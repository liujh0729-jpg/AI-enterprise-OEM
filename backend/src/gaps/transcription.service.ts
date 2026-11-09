import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { ContentMediaService } from '../content/content-media.service';
import { aiJson } from '../ai/ai-gateway';
import type { GapScopeService } from './gaps.scope';
import {
  asInt,
  asText,
  clip,
  iso,
  json,
  jsonBlock,
  pageParams,
  Row,
  safeStatus,
} from './gaps.helpers';

type TranscriptRow = {
  id: number;
  targetType: string;
  targetId: number;
  title: string;
  audioName: string;
  durationSec: number;
  language: string;
  transcript: string;
  summary: string;
  insights: unknown;
  model: string;
  status: string;
  createdAt: Date;
};

const TARGETS = ['INTERVIEW', 'MEETING', 'SERVICE', 'OTHER'] as const;
const TARGET_LABELS: Record<string, string> = {
  INTERVIEW: '面试',
  MEETING: '会议',
  SERVICE: '客服会话',
  OTHER: '其他',
};
const DIMENSIONS = [
  'HARD_SKILL',
  'SOFT',
  'EXPERIENCE',
  'STABILITY',
  'CULTURE',
  'WILL',
] as const;
const DIMENSION_LABELS: Record<string, string> = {
  HARD_SKILL: '专业技能',
  SOFT: '通用素质',
  EXPERIENCE: '经验匹配',
  STABILITY: '稳定性',
  CULTURE: '文化契合',
  WILL: '求职意愿',
};

/**
 * B2#16 会话语音转写：音频地址 → 统一 ASR 网关 → 逐字稿 + AI 摘要/行动项。
 * 音频不落盘，只存正文与结构化摘要；面试转写可一键写成面试维度评分供人工复核。
 */
