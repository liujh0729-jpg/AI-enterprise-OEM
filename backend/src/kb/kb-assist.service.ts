import type { CurrentUser } from '../auth/current-user';
import type { AiEvalService } from '../ai/ai-eval.service';
import type { PrismaService } from '../prisma/prisma.service';
import { kbChatMulti, resolveKbLlm } from './kb-llm';
import type {
  KbRetrieveService,
  RetrieveConsumerType,
} from './kb-retrieve.service';

/**
 * 业务板块知识增强（AI 底座 §5 P1-A 统一挂载）：
 * kb_consumers 从「只授读写」升级为「业务模块可绑定空间并召回」——专题厅/法务/出海/客服
 * 各自把空间绑到自己的 consumerType 上（Kb_bindConsumer），调用本服务即可做
 * 「先召回、再综合」，不必各自实现一遍检索+拼上下文+计费。
 * LLM 未配置时按摘录拼接作答（确定可验收），与 Kb ask 同一口径。
 */

export interface AssistInput {
  question: string;
  spaceIds?: number[];
  consumerType?: RetrieveConsumerType;
  consumerId?: string;
  topK?: number;
}

export interface AssistOptions {
  /** 板块系统提示词（各模块自己的口径）；缺省按 consumerType 取板块口径 */
  system?: string;
  /** 计费备注里的模块名 */
  module?: string;
}

/** 各板块口径（统一挂载：同一实现，按 consumerType 取对应提示词与模块名）。 */
export const MODULE_ASSIST_PROMPTS: Record<string, string> = {
  SERVICE_DESK:
    '你是企业客服助手。只依据给定资料回答，不承诺价格/合同/赔付/时效，不编造；不确定就请对方补充信息或留联系方式。观点后用 [编号] 标注引用。',
  THINK_TANK:
    '你是行业专题顾问。只依据给定资料回答，观点后用 [编号] 标注引用；资料不足时明说还缺哪方面信息。',
  LEGAL:
    '你是企业法务辅助。只依据给定资料梳理要点，明确说明这只是一般信息整理、不构成正式法律意见；观点后用 [编号] 标注引用。',
  OVERSEAS:
    '你是出海业务顾问。只依据给定资料回答，涉及各国法规/税务/合规时说明仅供参考、以当地最新规定为准；观点后用 [编号] 标注引用。',
};
const DEFAULT_ASSIST_PROMPT =
  '你是企业业务助手。只依据给定资料回答，观点后用 [编号] 标注引用；资料不足时明说缺什么。输出中文。';

export class KbAssistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly getRetrieve: () => KbRetrieveService,
    private readonly getAiEval: () => AiEvalService,
  ) {}

  async assist(
    user: CurrentUser,
    input: AssistInput,
    options: AssistOptions = {},
  ) {
    const topK = Math.max(1, Math.min(20, input.topK || 6));
    const found = await this.getRetrieve().retrieve(user, {
      query: input.question,
      spaceIds: input.spaceIds,
      consumerType: input.consumerType,
      consumerId: input.consumerId,
      topK,
      maxChars: 3000,
    });
    const citations = found.snippets.map((snippet) => ({
      source: snippet.source,
      title: snippet.title,
      ref: snippet.ref,
      excerpt: snippet.text,
    }));
    if (!found.snippets.length) {
      return {
        answer:
          '知识库里没有检索到相关内容；可先到「知识库」投料，或把本板块绑定的知识空间补上资料。',
        mode: 'extractive' as const,
        citations,
        spaces: found.spaces,
      };
    }
    const channel = await resolveKbLlm(this.prisma, user.userId);
    let answer = '';
    let mode: 'llm' | 'extractive' = 'extractive';
    let usage: { call: number; tokenIn?: number; tokenOut?: number } = {
      call: 1,
    };
    if (channel) {
      const context = found.snippets
        .map(
          (snippet, index) =>
            `[${index + 1}] ${snippet.title}\n${snippet.text}`,
        )
        .join('\n\n');
      const result = await kbChatMulti(
        channel,
        [
          {
            role: 'system',
            content:
              options.system ||
              (input.consumerType
                ? MODULE_ASSIST_PROMPTS[input.consumerType]
                : '') ||
              DEFAULT_ASSIST_PROMPT,
          },
          {
            role: 'user',
            content: `问题：${input.question}\n\n资料：\n${context}`,
          },
        ],
        user.userId,
        1200,
      );
      if (result) {
        answer = result.reply.trim();
        mode = 'llm';
        usage = {
          call: 1,
          tokenIn: result.promptTokens,
          tokenOut: result.completionTokens,
        };
      }
    }
    if (!answer) {
      answer = found.snippets
        .map(
          (snippet, index) =>
            `[${index + 1}] ${snippet.title}：${snippet.text}`,
        )
        .join('\n');
    }
    try {
      await this.getAiEval().chargeByUsage(
        user.userId,
        'kb_query',
        usage,
        `kb-assist:${options.module || 'module'}`,
      );
    } catch {
      // 辅助链路计费失败不阻断作答
    }
    return { answer, mode, citations, spaces: found.spaces };
  }
}
