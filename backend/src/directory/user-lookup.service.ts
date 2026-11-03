import { httpRequest } from '../http/transport';
import { Logger } from '../common/logger';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { findSeedUser } from './seed-users';
import { currentRequest, runInRequestContext } from '../common/request-context';
import type { UserDirectory } from '../../generated/prisma';
export interface DirectoryUser {
  id: string;
  username: string;
  displayName: string;
  email?: string | null;
  avatarUrl: string | null;
  personalIntro: string | null;
  enabled: boolean;
  createdAt: string;
}
interface ApiEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}
/** 账号服务 /user/info 的返回（只取本系统用得到的字段）。 */
type RemoteUserInfo = {
  id?: string;
  username?: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  role?: string;
  enabled?: boolean;
};
/** 账号服务同步间隔：过期后允许再拉一次 /user/info（避免每请求都打远端）。 */
const SYNC_TTL_MS = Number(
  process.env.USER_DIRECTORY_SYNC_TTL_MS || 6 * 60 * 60 * 1000,
);
/**
 * 用户目录（本系统自建）：
 * 账号服务没有目录/批量查询接口，因此由每次带 token 的请求**即时登记**（`remember`），
 * 再用账号服务 `GET /user/info`（用调用者自己的 token）补全昵称/邮箱/头像。
 * 查询顺序：内存缓存 → 本库 `user_directory` → 本地演示账号种子（仅开发环境兜底）。
 */
