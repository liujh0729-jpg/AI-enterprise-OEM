import type { CurrentUser } from '../auth/current-user';
import { clip, iso } from '../hrm/hrm.helpers';
import type { HrmOrg } from '../hrm/hrm.scope';
import type { PrismaService } from '../prisma/prisma.service';
import { ScrmClient } from './scrm.client';
import { ScrmScopeService, type ScrmSecrets } from './scrm.scope';
import { ScrmContactService } from './scrm-contact.service';
import { ScrmChatService } from './scrm-chat.service';
import { ScrmSopService } from './scrm-sop.service';
import {
  addTimeline,
  bumpStatDaily,
  intArr,
  orgKey,
  secondsOr,
  strArr,
  text,
} from './scrm.helpers';

/**
 * 全量/增量同步：企微是客户/标签/群唯一源，本地只做镜像。
 *
 * - 标签：全量对齐，企微已删除的标签/标签组软删（保留客户打标历史）；
 * - 客户：按有「客户联系」权限的成员分页拉取，幂等 upsert；本次未见到的客户
 *   只断掉本次参与同步的员工关系，没有归属才转 LOST，不物理删除；
 * - 客户群：列表 + 详情，成员退群记时间；群满由拉群任务自行换群。
 */

type SyncScope = 'ALL' | 'CONTACTS' | 'TAGS' | 'CHATS';

const CONTACT_STAFF_CHUNK = 100;
const MAX_CHATS_PER_SYNC = 500;

export type ScrmSyncResult = {
  contacts: number;
  tags: number;
  chats: number;
  lost: number;
  message: string;
};

