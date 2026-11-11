import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { PrismaService } from '../prisma/prisma.service';
import {
  AccountService,
  type AccountAgreements,
  type WechatProfileInput,
} from './account.service';
import {
  AccountSettingsService,
  type LoginMethod,
  type WechatSettings,
} from './account-settings.service';
import type { NotifyChannelService } from './notify-channel.service';
import { stub } from '../../test/doubles';

// AccountCrypto 需要独立密钥源；单测用固定值，避免读真实 .env。
process.env.EXTERNAL_CRED_KEY = 'unit-test-external-cred-key';

const accountRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  username: 'alice',
  email: 'alice@example.com',
  phone: null,
  passwordHash: 'hash',
  emailVerified: 1,
  phoneVerified: 0,
  status: 'ACTIVE',
  banReason: null,
  mustChangePassword: 0,
  tokenVersion: 0,
  lastLoginAt: null,
  deletedAt: null,
  avatar: null,
  intro: null,
  lang: 'zh',
  role: 'USER',
  inviteCode: 'ABC123',
  invitedBy: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

/** 账户设置：默认全关，按用例覆盖。 */
const settingsOf = (overrides: Record<string, unknown> = {}) =>
  stub<AccountSettingsService>({
    loginMethods: jest.fn(async () => ['PASSWORD'] as LoginMethod[]),
    registerModes: jest.fn(async () => ['USERNAME']),
    channelAvailability: jest.fn(async () => ({
      USERNAME: true,
      EMAIL: true,
      PHONE: true,
    })),
    loginAvailability: jest.fn(async () => ({
      PASSWORD: true,
      EMAIL_CODE: true,
      SMS_CODE: true,
      WECHAT: true,
    })),
    passwordRecoveryAvailability: jest.fn(async () => ({
      enabled: true,
      PASSWORD: true,
      EMAIL: true,
      SMS: true,
    })),
    cooldownDays: jest.fn(async () => 15),
    wechat: jest.fn(async () => null),
    wechatConfigured: jest.fn(async () => false),
    ...overrides,
  });

// 保留原始 jest.fn 引用给断言用：若先 stub 成服务类型，expect(obj.method) 会触发 unbound-method。
const channelsOf = (overrides: Record<string, unknown> = {}) => ({
  consumeCode: jest.fn(async () => undefined),
  consumeToken: jest.fn(async () => ({
    channel: 'EMAIL',
    target: 'alice@example.com',
  })),
  sendEmailCode: jest.fn(async () => undefined),
  sendSmsCode: jest.fn(async () => undefined),
  ...overrides,
});

const prismaOf = (overrides: Record<string, unknown> = {}) =>
  stub<PrismaService>({
    account: {
      findUnique: jest.fn(async () => accountRow()),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async () => accountRow()),
      update: jest.fn(async () => accountRow()),
      delete: jest.fn(async () => accountRow()),
    },
    accountBinding: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
    },
    loginLog: { create: jest.fn(async () => ({})) },
    auditLog: { create: jest.fn(async () => ({})) },
    userDirectory: { upsert: jest.fn(async () => ({})) },
    ...overrides,
  });

const makeAccount = (deps: {
  prisma?: ReturnType<typeof prismaOf>;
  settings?: ReturnType<typeof settingsOf>;
  channels?: ReturnType<typeof channelsOf>;
  points?: { grantOnRegister: jest.Mock };
  agreements?: AccountAgreements;
}) =>
  new AccountService(
    deps.prisma ?? prismaOf(),
    deps.settings ?? settingsOf(),
    stub<NotifyChannelService>(deps.channels ?? channelsOf()),
    deps.points ? stub(deps.points) : undefined,
    deps.agreements,
  );

// ---------- 设置服务：登录方式 / 微信 ----------

const settingsPrisma = (stored: Record<string, string> = {}) =>
  stub<PrismaService>({
    systemSetting: {
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) =>
        stored[where.key] === undefined
          ? null
          : { key: where.key, value: stored[where.key] },
      ),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { key: string };
          create: { value: string };
          update: { value: string };
        }) => {
          stored[where.key] = update?.value ?? create?.value;
          return { key: where.key, value: stored[where.key] };
        },
      ),
    },
  });

