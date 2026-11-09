import { randomBytes } from 'node:crypto';
import {
  ACQ_OUTREACH_ACTIONS,
  ACQ_OUTREACH_CHANNELS,
  ACQ_OUTREACH_STATUSES,
} from '@enterprise/contracts';
import { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmOrg } from '../hrm/hrm.scope';
import type { MechanismService } from '../mechanisms/mechanism.service';
import type { AiEvalService } from '../ai/ai-eval.service';
import type { PublishReviewService } from '../moderation/publish-review.service';
import type { TencentQidianService } from '../tencent-qidian/tp.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { DirectMailClient } from '../aliyun-mail/directmail.client';
import { AliyunMailCrypto } from '../aliyun-mail/aliyun-mail-crypto';
import { aiJson } from '../ai/ai-gateway';
import {
  AcquisitionSettingsService,
  acqChannelRule,
  type AcqSettings,
} from './acquisition-settings.service';
import { AcquisitionRadarService } from './radar.service';
import type { AcqPluginReportOutcome } from './plugin-bridge.service';
import {
  buildDraftMessages,
  channelLimit,
  cleanDraftText,
  containsLink,
  outreachFingerprint,
  ruleDrafts,
  validateDrafts,
  type DraftInput,
  type OutreachDraft,
  type PlaybookLike,
  type ProfileLike,
} from './acquisition-outreach';
import {
  clip,
  dayFloor,
  dateOr,
  int,
  iso,
  json,
  oneOf,
  orgKey,
  orgOf,
  pageArgs,
  pageResult,
  randomIntervalMs,
  strArr,
  text,
  type OrgKey,
  type Row,
} from './acquisition.helpers';
import type { EvidenceInput } from './acquisition-scoring';

