import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
/** 专用加密配置，禁止通过通用系统参数接口读取或覆盖。 */
export const QXY_SETTINGS_KEY = 'qxy_credentials';
/** 企享云账号池：平台管理员维护的多个报税账号（加密 JSON），同样禁止通用接口读写。 */
export const QXY_ACCOUNTS_KEY = 'qxy_accounts';
/** 每个账号最多绑定的税号数。 */
export const QXY_ACCOUNT_TAX_LIMIT = 5;
/** 到期前多少天进入红色提醒（仅提醒，不拦截调用）。 */
export const QXY_ACCOUNT_EXPIRING_DAYS = 10;
export type QxyCredentials = {
  appkey: string;
  secret: string;
};
/** 账号池存储结构（整池加密，接口只下发掩码）。 */
export type QxyAccount = {
  id: string;
  label: string;
  appkey: string;
  secret: string;
  taxNos: string[];
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};
export type QxyAccountView = {
  id: string;
  label: string;
  appkeyMasked: string;
  taxNos: string[];
  expiresAt: string;
  daysLeft: number | null;
  expiring: boolean;
  updatedAt: string;
};
export type QxyAccountInput = {
  id?: unknown;
  label?: unknown;
  appkey?: unknown;
  secret?: unknown;
  expiresAt?: unknown;
  taxNos?: unknown;
};
export class QxySettingsService {
  private readonly key: Buffer;
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {
    const source = String(process.env.EXTERNAL_CRED_KEY || '').trim();
    if (!source)
      throw new Error('EXTERNAL_CRED_KEY 未配置，无法加密企享云凭据');
    this.key = createHash('sha256')
      .update(`aiworkin-qxy-credentials|${source}`)
      .digest();
  }
  private environment(): QxyCredentials {
    return {
      appkey: String(process.env.QXY_APPKEY || '').trim(),
      secret: String(process.env.QXY_SECRET || '').trim(),
    };
  }
  private row() {
    return this.prisma.systemSetting.findUnique({
      where: { key: QXY_SETTINGS_KEY },
    });
  }
  /** 不回传明文或密文；后台未保存过时兼容原有部署凭据。 */
  async status() {
    const legacy = await this.legacyStatus();
    let pooled = 0;
    try {
      pooled = (await this.accounts()).length;
    } catch {
      // 账号池损坏不影响整体状态判定，修复入口在「财税管理」账号池。
      pooled = 0;
    }
    return {
      configured: pooled > 0 || legacy.configured,
      source: pooled > 0 ? 'pool' : legacy.source,
      updatedAt: legacy.updatedAt,
    };
  }
  private async legacyStatus() {
    const row = await this.row();
    const env = this.environment();
    return {
      configured: Boolean(row || (env.appkey && env.secret)),
      source: row ? 'db' : env.appkey && env.secret ? 'env' : 'none',
      updatedAt: row?.updatedAt || null,
    };
  }
  async view(user: CurrentUser) {
    this.identity.requireAdmin(user);
    return this.status();
  }
  /** 凭据文本校验：必填且不超过 4096 个字符。 */
  private validate(value: unknown, label: string) {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.trim().length > 4096
    ) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `请填写有效的 ${label}（最多 4096 个字符）`,
      );
    }
    return value.trim();
  }
  /** 每次调用读取当前配置，保存后生效；已有后台配置解密失败时不回退旧凭据。 */
  async resolve(): Promise<QxyCredentials> {
    const row = await this.row();
    if (!row) return this.environment();
    try {
      const data = this.open<QxyCredentials>(row.value);
      return {
        appkey: this.validate(data.appkey, 'AppKey'),
        secret: this.validate(data.secret, 'Secret'),
      };
    } catch {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '企享云历史凭据无法读取，请平台管理员在「财税管理」重新配置账号并绑定税号',
      );
    }
  }
  private seal(data: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(data), 'utf8'),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), encrypted]
      .map((part) => part.toString('base64'))
      .join(':');
  }
  private open<T>(value: string): T {
    const parts = String(value || '').split(':');
    if (parts.length !== 3) throw new Error('invalid ciphertext');
    const [iv, tag, encrypted] = parts.map((part) =>
      Buffer.from(part, 'base64'),
    );
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plain) as T;
  }
  // ---------- 企享云报税账号池（平台管理员） ----------
  private accountsRow() {
    return this.prisma.systemSetting.findUnique({
      where: { key: QXY_ACCOUNTS_KEY },
    });
  }
  /** 读取并解密账号池；密文损坏时明确提示修复入口。 */
  private async accounts(): Promise<QxyAccount[]> {
    const row = await this.accountsRow();
    if (!row) return [];
    try {
      const data = this.open<{ accounts?: unknown }>(row.value);
      const list = Array.isArray(data?.accounts) ? data.accounts : [];
      return list.map((item) => this.accountOf(item));
    } catch {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '企享云账号池无法读取，请平台管理员在「财税管理」重新保存账号',
      );
    }
  }
  private accountOf(value: unknown): QxyAccount {
    const row = (value || {}) as Partial<QxyAccount>;
    return {
      id: String(row.id || ''),
      label: String(row.label || ''),
      appkey: String(row.appkey || ''),
      secret: String(row.secret || ''),
      taxNos: Array.isArray(row.taxNos)
        ? row.taxNos.map((item) => String(item || '').trim()).filter(Boolean)
        : [],
      expiresAt: String(row.expiresAt || ''),
      createdAt: String(row.createdAt || ''),
      updatedAt: String(row.updatedAt || ''),
    };
  }
  private async write(accounts: QxyAccount[]) {
    return this.prisma.systemSetting.upsert({
      where: { key: QXY_ACCOUNTS_KEY },
      create: { key: QXY_ACCOUNTS_KEY, value: this.seal({ accounts }) },
      update: { value: this.seal({ accounts }) },
    });
  }
  /** 到期提醒：仅前端标红，不参与任何拦截判断。 */
  private expiry(expiresAt: string) {
    if (!expiresAt) return { daysLeft: null as number | null, expiring: false };
    const end = new Date(`${expiresAt}T23:59:59`);
    if (Number.isNaN(end.valueOf()))
      return { daysLeft: null as number | null, expiring: false };
    const daysLeft = Math.ceil((end.getTime() - Date.now()) / 86400000);
    return { daysLeft, expiring: daysLeft <= QXY_ACCOUNT_EXPIRING_DAYS };
  }
  private viewOf(account: QxyAccount): QxyAccountView {
    const key = account.appkey;
    return {
      id: account.id,
      label: account.label,
      appkeyMasked:
        key.length <= 8
          ? `${key.slice(0, 2)}****`
          : `${key.slice(0, 4)}****${key.slice(-4)}`,
      taxNos: [...account.taxNos],
      expiresAt: account.expiresAt,
      ...this.expiry(account.expiresAt),
      updatedAt: account.updatedAt,
    };
  }
  private async payload(accounts: QxyAccount[]) {
    const legacy = await this.legacyStatus();
    return {
      accounts: accounts.map((item) => this.viewOf(item)),
      maxTaxNos: QXY_ACCOUNT_TAX_LIMIT,
      expiringDays: QXY_ACCOUNT_EXPIRING_DAYS,
      legacyConfigured: legacy.configured,
      legacySource: legacy.source,
    };
  }
  async list(user: CurrentUser) {
    this.identity.requireAdmin(user);
    return this.payload(await this.accounts());
  }
  /** 新增 / 编辑账号：编辑时 AppKey、Secret 留空沿用原值。 */
  async save(user: CurrentUser, body: QxyAccountInput) {
    this.identity.requireAdmin(user);
    const accounts = await this.accounts();
    const id = this.plain(body?.id).trim();
    const current = id ? accounts.find((item) => item.id === id) : undefined;
    if (id && !current)
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '账号不存在（可能已被删除），请刷新后重试',
      );
    const label = this.text(body?.label, '账号名称', 60);
    const appkey = this.keepOrValidate(body?.appkey, current?.appkey, 'AppKey');
    const secret = this.keepOrValidate(body?.secret, current?.secret, 'Secret');
    const expiresAt = this.date(body?.expiresAt);
    const taxNos = this.taxNos(
      body?.taxNos === undefined ? current?.taxNos || [] : body.taxNos,
      accounts,
      current?.id,
    );
    const now = new Date().toISOString();
    const next: QxyAccount = {
      id: current?.id || randomBytes(6).toString('hex'),
      label,
      appkey,
      secret,
      taxNos,
      expiresAt,
      createdAt: current?.createdAt || now,
      updatedAt: now,
    };
    const saved = current
      ? accounts.map((item) => (item.id === next.id ? next : item))
      : [...accounts, next];
    await this.write(saved);
    await this.identity.audit(
      user.userId,
      current ? '更新企享云报税账号' : '新增企享云报税账号',
      `${label} · 税号 ${taxNos.length}/${QXY_ACCOUNT_TAX_LIMIT}`,
    );
    return this.payload(saved);
  }
  async remove(user: CurrentUser, id: string) {
    this.identity.requireAdmin(user);
    const accounts = await this.accounts();
    const current = accounts.find((item) => item.id === id);
    if (!current)
      throw new BusinessException(ErrorCode.NOT_FOUND, '账号不存在');
    const saved = accounts.filter((item) => item.id !== id);
    await this.write(saved);
    await this.identity.audit(
      user.userId,
      '删除企享云报税账号',
      `${current.label} · 解除税号 ${current.taxNos.length} 个`,
    );
    return this.payload(saved);
  }
  /** 税号匹配：一个税号只能属于一个账号，每账号最多 5 个。 */
  async bind(user: CurrentUser, id: string, taxNo: string) {
    this.identity.requireAdmin(user);
    const accounts = await this.accounts();
    const current = accounts.find((item) => item.id === id);
    if (!current)
      throw new BusinessException(ErrorCode.NOT_FOUND, '账号不存在');
    const key = this.normalizeTaxNo(taxNo);
    if (!key)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写 15-20 位统一社会信用代码（税号）',
      );
    const owner = accounts.find(
      (item) => item.id !== current.id && item.taxNos.includes(key),
    );
    if (owner)
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `该税号已绑定「${owner.label}」，请先解除后再绑定`,
      );
    if (current.taxNos.includes(key)) return this.payload(accounts);
    if (current.taxNos.length >= QXY_ACCOUNT_TAX_LIMIT)
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `该账号最多绑定 ${QXY_ACCOUNT_TAX_LIMIT} 个税号，请先解除或选择其他账号`,
      );
    const next: QxyAccount = {
      ...current,
      taxNos: [...current.taxNos, key],
      updatedAt: new Date().toISOString(),
    };
    const saved = accounts.map((item) => (item.id === next.id ? next : item));
    await this.write(saved);
    await this.identity.audit(
      user.userId,
      '匹配企享云报税税号',
      `${current.label} ← ${key}`,
    );
    return this.payload(saved);
  }
  async unbind(user: CurrentUser, id: string, taxNo: string) {
    this.identity.requireAdmin(user);
    const accounts = await this.accounts();
    const current = accounts.find((item) => item.id === id);
    if (!current)
      throw new BusinessException(ErrorCode.NOT_FOUND, '账号不存在');
    const key = this.normalizeTaxNo(taxNo);
    if (!current.taxNos.includes(key)) return this.payload(accounts);
    const next: QxyAccount = {
      ...current,
      taxNos: current.taxNos.filter((item) => item !== key),
      updatedAt: new Date().toISOString(),
    };
    const saved = accounts.map((item) => (item.id === next.id ? next : item));
    await this.write(saved);
    await this.identity.audit(
      user.userId,
      '解除企享云报税税号',
      `${current.label} ✕ ${key}`,
    );
    return this.payload(saved);
  }
  /** 税号 → 账号索引（能力矩阵展示当前匹配账号）；账号池损坏时降级为空。 */
  async bindingIndex(): Promise<
    Map<string, { accountId: string; label: string }>
  > {
    const index = new Map<string, { accountId: string; label: string }>();
    let accounts: QxyAccount[] = [];
    try {
      accounts = await this.accounts();
    } catch {
      return index;
    }
    for (const account of accounts) {
      for (const taxNo of account.taxNos)
        index.set(taxNo, { accountId: account.id, label: account.label });
    }
    return index;
  }
  /** 业务调用按企业税号取账号凭据；未匹配时回退历史单凭据 / 部署环境变量。 */
  async credentialsForTaxNo(taxNo?: string): Promise<QxyCredentials | null> {
    const key = this.normalizeTaxNo(taxNo);
    const accounts = await this.accounts();
    const hit = key
      ? accounts.find((item) => item.taxNos.includes(key))
      : undefined;
    if (hit) return { appkey: hit.appkey, secret: hit.secret };
    const legacy = await this.resolve();
    return legacy.appkey && legacy.secret ? legacy : null;
  }
  /** 请求体字段归一：只接受文本 / 数字，其余（对象等）一律按空串处理。 */
  private plain(value: unknown) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value))
      return String(value);
    return '';
  }
  private normalizeTaxNo(value: unknown) {
    return this.plain(value).replace(/[\s-]/g, '').toUpperCase();
  }
  private text(value: unknown, label: string, max: number) {
    const text = this.plain(value).trim();
    if (!text || text.length > max)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `请填写有效的${label}（最多 ${max} 个字符）`,
      );
    return text;
  }
  private keepOrValidate(
    value: unknown,
    current: string | undefined,
    label: string,
  ) {
    const text = this.plain(value).trim();
    if (!text && current) return current;
    return this.validate(value, label);
  }
  private date(value: unknown) {
    const text = this.plain(value).trim();
    if (!text) return '';
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
      Number.isNaN(new Date(`${text}T00:00:00`).valueOf())
    )
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写有效的到期时间（YYYY-MM-DD）',
      );
    return text;
  }
  private taxNos(value: unknown, accounts: QxyAccount[], selfId?: string) {
    if (!Array.isArray(value))
      throw new BusinessException(ErrorCode.BAD_REQUEST, '税号列表格式不正确');
    const list = [
      ...new Set(
        value.map((item) => this.normalizeTaxNo(item)).filter(Boolean),
      ),
    ];
    if (list.length > QXY_ACCOUNT_TAX_LIMIT)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `每个账号最多绑定 ${QXY_ACCOUNT_TAX_LIMIT} 个税号`,
      );
    for (const taxNo of list) {
      if (!/^[0-9A-Z]{15,20}$/.test(taxNo))
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `税号「${taxNo}」格式不正确（15-20 位数字或大写字母）`,
        );
      const owner = accounts.find(
        (item) => item.id !== selfId && item.taxNos.includes(taxNo),
      );
      if (owner)
        throw new BusinessException(
          ErrorCode.CONFLICT,
          `税号「${taxNo}」已绑定「${owner.label}」，请先解除后再绑定`,
        );
    }
    return list;
  }
}
