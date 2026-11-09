/**
 * 统一检索评分内核（AI 底座方案 §4.2）。
 *
 * 知识库混合检索、Agent 资料库、帮助中心、分身/客服的知识召回原本各写一份排序，
 * 分词、分数区间、条数与片段长度互不相通。这里把口径收口成一处：
 * - 分词：中文二元组 + 拉丁词，全系统同一个 tokenize；
 * - 评分：词面分 keywordScore（覆盖率为主、频率封顶）与 bm25Scores（长文档召回）都归一到 0~1；
 * - 融合：hybridScore = 词面 0.6 + 向量 0.4，向量缺失自动退化为词面；
 * - 截断：topK、候选上限、扫描规模、片段长度只在本文件定义一次（RANK）。
 * 向量本身可插拔：默认本地袋装 hash（确定性、零外部依赖），账号配了「向量嵌入」槽位才走真实模型。
 */

/** 检索口径常量：默认召回条数、候选与扫描上限、片段长度、融合权重。 */
export const RANK = {
  /** 默认召回条数（与契约 topK 默认一致） */
  topK: 8,
  /** 契约允许的 topK 上限 */
  maxTopK: 20,
  /** 进语义重排的候选上限 */
  candidates: 24,
  /** 列表/引用用的短片段长度 */
  excerptChars: 220,
  /** 带命中窗口的上下文片段长度 */
  snippetChars: 360,
  /** 单空间参与检索的页数上限 */
  scanPages: 1000,
  /** 单空间参与检索的分块数上限 */
  scanChunks: 3000,
  /** 资料库参与检索的片段数上限 */
  scanNodes: 3000,
  /** 融合权重：词面 */
  keywordWeight: 0.6,
  /** 融合权重：向量 */
  vectorWeight: 0.4,
  /** 向量分低于此值视为未命中（避免噪声进结果） */
  vectorFloor: 0.01,
} as const;

/** 本地袋装向量模型标识（写进 kb_chunks.model，与真实向量隔离） */
export const LOCAL_EMBED_ID = 'local-hash-256';
export const LOCAL_EMBED_DIM = 256;
/** 真实向量模型标识前缀：`embed:<模型名>` */
export const REMOTE_EMBED_PREFIX = 'embed:';

export const remoteEmbedId = (model: string): string =>
  `${REMOTE_EMBED_PREFIX}${String(model || '').slice(0, 58)}`;

export const isRemoteEmbedId = (id: string): boolean =>
  String(id || '').startsWith(REMOTE_EMBED_PREFIX);

