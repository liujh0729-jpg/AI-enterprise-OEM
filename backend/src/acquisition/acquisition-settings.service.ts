import {
  ACQ_DEFAULT_LIMITS,
  ACQ_OUTREACH_CHANNEL_LABELS,
  ACQ_OUTREACH_CHANNELS,
  ACQ_PLATFORMS,
  ACQ_PLATFORM_LABELS,
  ACQ_SOURCE_MODES,
  ACQ_SOURCE_MODE_LABELS,
  ACQ_LEAD_STATUSES,
  ACQ_LEAD_STATUS_LABELS,
  ACQ_INTENT_LEVELS,
  ACQ_INTENT_LEVEL_LABELS,
  ACQ_BUSINESS_STATUSES,
  ACQ_BUSINESS_STATUS_LABELS,
  ACQ_FOLLOW_UP_TIME_RULES,
  ACQ_QC_DIMENSIONS,
  ACQ_PRICING_CODES,
} from '@enterprise/contracts';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmScopeService, HrmOrg } from '../hrm/hrm.scope';
import { EXTENSION_INFO } from '../distribution/distribution.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import {
  bool,
  clip,
  int,
  num,
  orgKey,
  text,
  type OrgKey,
  type Row,
} from './acquisition.helpers';

/** 插件可采集的平台：首期七家公开页，TikTok / X / 快手只预留枚举不下发任务。 */
const COLLECTABLE = new Set<string>([
  'XHS',
  'DOUYIN',
  'ZHIHU',
  'WEIBO',
  'BILIBILI',
  'WX_CHANNEL',
  'WX_MP',
]);

/** 渠道 → 执行位置与动作：私信/评论走浏览器插件，邮件/企微走服务端既有通道。 */
const CHANNEL_RULES: Record<
  string,
  { action: string; executor: 'PLUGIN' | 'SERVER'; requiresHuman: boolean }
> = {
  XHS_DM: { action: 'DM', executor: 'PLUGIN', requiresHuman: true },
  DOUYIN_COMMENT: {
    action: 'COMMENT',
    executor: 'PLUGIN',
    requiresHuman: false,
  },
  EMAIL: { action: 'EMAIL', executor: 'SERVER', requiresHuman: false },
  WECOM: { action: 'FRIEND_REQUEST', executor: 'SERVER', requiresHuman: false },
};

export type AcqSettings = {
  enabled: boolean;
  collectEnabled: boolean;
  qcEnabled: boolean;
  outreachAutoSend: boolean;
  humanConfirm: boolean;
  dailyComments: number;
  dailyDm: number;
  cooldownDays: number;
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  activeHoursStart: string;
  activeHoursEnd: string;
  evidenceRetentionDays: number;
  followUpMaxRounds: number;
  defaultPlaybookId: number;
  aiModel: string;
  aiChannelId: number;
};

/**
 * 获客组织级设置。SystemSetting 的 key 只有 64 字符且全局共用，装不下组织键，
 * 所以单独一张 acq_settings（与 MktContext 同样的组织单例口径）。
 */
