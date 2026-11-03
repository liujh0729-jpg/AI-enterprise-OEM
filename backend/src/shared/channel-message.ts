export type ChannelMessage = {
  role: 'ENTERPRISE' | 'PROVIDER' | 'SYSTEM';
  name: string;
  time: string;
  text: string;
  /** 发言时选定的本地会话标识（`local-*`）；缺省表示按时间顺序归入最近一位回复方 */
  reply_to?: string;
};
export type ChannelEvent = {
  time: string;
  status: string;
  text: string;
};
/** 一条需求下的一位回复方会话（多轮）。 */
export type ChannelConversation = {
  /** 会话标识：`local-*`＝本地台账切分，其余为 AIworkin 平台会话 id */
  id: string;
  /** 会话对象名称（回复方 / 需求方本人） */
  name: string;
  /** 会话来源：AIWORKIN＝平台侧会话，LOCAL＝本地台账按回复方切分 */
  source: 'AIWORKIN' | 'LOCAL';
  messages: ChannelMessage[];
};
export function msgTime() {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}
export function asMessages(value: unknown): ChannelMessage[] {
  return Array.isArray(value) ? (value as ChannelMessage[]) : [];
}
export function asEvents(value: unknown): ChannelEvent[] {
  return Array.isArray(value) ? (value as ChannelEvent[]) : [];
}
export function appendMessage(
  messages: unknown,
  role: ChannelMessage['role'],
  name: string,
  text: string,
  conversationId = '',
) {
  // 服务商发言一律进本人会话（首次回复即开出这一位回复方的线程）；
  // 需求方与系统的发言按选中的会话落位。
  const target =
    role !== 'PROVIDER' && conversationId.startsWith('local-')
      ? conversationId
      : '';
  return [
    ...asMessages(messages),
    {
      role,
      name,
      time: msgTime(),
      text,
      ...(target ? { reply_to: target } : {}),
    },
  ];
}
/**
 * 本地需求台账的往来消息切分为「一位回复方一条会话」。
 *
 * 归属规则：服务商发言进本人会话（其首次回复即开出这一家的一条线程）；需求方与系统的发言
 * 先看 `reply_to`（用户在该会话里回复时记录），无标记则跟在前一条服务商发言所属会话里，
 * 尚无任何服务商回复时属于需求方本人会话。
 * 平台侧会话由 AIworkin 接口直接给出，不走本函数。
 */
export function conversationsFromMessages(
  messages: ChannelMessage[],
): ChannelConversation[] {
  const order: string[] = [];
  const buckets = new Map<string, ChannelMessage[]>();
  const lead: ChannelMessage[] = [];
  let current = '';
  const bucketOf = (provider: string) => {
    if (!buckets.has(provider)) {
      buckets.set(provider, []);
      order.push(provider);
    }
    return buckets.get(provider) as ChannelMessage[];
  };
  messages.forEach((message) => {
    const provider =
      message.role === 'PROVIDER' ? String(message.name || '').trim() : '';
    const target = String(message.reply_to || '');
    if (target === 'local-lead') {
      lead.push(message);
      current = '';
      return;
    }
    if (target.startsWith('local-')) {
      const name = target.slice('local-'.length);
      if (name) {
        bucketOf(name).push(message);
        current = name;
        return;
      }
    }
    if (provider) {
      bucketOf(provider);
      current = provider;
    }
    const bucket = current ? buckets.get(current) : undefined;
    (bucket || lead).push(message);
  });
  const owner =
    messages.find((message) => message.role === 'ENTERPRISE')?.name || '需求方';
  const conversations: ChannelConversation[] = [];
  if (lead.length) {
    conversations.push({
      id: 'local-lead',
      name: owner,
      source: 'LOCAL',
      messages: lead,
    });
  }
  order.forEach((provider) => {
    conversations.push({
      id: `local-${provider}`,
      name: provider,
      source: 'LOCAL',
      messages: buckets.get(provider) || [],
    });
  });
  return conversations;
}
/** 会话是否属于本地切分段（其余一律按 AIworkin 平台会话 id 处理）。 */
export function isLocalConversation(id: string) {
  return !id || id.startsWith('local-');
}
/** 需求方本人的发起会话标识（本地台账切分时段）。 */
export const LEAD_CONVERSATION_ID = 'local-lead';
/**
 * 有多少家回复了这条需求：回复方会话条数，不含需求方本人的发起会话。
 * 列表按钮「查看消息（n）」与弹窗「回复方会话（n）」同一口径。
 */
export function replyPartyCount(messages: ChannelMessage[]) {
  return conversationsFromMessages(messages).filter(
    (item) => item.id !== LEAD_CONVERSATION_ID,
  ).length;
}
export function demandText(
  title: string,
  category2: string,
  body: Record<string, string>,
) {
  return [
    `【${category2}】${title}`,
    body.description ? `详细说明：${body.description}` : '',
    body.budget ? `预算：${body.budget}` : '',
    body.expected_result ? `期望结果：${body.expected_result}` : '',
    body.must_conditions ? `必须满足条件：${body.must_conditions}` : '',
    body.expect_start || body.deadline
      ? `时间：${body.expect_start || '待定'}${body.deadline ? ` 截止 ${body.deadline}` : ''}`
      : '',
    body.region_scope ? `地域：${body.region_scope}` : '',
    body.contact_name || body.contact_phone
      ? `联系人：${body.contact_name || '—'} ${body.contact_phone || ''}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
export function feedbackProgress(status: string, nodes: string[]) {
  const index = nodes.indexOf(status);
  const done = index >= 0 ? index + 1 : 0;
  return {
    n: Math.min(done, nodes.length),
    m: nodes.length,
    label: `${Math.min(done, nodes.length)}/${nodes.length}`,
  };
}
