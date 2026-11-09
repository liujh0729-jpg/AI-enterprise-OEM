import { clip, num, strArr, text, type Row } from './acquisition.helpers';
import {
  wrapUntrusted,
  type EvidenceInput,
  type ScoreContext,
} from './acquisition-scoring';

/** 渠道限制：字数上限与是否允许链接，决定草稿怎么写、超长怎么截。 */
export type ChannelLimit = {
  maxChars: number;
  allowLinks: boolean;
  /** 同一平台每日上限的配置键：COMMENT 用 dailyComments，DM 用 dailyDm */
  quota: 'comments' | 'dm';
};

const CHANNEL_LIMITS: Record<string, ChannelLimit> = {
  // 抖音评论只有短评位，放链接会被限流甚至折叠
  DOUYIN_COMMENT: { maxChars: 100, allowLinks: false, quota: 'comments' },
  // 小红书私信首条带链接容易被判营销，先只发文字
  XHS_DM: { maxChars: 200, allowLinks: false, quota: 'dm' },
  EMAIL: { maxChars: 4000, allowLinks: true, quota: 'dm' },
  // 企微群发由既有企点通道执行，正文只承载话术
  WECOM: { maxChars: 600, allowLinks: false, quota: 'dm' },
};

export const channelLimit = (channel: string): ChannelLimit =>
  CHANNEL_LIMITS[channel] || CHANNEL_LIMITS.XHS_DM;

/** 三个角度固定，前端按此顺序展示，不随模型输出顺序漂移。 */
export const DRAFT_ANGLES = [
  {
    key: '共鸣式',
    hint: '先接住对方在原贴里说的具体困扰，再给一句我们能补上的点',
  },
  { key: '直给式', hint: '直接说清我们做什么、适合谁，用一句可核实的事实支撑' },
  { key: '提问式', hint: '用一个和原贴强相关的问题把对话打开，不推销' },
] as const;

export type OutreachDraft = { angle: string; text: string; why: string };

export type PlaybookLike = {
  name: string;
  goal: string;
  persona: Row;
  boundaries: Row;
  openers: Row[];
  objections: Row[];
} | null;

export type ProfileLike = {
  displayName: string;
  businessStatus: string;
  purpose: string;
  objections: string[];
  budget: string;
  decisionRole: string;
} | null;

export type DraftInput = {
  channel: string;
  action: string;
  platformLabel: string;
  brand: ScoreContext;
  lead: {
    nickname: string;
    intentLevel: string;
    intentTags: string[];
    scoreReason: string;
  };
  evidence: EvidenceInput[];
  playbook: PlaybookLike;
  profile: ProfileLike;
};

const FORBIDDEN_PROMISES = [
  '保证',
  '一定能',
  '稳赚',
  '包过',
  '最低价',
  '全网最低',
  '百分百',
  '无效退款',
];

/** 链接识别只用于「该渠道不允许链接」时的降级提示，不重写正文。 */
export const containsLink = (value: string): boolean =>
  /https?:\/\/|www\./i.test(String(value || ''));

/** 去掉模型爱加的前后缀与多余空行；不做语义改写。 */
export function cleanDraftText(value: unknown, maxChars: number): string {
  const raw = text(value)
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (raw.length <= maxChars) return raw;
  // 截断优先落在标点，避免把一句话砍成半句
  const slice = raw.slice(0, maxChars);
  const cut = Math.max(
    slice.lastIndexOf('。'),
    slice.lastIndexOf('！'),
    slice.lastIndexOf('？'),
    slice.lastIndexOf('\n'),
  );
  return (
    cut >= Math.floor(maxChars * 0.6) ? slice.slice(0, cut + 1) : slice
  ).trim();
}

const firstSentence = (value: string): string => {
  const text = String(value || '')
    .replace(/<<<不可信内容[^>]*>>>/g, '')
    .trim();
  const match = /^[^。！？\n]{6,80}/.exec(text);
  return (match ? match[0] : clip(text, 60)).trim();
};

/**
 * 无 AI Key 时的规则式草稿：只用证据里真实出现的说法和品牌上下文，
 * 不编造案例、不承诺价格与时效；mode=rule 由上层如实标注。
 */
export function ruleDrafts(input: DraftInput): OutreachDraft[] {
  const limit = channelLimit(input.channel);
  const brand = input.brand.brandName || '我们';
  const quote = firstSentence(input.evidence[0]?.excerpt || '');
  const topic = input.brand.keywords[0] || input.brand.industry || '这件事';
  const drafts: OutreachDraft[] = [];

  if (quote) {
    drafts.push({
      angle: '共鸣式',
      text: cleanDraftText(
        `看到你提到「${quote}」，我们也在帮同类客户处理${topic}这块。如果方便，我可以先按你的情况给个思路，不合适随时说。`,
        limit.maxChars,
      ),
      why: `原贴里有明确的具体说法（「${quote}」），先回应它比直接介绍自己更容易被当成同类人。`,
    });
  }
  drafts.push({
    angle: '直给式',
    text: cleanDraftText(
      `${brand}这边主要做${topic}。看你在关注这类问题，我把我们常规的处理方式和适用条件发你，你自己判断合不合适。`,
      limit.maxChars,
    ),
    why: '对方已在公开场景表达需求，直说做什么、适合谁，减少来回试探。',
  });
  if (drafts.length < 3) {
    drafts.push({
      angle: '提问式',
      text: cleanDraftText(
        `想确认一下：你现在是已经在选方案，还是先了解下大概做法？我按你的阶段说，不占用你太多时间。`,
        limit.maxChars,
      ),
      why: '用阶段问题把对话打开，先判断意向强度再决定要不要给方案。',
    });
  }
  return drafts.slice(0, 3);
}

