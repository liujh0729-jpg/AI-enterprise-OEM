import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PointsService } from '../points/points.service';
import { PointsSettingsService } from '../points/points-settings.service';
import type { CommunityAwardSettings } from '@enterprise/contracts';

/**
 * 创意社区奖励发放：审核通过（小额赠分）与推荐进市场（主推奖励）。
 *
 * 幂等与帽子：
 *  - **终身幂等**按积分流水的 `refType + refId` 判定，而不是只看 `rewardedAt`——
 *    工作流被驳回后改一版重新提交会再次走审核，只靠状态字段会重复发奖；
 *  - 单人单日帽 + 全站单日预算帽，两个帽都从后台设置读（0 = 不限）。
 * 官方模板（`source=OFFICIAL`）没有站内作者，一律不发奖。
 */

const REF_TYPE = 'community_workflow';
const APPROVE_SCENE = 'community_approve';
const RECOMMEND_SCENE = 'community_recommend';
const SCENES = [APPROVE_SCENE, RECOMMEND_SCENE];

/** 规则落 point_settings 键值表（复用积分域的配置存储，不再建新表）。 */
const SETTING_KEYS = {
  approveReward: 'community_approve_reward',
  recommendReward: 'community_recommend_reward',
  perUserDailyCap: 'community_reward_daily_per_user',
  siteDailyCap: 'community_reward_daily_site_cap',
} as const;

const DEFAULTS: CommunityAwardSettings = {
  approveReward: 0,
  recommendReward: 200,
  perUserDailyCap: 1000,
  siteDailyCap: 20000,
};

const LIMITS: Record<keyof CommunityAwardSettings, number> = {
  approveReward: 10000,
  recommendReward: 100000,
  perUserDailyCap: 1000000,
  siteDailyCap: 10000000,
};

function dayStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

