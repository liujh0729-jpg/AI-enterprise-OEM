import { createHash } from 'node:crypto';
import { aiGuardDeny } from '../ai/ai-guard.service';
import { resolveModel } from '../ai/ai-gateway';
import {
  geoChatMulti,
  type ChatMessage,
  type GeoChatResult,
} from '../geo/geo-llm.client';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * 知识库 LLM 薄适配（§10.5）：
 * - 分块：段落聚合到 ~600 字/块，重叠 80 字保上下文；
 * - 检索评分与向量原语已收口到 `ai/retrieval-kernel`（全系统统一口径）；
 * - LLM：与技能审查同一通道（AipddKey + rpa/workbuddy 默认模型）；缺 Key/模型
 *   返回 null 让上层走规则式回落，绝不抛穿业务链路。
 */

/** 段落聚合分块（~600 字，重叠 80）；空文本不出块。 */
export function chunkText(text: string, size = 600, overlap = 80): string[] {
  const clean = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!clean) return [];
  const paras = clean.split(/\n{2,}/);
  const chunks: string[] = [];
  let buf = '';
  for (const para of paras) {
    let piece = para;
    // 超长段落直接按句切，避免一块独大
    while (piece.length > size) {
      const cut = piece.lastIndexOf('。', size);
      const take = cut > size * 0.4 ? cut + 1 : size;
      if (buf) {
        chunks.push(buf);
        buf = '';
      }
      chunks.push(piece.slice(0, take).trim());
      piece = piece.slice(Math.max(1, take - overlap)).trim();
    }
    if ((buf + '\n\n' + piece).trim().length > size && buf) {
      chunks.push(buf.trim());
      buf = buf.slice(-overlap) + '\n\n' + piece;
    } else {
      buf = buf ? `${buf}\n\n${piece}` : piece;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.filter(Boolean);
}

export type KbLlmChannel = {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 渠道协议：Claude 走 Messages API，其余一律 OpenAI 兼容。 */
  protocol?: 'openai' | 'anthropic';
};

/**
 * LLM 通道解析（薄适配）：取模型已收口到统一 AI 网关——本轮/模块默认 →
 * 账号「模型设置」默认渠道 → RPA·Workbuddy 历史口径。解析不出通道返回 null，
 * 调用方按既有口径走规则式回落。
 */
export async function resolveKbLlm(
  prisma: PrismaService,
  userId: string,
): Promise<KbLlmChannel | null> {
  // 主开关/限流与网关同口径；静默链路被拒时回落规则式，不影响业务主流程。
  if (await aiGuardDeny(userId)) return null;
  const resolved = await resolveModel(prisma, { userId });
  if (!resolved) return null;
  return {
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    model: resolved.model,
    protocol: resolved.protocol,
  };
}

/** 统一出口：命中通道才请求；异常吞掉返回 null（回落规则式，绝不抛穿）。 */
export async function kbChatMulti(
  channel: KbLlmChannel | null,
  messages: ChatMessage[],
  userId: string,
  maxTokens = 1500,
): Promise<(GeoChatResult & { model: string }) | null> {
  if (!channel) return null;
  try {
    const result = await geoChatMulti({
      baseUrl: channel.baseUrl,
      apiKey: channel.apiKey,
      model: channel.model,
      messages,
      maxTokens,
      timeoutMs: 60_000,
      userId,
      api: channel.protocol === 'anthropic' ? 'anthropic' : 'openai',
    });
    return { ...result, model: channel.model };
  } catch {
    return null;
  }
}

export { parseJsonObject } from '../ai/ai-gateway';

/** 内容指纹（源去重）：sha256 十六进制。 */
export const sha256Hex = (s: string): string =>
  createHash('sha256')
    .update(String(s ?? ''), 'utf8')
    .digest('hex');