describe('账户设置：登录方式与微信', () => {
  it('默认只开常规登录', async () => {
    const settings = new AccountSettingsService(settingsPrisma());
    expect(await settings.loginMethods()).toEqual(['PASSWORD']);
  });

  it('保存登录方式时拒绝未配通道的验证码登录', async () => {
    const settings = new AccountSettingsService(settingsPrisma());
    await expect(
      settings.saveLoginMethods(['EMAIL_CODE'], {
        PASSWORD: true,
        EMAIL_CODE: false,
        SMS_CODE: false,
        WECHAT: false,
      }),
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it('保存后能读回，且去重', async () => {
    const settings = new AccountSettingsService(settingsPrisma());
    await settings.saveLoginMethods(['PASSWORD', 'WECHAT', 'WECHAT'], {
      PASSWORD: true,
      EMAIL_CODE: true,
      SMS_CODE: true,
      WECHAT: true,
    });
    expect(await settings.loginMethods()).toEqual(['PASSWORD', 'WECHAT']);
  });

  it('微信密钥只存密文，启用前必须先填 Secret', async () => {
    const settings = new AccountSettingsService(settingsPrisma());
    expect(await settings.wechatConfigured()).toBe(false);
    await expect(
      settings.saveWechat({ appId: 'wx123', enabled: true }),
    ).rejects.toBeInstanceOf(BusinessException);
    await settings.saveWechat({
      appId: 'wx123',
      appSecret: 'secret-value',
      enabled: true,
    });
    const saved = (await settings.wechat()) as WechatSettings;
    expect(saved.appSecretCipher).not.toContain('secret-value');
    expect(settings.wechatSecret(saved)).toBe('secret-value');
    expect(await settings.wechatConfigured()).toBe(true);
  });
});

// ---------- 验证码登录 ----------

describe('验证码登录', () => {
  it('管理员未开启该方式时直接拒绝', async () => {
    const account = makeAccount({});
    await expect(
      account.sendLoginCode('EMAIL', 'alice@example.com'),
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it('账号不存在时也回「已发送」但不真的发码（防枚举）', async () => {
    const channels = channelsOf();
    const account = makeAccount({
      prisma: prismaOf({
        account: {
          findUnique: jest.fn(async () => null),
          findFirst: jest.fn(async () => null),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
        },
      }),
      settings: settingsOf({
        loginMethods: jest.fn(async () => ['EMAIL_CODE']),
      }),
      channels,
    });
    expect(await account.sendLoginCode('EMAIL', 'no@example.com')).toEqual({
      sent: true,
    });
    expect(channels.sendEmailCode).not.toHaveBeenCalled();
  });

  it('账号存在时按 LOGIN 场景发码', async () => {
    const channels = channelsOf();
    const account = makeAccount({
      prisma: prismaOf({
        account: {
          findUnique: jest.fn(async () => accountRow()),
          findFirst: jest.fn(async () => accountRow()),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
        },
      }),
      settings: settingsOf({
        loginMethods: jest.fn(async () => ['EMAIL_CODE']),
      }),
      channels,
    });
    await account.sendLoginCode('EMAIL', 'Alice@Example.com');
    expect(channels.sendEmailCode).toHaveBeenCalledWith(
      'LOGIN',
      'alice@example.com',
      expect.any(String),
      expect.any(Function),
    );
  });

  it('核销验证码后按邮箱找到账号并建立会话', async () => {
    const channels = channelsOf();
    const account = makeAccount({
      prisma: prismaOf({
        account: {
          findUnique: jest.fn(async () => accountRow()),
          findFirst: jest.fn(async () => accountRow()),
          create: jest.fn(),
          update: jest.fn(async () => accountRow({ lastLoginAt: new Date() })),
          delete: jest.fn(),
        },
      }),
      settings: settingsOf({
        loginMethods: jest.fn(async () => ['EMAIL_CODE']),
      }),
      channels,
    });
    const session = await account.loginByCode(
      'EMAIL',
      'alice@example.com',
      '123456',
      {},
    );
    expect(channels.consumeCode).toHaveBeenCalledWith(
      'LOGIN',
      'EMAIL',
      'alice@example.com',
      '123456',
    );
    expect(session.userId).toBe('1');
    expect(session.role).toBe('user');
  });
});

// ---------- 微信扫码 ----------

const wechatProfile: WechatProfileInput = {
  provider: 'WECHAT_OPEN',
  openId: 'open-123',
  unionId: 'union-123',
  nickname: '小明',
  avatarUrl: 'https://img.example.com/a.png',
};

describe('微信扫码', () => {
  it('已绑定时直接登录', async () => {
    const prisma = prismaOf({
      accountBinding: {
        findFirst: jest.fn(async () => ({
          id: 9,
          userId: '1',
          provider: 'WECHAT_OPEN',
          openId: 'open-123',
          unionId: 'union-123',
        })),
        findUnique: jest.fn(async () => null),
        create: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
      },
    });
    const account = makeAccount({ prisma });
    const result = await account.wechatAuthenticate(wechatProfile, {});
    expect(result.status).toBe('LOGIN');
    if (result.status === 'LOGIN') expect(result.session.userId).toBe('1');
  });

  it('未绑定且开自动注册时建号并绑定', async () => {
    const bindingCreate = jest.fn(async () => ({}));
    const prisma = prismaOf({
      account: {
        findUnique: jest.fn(async () => accountRow()),
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (args: { data: { username: string } }) =>
          accountRow({ id: 7, username: args.data.username }),
        ),
        update: jest.fn(async () => accountRow({ id: 7, username: 'wx_-123' })),
        delete: jest.fn(async () => accountRow()),
      },
      accountBinding: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => null),
        create: bindingCreate,
        update: jest.fn(async () => ({})),
      },
    });
    const account = makeAccount({
      prisma,
      settings: settingsOf({
        wechat: jest.fn(async () => ({
          provider: 'WECHAT_OPEN',
          appId: 'wx',
          appSecretCipher: 'cipher',
          enabled: true,
          autoRegister: true,
          scopes: 'snsapi_login',
        })),
      }),
    });
    const result = await account.wechatAuthenticate(wechatProfile, {});
    expect(result.status).toBe('LOGIN');
    expect(bindingCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: expect.any(String),
        provider: 'WECHAT_OPEN',
        openId: 'open-123',
      }),
    });
  });

  it('未绑定且未开自动注册时回「待绑定」', async () => {
    const account = makeAccount({
      settings: settingsOf({
        wechat: jest.fn(async () => ({
          provider: 'WECHAT_OPEN',
          appId: 'wx',
          appSecretCipher: 'cipher',
          enabled: true,
          autoRegister: false,
          scopes: 'snsapi_login',
        })),
      }),
    });
    const result = await account.wechatAuthenticate(
      { ...wechatProfile, unionId: undefined },
      {},
    );
    expect(result.status).toBe('BIND');
  });

  it('绑定到其他已占用账号时明确冲突', async () => {
    const prisma = prismaOf({
      accountBinding: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => ({
          id: 9,
          userId: '2',
          provider: 'WECHAT_OPEN',
          openId: 'open-123',
        })),
        create: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
      },
    });
    const account = makeAccount({ prisma });
    await expect(account.bindWechat('1', wechatProfile)).rejects.toMatchObject({
      errorCode: ErrorCode.CONFLICT,
    });
  });
});

