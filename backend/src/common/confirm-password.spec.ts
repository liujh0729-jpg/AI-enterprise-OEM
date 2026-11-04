import * as bcrypt from 'bcryptjs';
import { assertSensitivePassword } from './confirm-password';

/**
 * 放权限的开关为什么要验密、验到什么程度：
 * 令牌被盗时攻击者拿不到密码，就开不了「无人值守写动作」和「自动执行授权」；
 * 同时验密本身要限流，否则 bcrypt 成了免费的 DoS 靶子。
 */
const HASH = bcrypt.hashSync('hunter2-hunter', 4);

function prismaWith(account: { passwordHash: string; status: string } | null) {
  const findUnique = jest.fn().mockResolvedValue(account);
  return { prisma: { account: { findUnique } } as never, findUnique };
}

describe('assertSensitivePassword', () => {
  it('密码正确就放行', async () => {
    const { prisma } = prismaWith({ passwordHash: HASH, status: 'ACTIVE' });
    await expect(
      assertSensitivePassword(prisma, '9001', 'hunter2-hunter', '测试开关'),
    ).resolves.toBeUndefined();
  });

  it('没带密码直接拒，并且不去查库', async () => {
    const { prisma, findUnique } = prismaWith({
      passwordHash: HASH,
      status: 'ACTIVE',
    });
    await expect(
      assertSensitivePassword(prisma, '9002', undefined, '测试开关'),
    ).rejects.toThrow('需要输入本站登录密码');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('密码不对就拒，文案只说开关开不了，不透露账号状态', async () => {
    const { prisma } = prismaWith({ passwordHash: HASH, status: 'ACTIVE' });
    await expect(
      assertSensitivePassword(prisma, '9003', 'wrong-pass', '测试开关'),
    ).rejects.toThrow('不能开启「测试开关」');
  });

  it('账号被封或没有密码时，即便密码对上也不放行', async () => {
    const { prisma } = prismaWith({ passwordHash: HASH, status: 'BANNED' });
    await expect(
      assertSensitivePassword(prisma, '9004', 'hunter2-hunter', '测试开关'),
    ).rejects.toThrow('不能开启「测试开关」');
  });

  it('连点验密被限流：bcrypt 不该成为拖住进程的入口', async () => {
    const { prisma } = prismaWith({ passwordHash: HASH, status: 'ACTIVE' });
    const attempts = Array.from({ length: 10 }, () =>
      assertSensitivePassword(prisma, '9005', 'wrong-pass', '测试开关').catch(
        (error: Error) => error.message,
      ),
    );
    await Promise.all(attempts);
    await expect(
      assertSensitivePassword(prisma, '9005', 'hunter2-hunter', '测试开关'),
    ).rejects.toThrow('密码验证过于频繁');
  });
});
