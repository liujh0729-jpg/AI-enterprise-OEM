import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { HrmOrg } from '../hrm/hrm.scope';
import { iso } from '../hrm/hrm.helpers';
import type { ApiEnv } from '../http/types';
import type { Services } from '../http/services';
import { ScrmContactService } from './scrm-contact.service';
import { ScrmMaterialService } from './scrm-material.service';
import { ScrmScopeService } from './scrm.scope';
import { ScrmSopService } from './scrm-sop.service';
import { int, nameOf, orgOf } from './scrm.helpers';

/**
 * 员工侧边栏：企微工作台 H5 不携带登录会话，改用 2 小时票据（HMAC 派生自 JWT_SECRET）。
 * 票据只证明「某组织某成员」，每次调用仍重新校验组织在册与企微接入状态；
 * 客户资料只对与该客户确有好友关系的员工开放，其余一律 404。
 */

const TICKET_TTL_MS = 2 * 3600_000;
const WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; resetAt: number }>();

type TicketPayload = {
  o: string;
  u: string;
  m: string;
  e: number;
  n: string;
};

function ticketKey(): Buffer {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) {
    throw new BusinessException(
      ErrorCode.UNAUTHORIZED,
      '服务端未配置 JWT_SECRET，无法签发侧边栏票据',
    );
  }
  return createHmac('sha256', secret)
    .update('wecom-scrm-sidebar-ticket')
    .digest();
}

function sign(payload: string): string {
  return createHmac('sha256', ticketKey()).update(payload).digest('base64url');
}

function limited(key: string, max = 120): boolean {
  const now = Date.now();
  const row = hits.get(key);
  if (!row || row.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  row.count += 1;
  return row.count > max;
}

const clientIp = (c: Context<ApiEnv>) =>
  (c.req.header('x-forwarded-for') || '').split(',')[0].trim() ||
  c.req.header('x-real-ip') ||
  '0.0.0.0';

const json = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify({ code: status === 200 ? 0 : status, message: 'ok', data }),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  );

export class ScrmSidebarService {
  constructor(
    private readonly scope: ScrmScopeService,
    private readonly contacts: ScrmContactService,
    private readonly sops: ScrmSopService,
    private readonly materials: ScrmMaterialService,
  ) {}

