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
import { ScrmComplianceService } from './scrm-compliance';
import {
  bumpStatDaily,
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
  text,
} from './scrm.helpers';

/**
 * 客户群发 / 群群发 / 朋友圈。
 *
 * 人工确认是硬闸：提交前必须是 APPROVED，且只能由管理员审批；编辑会退回草稿重新审。
 * 企微限制按员工执行：客户群发 1 次/天、群群发 1 次/天、朋友圈 3 次/周；
 * 本地先拦，超限的员工直接记失败原因，不静默跳过。
 * UNKNOWN 的发送结果不重发，避免客户收到重复消息。
 */

const MAX_CONTACTS_PER_TASK = 5000;
const MAX_CHATS_PER_TASK = 500;
const SEND_CHUNK = 100;

type MassType = 'CONTACT' | 'CHAT' | 'MOMENT';

type MassContent = {
  text: string;
  linkUrl: string;
  linkTitle: string;
  linkDesc: string;
  imageMediaId: string;
  miniProgram: { appId: string; title: string; page: string };
};

export class ScrmMassService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScrmScopeService,
    private readonly client: ScrmClient,
    private readonly compliance: ScrmComplianceService,
  ) {}

  private filterOf(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private contentOf(value: unknown): MassContent {
    const row = this.filterOf(value);
    const mini = this.filterOf(row.miniProgram);
    return {
      text: clip(row.text, 2000),
      linkUrl: clip(row.linkUrl, 500),
      linkTitle: clip(row.linkTitle, 120),
      linkDesc: clip(row.linkDesc, 300),
      imageMediaId: clip(row.imageMediaId, 200),
      miniProgram: {
        appId: clip(mini.appId, 64),
        title: clip(mini.title, 64),
        page: clip(mini.page, 200),
      },
    };
  }

  private taskView(row: {
    id: number;
    type: string;
    name: string;
    targetFilter: unknown;
    content: unknown;
    status: string;
    scheduledAt: Date | null;
    submittedAt: Date | null;
    reviewNote: string;
    total: number;
    sent: number;
    failed: number;
    unknown: number;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      targetFilter: {
        tagIds: intArr(this.filterOf(row.targetFilter).tagIds),
        staffUserIds: Array.isArray(
          this.filterOf(row.targetFilter).staffUserIds,
        )
          ? (this.filterOf(row.targetFilter).staffUserIds as unknown[]).map(
              String,
            )
          : [],
        codeIds: intArr(this.filterOf(row.targetFilter).codeIds),
        chatIds: intArr(this.filterOf(row.targetFilter).chatIds),
        addedFrom: text(this.filterOf(row.targetFilter).addedFrom),
        addedTo: text(this.filterOf(row.targetFilter).addedTo),
        contactIds: intArr(this.filterOf(row.targetFilter).contactIds),
      },
      content: this.contentOf(row.content),
      status: row.status,
      scheduledAt: iso(row.scheduledAt),
      submittedAt: iso(row.submittedAt),
      reviewNote: row.reviewNote,
      total: row.total,
      sent: row.sent,
      failed: row.failed,
      unknown: row.unknown,
      createdAt: iso(row.createdAt),
    };
  }

  async tasks(user: CurrentUser, query: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const { page, pageSize, offset } = safePage(query.page, query.pageSize, 20);
    const where: Prisma.ScrmMassTaskWhereInput = { ...orgKey(org) };
    const type = text(query.type);
    if (type) where.type = type;
    const status = text(query.status);
    if (status) where.status = status;
    const [rows, total] = await Promise.all([
      this.prisma.scrmMassTask.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.scrmMassTask.count({ where }),
    ]);
    return pageOf(
      rows.map((row) => this.taskView(row)),
      total,
      page,
      pageSize,
    );
  }

  /** 保存草稿：任何编辑都退回 DRAFT，必须重新提交审核（人工确认不可关闭）。 */
  async saveTask(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const id = int(body.id);
    const type = text(body.type).toUpperCase() as MassType;
    if (!['CONTACT', 'CHAT', 'MOMENT'].includes(type)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '群发类型不合法');
    }
    const name = clip(body.name, 60).trim();
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写任务名称');
    }
    const content = this.contentOf(body.content);
    if (!content.text.trim() && !content.linkUrl && !content.imageMediaId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '群发内容不能为空：请填写文本、链接或图片素材',
      );
    }
    if (content.imageMediaId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '图片群发需要企微临时素材 media_id，当前未接入素材上传；请改用文本或链接',
      );
    }
    const targetFilter = this.filterOf(body.targetFilter);
    const total = await this.countTargets(org, type, targetFilter);
    if (type === 'CONTACT' && total > MAX_CONTACTS_PER_TASK) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `单次客户群发最多 ${MAX_CONTACTS_PER_TASK} 位客户，请缩小筛选范围后拆分发送`,
      );
    }
    if (type === 'CHAT' && total > MAX_CHATS_PER_TASK) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `单次群群发最多 ${MAX_CHATS_PER_TASK} 个客户群，请拆分发送`,
      );
    }
    const existing = id
      ? await this.prisma.scrmMassTask.findFirst({
          where: { ...orgKey(org), id },
        })
      : null;
    if (id && !existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '群发任务不存在');
    }
    if (existing && ['SUBMITTED'].includes(existing.status)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '任务已提交发送，不能再编辑；请新建任务',
      );
    }
    const scheduledAt = dateOr(body.scheduledAt);
    const data = {
      type,
      name,
      targetFilter: json(targetFilter),
      content: json(content),
      status: 'DRAFT',
      scheduledAt,
      reviewerId: '',
      reviewedAt: null,
      reviewNote: '',
      total,
    };
    const row = existing
      ? await this.prisma.scrmMassTask.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.scrmMassTask.create({
          data: { ...orgKey(org), createdBy: user.userId, ...data },
        });
    return this.taskView(row);
  }

  /** 提交审核：草稿 → 待审。 */
  async requestReview(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const id = int(body.id);
    const task = await this.prisma.scrmMassTask.findFirst({
      where: { ...orgKey(org), id },
    });
    if (!task) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '群发任务不存在');
    }
    if (task.status !== 'DRAFT' && task.status !== 'REJECTED') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '只有草稿或被驳回的任务可以提交审核',
      );
    }
    const total = await this.countTargets(
      org,
      task.type as MassType,
      this.filterOf(task.targetFilter),
    );
    if (!total) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '当前筛选条件下没有可发送对象，请先调整目标范围',
      );
    }
    const row = await this.prisma.scrmMassTask.update({
      where: { id: task.id },
      data: { status: 'PENDING_REVIEW', total },
    });
    return this.taskView(row);
  }

  /** 审批：管理员确认后才允许发送；审批意见留痕。 */
  async reviewTask(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const id = int(body.id);
    const task = await this.prisma.scrmMassTask.findFirst({
      where: { ...orgKey(org), id },
    });
    if (!task) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '群发任务不存在');
    }
    if (task.status !== 'PENDING_REVIEW') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '只有待审核的任务可以审批',
      );
    }
    const approve = body.approve === true;
    if (task.createdBy === user.userId && approve) {
      // 自己审自己会让「双闸」失效；管理员本人建的任务由另一位管理员审
      const otherAdmin = await this.otherAdminOf(org, user.userId);
      if (otherAdmin) {
        throw new BusinessException(
          ErrorCode.ROLE_MISMATCH,
          '群发必须由另一位管理员审批：不能审批自己创建的任务',
        );
      }
    }
    const row = await this.prisma.scrmMassTask.update({
      where: { id: task.id },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        reviewerId: user.userId,
        reviewedAt: new Date(),
        reviewNote: clip(body.note, 300),
      },
    });
    return this.taskView(row);
  }

  /** 提交发送：必须是 APPROVED；定时任务到点由调度器调用同一入口。 */
  async submitTask(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const id = int(body.id);
    return this.submit(org, id);
  }

  private async submit(org: HrmOrg, id: number) {
    const task = await this.prisma.scrmMassTask.findFirst({
      where: { ...orgKey(org), id },
    });
    if (!task) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '群发任务不存在');
    }
    const resumable = ['FAILED', 'PARTIAL'].includes(task.status);
    if (task.status !== 'APPROVED' && !resumable) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '群发必须先通过人工审核（APPROVED）才能发送',
      );
    }
    if (task.scheduledAt && task.scheduledAt.getTime() > Date.now() + 60_000) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '任务设置了定时发送，到点会自动提交；如需立即发送请先清空定时时间',
      );
    }
    const { corp, secrets } = await this.scope.requireCorp(org);
    const staffLinks = await this.scope.staffLinks(org);
    const wecomOf = (memberId: string) =>
      [...staffLinks.entries()].find(
        ([, member]) => member === memberId,
      )?.[0] || '';
    const type = task.type as MassType;
    const filter = this.filterOf(task.targetFilter);
    const content = this.contentOf(task.content);
    // 出站敏感词闸：BLOCK 直接不给发，REPLACE 用改写后的文案继续
    const [cleanText, cleanTitle, cleanDesc] = await this.compliance.outbound(
      org,
      [content.text, content.linkTitle, content.linkDesc],
    );
    content.text = cleanText;
    content.linkTitle = cleanTitle;
    content.linkDesc = cleanDesc;

    if (resumable) {
      // 只重发上次失败的；UNKNOWN 不重发
      const targets = await this.prisma.scrmMassTarget.findMany({
        where: { ...orgKey(org), taskId: task.id, status: 'FAILED' },
      });
      if (!targets.length) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '没有可重发的失败对象；发送结果未知的不会重发，避免客户收到重复消息',
        );
      }
      const result = await this.sendTargets(
        org,
        corp.corpId,
        secrets.contactSecret,
        task.id,
        type,
        content,
        await Promise.all(
          targets.map(async (row) => ({
            id: row.id,
            kind: row.kind,
            targetId: row.targetId,
            targetName: row.targetName,
            staffUserId: row.staffUserId,
            externalId:
              row.kind === 'CHAT' ? await this.chatIdOf(org, row.targetId) : '',
            externalUserId:
              row.kind === 'CONTACT'
                ? await this.externalIdOf(org, row.targetId)
                : '',
            wecomStaffId: wecomOf(row.staffUserId),
          })),
        ),
      );
      return this.finishSubmit(org, task.id, result);
    }

    const targets = await this.buildTargets(org, type, filter, wecomOf);
    if (!targets.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '没有可发送对象：请检查筛选条件与员工的企业微信绑定',
      );
    }
    // 每日/每周上限：按员工先拦，超限的记失败原因
    const blocked = await this.blockedStaff(
      org,
      type,
      targets.map((row) => row.staffUserId),
    );
    const rows = await Promise.all(
      targets.map(async (target) => {
        const reason = blocked.get(target.staffUserId) || '';
        const row = await this.prisma.scrmMassTarget.create({
          data: {
            ...orgKey(org),
            taskId: task.id,
            kind: target.kind,
            targetId: target.targetId,
            targetName: target.targetName,
            staffUserId: target.staffUserId,
            staffName: target.staffName,
            status: reason ? 'FAILED' : 'PENDING',
            error: reason,
          },
        });
        return { ...target, id: row.id, blocked: reason };
      }),
    );
    const sendable = rows
      .filter((row) => !row.blocked)
      .map(
        ({
          id,
          kind,
          targetName,
          staffUserId,
          externalId,
          externalUserId,
          wecomStaffId,
        }) => ({
          id,
          kind,
          targetName,
          staffUserId,
          externalId,
          externalUserId,
          wecomStaffId,
        }),
      );
    const result = await this.sendTargets(
      org,
      corp.corpId,
      secrets.contactSecret,
      task.id,
      type,
      content,
      sendable,
    );
    await this.prisma.scrmMassTask.update({
      where: { id: task.id },
      data: {
        total: rows.length,
        submittedAt: new Date(),
        reviewNote: task.reviewNote,
      },
    });
    return this.finishSubmit(org, task.id, result);
  }

  /** 真正调企微发送；目标行状态在这里落定（成功进入待回执）。 */
  private async sendTargets(
    org: HrmOrg,
    corpId: string,
    contactSecret: string,
    taskId: number,
    type: MassType,
    content: MassContent,
    targets: {
      id: number;
      kind: string;
      staffUserId: string;
      externalId?: string;
      externalUserId?: string;
      wecomStaffId: string;
    }[],
  ): Promise<{ accepted: number; failed: number; msgIds: string[] }> {
    let accepted = 0;
    let failed = 0;
    const msgIds: string[] = [];
    const body = this.messageBody(content);
    if (type === 'MOMENT') {
      const byStaff = new Map<string, number[]>();
      for (const target of targets) {
        const list = byStaff.get(target.wecomStaffId) || [];
        list.push(target.id);
        byStaff.set(target.wecomStaffId, list);
      }
      for (const [sender, ids] of byStaff.entries()) {
        try {
          const result = await this.client.addMomentTask(
            corpId,
            contactSecret,
            {
              sender,
              ...body,
            },
          );
          if (!result.taskId) throw new Error('企微未返回朋友圈任务 ID');
          msgIds.push(result.taskId);
          await this.prisma.scrmMassTarget.updateMany({
            where: { id: { in: ids } },
            data: { status: 'PENDING', msgId: clip(result.taskId, 64) },
          });
          accepted += ids.length;
        } catch (error) {
          failed += ids.length;
          await this.prisma.scrmMassTarget.updateMany({
            where: { id: { in: ids } },
            data: {
              status: 'FAILED',
              error: clip(
                error instanceof Error ? error.message : '企微拒绝发送',
                300,
              ),
            },
          });
        }
      }
      return { accepted, failed, msgIds };
    }
    const byStaff = new Map<string, typeof targets>();
    for (const target of targets) {
      if (!target.wecomStaffId) {
        failed += 1;
        await this.prisma.scrmMassTarget.update({
          where: { id: target.id },
          data: { status: 'FAILED', error: '员工未绑定企业微信账号' },
        });
        continue;
      }
      const list = byStaff.get(target.wecomStaffId) || [];
      list.push(target);
      byStaff.set(target.wecomStaffId, list);
    }
    for (const [sender, list] of byStaff.entries()) {
      for (let start = 0; start < list.length; start += SEND_CHUNK) {
        const chunk = list.slice(start, start + SEND_CHUNK);
        const requestBody: Record<string, unknown> =
          type === 'CONTACT'
            ? {
                chat_type: 'single',
                external_userid: chunk
                  .map((row) => row.externalUserId || '')
                  .filter(Boolean),
                sender,
                ...body,
              }
            : {
                chat_type: 'group',
                chat_id_list: chunk
                  .map((row) => row.externalId || '')
                  .filter(Boolean),
                sender,
                ...body,
              };
        if (
          type === 'CONTACT' &&
          (requestBody.external_userid as string[]).length === 0
        ) {
          failed += chunk.length;
          await this.failTargets(
            chunk.map((row) => row.id),
            '客户缺少企微外部联系人 ID',
          );
          continue;
        }
        if (
          type === 'CHAT' &&
          (requestBody.chat_id_list as string[]).length === 0
        ) {
          failed += chunk.length;
          await this.failTargets(
            chunk.map((row) => row.id),
            '客户群缺少企微群 ID',
          );
          continue;
        }
        try {
          const result = await this.client.addMsgTemplate(
            corpId,
            contactSecret,
            requestBody,
          );
          if (!result.msgid) throw new Error('企微未返回群发任务 ID');
          msgIds.push(result.msgid);
          const failSet = new Set(result.failList);
          const okRows = chunk.filter(
            (row) =>
              !failSet.has(row.externalUserId || '') &&
              !failSet.has(row.externalId || ''),
          );
          const failRows = chunk.filter((row) => !okRows.includes(row));
          accepted += okRows.length;
          failed += failRows.length;
          if (okRows.length) {
            await this.prisma.scrmMassTarget.updateMany({
              where: { id: { in: okRows.map((row) => row.id) } },
              data: {
                status: 'PENDING',
                msgId: clip(result.msgid, 64),
                error: '',
              },
            });
          }
          if (failRows.length) {
            await this.failTargets(
              failRows.map((row) => row.id),
              '企微拒绝发送：客户不在该员工外部联系人中',
            );
          }
        } catch (error) {
          failed += chunk.length;
          await this.failTargets(
            chunk.map((row) => row.id),
            error instanceof Error ? error.message : '企微拒绝发送',
          );
        }
      }
    }
    return { accepted, failed, msgIds };
  }

  private async failTargets(ids: number[], reason: string) {
    if (!ids.length) return;
    await this.prisma.scrmMassTarget.updateMany({
      where: { id: { in: ids } },
      data: { status: 'FAILED', error: clip(reason, 300) },
    });
  }

  private async finishSubmit(
    org: HrmOrg,
    taskId: number,
    result: { accepted: number; failed: number; msgIds: string[] },
  ) {
    const counts = await this.prisma.scrmMassTarget.groupBy({
      by: ['status'],
      where: { ...orgKey(org), taskId },
      _count: { _all: true },
    });
    const byStatus = new Map(
      counts.map((row) => [row.status, row._count._all]),
    );
    const pending = byStatus.get('PENDING') || 0;
    const failed = byStatus.get('FAILED') || 0;
    const unknown = byStatus.get('UNKNOWN') || 0;
    const sent = byStatus.get('SENT') || 0;
    const status =
      pending === 0 && sent === 0
        ? 'FAILED'
        : pending > 0
          ? 'SUBMITTED'
          : failed > 0 || unknown > 0
            ? 'PARTIAL'
            : 'DONE';
    const row = await this.prisma.scrmMassTask.update({
      where: { id: taskId },
      data: {
        status,
        sent,
        failed,
        unknown,
        externalJobId: clip(result.msgIds[0] || '', 64),
      },
    });
    if (result.accepted > 0) {
      await bumpStatDaily(this.prisma, org, { massSent: result.accepted });
    }
    return {
      id: row.id,
      status: row.status,
      sent: row.sent,
      failed: row.failed,
    };
  }

  /** 回执对账：按 msgId 拉发送结果，PENDING → SENT/FAILED；过期未确认记 UNKNOWN。 */
  async reconcile(org: HrmOrg, taskId: number): Promise<string> {
    const task = await this.prisma.scrmMassTask.findFirst({
      where: { ...orgKey(org), id: taskId },
    });
    if (!task) return '';
    if (task.status !== 'SUBMITTED' && task.status !== 'PARTIAL')
      return task.status;
    const corp = await this.scope.corp(org);
    if (!corp?.enabled) return task.status;
    const secrets = this.scope.secretsOf(corp);
    const staffLinks = await this.scope.staffLinks(org);
    if (task.type === 'MOMENT') {
      const targets = await this.prisma.scrmMassTarget.findMany({
        where: {
          ...orgKey(org),
          taskId,
          status: 'PENDING',
          msgId: { not: '' },
        },
      });
      const byTask = new Map<string, typeof targets>();
      for (const target of targets) {
        const list = byTask.get(target.msgId) || [];
        list.push(target);
        byTask.set(target.msgId, list);
      }
      for (const [taskIdExternal, list] of byTask.entries()) {
        try {
          const result = await this.client.momentTaskResult(
            secrets.corpId,
            secrets.contactSecret,
            taskIdExternal,
          );
          if (result.total === 0) continue;
          const done = result.sent + result.failed >= result.total;
          if (!done) continue;
          if (result.failed === 0) {
            await this.prisma.scrmMassTarget.updateMany({
              where: { id: { in: list.map((row) => row.id) } },
              data: { status: 'SENT', sentAt: new Date() },
            });
          } else if (result.sent === 0) {
            await this.failTargets(
              list.map((row) => row.id),
              '朋友圈发送失败（企微回执）',
            );
          } else {
            await this.prisma.scrmMassTarget.updateMany({
              where: { id: { in: list.map((row) => row.id) } },
              data: {
                status: 'UNKNOWN',
                error: '朋友圈部分送达，按未知处理，不重发',
              },
            });
          }
        } catch {
          // 下次对账再试
        }
      }
    } else {
      const pending = await this.prisma.scrmMassTarget.findMany({
        where: {
          ...orgKey(org),
          taskId,
          status: 'PENDING',
          msgId: { not: '' },
        },
        take: 2000,
      });
      if (pending.length) {
        const contactPks = pending
          .filter((row) => row.kind === 'CONTACT')
          .map((row) => row.targetId);
        const chatPks = pending
          .filter((row) => row.kind === 'CHAT')
          .map((row) => row.targetId);
        const [contacts, chats] = await Promise.all([
          contactPks.length
            ? this.prisma.scrmContact.findMany({
                where: { ...orgKey(org), id: { in: contactPks } },
                select: { id: true, externalUserId: true },
              })
            : Promise.resolve([]),
          chatPks.length
            ? this.prisma.scrmChat.findMany({
                where: { ...orgKey(org), id: { in: chatPks } },
                select: { id: true, chatId: true },
              })
            : Promise.resolve([]),
        ]);
        const externalOfContact = new Map(
          contacts.map((row) => [row.id, row.externalUserId]),
        );
        const chatIdOfPk = new Map(chats.map((row) => [row.id, row.chatId]));
        const byMsg = new Map<string, typeof pending>();
        for (const target of pending) {
          const list = byMsg.get(target.msgId) || [];
          list.push(target);
          byMsg.set(target.msgId, list);
        }
        for (const [msgId, list] of byMsg.entries()) {
          const senders = [...new Set(list.map((row) => row.staffUserId))];
          for (const staffUserId of senders) {
            const wecomUserId =
              [...staffLinks.entries()].find(
                ([, member]) => member === staffUserId,
              )?.[0] || '';
            if (!wecomUserId) continue;
            try {
              const results = await this.client.groupMsgResults(
                secrets.corpId,
                secrets.contactSecret,
                msgId,
                wecomUserId,
              );
              const rows = list.filter(
                (row) => row.staffUserId === staffUserId,
              );
              const byTarget = new Map<string, (typeof rows)[number]>();
              for (const row of rows) {
                const key =
                  row.kind === 'CONTACT'
                    ? externalOfContact.get(row.targetId) || ''
                    : chatIdOfPk.get(row.targetId) || '';
                if (key) byTarget.set(key, row);
              }
              for (const result of results) {
                const target =
                  byTarget.get(
                    result.external_userid || result.chat_id || '',
                  ) || null;
                if (!target) continue;
                if (result.status === 1) {
                  await this.prisma.scrmMassTarget.update({
                    where: { id: target.id },
                    data: { status: 'SENT', sentAt: new Date() },
                  });
                } else if (result.status === 2 || result.status === 3) {
                  await this.prisma.scrmMassTarget.update({
                    where: { id: target.id },
                    data: {
                      status: 'FAILED',
                      error: clip(result.error_msg || '企微回执失败', 300),
                    },
                  });
                }
              }
            } catch {
              // 下次对账再试
            }
          }
        }
      }
    }
    return this.refreshTaskCounts(org, taskId);
  }

  /** 回执不必逐条全部完成：超过 24 小时仍 PENDING 的按 UNKNOWN 收口。 */
  private async refreshTaskCounts(
    org: HrmOrg,
    taskId: number,
  ): Promise<string> {
    const cutoff = new Date(Date.now() - 24 * 3600_000);
    await this.prisma.scrmMassTarget.updateMany({
      where: {
        ...orgKey(org),
        taskId,
        status: 'PENDING',
        createdAt: { lt: cutoff },
      },
      data: {
        status: 'UNKNOWN',
        error: '24 小时内未收到企微回执，按未知处理（不重发）',
      },
    });
    const counts = await this.prisma.scrmMassTarget.groupBy({
      by: ['status'],
      where: { ...orgKey(org), taskId },
      _count: { _all: true },
    });
    const byStatus = new Map(
      counts.map((row) => [row.status, row._count._all]),
    );
    const sent = byStatus.get('SENT') || 0;
    const failed = byStatus.get('FAILED') || 0;
    const unknown = byStatus.get('UNKNOWN') || 0;
    const pending = byStatus.get('PENDING') || 0;
    const status =
      pending > 0
        ? 'SUBMITTED'
        : failed > 0 || unknown > 0
          ? 'PARTIAL'
          : 'DONE';
    const before = await this.prisma.scrmMassTask.findUnique({
      where: { id: taskId },
    });
    const row = await this.prisma.scrmMassTask.update({
      where: { id: taskId },
      data: { status, sent, failed, unknown },
    });
    const deliveredDelta = Math.max(0, sent - (before?.sent || 0));
    if (deliveredDelta) {
      await bumpStatDaily(this.prisma, org, { massDelivered: deliveredDelta });
    }
    return row.status;
  }

  async targets(user: CurrentUser, query: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const taskId = int(query.taskId);
    const { page, pageSize, offset } = safePage(query.page, query.pageSize, 20);
    const where: Prisma.ScrmMassTargetWhereInput = {
      ...orgKey(org),
      taskId,
    };
    const status = text(query.status);
    if (status) where.status = status;
    const [rows, total] = await Promise.all([
      this.prisma.scrmMassTarget.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.scrmMassTarget.count({ where }),
    ]);
    return pageOf(
      rows.map((row) => ({
        id: row.id,
        taskId: row.taskId,
        kind: row.kind,
        targetName: row.targetName,
        staffUserId: row.staffUserId,
        staffName: row.staffName,
        status: row.status,
        error: row.error,
        msgId: row.msgId,
        sentAt: iso(row.sentAt),
      })),
      total,
      page,
      pageSize,
    );
  }

  // ---------- 目标与内容 ----------

  /** 除本人以外的管理员（组织主账号 / HR·ADMIN 角色成员），用于防止自批自审。 */
  private async otherAdminOf(org: HrmOrg, selfId: string): Promise<string> {
    if (org.orgUserId && org.orgUserId !== selfId) return org.orgUserId;
    const rows = await this.prisma.orgStaff.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        status: 'ACTIVE',
        memberUserId: { not: selfId },
      },
      select: { memberUserId: true, roles: true },
    });
    const admin = rows.find((row) => {
      const roles = Array.isArray(row.roles)
        ? row.roles.map((role) => text(role).toUpperCase())
        : [];
      return ['HR', 'ADMIN', 'OWNER', 'HUMAN_RESOURCE'].some((role) =>
        roles.includes(role),
      );
    });
    return admin?.memberUserId || '';
  }

  private async countTargets(
    org: HrmOrg,
    type: MassType,
    filter: Record<string, unknown>,
  ): Promise<number> {
    if (type === 'CONTACT') {
      return this.prisma.scrmContact.count({
        where: await this.contactWhere(org, filter),
      });
    }
    if (type === 'CHAT') {
      return this.prisma.scrmChat.count({
        where: this.chatWhere(org, filter),
      });
    }
    const staff = await this.momentStaff(org, filter);
    return staff.length;
  }

  private async contactWhere(
    org: HrmOrg,
    filter: Record<string, unknown>,
  ): Promise<Prisma.ScrmContactWhereInput> {
    const where: Prisma.ScrmContactWhereInput = {
      ...orgKey(org),
      status: 'ACTIVE',
    };
    const contactIds = intArr(filter.contactIds);
    // 标签与归属员工都是独立关联表，客户表上没有对应关系字段
    const relatedIds = await contactIdsByRelation(this.prisma, org, {
      tagIds: intArr(filter.tagIds),
      staffUserIds: Array.isArray(filter.staffUserIds)
        ? filter.staffUserIds.map(String).filter(Boolean)
        : [],
    });
    const idFilter = contactIds.length
      ? relatedIds
        ? contactIds.filter((id) => relatedIds.includes(id))
        : contactIds
      : relatedIds;
    if (idFilter) where.id = { in: idFilter };
    const codeIds = intArr(filter.codeIds);
    if (codeIds.length) where.sourceCodeId = { in: codeIds };
    const from = dateOr(filter.addedFrom);
    const to = dateOr(filter.addedTo);
    if (from || to) {
      where.addedAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: new Date(to.getTime() + 86_400_000 - 1) } : {}),
      };
    }
    return where;
  }

  private chatWhere(
    org: HrmOrg,
    filter: Record<string, unknown>,
  ): Prisma.ScrmChatWhereInput {
    const where: Prisma.ScrmChatWhereInput = {
      ...orgKey(org),
      status: 'ACTIVE',
    };
    const chatIds = intArr(filter.chatIds);
    if (chatIds.length) where.id = { in: chatIds };
    return where;
  }

  private async momentStaff(org: HrmOrg, filter: Record<string, unknown>) {
    const requested = Array.isArray(filter.staffUserIds)
      ? filter.staffUserIds.map(String).filter(Boolean)
      : [];
    if (requested.length) {
      const members = await this.scope.memberUserIds(org);
      return requested.filter((id) => members.includes(id));
    }
    const rows = await this.prisma.scrmContactStaff.findMany({
      where: orgKey(org),
      select: { staffUserId: true },
      distinct: ['staffUserId'],
    });
    return rows.map((row) => row.staffUserId);
  }

  private async buildTargets(
    org: HrmOrg,
    type: MassType,
    filter: Record<string, unknown>,
    wecomOf: (memberId: string) => string,
  ) {
    if (type === 'MOMENT') {
      const staff = await this.momentStaff(org, filter);
      const names = await this.scope.names(staff);
      return staff.map((staffUserId) => ({
        kind: 'STAFF',
        targetId: 0,
        targetName: nameOf(names, staffUserId),
        staffUserId,
        staffName: nameOf(names, staffUserId),
        externalId: '',
        externalUserId: '',
        wecomStaffId: wecomOf(staffUserId),
      }));
    }
    if (type === 'CHAT') {
      const chats = await this.prisma.scrmChat.findMany({
        where: this.chatWhere(org, filter),
        take: MAX_CHATS_PER_TASK,
      });
      const names = await this.scope.names(
        chats.map((chat) => chat.ownerStaffId),
      );
      return chats.map((chat) => ({
        kind: 'CHAT',
        targetId: chat.id,
        targetName: chat.name || chat.chatId,
        staffUserId: chat.ownerStaffId,
        staffName: nameOf(names, chat.ownerStaffId),
        externalId: chat.chatId,
        externalUserId: '',
        wecomStaffId: wecomOf(chat.ownerStaffId),
      }));
    }
    const contacts = await this.prisma.scrmContact.findMany({
      where: await this.contactWhere(org, filter),
      take: MAX_CONTACTS_PER_TASK,
    });
    const ids = contacts.map((contact) => contact.id);
    const links = ids.length
      ? await this.prisma.scrmContactStaff.findMany({
          where: { ...orgKey(org), contactId: { in: ids } },
          orderBy: { id: 'asc' },
        })
      : [];
    const staffLinks = await this.scope.staffLinks(org);
    const nameOfStaff = await this.scope.names(
      links.map((link) => link.staffUserId),
    );
    return contacts.map((contact) => {
      const owner =
        links.find(
          (link) => link.contactId === contact.id && link.relation === 'OWNER',
        ) || links.find((link) => link.contactId === contact.id);
      const staffUserId = owner?.staffUserId || '';
      const wecomStaffId =
        owner?.externalStaffId ||
        [...staffLinks.entries()].find(
          ([, member]) => member === staffUserId,
        )?.[0] ||
        '';
      return {
        kind: 'CONTACT',
        targetId: contact.id,
        targetName: contact.name || contact.remark || contact.externalUserId,
        staffUserId,
        staffName: nameOf(nameOfStaff, staffUserId),
        externalId: '',
        externalUserId: contact.externalUserId,
        wecomStaffId,
      };
    });
  }

  /**
   * 企微频控：同员工同类型客户/群群发每天 1 次，朋友圈每周 3 次。
   * 返回 staffUserId → 失败原因；未超限的不在 Map 里。
   */
  private async blockedStaff(
    org: HrmOrg,
    type: MassType,
    staffUserIds: string[],
  ): Promise<Map<string, string>> {
    const blocked = new Map<string, string>();
    const since =
      type === 'MOMENT'
        ? new Date(Date.now() - 7 * 86_400_000)
        : dayStart(dayKey());
    const tasks = await this.prisma.scrmMassTask.findMany({
      where: {
        ...orgKey(org),
        type,
        submittedAt: { gte: since },
        status: { in: ['SUBMITTED', 'DONE', 'PARTIAL'] },
      },
      select: { id: true },
    });
    if (!tasks.length) return blocked;
    const rows = await this.prisma.scrmMassTarget.findMany({
      where: {
        ...orgKey(org),
        taskId: { in: tasks.map((task) => task.id) },
        status: { in: ['SENT', 'PENDING', 'UNKNOWN'] },
        staffUserId: { in: [...new Set(staffUserIds)] },
      },
      select: { staffUserId: true },
    });
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.staffUserId, (counts.get(row.staffUserId) || 0) + 1);
    }
    for (const [staffUserId, count] of counts.entries()) {
      if (type === 'MOMENT' && count >= 3) {
        blocked.set(staffUserId, '该员工近 7 天已发 3 次朋友圈（企微上限）');
      } else if (type !== 'MOMENT' && count >= 1) {
        blocked.set(staffUserId, '该员工今日已发过同类群发（企微每日 1 次）');
      }
    }
    return blocked;
  }

  private messageBody(content: MassContent): Record<string, unknown> {
    const attachments: Record<string, unknown>[] = [];
    if (content.linkUrl) {
      attachments.push({
        msgtype: 'link',
        link: {
          title: content.linkTitle || content.linkUrl,
          url: content.linkUrl,
          desc: content.linkDesc,
        },
      });
    }
    if (content.miniProgram.appId) {
      attachments.push({
        msgtype: 'miniprogram',
        miniprogram: {
          appid: content.miniProgram.appId,
          title: content.miniProgram.title || content.linkTitle,
          page: content.miniProgram.page,
        },
      });
    }
    return {
      ...(content.text ? { text: { content: content.text } } : {}),
      ...(attachments.length ? { attachments } : {}),
    };
  }

  private async externalIdOf(org: HrmOrg, contactId: number): Promise<string> {
    const row = await this.prisma.scrmContact.findFirst({
      where: { ...orgKey(org), id: contactId },
      select: { externalUserId: true },
    });
    return row?.externalUserId || '';
  }

  private async chatIdOf(org: HrmOrg, chatPk: number): Promise<string> {
    const row = await this.prisma.scrmChat.findFirst({
      where: { ...orgKey(org), id: chatPk },
      select: { chatId: true },
    });
    return row?.chatId || '';
  }

  /** 调度入口：到点的已审批任务自动提交。 */
  async runDue(now: Date): Promise<number> {
    const tasks = await this.prisma.scrmMassTask.findMany({
      where: { status: 'APPROVED', scheduledAt: { lte: now } },
      take: 50,
    });
    let count = 0;
    for (const task of tasks) {
      const org = orgOf(task);
      try {
        await this.submit(org, task.id);
        count += 1;
      } catch {
        // 缺员工绑定/凭据等情况保留 APPROVED，等待人工处理
      }
    }
    return count;
  }

  /** 调度入口：对账所有进行中的任务。 */
  async reconcileRunning(): Promise<number> {
    const tasks = await this.prisma.scrmMassTask.findMany({
      where: { status: 'SUBMITTED' },
      orderBy: { id: 'asc' },
      take: 50,
    });
    let count = 0;
    for (const task of tasks) {
      const org = orgOf(task);
      try {
        await this.reconcile(org, task.id);
        count += 1;
      } catch {
        // 下轮再试
      }
    }
    return count;
  }
}
