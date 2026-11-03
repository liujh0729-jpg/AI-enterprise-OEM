import { createHash } from 'node:crypto';
import { text } from '../common/api';
import {
  AgentConversation,
  AgentMessage,
  DemandDraft,
  DemandGeoConfig,
} from './aiworkin.types';
import { AiworkinClient } from './aiworkin.client';
import { aiworkinStrict } from './aiworkin.config';
import { DemandService } from './demand.service';
import {
  ChannelConversation,
  ChannelMessage,
  conversationsFromMessages,
} from '../shared/channel-message';
export type DemandMessagesOutcome = {
  conversations: ChannelConversation[];
  /** AIWORKIN＝会话清单来自平台，LOCAL＝回落本地台账按回复方切分 */
  source: 'AIWORKIN' | 'LOCAL';
};
export type DemandSyncStatus = 'SYNCED' | 'SKIPPED' | 'FAILED';
export interface DemandSyncOutcome {
  published: number;
  status: DemandSyncStatus;
  error: string;
  listingId: string;
  matchRunId: string;
  tip: string;
}
export interface ReplySyncOutcome {
  synced: boolean;
  tip: string;
  message: AgentMessage | null;
}
/**
 * 需求发布 / 需求回复的统一同步入口：各板块只负责本地台账，
 * 平台侧单号与同步状态由本服务回填（契约见需求文档 2.0 §7）。
 */
export class DemandSyncService {
  constructor(
    private readonly client: AiworkinClient,
    private readonly demands: DemandService,
  ) {}
  async publish(
    token: string,
    draft: DemandDraft,
    localRef: string,
    idempotencyKey?: string,
  ): Promise<DemandSyncOutcome> {
    if (!this.client.isEnabled()) {
      return {
        published: 0,
        status: 'SKIPPED',
        error: '',
        listingId: '',
        matchRunId: '',
        tip: '',
      };
    }
    try {
      const result = await this.demands.publish(
        token,
        draft,
        idempotencyKey || demandIdempotencyKey(localRef, draft),
      );
      const isDraft = draft.publishAction === 'DRAFT';
      return {
        published: 1,
        status: 'SYNCED',
        error: '',
        listingId: result.listing.id,
        matchRunId: String(result.initialMatchRunId || ''),
        tip: isDraft
          ? '需求已同步至 AIworkin 平台通道（无截止时间，按草稿同步）'
          : '需求已发布至 AIworkin 平台通道',
      };
    } catch (error) {
      if (aiworkinStrict()) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      return {
        published: 0,
        status: 'FAILED',
        error: message.slice(0, 500),
        listingId: '',
        matchRunId: '',
        tip: `AIworkin 发布失败，已本地留痕待补发：${message}`,
      };
    }
  }
  /**
   * 一条需求的会话清单（一位回复方一条）：优先取 AIworkin 平台侧会话，
   * 通道未启用 / 无平台挂单 / 平台暂无会话时回落本地台账按回复方切分。
   */
  async conversations(
    token: string,
    listingId: string,
    matchRunId: string,
    localMessages: ChannelMessage[],
  ): Promise<DemandMessagesOutcome> {
    const local = (): DemandMessagesOutcome => ({
      conversations: conversationsFromMessages(localMessages),
      source: 'LOCAL',
    });
    if (!this.client.isEnabled() || !listingId) return local();
    try {
      const page = await this.demands.listConversationsForListing(
        token,
        listingId,
        matchRunId || undefined,
      );
      const list = page?.list || [];
      if (!list.length) return local();
      return {
        conversations: list.map(toChannelConversation),
        source: 'AIWORKIN',
      };
    } catch (error) {
      if (aiworkinStrict()) {
        throw error;
      }
      return local();
    }
  }
  async reply(
    token: string,
    conversationId: string,
    content: string,
  ): Promise<ReplySyncOutcome> {
    if (!this.client.isEnabled()) {
      return {
        synced: false,
        tip: '回复已本地留痕',
        message: null,
      };
    }
    if (!conversationId) {
      return {
        synced: false,
        tip: '该需求尚无 AIworkin 会话，回复仅本地留痕',
        message: null,
      };
    }
    try {
      const message = await this.demands.reply(token, conversationId, content);
      return { synced: true, tip: '已同步至 AIworkin 需求会话', message };
    } catch (error) {
      if (aiworkinStrict()) {
        throw error;
      }
      const reason = error instanceof Error ? error.message : String(error);
      return {
        synced: false,
        tip: `AIworkin 回复同步失败，仅本地留痕：${reason}`,
        message: null,
      };
    }
  }
}
/**
 * 由「本地单据标识 + 报文内容」派生的确定性 `Idempotency-Key`
 * （平台要求 16-100 位字母/数字/下划线/连字符）。
 *
 * 为什么必须确定性：发布请求超时但平台其实已收单时，本地会记 FAILED 并允许补发，
 * 而随机键让每次补发变成一笔全新请求 —— 平台上挂出两条重复需求。
 * 为什么要把内容一起哈希：改过内容再发必须是新键，否则平台按幂等重放返回旧版本，
 * 修改就同步不上去。
 */
