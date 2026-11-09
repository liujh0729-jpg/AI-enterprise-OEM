import {
  ACQ_PLAYBOOK_STATUSES,
  acqPlaybookBoundariesSchema,
  acqPlaybookEscalationSchema,
  acqPlaybookOpenerSchema,
  acqPlaybookObjectionSchema,
  acqPlaybookPersonaSchema,
} from '@enterprise/contracts';
import { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmOrg } from '../hrm/hrm.scope';
import type { KbRetrieveService } from '../kb/kb-retrieve.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { aiJson } from '../ai/ai-gateway';
import { AcquisitionSettingsService } from './acquisition-settings.service';
import { AcquisitionRadarService } from './radar.service';
import { AcquisitionProfileService } from './profile.service';
import {
  clip,
  int,
  intArr,
  iso,
  json,
  oneOf,
  orgKey,
  pageArgs,
  pageResult,
  strArr,
  text,
  type OrgKey,
  type Row,
} from './acquisition.helpers';
import { wrapUntrusted } from './acquisition-scoring';

type PlaybookRow = {
  id: number;
  orgType: string;
  orgUserId: string;
  name: string;
  goal: string;
  persona: unknown;
  boundaries: unknown;
  escalation: unknown;
  openers: unknown;
  objections: unknown;
  kbIds: unknown;
  faqIds: unknown;
  status: string;
  currentVersion: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

const asRecord = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : {};

const asList = (value: unknown): Row[] =>
  Array.isArray(value) ? value.map((item) => asRecord(item)) : [];

/** 库里可能是旧版形状：读出来统一按契约补齐，不让 serializeResponse 因缺字段整批失败。 */
const personaOf = (value: unknown) =>
  acqPlaybookPersonaSchema.parse({ ...asRecord(value) });
const boundariesOf = (value: unknown) =>
  acqPlaybookBoundariesSchema.parse({ ...asRecord(value) });
const escalationOf = (value: unknown) =>
  acqPlaybookEscalationSchema.parse({ ...asRecord(value) });
const openersOf = (value: unknown) =>
  asList(value)
    .map((item) => acqPlaybookOpenerSchema.safeParse(item))
    .filter((result) => result.success)
    .map((result) => result.data);
const objectionsOf = (value: unknown) =>
  asList(value)
    .map((item) => acqPlaybookObjectionSchema.safeParse(item))
    .filter((result) => result.success)
    .map((result) => result.data);

const BOUNDARY_LABELS: Record<string, string> = {
  noPricePromise: '不承诺价格/优惠',
  noTimelinePromise: '不承诺工期/时效',
  noCompensationPromise: '不承诺赔偿/退款',
  noCustomPromise: '不承诺定制化能力',
  noFabricatedCases: '不编造案例与数据',
};

export class AcquisitionPlaybookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AcquisitionSettingsService,
    private readonly radar: AcquisitionRadarService,
    private readonly profiles: AcquisitionProfileService,
    private readonly kb: KbRetrieveService,
  ) {}

  async list(user: CurrentUser, query: Row) {
    const org = await this.settings.org(user);
    const args = pageArgs(query);
    const q = text(query.q).trim();
    const where = {
      ...orgKey(org),
      ...(text(query.status) ? { status: text(query.status) } : {}),
      ...(q ? { name: { contains: q } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.acqPlaybook.count({ where }),
      this.prisma.acqPlaybook.findMany({
        where,
        orderBy: [{ status: 'asc' }, { id: 'desc' }],
        skip: args.skip,
        take: args.take,
      }),
    ]);
    return pageResult(
      rows.map((row) => this.view(row as PlaybookRow)),
      total,
      args,
    );
  }

  async save(user: CurrentUser, body: Row) {
    const org = await this.settings.org(user);
    const name = clip(text(body.name).trim(), 80);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写剧本名称');
    const data = {
      name,
      goal: clip(text(body.goal), 120),
      persona: json(personaOf(body.persona)),
      boundaries: json(boundariesOf(body.boundaries)),
      escalation: json(escalationOf(body.escalation)),
      openers: json(openersOf(body.openers)),
      objections: json(objectionsOf(body.objections)),
      kbIds: json(intArr(body.kbIds)),
      faqIds: json(intArr(body.faqIds)),
      status: oneOf(body.status, ACQ_PLAYBOOK_STATUSES, 'DRAFT'),
    };
    const id = int(body.id);
    try {
      if (id) {
        const row = await this.requirePlaybook(org, id);
        const updated = await this.prisma.acqPlaybook.update({
          where: { id: row.id },
          data,
        });
        return this.view(updated);
      }
      const created = await this.prisma.acqPlaybook.create({
        data: { ...orgKey(org), ...data, createdBy: user.userId },
      });
      return this.view(created);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `已有同名剧本「${name}」，请换一个名称`,
        );
      }
      throw error;
    }
  }

  /** 发布：当前配置存成一份不可变快照，版本号自增；会话固定版本号后不随再发布变化。 */
  async publish(user: CurrentUser, id: number) {
    const org = await this.settings.org(user);
    const row = await this.requirePlaybook(org, id);
    const version = row.currentVersion + 1;
    const snapshot = {
      name: row.name,
      goal: row.goal,
      persona: personaOf(row.persona),
      boundaries: boundariesOf(row.boundaries),
      escalation: escalationOf(row.escalation),
      openers: openersOf(row.openers),
      objections: objectionsOf(row.objections),
      kbIds: intArr(row.kbIds),
      faqIds: intArr(row.faqIds),
    };
    await this.prisma.acqPlaybookVersion.create({
      data: {
        playbookId: row.id,
        version,
        snapshot: json(snapshot),
        publishedAt: new Date(),
        createdBy: user.userId,
      },
    });
    const updated = await this.prisma.acqPlaybook.update({
      where: { id: row.id },
      data: { status: 'PUBLISHED', currentVersion: version },
    });
    return this.view(updated);
  }

  async versions(user: CurrentUser, id: number, query: Row) {
    const org = await this.settings.org(user);
    const row = await this.requirePlaybook(org, id);
    const args = pageArgs(query);
    const [total, rows] = await Promise.all([
      this.prisma.acqPlaybookVersion.count({ where: { playbookId: row.id } }),
      this.prisma.acqPlaybookVersion.findMany({
        where: { playbookId: row.id },
        orderBy: { version: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
    ]);
    return pageResult(
      rows.map((item) => ({
        id: item.id,
        playbookId: item.playbookId,
        version: item.version,
        snapshot: asRecord(item.snapshot),
        publishedAt: item.publishedAt ? iso(item.publishedAt) : '',
        createdBy: item.createdBy,
        createdAt: iso(item.createdAt),
      })),
      total,
      args,
    );
  }

  /**
   * 试运行：拼出实际会下发的提示词，再走统一网关生成一版回复。
   * 没有模型就按剧本里的开场/异议话术兜底，mode=rule 如实标注。
   */
  async preview(user: CurrentUser, id: number, body: Row) {
    const org = await this.settings.org(user);
    const row = await this.requirePlaybook(org, id);
    const version = int(body.version);
    const snapshot = version
      ? await this.snapshotOf(org, row.id, version)
      : null;
    const book = snapshot || {
      name: row.name,
      goal: row.goal,
      persona: personaOf(row.persona),
      boundaries: boundariesOf(row.boundaries),
      escalation: escalationOf(row.escalation),
      openers: openersOf(row.openers),
      objections: objectionsOf(row.objections),
      kbIds: intArr(row.kbIds),
      faqIds: intArr(row.faqIds),
    };
    const message = clip(text(body.customerMessage), 2000);
    const leadId = int(body.leadId);
    const profileId = int(body.profileId);
    const [lead, profile, snippets] = await Promise.all([
      leadId ? this.radar.requireLead(org, leadId).catch(() => null) : null,
      profileId
        ? this.prisma.acqProfile
            .findFirst({
              where: { id: profileId, ...orgKey(org), deletedAt: null },
            })
            .catch(() => null)
        : null,
      this.retrieveKnowledge(org, book, message),
    ]);

    const sections = this.sectionsOf(book, {
      customerMessage: message,
      lead: lead
        ? {
            nickname: lead.nickname,
            platform: lead.platform,
            intentLevel: lead.intentLevel,
            intentTags: strArr(lead.intentTags),
          }
        : null,
      profile: profile
        ? {
            displayName: profile.displayName,
            businessStatus: profile.businessStatus,
            purpose: profile.purpose,
            budget: profile.budget,
            objections: strArr(profile.objections),
          }
        : null,
      snippets,
    });
    const prompt = sections
      .map((item) => `## ${item.name}\n${item.text}`)
      .join('\n\n');

    const ai = await aiJson<{ reply: string }>(this.prisma, {
      userId: user.userId,
      model: (await this.settings.forOrg(org)).aiModel || undefined,
      channelId: (await this.settings.forOrg(org)).aiChannelId || undefined,
      messages: [
        {
          role: 'system',
          content: [
            '你是销售剧本的试运行助手。严格按剧本角色与边界回答客户，不承诺价格/时效/赔付，不编造案例。',
            '只输出一个 JSON 对象：{"reply":"给客户的中文回复"}',
          ].join('\n'),
        },
        { role: 'user', content: prompt },
      ],
      purpose: 'chat',
      module: 'acquisition',
      operation: 'playbook_preview',
      validate: (raw) => {
        const reply = clip(raw.reply, 2000);
        return reply ? { reply } : null;
      },
    });
    if (ai) {
      return {
        prompt,
        sections,
        reply: ai.data.reply,
        mode: 'llm' as const,
        version: version || row.currentVersion,
      };
    }
    return {
      prompt,
      sections,
      reply: this.ruleReply(book, message),
      mode: 'rule' as const,
      version: version || row.currentVersion,
    };
  }

  /** 接待侧复用同一套段落组装：剧本边界 → 知识摘录 → 客户上下文。 */
  async assemble(
    org: HrmOrg | OrgKey,
    playbookId: number,
    version: number,
    input: { customerMessage: string; lead: Row | null; profile: Row | null },
  ) {
    const book = await this.pinnedBook(org, playbookId, version);
    const snippets = await this.retrieveKnowledge(
      org,
      book,
      input.customerMessage,
    );
    return {
      book,
      sections: this.sectionsOf(book, { ...input, snippets }),
    };
  }

  /** 会话固定版本：返回该版本的剧本内容；找不到就按当前配置，不静默换版本。 */
  async pinnedBook(org: HrmOrg | OrgKey, playbookId: number, version: number) {
    const row = await this.requirePlaybook(org, playbookId);
    if (!version) return this.bookOf(row);
    const snapshot = await this.snapshotOf(org, row.id, version);
    return snapshot || this.bookOf(row);
  }

  bookOf(row: PlaybookRow) {
    return {
      name: row.name,
      goal: row.goal,
      persona: personaOf(row.persona),
      boundaries: boundariesOf(row.boundaries),
      escalation: escalationOf(row.escalation),
      openers: openersOf(row.openers),
      objections: objectionsOf(row.objections),
      kbIds: intArr(row.kbIds),
      faqIds: intArr(row.faqIds),
    };
  }

  async requirePlaybook(org: HrmOrg | OrgKey, id: number) {
    const row = await this.prisma.acqPlaybook.findFirst({
      where: { id, ...orgKey(org) },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '销售剧本不存在');
    return row as PlaybookRow;
  }

  private async snapshotOf(
    org: HrmOrg | OrgKey,
    playbookId: number,
    version: number,
  ) {
    const row = await this.prisma.acqPlaybookVersion.findUnique({
      where: { playbookId_version: { playbookId, version } },
    });
    void org;
    if (!row) return null;
    const snapshot = asRecord(row.snapshot);
    if (!Object.keys(snapshot).length) return null;
    return {
      name: text(snapshot.name),
      goal: text(snapshot.goal),
      persona: personaOf(snapshot.persona),
      boundaries: boundariesOf(snapshot.boundaries),
      escalation: escalationOf(snapshot.escalation),
      openers: openersOf(snapshot.openers),
      objections: objectionsOf(snapshot.objections),
      kbIds: intArr(snapshot.kbIds),
      faqIds: intArr(snapshot.faqIds),
    };
  }

  /** 知识绑定：只查剧本挂的知识空间，检索失败不阻断试运行，只少一段参考。 */
  private async retrieveKnowledge(
    org: HrmOrg | OrgKey,
    book: { kbIds: number[] },
    query: string,
  ) {
    if (!book.kbIds.length) return [];
    try {
      const user = userOfOrg(org);
      const found = await this.kb.retrieve(user, {
        query: query || '产品与服务',
        sources: ['kb'],
        spaceIds: book.kbIds,
        topK: 5,
        maxChars: 2000,
      });
      return found.snippets.map((item) => ({
        title: item.title,
        text: clip(item.text, 600),
        ref: item.ref,
      }));
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: 'acquisition_playbook_kb_skipped',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      return [];
    }
  }

  private sectionsOf(
    book: {
      name: string;
      goal: string;
      persona: ReturnType<typeof personaOf>;
      boundaries: ReturnType<typeof boundariesOf>;
      escalation: ReturnType<typeof escalationOf>;
      openers: ReturnType<typeof openersOf>;
      objections: ReturnType<typeof objectionsOf>;
    },
    input: {
      customerMessage: string;
      lead: Row | null;
      profile: Row | null;
      snippets: { title: string; text: string; ref: string }[];
    },
  ) {
    const persona = book.persona;
    const rules = Object.entries(book.boundaries)
      .filter(([key, value]) => key !== 'extra' && value === true)
      .map(([key]) => BOUNDARY_LABELS[key])
      .filter(Boolean);
    const extra = book.boundaries.extra;
    const sections: { name: string; text: string }[] = [
      {
        name: '角色',
        text: [
          `剧本：${book.name}`,
          persona.alias ? `对外称呼：${persona.alias}` : '',
          persona.personality ? `性格：${persona.personality}` : '',
          persona.tone ? `语气：${persona.tone}` : '',
          persona.format ? `回复格式：${persona.format}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
      { name: '目标', text: book.goal || '识别需求，推动下一步。' },
      {
        name: '可以做',
        text: persona.canDo.length
          ? persona.canDo.map((item) => `- ${item}`).join('\n')
          : '- 回答问题并引导下一步',
      },
      {
        name: '不能做',
        text:
          [
            ...persona.cannotDo.map((item) => `- ${item}`),
            ...rules.map((item) => `- ${item}`),
            ...extra.map((item) => `- ${item}`),
          ].join('\n') || '- 不承诺价格、时效与赔付',
      },
      {
        name: '开场话术',
        text:
          book.openers
            .map((item) => `- [${item.scene || '通用'}] ${item.text}`)
            .join('\n') || '（未配置）',
      },
      {
        name: '异议处理',
        text:
          book.objections
            .map(
              (item) =>
                `- ${item.topic}：先认同「${item.acknowledge}」，结论「${item.conclusion}」${
                  item.evidence ? `，依据「${item.evidence}」` : ''
                }${item.nextStep ? `，下一步「${item.nextStep}」` : ''}`,
            )
            .join('\n') || '（未配置）',
      },
      {
        name: '转人工',
        text: `触发词：${book.escalation.triggers.join('、') || '无'}\n话术：${book.escalation.handoffText}`,
      },
    ];
    if (input.snippets.length) {
      sections.push({
        name: '知识摘录',
        text: input.snippets
          .map((item) => `- ${item.title}（${item.ref}）：${item.text}`)
          .join('\n'),
      });
    }
    if (input.lead || input.profile) {
      sections.push({
        name: '客户上下文',
        text: [
          input.lead
            ? `社媒：${text(input.lead.platform)} / ${text(input.lead.nickname)}，意向 ${text(input.lead.intentLevel)}，标签 ${strArr(input.lead.intentTags).join('、') || '无'}`
            : '',
          input.profile
            ? `档案：${text(input.profile.displayName)}，状态 ${text(input.profile.businessStatus)}，用途 ${text(input.profile.purpose) || '未知'}，预算 ${text(input.profile.budget) || '未知'}，顾虑 ${strArr(input.profile.objections).join('、') || '无'}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      });
    }
    if (input.customerMessage) {
      sections.push({
        name: '客户消息',
        text: wrapUntrusted('客户消息', input.customerMessage),
      });
    }
    return sections;
  }

  private ruleReply(
    book: {
      openers: ReturnType<typeof openersOf>;
      objections: ReturnType<typeof objectionsOf>;
      escalation: ReturnType<typeof escalationOf>;
    },
    message: string,
  ) {
    const hit = book.objections.find((item) =>
      message ? message.includes(item.topic) : false,
    );
    if (hit) {
      return [hit.acknowledge, hit.conclusion, hit.evidence, hit.nextStep]
        .filter(Boolean)
        .join(' ');
    }
    if (
      message &&
      book.escalation.triggers.some((word) => message.includes(word))
    ) {
      return book.escalation.handoffText;
    }
    return (
      book.openers[0]?.text ||
      '收到，我先确认一下你的具体需求和使用场景，再给你更合适的建议。'
    );
  }

  private view(row: PlaybookRow) {
    return {
      id: row.id,
      name: row.name,
      goal: row.goal,
      persona: personaOf(row.persona),
      boundaries: boundariesOf(row.boundaries),
      escalation: escalationOf(row.escalation),
      openers: openersOf(row.openers),
      objections: objectionsOf(row.objections),
      kbIds: intArr(row.kbIds),
      faqIds: intArr(row.faqIds),
      status: oneOf(row.status, ACQ_PLAYBOOK_STATUSES, 'DRAFT'),
      currentVersion: row.currentVersion,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }
}

/** 试运行/接待只用组织键造一个最小身份：知识检索的空间可见性闸认 orgUserId。 */
function userOfOrg(org: HrmOrg | OrgKey) {
  return new CurrentUser(org.orgUserId, '', 'user');
}
