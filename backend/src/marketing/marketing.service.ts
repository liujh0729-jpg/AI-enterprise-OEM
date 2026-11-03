import { pageParam as listPageParam } from '../common/api';
import { allocateNo } from '../common/document-number';
import {
  DemandSyncService,
  splitList,
  toIsoDate,
} from '../aiworkin/demand-sync.service';
import { DemandDraft } from '../aiworkin/aiworkin.types';
import {
  normalizeCategoryEdit,
  requireSubCategoryId,
  withCategoryLabels,
} from '../aiworkin/category-catalog';
import { visibilityWhere } from '../shared/visibility';
import {
  isDemandOwner,
  requireDemandAccess,
  resolveDemandSpeaker,
} from '../shared/demand-access';
import { CurrentUser } from '../auth/current-user';
import { pickEditable } from '../shared/pick-editable';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { UserLookupService } from '../directory/user-lookup.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  appendMessage,
  asEvents,
  asMessages,
  demandText,
  feedbackProgress,
  isLocalConversation,
  msgTime,
  replyPartyCount,
} from '../shared/channel-message';
import { ContactResolver } from '../shared/contacts.service';
import { sideContactBody } from '../shared/contacts';
import {
  RegionFilter,
  RegionRow,
  demandGeoConfig,
  regionFromBody,
  regionColumns,
  regionFilterWhere,
  regionForCreate,
} from '../shared/region-scope';
const NODES = ['MATCHED', 'CONNECTED', 'DONE'];
const TYPE_LABELS: Record<string, string> = {
  VISIT: '达人探店',
  LIVE: '直播带货',
};
export class MarketingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly users: UserLookupService,
    private readonly demandSync: DemandSyncService,
    private readonly contacts: ContactResolver,
  ) {}
  private async listScope(
    user: CurrentUser,
    region: RegionFilter = {},
  ): Promise<import('../../generated/prisma').Prisma.MarketingOrderWhereInput> {
    const [eps, identity] = await Promise.all([
      this.identity.myEnterprises(user.userId),
      this.identity.currentIdentity(user),
    ]);
    const admin = this.identity.isPlatformAdmin(user);
    // 数据只有「做事的人」与「企业当事人」可见；无签约前置，服务商可见公开池

    return {
      ...visibilityWhere({
        isAdmin: admin,
        identity,
        userId: user.userId,
        enterpriseIds: eps.map((item) => item.id),
        includeOpenPool: true,
      }),
      // 省、市按需求本身记录的地域过滤（不限制＝两侧皆不筛选）
      ...regionFilterWhere(region),
    };
  }
  async list(
    user: CurrentUser,
    _asProvider = false,
    region: RegionFilter = {},
  ) {
    void _asProvider;
    const where = await this.listScope(user, region);
    const rows = await this.prisma.marketingOrder.findMany({
      where,
      orderBy: { id: 'desc' },
    });
    return rows.map((row) => ({
      ...withCategoryLabels(row),
      messages: asMessages(row.messages),
      events: asEvents(row.events),
      conversationCount: replyPartyCount(asMessages(row.messages)),
      feedback: feedbackProgress(row.status, NODES),
    }));
  }
  async listPage(
    user: CurrentUser,
    query: {
      page?: number;
      pageSize?: number;
      province?: string;
      city?: string;
      keyword?: string;
      status?: string;
      sort?: 'asc' | 'desc';
    },
  ) {
    const permission = await this.listScope(user, query);
    const where: import('../../generated/prisma').Prisma.MarketingOrderWhereInput =
      {
        AND: [
          permission,
          ...(query.status ? [{ status: query.status }] : []),
          ...(query.keyword
            ? [
                {
                  title: {
                    contains: query.keyword,
                  },
                },
              ]
            : []),
        ],
      };
    const { page, pageSize, offset } = listPageParam(
      query.page,
      query.pageSize,
    );
    const [rows, total] = await Promise.all([
      this.prisma.marketingOrder.findMany({
        where,
        orderBy: { id: query.sort ?? 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.marketingOrder.count({ where }),
    ]);
    return {
      list: rows.map((row) => ({
        ...withCategoryLabels(row),
        messages: asMessages(row.messages),
        events: asEvents(row.events),
        conversationCount: replyPartyCount(asMessages(row.messages)),
        feedback: feedbackProgress(row.status, NODES),
      })),
      total,
      page,
      pageSize,
    };
  }
  async listStats(user: CurrentUser) {
    const where = await this.listScope(user);
    const groups = await this.prisma.marketingOrder.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });
    return {
      total: groups.reduce((sum, row) => sum + row._count._all, 0),
      byStatus: Object.fromEntries(
        groups.map((row) => [row.status, row._count._all]),
      ),
    };
  }
  async detail(user: CurrentUser, id: number) {
    const permission = await this.listScope(user);
    const row = await this.prisma.marketingOrder.findFirst({
      where: { AND: [permission, { id }] },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '记录不存在或无权访问');
    const rows = [row];
    return rows.map((row) => ({
      ...withCategoryLabels(row),
      messages: asMessages(row.messages),
      events: asEvents(row.events),
      conversationCount: replyPartyCount(asMessages(row.messages)),
      feedback: feedbackProgress(row.status, NODES),
    }))[0];
  }

  async create(user: CurrentUser, body: Record<string, string>, token = '') {
    await this.identity.requireRoles(user, 'ENTERPRISE_USER');
    const title = String(body.title || '').trim();
    if (!title)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写需求标题');
    const eps = await this.identity.myEnterprises(user.userId);
    const ep = eps[0] || null;
    const typeLabel = body.order_type === 'LIVE' ? '直播带货' : '达人探店';
    const eventText = '需求已发布，等待服务商接收对接';
    // 地域范围三态（不限制 / 指定地区 / 经纬度坐标）：跟着需求本身走，不取发布主体档案
    const region = regionForCreate(body);

    // 联系方式：企业侧按档案自动带出（临时换人可在表单改），执行侧待服务商接收时带出
    const stageContacts = await this.contacts.stage(
      { enterpriseUserId: ep?.userId, enterpriseId: ep?.id },
      body,
    );
    const row = await this.prisma.marketingOrder.create({
      data: {
        orderNo: await allocateNo(this.prisma, 'YX'),
        enterpriseId: ep?.id || 0,
        createdBy: user.userId,
        orderType: body.order_type || 'VISIT',
        // 二级类目取 AIworkin 内容 / 营销广告 / 电商子树（本模块固定「营销推广」）
        subCategoryId: requireSubCategoryId('MARKETING', body.sub_category_id),
        title,
        description: body.description || '',
        tags: body.tags || '',
        budget: body.budget || '',
        expectedResult: body.expected_result || '',
        mustConditions: body.must_conditions || '',
        expectStart: body.expect_start || '',
        deadline: body.deadline || '',
        ...regionColumns(region),
        regionScope: region.label,
        contactWechat: body.contact_wechat || '',
        contactEmail: body.contact_email || '',
        ...stageContacts,
        emailSync: Number(body.email_sync || 0) ? 1 : 0,
        status: 'OPEN',
        events: [{ time: msgTime(), status: 'OPEN', text: eventText }],
        messages: [
          {
            role: 'ENTERPRISE',
            name: ep?.name || user.username,
            time: msgTime(),
            text: demandText(title, typeLabel, {
              ...body,
              region_scope: region.label,
              contact_name: stageContacts.contactName,
              contact_phone: stageContacts.contactPhone,
            }),
          },
          { role: 'SYSTEM', name: '系统', time: msgTime(), text: eventText },
        ],
      },
    });
    const sync = await this.demandSync.publish(
      token,
      buildMarketingDraft(row),
      `marketing:${row.id}`,
    );
    await this.prisma.marketingOrder.update({
      where: { id: row.id },
      data: {
        aiworkinPublished: sync.published,
        platformListingId: sync.listingId,
        platformMatchRunId: sync.matchRunId,
        aiworkinSyncStatus: sync.status,
        aiworkinSyncError: sync.error,
      },
    });
    return {
      id: row.id,
      status: 'OPEN',
      aiworkinPublished: sync.published,
      platform_listing_id: sync.listingId,
      aiworkin_sync_status: sync.status,
      tip: sync.tip,
    };
  }
  async accept(user: CurrentUser, id: number) {
    await this.identity.requireRoles(user, 'SERVICE_PROVIDER');
    const row = await this.prisma.marketingOrder.findUnique({ where: { id } });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '营销需求不存在');
    if (row.status !== 'OPEN') {
      throw new BusinessException(ErrorCode.ORDER_STATE, '该需求已被接收');
    }
    const name = await this.users.displayName(user.userId);
    const ack = `服务商「${name}」已接收对接`;
    // 接收即确定执行人：执行联系方式按接收人档案带出
    const providerContact = await this.contacts.provider(
      user.userId,
      user.userId,
    );
    await this.prisma.marketingOrder.update({
      where: { id },
      data: {
        providerUserId: user.userId,
        providerName: name,
        // 接收即绑定承办人
        staffUserId: user.userId,
        status: 'MATCHED',
        ...(providerContact.name || providerContact.phone
          ? {
              providerContactName: providerContact.name,
              providerContactPhone: providerContact.phone,
            }
          : {}),
        events: [
          ...asEvents(row.events),
          { time: msgTime(), status: 'MATCHED', text: ack },
        ],
        messages: appendMessage(row.messages, 'SYSTEM', '系统', ack),
      },
    });
    return { id, status: 'MATCHED' };
  }
  async messages(user: CurrentUser, id: number, token = '') {
    const row = await this.requireAccess(user, id, true);
    const channel = await this.demandSync.conversations(
      token,
      row.platformListingId,
      row.platformMatchRunId,
      asMessages(row.messages),
    );
    return {
      orderId: row.id,
      conversations: channel.conversations,
      source: channel.source,
    };
  }
  async postMessage(
    user: CurrentUser,
    id: number,
    text: string,
    token = '',
    conversationId = '',
  ) {
    const content = text.trim();
    if (!content)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '消息内容不能为空');
    // 「发给你了就是接收了」：服务商无需先点接收，首次回复即接单
    await this.claimOnReply(user, id);
    const row = await this.requireAccess(user, id);
    const speaker = await resolveDemandSpeaker(
      { prisma: this.prisma, identity: this.identity },
      user,
      row,
    );
    if (!speaker) {
      throw new BusinessException(ErrorCode.ROLE_MISMATCH, '仅当事双方可发言');
    }
    const name =
      speaker.side === 'ENTERPRISE'
        ? speaker.enterprise?.name || user.username
        : await this.users.displayName(user.userId);
    const messages = appendMessage(
      row.messages,
      speaker.side,
      name,
      content,
      conversationId,
    );
    await this.prisma.marketingOrder.update({
      where: { id },
      data: { messages: messages },
    });
    const sync = await this.demandSync.reply(
      token,
      isLocalConversation(conversationId) ? '' : conversationId,
      content,
    );
    return { orderId: id, messages, aiworkin_sync: sync.synced, tip: sync.tip };
  }
  async confirm(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown> = {},
  ) {
    const row = await this.requireAccess(user, id);
    const ep = row.enterpriseId
      ? await this.prisma.enterpriseProfile.findUnique({
          where: { id: row.enterpriseId },
        })
      : null;
    if (ep?.userId !== user.userId && row.createdBy !== user.userId) {
      throw new BusinessException(ErrorCode.ROLE_MISMATCH, '仅企业可确认对接');
    }
    const updated = await this.prisma.marketingOrder.update({
      where: { id },
      data: {
        status: 'DONE',
        events: [
          ...asEvents(row.events),
          { time: msgTime(), status: 'DONE', text: '企业已确认对接方案' },
        ],
        messages: appendMessage(
          row.messages,
          'SYSTEM',
          '系统',
          '企业已确认对接方案',
        ),
        ...(await this.contacts.stage(
          {
            enterpriseId: row.enterpriseId,
            staffUserId: row.staffUserId,
            providerUserId: row.providerUserId,
          },
          body,
        )),
      },
    });
    return {
      id,
      status: 'DONE',
      contact_name: updated.contactName,
      contact_phone: updated.contactPhone,
      provider_contact_name: updated.providerContactName,
      provider_contact_phone: updated.providerContactPhone,
    };
  }
  /**
   * 改联系方式（临时换人）：企业当事人改需求侧、承办人改执行侧，均不受单据状态限制。
   * 系统已按对应人档案自动带出，这里只处理人工调整。
   */
  async updateContacts(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown> = {},
  ) {
    const row = await this.requireAccess(user, id);
    const side = await this.identity.contactSide(user, row);
    const updated = await this.prisma.marketingOrder.update({
      where: { id },
      data: await this.contacts.stage(
        {
          enterpriseId: row.enterpriseId,
          staffUserId: row.staffUserId,
          providerUserId: row.providerUserId,
        },
        sideContactBody(body, side, row),
      ),
    });
    await this.identity.audit(
      user.userId,
      'MARKETING_CONTACTS_UPDATE',
      `#${id} ${row.orderNo} 联系方式`,
    );
    return {
      id,
      contact_name: updated.contactName,
      contact_phone: updated.contactPhone,
      provider_contact_name: updated.providerContactName,
      provider_contact_phone: updated.providerContactPhone,
    };
  }
  /** 编辑营销需求：仅创建人或平台管理员。 */
  async update(user: CurrentUser, id: number, body: Record<string, unknown>) {
    const row = await this.requireAccess(user, id);
    if (!isDemandOwner(user, row, this.identity.isPlatformAdmin(user))) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅需求创建人可修改',
      );
    }
    const region = regionFromBody(body);
    await this.prisma.marketingOrder.update({
      where: { id },
      data: {
        ...pickEditable(
          normalizeCategoryEdit('MARKETING', body),
          MARKETING_EDITABLE,
        ),
        // 带三态控件时整体覆盖地域范围（含派生文案）；未带则保持原值
        ...(region
          ? { ...regionColumns(region), regionScope: region.label }
          : {}),
      },
    });
    await this.identity.audit(
      user.userId,
      'MARKETING_UPDATE',
      `#${id} ${row.orderNo}`,
    );
    return {
      id,
      tip: row.platformListingId
        ? '该需求已发布至 AIworkin 平台通道，修改将在下次同步生效'
        : '已保存',
    };
  }
  async remove(user: CurrentUser, id: number) {
    const row = await this.requireAccess(user, id);
    if (!isDemandOwner(user, row, this.identity.isPlatformAdmin(user))) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅需求创建人可删除',
      );
    }
    await this.prisma.marketingOrder.delete({ where: { id } });
    await this.identity.audit(
      user.userId,
      'MARKETING_DELETE',
      `#${id} ${row.orderNo}`,
    );
    return { id, deleted: true };
  }
  /**
   * 「发给你了就是接收了」：需求发布给服务商后无需再点接收，
   * 服务商（机构账号本人承办）首次回复即自动接单并绑定承办人。
   */
  private async claimOnReply(user: CurrentUser, id: number) {
    const row = await this.prisma.marketingOrder.findUnique({ where: { id } });
    if (!row) return;
    if (row.status !== 'OPEN' || row.providerUserId) return;
    if (row.createdBy === user.userId) return;
    if (this.identity.isPlatformAdmin(user)) return;
    if (!(await this.identity.hasRole(user, 'SERVICE_PROVIDER'))) return;
    const name = await this.users.displayName(user.userId);
    const ack = `服务商「${name}」已回复并接收对接`;
    // 与 accept 同一口径：接单即确定执行人，执行联系方式按接单方档案带出
    const providerContact = await this.contacts.provider(
      user.userId,
      user.userId,
    );
    await this.prisma.marketingOrder.update({
      where: { id },
      data: {
        providerUserId: user.userId,
        providerName: name,
        // 回复即接单并绑定承办人（机构账号本人承办）
        staffUserId: user.userId,
        status: 'MATCHED',
        ...(providerContact.name || providerContact.phone
          ? {
              providerContactName: providerContact.name,
              providerContactPhone: providerContact.phone,
            }
          : {}),
        events: [
          ...asEvents(row.events),
          { time: msgTime(), status: 'MATCHED', text: ack },
        ],
        messages: appendMessage(row.messages, 'SYSTEM', '系统', ack),
      },
    });
  }
  /**
   * 单据可达性：平台管理员 / 需求当事人 / 承办人（服务商账号或承办职员）。
   * allowPool：服务商可读公开需求池需求的消息（回复即接单，先读后写）。
   */
  private async requireAccess(
    user: CurrentUser,
    id: number,
    allowPool = false,
  ) {
    const row = await this.prisma.marketingOrder.findUnique({ where: { id } });
    return requireDemandAccess(
      {
        prisma: this.prisma,
        identity: this.identity,
        poolEligible: (current) =>
          this.identity.hasRole(current, 'SERVICE_PROVIDER'),
      },
      '营销需求不存在',
      user,
      row,
      allowPool,
    );
  }
}
/** 可编辑字段：前端字段名 → 数据库列名（与 create 同一套 snake_case 表单字段名）。 */
const MARKETING_EDITABLE: Record<string, string> = {
  title: 'title',
  description: 'description',
  order_type: 'orderType',
  sub_category_id: 'subCategoryId',
  tags: 'tags',
  budget: 'budget',
  expected_result: 'expectedResult',
  must_conditions: 'mustConditions',
  expect_start: 'expectStart',
  deadline: 'deadline',
  region_scope: 'regionScope',
  contact_name: 'contactName',
  contact_phone: 'contactPhone',
  contact_wechat: 'contactWechat',
  contact_email: 'contactEmail',
  provider_contact_name: 'providerContactName',
  provider_contact_phone: 'providerContactPhone',
};
function buildMarketingDraft(
  row: {
    title: string;
    description: string;
    orderType: string;
    subCategoryId: string;
    tags: string;
    budget: string;
    expectedResult: string;
    mustConditions: string;
    expectStart: string;
    deadline: string;
    regionScope: string;
    contactName: string;
    contactPhone: string;
    contactWechat: string;
    contactEmail: string;
    emailSync: number;
  } & RegionRow,
): DemandDraft {
  const deadline = toIsoDate(row.deadline);
  return {
    title: row.title,
    description: row.description || row.title,
    direction: 'DEMAND',
    subcategoryId: requireSubCategoryId('MARKETING', row.subCategoryId),
    publishAction: deadline ? 'PUBLISH' : 'DRAFT',
    // 本系统预算为人民币文本，平台只收 AWCOIN 整数，故按「面议」提交，
    // 金额原文随 attributes.budget 带给平台匹配参考
    moneyMode: 'NEGOTIABLE',
    currency: 'AWCOIN',
    tags: splitList(row.tags),
    expectedOutcome: row.expectedResult || undefined,
    mustHaves: splitList(row.mustConditions),
    startAt: toIsoDate(row.expectStart),
    deadline,
    attributes: {
      marketingType: TYPE_LABELS[row.orderType] || row.orderType,
      budget: row.budget,
      regionScope: row.regionScope,
    },
    a2aConfig: demandGeoConfig(row),
    contactName: row.contactName || undefined,
    contactPhone: row.contactPhone || undefined,
    contactWechat: row.contactWechat || undefined,
    contactEmail: row.contactEmail || undefined,
    replyEmailEnabled: row.emailSync === 1,
    replyEmail: row.emailSync === 1 ? row.contactEmail : undefined,
  };
}
