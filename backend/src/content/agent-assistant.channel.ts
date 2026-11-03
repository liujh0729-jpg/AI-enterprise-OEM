import {
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { ContentAgentAssistantKind } from '@enterprise/contracts';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { assertOutboundUrl } from '../http/outbound-guard';
import { httpRequest, TransportError } from '../http/transport';

/**
 * Agent 助理的第三方消息通道适配层。
 *
 * 平台有两种：双向（能收能回）与只出不进（群机器人）。收发都只走 HTTP，
 * 不引入 WebSocket 依赖：QQ 走 OneBot v11 的 HTTP 上报 + HTTP API。
 * custom 只给 AI 客服的「自定义渠道」用，不进助理的渠道清单。
 */

export type ChannelKind = ContentAgentAssistantKind | 'custom';

export type AssistantConfig = Record<string, string>;

export type AssistantRequest = {
  method: 'GET' | 'POST';
  query: Record<string, string>;
  headers: Record<string, string>;
  rawBody: string;
};

/** 一条入站指令：外部聊天 → 一轮 Agent 对话。 */
export type AssistantInbound = {
  /** 外部聊天标识（企业微信 userid / 群号 / chat_id …） */
  chatId: string;
  /** 发送者标识（用于白名单与展示） */
  userId: string;
  userName: string;
  text: string;
  /** 平台消息 ID，用于重推去重 */
  messageId: string;
  /** 回这条消息需要的运行时信息（如钉钉 sessionWebhook），不落库 */
  replyTarget: Record<string, string>;
  /** 自定义渠道按入站映射登记的会话级额外字段，出站时原样带回 */
  extra?: Record<string, string>;
};

export type AssistantHttpResponse = {
  status: number;
  body: string;
  contentType?: string;
};

export type AssistantReceive = {
  response: AssistantHttpResponse;
  events: AssistantInbound[];
  /** 微信客服的增量游标：拉到新消息才返回 */
  cursor?: string;
};

const WECOM_BASE = (
  process.env.WECOM_API_BASE || 'https://qyapi.weixin.qq.com'
).replace(/\/+$/, '');
const WECHAT_MP_BASE = (
  process.env.WECHAT_MP_API_BASE || 'https://api.weixin.qq.com'
).replace(/\/+$/, '');
const DINGTALK_BASE = (
  process.env.DINGTALK_API_BASE || 'https://api.dingtalk.com'
).replace(/\/+$/, '');
const FEISHU_BASE = (
  process.env.FEISHU_OPEN_BASE_URL || 'https://open.feishu.cn'
).replace(/\/+$/, '');

const API_TIMEOUT_MS = 15_000;

function bad(message: string): never {
  throw new BusinessException(ErrorCode.BAD_REQUEST, message);
}

function upstream(message: string): never {
  throw new BusinessException(ErrorCode.SERVICE_UNAVAILABLE, message);
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function requireField(config: AssistantConfig, key: string, label: string) {
  const value = text(config[key]).trim();
  if (!value) bad(`助理通道缺少「${label}」，请重新保存这条通道`);
  return value;
}

async function requestJson<T>(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    operation: string;
    timeoutMs?: number;
  },
): Promise<{ status: number; ok: boolean; data: T }> {
  let response: { status: number; ok: boolean; data: unknown };
  try {
    response = await httpRequest(url, {
      method: options.method || 'GET',
      headers: {
        ...(options.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
        ...(options.headers || {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      timeoutMs: options.timeoutMs ?? API_TIMEOUT_MS,
      readAs: 'text',
      operation: options.operation,
    });
  } catch (error) {
    if (error instanceof TransportError) {
      console.error(
        JSON.stringify({
          event: 'assistant_upstream_error',
          operation: options.operation,
          kind: error.kind,
        }),
      );
      upstream('连不上第三方平台，请检查网络后重试');
    }
    throw error;
  }
  const raw = typeof response.data === 'string' ? response.data : '';
  let data: T = {} as T;
  if (raw) {
    try {
      data = JSON.parse(raw) as T;
    } catch {
      if (response.ok) upstream('第三方平台返回格式不正确');
      data = {} as T;
    }
  }
  return { status: response.status, ok: response.ok, data };
}

/* ---------------- 企业微信 / 公众号 加解密 ---------------- */

function wechatAesKey(encodingAesKey: string, label: string) {
  const value = text(encodingAesKey).trim();
  if (value.length !== 43) bad(`${label} 需要 43 位 EncodingAESKey`);
  return Buffer.from(`${value}=`, 'base64');
}

function decryptWechatXml(
  sealed: string,
  encodingAesKey: string,
  receiveId: string,
  label: string,
) {
  const key = wechatAesKey(encodingAesKey, label);
  const buffer = Buffer.from(text(sealed), 'base64');
  if (!buffer.length) bad(`${label} 密文为空`);
  try {
    const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
    decipher.setAutoPadding(false);
    const plain = Buffer.concat([decipher.update(buffer), decipher.final()]);
    const pad = plain[plain.length - 1];
    if (pad < 1 || pad > 32) bad(`${label} 密文填充非法`);
    const content = plain.subarray(0, plain.length - pad);
    const length = content.readUInt32BE(16);
    const message = content.subarray(20, 20 + length).toString('utf8');
    const found = content.subarray(20 + length).toString('utf8');
    if (receiveId && found && found !== receiveId) {
      bad(`${label} 回调与通道配置不匹配（接收方 ID 不一致）`);
    }
    return message;
  } catch (error) {
    if (error instanceof BusinessException) throw error;
    bad(`${label} 回调解密失败，请核对 Token / EncodingAESKey`);
  }
}

function sha1Signature(parts: string[]) {
  return createHash('sha1').update(parts.sort().join('')).digest('hex');
}

function sameSecret(left: string, right: string) {
  const a = Buffer.from(text(left));
  const b = Buffer.from(text(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function pickXml(xml: string, tag: string) {
  const matched = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  if (!matched) return '';
  const raw = matched[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(raw);
  return cdata ? cdata[1] : raw;
}

function assertWechatSignature(
  token: string,
  query: Record<string, string>,
  signatureKey: 'signature' | 'msg_signature',
  sealed: string,
  label: string,
) {
  const signature = text(query[signatureKey]);
  if (!signature) bad(`${label} 回调缺少签名参数`);
  const expected = sha1Signature([
    text(token),
    text(query.timestamp),
    text(query.nonce),
    sealed,
  ]);
  if (!sameSecret(signature, expected)) bad(`${label} 回调签名校验失败`);
}

/* ---------------- 企业微信 ---------------- */

function wecomError(code: unknown, message: unknown, label: string): never {
  const errcode = Number(code ?? 0);
  const textMessage = text(message);
  if (errcode === 40001 || errcode === 40013 || errcode === 40091)
    bad(`${label}：企业 CorpID 或 Secret 不正确`);
  if (errcode === 60020)
    bad(`${label}：服务器 IP 不在企业微信可信 IP 白名单内`);
  if (errcode === 45009) bad(`${label}：接口调用超过平台频率限制，请稍后重试`);
  if (errcode === 42001 || errcode === 40014)
    bad(`${label}：AccessToken 已失效，请稍后重试`);
  if (errcode === 81013 || errcode === 60111)
    bad(`${label}：接收人不存在或不在应用可见范围内`);
  upstream(
    `${label}：企业微信返回错误 ${errcode}${textMessage ? `（${textMessage}）` : ''}`,
  );
}

async function wecomAccessToken(config: AssistantConfig, label: string) {
  const corpId = requireField(config, 'corpId', '企业 CorpID');
  const secret = requireField(config, 'secret', '应用 Secret');
  const { data } = await requestJson<{
    errcode?: number;
    errmsg?: string;
    access_token?: string;
  }>(
    `${WECOM_BASE}/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`,
    { operation: 'assistant_wecom_token' },
  );
  if (!data.access_token) wecomError(data.errcode, data.errmsg, label);
  return data.access_token;
}

function wecomCallbackTarget(
  config: AssistantConfig,
  query: Record<string, string>,
  rawBody: string,
) {
  const token = requireField(config, 'token', '接收消息 Token');
  const aesKey = requireField(config, 'encodingAesKey', 'EncodingAESKey');
  const outer = pickXml(rawBody, 'Encrypt');
  const encrypted = !!outer || query.encrypt_type === 'aes';
  if (!encrypted) {
    assertWechatSignature(token, query, 'signature', '', '企业微信');
    return { xml: rawBody, aesKey: '', corpId: '' };
  }
  assertWechatSignature(token, query, 'msg_signature', outer, '企业微信');
  return {
    xml: decryptWechatXml(
      outer,
      aesKey,
      requireField(config, 'corpId', '企业 CorpID'),
      '企业微信',
    ),
    aesKey,
    corpId: requireField(config, 'corpId', '企业 CorpID'),
  };
}

function wecomAppReceive(
  config: AssistantConfig,
  request: AssistantRequest,
): AssistantReceive {
  if (request.method === 'GET') {
    const token = requireField(config, 'token', '接收消息 Token');
    assertWechatSignature(token, request.query, 'signature', '', '企业微信');
    const echo = text(request.query.echostr);
    return {
      response: { status: 200, body: echo, contentType: 'text/plain' },
      events: [],
    };
  }
  const { xml } = wecomCallbackTarget(config, request.query, request.rawBody);
  const messageType = pickXml(xml, 'MsgType');
  const content = pickXml(xml, 'Content').trim();
  const from = pickXml(xml, 'FromUserName');
  if (messageType !== 'text' || !content || !from) {
    return { response: { status: 200, body: '' }, events: [] };
  }
  return {
    response: { status: 200, body: '' },
    events: [
      {
        chatId: from,
        userId: from,
        userName: from,
        text: content,
        messageId: pickXml(xml, 'MsgId'),
        replyTarget: {},
      },
    ],
  };
}

async function wecomAppSend(
  config: AssistantConfig,
  target: { chatId: string },
  content: string,
) {
  const accessToken = await wecomAccessToken(config, '企业微信应用');
  const agentId = Number(requireField(config, 'agentId', '应用 AgentId'));
  if (!Number.isFinite(agentId) || agentId <= 0)
    bad('企业微信应用：AgentId 必须是数字');
  const { data } = await requestJson<{ errcode?: number; errmsg?: string }>(
    `${WECOM_BASE}/cgi-bin/message/send?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: 'POST',
      operation: 'assistant_wecom_send',
      body: {
        touser: target.chatId,
        msgtype: 'text',
        agentid: agentId,
        text: { content },
        safe: 0,
      },
    },
  );
  if (Number(data.errcode ?? 0) !== 0)
    wecomError(data.errcode, data.errmsg, '企业微信应用');
}

/* ---------------- 微信客服 ---------------- */

type KfMessage = {
  msgid?: string;
  open_kfid?: string;
  external_userid?: string;
  send_time?: number;
  origin?: number;
  msgtype?: string;
  text?: { content?: string };
};

async function wecomKfReceive(
  config: AssistantConfig,
  request: AssistantRequest,
  cursor: string,
): Promise<AssistantReceive> {
  if (request.method === 'GET') {
    const token = requireField(config, 'token', '接收消息 Token');
    assertWechatSignature(token, request.query, 'signature', '', '微信客服');
    return {
      response: {
        status: 200,
        body: text(request.query.echostr),
        contentType: 'text/plain',
      },
      events: [],
    };
  }
  const { xml } = wecomCallbackTarget(config, request.query, request.rawBody);
  const eventToken = pickXml(xml, 'Token');
  if (!eventToken) {
    return { response: { status: 200, body: '' }, events: [] };
  }
  const openKfId = requireField(config, 'openKfId', '客服账号 open_kfid');
  const accessToken = await wecomAccessToken(config, '微信客服');
  const events: AssistantInbound[] = [];
  let nextCursor = cursor;
  for (let page = 0; page < 3; page += 1) {
    const { data } = await requestJson<{
      errcode?: number;
      errmsg?: string;
      next_cursor?: string;
      has_more?: number;
      msg_list?: KfMessage[];
    }>(
      `${WECOM_BASE}/cgi-bin/kf/sync_msg?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        operation: 'assistant_wecom_kf_sync',
        body: {
          token: eventToken,
          cursor: page === 0 ? nextCursor || undefined : nextCursor,
          open_kfid: openKfId,
          limit: 1000,
        },
      },
    );
    if (Number(data.errcode ?? 0) !== 0)
      wecomError(data.errcode, data.errmsg, '微信客服');
    for (const item of data.msg_list || []) {
      // origin=3 是客户发的；其它是系统/接待人员自己发的，不回。
      if (Number(item.origin) !== 3) continue;
      if (item.msgtype !== 'text') continue;
      const content = text(item.text?.content).trim();
      const externalUserId = text(item.external_userid);
      if (!content || !externalUserId) continue;
      events.push({
        chatId: externalUserId,
        userId: externalUserId,
        userName: externalUserId,
        text: content,
        messageId: text(item.msgid),
        replyTarget: {},
      });
    }
    const advanced = text(data.next_cursor);
    if (advanced) nextCursor = advanced;
    if (!data.has_more) break;
  }
  return { response: { status: 200, body: '' }, events, cursor: nextCursor };
}

async function wecomKfSend(
  config: AssistantConfig,
  target: { chatId: string },
  content: string,
) {
  const accessToken = await wecomAccessToken(config, '微信客服');
  const openKfId = requireField(config, 'openKfId', '客服账号 open_kfid');
  const { data } = await requestJson<{ errcode?: number; errmsg?: string }>(
    `${WECOM_BASE}/cgi-bin/kf/send_msg?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: 'POST',
      operation: 'assistant_wecom_kf_send',
      body: {
        touser: target.chatId,
        open_kfid: openKfId,
        msgtype: 'text',
        text: { content },
      },
    },
  );
  if (Number(data.errcode ?? 0) !== 0)
    wecomError(data.errcode, data.errmsg, '微信客服');
}

/* ---------------- 公众号服务号 ---------------- */

async function wechatMpAccessToken(config: AssistantConfig) {
  const appId = requireField(config, 'appId', 'AppID');
  const secret = requireField(config, 'appSecret', 'AppSecret');
  const { data } = await requestJson<{
    errcode?: number;
    errmsg?: string;
    access_token?: string;
  }>(
    `${WECHAT_MP_BASE}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(secret)}`,
    { operation: 'assistant_wechat_mp_token' },
  );
  if (!data.access_token) wecomError(data.errcode, data.errmsg, '微信公众号');
  return data.access_token;
}

function wechatMpReceive(
  config: AssistantConfig,
  request: AssistantRequest,
): AssistantReceive {
  const token = requireField(config, 'token', '服务器配置 Token');
  const appId = requireField(config, 'appId', 'AppID');
  if (request.method === 'GET') {
    assertWechatSignature(token, request.query, 'signature', '', '微信公众号');
    return {
      response: {
        status: 200,
        body: text(request.query.echostr),
        contentType: 'text/plain',
      },
      events: [],
    };
  }
  const aesKey = requireField(config, 'encodingAesKey', 'EncodingAESKey');
  const sealed = pickXml(request.rawBody, 'Encrypt');
  let xml = request.rawBody;
  if (sealed) {
    assertWechatSignature(
      token,
      request.query,
      'msg_signature',
      sealed,
      '微信公众号',
    );
    xml = decryptWechatXml(sealed, aesKey, appId, '微信公众号');
  } else {
    assertWechatSignature(token, request.query, 'signature', '', '微信公众号');
  }
  const messageType = pickXml(xml, 'MsgType');
  const content = pickXml(xml, 'Content').trim();
  const from = pickXml(xml, 'FromUserName');
  if (messageType !== 'text' || !content || !from) {
    return { response: { status: 200, body: 'success' }, events: [] };
  }
  return {
    response: { status: 200, body: 'success' },
    events: [
      {
        chatId: from,
        userId: from,
        userName: from,
        text: content,
        messageId: pickXml(xml, 'MsgId'),
        replyTarget: {},
      },
    ],
  };
}

async function wechatMpSend(
  config: AssistantConfig,
  target: { chatId: string },
  content: string,
) {
  const accessToken = await wechatMpAccessToken(config);
  const { data } = await requestJson<{ errcode?: number; errmsg?: string }>(
    `${WECHAT_MP_BASE}/cgi-bin/message/custom/send?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: 'POST',
      operation: 'assistant_wechat_mp_send',
      body: { touser: target.chatId, msgtype: 'text', text: { content } },
    },
  );
  if (Number(data.errcode ?? 0) !== 0)
    wecomError(data.errcode, data.errmsg, '微信公众号');
}

/* ---------------- 钉钉 ---------------- */

function dingtalkSign(appSecret: string, timestamp: string) {
  return createHmac('sha256', appSecret)
    .update(`${timestamp}\n${appSecret}`)
    .digest('base64');
}

function dingtalkReceive(
  config: AssistantConfig,
  request: AssistantRequest,
): AssistantReceive {
  const appSecret = requireField(config, 'appSecret', 'AppSecret');
  const timestamp = text(request.headers.timestamp);
  const sign = text(request.headers.sign);
  if (!timestamp || !sign)
    bad('钉钉机器人回调缺少签名，请检查消息接收地址配置');
  if (!sameSecret(sign, dingtalkSign(appSecret, timestamp)))
    bad('钉钉机器人回调签名校验失败');

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(request.rawBody || '{}') as Record<string, unknown>;
  } catch {
    bad('钉钉机器人回调内容不是合法 JSON');
  }
  const messageType = text(payload.msgtype);
  const content =
    messageType === 'text'
      ? text((payload.text as { content?: string } | undefined)?.content).trim()
      : '';
  const conversationId = text(payload.conversationId);
  const senderStaffId = text(payload.senderStaffId);
  const senderId = text(payload.senderId);
  if (!content || !conversationId) {
    return { response: { status: 200, body: '' }, events: [] };
  }
  return {
    response: { status: 200, body: '' },
    events: [
      {
        chatId: conversationId,
        userId: senderStaffId || senderId,
        userName: text(payload.senderNick) || senderStaffId || senderId,
        text: content,
        messageId: text(payload.msgId),
        replyTarget: {
          sessionWebhook: text(payload.sessionWebhook),
          robotCode: text(payload.robotCode),
          conversationType: text(payload.conversationType),
        },
      },
    ],
  };
}

async function dingtalkRobotToken(config: AssistantConfig) {
  const appKey = requireField(config, 'appKey', 'AppKey');
  const appSecret = requireField(config, 'appSecret', 'AppSecret');
  const { data } = await requestJson<{
    accessToken?: string;
    message?: string;
    code?: string;
  }>(`${DINGTALK_BASE}/v1.0/oauth2/accessToken`, {
    method: 'POST',
    operation: 'assistant_dingtalk_token',
    body: { appKey, appSecret },
  });
  if (!data.accessToken) bad('钉钉机器人：AppKey / AppSecret 校验失败');
  return data.accessToken;
}

async function dingtalkSend(
  config: AssistantConfig,
  target: {
    chatId: string;
    userId: string;
    replyTarget: Record<string, string>;
  },
  content: string,
) {
  const webhook = text(target.replyTarget.sessionWebhook);
  if (webhook) {
    // sessionWebhook 有效期约 1.5 小时，过期后走机器人接口兜底。
    try {
      const { ok } = await requestJson<Record<string, unknown>>(webhook, {
        method: 'POST',
        operation: 'assistant_dingtalk_webhook_reply',
        body: { msgtype: 'text', text: { content } },
      });
      if (ok) return;
    } catch {
      /* 回退到机器人接口 */
    }
  }
  const accessToken = await dingtalkRobotToken(config);
  const robotCode =
    text(target.replyTarget.robotCode) ||
    requireField(config, 'robotCode', 'RobotCode');
  const isGroup = target.chatId.startsWith('cid');
  const msgParam = JSON.stringify({ content });
  const url = isGroup
    ? `${DINGTALK_BASE}/v1.0/robot/groupMessages/send`
    : `${DINGTALK_BASE}/v1.0/robot/oToMessages/batchSend`;
  const body = isGroup
    ? {
        robotCode,
        openConversationId: target.chatId,
        msgKey: 'sampleText',
        msgParam,
      }
    : {
        robotCode,
        userIds: [target.userId || target.chatId],
        msgKey: 'sampleText',
        msgParam,
      };
  const { data } = await requestJson<Record<string, unknown>>(url, {
    method: 'POST',
    operation: 'assistant_dingtalk_robot_send',
    headers: { 'x-acs-dingtalk-access-token': accessToken },
    body,
  });
  const processQuery = data.processQuery;
  if (
    processQuery &&
    Number((processQuery as { code?: number }).code ?? 0) !== 0
  )
    upstream('钉钉机器人：消息发送失败，请检查机器人权限与 RobotCode');
}

/* ---------------- 飞书 ---------------- */

async function feishuTenantToken(config: AssistantConfig) {
  const appId = requireField(config, 'appId', 'App ID');
  const appSecret = requireField(config, 'appSecret', 'App Secret');
  const { data } = await requestJson<{
    code?: number;
    msg?: string;
    tenant_access_token?: string;
  }>(`${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    operation: 'assistant_feishu_token',
    body: { app_id: appId, app_secret: appSecret },
  });
  if (!data.tenant_access_token)
    bad('飞书自建应用：App ID / App Secret 校验失败');
  return data.tenant_access_token;
}

function decryptFeishu(sealed: string, encryptKey: string) {
  const raw = Buffer.from(text(sealed), 'base64');
  if (raw.length <= 16) bad('飞书回调密文格式非法');
  const key = createHash('sha256').update(text(encryptKey)).digest();
  try {
    const decipher = createDecipheriv('aes-256-cbc', key, raw.subarray(0, 16));
    return Buffer.concat([
      decipher.update(raw.subarray(16)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    bad('飞书回调解密失败，请核对 Encrypt Key');
  }
}

function feishuReceive(
  config: AssistantConfig,
  request: AssistantRequest,
): AssistantReceive {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(request.rawBody || '{}') as Record<string, unknown>;
  } catch {
    bad('飞书回调内容不是合法 JSON');
  }
  const encryptKey = text(config.encryptKey).trim();
  if (typeof payload.encrypt === 'string' && payload.encrypt) {
    if (!encryptKey) bad('飞书回调已加密，但通道没有配置 Encrypt Key');
    try {
      payload = JSON.parse(
        decryptFeishu(payload.encrypt, encryptKey),
      ) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      bad('飞书回调解密失败，请核对 Encrypt Key');
    }
  }
  if (payload.type === 'url_verification') {
    return {
      response: {
        status: 200,
        body: JSON.stringify({ challenge: payload.challenge }),
        contentType: 'application/json',
      },
      events: [],
    };
  }
  const header = (payload.header || {}) as Record<string, unknown>;
  const verificationToken = text(config.verificationToken).trim();
  if (
    verificationToken &&
    text(header.token) &&
    !sameSecret(text(header.token), verificationToken)
  )
    bad('飞书回调 Verification Token 校验失败');
  if (text(header.event_type) !== 'im.message.receive_v1') {
    return {
      response: {
        status: 200,
        body: JSON.stringify({ code: 0 }),
        contentType: 'application/json',
      },
      events: [],
    };
  }
  const event = (payload.event || {}) as Record<string, unknown>;
  const message = (event.message || {}) as Record<string, unknown>;
  if (text(message.message_type) !== 'text') {
    return {
      response: {
        status: 200,
        body: JSON.stringify({ code: 0 }),
        contentType: 'application/json',
      },
      events: [],
    };
  }
  let content = '';
  try {
    const parsed = JSON.parse(text(message.content) || '{}') as {
      text?: string;
    };
    content = text(parsed.text).trim();
  } catch {
    content = '';
  }
  const chatId = text(message.chat_id);
  const sender = (event.sender || {}) as Record<string, unknown>;
  const senderId = (sender.sender_id || {}) as Record<string, unknown>;
  const userId = text(senderId.open_id) || text(senderId.user_id);
  if (!content || !chatId) {
    return {
      response: {
        status: 200,
        body: JSON.stringify({ code: 0 }),
        contentType: 'application/json',
      },
      events: [],
    };
  }
  return {
    response: {
      status: 200,
      body: JSON.stringify({ code: 0 }),
      contentType: 'application/json',
    },
    events: [
      {
        chatId,
        userId,
        userName: userId,
        text: content,
        messageId: text(message.message_id),
        replyTarget: {},
      },
    ],
  };
}

async function feishuSend(
  config: AssistantConfig,
  target: { chatId: string; messageId: string },
  content: string,
) {
  const token = await feishuTenantToken(config);
  const replyTo = target.messageId;
  const payload = {
    msg_type: 'text',
    content: JSON.stringify({ text: content }),
  };
  const url = replyTo
    ? `${FEISHU_BASE}/open-apis/im/v1/messages/${encodeURIComponent(replyTo)}/reply`
    : `${FEISHU_BASE}/open-apis/im/v1/messages?receive_id_type=chat_id`;
  const body = replyTo ? payload : { receive_id: target.chatId, ...payload };
  const { data } = await requestJson<{ code?: number; msg?: string }>(url, {
    method: 'POST',
    operation: 'assistant_feishu_send',
    headers: { authorization: `Bearer ${token}` },
    body,
  });
  if (Number(data.code ?? 0) !== 0)
    upstream(
      `飞书自建应用：消息发送失败（${Number(data.code)}${data.msg ? ` ${data.msg}` : ''}）`,
    );
}

/* ---------------- QQ（OneBot v11） ---------------- */

function onebotBase(config: AssistantConfig) {
  const base = requireField(config, 'apiBase', 'HTTP API 地址').replace(
    /\/+$/,
    '',
  );
  if (!/^https?:\/\//i.test(base))
    bad('QQ 机器人：HTTP API 地址必须以 http:// 或 https:// 开头');
  return base;
}

function qqMessageText(message: unknown, raw: unknown) {
  if (Array.isArray(message)) {
    return message
      .map((segment) => {
        const item = segment as { type?: string; data?: { text?: string } };
        return item.type === 'text' ? text(item.data?.text) : '';
      })
      .join('')
      .trim();
  }
  if (typeof message === 'string')
    return message.replace(/\[CQ:[^\]]+\]/g, '').trim();
  return text(raw).trim();
}

function qqReceive(
  config: AssistantConfig,
  request: AssistantRequest,
): AssistantReceive {
  const accessToken = text(config.accessToken).trim();
  if (accessToken) {
    const header = text(request.headers.authorization);
    const expected = `Bearer ${accessToken}`;
    if (!header || !sameSecret(header, expected))
      bad('QQ 机器人回调 Access Token 校验失败');
  }
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(request.rawBody || '{}') as Record<string, unknown>;
  } catch {
    bad('QQ 机器人回调内容不是合法 JSON');
  }
  if (text(payload.post_type) !== 'message') {
    return { response: { status: 204, body: '' }, events: [] };
  }
  const messageType = text(payload.message_type);
  const groupId = text(payload.group_id);
  const userId = text(payload.user_id);
  const content = qqMessageText(payload.message, payload.raw_message);
  if (!content || (!groupId && !userId)) {
    return { response: { status: 204, body: '' }, events: [] };
  }
  const chatId =
    messageType === 'group' ? `group:${groupId}` : `private:${userId}`;
  return {
    response: { status: 204, body: '' },
    events: [
      {
        chatId,
        userId,
        userName:
          text(
            (payload.sender as { nickname?: string } | undefined)?.nickname,
          ) || userId,
        text: content,
        messageId: text(payload.message_id),
        replyTarget: {
          messageType,
          groupId,
          userId,
        },
      },
    ],
  };
}

async function qqSend(
  config: AssistantConfig,
  target: { chatId: string; replyTarget: Record<string, string> },
  content: string,
) {
  const base = onebotBase(config);
  const accessToken = text(config.accessToken).trim();
  const isGroup =
    target.replyTarget.messageType === 'group' ||
    target.chatId.startsWith('group:');
  const id = isGroup
    ? text(target.replyTarget.groupId) || target.chatId.replace(/^group:/, '')
    : text(target.replyTarget.userId) || target.chatId.replace(/^private:/, '');
  const { data } = await requestJson<{ status?: string; retcode?: number }>(
    `${base}/${isGroup ? 'send_group_msg' : 'send_private_msg'}`,
    {
      method: 'POST',
      operation: 'assistant_qq_send',
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
      body: isGroup
        ? { group_id: Number(id), message: content }
        : { user_id: Number(id), message: content },
    },
  );
  if (data.status !== 'ok' && Number(data.retcode ?? 0) !== 0)
    upstream('QQ 机器人：消息发送失败，请检查 OneBot 实现是否在线');
}

/* ---------------- 群机器人（只出不进） ---------------- */

async function wecomBotSend(config: AssistantConfig, content: string) {
  const raw = requireField(config, 'webhookKey', 'Webhook Key');
  const key = raw.includes('key=') ? raw.slice(raw.indexOf('key=') + 4) : raw;
  const { data } = await requestJson<{ errcode?: number; errmsg?: string }>(
    `${WECOM_BASE}/cgi-bin/webhook/send?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      operation: 'assistant_wecom_bot_send',
      body: { msgtype: 'text', text: { content } },
    },
  );
  if (Number(data.errcode ?? 0) !== 0)
    wecomError(data.errcode, data.errmsg, '企业微信群机器人');
}

async function dingtalkWebhookSend(config: AssistantConfig, content: string) {
  const raw = requireField(config, 'webhookUrl', 'Webhook 地址');
  if (!/^https?:\/\//i.test(raw))
    bad('钉钉自定义群机器人：Webhook 地址必须以 http:// 或 https:// 开头');
  let url = raw;
  const secret = text(config.signSecret).trim();
  if (secret) {
    const timestamp = String(Date.now());
    url = `${raw}${raw.includes('?') ? '&' : '?'}timestamp=${timestamp}&sign=${encodeURIComponent(dingtalkSign(secret, timestamp))}`;
  }
  const { data } = await requestJson<{ errcode?: number; errmsg?: string }>(
    url,
    {
      method: 'POST',
      operation: 'assistant_dingtalk_webhook_send',
      body: { msgtype: 'text', text: { content } },
    },
  );
  if (Number(data.errcode ?? 0) !== 0)
    upstream(
      `钉钉自定义群机器人：发送失败（${Number(data.errcode)}${data.errmsg ? ` ${data.errmsg}` : ''}）`,
    );
}

/* ---------------- 自定义渠道（JSON 映射 + 模板出站） ---------------- */

type CustomMapping = {
  chatId?: string;
  userId?: string;
  userName?: string;
  text?: string;
  messageId?: string;
  extra?: Record<string, string>;
};

type CustomVars = Record<string, string>;

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  const value = text(raw).trim();
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    bad(`${label}不是合法 JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    bad(`${label}必须是 JSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

function pickPath(payload: unknown, path: string): unknown {
  const key = path.trim();
  if (!key) return undefined;
  let current: unknown = payload;
  for (const part of key.split('.')) {
    if (!part) continue;
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function scalar(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function readMapping(config: AssistantConfig): CustomMapping {
  return parseJsonObject(text(config.inboundMapping), '入站映射');
}

function headerValue(headers: Record<string, string>, name: string) {
  const target = name.trim().toLowerCase();
  if (!target) return '';
  for (const [key, value] of Object.entries(headers)) {
    if (key.trim().toLowerCase() === target) return text(value);
  }
  return '';
}

function customSecurity(config: AssistantConfig) {
  const mode = text(config.securityMode).trim().toLowerCase() || 'none';
  if (!['none', 'header', 'hmac'].includes(mode)) {
    bad('自定义渠道：校验方式只能是 none / header / hmac');
  }
  const secret = text(config.securitySecret).trim();
  const header =
    text(config.securityHeader).trim() ||
    (mode === 'hmac' ? 'x-signature' : 'x-channel-token');
  if (mode !== 'none' && !secret) {
    bad('自定义渠道缺少「校验密钥」，请重新保存这条渠道');
  }
  return { mode: mode as 'none' | 'header' | 'hmac', secret, header };
}

function hmacHex(secret: string, body: string) {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function customAck(config: AssistantConfig): AssistantHttpResponse {
  const raw = Number(text(config.ackStatus).trim() || 200);
  const status = Number.isInteger(raw) && raw >= 200 && raw <= 599 ? raw : 200;
  const body = text(config.ackBody);
  const trimmed = body.trim();
  return {
    status,
    body,
    contentType:
      trimmed.startsWith('{') || trimmed.startsWith('[')
        ? 'application/json; charset=utf-8'
        : 'text/plain; charset=utf-8',
  };
}

function renderTemplate(template: string, vars: CustomVars): string {
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g,
    (_matched, key: string) => vars[key] ?? '',
  );
}

function renderValue(value: unknown, vars: CustomVars): unknown {
  if (typeof value === 'string') return renderTemplate(value, vars);
  if (Array.isArray(value)) return value.map((item) => renderValue(item, vars));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        renderValue(item, vars),
      ]),
    );
  }
  return value;
}

/**
 * 出站正文：能解析成 JSON 就按结构替换占位符再序列化（转义交给 JSON.stringify），
 * 否则按纯文本模板替换，配合自定义 Content-Type 使用。
 */
function renderBody(template: string, vars: CustomVars): string {
  const raw = text(template).trim();
  if (!raw) return '';
  try {
    return JSON.stringify(renderValue(JSON.parse(raw), vars));
  } catch {
    return renderTemplate(raw, vars);
  }
}

function renderHeaders(
  template: Record<string, unknown>,
  vars: CustomVars,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(template)) {
    const name = key.trim();
    if (!name) continue;
    headers[name] = renderTemplate(scalar(value), vars).replace(
      /[\r\n]+/g,
      ' ',
    );
  }
  return headers;
}

function customReceive(
  config: AssistantConfig,
  request: AssistantRequest,
): AssistantReceive {
  const security = customSecurity(config);
  if (security.mode !== 'none') {
    const provided = headerValue(request.headers, security.header);
    if (!provided) bad('自定义渠道：回调缺少校验请求头');
    const expected =
      security.mode === 'hmac'
        ? hmacHex(security.secret, request.rawBody)
        : security.secret;
    if (!sameSecret(provided, expected)) {
      bad('自定义渠道：回调校验失败');
    }
  }
  const payload = request.rawBody.trim()
    ? parseJsonObject(request.rawBody, '回调请求体')
    : request.query;
  const mapping = readMapping(config);
  const read = (path?: string) => (path ? scalar(pickPath(payload, path)) : '');
  const chatId = read(mapping.chatId);
  const content = read(mapping.text);
  if (!chatId && !content) {
    // 平台探活/地址校验：只回执，不建会话
    return { response: customAck(config), events: [] };
  }
  if (!chatId) bad('自定义渠道：入站映射没取到会话标识（chatId）');
  if (!content.trim()) bad('自定义渠道：入站映射没取到消息内容（text）');
  const extra: Record<string, string> = {};
  const extraMapping =
    mapping.extra && typeof mapping.extra === 'object' ? mapping.extra : {};
  for (const [key, path] of Object.entries(extraMapping)) {
    const value = read(scalar(path));
    if (value) extra[key.slice(0, 40)] = value.slice(0, 500);
  }
  return {
    response: customAck(config),
    events: [
      {
        chatId: chatId.slice(0, 191),
        userId: (read(mapping.userId) || chatId).slice(0, 191),
        userName: read(mapping.userName).slice(0, 120),
        text: content,
        messageId: read(mapping.messageId).slice(0, 191),
        replyTarget: {},
        extra,
      },
    ],
  };
}

async function customSend(
  config: AssistantConfig,
  target: {
    chatId: string;
    userId: string;
    userName?: string;
    messageId: string;
    extra?: Record<string, string>;
  },
  content: string,
) {
  const url = requireField(config, 'outboundUrl', '出站地址');
  const security = customSecurity(config);
  const vars: CustomVars = {
    chatId: target.chatId,
    userId: target.userId,
    userName: target.userName || '',
    text: content,
    messageId: target.messageId,
    ...Object.fromEntries(
      Object.entries(target.extra || {}).map(([key, value]) => [
        `extra.${key}`,
        value,
      ]),
    ),
  };
  const headers = renderHeaders(
    parseJsonObject(text(config.outboundHeaders), '出站请求头'),
    vars,
  );
  const body = renderBody(text(config.outboundBody), vars);
  if (security.mode === 'header') {
    headers[security.header.toLowerCase()] = security.secret;
  } else if (security.mode === 'hmac') {
    headers[security.header.toLowerCase()] = hmacHex(security.secret, body);
  }
  const method = (text(config.outboundMethod).trim() || 'POST').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    bad('自定义渠道：出站方法只支持 GET/POST/PUT/PATCH/DELETE');
  }
  const noBody = method === 'GET' || method === 'DELETE';
  if (!noBody && body) {
    const hasContentType = Object.keys(headers).some(
      (key) => key.toLowerCase() === 'content-type',
    );
    if (!hasContentType) headers['content-type'] = 'application/json';
  }
  const checked = await assertOutboundUrl(url);
  let response: { status: number; ok: boolean };
  try {
    response = await httpRequest(checked.toString(), {
      method,
      headers,
      body: noBody ? undefined : body || undefined,
      timeoutMs: API_TIMEOUT_MS,
      readAs: 'text',
      operation: 'service_desk_custom_send',
      redirect: 'manual',
    });
  } catch (error) {
    if (error instanceof TransportError) {
      upstream('自定义渠道：连不上出站地址，请检查域名与网络');
    }
    throw error;
  }
  if (response.status >= 300 && response.status < 400) {
    upstream('自定义渠道：出站地址发生重定向，已拒绝跟随，请直接填最终地址');
  }
  if (!response.ok) {
    upstream(`自定义渠道：对方返回 ${response.status}`);
  }
}

async function customTest(config: AssistantConfig) {
  const mapping = readMapping(config);
  if (!text(mapping.chatId).trim() || !text(mapping.text).trim()) {
    bad('自定义渠道：入站映射必须包含 chatId 与 text');
  }
  customSecurity(config);
  parseJsonObject(text(config.outboundHeaders), '出站请求头');
  const url = requireField(config, 'outboundUrl', '出站地址');
  const checked = await assertOutboundUrl(url);
  let status = 0;
  try {
    const response = await httpRequest(checked.toString(), {
      method: 'HEAD',
      timeoutMs: 8_000,
      readAs: 'empty',
      operation: 'service_desk_custom_probe',
      redirect: 'manual',
    });
    status = response.status;
  } catch (error) {
    if (error instanceof TransportError) {
      upstream('自定义渠道：出站地址不可达，请检查域名与网络');
    }
    throw error;
  }
  if (status >= 300 && status < 400) {
    return {
      ok: false,
      message: '出站地址会发生重定向，实际发送会被拒绝，请直接填最终地址',
    };
  }
  return { ok: true, message: '配置校验通过，出站地址可达（未发送测试消息）' };
}

/* ---------------- 对外统一入口 ---------------- */

export async function receiveAssistantMessage(
  kind: ChannelKind,
  config: AssistantConfig,
  request: AssistantRequest,
  cursor: string,
): Promise<AssistantReceive> {
  switch (kind) {
    case 'wecom_app':
      return wecomAppReceive(config, request);
    case 'wecom_kf':
      return wecomKfReceive(config, request, cursor);
    case 'wechat_mp':
      return wechatMpReceive(config, request);
    case 'dingtalk_robot':
      return dingtalkReceive(config, request);
    case 'feishu_app':
      return feishuReceive(config, request);
    case 'qq_onebot':
      return qqReceive(config, request);
    case 'custom':
      return customReceive(config, request);
    default:
      return { response: { status: 404, body: '' }, events: [] };
  }
}

export async function sendAssistantMessage(
  kind: ChannelKind,
  config: AssistantConfig,
  target: {
    chatId: string;
    userId: string;
    replyTarget: Record<string, string>;
    messageId: string;
    userName?: string;
    extra?: Record<string, string>;
  },
  reply: string,
): Promise<void> {
  const content = reply.slice(0, 1800);
  switch (kind) {
    case 'wecom_app':
      return wecomAppSend(config, target, content);
    case 'wecom_kf':
      return wecomKfSend(config, target, content);
    case 'wechat_mp':
      return wechatMpSend(config, target, content);
    case 'dingtalk_robot':
      return dingtalkSend(config, target, content);
    case 'feishu_app':
      return feishuSend(config, target, content);
    case 'qq_onebot':
      return qqSend(config, target, content);
    case 'wecom_bot':
      return wecomBotSend(config, content);
    case 'dingtalk_webhook':
      return dingtalkWebhookSend(config, content);
    case 'custom':
      return customSend(config, target, content);
    default:
      bad('不支持的助理通道类型');
  }
}

export async function testAssistantChannel(
  kind: ChannelKind,
  config: AssistantConfig,
): Promise<{ ok: boolean; message: string }> {
  try {
    switch (kind) {
      case 'wecom_app': {
        await wecomAccessToken(config, '企业微信应用');
        return { ok: true, message: '凭据有效，企业微信应用可以收发消息' };
      }
      case 'wecom_kf': {
        await wecomAccessToken(config, '微信客服');
        return { ok: true, message: '凭据有效，微信客服可以收发消息' };
      }
      case 'wechat_mp': {
        await wechatMpAccessToken(config);
        return { ok: true, message: '凭据有效，微信公众号可以收发消息' };
      }
      case 'dingtalk_robot': {
        await dingtalkRobotToken(config);
        return { ok: true, message: '凭据有效，钉钉机器人可以收发消息' };
      }
      case 'feishu_app': {
        await feishuTenantToken(config);
        return { ok: true, message: '凭据有效，飞书应用可以收发消息' };
      }
      case 'qq_onebot': {
        const base = onebotBase(config);
        const accessToken = text(config.accessToken).trim();
        const { ok } = await requestJson<Record<string, unknown>>(
          `${base}/get_login_info`,
          {
            operation: 'assistant_qq_probe',
            timeoutMs: 10_000,
            headers: accessToken
              ? { authorization: `Bearer ${accessToken}` }
              : {},
          },
        );
        if (!ok) upstream('QQ 机器人：OneBot 实现返回异常');
        return { ok: true, message: '已连上 OneBot 实现，可以收发消息' };
      }
      case 'wecom_bot': {
        await wecomBotSend(
          config,
          '「Agent 助理」连接测试：收到这条消息说明企业微信群机器人已配置成功。',
        );
        return { ok: true, message: '已在群里发送一条测试消息' };
      }
      case 'dingtalk_webhook': {
        await dingtalkWebhookSend(
          config,
          '「Agent 助理」连接测试：收到这条消息说明钉钉群机器人已配置成功。',
        );
        return { ok: true, message: '已在群里发送一条测试消息' };
      }
      case 'custom':
        return await customTest(config);
      default:
        bad('不支持的助理通道类型');
    }
  } catch (error) {
    if (error instanceof BusinessException)
      return { ok: false, message: error.message };
    return { ok: false, message: '测试失败，请检查网络与凭据' };
  }
}

/** 生成回调地址里的随机串（32 位小写十六进制，与飞书同步回调同风格）。 */
export function createAssistantToken() {
  return randomBytes(16).toString('hex');
}

export { decryptWechatXml, dingtalkSign, wechatAesKey };
