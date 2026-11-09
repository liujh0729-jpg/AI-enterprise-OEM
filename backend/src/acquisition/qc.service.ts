import { ACQ_QC_DIMENSIONS } from '@enterprise/contracts';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import { aiJson } from '../ai/ai-gateway';
import type { AiEvalService } from '../ai/ai-eval.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { AcquisitionSettingsService } from './acquisition-settings.service';
import {
  clip,
  int,
  iso,
  json,
  orgKey,
  pageArgs,
  pageResult,
  text,
  type OrgKey,
  type Row,
} from './acquisition.helpers';

type TranscriptMessage = {
  role: 'visitor' | 'agent' | 'ai' | 'system';
  text: string;
  at: Date;
};

type DimensionDraft = {
  key: string;
  name: string;
  score: number;
  note: string;
};
type IssueDraft = {
  dimension: string;
  quote: string;
  problem: string;
  rewrite: string;
};

export type QcOutcome = {
  dimensions: DimensionDraft[];
  issues: IssueDraft[];
  suggestions: string[];
  mode: 'rule' | 'llm';
};

const PROMISE_WORDS = [
  '保证',
  '一定',
  '百分百',
  '最低价',
  '全网最',
  '包退',
  '承诺',
  '绝对',
];
const EMPATHY_WORDS = ['理解', '抱歉', '感谢', '辛苦', '明白', '确实'];
const PRICE_WORDS = ['价格', '多少钱', '报价', '费用', '预算'];
const CTA_WORDS = [
  '要不要',
  '可以吗',
  '方便',
  '安排',
  '发您',
  '看一下',
  '确认',
  '下一步',
];

const QC_SYSTEM = [
  '你是销售会话质检员。按五个维度各 0-20 分评分，只输出 JSON：',
  '{"dimensions":[{"key":"DEMAND","score":0,"note":"依据"},…],"issues":[{"dimension":"需求识别","quote":"原话","problem":"问题","rewrite":"改写建议"}],"suggestions":["建议"]}',
  '维度固定为：DEMAND 需求识别、COMPLETENESS 信息完整、BOUNDARY 边界合规、PACE 推进节奏、EMOTION 情绪处理。',
  '问题必须引用会话原话；没有问题就给空数组，不要编造。',
].join('\n');

/**
 * 接待质检（设计 §5.7）：把服务台会话按五维各 20 分打分并留快照。
 * 有模型时用模型，无模型时用可解释的规则打分——两种模式都返回同构数据，前端不需要分支。
 */