/** 分词：中文 2-gram + 英文/数字词（小写）；单字仅在纯中文短查询时保留。 */
export function tokenize(text: string): string[] {
  const raw = String(text ?? '').toLowerCase();
  const tokens: string[] = [];
  const ascii = raw.match(/[a-z0-9][a-z0-9._+-]*/g) || [];
  tokens.push(...ascii);
  const cjkRuns = raw.match(/[\u4e00-\u9fff]+/g) || [];
  for (const run of cjkRuns) {
    if (run.length === 1) tokens.push(run);
    for (let i = 0; i + 2 <= run.length; i += 1) {
      tokens.push(run.slice(i, i + 2));
    }
  }
  return tokens;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 袋装 hash 向量：token → 维度计数，L2 归一；同文本必得同向量（确定性）。 */
export function hashEmbed(text: string): number[] {
  const vec = new Array<number>(LOCAL_EMBED_DIM).fill(0);
  for (const token of tokenize(text)) {
    vec[fnv1a(token) % LOCAL_EMBED_DIM] += 1;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  return norm > 0 ? vec.map((v) => Number((v / norm).toFixed(6))) : vec;
}

export function cosine(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 关键词分数 [0,1]：查询 token 覆盖率为主，频率为辅（饱和封顶防长文刷分）。 */
export function keywordScore(query: string, text: string): number {
  const qTokens = Array.from(new Set(tokenize(query)));
  if (!qTokens.length) return 0;
  const hay = String(text ?? '').toLowerCase();
  let covered = 0;
  let freq = 0;
  for (const token of qTokens) {
    let idx = hay.indexOf(token);
    let hits = 0;
    while (idx !== -1 && hits < 10) {
      hits += 1;
      idx = hay.indexOf(token, idx + token.length);
    }
    if (hits > 0) {
      covered += 1;
      freq += Math.log2(hits + 1);
    }
  }
  const coverage = covered / qTokens.length;
  const density = Math.min(1, freq / (qTokens.length * 3));
  return Number((coverage * 0.75 + density * 0.25).toFixed(6));
}

/** 词面 + 向量融合；向量缺失（未 embedding 或维度不符）时等于词面分。 */
export function hybridScore(keyword: number, vector: number): number {
  return Number(
    (keyword * RANK.keywordWeight + vector * RANK.vectorWeight).toFixed(6),
  );
}

/**
 * 跨源合并前的归一：把各来源的分数量纲拉到 0~1（本批最高分为 1）。
 * 帮助中心是加和分、资料库是 BM25 分、知识库是融合分，不归一就没法排在一个清单里。
 */
export function normalizeScores(scores: number[]): number[] {
  const max = scores.reduce((acc, s) => (s > acc ? s : acc), 0);
  if (max <= 0) return scores.map(() => 0);
  return scores.map((s) => Number((s / max).toFixed(6)));
}

/** 字段加权检索的默认权重：标题 > 关键词 > 摘要 > 正文。 */
export const FIELD_WEIGHTS = {
  title: 0.35,
  keywords: 0.3,
  summary: 0.2,
  body: 0.15,
} as const;

export type ScoredFields = {
  title?: string;
  keywords?: string[];
  summary?: string;
  body?: string;
};

/**
 * 多字段评分（帮助中心、名录类只读库共用）：每个字段各算一次 keywordScore，
 * 按 FIELD_WEIGHTS 加权，出参归一到 0~1——字段命中率不同不会让某类文档天然排前。
 */
export function fieldScore(query: string, fields: ScoredFields): number {
  const parts: [number, string | undefined][] = [
    [FIELD_WEIGHTS.title, fields.title],
    [FIELD_WEIGHTS.keywords, (fields.keywords || []).join(' ')],
    [FIELD_WEIGHTS.summary, fields.summary],
    [FIELD_WEIGHTS.body, fields.body],
  ];
  let score = 0;
  for (const [weight, text] of parts) {
    if (!text) continue;
    score += keywordScore(query, text) * weight;
  }
  return Number(score.toFixed(6));
}

export type Bm25Doc = { key: string; text: string };

/**
 * BM25-lite 召回（长文档集合用）：中文二元组同一套 tokenize，k1=1.4/b=0.75，
 * 出参按分数降序、截断到候选上限，分数再归一到 0~1 以便与向量分融合。
 */
export function bm25Scores(
  query: string,
  docs: Bm25Doc[],
  limit: number = RANK.candidates,
  options: { k1?: number; b?: number } = {},
): { key: string; score: number }[] {
  const queryTokens = [...new Set(tokenize(query))];
  if (!queryTokens.length || !docs.length) return [];
  const k1 = options.k1 ?? 1.4;
  const b = options.b ?? 0.75;
  const parsed = docs.map((doc) => {
    const counts = new Map<string, number>();
    const tokens = tokenize(doc.text);
    for (const token of tokens) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
    return { key: doc.key, counts, length: tokens.length };
  });
  const avgLength =
    parsed.reduce((sum, doc) => sum + doc.length, 0) /
    Math.max(1, parsed.length);
  const df = new Map<string, number>();
  for (const token of queryTokens) {
    let count = 0;
    for (const doc of parsed) if (doc.counts.has(token)) count += 1;
    df.set(token, count);
  }
  const scored = parsed.map((doc) => {
    let score = 0;
    for (const token of queryTokens) {
      const tf = doc.counts.get(token) || 0;
      if (!tf) continue;
      const freq = df.get(token) || 0;
      const idf = Math.log(1 + (parsed.length - freq + 0.5) / (freq + 0.5));
      const norm =
        tf + k1 * (1 - b + (b * doc.length) / Math.max(1, avgLength));
      score += idf * ((tf * (k1 + 1)) / norm);
    }
    return { key: doc.key, score };
  });
  const hit = scored.filter((item) => item.score > 0);
  const norm = normalizeScores(hit.map((item) => item.score));
  return hit
    .map((item, index) => ({ key: item.key, score: norm[index] }))
    .sort(
      (left, right) =>
        right.score - left.score || left.key.localeCompare(right.key),
    )
    .slice(0, limit);
}

/** 片段裁剪：压掉换行后取前 n 字（各源统一用 RANK.excerptChars / snippetChars）。 */
export function excerpt(text: string, n = RANK.excerptChars): string {
  const plain = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > n ? `${plain.slice(0, n)}…` : plain;
}

/** 带命中窗口的片段：从首个命中的 token 前 1/3 处起截取（资料库/问答上下文用）。 */
export function snippet(
  content: string,
  tokens: string[],
  n = RANK.snippetChars,
) {
  const plain = String(content ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= n) return plain;
  const lowered = plain.toLowerCase();
  let at = -1;
  for (const token of tokens) {
    const index = lowered.indexOf(token);
    if (index >= 0 && (at < 0 || index < at)) at = index;
  }
  if (at < 0) return `${plain.slice(0, n)}…`;
  const start = Math.max(0, at - Math.floor(n / 3));
  const end = Math.min(plain.length, start + n);
  return `${start > 0 ? '…' : ''}${plain.slice(start, end)}${
    end < plain.length ? '…' : ''
  }`;
}