export class UserLookupService {
  private readonly logger = new Logger(UserLookupService.name);
  private readonly remembering = new Map<string, Promise<void>>();
  private readonly userCache = new Map<
    string,
    {
      value: DirectoryUser | null;
      expiresAt: number;
    }
  >();
  private readonly cacheTtlMs = Number(
    process.env.USER_DIRECTORY_CACHE_TTL_MS || 30000,
  );
  constructor(private readonly prisma: PrismaService) {}
  async requireActiveUser(userId: string) {
    const user = await this.find(userId);
    if (!user) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, 'user not found');
    }
    if (!user.enabled) {
      throw new BusinessException(ErrorCode.FORBIDDEN, 'user disabled');
    }
    return user;
  }
  async findPublic(userId: string): Promise<DirectoryUser | null> {
    const user = await this.find(userId);
    return user?.enabled ? user : null;
  }
  async lookup(userIds: string[]): Promise<DirectoryUser[]> {
    const normalized = [...new Set(userIds.filter(Boolean))];
    if (!normalized.length) return [];
    // 同步中的账号先完成状态核验，避免批量查询读回核验前的启用状态。
    await Promise.all(
      normalized.flatMap((id) => {
        const pending = this.remembering.get(id);
        return pending ? [pending] : [];
      }),
    );
    const missing = normalized.filter((id) => {
      const cached = this.userCache.get(id);
      return !cached || cached.expiresAt <= Date.now();
    });
    if (missing.length) {
      const rows = await this.prisma.userDirectory.findMany({
        where: { userId: { in: missing } },
      });
      const found = new Map(
        rows.map((row) => [row.userId, toDirectoryUser(row)]),
      );
      for (const id of missing)
        this.cacheUser(id, found.get(id) || findSeedUser(id));
    }
    return normalized
      .map((id) => this.userCache.get(id)!.value)
      .filter((user): user is DirectoryUser => !!user);
  }
  async displayName(userId: string): Promise<string> {
    const user = await this.find(userId);
    return user?.displayName || user?.username || userId;
  }
  /**
   * 批量昵称：一次 `findMany` 取未命中缓存的目录行，避免列表页按行 N 次查询。
   * 回退顺序与 `find` 一致（本库 → 演示账号种子 → userId）。
   */
  async displayNames(userIds: string[]): Promise<Map<string, string>> {
    const normalized = [...new Set(userIds.filter(Boolean))];
    const out = new Map<string, string>();
    const missing: string[] = [];
    for (const id of normalized) {
      const cached = this.userCache.get(id);
      if (cached && cached.expiresAt > Date.now()) {
        out.set(id, cached.value?.displayName || cached.value?.username || id);
      } else {
        missing.push(id);
      }
    }
    if (!missing.length) return out;
    const rows = await this.prisma.userDirectory.findMany({
      where: { userId: { in: missing } },
    });
    const found = new Map(
      rows.map((row) => [row.userId, toDirectoryUser(row)]),
    );
    for (const id of missing) {
      const user = found.get(id) || findSeedUser(id);
      this.cacheUser(id, user || null);
      out.set(id, user?.displayName || user?.username || id);
    }
    return out;
  }
  /**
   * 即时登记：每个带 token 的请求都会调用（命中内存缓存即返回）。
   * 首次/过期时读取目录及上游账号状态，资料写库在后台完成。
   * 同一用户共用状态核验；requireActiveUser 必须等待它，不能用旧缓存绕过禁用检查。
   */
  remember(
    userId: string,
    username: string,
    accessToken?: string,
    loadExisting?: () => Promise<UserDirectory | null>,
  ): Promise<void> {
    if (!userId) return Promise.resolve();
    const pending = this.remembering.get(userId);
    if (pending) return pending;
    const cached = this.userCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve();
    // 在调用者的请求上下文内取快照，再把 Promise 传给脱离取消信号的共享核验。
    const existing = loadExisting?.();
    // 多个请求共用核验；首个请求断开时仍需完成，不继承它的取消信号或统计。
    const work = runInRequestContext(
      () => this.loadAndRemember(userId, username, accessToken, existing),
      { requestId: currentRequest()?.requestId },
    ).finally(() => this.remembering.delete(userId));
    this.remembering.set(userId, work);
    return work;
  }
  private async loadAndRemember(
    userId: string,
    username: string,
    accessToken?: string,
    existingRow?: Promise<UserDirectory | null>,
  ) {
    try {
      const existing = await (existingRow
        ? existingRow
        : this.prisma.userDirectory.findUnique({ where: { userId } }));
      const fresh =
        existing?.syncedAt &&
        Date.now() - existing.syncedAt.getTime() < SYNC_TTL_MS;
      const info =
        accessToken && !fresh ? await this.fetchInfo(accessToken) : null;
      // 昵称回退顺序：账号服务 → 已存目录 → 演示账号种子 → 用户名
      // （本地演示账号不在账号服务里，不能让用户名把种子的中文名覆盖掉）
      const fallback = findSeedUser(userId);
      const data = {
        username: info?.username || username || existing?.username || '',
        displayName:
          info?.displayName ||
          existing?.displayName ||
          fallback?.displayName ||
          username ||
          '',
        email: info?.email || existing?.email || fallback?.email || '',
        avatarUrl: info?.avatarUrl || existing?.avatarUrl || '',
        role: info?.role || existing?.role || '',
        // 上游不可用或资料仍新鲜时保留本地禁用状态，不能默认重新启用。
        enabled:
          typeof info?.enabled === 'boolean'
            ? Number(info.enabled)
            : (existing?.enabled ?? 1),
        ...(info ? { syncedAt: new Date() } : {}),
      };
      const directoryUser = toDirectoryUser({
        userId,
        username: data.username,
        displayName: data.displayName,
        email: data.email,
        avatarUrl: data.avatarUrl,
        enabled: data.enabled,
        createdAt: existing?.createdAt ?? new Date(),
      });
      // 内容与目录行一致时不写库：避免每个缓存周期都产生一次 UPDATE（updatedAt 也是写）
      const unchanged =
        !!existing &&
        !info &&
        existing.username === data.username &&
        existing.displayName === data.displayName &&
        existing.email === data.email &&
        existing.avatarUrl === data.avatarUrl &&
        existing.role === data.role &&
        existing.enabled === data.enabled;
      this.cacheUser(userId, directoryUser);
      if (!unchanged) {
        void this.prisma.userDirectory
          .upsert({
            where: { userId },
            update: data,
            create: { userId, ...data },
          })
          .catch(() => {
            this.logger.warn('用户目录资料保存失败，将在下个缓存周期重试');
          });
      }
    } catch (error) {
      // 目录登记失败不影响业务请求（下次请求会再试）
      this.logger.warn(
        `remember(${userId}) failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  private async fetchInfo(accessToken: string): Promise<RemoteUserInfo | null> {
    const base = (
      process.env.JAVA_BASE_URL || 'https://api.aipdd.work'
    ).replace(/\/$/, '');
    const timeout = Number(process.env.JAVA_REQUEST_TIMEOUT_MS || 5000);
    try {
      const response = await httpRequest<ApiEnvelope<RemoteUserInfo>>(
        `${base}/user/info`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
          cache: 'no-store',
          timeoutMs: timeout,
          operation: 'java:user-info',
        },
      );
      if (!response.ok) return null;
      const payload = response.data;
      return payload?.code === 0 && payload.data ? payload.data : null;
    } catch {
      return null;
    }
  }
  private async find(userId: string): Promise<DirectoryUser | null> {
    await this.remembering.get(userId);
    const cached = this.userCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const local = await this.prisma.userDirectory.findUnique({
      where: { userId },
    });
    const user = local ? toDirectoryUser(local) : findSeedUser(userId);
    this.cacheUser(userId, user);
    return user;
  }
  private cacheUser(userId: string, value: DirectoryUser | null) {
    this.userCache.set(userId, {
      value,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }
}
type UserDirectoryRow = {
  userId: string;
  username: string;
  displayName: string;
  email: string;
  avatarUrl: string;
  enabled: number;
  createdAt: Date;
};
function toDirectoryUser(row: UserDirectoryRow): DirectoryUser {
  return {
    id: row.userId,
    username: row.username,
    displayName: row.displayName || row.username,
    email: row.email || null,
    avatarUrl: row.avatarUrl || null,
    personalIntro: null,
    enabled: row.enabled === 1,
    createdAt: row.createdAt.toISOString(),
  };
}