  /** 管理端签发：只有已接入企微的组织成员才能拿到票据。 */
  async ticket(user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const corp = await this.scope.requireCorp(org);
    if (!corp.corp.agentId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '尚未配置企微自建应用 AgentId，侧边栏无法打开',
      );
    }
    const member = await this.scope.requireMember(org, user.userId);
    const expiresAt = Date.now() + TICKET_TTL_MS;
    const payload: TicketPayload = {
      o: org.orgType,
      u: org.orgUserId,
      m: member,
      e: expiresAt,
      n: randomBytes(8).toString('hex'),
    };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return {
      ticket: `${body}.${sign(body)}`,
      expiresAt: iso(new Date(expiresAt)),
    };
  }

  /** 票据验签 + 组织/成员/企微状态复核；任何一项不满足都按未授权处理。 */
  private async open(
    ticket: string,
  ): Promise<{ org: HrmOrg; memberUserId: string }> {
    const parts = String(ticket || '').split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '侧边栏票据不合法');
    }
    const expected = Buffer.from(sign(parts[0]));
    const received = Buffer.from(parts[1]);
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '侧边栏票据校验失败');
    }
    let payload: TicketPayload;
    try {
      payload = JSON.parse(
        Buffer.from(parts[0], 'base64url').toString('utf8'),
      ) as TicketPayload;
    } catch {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '侧边栏票据不合法');
    }
    if (
      !payload ||
      typeof payload.o !== 'string' ||
      typeof payload.u !== 'string' ||
      typeof payload.m !== 'string' ||
      typeof payload.e !== 'number'
    ) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '侧边栏票据不合法');
    }
    if (payload.e < Date.now()) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '侧边栏票据已过期，请刷新重试',
      );
    }
    const org = orgOf({ orgType: payload.o, orgUserId: payload.u });
    const corp = await this.scope.corp(org);
    if (!corp?.enabled) {
      throw new BusinessException(
        ErrorCode.FEATURE_CLOSED,
        '企业微信 SCRM 未接入或已停用',
      );
    }
    const members = await this.scope.memberUserIds(org);
    if (!members.includes(payload.m)) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '当前账号已不在组织内，请联系管理员重新绑定',
      );
    }
    return { org, memberUserId: payload.m };
  }

  /** 侧边栏首屏：客户 360（仅本人好友）+ 本人待办 + 组织素材库。 */
  async view(ticket: string, contactId: number) {
    const { org, memberUserId } = await this.open(ticket);
    return this.payload(org, memberUserId, contactId);
  }

  /** 登录态预览：后台直接看员工侧边栏效果，口径与公开票据通道一致。 */
  async viewForUser(user: CurrentUser, contactId: number) {
    const org = await this.scope.resolve(user);
    const corp = await this.scope.corp(org);
    if (!corp?.enabled) {
      throw new BusinessException(
        ErrorCode.FEATURE_CLOSED,
        '企业微信 SCRM 未接入或已停用',
      );
    }
    const memberUserId = await this.scope.requireMember(org, user.userId);
    return this.payload(org, memberUserId, contactId);
  }

  private async payload(org: HrmOrg, memberUserId: string, contactId: number) {
    const [tasks, materials, names] = await Promise.all([
      this.sops.sidebarTasks(org, memberUserId),
      this.materials.listFor(org),
      this.scope.names([memberUserId]),
    ]);
    const base = {
      staff: { userId: memberUserId, name: nameOf(names, memberUserId) },
      contact: null,
      fields: [] as {
        fieldKey: string;
        label?: string;
        type?: string;
        value: string | string[];
      }[],
      tags: [] as { id: number; name: string; color: string; source: string }[],
      tasks,
      materials,
      chats: [] as { id: number; name: string; memberCount: number }[],
    };
    if (!contactId) return base;
    const link = await this.contacts.staffLink(org, contactId, memberUserId);
    if (!link) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '客户不存在或不是你的好友',
      );
    }
    const detail = await this.contacts.detailFor(org, contactId);
    const contact: Record<string, unknown> = { ...detail };
    delete contact.fields;
    delete contact.chats;
    delete contact.timeline;
    return {
      ...base,
      contact,
      fields: detail.fields,
      tags: detail.tags,
      chats: detail.chats.map((chat) => ({
        id: chat.id,
        name: chat.name,
        memberCount: chat.memberCount,
      })),
    };
  }

  async complete(ticket: string, body: Record<string, unknown>) {
    const { org, memberUserId } = await this.open(ticket);
    return this.sops.completeSidebarTask(org, memberUserId, {
      ...body,
      id: int(body.id),
    });
  }
}

/** 侧边栏公开通道：路径里带票据，不走登录态，统一 JSON 信封。 */
export function registerScrmSidebarPublic(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  const sidebar = services.scrm.sidebar;

  app.get('/api/public/wecom-scrm/sidebar/:ticket', async (c) => {
    if (limited(`scrm-sidebar:${clientIp(c)}`)) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '请求过于频繁',
      );
    }
    const contactId = Number(c.req.query('contactId') || 0);
    const data = await sidebar.view(
      String(c.req.param('ticket') || ''),
      Number.isFinite(contactId) ? Math.trunc(contactId) : 0,
    );
    return json(data);
  });

  app.post(
    '/api/public/wecom-scrm/sidebar/:ticket/tasks/complete',
    async (c) => {
      if (limited(`scrm-sidebar:task:${clientIp(c)}`, 60)) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          '操作过于频繁',
        );
      }
      const body = await c.req
        .json<Record<string, unknown>>()
        .catch(() => ({}));
      const data = await sidebar.complete(
        String(c.req.param('ticket') || ''),
        body,
      );
      return json(data);
    },
  );
}
