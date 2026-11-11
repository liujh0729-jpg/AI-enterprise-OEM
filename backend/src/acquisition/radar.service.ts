import { randomBytes } from 'node:crypto';
import {
  ACQ_DEFAULT_LIMITS,
  ACQ_EVIDENCE_SOURCES,
  ACQ_INTENT_LEVELS,
  ACQ_PLATFORM_LABELS,
  ACQ_PLUGIN_STOP_LABELS,
  ACQ_SOURCE_MODES,
} from '@enterprise/contracts';
import type { CurrentUser } from '../auth/current-user';
import type { Prisma } from '../../generated/prisma';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmOrg } from '../hrm/hrm.scope';
import type { MechanismService } from '../mechanisms/mechanism.service';
import type { DataTableService } from '../data-table/data-table.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { aiJson } from '../ai/ai-gateway';
import type { AiEvalService } from '../ai/ai-eval.service';
import type { AcqPluginReportOutcome } from './plugin-bridge.service';
import {
  AcquisitionSettingsService,
  acqCollectable,
} from './acquisition-settings.service';
import {
  EMPTY_CONTEXT,
  buildScoreMessages,
  ruleScore,
  validateScore,
  type EvidenceInput,
  type IntentScore,
  type ScoreContext,
} from './acquisition-scoring';
import {
  clip,
  contactKey,
  contactsOf,
  dateOr,
  dayFloor,
  dedupeKeyOf,
  evidenceContactsOf,
  int,
  intArr,
  iso,
  json,
  num,
  oneOf,
  orgKey,
  orgOf,
  pageArgs,
  pageResult,
  strArr,
  text,
  type AcqContact,
  type OrgKey,
  type Row,
} from './acquisition.helpers';

/** 采集中的批次：同一源同时只允许一个在跑，插件掉线由超时兜底转 PARTIAL。 */
const IN_FLIGHT = ['QUEUED', 'CLAIMED', 'RUNNING'];
const RUN_TIMEOUT_MS = 10 * 60_000;
const INSERT_BATCH = 100;
const EXPORT_LIMIT = 20000;

/** 时间窗 → 天数；all 不设下限。 */
const WINDOW_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

/**
 * 简易 cron（分 时 日 月 周）+ daily / weekly 别名，与营销技能库同一套语义。
 * 按服务器本地时区推算，和活跃时段判定（getHours）保持同一口径。
 */
export function nextRunAt(cron: string, from = new Date()): Date | null {
  const raw = String(cron || '')
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (raw === 'weekly') return new Date(from.getTime() + 7 * 86_400_000);
  if (raw === 'daily') return new Date(from.getTime() + 86_400_000);
  const parts = raw.split(/\s+/);
  if (parts.length >= 2 && /^\*\/\d+$/.test(parts[0])) {
    const step = Math.max(1, Number(parts[0].slice(2)) || 60);
    return new Date(from.getTime() + step * 60_000);
  }
  const minute = Number(parts[0]);
  const hour = Number(parts[1]);
  if (
    Number.isInteger(minute) &&
    Number.isInteger(hour) &&
    minute >= 0 &&
    minute < 60 &&
    hour >= 0 &&
    hour < 24
  ) {
    const next = new Date(from);
    next.setSeconds(0, 0);
    next.setHours(hour, minute, 0, 0);
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }
  return new Date(from.getTime() + 86_400_000);
}

/** 导出/写表共用的线索列：键名即多维表格的候选 fieldKey。 */
const LEAD_EXPORT_COLUMNS = [
  'id',
  'platform',
  'platformUserId',
  'nickname',
  'profileUrl',
  'intentScore',
  'intentLevel',
  'intentTags',
  'scoreMode',
  'status',
  'crmLeadId',
  'evidenceCount',
  'firstSeenAt',
  'lastSeenAt',
];

