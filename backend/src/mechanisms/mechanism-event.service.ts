import { randomUUID } from 'node:crypto';
import type { CurrentUser } from '../auth/current-user';
import { clip, orgKey } from '../hrm/hrm.helpers';
import type { HrmOrg } from '../hrm/hrm.scope';
import {
  evalCondition,
  json,
  logger,
  num,
  strArr,
  text,
} from './mechanism.shared';
import type { Condition, MechanismListener, Row } from './mechanism.shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmScopeService } from '../hrm/hrm.scope';
import type { AccountCrypto } from '../account/account-crypto';
import type { StorageService } from '../storage/storage.service';
import type { NotificationService } from '../notifications/notification.service';
import type { MechanismWebhookService } from './mechanism-webhook.service';
import { MechanismBase } from './mechanism.base';

/** 进程内领域事件、规则分派与动作执行。 */
export class MechanismEventService extends MechanismBase {
  constructor(
    prisma: PrismaService,
    scope: HrmScopeService,
    crypto: AccountCrypto,
    storage: StorageService,
    notifications: NotificationService,
    requirePlatformAdmin: (user: CurrentUser) => void,
    private readonly webhooks: MechanismWebhookService,
  ) {
    super(prisma, scope, crypto, storage, notifications, requirePlatformAdmin);
  }

  private readonly listeners: Array<{
    event: string;
    handler: MechanismListener;
  }> = [];

  on(event: string, handler: MechanismListener) {
    this.listeners.push({ event, handler });
  }

  private async runListeners(org: HrmOrg, event: string, payload: Row) {
    for (const listener of this.listeners) {
      if (listener.event !== event && listener.event !== '*') continue;
      try {
        await listener.handler(org, event, payload);
      } catch (failure) {
        logger.warn({
          operation: 'listener',
          event,
          error: failure instanceof Error ? failure.message : String(failure),
        });
      }
    }
  }

