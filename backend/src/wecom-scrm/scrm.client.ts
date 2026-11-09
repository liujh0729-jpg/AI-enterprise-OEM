import { createHash } from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { httpRequest } from '../http/transport';

/**
 * 企业微信「外部联系人 / 客户群 / 群发 / 联系我 / 在职继承」服务端客户端。
 *
 * - 令牌按 (corpId, Secret) 在进程内缓存，提前 5 分钟刷新；
 * - 全局限速 18 QPS（官方上限 20，留出余量），超限请求排队而不是直接失败；
 * - 42001/40014/41001（令牌过期）自动换令牌重试一次；
 * - 上游原文不外传，统一翻译成可操作的中文提示。
 */

const BASE = 'https://qyapi.weixin.qq.com/cgi-bin';
const TIMEOUT_MS = 20_000;
const MAX_QPS = 18;

export type WecomTagGroup = {
  group_id: string;
  group_name: string;
  create_time?: number;
  order?: number;
  tag?: { id: string; name: string; create_time?: number; order?: number }[];
};

export type WecomExternalContact = {
  external_userid: string;
  name?: string;
  position?: string;
  avatar?: string;
  corp_name?: string;
  corp_full_name?: string;
  type?: number;
  gender?: number;
  unionid?: string;
  external_profile?: Record<string, unknown>;
};

export type WecomFollowInfo = {
  userid?: string;
  remark?: string;
  description?: string;
  createtime?: number;
  createtimestamp?: number;
  tag_id?: string[];
  remark_corp_name?: string;
  remark_mobiles?: string[];
  oper_userid?: string[];
  add_way?: number;
  state?: string;
  wechat_channels?: Record<string, unknown>;
};

export type WecomChatSummary = { chat_id: string; status?: number };
export type WecomChatMember = {
  type?: number;
  userid?: string;
  external_userid?: string;
  unionid?: string;
  join_time?: number;
  join_scene?: number;
  group_nickname?: string;
  name?: string;
  invitor?: { userid?: string };
};
export type WecomChatDetail = {
  chat_id: string;
  name?: string;
  owner?: string;
  create_time?: number;
  notice?: string;
  member_list?: WecomChatMember[];
  admin_list?: { userid?: string }[];
};

