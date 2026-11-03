import { setTimeout as pause } from 'node:timers/promises';
import { Logger } from '../common/logger';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { geoChat } from './geo-llm.client';
import { GEO_PROVIDERS, GeoSettingsService } from './geo-settings.service';
import { GEO_PLATFORMS, normalizeObservation } from './geo-shared';
/**
 * GEO 自动采集执行器（用户端「开启自动采集」后的每周任务）：
 * - 每期 = 一个项目的一周（week_start = 该周周日 00:00），逐项 = ACTIVE 问题 × 可用平台；
 * - 项执行：向该平台提问（原始回答留档）→ 用豆包把回答解析成观测字段 → 直接落真实观测；
 * - 执行窗口：周日 02:00–06:00，窗口到点未跑完的项留 PENDING，顺延到次日同窗口继续；
 * - 多实例（1690/1691 同库）用原子 claim + 心跳防重复执行。
 */
export const GEO_COLLECT_MAX_ATTEMPTS = 3;
/** 单项最多重试次数用尽后的状态。 */
export const GEO_WINDOW_START_HOUR = 2;
export const GEO_WINDOW_END_HOUR = 6;
/** 单次提问超时：各家官方接口长回答普遍 30s+，实测 60s 会挂。 */
const ASK_TIMEOUT_MS = 180000;
/** 解析超时（豆包）。 */
const PARSE_TIMEOUT_MS = 120000;
/** 提问输出上限（含思考 token）。 */
const ASK_MAX_TOKENS = 3000;
const PARSE_MAX_TOKENS = 1200;
/** 逐项节流（≈1.4 QPS）。 */
const ITEM_GAP_MS = 700;
/** 失败项的冷却：避免同一项在窗口内每分钟重试。 */
const RETRY_COOLDOWN_MS = 5 * 60 * 1000;
/** RUNNING 心跳过期阈值：超过视为实例已死，可由其它实例接管。 */
const STALE_HEARTBEAT_MS = 10 * 60 * 1000;
const asArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item)) : [];
/** 本期的归属周：最近的周日 00:00（今天是周日则取今天）。 */
const SHANGHAI_OFFSET = 8 * 3600000;
const localDay = (date: Date) => new Date(date.getTime() + SHANGHAI_OFFSET);
export function weekStartOf(now: Date): Date {
  const day = localDay(now);
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() - day.getUTCDay());
  return new Date(day.getTime() - SHANGHAI_OFFSET);
}
export function weekLabelOf(weekStart: Date): string {
  const day = localDay(weekStart);
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const start = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - start) / 86400000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
function windowOfDay(day: Date) {
  const start = localDay(day);
  start.setUTCHours(GEO_WINDOW_START_HOUR, 0, 0, 0);
  const end = localDay(day);
  end.setUTCHours(GEO_WINDOW_END_HOUR, 0, 0, 0);
  return {
    start: new Date(start.getTime() - SHANGHAI_OFFSET),
    end: new Date(end.getTime() - SHANGHAI_OFFSET),
  };
}
export function nextWindowOf(
  now: Date,
  weekStart: Date,
): { start: Date; end: Date } | null {
  for (let offset = 0; offset < 7; offset++) {
    const window = windowOfDay(
      new Date(weekStart.getTime() + offset * 86400000),
    );
    if (window.end.getTime() > now.getTime()) return window;
  }
  return null;
}
export function isInWindow(now: Date) {
  const window = windowOfDay(now);
  return now >= window.start && now < window.end;
}
const hhmm = (date: Date) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
type ProjectRow = {
  id: number;
  /** 项目归属账号：采集与解析只用这个账号自己配的 Key。 */
  ownerUserId: string;
  brand: string;
  brandAliases: string;
  industry: string;
  competitors: unknown;
  platforms: unknown;
};
type QuestionRow = {
  id: number;
  text: string;
  scenario: string;
};
/** 每次抢占生成新令牌；同一进程再次接管也不能复用旧执行权。 */
type RunLease = {
  id: number;
  token: string;
};
type ClaimedRun = RunLease & {
  periodLabel: string;
  projectId: number;
};
class GeoCollectionLeaseLostError extends Error {
  constructor(runId: number) {
    super(`采集任务 #${runId} 的执行权已失效`);
  }
}
const providerOfPlatform = (platform: string) =>
  GEO_PROVIDERS.find((item) => item.platform === platform) || null;
