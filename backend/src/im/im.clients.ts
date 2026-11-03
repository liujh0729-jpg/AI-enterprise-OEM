import { createDecipheriv, createHash } from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { httpRequest } from '../http/transport';

/**
 * 飞书 / 企业微信的最小服务端客户端：令牌、通讯录读、发消息、审批实例、任务。
 * 上游原文一律不外传，失败给中文可操作提示；令牌按凭据组合在进程内缓存并提前刷新。
 */

export type ImDirectoryMember = {
  externalUserId: string;
  unionId: string;
  name: string;
  mobile: string;
  email: string;
  departmentIds: string[];
};

export type ImDirectoryDept = {
  externalDeptId: string;
  name: string;
  parentExternalId: string;
};

const TIMEOUT_MS = 20_000;
const FEISHU_BASE = 'https://open.feishu.cn/open-apis';
const WECOM_BASE = 'https://qyapi.weixin.qq.com/cgi-bin';

type CachedToken = { token: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

async function httpJson<T>(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: unknown },
): Promise<T> {
  try {
    const result = await httpRequest<unknown>(url, {
      method: init?.method || 'GET',
      headers: {
        'content-type': 'application/json',
        ...(init?.headers || {}),
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      timeoutMs: TIMEOUT_MS,
      operation: 'im.upstream',
    });
    return (result.data ?? {}) as T;
  } catch {
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      '连接 IM 服务超时或网络不可用，请稍后重试',
    );
  }
}

