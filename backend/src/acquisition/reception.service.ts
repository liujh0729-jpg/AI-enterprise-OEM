import { CurrentUser } from '../auth/current-user';
import type { Prisma } from '../../generated/prisma';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmOrg } from '../hrm/hrm.scope';
import { aiJson } from '../ai/ai-gateway';
import { AcquisitionSettingsService } from './acquisition-settings.service';
import { AcquisitionProfileService } from './profile.service';
import { AcquisitionPlaybookService } from './playbook.service';
import {
  AcquisitionFollowUpService,
  hasBuyingIntent,
} from './follow-up.service';
import {
  clip,
  json,
  orgKey,
  peerKeyOf,
  text,
  type Row,
} from './acquisition.helpers';

export type AcqReceptionInput = {
  ownerUserId: string;
  conversationId: number;
  channelId: number;
  externalUserId: string;
  externalUserName: string;
  message: string;
};

export type AcqReceptionContext = {
  /** 系统提示里的段落：剧本边界 → 知识摘录 → 客户上下文。 */
  sections: { name: string; text: string }[];
  /** 剧本里定义的转人工触发词。 */
  handoffTriggers: string[];
  /** 触发后要说的话术。 */
  handoffText: string;
  /** 回复发出后写档案、建跟进；失败只告警。 */
  afterReply: (reply: string) => Promise<void>;
};

type ProfileRow = {
  id: number;
  businessStatus: string;
  purpose: string;
  source: string;
  budget: string;
  timeline: string;
  decisionRole: string;
  pinnedVersion: number;
};

const EXTRACT_SYSTEM = [
  '从客服会话里抽取销售档案字段。只输出 JSON：',
  '{"purpose":"用途/场景","budget":"预算原文","timeline":"时间要求","decisionRole":"决策角色","objection":"顾虑"}',
  '没有提到的字段输出空字符串，不要猜测。',
].join('\n');

const STOP_WORDS = [
  '不用跟了',
  '不用联系',
  '我自己买',
  '不买了',
  '别联系我',
  '不需要了',
];

const STATUS_ORDER = ['free', 'engaged', 'qualified', 'customer'];

/**
 * AI 销售接待（设计 §5.5）：不新建聊天系统，在服务台提示词组装处补齐剧本与档案，
 * 每轮回复后抽取结构化信息写档案与时间线，客户说「明天再说」就按时间映射建跟进。
 */
