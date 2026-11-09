import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { clip, orgKey } from '../hrm/hrm.helpers';
import { evalCondition, json, text } from './mechanism.shared';
import type { Condition, PageQuery, Row } from './mechanism.shared';
import { MechanismBase } from './mechanism.base';

/** 规则引擎条件与动作配置。 */
export class MechanismRuleService extends MechanismBase {
  private ruleView(row: {
    id: number;
    code: string;
    name: string;
    description: string;
    event: string;
    conditions: unknown;
    actions: unknown;
    enabled: boolean;
    lastTriggeredAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      event: row.event,
      conditions: (row.conditions || []) as Condition[],
      actions: (row.actions || []) as Row[],
      enabled: row.enabled,
      lastTriggeredAt: row.lastTriggeredAt
        ? row.lastTriggeredAt.toISOString()
        : '',
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listRules(user: CurrentUser, query: PageQuery & { event?: string }) {
    const org = await this.org(user);
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(query.event ? { event: query.event } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.ruleDefinition.count({ where }),
      this.prisma.ruleDefinition.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: rows.map((row) => this.ruleView(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async saveRule(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = Number(body.id ?? 0);
    const data = {
      code: clip(body.code, 64),
      name: clip(body.name, 80),
      description: clip(body.description, 300),
      event: clip(body.event, 64),
      conditions: json(body.conditions || []),
      actions: json(body.actions || []),
      enabled: body.enabled !== false,
    };
    const row = id
      ? await this.prisma.ruleDefinition.update({ where: { id }, data })
      : await this.prisma.ruleDefinition.create({
          data: { ...orgKey(org), ...data, createdBy: user.userId },
        });
    return this.ruleView(row);
  }

  async removeRule(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = Number(body.id);
    const row = await this.prisma.ruleDefinition.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '规则不存在');
    await this.prisma.ruleDefinition.delete({ where: { id } });
    return { id };
  }

  async testRule(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    void org;
    const context = (body.context || {}) as Row;
    const details = ((body.conditions || []) as Condition[]).map((c) => ({
      field: c.field,
      op: c.op,
      actual: text(context[c.field]),
      pass: evalCondition(c, context),
    }));
    return {
      matched: details.length > 0 && details.every((item) => item.pass),
      details,
    };
  }
}