describe('注册协议与隐私政策：未同意不建号', () => {
  const consents = [
    {
      id: 11,
      code: 'USER_REGISTRATION',
      version: 'v1.0',
      title: '用户注册协议',
    },
    { id: 12, code: 'USER_PRIVACY', version: 'v1.0', title: '隐私政策' },
  ];
  /** 按 TermsService.requireRegisterConsent 的口径：缺项/版本不符即报出对应协议标题。 */
  const agreementsOf = (required = consents) => {
    const requireRegisterConsent = jest.fn(
      async (submitted: { code: string; version: string }[]) => {
        for (const doc of required) {
          if (
            !submitted.some(
              (item) => item.code === doc.code && item.version === doc.version,
            )
          ) {
            throw new BusinessException(
              ErrorCode.BAD_REQUEST,
              `请先阅读并同意《${doc.title}》`,
            );
          }
        }
        return required;
      },
    );
    return stub<AccountAgreements>({ requireRegisterConsent });
  };

  it('未传协议时拒绝注册且不落账号', async () => {
    const createAccount = jest.fn(async () => accountRow());
    const account = makeAccount({
      prisma: prismaOf({ account: { create: createAccount } }),
      agreements: agreementsOf(),
    });
    await expect(
      account.register({
        mode: 'USERNAME',
        username: 'bob',
        password: 'abc12345',
      }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.BAD_REQUEST });
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('只同意注册协议、漏掉隐私政策同样拒绝', async () => {
    const createAccount = jest.fn(async () => accountRow());
    const account = makeAccount({
      prisma: prismaOf({ account: { create: createAccount } }),
      agreements: agreementsOf(),
    });
    await expect(
      account.register(
        {
          mode: 'USERNAME',
          username: 'bob',
          password: 'abc12345',
          terms: [{ code: 'USER_REGISTRATION', version: 'v1.0' }],
        },
        {},
      ),
    ).rejects.toThrow('隐私政策');
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('同意后建号并写版本/IP/UA 留痕', async () => {
    const createAccount = jest.fn(async () => accountRow());
    const upsert = jest.fn(async () => ({}));
    const $transaction = jest.fn(async (ops: Promise<unknown>[]) =>
      Promise.all(ops),
    );
    const account = makeAccount({
      prisma: prismaOf({
        account: {
          create: createAccount,
          findUnique: jest.fn(async () => null),
          findFirst: jest.fn(async () => null),
        },
        $transaction,
        termsAcceptance: { upsert },
      }),
      agreements: agreementsOf(),
    });
    await account.register(
      {
        mode: 'USERNAME',
        username: 'Bob',
        password: 'abc12345',
        terms: [
          { code: 'USER_REGISTRATION', version: 'v1.0' },
          { code: 'USER_PRIVACY', version: 'v1.0' },
        ],
      },
      { ip: '10.0.0.8', userAgent: 'jest-agent' },
    );
    expect(createAccount).toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith({
      where: {
        userId_code_version: {
          userId: '1',
          code: 'USER_PRIVACY',
          version: 'v1.0',
        },
      },
      create: expect.objectContaining({
        documentId: 12,
        ip: '10.0.0.8',
        userAgent: 'jest-agent',
      }),
      update: expect.objectContaining({ ip: '10.0.0.8' }),
    });
  });
});

describe('找回密码与验证码设密：与登录策略同源', () => {
  const user = new CurrentUser('1', 'alice', 'user');

  it('密码找回整体关闭时拒绝发码', async () => {
    const channels = channelsOf();
    const account = makeAccount({
      channels,
      settings: settingsOf({
        passwordRecoveryAvailability: jest.fn(async () => ({
          enabled: false,
          PASSWORD: false,
          EMAIL: false,
          SMS: false,
        })),
      }),
    });
    await expect(
      account.requestPasswordReset('EMAIL', 'alice@example.com'),
    ).rejects.toBeInstanceOf(BusinessException);
    expect(channels.sendEmailCode).not.toHaveBeenCalled();
  });

  it('邮箱通道未开启时即使已配 SMTP 也拒绝', async () => {
    const channels = channelsOf();
    const account = makeAccount({
      channels,
      settings: settingsOf({
        passwordRecoveryAvailability: jest.fn(async () => ({
          enabled: true,
          PASSWORD: true,
          EMAIL: false,
          SMS: true,
        })),
      }),
    });
    await expect(
      account.requestPasswordReset('EMAIL', 'alice@example.com'),
    ).rejects.toBeInstanceOf(BusinessException);
    expect(channels.sendEmailCode).not.toHaveBeenCalled();
  });

  it('验证码重置：按规范化目标消费 RESET_PASSWORD 并递增 tokenVersion', async () => {
    const consumeCode = jest.fn(async () => undefined);
    const update = jest.fn(async () => accountRow({ tokenVersion: 1 }));
    const account = makeAccount({
      channels: channelsOf({ consumeCode }),
      prisma: prismaOf({
        account: {
          findFirst: jest.fn(async () => accountRow()),
          update,
        },
      }),
    });
    await account.resetPassword(
      'EMAIL',
      ' Alice@Example.com ',
      '123456',
      'newpass123',
    );
    expect(consumeCode).toHaveBeenCalledWith(
      'RESET_PASSWORD',
      'EMAIL',
      'alice@example.com',
      '123456',
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ tokenVersion: { increment: 1 } }),
    });
  });

  it('邮件令牌重置：令牌换目标后写入新密码并留审计', async () => {
    const update = jest.fn(async () => accountRow({ tokenVersion: 1 }));
    const auditLog = { create: jest.fn(async () => ({})) };
    const account = makeAccount({
      prisma: prismaOf({
        account: {
          findFirst: jest.fn(async () => accountRow()),
          update,
        },
        auditLog,
      }),
    });
    await account.resetPasswordByToken('a'.repeat(48), 'newpass123');
    expect(update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ tokenVersion: { increment: 1 } }),
    });
    expect(auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'ACCOUNT_PASSWORD_RESET',
        detail: 'channel=EMAIL;via=link',
      }),
    });
  });

  it('账号安全视图：目标脱敏，只报已绑定且策略开放的通道', async () => {
    const account = makeAccount({});
    const view = await account.securityView(user);
    expect(view).toMatchObject({
      username: 'alice',
      hasPassword: true,
      email: 'al***@example.com',
      phone: '',
      codeChannels: { EMAIL: true, SMS: false },
    });
  });

  it('验证码设密：只发到当前账号绑定目标，使用独立 SET_PASSWORD 场景', async () => {
    const sendEmailCode = jest.fn(async () => undefined);
    const account = makeAccount({
      channels: channelsOf({ sendEmailCode }),
    });
    const result = await account.sendSetPasswordCode(user, 'EMAIL');
    expect(sendEmailCode).toHaveBeenCalledWith(
      'SET_PASSWORD',
      'alice@example.com',
      expect.any(String),
      expect.any(Function),
    );
    expect(result).toEqual({ sent: true, target: 'al***@example.com' });
  });

  it('验证码设密：未绑定手机时拒绝且不消费验证码', async () => {
    const consumeCode = jest.fn(async () => undefined);
    const account = makeAccount({
      channels: channelsOf({ consumeCode }),
    });
    await expect(
      account.setPasswordByCode(user, 'SMS', '123456', 'newpass123'),
    ).rejects.toBeInstanceOf(BusinessException);
    expect(consumeCode).not.toHaveBeenCalled();
  });

  it('验证码设密成功：消费 SET_PASSWORD 并返回换发会话素材', async () => {
    const consumeCode = jest.fn(async () => undefined);
    const update = jest.fn(async () => accountRow({ tokenVersion: 3 }));
    const account = makeAccount({
      channels: channelsOf({ consumeCode }),
      prisma: prismaOf({
        account: {
          findUnique: jest.fn(async () => accountRow()),
          update,
        },
      }),
    });
    const result = await account.setPasswordByCode(
      user,
      'EMAIL',
      '123456',
      'newpass123',
    );
    expect(consumeCode).toHaveBeenCalledWith(
      'SET_PASSWORD',
      'EMAIL',
      'alice@example.com',
      '123456',
    );
    expect(result).toEqual({
      changed: true,
      session: {
        userId: '1',
        username: 'alice',
        role: 'user',
        tokenVersion: 3,
      },
    });
  });
});