export class AcquisitionReceptionService {
  private readonly warned = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AcquisitionSettingsService,
    private readonly profiles: AcquisitionProfileService,
    private readonly playbooks: AcquisitionPlaybookService,
    private readonly followUps: AcquisitionFollowUpService,
  ) {}

  async context(input: AcqReceptionInput): Promise<AcqReceptionContext | null> {
    const ownerUserId = clip(text(input.ownerUserId), 64);
    if (!ownerUserId) return null;
    let org: HrmOrg;
    try {
      org = await this.settings.org(new CurrentUser(ownerUserId, '', ''));
    } catch {
      return null;
    }
    const settings = await this.settings.forOrg(org);
    if (!settings.enabled) return null;

    const channel = await this.channelOf(org, input.channelId);
    const externalUserId =
      clip(text(input.externalUserId), 160) ||
      `visitor-${input.conversationId}`;
    const peerKey = peerKeyOf(channel, externalUserId);
    const profile = await this.profiles.ensurePeer(org, {
      channel,
      externalUserId,
      displayName: clip(text(input.externalUserName), 120),
      source: clip(channel === 'WEB' ? '官网客服' : channel, 60),
      ownerUserId,
    });
    if (profile) await this.profiles.touchContact(profile.id);

    const profileRow = (profile || null) as ProfileRow | null;
    let playbookId = settings.defaultPlaybookId;
    let version = 0;
    let sections: { name: string; text: string }[] = [];
    let handoffTriggers: string[] = [];
    let handoffText = '';
    if (playbookId) {
      try {
        const book = await this.playbooks.requirePlaybook(org, playbookId);
        version = profileRow?.pinnedVersion || 0;
        if (profileRow && !version) {
          // 会话第一次接待时把版本钉住：之后再发布不改变这段关系里的剧本
          version = book.currentVersion;
          await this.prisma.acqProfile
            .update({
              where: { id: profileRow.id },
              data: { pinnedVersion: version },
            })
            .catch(() => undefined);
          profileRow.pinnedVersion = version;
        }
        const assembled = await this.playbooks.assemble(
          org,
          playbookId,
          version,
          {
            customerMessage: text(input.message),
            lead: null,
            profile: profileRow
              ? {
                  displayName: input.externalUserName,
                  businessStatus: profileRow.businessStatus,
                  purpose: profileRow.purpose,
                  budget: profileRow.budget,
                  objections: [],
                }
              : null,
          },
        );
        sections = assembled.sections;
        handoffTriggers = assembled.book.escalation.triggers.filter(Boolean);
        handoffText = assembled.book.escalation.handoffText;
      } catch (error) {
        this.warnOnce('reception-playbook', error);
        playbookId = 0;
      }
    }

    const message = clip(text(input.message), 2000);
    return {
      sections,
      handoffTriggers,
      handoffText,
      afterReply: (reply: string) =>
        this.afterReply({
          org,
          profileId: profileRow?.id || 0,
          peerKey,
          channel,
          message,
          reply,
          playbookId,
        }).catch((error) => this.warnOnce('reception-after-reply', error)),
    };
  }

  private async afterReply(input: {
    org: HrmOrg;
    profileId: number;
    peerKey: string;
    channel: string;
    message: string;
    reply: string;
    playbookId: number;
  }) {
    if (!input.profileId) return;
    const { org } = input;
    const current = await this.prisma.acqProfile.findUnique({
      where: { id: input.profileId },
    });
    if (!current) return;

    // 客户主动回复即视为「跟上了」，先把未完成的计划收口
    const stop = STOP_WORDS.some((word) => input.message.includes(word));
    await this.followUps.completeByPeer(
      org,
      input.peerKey,
      stop ? '客户明确表示不用继续跟了' : '客户已主动回复',
    );

    const extracted = await this.extract(org.orgUserId, input.message);
    const data: Prisma.AcqProfileUncheckedUpdateInput = {};
    if (!current.purpose && extracted.purpose)
      data.purpose = clip(extracted.purpose, 200);
    if (!current.budget && extracted.budget)
      data.budget = clip(extracted.budget, 80);
    if (!current.timeline && extracted.timeline)
      data.timeline = clip(extracted.timeline, 80);
    if (!current.decisionRole && extracted.decisionRole) {
      data.decisionRole = clip(extracted.decisionRole, 40);
    }
    if (!current.source && input.channel) data.source = clip(input.channel, 60);
    const nextStatus = this.nextStatus(
      current.businessStatus,
      input.message,
      extracted,
      stop,
    );
    if (nextStatus !== current.businessStatus) data.businessStatus = nextStatus;
    if (Object.keys(data).length) {
      await this.prisma.acqProfile
        .update({ where: { id: current.id }, data })
        .catch((error) => this.warnOnce('reception-profile', error));
      if (nextStatus !== current.businessStatus) {
        await this.event(org, current.id, 'STAGE', {
          summary: `业务状态 ${current.businessStatus} → ${nextStatus}（AI 接待识别）`,
          payload: { from: current.businessStatus, to: nextStatus },
        });
      }
    }
    await this.event(org, current.id, 'CHAT', {
      summary: clip(`客户：${input.message}`, 400),
      payload: {
        channel: input.channel,
        reply: clip(input.reply, 300),
        extracted,
      },
    });

    if (!stop) {
      await this.followUps
        .createAuto(
          org,
          { id: current.id, channelPeerKey: current.channelPeerKey },
          {
            message: input.message,
            contextSummary: clip(
              `客户：${input.message}\n接待回复：${input.reply}`,
              4000,
            ),
            playbookId: input.playbookId,
          },
        )
        .catch((error) => this.warnOnce('reception-follow-up', error));
    }
  }

  /** 渠道种类 → 档案的渠道段；官网 widget 单独用 WEB。 */
  private async channelOf(org: HrmOrg, channelId: number) {
    if (!channelId) return 'WEB';
    const channel = await this.prisma.serviceDeskChannel.findFirst({
      where: { id: channelId, ownerUserId: org.orgUserId },
      select: { kind: true },
    });
    return clip((channel?.kind || 'CUSTOM').toUpperCase(), 20) || 'CUSTOM';
  }

  private async extract(ownerUserId: string, message: string) {
    const rule = ruleExtract(message);
    if (!this.shouldUseModel(message)) return rule;
    const ai = await aiJson<{
      purpose: string;
      budget: string;
      timeline: string;
      decisionRole: string;
      objection: string;
    }>(this.prisma, {
      userId: ownerUserId,
      messages: [
        { role: 'system', content: EXTRACT_SYSTEM },
        { role: 'user', content: clip(message, 2000) },
      ],
      purpose: 'batch',
      module: 'acquisition',
      operation: 'reception_extract',
      validate: (raw) => {
        const value = {
          purpose: clip(raw.purpose, 200),
          budget: clip(raw.budget, 80),
          timeline: clip(raw.timeline, 80),
          decisionRole: clip(raw.decisionRole, 40),
          objection: clip(raw.objection, 200),
        };
        return Object.values(value).some(Boolean) ? value : null;
      },
    }).catch(() => null);
    if (!ai) return rule;
    return {
      purpose: ai.data.purpose || rule.purpose,
      budget: ai.data.budget || rule.budget,
      timeline: ai.data.timeline || rule.timeline,
      decisionRole: ai.data.decisionRole || rule.decisionRole,
      objection: ai.data.objection || rule.objection,
    };
  }

  /** 短消息不额外调模型：接待回复本身已经花了一次调用。 */
  private shouldUseModel(message: string) {
    const content = text(message);
    if (content.length < 12) return false;
    return /价格|多少钱|预算|怎么|购买|下单|时间|需要|版本|套餐|优惠|考虑/.test(
      content,
    );
  }

  private nextStatus(
    current: string,
    message: string,
    extracted: { budget: string; timeline: string; objection: string },
    stop: boolean,
  ) {
    if (['customer', 'churned'].includes(current)) return current;
    const index = STATUS_ORDER.indexOf(current);
    let next = current;
    if (index < 0) next = 'free';
    if (next === 'free') next = 'engaged';
    if (
      hasBuyingIntent(message) ||
      extracted.budget ||
      extracted.timeline ||
      /怎么买|下单|付款|支付/.test(message)
    ) {
      if (next === 'engaged') next = 'qualified';
    }
    if (stop && next === 'qualified') return next;
    return next;
  }

  private async event(
    org: HrmOrg,
    profileId: number,
    kind: string,
    input: { summary: string; payload: Row },
  ) {
    await this.prisma.acqProfileEvent
      .create({
        data: {
          profileId,
          ...orgKey(org),
          kind,
          refId: 0,
          summary: clip(input.summary, 500),
          payload: json(input.payload),
        },
      })
      .catch((error) => this.warnOnce('reception-event', error));
  }

  private warnOnce(key: string, error: unknown) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(
      JSON.stringify({
        event: 'acquisition_reception_warning',
        key,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/** 规则抽取兜底：不调模型也能把最关键的预算、时间、角色落进档案。 */
export function ruleExtract(message: string) {
  const content = text(message);
  const budget = content.match(/预算[^\d]{0,6}(\d+(?:\.\d+)?\s*[万千kK]?)/);
  const timeline = content.match(
    /(下个?月|这个月|月底|年后|一周内|两周内|明天|后天|下周|季度)/,
  );
  const role = content.match(
    /(老板|采购|负责人|合伙人|自己决定|帮朋友问|财务)/,
  );
  const purpose = content.match(
    /(想做|需要|打算|用于|给公司|给自己|帮朋友|开(?:店|公司)|投放|推广|采购)([^，。！？\n]{0,24})/,
  );
  return {
    purpose: purpose ? clip(`${purpose[1]}${purpose[2]}`, 200) : '',
    budget: budget ? clip(budget[0], 80) : '',
    timeline: timeline ? clip(timeline[0], 80) : '',
    decisionRole: role ? clip(role[0], 40) : '',
    objection: '',
  };
}
