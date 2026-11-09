import { text } from '../common/api';
import { PrismaService } from '../prisma/prisma.service';
import { aiEmbed, parseJsonObject, tryChat } from '../ai/ai-gateway';
import {
  hashEmbed,
  LOCAL_EMBED_ID,
  remoteEmbedId,
} from '../ai/retrieval-kernel';
import type { ChatContentPart } from '../geo/geo-llm.client';

/**
 * 数字资产 AI（AI 底座方案 §7 P1-C）：把「图片/文档」变成可复用的文本与标签。
 *
 * 原则与底座一致：
 * - 一律走统一网关取模型（视觉槽位优先，缺槽位退回文本模型）；
 * - 缺 Key / 调用失败**不抛穿**，回落规则式摘要（文件名 + 类型），只标 mode=rule；
 * - 向量与知识库同一套可插拔口径：默认本地袋装，配了「向量嵌入」槽位才用真实向量。
 */
export type AssetVisionOutcome = {
  kind: 'image' | 'text';
  text: string;
  caption: string;
  labels: string[];
  model: string;
  mode: 'llm' | 'rule';
};

/** 图片 MIME：只认 OSS 键里的扩展名，认不出按 jpeg。 */
function mediaTypeOf(name: string, url: string): string {
  const source = (name || url).split('?')[0].toLowerCase();
  const ext = source.includes('.') ? source.split('.').pop() || '' : '';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

/** 从模型回复里收标签：数组或 {labels:[...]} 都吃，去重、限长、限数。 */
function pickLabels(
  parsed: Record<string, unknown> | null,
  limit = 6,
): string[] {
  const raw = Array.isArray(parsed?.labels)
    ? parsed?.labels
    : Array.isArray(parsed?.tags)
      ? parsed?.tags
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw as unknown[]) {
    const label = text(item).trim().slice(0, 12);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
    if (out.length >= limit) break;
  }
  return out;
}

/** 规则式兜底：拿文件名（去掉扩展名与时间戳前缀）当标签，至少给一个「未分类」。 */
function ruleLabels(name: string, type: string): string[] {
  const base = (name || '').replace(/\.[a-z0-9]+$/i, '').trim();
  const cleaned = base
    .replace(/^\d{10,}[-_]/, '')
    .replace(/[-_]{2,}/g, ' ')
    .slice(0, 24);
  const labels = cleaned ? [cleaned] : [];
  if (type && type !== 'file' && !labels.includes(type)) labels.push(type);
  return labels.slice(0, 6);
}

const VISION_SYSTEM = [
  '你是数字资产理解助手。看这张图，输出一个 JSON 对象：',
  '{"caption":"一句话中文描述（不超过 60 字）","labels":["3-6 个中文标签"]}',
  '标签用常见中文词（如 海报、产品图、人物、风景、图表），不要英文、不要编号、不要解释。',
].join('\n');

const TEXT_SYSTEM = [
  '你是资料理解助手。读这段文本，输出一个 JSON 对象：',
  '{"caption":"一句话中文摘要（不超过 60 字）","labels":["3-6 个中文标签"]}',
  '标签用常见中文词，不要英文、不要编号、不要解释。',
].join('\n');

export class AssetVisionService {
  constructor(private readonly prisma: PrismaService) {}

  /** 图片理解：视觉槽位模型 + 图像分片（公网 URL）。 */
  private async understandImage(
    userId: string,
    input: { name: string; url: string },
    token?: string,
  ): Promise<AssetVisionOutcome | null> {
    const message: ChatContentPart[] = [
      {
        type: 'image',
        url: input.url,
        mediaType: mediaTypeOf(input.name, input.url),
      },
      { type: 'text', text: '请按要求输出 JSON。' },
    ];
    const out = await tryChat(this.prisma, {
      userId,
      token,
      mediaType: 'vision',
      module: 'assets',
      operation: 'asset_vision',
      messages: [
        { role: 'system', content: VISION_SYSTEM },
        { role: 'user', content: message },
      ],
      maxTokens: 400,
      timeoutMs: 30000,
      purpose: 'batch',
    });
    if (!out) return null;
    const parsed = parseJsonObject(out.reply);
    const caption = text(parsed?.caption).trim().slice(0, 200);
    const labels = pickLabels(parsed);
    if (!caption && !labels.length) return null;
    return {
      kind: 'image',
      text: caption,
      caption,
      labels,
      model: out.model,
      mode: 'llm',
    };
  }

