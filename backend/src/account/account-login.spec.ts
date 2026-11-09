import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { PrismaService } from '../prisma/prisma.service';
import { AccountService, type WechatProfileInput } from './account.service';
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
    cooldownDays: jest.fn(async () => 15),
    wechat: jest.fn(async () => null),
    wechatConfigured: jest.fn(async () => false),
    ...overrides,
  });

// 保留原始 jest.fn 引用给断言用：若先 stub 成服务类型，expect(obj.method) 会触发 unbound-method。
const channelsOf = (overrides: Record<string, unknown> = {}) => ({
  consumeCode: jest.fn(async () => undefined),
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
}) =>
  new AccountService(
    deps.prisma ?? prismaOf(),
    deps.settings ?? settingsOf(),
    stub<NotifyChannelService>(deps.channels ?? channelsOf()),
    deps.points ? stub(deps.points) : undefined,
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
