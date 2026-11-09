import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { pageOf } from '../common/api';
import type { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma';
import type { HrmOrg } from '../hrm/hrm.scope';
import { iso } from '../hrm/hrm.helpers';
import { aiJson } from '../ai/ai-gateway';
import type { AiEvalService } from '../ai/ai-eval.service';
import { ScrmScopeService } from './scrm.scope';
import { ScrmSopService } from './scrm-sop.service';
import { clip, int, orgKey, safePage, text } from './scrm.helpers';

/**
 * 合规：敏感词与质检。
 * - 出站：BLOCK 直接拦下、REPLACE 改写后放行、ALERT 只留痕；
 * - 入站：只告警留痕，绝不影响客户消息；
 * - 质检：有模型走模型、无模型用可解释规则，两种模式返回同构结果。
 */

type Direction = 'INBOUND' | 'OUTBOUND' | 'CHAT';

type InspectInput = {
  texts: string[];
  direction: Direction;
  contactId?: number;
  contactName?: string;
  staffUserId?: string;
  record?: boolean;
};

export type InspectResult = {
  blocked: boolean;
  texts: string[];
  replaced: string;
  hits: { word: string; action: string; group: string }[];
};

const QC_DIMENSIONS = [
  { key: 'PROFILE', label: '资料完整', max: 25 },
  { key: 'ENGAGEMENT', label: '互动深度', max: 25 },
  { key: 'RISK', label: '风险合规', max: 25 },
  { key: 'FOLLOWUP', label: '跟进及时', max: 25 },
];

const QC_SYSTEM = [
  '你是企业微信客户运营质检员。按四个维度各 0-25 分评分，只输出 JSON：',
  '{"dimensions":[{"key":"PROFILE","score":0,"note":"依据"},…],"highlights":["亮点"],"suggestions":["建议"]}',
  '维度固定为：PROFILE 资料完整、ENGAGEMENT 互动深度、RISK 风险合规、FOLLOWUP 跟进及时。',
  '评分要有依据，不要编造会话里没有的内容。',
].join('\n');

export class ScrmComplianceService {
  private readonly warned = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScrmScopeService,
    private readonly sops: ScrmSopService,
    private readonly aiEval: AiEvalService,
  ) {}

  private wordView(row: {
    id: number;
    groupName: string;
    word: string;
    action: string;
    direction: string;
    replacement: string;
    enabled: boolean;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      group: row.groupName,
      word: row.word,
      action: row.action,
      direction: row.direction,
      replacement: row.replacement,
      enabled: row.enabled,
      createdAt: iso(row.createdAt),
    };
  }

  async words(user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const rows = await this.prisma.scrmSensitiveWord.findMany({
      where: orgKey(org),
      orderBy: [{ direction: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.wordView(row));
  }

  async saveWord(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const id = int(body.id);
    const word = clip(body.word, 100).trim();
    if (!word) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写敏感词');
    }
    const direction = text(body.direction).toUpperCase() || 'OUTBOUND';
    if (!['INBOUND', 'OUTBOUND', 'CHAT'].includes(direction)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '敏感词方向不合法');
    }
    const action = text(body.action).toUpperCase() || 'BLOCK';
    if (!['ALERT', 'BLOCK', 'REPLACE'].includes(action)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '敏感词动作不合法');
    }
    const replacement = clip(body.replacement, 100);
    if (action === 'REPLACE' && !replacement.trim()) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '替换动作必须填写替换后的文本',
      );
    }
    const data = {
      groupName: clip(body.group, 40),
      word,
      action,
      direction,
      replacement,
      enabled: body.enabled !== false,
    };
    let row;
    if (id) {
      const existing = await this.prisma.scrmSensitiveWord.findFirst({
        where: { ...orgKey(org), id },
      });
      if (!existing) {
        throw new BusinessException(ErrorCode.NOT_FOUND, '敏感词不存在');
      }
      row = await this.prisma.scrmSensitiveWord.update({
        where: { id: existing.id },
        data,
      });
    } else {
      row = await this.prisma.scrmSensitiveWord.upsert({
        where: {
          orgType_orgUserId_word_direction: {
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            word,
            direction,
          },
        },
        create: { ...orgKey(org), createdBy: user.userId, ...data },
        update: data,
      });
    }
    return this.wordView(row);
  }

  async removeWord(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const id = int(body.id);
    const row = await this.prisma.scrmSensitiveWord.findFirst({
      where: { ...orgKey(org), id },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '敏感词不存在');
    }
    await this.prisma.scrmSensitiveWord.delete({ where: { id: row.id } });
    return { id: row.id };
  }

  async hits(user: CurrentUser, query: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const { page, pageSize, offset } = safePage(query.page, query.pageSize, 20);
    const where: Prisma.ScrmSensitiveHitWhereInput = { ...orgKey(org) };
    const direction = text(query.direction).toUpperCase();
    if (direction) where.direction = direction;
    const [total, rows] = await Promise.all([
      this.prisma.scrmSensitiveHit.count({ where }),
      this.prisma.scrmSensitiveHit.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
    ]);
    return pageOf(
      rows.map((row) => ({
        id: row.id,
        word: row.word,
        group: row.groupName,
        direction: row.direction,
        contactId: row.contactId,
        contactName: row.contactName,
        text: row.text,
        createdAt: iso(row.createdAt),
      })),
      total,
      page,
      pageSize,
    );
  }

  /** 手动试检：只返回命中结论，不写命中台账（台账只记真实消息）。 */
  async checkText(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const direction = (text(body.direction).toUpperCase() ||
      'OUTBOUND') as Direction;
    const result = await this.inspect(org, {
      texts: [clip(body.text, 4000)],
      direction,
      record: false,
    });
    return {
      blocked: result.blocked,
      replaced: result.replaced,
      hits: result.hits,
    };
  }

  /**
   * 内部检查：出站 BLOCK 拦截、REPLACE 改写；入站/群聊只记录告警。
   * 每次命中按词写一条台账，最多 20 条，正文截断到 2000 字。
   */
  async inspect(org: HrmOrg, input: InspectInput): Promise<InspectResult> {
    const direction = input.direction;
    const scopes =
      direction === 'CHAT'
        ? ['CHAT', 'OUTBOUND', 'INBOUND']
        : [direction, 'CHAT'];
    const words = await this.prisma.scrmSensitiveWord.findMany({
      where: {
        ...orgKey(org),
        enabled: true,
        direction: { in: scopes },
      },
    });
    let texts = input.texts.map((item) => String(item || ''));
    const hits: { word: string; action: string; group: string }[] = [];
    let blocked = false;
    for (const word of words) {
      if (!texts.some((item) => item.includes(word.word))) continue;
      // 入站只告警：无论词条配置什么动作，都不能改动或阻断客户消息
      const action = direction === 'OUTBOUND' ? word.action : 'ALERT';
      if (action === 'BLOCK') blocked = true;
      if (action === 'REPLACE' && word.replacement) {
        texts = texts.map((item) =>
          item.split(word.word).join(word.replacement),
        );
      }
      hits.push({ word: word.word, action, group: word.groupName });
    }
    if (hits.length && input.record !== false) {
      const contactName =
        input.contactName || (await this.contactName(org, input.contactId));
      const body = clip(texts.join('\n'), 2000);
      await this.prisma.scrmSensitiveHit.createMany({
        data: hits.slice(0, 20).map((hit) => ({
          ...orgKey(org),
          word: clip(hit.word, 100),
          groupName: clip(hit.group, 40),
          direction,
          contactId: input.contactId || 0,
          contactName: clip(contactName, 120),
          staffUserId: clip(input.staffUserId || '', 64),
          text: body,
        })),
      });
      if (direction === 'INBOUND' && input.contactId) {
        await this.sops.triggerKeyword(
          org,
          input.contactId,
          hits.map((hit) => hit.word),
          input.staffUserId || '',
        );
      }
    }
    return { blocked, texts, replaced: texts[0] || '', hits };
  }

  /** 出站发送前置闸：命中 BLOCK 直接拒绝发送，REPLACE 返回改写后的文本。 */
  async outbound(
    org: HrmOrg,
    texts: string[],
    meta: {
      contactId?: number;
      contactName?: string;
      staffUserId?: string;
    } = {},
  ): Promise<string[]> {
    const result = await this.inspect(org, {
      texts,
      direction: 'OUTBOUND',
      ...meta,
    });
    if (result.blocked) {
      const words = [...new Set(result.hits.map((hit) => hit.word))].join('、');
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `内容命中敏感词（${words}），已拦截发送`,
      );
    }
    return result.texts;
  }

  private async contactName(org: HrmOrg, contactId?: number): Promise<string> {
    if (!contactId) return '';
    const row = await this.prisma.scrmContact.findFirst({
      where: { ...orgKey(org), id: contactId },
      select: { name: true, remark: true, externalUserId: true },
    });
    return row?.name || row?.remark || row?.externalUserId || '';
  }

  /** 客户质检：四维各 25 分；有模型走模型，无模型用规则，结果同构。 */
  async qc(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const contactId = int(body.contactId);
    const inputText = clip(body.text, 20000);
    let contact: {
      name: string;
      remark: string;
      description: string;
      region: string;
      lastInteractionAt: Date | null;
      addedAt: Date | null;
    } | null = null;
    let timelineText = '';
    if (contactId) {
      const row = await this.prisma.scrmContact.findFirst({
        where: { ...orgKey(org), id: contactId },
      });
      if (!row) {
        throw new BusinessException(
          ErrorCode.NOT_FOUND,
          '客户不存在或不属于本组织',
        );
      }
      contact = row;
      const events = await this.prisma.scrmTimelineEvent.findMany({
        where: { ...orgKey(org), contactId },
        orderBy: { at: 'desc' },
        take: 30,
      });
      timelineText = events
        .map(
          (event) => `${event.title}${event.detail ? `：${event.detail}` : ''}`,
        )
        .join('\n');
    }
    const source = [inputText, timelineText].filter(Boolean).join('\n');
    if (!source.trim()) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择客户或粘贴要质检的聊天内容',
      );
    }
    const rule = await this.ruleQc(org, contactId, contact, source, inputText);
    const ai = await aiJson<{
      score: number;
      dimensions: { key: string; label: string; score: number }[];
      highlights: string[];
      suggestions: string[];
    }>(this.prisma, {
      userId: user.userId,
      messages: [
        { role: 'system', content: QC_SYSTEM },
        {
          role: 'user',
          content: clip(
            [
              contact
                ? `客户：${contact.name || contact.remark || '未命名'}`
                : '客户：未指定',
              '会话/跟进记录：',
              source,
            ].join('\n\n'),
            12000,
          ),
        },
      ],
      purpose: 'batch',
      module: 'wecom-scrm',
      operation: 'qc_review',
      charge: { code: 'scrm_qc', refId: String(contactId || 0) },
      validate: (raw) => validateQc(raw, rule),
    });
    if (!ai) {
      await this.aiEval
        .chargeByUsage(
          user.userId,
          'scrm_qc',
          { call: 1 },
          String(contactId || 0),
          {
            module: 'wecom-scrm',
            operation: 'qc_review_rule',
          },
        )
        .catch((error) => this.warnOnce('scrm_qc_charge', error));
    }
    return ai ? { ...ai.data, source: 'LLM' } : { ...rule, source: 'RULE' };
  }

  private async ruleQc(
    org: HrmOrg,
    contactId: number,
    contact: {
      name: string;
      remark: string;
      description: string;
      region: string;
      lastInteractionAt: Date | null;
      addedAt: Date | null;
    } | null,
    source: string,
    chatText: string,
  ) {
    const fieldCount = contactId
      ? await this.prisma.scrmContactFieldValue.count({
          where: { ...orgKey(org), contactId },
        })
      : 0;
    const filled =
      (contact?.remark ? 1 : 0) +
      (contact?.description ? 1 : 0) +
      (contact?.region ? 1 : 0) +
      fieldCount;
    const profile = contact
      ? Math.min(25, 8 + filled * 3)
      : Math.min(25, 8 + Math.min(5, Math.floor(source.length / 80)));

    const events = contactId
      ? await this.prisma.scrmTimelineEvent.count({
          where: {
            ...orgKey(org),
            contactId,
            at: { gte: new Date(Date.now() - 30 * 86_400_000) },
          },
        })
      : 0;
    const engagement = contact
      ? Math.min(25, 6 + events * 2 + (chatText ? 4 : 0))
      : Math.min(25, 6 + Math.floor(source.length / 200));

    const words = await this.prisma.scrmSensitiveWord.findMany({
      where: { ...orgKey(org), enabled: true },
      select: { word: true },
    });
    const hitWords = words
      .map((row) => row.word)
      .filter((word) => word && source.includes(word));
    const risk = Math.max(0, 25 - hitWords.length * 8);

    const last = contact?.lastInteractionAt || contact?.addedAt || null;
    const ageDays = last ? (Date.now() - last.getTime()) / 86_400_000 : 999;
    const followup =
      ageDays <= 1
        ? 25
        : ageDays <= 3
          ? 20
          : ageDays <= 7
            ? 14
            : ageDays <= 30
              ? 8
              : 3;

    const highlights: string[] = [];
    if (filled >= 5) highlights.push(`客户资料已填写 ${filled} 项，信息较完整`);
    if (events >= 5) highlights.push(`近 30 天有 ${events} 条互动记录`);
    if (!hitWords.length) highlights.push('近期内容未命中敏感词');
    if (ageDays <= 1) highlights.push('最近一天内有过跟进互动');

    const suggestions: string[] = [];
    if (filled < 3)
      suggestions.push(
        '补齐客户行业、需求、预算等资料卡字段，便于后续分层运营。',
      );
    if (events < 3)
      suggestions.push('增加有效互动：按 SOP 待办发送素材或约一次需求确认。');
    if (hitWords.length) {
      suggestions.push(
        `避免使用敏感表述：${[...new Set(hitWords)].join('、')}。`,
      );
    }
    if (ageDays > 7)
      suggestions.push('客户已超过一周未互动，建议用素材库内容重新激活。');

    const dims = {
      PROFILE: profile,
      ENGAGEMENT: engagement,
      RISK: risk,
      FOLLOWUP: followup,
    };
    return {
      score: QC_DIMENSIONS.reduce(
        (sum, dimension) =>
          sum + (dims[dimension.key as keyof typeof dims] || 0),
        0,
      ),
      dimensions: QC_DIMENSIONS.map((dimension) => ({
        key: dimension.key,
        label: dimension.label,
        score: dims[dimension.key as keyof typeof dims] || 0,
      })),
      highlights: highlights.slice(0, 5),
      suggestions: suggestions.slice(0, 5),
    };
  }

  private warnOnce(key: string, error: unknown) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(
      JSON.stringify({
        event: 'scrm_compliance_warning',
        key,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/** 模型结果校验：四维必须齐全，缺失维度回落规则分；越界一律收敛。 */
function validateQc(
  raw: Record<string, unknown>,
  rule: {
    score: number;
    dimensions: { key: string; label: string; score: number }[];
    highlights: string[];
    suggestions: string[];
  },
) {
  const list = Array.isArray(raw.dimensions) ? raw.dimensions : [];
  const byKey = new Map(
    list.map((item) => {
      const row =
        item && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : {};
      return [text(row.key).toUpperCase(), row] as const;
    }),
  );
  const fallback = new Map(
    rule.dimensions.map((item) => [item.key, item.score]),
  );
  const dimensions = QC_DIMENSIONS.map((dimension) => {
    const row = byKey.get(dimension.key);
    return {
      key: dimension.key,
      label: dimension.label,
      score: Math.min(
        dimension.max,
        Math.max(0, int(row?.score, fallback.get(dimension.key) || 0)),
      ),
    };
  });
  const highlights = (Array.isArray(raw.highlights) ? raw.highlights : [])
    .map((item) => clip(text(item), 200))
    .filter(Boolean)
    .slice(0, 5);
  const suggestions = (Array.isArray(raw.suggestions) ? raw.suggestions : [])
    .map((item) => clip(text(item), 200))
    .filter(Boolean)
    .slice(0, 5);
  return {
    score: dimensions.reduce((sum, item) => sum + item.score, 0),
    dimensions,
    highlights,
    suggestions,
  };
}