export class TranscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: GapScopeService,
    private readonly media: ContentMediaService,
  ) {}

  private view(row: TranscriptRow) {
    const insights = jsonBlock(row.insights);
    return {
      id: row.id,
      targetType: row.targetType,
      targetTypeLabel: TARGET_LABELS[row.targetType] || row.targetType,
      targetId: row.targetId,
      title: row.title,
      audioName: row.audioName,
      durationSec: row.durationSec,
      language: row.language,
      transcript: row.transcript,
      summary: row.summary,
      insights,
      model: row.model,
      status: row.status,
      createdAt: iso(row.createdAt),
    };
  }

  async transcripts(user: CurrentUser, query: Row) {
    const org = await this.scope.resolve(user);
    const { page, pageSize, offset } = pageParams(query);
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(asText(query.targetType).trim()
        ? { targetType: asText(query.targetType).trim().toUpperCase() }
        : {}),
      ...(asInt(query.targetId) > 0 ? { targetId: asInt(query.targetId) } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.aiTranscript.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: pageSize,
      }),
      this.prisma.aiTranscript.count({ where }),
    ]);
    return { list: rows.map((row) => this.view(row)), total, page, pageSize };
  }

  private async owned(user: CurrentUser, idRaw: string | number) {
    const org = await this.scope.resolve(user);
    const row = await this.prisma.aiTranscript.findFirst({
      where: {
        id: asInt(idRaw),
        orgType: org.orgType,
        orgUserId: org.orgUserId,
      },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '转写记录不存在');
    return { org, row };
  }

  async transcript(user: CurrentUser, idRaw: string) {
    const { row } = await this.owned(user, idRaw);
    return this.view(row);
  }

  async create(user: CurrentUser, body: Row) {
    const org = await this.scope.resolve(user);
    const mediaUrl = asText(body.mediaUrl).trim();
    if (!/^https?:\/\//i.test(mediaUrl)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写可访问的音频地址（http/https）',
      );
    }
    const title = clip(body.title, 120).trim();
    if (!title)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写转写标题');
    const targetType = safeStatus(body.targetType, TARGETS, 'OTHER');
    const result = await this.media.transcribe(user, undefined, {
      mediaUrl,
      language: asText(body.language).trim() || undefined,
    });
    const row = await this.prisma.aiTranscript.create({
      data: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        targetType,
        targetId: asInt(body.targetId),
        title,
        audioName: clip(body.audioName, 200),
        durationSec: Math.max(0, asInt(body.durationSec)),
        language: asText(body.language).trim() || 'zh',
        transcript: String(result.text || ''),
        status: 'DONE',
        createdBy: org.actorId,
      },
    });
    return this.view(row);
  }

  async summarize(user: CurrentUser, idRaw: string, body: Row) {
    const { org, row } = await this.owned(user, idRaw);
    const prompt = clip(body.prompt, 2000).trim();
    const ask = [
      '你是会议/面试记录助手。请阅读逐字稿，输出 JSON：',
      '{"summary": "200字以内中文摘要", "highlights": ["要点"], "actionItems": ["待办"], "dimensions": {"HARD_SKILL": {"score": 0-5, "note": "依据"}}}',
      'dimensions 仅当这是面试转写且逐字稿里有足够信息时给出；不确定就省略。',
      prompt ? `补充要求：${prompt}` : '',
      `逐字稿：\n${row.transcript.slice(0, 12000)}`,
    ]
      .filter(Boolean)
      .join('\n');
    const parsed = await aiJson<Row>(this.prisma, {
      userId: org.actorId,
      module: 'ai',
      operation: 'transcript_summarize',
      messages: [
        { role: 'system', content: '只输出 JSON 对象，不要解释。' },
        { role: 'user', content: ask },
      ],
      maxTokens: 1200,
    });
    const data = parsed?.data || {};
    const summary =
      clip(data.summary, 2000) || this.fallbackSummary(row.transcript);
    const highlights = Array.isArray(data.highlights)
      ? data.highlights
          .map((item) => clip(item, 200))
          .filter(Boolean)
          .slice(0, 20)
      : [];
    const actionItems = Array.isArray(data.actionItems)
      ? data.actionItems
          .map((item) => clip(item, 200))
          .filter(Boolean)
          .slice(0, 20)
      : [];
    const dimensions = jsonBlock(data.dimensions);
    const updated = await this.prisma.aiTranscript.update({
      where: { id: row.id },
      data: {
        summary,
        insights: json({ highlights, actionItems, dimensions }),
        model: parsed?.model || row.model,
      },
    });
    return this.view(updated);
  }

  private fallbackSummary(transcript: string): string {
    const text = String(transcript || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return '逐字稿为空，暂无可摘要内容。';
    return text.slice(0, 200) + (text.length > 200 ? '…' : '');
  }

  async applyInterviewDraft(user: CurrentUser, idRaw: string, body: Row) {
    const { org, row } = await this.owned(user, idRaw);
    if (row.targetType !== 'INTERVIEW' || !row.targetId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '只有关联面试的转写才能写入面试评分',
      );
    }
    const interviewId = asInt(body.interviewId) || row.targetId;
    const interview = await this.prisma.hrmInterview.findFirst({
      where: {
        id: interviewId,
        orgType: org.orgType,
        orgUserId: org.orgUserId,
      },
    });
    if (!interview)
      throw new BusinessException(ErrorCode.NOT_FOUND, '面试记录不存在');
    const dimensions = jsonBlock(jsonBlock(row.insights).dimensions);
    const ratings: { dimension: string; score: number; note: string }[] = [];
    for (const dimension of DIMENSIONS) {
      const item = jsonBlock(dimensions[dimension]);
      const score = Number(item.score);
      if (!Number.isFinite(score) || score <= 0) continue;
      ratings.push({
        dimension,
        score: Math.min(5, Math.max(0.5, Number(score.toFixed(1)))),
        note: clip(item.note, 500) || DIMENSION_LABELS[dimension],
      });
    }
    if (!ratings.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '转写摘要里没有维度评分，请先执行「AI 摘要」再写入',
      );
    }
    const raterUserId = asText(body.interviewerUserId).trim() || org.actorId;
    for (const rating of ratings) {
      await this.prisma.hrmInterviewRating.upsert({
        where: {
          interviewId_raterUserId_dimension: {
            interviewId,
            raterUserId,
            dimension: rating.dimension,
          },
        },
        create: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          interviewId,
          raterUserId,
          dimension: rating.dimension,
          score: rating.score,
          note: rating.note,
        },
        update: { score: rating.score, note: rating.note },
      });
    }
    return { ratings };
  }

  async remove(user: CurrentUser, idRaw: string) {
    const { row } = await this.owned(user, idRaw);
    await this.prisma.aiTranscript.delete({ where: { id: row.id } });
    return { removed: true };
  }
}
