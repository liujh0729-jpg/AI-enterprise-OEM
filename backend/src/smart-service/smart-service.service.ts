import { pageParam as listPageParam } from '../common/api';
import { allocateNo } from '../common/document-number';
import { Prisma } from '../../generated/prisma';
import { text } from '../common/api';
import {
  DemandSyncService,
  splitList,
  toIsoDate,
} from '../aiworkin/demand-sync.service';
import { DemandDraft } from '../aiworkin/aiworkin.types';
import {
  requireSubCategoryId,
  normalizeCategoryEdit,
  withCategoryLabels,
} from '../aiworkin/category-catalog';
import { pickEditable } from '../shared/pick-editable';
import { visibilityWhere } from '../shared/visibility';
import {
  isDemandOwner,
  requireDemandAccess,
  resolveDemandSpeaker,
} from '../shared/demand-access';
import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { CATEGORY_LABELS, SMART_SERVICE_TYPES } from '../common/constants';
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
const SMART_NODES = ['PENDING', 'IN_PROGRESS', 'DELIVERED'];
/** 可编辑字段：前端字段名 → 数据库列名（与 create 同一套 snake_case 表单字段名）。 */
const SMART_EDITABLE: Record<string, string> = {
  title: 'title',
  service_item: 'serviceItem',
  sub_category_id: 'subCategoryId',
  description: 'description',
  tags: 'tags',
  budget: 'budget',
  expected_result: 'expectedResult',
  must_conditions: 'mustConditions',
  region_scope: 'regionScope',
  expect_start: 'expectStart',
  deadline: 'deadline',
  contact_name: 'contactName',
  contact_phone: 'contactPhone',
  contact_wechat: 'contactWechat',
  contact_email: 'contactEmail',
  provider_contact_name: 'providerContactName',
  provider_contact_phone: 'providerContactPhone',
};
export class SmartServiceService {
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
  ): Promise<
    import('../../generated/prisma').Prisma.SmartServiceOrderWhereInput
  > {
    const [eps, identity] = await Promise.all([
      this.identity.myEnterprises(user.userId),
      this.identity.currentIdentity(user),
    ]);
    const admin = this.identity.isPlatformAdmin(user);
    // 数据只有「做事的人」与「企业当事人」可见（服务商账号非承办人亦不可见）
    let where = visibilityWhere({
      isAdmin: admin,
      identity,
      userId: user.userId,
      enterpriseIds: eps.map((item) => item.id),
      includeOpenPool: true,
    });
    if (!admin && identity === 'SERVICE_PROVIDER') {
      const canOpen = await this.canAcceptPool(user.userId);
      if (!canOpen && where && 'OR' in where) {
        where = {
          providerUserId: user.userId,
          OR: [{ staffUserId: user.userId }, { staffUserId: '' }],
        };
      }
    }

    return { ...where, ...regionFilterWhere(region) };
  }
  async list(
    user: CurrentUser,
    _asProvider = false,
    region: RegionFilter = {},
  ) {
    void _asProvider;
    const where = await this.listScope(user, region);
    const rows = await this.prisma.smartServiceOrder.findMany({
      where,
      orderBy: { id: 'desc' },
    });
    return rows.map(decorateSmart);
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
    const where: import('../../generated/prisma').Prisma.SmartServiceOrderWhereInput =
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
      this.prisma.smartServiceOrder.findMany({
        where,
        orderBy: { id: query.sort ?? 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.smartServiceOrder.count({ where }),
    ]);
    return { list: rows.map(decorateSmart), total, page, pageSize };
  }
  async listStats(user: CurrentUser) {
    const where = await this.listScope(user);
    const groups = await this.prisma.smartServiceOrder.groupBy({
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
    const row = await this.prisma.smartServiceOrder.findFirst({
      where: { AND: [permission, { id }] },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '记录不存在或无权访问');
    const rows = [row];
    return rows.map(decorateSmart)[0];
  }

  async create(user: CurrentUser, body: Record<string, string>, token = '') {
    await this.identity.requireRoles(user, 'ENTERPRISE_USER');
    const title = String(body.title || '').trim();
    if (!title)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写需求标题');
    const item = String(body.service_item || '')
      .trim()
      .toUpperCase();
    if (!isSmartItem(item)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `请选择服务细项（${SMART_SERVICE_TYPES.map((code) => CATEGORY_LABELS[code]).join(' / ')}）`,
      );
    }
    const eps = await this.identity.myEnterprises(user.userId);
    const ep = eps[0] || null;
    // IT服务按细项各签：直派只找与本单细项一致的生效签约
    let contract = null;
    if (ep) {
      contract = await this.prisma.contract.findFirst({
        where: { enterpriseId: ep.id, serviceType: item, status: 'ACTIVE' },
      });
    }
    const providerName = contract
      ? await this.users.displayName(contract.providerUserId)
      : '';
    const status = contract ? 'PENDING' : 'OPEN';
    const eventText = contract
      ? `需求已发布，已直派IT服务商「${providerName}」接收工单`
      : '需求已发布，等待服务商接收';

    // 地域范围三态（不限制 / 指定地区 / 经纬度坐标）：跟着需求本身走，不取发布主体档案
    const region = regionForCreate(body);
    // 需求联系方式：企业侧按档案自动带出，执行侧承接签约上已定的服务商联系人
    const stageContacts = await this.contacts.stage(
      {
        enterpriseUserId: ep?.userId,
        enterpriseId: ep?.id,
        providerUserId: contract?.providerUserId || '',
      },
      {
        provider_contact_name: contract?.providerContactName || '',
        provider_contact_phone: contract?.providerContactPhone || '',
        ...body,
      },
    );
    const messages = [
      {
        role: 'ENTERPRISE' as const,
        name: ep?.name || user.username,
        time: msgTime(),
        text: demandText(title, CATEGORY_LABELS[item], {
          description: body.description || '',
          budget: body.budget || '',
          expected_result: body.expected_result || '',
          must_conditions: body.must_conditions || '',
          expect_start: body.expect_start || '',
          deadline: body.deadline || '',
          region_scope: region.label,
          contact_name: stageContacts.contactName,
          contact_phone: stageContacts.contactPhone,
        }),
      },
      {
        role: 'SYSTEM' as const,
        name: '系统',
        time: msgTime(),
        text: eventText,
      },
    ];
    const row = await this.prisma.smartServiceOrder.create({
      data: {
        orderNo: await allocateNo(this.prisma, 'ZH'),
        contractId: contract?.id || 0,
        enterpriseId: ep?.id || 0,
        createdBy: user.userId,
        providerUserId: contract?.providerUserId || '',
        providerName,
        serviceItem: item,
        // 二级类目取 AIworkin「软件 / AI开发公司」子树（未选＝「软件开发 / AI开发」）
        subCategoryId: requireSubCategoryId('SMART', body.sub_category_id),
        title,
        description: body.description || '',
        budget: body.budget || '',
        expectedResult: body.expected_result || '',
        mustConditions: body.must_conditions || '',
        tags: body.tags || '',
        expectStart: body.expect_start || '',
        deadline: body.deadline || '',
        ...regionColumns(region),
        regionScope: region.label,
        emailSync: Number(body.email_sync || 0) ? 1 : 0,
        contactWechat: body.contact_wechat || '',
        contactEmail: body.contact_email || '',
        ...stageContacts,
        status,
        aiworkinPublished: 0,
        events: [{ time: msgTime(), status, text: eventText }],
        messages,
      },
    });
    const sync = await this.demandSync.publish(
      token,
      buildSmartDraft(row),
      `smart:${row.id}`,
    );
    await this.prisma.smartServiceOrder.update({
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
      status,
      provider_id: row.providerUserId,
      provider_name: providerName,
      aiworkinPublished: sync.published,
      platform_listing_id: sync.listingId,
      aiworkin_sync_status: sync.status,
      tip: sync.tip,
    };
  }
  /** 编辑IT服务需求：只按身份判定（创建人或平台管理员），能不能改由接口返回值决定。 */
  async update(user: CurrentUser, id: number, body: Record<string, unknown>) {
    const row = await this.requireOwner(user, id);
    if (body.service_item !== undefined) {
      const item = text(body.service_item).trim().toUpperCase();
      if (!isSmartItem(item)) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '服务细项不合法');
      }
      body = { ...body, service_item: item };
    }
    const region = regionFromBody(body);
    await this.prisma.smartServiceOrder.update({
      where: { id },
      data: {
        ...pickEditable(normalizeCategoryEdit('SMART', body), SMART_EDITABLE),
        ...(region
          ? { ...regionColumns(region), regionScope: region.label }
          : {}),
      },
    });
    await this.identity.audit(
      user.userId,
      'SMART_SERVICE_UPDATE',
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
    const row = await this.requireOwner(user, id);
    await this.prisma.smartServiceOrder.delete({ where: { id } });
    await this.identity.audit(
      user.userId,
      'SMART_SERVICE_DELETE',
      `#${id} ${row.orderNo}`,
    );
    return { id, deleted: true };
  }
  /** 编辑/删除前置：单据存在 + 创建人或平台管理员（服务商不可改企业需求）。 */
  private async requireOwner(user: CurrentUser, id: number) {
    const row = await this.prisma.smartServiceOrder.findUnique({
      where: { id },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, 'IT服务需求不存在');
    }
    if (!isDemandOwner(user, row, this.identity.isPlatformAdmin(user))) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅需求创建人或平台管理员可操作，服务商不可修改企业填写的需求内容',
      );
    }
    return row;
  }
  async accept(user: CurrentUser, id: number) {
    await this.identity.requireRoles(user, 'SERVICE_PROVIDER');
    if (!(await this.canAcceptPool(user.userId))) {
      throw new BusinessException(
        ErrorCode.CONTRACT_STATE,
        '仅备案IT服务服务商可接收该工单',
      );
    }
    const row = await this.prisma.smartServiceOrder.findUnique({
      where: { id },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, 'IT服务需求不存在');
    if (row.status !== 'OPEN' || row.providerUserId) {
      throw new BusinessException(ErrorCode.ORDER_STATE, '该需求已被接收');
    }
    const name = await this.users.displayName(user.userId);
    const ack = `IT服务商「${name}」已接收工单，等待开工`;
    // 接收即确定执行人：执行联系方式按接收人档案刷新
    const providerContact = await this.contacts.provider(
      user.userId,
      user.userId,
    );
    await this.prisma.smartServiceOrder.update({
      where: { id },
      data: {
        providerUserId: user.userId,
        // 接收即绑定承办人（职员账号接收即本人承办）
        staffUserId: user.userId,
        providerName: name,
        status: 'PENDING',
        ...(providerContact.name || providerContact.phone
          ? {
              providerContactName: providerContact.name,
              providerContactPhone: providerContact.phone,
            }
          : {}),
        events: [
          ...asEvents(row.events),
          { time: msgTime(), status: 'PENDING', text: ack },
        ] as Prisma.InputJsonValue,
        messages: appendMessage(row.messages, 'SYSTEM', '系统', ack),
      },
    });
    return {
      id,
      status: 'PENDING',
      provider_id: user.userId,
      provider_name: name,
    };
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
      order_no: row.orderNo,
      ...channel,
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
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅需求企业与服务方承办人可发言',
      );
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
    await this.prisma.smartServiceOrder.update({
      where: { id },
      data: { messages },
    });
    const sync = await this.demandSync.reply(
      token,
      isLocalConversation(conversationId) ? '' : conversationId,
      content,
    );
    return {
      orderId: id,
      order_no: row.orderNo,
      messages,
      aiworkin_sync: sync.synced,
      tip: sync.tip,
    };
  }
  async advance(
    user: CurrentUser,
    id: number,
    action: string,
    text = '',
    body: Record<string, unknown> = {},
  ) {
    const row = await this.prisma.smartServiceOrder.findUnique({
      where: { id },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, 'IT服务工单不存在');
    if (!(await this.identity.canWorkOn(user, row))) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        row.staffUserId
          ? '仅该单的承办职员可办理（服务商账号不代替承办人作业）'
          : '请服务商先在「职员/代理人管理 · 企业分配」指定承办职员',
      );
    }
    const map: Record<string, string> = {
      START: 'IN_PROGRESS',
      DELIVER: 'DELIVERED',
      EXCEPTION: 'EXCEPTION',
    };
    const target = map[action];
    if (!target)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '动作不合法');
    const advText = text || target;
    const updated = await this.prisma.smartServiceOrder.update({
      where: { id },
      data: {
        status: target,
        events: [
          ...asEvents(row.events),
          { time: msgTime(), status: target, text: advText },
        ] as Prisma.InputJsonValue,
        messages: appendMessage(row.messages, 'SYSTEM', '系统', advText),
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
      status: target,
      contact_name: updated.contactName,
      contact_phone: updated.contactPhone,
      provider_contact_name: updated.providerContactName,
      provider_contact_phone: updated.providerContactPhone,
    };
  }
  /**
   * 改联系方式（临时换人）：企业当事人改需求侧、承办人改执行侧，均不受单据状态限制。
   */
  async updateContacts(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown> = {},
  ) {
    const row = await this.requireAccess(user, id);
    const side = await this.identity.contactSide(user, row);
    const updated = await this.prisma.smartServiceOrder.update({
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
      'SMART_SERVICE_CONTACTS_UPDATE',
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
  private async canAcceptPool(userId: string) {
    return this.identity.hasServiceType(userId, 'SMART_SERVICE');
  }
  /**
   * 「发给你了就是接收了」：备案IT服务服务商首次回复即自动接单并绑定承办人。
   */
  private async claimOnReply(user: CurrentUser, id: number) {
    const row = await this.prisma.smartServiceOrder.findUnique({
      where: { id },
    });
    if (!row) return;
    if (row.status !== 'OPEN' || row.providerUserId) return;
    if (row.createdBy === user.userId) return;
    if (this.identity.isPlatformAdmin(user)) return;
    if (!(await this.identity.hasRole(user, 'SERVICE_PROVIDER'))) return;
    if (!(await this.canAcceptPool(user.userId))) return;
    const name = await this.users.displayName(user.userId);
    const ack = `IT服务商「${name}」已回复并接收工单，等待开工`;
    const providerContact = await this.contacts.provider(
      user.userId,
      user.userId,
    );
    await this.prisma.smartServiceOrder.update({
      where: { id },
      data: {
        providerUserId: user.userId,
        staffUserId: user.userId,
        providerName: name,
        status: 'PENDING',
        ...(providerContact.name || providerContact.phone
          ? {
              providerContactName: providerContact.name,
              providerContactPhone: providerContact.phone,
            }
          : {}),
        events: [
          ...asEvents(row.events),
          { time: msgTime(), status: 'PENDING', text: ack },
        ] as Prisma.InputJsonValue,
        messages: appendMessage(row.messages, 'SYSTEM', '系统', ack),
      },
    });
  }
  /**
   * 单据可达性：平台管理员 / 需求企业当事人 / 承办人（服务商账号或承办职员）。
   * allowPool：可接单的服务商可读公开需求池工单的消息（回复即接单，先读后写）。
   */
  private async requireAccess(
    user: CurrentUser,
    id: number,
    allowPool = false,
  ) {
    const row = await this.prisma.smartServiceOrder.findUnique({
      where: { id },
    });
    return requireDemandAccess(
      {
        prisma: this.prisma,
        identity: this.identity,
        poolEligible: (current) => this.canAcceptPool(current.userId),
      },
      'IT服务需求不存在',
      user,
      row,
      allowPool,
    );
  }
}
function isSmartItem(value: string) {
  return (SMART_SERVICE_TYPES as readonly string[]).includes(value);
}
function buildSmartDraft(
  row: {
    title: string;
    description: string;
    tags: string;
    budget: string;
    expectedResult: string;
    mustConditions: string;
    expectStart: string;
    deadline: string;
    regionScope: string;
    serviceItem: string;
    subCategoryId: string;
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
    subcategoryId: requireSubCategoryId('SMART', row.subCategoryId),
    // 无截止时间无法按发布态提交，先落草稿，补齐后可发布
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
      serviceItem: row.serviceItem,
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
function decorateSmart(row: {
  status: string;
  messages: unknown;
  events: unknown;
  [key: string]: unknown;
}) {
  return {
    ...withCategoryLabels(row),
    messages: asMessages(row.messages),
    events: asEvents(row.events),
    conversationCount: replyPartyCount(asMessages(row.messages)),
    feedback: feedbackProgress(row.status, SMART_NODES),
  };
}
