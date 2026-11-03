import { sign } from 'jsonwebtoken';
import { AuthService } from './auth.service';

describe('identity authentication scheduling', () => {
  const originalEnv = { ...process.env };
  const secret = 'isolated-auth-scheduling-key';
  beforeEach(() => {
    process.env.JWT_SECRET = secret;
    process.env.JWT_ISSUER = 'aipdd-java-core';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });
  const token = (
    payload: Record<string, unknown> = {},
    key = secret,
    issuer = 'aipdd-java-core',
    expiresIn = 3600,
  ): string =>
    sign(
      {
        userId: 'auth-unit',
        username: 'unit',
        role: 'user',
        type: 'access',
        ...payload,
      },
      key,
      { issuer, expiresIn },
    );

  it('lets the identity handler overlap its queries with account status checks', async () => {
    let finish!: () => void;
    const remember = jest.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const auth = new AuthService({} as never, { remember } as never);
    const access = token();
    expect(
      await auth.authenticate('GET', '/enterprise/me', access),
    ).toMatchObject({ userId: 'auth-unit', role: 'user' });
    expect(remember).toHaveBeenCalledWith(
      'auth-unit',
      'unit',
      access,
      expect.any(Function),
    );
    finish();
  });

  it('retains the existing ordering for other business endpoints', async () => {
    let finish!: () => void;
    const remember = jest.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const requireActiveUser = jest.fn().mockResolvedValue({ enabled: true });
    const auth = new AuthService(
      {} as never,
      { remember, requireActiveUser } as never,
    );
    let finished = false;
    const pending = auth
      .authenticate('GET', '/enterprise/contracts', token())
      .then(() => {
        finished = true;
      });
    await Promise.resolve();
    expect(finished).toBe(false);
    finish();
    await pending;
    expect(finished).toBe(true);
    expect(requireActiveUser).toHaveBeenCalledWith('auth-unit');
  });

  it('rejects a disabled account on a business endpoint after directory sync', async () => {
    const requireActiveUser = jest
      .fn()
      .mockRejectedValue(new Error('user disabled'));
    const auth = new AuthService(
      {} as never,
      {
        remember: jest.fn().mockResolvedValue(undefined),
        requireActiveUser,
      } as never,
    );
    await expect(
      auth.authenticate('GET', '/enterprise/contracts', token()),
    ).rejects.toThrow('user disabled');
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

  it.each([
    ['missing', (): undefined => undefined],
    ['bad signature', () => token({}, 'other-key')],
    ['wrong issuer', () => token({}, secret, 'other-issuer')],
    ['expired', () => token({}, secret, 'aipdd-java-core', -60)],
    ['refresh token', () => token({ type: 'refresh' })],
  ] as const)(
    'rejects %s before starting directory work',
    async (_, access) => {
      const remember = jest.fn();
      const auth = new AuthService({} as never, { remember } as never);
      await expect(
        auth.authenticate('GET', '/enterprise/me', access()),
      ).rejects.toThrow();
      expect(remember).not.toHaveBeenCalled();
    },
  );
});
