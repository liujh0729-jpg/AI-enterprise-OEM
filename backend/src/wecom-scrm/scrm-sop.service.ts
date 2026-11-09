import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { pageOf } from '../common/api';
import type { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma';
import type { HrmOrg } from '../hrm/hrm.scope';
import { clip, iso } from '../hrm/hrm.helpers';
import { ScrmClient } from './scrm.client';
import { ScrmScopeService } from './scrm.scope';
import {
  addTimeline,
  contactIdsByRelation,
  dateOr,
  dayKey,
  dayStart,
  int,
  intArr,
  json,
  nameOf,
  orgKey,
  orgOf,
  safePage,
  strArr,
  text,
} from './scrm.helpers';

/**
 * SOP：触发（加好友 / 标签 / 关键词 / 定时 / 手动）→ 自动动作（打标签、提醒员工）
 * + 员工待办（欢迎语/素材/群发/跟进任务由员工在侧边栏执行）。
 *
 * 同一客户同一 SOP 只保留一条待办，避免重复打扰；
 * 定时规则按北京时间小时触发，同一客户当天只生成一次。
 */

type SopRow = {
  id: number;
  name: string;
  trigger: string;
  triggerConfig: unknown;
  actions: unknown;
  enabled: boolean;
  version: number;
  createdAt: Date;
  orgType: string;
  orgUserId: string;
};

type SopAction = { kind: string; config: Record<string, unknown> };

const TASK_KINDS = ['WELCOME', 'MATERIAL', 'MASS', 'TASK'];
const MAX_RUN_CONTACTS = 500;
const remindAttempts = new Map<number, number>();

export class ScrmSopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScrmScopeService,
    private readonly client: ScrmClient,
  ) {}

  private actionsOf(value: unknown): SopAction[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
      const row = (item || {}) as Record<string, unknown>;
      return {
        kind: text(row.kind).toUpperCase(),
        config:
          row.config &&
          typeof row.config === 'object' &&
          !Array.isArray(row.config)
            ? (row.config as Record<string, unknown>)
            : {},
      };
    });
  }

  private configOf(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private sopView(row: SopRow) {
    return {
      id: row.id,
      name: row.name,
      trigger: row.trigger,
      triggerConfig: this.configOf(row.triggerConfig),
      actions: this.actionsOf(row.actions),
      enabled: row.enabled,
      version: row.version,
      createdAt: iso(row.createdAt),
    };
  }

  async sops(user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const rows = await this.prisma.scrmSop.findMany({
      where: orgKey(org),
      orderBy: { id: 'desc' },
    });
    return rows.map((row) => this.sopView(row));
  }

  async saveSop(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const id = int(body.id);
    const name = clip(body.name, 60).trim();
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写 SOP 名称');
    }
    const trigger = text(body.trigger).toUpperCase();
    if (!['JOIN', 'TAG', 'KEYWORD', 'SCHEDULE', 'MANUAL'].includes(trigger)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, 'SOP 触发方式不合法');
    }
    const actions = this.actionsOf(body.actions).slice(0, 20);
    for (const action of actions) {
      if (
        !['WELCOME', 'MATERIAL', 'MASS', 'TASK', 'NOTIFY', 'TAG'].includes(
          action.kind,
        )
      ) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, 'SOP 动作不合法');
      }
    }
    if (trigger === 'SCHEDULE') {
      const hour = int(this.configOf(body.triggerConfig).hour, 9);
      if (hour < 0 || hour > 23) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '定时小时必须在 0–23 之间',
        );
      }
    }
    const existing = id
      ? await this.prisma.scrmSop.findFirst({ where: { ...orgKey(org), id } })
      : null;
    if (id && !existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, 'SOP 不存在');
    }
    const data = {
      name,
      trigger,
      triggerConfig: json(this.configOf(body.triggerConfig)),
      actions: json(actions),
      enabled: body.enabled !== false,
    };
    const row = existing
      ? await this.prisma.scrmSop.update({
          where: { id: existing.id },
          data: { ...data, version: { increment: 1 } },
        })
      : await this.prisma.scrmSop.create({
          data: { ...orgKey(org), createdBy: user.userId, ...data },
        });
    return this.sopView(row);
  }

  async removeSop(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const id = int(body.id);
    const row = await this.prisma.scrmSop.findFirst({
      where: { ...orgKey(org), id },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, 'SOP 不存在');
    }
    await this.prisma.$transaction([
      this.prisma.scrmSopTask.updateMany({
        where: { ...orgKey(org), sopId: id, status: 'PENDING' },
        data: {
          status: 'SKIPPED',
          result: 'SOP 已删除',
          completedAt: new Date(),
        },
      }),
      this.prisma.scrmSop.delete({ where: { id } }),
    ]);
    return { id };
  }

  /** 手动执行：按触发配置筛选客户，立即生成待办与自动动作（管理员可重复补跑）。 */
  async runSop(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const sop = await this.prisma.scrmSop.findFirst({
      where: { ...orgKey(org), id: int(body.id) },
    });
    if (!sop) {
      throw new BusinessException(ErrorCode.NOT_FOUND, 'SOP 不存在');
    }
    const contacts = await this.contactsFor(
      org,
      this.configOf(sop.triggerConfig),
    );
    let created = 0;
    for (const contact of contacts) {
      const fired = await this.fire(org, sop, contact.id, '', 'MANUAL');
      if (fired) created += 1;
    }
    return {
      created,
      message: created
        ? `已为 ${created} 位客户生成 SOP 待办/动作`
        : '没有符合条件的新客户（已跳过有待办或不符合筛选的客户）',
    };
  }

  async sopTasks(user: CurrentUser, query: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const { page, pageSize, offset } = safePage(query.page, query.pageSize, 20);
    const where: Prisma.ScrmSopTaskWhereInput = { ...orgKey(org) };
    const status = text(query.status);
    if (status) where.status = status;
    const contactId = int(query.contactId);
    if (contactId) where.contactId = contactId;
    const staffQuery = text(query.staffUserId);
    if (org.isAdmin) {
      if (staffQuery) where.staffUserId = staffQuery;
    } else {
      where.staffUserId = org.actorId;
    }
    const [rows, total] = await Promise.all([
      this.prisma.scrmSopTask.findMany({
        where,
        orderBy: [{ dueAt: 'asc' }, { id: 'desc' }],
        skip: offset,
        take: pageSize,
      }),
      this.prisma.scrmSopTask.count({ where }),
    ]);
    const views = await this.viewsOf(org, rows);
    return pageOf(views, total, page, pageSize);
  }

  async completeSopTask(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    return this.completeTask(org, body, org.isAdmin ? '' : org.actorId);
  }

  /** 员工侧边栏完成待办：票据身份已确定员工，只允许处理本人的待办。 */
  async completeSidebarTask(
    org: HrmOrg,
    staffUserId: string,
    body: Record<string, unknown>,
  ) {
    return this.completeTask(org, body, staffUserId);
  }

  private async completeTask(
    org: HrmOrg,
    body: Record<string, unknown>,
    staffUserId: string,
  ) {
    const id = int(body.id);
    const task = await this.prisma.scrmSopTask.findFirst({
      where: { ...orgKey(org), id },
    });
    if (!task) {
      throw new BusinessException(ErrorCode.NOT_FOUND, 'SOP 待办不存在');
    }
    if (staffUserId && task.staffUserId !== staffUserId) {
      throw new BusinessException(ErrorCode.NOT_FOUND, 'SOP 待办不存在');
    }
    if (task.status !== 'PENDING') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该待办已处理，不能重复操作',
      );
    }
    const status = text(body.status).toUpperCase();
    if (!['DONE', 'SKIPPED'].includes(status)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '待办状态不合法');
    }
    const row = await this.prisma.scrmSopTask.update({
      where: { id: task.id },
      data: {
        status,
        result: clip(body.result, 1000),
        completedAt: new Date(),
      },
    });
    if (row.contactId) {
      await addTimeline(
        this.prisma,
        org,
        row.contactId,
        'SOP',
        status === 'DONE' ? 'SOP 待办已完成' : 'SOP 待办已跳过',
        clip(body.result, 1000),
      );
    }
    return (await this.viewsOf(org, [row]))[0];
  }

  /** 员工侧边栏待办：只返回本人 PENDING，按到期时间排序。 */
  async sidebarTasks(org: HrmOrg, staffUserId: string) {
    const rows = await this.prisma.scrmSopTask.findMany({
      where: { ...orgKey(org), staffUserId, status: 'PENDING' },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: 30,
    });
    return this.viewsOf(org, rows);
  }

  private async viewsOf(
    org: HrmOrg,
    rows: {
      id: number;
      sopId: number;
      contactId: number;
      staffUserId: string;
      dueAt: Date | null;
      status: string;
      result: string;
      completedAt: Date | null;
      createdAt: Date;
    }[],
  ) {
    if (!rows.length) return [];
    const [sops, contacts, names] = await Promise.all([
      this.prisma.scrmSop.findMany({
        where: {
          ...orgKey(org),
          id: { in: [...new Set(rows.map((row) => row.sopId))] },
        },
        select: { id: true, name: true },
      }),
      this.prisma.scrmContact.findMany({
        where: {
          ...orgKey(org),
          id: {
            in: [...new Set(rows.map((row) => row.contactId).filter(Boolean))],
          },
        },
        select: { id: true, name: true, remark: true, externalUserId: true },
      }),
      this.scope.names(rows.map((row) => row.staffUserId)),
    ]);
    const sopName = new Map(sops.map((row) => [row.id, row.name]));
    const contactName = new Map(
      contacts.map((row) => [
        row.id,
        row.name || row.remark || row.externalUserId,
      ]),
    );
    return rows.map((row) => ({
      id: row.id,
      sopId: row.sopId,
      sopName: sopName.get(row.sopId) || '',
      contactId: row.contactId,
      contactName: contactName.get(row.contactId) || '',
      staffUserId: row.staffUserId,
      staffName: nameOf(names, row.staffUserId),
      dueAt: iso(row.dueAt),
      status: row.status,
      result: row.result,
      completedAt: iso(row.completedAt),
      createdAt: iso(row.createdAt),
    }));
  }

  // ---------- 触发 ----------

  /** 加好友后触发：只匹配 JOIN SOP；按来源活码/归属员工过滤。 */
  async triggerJoin(org: HrmOrg, contactId: number, staffUserId: string) {
    const contact = await this.prisma.scrmContact.findFirst({
      where: { ...orgKey(org), id: contactId },
      select: { id: true, sourceCodeId: true },
    });
    if (!contact) return;
    const sops = await this.prisma.scrmSop.findMany({
      where: { ...orgKey(org), enabled: true, trigger: 'JOIN' },
    });
    for (const sop of sops) {
      const config = this.configOf(sop.triggerConfig);
      if (!this.matchesContact(config, contact.sourceCodeId, staffUserId))
        continue;
      await this.fire(org, sop, contact.id, staffUserId, 'JOIN');
    }
  }

  /** 标签变化触发：任一命中配置的标签即触发；未配置标签时任意标签变化都触发。 */
  async triggerTag(
    org: HrmOrg,
    contactId: number,
    tagIds: number[],
    staffUserId = '',
  ) {
    if (!tagIds.length) return;
    const sops = await this.prisma.scrmSop.findMany({
      where: { ...orgKey(org), enabled: true, trigger: 'TAG' },
    });
    for (const sop of sops) {
      const wanted = intArr(this.configOf(sop.triggerConfig).tagIds);
      if (wanted.length && !wanted.some((id) => tagIds.includes(id))) continue;
      await this.fire(org, sop, contactId, staffUserId, 'TAG');
    }
  }

  /** 关键词触发：入站消息命中敏感词/关键词时调用（由合规检查链路喂入）。 */
  async triggerKeyword(
    org: HrmOrg,
    contactId: number,
    words: string[],
    staffUserId = '',
  ) {
    const hits = words.map((word) => word.trim().toLowerCase()).filter(Boolean);
    if (!hits.length) return;
    const sops = await this.prisma.scrmSop.findMany({
      where: { ...orgKey(org), enabled: true, trigger: 'KEYWORD' },
    });
    for (const sop of sops) {
      const configured = strArr(this.configOf(sop.triggerConfig).keywords).map(
        (word) => word.toLowerCase(),
      );
      if (!configured.length || !configured.some((word) => hits.includes(word)))
        continue;
      await this.fire(org, sop, contactId, staffUserId, 'KEYWORD');
    }
  }

  /** 定时触发：调度器每分钟调用；同一天同一客户不重复生成。 */
  async runScheduled(now: Date): Promise<number> {
    const shifted = new Date(now.getTime() + 8 * 3600_000);
    const hour = shifted.getUTCHours();
    const weekday = shifted.getUTCDay() === 0 ? 7 : shifted.getUTCDay();
    const sops = await this.prisma.scrmSop.findMany({
      where: { enabled: true, trigger: 'SCHEDULE' },
      take: 200,
    });
    const today = dayStart(dayKey(now));
    let count = 0;
    for (const sop of sops) {
      const config = this.configOf(sop.triggerConfig);
      if (int(config.hour, 9) !== hour) continue;
      const weekdays = intArr(config.weekdays);
      if (weekdays.length && !weekdays.includes(weekday)) continue;
      const org = orgOf(sop);
      const contacts = await this.contactsFor(org, config);
      if (!contacts.length) continue;
      const existing = await this.prisma.scrmSopTask.findMany({
        where: {
          ...orgKey(org),
          sopId: sop.id,
          contactId: { in: contacts.map((contact) => contact.id) },
          createdAt: { gte: today },
        },
        select: { contactId: true },
      });
      const done = new Set(existing.map((row) => row.contactId));
      for (const contact of contacts) {
        if (done.has(contact.id)) continue;
        const fired = await this.fire(org, sop, contact.id, '', 'SCHEDULE');
        if (fired) count += 1;
      }
    }
    return count;
  }

  /** 到期未完成提醒：每单只提醒一次；企微未配置时静默跳过。 */
  async remindOverdue(now: Date): Promise<number> {
    const rows = await this.prisma.scrmSopTask.findMany({
      where: {
        status: 'PENDING',
        remindedAt: null,
        dueAt: { not: null, lt: now },
      },
      orderBy: { dueAt: 'asc' },
      take: 50,
    });
    let sent = 0;
    for (const row of rows) {
      const last = remindAttempts.get(row.id) || 0;
      if (now.getTime() - last < 3600_000) continue;
      remindAttempts.set(row.id, now.getTime());
      const org = orgOf(row);
      const corp = await this.scope.corp(org);
      if (!corp?.enabled || !corp.agentId) continue;
      const secrets = this.scope.secretsOf(corp);
      if (!secrets.appSecret) continue;
      const staffLinks = await this.scope.staffLinks(org);
      const wecomId =
        [...staffLinks.entries()].find(
          ([, member]) => member === row.staffUserId,
        )?.[0] || '';
      if (!wecomId) continue;
      const sop = await this.prisma.scrmSop.findFirst({
        where: { ...orgKey(org), id: row.sopId },
        select: { name: true },
      });
      try {
        await this.client.sendText(
          secrets.corpId,
          secrets.appSecret,
          secrets.agentId,
          wecomId,
          `SOP「${sop?.name || row.sopId}」有 1 条待办已到期，请打开企业微信 SCRM 侧边栏处理。`,
        );
        await this.prisma.scrmSopTask.update({
          where: { id: row.id },
          data: { remindedAt: new Date() },
        });
        sent += 1;
      } catch {
        // 企微消息发送失败不阻断其他提醒，下一小时再试
      }
    }
    if (remindAttempts.size > 2000) remindAttempts.clear();
    return sent;
  }

  // ---------- 执行 ----------

  private async fire(
    org: HrmOrg,
    sop: SopRow,
    contactId: number,
    staffUserId: string,
    triggerName: string,
  ): Promise<boolean> {
    if (!contactId) return false;
    const pending = await this.prisma.scrmSopTask.findFirst({
      where: { ...orgKey(org), sopId: sop.id, contactId, status: 'PENDING' },
      select: { id: true },
    });
    if (pending) return false;
    const actions = this.actionsOf(sop.actions);
    if (!actions.length) return false;
    const owner = staffUserId || (await this.ownerOf(org, contactId));
    const delayMinutes = Math.min(
      ...actions.map((action) => {
        const config = action.config;
        return int(config.delayMinutes, 0) + int(config.delayHours, 0) * 60;
      }),
    );
    const dueAt = new Date(Date.now() + Math.max(0, delayMinutes) * 60_000);

    for (const action of actions) {
      if (action.kind === 'TAG') {
        await this.applyTagAction(org, contactId, owner, action.config);
      } else if (action.kind === 'NOTIFY') {
        await this.notifyStaff(org, sop, owner, action.config);
      }
    }
    if (actions.some((action) => TASK_KINDS.includes(action.kind))) {
      const row = await this.prisma.scrmSopTask.create({
        data: {
          ...orgKey(org),
          sopId: sop.id,
          contactId,
          staffUserId: owner,
          dueAt,
          status: 'PENDING',
        },
      });
      await addTimeline(
        this.prisma,
        org,
        contactId,
        'SOP',
        `触发 SOP：${sop.name}`,
        `触发方式：${triggerName}；待办 #${row.id}`,
      );
    }
    return true;
  }

  private async ownerOf(org: HrmOrg, contactId: number): Promise<string> {
    const link = await this.prisma.scrmContactStaff.findFirst({
      where: { ...orgKey(org), contactId },
      orderBy: { id: 'asc' },
      select: { staffUserId: true },
    });
    return link?.staffUserId || '';
  }

  private async applyTagAction(
    org: HrmOrg,
    contactId: number,
    staffUserId: string,
    config: Record<string, unknown>,
  ) {
    const tagIds = intArr(config.tagIds);
    if (!tagIds.length || !staffUserId) return;
    const corp = await this.scope.corp(org);
    if (!corp?.enabled) return;
    const secrets = this.scope.secretsOf(corp);
    const [tags, contact, links, staffLinks] = await Promise.all([
      this.prisma.scrmTag.findMany({
        where: {
          ...orgKey(org),
          id: { in: tagIds },
          deleted: false,
          externalId: { not: '' },
        },
      }),
      this.prisma.scrmContact.findFirst({
        where: { ...orgKey(org), id: contactId },
        select: { externalUserId: true },
      }),
      this.prisma.scrmContactStaff.findMany({
        where: { ...orgKey(org), contactId, staffUserId },
      }),
      this.scope.staffLinks(org),
    ]);
    if (!tags.length || !contact?.externalUserId) return;
    const wecomId =
      links[0]?.externalStaffId ||
      [...staffLinks.entries()].find(
        ([, member]) => member === staffUserId,
      )?.[0] ||
      '';
    if (!wecomId) return;
    try {
      await this.client.markTag(
        secrets.corpId,
        secrets.contactSecret,
        wecomId,
        contact.externalUserId,
        tags.map((tag) => tag.externalId),
        [],
      );
    } catch {
      return;
    }
    await this.prisma.scrmContactTag.createMany({
      data: tags.map((tag) => ({
        ...orgKey(org),
        contactId,
        tagId: tag.id,
        source: 'WECOM',
      })),
      skipDuplicates: true,
    });
  }

  private async notifyStaff(
    org: HrmOrg,
    sop: SopRow,
    staffUserId: string,
    config: Record<string, unknown>,
  ) {
    if (!staffUserId) return;
    const corp = await this.scope.corp(org);
    if (!corp?.enabled || !corp.agentId) return;
    const secrets = this.scope.secretsOf(corp);
    if (!secrets.appSecret) return;
    const staffLinks = await this.scope.staffLinks(org);
    const wecomId =
      [...staffLinks.entries()].find(
        ([, member]) => member === staffUserId,
      )?.[0] || '';
    if (!wecomId) return;
    const message =
      clip(config.text, 400) ||
      `SOP「${sop.name}」已触发，请打开企业微信 SCRM 侧边栏跟进。`;
    try {
      await this.client.sendText(
        secrets.corpId,
        secrets.appSecret,
        secrets.agentId,
        wecomId,
        message,
      );
    } catch {
      // 自动提醒失败不阻断 SOP 待办生成
    }
  }

  private async contactsFor(org: HrmOrg, config: Record<string, unknown>) {
    const where: Prisma.ScrmContactWhereInput = {
      ...orgKey(org),
      status: 'ACTIVE',
    };
    // 标签与归属员工都是独立关联表，客户表上没有对应关系字段
    const relatedIds = await contactIdsByRelation(this.prisma, org, {
      tagIds: intArr(config.tagIds),
      staffUserIds: strArr(config.staffUserIds),
    });
    if (relatedIds) where.id = { in: relatedIds };
    const codeIds = intArr(config.codeIds);
    if (codeIds.length) where.sourceCodeId = { in: codeIds };
    const from = dateOr(config.addedFrom);
    if (from) where.addedAt = { gte: from };
    return this.prisma.scrmContact.findMany({
      where,
      orderBy: { id: 'desc' },
      take: MAX_RUN_CONTACTS,
      select: { id: true },
    });
  }

  private matchesContact(
    config: Record<string, unknown>,
    codeId: number,
    staffUserId: string,
  ): boolean {
    const codeIds = intArr(config.codeIds);
    if (codeIds.length && !codeIds.includes(codeId)) return false;
    const staffUserIds = strArr(config.staffUserIds);
    if (
      staffUserIds.length &&
      staffUserId &&
      !staffUserIds.includes(staffUserId)
    ) {
      return false;
    }
    return true;
  }
}