function toNum(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/** 奖励对象最少要有的字段（避免把整行 JSON 传进服务）。 */
export type CommunityAwardTarget = {
  id: number;
  code: string;
  source: string;
  ownerUserId: string;
  title: string;
};

export type CommunityAwardResult = {
  rewarded: boolean;
  points: number;
  /** 未发奖的原因，只进审计与日志，不回给前端 */
  skipped: string;
};

export class CommunityAwardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService,
    private readonly settings: PointsSettingsService,
    private readonly identity: IdentityService,
  ) {}

  /** 当前生效的社区积分规则（后台表单回显）。 */
  async view(): Promise<CommunityAwardSettings> {
    const out: CommunityAwardSettings = { ...DEFAULTS };
    for (const field of Object.keys(
      DEFAULTS,
    ) as (keyof CommunityAwardSettings)[]) {
      const stored = String(
        (await this.settings.flag(SETTING_KEYS[field])) ?? '',
      ).trim();
      // 空串＝从没配过，必须保留默认值（否则新库上「推荐奖励 200」会默默变成 0，一分都不发）
      if (!stored) continue;
      const num = Number(stored);
      if (Number.isFinite(num) && num >= 0) {
        out[field] = Math.min(Math.floor(num), LIMITS[field]);
      }
    }
    return out;
  }

  /** 后台保存规则：越界与非法值一律回落到默认，不写脏数据。 */
  async save(
    body: Partial<CommunityAwardSettings>,
  ): Promise<CommunityAwardSettings> {
    for (const field of Object.keys(
      DEFAULTS,
    ) as (keyof CommunityAwardSettings)[]) {
      const value = body?.[field];
      if (value === undefined || value === null) continue;
      const num = Number(value);
      const safe =
        Number.isFinite(num) && num >= 0
          ? Math.min(Math.floor(num), LIMITS[field])
          : DEFAULTS[field];
      await this.settings.setFlag(SETTING_KEYS[field], String(safe));
    }
    return this.view();
  }

  /** 该工作流这类奖励是否已经发过（终身一次）。 */
  private async alreadyPaid(code: string, kind: 'approve' | 'recommend') {
    const refId = this.refId(code, kind);
    const count = await this.prisma.pointTransaction.count({
      where: { refType: REF_TYPE, refId },
    });
    return count > 0;
  }

  private refId(code: string, kind: 'approve' | 'recommend') {
    // ref_id 只有 64 个字符：kind 放前面，超长的模板名截尾（同一 code 截后仍稳定）
    return `${kind}:${code}`.slice(0, 64);
  }

  /**
   * 发奖：`approve` / `recommend` 两个场景各终身一次。
   * 任何一步不满足（规则为 0、官方条目、无作者、越帽）都只是「不发」，
   * 不报错——审核动作本身必须能顺利完成。
   */
  async award(
    admin: CurrentUser,
    workflow: CommunityAwardTarget,
    kind: 'approve' | 'recommend',
  ): Promise<CommunityAwardResult> {
    const none: CommunityAwardResult = {
      rewarded: false,
      points: 0,
      skipped: '',
    };
    if (workflow.source === 'OFFICIAL') {
      return { ...none, skipped: '官方模板无站内作者' };
    }
    const owner = String(workflow.ownerUserId || '').trim();
    if (!owner) return { ...none, skipped: '作者账号缺失' };
    const cfg = await this.view();
    const amount = kind === 'approve' ? cfg.approveReward : cfg.recommendReward;
    if (amount <= 0) return { ...none, skipped: '该场景奖励已关闭' };
    if (await this.alreadyPaid(workflow.code, kind)) {
      // 已经发过：把状态标记补齐，界面就不会显示成「待发奖」
      if (kind === 'recommend' && !(await this.rewardedFlag(workflow.id))) {
        await this.prisma.communityWorkflow.update({
          where: { id: workflow.id },
          data: { rewardedAt: new Date() },
        });
      }
      return { ...none, skipped: '该工作流已发过这类奖励' };
    }
    const since = dayStart();
    if (cfg.perUserDailyCap > 0) {
      const mine = await this.prisma.pointTransaction.aggregate({
        where: {
          userId: owner,
          type: 'EARN',
          scene: { in: SCENES },
          createdAt: { gte: since },
        },
        _sum: { amount: true },
      });
      if (toNum(mine._sum.amount) + amount > cfg.perUserDailyCap) {
        return { ...none, skipped: '作者当日社区奖励已达上限' };
      }
    }
    if (cfg.siteDailyCap > 0) {
      const all = await this.prisma.pointTransaction.aggregate({
        where: {
          type: 'EARN',
          scene: { in: SCENES },
          createdAt: { gte: since },
        },
        _sum: { amount: true },
      });
      if (toNum(all._sum.amount) + amount > cfg.siteDailyCap) {
        return { ...none, skipped: '全站当日社区奖励预算已用尽' };
      }
    }
    const scene = kind === 'approve' ? APPROVE_SCENE : RECOMMEND_SCENE;
    await this.points.credit(owner, 'EARN', amount, {
      scene,
      refType: REF_TYPE,
      refId: this.refId(workflow.code, kind),
      operator: admin.userId,
      remark:
        kind === 'approve'
          ? `创意社区工作流审核通过奖励：${workflow.title.slice(0, 80)}`
          : `创意社区工作流推荐进市场奖励：${workflow.title.slice(0, 80)}`,
    });
    if (kind === 'recommend') {
      await this.prisma.communityWorkflow.update({
        where: { id: workflow.id },
        data: { rewardedAt: new Date() },
      });
    }
    await this.identity.audit(
      admin.userId,
      '创意社区发放奖励',
      `${kind} ${workflow.code} +${amount}分 → ${owner}`,
    );
    return { rewarded: true, points: amount, skipped: '' };
  }

  private async rewardedFlag(id: number) {
    const row = await this.prisma.communityWorkflow.findUnique({
      where: { id },
      select: { rewardedAt: true },
    });
    return Boolean(row?.rewardedAt);
  }
}
