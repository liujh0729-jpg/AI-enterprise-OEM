import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { pageOf } from '../common/api';
import type { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma';
import type { HrmOrg } from '../hrm/hrm.scope';
import { clip, iso } from '../hrm/hrm.helpers';
import { ScrmScopeService } from './scrm.scope';
import { ScrmClient } from './scrm.client';
import { ScrmSopService } from './scrm-sop.service';
import {
  addTimeline,
  contactIdsByRelation,
  dateOr,
  int,
  intArr,
  json,
  nameOf,
  orgKey,
  safePage,
  strArr,
  text,
} from './scrm.helpers';

/** 资料卡内置字段（全部做好：9 类字段类型 + 3 套示例模板由前端一键套用）。 */
export const SCRM_BUILTIN_FIELDS = [
  {
    key: 'company',
    label: '公司名称',
    type: 'TEXT',
    options: [],
    required: false,
    sort: 10,
    description: '客户所在企业；B2B 场景必填建议开启',
  },
  {
    key: 'title',
    label: '职位',
    type: 'TEXT',
    options: [],
    required: false,
    sort: 20,
    description: '客户在公司的职位',
  },
  {
    key: 'industry',
    label: '所属行业',
    type: 'SELECT',
    options: [
      '制造业',
      '零售电商',
      '教育培训',
      '医疗健康',
      '金融',
      '互联网',
      '其他',
    ],
    required: false,
    sort: 30,
    description: '用于分群与群发筛选',
  },
  {
    key: 'phone',
    label: '手机号',
    type: 'PHONE',
    options: [],
    required: false,
    sort: 40,
    description: '按权限脱敏展示',
  },
  {
    key: 'email',
    label: '邮箱',
    type: 'EMAIL',
    options: [],
    required: false,
    sort: 50,
    description: '',
  },
  {
    key: 'birthday',
    label: '生日',
    type: 'BIRTHDAY',
    options: [],
    required: false,
    sort: 60,
    description: '用于生日关怀 SOP',
  },
  {
    key: 'needs',
    label: '需求标签',
    type: 'MULTI',
    options: ['了解产品', '询价', '售后', '合作', '其他'],
    required: false,
    sort: 70,
    description: '可多选',
  },
  {
    key: 'level',
    label: '客户等级',
    type: 'SELECT',
    options: ['A 重点', 'B 普通', 'C 观察'],
    required: false,
    sort: 80,
    description: '',
  },
  {
    key: 'source_note',
    label: '来源备注',
    type: 'TEXT',
    options: [],
    required: false,
    sort: 90,
    description: '渠道/活动来源的自由备注',
  },
] as const;

type ContactRow = {
  id: number;
  externalUserId: string;
  name: string;
  avatar: string;
  gender: string;
  region: string;
  remark: string;
  description: string;
  status: string;
  sourceCodeId: number;
  sourceCodeName: string;
  addedAt: Date | null;
  lostAt: Date | null;
  lostReason: string;
  lastInteractionAt: Date | null;
  crmLeadId: number;
  crmCustomerId: number;
};

export class ScrmContactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScrmScopeService,
    private readonly client: ScrmClient,
    private readonly sops: ScrmSopService,
  ) {}

  private async ensureFields(org: HrmOrg): Promise<void> {
    const count = await this.prisma.scrmContactField.count({
      where: orgKey(org),
    });
    if (count) return;
    await this.prisma.scrmContactField.createMany({
      data: SCRM_BUILTIN_FIELDS.map((field) => ({
        ...orgKey(org),
        key: field.key,
        label: field.label,
        type: field.type,
        options: json(field.options),
        required: field.required,
        sortOrder: field.sort,
        builtin: true,
        description: field.description,
      })),
    });
  }

  private async tagMap(
    org: HrmOrg,
    contactIds: number[],
  ): Promise<
    Map<number, { id: number; name: string; color: string; source: string }[]>
  > {
    const out = new Map<
      number,
      { id: number; name: string; color: string; source: string }[]
    >();
    if (!contactIds.length) return out;
    const rows = await this.prisma.scrmContactTag.findMany({
      where: { ...orgKey(org), contactId: { in: contactIds } },
    });
    const tagIds = [...new Set(rows.map((row) => row.tagId))];
    const tags = tagIds.length
      ? await this.prisma.scrmTag.findMany({
          where: { ...orgKey(org), id: { in: tagIds }, deleted: false },
        })
      : [];
    const byId = new Map(tags.map((tag) => [tag.id, tag]));
    for (const row of rows) {
      const tag = byId.get(row.tagId);
      if (!tag) continue;
      const list = out.get(row.contactId) || [];
      list.push({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        source: row.source || tag.source,
      });
      out.set(row.contactId, list);
    }
    return out;
  }

  private async staffMap(
    org: HrmOrg,
    contactIds: number[],
    names: Map<string, string>,
  ): Promise<Map<number, { userId: string; name: string }[]>> {
    const out = new Map<number, { userId: string; name: string }[]>();
    if (!contactIds.length) return out;
    const rows = await this.prisma.scrmContactStaff.findMany({
      where: { ...orgKey(org), contactId: { in: contactIds } },
      orderBy: { id: 'asc' },
    });
    for (const row of rows) {
      const list = out.get(row.contactId) || [];
      list.push({
        userId: row.staffUserId,
        name: nameOf(names, row.staffUserId),
      });
      out.set(row.contactId, list);
    }
    return out;
  }

  private async chatCountMap(
    org: HrmOrg,
    contactIds: number[],
  ): Promise<Map<number, number>> {
    if (!contactIds.length) return new Map();
    const rows = await this.prisma.scrmChatMember.groupBy({
      by: ['contactId'],
      where: {
        ...orgKey(org),
        contactId: { in: contactIds },
        leaveAt: null,
      },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.contactId, row._count._all]));
  }

  private view(
    row: ContactRow,
    staff: { userId: string; name: string }[],
    tags: { id: number; name: string; color: string; source: string }[],
    chatCount: number,
  ) {
    return {
      id: row.id,
      externalUserId: row.externalUserId,
      name: row.name,
      avatar: row.avatar,
      gender: row.gender,
      region: row.region,
      remark: row.remark,
      description: row.description,
      status: row.status,
      sourceCodeId: row.sourceCodeId,
      sourceCodeName: row.sourceCodeName,
      addedAt: iso(row.addedAt),
      lostAt: iso(row.lostAt),
      lostReason: row.lostReason,
      lastInteractionAt: iso(row.lastInteractionAt),
      crmLeadId: row.crmLeadId,
      crmCustomerId: row.crmCustomerId,
      staff,
      tags,
      chatCount,
    };
  }

  async list(user: CurrentUser, query: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const { page, pageSize, offset } = safePage(query.page, query.pageSize, 20);
    const where: Prisma.ScrmContactWhereInput = { ...orgKey(org) };
    const keyword = clip(query.keyword, 100).trim();
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { remark: { contains: keyword } },
        { region: { contains: keyword } },
      ];
    }
    const status = text(query.status).trim();
    if (status) where.status = status;
    const related = await contactIdsByRelation(this.prisma, org, {
      staffUserIds: query.staffUserId ? [text(query.staffUserId)] : [],
      tagIds: query.tagId ? [int(query.tagId)] : [],
    });
    if (related) where.id = { in: related };
    if (query.codeId) where.sourceCodeId = int(query.codeId);
    if (query.crmCustomerId) where.crmCustomerId = int(query.crmCustomerId);
    const from = dateOr(query.from);
    const to = dateOr(query.to);
    if (from || to) {
      where.addedAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: new Date(to.getTime() + 86_400_000 - 1) } : {}),
      };
    }
    const [rows, total] = await Promise.all([
      this.prisma.scrmContact.findMany({
        where,
        orderBy: [{ lastInteractionAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: pageSize,
      }),
      this.prisma.scrmContact.count({ where }),
    ]);
    const ids = rows.map((row) => row.id);
    const staffIds = rows.flatMap((row) => [row.externalUserId]);
    void staffIds;
    const [tags, names] = await Promise.all([
      this.tagMap(org, ids),
      // 归属员工名：先取关系再批量查名
      this.prisma.scrmContactStaff
        .findMany({
          where: { ...orgKey(org), contactId: { in: ids } },
          select: { staffUserId: true },
        })
        .then(async (links) =>
          this.scope.names(links.map((link) => link.staffUserId)),
        ),
    ]);
    const staff = await this.staffMap(org, ids, names);
    const chats = await this.chatCountMap(org, ids);
    return pageOf(
      rows.map((row) =>
        this.view(
          row,
          staff.get(row.id) || [],
          tags.get(row.id) || [],
          chats.get(row.id) || 0,
        ),
      ),
      total,
      page,
      pageSize,
    );
  }

  async contact(user: CurrentUser, query: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    return this.detailFor(org, int(query.id));
  }

  /** 侧边栏：确认该员工确实是此客户的好友，否则不返回任何客户资料。 */
  async staffLink(org: HrmOrg, contactId: number, staffUserId: string) {
    if (!contactId || !staffUserId) return null;
    return this.prisma.scrmContactStaff.findFirst({
      where: { ...orgKey(org), contactId, staffUserId },
    });
  }

  /** 客户 360 详情：管理页与员工侧边栏共用同一份视图。 */
  async detailFor(org: HrmOrg, id: number) {
    const row = await this.prisma.scrmContact.findFirst({
      where: { ...orgKey(org), id },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '客户不存在或不属于本组织',
      );
    }
    const [links, tagRows, fieldRows, fieldDefs, timeline, chatMembers, names] =
      await Promise.all([
        this.prisma.scrmContactStaff.findMany({
          where: { ...orgKey(org), contactId: id },
          orderBy: { id: 'asc' },
        }),
        this.tagMap(org, [id]),
        this.prisma.scrmContactFieldValue.findMany({
          where: { ...orgKey(org), contactId: id },
        }),
        this.prisma.scrmContactField.findMany({
          where: orgKey(org),
        }),
        this.prisma.scrmTimelineEvent.findMany({
          where: { ...orgKey(org), contactId: id },
          orderBy: { at: 'desc' },
          take: 100,
        }),
        this.prisma.scrmChatMember.findMany({
          where: { ...orgKey(org), contactId: id, leaveAt: null },
          orderBy: { id: 'desc' },
          take: 50,
        }),
        this.scope.names(
          (
            await this.prisma.scrmContactStaff.findMany({
              where: { ...orgKey(org), contactId: id },
              select: { staffUserId: true },
            })
          ).map((link) => link.staffUserId),
        ),
      ]);
    const chatIds = [...new Set(chatMembers.map((member) => member.chatId))];
    const chats = chatIds.length
      ? await this.prisma.scrmChat.findMany({
          where: { ...orgKey(org), id: { in: chatIds } },
        })
      : [];
    const ownerNames = await this.scope.names(
      chats.map((chat) => chat.ownerStaffId),
    );
    const fieldByKey = new Map(fieldDefs.map((field) => [field.key, field]));
    const fieldValues = fieldRows.map((field) => {
      const def = fieldByKey.get(field.fieldKey);
      return {
        fieldKey: field.fieldKey,
        label: def?.label || field.fieldKey,
        type: def?.type || 'TEXT',
        value: Array.isArray(field.value)
          ? field.value.map(String)
          : text(field.value),
      };
    });
    return {
      ...this.view(
        row,
        links.map((link) => ({
          userId: link.staffUserId,
          name: nameOf(names, link.staffUserId),
        })),
        tagRows.get(id) || [],
        chatMembers.length,
      ),
      fields: fieldValues,
      chats: chats.map((chat) => ({
        id: chat.id,
        chatId: chat.chatId,
        name: chat.name,
        ownerStaffName: nameOf(ownerNames, chat.ownerStaffId),
        memberCount: chat.memberCount,
      })),
      timeline: timeline.map((event) => ({
        id: event.id,
        kind: event.kind,
        title: event.title,
        detail: event.detail,
        at: iso(event.at),
      })),
    };
  }

  /** 只有管理员或该客户的归属员工能改资料；其他组织成员只读。 */
  private async assertEditable(org: HrmOrg, contactId: number) {
    const contact = await this.prisma.scrmContact.findFirst({
      where: { ...orgKey(org), id: contactId },
    });
    if (!contact) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '客户不存在或不属于本组织',
      );
    }
    if (org.isAdmin) return contact;
    const link = await this.prisma.scrmContactStaff.findFirst({
      where: { ...orgKey(org), contactId, staffUserId: org.actorId },
    });
    if (!link) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '只有客户归属员工或管理员可以修改该客户资料',
      );
    }
    return contact;
  }

  async updateContact(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const id = int(body.id);
    const contact = await this.assertEditable(org, id);
    const data: Record<string, unknown> = {};
    if (body.remark !== undefined) data.remark = clip(body.remark, 200);
    if (body.description !== undefined) {
      data.description = clip(body.description, 1000);
    }
    if (!Object.keys(data).length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有需要保存的字段');
    }
    const updated = await this.prisma.scrmContact.update({
      where: { id: contact.id },
      data,
    });
    if (body.remark !== undefined) {
      await addTimeline(
        this.prisma,
        org,
        contact.id,
        'NOTE',
        '更新备注',
        clip(body.remark, 200),
      );
    }
    const [links, tags, chats] = await Promise.all([
      this.prisma.scrmContactStaff.findMany({
        where: { ...orgKey(org), contactId: contact.id },
      }),
      this.tagMap(org, [contact.id]),
      this.chatCountMap(org, [contact.id]),
    ]);
    const names = await this.scope.names(links.map((link) => link.staffUserId));
    return this.view(
      updated,
      links.map((link) => ({
        userId: link.staffUserId,
        name: nameOf(names, link.staffUserId),
      })),
      tags.get(contact.id) || [],
      chats.get(contact.id) || 0,
    );
  }

  /** 提升到 CRM：幂等（已有 crmLeadId 直接返回），线索归属客户的第一位员工。 */
  async promoteContact(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const id = int(body.id);
    const contact = await this.assertEditable(org, id);
    if (contact.crmLeadId > 0) {
      return { contactId: contact.id, crmLeadId: contact.crmLeadId };
    }
    const owner = await this.prisma.scrmContactStaff.findFirst({
      where: { ...orgKey(org), contactId: id },
      orderBy: { id: 'asc' },
    });
    const fields = await this.prisma.scrmContactFieldValue.findMany({
      where: { ...orgKey(org), contactId: id },
    });
    const valueOf = (key: string): string => {
      const row = fields.find((field) => field.fieldKey === key);
      if (!row) return '';
      const raw = row.value;
      return Array.isArray(raw) ? raw.map(String).join(',') : text(raw);
    };
    const lead = await this.prisma.crmLead.create({
      data: {
        ownerUserId: org.orgUserId,
        orgType: org.orgType,
        name: clip(
          contact.name || contact.remark || contact.externalUserId,
          120,
        ),
        contactName: clip(contact.name, 60),
        phone: clip(valueOf('phone'), 40),
        phoneNorm: clip(valueOf('phone').replace(/\D/g, ''), 40),
        email: clip(valueOf('email'), 120),
        emailNorm: clip(valueOf('email').toLowerCase(), 160),
        source: '企业微信',
        stage: 'NEW',
        ownerId: owner?.staffUserId || org.actorId,
        remark: clip(
          [contact.description, contact.region ? `地区：${contact.region}` : '']
            .filter(Boolean)
            .join('\n'),
          4000,
        ),
        custom: json({
          scrmContactId: contact.id,
          externalUserId: contact.externalUserId,
          company: valueOf('company'),
          title: valueOf('title'),
          industry: valueOf('industry'),
          level: valueOf('level'),
        }),
      },
    });
    await this.prisma.scrmContact.update({
      where: { id: contact.id },
      data: { crmLeadId: lead.id },
    });
    await addTimeline(
      this.prisma,
      org,
      contact.id,
      'NOTE',
      '提升为 CRM 线索',
      `线索 #${lead.id}`,
    );
    return { contactId: contact.id, crmLeadId: lead.id };
  }

  /** 分配归属（组织内转交，不动企微）：管理员指定在册成员。 */
  async assignContact(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const id = int(body.id);
    const staffUserId = await this.scope.requireMember(
      org,
      text(body.staffUserId),
    );
    const contact = await this.prisma.scrmContact.findFirst({
      where: { ...orgKey(org), id },
    });
    if (!contact) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '客户不存在或不属于本组织',
      );
    }
    await this.prisma.$transaction([
      this.prisma.scrmContactStaff.deleteMany({
        where: { ...orgKey(org), contactId: id, relation: 'OWNER' },
      }),
      this.prisma.scrmContactStaff.create({
        data: {
          ...orgKey(org),
          contactId: id,
          staffUserId,
          relation: 'OWNER',
          addedAt: new Date(),
        },
      }),
    ]);
    await addTimeline(
      this.prisma,
      org,
      id,
      'TRANSFER',
      '变更归属员工',
      `新归属：${staffUserId}`,
    );
    return { contactId: id, staffUserId };
  }

  async refreshTagUsage(org: HrmOrg, tagIds: number[]): Promise<void> {
    if (!tagIds.length) return;
    const rows = await this.prisma.scrmContactTag.groupBy({
      by: ['tagId'],
      where: { ...orgKey(org), tagId: { in: tagIds } },
      _count: { _all: true },
    });
    const counts = new Map(rows.map((row) => [row.tagId, row._count._all]));
    await Promise.all(
      tagIds.map((tagId) =>
        this.prisma.scrmTag.updateMany({
          where: { ...orgKey(org), id: tagId },
          data: { usageCount: counts.get(tagId) || 0 },
        }),
      ),
    );
  }

  /** 标签改动：本地先落库，再尽量同步到企微（无凭据/无归属员工时只落本地）。 */
  private async applyTags(
    org: HrmOrg,
    contactIds: number[],
    addTagIds: number[],
    removeTagIds: number[],
  ): Promise<{ updated: number; failed: number }> {
    let updated = 0;
    let failed = 0;
    const corp = await this.scope.corp(org);
    const secrets = corp?.contactSecretEnc ? this.scope.secretsOf(corp) : null;
    const links = await this.prisma.scrmContactStaff.findMany({
      where: { ...orgKey(org), contactId: { in: contactIds } },
    });
    const staffLinks = await this.scope.staffLinks(org);
    const tagRows = await this.prisma.scrmTag.findMany({
      where: { ...orgKey(org), id: { in: [...addTagIds, ...removeTagIds] } },
    });
    const tagById = new Map(tagRows.map((tag) => [tag.id, tag]));
    for (const contactId of contactIds) {
      try {
        const owner = links.find(
          (link) => link.contactId === contactId && link.relation === 'OWNER',
        );
        if (removeTagIds.length) {
          await this.prisma.scrmContactTag.deleteMany({
            where: {
              ...orgKey(org),
              contactId,
              tagId: { in: removeTagIds },
            },
          });
        }
        if (addTagIds.length) {
          await this.prisma.scrmContactTag.createMany({
            data: addTagIds.map((tagId) => ({
              ...orgKey(org),
              contactId,
              tagId,
              source: 'MANUAL',
            })),
            skipDuplicates: true,
          });
          // 手工打标同样是 SOP 的触发源；SOP 自身失败不影响本次打标结果
          try {
            await this.sops.triggerTag(
              org,
              contactId,
              addTagIds,
              owner?.staffUserId || '',
            );
          } catch {
            // 触发失败只跳过，不阻断打标
          }
        }
        // 企微侧同步：必须知道客户对应的企微成员 userid
        if (secrets && owner) {
          const wecomUserId =
            owner.externalStaffId ||
            [...staffLinks.entries()].find(
              ([, member]) => member === owner.staffUserId,
            )?.[0] ||
            '';
          const contact = await this.prisma.scrmContact.findUnique({
            where: { id: contactId },
          });
          if (wecomUserId && contact) {
            const tagExternal = (ids: number[]) =>
              ids
                .map((tagId) => tagById.get(tagId)?.externalId || '')
                .filter(Boolean);
            try {
              await this.client.markTag(
                secrets.corpId,
                secrets.contactSecret,
                wecomUserId,
                contact.externalUserId,
                tagExternal(addTagIds),
                tagExternal(removeTagIds),
              );
            } catch {
              // 企微拒绝（客户已删除/无权限）不回滚本地，失败数单独统计
              failed += 1;
            }
          }
        }
        updated += 1;
      } catch {
        failed += 1;
      }
    }
    await this.refreshTagUsage(org, [...addTagIds, ...removeTagIds]);
    return { updated, failed };
  }

  async batchTag(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const contactIds = intArr(body.contactIds).slice(0, 200);
    if (!org.isAdmin) {
      const owned = await this.prisma.scrmContactStaff.count({
        where: {
          ...orgKey(org),
          contactId: { in: contactIds },
          staffUserId: org.actorId,
        },
      });
      if (owned < contactIds.length) {
        throw new BusinessException(
          ErrorCode.ROLE_MISMATCH,
          '批量打标只能操作自己名下的客户',
        );
      }
    }
    return this.applyTags(
      org,
      contactIds,
      intArr(body.addTagIds),
      intArr(body.removeTagIds),
    );
  }

  async batchTagByFilter(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const where: Prisma.ScrmContactWhereInput = { ...orgKey(org) };
    const keyword = clip(body.keyword, 100).trim();
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { remark: { contains: keyword } },
      ];
    }
    if (body.status) where.status = text(body.status);
    const related = await contactIdsByRelation(this.prisma, org, {
      staffUserIds: body.staffUserId
        ? [text(body.staffUserId)]
        : org.isAdmin
          ? []
          : [org.actorId],
      tagIds: body.tagId ? [int(body.tagId)] : [],
    });
    if (related) where.id = { in: related };
    const rows = await this.prisma.scrmContact.findMany({
      where,
      select: { id: true },
      take: 2000,
    });
    const result = await this.applyTags(
      org,
      rows.map((row) => row.id),
      intArr(body.addTagIds),
      intArr(body.removeTagIds),
    );
    return { matched: rows.length, ...result };
  }

  // ---------- 资料卡字段 ----------
  private fieldView(field: {
    id: number;
    key: string;
    label: string;
    type: string;
    options: unknown;
    required: boolean;
    sortOrder: number;
    builtin: boolean;
    description: string;
  }) {
    return {
      id: field.id,
      key: field.key,
      label: field.label,
      type: field.type,
      options: strArr(field.options),
      required: field.required,
      sort: field.sortOrder,
      builtin: field.builtin,
      description: field.description,
    };
  }

  async fields(user: CurrentUser) {
    const org = await this.scope.resolve(user);
    await this.ensureFields(org);
    const rows = await this.prisma.scrmContactField.findMany({
      where: orgKey(org),
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.fieldView(row));
  }

  async saveField(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    await this.ensureFields(org);
    const id = int(body.id);
    const existing = id
      ? await this.prisma.scrmContactField.findFirst({
          where: { ...orgKey(org), id },
        })
      : null;
    if (id && !existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '字段不存在');
    }
    const label = clip(body.label, 40).trim();
    if (!label) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写字段名称');
    }
    const key = existing?.builtin
      ? existing.key
      : clip(body.key, 40).trim() ||
        `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const data = {
      label,
      type: text(body.type) || 'TEXT',
      options: json(strArr(body.options).map((item) => clip(item, 40))),
      required: body.required === true,
      sortOrder: int(body.sort),
      description: clip(body.description, 200),
    };
    const row = existing
      ? await this.prisma.scrmContactField.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.scrmContactField.create({
          data: {
            ...orgKey(org),
            key,
            builtin: false,
            ...data,
          },
        });
    return this.fieldView(row);
  }

  async removeField(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const id = int(body.id);
    const field = await this.prisma.scrmContactField.findFirst({
      where: { ...orgKey(org), id },
    });
    if (!field) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '字段不存在');
    }
    if (field.builtin) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '内置字段不可删除，可改名或停用填写',
      );
    }
    await this.prisma.$transaction([
      this.prisma.scrmContactFieldValue.deleteMany({
        where: { ...orgKey(org), fieldKey: field.key },
      }),
      this.prisma.scrmContactField.delete({ where: { id: field.id } }),
    ]);
    return { id: field.id };
  }

  async saveContactFields(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const contactId = int(body.contactId);
    await this.assertEditable(org, contactId);
    const values = Array.isArray(body.values) ? body.values : [];
    let saved = 0;
    for (const item of values) {
      const row = item as Record<string, unknown>;
      const fieldKey = clip(row.fieldKey, 40).trim();
      if (!fieldKey) continue;
      const field = await this.prisma.scrmContactField.findUnique({
        where: {
          orgType_orgUserId_key: {
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            key: fieldKey,
          },
        },
      });
      if (!field) continue;
      const raw = row.value;
      const value = Array.isArray(raw)
        ? raw.map((x) => clip(x, 200)).filter(Boolean)
        : clip(raw, 1000);
      // 清空即删除：只 upsert 会让用户删不掉已经填过的字段值
      if (Array.isArray(value) ? value.length === 0 : !value.trim()) {
        await this.prisma.scrmContactFieldValue.deleteMany({
          where: { contactId, fieldKey },
        });
        saved += 1;
        continue;
      }
      await this.prisma.scrmContactFieldValue.upsert({
        where: {
          contactId_fieldKey: { contactId, fieldKey },
        },
        create: { ...orgKey(org), contactId, fieldKey, value: json(value) },
        update: { value: json(value) },
      });
      saved += 1;
    }
    return { saved };
  }

  // ---------- 标签库 ----------
  async tagGroups(user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const [groups, tags] = await Promise.all([
      this.prisma.scrmTagGroup.findMany({
        where: { ...orgKey(org), deleted: false },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.scrmTag.findMany({
        where: { ...orgKey(org), deleted: false },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const byGroup = new Map<number, (typeof tags)[number][]>();
    for (const tag of tags) {
      const list = byGroup.get(tag.groupId) || [];
      list.push(tag);
      byGroup.set(tag.groupId, list);
    }
    const viewTag = (tag: (typeof tags)[number]) => ({
      id: tag.id,
      externalId: tag.externalId,
      name: tag.name,
      color: tag.color,
      sort: tag.sortOrder,
      usageCount: tag.usageCount,
    });
    return groups.map((group) => ({
      id: group.id,
      externalId: group.externalId,
      name: group.name,
      sort: group.sortOrder,
      tags: (byGroup.get(group.id) || []).map(viewTag),
    }));
  }

  /** 内部用：取组织标签名（群发、SOP、统计共用）。 */
  async tagNames(org: HrmOrg, tagIds: number[]): Promise<string[]> {
    if (!tagIds.length) return [];
    const rows = await this.prisma.scrmTag.findMany({
      where: { ...orgKey(org), id: { in: tagIds } },
      select: { name: true },
    });
    return rows.map((row) => row.name);
  }

  /** 内部用：把企微 follow_info 落成客户镜像（幂等；新增与补全共用）。 */
  async upsertFromWecom(
    org: HrmOrg,
    input: {
      externalUserId: string;
      name?: string;
      avatar?: string;
      gender?: number;
      unionId?: string;
      remark?: string;
      description?: string;
      staffUserId?: string;
      externalStaffId?: string;
      addedAt?: Date;
      lastInteractionAt?: Date;
      codeId?: number;
      codeName?: string;
    },
  ): Promise<{ contactId: number; created: boolean }> {
    const externalUserId = clip(input.externalUserId, 64);
    if (!externalUserId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '缺少外部联系人 ID');
    }
    const existing = await this.prisma.scrmContact.findUnique({
      where: {
        orgType_orgUserId_externalUserId: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          externalUserId,
        },
      },
    });
    const data = {
      name: clip(input.name ?? existing?.name ?? '', 120),
      avatar: clip(input.avatar ?? existing?.avatar ?? '', 500),
      gender:
        input.gender === undefined
          ? existing?.gender || ''
          : String(input.gender),
      unionId: clip(input.unionId ?? existing?.unionId ?? '', 64),
      remark: clip(input.remark ?? existing?.remark ?? '', 200),
      description: clip(input.description ?? existing?.description ?? '', 1000),
      status: 'ACTIVE',
      lastInteractionAt:
        input.lastInteractionAt ||
        existing?.lastInteractionAt ||
        input.addedAt ||
        new Date(),
      ...(input.codeId
        ? {
            sourceCodeId: input.codeId,
            sourceCodeName: clip(input.codeName || '', 60),
          }
        : {}),
    };
    let contactId = existing?.id || 0;
    let created = false;
    if (existing) {
      // 流失客户重新加回：清空流失状态并记一次新增
      const revived = existing.status === 'LOST';
      await this.prisma.scrmContact.update({
        where: { id: existing.id },
        data: {
          ...data,
          ...(revived ? { lostAt: null, lostReason: '' } : {}),
        },
      });
      if (revived) {
        await addTimeline(this.prisma, org, existing.id, 'ADD', '客户重新添加');
      }
    } else {
      const row = await this.prisma.scrmContact.create({
        data: {
          ...orgKey(org),
          externalUserId,
          addedAt: input.addedAt || new Date(),
          ...data,
        },
      });
      contactId = row.id;
      created = true;
      await addTimeline(
        this.prisma,
        org,
        row.id,
        'ADD',
        '客户添加',
        input.codeName ? `来源活码：${input.codeName}` : '',
        row.addedAt || new Date(),
      );
    }
    if (input.staffUserId) {
      await this.prisma.scrmContactStaff.upsert({
        where: {
          contactId_staffUserId: {
            contactId,
            staffUserId: input.staffUserId,
          },
        },
        create: {
          ...orgKey(org),
          contactId,
          staffUserId: input.staffUserId,
          externalStaffId: clip(input.externalStaffId || '', 64),
          relation: 'OWNER',
          addedAt: input.addedAt || new Date(),
        },
        update: {
          externalStaffId: clip(input.externalStaffId || '', 64) || undefined,
        },
      });
    }
    return { contactId, created };
  }

  /** 内部用：标记某个员工删除客户；没有其他员工时客户转流失。 */
  async markDeletedByStaff(
    org: HrmOrg,
    externalUserId: string,
    staffUserId: string,
    reason = '成员删除客户',
  ): Promise<void> {
    const contact = await this.prisma.scrmContact.findUnique({
      where: {
        orgType_orgUserId_externalUserId: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          externalUserId,
        },
      },
    });
    if (!contact) return;
    await this.prisma.scrmContactStaff.deleteMany({
      where: { ...orgKey(org), contactId: contact.id, staffUserId },
    });
    const remaining = await this.prisma.scrmContactStaff.count({
      where: { ...orgKey(org), contactId: contact.id },
    });
    if (remaining === 0 && contact.status !== 'LOST') {
      await this.prisma.scrmContact.update({
        where: { id: contact.id },
        data: {
          status: 'LOST',
          lostAt: new Date(),
          lostReason: clip(reason, 200),
        },
      });
      await addTimeline(
        this.prisma,
        org,
        contact.id,
        'LOST',
        '客户流失',
        reason,
      );
    }
  }

  /** 内部用：更新最后互动时间（群发/入群/接待都算互动）。 */
  async touch(org: HrmOrg, contactId: number): Promise<void> {
    if (!contactId) return;
    await this.prisma.scrmContact.updateMany({
      where: { ...orgKey(org), id: contactId },
      data: { lastInteractionAt: new Date() },
    });
  }

  /** 内部用：按 externalUserId 找客户（回调事件只带企微 id）。 */
  async findByExternal(org: HrmOrg, externalUserId: string) {
    return this.prisma.scrmContact.findUnique({
      where: {
        orgType_orgUserId_externalUserId: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          externalUserId,
        },
      },
    });
  }

  /** 内部用：归属员工 id 列表。 */
  async ownersOf(org: HrmOrg, contactId: number): Promise<string[]> {
    const rows = await this.prisma.scrmContactStaff.findMany({
      where: { ...orgKey(org), contactId },
      select: { staffUserId: true },
    });
    return rows.map((row) => row.staffUserId);
  }

  /** 统计用：今日新增/流失数。 */
  async counts(org: HrmOrg) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [contacts, lost, todayAdded, links] = await Promise.all([
      this.prisma.scrmContact.count({
        where: { ...orgKey(org), status: 'ACTIVE' },
      }),
      this.prisma.scrmContact.count({
        where: { ...orgKey(org), status: 'LOST' },
      }),
      this.prisma.scrmContact.count({
        where: { ...orgKey(org), addedAt: { gte: start } },
      }),
      this.prisma.scrmContactStaff.findMany({
        where: orgKey(org),
        select: { staffUserId: true },
        distinct: ['staffUserId'],
      }),
    ]);
    return { contacts, lost, todayAdded, activeStaff: links.length };
  }
}
