import { Prisma } from '../../generated/prisma';
import { LIST_ALL_LIMIT, text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiCallCrypto } from './ai-call-crypto';

export const AI_CALL_STATUSES = ['active', 'disabled'] as const;

/**
 * 「其他字段」在库里和接口里都是明文，所以键名一旦像凭据就得拦下来，
 * 逼用户把口令改填进会加密、且不回显的专用字段。
 */
const SECRET_LIKE_EXTRA_KEY =
  /(pass(word)?|passwd|pwd|token|secret|cookie|api[-_]?key|access[-_]?key|private[-_]?key|credential)/i;

/**
 * AI 调用账号：AI 自动化任务要登录第三方平台时来这里取凭据。
 *
 * 凭据（口令 / API Key / Cookie）只存密文，界面与列表一律只回「存过没有」；
 * 明文只在 `/api/v1/ai-call` 机器通道读取时解密一次，且必须带着
 * 「已绑定这个 AI 账号的 Workbuddy Enterprise 账号」来换。
 */
export class AiCallAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly crypto: AiCallCrypto,
  ) {}

  async list(user: CurrentUser, query: { keyword?: string }) {
    const keyword = text(query.keyword).trim();
    const rows = await this.prisma.aiCallAccount.findMany({
      where: {
        createdBy: user.userId,
        ...(keyword
          ? {
              OR: [
                { name: { contains: keyword } },
                { platform: { contains: keyword } },
                { username: { contains: keyword } },
              ],
            }
          : {}),
      },
      include: {
        bindings: {
          include: {
            workbuddyAccount: {
              select: { id: true, name: true, status: true },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      // 界面侧没有分页参数：一次读取封顶（与 pageQuery 上限一致）
      take: LIST_ALL_LIMIT + 1,
    });
    const truncated = rows.length > LIST_ALL_LIMIT;
    const visible = truncated ? rows.slice(0, LIST_ALL_LIMIT) : rows;
    return visible.map((row) => this.decorate(row));
  }

  async get(user: CurrentUser, id: number) {
    const row = await this.loadOwned(user, id);
    return this.decorate(row);
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    const name = text(body.name).trim().slice(0, 128);
    if (!name) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请给这个账号起个名字（如「淘宝-运营店」）',
      );
    }
    const platform = text(body.platform).trim();
    if (!platform) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写平台名称或站点地址',
      );
    }
    const username = text(body.username).trim();
    const password = text(body.password);
    const apiKey = text(body.apiKey).trim();
    const cookie = text(body.cookie).trim();
    if (!password && !apiKey && !cookie) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '至少要填一种凭据：登录口令 / API Key / Cookie',
      );
    }
    const boundIds = await this.readBindings(user, body.workbuddyAccountIds);
    const extra = this.readExtra(body.extra);
    const row = await this.prisma.aiCallAccount.create({
      data: {
        createdBy: user.userId,
        name,
        platform: platform.slice(0, 191),
        loginUrl: text(body.loginUrl).trim().slice(0, 500),
        username: username.slice(0, 191),
        passwordCipher: password ? this.crypto.encrypt(password) : '',
        apiKeyCipher: apiKey ? this.crypto.encrypt(apiKey) : '',
        cookieCipher: cookie ? this.crypto.encrypt(cookie) : '',
        extra,
        status: this.normalizeStatus(body.status, 'active'),
        notes: text(body.notes).trim().slice(0, 500),
        bindings: {
          create: boundIds.map((workbuddyAccountId) => ({
            workbuddyAccountId,
          })),
        },
      },
      include: {
        bindings: {
          include: {
            workbuddyAccount: {
              select: { id: true, name: true, status: true },
            },
          },
        },
      },
    });
    await this.identity.audit(
      user.userId,
      'AI调用登记账号',
      `#${row.id} ${row.platform}/${row.name}`,
    );
    return this.decorate(row);
  }

  async update(user: CurrentUser, id: number, body: Record<string, unknown>) {
    const row = await this.loadOwned(user, id);
    const data: Prisma.AiCallAccountUpdateInput = {};
    if (body.name !== undefined) {
      const name = text(body.name).trim().slice(0, 128);
      if (!name) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '名称不能为空');
      }
      data.name = name;
    }
    if (body.platform !== undefined) {
      const platform = text(body.platform).trim();
      if (!platform) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '平台名称不能为空');
      }
      data.platform = platform.slice(0, 191);
    }
    if (body.loginUrl !== undefined) {
      data.loginUrl = text(body.loginUrl).trim().slice(0, 500);
    }
    if (body.username !== undefined) {
      data.username = text(body.username).trim().slice(0, 191);
    }
    // 凭据留空＝不动已存密文（界面不回显旧值）
    const password = text(body.password);
    if (password) data.passwordCipher = this.crypto.encrypt(password);
    const apiKey = text(body.apiKey).trim();
    if (apiKey) data.apiKeyCipher = this.crypto.encrypt(apiKey);
    const cookie = text(body.cookie).trim();
    if (cookie) data.cookieCipher = this.crypto.encrypt(cookie);
    if (body.extra !== undefined) {
      data.extra = this.readExtra(body.extra);
    }
    if (body.status !== undefined) {
      data.status = this.normalizeStatus(body.status, row.status);
    }
    if (body.notes !== undefined) {
      data.notes = text(body.notes).trim().slice(0, 500);
    }
    const boundIds =
      body.workbuddyAccountIds === undefined
        ? null
        : await this.readBindings(user, body.workbuddyAccountIds);
    if (!Object.keys(data).length && boundIds === null) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有需要保存的修改');
    }
    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length) {
        await tx.aiCallAccount.update({ where: { id }, data });
      }
      if (boundIds) {
        await tx.aiCallAccountBinding.deleteMany({ where: { accountId: id } });
        await tx.aiCallAccountBinding.createMany({
          data: boundIds.map((workbuddyAccountId) => ({
            accountId: id,
            workbuddyAccountId,
          })),
        });
      }
    });
    await this.identity.audit(
      user.userId,
      'AI调用修改账号',
      `#${id} ${row.platform}/${row.name}`,
    );
    return this.get(user, id);
  }

  async remove(user: CurrentUser, id: number) {
    const row = await this.loadOwned(user, id);
    await this.prisma.aiCallAccount.delete({ where: { id } });
    await this.identity.audit(
      user.userId,
      'AI调用删除账号',
      `#${id} ${row.platform}/${row.name}`,
    );
    return { id };
  }

  /** 机器通道：按 Workbuddy Enterprise 账号列可调用的账号（不含任何明文凭据）。 */
  async openList(
    user: CurrentUser,
    workbuddyAccountId: number,
    platform?: string,
  ) {
    const wb = await this.loadWorkbuddy(user, workbuddyAccountId);
    const keyword = text(platform).trim();
    const rows = await this.prisma.aiCallAccount.findMany({
      where: {
        createdBy: user.userId,
        status: 'active',
        ...(keyword ? { platform: { contains: keyword } } : {}),
        bindings: { some: { workbuddyAccountId: wb.id } },
      },
      include: {
        bindings: {
          include: {
            workbuddyAccount: {
              select: { id: true, name: true, status: true },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      // 同一把 Enterprise 账号绑定的可调用账号封顶，避免一次搬全表
      take: LIST_ALL_LIMIT + 1,
    });
    const truncated = rows.length > LIST_ALL_LIMIT;
    const visible = truncated ? rows.slice(0, LIST_ALL_LIMIT) : rows;
    return visible.map((row) => this.decorate(row));
  }

  /**
   * 机器通道：解密一次给 AI 任务用。
   * 必须同时满足：账号归本人、AI 账号启用、Workbuddy 账号启用、两者已绑定。
   */
  async openCredentials(
    user: CurrentUser,
    id: number,
    workbuddyAccountId: number,
  ) {
    const wb = await this.loadWorkbuddy(user, workbuddyAccountId);
    const row = await this.loadOwned(user, id);
    if (row.status !== 'active') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '这个 AI 调用账号已停用，请先在「AI 调用账号」里启用',
      );
    }
    const binding = await this.prisma.aiCallAccountBinding.findUnique({
      where: {
        accountId_workbuddyAccountId: {
          accountId: id,
          workbuddyAccountId: wb.id,
        },
      },
    });
    if (!binding) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '这个 AI 调用账号没有绑定当前 Workbuddy Enterprise 账号',
      );
    }
    await this.identity.audit(
      user.userId,
      'AI调用读取凭据',
      `#${id} ${row.platform}/${row.name}（Workbuddy ${wb.name}）`,
    );
    return {
      id: row.id,
      name: row.name,
      platform: row.platform,
      loginUrl: row.loginUrl,
      username: row.username,
      password: this.decrypt(row.passwordCipher),
      apiKey: this.decrypt(row.apiKeyCipher),
      cookie: this.decrypt(row.cookieCipher),
      extra: row.extra ?? {},
    };
  }

  private decrypt(sealed: string) {
    return sealed ? this.crypto.decrypt(sealed) : '';
  }

  private async loadOwned(user: CurrentUser, id: number) {
    const row = await this.prisma.aiCallAccount.findUnique({
      where: { id },
      include: {
        bindings: {
          include: {
            workbuddyAccount: {
              select: { id: true, name: true, status: true },
            },
          },
        },
      },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, 'AI 调用账号不存在');
    }
    if (row.createdBy !== user.userId) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '该 AI 调用账号归他人所有',
      );
    }
    return row;
  }

  /** 绑定的 Workbuddy Enterprise 账号必须存在且归本人；至少要绑一个。 */
  private async readBindings(
    user: CurrentUser,
    raw: unknown,
  ): Promise<number[]> {
    const ids = Array.isArray(raw)
      ? [...new Set(raw.map((item) => Number(item)))]
      : [];
    const valid = ids.filter((item) => Number.isInteger(item) && item > 0);
    if (!valid.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请至少绑定一个 Workbuddy Enterprise 账号',
      );
    }
    const rows = await this.prisma.workbuddyAccount.findMany({
      where: { id: { in: valid } },
      select: { id: true, createdBy: true },
    });
    if (rows.length !== valid.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '有 Workbuddy Enterprise 账号不存在',
      );
    }
    if (rows.some((row) => row.createdBy !== user.userId)) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '只能绑定自己的 Workbuddy Enterprise 账号',
      );
    }
    return valid;
  }

  private async loadWorkbuddy(user: CurrentUser, id: number) {
    const row = await this.prisma.workbuddyAccount.findUnique({
      where: { id },
      select: { id: true, name: true, createdBy: true, status: true },
    });
    if (!row || row.createdBy !== user.userId) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        'Workbuddy Enterprise 账号不存在',
      );
    }
    if (row.status !== 'active') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `Workbuddy Enterprise 账号「${row.name}」已停用，请先启用`,
      );
    }
    return row;
  }

  private normalizeStatus(raw: unknown, fallback: string) {
    const value = text(raw).trim();
    if (!value) return fallback;
    if (!(AI_CALL_STATUSES as readonly string[]).includes(value)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '账号状态只能是 active（启用）或 disabled（停用）',
      );
    }
    return value;
  }

  /** 平台特有字段：只收一层键值对，值统一转成字符串。 */
  private readExtra(raw: unknown): Prisma.InputJsonValue {
    if (raw === undefined || raw === null || raw === '') return {};
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '其他字段必须是键值对',
      );
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const name = key.trim().slice(0, 64);
      if (!name || value === undefined || value === null) continue;
      if (SECRET_LIKE_EXTRA_KEY.test(name)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `「${name}」是凭据，请填在登录口令 / API Key / Cookie 里（其他字段不明文存凭据）`,
        );
      }
      result[name] = (
        typeof value === 'object' ? JSON.stringify(value) : text(value)
      ).slice(0, 1000);
    }
    if (JSON.stringify(result).length > 4000) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '其他字段合计不能超过 4000 字符',
      );
    }
    return result;
  }

  private decorate(row: {
    id: number;
    createdBy: string;
    name: string;
    platform: string;
    loginUrl: string;
    username: string;
    passwordCipher: string;
    apiKeyCipher: string;
    cookieCipher: string;
    extra: Prisma.JsonValue;
    status: string;
    notes: string;
    createdAt: Date;
    updatedAt: Date;
    bindings: {
      workbuddyAccountId: number;
      workbuddyAccount: { id: number; name: string; status: string };
    }[];
  }) {
    return {
      id: row.id,
      createdBy: row.createdBy,
      name: row.name,
      platform: row.platform,
      loginUrl: row.loginUrl,
      username: row.username,
      extra: row.extra ?? {},
      status: row.status,
      notes: row.notes,
      hasPassword: Boolean(row.passwordCipher),
      hasApiKey: Boolean(row.apiKeyCipher),
      hasCookie: Boolean(row.cookieCipher),
      bindings: row.bindings.map((binding) => ({
        workbuddyAccountId: binding.workbuddyAccountId,
        name: binding.workbuddyAccount.name,
        status: binding.workbuddyAccount.status,
      })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