type SourceRow = {
  id: number;
  name: string;
  platform: string;
  mode: string;
  query: unknown;
  filters: unknown;
  cron: string;
  dailyLimit: number;
  status: string;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type RunRow = {
  id: number;
  sourceId: number;
  status: string;
  stats: unknown;
  error: string;
  claimedAt: Date | null;
  heartbeatAt: Date | null;
  startedAt: Date;
  finishedAt: Date | null;
};

type LeadRow = {
  id: number;
  platform: string;
  platformUserId: string;
  nickname: string;
  profileUrl: string;
  intentScore: number;
  intentLevel: string;
  intentTags: unknown;
  scoreMode: string;
  scoreReason: string;
  opening: string;
  risk: string;
  status: string;
  blockReason: string;
  ownerUserId: string;
  crmLeadId: number;
  evidenceCount: number;
  contactCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

const asRecord = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : {};

/** 监控源 + 采集批次 + 线索 + 证据 + 意图评分；采集执行在浏览器插件，服务端只记账与判定。 */
export class AcquisitionRadarService {
  private readonly warned = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AcquisitionSettingsService,
    private readonly mechanisms: MechanismService,
    private readonly dataTable: DataTableService,
    private readonly aiEval: AiEvalService,
  ) {}

  /** 导出复用横切机制的任务与文件账本，行数据由本模块提供，避免两处实现。 */
  registerExports() {
    this.mechanisms.registerExportModule(
      { module: 'acq_lead', label: '获客线索', columns: LEAD_EXPORT_COLUMNS },
      (org, filters) => this.exportRows(org, filters),
    );
  }

  // ---------- 监控源 ----------

  async sources(user: CurrentUser, query: Row) {
    const org = await this.settings.org(user);
    const args = pageArgs(query);
    const where = {
      ...orgKey(org),
      ...(text(query.platform) ? { platform: text(query.platform) } : {}),
      ...(text(query.status) ? { status: text(query.status) } : {}),
      ...(text(query.q) ? { name: { contains: text(query.q) } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.acqSource.count({ where }),
      this.prisma.acqSource.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
    ]);
    return pageResult(
      rows.map((row) => this.sourceView(row)),
      total,
      args,
    );
  }

  async saveSource(user: CurrentUser, body: Row) {
    const org = await this.settings.org(user);
    const name = clip(text(body.name).trim(), 80);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写监控源名称');
    const platform = text(body.platform);
    if (!acqCollectable(platform)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该平台暂不支持浏览器采集，请先选择首期开放的平台',
      );
    }
    const mode = oneOf(body.mode, ACQ_SOURCE_MODES, 'KEYWORD');
    const query = this.sourceQuery(body.query, mode);
    const cron = clip(text(body.cron).trim(), 60);
    const id = int(body.id);
    const data = {
      name,
      platform,
      mode,
      query: json(query),
      filters: json(this.sourceFilters(body.filters)),
      cron,
      dailyLimit: Math.min(
        2000,
        Math.max(1, int(body.dailyLimit, ACQ_DEFAULT_LIMITS.sourceDailyLimit)),
      ),
      status: oneOf(body.status, ['ACTIVE', 'PAUSED'] as const, 'ACTIVE'),
      nextRunAt:
        oneOf(body.status, ['ACTIVE', 'PAUSED'] as const, 'ACTIVE') === 'ACTIVE'
          ? nextRunAt(cron)
          : null,
    };
    if (id > 0) {
      const existing = await this.prisma.acqSource.findFirst({
        where: { id, ...orgKey(org) },
      });
      if (!existing) {
        throw new BusinessException(ErrorCode.NOT_FOUND, '监控源不存在');
      }
      const row = await this.prisma.acqSource.update({ where: { id }, data });
      return this.sourceView(row);
    }
    const row = await this.prisma.acqSource.create({
      data: { ...orgKey(org), ...data, createdBy: user.userId },
    });
    return this.sourceView(row);
  }

  async removeSource(user: CurrentUser, id: number) {
    const org = await this.settings.org(user);
    const row = await this.prisma.acqSource.findFirst({
      where: { id, ...orgKey(org) },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '监控源不存在');
    // 批次与线索保留：线索是资产，删源只停止后续采集
    await this.prisma.acqSource.delete({ where: { id } });
    await this.audit(user, '获客监控源删除', `#${id} ${row.name}`);
    return { removed: true };
  }

  /** 手动触发：只建批次并下发 jobId，真正的采集由浏览器插件拉取执行。 */
  async runSource(user: CurrentUser, id: number) {
    const org = await this.settings.org(user);
    const settings = await this.settings.forOrg(org);
    if (!settings.enabled || !settings.collectEnabled) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '获客采集已关闭，请先在设置里开启',
      );
    }
    const source = await this.prisma.acqSource.findFirst({
      where: { id, ...orgKey(org) },
    });
    if (!source)
      throw new BusinessException(ErrorCode.NOT_FOUND, '监控源不存在');
    const running = await this.prisma.acqRun.findFirst({
      where: { sourceId: id, status: { in: IN_FLIGHT } },
    });
    if (running) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该监控源已有批次在采集，请等它结束或超时后再触发',
      );
    }
    const now = new Date();
    const run = await this.prisma.acqRun.create({
      data: {
        ...orgKey(org),
        sourceId: id,
        status: 'QUEUED',
        jobId: this.jobIdOf(id),
        stats: json({ scanned: 0, new: 0, duplicate: 0, filtered: 0 }),
      },
    });
    await this.prisma.acqSource.update({
      where: { id },
      data: { lastRunAt: now, nextRunAt: nextRunAt(source.cron, now) },
    });
    await this.mechanisms.dispatch(org, 'acquisition.run.queued', {
      runId: run.id,
      sourceId: id,
      platform: source.platform,
    });
    return this.runView(run, source);
  }

  async runs(user: CurrentUser, query: Row) {
    const org = await this.settings.org(user);
    const args = pageArgs(query);
    const where = {
      ...orgKey(org),
      ...(int(query.sourceId) > 0 ? { sourceId: int(query.sourceId) } : {}),
      ...(text(query.status) ? { status: text(query.status) } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.acqRun.count({ where }),
      this.prisma.acqRun.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
    ]);
    const sources = await this.sourceMap(rows.map((row) => row.sourceId));
    return pageResult(
      rows.map((row) => this.runView(row, sources.get(row.sourceId))),
      total,
      args,
    );
  }

  async runDetail(user: CurrentUser, id: number) {
    const org = await this.settings.org(user);
    const run = await this.prisma.acqRun.findFirst({
      where: { id, ...orgKey(org) },
    });
    if (!run)
      throw new BusinessException(ErrorCode.NOT_FOUND, '采集批次不存在');
    const source = await this.prisma.acqSource.findFirst({
      where: { id: run.sourceId },
    });
    // 批次产物按证据反查线索，跨批次合并后仍能看到这一批采到了谁
    const evidence = await this.prisma.acqLeadEvidence.findMany({
      where: { runId: id, ...orgKey(org) },
      select: { leadId: true },
      take: 2000,
    });
    const leadIds = [...new Set(evidence.map((row) => row.leadId))];
    const leads = leadIds.length
      ? await this.prisma.acqLead.findMany({
          where: { id: { in: leadIds }, ...orgKey(org), deletedAt: null },
          orderBy: { intentScore: 'desc' },
          take: 200,
        })
      : [];
    return {
      ...this.runView(run, source ?? undefined),
      leads: leads.map((row) => this.leadView(row)),
    };
  }

  // ---------- 线索 ----------

  async leads(user: CurrentUser, query: Row) {
    const org = await this.settings.org(user);
    const args = pageArgs(query);
    const where = await this.resolveWhere(org, query);
    if (!where) return pageResult([], 0, args);
    const [total, rows] = await Promise.all([
      this.prisma.acqLead.count({ where }),
      this.prisma.acqLead.findMany({
        where,
        orderBy: [{ intentScore: 'desc' }, { id: 'desc' }],
        skip: args.skip,
        take: args.take,
      }),
    ]);
    return pageResult(
      rows.map((row) => this.leadView(row)),
      total,
      args,
    );
  }

  async leadDetail(user: CurrentUser, id: number) {
    const org = await this.settings.org(user);
    const row = await this.requireLead(org, id);
    const [evidence, outreach, profile, contacts] = await Promise.all([
      this.prisma.acqLeadEvidence.findMany({
        where: { leadId: id, ...orgKey(org) },
        orderBy: { capturedAt: 'desc' },
        take: 100,
      }),
      this.prisma.acqOutreachTask.findMany({
        where: { leadId: id, ...orgKey(org) },
        orderBy: { id: 'desc' },
        take: 50,
      }),
      row.crmLeadId
        ? this.prisma.acqProfile.findFirst({
            where: {
              crmLeadId: row.crmLeadId,
              ...orgKey(org),
              deletedAt: null,
            },
            select: { id: true },
          })
        : Promise.resolve(null),
      this.leadContacts(org, id),
    ]);
    return {
      ...this.leadView(row),
      opening: row.opening,
      risk: row.risk,
      profileId: profile?.id || 0,
      contacts,
      evidence: evidence.map((item) => ({
        id: item.id,
        leadId: item.leadId,
        runId: item.runId,
        sourceType: item.sourceType,
        url: item.url,
        excerpt: item.excerpt,
        summary: item.summary,
        metrics: asRecord(item.metrics),
        contacts: evidenceContactsOf(item.contacts),
        capturedAt: iso(item.capturedAt),
      })),
      outreach: outreach.map((item) => ({
        id: item.id,
        channel: item.channel,
        action: item.action,
        status: item.status,
        receiptStatus: item.receiptStatus,
        sentAt: iso(item.sentAt),
        finalText: item.finalText || item.draft,
      })),
    };
  }

  /** 供档案/提升等相邻服务复用同一份线索视图，避免两处字段口径漂移。 */
  async publicLeadView(org: HrmOrg | OrgKey, id: number) {
    return this.leadView(await this.requireLead(org, id));
  }

  async updateLead(user: CurrentUser, id: number, body: Row) {
    const org = await this.settings.org(user);
    const row = await this.requireLead(org, id);
    const data: Prisma.AcqLeadUncheckedUpdateInput = {};
    if (body.status !== undefined) {
      data.status = clip(text(body.status), 16);
    }
    if (body.blockReason !== undefined) {
      data.blockReason = clip(text(body.blockReason), 300);
    }
    if (body.ownerUserId !== undefined) {
      data.ownerUserId = clip(text(body.ownerUserId), 64);
    }
    if (body.tags !== undefined) {
      data.intentTags = json(
        strArr(body.tags)
          .map((tag) => clip(tag, 40))
          .slice(0, 20),
      );
    }
    if (!Object.keys(data).length && !text(body.note)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有需要保存的修改');
    }
    const updated = Object.keys(data).length
      ? await this.prisma.acqLead.update({ where: { id }, data })
      : row;
    if (text(body.note)) {
      await this.audit(user, '获客线索备注', `#${id} ${clip(body.note, 400)}`);
    }
    return this.leadView(updated);
  }

  /** 意图评分：有通道走模型并严格校验，缺 Key 或产出不合规降级规则式，mode 如实标注。 */
  async scoreLead(
    user: CurrentUser,
    id: number,
    body: Row,
    token = '',
  ): Promise<IntentScore> {
    const org = await this.settings.org(user);
    const row = await this.requireLead(org, id);
    const force = body.force === true;
    if (!force && row.scoreMode === 'llm') return this.scoreOf(row);
    const settings = await this.settings.forOrg(org);
    const evidenceRows = await this.prisma.acqLeadEvidence.findMany({
      where: { leadId: id, ...orgKey(org) },
      orderBy: { capturedAt: 'desc' },
      take: 8,
    });
    const evidence: EvidenceInput[] = evidenceRows.map((item) => ({
      sourceType: item.sourceType,
      excerpt: item.excerpt || item.summary,
      metrics: asRecord(item.metrics),
    }));
    const context = await this.brandContext(org);
    let score = ruleScore(evidence, context);
    const ai = await aiJson<IntentScore>(this.prisma, {
      userId: user.userId,
      token,
      model: settings.aiModel || undefined,
      channelId: settings.aiChannelId || undefined,
      messages: buildScoreMessages(
        evidence,
        context,
        ACQ_PLATFORM_LABELS[row.platform] || row.platform,
      ),
      purpose: 'batch',
      module: 'acquisition',
      operation: 'score_lead',
      charge: { code: 'acq_score', refId: String(id) },
      validate: (raw) => validateScore(raw),
    });
    if (ai) score = ai.data;
    // 合并口径：同一人多次评分取最高分，force 时才允许覆盖为本次结果
    const finalScore = force
      ? score.score
      : Math.max(row.intentScore, score.score);
    const level = finalScore >= 70 ? 'HOT' : finalScore >= 40 ? 'WARM' : 'COLD';
    await this.prisma.acqLead.update({
      where: { id },
      data: {
        intentScore: finalScore,
        intentLevel: level,
        intentTags: json(score.tags),
        scoreMode: score.mode,
        scoreReason: clip(score.reason, 4000),
        opening: clip(score.opening, 2000),
        risk: clip(score.risk, 300),
      },
    });
    return { ...score, score: finalScore, level };
  }

  // ---------- 写入多维表格 / 导出 ----------

  async leadsToTable(user: CurrentUser, body: Row) {
    const org = await this.settings.org(user);
    const tableId = int(body.tableId);
    if (tableId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择一张结果表');
    }
    const leadIds = intArr(body.leadIds).slice(0, 500);
    if (!leadIds.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择要写入的线索');
    }
    const rows = await this.prisma.acqLead.findMany({
      where: { id: { in: leadIds }, ...orgKey(org), deletedAt: null },
    });
    const skipped = leadIds.length - rows.length;
    if (!rows.length) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '所选线索不存在或已删除',
      );
    }
    const fields = await this.dataTable.fieldsOf(tableId);
    const fieldKeys = new Set(fields.map((field) => field.fieldKey));
    const explicit = asRecord(body.fieldMap);
    const pairs: Array<[string, string]> = Object.keys(explicit).length
      ? Object.entries(explicit)
          .map(
            ([from, to]) => [clip(from, 60), clip(to, 60)] as [string, string],
          )
          .filter(
            ([from, to]) =>
              LEAD_EXPORT_COLUMNS.includes(from) && fieldKeys.has(to),
          )
      : LEAD_EXPORT_COLUMNS.filter((key) => fieldKeys.has(key)).map(
          (key) => [key, key] as [string, string],
        );
    if (!pairs.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '目标表没有可映射的获客字段，请先建列或调整字段映射',
      );
    }
    await this.dataTable.assertWritable(
      user,
      tableId,
      pairs.map(([, to]) => to),
      '获客线索结果表',
    );
    const payload = rows.map((row) => {
      const view = this.leadRow(row);
      const item: Row = {};
      for (const [from, to] of pairs) item[to] = view[from];
      return item;
    });
    let written = 0;
    let failed = 0;
    let firstError = '';
    for (let index = 0; index < payload.length; index += INSERT_BATCH) {
      const batch = payload.slice(index, index + INSERT_BATCH);
      try {
        await this.dataTable.createRows(user, tableId, batch);
        written += batch.length;
      } catch (error) {
        failed += batch.length;
        firstError ||= error instanceof Error ? error.message : '写入失败';
      }
    }
    if (!written && failed) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, firstError);
    }
    await this.audit(
      user,
      '获客线索写入多维表格',
      `表#${tableId} 写入${written}条 跳过${skipped}条 失败${failed}条`,
    );
    return { tableId, written, skipped, failed };
  }

  async exportLeads(user: CurrentUser, body: Row) {
    const job = await this.mechanisms.createExportJob(user, {
      module: 'acq_lead',
      format: body.format === 'json' ? 'json' : 'csv',
      filters: {
        leadIds: intArr(body.leadIds),
        platform: text(body.platform),
        status: text(body.status),
        intentLevel: text(body.intentLevel),
      },
    });
    await this.audit(
      user,
      '获客线索导出',
      `任务#${job.id} ${job.format} ${job.rowCount}条 ${job.status}`,
    );
    return { jobId: job.id, status: job.status, downloadUrl: job.fileUrl };
  }

  /** 横切导出任务的行 provider：与列表页同一套过滤口径。 */
  async exportRows(org: HrmOrg | OrgKey, filters: Row): Promise<Row[]> {
    const where = await this.resolveWhere(org, filters);
    if (!where) return [];
    const rows = await this.prisma.acqLead.findMany({
      where,
      orderBy: [{ intentScore: 'desc' }, { id: 'desc' }],
      take: EXPORT_LIMIT,
    });
    return rows.map((row) => this.leadRow(row));
  }

  // ---------- 采集入库（插件回执调用） ----------

  /**
   * 采集结果入库：平台+平台用户标识去重，URL 去重证据，过滤词/互动阈值/时间窗/已成交在这里判定。
   * 入库即给规则式初评分，模型评分由 scoreLead 显式触发，避免一次采集打出上百次 AI 调用。
   */
  async ingest(
    key: OrgKey,
    runId: number,
    items: Row[],
  ): Promise<{
    scanned: number;
    new: number;
    duplicate: number;
    filtered: number;
    leadIds: number[];
  }> {
    const run = await this.prisma.acqRun.findFirst({
      where: { id: runId, ...orgKey(key) },
    });
    if (!run)
      throw new BusinessException(ErrorCode.NOT_FOUND, '采集批次不存在');
    const source = await this.prisma.acqSource.findFirst({
      where: { id: run.sourceId, ...orgKey(key) },
    });
    const filters = this.sourceFilters(source?.filters);
    const query = asRecord(source?.query);
    const context = await this.brandContext(key);
    const windowDays = WINDOW_DAYS[filters.timeWindow as string] || 0;
    const cutoff = windowDays
      ? new Date(Date.now() - windowDays * 86_400_000)
      : null;
    const excludeWords = strArr(filters.excludeWords).map((word) =>
      word.toLowerCase(),
    );
    const regions = strArr(filters.regions).map((word) => word.toLowerCase());
    const minComments = Math.max(0, int(filters.minComments));
    const stats = { scanned: 0, new: 0, duplicate: 0, filtered: 0 };
    const leadIds: number[] = [];
    const dailyLimit = Math.max(
      1,
      int(source?.dailyLimit, ACQ_DEFAULT_LIMITS.sourceDailyLimit),
    );
    const todayCount = await this.prisma.acqLeadEvidence.count({
      where: {
        ...orgKey(key),
        runId: { in: await this.todayRunIds(key, run.sourceId) },
      },
    });
    let budget = Math.max(0, dailyLimit - todayCount);

    for (const raw of items.slice(0, 500)) {
      stats.scanned += 1;
      const item = asRecord(raw);
      const platform = clip(text(item.platform), 20);
      const platformUserId = clip(text(item.platformUserId).trim(), 120);
      const url = clip(text(item.url).trim(), 500);
      const excerpt = clip(text(item.excerpt), 4000);
      if (!platformUserId || !url || !acqCollectable(platform)) {
        stats.filtered += 1;
        continue;
      }
      if (source && platform !== source.platform) {
        stats.filtered += 1;
        continue;
      }
      const metrics = asRecord(item.metrics);
      const haystack = `${excerpt} ${text(item.nickname)}`.toLowerCase();
      if (excludeWords.some((word) => word && haystack.includes(word))) {
        stats.filtered += 1;
        continue;
      }
      if (minComments > 0 && num(metrics.comments) < minComments) {
        stats.filtered += 1;
        continue;
      }
      const publishedAt = dateOr(metrics.publishedAt);
      if (cutoff && publishedAt && publishedAt < cutoff) {
        stats.filtered += 1;
        continue;
      }
      if (regions.length && !regions.some((word) => haystack.includes(word))) {
        stats.filtered += 1;
        continue;
      }
      if (budget <= 0) {
        stats.filtered += 1;
        continue;
      }
      const dedupeKey = dedupeKeyOf(platform, platformUserId);
      const existing = await this.prisma.acqLead.findFirst({
        where: { ...orgKey(key), dedupeKey },
      });
      if (existing?.deletedAt) {
        // 人工删过的线索不再自动复活
        stats.filtered += 1;
        continue;
      }
      if (
        filters.excludeCustomers !== false &&
        existing &&
        (existing.crmLeadId > 0 || existing.status === 'PROMOTED')
      ) {
        stats.filtered += 1;
        continue;
      }
      const evidenceInput: EvidenceInput[] = [
        {
          sourceType: oneOf(item.sourceType, ACQ_EVIDENCE_SOURCES, 'COMMENT'),
          excerpt,
          metrics,
        },
      ];
      // 公开联系方式只取主页已公开可见字段（D7=B）：本系统不绕过登录墙、不抓隐藏资料。
      const contacts = contactsOf(item.contacts);
      const score = ruleScore(evidenceInput, {
        ...context,
        keywords: [...context.keywords, ...strArr(query.keywords)],
        regions: [...context.regions, ...regions],
      });
      const now = new Date();
      const lead = existing
        ? await this.prisma.acqLead.update({
            where: { id: existing.id },
            data: {
              nickname: existing.nickname || clip(text(item.nickname), 120),
              profileUrl:
                existing.profileUrl || clip(text(item.profileUrl), 500),
              lastSeenAt: now,
              // 合并取最高分，初评分不覆盖已有的模型判断
              intentScore: Math.max(existing.intentScore, score.score),
              intentLevel:
                Math.max(existing.intentScore, score.score) >= 70
                  ? 'HOT'
                  : Math.max(existing.intentScore, score.score) >= 40
                    ? 'WARM'
                    : 'COLD',
            },
          })
        : await this.prisma.acqLead.create({
            data: {
              ...orgKey(key),
              platform,
              platformUserId,
              nickname: clip(text(item.nickname), 120),
              profileUrl: clip(text(item.profileUrl), 500),
              dedupeKey,
              intentScore: score.score,
              intentLevel: score.level,
              intentTags: json(score.tags),
              scoreMode: score.mode,
              scoreReason: clip(score.reason, 4000),
              risk: clip(score.risk, 300),
              firstSeenAt: now,
              lastSeenAt: now,
            },
          });
      const evidence = await this.prisma.acqLeadEvidence.upsert({
        where: { leadId_url: { leadId: lead.id, url } },
        create: {
          ...orgKey(key),
          leadId: lead.id,
          runId,
          sourceType: evidenceInput[0].sourceType,
          url,
          excerpt,
          summary: clip(excerpt.replace(/\s+/g, ' '), 200),
          metrics: json(metrics),
          contacts: json(contacts),
          capturedAt: publishedAt || now,
        },
        update: {
          runId,
          excerpt: excerpt || undefined,
          metrics: json(metrics),
          // 主页公开信息的补抓结果按「最后一次采到」覆盖；本次没采到就保留上一次的，不清空。
          contacts: contacts.length ? json(contacts) : undefined,
        },
      });
      budget -= 1;
      leadIds.push(lead.id);
      if (existing) stats.duplicate += 1;
      else {
        stats.new += 1;
        await this.mechanisms.dispatch(orgOf(key), 'acquisition.lead.created', {
          leadId: lead.id,
          platform,
          intentScore: lead.intentScore,
          intentLevel: lead.intentLevel,
          runId,
          evidenceId: evidence.id,
        });
      }
    }
    for (const leadId of new Set(leadIds)) {
      const count = await this.prisma.acqLeadEvidence.count({
        where: { leadId },
      });
      const contactCount = (await this.leadContacts(key, leadId)).length;
      await this.prisma.acqLead.update({
        where: { id: leadId },
        data: { evidenceCount: count, contactCount },
      });
    }
    return { ...stats, leadIds: [...new Set(leadIds)] };
  }

  /**
   * 汇总某条线索下跨全部证据的公开联系方式，按「字段 + 取值」去重。
   * 带 url / capturedAt 追溯来源：这就是 D7=B 要求的证据链，界面据此展示每条联系方式的出处。
   */
  private async leadContacts(
    org: HrmOrg | OrgKey,
    leadId: number,
  ): Promise<Array<AcqContact & { url: string; capturedAt: string }>> {
    const rows = await this.prisma.acqLeadEvidence.findMany({
      where: { leadId, ...orgKey(org) },
      orderBy: { capturedAt: 'desc' },
      take: 200,
      select: { url: true, contacts: true, capturedAt: true },
    });
    const seen = new Set<string>();
    const out: Array<AcqContact & { url: string; capturedAt: string }> = [];
    for (const row of rows) {
      for (const contact of evidenceContactsOf(row.contacts)) {
        const key = contactKey(contact);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          ...contact,
          url: row.url,
          capturedAt: iso(row.capturedAt),
        });
      }
    }
    return out;
  }

  // ---------- 插件任务（采集） ----------

  /** 认领待采批次：CAS 从 QUEUED 改 CLAIMED，抢不到说明已被别的插件实例领走。 */
  async claimCollectJobs(key: OrgKey, limit: number): Promise<Row[]> {
    const runs = await this.prisma.acqRun.findMany({
      where: { ...orgKey(key), status: 'QUEUED' },
      orderBy: { id: 'asc' },
      take: Math.max(1, limit),
    });
    const settings = await this.settings.forOrg(key);
    const jobs: Row[] = [];
    for (const run of runs) {
      const now = new Date();
      const claimed = await this.prisma.acqRun.updateMany({
        where: { id: run.id, status: 'QUEUED' },
        data: { status: 'CLAIMED', claimedAt: now, heartbeatAt: now },
      });
      if (claimed.count !== 1) continue;
      const source = await this.prisma.acqSource.findFirst({
        where: { id: run.sourceId, ...orgKey(key) },
      });
      if (!source || source.status !== 'ACTIVE') {
        await this.prisma.acqRun.update({
          where: { id: run.id },
          data: {
            status: 'FAILED',
            error: '监控源已删除或已暂停，批次不再下发',
            finishedAt: now,
          },
        });
        continue;
      }
      const query = this.normalizeQuery(source.query);
      jobs.push({
        jobId: run.jobId,
        type: 'collect',
        runId: run.id,
        outreachId: 0,
        platform: source.platform,
        mode: source.mode,
        query,
        filters: this.sourceFilters(source.filters),
        urls: strArr(query.urls),
        limits: {
          dailyLimit: source.dailyLimit,
          maxItems: source.dailyLimit,
          intervalMinSeconds: settings.intervalMinSeconds,
          intervalMaxSeconds: settings.intervalMaxSeconds,
          activeHoursStart: settings.activeHoursStart,
          activeHoursEnd: settings.activeHoursEnd,
        },
        action: '',
        targetUrl: '',
        text: '',
        maxPerHour: 0,
      });
    }
    return jobs;
  }

  /**
   * 采集回执：jobId 必须与批次一致；已关闭的批次按重复回执处理，不再二次入库。
   * running 只累加统计与心跳，done/partial/failed/stopped 才关批次并记一次采集用量。
   */
  async reportCollect(
    key: OrgKey,
    body: Row,
    actorUserId: string,
  ): Promise<AcqPluginReportOutcome> {
    const runId = int(body.runId);
    const run = await this.prisma.acqRun.findFirst({
      where: { id: runId, ...orgKey(key) },
    });
    if (!run)
      throw new BusinessException(ErrorCode.NOT_FOUND, '采集批次不存在');
    if (run.jobId !== clip(text(body.jobId), 120)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '回执与批次不匹配');
    }
    if (['DONE', 'PARTIAL', 'FAILED'].includes(run.status)) {
      return {
        duplicated: true,
        runStatus: run.status,
        message: '该批次已关闭，本次回执按重复处理',
      };
    }
    const items = Array.isArray(body.items) ? (body.items as Row[]) : [];
    const ingest = items.length
      ? await this.ingest(key, runId, items)
      : { scanned: 0, new: 0, duplicate: 0, filtered: 0, leadIds: [] };
    const reported = asRecord(body.stats);
    const previous = asRecord(run.stats);
    const stats = {
      scanned:
        Math.max(ingest.scanned, int(reported.scanned)) + int(previous.scanned),
      new: ingest.new + int(previous.new),
      duplicate: ingest.duplicate + int(previous.duplicate),
      filtered:
        Math.max(ingest.filtered, int(reported.filtered)) +
        int(previous.filtered),
    };
    const stopReason = clip(text(body.stopReason), 40);
    const reportedStatus = text(body.status) || 'done';
    const stopped = ['partial', 'failed', 'stopped'].includes(reportedStatus);
    const status =
      reportedStatus === 'running'
        ? 'RUNNING'
        : reportedStatus === 'failed'
          ? 'FAILED'
          : stopped || (stopReason && stopReason !== 'LIMIT_REACHED')
            ? 'PARTIAL'
            : 'DONE';
    const error = clip(
      text(body.error) ||
        (stopReason ? ACQ_PLUGIN_STOP_LABELS[stopReason] || stopReason : ''),
      2000,
    );
    const now = new Date();
    const finished = status !== 'RUNNING';
    await this.prisma.acqRun.update({
      where: { id: runId },
      data: {
        status,
        stats: json(stats),
        error,
        heartbeatAt: now,
        finishedAt: finished ? now : null,
      },
    });
    if (finished) {
      // 采集用量记账失败不阻断回执：批次结果已经落库，账本只告警一次
      await this.aiEval
        .chargeByUsage(actorUserId, 'acq_scan', { call: 1 }, String(runId), {
          module: 'acquisition',
          operation: 'collect_run',
        })
        .catch((err) => this.warnOnce('acq_scan', err));
      await this.mechanisms.dispatch(orgOf(key), 'acquisition.run.finished', {
        runId,
        sourceId: run.sourceId,
        status,
        newLeads: ingest.new,
      });
    }
    return {
      newLeads: ingest.new,
      runStatus: status,
      message: finished
        ? `批次已结束：新增 ${ingest.new} 条，重复 ${ingest.duplicate} 条，过滤 ${ingest.filtered} 条`
        : `已收到 ${items.length} 条采集结果，批次继续`,
    };
  }

  // ---------- 调度器入口 ----------

  /** 到点的源：CAS 抢占 nextRunAt，抢不到说明别的 tick 已经建过批次。 */
  async dueSources(now = new Date()): Promise<number[]> {
    const sources = await this.prisma.acqSource.findMany({
      where: {
        status: 'ACTIVE',
        cron: { not: '' },
        OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
      },
      take: 50,
    });
    const created: number[] = [];
    for (const source of sources) {
      const settings = await this.settings.forOrg(source);
      if (!settings.enabled || !settings.collectEnabled) continue;
      const running = await this.prisma.acqRun.findFirst({
        where: { sourceId: source.id, status: { in: IN_FLIGHT } },
      });
      if (running) continue;
      const claimed = await this.prisma.acqSource.updateMany({
        where: { id: source.id, status: 'ACTIVE', nextRunAt: source.nextRunAt },
        data: { lastRunAt: now, nextRunAt: nextRunAt(source.cron, now) },
      });
      if (claimed.count !== 1) continue;
      const run = await this.prisma.acqRun.create({
        data: {
          orgType: source.orgType,
          orgUserId: source.orgUserId,
          sourceId: source.id,
          status: 'QUEUED',
          jobId: this.jobIdOf(source.id),
          stats: json({ scanned: 0, new: 0, duplicate: 0, filtered: 0 }),
        },
      });
      created.push(run.id);
    }
    return created;
  }

  /** 插件掉线/关页：超过 10 分钟没有心跳的批次记 PARTIAL，不把空结果当成功。 */
  async timeoutStaleRuns(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - RUN_TIMEOUT_MS);
    const rows = await this.prisma.acqRun.findMany({
      where: {
        status: { in: ['CLAIMED', 'RUNNING'] },
        OR: [
          { heartbeatAt: { lt: before } },
          { heartbeatAt: null, claimedAt: { lt: before } },
        ],
      },
      take: 100,
      select: { id: true },
    });
    if (!rows.length) return 0;
    const result = await this.prisma.acqRun.updateMany({
      where: {
        id: { in: rows.map((row) => row.id) },
        status: { in: ['CLAIMED', 'RUNNING'] },
      },
      data: {
        status: 'PARTIAL',
        error: '插件超过 10 分钟没有回执，批次按部分完成关闭',
        finishedAt: now,
      },
    });
    return result.count;
  }

  /** 证据保留期：到期只清原文，摘要与链接留着，线索本身不受影响。 */
  async purgeEvidence(now = new Date()): Promise<number> {
    const orgs = await this.prisma.acqSetting.findMany({
      select: { orgType: true, orgUserId: true, evidenceRetentionDays: true },
    });
    let total = 0;
    for (const org of orgs) {
      const days = Math.max(
        7,
        int(
          org.evidenceRetentionDays,
          ACQ_DEFAULT_LIMITS.evidenceRetentionDays,
        ),
      );
      const cutoff = new Date(now.getTime() - days * 86_400_000);
      const result = await this.prisma.acqLeadEvidence.updateMany({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          capturedAt: { lt: cutoff },
          excerpt: { not: '' },
        },
        data: { excerpt: '' },
      });
      total += result.count;
    }
    return total;
  }

  /** 品牌上下文取自营销口径单例，地域来自监控源过滤，不另建一套品牌资料。 */
  async brandContext(key: OrgKey): Promise<ScoreContext> {
    const row = await this.prisma.mktContext.findFirst({
      where: { orgType: key.orgType, orgUserId: key.orgUserId },
    });
    if (!row) return { ...EMPTY_CONTEXT };
    return {
      brandName: row.brandName,
      industry: row.industry,
      positioning: row.positioning,
      keywords: strArr(row.keywords),
      regions: [],
    };
  }

  async requireLead(org: HrmOrg | OrgKey, id: number) {
    const row = await this.prisma.acqLead.findFirst({
      where: { id, ...orgKey(org), deletedAt: null },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '线索不存在或已删除');
    return row;
  }

  // ---------- 内部 ----------

  private jobIdOf(sourceId: number): string {
    return `acq-${sourceId}-${Date.now()}-${randomBytes(6).toString('hex')}`;
  }

  private async todayRunIds(key: OrgKey, sourceId: number): Promise<number[]> {
    const rows = await this.prisma.acqRun.findMany({
      where: {
        ...orgKey(key),
        sourceId,
        startedAt: { gte: dayFloor(new Date()) },
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  private async sourceMap(ids: number[]) {
    const unique = [...new Set(ids.filter((id) => id > 0))];
    if (!unique.length) return new Map<number, SourceRow>();
    const rows = await this.prisma.acqSource.findMany({
      where: { id: { in: unique } },
    });
    return new Map(rows.map((row) => [row.id, row as SourceRow]));
  }

  private normalizeQuery(value: unknown): Row {
    const raw = asRecord(value);
    const list = (key: string) =>
      strArr(raw[key])
        .map((item) => clip(item, 120))
        .slice(0, 50);
    return {
      keywords: list('keywords'),
      competitorIds: list('competitorIds'),
      topicTags: list('topicTags'),
      accountUrls: list('accountUrls'),
      urls: list('urls'),
    };
  }

  private sourceQuery(value: unknown, mode: string): Row {
    const query = this.normalizeQuery(value);
    const required: Record<string, string> = {
      KEYWORD: 'keywords',
      COMPETITOR: 'competitorIds',
      TOPIC: 'topicTags',
      ACCOUNT: 'accountUrls',
      URL: 'urls',
    };
    const key = required[mode];
    if (key && !(query[key] as string[]).length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该查找方式需要至少填写一项查找内容',
      );
    }
    return query;
  }

  private sourceFilters(value: unknown): Row {
    const raw = asRecord(value);
    return {
      timeWindow: oneOf(
        raw.timeWindow,
        ['7d', '30d', '90d', 'all'] as const,
        '30d',
      ),
      excludeWords: strArr(raw.excludeWords)
        .map((word) => clip(word, 60))
        .slice(0, 50),
      minComments: Math.min(100000, Math.max(0, int(raw.minComments))),
      regions: strArr(raw.regions)
        .map((word) => clip(word, 60))
        .slice(0, 50),
      excludeCustomers: raw.excludeCustomers !== false,
    };
  }

  /** 按监控源过滤要先经批次→证据反查线索；返回 null 表示该源没有任何线索，直接空结果。 */
  private async resolveWhere(org: HrmOrg | OrgKey, query: Row) {
    const sourceId = int(query.sourceId);
    if (sourceId <= 0) return this.leadWhere(org, query);
    const runs = await this.prisma.acqRun.findMany({
      where: { ...orgKey(org), sourceId },
      select: { id: true },
    });
    if (!runs.length) return null;
    const evidence = await this.prisma.acqLeadEvidence.findMany({
      where: { ...orgKey(org), runId: { in: runs.map((run) => run.id) } },
      select: { leadId: true },
      take: EXPORT_LIMIT,
    });
    const ids = [...new Set(evidence.map((row) => row.leadId))];
    if (!ids.length) return null;
    const explicit = intArr(query.leadIds);
    const merged = explicit.length
      ? ids.filter((id) => explicit.includes(id))
      : ids;
    if (!merged.length) return null;
    return this.leadWhere(org, { ...query, leadIds: merged });
  }

  private leadWhere(org: HrmOrg | OrgKey, query: Row) {
    const from = dateOr(query.from);
    const to = dateOr(query.to);
    const lastSeenAt: { gte?: Date; lt?: Date } = {};
    if (from) lastSeenAt.gte = dayFloor(from);
    if (to) {
      const end = dayFloor(to);
      end.setDate(end.getDate() + 1);
      lastSeenAt.lt = end;
    }
    const leadIds = intArr(query.leadIds);
    const q = clip(text(query.q).trim(), 60);
    const tag = clip(text(query.tag).trim(), 40);
    return {
      ...orgKey(org),
      deletedAt: null,
      ...(leadIds.length ? { id: { in: leadIds } } : {}),
      ...(text(query.platform) ? { platform: text(query.platform) } : {}),
      ...(text(query.status) ? { status: text(query.status) } : {}),
      ...(text(query.intentLevel)
        ? { intentLevel: text(query.intentLevel) }
        : {}),
      ...(query.minScore !== undefined && query.minScore !== ''
        ? { intentScore: { gte: Math.max(0, int(query.minScore)) } }
        : {}),
      ...(tag ? { intentTags: { array_contains: [tag] } } : {}),
      ...(Object.keys(lastSeenAt).length ? { lastSeenAt } : {}),
      ...(q
        ? {
            OR: [
              { nickname: { contains: q } },
              { platformUserId: { contains: q } },
              { scoreReason: { contains: q } },
            ],
          }
        : {}),
    };
  }

  private sourceView(row: SourceRow) {
    return {
      id: row.id,
      name: row.name,
      platform: row.platform,
      mode: row.mode,
      query: this.normalizeQuery(row.query),
      filters: this.sourceFilters(row.filters),
      cron: row.cron,
      dailyLimit: row.dailyLimit,
      status: row.status,
      lastRunAt: iso(row.lastRunAt),
      nextRunAt: iso(row.nextRunAt),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  private runView(row: RunRow, source?: SourceRow) {
    const stats = asRecord(row.stats);
    return {
      id: row.id,
      sourceId: row.sourceId,
      sourceName: source?.name || '',
      platform: source?.platform || '',
      status: row.status,
      stats: {
        scanned: Math.max(0, int(stats.scanned)),
        new: Math.max(0, int(stats.new)),
        duplicate: Math.max(0, int(stats.duplicate)),
        filtered: Math.max(0, int(stats.filtered)),
      },
      error: row.error,
      claimedAt: iso(row.claimedAt),
      heartbeatAt: iso(row.heartbeatAt),
      startedAt: iso(row.startedAt),
      finishedAt: iso(row.finishedAt),
    };
  }

  private leadView(row: LeadRow) {
    return {
      id: row.id,
      platform: row.platform,
      platformUserId: row.platformUserId,
      nickname: row.nickname,
      profileUrl: row.profileUrl,
      intentScore: row.intentScore,
      intentLevel: row.intentLevel,
      intentTags: strArr(row.intentTags),
      scoreMode: row.scoreMode,
      scoreReason: row.scoreReason,
      status: row.status,
      blockReason: row.blockReason,
      ownerUserId: row.ownerUserId,
      crmLeadId: row.crmLeadId,
      evidenceCount: row.evidenceCount,
      contactCount: row.contactCount,
      firstSeenAt: iso(row.firstSeenAt),
      lastSeenAt: iso(row.lastSeenAt),
    };
  }

  private leadRow(row: LeadRow): Row {
    const view = this.leadView(row);
    return { ...view, intentTags: strArr(row.intentTags).join('、') };
  }

  private scoreOf(row: LeadRow): IntentScore {
    return {
      score: row.intentScore,
      level: oneOf(row.intentLevel, ACQ_INTENT_LEVELS, 'COLD'),
      tags: strArr(row.intentTags),
      reason: row.scoreReason,
      opening: row.opening,
      risk: row.risk,
      mode: oneOf(row.scoreMode, ['rule', 'llm'] as const, 'rule'),
      dimensions: [],
    };
  }

  private async audit(user: CurrentUser, action: string, detail: string) {
    await this.prisma.auditLog.create({
      data: { userId: user.userId, action, detail: clip(detail, 500) },
    });
  }

  /** 记账等辅助链路失败只告警一次，不阻断采集主链路。 */
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