export function demandIdempotencyKey(
  localRef: string,
  draft: DemandDraft,
): string {
  const digest = createHash('sha256')
    .update(`${localRef}|${JSON.stringify(draft)}`)
    .digest('hex')
    .slice(0, 32);
  return `dem_${digest}`;
}
export function splitList(value: string) {
  return String(value || '')
    .split(/[,，、;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
/**
 * 从板块表单原始字段（法律/知产把整份表单存入 Json 列）构建需求草稿。
 * 兼容 snake_case 与 camelCase 两种键名。
 */
export function buildDraftFromFields(
  fields: Record<string, unknown>,
  options: {
    title: string;
    categoryLabel: string;
    /** AIworkin 二级类目 UUID（平台必填，缺失时调用方已按模块兜底） */
    subcategoryId: string;
    attributes?: Record<string, unknown>;
    fallbackDescription?: string;
    /** 地域范围三态（跟着需求本身走），由调用方从需求行的结构化列推出 */
    a2aConfig?: DemandGeoConfig;
  },
): DemandDraft {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = fields[key];
      if (value !== undefined && value !== null && text(value).trim() !== '') {
        return text(value).trim();
      }
    }
    return '';
  };
  const deadline = toIsoDate(pick('deadline', '截止时间'));
  const tags = pick('tags', '标签');
  const mustConditions = pick(
    'must_conditions',
    'mustConditions',
    '必须满足条件',
  );
  const emailSync = pick('email_sync', 'emailSync');
  const email = pick('contact_email', 'contactEmail', '邮箱');
  return {
    title: options.title,
    description:
      pick('description', '详细说明') ||
      options.fallbackDescription ||
      options.title,
    direction: 'DEMAND',
    subcategoryId: options.subcategoryId,
    publishAction: deadline ? 'PUBLISH' : 'DRAFT',
    // 本系统预算为人民币文本，平台只收 AWCOIN 整数，故按「面议」提交，
    // 金额原文随 attributes.budget 带给平台匹配参考
    moneyMode: 'NEGOTIABLE',
    currency: 'AWCOIN',
    tags: splitList(tags),
    expectedOutcome:
      pick('expected_result', 'expectedResult', '期望结果') || undefined,
    mustHaves: splitList(mustConditions),
    startAt: toIsoDate(pick('expect_start', 'expectStart', '期望开始时间')),
    deadline,
    attributes: {
      category: options.categoryLabel,
      budget: pick('budget', '预算'),
      regionScope: pick('region_scope', 'regionScope', '地域范围'),
      ...options.attributes,
    },
    ...(options.a2aConfig ? { a2aConfig: options.a2aConfig } : {}),
    contactName: pick('contact_name', 'contactName', '联系人') || undefined,
    contactPhone: pick('contact_phone', 'contactPhone', '手机') || undefined,
    contactWechat: pick('contact_wechat', 'contactWechat', '微信') || undefined,
    contactEmail: email || undefined,
    replyEmailEnabled: emailSync === '1' || emailSync === 'true',
    replyEmail: emailSync === '1' || emailSync === 'true' ? email : undefined,
  };
}
export function toIsoDate(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  const parsed = Date.parse(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}
/** 平台会话上的对方名称字段不固定，按候选键依次取。 */
const CONVERSANT_KEYS = [
  'agentName',
  'providerName',
  'supplierName',
  'counterpartName',
  'ownerName',
  'userName',
  'title',
];
function firstText(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}
/** 平台 role 归一到本系统的三方角色（未知角色按服务方发言处理）。 */
function channelRole(value: unknown): ChannelMessage['role'] {
  const raw = text(value || '').toUpperCase();
  if (raw.includes('SYSTEM') || raw.includes('AUTO')) return 'SYSTEM';
  if (
    raw.includes('ENTERPRISE') ||
    raw.includes('BUYER') ||
    raw.includes('DEMANDER') ||
    raw.includes('OWNER')
  )
    return 'ENTERPRISE';
  return 'PROVIDER';
}
function channelTime(value: unknown) {
  const raw = text(value || '');
  if (!raw) return '';
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed)
    ? raw
    : new Date(parsed).toLocaleString('zh-CN', { hour12: false });
}
function toChannelMessage(message: AgentMessage): ChannelMessage {
  const role = channelRole(message.role);
  return {
    role,
    name:
      firstText(message, ['name', 'senderName', 'fromName', 'nickname']) ||
      (role === 'SYSTEM'
        ? '系统'
        : role === 'ENTERPRISE'
          ? '需求方'
          : '服务商'),
    time: channelTime(message.sentAt || message.createdAt),
    text: text(message.content ?? message.text ?? ''),
  };
}
/**
 * 平台会话 → 本系统会话（一位回复方一条线程）。
 * 本地台账板块经 `conversations()` 走，平台直连板块（market-board）直接复用。
 */
export function toChannelConversation(
  conversation: AgentConversation,
): ChannelConversation {
  const messages = (conversation.messages || []).map(toChannelMessage);
  return {
    id: conversation.id,
    name:
      firstText(conversation, CONVERSANT_KEYS) ||
      messages.find((item) => item.role === 'PROVIDER')?.name ||
      `会话 ${String(conversation.id).slice(0, 8)}`,
    source: 'AIWORKIN',
    messages,
  };
}