/** 模型输出的严格校验：角度必须齐全、正文不空且不超字数，否则整批不用。 */
export function validateDrafts(
  raw: Row,
  maxChars: number,
): OutreachDraft[] | null {
  const list = Array.isArray(raw.drafts) ? (raw.drafts as Row[]) : [];
  const drafts = list
    .map((item) => ({
      angle: clip(item?.angle, 20),
      text: cleanDraftText(item?.text, maxChars),
      why: clip(item?.why, 300),
    }))
    .filter((item) => item.angle && item.text);
  if (!drafts.length) return null;
  return drafts.slice(0, 3);
}

export function buildDraftMessages(input: DraftInput): Array<{
  role: 'system' | 'user';
  content: string;
}> {
  const limit = channelLimit(input.channel);
  const boundaries = input.playbook?.boundaries || {};
  const cannot = strArr((input.playbook?.persona || {}).cannotDo);
  const objections = (input.playbook?.objections || [])
    .map(
      (item) =>
        `${clip(item?.topic, 20)}：承接「${clip(item?.acknowledge, 60)}」，结论「${clip(item?.conclusion, 60)}」，证据「${clip(item?.evidence, 80)}」，下一步「${clip(item?.nextStep, 60)}」`,
    )
    .join('\n');
  const system = [
    '你是中文 B2B 销售，只写一条对外触达消息，不写群发稿。',
    `渠道：${input.platformLabel}，动作：${input.action}。硬限制：全文不超过 ${limit.maxChars} 字，${limit.allowLinks ? '可以放 1 个链接' : '不允许出现链接或网址'}。`,
    '写 3 个不同角度：共鸣式（先接住对方原贴里的具体困扰）、直给式（说清做什么、适合谁）、提问式（用相关问题打开对话）。',
    '每版都要写 why，用一句话说明为什么这个角度适合当前证据。',
    '禁止：承诺价格/最低价/时效/赔付/效果，虚构案例或资质，使用「保证」「百分百」「稳赚」这类词。',
    '不要自称 AI，不要提及获取渠道，不要说「看到你在找」「我刷到你」。',
    cannot.length ? `剧本禁止事项：${cannot.join('、')}。` : '',
    '只输出 JSON，不要围栏不要解释：{"drafts":[{"angle":"共鸣式","text":"","why":""}]}',
  ]
    .filter(Boolean)
    .join('\n');
  const user = [
    `品牌：${input.brand.brandName || '未配置'}；行业：${input.brand.industry || '未配置'}；定位：${input.brand.positioning || '未配置'}；关键词：${input.brand.keywords.join('、') || '无'}。`,
    input.playbook
      ? `剧本：${input.playbook.name}（目标：${input.playbook.goal || '未填'}）。`
      : '未绑定剧本，按通用销售口径写。',
    input.profile
      ? `客户档案：${input.profile.displayName || '未填'}，阶段 ${input.profile.businessStatus}，用途 ${input.profile.purpose || '未填'}，预算 ${input.profile.budget || '未填'}，决策角色 ${input.profile.decisionRole || '未填'}，顾虑 ${input.profile.objections.join('、') || '无'}。`
      : '暂无客户档案。',
    `线索：${input.lead.nickname || '对方'}，意向 ${input.lead.intentLevel}，标签 ${input.lead.intentTags.join('、') || '无'}。`,
    objections ? `异议处理参考：\n${objections}` : '',
    input.evidence.length
      ? input.evidence
          .slice(0, 5)
          .map(
            (item, index) =>
              `证据${index + 1}（${item.sourceType}）：\n${wrapUntrusted(`证据${index + 1}`, item.excerpt)}`,
          )
          .join('\n\n')
      : '暂无证据原文。',
    boundaryHints(boundaries),
  ]
    .filter(Boolean)
    .join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function boundaryHints(boundaries: Row): string {
  const hints: string[] = [];
  if (boundaries.noPricePromise !== false) hints.push('不承诺价格');
  if (boundaries.noTimelinePromise !== false) hints.push('不承诺交付时效');
  if (boundaries.noCompensationPromise !== false) hints.push('不承诺赔付');
  if (boundaries.noCustomPromise !== false) hints.push('不承诺定制');
  if (boundaries.noFabricatedCases !== false) hints.push('不编造案例');
  const extra = strArr(boundaries.extra);
  return [...hints, ...extra].length
    ? `边界：${[...hints, ...extra].join('、')}。`
    : '';
}

/** 触发禁词直接判定不合规：宁可退回人工改写，也不把承诺发出去。 */
export function findForbiddenPromise(draft: string): string {
  return FORBIDDEN_PROMISES.find((word) => draft.includes(word)) || '';
}

/** 同内容判定：忽略空白与标点差异，避免「同一句换个空格再发一次」。 */
export const outreachFingerprint = (value: unknown): string =>
  text(value)
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。！？、；：,.!?;:]+/g, '')
    .toLowerCase()
    .slice(0, 2000);

export const engagementOf = (evidence: EvidenceInput[]): number =>
  evidence.reduce(
    (sum, item) =>
      sum +
      Math.max(0, num(item.metrics?.likes)) +
      Math.max(0, num(item.metrics?.comments)) * 2,
    0,
  );
