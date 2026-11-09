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
  int,
  orgKey,
  orgOf,
  safePage,
  text,
} from './scrm.helpers';

/**
 * 在职转接 / 离职继承 / 未分配。
 *
 * - 只有企业管理员能发起（离职继承涉及客户资产归属，不自动替管理员决定）；
 * - 客户走 transfer_customer / resigned/transfer_customer，接替需客户 24 小时内不拒绝；
 * - 客户群走 groupchat/transfer / groupchat/resigned/transfer，新群主立即生效；
 * - 提交后状态按企微回执轮询刷新，失败原因原样回写，不重复提交。
 */

type TransferType = 'ACTIVE' | 'RESIGN';
type TransferKind = 'CONTACT' | 'CHAT';

const CLIENT_CHUNK = 100;

type Target = { kind: TransferKind; id: number };

export class ScrmTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScrmScopeService,
    private readonly client: ScrmClient,
  ) {}

  private wecomOf(staffLinks: Map<string, string>, memberId: string): string {
    return (
      [...staffLinks.entries()].find(
        ([, member]) => member === memberId,
      )?.[0] || ''
    );
  }

  private localOf(staffLinks: Map<string, string>, wecomId: string): string {
    return staffLinks.get(wecomId) || '';
  }

  private view(row: {
    id: number;
    type: string;
    kind: string;
    targetName: string;
    fromStaffId: string;
    fromStaffName: string;
    toStaffId: string;
    toStaffName: string;
    status: string;
    failReason: string;
    externalJobId: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      type: row.type,
      kind: row.kind,
      targetName: row.targetName,
      fromStaffId: row.fromStaffId,
      fromStaffName: row.fromStaffName,
      toStaffId: row.toStaffId,
      toStaffName: row.toStaffName,
      status: row.status,
      failReason: row.failReason,
      externalJobId: row.externalJobId,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  async transfers(user: CurrentUser, query: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const { page, pageSize, offset } = safePage(query.page, query.pageSize, 20);
    const where: Prisma.ScrmTransferWhereInput = { ...orgKey(org) };
    const type = text(query.type);
    if (type) where.type = type;
    const [rows, total] = await Promise.all([
      this.prisma.scrmTransfer.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.scrmTransfer.count({ where }),
    ]);
    return pageOf(
      rows.map((row) => this.view(row)),
      total,
      page,
      pageSize,
    );
  }

  /** 未分配：企微离职成员待分配客户 + 本地没有有效跟进人的客户/群。 */
  async unassigned(user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const [staffLinks, members] = await Promise.all([
      this.scope.staffLinks(org),
      this.scope.memberUserIds(org),
    ]);
    const memberSet = new Set(members);
    const out = new Map<
      string,
      {
        kind: string;
        id: number;
        externalId: string;
        name: string;
        ownerStaffId: string;
        ownerStaffName: string;
        reason: string;
        lastActiveAt: string;
      }
    >();

    const corp = await this.scope.corp(org);
    const fromWecom: { externalUserId: string; handover: string }[] = [];
    if (corp?.enabled) {
      const secrets = this.scope.secretsOf(corp);
      try {
        let cursor = '';
        for (let page = 0; page < 5; page += 1) {
          const result = await this.client.unassignedList(
            secrets.corpId,
            secrets.contactSecret,
            cursor,
            100,
          );
          for (const item of result.list) {
            if (!item.external_userid) continue;
            fromWecom.push({
              externalUserId: item.external_userid,
              handover: item.handover_userid || '',
            });
          }
          if (!result.nextCursor) break;
          cursor = result.nextCursor;
        }
      } catch {
        // 企微待分配列表暂不可用时仍返回本地判断，避免整页空白
      }
    }
    if (fromWecom.length) {
      const externalIds = [
        ...new Set(fromWecom.map((row) => row.externalUserId)),
      ];
      const contacts = await this.prisma.scrmContact.findMany({
        where: { ...orgKey(org), externalUserId: { in: externalIds } },
        select: {
          id: true,
          externalUserId: true,
          name: true,
          remark: true,
          lastInteractionAt: true,
          addedAt: true,
        },
      });
      const byExternal = new Map(
        contacts.map((row) => [row.externalUserId, row]),
      );
      for (const item of fromWecom) {
        const contact = byExternal.get(item.externalUserId);
        const ownerStaffId =
          this.localOf(staffLinks, item.handover) || item.handover;
        out.set(`CONTACT:${item.externalUserId}`, {
          kind: 'CONTACT',
          id: contact?.id || 0,
          externalId: item.externalUserId,
          name: contact?.name || contact?.remark || item.externalUserId,
          ownerStaffId,
          ownerStaffName: ownerStaffId,
          reason: '离职成员待分配',
          lastActiveAt: iso(contact?.lastInteractionAt || contact?.addedAt),
        });
      }
    }

    const contacts = await this.prisma.scrmContact.findMany({
      where: { ...orgKey(org), status: 'ACTIVE' },
      orderBy: { id: 'desc' },
      take: 1000,
      select: {
        id: true,
        externalUserId: true,
        name: true,
        remark: true,
        addedAt: true,
        lastInteractionAt: true,
      },
    });
    const contactIds = contacts.map((row) => row.id);
    const links = contactIds.length
      ? await this.prisma.scrmContactStaff.findMany({
          where: { ...orgKey(org), contactId: { in: contactIds } },
        })
      : [];
    const linksOf = new Map<number, typeof links>();
    for (const link of links) {
      const list = linksOf.get(link.contactId) || [];
      list.push(link);
      linksOf.set(link.contactId, list);
    }
    for (const contact of contacts) {
      const key = `CONTACT:${contact.externalUserId}`;
      if (out.has(key)) continue;
      const owned = linksOf.get(contact.id) || [];
      if (owned.some((link) => memberSet.has(link.staffUserId))) continue;
      const owner = owned[0];
      out.set(key, {
        kind: 'CONTACT',
        id: contact.id,
        externalId: contact.externalUserId,
        name: contact.name || contact.remark || contact.externalUserId,
        ownerStaffId: owner?.staffUserId || '',
        ownerStaffName: owner?.staffUserId || '',
        reason: owned.length ? '原跟进员工已不在组织' : '暂无跟进员工',
        lastActiveAt: iso(contact.lastInteractionAt || contact.addedAt),
      });
    }

    const chats = await this.prisma.scrmChat.findMany({
      where: { ...orgKey(org), status: 'ACTIVE' },
      orderBy: { id: 'desc' },
      take: 1000,
      select: {
        id: true,
        chatId: true,
        name: true,
        ownerStaffId: true,
        updatedAt: true,
      },
    });
    for (const chat of chats) {
      const key = `CHAT:${chat.chatId}`;
      if (out.has(key)) continue;
      if (chat.ownerStaffId && memberSet.has(chat.ownerStaffId)) continue;
      out.set(key, {
        kind: 'CHAT',
        id: chat.id,
        externalId: chat.chatId,
        name: chat.name || chat.chatId,
        ownerStaffId: chat.ownerStaffId,
        ownerStaffName: chat.ownerStaffId,
        reason: chat.ownerStaffId ? '群主已不在组织' : '暂无群主',
        lastActiveAt: iso(chat.updatedAt),
      });
    }

    const names = await this.scope.names(
      [...out.values()].map((row) => row.ownerStaffId).filter(Boolean),
    );
    return [...out.values()].slice(0, 500).map((row) => ({
      ...row,
      ownerStaffName: names.get(row.ownerStaffId) || row.ownerStaffName,
    }));
  }

  /** 发起转接/继承：管理员指定接收人，客户与群分别提交企微。 */
  async createTransfer(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const type = text(body.type).toUpperCase() as TransferType;
    if (!['ACTIVE', 'RESIGN'].includes(type)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '转接类型不合法');
    }
    const toStaffId = text(body.toStaffId).trim();
    await this.scope.requireMember(org, toStaffId);
    const { corp, secrets } = await this.scope.requireCorp(org);
    const [staffLinks, members] = await Promise.all([
      this.scope.staffLinks(org),
      this.scope.memberUserIds(org),
    ]);
    const memberSet = new Set(members);
    const toWecom = this.wecomOf(staffLinks, toStaffId);
    if (!toWecom) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '接收人尚未绑定企业微信账号，请先在「成员同步」完成绑定后再转接',
      );
    }
    const targets = this.parseTargets(body.targets);
    if (!targets.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择要转接的客户或客户群',
      );
    }

    let created = 0;
    let failed = 0;
    let firstError = '';
    const contactCalls = new Map<
      string,
      { externalIds: string[]; rows: number[] }
    >();
    const chatCalls = new Map<string, { chatIds: string[]; rows: number[] }>();

    for (const target of targets) {
      if (await this.hasPending(org, type, target, toStaffId)) {
        failed += 1;
        firstError = firstError || '该对象已有进行中的转接任务，请等待结果刷新';
        continue;
      }
      const prepared = await this.prepareTarget(org, type, target, {
        memberSet,
        staffLinks,
        toStaffId,
      });
      if (typeof prepared === 'string') {
        failed += 1;
        firstError = firstError || prepared;
        await this.recordTransfer(org, {
          type,
          target,
          toStaffId,
          status: 'FAILED',
          failReason: prepared,
        });
        continue;
      }
      if (target.kind === 'CONTACT') {
        const bucket = contactCalls.get(prepared.fromWecom) || {
          externalIds: [],
          rows: [],
        };
        bucket.externalIds.push(prepared.externalId);
        bucket.rows.push(prepared.rowId);
        contactCalls.set(prepared.fromWecom, bucket);
      } else {
        const bucket = chatCalls.get(prepared.fromWecom) || {
          chatIds: [],
          rows: [],
        };
        bucket.chatIds.push(prepared.externalId);
        bucket.rows.push(prepared.rowId);
        chatCalls.set(prepared.fromWecom, bucket);
      }
    }

    for (const [fromWecom, bucket] of contactCalls.entries()) {
      for (
        let start = 0;
        start < bucket.externalIds.length;
        start += CLIENT_CHUNK
      ) {
        const ids = bucket.externalIds.slice(start, start + CLIENT_CHUNK);
        try {
          const result =
            type === 'RESIGN'
              ? await this.client.resignedTransferCustomer(
                  corp.corpId,
                  secrets.contactSecret,
                  {
                    handover_userid: fromWecom,
                    takeover_userid: toWecom,
                    external_userid: ids,
                  },
                )
              : await this.client.transferCustomer(
                  corp.corpId,
                  secrets.contactSecret,
                  {
                    handover_userid: fromWecom,
                    takeover_userid: toWecom,
                    external_userid: ids,
                  },
                );
          const failSet = new Set(result.failList);
          for (let index = start; index < start + ids.length; index += 1) {
            const externalId = bucket.externalIds[index];
            const status = failSet.has(externalId) ? 'FAILED' : 'PENDING';
            const reason = failSet.has(externalId)
              ? '企微拒绝转接（客户不在原员工名下或冷却中）'
              : '';
            await this.updatePrepared(org, {
              rowId: bucket.rows[index],
              status,
              failReason: reason,
            });
            if (status === 'PENDING') created += 1;
            else {
              failed += 1;
              firstError = firstError || reason;
            }
          }
        } catch (error) {
          const reason = clip(
            error instanceof Error ? error.message : '企微拒绝转接',
            300,
          );
          for (let index = start; index < start + ids.length; index += 1) {
            await this.updatePrepared(org, {
              rowId: bucket.rows[index],
              status: 'FAILED',
              failReason: reason,
            });
          }
          failed += ids.length;
          firstError = firstError || reason;
        }
      }
    }

    for (const bucket of chatCalls.values()) {
      for (
        let start = 0;
        start < bucket.chatIds.length;
        start += CLIENT_CHUNK
      ) {
        const ids = bucket.chatIds.slice(start, start + CLIENT_CHUNK);
        try {
          const result =
            type === 'RESIGN'
              ? await this.client.resignedTransferGroupChat(
                  corp.corpId,
                  secrets.contactSecret,
                  ids,
                  toWecom,
                )
              : await this.client.transferGroupChat(
                  corp.corpId,
                  secrets.contactSecret,
                  ids,
                  toWecom,
                );
          const failSet = new Set(result.failList);
          for (let index = start; index < start + ids.length; index += 1) {
            const chatId = bucket.chatIds[index];
            const isFailed = failSet.has(chatId);
            const reason = isFailed
              ? '企微拒绝群转接（接收人不在群内或未开通客户群）'
              : '';
            await this.updatePrepared(org, {
              rowId: bucket.rows[index],
              status: isFailed ? 'FAILED' : 'DONE',
              failReason: reason,
            });
            if (isFailed) {
              failed += 1;
              firstError = firstError || reason;
            } else {
              created += 1;
              await this.applyChatOwner(org, bucket.rows[index], toStaffId);
            }
          }
        } catch (error) {
          const reason = clip(
            error instanceof Error ? error.message : '企微拒绝群转接',
            300,
          );
          for (let index = start; index < start + ids.length; index += 1) {
            await this.updatePrepared(org, {
              rowId: bucket.rows[index],
              status: 'FAILED',
              failReason: reason,
            });
          }
          failed += ids.length;
          firstError = firstError || reason;
        }
      }
    }

    const parts = [
      `已提交 ${created} 个${type === 'RESIGN' ? '离职继承' : '在职转接'}任务`,
    ];
    if (failed) parts.push(`${failed} 个失败`);
    if (firstError) parts.push(`首个失败原因：${firstError}`);
    if (type === 'RESIGN' && created) {
      parts.push('客户需 24 小时内未拒绝才会自动接替，可在列表中刷新结果');
    }
    return { created, message: parts.join('；') };
  }

  /** 轮询客户接替结果；客户群在提交时已生效，这里只做复核。 */
  async refreshTransfer(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const row = await this.prisma.scrmTransfer.findFirst({
      where: { ...orgKey(org), id: int(body.id) },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '转接任务不存在');
    }
    return this.view(await this.refresh(org, row));
  }

  private async refresh(
    org: HrmOrg,
    row: {
      id: number;
      type: string;
      kind: string;
      targetId: number;
      toStaffId: string;
      fromStaffId: string;
      status: string;
      fromStaffName: string;
      toStaffName: string;
      targetName: string;
      failReason: string;
      externalJobId: string;
      createdAt: Date;
      updatedAt: Date;
      orgType: string;
      orgUserId: string;
    },
  ) {
    if (row.status === 'DONE' || row.status === 'FAILED') return row;
    const { corp, secrets } = await this.scope.requireCorp(org);
    const staffLinks = await this.scope.staffLinks(org);
    const toWecom = this.wecomOf(staffLinks, row.toStaffId);
    const fromWecom = this.wecomOf(staffLinks, row.fromStaffId);
    if (!toWecom) {
      return this.markTransfer(
        org,
        row.id,
        'FAILED',
        '接收人未绑定企业微信账号，无法查询接替状态',
      );
    }
    if (row.kind === 'CHAT') {
      const chat = await this.prisma.scrmChat.findFirst({
        where: { ...orgKey(org), id: row.targetId },
        select: { chatId: true, ownerStaffId: true },
      });
      if (!chat) {
        return this.markTransfer(org, row.id, 'FAILED', '客户群已不存在');
      }
      if (toWecom && chat.ownerStaffId === row.toStaffId) {
        return this.markTransfer(org, row.id, 'DONE', '');
      }
      const detail = await this.client.chatDetail(
        corp.corpId,
        secrets.contactSecret,
        chat.chatId,
      );
      if (detail?.owner && detail.owner === toWecom) {
        await this.prisma.scrmChat.update({
          where: { id: row.targetId },
          data: { ownerStaffId: row.toStaffId },
        });
        return this.markTransfer(org, row.id, 'DONE', '');
      }
      return this.markTransfer(
        org,
        row.id,
        'PROCESSING',
        '等待企微生效；如长时间未变更，请检查接收人是否在群内',
      );
    }

    const contact = await this.prisma.scrmContact.findFirst({
      where: { ...orgKey(org), id: row.targetId },
      select: { externalUserId: true },
    });
    if (!contact?.externalUserId || !fromWecom) {
      return this.markTransfer(
        org,
        row.id,
        'FAILED',
        '缺少客户或原员工的企微标识，无法查询接替状态',
      );
    }
    const handoverType = row.type === 'RESIGN' ? 0 : 1;
    let cursor = '';
    for (let page = 0; page < 5; page += 1) {
      const result = await this.client.transferResult(
        corp.corpId,
        secrets.contactSecret,
        handoverType,
        cursor,
        100,
      );
      const hit = result.list.find(
        (item) =>
          item.handover_userid === fromWecom &&
          item.takeover_userid === toWecom &&
          item.external_userid === contact.externalUserId,
      );
      if (hit) {
        const status = Number(hit.status ?? 0);
        const code = Number(hit.errcode ?? 0);
        if (status === 1 && code === 0) {
          await this.applyContactOwner(
            org,
            row.targetId,
            row.fromStaffId,
            row.toStaffId,
            staffLinks,
          );
          return this.markTransfer(org, row.id, 'DONE', '');
        }
        if (code === 1) {
          return this.markTransfer(
            org,
            row.id,
            'FAILED',
            '客户拒绝接替，原归属保留',
          );
        }
        if (code === 2) {
          return this.markTransfer(
            org,
            row.id,
            'FAILED',
            '接替成员实名认证未通过',
          );
        }
        if (code === 3) {
          return this.markTransfer(org, row.id, 'FAILED', '接替成员已离职');
        }
        if (code === 4) {
          return this.markTransfer(org, row.id, 'FAILED', '客户已删除接替成员');
        }
        return this.markTransfer(
          org,
          row.id,
          'PROCESSING',
          '等待客户确认（客户 24 小时内未拒绝则自动接替）',
        );
      }
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    return this.markTransfer(
      org,
      row.id,
      'PROCESSING',
      '企微尚未返回接替结果，稍后再刷新',
    );
  }

  private async markTransfer(
    org: HrmOrg,
    id: number,
    status: string,
    failReason: string,
  ) {
    return this.prisma.scrmTransfer.update({
      where: { id },
      data: { status, failReason: clip(failReason, 300) },
    });
  }

  /** 接替完成后本地归属切换：原员工保留为共享关系，新员工成为 OWNER。 */
  private async applyContactOwner(
    org: HrmOrg,
    contactId: number,
    fromStaffId: string,
    toStaffId: string,
    staffLinks: Map<string, string>,
  ) {
    if (fromStaffId && fromStaffId !== toStaffId) {
      await this.prisma.scrmContactStaff.updateMany({
        where: { ...orgKey(org), contactId, staffUserId: fromStaffId },
        data: { relation: 'SHARED' },
      });
    }
    await this.prisma.scrmContactStaff.upsert({
      where: { contactId_staffUserId: { contactId, staffUserId: toStaffId } },
      create: {
        ...orgKey(org),
        contactId,
        staffUserId: toStaffId,
        externalStaffId: this.wecomOf(staffLinks, toStaffId),
        relation: 'OWNER',
        addedAt: new Date(),
      },
      update: {
        relation: 'OWNER',
        externalStaffId: this.wecomOf(staffLinks, toStaffId),
      },
    });
    const names = await this.scope.names([fromStaffId, toStaffId]);
    await addTimeline(
      this.prisma,
      org,
      contactId,
      'TRANSFER',
      '客户已转接',
      `${names.get(fromStaffId) || fromStaffId} → ${names.get(toStaffId) || toStaffId}`,
    );
  }

  private async applyChatOwner(
    org: HrmOrg,
    transferId: number,
    toStaffId: string,
  ) {
    const row = await this.prisma.scrmTransfer.findFirst({
      where: { ...orgKey(org), id: transferId },
    });
    if (!row) return;
    await this.prisma.scrmChat.updateMany({
      where: { ...orgKey(org), id: row.targetId },
      data: { ownerStaffId: toStaffId },
    });
  }

  private parseTargets(value: unknown): Target[] {
    if (!Array.isArray(value)) return [];
    const out: Target[] = [];
    for (const item of value) {
      const row = (item || {}) as Record<string, unknown>;
      const kind = text(row.kind).toUpperCase() as TransferKind;
      const id = int(row.id);
      if (!['CONTACT', 'CHAT'].includes(kind) || id <= 0) continue;
      out.push({ kind, id });
    }
    return out;
  }

  /** 读取目标并校验归属；返回企微调用所需的标识，失败时返回原因。 */
  private async prepareTarget(
    org: HrmOrg,
    type: TransferType,
    target: Target,
    ctx: {
      memberSet: Set<string>;
      staffLinks: Map<string, string>;
      toStaffId: string;
    },
  ): Promise<
    string | { rowId: number; externalId: string; fromWecom: string }
  > {
    if (target.kind === 'CONTACT') {
      const contact = await this.prisma.scrmContact.findFirst({
        where: { ...orgKey(org), id: target.id },
        select: { id: true, externalUserId: true, name: true, remark: true },
      });
      if (!contact) return '客户不存在或不属于当前组织';
      const links = await this.prisma.scrmContactStaff.findMany({
        where: { ...orgKey(org), contactId: contact.id },
      });
      const owner =
        links.find((link) => link.relation === 'OWNER') || links[0] || null;
      if (!owner) return '该客户没有跟进员工，无法转接';
      if (owner.staffUserId === ctx.toStaffId)
        return '接收人已是该客户的跟进员工';
      const fromWecom =
        owner.externalStaffId ||
        this.wecomOf(ctx.staffLinks, owner.staffUserId);
      if (!fromWecom) return '原跟进员工尚未绑定企业微信账号';
      const guard = this.guardStaff(type, owner.staffUserId, ctx.memberSet);
      if (guard) return guard;
      const row = await this.recordTransfer(org, {
        type,
        target,
        toStaffId: ctx.toStaffId,
        status: 'PROCESSING',
        failReason: '',
        targetName: contact.name || contact.remark || contact.externalUserId,
        fromStaffId: owner.staffUserId,
      });
      return { rowId: row.id, externalId: contact.externalUserId, fromWecom };
    }
    const chat = await this.prisma.scrmChat.findFirst({
      where: { ...orgKey(org), id: target.id },
      select: { id: true, chatId: true, name: true, ownerStaffId: true },
    });
    if (!chat) return '客户群不存在或不属于当前组织';
    if (!chat.ownerStaffId) return '该客户群没有群主，无法转接';
    if (chat.ownerStaffId === ctx.toStaffId) return '接收人已是该群群主';
    const fromWecom = this.wecomOf(ctx.staffLinks, chat.ownerStaffId);
    if (!fromWecom) return '原群主尚未绑定企业微信账号';
    const guard = this.guardStaff(type, chat.ownerStaffId, ctx.memberSet);
    if (guard) return guard;
    const row = await this.recordTransfer(org, {
      type,
      target,
      toStaffId: ctx.toStaffId,
      status: 'PROCESSING',
      failReason: '',
      targetName: chat.name || chat.chatId,
      fromStaffId: chat.ownerStaffId,
    });
    return { rowId: row.id, externalId: chat.chatId, fromWecom };
  }

  private guardStaff(
    type: TransferType,
    fromStaffId: string,
    memberSet: Set<string>,
  ): string {
    const stillActive = memberSet.has(fromStaffId);
    if (type === 'RESIGN' && stillActive) {
      return '原员工仍在组织内，请改用「在职转接」；离职继承只适用于已移出组织的员工';
    }
    if (type === 'ACTIVE' && !stillActive) {
      return '原员工已不在组织内，请改用「离职继承」';
    }
    return '';
  }

  private async hasPending(
    org: HrmOrg,
    type: TransferType,
    target: Target,
    toStaffId: string,
  ): Promise<boolean> {
    const row = await this.prisma.scrmTransfer.findFirst({
      where: {
        ...orgKey(org),
        type,
        kind: target.kind,
        targetId: target.id,
        toStaffId,
        status: { in: ['PENDING', 'PROCESSING'] },
      },
      select: { id: true },
    });
    return Boolean(row);
  }

  private async recordTransfer(
    org: HrmOrg,
    input: {
      type: TransferType;
      target: Target;
      toStaffId: string;
      status: string;
      failReason: string;
      targetName?: string;
      fromStaffId?: string;
    },
  ) {
    const names = await this.scope.names([
      input.fromStaffId || '',
      input.toStaffId,
    ]);
    return this.prisma.scrmTransfer.create({
      data: {
        ...orgKey(org),
        type: input.type,
        kind: input.target.kind,
        targetId: input.target.id,
        targetName: clip(
          input.targetName ||
            `${input.target.kind === 'CONTACT' ? '客户' : '客户群'} #${input.target.id}`,
          120,
        ),
        fromStaffId: input.fromStaffId || '',
        fromStaffName:
          names.get(input.fromStaffId || '') || input.fromStaffId || '',
        toStaffId: input.toStaffId,
        toStaffName: names.get(input.toStaffId) || input.toStaffId,
        status: input.status,
        failReason: clip(input.failReason, 300),
        createdBy: org.actorId,
      },
    });
  }

  private async updatePrepared(
    org: HrmOrg,
    input: {
      rowId: number;
      status: string;
      failReason: string;
    },
  ) {
    await this.prisma.scrmTransfer.updateMany({
      where: { ...orgKey(org), id: input.rowId },
      data: {
        status: input.status,
        failReason: clip(input.failReason, 300),
      },
    });
  }

  /** 调度入口：每 5 分钟刷新进行中的客户接替与群归属。 */
  async runDue(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - 5 * 60_000);
    const rows = await this.prisma.scrmTransfer.findMany({
      where: {
        status: { in: ['PENDING', 'PROCESSING'] },
        updatedAt: { lt: cutoff },
      },
      orderBy: { id: 'asc' },
      take: 20,
    });
    let count = 0;
    for (const row of rows) {
      try {
        await this.refresh(orgOf(row), row);
        count += 1;
      } catch {
        // 下轮再试
      }
    }
    return count;
  }
}