export class AcquisitionQcService {
  private readonly warned = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AcquisitionSettingsService,
    private readonly aiEval: AiEvalService,
  ) {}

  async list(user: CurrentUser, query: Row) {
    const org = await this.settings.org(user);
    const args = pageArgs(query);
    const where = {
      ...orgKey(org),
      ...(int(query.conversationId) > 0
        ? { conversationId: int(query.conversationId) }
        : {}),
      ...(text(query.agentUserId).trim()
        ? { agentUserId: clip(text(query.agentUserId), 64) }
        : {}),
      ...(int(query.playbookId) > 0
        ? { playbookId: int(query.playbookId) }
        : {}),
      ...(query.maxScore === undefined
        ? {}
        : { score: { lte: Math.min(100, Math.max(0, int(query.maxScore))) } }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.acqQcReview.count({ where }),
      this.prisma.acqQcReview.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
    ]);
    return pageResult(
      rows.map((row) => this.view(row)),
      total,
      args,
    );
  }

  async run(user: CurrentUser, body: Row, token = '') {
    const org = await this.settings.org(user);
    const conversationId = int(body.conversationId);
    if (conversationId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择要质检的会话');
    }
    const conversation = await this.prisma.serviceDeskConversation.findFirst({
      where: { id: conversationId, ownerUserId: org.orgUserId },
    });
    if (!conversation) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '会话不存在或不属于当前组织',
      );
    }
    const messages = await this.transcript(conversationId);
    if (!messages.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '该会话还没有消息');
    }
    const settings = await this.settings.forOrg(org);
    const playbookId =
      int(body.playbookId) > 0
        ? int(body.playbookId)
        : settings.defaultPlaybookId;
    const boundary = await this.boundaryText(org, playbookId);
    const rule = ruleQc(messages, boundary);
    const ai = await aiJson<{
      dimensions: DimensionDraft[];
      issues: IssueDraft[];
      suggestions: string[];
    }>(this.prisma, {
      userId: org.orgUserId,
      token,
      model: settings.aiModel || undefined,
      channelId: settings.aiChannelId || undefined,
      messages: [
        { role: 'system', content: QC_SYSTEM },
        {
          role: 'user',
          content: clip(
            [
              boundary ? `剧本边界：\n${boundary}` : '剧本边界：未配置',
              '会话记录：',
              messages
                .map(
                  (item) =>
                    `[${ROLE_LABELS[item.role] || item.role}] ${item.text}`,
                )
                .join('\n'),
            ].join('\n\n'),
            8000,
          ),
        },
      ],
      purpose: 'batch',
      module: 'acquisition',
      operation: 'qc_review',
      charge: { code: 'acq_qc', refId: String(conversationId) },
      validate: (raw) => validateQc(raw, rule),
    });
    if (!ai) {
      // 规则模式没有发生模型调用；质检本身仍是计费动作，按一次记账（失败只告警）
      await this.aiEval
        .chargeByUsage(
          org.orgUserId,
          'acq_qc',
          { call: 1 },
          String(conversationId),
          {
            module: 'acquisition',
            operation: 'qc_review_rule',
          },
        )
        .catch((error) => this.warnOnce('acq_qc_charge', error));
    }
    const outcome: QcOutcome = ai
      ? { ...ai.data, mode: 'llm' }
      : { ...rule, mode: 'rule' };
    const score = outcome.dimensions.reduce((sum, item) => sum + item.score, 0);
    const row = await this.prisma.acqQcReview.create({
      data: {
        ...orgKey(org),
        conversationId,
        agentUserId: clip(conversation.assigneeUserId || '', 64),
        playbookId,
        score,
        dimensions: json(outcome.dimensions),
        issues: json(outcome.issues),
        suggestions: json(outcome.suggestions),
        mode: outcome.mode,
      },
    });
    return this.view(row);
  }

  async detail(user: CurrentUser, id: number) {
    const org = await this.settings.org(user);
    const row = await this.prisma.acqQcReview.findFirst({
      where: { id, ...orgKey(org) },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '质检记录不存在');
    const conversation = await this.prisma.serviceDeskConversation.findUnique({
      where: { id: row.conversationId },
    });
    const messages = await this.transcript(row.conversationId);
    return {
      ...this.view(row),
      conversationTitle: conversationTitle(conversation),
      messages: messages.map((item) => ({
        role: item.role,
        text: item.text,
        at: iso(item.at),
      })),
    };
  }

  private async transcript(
    conversationId: number,
  ): Promise<TranscriptMessage[]> {
    const rows = await this.prisma.serviceDeskMessage.findMany({
      where: { conversationId },
      orderBy: { id: 'desc' },
      take: 200,
    });
    return rows
      .reverse()
      .filter((row) => row.contentType === 'text' && row.content.trim())
      .map((row) => ({
        role: normalizeRole(row.senderType),
        text: clip(row.content, 2000),
        at: row.createdAt,
      }));
  }

  private async boundaryText(org: OrgKey, playbookId: number): Promise<string> {
    if (playbookId <= 0) return '';
    const book = await this.prisma.acqPlaybook.findFirst({
      where: { id: playbookId, ...orgKey(org) },
    });
    if (!book) return '';
    const raw = asRecord(book.boundaries);
    const lines: string[] = [];
    const labels: Record<string, string> = {
      noPricePromise: '不做价格承诺',
      noTimelinePromise: '不做交付时间承诺',
      noCompensationPromise: '不做赔付承诺',
      noCustomPromise: '不做定制承诺',
      noFabricatedCases: '不编造案例',
    };
    for (const [key, label] of Object.entries(labels)) {
      if (raw[key] === true) lines.push(label);
    }
    const extra = Array.isArray(raw.extra)
      ? raw.extra.map((item) => String(item)).filter(Boolean)
      : [];
    lines.push(...extra.map((item) => clip(item, 120)));
    return lines.join('；');
  }

  private view(row: {
    id: number;
    conversationId: number;
    agentUserId: string;
    playbookId: number;
    score: number;
    dimensions: unknown;
    issues: unknown;
    suggestions: unknown;
    mode: string;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      conversationId: row.conversationId,
      agentUserId: row.agentUserId,
      playbookId: row.playbookId,
      score: row.score,
      dimensions: asDimensions(row.dimensions),
      issues: asIssues(row.issues),
      suggestions: Array.isArray(row.suggestions)
        ? row.suggestions.map((item) => clip(item, 300)).filter(Boolean)
        : [],
      mode: row.mode,
      createdAt: iso(row.createdAt),
    };
  }

  private warnOnce(key: string, error: unknown) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(
      JSON.stringify({
        event: 'acquisition_qc_warning',
        key,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

const ROLE_LABELS: Record<string, string> = {
  visitor: '客户',
  agent: '客服',
  ai: 'AI',
  system: '系统',
};

const normalizeRole = (senderType: string): TranscriptMessage['role'] => {
  if (
    senderType === 'visitor' ||
    senderType === 'agent' ||
    senderType === 'ai'
  ) {
    return senderType;
  }
  return 'system';
};

const conversationTitle = (
  row: {
    subject: string;
    externalUserName: string;
    externalUserId: string;
  } | null,
) =>
  clip(
    row?.subject || row?.externalUserName || row?.externalUserId || '访客会话',
    120,
  );

/** 规则质检：每条结论都能指到原话或缺失项，不依赖模型。 */
export function ruleQc(
  messages: TranscriptMessage[],
  boundary: string,
): QcOutcome {
  const agent = messages.filter(
    (item) => item.role === 'agent' || item.role === 'ai',
  );
  const visitor = messages.filter((item) => item.role === 'visitor');
  const agentText = agent.map((item) => item.text).join('\n');
  const visitorText = visitor.map((item) => item.text).join('\n');
  const issues: IssueDraft[] = [];
  const suggestions: string[] = [];

  const dims: Record<string, { score: number; note: string }> = {};

  // 需求识别：有没有主动追问、有没有复述客户说过的需求
  let demand = 10;
  if (/[?？]/.test(agentText)) demand += 4;
  const overlap = keywordOverlap(visitorText, agentText);
  if (overlap >= 2) demand += 4;
  else if (overlap >= 1) demand += 2;
  if (!visitor.length) demand -= 4;
  if (!agent.some((item) => /[?？]/.test(item.text))) {
    suggestions.push('先用一个开放式问题确认客户的使用场景，再介绍方案。');
  }
  dims.DEMAND = {
    score: demand,
    note: `客服提问 ${countMatches(agentText, /[?？]/g)} 次，复述客户关键词 ${overlap} 个`,
  };

  // 信息完整：客户问到的价格/时间有没有回应
  let completeness = 12;
  const visitorQuestions = visitor.filter((item) =>
    /[?？]|价格|多少钱|怎么|多久|时间|发货|售后/.test(item.text),
  );
  const answered = visitorQuestions.filter((item) =>
    sharesKeyword(item.text, agentText),
  ).length;
  completeness += Math.min(6, answered * 2);
  if (/-/.test(visitorText) && !/已/.test(visitorText)) completeness += 2;
  if (visitorQuestions.length > answered) {
    const missing = visitorQuestions.find(
      (item) => !sharesKeyword(item.text, agentText),
    );
    if (missing) {
      issues.push({
        dimension: '信息完整',
        quote: clip(missing.text, 200),
        problem: '客户的问题没有得到正面回应',
        rewrite: '先直接回答，再补充一条可选方案并确认是否还有其他疑问。',
      });
      completeness -= 5;
      suggestions.push('逐条回应客户问题，未确定的信息先说明核实时间。');
    }
  }
  dims.COMPLETENESS = {
    score: completeness,
    note: `客户提问 ${visitorQuestions.length} 条，已回应 ${answered} 条`,
  };

  // 边界合规：承诺词与剧本禁用项
  let boundaryScore = 20;
  const promiseHits = PROMISE_WORDS.filter((word) => agentText.includes(word));
  if (promiseHits.length) {
    boundaryScore -= promiseHits.length * 6;
    const quote = agent.find((item) =>
      promiseHits.some((w) => item.text.includes(w)),
    );
    issues.push({
      dimension: '边界合规',
      quote: clip(quote?.text || promiseHits.join('、'), 200),
      problem: `出现绝对化承诺：${promiseHits.join('、')}`,
      rewrite: '改为说明可确认的事实与条件，避免「一定/保证/最低价」等表述。',
    });
    suggestions.push('把价格、时效、赔付类表述换成「以合同/确认为准」。');
  }
  if (
    boundary.includes('不做价格承诺') &&
    PRICE_WORDS.some((w) => agentText.includes(w))
  ) {
    boundaryScore -= 4;
  }
  dims.BOUNDARY = {
    score: boundaryScore,
    note: promiseHits.length
      ? `命中承诺词：${promiseHits.join('、')}`
      : '未发现绝对化承诺',
  };

  // 推进节奏：每轮有没有下一步
  let pace = 14;
  if (CTA_WORDS.some((word) => agentText.includes(word))) pace += 4;
  if (agent.length && visitor.length && agent.length > visitor.length * 3)
    pace -= 4;
  if (!CTA_WORDS.some((word) => agentText.includes(word))) {
    suggestions.push(
      '每轮结束前给一个明确的下一步（发资料、约时间、确认需求）。',
    );
  }
  dims.PACE = {
    score: pace,
    note: `客服 ${agent.length} 条 / 客户 ${visitor.length} 条，下一步引导 ${CTA_WORDS.some((w) => agentText.includes(w)) ? '有' : '无'}`,
  };

  // 情绪处理：客户抱怨或犹豫时有没有先接住
  let emotion = 15;
  const negative = /不满意|失望|太贵|算了|投诉|着急|担心|怕/.test(visitorText);
  const empathy = EMPATHY_WORDS.some((word) => agentText.includes(word));
  if (empathy) emotion += 3;
  if (negative && empathy) emotion += 2;
  if (negative && !empathy) {
    emotion -= 6;
    const quote = visitor.find((item) =>
      /不满意|失望|太贵|算了|投诉|着急|担心|怕/.test(item.text),
    );
    issues.push({
      dimension: '情绪处理',
      quote: clip(quote?.text || '', 200),
      problem: '客户表达顾虑后没有先回应情绪',
      rewrite: '先复述客户的顾虑并表示理解，再给对应的事实或方案。',
    });
    suggestions.push('客户表达顾虑时先共情一句，再进入解释。');
  }
  dims.EMOTION = {
    score: emotion,
    note: negative
      ? empathy
        ? '客户有顾虑，客服已先共情'
        : '客户有顾虑，客服未先共情'
      : '无明显负面情绪',
  };

  return {
    dimensions: ACQ_QC_DIMENSIONS.map((dimension) => ({
      key: dimension.key,
      name: dimension.label,
      score: clamp(dims[dimension.key]?.score ?? 0, 0, dimension.max),
      note: clip(dims[dimension.key]?.note || '', 200),
    })),
    issues: issues.slice(0, 8).map((item) => ({
      dimension: clip(item.dimension, 20),
      quote: clip(item.quote, 300),
      problem: clip(item.problem, 300),
      rewrite: clip(item.rewrite, 300),
    })),
    suggestions: [...new Set(suggestions)].slice(0, 6),
    mode: 'rule',
  };
}

/** 模型结果校验：五维必须齐全，缺失维度回落到规则分；任何字段超界都截断。 */
function validateQc(raw: Record<string, unknown>, rule: QcOutcome) {
  const list = Array.isArray(raw.dimensions) ? raw.dimensions : [];
  const byKey = new Map(
    list.map((item) => {
      const row = asRecord(item);
      return [text(row.key).toUpperCase(), row] as const;
    }),
  );
  const fallback = new Map(rule.dimensions.map((item) => [item.key, item]));
  const dimensions = ACQ_QC_DIMENSIONS.map((dimension) => {
    const item = byKey.get(dimension.key);
    const base = fallback.get(dimension.key);
    if (!item) return base as DimensionDraft;
    return {
      key: dimension.key,
      name: dimension.label,
      score: clamp(int(item.score, base?.score ?? 0), 0, dimension.max),
      note: clip(text(item.note), 200),
    };
  });
  const issuesRaw = Array.isArray(raw.issues) ? raw.issues : [];
  const issues = issuesRaw.slice(0, 8).map((item) => {
    const row = asRecord(item);
    return {
      dimension: clip(text(row.dimension), 20),
      quote: clip(text(row.quote), 300),
      problem: clip(text(row.problem), 300),
      rewrite: clip(text(row.rewrite), 300),
    };
  });
  const suggestions = (Array.isArray(raw.suggestions) ? raw.suggestions : [])
    .map((item) => clip(text(item), 300))
    .filter(Boolean)
    .slice(0, 6);
  return { dimensions, issues, suggestions };
}

const asRecord = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : {};

const asDimensions = (value: unknown): DimensionDraft[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = asRecord(item);
    return {
      key: clip(text(row.key), 20),
      name: clip(text(row.name), 20),
      score: clamp(int(row.score), 0, 20),
      note: clip(text(row.note), 200),
    };
  });
};

const asIssues = (value: unknown): IssueDraft[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = asRecord(item);
    return {
      dimension: clip(text(row.dimension), 20),
      quote: clip(text(row.quote), 300),
      problem: clip(text(row.problem), 300),
      rewrite: clip(text(row.rewrite), 300),
    };
  });
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const countMatches = (content: string, pattern: RegExp) =>
  (content.match(pattern) || []).length;

const tokenize = (content: string) =>
  new Set(
    content
      .split(/[\s，。！？、,.!?;；:：""''（）()[\]【】\n]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2 && item.length <= 12),
  );

function keywordOverlap(left: string, right: string): number {
  const a = tokenize(left);
  const b = tokenize(right);
  let count = 0;
  for (const item of a) if (b.has(item)) count += 1;
  return count;
}

function sharesKeyword(left: string, right: string): boolean {
  const source = tokenize(left);
  if (!source.size) return /[?？]/.test(left) ? /[?？]/.test(right) : false;
  for (const item of source) if (right.includes(item)) return true;
  return false;
}
