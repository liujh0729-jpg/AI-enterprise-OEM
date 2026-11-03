import { pageParam as listPageParam } from '../common/api';
import { allocateNo } from '../common/document-number';
import { Prisma } from '../../generated/prisma';
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
import { pickEditable } from '../shared/pick-editable';
import { visibilityWhere } from '../shared/visibility';
import {
  isDemandOwner,
  requireDemandAccess,
  resolveDemandSpeaker,
} from '../shared/demand-access';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
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
const ASSET_NODES = ['PENDING', 'VIEWING', 'DEAL'];
/**
 * 资产交易（AIworkin 一级类目「资产租售与居间服务」）：
 * **发起与承接均为双身份** —— 企业身份与服务商身份都可发布资产需求、也可居间承接，
 * 承接前置＝本人已发布过「资产交易」类目服务（在「服务发布」页签建档即可，草稿亦算），
 * 流程与物流需求同构（无签约前置，走公开需求池）。
 */
export class AssetService {
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
  ): Promise<import('../../generated/prisma').Prisma.AssetRequestWhereInput> {
    const [eps, identity] = await Promise.all([
      this.identity.myEnterprises(user.userId),
      this.identity.currentIdentity(user),
    ]);
    const admin = this.identity.isPlatformAdmin(user);
    let where = visibilityWhere({
      isAdmin: admin,
      identity,
      userId: user.userId,
      enterpriseIds: eps.map((item) => item.id),
      includeOpenPool: true,
    });
    if (!admin) {
      // 承接资格＝本人已发布「资产交易」服务（企业/服务商身份同一门槛）
      const canBroker = await this.hasPublishedService(user.userId);
      const pool = { status: 'OPEN', providerUserId: '' };
      if (identity === 'SERVICE_PROVIDER') {
        const own = {
          providerUserId: user.userId,
          OR: [{ staffUserId: user.userId }, { staffUserId: '' }],
        };
        // 发布方也是服务商：自己发布的资产即使已被其他服务商承接，仍须可见可管
        const mine = { createdBy: user.userId };
        where = canBroker ? { OR: [own, pool, mine] } : { OR: [own, mine] };
      } else if (identity === 'ENTERPRISE_USER') {
        // 企业身份承接同口径：本人承办的单据始终可见，已发布服务时再叠加公开池
        const brokered = { providerUserId: user.userId };
        where = canBroker
          ? { OR: [where ?? {}, brokered, pool] }
          : { OR: [where ?? {}, brokered] };
      }
    }

    return { ...where, ...regionFilterWhere(region) };
  }
  async list(user: CurrentUser, region: RegionFilter = {}) {
    const where = await this.listScope(user, region);
    const rows = await this.prisma.assetRequest.findMany({
      where,
      orderBy: { id: 'desc' },
    });
    return rows.map(decorateAsset);
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
    const where: import('../../generated/prisma').Prisma.AssetRequestWhereInput =
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
      this.prisma.assetRequest.findMany({
        where,
        orderBy: { id: query.sort ?? 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.assetRequest.count({ where }),
    ]);
    return { list: rows.map(decorateAsset), total, page, pageSize };
  }
  async listStats(user: CurrentUser) {
    const where = await this.listScope(user);
    const groups = await this.prisma.assetRequest.groupBy({
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
    const row = await this.prisma.assetRequest.findFirst({
      where: { AND: [permission, { id }] },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '记录不存在或无权访问');
    const rows = [row];
    return rows.map(decorateAsset)[0];
  }

  async create(user: CurrentUser, body: Record<string, unknown>, token = '') {
    await this.identity.requireRoles(
      user,
      'SERVICE_PROVIDER',
      'ENTERPRISE_USER',
    );
    const title = text(body.title).trim();
    if (!title) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写需求标题');
    }
    const eps = await this.identity.myEnterprises(user.userId);
    const ep = eps[0] || null;
    const posterName = ep?.name || (await this.users.displayName(user.userId));
    const eventText = '资产已发布，等待承接方接收对接';

    // 资产方联系方式：企业档案（有则取）→ 无企业档案时回退服务商备案联系人
    const poster = await this.contacts.enterprise(user.userId, ep?.id || 0);
    const sellerContact =
      poster.name || poster.phone
        ? poster
        : await this.contacts.provider(user.userId, user.userId);
    const stageContacts = await this.contacts.stage(
      { enterpriseUserId: ep?.userId, enterpriseId: ep?.id },
      {
        ...body,
        contact_name: text(body.contact_name).trim() || sellerContact.name,
        contact_phone: text(body.contact_phone).trim() || sellerContact.phone,
      },
    );
    // 地域范围三态（不限制 / 指定地区 / 经纬度坐标）：跟着需求本身走，不取发布主体档案
    const region = regionForCreate(body);
    const row = await this.prisma.assetRequest.create({
      data: {
        requestNo: await allocateNo(this.prisma, 'ZJ'),
        enterpriseId: ep?.id || 0,
        createdBy: user.userId,
        // 二级类目取 AIworkin 资产租售与居间服务子树（未选＝「房产销售/租赁」）
        subCategoryId: requireSubCategoryId('ASSET', body.sub_category_id),
        title,
        description: text(body.description || body.remark),
        tags: text(body.tags),
        budget: text(body.budget),
        expectedResult: text(body.expected_result),
        mustConditions: text(body.must_conditions),
        expectStart: text(body.expect_start),
        deadline: text(body.deadline),
        ...regionColumns(region),
        regionScope: region.label,
        emailSync: Number(body.email_sync || 0) ? 1 : 0,
        contactWechat: text(body.contact_wechat),
        contactEmail: text(body.contact_email),
        ...stageContacts,
        status: 'OPEN',
        events: [{ time: msgTime(), status: 'OPEN', text: eventText }],
        messages: [
          {
            role: 'ENTERPRISE',
            name: posterName,
            time: msgTime(),
            text: demandText(title, ASSET_TYPE_LABEL, {
              description: text(body.description || body.remark),
              budget: text(body.budget),
              expected_result: text(body.expected_result),
              must_conditions: text(body.must_conditions),
              expect_start: text(body.expect_start),
              deadline: text(body.deadline),
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
      buildAssetDraft(row),
      `asset:${row.id}`,
    );
    await this.prisma.assetRequest.update({
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
      request_no: row.requestNo,
      status: 'OPEN',
      aiworkinPublished: sync.published,
      platform_listing_id: sync.listingId,
      aiworkin_sync_status: sync.status,
      tip: sync.tip,
    };
  }
  /** 编辑资产需求：只按身份判定（创建人或平台管理员），能不能改由接口返回值决定。 */
  async update(user: CurrentUser, id: number, body: Record<string, unknown>) {
    const row = await this.requireOwner(user, id);
    const region = regionFromBody(body);
    await this.prisma.assetRequest.update({
      where: { id },
      data: {
        ...pickEditable(normalizeCategoryEdit('ASSET', body), ASSET_EDITABLE),
        ...(region
          ? { ...regionColumns(region), regionScope: region.label }
          : {}),
      },
    });
    await this.identity.audit(
      user.userId,
      'ASSET_UPDATE',
      `#${id} ${row.requestNo}`,
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
    await this.prisma.assetRequest.delete({ where: { id } });
    await this.identity.audit(
      user.userId,
      'ASSET_DELETE',
      `#${id} ${row.requestNo}`,
    );
    return { id, deleted: true };
  }
  private async requireOwner(user: CurrentUser, id: number) {
    const row = await this.prisma.assetRequest.findUnique({ where: { id } });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '资产需求不存在');
    }
    if (!isDemandOwner(user, row, this.identity.isPlatformAdmin(user))) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅需求创建人或平台管理员可操作，服务商不可修改用户填写的需求内容',
      );
    }
    return row;
  }
  /** 承接（居间承办）：企业与服务商身份一致 —— 先发布过资产服务才可承接；承接即绑定承办人并带出执行联系方式。 */
  async accept(user: CurrentUser, id: number) {
    await this.identity.requireRoles(
      user,
      'SERVICE_PROVIDER',
      'ENTERPRISE_USER',
    );
    if (!(await this.hasPublishedService(user.userId))) {
      throw new BusinessException(
        ErrorCode.CONTRACT_STATE,
        '承接资产需求前请先在「服务发布」页签发布一条「资产交易」类目服务',
      );
    }
    const row = await this.prisma.assetRequest.findUnique({ where: { id } });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '资产需求不存在');
    }
    if (row.status !== 'OPEN' || row.providerUserId) {
      throw new BusinessException(ErrorCode.ORDER_STATE, '该资产需求已被接收');
    }
    const name = await this.users.displayName(user.userId);
    const ack = `承接方「${name}」已接收需求，等待对接`;
    const brokerContact = await this.brokerContact(user.userId);
    await this.prisma.assetRequest.update({
      where: { id },
      data: {
        providerUserId: user.userId,
        staffUserId: user.userId,
        brokerName: name,
        status: 'PENDING',
        ...(brokerContact.name || brokerContact.phone
          ? {
              providerContactName: brokerContact.name,
              providerContactPhone: brokerContact.phone,
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
      requestId: row.id,
      request_no: row.requestNo,
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
    if (!content) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '消息内容不能为空');
    }
    // 「发给你了就是接收了」：已发布服务的承接方首次回复即接单
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
        '仅需求用户与居间承办人可发言',
      );
    }
    const name =
      (speaker.side === 'ENTERPRISE' && speaker.enterprise?.name) ||
      (await this.users.displayName(user.userId));
    const messages = appendMessage(
      row.messages,
      speaker.side,
      name,
      content,
      conversationId,
    );
    await this.prisma.assetRequest.update({
      where: { id },
      data: { messages },
    });
    const sync = await this.demandSync.reply(
      token,
      isLocalConversation(conversationId) ? '' : conversationId,
      content,
    );
    return {
      requestId: id,
      request_no: row.requestNo,
      messages,
      aiworkin_sync: sync.synced,
      tip: sync.tip,
    };
  }
  /** 改联系方式（临时换人）：需求用户改发起侧、居间承办人改执行侧，不受状态限制。 */
  async updateContacts(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown> = {},
  ) {
    const row = await this.requireAccess(user, id);
    const side = await this.identity.contactSide(user, row);
    const updated = await this.prisma.assetRequest.update({
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
      'ASSET_CONTACTS_UPDATE',
      `#${id} ${row.requestNo} 联系方式`,
    );
    return {
      id,
      contact_name: updated.contactName,
      contact_phone: updated.contactPhone,
      provider_contact_name: updated.providerContactName,
      provider_contact_phone: updated.providerContactPhone,
    };
  }
  /**
   * 承接资格（企业与服务商身份同一门槛）：本人已发布过「资产交易」类目服务。
   * 本地 AIworkin 通道关闭时发布态永远停留在草稿，故**有服务记录即算**。
   */
  private async hasPublishedService(userId: string) {
    const row = await this.prisma.providerServiceListing.findFirst({
      where: { providerUserId: userId, domain: 'ASSET' },
      select: { id: true },
    });
    return !!row;
  }
  /** 居间承接人联系方式：服务商备案联系人 → 企业身份承接时回退企业档案。 */
  private async brokerContact(userId: string) {
    const provider = await this.contacts.provider(userId, userId);
    if (provider.name || provider.phone) return provider;
    return this.contacts.enterprise(userId, 0);
  }
  private async claimOnReply(user: CurrentUser, id: number) {
    const row = await this.prisma.assetRequest.findUnique({ where: { id } });
    if (!row) return;
    if (row.status !== 'OPEN' || row.providerUserId) return;
    if (row.createdBy === user.userId) return;
    if (this.identity.isPlatformAdmin(user)) return;
    if (!(await this.hasPublishedService(user.userId))) return;
    const name = await this.users.displayName(user.userId);
    const ack = `承接方「${name}」已回复并接收需求，等待对接`;
    const brokerContact = await this.brokerContact(user.userId);
    await this.prisma.assetRequest.update({
      where: { id },
      data: {
        providerUserId: user.userId,
        staffUserId: user.userId,
        brokerName: name,
        status: 'PENDING',
        ...(brokerContact.name || brokerContact.phone
          ? {
              providerContactName: brokerContact.name,
              providerContactPhone: brokerContact.phone,
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
  private async requireAccess(
    user: CurrentUser,
    id: number,
    allowPool = false,
  ) {
    const row = await this.prisma.assetRequest.findUnique({ where: { id } });
    return requireDemandAccess(
      {
        prisma: this.prisma,
        identity: this.identity,
        poolEligible: (current) => this.hasPublishedService(current.userId),
      },
      '资产需求不存在',
      user,
      row,
      allowPool,
    );
  }
}
const ASSET_TYPE_LABEL = '资产租售与居间服务';
/** 可编辑字段：前端字段名 → 数据库列名（与 create 同一套 snake_case 表单字段名）。 */
const ASSET_EDITABLE: Record<string, string> = {
  title: 'title',
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
function buildAssetDraft(
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
    subcategoryId: requireSubCategoryId('ASSET', row.subCategoryId),
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
      category: ASSET_TYPE_LABEL,
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
function decorateAsset(row: {
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
    feedback: feedbackProgress(row.status, ASSET_NODES),
  };
}
