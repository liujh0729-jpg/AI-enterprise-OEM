import * as bcrypt from 'bcryptjs';
import { text } from './api';
import { BusinessException } from './business.exception';
import { ErrorCode } from './error-code';
import { RateWindow } from './rate-window';
import type { PrismaService } from '../prisma/prisma.service';

/** bcrypt 是故意的慢：不限流的话，拿被盗令牌连点错误密码就能拖住进程。 */
const ATTEMPT_MAX = 10;
const ATTEMPT_WINDOW_MS = 60_000;
const limiter = new RateWindow(ATTEMPT_MAX, ATTEMPT_WINDOW_MS);

/**
 * 放权限的开关要二次验密：会话令牌被盗时，攻击者也不能顺手把「允许自动执行写动作」
 * 或「可自动执行的动作」勾选保存掉。
 * 只验「从禁到开」——收回权限永远不设门槛，鼓励随时把闸门关回去。
 * 密码只在请求体里过一次，不落库、不进日志、不回显。
 */
export async function assertSensitivePassword(
  prisma: PrismaService,
  userId: string,
  raw: unknown,
  feature: string,
) {
  limiter.consume(userId, '密码验证过于频繁，请稍后再试');
  const password = text(raw);
  const id = Number(userId);
  if (!password || !Number.isInteger(id) || id <= 0) {
    throw new BusinessException(
      ErrorCode.FORBIDDEN,
      `开启「${feature}」需要输入本站登录密码`,
    );
  }
  const account = await prisma.account.findUnique({
    where: { id },
    select: { passwordHash: true, status: true },
  });
  if (
    !account?.passwordHash ||
    account.status !== 'ACTIVE' ||
    !(await bcrypt.compare(password, account.passwordHash))
  ) {
    throw new BusinessException(
      ErrorCode.FORBIDDEN,
      `登录密码不正确，不能开启「${feature}」`,
    );
  }
}
