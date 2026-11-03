import { text } from '../common/api';
import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { GeoCollectionService } from './geo-collection.service';
import { GeoSettingsService } from './geo-settings.service';
import {
  GEO_CITATION_GENRES,
  GEO_GAP_TYPES,
  GEO_PLATFORMS,
  GEO_SENTIMENTS,
  normalizeObservation,
} from './geo-shared';
/** 问题库配比：起步 30 条（12 品类 / 8 决策 / 8 对比 / 2 品牌），占比 40/25/25/10。 */
export const GEO_QUESTION_TYPES = [
  { type: '品类词', target: 12, share: 40 },
  { type: '决策词', target: 8, share: 25 },
  { type: '竞品对比词', target: 8, share: 25 },
  { type: '品牌词', target: 2, share: 10 },
] as const;
/** 引用质量得分权重：报告/官网/百科=100，评测/社区=60，无引用=30，未知=50。 */
const CITATION_WEIGHT: Record<string, number> = {
  报告: 100,
  官网: 100,
  百科: 100,
  评测: 60,
  社区: 60,
  无: 30,
};
const CITATION_WEIGHT_UNKNOWN = 50;
/** 0-1 比率 → 0-100 得分（分段线性，与 geo_metrics.py score_bucket 同口径）。 */
export function scoreBucket(rate: number) {
  if (rate >= 0.6) return 100;
  if (rate >= 0.4) return 60 + ((rate - 0.4) / 0.2) * 39;
  if (rate >= 0.15) return 30 + ((rate - 0.15) / 0.25) * 29;
  return (rate / 0.15) * 30;
}
function exposureTier(score: number) {
  if (score >= 80) return '优';
  if (score >= 60) return '良';
  if (score >= 40) return '中';
  return '差';
}
const round1 = (value: number) => Math.round(value * 10) / 10;
const round3 = (value: number) => Math.round(value * 1000) / 1000;
type ObservationRow = {
  id: number;
  questionId: number;
  platform: string;
  brandMentioned: number;
  rankPosition: number | null;
  sentiment: string;
  citationGenre: string;
  answerExcerpt: string;
};
type Metrics = {
  total: number;
  mentioned: number;
  listed: number;
  negative: number;
  mentionRate: number;
  listRate: number;
  avgRank: number | null;
  negativeRate: number;
  citationQuality: number;
  exposureScore: number;
  tier: string;
};
export class GeoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly collection: GeoCollectionService,
    private readonly settings: GeoSettingsService,
  ) {}
  /** 前端选项（平台/问题类型配比/情感/引用题材/缺口类型），可用平台按当前账号自己的 Key 判定。 */
  async meta(user: CurrentUser) {
    return {
      platforms: [...GEO_PLATFORMS],
      // 只有当前账号在「营销工具」配过 Key 与模型的平台才可选（未配置即不可用，不共享他人 Key）
      availablePlatforms: await this.settings.availablePlatforms(user.userId),
      questionTypes: GEO_QUESTION_TYPES.map((item) => ({ ...item })),
      sentiments: [...GEO_SENTIMENTS],
      citationGenres: [...GEO_CITATION_GENRES],
      gapTypes: [...GEO_GAP_TYPES],
    };
  }
  /* ------------------------------ 项目 ------------------------------ */
  async listProjects(user: CurrentUser) {
    const rows = await this.prisma.geoProject.findMany({
      where: await this.scope(user),
      orderBy: { id: 'desc' },
    });
    return rows.map((row) => ({
      ...row,
      competitors: asArray(row.competitors),
      platforms: asArray(row.platforms),
      brandAliasList: row.brandAliases
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    }));
  }
  async createProject(user: CurrentUser, body: Record<string, unknown>) {
    const brand = text(body.brand).trim();
    if (!brand) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写品牌名称');
    }
    const isAdmin = this.identity.isPlatformAdmin(user);
    const eps = isAdmin ? [] : await this.identity.myEnterprises(user.userId);
    const enterprise = eps[0] || null;
    const row = await this.prisma.geoProject.create({
      data: {
        ownerUserId: user.userId,
        enterpriseId: enterprise?.id || Number(body.enterprise_id || 0),
        enterpriseUserId: enterprise?.userId || '',
        brand,
        brandAliases: text(body.brand_aliases),
        industry: text(body.industry),
        competitors: asStringList(body.competitors),
        platforms: asStringList(body.platforms).length
          ? asStringList(body.platforms)
          : [...GEO_PLATFORMS],
        note: text(body.note),
      },
    });
    return row;
  }
  async updateProject(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown>,
  ) {
    await this.requireProject(user, id);
    const data: Record<string, unknown> = {};
    for (const [key, column] of Object.entries({
      brand: 'brand',
      brand_aliases: 'brandAliases',
      industry: 'industry',
      note: 'note',
      status: 'status',
    })) {
      if (body[key] !== undefined) data[column] = text(body[key]);
    }
    if (body.competitors !== undefined)
      data.competitors = asStringList(body.competitors);
    if (body.platforms !== undefined)
      data.platforms = asStringList(body.platforms);
    return this.prisma.geoProject.update({ where: { id }, data });
  }
  async removeProject(user: CurrentUser, id: number) {
    await this.requireProject(user, id);
    const batches = await this.prisma.geoBatch.findMany({
      where: { projectId: id },
      select: { id: true },
    });
    await this.prisma.geoObservation.deleteMany({
      where: { batchId: { in: batches.map((item) => item.id) } },
    });
    await this.prisma.geoBatch.deleteMany({ where: { projectId: id } });
    await this.prisma.geoQuestion.deleteMany({ where: { projectId: id } });
    await this.prisma.geoTopic.deleteMany({ where: { projectId: id } });
    await this.prisma.geoProject.delete({ where: { id } });
    return { id };
  }
  /* ---------------------------- 自动采集 ---------------------------- */
  /** 自动采集开关状态：开关态 + 本期任务进度 + 下一个窗口（周日 02:00–06:00）。 */
  async autoCollectStatus(user: CurrentUser, projectId: number) {
    await this.requireProject(user, projectId);
    return this.collection.statusOf(projectId);
  }
  /** 开关自动采集：开启即排本期任务；关闭收掉未跑完的本期任务（已采观测保留）。 */
  async setAutoCollect(
    user: CurrentUser,
    projectId: number,
    body: Record<string, unknown>,
  ) {
    await this.requireProject(user, projectId);
    const enabled =
      body.enabled === true ||
      text(body.enabled) === 'true' ||
      Number(body.enabled || 0) === 1;
    return this.collection.setEnabled(
      projectId,
      enabled,
      user.username || user.userId,
    );
  }
  /* ---------------------------- 监控问题库 ---------------------------- */
  async listQuestions(user: CurrentUser, projectId: number) {
    await this.requireProject(user, projectId);
    return this.prisma.geoQuestion.findMany({
      where: { projectId },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    });
  }
  async saveQuestion(
    user: CurrentUser,
    projectId: number,
    body: Record<string, unknown>,
    id = 0,
  ) {
    await this.requireProject(user, projectId);
    const exist = id
      ? await this.prisma.geoQuestion.findUnique({ where: { id } })
      : null;
    if (id && (!exist || exist.projectId !== projectId)) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '监控问题不存在');
    }
    // PATCH 支持部分字段：未传的键沿用原值（如仅切换「启用/淘汰」）
    const merged = {
      text: body.text === undefined ? exist?.text || '' : text(body.text),
      type: body.type === undefined ? exist?.type || '品类词' : text(body.type),
      scenario:
        body.scenario === undefined
          ? exist?.scenario || ''
          : text(body.scenario),
      expectedAnswerForm:
        body.expected_answer_form === undefined
          ? exist?.expectedAnswerForm || ''
          : text(body.expected_answer_form),
      priority:
        body.priority === undefined
          ? exist?.priority || 'P1'
          : text(body.priority),
      seq: body.seq === undefined ? exist?.seq || '' : text(body.seq),
      status:
        body.status === undefined
          ? exist?.status || 'ACTIVE'
          : text(body.status),
    };
    const question = merged.text.trim();
    if (!question) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写监控问题');
    }
    const payload = {
      text: question,
      type: GEO_QUESTION_TYPES.some((item) => item.type === merged.type)
        ? merged.type
        : '品类词',
      scenario: merged.scenario,
      expectedAnswerForm: merged.expectedAnswerForm,
      priority: ['P0', 'P1', 'P2'].includes(merged.priority)
        ? merged.priority
        : 'P1',
      seq: merged.seq,
      status: ['ACTIVE', 'RETIRED'].includes(merged.status)
        ? merged.status
        : 'ACTIVE',
    };
    if (id) {
      return this.prisma.geoQuestion.update({ where: { id }, data: payload });
    }
    return this.prisma.geoQuestion.create({ data: { projectId, ...payload } });
  }
  async removeQuestion(user: CurrentUser, id: number) {
    const row = await this.prisma.geoQuestion.findUnique({ where: { id } });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '监控问题不存在');
    await this.requireProject(user, row.projectId);
    await this.prisma.geoObservation.deleteMany({ where: { questionId: id } });
    await this.prisma.geoQuestion.delete({ where: { id } });
    return { id };
  }
  /* ----------------------------- 采集批次 ----------------------------- */
  async listBatches(user: CurrentUser, projectId: number) {
    await this.requireProject(user, projectId);
    const rows = await this.prisma.geoBatch.findMany({
      where: { projectId },
      orderBy: { id: 'desc' },
    });
    const counts = await this.prisma.geoObservation.groupBy({
      by: ['batchId'],
      where: { batchId: { in: rows.map((item) => item.id) } },
      _count: { _all: true },
    });
    return rows.map((row) => ({
      ...row,
      platforms: asArray(row.platforms),
      observationCount:
        counts.find((item) => item.batchId === row.id)?._count._all || 0,
    }));
  }
  async saveBatch(
    user: CurrentUser,
    projectId: number,
    body: Record<string, unknown>,
    id = 0,
  ) {
    await this.requireProject(user, projectId);
    const periodLabel = text(body.period_label).trim();
    if (!periodLabel) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写采集周期（如 2026-W39 / 2026-09）',
      );
    }
    const project = await this.prisma.geoProject.findUnique({
      where: { id: projectId },
    });
    const payload = {
      periodLabel,
      channel: ['B', 'C'].includes(text(body.channel))
        ? text(body.channel)
        : 'A',
      dataNature: text(body.data_nature) === 'real' ? 'real' : 'simulated',
      platforms: asStringList(body.platforms).length
        ? asStringList(body.platforms)
        : asArray(project?.platforms || []),
      note: text(body.note),
    };
    if (id) {
      const exist = await this.prisma.geoBatch.findUnique({ where: { id } });
      if (!exist || exist.projectId !== projectId) {
        throw new BusinessException(ErrorCode.NOT_FOUND, '采集批次不存在');
      }
      return this.prisma.geoBatch.update({ where: { id }, data: payload });
    }
    return this.prisma.geoBatch.create({
      data: { projectId, createdBy: user.userId, ...payload },
    });
  }
  async removeBatch(user: CurrentUser, id: number) {
    const row = await this.prisma.geoBatch.findUnique({ where: { id } });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '采集批次不存在');
    await this.requireProject(user, row.projectId);
    await this.prisma.geoObservation.deleteMany({ where: { batchId: id } });
    await this.prisma.geoBatch.delete({ where: { id } });
    return { id };
  }
  /* ----------------------------- 观测记录 ----------------------------- */
  async listObservations(user: CurrentUser, batchId: number) {
    const batch = await this.requireBatch(user, batchId);
    const rows = await this.prisma.geoObservation.findMany({
      where: { batchId },
      orderBy: { id: 'asc' },
    });
    const questions = await this.prisma.geoQuestion.findMany({
      where: { projectId: batch.projectId },
    });
    return rows.map((row) => ({
      ...row,
      questionText:
        questions.find((item) => item.id === row.questionId)?.text || '',
      questionType:
        questions.find((item) => item.id === row.questionId)?.type || '',
    }));
  }
  async saveObservation(
    user: CurrentUser,
    batchId: number,
    body: Record<string, unknown>,
    id = 0,
  ) {
    const batch = await this.requireBatch(user, batchId);
    const platform = text(body.platform);
    if (!GEO_PLATFORMS.includes(platform as (typeof GEO_PLATFORMS)[number])) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择监控平台');
    }
    const questionId = Number(body.question_id || 0);
    const question = questionId
      ? await this.prisma.geoQuestion.findUnique({ where: { id: questionId } })
      : null;
    if (!question || question.projectId !== batch.projectId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择本项目的监控问题',
      );
    }
    if (!id) {
      // 同一批次内「问题 × 平台」只应有一条观测，重复录入会把指标重复计数
      const dup = await this.prisma.geoObservation.findFirst({
        where: { batchId, questionId, platform },
      });
      if (dup) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `「${question.text}」在 ${platform} 已录过观测，请直接编辑那条记录`,
        );
      }
    }
    const payload = {
      platform,
      questionId,
      ...normalizeObservation(body),
    };
    if (id) {
      const exist = await this.prisma.geoObservation.findUnique({
        where: { id },
      });
      if (!exist || exist.batchId !== batchId) {
        throw new BusinessException(ErrorCode.NOT_FOUND, '观测记录不存在');
      }
      return this.prisma.geoObservation.update({
        where: { id },
        data: payload,
      });
    }
    return this.prisma.geoObservation.create({
      data: { batchId, ...payload },
    });
  }
  async removeObservation(user: CurrentUser, id: number) {
    const row = await this.prisma.geoObservation.findUnique({ where: { id } });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '观测记录不存在');
    await this.requireBatch(user, row.batchId);
    await this.prisma.geoObservation.delete({ where: { id } });
    return { id };
  }
  /* ------------------------------ 报告 ------------------------------ */
  /**
   * 效果报告（对齐 geo 技能包报告模板 §1-§6）：
   * 指标按 geo_metrics.py 口径计算；模拟数据在报告内明确标注。
   */
  async report(user: CurrentUser, projectId: number, batchId = 0) {
    const project = await this.requireProject(user, projectId);
    const batches = await this.prisma.geoBatch.findMany({
      where: { projectId },
      orderBy: { id: 'desc' },
    });
    const questions = await this.prisma.geoQuestion.findMany({
      where: { projectId },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    });
    const batchCounts = await this.prisma.geoObservation.groupBy({
      by: ['batchId'],
      where: { batchId: { in: batches.map((item) => item.id) } },
      _count: { _all: true },
    });
    const countOf = (id: number) =>
      batchCounts.find((row) => row.batchId === id)?._count._all || 0;
    // 默认报最新「有观测」的批次：刚建好还没录入的空批次不把报告清零
    const filled = batches.filter((item) => countOf(item.id) > 0);
    const current =
      batches.find((item) => item.id === batchId) ||
      filled[0] ||
      batches[0] ||
      null;
    const prev = current
      ? filled.find((item) => item.id < current.id) || null
      : null;
    const base = {
      project: {
        ...project,
        competitors: asArray(project.competitors),
        platforms: asArray(project.platforms),
        brandAliasList: project.brandAliases
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      },
      questions,
      batches: batches.map((item) => ({
        ...item,
        platforms: asArray(item.platforms),
        observationCount: countOf(item.id),
      })),
      current,
      baseline: batches.length ? batches[batches.length - 1] : null,
    };
    if (!current) {
      return {
        ...base,
        metrics: null,
        prevMetrics: null,
        platforms: [],
        competitors: [],
        gaps: [],
        actions: [],
        summary: [],
      };
    }
    const rows = (await this.prisma.geoObservation.findMany({
      where: { batchId: current.id },
      orderBy: { id: 'asc' },
    })) as ObservationRow[];
    const prevRows = prev
      ? ((await this.prisma.geoObservation.findMany({
          where: { batchId: prev.id },
        })) as ObservationRow[])
      : [];
    const metrics = computeMetrics(rows);
    const prevMetrics = prevRows.length ? computeMetrics(prevRows) : null;
    // §3a 分平台摘要（批次配置的平台 ∪ 观测实际出现的平台，保证分平台合计＝总数）
    const platformRows = [
      ...new Set([
        ...asArray(current.platforms),
        ...rows.map((item) => item.platform),
      ]),
    ].map((platform) => {
      const own = rows.filter((item) => item.platform === platform);
      const ownMetrics = own.length ? computeMetrics(own) : null;
      const counts = new Map<string, number>();
      for (const item of own) {
        if (!item.citationGenre || item.citationGenre === '无') continue;
        counts.set(
          item.citationGenre,
          (counts.get(item.citationGenre) || 0) + 1,
        );
      }
      const top =
        [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '无引用';
      return {
        platform,
        total: own.length,
        mentioned: ownMetrics?.mentioned || 0,
        listed: ownMetrics?.listed || 0,
        avgRank: ownMetrics?.avgRank ?? null,
        topCitation: own.length ? top : '—',
        tip: current.dataNature === 'simulated' ? '模拟数据' : '',
      };
    });
    // §4 竞品对比：提及率按「回答摘录中出现竞品名」匹配，其余指标需采集时记录竞品排名
    const aliases = [
      project.brand,
      ...project.brandAliases
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ].filter(Boolean);
    const competitorRows = asArray(project.competitors).map((name) => {
      const hit = rows.filter((item) =>
        String(item.answerExcerpt || '').includes(String(name)),
      ).length;
      const competitorOwn = rows.filter(
        (item) =>
          String(item.answerExcerpt || '').includes(String(name)) &&
          !aliases.some((alias) =>
            String(item.answerExcerpt || '').includes(alias),
          ),
      ).length;
      return {
        name: String(name),
        mentionRate: rows.length ? round1((hit / rows.length) * 100) : 0,
        // 仅未点名我方而点名竞品 = 竞品覆盖点（我方缺席）
        coverGap: competitorOwn,
        listRate: null,
        avgRank: null,
        exposureScore: null,
      };
    });
    // §5 可见度缺口与机会点（只对「启用中」的问题生成：淘汰的问题不再报缺口）
    const byQuestion = new Map<number, ObservationRow[]>();
    for (const row of rows) {
      const list = byQuestion.get(row.questionId) || [];
      list.push(row);
      byQuestion.set(row.questionId, list);
    }
    const competitorNames = asArray(project.competitors);
    const gaps = questions
      .filter((question) => question.status === 'ACTIVE')
      .map((question) => {
        const own = byQuestion.get(question.id) || [];
        if (!own.length) return null;
        const mentioned = own.filter((item) => item.brandMentioned === 1);
        const cited = mentioned.filter((item) => item.citationGenre !== '无');
        const negative = mentioned.filter((item) => item.sentiment === '负面');
        const ranks = mentioned
          .map((item) => item.rankPosition || 0)
          .filter((item) => item > 0);
        const rivals = competitorNames.filter((name) =>
          own.some((item) =>
            String(item.answerExcerpt || '').includes(String(name)),
          ),
        );
        let gapType = '';
        let detail = '';
        if (negative.length) {
          gapType = '品牌被错误描述点';
          detail = `${negative.length} 条回答出现负面描述（P0 修复级）`;
        } else if (!mentioned.length && rivals.length) {
          gapType = '竞品覆盖点';
          detail = `我方未被点名，${rivals.join(' / ')} 被回答提及`;
        } else if (!mentioned.length) {
          gapType = '引用真空点';
          detail = `${own.length} 个平台均未点名品牌`;
        } else if (!cited.length) {
          gapType = '弱覆盖点';
          detail = '被点名但无任何引用依据';
        } else if (ranks.length && Math.min(...ranks) > 3) {
          gapType = '名次缺口';
          detail = `已上榜但最好名次为第 ${Math.min(...ranks)} 位`;
        }
        if (!gapType) return null;
        return {
          questionId: question.id,
          type: question.type,
          priority: question.priority,
          text: question.text,
          gapType,
          detail,
          platforms: own.map((item) => item.platform),
          suggestForm:
            question.expectedAnswerForm || suggestForm(question.type),
        };
      })
      .filter((item): item is NonNullable<typeof item> => !!item)
      .sort((a, b) => a.priority.localeCompare(b.priority));
    const actions = buildActions(gaps, metrics, current.dataNature);
    const summary = [
      `本期（${current.periodLabel}）共采集 ${metrics.total} 条回答，品牌被点名 ${metrics.mentioned} 条（提及率 ${pct(metrics.mentionRate)}），上榜 ${metrics.listed} 条（上榜率 ${pct(metrics.listRate)}）${metrics.avgRank === null ? '，无上榜样本不计算平均排名' : `，平均排名第 ${round1(metrics.avgRank)} 位`}。`,
      `曝光效果分数 ${metrics.exposureScore} 分（${metrics.tier}），${metrics.negative ? `存在 ${metrics.negative} 条负面描述需 P0 修复；` : ''}引用质量得分 ${round1(metrics.citationQuality)} 分，主要缺口为 ${gaps.length ? [...new Set(gaps.map((item) => item.gapType))].join(' / ') : '暂无明显缺口'}。`,
      current.dataNature === 'simulated'
        ? '本批次为模拟数据（通道 A 人工），结论仅用于校准方法；正式接入监控平台后按真实值替换。'
        : '本批次为真实采集数据，结论可直接用于下一步内容生产与投放。',
    ];
    return {
      ...base,
      metrics,
      prevMetrics,
      platforms: platformRows,
      competitors: competitorRows,
      gaps,
      actions,
      summary,
    };
  }
  /* ----------------------------- 选题池 ----------------------------- */
  async listTopics(user: CurrentUser, projectId: number) {
    await this.requireProject(user, projectId);
    return this.prisma.geoTopic.findMany({
      where: { projectId },
      orderBy: [{ totalScore: 'desc' }, { id: 'asc' }],
    });
  }
  async saveTopic(
    user: CurrentUser,
    projectId: number,
    body: Record<string, unknown>,
    id = 0,
  ) {
    await this.requireProject(user, projectId);
    const title = text(body.title).trim();
    if (!title) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写选题名称');
    }
    const clamp = (value: unknown) =>
      Math.max(0, Math.min(10, Math.floor(Number(value || 0))));
    const gapType = GEO_GAP_TYPES.includes(
      text(body.gap_type) as (typeof GEO_GAP_TYPES)[number],
    )
      ? text(body.gap_type)
      : '引用真空点';
    const platformCount = Math.max(
      0,
      Math.floor(Number(body.platform_count || 0)),
    );
    // 缺口强度：多平台同现缺口（≥3）加 2 分，封顶 10
    const gapScore = Math.min(
      10,
      clamp(body.gap_score) + (platformCount >= 3 ? 2 : 0),
    );
    const citableScore = clamp(body.citable_score);
    const businessScore = clamp(body.business_score);
    const supplyScore = clamp(body.supply_score);
    const styleBonus = Math.max(
      0,
      Math.min(2, Math.floor(Number(body.style_bonus || 0))),
    );
    const blacklisted = Number(body.blacklisted || 0) ? 1 : 0;
    const citable = Math.min(10, citableScore + styleBonus);
    const totalScore = blacklisted
      ? 0
      : round1(
          gapScore * 0.3 +
            citable * 0.3 +
            businessScore * 0.25 +
            supplyScore * 0.15,
        );
    const payload = {
      title,
      gapType,
      questionId: Number(body.question_id || 0),
      platformCount,
      gapScore,
      citableScore,
      businessScore,
      supplyScore,
      styleBonus,
      totalScore,
      blacklisted,
      status: blacklisted
        ? 'REJECTED'
        : ['CANDIDATE', 'SELECTED', 'REJECTED'].includes(text(body.status))
          ? text(body.status)
          : 'CANDIDATE',
      note: text(body.note),
    };
    if (id) {
      const exist = await this.prisma.geoTopic.findUnique({ where: { id } });
      if (!exist || exist.projectId !== projectId) {
        throw new BusinessException(ErrorCode.NOT_FOUND, '选题不存在');
      }
      return this.prisma.geoTopic.update({ where: { id }, data: payload });
    }
    return this.prisma.geoTopic.create({ data: { projectId, ...payload } });
  }
  async removeTopic(user: CurrentUser, id: number) {
    const row = await this.prisma.geoTopic.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '选题不存在');
    await this.requireProject(user, row.projectId);
    await this.prisma.geoTopic.delete({ where: { id } });
    return { id };
  }
  /* ---------------------------- 权限与工具 ---------------------------- */
  private async scope(user: CurrentUser) {
    if (this.identity.isPlatformAdmin(user)) return {};
    const eps = await this.identity.myEnterprises(user.userId);
    return {
      OR: [
        { ownerUserId: user.userId },
        { enterpriseUserId: user.userId },
        { enterpriseId: { in: eps.map((item) => item.id) } },
      ],
    };
  }
  private async requireProject(user: CurrentUser, id: number) {
    const row = await this.prisma.geoProject.findUnique({ where: { id } });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, 'GEO 项目不存在');
    if (this.identity.isPlatformAdmin(user)) return row;
    if (
      row.ownerUserId === user.userId ||
      (row.enterpriseUserId && row.enterpriseUserId === user.userId)
    ) {
      return row;
    }
    const eps = await this.identity.myEnterprises(user.userId);
    if (row.enterpriseId && eps.some((item) => item.id === row.enterpriseId)) {
      return row;
    }
    throw new BusinessException(
      ErrorCode.FORBIDDEN,
      '数据仅对品牌方当事人与承办人可见',
    );
  }
  private async requireBatch(user: CurrentUser, id: number) {
    const row = await this.prisma.geoBatch.findUnique({ where: { id } });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '采集批次不存在');
    await this.requireProject(user, row.projectId);
    return row;
  }
}
function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}
function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return text(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
const pct = (rate: number) => `${round1(rate * 100)}%`;
/** 指标计算（与 geo_metrics.py compute_metrics 同口径）。 */
function computeMetrics(rows: ObservationRow[]): Metrics {
  const total = rows.length;
  const mentioned = rows.filter((item) => item.brandMentioned === 1).length;
  const ranks = rows
    .map((item) => item.rankPosition || 0)
    .filter((item) => item > 0);
  const listed = ranks.length;
  const negative = rows.filter(
    (item) => item.brandMentioned === 1 && item.sentiment === '负面',
  ).length;
  const mentionRate = total ? mentioned / total : 0;
  const listRate = total ? listed / total : 0;
  const negativeRate = mentioned ? negative / mentioned : 0;
  const citationQuality = total
    ? rows.reduce(
        (sum, item) =>
          sum +
          (CITATION_WEIGHT[item.citationGenre] ?? CITATION_WEIGHT_UNKNOWN),
        0,
      ) / total
    : 0;
  const exposureScore = round1(
    scoreBucket(mentionRate) * 0.4 +
      scoreBucket(listRate) * 0.3 +
      citationQuality * 0.3,
  );
  return {
    total,
    mentioned,
    listed,
    negative,
    mentionRate: round3(mentionRate),
    listRate: round3(listRate),
    avgRank: ranks.length
      ? round1(ranks.reduce((sum, item) => sum + item, 0) / ranks.length)
      : null,
    negativeRate: round3(negativeRate),
    citationQuality: round1(citationQuality),
    exposureScore,
    tier: exposureTier(exposureScore),
  };
}
function suggestForm(type: string) {
  if (type === '竞品对比词') return '对比表';
  if (type === '决策词') return '清单/FAQ';
  if (type === '品牌词') return '官方说明';
  return '数据文/指南';
}
/** §6 下一步动作清单：由缺口规则生成（不编造事实，动作指向内容生产与投放）。 */
function buildActions(
  gaps: Array<{
    gapType: string;
    priority: string;
    text: string;
  }>,
  metrics: Metrics,
  dataNature: string,
) {
  const actions: Array<{
    action: string;
    skill: string;
    owner: string;
    priority: string;
    due: string;
  }> = [];
  const has = (type: string) => gaps.some((item) => item.gapType === type);
  if (has('品牌被错误描述点')) {
    actions.push({
      action: '修复负面/错误描述：产出勘误文与官方说明，优先覆盖对应平台',
      skill: '04 优化-高引用GEO内容创作',
      owner: '品牌方 + 服务商内容运营',
      priority: 'P0',
      due: '1 周内',
    });
  }
  if (has('引用真空点')) {
    actions.push({
      action:
        '补齐引用真空点：按缺口问题生产清单/对比/数据类内容，投向报告、官网、百科等高权重载体',
      skill: '04 优化-高引用GEO内容创作',
      owner: '服务商内容运营',
      priority: 'P0',
      due: '2 周内',
    });
  }
  if (has('名次缺口')) {
    actions.push({
      action:
        '提升上榜名次：对已上榜问题补充结构化数据与权威引用，争取进入前 3 位',
      skill: '04 优化-高引用GEO内容创作',
      owner: '服务商内容运营',
      priority: 'P1',
      due: '1 个月',
    });
  }
  if (has('弱覆盖点')) {
    actions.push({
      action: '为已点名问题补充可引用依据（报告/官网/百科），提高引用质量得分',
      skill: '04 优化-高引用GEO内容创作',
      owner: '服务商内容运营',
      priority: 'P1',
      due: '1 个月',
    });
  }
  actions.push({
    action: `按季度评审问题库有效性（当前 ${metrics.total} 条回答样本）并淘汰长期无品牌/无竞品的问题`,
    skill: '02 监控-多平台大模型监控模拟',
    owner: '服务商 GEO 分析',
    priority: 'P2',
    due: '每季度',
  });
  if (dataNature === 'simulated') {
    actions.push({
      action: '接入真实监控平台复采本轮问题库，用真实值替换模拟数据后复核结论',
      skill: '02 监控-多平台大模型监控模拟',
      owner: '服务商 GEO 分析',
      priority: 'P0',
      due: '2 周内',
    });
  }
  return actions;
}
