import { createHmac } from 'node:crypto';
import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { httpRequest } from '../http/transport';
import { clip, orgKey } from '../hrm/hrm.helpers';
import { strArr, text } from './mechanism.shared';
import type { PageQuery, Row } from './mechanism.shared';
import { MechanismBase } from './mechanism.base';

/** Webhook 订阅与 Outbox 投递。 */
export class MechanismWebhookService extends MechanismBase {
  private webhookView(row: {
    id: number;
    name: string;
    url: string;
    events: unknown;
    enabled: boolean;
    status: string;
    secretCipher: string;
    lastDeliveredAt: Date | null;
    lastError: string;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      events: strArr(row.events),
      enabled: row.enabled,
      status: row.status,
      secretMasked: row.secretCipher ? '••••••' : '',
      lastDeliveredAt: row.lastDeliveredAt
        ? row.lastDeliveredAt.toISOString()
        : '',
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listWebhooks(user: CurrentUser) {
    const org = await this.org(user);
    const rows = await this.prisma.webhookSubscription.findMany({
      where: { orgType: org.orgType, orgUserId: org.orgUserId },
      orderBy: { id: 'desc' },
    });
    return rows.map((row) => this.webhookView(row));
  }

  async saveWebhook(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = Number(body.id ?? 0);
    const data = {
      name: clip(body.name, 120),
      url: clip(body.url, 500),
      events: (body.events as string[]) || [],
      enabled: body.enabled !== false,
      status: body.enabled === false ? 'PAUSED' : 'ACTIVE',
      lastError: '',
    };
    const secret = text(body.secret).trim();
    if (id) {
      const existing = await this.prisma.webhookSubscription.findFirst({
        where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, 'Webhook 不存在');
      const row = await this.prisma.webhookSubscription.update({
        where: { id },
        data: {
          ...data,
          ...(secret ? { secretCipher: this.crypto.encrypt(secret) } : {}),
        },
      });
      return this.webhookView(row);
    }
    const row = await this.prisma.webhookSubscription.create({
      data: {
        ...orgKey(org),
        ...data,
        secretCipher: secret ? this.crypto.encrypt(secret) : '',
        createdBy: user.userId,
      },
    });
    return this.webhookView(row);
  }

  async removeWebhook(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = Number(body.id);
    const row = await this.prisma.webhookSubscription.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, 'Webhook 不存在');
    await this.prisma.webhookOutbox.deleteMany({
      where: { subscriptionId: id },
    });
    await this.prisma.webhookSubscription.delete({ where: { id } });
    return { id };
  }

  private deliveryView(row: {
    id: number;
    event: string;
    status: string;
    attempts: number;
    nextAt: Date | null;
    deliveredAt: Date | null;
    error: string;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      event: row.event,
      status: row.status,
      attempts: row.attempts,
      nextAt: row.nextAt ? row.nextAt.toISOString() : '',
      deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : '',
      error: row.error,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async deliveries(
    user: CurrentUser,
    query: PageQuery & { subscriptionId?: number; status?: string },
  ) {
    const org = await this.org(user);
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(query.subscriptionId ? { subscriptionId: query.subscriptionId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.webhookOutbox.count({ where }),
      this.prisma.webhookOutbox.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: rows.map((row) => this.deliveryView(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async deliver(outboxId: number) {
    const row = await this.prisma.webhookOutbox.findUnique({
      where: { id: outboxId },
    });
    if (!row) return null;
    if (row.status === 'DONE') return row;
    const sub = await this.prisma.webhookSubscription.findUnique({
      where: { id: row.subscriptionId },
    });
    if (!sub || !sub.enabled) {
      return this.prisma.webhookOutbox.update({
        where: { id: outboxId },
        data: {
          status: 'SKIPPED',
          error: '订阅已停用或已删除',
          deliveredAt: new Date(),
        },
      });
    }
    const body = JSON.stringify({
      event: row.event,
      payload: row.payload,
      sentAt: new Date().toISOString(),
    });
    const secret = sub.secretCipher
      ? this.crypto.decrypt(sub.secretCipher)
      : '';
    const signature = secret
      ? createHmac('sha256', secret).update(body).digest('hex')
      : '';
    try {
      await httpRequest(sub.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-oem-event': row.event,
          ...(signature ? { 'x-oem-signature': signature } : {}),
        },
        body,
        timeoutMs: 5000,
        operation: 'webhook.deliver',
      });
      const done = await this.prisma.webhookOutbox.update({
        where: { id: outboxId },
        data: {
          status: 'DONE',
          attempts: { increment: 1 },
          deliveredAt: new Date(),
          error: '',
        },
      });
      await this.prisma.webhookSubscription.update({
        where: { id: sub.id },
        data: { lastDeliveredAt: new Date(), lastError: '' },
      });
      return done;
    } catch (error) {
      const message = clip(
        error instanceof Error ? error.message : '投递失败',
        500,
      );
      await this.prisma.webhookSubscription.update({
        where: { id: sub.id },
        data: { lastError: message },
      });
      return this.prisma.webhookOutbox.update({
        where: { id: outboxId },
        data: {
          status: 'FAILED',
          attempts: { increment: 1 },
          error: message,
          nextAt: new Date(Date.now() + 60_000),
        },
      });
    }
  }

  async replay(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = Number(body.id);
    const row = await this.prisma.webhookOutbox.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '投递记录不存在');
    await this.prisma.webhookOutbox.update({
      where: { id },
      data: { status: 'PENDING', nextAt: null, error: '' },
    });
    const delivered = await this.deliver(id);
    return this.deliveryView(delivered!);
  }

  async testWebhook(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = Number(body.id);
    const sub = await this.prisma.webhookSubscription.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!sub)
      throw new BusinessException(ErrorCode.NOT_FOUND, 'Webhook 不存在');
    const outbox = await this.prisma.webhookOutbox.create({
      data: {
        ...orgKey(org),
        subscriptionId: sub.id,
        event: 'custom',
        payload: { test: true, message: '这是一条测试事件' },
        status: 'PENDING',
      },
    });
    const result = await this.deliver(outbox.id);
    return {
      ok: result?.status === 'DONE',
      status: result?.status === 'DONE' ? 200 : 502,
      message:
        result?.status === 'DONE'
          ? '测试事件已送达'
          : result?.error || '投递失败',
    };
  }
}