/** 从模型输出里抠出 JSON（容忍 ```json 代码块与前后解释文字）。 */
function extractJson(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
function brandProfile(project: ProjectRow) {
  const aliases = text(project.brandAliases)
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const competitors = asArray(project.competitors).filter(Boolean);
  return { aliases, competitors };
}
/** 采集提问：带品牌背景与中文口径（不带背景实测会返回英文或误解品牌）。 */
export function buildAskPrompt(project: ProjectRow, question: QuestionRow) {
  const { aliases, competitors } = brandProfile(project);
  const background = [
    `品牌「${project.brand}」`,
    aliases.length ? `（别名：${aliases.join('、')}）` : '',
    text(project.industry) ? `，所属行业：${project.industry}` : '',
    competitors.length ? `；该行业常见品牌还有：${competitors.join('、')}` : '',
  ].join('');
  return [
    '你是一位面向中文互联网用户的 AI 助手。请用简体中文、以普通用户的真实视角回答下面的问题。',
    `背景资料（仅供你理解问题，不必逐字复述）：${background}。`,
    text(question.scenario) ? `用户的真实场景：${question.scenario}` : '',
    `问题：${question.text}`,
    '要求：给出你的真实推荐与判断；适合用清单时请按推荐顺序编号列出并简述理由；不要因为背景资料里出现某个品牌就刻意推荐它；全文使用简体中文。',
  ]
    .filter(Boolean)
    .join('\n');
}
/** 解析提问：把平台回答标注成观测字段（与人工录入同口径）。 */
export function buildParsePrompt(
  project: ProjectRow,
  question: QuestionRow,
  answer: string,
) {
  const { aliases, competitors } = brandProfile(project);
  return [
    '你是 GEO 分析的数据标注员。请阅读下面这段 AI 平台对某问题的回答，判断目标品牌在该回答中的表现，只输出一个 JSON 对象（不要解释、不要 markdown 代码块）。',
    `目标品牌：${project.brand}${aliases.length ? `（别名：${aliases.join('、')}，任一出现都算被提及）` : ''}`,
    competitors.length ? `竞品品牌：${competitors.join('、')}` : '',
    `问题：${question.text}`,
    `回答原文：\n${answer}`,
    '请输出这些字段：',
    '{"brand_mentioned": 0 或 1, "rank_position": 整数或 null, "sentiment": "正面"|"中性"|"负面", "citation_genre": "报告"|"官网"|"评测"|"百科"|"社区"|"无", "citation_domains": ["域名"], "excerpt": "回答中与目标品牌或竞品相关的原文（≤500 字）"}',
    '规则：品牌未被提及/推荐时 brand_mentioned=0、sentiment="未提及"、citation_genre="无"、rank_position=null；rank_position 只在回答明确按顺序列出品牌时填写；citation_genre 指回答引用的来源题材，没有引用填「无」；不要臆测。',
  ]
    .filter(Boolean)
    .join('\n');
}
export class GeoCollectionService {
  private stopping = false;
  private readonly active = new Map<
    number,
    { lease: RunLease; controller: AbortController }
  >();
  private runningTick?: Promise<unknown>;
  readonly workerStatus = {
    lastScheduledAt: null as string | null,
    active: 0,
    completedRounds: 0,
    failures: 0,
  };
  async stop(timeoutMs = 60000) {
    this.stopping = true;
    if (this.runningTick) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        this.runningTick.catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
      if (timer) clearTimeout(timer);
    }
    for (const { controller } of this.active.values()) controller.abort();
    // 让取消后的 finally 先清理心跳，避免断开数据库后继续续租。
    if (this.runningTick) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        this.runningTick.catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 2000);
        }),
      ]);
      if (timer) clearTimeout(timer);
    }
    await Promise.all(
      [...this.active.values()].map(({ lease }) =>
        this.prisma.geoCollectRun.updateMany({
          where: { id: lease.id, status: 'RUNNING', claimedBy: lease.token },
          data: {
            status: 'PENDING',
            claimedBy: '',
            lastError: 'Worker 停止，等待继续执行',
          },
        }),
      ),
    );
  }
  tick(now = new Date()) {
    if (this.stopping) return Promise.resolve({ skipped: '正在停止' });
    if (this.runningTick) return this.runningTick;
    this.workerStatus.lastScheduledAt = now.toISOString();
    const task = this.schedule(now).finally(() => {
      this.runningTick = undefined;
    });
    this.runningTick = task;
    return task;
  }

  private readonly logger = new Logger(GeoCollectionService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: GeoSettingsService,
    private readonly timing: { heartbeatMs?: number; itemGapMs?: number } = {},
  ) {}
  /* ------------------------------ 开关 ------------------------------ */
  /** 开关自动采集：开启即排本期任务（本周还有窗口时）；关闭则收掉未跑完的本期任务。 */
  async setEnabled(projectId: number, enabled: boolean, by: string) {
    await this.prisma.geoProject.update({
      where: { id: projectId },
      data: {
        autoCollect: enabled ? 1 : 0,
        autoCollectBy: by,
        autoCollectAt: new Date(),
      },
    });
    const now = new Date();
    const weekStart = weekStartOf(now);
    if (enabled) {
      const project = await this.prisma.geoProject.findUnique({
        where: { id: projectId },
      });
      if (project && nextWindowOf(now, weekStart)) {
        await this.planWeek(project, weekStart, now);
        // 本周内重开开关：把已取消的本期任务放回待跑（已采的项不重复采）
        await this.prisma.geoCollectRun.updateMany({
          where: { projectId, weekStart, status: 'CANCELLED' },
          data: {
            status: 'PENDING',
            claimedBy: '',
            lastError: '重新开启自动采集，本期继续',
          },
        });
      }
    } else {
      await this.prisma.geoCollectRun.updateMany({
        where: {
          projectId,
          status: { in: ['PENDING', 'RUNNING'] },
          weekStart: { gte: new Date(weekStart.getTime() - 6 * 86400000) },
        },
        data: {
          status: 'CANCELLED',
          claimedBy: '',
          lastError: '已关闭自动采集，本期不再继续',
        },
      });
    }
    return this.statusOf(projectId, now);
  }
  /** 用户端开关面板：开关态 + 本期任务进度 + 下一个窗口。 */
  async statusOf(projectId: number, now = new Date()) {
    const project = await this.prisma.geoProject.findUnique({
      where: { id: projectId },
    });
    const weekStart = weekStartOf(now);
    const runs = await this.prisma.geoCollectRun.findMany({
      where: { projectId },
      orderBy: { weekStart: 'desc' },
      take: 3,
    });
    const current = runs.find(
      (row) => row.weekStart.getTime() === weekStart.getTime(),
    );
    const questionCount = await this.prisma.geoQuestion.count({
      where: { projectId, status: 'ACTIVE' },
    });
    const platforms = await this.usablePlatforms(
      asArray(project?.platforms || []),
      project?.ownerUserId || '',
    );
    const window = nextWindowOf(now, weekStart);
    return {
      enabled: Number(project?.autoCollect || 0) === 1,
      updatedBy: project?.autoCollectBy || '',
      updatedAt: project?.autoCollectAt || null,
      weekStart,
      weekLabel: weekLabelOf(weekStart),
      windowStart: window?.start || null,
      windowEnd: window?.end || null,
      inWindow: isInWindow(now),
      questionCount,
      usablePlatforms: platforms.usable,
      skippedPlatforms: platforms.skipped,
      plannedPerRun: questionCount * platforms.usable.length,
      currentRun: current ? this.runView(current) : null,
      recentRuns: runs.map((row) => this.runView(row)),
    };
  }
  /** 管理端「每周采集任务量」：本周计划 / 实际完成（含顺延）与逐项目明细。 */
  async stats(now = new Date()) {
    const weekStart = weekStartOf(now);
    const runs = await this.prisma.geoCollectRun.findMany({
      where: { weekStart },
      orderBy: { projectId: 'asc' },
    });
    const projects = await this.prisma.geoProject.findMany({
      where: { id: { in: runs.map((row) => row.projectId) } },
    });
    const projectOf = new Map(projects.map((row) => [row.id, row]));
    const rows = runs.map((row) => {
      const project = projectOf.get(row.projectId);
      return {
        ...this.runView(row),
        brand: project?.brand || `项目 ${row.projectId}`,
        industry: project?.industry || '',
        enabled: Number(project?.autoCollect || 0) === 1,
      };
    });
    const sum = (key: 'planned' | 'done' | 'failed') =>
      rows.reduce((total, row) => total + row[key], 0);
    const window = nextWindowOf(now, weekStart);
    return {
      weekStart,
      weekLabel: weekLabelOf(weekStart),
      windowStart: window?.start || null,
      windowEnd: window?.end || null,
      inWindow: isInWindow(now),
      totals: {
        projects: rows.length,
        planned: sum('planned'),
        done: sum('done'),
        failed: sum('failed'),
        pending: sum('planned') - sum('done') - sum('failed'),
      },
      runs: rows,
    };
  }
  private runView(row: {
    id: number;
    projectId: number;
    weekStart: Date;
    periodLabel: string;
    status: string;
    planned: number;
    done: number;
    failed: number;
    batchId: number;
    startedAt: Date | null;
    finishedAt: Date | null;
    windowStart: Date | null;
    windowEnd: Date | null;
    lastError: string;
  }) {
    const pending = row.planned - row.done - row.failed;
    const deferred =
      pending > 0 &&
      row.status === 'PENDING' &&
      !!row.windowStart &&
      !!row.windowEnd;
    return {
      id: row.id,
      projectId: row.projectId,
      weekStart: row.weekStart,
      periodLabel: row.periodLabel,
      status: row.status,
      planned: row.planned,
      done: row.done,
      failed: row.failed,
      pending: pending > 0 ? pending : 0,
      deferred,
      batchId: row.batchId,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      windowStart: row.windowStart,
      windowEnd: row.windowEnd,
      lastError: row.lastError,
    };
  }
  /* ------------------------------ 排期 ------------------------------ */
  private async usablePlatforms(platforms: string[], ownerUserId: string) {
    const usable: string[] = [];
    const skipped: string[] = [];
    for (const platform of platforms) {
      const spec = providerOfPlatform(platform);
      if (!spec) {
        skipped.push(`${platform}（平台不存在）`);
        continue;
      }
      const resolved = await this.settings.resolve(ownerUserId, spec.code);
      if (resolved.apiKey && resolved.model) usable.push(platform);
      else {
        skipped.push(
          `${resolved.apiKey ? `${platform}（未填模型）` : `${platform}（未配 Key）`}`,
        );
      }
    }
    return { usable, skipped };
  }
  /** 为本期建任务与逐项明细（本期还没排过才建；并发触发时靠唯一键兜底）。 */
  private async planWeek(
    project: ProjectRow & {
      autoCollect?: number;
    },
    weekStart: Date,
    now: Date,
  ) {
    const exist = await this.prisma.geoCollectRun.findUnique({
      where: {
        projectId_weekStart: { projectId: project.id, weekStart },
      },
    });
    if (exist) return exist;
    const questions = await this.prisma.geoQuestion.findMany({
      where: { projectId: project.id, status: 'ACTIVE' },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    });
    const configured = asArray(project.platforms).filter((item) =>
      (GEO_PLATFORMS as readonly string[]).includes(item),
    );
    const { usable, skipped } = await this.usablePlatforms(
      configured,
      project.ownerUserId,
    );
    const label = weekLabelOf(weekStart);
    if (!questions.length || !usable.length) {
      const reason = !questions.length
        ? '本期未排期：项目没有启用中的监控问题'
        : `本期未排期：没有可用采集平台（${skipped.join('、') || '未配置监控平台'}）`;
      return this.prisma.geoCollectRun.create({
        data: {
          projectId: project.id,
          weekStart,
          periodLabel: label,
          status: 'DONE',
          planned: 0,
          finishedAt: now,
          lastError: reason,
        },
      });
    }
    try {
      // 任务与逐项明细同事务：明细写不进去就整体回滚，不留「有计划没明细」的空壳任务
      const run = await this.prisma.$transaction(async (tx) => {
        const created = await tx.geoCollectRun.create({
          data: {
            projectId: project.id,
            weekStart,
            periodLabel: label,
            planned: questions.length * usable.length,
            lastError: skipped.length
              ? `未纳入本期（${skipped.join('、')}）`
              : '',
          },
        });
        await tx.geoCollectItem.createMany({
          data: questions.flatMap((question) =>
            usable.map((platform) => ({
              runId: created.id,
              projectId: project.id,
              questionId: question.id,
              platform,
            })),
          ),
        });
        return created;
      });
      this.logger.log(
        `已排期 ${project.brand || project.id} ${label}：${questions.length} 问 × ${usable.length} 平台 = ${questions.length * usable.length} 项`,
      );
      return run;
    } catch (error) {
      // P2002：另一个实例刚排过同一期
      const raced = await this.prisma.geoCollectRun.findUnique({
        where: { projectId_weekStart: { projectId: project.id, weekStart } },
      });
      if (raced) return raced;
      this.logger.error(
        `排期失败：${project.brand || project.id} ${label}：${this.errorText(error)}`,
      );
      throw error;
    }
  }
  /** 每周滚动：本期没排过的排期；上一期没跑完的收口（新一期不叠加旧账）。 */
  async ensureWeekRuns(now: Date) {
    const weekStart = weekStartOf(now);
    await this.prisma.geoCollectRun.updateMany({
      where: {
        weekStart: { lt: weekStart },
        status: { in: ['PENDING', 'RUNNING'] },
      },
      data: {
        status: 'CLOSED',
        claimedBy: '',
        finishedAt: now,
        lastError: '新一期采集已排期，上一期未完成项不再继续',
      },
    });
    const projects = await this.prisma.geoProject.findMany({
      where: { autoCollect: 1, status: 'ACTIVE' },
    });
    for (const project of projects) {
      await this.planWeek(project, weekStart, now);
    }
  }
  /* ------------------------------ 执行 ------------------------------ */
  /** 调度入口：窗口外只做超时实例的复位；窗口内排期 + 逐个任务执行。 */
  private async schedule(now: Date) {
    await this.ensureWeekRuns(now);
    await this.releaseStale(now);
    if (!isInWindow(now)) return { skipped: '窗口外' };
    const weekStart = weekStartOf(now);
    const runs = await this.prisma.geoCollectRun.findMany({
      where: { weekStart, status: { in: ['PENDING', 'RUNNING'] } },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    });
    let cursor = 0;
    const runner = async () => {
      while (!this.stopping && cursor < runs.length) {
        const run = runs[cursor++];
        const window = nextWindowOf(new Date(), weekStart);
        if (!window || Date.now() >= window.end.getTime()) break;
        try {
          await this.executeRun(run.id, window);
        } catch {
          this.logger.warn({ event: 'geo_round_failed', runId: run.id });
        }
      }
    };
    await Promise.all([runner(), runner()]);
    return { runs: runs.length };
  }
  /** 心跳过期的执行实例所属任务放回 PENDING，等待窗口内重试。 */
  private async releaseStale(now: Date) {
    await this.prisma.geoCollectRun.updateMany({
      where: {
        status: 'RUNNING',
        OR: [
          { heartbeatAt: { lt: new Date(now.getTime() - STALE_HEARTBEAT_MS) } },
          { heartbeatAt: null },
        ],
      },
      data: {
        status: 'PENDING',
        claimedBy: '',
        lastError: '上一执行实例中断（心跳过期），等待窗口内重试',
      },
    });
  }
  /**
   * 先条件更新并锁住任务行，再在同一短事务里写明细/结果。
   * 接管、取消与本次写入由 PG 行锁串行化；外部模型调用始终放在事务外。
   * 过期令牌不能续命，即使尚无其它实例接管，也必须重新抢占。
   */
  private async withLease<T>(
    lease: RunLease,
    write: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const owned = await tx.geoCollectRun.updateMany({
        where: {
          id: lease.id,
          status: 'RUNNING',
          claimedBy: lease.token,
          heartbeatAt: {
            gte: new Date(now.getTime() - STALE_HEARTBEAT_MS),
          },
        },
        data: { heartbeatAt: now },
      });
      if (!owned.count) throw new GeoCollectionLeaseLostError(lease.id);
      return write(tx);
    });
  }
  private async executeRun(
    runId: number,
    window: {
      start: Date;
      end: Date;
    },
  ) {
    const now = new Date();
    const lease: RunLease = { id: runId, token: randomUUID() };
    const claimed = await this.prisma.geoCollectRun.updateMany({
      where: {
        id: runId,
        OR: [
          { status: 'PENDING' },
          {
            status: 'RUNNING',
            OR: [
              {
                heartbeatAt: {
                  lt: new Date(now.getTime() - STALE_HEARTBEAT_MS),
                },
              },
              { heartbeatAt: null },
            ],
          },
        ],
      },
      data: {
        status: 'RUNNING',
        claimedBy: lease.token,
        heartbeatAt: now,
        windowStart: window.start,
        windowEnd: window.end,
      },
    });
    if (!claimed.count) return;
    const controller = new AbortController();
    this.active.set(runId, { lease, controller });
    this.workerStatus.active = this.active.size;
    let heartbeating = false;
    const heartbeat = setInterval(() => {
      if (heartbeating) return;
      heartbeating = true;
      void this.withLease(lease, () => Promise.resolve())
        .catch(() => controller.abort())
        .finally(() => {
          heartbeating = false;
        });
    }, this.timing.heartbeatMs ?? 30000);
    try {
      await this.executeClaimedRun(lease, window);
      this.workerStatus.completedRounds++;
    } catch (error) {
      if (controller.signal.aborted || this.stopping) return;
      this.workerStatus.failures++;
      if (!(error instanceof GeoCollectionLeaseLostError)) throw error;
      this.logger.warn(`${error.message}，停止当前执行`);
    } finally {
      clearInterval(heartbeat);
      try {
        await this.prisma.geoCollectRun.updateMany({
          where: { id: lease.id, status: 'RUNNING', claimedBy: lease.token },
          data: { status: 'PENDING', claimedBy: '' },
        });
      } finally {
        this.active.delete(runId);
        this.workerStatus.active = this.active.size;
      }
    }
  }
  private async executeClaimedRun(
    lease: RunLease,
    window: {
      start: Date;
      end: Date;
    },
  ) {
    const run = await this.withLease(lease, async (tx) => {
      await tx.geoCollectRun.updateMany({
        where: { id: lease.id, startedAt: null },
        data: { startedAt: new Date() },
      });
      return tx.geoCollectRun.findUniqueOrThrow({ where: { id: lease.id } });
    });
    const project = await this.prisma.geoProject.findUnique({
      where: { id: run.projectId },
    });
    if (!project) {
      await this.finish(lease, { reason: '项目已删除，本期终止' });
      return;
    }
    const items = await this.prisma.geoCollectItem.findMany({
      where: {
        runId: lease.id,
        status: 'PENDING',
        OR: [
          { attempts: 0 },
          { updatedAt: { lte: new Date(Date.now() - RETRY_COOLDOWN_MS) } },
        ],
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: 5,
    });
    const questions = new Map<number, QuestionRow>(
      (
        await this.prisma.geoQuestion.findMany({
          where: {
            projectId: run.projectId,
            id: { in: items.map((item) => item.questionId) },
          },
        })
      ).map((row) => [row.id, row] as const),
    );
    const skippedPlatforms = new Set<string>();
    let deferred = false;
    const errors: string[] = [];
    let processed = 0;
    for (const item of items) {
      if (this.stopping || processed >= 5) break;
      if (Date.now() >= window.end.getTime()) {
        deferred = true;
        break;
      }
      if (skippedPlatforms.has(item.platform)) continue;
      if (
        item.attempts > 0 &&
        Date.now() - item.updatedAt.getTime() < RETRY_COOLDOWN_MS
      ) {
        deferred = true;
        continue;
      }
      const question = questions.get(item.questionId);
      if (!question) {
        await this.withLease(lease, (tx) =>
          tx.geoCollectItem.updateMany({
            where: { id: item.id, runId: lease.id, status: 'PENDING' },
            data: { status: 'FAILED', error: '监控问题已被删除' },
          }),
        );
        errors.push(`问题 #${item.questionId} 已被删除`);
        continue;
      }
      processed++;
      const result = await this.attemptItem(
        {
          ...lease,
          periodLabel: run.periodLabel,
          projectId: run.projectId,
        },
        item.id,
        project,
        question,
      );
      if (result.error) errors.push(result.error);
      if (result.skipped) skippedPlatforms.add(item.platform);
      const signal = this.active.get(lease.id)?.controller.signal;
      await pause(this.timing.itemGapMs ?? ITEM_GAP_MS, undefined, {
        signal,
      }).catch(() => undefined);
    }
    await this.finish(lease, { deferred, errors }, window);
  }
  /** 单项执行：提问（原始回答留档）→ 解析 → 落真实观测。 */
  private async attemptItem(
    run: ClaimedRun,
    itemId: number,
    project: ProjectRow,
    question: QuestionRow,
  ): Promise<{
    error?: string;
    skipped?: boolean;
  }> {
    // 在持有当前执行权时重新读取：重放已完成项直接跳过，不再次创建观测。
    const item = await this.withLease(run, (tx) =>
      tx.geoCollectItem.findFirst({
        where: { id: itemId, runId: run.id, status: 'PENDING' },
      }),
    );
    if (!item) return {};
    const spec = providerOfPlatform(item.platform);
    if (!spec) {
      await this.failItem(run, item.id, `未知采集平台「${item.platform}」`);
      return { error: `${item.platform}：平台不存在` };
    }
    let raw = text(item.rawAnswer).trim();
    let model = text(item.modelVersion);
    if (!raw) {
      const {
        apiKey,
        model: configured,
        baseUrl,
      } = await this.settings.resolve(project.ownerUserId, spec.code);
      if (!apiKey || !configured) {
        // 配置缺失属「可修复」，不计重试次数，本窗口跳过该平台
        await this.withLease(run, (tx) =>
          tx.geoCollectItem.updateMany({
            where: { id: item.id, runId: run.id, status: 'PENDING' },
            data: {
              error: `${spec.label} 未配置${apiKey ? '模型' : ' API Key'}，本窗口跳过`,
            },
          }),
        );
        return {
          skipped: true,
          error: `${item.platform}：未配置${apiKey ? '模型' : ' API Key'}`,
        };
      }
      model = configured;
      await this.withLease(run, () => Promise.resolve());
      try {
        const asked = await geoChat({
          baseUrl,
          apiKey,
          model: configured,
          api: spec.api,
          prompt: buildAskPrompt(project, question),
          maxTokens: ASK_MAX_TOKENS,
          timeoutMs: ASK_TIMEOUT_MS,
          signal: this.active.get(run.id)?.controller.signal,
          platform: spec.code,
        });
        raw = asked.reply;
        if (!raw) throw new Error('平台返回了空回答');
      } catch (error) {
        if (this.active.get(run.id)?.controller.signal.aborted) throw error;
        await this.failItem(run, item.id, this.errorText(error));
        return { error: `${item.platform}：${this.errorText(error)}` };
      }
      // 先留档原始回答：解析失败时复用重试，不重复计费
      const saved = await this.withLease(run, (tx) =>
        tx.geoCollectItem.updateMany({
          where: { id: item.id, runId: run.id, status: 'PENDING' },
          data: { rawAnswer: raw, answeredAt: new Date(), modelVersion: model },
        }),
      );
      if (!saved.count) return {};
    }
    await this.withLease(run, () => Promise.resolve());
    let parsed: Record<string, unknown>;
    try {
      parsed = await this.parseAnswer(
        project,
        question,
        raw,
        this.active.get(run.id)?.controller.signal,
      );
    } catch (error) {
      if (this.active.get(run.id)?.controller.signal.aborted) throw error;
      await this.failItem(run, item.id, this.errorText(error));
      return { error: `${item.platform} 解析失败：${this.errorText(error)}` };
    }
    const observationId = await this.withLease(run, async (tx) => {
      const pending = await tx.geoCollectItem.findFirst({
        where: { id: item.id, runId: run.id, status: 'PENDING' },
      });
      if (!pending) return null;
      // 首次批次、观测与 DONE 同事务：任一步失败都回滚，重试不会留下重复观测或空批次。
      const batchId = await this.openBatch(tx, run);
      const observation = await tx.geoObservation.create({
        data: {
          batchId,
          questionId: question.id,
          platform: item.platform,
          ...normalizeObservation({
            brand_mentioned: parsed.brand_mentioned ?? parsed.brandMentioned,
            rank_position: parsed.rank_position ?? parsed.rankPosition,
            sentiment: parsed.sentiment,
            citation_genre: parsed.citation_genre ?? parsed.citationGenre,
            citation_domains: Array.isArray(parsed.citation_domains)
              ? parsed.citation_domains.map((row) => String(row)).join(', ')
              : (parsed.citation_domains ?? parsed.citationDomains),
            answer_excerpt: parsed.excerpt ?? parsed.answer_excerpt,
            model_version: model,
          }),
        },
      });
      await tx.geoCollectItem.update({
        where: { id: item.id },
        data: {
          status: 'DONE',
          attempts: { increment: 1 },
          error: '',
          observationId: observation.id,
          modelVersion: model,
          answeredAt: new Date(),
        },
      });
      return observation.id;
    });
    if (observationId === null) return {};
    this.logger.log(
      `${project.brand} · ${question.text.slice(0, 18)} @ ${item.platform} 已落观测 #${observationId}`,
    );
    return {};
  }
  /** 用豆包把平台回答解析成观测字段（无单一模型能代采，但解析统一走豆包）。 */
  private async parseAnswer(
    project: ProjectRow,
    question: QuestionRow,
    answer: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const spec = GEO_PROVIDERS.find((item) => item.code === 'doubao')!;
    const { apiKey, model, baseUrl } = await this.settings.resolve(
      project.ownerUserId,
      'doubao',
    );
    if (!apiKey || !model) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `解析模型未配置（${spec.label} 的 API Key / 模型），请在「营销工具 → GEO 分析 → 采集平台 Key」补齐`,
      );
    }
    const parsed = await geoChat({
      baseUrl,
      apiKey,
      model,
      prompt: buildParsePrompt(project, question, answer),
      maxTokens: PARSE_MAX_TOKENS,
      timeoutMs: PARSE_TIMEOUT_MS,
      signal,
      platform: 'doubao',
    });
    const json = extractJson(parsed.reply);
    if (!json) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `解析结果不是 JSON：${parsed.reply.slice(0, 120)}`,
      );
    }
    return json;
  }
  private async failItem(lease: RunLease, itemId: number, error: string) {
    await this.withLease(lease, async (tx) => {
      const item = await tx.geoCollectItem.findFirst({
        where: { id: itemId, runId: lease.id, status: 'PENDING' },
      });
      if (!item) return;
      const attempts = item.attempts + 1;
      await tx.geoCollectItem.update({
        where: { id: item.id },
        data: {
          status: attempts >= GEO_COLLECT_MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
          attempts,
          error: error.slice(0, 500),
        },
      });
    });
  }
  private errorText(error: unknown) {
    if (error instanceof BusinessException) return error.message;
    return (error as Error)?.message || '未知错误';
  }
  /** 首个成功项时才建自动批次（全失败不留空批次），通道 C / 真实数据。 */
  private async openBatch(tx: Prisma.TransactionClient, run: ClaimedRun) {
    const current = await tx.geoCollectRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    if (current.batchId) return current.batchId;
    const platforms = await tx.geoCollectItem.findMany({
      where: { runId: run.id },
      select: { platform: true },
      distinct: ['platform'],
    });
    const batch = await tx.geoBatch.create({
      data: {
        projectId: run.projectId,
        periodLabel: run.periodLabel,
        channel: 'C',
        dataNature: 'real',
        platforms: platforms.map((row) => row.platform),
        note: '系统自动采集（每周日凌晨窗口，未跑完顺延次日；观测可人工修订）',
        createdBy: 'system:geo-collect',
      },
    });
    await tx.geoCollectRun.update({
      where: { id: run.id },
      data: { batchId: batch.id },
    });
    return batch.id;
  }
  /** 收口：按明细实际状态回写计数；还剩待跑项则退回 PENDING 等下个窗口。 */
  private async finish(
    lease: RunLease,
    summary: {
      deferred?: boolean;
      reason?: string;
      errors?: string[];
    } = {},
    window?: {
      start: Date;
      end: Date;
    },
  ) {
    const errors = summary.errors || [];
    const { done, failed, pending } = await this.withLease(
      lease,
      async (tx) => {
        const [done, failed, pending] = await Promise.all([
          tx.geoCollectItem.count({
            where: { runId: lease.id, status: 'DONE' },
          }),
          tx.geoCollectItem.count({
            where: { runId: lease.id, status: 'FAILED' },
          }),
          tx.geoCollectItem.count({
            where: { runId: lease.id, status: 'PENDING' },
          }),
        ]);
        const lastError = summary.deferred
          ? `窗口 ${window ? `${hhmm(window.start)}–${hhmm(window.end)}` : ''} 结束，剩 ${pending} 项顺延到次日同窗口继续${errors.length ? `；最近失败：${errors[0]}` : ''}`
          : summary.reason ||
            (failed
              ? `${failed} 项重试 ${GEO_COLLECT_MAX_ATTEMPTS} 次仍失败，最近错误：${errors[0] || '见逐项错误'}`
              : errors[0] || '');
        await tx.geoCollectRun.update({
          where: { id: lease.id },
          data: {
            done,
            failed,
            status: pending > 0 ? 'PENDING' : 'DONE',
            finishedAt: pending > 0 ? null : new Date(),
            claimedBy: '',
            lastError: lastError.slice(0, 500),
          },
        });
        return { done, failed, pending };
      },
    );
    this.logger.log(
      `本期收口：完成 ${done} / 失败 ${failed} / 待跑 ${pending}${summary.deferred ? '（顺延次日）' : ''}`,
    );
  }
}
