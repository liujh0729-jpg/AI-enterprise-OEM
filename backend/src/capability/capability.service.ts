import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { UserLookupService } from '../directory/user-lookup.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { QxySettingsService } from '../qixiangyun/qxy-settings.service';
/** 税号索引口径：与企享云账号池一致（去空格与连字符、统一大写）。 */
const taxNoKey = (value: unknown) =>
  (typeof value === 'string' ? value : '').replace(/[\s-]/g, '').toUpperCase();
/**
 * 服务商提交审核时填写的「开通时间」（企业:能力 → YYYY-MM-DD）：
 * 存 system_settings 键值表，复用现有迁移（不新增 Prisma 字段）。
 */
export const CAPABILITY_OPEN_DATES_KEY = 'capability_open_dates';
const OPEN_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** 企业能力编码（平台开通后企业/财务人员才有对应功能）。 */
export const CAPABILITY_CODES = {
  E_TAX_FILING: '电子报税（自动申报）',
  E_INVOICING: '电子开票（自动开票）',
} as const;
export type CapabilityCode = keyof typeof CAPABILITY_CODES;
export const CAPABILITY_STATUS = {
  REQUESTED: '待平台审核',
  OPEN: '已开通',
  CLOSED: '已关闭',
} as const;
/**
 * 企业能力开通（需求 3.3 / 6.6）：
 * 服务商在「财税服务 · 财税自动化」按**服务企业**提交付费开通申请（含开通时间），
 * 请求进入「平台管理后台 · 服务商能力开通」审核；企业维度的开通 / 关闭与企享云账号
 * 匹配统一在「财税管理」，审核通过（OPEN）后财务人员才有「自动申报 / 自动开票」。
 */