type CachedToken = { token: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

/** 简单令牌桶：滑动窗口内最多 MAX_QPS 个请求。 */
class QpsLimiter {
  private readonly stamps: number[] = [];

  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (this.stamps.length && this.stamps[0] <= now - 1000) {
        this.stamps.shift();
      }
      if (this.stamps.length < MAX_QPS) {
        this.stamps.push(now);
        return;
      }
      const wait = Math.max(10, this.stamps[0] + 1000 - now);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

const limiter = new QpsLimiter();

const ERRORS: Record<number, string> = {
  40001: 'Secret 无效或已重置，请在企微后台重新获取后保存',
  40013: '企业 CorpID 无效，请核对企微后台的企业 ID',
  40014: 'access_token 无效，请重新保存凭据',
  41001: '缺少 access_token，请重新保存凭据',
  42001: 'access_token 已过期，请重试',
  60011: '应用没有该接口权限，请在企微后台开通「客户联系」并授权',
  60020:
    '服务器 IP 不在企微可信 IP 名单内，请在企微后台「应用管理 → 企业可信IP」添加本站出口 IP',
  45009: '调用超过企微频率限制，请稍后重试',
  84061: '「客户联系」功能未开通，请在企微后台开通后重试',
  301002: '不是该客户的联系人，无法操作',
  41050: '该客户已不是你的外部联系人',
};

const UPSTREAM = [42001, 40014, 41001];

async function httpJson<T>(
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  await limiter.take();
  try {
    const result = await httpRequest<unknown>(url, {
      method: init?.method || 'GET',
      headers: { 'content-type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      timeoutMs: TIMEOUT_MS,
      operation: 'wecom-scrm.upstream',
    });
    return (result.data ?? {}) as T;
  } catch {
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      '连接企业微信超时或网络不可用，请稍后重试',
    );
  }
}

type Envelope = { errcode?: number; errmsg?: string };

export class ScrmClient {
  private async fetchToken(corpId: string, secret: string): Promise<string> {
    const key = `scrm:${corpId}:${createHash('sha1').update(secret).digest('hex').slice(0, 12)}`;
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 300_000) return cached.token;
    const data = await httpJson<
      Envelope & { access_token?: string; expires_in?: number }
    >(
      `${BASE}/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`,
    );
    if (!data.access_token) {
      const code = Number(data.errcode ?? 0);
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        ERRORS[code] ||
          `企业微信凭据无效：${data.errmsg || '请检查 CorpID / Secret'}`,
      );
    }
    tokenCache.set(key, {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
    });
    return data.access_token;
  }

  /** 统一调用：GET 把参数拼 query，POST 走 JSON；令牌过期自动刷新重试一次。 */
  private async call<T extends Envelope>(
    corpId: string,
    secret: string,
    method: 'GET' | 'POST',
    path: string,
    query?: Record<string, string | number | undefined>,
    body?: unknown,
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.fetchToken(corpId, secret);
      const search = new URLSearchParams({ access_token: token });
      for (const [key, value] of Object.entries(query || {})) {
        if (value !== undefined && value !== '') search.set(key, String(value));
      }
      const url = `${BASE}/${path}?${search.toString()}`;
      const data = await httpJson<T>(
        url,
        method === 'POST' ? { method, body: body ?? {} } : undefined,
      );
      const code = Number(data.errcode ?? 0);
      if (!code) return data;
      if (UPSTREAM.includes(code) && attempt === 0) {
        tokenCache.delete(
          `scrm:${corpId}:${createHash('sha1').update(secret).digest('hex').slice(0, 12)}`,
        );
        continue;
      }
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `企业微信接口失败：${ERRORS[code] || data.errmsg || `errcode=${code}`}`,
      );
    }
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      '企业微信令牌刷新失败，请重新保存凭据',
    );
  }

  // ---------- 通讯录（只读探针） ----------
  async departments(corpId: string, secret: string): Promise<number> {
    const data = await this.call<Envelope & { department?: unknown[] }>(
      corpId,
      secret,
      'GET',
      'department/list',
    );
    return (data.department || []).length;
  }

  // ---------- 外部联系人 ----------
  /** 有「客户联系」权限的成员 userid 列表。 */
  async followUsers(corpId: string, secret: string): Promise<string[]> {
    const data = await this.call<Envelope & { follow_user?: string[] }>(
      corpId,
      secret,
      'POST',
      'externalcontact/get_follow_user_list',
      undefined,
      {},
    );
    return data.follow_user || [];
  }

  /** 批量拉取外部联系人（cursor 分页，limit 上限 100）。 */
  async batchContacts(
    corpId: string,
    secret: string,
    userIds: string[],
    cursor = '',
    limit = 100,
  ): Promise<{
    list: {
      external_contact: WecomExternalContact;
      follow_info: WecomFollowInfo;
    }[];
    nextCursor: string;
  }> {
    const data = await this.call<
      Envelope & {
        external_contact_list?: {
          external_contact: WecomExternalContact;
          follow_info: WecomFollowInfo;
        }[];
        next_cursor?: string;
      }
    >(corpId, secret, 'POST', 'externalcontact/batch/get_by_user', undefined, {
      userid_list: userIds.slice(0, 100),
      cursor,
      limit: Math.min(Math.max(limit, 1), 100),
    });
    return {
      list: data.external_contact_list || [],
      nextCursor: data.next_cursor || '',
    };
  }

  async contactDetail(
    corpId: string,
    secret: string,
    externalUserId: string,
  ): Promise<{
    contact: WecomExternalContact | null;
    follows: WecomFollowInfo[];
  }> {
    const data = await this.call<
      Envelope & {
        external_contact?: WecomExternalContact;
        follow_user?: WecomFollowInfo[];
      }
    >(corpId, secret, 'GET', 'externalcontact/get', {
      external_userid: externalUserId,
    });
    return {
      contact: data.external_contact || null,
      follows: data.follow_user || [],
    };
  }

  async tagGroups(corpId: string, secret: string): Promise<WecomTagGroup[]> {
    const data = await this.call<Envelope & { tag_group?: WecomTagGroup[] }>(
      corpId,
      secret,
      'POST',
      'externalcontact/get_corp_tag_list',
      undefined,
      {},
    );
    return data.tag_group || [];
  }

  async markTag(
    corpId: string,
    secret: string,
    userId: string,
    externalUserId: string,
    addTag: string[],
    removeTag: string[],
  ): Promise<void> {
    await this.call<Envelope>(
      corpId,
      secret,
      'POST',
      'externalcontact/mark_tag',
      undefined,
      {
        userid: userId,
        external_userid: externalUserId,
        add_tag: addTag,
        remove_tag: removeTag,
      },
    );
  }

  // ---------- 客户群 ----------
  async chatList(
    corpId: string,
    secret: string,
    cursor = '',
    limit = 100,
    ownerUserIds: string[] = [],
  ): Promise<{ list: WecomChatSummary[]; nextCursor: string }> {
    const data = await this.call<
      Envelope & { group_chat_list?: WecomChatSummary[]; next_cursor?: string }
    >(corpId, secret, 'POST', 'externalcontact/groupchat/list', undefined, {
      status_filter: 0,
      owner_filter: ownerUserIds.length
        ? { userid_list: ownerUserIds.slice(0, 100) }
        : undefined,
      cursor,
      limit: Math.min(Math.max(limit, 1), 100),
    });
    return {
      list: data.group_chat_list || [],
      nextCursor: data.next_cursor || '',
    };
  }

  async chatDetail(
    corpId: string,
    secret: string,
    chatId: string,
  ): Promise<WecomChatDetail | null> {
    const data = await this.call<Envelope & { group_chat?: WecomChatDetail }>(
      corpId,
      secret,
      'POST',
      'externalcontact/groupchat/get',
      undefined,
      { chat_id: chatId, need_name: 1 },
    );
    return data.group_chat || null;
  }

  // ---------- 群发 ----------
  async addMsgTemplate(
    corpId: string,
    secret: string,
    body: Record<string, unknown>,
  ): Promise<{ msgid: string; failList: string[] }> {
    const data = await this.call<
      Envelope & { msgid?: string; fail_list?: string[] }
    >(
      corpId,
      secret,
      'POST',
      'externalcontact/add_msg_template',
      undefined,
      body,
    );
    return { msgid: data.msgid || '', failList: data.fail_list || [] };
  }

  async groupMsgTasks(
    corpId: string,
    secret: string,
    msgId: string,
  ): Promise<{ userid: string; status: number; send_time?: number }[]> {
    const data = await this.call<
      Envelope & {
        task_list?: { userid: string; status: number; send_time?: number }[];
      }
    >(corpId, secret, 'POST', 'externalcontact/get_groupmsg_task', undefined, {
      msgid: msgId,
    });
    return data.task_list || [];
  }

  async groupMsgResults(
    corpId: string,
    secret: string,
    msgId: string,
    userId: string,
  ): Promise<
    {
      external_userid?: string;
      chat_id?: string;
      status: number;
      send_time?: number;
      error_code?: number;
      error_msg?: string;
    }[]
  > {
    const data = await this.call<
      Envelope & {
        send_list?: {
          external_userid?: string;
          chat_id?: string;
          status: number;
          send_time?: number;
          error_code?: number;
          error_msg?: string;
        }[];
      }
    >(
      corpId,
      secret,
      'POST',
      'externalcontact/get_groupmsg_send_result',
      undefined,
      { msgid: msgId, userid: userId },
    );
    return data.send_list || [];
  }

  async addMomentTask(
    corpId: string,
    secret: string,
    body: Record<string, unknown>,
  ): Promise<{ taskId: string; invalidSenders: string[] }> {
    const data = await this.call<
      Envelope & {
        task_id?: string;
        invalid_sender_list?: { user_list?: string[] }[];
      }
    >(
      corpId,
      secret,
      'POST',
      'externalcontact/add_moment_task',
      undefined,
      body,
    );
    const invalid = (data.invalid_sender_list || []).flatMap(
      (item) => item.user_list || [],
    );
    return { taskId: data.task_id || '', invalidSenders: invalid };
  }

  async momentTaskResult(
    corpId: string,
    secret: string,
    taskId: string,
  ): Promise<{ total: number; sent: number; failed: number }> {
    const data = await this.call<
      Envelope & {
        task_list?: { userid?: string; status?: number }[];
      }
    >(
      corpId,
      secret,
      'POST',
      'externalcontact/get_moment_task_result',
      undefined,
      {
        task_id: taskId,
      },
    );
    const rows = data.task_list || [];
    const sent = rows.filter((row) => Number(row.status ?? 0) === 1).length;
    return { total: rows.length, sent, failed: rows.length - sent };
  }

  // ---------- 欢迎语 / 联系我 ----------
  async sendWelcome(
    corpId: string,
    secret: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    await this.call<Envelope>(
      corpId,
      secret,
      'POST',
      'externalcontact/send_welcome_msg',
      undefined,
      body,
    );
  }

  async addContactWay(
    corpId: string,
    secret: string,
    body: Record<string, unknown>,
  ): Promise<{ configId: string; qrCode: string }> {
    const data = await this.call<
      Envelope & { config_id?: string; qr_code?: string }
    >(
      corpId,
      secret,
      'POST',
      'externalcontact/add_contact_way',
      undefined,
      body,
    );
    return { configId: data.config_id || '', qrCode: data.qr_code || '' };
  }

  async getContactWay(
    corpId: string,
    secret: string,
    configId: string,
  ): Promise<{ qrCode: string; state: string }> {
    const data = await this.call<
      Envelope & { contact_way?: { state?: string }; qr_code?: string }
    >(corpId, secret, 'POST', 'externalcontact/get_contact_way', undefined, {
      config_id: configId,
    });
    return {
      qrCode: data.qr_code || '',
      state: data.contact_way?.state || '',
    };
  }

  /** 更新活码引流成员：用于「某人达到当日上限后自动切换」。 */
  async updateContactWay(
    corpId: string,
    secret: string,
    configId: string,
    userIds: string[],
  ): Promise<void> {
    await this.call<Envelope>(
      corpId,
      secret,
      'POST',
      'externalcontact/update_contact_way',
      undefined,
      { config_id: configId, user: userIds.slice(0, 100) },
    );
  }

  async delContactWay(
    corpId: string,
    secret: string,
    configId: string,
  ): Promise<void> {
    await this.call<Envelope>(
      corpId,
      secret,
      'POST',
      'externalcontact/del_contact_way',
      undefined,
      { config_id: configId },
    );
  }

  // ---------- 在职 / 离职继承 ----------
  async transferCustomer(
    corpId: string,
    secret: string,
    body: Record<string, unknown>,
  ): Promise<{ failList: string[] }> {
    const data = await this.call<Envelope & { fail_list?: string[] }>(
      corpId,
      secret,
      'POST',
      'externalcontact/transfer_customer',
      undefined,
      body,
    );
    return { failList: data.fail_list || [] };
  }

  /** 分配离职成员的客户：客户 24 小时内未拒绝则自动接替。 */
  async resignedTransferCustomer(
    corpId: string,
    secret: string,
    body: Record<string, unknown>,
  ): Promise<{ failList: string[] }> {
    const data = await this.call<Envelope & { fail_list?: string[] }>(
      corpId,
      secret,
      'POST',
      'externalcontact/resigned/transfer_customer',
      undefined,
      body,
    );
    return { failList: data.fail_list || [] };
  }

  async transferResult(
    corpId: string,
    secret: string,
    handoverType: 0 | 1,
    cursor = '',
    limit = 100,
  ): Promise<{
    list: {
      handover_userid?: string;
      takeover_userid?: string;
      external_userid?: string;
      status?: number;
      errcode?: number;
    }[];
    nextCursor: string;
  }> {
    const data = await this.call<
      Envelope & {
        customer?: {
          handover_userid?: string;
          takeover_userid?: string;
          external_userid?: string;
          status?: number;
          errcode?: number;
        }[];
        next_cursor?: string;
      }
    >(
      corpId,
      secret,
      'POST',
      'externalcontact/get_transfer_result',
      undefined,
      {
        handover_type: handoverType,
        cursor,
        limit: Math.min(Math.max(limit, 1), 1000),
      },
    );
    return { list: data.customer || [], nextCursor: data.next_cursor || '' };
  }

  async unassignedList(
    corpId: string,
    secret: string,
    cursor = '',
    pageSize = 100,
  ): Promise<{
    list: {
      handover_userid?: string;
      external_userid?: string;
      dimission_time?: number;
    }[];
    nextCursor: string;
  }> {
    const data = await this.call<
      Envelope & {
        info?: {
          handover_userid?: string;
          external_userid?: string;
          dimission_time?: number;
        }[];
        next_cursor?: string;
      }
    >(
      corpId,
      secret,
      'POST',
      'externalcontact/get_unassigned_list',
      undefined,
      {
        page_size: Math.min(Math.max(pageSize, 1), 1000),
        cursor,
      },
    );
    return { list: data.info || [], nextCursor: data.next_cursor || '' };
  }

  async transferGroupChat(
    corpId: string,
    secret: string,
    chatIds: string[],
    newOwner: string,
  ): Promise<{ failList: string[] }> {
    const data = await this.call<Envelope & { failed_chat_list?: string[] }>(
      corpId,
      secret,
      'POST',
      'externalcontact/groupchat/transfer',
      undefined,
      { chat_id_list: chatIds.slice(0, 100), new_owner: newOwner },
    );
    return { failList: data.failed_chat_list || [] };
  }

  /** 分配离职成员的客户群：新群主立即生效。 */
  async resignedTransferGroupChat(
    corpId: string,
    secret: string,
    chatIds: string[],
    newOwner: string,
  ): Promise<{ failList: string[] }> {
    const data = await this.call<Envelope & { failed_chat_list?: string[] }>(
      corpId,
      secret,
      'POST',
      'externalcontact/groupchat/resigned/transfer',
      undefined,
      { chat_id_list: chatIds.slice(0, 100), new_owner: newOwner },
    );
    return { failList: data.failed_chat_list || [] };
  }

  // ---------- 应用消息 ----------
  async sendText(
    corpId: string,
    secret: string,
    agentId: string,
    toUser: string,
    content: string,
  ): Promise<void> {
    await this.call<Envelope>(
      corpId,
      secret,
      'POST',
      'message/send',
      undefined,
      {
        touser: toUser,
        msgtype: 'text',
        agentid: Number(agentId) || 0,
        text: { content: content.slice(0, 2048) },
      },
    );
  }
}
