import { Prisma } from '../../generated/prisma';
import { LIST_ALL_LIMIT, text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { RpaCrypto } from './rpa-crypto';
import {
  ACCOUNT_STATUSES,
  normalizeChoice,
  normalizeEnvType,
  normalizeProxyMethod,
  normalizeProxyType,
} from './rpa-shared';

/** 一条 RPA 账号（任务绑定与执行报文要看的字段；口令在本类型里只以密文形态出现）。 */
export type RpaAccountRow = {
  id: number;
  createdBy: string;
  platform: string;
  nickname: string;
  username: string;
  keyCipher: string;
  loginUrl: string;
  envType: number;
  status: string;
  proxyMethod: number;
  proxyType: string;
  proxyHost: string;
  proxyPort: number;
  proxyUserName: string;
  proxyPasswordCipher: string;
  notes: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * RPA 账号：本地比特浏览器登录目标平台要用的凭据清单。
 * 登录口令与代理口令都以 AES-256-GCM 密文落库，只有「任务派发」这一条链路会把它们
 * 解密回传给执行端（执行端要真的登录），列表 / 详情 / 管理接口一律只回「是否已保存口令」。
 */
export class RpaAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly crypto: RpaCrypto,
  ) {}

  async list(user: CurrentUser, query: { keyword?: string }) {
    const keyword = text(query.keyword).trim();
    const rows = await this.prisma.rpaAccount.findMany({
      where: {
        ...(this.identity.isPlatformAdmin(user)
          ? {}
          : { createdBy: user.userId }),
        ...(keyword
          ? {
              OR: [
                { username: { contains: keyword } },
                { nickname: { contains: keyword } },
                { platform: { contains: keyword } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      // 界面侧没有分页参数，管理员又是全库视图，必须给一次读取封顶（与 pageQuery 上限一致）。
      take: LIST_ALL_LIMIT + 1,
    });
    const truncated = rows.length > LIST_ALL_LIMIT;
    const visible = truncated ? rows.slice(0, LIST_ALL_LIMIT) : rows;
    return visible.map((row) => decorate(row));
  }

  async get(user: CurrentUser, id: number) {
    return decorate(await this.loadOwned(user, id));
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    const platform = text(body.platform).trim();
    if (!platform) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写平台 URL');
    }
    const username = text(body.username).trim();
    if (!username) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写登录账号');
    }
    const password = text(body.password);
    if (!password) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写登录口令');
    }
    const row = await this.prisma.rpaAccount.create({
      data: {
        createdBy: user.userId,
        platform: platform.slice(0, 500),
        groupId: text(body.groupId).trim().slice(0, 128),
        nickname: text(body.nickname).trim().slice(0, 128),
        username: username.slice(0, 191),
        keyCipher: this.crypto.encrypt(password),
        loginUrl: text(body.loginUrl).trim().slice(0, 500),
        envType: normalizeEnvType(body.envType),
        status: normalizeChoice(
          body.status,
          ACCOUNT_STATUSES,
          '账号状态',
          'active',
        ),
        proxyMethod: normalizeProxyMethod(body.proxyMethod),
        proxyType: normalizeProxyType(body.proxyType),
        proxyHost: text(body.proxyHost).trim().slice(0, 255),
        proxyPort: Number(text(body.proxyPort).trim() || '0') || 0,
        proxyUserName: text(body.proxyUserName).trim().slice(0, 200),
        proxyPasswordCipher: this.sealProxyPassword(body),
        notes: text(body.notes).trim().slice(0, 500),
      },
    });
    await this.identity.audit(
      user.userId,
      'RPA登记账号',
      `#${row.id} ${row.platform}/${row.username}`,
    );
    return decorate(row);
  }

  async update(user: CurrentUser, id: number, body: Record<string, unknown>) {
    const row = await this.loadOwned(user, id);
    const data: Prisma.RpaAccountUpdateInput = {};
    if (body.platform !== undefined) {
      const platform = text(body.platform).trim();
      if (!platform) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写平台 URL');
      }
      data.platform = platform.slice(0, 500);
    }
    if (body.username !== undefined) {
      const username = text(body.username).trim();
      if (!username) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '登录账号不能为空');
      }
      data.username = username.slice(0, 191);
    }
    // 口令留空＝不动已存密文（界面上不回显旧口令）
    const password = text(body.password);
    if (password) data.keyCipher = this.crypto.encrypt(password);
    if (body.groupId !== undefined) {
      data.groupId = text(body.groupId).trim().slice(0, 128);
    }
    if (body.nickname !== undefined) {
      data.nickname = text(body.nickname).trim().slice(0, 128);
    }
    if (body.loginUrl !== undefined) {
      data.loginUrl = text(body.loginUrl).trim().slice(0, 500);
    }
    if (body.envType !== undefined) {
      data.envType = normalizeEnvType(body.envType);
    }
    if (body.status !== undefined) {
      data.status = normalizeChoice(
        body.status,
        ACCOUNT_STATUSES,
        '账号状态',
        row.status,
      );
    }
    if (body.proxyMethod !== undefined) {
      data.proxyMethod = normalizeProxyMethod(body.proxyMethod);
    }
    if (body.proxyType !== undefined) {
      data.proxyType = normalizeProxyType(body.proxyType);
    }
    if (body.proxyHost !== undefined) {
      data.proxyHost = text(body.proxyHost).trim().slice(0, 255);
    }
    if (body.proxyPort !== undefined) {
      data.proxyPort = Number(text(body.proxyPort).trim() || '0') || 0;
    }
    if (body.proxyUserName !== undefined) {
      data.proxyUserName = text(body.proxyUserName).trim().slice(0, 200);
    }
    // 代理口令留空＝不动已存密文（界面上不回显旧口令）
    const sealedProxy = this.sealProxyPassword(body);
    if (sealedProxy) data.proxyPasswordCipher = sealedProxy;
    if (body.notes !== undefined) {
      data.notes = text(body.notes).trim().slice(0, 500);
    }
    if (!Object.keys(data).length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有需要保存的修改');
    }
    const saved = await this.prisma.rpaAccount.update({ where: { id }, data });
    await this.identity.audit(
      user.userId,
      'RPA修改账号',
      `#${id} ${saved.platform}/${saved.username}`,
    );
    return decorate(saved);
  }

  async remove(user: CurrentUser, id: number) {
    const row = await this.loadOwned(user, id);
    const bound = await this.prisma.rpaTask.findMany({
      where: { createdBy: user.userId },
      select: { id: true, name: true, accountIds: true },
    });
    const hit = bound.filter((task) =>
      accountIdList(task.accountIds).includes(id),
    );
    if (hit.length) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `该账号被 ${hit.length} 个 RPA 任务引用（${hit[0].name}），请先调整任务`,
      );
    }
    await this.prisma.rpaAccount.delete({ where: { id } });
    await this.identity.audit(
      user.userId,
      'RPA删除账号',
      `#${id} ${row.platform}/${row.username}`,
    );
    return { id };
  }

  /** 任务绑定校验用：必须是本人登记的账号。 */
  async loadOwned(user: CurrentUser, id: number) {
    const row = await this.prisma.rpaAccount.findUnique({ where: { id } });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, 'RPA 账号不存在');
    if (row.createdBy !== user.userId) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '该 RPA 账号归他人所有',
      );
    }
    return row;
  }

  /** 仅任务派发链路调用：把密文换成执行端登录要用的明文口令。 */
  decryptPassword(row: { keyCipher: string }) {
    return this.crypto.decrypt(row.keyCipher);
  }

  /** 仅任务派发链路调用：代理口令同样只在派发给本地执行端这一刻才是明文。 */
  decryptProxyPassword(row: { proxyPasswordCipher: string }) {
    return this.crypto.decrypt(row.proxyPasswordCipher);
  }

  /** 入参里的明文代理口令就地加密；没填＝空串（调用方据此判断「不改」）。 */
  private sealProxyPassword(body: Record<string, unknown>) {
    const plain = text(body.proxyPassword).trim();
    return plain ? this.crypto.encrypt(plain) : '';
  }
}

export function accountIdList(raw: Prisma.JsonValue): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function decorate(row: {
  id: number;
  createdBy: string;
  platform: string;
  groupId: string;
  nickname: string;
  username: string;
  keyCipher: string;
  loginUrl: string;
  envType: number;
  status: string;
  proxyMethod: number;
  proxyType: string;
  proxyHost: string;
  proxyPort: number;
  proxyUserName: string;
  proxyPasswordCipher: string;
  notes: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    createdBy: row.createdBy,
    platform: row.platform,
    groupId: row.groupId,
    nickname: row.nickname,
    username: row.username,
    loginUrl: row.loginUrl,
    envType: row.envType,
    status: row.status,
    proxyMethod: row.proxyMethod,
    proxyType: row.proxyType,
    proxyHost: row.proxyHost,
    proxyPort: row.proxyPort,
    proxyUserName: row.proxyUserName,
    notes: row.notes,
    lastLoginAt: row.lastLoginAt,
    // 口令（登录 / 代理）只回「有没有存过」，界面据此决定要不要重新输入
    hasPassword: Boolean(row.keyCipher),
    hasProxyPassword: Boolean(row.proxyPasswordCipher),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
