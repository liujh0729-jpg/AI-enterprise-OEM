import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import {
  QXY_ACCOUNTS_KEY,
  QXY_ACCOUNT_TAX_LIMIT,
  QxySettingsService,
} from './qxy-settings.service';

describe('QxySettingsService', () => {
  const admin = new CurrentUser('admin', '管理员', 'admin');
  const member = new CurrentUser('member', '普通用户', 'user');
  const original = {
    key: process.env.EXTERNAL_CRED_KEY,
    appkey: process.env.QXY_APPKEY,
    secret: process.env.QXY_SECRET,
  };
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  let rows: Record<string, string>;
  const prisma = {
    systemSetting: {
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) => {
        const value = rows[where.key];
        return value ? { key: where.key, value, updatedAt: new Date() } : null;
      }),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { key: string };
          create?: { key: string; value: string };
          update?: { value: string };
        }) => {
          rows[where.key] = String(update?.value ?? create?.value ?? '');
          return {
            ...(create || {}),
            ...(update || {}),
            updatedAt: new Date(),
          };
        },
      ),
    },
  };
  const identity = {
    requireAdmin: jest.fn((user: CurrentUser) => {
      if (!user.isAdmin())
        throw new BusinessException(ErrorCode.ROLE_MISMATCH, '需要平台管理员');
    }),
    audit: jest.fn().mockResolvedValue(undefined),
  };
  let settings: QxySettingsService;

  beforeEach(() => {
    rows = {};
    jest.clearAllMocks();
    process.env.EXTERNAL_CRED_KEY = 'unit-encryption-key';
    process.env.QXY_APPKEY = 'legacy-key';
    process.env.QXY_SECRET = 'legacy-secret';
    settings = new QxySettingsService(prisma as never, identity as never);
  });

  afterAll(() => {
    for (const [name, value] of Object.entries({
      EXTERNAL_CRED_KEY: original.key,
      QXY_APPKEY: original.appkey,
      QXY_SECRET: original.secret,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('keeps legacy environment credentials as the fallback before any account is saved', async () => {
    expect(await settings.status()).toMatchObject({
      configured: true,
      source: 'env',
    });
    expect(await settings.resolve()).toEqual({
      appkey: 'legacy-key',
      secret: 'legacy-secret',
    });
    expect(await settings.credentialsForTaxNo('913300000000000000')).toEqual({
      appkey: 'legacy-key',
      secret: 'legacy-secret',
    });
    delete process.env.QXY_SECRET;
    expect(await settings.status()).toMatchObject({
      configured: false,
      source: 'none',
    });
  });

  it('encrypts the account pool and maps a tax number to its own credentials', async () => {
    const saved = await settings.save(admin, {
      label: '主账号',
      appkey: 'pool-key',
      secret: 'pool-secret',
      expiresAt: day(30),
      taxNos: ['9133 0000 0000 000000'],
    });
    expect(saved.accounts).toHaveLength(1);
    expect(saved.accounts[0].appkeyMasked).not.toContain('pool-key');
    expect(saved.accounts[0].taxNos).toEqual(['913300000000000000']);
    expect(rows[QXY_ACCOUNTS_KEY]).not.toContain('pool-key');
    expect(rows[QXY_ACCOUNTS_KEY]).not.toContain('pool-secret');
    expect(await settings.status()).toMatchObject({ source: 'pool' });
    expect(await settings.credentialsForTaxNo('913300000000000000')).toEqual({
      appkey: 'pool-key',
      secret: 'pool-secret',
    });
    // 未匹配税号仍回退历史/部署环境变量凭据
    expect(await settings.credentialsForTaxNo('913300000000000001')).toEqual({
      appkey: 'legacy-key',
      secret: 'legacy-secret',
    });
  });

  it('enforces the five-tax-number limit and single-owner binding', async () => {
    const first = await settings.save(admin, {
      label: '账号 A',
      appkey: 'key-a',
      secret: 'secret-a',
      taxNos: [
        '913300000000000001',
        '913300000000000002',
        '913300000000000003',
        '913300000000000004',
        '913300000000000005',
      ],
    });
    const firstId = first.accounts[0].id;
    await expect(
      settings.bind(admin, firstId, '913300000000000006'),
    ).rejects.toThrow(`最多绑定 ${QXY_ACCOUNT_TAX_LIMIT} 个税号`);
    const second = await settings.save(admin, {
      label: '账号 B',
      appkey: 'key-b',
      secret: 'secret-b',
    });
    const secondId = second.accounts.find((item) => item.id !== firstId)!.id;
    await expect(
      settings.bind(admin, secondId, '913300000000000001'),
    ).rejects.toThrow('已绑定');
  });

  it('denies ordinary users before reading or writing the pool', async () => {
    await expect(settings.list(member)).rejects.toThrow('需要平台管理员');
    await expect(
      settings.save(member, { label: 'x', appkey: 'x', secret: 'y' }),
    ).rejects.toThrow('需要平台管理员');
    expect(prisma.systemSetting.findUnique).not.toHaveBeenCalled();
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });

  it('keeps AppKey and Secret when editing and flags expiring accounts without blocking calls', async () => {
    const saved = await settings.save(admin, {
      label: '主账号',
      appkey: 'pool-key',
      secret: 'pool-secret',
      expiresAt: day(-1),
      taxNos: ['913300000000000000'],
    });
    expect(saved.accounts[0]).toMatchObject({
      expiring: true,
      daysLeft: expect.any(Number),
    });
    const edited = await settings.save(admin, {
      id: saved.accounts[0].id,
      label: '续费账号',
      expiresAt: day(60),
    });
    expect(edited.accounts[0]).toMatchObject({
      label: '续费账号',
      expiring: false,
    });
    // 到期仅提醒不拦截：仍可解析凭据
    expect(await settings.credentialsForTaxNo('913300000000000000')).toEqual({
      appkey: 'pool-key',
      secret: 'pool-secret',
    });
  });

  it('reports damaged pool ciphertext instead of falling back', async () => {
    await settings.save(admin, {
      label: '主账号',
      appkey: 'pool-key',
      secret: 'pool-secret',
    });
    rows[QXY_ACCOUNTS_KEY] = 'damaged';
    await expect(settings.list(admin)).rejects.toThrow('重新保存账号');
    await expect(
      settings.credentialsForTaxNo('913300000000000000'),
    ).rejects.toThrow('重新保存账号');
  });
});