export class CapabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly users: UserLookupService,
    private readonly accounts: QxySettingsService,
  ) {}
  private normalize(code: string): CapabilityCode {
    const key = String(code || '').toUpperCase() as CapabilityCode;
    if (!CAPABILITY_CODES[key]) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `能力编码不合法，仅支持 ${Object.keys(CAPABILITY_CODES).join(' / ')}`,
      );
    }
    return key;
  }
  /** 能力行 → 前端渲染结构（含未配置项）：emptyLabel 区分「未开通」（企业侧）/「未配置」（服务商配置页）。 */
  private shape(
    rows: {
      code: string;
      status: string;
      note: string;
      requestedBy: string;
      updatedAt: Date;
    }[],
    names: Map<string, string>,
    emptyLabel: string,
  ) {
    return Object.keys(CAPABILITY_CODES).map((code) => {
      const row = rows.find((item) => item.code === code);
      return {
        code,
        label: CAPABILITY_CODES[code as CapabilityCode],
        status: row?.status || 'NONE',
        statusLabel: row
          ? CAPABILITY_STATUS[row.status as keyof typeof CAPABILITY_STATUS] ||
            row.status
          : emptyLabel,
        note: row?.note || '',
        requestedByName: row?.requestedBy
          ? names.get(row.requestedBy) || row.requestedBy
          : '',
        updatedAt: row?.updatedAt || null,
      };
    });
  }
  /** 某企业的能力清单（含未申请项，便于前端直接渲染按钮）。 */
  async ofEnterprise(enterpriseId: number) {
    const rows = await this.prisma.enterpriseCapability.findMany({
      where: { enterpriseId },
    });
    return this.shape(rows, new Map(), '未开通');
  }
  /**
   * 服务商侧：按服务企业列出自动化能力配置矩阵（「⚡ 自动化能力」页）。
   * 服务商账号 / 承办职员：本人名下**生效签约**的服务企业；
   * 平台管理员：全部已生效企业（只读，开通 / 关闭在「平台管理后台 · 财税管理」）。
   */
  async servedMatrix(user: CurrentUser) {
    const isAdmin = this.identity.isPlatformAdmin(user);
    let ids: number[] = [];
    if (isAdmin) {
      const eps = await this.prisma.enterpriseProfile.findMany({
        where: { status: 'APPROVED' },
        orderBy: { id: 'asc' },
        select: { id: true },
      });
      ids = eps.map((item) => item.id);
    } else {
      const ctx = await this.identity.providerContext(user.userId);
      if (!ctx.providers.length) return [];
      const contracts = await this.prisma.contract.findMany({
        where: { providerUserId: { in: ctx.providers }, status: 'ACTIVE' },
      });
      ids = [...new Set(contracts.map((item) => item.enterpriseId))];
    }
    const enterprises = await this.prisma.enterpriseProfile.findMany({
      where: { id: { in: ids } },
      orderBy: { id: 'asc' },
    });
    const rows = await this.prisma.enterpriseCapability.findMany({
      where: { enterpriseId: { in: ids } },
    });
    const names = await this.namesOf(rows);
    return enterprises.map((ep) => ({
      enterpriseId: ep.id,
      name: ep.name,
      taxNo: ep.uscc || '',
      canConfigure: !isAdmin,
      capabilities: this.shape(
        rows.filter((item) => item.enterpriseId === ep.id),
        names,
        '未配置',
      ),
    }));
  }
  private async namesOf(
    rows: {
      requestedBy: string;
    }[],
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(rows.map((item) => item.requestedBy).filter(Boolean)),
    ];
    const users = await this.users.lookup(ids);
    return new Map(users.map((item) => [item.id, item.displayName]));
  }
  /** 企业侧/财务人员侧：查看本企业能力（企业当事人或该企业的承办人/服务商）。 */
  async mine(user: CurrentUser, enterpriseId?: number) {
    const id = await this.resolveEnterprise(user, enterpriseId);
    return this.ofEnterprise(id);
  }
  /**
   * 服务商侧配置（或企业侧申请）：把企业列入自动化能力，状态 REQUESTED（待平台审核）。
   * 未开通/已关闭时可配置；已开通（OPEN）不可重复配置。
   * opensAt：服务商提交审核时填写的开通时间（必填），平台后台可见。
   */
  async request(
    user: CurrentUser,
    code: string,
    note = '',
    enterpriseId?: number,
    opensAt = '',
  ) {
    const key = this.normalize(code);
    const id = await this.resolveEnterprise(user, enterpriseId);
    const opensAtText = this.openDate(opensAt);
    if (!opensAtText) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写开通时间（YYYY-MM-DD）',
      );
    }
    const row = await this.prisma.enterpriseCapability.findUnique({
      where: { enterpriseId_code: { enterpriseId: id, code: key } },
    });
    if (row?.status === 'OPEN') {
      throw new BusinessException(ErrorCode.CONFLICT, '该能力已开通');
    }
    const saved = await this.prisma.enterpriseCapability.upsert({
      where: { enterpriseId_code: { enterpriseId: id, code: key } },
      update: {
        status: 'REQUESTED',
        note: note.slice(0, 300),
        requestedBy: user.userId,
      },
      create: {
        enterpriseId: id,
        code: key,
        status: 'REQUESTED',
        note: note.slice(0, 300),
        requestedBy: user.userId,
      },
    });
    await this.writeOpenDate(id, key, opensAtText);
    await this.identity.audit(
      user.userId,
      '配置自动化能力（待平台审核）',
      `${CAPABILITY_CODES[key]}（企业 #${id}，开通时间 ${opensAtText}）`,
    );
    return { id: saved.id, enterpriseId: id, code: key, status: saved.status };
  }
  /** 撤回待审核的自动化配置（服务商配置后、平台审核前可撤回，回到未配置）。 */
  async cancel(user: CurrentUser, code: string, enterpriseId?: number) {
    const key = this.normalize(code);
    const id = await this.resolveEnterprise(user, enterpriseId);
    const row = await this.prisma.enterpriseCapability.findUnique({
      where: { enterpriseId_code: { enterpriseId: id, code: key } },
    });
    if (row?.status !== 'REQUESTED') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '仅「待平台审核」的配置可撤回',
      );
    }
    await this.prisma.enterpriseCapability.delete({ where: { id: row.id } });
    await this.writeOpenDate(id, key, null);
    await this.identity.audit(
      user.userId,
      '撤回自动化能力配置',
      `${CAPABILITY_CODES[key]}（企业 #${id}）`,
    );
    return { enterpriseId: id, code: key, status: 'NONE' };
  }
  /** 平台管理员：开通 / 关闭；开通时可按税号匹配企享云报税 API Key。 */
  async setStatus(
    user: CurrentUser,
    enterpriseId: number,
    code: string,
    action: 'open' | 'close',
    note = '',
    qxyAccountId = '',
  ) {
    this.identity.requireAdmin(user);
    const key = this.normalize(code);
    const enterprise = await this.prisma.enterpriseProfile.findUnique({
      where: { id: enterpriseId },
    });
    if (!enterprise) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '企业不存在');
    }
    if (action !== 'close' && qxyAccountId) {
      if (!taxNoKey(enterprise.uscc))
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `企业「${enterprise.name}」缺少统一社会信用代码（税号），请先补全企业档案`,
        );
      await this.accounts.bind(user, qxyAccountId, enterprise.uscc);
    }
    const status = action === 'close' ? 'CLOSED' : 'OPEN';
    const saved = await this.prisma.enterpriseCapability.upsert({
      where: { enterpriseId_code: { enterpriseId, code: key } },
      update: { status, note: note.slice(0, 300), openedBy: user.userId },
      create: {
        enterpriseId,
        code: key,
        status,
        note: note.slice(0, 300),
        openedBy: user.userId,
      },
    });
    await this.identity.audit(
      user.userId,
      action === 'close' ? '关闭企业能力' : '开通企业能力',
      `${enterprise.name} · ${CAPABILITY_CODES[key]}`,
    );
    return { id: saved.id, code: key, status: saved.status };
  }
  /** 待平台审核的配置/申请（平台管理后台列表，含配置人）。 */
  async pendingRequests() {
    return (await this.pendingRequestPage()).list;
  }
  async pendingRequestPage(page?: number, pageSize = 20) {
    const [rows, total] = await Promise.all([
      this.prisma.enterpriseCapability.findMany({
        where: { status: 'REQUESTED' },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        ...(page ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
      }),
      this.prisma.enterpriseCapability.count({
        where: { status: 'REQUESTED' },
      }),
    ]);
    const enterprises = await this.prisma.enterpriseProfile.findMany({
      where: { id: { in: rows.map((item) => item.enterpriseId) } },
    });
    const names = await this.namesOf(rows);
    const bindings = await this.accounts.bindingIndex();
    const dates = await this.openDates();
    const list = rows.map((row) => {
      const enterprise = enterprises.find(
        (item) => item.id === row.enterpriseId,
      );
      return {
        ...row,
        label: CAPABILITY_CODES[row.code as CapabilityCode] || row.code,
        enterpriseName: enterprise?.name || '',
        taxNo: enterprise?.uscc || '',
        qxyAccountName: bindings.get(taxNoKey(enterprise?.uscc))?.label || '',
        opensAt: dates[`${row.enterpriseId}:${row.code}`] || '',
        requestedByName: row.requestedBy
          ? names.get(row.requestedBy) || row.requestedBy
          : '',
      };
    });
    return { list, total, page: page || 1, pageSize };
  }
  /** 平台「财税管理 · 已开通」：OPEN 能力清单（开通时间 / 匹配账号 / 开通人）。 */
  async openedPage(page?: number, pageSize = 20) {
    const [rows, total] = await Promise.all([
      this.prisma.enterpriseCapability.findMany({
        where: { status: 'OPEN' },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        ...(page ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
      }),
      this.prisma.enterpriseCapability.count({ where: { status: 'OPEN' } }),
    ]);
    const enterprises = await this.prisma.enterpriseProfile.findMany({
      where: { id: { in: rows.map((item) => item.enterpriseId) } },
    });
    const names = await this.namesOf(
      rows.map((item) => ({ requestedBy: item.openedBy || item.requestedBy })),
    );
    const bindings = await this.accounts.bindingIndex();
    const dates = await this.openDates();
    const list = rows.map((row) => {
      const enterprise = enterprises.find(
        (item) => item.id === row.enterpriseId,
      );
      return {
        id: row.id,
        enterpriseId: row.enterpriseId,
        enterpriseName: enterprise?.name || '',
        taxNo: enterprise?.uscc || '',
        code: row.code,
        label: CAPABILITY_CODES[row.code as CapabilityCode] || row.code,
        qxyAccountName: bindings.get(taxNoKey(enterprise?.uscc))?.label || '',
        opensAt:
          dates[`${row.enterpriseId}:${row.code}`] ||
          row.updatedAt.toISOString().slice(0, 10),
        openedByName: row.openedBy
          ? names.get(row.openedBy) || row.openedBy
          : '',
        openedAt: row.updatedAt.toISOString(),
      };
    });
    return { list, total, page: page || 1, pageSize };
  }
  async adminMatrix(user: CurrentUser, page?: number, pageSize = 20) {
    this.identity.requireAdmin(user);
    const [eps, total] = await Promise.all([
      this.prisma.enterpriseProfile.findMany({
        where: { status: 'APPROVED' },
        orderBy: { id: 'asc' },
        ...(page ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
      }),
      this.prisma.enterpriseProfile.count({ where: { status: 'APPROVED' } }),
    ]);
    const rows = await this.prisma.enterpriseCapability.findMany({
      where: { enterpriseId: { in: eps.map((item) => item.id) } },
    });
    const bindings = await this.accounts.bindingIndex();
    const list = eps.map((ep) => ({
      enterpriseId: ep.id,
      name: ep.name,
      taxFiling:
        rows.find((r) => r.enterpriseId === ep.id && r.code === 'E_TAX_FILING')
          ?.status || 'NONE',
      invoicing:
        rows.find((r) => r.enterpriseId === ep.id && r.code === 'E_INVOICING')
          ?.status || 'NONE',
      taxNo: ep.uscc || '',
      qxyAccountName: bindings.get(taxNoKey(ep.uscc))?.label || '',
    }));
    return { list, total, page: page || 1, pageSize };
  }
  /** 开通时间索引（企业:能力 → YYYY-MM-DD）；键值表损坏时降级为空。 */
  private async openDates(): Promise<Record<string, string>> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: CAPABILITY_OPEN_DATES_KEY },
    });
    if (!row?.value) return {};
    try {
      const parsed = JSON.parse(row.value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, string>)
        : {};
    } catch {
      return {};
    }
  }
  /** 写入 / 清除某企业某能力的开通时间（撤回申请时清除）。 */
  private async writeOpenDate(
    enterpriseId: number,
    code: string,
    date: string | null,
  ) {
    const map = await this.openDates();
    const key = `${enterpriseId}:${code}`;
    if (date) map[key] = date;
    else delete map[key];
    const value = JSON.stringify(map);
    await this.prisma.systemSetting.upsert({
      where: { key: CAPABILITY_OPEN_DATES_KEY },
      create: { key: CAPABILITY_OPEN_DATES_KEY, value },
      update: { value },
    });
  }
  /** 开通时间格式归一：留空返回空串，非法格式直接拒绝。 */
  private openDate(value: unknown) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return '';
    if (
      !OPEN_DATE_PATTERN.test(text) ||
      Number.isNaN(new Date(`${text}T00:00:00`).valueOf())
    )
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '开通时间格式不正确（YYYY-MM-DD）',
      );
    return text;
  }
  /** 企业维度解析：管理员可指定；企业当事人取本企业；
   *  服务商/承办职员取其正在服务（有生效签约）的企业 —— 财务人员可代为申请开通。 */
  private async resolveEnterprise(user: CurrentUser, enterpriseId?: number) {
    const wanted = Number(enterpriseId || 0);
    if (this.identity.isPlatformAdmin(user)) {
      if (!wanted) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '请指定企业');
      }
      return wanted;
    }
    const own = await this.identity.myEnterprises(user.userId);
    if (wanted && own.some((item) => item.id === wanted)) return wanted;
    if (!wanted && own.length) return own[0].id;
    if (wanted) {
      const ctx = await this.identity.providerContext(user.userId);
      if (ctx.providers.length) {
        const contract = await this.prisma.contract.findFirst({
          where: {
            enterpriseId: wanted,
            providerUserId: { in: ctx.providers },
            status: 'ACTIVE',
          },
        });
        if (contract) return wanted;
      }
    }
    throw new BusinessException(
      ErrorCode.ROLE_MISMATCH,
      '仅企业当事人或该企业的服务商/承办职员可查看与申请企业能力',
    );
  }
}