  /** 文档理解：已有抽取正文时喂文本模型出摘要与标签。 */
  private async understandText(
    userId: string,
    input: { name: string; body: string },
    token?: string,
  ): Promise<AssetVisionOutcome | null> {
    const body = input.body.slice(0, 6000);
    if (!body.trim()) return null;
    const out = await tryChat(this.prisma, {
      userId,
      token,
      mediaType: 'text',
      module: 'assets',
      operation: 'asset_text_understand',
      messages: [
        { role: 'system', content: TEXT_SYSTEM },
        {
          role: 'user',
          content: `文件名：${input.name}\n\n正文：\n${body}`,
        },
      ],
      maxTokens: 400,
      timeoutMs: 30000,
      purpose: 'batch',
    });
    if (!out) return null;
    const parsed = parseJsonObject(out.reply);
    const caption = text(parsed?.caption).trim().slice(0, 200);
    const labels = pickLabels(parsed);
    if (!caption && !labels.length) return null;
    return {
      kind: 'text',
      text: caption || body.slice(0, 200),
      caption,
      labels,
      model: out.model,
      mode: 'llm',
    };
  }

  /**
   * 理解一条资产：图片 → 视觉；可读文档 → 文本；其它（音视频/压缩包）→ 规则兜底。
   * 返回 null 表示完全没有可用信息（连文件名都没有）。
   */
  async understand(
    userId: string,
    input: { name: string; type: string; url: string; text?: string | null },
    token?: string,
  ): Promise<AssetVisionOutcome> {
    try {
      if (input.type === 'image' && input.url) {
        const vision = await this.understandImage(userId, input, token);
        if (vision) return vision;
      }
      if (input.text && input.text.trim()) {
        const read = await this.understandText(
          userId,
          {
            name: input.name,
            body: input.text,
          },
          token,
        );
        if (read) return read;
      }
    } catch {
      // 明确动作下的模型报错也走兜底：资产理解不该因缺 Key 阻断主流程
    }
    const labels = ruleLabels(input.name, input.type);
    return {
      kind: input.text ? 'text' : 'image',
      text: input.text ? input.text.slice(0, 200) : input.name,
      caption: '',
      labels,
      model: '',
      mode: 'rule',
    };
  }

  /** 资产向量：与知识库同一套写路径（远端优先、失败回落本地袋装）。 */
  async embed(
    userId: string,
    body: string,
    token?: string,
  ): Promise<{ model: string; vector: number[] }> {
    const one = await this.embedMany(userId, [body], token);
    return { model: one.model, vector: one.vectors[0] || [] };
  }

  /**
   * 批量资产向量：一次远端调用拿整批（省 quota），远端不可用整批回落本地袋装。
   * 供「找相似」用同一个模型空间比较，避免远端/本地混算导致余弦无意义。
   */
  async embedMany(
    userId: string,
    bodies: string[],
    token?: string,
  ): Promise<{ model: string; vectors: number[][] }> {
    const payloads = bodies.map((body) => String(body || '').slice(0, 4000));
    if (!payloads.length) return { model: LOCAL_EMBED_ID, vectors: [] };
    const remote = await aiEmbed(this.prisma, {
      userId,
      token,
      texts: payloads,
      module: 'assets',
      operation: 'asset_similar',
    }).catch(() => null);
    const vectors = remote?.vectors || [];
    if (
      remote &&
      vectors.length === payloads.length &&
      vectors.every((v) => v?.length)
    ) {
      return { model: remoteEmbedId(remote.model), vectors };
    }
    return {
      model: LOCAL_EMBED_ID,
      vectors: payloads.map((body) => hashEmbed(body)),
    };
  }
}
