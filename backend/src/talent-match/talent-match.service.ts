import { kbChatMulti, parseJsonObject, resolveKbLlm } from '../kb/kb-llm';
import type { PrismaService } from '../prisma/prisma.service';
import { ensureActiveRubric } from './talent-match.rubric';
import {
  finalizeLlmJson,
  ruleEvaluate,
  type ResumeFact,
  type TalentEvalResult,
} from './talent-match.scoring';

/**
 * talent-match 共享服务（§12.9.1 单一实现点）：雇主侧 hrm.ai 与候选人侧代投同调此服务。
 * 入参双向对称且只喂结构化事实（降注入面，对齐 §5.11.2）；
 * LLM 只做证据抽取与维度评分，分档/阈值/矩阵完整性由 scoring 代码裁决；
 * 未配 Key 走规则式回落（确定性可验收），token 用量回传给出账方计费。
 */

export type TalentMatchInput = {
  personSide: { items: ResumeFact[]; skills: string[]; summary?: string };
  positionSide: { title: string; jd: string; tier?: string };
  rubricCode?: string;
};
export type TalentMatchOutcome = {
  result: TalentEvalResult;
  usage: { call: number; tokenIn?: number; tokenOut?: number };
};

export class TalentMatchService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(
    input: TalentMatchInput,
    userId: string,
  ): Promise<TalentMatchOutcome> {
    const rubric = await ensureActiveRubric(this.prisma, input.rubricCode);
    const items = (input.personSide.items || []).map((i) => ({
      id: String(i.id),
      kind: String(i.kind || 'SKILL'),
      title: String(i.title || '').slice(0, 200),
      detail: String(i.detail || '').slice(0, 2000),
      period: String(i.period || '').slice(0, 64),
    }));
    const rule = ruleEvaluate({
      jd: input.positionSide.jd,
      items,
      skills: input.personSide.skills || [],
      rubric,
    });
    const channel = await resolveKbLlm(this.prisma, userId);
    if (!channel) return { result: rule.result, usage: { call: 0 } };
    // 规则矩阵先行入 prompt：模型只在给定要求与条目上补证据，不得新造
    const messages = [
      { role: 'system' as const, content: rubric.promptDigest },
      {
        role: 'user' as const,
        content: JSON.stringify(
          {
            position: {
              title: input.positionSide.title,
              tier: input.positionSide.tier || '',
            },
            requirements: rule.matrix.map((m) => m.requirement),
            resumeItems: items,
            skills: input.personSide.skills || [],
            summary: input.personSide.summary || '',
          },
          null,
          0,
        ),
      },
    ];
    const reply = await kbChatMulti(channel, messages, userId, 1200);
    if (!reply?.reply) return { result: rule.result, usage: { call: 1 } };
    const json = parseJsonObject(reply.reply);
    const finalized = json ? finalizeLlmJson(json, { items, rubric }) : null;
    const usage = {
      call: 1,
      tokenIn: reply.promptTokens || undefined,
      tokenOut: reply.completionTokens || undefined,
    };
    return {
      result: finalized ?? rule.result,
      usage,
    };
  }
}
