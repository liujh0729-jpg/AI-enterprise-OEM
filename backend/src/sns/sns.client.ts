import * as jwt from 'jsonwebtoken';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { Logger } from '../common/logger';
import { httpRequest } from '../http/transport';

const logger = new Logger('SnsClient');

export type SnsNotification = {
  source?: string;
  id: string;
  type: string;
  payload?: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
  person?: { id: string; displayName: string; avatarUrl?: string } | null;
};

export type SnsNotificationList = {
  rows: SnsNotification[];
  unread: number;
};

type Envelope<T> = { code: number; message: string; data: T };

/**
 * AIworkin 社交（SNS）站内私信 / 通知的只读与发信客户端。
 *
 * 两站共用 AIworkin 的 JWT 密钥与 issuer，且用户编号同为 `u-*`：
 * 这里按当前账号临时签一枚 5 分钟令牌，代表该用户调用 SNS 自己的接口，
 * 不在本库保存 SNS 密码或长期令牌，也不替代 SNS 的拉黑 / 频率限制。
 */
export class SnsClient {
  private readonly base = String(
    process.env.SNS_BASE_URL || 'http://127.0.0.1:1692',
  )
    .trim()
    .replace(/\/+$/, '');
  /** SNS 前台地址：只用于通知里的「去处理」链接，未配置时不给链接。 */
  readonly webUrl = String(process.env.SNS_WEB_URL || '')
    .trim()
    .replace(/\/+$/, '');

  private token(userId: string) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'JWT_SECRET 未配置，无法调用 AIworkin 社交',
      );
    }
    return jwt.sign(
      { userId, username: userId, role: 'user', type: 'access' },
      secret,
      {
        algorithm: 'HS256',
        issuer: process.env.JWT_ISSUER || 'aipdd-java-core',
        expiresIn: '5m',
      },
    );
  }

  private async call<T>(
    path: string,
    userId: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    let response;
    try {
      response = await httpRequest<Envelope<T>>(`${this.base}${path}`, {
        method: init.method || 'GET',
        headers: {
          authorization: `Bearer ${this.token(userId)}`,
          ...(init.body === undefined
            ? {}
            : { 'content-type': 'application/json' }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        timeoutMs: 4000,
        operation: 'sns',
      });
    } catch (error) {
      logger.warn({ path, error: this.errorInfo(error) });
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'AIworkin 社交暂时不可用，请稍后重试',
      );
    }
    const payload = response.data;
    if (!response.ok || !payload || payload.code !== 0) {
      const message = payload?.message || '';
      throw new BusinessException(
        response.status === 400
          ? ErrorCode.BAD_REQUEST
          : ErrorCode.SERVICE_UNAVAILABLE,
        message && /[\u4e00-\u9fa5]/.test(message)
          ? message
          : 'AIworkin 社交暂时不可用，请稍后重试',
      );
    }
    return payload.data;
  }

  sendMail(
    userId: string,
    input: { toUserId: string; subject: string; body: string },
  ) {
    return this.call<{ id: number }>('/sns/mail/messages', userId, {
      method: 'POST',
      body: { ...input, aiGenerated: false },
    });
  }

  notifications(userId: string) {
    return this.call<SnsNotificationList>('/sns/notifications', userId);
  }

  read(userId: string, id: string) {
    return this.call<{ id: number; read: boolean }>(
      `/sns/notifications/${encodeURIComponent(id)}/read`,
      userId,
      { method: 'POST' },
    );
  }

  readAll(userId: string) {
    return this.call<{ updated: number }>(
      '/sns/notifications/read-all',
      userId,
      {
        method: 'POST',
      },
    );
  }

  private errorInfo(error: unknown) {
    if (error instanceof Error)
      return { name: error.name, message: error.message };
    return { message: String(error) };
  }
}