export class AcquisitionSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: HrmScopeService,
  ) {}

  async org(user: CurrentUser): Promise<HrmOrg> {
    return this.scope.resolve(user);
  }

  private defaults(): AcqSettings {
    return {
      enabled: true,
      collectEnabled: true,
      qcEnabled: true,
      outreachAutoSend: false,
      humanConfirm: true,
      dailyComments: ACQ_DEFAULT_LIMITS.dailyComments,
      dailyDm: ACQ_DEFAULT_LIMITS.dailyDm,
      cooldownDays: ACQ_DEFAULT_LIMITS.cooldownDays,
      intervalMinSeconds: ACQ_DEFAULT_LIMITS.intervalMinSeconds,
      intervalMaxSeconds: ACQ_DEFAULT_LIMITS.intervalMaxSeconds,
      activeHoursStart: ACQ_DEFAULT_LIMITS.activeHoursStart,
      activeHoursEnd: ACQ_DEFAULT_LIMITS.activeHoursEnd,
      evidenceRetentionDays: ACQ_DEFAULT_LIMITS.evidenceRetentionDays,
      followUpMaxRounds: ACQ_DEFAULT_LIMITS.followUpMaxRounds,
      defaultPlaybookId: 0,
      aiModel: '',
      aiChannelId: 0,
    };
  }

  private view(row: {
    enabled: boolean;
    collectEnabled: boolean;
    qcEnabled: boolean;
    outreachAutoSend: boolean;
    humanConfirm: boolean;
    dailyComments: number;
    dailyDm: number;
    cooldownDays: number;
    intervalMinSeconds: number;
    intervalMaxSeconds: number;
    activeHoursStart: string;
    activeHoursEnd: string;
    evidenceRetentionDays: number;
    followUpMaxRounds: number;
    defaultPlaybookId: number;
    aiModel: string;
    aiChannelId: number;
  }): AcqSettings {
    const min = Math.max(5, int(row.intervalMinSeconds, 20));
    const max = Math.max(min, int(row.intervalMaxSeconds, 60));
    return {
      enabled: row.enabled,
      collectEnabled: row.collectEnabled,
      qcEnabled: row.qcEnabled,
      outreachAutoSend: row.outreachAutoSend,
      humanConfirm: row.humanConfirm,
      dailyComments: Math.max(0, int(row.dailyComments, 20)),
      dailyDm: Math.max(0, int(row.dailyDm, 30)),
      cooldownDays: Math.max(0, int(row.cooldownDays, 7)),
      intervalMinSeconds: min,
      intervalMaxSeconds: max,
      activeHoursStart: clip(row.activeHoursStart, 5) || '09:00',
      activeHoursEnd: clip(row.activeHoursEnd, 5) || '21:00',
      evidenceRetentionDays: Math.max(7, int(row.evidenceRetentionDays, 180)),
      followUpMaxRounds: Math.min(
        5,
        Math.max(1, int(row.followUpMaxRounds, 2)),
      ),
      defaultPlaybookId: Math.max(0, int(row.defaultPlaybookId, 0)),
      aiModel: clip(row.aiModel, 128),
      aiChannelId: Math.max(0, int(row.aiChannelId, 0)),
    };
  }

  /** 读设置：没有行就按默认值建一行，后续所有模块拿到的是同一份口径。 */
  async forOrg(key: OrgKey): Promise<AcqSettings> {
    const row = await this.prisma.acqSetting.upsert({
      where: {
        orgType_orgUserId: { orgType: key.orgType, orgUserId: key.orgUserId },
      },
      create: { ...orgKey(key), ...this.defaults() },
      update: {},
    });
    return this.view(row);
  }

  async read(user: CurrentUser) {
    const org = await this.org(user);
    const settings = await this.forOrg(org);
    return {
      ...settings,
      // 私信首条始终人工，是硬规则不是开关，不入库也不受 outreachAutoSend 影响
      dmAlwaysHuman: true,
      extensionVersion: EXTENSION_INFO.version,
      extensionDownloadPath: EXTENSION_INFO.downloadPath,
    };
  }

  async save(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.scope.requireAdmin(org);
    const current = await this.forOrg(org);
    const clock = (v: unknown, fallback: string): string => {
      const raw = text(v).trim();
      return /^\d{2}:\d{2}$/.test(raw) ? raw : fallback;
    };
    const data = {
      enabled: bool(body.enabled, current.enabled),
      collectEnabled: bool(body.collectEnabled, current.collectEnabled),
      qcEnabled: bool(body.qcEnabled, current.qcEnabled),
      outreachAutoSend: bool(body.outreachAutoSend, current.outreachAutoSend),
      humanConfirm: bool(body.humanConfirm, current.humanConfirm),
      dailyComments:
        body.dailyComments === undefined
          ? current.dailyComments
          : Math.min(500, Math.max(0, int(body.dailyComments, 20))),
      dailyDm:
        body.dailyDm === undefined
          ? current.dailyDm
          : Math.min(500, Math.max(0, int(body.dailyDm, 30))),
      cooldownDays:
        body.cooldownDays === undefined
          ? current.cooldownDays
          : Math.min(90, Math.max(0, int(body.cooldownDays, 7))),
      intervalMinSeconds:
        body.intervalMinSeconds === undefined
          ? current.intervalMinSeconds
          : Math.min(600, Math.max(5, int(body.intervalMinSeconds, 20))),
      intervalMaxSeconds:
        body.intervalMaxSeconds === undefined
          ? current.intervalMaxSeconds
          : Math.min(900, Math.max(5, int(body.intervalMaxSeconds, 60))),
      activeHoursStart: clock(body.activeHoursStart, current.activeHoursStart),
      activeHoursEnd: clock(body.activeHoursEnd, current.activeHoursEnd),
      evidenceRetentionDays:
        body.evidenceRetentionDays === undefined
          ? current.evidenceRetentionDays
          : Math.min(730, Math.max(7, int(body.evidenceRetentionDays, 180))),
      followUpMaxRounds:
        body.followUpMaxRounds === undefined
          ? current.followUpMaxRounds
          : Math.min(5, Math.max(1, int(body.followUpMaxRounds, 2))),
      defaultPlaybookId:
        body.defaultPlaybookId === undefined
          ? current.defaultPlaybookId
          : Math.max(0, int(body.defaultPlaybookId, 0)),
      aiModel:
        body.aiModel === undefined ? current.aiModel : clip(body.aiModel, 128),
      aiChannelId:
        body.aiChannelId === undefined
          ? current.aiChannelId
          : Math.max(0, int(body.aiChannelId, 0)),
    };
    if (data.intervalMaxSeconds < data.intervalMinSeconds) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '随机间隔上限不能小于下限',
      );
    }
    if (data.defaultPlaybookId > 0) {
      const playbook = await this.prisma.acqPlaybook.findFirst({
        where: { id: data.defaultPlaybookId, ...orgKey(org) },
      });
      if (!playbook) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '默认剧本不存在或不属于当前组织',
        );
      }
    }
    await this.prisma.acqSetting.update({
      where: {
        orgType_orgUserId: { orgType: org.orgType, orgUserId: org.orgUserId },
      },
      data,
    });
    await this.prisma.auditLog.create({
      data: {
        userId: user.userId,
        action: '获客设置修改',
        detail: clip(JSON.stringify(data), 500),
      },
    });
    return this.read(user);
  }

  /** 元信息：平台/渠道/限额/插件版本/知识与表格选项，前端一次取齐不写死枚举。 */
  async meta(user: CurrentUser) {
    const org = await this.org(user);
    const settings = await this.forOrg(org);
    const [kbRows, faqRows, tables] = await Promise.all([
      this.prisma.kbSpace.findMany({
        where: {
          status: 'ACTIVE',
          OR: [
            { ownerUserId: user.userId },
            { orgType: org.orgType, orgUserId: org.orgUserId },
          ],
        },
        orderBy: { id: 'desc' },
        take: 100,
        select: { id: true, name: true },
      }),
      this.prisma.serviceDeskFaq.findMany({
        where: { ownerUserId: org.orgUserId },
        orderBy: { id: 'desc' },
        take: 200,
        select: { id: true, question: true },
      }),
      this.prisma.dataTable.findMany({
        where: { createdBy: user.userId },
        orderBy: { updatedAt: 'desc' },
        take: 100,
        select: { id: true, name: true },
      }),
    ]);
    return {
      platforms: ACQ_PLATFORMS.map((key) => ({
        key,
        label: ACQ_PLATFORM_LABELS[key] || key,
        collectable: COLLECTABLE.has(key),
      })),
      modes: ACQ_SOURCE_MODES.map((key) => ({
        key,
        label: ACQ_SOURCE_MODE_LABELS[key] || key,
      })),
      channels: ACQ_OUTREACH_CHANNELS.map((key) => ({
        key,
        label: ACQ_OUTREACH_CHANNEL_LABELS[key] || key,
        action: CHANNEL_RULES[key].action,
        executor: CHANNEL_RULES[key].executor,
        requiresHuman: CHANNEL_RULES[key].requiresHuman,
      })),
      leadStatuses: ACQ_LEAD_STATUSES.map((key) => ({
        key,
        label: ACQ_LEAD_STATUS_LABELS[key] || key,
      })),
      intentLevels: ACQ_INTENT_LEVELS.map((key) => ({
        key,
        label: ACQ_INTENT_LEVEL_LABELS[key] || key,
      })),
      businessStatuses: ACQ_BUSINESS_STATUSES.map((key) => ({
        key,
        label: ACQ_BUSINESS_STATUS_LABELS[key] || key,
      })),
      followUpTimeRules: ACQ_FOLLOW_UP_TIME_RULES.map((rule) => ({
        key: rule.key,
        label: rule.label,
      })),
      qcDimensions: ACQ_QC_DIMENSIONS.map((d) => ({
        key: d.key,
        label: d.label,
        max: d.max,
      })),
      limits: {
        ...settings,
        sourceDailyLimit: ACQ_DEFAULT_LIMITS.sourceDailyLimit,
        pluginPullMax: ACQ_DEFAULT_LIMITS.pluginPullMax,
        pluginTokenTtlSeconds: ACQ_DEFAULT_LIMITS.pluginTokenTtlSeconds,
        batchPerMinute: ACQ_DEFAULT_LIMITS.batchPerMinute,
      },
      pricing: ACQ_PRICING_CODES.map((item) => ({
        code: item.code,
        unit: item.unit,
        label: item.label,
        unitPriceAmount: num(item.unitPriceAmount),
        freeQuotaAmount: num(item.freeQuotaAmount),
      })),
      extension: {
        version: EXTENSION_INFO.version,
        downloadPath: EXTENSION_INFO.downloadPath,
        chromeStoreUrl: EXTENSION_INFO.chromeStoreUrl,
      },
      kbOptions: kbRows.map((row) => ({
        id: row.id,
        name: clip(row.name, 80),
      })),
      faqOptions: faqRows.map((row) => ({
        id: row.id,
        question: clip(row.question, 120),
      })),
      tableOptions: tables.map((row) => ({
        id: row.id,
        name: clip(row.name, 80),
      })),
    };
  }
}

export const acqChannelRule = (channel: string) =>
  CHANNEL_RULES[channel] || CHANNEL_RULES.XHS_DM;

export const acqCollectable = (platform: string): boolean =>
  COLLECTABLE.has(platform);