type TaskRow = {
  id: number;
  orgType: string;
  orgUserId: string;
  leadId: number;
  channel: string;
  action: string;
  targetUrl: string;
  externalUserId: string;
  draft: string;
  finalText: string;
  status: string;
  moderation: string;
  moderationNote: string;
  blockedReason: string;
  jobId: string;
  payload: unknown;
  costConfirmed: boolean;
  playbookId: number;
  scheduledAt: Date | null;
  sentAt: Date | null;
  receiptStatus: string;
  receiptRef: string;
  retryCount: number;
  logs: unknown;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

type LogEntry = { at: string; step: string; result: string; detail: string };

const asRecord = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : {};

const asLogs = (value: unknown): LogEntry[] =>
  Array.isArray(value)
    ? (value as Row[]).map((item) => ({
        at: text(item?.at),
        step: text(item?.step),
        result: text(item?.result),
        detail: text(item?.detail),
      }))
    : [];

const QUOTA_LABELS: Record<string, string> = {
  comments: '评论',
  dm: '私信/邮件',
};

/** 执行中的状态：这些任务已经发出去（或已提交），失败不能自动重发。 */
const ATTEMPTED = ['SENDING', 'SENT', 'FAILED'];

/** 内容安全的实际结论，日志里给人话，不写 pass/off 这类内部值。 */
const MODERATION_LABELS: Record<string, string> = {
  pass: '已通过内容安全检测',
  off: '内容安全未配置，按放行入队',
};

const moderationLabel = (value: string) =>
  MODERATION_LABELS[value] || '内容安全未启用';

export class AcquisitionOutreachService {
  private readonly warned = new Set<string>();
  private readonly mailCrypto = new AliyunMailCrypto();

  /** 跟进回执钩子（A8）：跟进复用触达发送链路，结果回落到跟进账本。 */
  followUpReceipt?: (input: {
    followUpId: number;
    status: 'submitted' | 'succeeded' | 'failed' | 'unknown';
    ref?: string;
    error?: string;
  }) => Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AcquisitionSettingsService,
    private readonly radar: AcquisitionRadarService,
    private readonly publishReview: PublishReviewService,
    private readonly mechanisms: MechanismService,
    private readonly aiEval: AiEvalService,
    private readonly qidian: TencentQidianService,
  ) {}

  // ---------- 列表与日志 ----------

  async list(user: CurrentUser, query: Row) {
    const org = await this.settings.org(user);
    const args = pageArgs(query);
    const where = {
      ...orgKey(org),
      ...(int(query.leadId) > 0 ? { leadId: int(query.leadId) } : {}),
      ...(text(query.channel) ? { channel: text(query.channel) } : {}),
      ...(text(query.status) ? { status: text(query.status) } : {}),
      ...(text(query.receiptStatus)
        ? { receiptStatus: text(query.receiptStatus) }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.acqOutreachTask.count({ where }),
      this.prisma.acqOutreachTask.findMany({
        where,
        orderBy: [{ id: 'desc' }],
        skip: args.skip,
        take: args.take,
      }),
    ]);
    const names = await this.leadNames(rows.map((row) => row.leadId));
    return pageResult(
      rows.map((row) => this.view(row as TaskRow, names)),
      total,
      args,
    );
  }

  async logs(user: CurrentUser, id: number) {
    const org = await this.settings.org(user);
    const task = await this.requireTask(org, id);
    return asLogs(task.logs);
  }

  // ---------- 草稿 ----------

  /**
   * 建触达任务：只产草稿，不发消息。
   * 退订/黑名单/竞品/已成交这类硬拦截在这里就给结论，不必等到审核那一步。
   */
  async create(user: CurrentUser, body: Row) {
    const org = await this.settings.org(user);
    const settings = await this.settings.forOrg(org);
    if (!settings.enabled) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '获客已关闭，请先在设置里开启',
      );
    }
    const lead = await this.radar.requireLead(org, int(body.leadId));
    const channel = oneOf(body.channel, ACQ_OUTREACH_CHANNELS, 'XHS_DM');
    const rule = acqChannelRule(channel);
    const action = oneOf(
      body.action,
      ACQ_OUTREACH_ACTIONS,
      rule.action as (typeof ACQ_OUTREACH_ACTIONS)[number],
    );
    const limit = channelLimit(channel);
    const evidence = await this.evidenceOf(org, lead.id);
    // 私信优先用线索主页（会话入口在那里），评论必须落在具体内容页
    const fallbackUrl =
      action === 'DM'
        ? clip(text(lead.profileUrl), 500) || clip(text(evidence[0]?.url), 500)
        : clip(text(evidence[0]?.url), 500);
    const targetUrl = clip(text(body.targetUrl), 500) || fallbackUrl;
    if (rule.executor === 'PLUGIN' && action === 'COMMENT' && !targetUrl) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '评论触达需要内容页链接：请先在采集结果里选一条证据，或手动填写目标链接',
      );
    }
    const externalUserId =
      clip(text(body.externalUserId), 160) ||
      (rule.executor === 'PLUGIN' ? clip(lead.platformUserId, 160) : '');

    const playbookId = int(body.playbookId) || settings.defaultPlaybookId;
    const playbook = playbookId
      ? await this.loadPlaybook(org, playbookId)
      : null;
    const profile = lead.crmLeadId
      ? await this.loadProfile(org, lead.crmLeadId)
      : null;
    const brand = await this.radar.brandContext(org);
    const input: DraftInput = {
      channel,
      action,
      platformLabel: lead.platform,
      brand,
      lead: {
        nickname: lead.nickname,
        intentLevel: lead.intentLevel,
        intentTags: strArr(lead.intentTags),
        scoreReason: lead.scoreReason,
      },
      evidence,
      playbook,
      profile,
    };

    let drafts: OutreachDraft[] = [];
    let mode: 'rule' | 'llm' = 'rule';
    const manual = text(body.text).trim();
    if (manual) {
      drafts = [
        {
          angle: '人工填写',
          text: cleanDraftText(manual, limit.maxChars),
          why: '用户直接给出的正文，未经模型改写。',
        },
      ];
    } else if (body.generate === false) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写触达正文，或允许按线索自动生成草稿',
      );
    } else {
      const ai = await aiJson<{ drafts: OutreachDraft[] }>(this.prisma, {
        userId: user.userId,
        model: settings.aiModel || undefined,
        channelId: settings.aiChannelId || undefined,
        messages: buildDraftMessages(input),
        purpose: 'batch',
        module: 'acquisition',
        operation: 'outreach_draft',
        validate: (raw) => {
          const drafts = validateDrafts(raw, limit.maxChars);
          return drafts ? { drafts } : null;
        },
      });
      if (ai) {
        drafts = ai.data.drafts;
        mode = 'llm';
      } else {
        drafts = ruleDrafts(input);
      }
    }
    if (!drafts.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '没有可用的触达正文：请补齐线索证据或手动填写',
      );
    }
    const draftText = drafts[0].text;
    const blocked = this.suppressionReason(lead, profile);
    const now = new Date();
    const logs: LogEntry[] = [
      {
        at: iso(now),
        step: '草稿',
        result: mode === 'llm' ? '模型生成' : '规则生成',
        detail: clip(
          `通道 ${channel}/${action}，字数上限 ${limit.maxChars}，生成 ${drafts.length} 版`,
          300,
        ),
      },
    ];
    if (blocked) {
      logs.push({
        at: iso(now),
        step: '风控',
        result: '拦截',
        detail: blocked,
      });
    }
    const created = await this.prisma.acqOutreachTask.create({
      data: {
        ...orgKey(org),
        leadId: lead.id,
        channel,
        action,
        targetUrl,
        externalUserId,
        draft: draftText,
        finalText: '',
        status: blocked ? 'SKIPPED' : 'DRAFT',
        blockedReason: clip(blocked, 300),
        playbookId,
        logs: json(logs),
        createdBy: user.userId,
      },
    });
    const view = this.view(created, await this.leadNames([lead.id]));
    const autoApprove =
      body.autoApprove === true &&
      !blocked &&
      this.canAutoApprove(settings, channel, action);
    if (autoApprove) {
      const approved = await this.approve(user, created.id, {
        finalText: draftText,
      });
      return { ...approved, drafts, blocked, mode };
    }
    return { ...view, drafts, blocked, mode };
  }

  /**
   * 审核与风控（顺序不可颠倒）：退订/黑名单/竞品/已成交 → 频控 → 内容安全 → 入队。
   * 任一拦截都落 SKIPPED 并记原因，不静默丢弃。
   */
  async approve(user: CurrentUser, id: number, body: Row) {
    const org = await this.settings.org(user);
    const settings = await this.settings.forOrg(org);
    const task = await this.requireTask(org, id);
    if (['SENT', 'SENDING', 'CANCELLED', 'SKIPPED'].includes(task.status)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该任务已结束或正在发送，不能再次审核；如需重发请新建一条',
      );
    }
    const lead = await this.radar.requireLead(org, task.leadId);
    const limit = channelLimit(task.channel);
    const finalText = cleanDraftText(
      text(body.finalText) || task.finalText || task.draft,
      limit.maxChars,
    );
    if (!finalText) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '触达正文为空');
    }
    const rule = acqChannelRule(task.channel);
    const profile = lead.crmLeadId
      ? await this.loadProfile(org, lead.crmLeadId)
      : null;
    const payload = asRecord(body.payload);
    const costConfirmed = body.confirmCost === true;

    // 服务端渠道的前置条件先验：缺字段直接 400，不留一条注定失败的任务
    if (rule.executor === 'SERVER') {
      this.assertServerReady(task, payload, costConfirmed);
    }
    if (!limit.allowLinks && containsLink(finalText)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `该渠道不允许发送链接：请删掉正文里的网址（上限 ${limit.maxChars} 字）`,
      );
    }

    const blocked = await this.riskGate(
      user,
      org,
      settings,
      task,
      lead,
      profile,
      finalText,
    );
    if (blocked.reason) {
      const logs = [
        ...asLogs(task.logs),
        {
          at: iso(new Date()),
          step: '风控',
          result: '拦截',
          detail: blocked.reason,
        },
      ];
      const updated = await this.prisma.acqOutreachTask.update({
        where: { id: task.id },
        data: {
          finalText,
          status: 'SKIPPED',
          blockedReason: clip(blocked.reason, 300),
          moderation: blocked.moderation || 'off',
          moderationNote: clip(blocked.note, 4000),
          logs: json(logs),
        },
      });
      await this.audit(user, '获客触达拦截', `#${task.id} ${blocked.reason}`);
      return this.view(updated, await this.leadNames([task.leadId]));
    }

    const scheduledAt =
      dateOr(body.scheduledAt) ||
      task.scheduledAt ||
      (await this.nextSlot(org, settings, task));
    const jobId =
      rule.executor === 'PLUGIN'
        ? `acq-out-${task.id}-${Date.now()}-${randomBytes(4).toString('hex')}`
        : '';
    const retrying = task.status === 'FAILED';
    const retryCount = retrying ? task.retryCount + 1 : task.retryCount;
    const logs = [
      ...asLogs(task.logs),
      ...(retrying
        ? [
            {
              at: iso(new Date()),
              step: '重试',
              result: '人工重新提交',
              detail: `第 ${retryCount} 次提交；上一次为失败，已发出去的部分不会撤回`,
            },
          ]
        : []),
      {
        at: iso(new Date()),
        step: '审核',
        result: '通过',
        detail: clip(
          `${limit.maxChars} 字上限内，${moderationLabel(blocked.moderation)}`,
          300,
        ),
      },
      {
        at: iso(new Date()),
        step: '入队',
        result: '待执行',
        detail:
          scheduledAt > new Date()
            ? `计划 ${iso(scheduledAt)} 执行`
            : '立即执行',
      },
    ];
    const queued = await this.prisma.acqOutreachTask.update({
      where: { id: task.id },
      data: {
        finalText,
        status: 'QUEUED',
        moderation: blocked.moderation || 'off',
        moderationNote: clip(blocked.note, 4000),
        blockedReason: '',
        jobId,
        payload: json(payload),
        costConfirmed,
        retryCount,
        scheduledAt,
        logs: json(logs),
      },
    });
    await this.audit(
      user,
      '获客触达审核',
      `#${task.id} ${task.channel}/${task.action}`,
    );
    if (rule.executor === 'SERVER' && scheduledAt <= new Date()) {
      return this.executeServer(user, queued);
    }
    return this.view(queued, await this.leadNames([task.leadId]));
  }

  async cancel(user: CurrentUser, id: number, body: Row) {
    const org = await this.settings.org(user);
    const task = await this.requireTask(org, id);
    if (['SENT', 'CANCELLED'].includes(task.status)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该任务已结束，不能取消',
      );
    }
    const reason = clip(text(body.reason), 200) || '人工取消';
    const updated = await this.prisma.acqOutreachTask.update({
      where: { id: task.id },
      data: {
        status: 'CANCELLED',
        blockedReason: clip(reason, 300),
        logs: json([
          ...asLogs(task.logs),
          {
            at: iso(new Date()),
            step: '取消',
            result: '已取消',
            detail: reason,
          },
        ]),
      },
    });
    await this.audit(user, '获客触达取消', `#${task.id} ${reason}`);
    return this.view(updated, await this.leadNames([task.leadId]));
  }

  // ---------- 插件队列 ----------

  /** 插件认领：只放行到点的插件渠道任务，CAS 到 SENDING，避免多标签页重复领取。 */
  async claimOutreachJobs(key: OrgKey, limit: number): Promise<Row[]> {
    const settings = await this.settings.forOrg(key);
    const now = new Date();
    if (!settings.enabled) return [];
    if (
      !this.withinHours(now, settings.activeHoursStart, settings.activeHoursEnd)
    ) {
      return [];
    }
    const rows = await this.prisma.acqOutreachTask.findMany({
      where: {
        ...orgKey(key),
        status: 'QUEUED',
        channel: { in: ['XHS_DM', 'DOUYIN_COMMENT'] },
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
      },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: Math.max(1, limit * 2),
    });
    const jobs: Row[] = [];
    const leftByChannel = new Map<string, number>();
    for (const row of rows) {
      if (jobs.length >= limit) break;
      if (!leftByChannel.has(row.channel)) {
        leftByChannel.set(
          row.channel,
          await this.remainingQuota(key, settings, row.channel),
        );
      }
      const quota = leftByChannel.get(row.channel) || 0;
      // 额度用完就不再领取：留在队列里等明天，不占着 SENDING
      if (quota <= 0) continue;
      const claimed = await this.prisma.acqOutreachTask.updateMany({
        where: { id: row.id, status: 'QUEUED' },
        data: { status: 'SENDING' },
      });
      if (claimed.count !== 1) continue;
      leftByChannel.set(row.channel, quota - 1);
      jobs.push({
        jobId: row.jobId,
        type: 'outreach',
        runId: 0,
        outreachId: row.id,
        platform: row.channel === 'XHS_DM' ? 'XHS' : 'DOUYIN',
        mode: '',
        query: {},
        filters: {},
        urls: row.targetUrl ? [row.targetUrl] : [],
        limits: {
          intervalMinSeconds: settings.intervalMinSeconds,
          intervalMaxSeconds: settings.intervalMaxSeconds,
          activeHoursStart: settings.activeHoursStart,
          activeHoursEnd: settings.activeHoursEnd,
        },
        action: row.action,
        targetUrl: row.targetUrl,
        externalUserId: row.externalUserId,
        text: row.finalText || row.draft,
        maxPerHour: quota,
      });
    }
    return jobs;
  }

  /**
   * 插件回执：只有 succeeded 才把线索推进为「已触达」。
   * unknown 不重发；failed 先看是否已提交过（可能已部分发送），有提交记录就不允许自动重发。
   */
  async reportOutreach(
    key: OrgKey,
    body: Row,
    actorUserId: string,
  ): Promise<AcqPluginReportOutcome> {
    const id = int(body.outreachId);
    const task = await this.prisma.acqOutreachTask.findFirst({
      where: { id, ...orgKey(key) },
    });
    if (!task)
      throw new BusinessException(ErrorCode.NOT_FOUND, '触达任务不存在');
    if (task.jobId !== clip(text(body.jobId), 120)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '回执与触达任务不匹配',
      );
    }
    if (['SENT', 'CANCELLED', 'SKIPPED'].includes(task.status)) {
      return {
        duplicated: true,
        outreachStatus: task.status,
        message: '该触达任务已结束，本次回执按重复处理',
      };
    }
    const receiptStatus = oneOf(
      body.receiptStatus,
      ['submitted', 'succeeded', 'failed', 'unknown'] as const,
      'unknown',
    );
    const receiptRef = clip(text(body.receiptRef), 160) || task.receiptRef;
    const error = clip(text(body.error), 1000);
    const logs = asLogs(task.logs);
    const now = new Date();
    const push = (step: string, result: string, detail: string) =>
      logs.push({ at: iso(now), step, result, detail: clip(detail, 300) });

    if (receiptStatus === 'succeeded') {
      push(
        '回执',
        '已成功',
        receiptRef ? `凭证 ${receiptRef}` : '插件回报发送成功',
      );
      await this.prisma.acqOutreachTask.update({
        where: { id: task.id },
        data: {
          status: 'SENT',
          sentAt: task.sentAt || now,
          receiptStatus: 'succeeded',
          receiptRef,
          logs: json(logs),
        },
      });
      await this.afterSent(
        key,
        task.leadId,
        task.id,
        task.channel,
        actorUserId,
      );
      await this.notifyFollowUp(task, 'succeeded', receiptRef, '');
      return {
        outreachStatus: 'SENT',
        message: '已记录发送成功',
      };
    }

    if (receiptStatus === 'submitted') {
      push(
        '回执',
        '已提交',
        receiptRef ? `凭证 ${receiptRef}` : '等待最终结果',
      );
      await this.prisma.acqOutreachTask.update({
        where: { id: task.id },
        data: {
          status: 'SENDING',
          sentAt: task.sentAt || now,
          receiptStatus: 'submitted',
          receiptRef,
          logs: json(logs),
        },
      });
      await this.notifyFollowUp(task, 'submitted', receiptRef, '');
      return { outreachStatus: 'SENDING', message: '已记录提交，等待最终结果' };
    }

    if (receiptStatus === 'failed') {
      const alreadySubmitted = ATTEMPTED.includes(task.status) && !!task.sentAt;
      push(
        '回执',
        '失败',
        alreadySubmitted
          ? `失败前已有提交记录，可能已部分发送，不自动重发${error ? `：${error}` : ''}`
          : error || '插件回报发送失败',
      );
      await this.prisma.acqOutreachTask.update({
        where: { id: task.id },
        data: {
          status: 'FAILED',
          receiptStatus: 'failed',
          receiptRef,
          logs: json(logs),
        },
      });
      await this.notifyFollowUp(task, 'failed', receiptRef, error);
      await this.mechanisms.dispatch(
        orgOf(key),
        'acquisition.outreach.failed',
        {
          outreachId: task.id,
          leadId: task.leadId,
          channel: task.channel,
          error,
        },
      );
      return {
        outreachStatus: 'FAILED',
        message: alreadySubmitted
          ? '失败前已提交过：可能已部分发送，请到平台核对后人工补记'
          : `发送失败：${error || '插件未给出原因'}`,
      };
    }

    // unknown：结果未知不重发，留给对账或人工核对
    push('回执', '结果未知', error || '插件无法确认结果，不自动重发');
    await this.prisma.acqOutreachTask.update({
      where: { id: task.id },
      data: {
        status: 'SENDING',
        sentAt: task.sentAt || now,
        receiptStatus: 'unknown',
        receiptRef,
        logs: json(logs),
      },
    });
    await this.notifyFollowUp(task, 'unknown', receiptRef, error);
    return {
      outreachStatus: 'SENDING',
      message: '结果未知：不会自动重发，稍后按超时对账或人工核对',
    };
  }

  /** 跟进任务带着 payload.followUpId：结果回落到跟进账本；失败只告警不影响触达自身。 */
  private async notifyFollowUp(
    task: TaskRow,
    status: 'submitted' | 'succeeded' | 'failed' | 'unknown',
    ref: string,
    error: string,
  ) {
    const followUpId = int(asRecord(task.payload).followUpId);
    if (!followUpId || !this.followUpReceipt) return;
    await this.followUpReceipt({
      followUpId,
      status,
      ref,
      error,
    }).catch((failure) => this.warnOnce('follow-up-receipt', failure));
  }

  // ---------- 调度入口（A8 挂到定时器） ----------

  /** 到点的服务端任务：邮件/企微在定时器里补执行，避免审核时就阻塞请求。 */
  async runDueServerTasks(now = new Date()): Promise<number> {
    const rows = await this.prisma.acqOutreachTask.findMany({
      where: {
        status: 'QUEUED',
        channel: { in: ['EMAIL', 'WECOM'] },
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
      },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: 20,
    });
    let done = 0;
    for (const row of rows) {
      const claimed = await this.prisma.acqOutreachTask.updateMany({
        where: { id: row.id, status: 'QUEUED' },
        data: { status: 'SENDING' },
      });
      if (claimed.count !== 1) continue;
      const user = new CurrentUser(row.createdBy, '', 'user');
      await this.executeServer(user, { ...row, status: 'SENDING' });
      done += 1;
    }
    return done;
  }

  /**
   * 结果未知的对账：超过 30 分钟还没有终态的按失败关闭，**不重发**。
   * 插件渠道没有服务端回查接口，只能标记为需人工核对。
   */
  async reconcileUnknown(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - 30 * 60_000);
    const rows = await this.prisma.acqOutreachTask.findMany({
      where: {
        status: 'SENDING',
        updatedAt: { lt: before },
        receiptStatus: { in: ['unknown', 'submitted'] },
      },
      take: 50,
    });
    let closed = 0;
    for (const row of rows) {
      const logs = [
        ...asLogs(row.logs),
        {
          at: iso(now),
          step: '对账',
          result: '按失败关闭',
          detail:
            '超过 30 分钟没有最终回执，不自动重发；请到平台人工核对后再决定',
        },
      ];
      await this.prisma.acqOutreachTask.update({
        where: { id: row.id },
        data: { status: 'FAILED', logs: json(logs) },
      });
      closed += 1;
    }
    return closed;
  }

  // ---------- 服务端执行 ----------

  private async executeServer(user: CurrentUser, task: TaskRow) {
    if (task.channel === 'EMAIL') return this.sendEmail(user, task);
    if (task.channel === 'WECOM') return this.sendWecom(user, task);
    return this.view(task, await this.leadNames([task.leadId]));
  }

  private async sendEmail(user: CurrentUser, task: TaskRow) {
    const lead = await this.prisma.acqLead.findUnique({
      where: { id: task.leadId },
    });
    const crmLead = lead?.crmLeadId
      ? await this.prisma.crmLead.findUnique({ where: { id: lead.crmLeadId } })
      : null;
    const payload = asRecord(task.payload);
    // 跟进任务没有线索行，邮箱与标题由调用方随 payload 透传
    const email = clip(crmLead?.email, 120) || clip(text(payload.toEmail), 120);
    const now = new Date();
    if (!email) {
      return this.failServer(
        task,
        '该线索没有邮箱：先在 CRM 补全邮箱，或等客户主动留资后再发邮件',
        now,
      );
    }
    const setting = await this.prisma.aliyunMailSetting.findUnique({
      where: { userId: task.createdBy },
    });
    if (!setting?.accessKeyId || !setting.accessKeySecretCipher) {
      return this.failServer(
        task,
        '未配置阿里云邮件推送 AccessKey：请到「营销工具 → 邮件设置」完成配置',
        now,
      );
    }
    let client: DirectMailClient;
    try {
      client = new DirectMailClient({
        accessKeyId: setting.accessKeyId,
        accessKeySecret: this.mailCrypto.decrypt(setting.accessKeySecretCipher),
        region: setting.region,
      });
    } catch (error) {
      return this.failServer(
        task,
        `阿里云 AccessKey 解密失败：${this.errMsg(error)}`,
        now,
      );
    }
    let sender = '';
    try {
      const addresses = await client.listSenderAddresses();
      const usable = addresses.filter(
        (item) =>
          !/disable|invalid|fail/i.test(item.domainStatus || '') &&
          !/disable|invalid|fail/i.test(item.accountStatus || ''),
      );
      sender = (usable[0] || addresses[0])?.accountName || '';
    } catch (error) {
      return this.failServer(
        task,
        `读取发信地址失败：${this.errMsg(error)}`,
        now,
      );
    }
    if (!sender) {
      return this.failServer(
        task,
        '阿里云账号下没有可用发信地址：请到邮件推送控制台验证发信域名',
        now,
      );
    }
    const brand = await this.prisma.mktContext.findFirst({
      where: { orgType: task.orgType, orgUserId: task.orgUserId },
    });
    const subject =
      clip(text(payload.subject), 78) ||
      clip(
        `${brand?.brandName || '合作'}｜${task.action === 'EMAIL' ? '关于你在关注的问题' : '想和你聊一下'}`,
        78,
      );
    try {
      const result = await client.singleSendMail({
        accountName: sender,
        toAddress: email,
        subject,
        text: task.finalText || task.draft,
      });
      const logs = [
        ...asLogs(task.logs),
        {
          at: iso(now),
          step: '执行',
          result: '已提交',
          detail: clip(
            `阿里云邮件推送 ${sender} → ${this.maskEmail(email)}，EnvId ${result.envId || '无'}`,
            300,
          ),
        },
      ];
      const updated = await this.prisma.acqOutreachTask.update({
        where: { id: task.id },
        data: {
          status: 'SENT',
          sentAt: now,
          receiptStatus: 'succeeded',
          receiptRef: clip(result.envId || result.requestId, 160),
          logs: json(logs),
        },
      });
      await this.afterSent(
        orgKey(task),
        task.leadId,
        task.id,
        task.channel,
        user.userId,
      );
      await this.notifyFollowUp(
        task,
        'succeeded',
        result.envId || result.requestId || '',
        '',
      );
      return this.view(updated, await this.leadNames([task.leadId]));
    } catch (error) {
      return this.failServer(
        task,
        `阿里云邮件推送失败：${this.errMsg(error)}`,
        now,
      );
    }
  }

  /**
   * 企微触达转交既有腾讯企点通道：本模块只准备话术与回执位，
   * 群发字段沿用「营销工具 → 企业微信」同一份透传口径，费用必须显式确认。
   */
  private async sendWecom(user: CurrentUser, task: TaskRow) {
    const now = new Date();
    const payload = asRecord(task.payload);
    try {
      const result = await this.qidian.scrmSaveMassTask(user, {
        ...payload,
        confirmCost: true,
      });
      const receipt = asRecord(result?.data);
      const ref = clip(
        [
          result?.taskId,
          result?.TaskId,
          receipt.taskId,
          receipt.TaskId,
          receipt.taskInstanceId,
        ]
          .map((value) => text(value))
          .find(Boolean) || '',
        160,
      );
      const logs = [
        ...asLogs(task.logs),
        {
          at: iso(now),
          step: '执行',
          result: '已提交企点',
          detail: clip(`腾讯企点群发任务${ref ? ` ${ref}` : ''}已创建`, 300),
        },
      ];
      const updated = await this.prisma.acqOutreachTask.update({
        where: { id: task.id },
        data: {
          status: 'SENDING',
          sentAt: now,
          receiptStatus: 'submitted',
          receiptRef: ref,
          logs: json(logs),
        },
      });
      return this.view(updated, await this.leadNames([task.leadId]));
    } catch (error) {
      return this.failServer(
        task,
        `腾讯企点群发失败：${this.errMsg(error)}`,
        now,
      );
    }
  }

  private async failServer(task: TaskRow, reason: string, now: Date) {
    const logs = [
      ...asLogs(task.logs),
      { at: iso(now), step: '执行', result: '失败', detail: clip(reason, 300) },
    ];
    const updated = await this.prisma.acqOutreachTask.update({
      where: { id: task.id },
      data: {
        status: 'FAILED',
        receiptStatus: 'failed',
        blockedReason: clip(reason, 300),
        logs: json(logs),
      },
    });
    await this.notifyFollowUp(task, 'failed', '', reason);
    return this.view(updated, await this.leadNames([task.leadId]));
  }

  // ---------- 风控 ----------

  /** 第 1 道：退订/黑名单/竞品员工/已成交 → 直接拦截。 */
  private suppressionReason(
    lead: {
      status: string;
      blockReason: string;
      intentTags: unknown;
      crmLeadId: number;
    },
    profile: ProfileLike,
  ): string {
    if (lead.status === 'IGNORED') {
      return `线索已标记为「${lead.blockReason || '已忽略'}」，不再触达`;
    }
    if (strArr(lead.intentTags).includes('疑似同行')) {
      return '命中「疑似同行」：按竞品员工处理，不做触达';
    }
    if (profile?.businessStatus === 'customer') {
      return '客户档案已成交，不再做获客触达';
    }
    return '';
  }

  private async riskGate(
    user: CurrentUser,
    org: HrmOrg,
    settings: AcqSettings,
    task: TaskRow,
    lead: {
      status: string;
      blockReason: string;
      intentTags: unknown;
      crmLeadId: number;
    },
    profile: ProfileLike,
    finalText: string,
  ): Promise<{ reason: string; moderation: string; note: string }> {
    // 1. 抑制名单
    const suppressed = this.suppressionReason(lead, profile);
    if (suppressed) return { reason: suppressed, moderation: 'off', note: '' };
    if (lead.crmLeadId) {
      const crmLead = await this.prisma.crmLead.findUnique({
        where: { id: lead.crmLeadId },
        select: { stage: true },
      });
      if (crmLead?.stage === 'SUCCESS') {
        return {
          reason: '该线索在 CRM 已成交，不再做获客触达',
          moderation: 'off',
          note: '',
        };
      }
    }
    // 2. 频控：日上限 + 同线索冷却 + 同内容不重复
    const frequency = await this.frequencyReason(
      org,
      settings,
      task,
      finalText,
    );
    if (frequency) return { reason: frequency, moderation: 'off', note: '' };
    // 3. 内容安全
    return this.moderate(user, finalText);
  }

  private async frequencyReason(
    org: HrmOrg,
    settings: AcqSettings,
    task: TaskRow,
    finalText: string,
  ): Promise<string> {
    const limit = channelLimit(task.channel);
    const cap =
      limit.quota === 'comments' ? settings.dailyComments : settings.dailyDm;
    const today = dayFloor(new Date());
    const used = await this.prisma.acqOutreachTask.count({
      where: {
        ...orgKey(org),
        channel: task.channel,
        id: { not: task.id },
        status: { in: ['QUEUED', 'SENDING', 'SENT'] },
        OR: [
          { sentAt: { gte: today } },
          { sentAt: null, createdAt: { gte: today } },
        ],
      },
    });
    if (used >= cap) {
      return `今日${QUOTA_LABELS[limit.quota] || '触达'}已达上限（${cap} 条），明天再试`;
    }
    if (settings.cooldownDays > 0) {
      const last = await this.prisma.acqOutreachTask.findFirst({
        where: {
          ...orgKey(org),
          leadId: task.leadId,
          status: 'SENT',
          sentAt: { not: null },
        },
        orderBy: { sentAt: 'desc' },
      });
      if (last?.sentAt) {
        const elapsed = Date.now() - last.sentAt.getTime();
        const cooldown = settings.cooldownDays * 86_400_000;
        if (elapsed < cooldown) {
          const waitDays = Math.ceil((cooldown - elapsed) / 86_400_000);
          return `同一线索冷却中：${waitDays} 天后再触达（冷却 ${settings.cooldownDays} 天）`;
        }
      }
    }
    const recent = await this.prisma.acqOutreachTask.findMany({
      where: {
        ...orgKey(org),
        leadId: task.leadId,
        channel: task.channel,
        targetUrl: task.targetUrl,
        status: 'SENT',
      },
      orderBy: { id: 'desc' },
      take: 20,
      select: { finalText: true, draft: true },
    });
    const fingerprint = outreachFingerprint(finalText);
    const same = recent.some(
      (row) => outreachFingerprint(row.finalText || row.draft) === fingerprint,
    );
    if (same) {
      return '同一内容已经发过：请改写后再发，避免重复评论被判骚扰';
    }
    return '';
  }

  private async moderate(
    user: CurrentUser,
    finalText: string,
  ): Promise<{ reason: string; moderation: string; note: string }> {
    let active = false;
    try {
      const view = await this.publishReview.view();
      active = view.enabled && view.configured;
    } catch {
      // 读取审核配置失败按未启用处理，仍会走 guard 的放行分支
    }
    try {
      await this.publishReview.guard({
        userId: user.userId,
        scene: 'acquisition_outreach',
        texts: [finalText],
      });
      return { reason: '', moderation: active ? 'pass' : 'off', note: '' };
    } catch (error) {
      if (
        error instanceof BusinessException &&
        error.errorCode.code === ErrorCode.CONTENT_MODERATION_BLOCKED.code
      ) {
        return {
          reason: error.message,
          moderation: 'block',
          note: error.message,
        };
      }
      throw error;
    }
  }

  // ---------- 小工具 ----------

  private canAutoApprove(
    settings: AcqSettings,
    channel: string,
    action: string,
  ): boolean {
    // 私信首条始终人工，是硬规则，不受任何开关影响
    if (action === 'DM' || channel === 'XHS_DM') return false;
    if (!settings.outreachAutoSend) return false;
    return !acqChannelRule(channel).requiresHuman;
  }

  private assertServerReady(
    task: TaskRow,
    payload: Row,
    costConfirmed: boolean,
  ) {
    if (task.channel === 'EMAIL') return;
    if (!Object.keys(payload).length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '企微群发需要填写企点「群发任务」接口字段（与「营销工具 → 企业微信」同一份口径）',
      );
    }
    if (!costConfirmed) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '企微群发会产生真实发送与额度消耗，请核对人群后勾选确认',
      );
    }
  }

  /** 下一个可用发送时间：不早于请求时间，且与上一条同渠道任务间隔 ≥ 随机下限。 */
  private async nextSlot(
    org: HrmOrg,
    settings: AcqSettings,
    task: TaskRow,
  ): Promise<Date> {
    const last = await this.prisma.acqOutreachTask.findFirst({
      where: {
        ...orgKey(org),
        channel: task.channel,
        status: { in: ['SENDING', 'SENT'] },
        sentAt: { not: null },
      },
      orderBy: { sentAt: 'desc' },
    });
    const interval = randomIntervalMs(
      settings.intervalMinSeconds,
      settings.intervalMaxSeconds,
    );
    const base = last?.sentAt ? last.sentAt.getTime() + interval : 0;
    return new Date(Math.max(Date.now(), base));
  }

  private async remainingQuota(
    key: OrgKey,
    settings: AcqSettings,
    channel: string,
  ): Promise<number> {
    const limit = channelLimit(channel);
    const cap =
      limit.quota === 'comments' ? settings.dailyComments : settings.dailyDm;
    const today = dayFloor(new Date());
    const used = await this.prisma.acqOutreachTask.count({
      where: {
        ...orgKey(key),
        channel,
        status: { in: ['SENDING', 'SENT'] },
        sentAt: { gte: today },
      },
    });
    const left = Math.max(0, cap - used);
    // maxPerHour 是会话内的节流上限：把日额度摊到约 8 个活跃小时
    return left > 0 ? Math.max(1, Math.ceil(left / 8)) : 0;
  }

  /** 发送成功后的连带动作：推进线索、记用量、发事件、写档案时间线。 */
  private async afterSent(
    key: OrgKey,
    leadId: number,
    taskId: number,
    channel: string,
    actorUserId: string,
  ) {
    await this.prisma.acqLead.updateMany({
      where: { id: leadId, ...orgKey(key), status: 'NEW' },
      data: { status: 'CONTACTED', lastSeenAt: new Date() },
    });
    await this.aiEval
      .chargeByUsage(actorUserId, 'acq_outreach', { call: 1 }, String(taskId), {
        module: 'acquisition',
        operation: 'outreach_send',
      })
      .catch((error) => this.warnOnce('acq_outreach', error));
    await this.mechanisms.dispatch(orgOf(key), 'acquisition.outreach.sent', {
      outreachId: taskId,
      leadId,
      channel,
    });
    const lead = await this.prisma.acqLead.findUnique({
      where: { id: leadId },
      select: { crmLeadId: true },
    });
    if (!lead?.crmLeadId) return;
    const profile = await this.prisma.acqProfile.findFirst({
      where: { ...orgKey(key), crmLeadId: lead.crmLeadId, deletedAt: null },
    });
    if (!profile) return;
    await this.prisma.acqProfileEvent.create({
      data: {
        profileId: profile.id,
        ...orgKey(key),
        kind: 'OUTREACH',
        refId: taskId,
        summary: clip(`触达任务 #${taskId} 已发送（${channel}）`, 500),
        payload: json({ channel }),
      },
    });
    await this.prisma.acqProfile.update({
      where: { id: profile.id },
      data: { lastContactAt: new Date() },
    });
  }

  private async requireTask(org: HrmOrg | OrgKey, id: number) {
    const row = await this.prisma.acqOutreachTask.findFirst({
      where: { id, ...orgKey(org) },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '触达任务不存在');
    return row as TaskRow;
  }

  private async leadNames(ids: number[]) {
    const unique = [...new Set(ids.filter((id) => id > 0))];
    if (!unique.length)
      return new Map<number, { nickname: string; platform: string }>();
    const rows = await this.prisma.acqLead.findMany({
      where: { id: { in: unique } },
      select: { id: true, nickname: true, platform: true },
    });
    return new Map(
      rows.map((row) => [
        row.id,
        { nickname: row.nickname, platform: row.platform },
      ]),
    );
  }

  private async evidenceOf(
    org: HrmOrg,
    leadId: number,
  ): Promise<EvidenceInput[]> {
    const rows = await this.prisma.acqLeadEvidence.findMany({
      where: { leadId, ...orgKey(org) },
      orderBy: { capturedAt: 'desc' },
      take: 8,
    });
    return rows.map((item) => ({
      sourceType: item.sourceType,
      excerpt: item.excerpt || item.summary,
      metrics: asRecord(item.metrics),
      url: item.url,
    }));
  }

  private async loadPlaybook(org: HrmOrg, id: number): Promise<PlaybookLike> {
    const row = await this.prisma.acqPlaybook.findFirst({
      where: { id, ...orgKey(org) },
    });
    if (!row) return null;
    return {
      name: row.name,
      goal: row.goal,
      persona: asRecord(row.persona),
      boundaries: asRecord(row.boundaries),
      openers: Array.isArray(row.openers) ? (row.openers as Row[]) : [],
      objections: Array.isArray(row.objections)
        ? (row.objections as Row[])
        : [],
    };
  }

  private async loadProfile(
    org: HrmOrg,
    crmLeadId: number,
  ): Promise<ProfileLike> {
    const row = await this.prisma.acqProfile.findFirst({
      where: { ...orgKey(org), crmLeadId, deletedAt: null },
    });
    if (!row) return null;
    return {
      displayName: row.displayName,
      businessStatus: row.businessStatus,
      purpose: row.purpose,
      objections: strArr(row.objections),
      budget: row.budget,
      decisionRole: row.decisionRole,
    };
  }

  private view(
    row: TaskRow,
    names: Map<number, { nickname: string; platform: string }>,
  ) {
    const meta = names.get(row.leadId);
    return {
      id: row.id,
      leadId: row.leadId,
      leadNickname: meta?.nickname || '',
      platform: meta?.platform || '',
      channel: row.channel,
      action: row.action,
      targetUrl: row.targetUrl,
      externalUserId: row.externalUserId,
      draft: row.draft,
      finalText: row.finalText || row.draft,
      status: oneOf(row.status, ACQ_OUTREACH_STATUSES, 'DRAFT'),
      moderation: row.moderation,
      moderationNote: row.moderationNote,
      blockedReason: row.blockedReason,
      scheduledAt: row.scheduledAt ? iso(row.scheduledAt) : '',
      sentAt: row.sentAt ? iso(row.sentAt) : '',
      receiptStatus: row.receiptStatus,
      receiptRef: row.receiptRef,
      retryCount: row.retryCount,
      createdBy: row.createdBy,
      createdAt: iso(row.createdAt),
    };
  }

  private withinHours(at: Date, start: string, end: string): boolean {
    const minutes = (hhmm: string, fallback: number) => {
      const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
      return match
        ? Math.min(23, Number(match[1])) * 60 + Math.min(59, Number(match[2]))
        : fallback;
    };
    const from = minutes(start, 9 * 60);
    const to = minutes(end, 21 * 60);
    const now = at.getHours() * 60 + at.getMinutes();
    return from <= to ? now >= from && now < to : now >= from || now < to;
  }

  private maskEmail(value: string): string {
    const [name, domain] = String(value).split('@');
    if (!domain) return '***';
    return `${name.slice(0, 2)}***@${domain}`;
  }

  private errMsg(error: unknown): string {
    return clip(error instanceof Error ? error.message : String(error), 300);
  }

  private async audit(user: CurrentUser, action: string, detail: string) {
    await this.prisma.auditLog.create({
      data: { userId: user.userId, action, detail: clip(detail, 500) },
    });
  }

  private warnOnce(key: string, error: unknown) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(
      JSON.stringify({
        event: 'acquisition_accounting_skipped',
        key,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
