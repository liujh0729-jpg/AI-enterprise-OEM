import { PrismaService } from '../prisma/prisma.service';
import { AccountCrypto } from '../account/account-crypto';

/** 敏感键：落库前 AES-256-GCM 加密（复用账户域同源密钥），任何接口永不回显明文。 */
const SECRET_KEYS = new Set(['wx_apiv3_key', 'wx_serial', 'wx_private_key']);

export interface RechargeTier {
  cents: number;
  bonusPercent: number;
}

/** 积分与计费的全量可配参数：赚分/花分的具体数量都从这里出，管理员在后台随意改。 */
export interface PointsSettings {
  /** 汇率：1 元人民币 = N 积分（只影响新订单，永不追溯已充积分）。 */
  rate: number;
  rechargeMinCents: number;
  rechargeTiers: RechargeTier[];
  /** 新用户注册赠分（0 = 关闭）。 */
  signupBonus: number;
  /** 邀请奖励：被邀人注册成功，邀请人所得（0 = 关闭）。 */
  inviteRewardSignup: number;
  /** 邀请奖励：被邀人首充金额百分比，给邀请人（0 = 关闭）。 */
  inviteRechargePercent: number;
  /** 被邀首充奖励的单人上限。 */
  inviteRechargeCap: number;
  /** 每个邀请人每日可得邀请奖励的人头上限（防刷）。 */
  inviteDailyCount: number;
  /** 全站奖励类日发放预算帽（0 = 不限）。 */
  rewardDailyCap: number;
  transferEnabled: boolean;
  transferMin: number;
  transferDailyCount: number;
  transferDailyPoints: number;
  /** 赠送手续费率（百分比，默认 0，预留防套利）。 */
  transferFeePercent: number;
  /** 欠费宽限天数：宽限内资产只读不可新增，永不自动删除。 */
  arrearsGraceDays: number;
  /** 单账号单日消费熔断上限（0 = 不限）。 */
  spendDailyCap: number;
  /** 微信支付五项是否配齐（配齐才允许充值下单）。 */
  wechatConfigured: boolean;
  wechatNotifyUrl: string;
  wechatAppId: string;
  wechatMchId: string;
}

/**
 * 积分设置：point_settings 键值表 + 代码内默认值（行业建议价目见设计方案 §8.2）。
 * 敏感键密文入库；管理端视图对密文键只回「已配置」布尔与脱敏尾巴。
 */