export class FeishuClient {
  async tenantToken(appId: string, appSecret: string): Promise<string> {
    const key = `feishu:${appId}`;
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const data = await httpJson<{
      code?: number;
      msg?: string;
      tenant_access_token?: string;
      expire?: number;
    }>(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      body: { app_id: appId, app_secret: appSecret },
    });
    if (!data.tenant_access_token) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `飞书应用凭据无效：${data.msg || '请检查 App ID / App Secret'}`,
      );
    }
    tokenCache.set(key, {
      token: data.tenant_access_token,
      expiresAt: Date.now() + (data.expire || 3600) * 1000,
    });
    return data.tenant_access_token;
  }

  async departments(token: string): Promise<ImDirectoryDept[]> {
    const out: ImDirectoryDept[] = [];
    let pageToken = '';
    for (let round = 0; round < 20; round += 1) {
      const query = new URLSearchParams({
        parent_department_id: '0',
        fetch_child: 'true',
        page_size: '50',
        department_id_type: 'open_department_id',
        ...(pageToken ? { page_token: pageToken } : {}),
      });
      const data = await httpJson<{
        code?: number;
        msg?: string;
        data?: {
          items?: Array<{
            open_department_id?: string;
            name?: string;
            parent_department_id?: string;
          }>;
          has_more?: boolean;
          page_token?: string;
        };
      }>(`${FEISHU_BASE}/contact/v3/departments?${query}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (data.code && data.code !== 0) {
        throw new BusinessException(
          ErrorCode.FORBIDDEN,
          `飞书通讯录读取失败：${data.msg || '请检查通讯录权限'}`,
        );
      }
      for (const item of data.data?.items || []) {
        if (!item.open_department_id) continue;
        out.push({
          externalDeptId: item.open_department_id,
          name: item.name || '',
          parentExternalId: item.parent_department_id || '',
        });
      }
      if (!data.data?.has_more || !data.data.page_token) break;
      pageToken = data.data.page_token;
    }
    return out;
  }

  async users(token: string): Promise<ImDirectoryMember[]> {
    const depts = await this.departments(token);
    const out: ImDirectoryMember[] = [];
    const seen = new Set<string>();
    const roots = ['0', ...depts.map((item) => item.externalDeptId)];
    for (const deptId of roots) {
      let pageToken = '';
      for (let round = 0; round < 20; round += 1) {
        const query = new URLSearchParams({
          department_id: deptId,
          page_size: '50',
          user_id_type: 'open_id',
          department_id_type: 'open_department_id',
          ...(pageToken ? { page_token: pageToken } : {}),
        });
        const data = await httpJson<{
          code?: number;
          msg?: string;
          data?: {
            items?: Array<{
              open_id?: string;
              union_id?: string;
              name?: string;
              mobile?: string;
              email?: string;
              department_ids?: string[];
            }>;
            has_more?: boolean;
            page_token?: string;
          };
        }>(`${FEISHU_BASE}/contact/v3/users/find_by_department?${query}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (data.code && data.code !== 0) {
          throw new BusinessException(
            ErrorCode.FORBIDDEN,
            `飞书成员读取失败：${data.msg || '请检查通讯录权限'}`,
          );
        }
        for (const item of data.data?.items || []) {
          if (!item.open_id || seen.has(item.open_id)) continue;
          seen.add(item.open_id);
          out.push({
            externalUserId: item.open_id,
            unionId: item.union_id || '',
            name: item.name || '',
            mobile: item.mobile || '',
            email: item.email || '',
            departmentIds: item.department_ids || [],
          });
        }
        if (!data.data?.has_more || !data.data.page_token) break;
        pageToken = data.data.page_token;
      }
    }
    return out;
  }

  async sendCard(
    token: string,
    receiveIdType: 'open_id' | 'chat_id',
    receiveId: string,
    title: string,
    body: string,
    link: string,
  ): Promise<void> {
    const content = {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: title.slice(0, 100) },
      },
      elements: [
        {
          tag: 'div',
          text: { tag: 'lark_md', content: body.slice(0, 2000) },
        },
        ...(link
          ? [
              {
                tag: 'action',
                actions: [
                  {
                    tag: 'button',
                    text: { tag: 'plain_text', content: '去处理' },
                    url: link,
                    type: 'primary',
                  },
                ],
              },
            ]
          : []),
      ],
    };
    const data = await httpJson<{ code?: number; msg?: string }>(
      `${FEISHU_BASE}/im/v1/messages?receive_id_type=${receiveIdType}`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: {
          receive_id: receiveId,
          msg_type: 'interactive',
          content: JSON.stringify(content),
        },
      },
    );
    if (data.code && data.code !== 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `飞书消息发送失败：${data.msg || '请检查应用消息权限'}`,
      );
    }
  }

  async createApprovalInstance(
    token: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const data = await httpJson<{
      code?: number;
      msg?: string;
      data?: Record<string, unknown>;
    }>(`${FEISHU_BASE}/approval/v4/instances`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body,
    });
    if (data.code && data.code !== 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `飞书审批发起失败：${data.msg || '请检查审批定义与权限'}`,
      );
    }
    return data.data || {};
  }

  async createTask(
    token: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const data = await httpJson<{
      code?: number;
      msg?: string;
      data?: Record<string, unknown>;
    }>(`${FEISHU_BASE}/task/v2/tasks`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body,
    });
    if (data.code && data.code !== 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `飞书任务创建失败：${data.msg || '请检查任务权限'}`,
      );
    }
    return data.data || {};
  }

  decryptEvent(encryptKey: string, encrypted: string): Record<string, unknown> {
    try {
      const key = createHash('sha256').update(encryptKey).digest();
      const raw = Buffer.from(encrypted, 'base64');
      const decipher = createDecipheriv(
        'aes-256-cbc',
        key,
        raw.subarray(0, 16),
      );
      const plain = Buffer.concat([
        decipher.update(raw.subarray(16)),
        decipher.final(),
      ]).toString('utf8');
      return JSON.parse(plain) as Record<string, unknown>;
    } catch {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '飞书事件解密失败，请核对 Encrypt Key',
      );
    }
  }
}