  async dispatch(org: HrmOrg, event: string, payload: Row) {
    const log = await this.recordEvent(org, event, payload);
    // 调用方显式给了幂等键且已处理过：整条事件跳过，避免重复执行外部动作。
    if (log.duplicate) return;
    await this.runListeners(org, event, payload);
    const subscriptions = await this.prisma.webhookSubscription.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        enabled: true,
        status: 'ACTIVE',
      },
    });
    const outboxIds: number[] = [];
    for (const sub of subscriptions) {
      if (!strArr(sub.events).includes(event)) continue;
      const row = await this.prisma.webhookOutbox.create({
        data: {
          ...orgKey(org),
          subscriptionId: sub.id,
          event,
          payload: json(payload),
          status: 'PENDING',
        },
      });
      outboxIds.push(row.id);
    }
    await Promise.all(
      outboxIds.map((id) => this.webhooks.deliver(id).catch(() => null)),
    );
    const rules = await this.prisma.ruleDefinition.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        event,
        enabled: true,
      },
    });
    for (const rule of rules) {
      const conditions = (rule.conditions || []) as Condition[];
      if (
        !conditions.length ||
        !conditions.every((c) => evalCondition(c, payload))
      )
        continue;
      for (const action of (rule.actions || []) as Row[]) {
        const startedAt = Date.now();
        let status = 'DONE';
        let error = '';
        try {
          await this.runAction(org, rule.id, action, payload);
        } catch (failure) {
          status = 'FAILED';
          error = clip(
            failure instanceof Error ? failure.message : String(failure),
            500,
          );
        }
        await this.recordRuleExecution(
          org,
          log.id,
          rule.id,
          action,
          status,
          error,
          Date.now() - startedAt,
        );
      }
      await this.prisma.ruleDefinition.update({
        where: { id: rule.id },
        data: { lastTriggeredAt: new Date() },
      });
    }
    if (log.id) {
      await this.prisma.eventLog
        .update({ where: { id: log.id }, data: { status: 'DISPATCHED' } })
        .catch(() => null);
    }
  }

  private async recordEvent(
    org: HrmOrg,
    event: string,
    payload: Row,
  ): Promise<{ id: number; duplicate: boolean }> {
    const source = clip(text(payload.source), 32);
    const sourceId = clip(text(payload.sourceId), 64);
    const explicit = clip(text(payload.idempotencyKey), 191);
    const key =
      explicit ||
      (source && sourceId
        ? `${event}:${source}:${sourceId}`
        : `${event}:${randomUUID()}`);
    try {
      const row = await this.prisma.eventLog.create({
        data: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          event: clip(event, 80),
          payload: json(payload),
          actorId: clip(org.actorId, 64),
          source,
          sourceId,
          idempotencyKey: key,
        },
      });
      return { id: row.id, duplicate: false };
    } catch (failure) {
      if ((failure as { code?: string }).code === 'P2002') {
        return { id: 0, duplicate: Boolean(explicit) };
      }
      logger.warn({
        operation: 'recordEvent',
        event,
        error: failure instanceof Error ? failure.message : String(failure),
      });
      return { id: 0, duplicate: false };
    }
  }

  private async recordRuleExecution(
    org: HrmOrg,
    eventLogId: number,
    ruleId: number,
    action: Row,
    status: string,
    error: string,
    durationMs: number,
  ) {
    await this.prisma.ruleExecution
      .create({
        data: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          eventLogId,
          ruleId,
          actionType: clip(text(action.type), 32),
          status,
          detail: json(action),
          error,
          attempts: 1,
          durationMs: Math.max(0, Math.trunc(durationMs)),
        },
      })
      .catch(() => null);
  }

  private async runAction(
    org: HrmOrg,
    ruleId: number,
    action: Row,
    payload: Row,
  ) {
    const type = text(action.type);
    const target = text(action.target);
    if (type === 'webhook') {
      const sub = await this.prisma.webhookSubscription.findFirst({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          OR: [{ id: Number(target) || 0 }, { name: target }],
        },
      });
      if (sub) {
        const row = await this.prisma.webhookOutbox.create({
          data: {
            ...orgKey(org),
            subscriptionId: sub.id,
            event: `rule:${ruleId}`,
            payload: json({ ...payload, ...(action.payload as Row) }),
            status: 'PENDING',
          },
        });
        await this.webhooks.deliver(row.id).catch(() => null);
      }
      return;
    }
    if (type === 'notify') {
      const userId = target || org.orgUserId;
      await this.notifications.notify(userId, {
        category: 'platform',
        title: `规则命中：${text(payload.title) || text(payload.event) || '业务事件'}`,
        body: JSON.stringify(payload).slice(0, 2000),
        level: 'info',
        entityType: 'rule',
        entityId: String(ruleId),
      });
      return;
    }
    if (type === 'insight') {
      await this.prisma.aiInsightRecord.create({
        data: {
          ...orgKey(org),
          scope: 'rule',
          kind: target || 'rule',
          mode: 'rule',
          summary: clip(text(payload.summary) || text(payload.title), 1000),
          findings: json([payload]),
          suggestions: json(
            strArr((action.payload as Row | undefined)?.suggestions),
          ),
          metrics: json(action.payload || {}),
          createdBy: org.actorId,
        },
      });
      return;
    }
    if (type === 'task') {
      const actionPayload = (action.payload || {}) as Row;
      const projectId = Math.trunc(
        num(actionPayload.projectId ?? payload.projectId),
      );
      if (!projectId) return;
      const project = await this.prisma.pjProject.findFirst({
        where: {
          id: projectId,
          orgType: org.orgType,
          orgUserId: org.orgUserId,
        },
      });
      if (!project) return;
      await this.prisma.pjTask.create({
        data: {
          ...orgKey(org),
          projectId,
          title: clip(actionPayload.title || `规则 ${ruleId} 自动任务`, 200),
          description: JSON.stringify(payload).slice(0, 20000),
          type: 'TASK',
          priority: 'MEDIUM',
          createdBy: org.actorId,
        },
      });
    }
  }
}