export class PointsSettingsService {
  /** 微信配置键（写接口单独走加密分支）。 */
  static readonly WECHAT_KEYS = [
    'wx_appid',
    'wx_mchid',
    'wx_apiv3_key',
    'wx_serial',
    'wx_private_key',
    'wx_notify_url',
  ] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AccountCrypto,
  ) {}

  private async raw(key: string): Promise<string> {
    const row = await this.prisma.pointSetting.findUnique({ where: { key } });
    return row?.value ?? '';
  }

  /** 密文键解密；历史明文值原样返回（迁移容错）。 */
  private async secret(key: string): Promise<string> {
    const value = await this.raw(key);
    if (!value) return '';
    try {
      return this.crypto.decrypt(value);
    } catch {
      return value;
    }
  }

  private num(cache: Map<string, string>, key: string, fallback: number) {
    const parsed = Number(cache.get(key) ?? '');
    return Number.isFinite(parsed) && cache.has(key) ? parsed : fallback;
  }

  async view(): Promise<PointsSettings> {
    const rows = await this.prisma.pointSetting.findMany();
    const cache = new Map(rows.map((row) => [row.key, row.value]));
    const text = (key: string, fallback = '') =>
      cache.has(key) ? String(cache.get(key) ?? '') : fallback;
    let tiers: RechargeTier[] = [
      { cents: 1000, bonusPercent: 0 },
      { cents: 5000, bonusPercent: 0 },
      { cents: 10000, bonusPercent: 5 },
      { cents: 30000, bonusPercent: 10 },
      { cents: 50000, bonusPercent: 15 },
    ];
    try {
      const stored = JSON.parse(text('recharge_tiers'));
      if (
        Array.isArray(stored) &&
        stored.every(
          (t) =>
            t &&
            Number.isInteger(t.cents) &&
            t.cents > 0 &&
            Number.isFinite(t.bonusPercent),
        )
      ) {
        tiers = stored
          .map((t) => ({ cents: t.cents, bonusPercent: t.bonusPercent }))
          .slice(0, 12);
      }
    } catch {
      // 配置损坏回落默认档
    }
    const wechatConfigured = Boolean(
      text('wx_appid') &&
        text('wx_mchid') &&
        (await this.raw('wx_apiv3_key')) &&
        (await this.raw('wx_serial')) &&
        (await this.raw('wx_private_key')),
    );
    return {
      rate: this.num(cache, 'rate', 10),
      rechargeMinCents: this.num(cache, 'recharge_min_cents', 100),
      rechargeTiers: tiers,
      signupBonus: this.num(cache, 'signup_bonus', 50),
      inviteRewardSignup: this.num(cache, 'invite_reward_signup', 100),
      inviteRechargePercent: this.num(cache, 'invite_recharge_percent', 5),
      inviteRechargeCap: this.num(cache, 'invite_recharge_cap', 500),
      inviteDailyCount: this.num(cache, 'invite_daily_count', 20),
      rewardDailyCap: this.num(cache, 'reward_daily_cap', 50000),
      transferEnabled: text('transfer_enabled', '1') !== '0',
      transferMin: this.num(cache, 'transfer_min', 1),
      transferDailyCount: this.num(cache, 'transfer_daily_count', 20),
      transferDailyPoints: this.num(cache, 'transfer_daily_points', 1000),
      transferFeePercent: this.num(cache, 'transfer_fee_percent', 0),
      arrearsGraceDays: this.num(cache, 'arrears_grace_days', 7),
      spendDailyCap: this.num(cache, 'spend_daily_cap', 1000),
      wechatConfigured,
      wechatNotifyUrl: text('wx_notify_url'),
      wechatAppId: text('wx_appid'),
      wechatMchId: text('wx_mchid'),
    };
  }

  /** 管理端保存（不含微信敏感键）：只收白名单键，数值统一转字符串存。 */
  async save(body: Partial<Record<string, unknown>>) {
    const allowed = [
      'rate',
      'recharge_min_cents',
      'recharge_tiers',
      'signup_bonus',
      'invite_reward_signup',
      'invite_recharge_percent',
      'invite_recharge_cap',
      'invite_daily_count',
      'reward_daily_cap',
      'transfer_enabled',
      'transfer_min',
      'transfer_daily_count',
      'transfer_daily_points',
      'transfer_fee_percent',
      'arrears_grace_days',
      'spend_daily_cap',
    ];
    for (const key of allowed) {
      if (body[key] === undefined) continue;
      const value =
        typeof body[key] === 'string'
          ? (body[key] as string)
          : JSON.stringify(body[key]);
      await this.prisma.pointSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    }
    return this.view();
  }

  /** 微信支付配置保存：空串=清除、不传=保持；私钥等敏感键密文入库。 */
  async saveWechatConfig(input: {
    appId?: string;
    mchId?: string;
    apiv3Key?: string;
    certSerial?: string;
    privateKey?: string;
    notifyUrl?: string;
  }) {
    const pairs: [string, string | undefined][] = [
      ['wx_appid', input.appId],
      ['wx_mchid', input.mchId],
      ['wx_apiv3_key', input.apiv3Key],
      ['wx_serial', input.certSerial],
      ['wx_private_key', input.privateKey],
      ['wx_notify_url', input.notifyUrl],
    ];
    for (const [key, value] of pairs) {
      if (value === undefined) continue;
      const trimmed = String(value).trim();
      const stored = SECRET_KEYS.has(key) && trimmed
        ? this.crypto.encrypt(trimmed)
        : trimmed;
      await this.prisma.pointSetting.upsert({
        where: { key },
        create: { key, value: stored },
        update: { value: stored },
      });
    }
    return this.view();
  }

  /** 解密后的微信商户参数（仅支付客户端内部使用，绝不回显）。 */
  async wechatCredentials() {
    const appId = await this.raw('wx_appid');
    const mchId = await this.raw('wx_mchid');
    const apiv3Key = await this.secret('wx_apiv3_key');
    const certSerial = await this.secret('wx_serial');
    const privateKey = await this.secret('wx_private_key');
    const notifyUrl = await this.raw('wx_notify_url');
    const configured = Boolean(
      appId && mchId && apiv3Key && certSerial && privateKey,
    );
    return { appId, mchId, apiv3Key, certSerial, privateKey, notifyUrl, configured };
  }

  /** 定时任务幂等标记（如「今天已跑过日批」），复用键值表。 */
  async flag(key: string) {
    return this.raw(key);
  }
  async setFlag(key: string, value: string) {
    await this.prisma.pointSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}
