import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { pageOf } from '../common/api';
import type { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma';
import type { HrmOrg } from '../hrm/hrm.scope';
import { clip, iso } from '../hrm/hrm.helpers';
import type { WecomChatDetail } from './scrm.client';
import { ScrmClient } from './scrm.client';
import { ScrmScopeService, type ScrmSecrets } from './scrm.scope';
import {
  contactIdsByRelation,
  int,
  intArr,
  json,
  nameOf,
  orgKey,
  safePage,
  text,
} from './scrm.helpers';

/**
 * 客户群：群列表/详情、本地分组、自动拉群。
 *
 * 企微不提供「把某个客户直接塞进群」的接口，自动拉群做的是：按标签/群挑出客户，
 * 用 1v1 群发把入群邀请送达客户，再用群成员对账统计实际入群数——不伪造已入群。
 */
export class ScrmChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScrmScopeService,
    private readonly client: ScrmClient,
  ) {}

  private async groupMap(org: HrmOrg): Promise<Map<number, string>> {
    const rows = await this.prisma.scrmChatGroup.findMany({
      where: orgKey(org),
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private view(
    row: {
      id: number;
      chatId: string;
      name: string;
      ownerStaffId: string;
      groupId: number;
      memberCount: number;
      maxMembers: number;
      status: string;
      createdAt: Date;
    },
    ownerName: string,
    groupName: string,
  ) {
    return {
      id: row.id,
      chatId: row.chatId,
      name: row.name,
      ownerStaffId: row.ownerStaffId,
      ownerStaffName: ownerName,
      groupName,
      memberCount: row.memberCount,
      maxMembers: row.maxMembers,
      status: row.status,
      createdAt: iso(row.createdAt),
    };
  }

  async chats(user: CurrentUser, query: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const { page, pageSize, offset } = safePage(query.page, query.pageSize, 20);
    const where: Prisma.ScrmChatWhereInput = { ...orgKey(org) };
    const keyword = clip(query.keyword, 100).trim();
    if (keyword) where.name = { contains: keyword };
    const owner = text(query.ownerStaffId).trim();
    if (owner) where.ownerStaffId = owner;
    const status = text(query.status).trim();
    if (status) where.status = status;
    const groupName = clip(query.groupName, 40).trim();
    if (groupName) {
      const groups = await this.prisma.scrmChatGroup.findMany({
        where: { ...orgKey(org), name: { contains: groupName } },
        select: { id: true },
      });
      where.groupId = { in: groups.map((group) => group.id) };
    }
    const [rows, total, groups] = await Promise.all([
      this.prisma.scrmChat.findMany({
        where,
        orderBy: [{ memberCount: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: pageSize,
      }),
      this.prisma.scrmChat.count({ where }),
      this.groupMap(org),
    ]);
    const names = await this.scope.names(rows.map((row) => row.ownerStaffId));
    return pageOf(
      rows.map((row) =>
        this.view(
          row,
          nameOf(names, row.ownerStaffId),
          groups.get(row.groupId) || '',
        ),
      ),
      total,
      page,
      pageSize,
    );
  }

  async chat(user: CurrentUser, query: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const id = int(query.id);
    const row = await this.prisma.scrmChat.findFirst({
      where: { ...orgKey(org), id },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '客户群不存在或不属于本组织',
      );
    }
    const [members, groups, names] = await Promise.all([
      this.prisma.scrmChatMember.findMany({
        where: { ...orgKey(org), chatId: row.id },
        orderBy: [{ leaveAt: 'asc' }, { id: 'asc' }],
        take: 500,
      }),
      this.groupMap(org),
      this.scope.names([row.ownerStaffId]),
    ]);
    return {
      ...this.view(
        row,
        nameOf(names, row.ownerStaffId),
        groups.get(row.groupId) || '',
      ),
      notice: row.notice,
      members: members.map((member) => ({
        contactId: member.contactId,
        externalUserId: member.externalUserId,
        name: member.name,
        role: member.role,
        joinAt: iso(member.joinAt),
        leaveAt: iso(member.leaveAt),
      })),
    };
  }

  async chatGroups(user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const [groups, counts] = await Promise.all([
      this.prisma.scrmChatGroup.findMany({
        where: orgKey(org),
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.scrmChat.groupBy({
        by: ['groupId'],
        where: orgKey(org),
        _count: { _all: true },
      }),
    ]);
    const byId = new Map(counts.map((row) => [row.groupId, row._count._all]));
    return groups.map((group) => ({
      id: group.id,
      name: group.name,
      sort: group.sortOrder,
      chatCount: byId.get(group.id) || 0,
    }));
  }

  async saveChatGroup(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const id = int(body.id);
    const name = clip(body.name, 40).trim();
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写分组名称');
    }
    const duplicate = await this.prisma.scrmChatGroup.findFirst({
      where: { ...orgKey(org), name, ...(id ? { id: { not: id } } : {}) },
    });
    if (duplicate) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '分组名称已存在');
    }
    const row = id
      ? await this.prisma.scrmChatGroup.update({
          where: { id },
          data: { name, sortOrder: int(body.sort) },
        })
      : await this.prisma.scrmChatGroup.create({
          data: { ...orgKey(org), name, sortOrder: int(body.sort) },
        });
    return {
      id: row.id,
      name: row.name,
      sort: row.sortOrder,
      chatCount: 0,
    };
  }

  /** 批量移动群分组；分组 0 表示移出分组。 */
  async moveChats(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const chatIds = intArr(body.chatIds);
    const groupId = int(body.groupId);
    if (groupId) {
      const group = await this.prisma.scrmChatGroup.findFirst({
        where: { ...orgKey(org), id: groupId },
      });
      if (!group) {
        throw new BusinessException(ErrorCode.NOT_FOUND, '分组不存在');
      }
    }
    const result = await this.prisma.scrmChat.updateMany({
      where: { ...orgKey(org), id: { in: chatIds } },
      data: { groupId },
    });
    return { moved: result.count };
  }

  private roomPullView(row: {
    id: number;
    name: string;
    chatIds: unknown;
    welcomeId: number;
    tagIds: unknown;
    status: string;
    invited: number;
    joined: number;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      name: row.name,
      chatIds: intArr(row.chatIds),
      welcomeId: row.welcomeId,
      tagIds: intArr(row.tagIds),
      status: row.status,
      invited: row.invited,
      joined: row.joined,
      createdAt: iso(row.createdAt),
    };
  }

  async roomPulls(user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const rows = await this.prisma.scrmRoomPull.findMany({
      where: orgKey(org),
      orderBy: { id: 'desc' },
      take: 100,
    });
    return rows.map((row) => this.roomPullView(row));
  }

  async saveRoomPull(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const id = int(body.id);
    const name = clip(body.name, 60).trim();
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写拉群任务名称');
    }
    const chatIds = intArr(body.chatIds);
    if (chatIds.length) {
      const count = await this.prisma.scrmChat.count({
        where: { ...orgKey(org), id: { in: chatIds } },
      });
      if (count !== chatIds.length) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '部分客户群不存在');
      }
    }
    const data = {
      name,
      chatIds: json(chatIds),
      welcomeId: int(body.welcomeId),
      tagIds: json(intArr(body.tagIds)),
    };
    const row = id
      ? await this.prisma.scrmRoomPull.update({ where: { id }, data })
      : await this.prisma.scrmRoomPull.create({
          data: { ...orgKey(org), createdBy: user.userId, ...data },
        });
    return this.roomPullView(row);
  }

  /**
   * 执行拉群：按标签挑客户 → 1v1 邀请 → 用群成员对账统计入群数。
   * 目标群全部满员时直接拒绝，不把「已发邀请」说成「已入群」。
   */
  async runRoomPull(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const id = int(body.id);
    const pull = await this.prisma.scrmRoomPull.findFirst({
      where: { ...orgKey(org), id },
    });
    if (!pull) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '拉群任务不存在');
    }
    const { corp, secrets } = await this.scope.requireCorp(org);
    const chatIds = intArr(pull.chatIds);
    if (!chatIds.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请先选择目标客户群');
    }
    const chats = await this.prisma.scrmChat.findMany({
      where: { ...orgKey(org), id: { in: chatIds } },
    });
    const usable = chats.filter(
      (chat) => chat.status === 'ACTIVE' && chat.memberCount < chat.maxMembers,
    );
    if (!usable.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '目标客户群均已满员或已解散，请先在客户群页签补充新群',
      );
    }
    const tagIds = intArr(pull.tagIds);
    const contactWhere: Prisma.ScrmContactWhereInput = {
      ...orgKey(org),
      status: 'ACTIVE',
    };
    // 客户与标签是独立关联表，客户表上没有 tags 关系字段
    const taggedIds = await contactIdsByRelation(this.prisma, org, { tagIds });
    if (taggedIds) contactWhere.id = { in: taggedIds };
    const contacts = await this.prisma.scrmContact.findMany({
      where: contactWhere,
      select: { id: true, externalUserId: true, name: true },
      take: 1000,
    });
    if (!contacts.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '没有符合条件的客户：请先给客户打上任务里选择的标签',
      );
    }
    const [links, staffLinks, welcome] = await Promise.all([
      this.prisma.scrmContactStaff.findMany({
        where: {
          ...orgKey(org),
          contactId: { in: contacts.map((contact) => contact.id) },
        },
      }),
      this.scope.staffLinks(org),
      pull.welcomeId
        ? this.prisma.scrmWelcome.findFirst({
            where: { ...orgKey(org), id: pull.welcomeId, enabled: true },
          })
        : Promise.resolve(null),
    ]);
    const staffWecom = new Map<string, string>();
    for (const [wecomId, memberId] of staffLinks.entries()) {
      staffWecom.set(memberId, wecomId);
    }
    const material = await this.inviteLink(org, welcome?.materialIds);
    const content =
      clip(welcome?.content, 1000).trim() ||
      '你好，我们新建了专属客户群，欢迎加入获取最新资料与活动通知。';
    const byStaff = new Map<string, string[]>();
    for (const contact of contacts) {
      const owner =
        links.find(
          (link) => link.contactId === contact.id && link.relation === 'OWNER',
        ) || links.find((link) => link.contactId === contact.id);
      if (!owner) continue;
      const wecomUserId =
        owner.externalStaffId || staffWecom.get(owner.staffUserId) || '';
      if (!wecomUserId) continue;
      const list = byStaff.get(wecomUserId) || [];
      list.push(contact.externalUserId);
      byStaff.set(wecomUserId, list);
    }
    let invited = 0;
    let failed = 0;
    let lastError = '';
    for (const [wecomUserId, externalUserIds] of byStaff.entries()) {
      for (let i = 0; i < externalUserIds.length; i += 100) {
        const chunk = externalUserIds.slice(i, i + 100);
        try {
          const result = await this.client.addMsgTemplate(
            corp.corpId,
            secrets.contactSecret,
            {
              chat_type: 'single',
              external_userid: chunk,
              sender: wecomUserId,
              text: { content },
              ...(material
                ? {
                    attachments: [
                      {
                        msgtype: 'link',
                        link: {
                          title: material.title,
                          url: material.link,
                          desc: material.content.slice(0, 300),
                        },
                      },
                    ],
                  }
                : {}),
            },
          );
          invited += chunk.length - result.failList.length;
          failed += result.failList.length;
        } catch (error) {
          failed += chunk.length;
          lastError = error instanceof Error ? error.message : '企微拒绝发送';
        }
      }
    }
    const invitedContacts = contacts.filter((contact) =>
      links.some((link) => link.contactId === contact.id),
    );
    const joined = await this.prisma.scrmChatMember.count({
      where: {
        ...orgKey(org),
        chatId: { in: usable.map((chat) => chat.id) },
        contactId: { in: invitedContacts.map((contact) => contact.id) },
        leaveAt: null,
      },
    });
    await this.prisma.scrmRoomPull.update({
      where: { id: pull.id },
      data: {
        invited,
        joined,
        status: invited > 0 ? 'DONE' : 'FAILED',
        lastRunAt: new Date(),
      },
    });
    return {
      invited,
      joined,
      message:
        invited > 0
          ? `已向 ${invited} 位客户发出入群邀请${failed ? `，${failed} 位发送失败` : ''}；当前已在群 ${joined} 位`
          : `邀请未发出${lastError ? `：${lastError}` : '，请检查客户是否仍有归属员工'}`,
    };
  }

  private async inviteLink(
    org: HrmOrg,
    materialIds: unknown,
  ): Promise<{ title: string; content: string; link: string } | null> {
    const ids = intArr(materialIds);
    if (!ids.length) return null;
    const material = await this.prisma.scrmMaterial.findFirst({
      where: { ...orgKey(org), id: { in: ids }, link: { not: '' } },
      orderBy: { id: 'asc' },
    });
    if (!material) return null;
    return {
      title: material.title,
      content: material.content,
      link: material.link,
    };
  }

  async syncChat(
    org: HrmOrg,
    secrets: ScrmSecrets,
    chatId: string,
    staffLinks?: Map<string, string>,
  ): Promise<{ id: number; members: number } | null> {
    const detail = await this.client.chatDetail(
      secrets.corpId,
      secrets.contactSecret,
      chatId,
    );
    if (!detail) return null;
    return this.upsertDetail(org, detail, staffLinks);
  }

  /** 幂等写入群与成员；本次详情里没有的客户成员记退群时间，不物理删除。 */
  async upsertDetail(
    org: HrmOrg,
    detail: WecomChatDetail,
    staffLinksInput?: Map<string, string>,
  ): Promise<{ id: number; members: number }> {
    const chatIdValue = clip(detail.chat_id, 64);
    if (!chatIdValue) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '企微返回的群 ID 为空',
      );
    }
    const staffLinks = staffLinksInput || (await this.scope.staffLinks(org));
    const ownerWecomId = text(detail.owner);
    const ownerStaffId = staffLinks.get(ownerWecomId) || '';
    const memberList = Array.isArray(detail.member_list)
      ? detail.member_list
      : [];
    // type=2 是外部联系人（客户），type=1 是企业成员
    const externals = memberList.filter(
      (member) => member.type === 2 && text(member.external_userid),
    );
    const row = await this.prisma.scrmChat.upsert({
      where: {
        orgType_orgUserId_chatId: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          chatId: chatIdValue,
        },
      },
      create: {
        ...orgKey(org),
        chatId: chatIdValue,
        name: clip(detail.name, 120),
        ownerStaffId,
        memberCount: externals.length,
        status: 'ACTIVE',
        notice: text(detail.notice),
        syncedAt: new Date(),
      },
      update: {
        name: clip(detail.name, 120),
        ownerStaffId,
        memberCount: externals.length,
        status: 'ACTIVE',
        notice: text(detail.notice),
        syncedAt: new Date(),
      },
    });
    const externalIds = externals.map((member) => text(member.external_userid));
    const contacts = externalIds.length
      ? await this.prisma.scrmContact.findMany({
          where: { ...orgKey(org), externalUserId: { in: externalIds } },
          select: { id: true, externalUserId: true },
        })
      : [];
    const contactByExternal = new Map(
      contacts.map((contact) => [contact.externalUserId, contact.id]),
    );
    for (const member of externals) {
      const externalUserId = clip(member.external_userid, 64);
      if (!externalUserId) continue;
      const joinAt =
        Number(member.join_time || 0) > 0
          ? new Date(Number(member.join_time) * 1000)
          : new Date();
      const contactId = contactByExternal.get(externalUserId) || 0;
      await this.prisma.scrmChatMember.upsert({
        where: {
          chatId_externalUserId: { chatId: row.id, externalUserId },
        },
        create: {
          ...orgKey(org),
          chatId: row.id,
          contactId,
          externalUserId,
          name: clip(member.group_nickname || member.name || '', 120),
          role: 'MEMBER',
          joinAt,
        },
        update: {
          contactId,
          name: clip(member.group_nickname || member.name || '', 120),
          leaveAt: null,
        },
      });
    }
    await this.prisma.scrmChatMember.updateMany({
      where: {
        ...orgKey(org),
        chatId: row.id,
        externalUserId: { notIn: externalIds },
        leaveAt: null,
      },
      data: { leaveAt: new Date() },
    });
    return { id: row.id, members: externals.length };
  }

  async markDismissed(org: HrmOrg, chatId: string): Promise<void> {
    await this.prisma.scrmChat.updateMany({
      where: { ...orgKey(org), chatId: clip(chatId, 64) },
      data: { status: 'DISMISSED', syncedAt: new Date() },
    });
  }

  /** 群的客户成员 id 列表（SOP/群发共用）。 */
  async memberContactIds(org: HrmOrg, chatPk: number): Promise<number[]> {
    const rows = await this.prisma.scrmChatMember.findMany({
      where: {
        ...orgKey(org),
        chatId: chatPk,
        leaveAt: null,
        contactId: { gt: 0 },
      },
      select: { contactId: true },
    });
    return [...new Set(rows.map((row) => row.contactId))];
  }

  /** 群发按本地群 id 找企微 chatId。 */
  async wecomChatIds(org: HrmOrg, chatPks: number[]): Promise<string[]> {
    if (!chatPks.length) return [];
    const rows = await this.prisma.scrmChat.findMany({
      where: { ...orgKey(org), id: { in: chatPks } },
      select: { chatId: true },
    });
    return rows.map((row) => row.chatId).filter(Boolean);
  }

  /** 内部：群数量与成员数（概览）。 */
  async counts(org: HrmOrg) {
    const [chats, members] = await Promise.all([
      this.prisma.scrmChat.count({
        where: { ...orgKey(org), status: 'ACTIVE' },
      }),
      this.prisma.scrmChatMember.count({
        where: { ...orgKey(org), leaveAt: null },
      }),
    ]);
    return { chats, members };
  }
}
