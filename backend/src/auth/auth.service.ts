import { createHash } from 'node:crypto';
import type { PrismaService } from '../prisma/prisma.service';
import type { UserLookupService } from '../directory/user-lookup.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from './current-user';
import { isSsoSession, parseAccessToken, ssoSessionTokenVersion } from './token';
import type { AccountService } from '../account/account.service';

/**
 * 免登录的公开请求：健康检查、类目字典，以及飞书事件订阅 / Agent 助理回填。
 * 回调路径里带每条绑定独有的随机 token，校验在各业务服务内做。
 */
export const isPublicRequest = (method: string, path: string) =>
  (method === 'GET' &&
    (/^\/health(?:\/(ready|version))?\/?$/.test(path) ||
      path === '/enterprise/aiworkin/categories' ||
      // 企业微信 / 公众号 / 微信客服接入时要先 GET 校验签名
      /^\/enterprise\/agent\/assistant\/[a-f0-9]{32}$/.test(path))) ||
  (method === 'POST' &&
    (/^\/enterprise\/feishu\/events\/[a-f0-9]{32}$/.test(path) ||
      // IM 连接（飞书 / 企微）回调：路径里是每条连接器独有的随机 token
      /^\/enterprise\/im\/events\/[a-z]+\/[a-z0-9]{8,64}$/i.test(path) ||
      /^\/enterprise\/agent\/assistant\/[a-f0-9]{32}$/.test(path)));

export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserLookupService,
    /** 开源版本地账户：传入后对自签会话校验封禁与 token_version；不传保持原行为。 */
    private readonly accounts?: AccountService,
  ) {}
  async authenticate(
    method: string,
    path: string,
    token?: string,
    apiKey?: string,
  ) {
    if (path.startsWith('/api/v1/')) {
      if (!apiKey) {
        throw new BusinessException(
          ErrorCode.UNAUTHORIZED,
          '机器通道必须带 x-api-key 请求头，或以 Authorization: Bearer ek_... 传入同一把 Key',
        );
      }
      const keyHash = createHash('sha256').update(apiKey).digest('hex');
      const row = await this.prisma.apiKey.findFirst({
        where: { keyHash, status: 'ACTIVE' },
      });
      if (!row)
        throw new BusinessException(ErrorCode.UNAUTHORIZED, 'invalid api key');
      await this.users.requireActiveUser(row.userId);
      const threshold = new Date(Date.now() - 60_000);
      if (!row.lastUsedAt || row.lastUsedAt < threshold)
        await this.prisma.apiKey.updateMany({
          where: {
            id: row.id,
            OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: threshold } }],
          },
          data: { lastUsedAt: new Date() },
        });
      await this.prisma.auditLog.create({
        data: {
          userId: row.userId,
          action: 'API_CALL',
          detail: `#${row.id} ${method} ${path}`,
        },
      });
      return new CurrentUser(row.userId, row.userId, 'user');
    }
    if (isPublicRequest(method, path)) {
      try {
        return token ? parseAccessToken(token) : undefined;
      } catch {
        return undefined;
      }
    }
    const user = parseAccessToken(token);
    // 开源版只接受本系统自签的本地会话：遗留的平台/上游令牌不再直达（设计：删除 SSO 依赖）。
    if (!token || !isSsoSession(token) || !this.accounts) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '会话无效，请使用本站账户登录',
      );
    }
    await this.accounts.assertSessionValid(
      user.userId,
      ssoSessionTokenVersion(token),
    );
    return user;
  }
}