export class ScrmSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScrmScopeService,
    private readonly client: ScrmClient,
    private readonly contacts: ScrmContactService,
    private readonly chats: ScrmChatService,
    private readonly sops: ScrmSopService,
  ) {}

  async sync(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const { corp, secrets } = await this.scope.requireCorp(org);
    const raw = text(body.scope).toUpperCase();
    const scope: SyncScope = ['CONTACTS', 'TAGS', 'CHATS'].includes(raw)
      ? (raw as SyncScope)
      : 'ALL';
    return this.syncFor(org, corp.id, secrets, scope);
  }

  async syncTags(user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const { secrets } = await this.scope.requireCorp(org);
    return this.syncTagsFor(org, secrets);
  }

  /** 按范围执行；回调与定时任务复用同一入口（后台操作以组织键为准）。 */
  async syncFor(
    org: HrmOrg,
    corpId: number,
    secrets: ScrmSecrets,
    scope: SyncScope = 'ALL',
  ): Promise<ScrmSyncResult> {
    let tags = 0;
    let contacts = 0;
    let lost = 0;
    let chats = 0;
    const notes: string[] = [];
    if (scope === 'ALL' || scope === 'TAGS') {
      const result = await this.syncTagsFor(org, secrets);
      tags = result.tags;
    }
    if (scope === 'ALL' || scope === 'CONTACTS') {
      const result = await this.syncContactsFor(org, secrets);
      contacts = result.created;
      lost = result.lost;
      if (result.truncated)
        notes.push('客户数超过单次上限，未同步部分请再点一次同步');
    }
    if (scope === 'ALL' || scope === 'CHATS') {
      const result = await this.syncChatsFor(org, secrets);
      chats = result.chats;
      if (result.truncated)
        notes.push('客户群数超过单次上限，未同步部分请再点一次同步');
    }
    if (scope === 'ALL' || scope === 'CONTACTS') {
      const tagRows = await this.prisma.scrmTag.findMany({
        where: orgKey(org),
        select: { id: true },
      });
      await this.contacts.refreshTagUsage(
        org,
        tagRows.map((row) => row.id),
      );
    }
    if (contacts || lost) {
      await bumpStatDaily(this.prisma, org, { added: contacts, lost });
    }
    const message =
      `同步完成：客户 +${contacts}、流失 ${lost}、标签 ${tags}、客户群 ${chats}` +
      (notes.length ? `；${notes.join('；')}` : '');
    await this.prisma.scrmCorp.update({
      where: { id: corpId },
      data: {
        lastSyncAt: new Date(),
        lastSyncResult: clip(message, 500),
        status: 'ACTIVE',
      },
    });
    return { contacts, tags, chats, lost, message };
  }

  /** 标签组/标签全量对齐：未在本次结果里的企微标签软删。 */
  async syncTagsFor(
    org: HrmOrg,
    secrets: ScrmSecrets,
  ): Promise<{ groups: number; tags: number }> {
    const groups = await this.client.tagGroups(
      secrets.corpId,
      secrets.contactSecret,
    );
    const seenGroups = new Set<string>();
    const seenTags = new Set<string>();
    let tagCount = 0;
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      const externalGroupId = clip(group.group_id, 64);
      if (!externalGroupId) continue;
      seenGroups.add(externalGroupId);
      const groupRow = await this.prisma.scrmTagGroup.upsert({
        where: {
          orgType_orgUserId_externalId: {
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            externalId: externalGroupId,
          },
        },
        create: {
          ...orgKey(org),
          externalId: externalGroupId,
          name: clip(group.group_name || '未命名分组', 60),
          sortOrder: Number(group.order ?? index) || index,
        },
        update: {
          name: clip(group.group_name || '未命名分组', 60),
          sortOrder: Number(group.order ?? index) || index,
          deleted: false,
        },
      });
      const tags = Array.isArray(group.tag) ? group.tag : [];
      for (let tagIndex = 0; tagIndex < tags.length; tagIndex += 1) {
        const tag = tags[tagIndex];
        const externalTagId = clip(tag.id, 64);
        if (!externalTagId) continue;
        seenTags.add(externalTagId);
        await this.prisma.scrmTag.upsert({
          where: {
            orgType_orgUserId_externalId: {
              orgType: org.orgType,
              orgUserId: org.orgUserId,
              externalId: externalTagId,
            },
          },
          create: {
            ...orgKey(org),
            groupId: groupRow.id,
            externalId: externalTagId,
            name: clip(tag.name || '未命名标签', 60),
            source: 'WECOM',
            sortOrder: Number(tag.order ?? tagIndex) || tagIndex,
          },
          update: {
            groupId: groupRow.id,
            name: clip(tag.name || '未命名标签', 60),
            sortOrder: Number(tag.order ?? tagIndex) || tagIndex,
            deleted: false,
          },
        });
        tagCount += 1;
      }
    }
    if (seenGroups.size) {
      await this.prisma.scrmTagGroup.updateMany({
        where: {
          ...orgKey(org),
          deleted: false,
          externalId: { notIn: [...seenGroups] },
        },
        data: { deleted: true },
      });
      await this.prisma.scrmTag.updateMany({
        where: {
          ...orgKey(org),
          deleted: false,
          source: 'WECOM',
          externalId: { notIn: [...seenTags] },
        },
        data: { deleted: true },
      });
    }
    return { groups: seenGroups.size, tags: tagCount };
  }

  /**
   * 客户全量：按 follow_user 分页。返回新增数与流失数。
   * 企微没有「全量客户」接口，只能按有客户联系权限的成员拉取，这是官方口径。
   */
  async syncContactsFor(
    org: HrmOrg,
    secrets: ScrmSecrets,
  ): Promise<{ created: number; lost: number; truncated: boolean }> {
    const followUsers = await this.client.followUsers(
      secrets.corpId,
      secrets.contactSecret,
    );
    const staffLinks = await this.scope.staffLinks(org);
    const syncedMemberIds = new Set(
      followUsers.map((id) => staffLinks.get(id) || '').filter(Boolean),
    );
    if (!followUsers.length) {
      return { created: 0, lost: 0, truncated: false };
    }
    const tagRows = await this.prisma.scrmTag.findMany({
      where: { ...orgKey(org), deleted: false, externalId: { not: '' } },
      select: { id: true, externalId: true },
    });
    const tagByExternal = new Map(
      tagRows.map((tag) => [tag.externalId, tag.id]),
    );
    const seen = new Set<string>();
    let created = 0;
    let truncated = false;
    for (
      let start = 0;
      start < followUsers.length;
      start += CONTACT_STAFF_CHUNK
    ) {
      const chunk = followUsers.slice(start, start + CONTACT_STAFF_CHUNK);
      let cursor = '';
      do {
        const page = await this.client.batchContacts(
          secrets.corpId,
          secrets.contactSecret,
          chunk,
          cursor,
          100,
        );
        for (const item of page.list) {
          const externalUserId = clip(
            item.external_contact?.external_userid,
            64,
          );
          if (!externalUserId) continue;
          seen.add(externalUserId);
          const follow = item.follow_info || {};
          const wecomStaffId = text(follow.userid);
          const staffUserId = staffLinks.get(wecomStaffId) || '';
          const addedAt =
            secondsOr(follow.createtimestamp ?? follow.createtime) ||
            new Date();
          const result = await this.contacts.upsertFromWecom(org, {
            externalUserId,
            name: text(item.external_contact?.name),
            avatar: text(item.external_contact?.avatar),
            gender: Number(item.external_contact?.gender ?? 0),
            unionId: text(item.external_contact?.unionid),
            remark: text(follow.remark),
            description: text(follow.description),
            staffUserId,
            externalStaffId: wecomStaffId,
            addedAt,
          });
          if (result.created) created += 1;
          const localTagIds = strArr(follow.tag_id)
            .map((id) => tagByExternal.get(id) || 0)
            .filter(Boolean);
          await this.prisma.scrmContactTag.deleteMany({
            where: {
              ...orgKey(org),
              contactId: result.contactId,
              source: 'WECOM',
              tagId: { notIn: localTagIds },
            },
          });
          if (localTagIds.length) {
            await this.prisma.scrmContactTag.createMany({
              data: localTagIds.map((tagId) => ({
                ...orgKey(org),
                contactId: result.contactId,
                tagId,
                source: 'WECOM',
              })),
              skipDuplicates: true,
            });
          }
        }
        cursor = page.nextCursor;
      } while (cursor);
      if (seen.size >= 20_000) {
        truncated = start + CONTACT_STAFF_CHUNK < followUsers.length;
        break;
      }
    }
    const lost = await this.reconcileLost(org, seen, syncedMemberIds);
    return { created, lost, truncated };
  }

  /** 对账：本次同步覆盖到的员工名下、企微已不存在的客户关系断掉，无归属才流失。 */
  private async reconcileLost(
    org: HrmOrg,
    seen: Set<string>,
    syncedMemberIds: Set<string>,
  ): Promise<number> {
    if (!syncedMemberIds.size) return 0;
    const locals = await this.prisma.scrmContact.findMany({
      where: { ...orgKey(org), status: 'ACTIVE' },
      select: { id: true, externalUserId: true },
    });
    const stale = locals.filter((contact) => !seen.has(contact.externalUserId));
    let lost = 0;
    for (let start = 0; start < stale.length; start += 500) {
      const chunk = stale.slice(start, start + 500);
      const ids = chunk.map((contact) => contact.id);
      const removed = await this.prisma.scrmContactStaff.deleteMany({
        where: {
          ...orgKey(org),
          contactId: { in: ids },
          staffUserId: { in: [...syncedMemberIds] },
        },
      });
      if (!removed.count) continue;
      for (const contact of chunk) {
        const remaining = await this.prisma.scrmContactStaff.count({
          where: { ...orgKey(org), contactId: contact.id },
        });
        if (remaining > 0) continue;
        await this.prisma.scrmContact.update({
          where: { id: contact.id },
          data: {
            status: 'LOST',
            lostAt: new Date(),
            lostReason: '企微已无客户关系',
          },
        });
        await addTimeline(
          this.prisma,
          org,
          contact.id,
          'LOST',
          '客户流失',
          '企微对账：客户与所有员工均已解除关系',
        );
        lost += 1;
      }
    }
    return lost;
  }

  /** 客户群：列表 + 详情；单次上限防止把接口拖死。 */
  async syncChatsFor(
    org: HrmOrg,
    secrets: ScrmSecrets,
  ): Promise<{ chats: number; truncated: boolean }> {
    const staffLinks = await this.scope.staffLinks(org);
    let cursor = '';
    let synced = 0;
    let truncated = false;
    do {
      const page = await this.client.chatList(
        secrets.corpId,
        secrets.contactSecret,
        cursor,
        100,
      );
      for (const summary of page.list) {
        const chatId = clip(summary.chat_id, 64);
        if (!chatId) continue;
        if (synced >= MAX_CHATS_PER_SYNC) {
          truncated = true;
          break;
        }
        try {
          await this.chats.syncChat(org, secrets, chatId, staffLinks);
          synced += 1;
        } catch {
          // 单个群拉详情失败不影响整批；下次同步再对账
        }
      }
      if (truncated) break;
      cursor = page.nextCursor;
    } while (cursor);
    return { chats: synced, truncated };
  }

  // ---------- 回调事件（已验签） ----------

  /** 回调事件分发：客户增删、群变更、标签变更；其他事件忽略。 */
  async handleEvent(
    org: HrmOrg,
    secrets: ScrmSecrets,
    event: Record<string, string>,
  ): Promise<string> {
    const name = text(event.Event);
    if (name === 'change_external_contact') {
      return this.handleContactEvent(org, secrets, event);
    }
    if (name === 'change_external_chat') {
      return this.handleChatEvent(org, secrets, event);
    }
    if (name === 'change_external_tag') {
      const result = await this.syncTagsFor(org, secrets);
      return `标签同步 ${result.tags}`;
    }
    return '';
  }

  private async handleContactEvent(
    org: HrmOrg,
    secrets: ScrmSecrets,
    event: Record<string, string>,
  ): Promise<string> {
    const changeType = text(event.ChangeType);
    const externalUserId = clip(event.ExternalUserID, 64);
    if (!externalUserId) return '';
    const staffLinks = await this.scope.staffLinks(org);
    const staffUserId = staffLinks.get(text(event.UserID)) || '';
    if (
      changeType === 'del_external_contact' ||
      changeType === 'del_follow_user'
    ) {
      if (!staffUserId) return '';
      const reason =
        changeType === 'del_external_contact' ? '客户删除员工' : '员工删除客户';
      await this.contacts.markDeletedByStaff(
        org,
        externalUserId,
        staffUserId,
        reason,
      );
      const contact = await this.contacts.findByExternal(org, externalUserId);
      if (contact?.status === 'LOST') {
        await bumpStatDaily(this.prisma, org, { lost: 1 });
        await this.touchCorp(org, `客户流失：${reason}`);
      }
      return reason;
    }
    if (
      changeType !== 'add_external_contact' &&
      changeType !== 'add_half_external_contact' &&
      changeType !== 'edit_external_contact'
    ) {
      return '';
    }
    const detail = await this.client.contactDetail(
      secrets.corpId,
      secrets.contactSecret,
      externalUserId,
    );
    if (!detail.contact) return '';
    const state = clip(event.State, 40);
    const code = state
      ? await this.prisma.scrmCode.findFirst({
          where: { ...orgKey(org), scene: state, status: 'ACTIVE' },
        })
      : null;
    let createdCount = 0;
    for (const follow of detail.follows) {
      const wecomStaffId = text(follow.userid);
      const member = staffLinks.get(wecomStaffId) || staffUserId;
      const addedAt = secondsOr(follow.createtimestamp ?? follow.createtime);
      const result = await this.contacts.upsertFromWecom(org, {
        externalUserId,
        name: text(detail.contact.name),
        avatar: text(detail.contact.avatar),
        gender: Number(detail.contact.gender ?? 0),
        unionId: text(detail.contact.unionid),
        remark: text(follow.remark),
        description: text(follow.description),
        staffUserId: member,
        externalStaffId: wecomStaffId,
        addedAt: addedAt || undefined,
        lastInteractionAt: new Date(),
        codeId: code?.id,
        codeName: code?.name,
      });
      if (result.created) {
        createdCount += 1;
        // 加好友是 SOP 的第一类触发源：新客户落库后立即匹配 JOIN 规则
        await this.sops.triggerJoin(org, result.contactId, member);
      }
      if (code) {
        const tagIds = intArr(code.tagIds);
        if (tagIds.length) {
          await this.prisma.scrmContactTag.createMany({
            data: tagIds.map((tagId) => ({
              ...orgKey(org),
              contactId: result.contactId,
              tagId,
              source: 'AUTO',
            })),
            skipDuplicates: true,
          });
          await this.sops.triggerTag(org, result.contactId, tagIds, member);
        }
      }
    }
    if (createdCount) {
      await bumpStatDaily(this.prisma, org, { added: createdCount });
    }
    if (code) {
      await this.prisma.scrmCode.update({
        where: { id: code.id },
        data: { added: { increment: 1 }, scanned: { increment: 1 } },
      });
    }
    await this.touchCorp(
      org,
      createdCount
        ? `回调新增客户 ${createdCount}`
        : `回调更新客户 ${iso(new Date())}`,
    );
    return createdCount ? `新增客户 ${createdCount}` : '更新客户资料';
  }

  private async handleChatEvent(
    org: HrmOrg,
    secrets: ScrmSecrets,
    event: Record<string, string>,
  ): Promise<string> {
    const chatId = clip(event.ChatId, 64);
    if (!chatId) return '';
    const update = text(event.UpdateDetail) || text(event.ChangeType);
    if (update === 'dismiss') {
      await this.chats.markDismissed(org, chatId);
      await this.touchCorp(org, '客户群解散');
      return '客户群解散';
    }
    const staffLinks = await this.scope.staffLinks(org);
    try {
      await this.chats.syncChat(org, secrets, chatId, staffLinks);
    } catch {
      return '';
    }
    await this.touchCorp(org, `客户群变更：${update || '成员变动'}`);
    return '客户群已同步';
  }

  /** 回调只记最近结果，不改 lastSyncAt（避免把「收到一条事件」显示成「全量同步」）。 */
  private async touchCorp(org: HrmOrg, message: string): Promise<void> {
    await this.prisma.scrmCorp.updateMany({
      where: orgKey(org),
      data: { lastSyncResult: clip(message, 500) },
    });
  }
}
