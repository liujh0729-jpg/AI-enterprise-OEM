import { sign } from 'jsonwebtoken';
import { createHmac } from 'node:crypto';
import { AuthService } from './auth.service';
import { issueSsoSession } from './token';

/** 当前实现只接受本站自签会话（issuer=enterprise-sso），并核对账号版本。 */
describe('local session authentication boundary', () => {
  const originalEnv = { ...process.env };
  const secret = 'isolated-local-session-key';
  beforeEach(() => {
    process.env.JWT_SECRET = secret;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const accounts = () => ({
    assertSessionValid: jest.fn().mockResolvedValue(undefined),
  });
  // 与 token.ts 的 HKDF 派生一致：改签 issuer=enterprise-sso 的伪造令牌。
  const forgedSecret = () =>
    createHmac('sha256', secret).update('enterprise-sso-session').digest();

  it('accepts a locally signed session and validates its token version', async () => {
    const account = accounts();
    const auth = new AuthService(
      {} as never,
      {} as never,
      account as never,
    );
    await expect(
      auth.authenticate('GET', '/enterprise/me', issueSsoSession('42', 'unit', 'user', 3)),
    ).resolves.toMatchObject({ userId: '42', username: 'unit' });
    expect(account.assertSessionValid).toHaveBeenCalledWith('42', 3);
  });

  it('rejects the request when the account module is not wired', async () => {
    const auth = new AuthService({} as never, {} as never);
    await expect(
      auth.authenticate('GET', '/enterprise/me', issueSsoSession('42', 'unit')),
    ).rejects.toThrow('会话无效');
  });

  it.each([
    ['missing', (): undefined => undefined],
    [
      'upstream platform',
      () =>
        sign(
          { userId: '42', username: 'unit', role: 'user', type: 'access' },
          secret,
          { issuer: 'aipdd-java-core', expiresIn: 300 },
        ),
    ],
    [
      'wrong signature',
      () =>
        sign(
          { userId: '42', username: 'unit', role: 'user', type: 'access' },
          forgedSecret().toString('hex'),
          { issuer: 'enterprise-sso', expiresIn: 300 },
        ),
    ],
  ] as const)('rejects %s before touching the account module', async (_, access) => {
    const account = accounts();
    const auth = new AuthService({} as never, {} as never, account as never);
    await expect(
      auth.authenticate('GET', '/enterprise/me', access()),
    ).rejects.toThrow();
    expect(account.assertSessionValid).not.toHaveBeenCalled();
  });

  it('rejects a disabled API key owner before recording a successful API call', async () => {
    const updateMany = jest.fn();
    const create = jest.fn();
    const auth = new AuthService(
      {
        apiKey: {
          findFirst: jest.fn().mockResolvedValue({ id: 1, userId: 'disabled' }),
          updateMany,
        },
        auditLog: { create },
      } as never,
      {
        requireActiveUser: jest
          .fn()
          .mockRejectedValue(new Error('user disabled')),
      } as never,
    );
    await expect(
      auth.authenticate('GET', '/api/v1/contracts', undefined, 'unit-key'),
    ).rejects.toThrow('user disabled');
    expect(updateMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});