export class WecomClient {
  async token(corpId: string, secret: string): Promise<string> {
    const key = `wecom:${corpId}:${secret.slice(-6)}`;
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const data = await httpJson<{
      errcode?: number;
      errmsg?: string;
      access_token?: string;
      expires_in?: number;
    }>(
      `${WECOM_BASE}/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`,
    );
    if (!data.access_token) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `企业微信凭据无效：${data.errmsg || '请检查企业ID / Secret'}`,
      );
    }
    tokenCache.set(key, {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
    });
    return data.access_token;
  }

  async departments(token: string): Promise<ImDirectoryDept[]> {
    const data = await httpJson<{
      errcode?: number;
      errmsg?: string;
      department?: Array<{ id?: number; name?: string; parentid?: number }>;
    }>(`${WECOM_BASE}/department/list?access_token=${token}`);
    if (data.errcode && data.errcode !== 0) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        `企业微信部门读取失败：${data.errmsg || '请检查通讯录同步权限'}`,
      );
    }
    return (data.department || [])
      .filter((item) => item.id)
      .map((item) => ({
        externalDeptId: String(item.id),
        name: item.name || '',
        parentExternalId: item.parentid ? String(item.parentid) : '',
      }));
  }

  async users(token: string): Promise<ImDirectoryMember[]> {
    const depts = await this.departments(token);
    const out: ImDirectoryMember[] = [];
    const seen = new Set<string>();
    const roots = ['1', ...depts.map((item) => item.externalDeptId)];
    for (const deptId of roots) {
      const data = await httpJson<{
        errcode?: number;
        errmsg?: string;
        userlist?: Array<{
          userid?: string;
          name?: string;
          mobile?: string;
          email?: string;
          department?: number[];
          unionid?: string;
        }>;
      }>(
        `${WECOM_BASE}/user/list?access_token=${token}&department_id=${deptId}&fetch_child=1`,
      );
      if (data.errcode && data.errcode !== 0) {
        throw new BusinessException(
          ErrorCode.FORBIDDEN,
          `企业微信成员读取失败：${data.errmsg || '请检查通讯录同步权限'}`,
        );
      }
      for (const item of data.userlist || []) {
        if (!item.userid || seen.has(item.userid)) continue;
        seen.add(item.userid);
        out.push({
          externalUserId: item.userid,
          unionId: item.unionid || '',
          name: item.name || '',
          mobile: item.mobile || '',
          email: item.email || '',
          departmentIds: (item.department || []).map((id) => String(id)),
        });
      }
    }
    return out;
  }

  async sendTextCard(
    token: string,
    agentId: string,
    toUser: string,
    title: string,
    description: string,
    url: string,
  ): Promise<void> {
    // textcard 的 url 必须是绝对地址：站点域名还没配置时退化为纯文本，避免发出一条点不开的卡片。
    const body = /^https?:\/\//i.test(url)
      ? {
          touser: toUser,
          msgtype: 'textcard',
          agentid: Number(agentId) || 0,
          textcard: {
            title: title.slice(0, 100),
            description: description.slice(0, 400),
            url,
            btntxt: '去处理',
          },
        }
      : {
          touser: toUser,
          msgtype: 'text',
          agentid: Number(agentId) || 0,
          text: { content: `${title}\n${description}`.slice(0, 2048) },
        };
    const data = await httpJson<{ errcode?: number; errmsg?: string }>(
      `${WECOM_BASE}/message/send?access_token=${token}`,
      {
        method: 'POST',
        body,
      },
    );
    if (data.errcode && data.errcode !== 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `企业微信消息发送失败：${data.errmsg || '请检查应用消息权限'}`,
      );
    }
  }

  async applyEvent(
    token: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const data = await httpJson<{
      errcode?: number;
      errmsg?: string;
      sp_no?: string;
    }>(`${WECOM_BASE}/oa/applyevent?access_token=${token}`, {
      method: 'POST',
      body,
    });
    if (data.errcode && data.errcode !== 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `企业微信审批发起失败：${data.errmsg || '请检查模板与权限'}`,
      );
    }
    return { spNo: data.sp_no || '' };
  }
}
