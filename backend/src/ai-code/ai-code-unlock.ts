import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { aiCodeUnlockTtlMs } from './ai-code.config';

/**
 * 解锁票据：重复输入登录密码后发放一枚短时票据（内存态、绑定 userId）。
 * 对话写文件、导出补丁、在线应用都必须先解锁；进程重启即失效，需重新验密。
 */

type Ticket = { userId: string; expiresAt: number };

const tickets = new Map<string, Ticket>();

export function issueUnlock(userId: string) {
  const expiresAt = Date.now() + aiCodeUnlockTtlMs();
  tickets.set(userId, { userId, expiresAt });
  return new Date(expiresAt).toISOString();
}

export function unlockExpiresAt(userId: string) {
  const ticket = tickets.get(userId);
  if (!ticket) return '';
  if (Date.now() > ticket.expiresAt) {
    tickets.delete(userId);
    return '';
  }
  return new Date(ticket.expiresAt).toISOString();
}

export function isUnlocked(userId: string) {
  return Boolean(unlockExpiresAt(userId));
}

export function requireUnlock(userId: string) {
  if (!isUnlocked(userId)) {
    throw new BusinessException(
      ErrorCode.FORBIDDEN,
      '「AI 编程」需要先输入登录密码解锁，且票据已过期，请重新验证密码',
    );
  }
}

export function dropUnlock(userId: string) {
  tickets.delete(userId);
}
