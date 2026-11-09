import {
  ACQ_BUSINESS_STATUSES,
  ACQ_CRM_STAGE_PROFILE_MAP,
  ACQ_PROFILE_CRM_STAGE_MAP,
  ACQ_PROFILE_EVENT_KINDS,
} from '@enterprise/contracts';
import { CurrentUser } from '../auth/current-user';
import type { Prisma } from '../../generated/prisma';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmOrg } from '../hrm/hrm.scope';
import type { CrmLeadService } from '../crm/crm.lead.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { AcquisitionSettingsService } from './acquisition-settings.service';
import { AcquisitionRadarService } from './radar.service';
import {
  clip,
  dayFloor,
  int,
  iso,
  json,
  orgKey,
  pageArgs,
  pageResult,
  peerKeyOf,
  strArr,
  text,
  type OrgKey,
  type Row,
} from './acquisition.helpers';

type ProfileRow = {
  id: number;
  orgType: string;
  orgUserId: string;
  crmLeadId: number;
  channelPeerKey: string;
  displayName: string;
  businessStatus: string;
  purpose: string;
  source: string;
  budget: string;
  timeline: string;
  decisionRole: string;
  objections: unknown;
  tags: unknown;
  healthScore: number;
  ownerUserId: string;
  nextActionAt: Date | null;
  lastContactAt: Date | null;
  pinnedVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

type EventRow = {
  id: number;
  profileId: number;
  kind: string;
  refId: number;
  summary: string;
  payload: unknown;
  createdAt: Date;
};

const asRecord = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : {};

const STATUS_SET = new Set<string>(ACQ_BUSINESS_STATUSES);
const EVENT_SET = new Set<string>(ACQ_PROFILE_EVENT_KINDS);

/** 档案状态 → CRM 阶段；反向映射在 contracts 里同一份常量，不另抄。 */
const crmStageOf = (businessStatus: string): string =>
  ACQ_PROFILE_CRM_STAGE_MAP[businessStatus] || '';
const profileStatusOf = (crmStage: string): string =>
  ACQ_CRM_STAGE_PROFILE_MAP[crmStage] || '';

const DAY = 86_400_000;

export class AcquisitionProfileService {
  private readonly warned = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AcquisitionSettingsService,
    private readonly radar: AcquisitionRadarService,
    private readonly crmLeads: CrmLeadService,
  ) {}

  async list(user: CurrentUser, query: Row) {
    const org = await this.settings.org(user);
    const args = pageArgs(query);
    const q = text(query.q).trim();
    const where = {
      ...orgKey(org),
      deletedAt: null,
      ...(text(query.businessStatus)
        ? { businessStatus: text(query.businessStatus) }
        : {}),
      ...(text(query.ownerUserId)
        ? { ownerUserId: text(query.ownerUserId) }
        : {}),
      ...(q
        ? {
            OR: [
              { displayName: { contains: q } },
              { purpose: { contains: q } },
              { channelPeerKey: { contains: q } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.acqProfile.count({ where }),
      this.prisma.acqProfile.findMany({
        where,
        orderBy: [{ healthScore: 'desc' }, { id: 'desc' }],
        skip: args.skip,
        take: args.take,
      }),
    ]);
    return pageResult(
      rows.map((row) => this.view(row as ProfileRow)),
      total,
      args,
    );
  }

  async detail(user: CurrentUser, id: number) {
    const org = await this.settings.org(user);
    const row = await this.requireProfile(org, id);
    const [events, followUps, crm] = await Promise.all([
      this.prisma.acqProfileEvent.findMany({
        where: { profileId: id, ...orgKey(org) },
        orderBy: { id: 'desc' },
        take: 50,
      }),
      this.prisma.acqFollowUp.findMany({
        where: { profileId: id, ...orgKey(org) },
        orderBy: { followUpAt: 'asc' },
        take: 20,
      }),
      row.crmLeadId
        ? this.prisma.crmLead.findFirst({
            where: {
              id: row.crmLeadId,
              ownerUserId: org.orgUserId,
              deletedAt: null,
            },
            select: { stage: true },
          })
        : Promise.resolve(null),
    ]);
    const fresh = await this.refreshHealth(org, row);
    return {
      ...this.view(fresh),
      events: events.map((item) => this.eventView(item as EventRow)),
      crmStage: crm?.stage || '',
      followUps: followUps.map((item) => ({
        id: item.id,
        followUpAt: iso(item.followUpAt),
        reason: item.reason,
        status: item.status,
        retryCount: item.retryCount,
      })),
    };
  }

  async update(user: CurrentUser, id: number, body: Row) {
    const org = await this.settings.org(user);
    const row = await this.requireProfile(org, id);
    const data: Prisma.AcqProfileUncheckedUpdateInput = {};
    for (const key of [
      'displayName',
      'purpose',
      'source',
      'budget',
      'timeline',
      'decisionRole',
    ] as const) {
      if (body[key] !== undefined) {
        const max =
          key === 'displayName'
            ? 120
            : key === 'purpose'
              ? 200
              : key === 'budget'
                ? 80
                : key === 'timeline'
                  ? 80
                  : key === 'source'
                    ? 60
                    : 40;
        data[key] = clip(text(body[key]), max);
      }
    }
    if (body.businessStatus !== undefined) {
      const next = text(body.businessStatus);
      if (!STATUS_SET.has(next)) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '业务状态不正确');
      }
      data.businessStatus = next;
    }
    if (body.objections !== undefined) {
      data.objections = json(
        strArr(body.objections)
          .map((item) => clip(item, 200))
          .slice(0, 20),
      );
    }
    if (body.tags !== undefined) {
      data.tags = json(
        strArr(body.tags)
          .map((item) => clip(item, 40))
          .slice(0, 20),
      );
    }
    if (body.ownerUserId !== undefined) {
      data.ownerUserId = clip(text(body.ownerUserId), 64);
    }
    const note = clip(text(body.note), 500);
    if (!Object.keys(data).length && !note) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有需要保存的修改');
    }
    const updated = Object.keys(data).length
      ? await this.prisma.acqProfile.update({
          where: { id },
          data,
        })
      : row;

    if (
      data.businessStatus !== undefined &&
      data.businessStatus !== row.businessStatus
    ) {
      await this.pushEvent(
        org,
        id,
        'STAGE',
        0,
        `业务状态：${row.businessStatus} → ${text(data.businessStatus)}`,
        { from: row.businessStatus, to: data.businessStatus },
      );
      // 档案状态是销售语义的第一现场：同步给 CRM 阶段，失败只告警不阻断保存
      await this.pushCrmStage(org, row.crmLeadId, text(data.businessStatus));
    }
    if (note) {
      await this.pushEvent(org, id, 'NOTE', 0, note, {});
    }
    const fresh = await this.refreshHealth(org, updated);
    return this.view(fresh);
  }

  async events(user: CurrentUser, id: number, query: Row) {
    const org = await this.settings.org(user);
    await this.requireProfile(org, id);
    const args = pageArgs(query);
    const where = {
      profileId: id,
      ...orgKey(org),
      ...(text(query.kind) ? { kind: text(query.kind) } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.acqProfileEvent.count({ where }),
      this.prisma.acqProfileEvent.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
    ]);
    return pageResult(
      rows.map((row) => this.eventView(row as EventRow)),
      total,
      args,
    );
  }

  /**
   * 线索提升 CRM：先建 CRM 线索，再落档案并回写线索。
   * CRM 未配置成员权限时直接报错——这一步的产出就是 CRM 线索，不能假装成功。
   */
  async promote(user: CurrentUser, leadId: number, body: Row) {
    const org = await this.settings.org(user);
    const lead = await this.radar.requireLead(org, leadId);
    const peerKey =
      peerKeyOf(lead.platform, lead.platformUserId) || `lead:${lead.id}`;

    // 已经提升过：幂等返回现有档案，不重复建 CRM 线索
    if (lead.crmLeadId > 0) {
      const existing = await this.prisma.acqProfile.findFirst({
        where: {
          crmLeadId: lead.crmLeadId,
          ...orgKey(org),
          deletedAt: null,
        },
      });
      const profile =
        existing ||
        (await this.prisma.acqProfile.create({
          data: {
            ...orgKey(org),
            crmLeadId: lead.crmLeadId,
            channelPeerKey: peerKey,
            displayName: clip(lead.nickname || lead.platformUserId, 120),
            businessStatus: 'engaged',
            source: clip(`社媒·${lead.platform}`, 60),
            ownerUserId: text(body.ownerId) || org.orgUserId,
          },
        }));
      return {
        ...(await this.radar.publicLeadView(org, lead.id)),
        crmLeadId: lead.crmLeadId,
        profileId: profile.id,
      };
    }

    const name =
      clip(text(body.name), 120) ||
      clip(lead.nickname, 120) ||
      clip(`${lead.platform} ${lead.platformUserId}`, 120) ||
      `社媒线索 #${lead.id}`;
    const crmLead = (await this.crmLeads.create(user, {
      name,
      contactName: clip(text(body.contactName), 60),
      phone: text(body.phone),
      email: text(body.email),
      source: clip(text(body.source) || `社媒·${lead.platform}`, 60),
      ownerId: text(body.ownerId),
      poolId: int(body.poolId),
      remark:
        clip(text(body.remark), 2000) ||
        clip([lead.scoreReason, lead.opening].filter(Boolean).join('\n'), 2000),
    })) as Row;
    const crmLeadId = int(crmLead.id);
    if (!crmLeadId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'CRM 没有返回线索 ID，本次提升未完成',
      );
    }

    const profile = await this.prisma.acqProfile.upsert({
      where: {
        orgType_orgUserId_channelPeerKey: {
          ...orgKey(org),
          channelPeerKey: peerKey,
        },
      },
      create: {
        ...orgKey(org),
        crmLeadId,
        channelPeerKey: peerKey,
        displayName: name,
        businessStatus: 'engaged',
        source: clip(`社媒·${lead.platform}`, 60),
        ownerUserId: text(body.ownerId) || org.orgUserId,
      },
      update: {
        crmLeadId,
        deletedAt: null,
      },
    });

    await this.prisma.acqLead.update({
      where: { id: lead.id },
      data: { crmLeadId, status: 'PROMOTED' },
    });
    await this.pushEvent(
      org,
      profile.id,
      'LEAD',
      lead.id,
      `从「${lead.platform}」线索 #${lead.id} 提升为 CRM 线索 #${crmLeadId}`,
      {
        leadId: lead.id,
        crmLeadId,
        platform: lead.platform,
        platformUserId: lead.platformUserId,
        profileUrl: lead.profileUrl,
      },
    );
    await this.refreshHealth(org, profile);
    return {
      ...(await this.radar.publicLeadView(org, lead.id)),
      crmLeadId,
      profileId: profile.id,
    };
  }

  /**
   * CRM 阶段变化 → 档案业务状态（由 CrmLeadService 的阶段钩子调用）。
   * 找不到对应档案就静默返回：不是所有 CRM 线索都来自获客。
   */
  async syncCrmStage(ownerUserId: string, crmLeadId: number, stage: string) {
    if (!ownerUserId || !crmLeadId) return;
    const next = profileStatusOf(stage);
    if (!next) return;
    const rows = await this.prisma.acqProfile.findMany({
      where: { crmLeadId, orgUserId: ownerUserId, deletedAt: null },
    });
    for (const row of rows) {
      if (row.businessStatus === next) continue;
      await this.prisma.acqProfile.update({
        where: { id: row.id },
        data: { businessStatus: next },
      });
      await this.prisma.acqProfileEvent.create({
        data: {
          profileId: row.id,
          orgType: row.orgType,
          orgUserId: row.orgUserId,
          kind: 'STAGE',
          refId: crmLeadId,
          summary: `CRM 阶段变为「${stage}」，业务状态 ${row.businessStatus} → ${next}`,
          payload: json({
            from: row.businessStatus,
            to: next,
            crmStage: stage,
          }),
        },
      });
    }
  }

  /** 会话/触达侧引用档案：先按 CRM 线索找，再按渠道会话键兜底。 */
  async findFor(
    org: HrmOrg | OrgKey,
    input: { crmLeadId?: number; channelPeerKey?: string },
  ) {
    if (input.crmLeadId) {
      const byCrm = await this.prisma.acqProfile.findFirst({
        where: {
          crmLeadId: input.crmLeadId,
          ...orgKey(org),
          deletedAt: null,
        },
      });
      if (byCrm) return byCrm;
    }
    if (input.channelPeerKey) {
      return this.prisma.acqProfile.findFirst({
        where: {
          channelPeerKey: clip(input.channelPeerKey, 200),
          ...orgKey(org),
          deletedAt: null,
        },
      });
    }
    return null;
  }

  /** 入站客户建档：同一会话键只留一份，重复对话只更新显示名与最后联系时间。 */
  async ensurePeer(
    org: HrmOrg | OrgKey,
    input: {
      channel: string;
      externalUserId: string;
      displayName?: string;
      source?: string;
      ownerUserId?: string;
    },
  ) {
    const peerKey = peerKeyOf(input.channel, input.externalUserId);
    if (!peerKey) return null;
    return this.prisma.acqProfile.upsert({
      where: {
        orgType_orgUserId_channelPeerKey: {
          ...orgKey(org),
          channelPeerKey: peerKey,
        },
      },
      create: {
        ...orgKey(org),
        channelPeerKey: peerKey,
        displayName: clip(input.displayName || input.externalUserId, 120),
        source: clip(input.source || input.channel, 60),
        ownerUserId: clip(input.ownerUserId || '', 64),
      },
      update: {
        ...(input.displayName
          ? { displayName: clip(input.displayName, 120) }
          : {}),
        deletedAt: null,
      },
    });
  }

  async touchContact(profileId: number) {
    if (!profileId) return;
    await this.prisma.acqProfile
      .update({
        where: { id: profileId },
        data: { lastContactAt: new Date() },
      })
      .catch((error) => this.warnOnce(`touch-${profileId}`, error));
  }

  private async refreshHealth(org: HrmOrg | OrgKey, row: ProfileRow) {
    if (!row?.id) return row;
    const score = await this.computeHealth(org, row);
    if (score === row.healthScore) return row;
    const updated = await this.prisma.acqProfile.update({
      where: { id: row.id },
      data: { healthScore: score },
    });
    return updated as ProfileRow;
  }

  /**
   * 健康分：互动频次（近 30 天成功触达）+ 最近联系 + 逾期跟进 + 阶段，全部可解释。
   * 只用于排序与提醒，不参与任何发送放行判断。
   */
  private async computeHealth(org: HrmOrg | OrgKey, row: ProfileRow) {
    const key = orgKey(org);
    const since = new Date(Date.now() - 30 * DAY);
    let sent = 0;
    if (row.crmLeadId) {
      const lead = await this.prisma.acqLead.findFirst({
        where: { crmLeadId: row.crmLeadId, ...key, deletedAt: null },
        select: { id: true },
      });
      if (lead) {
        sent = await this.prisma.acqOutreachTask.count({
          where: {
            leadId: lead.id,
            ...key,
            status: 'SENT',
            sentAt: { gte: since },
          },
        });
      }
    }
    const overdue = await this.prisma.acqFollowUp.count({
      where: {
        profileId: row.id,
        ...key,
        status: 'pending',
        followUpAt: { lt: dayFloor(new Date()) },
      },
    });
    let score = 60 + Math.min(20, sent * 5);
    if (row.lastContactAt) {
      const age = Date.now() - row.lastContactAt.getTime();
      if (age <= 7 * DAY) score += 10;
      else if (age <= 30 * DAY) score += 5;
      else score -= 10;
    }
    score -= Math.min(30, overdue * 10);
    if (row.businessStatus === 'customer') score += 15;
    if (row.businessStatus === 'qualified') score += 5;
    if (row.businessStatus === 'churned') score -= 25;
    return Math.max(0, Math.min(100, score));
  }

  private async pushCrmStage(
    org: HrmOrg | OrgKey,
    crmLeadId: number,
    businessStatus: string,
  ) {
    if (!crmLeadId) return;
    const stage = crmStageOf(businessStatus);
    if (!stage) return;
    try {
      // 只改归属本账号的线索：跨账号一律不动，避免越权写别人的 CRM
      await this.prisma.crmLead.updateMany({
        where: {
          id: crmLeadId,
          ownerUserId: org.orgUserId,
          deletedAt: null,
        },
        data: { stage },
      });
    } catch (error) {
      this.warnOnce(`crm-stage-${crmLeadId}`, error);
    }
  }

  private async pushEvent(
    org: HrmOrg | OrgKey,
    profileId: number,
    kind: string,
    refId: number,
    summary: string,
    payload: Row,
  ) {
    if (!EVENT_SET.has(kind)) return;
    await this.prisma.acqProfileEvent.create({
      data: {
        profileId,
        ...orgKey(org),
        kind,
        refId,
        summary: clip(summary, 500),
        payload: json(payload),
      },
    });
  }

  private async requireProfile(org: HrmOrg | OrgKey, id: number) {
    const row = await this.prisma.acqProfile.findFirst({
      where: { id, ...orgKey(org), deletedAt: null },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '客户档案不存在');
    return row as ProfileRow;
  }

  private view(row: ProfileRow) {
    return {
      id: row.id,
      crmLeadId: row.crmLeadId,
      channelPeerKey: row.channelPeerKey,
      displayName: row.displayName,
      businessStatus: row.businessStatus,
      purpose: row.purpose,
      source: row.source,
      budget: row.budget,
      timeline: row.timeline,
      decisionRole: row.decisionRole,
      objections: strArr(row.objections),
      tags: strArr(row.tags),
      healthScore: row.healthScore,
      ownerUserId: row.ownerUserId,
      nextActionAt: row.nextActionAt ? iso(row.nextActionAt) : '',
      lastContactAt: row.lastContactAt ? iso(row.lastContactAt) : '',
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  private eventView(row: EventRow) {
    return {
      id: row.id,
      profileId: row.profileId,
      kind: row.kind,
      refId: row.refId,
      summary: row.summary,
      payload: asRecord(row.payload),
      createdAt: iso(row.createdAt),
    };
  }

  private warnOnce(key: string, error: unknown) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(
      JSON.stringify({
        event: 'acquisition_profile_side_effect_skipped',
        key,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
