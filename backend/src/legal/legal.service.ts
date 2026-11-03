import { pageParam as listPageParam } from '../common/api';
import { allocateNo } from '../common/document-number';
import { Prisma } from '../../generated/prisma';
import {
  buildDraftFromFields,
  DemandSyncService,
} from '../aiworkin/demand-sync.service';
import { DemandDraft } from '../aiworkin/aiworkin.types';
import {
  requireSubCategoryId,
  withCategoryLabels,
} from '../aiworkin/category-catalog';
import { visibilityWhere } from '../shared/visibility';
import { toJsonArray } from '../shared/json-value';
import {
  isDemandOwner,
  requireEnterpriseDemandAccess,
} from '../shared/demand-access';
import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { text } from '../common/api';
import { ErrorCode } from '../common/error-code';
import { UserLookupService } from '../directory/user-lookup.service';
import { ContractsService } from '../contracts/contracts.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  appendMessage,
  asMessages,
  demandText,
  isLocalConversation,
  msgTime,
  replyPartyCount,
} from '../shared/channel-message';
import {
  contactSnapshot,
  readContact,
  sideContactBody,
} from '../shared/contacts';
import { requireLocation, resolveLocation } from '../shared/locations';
import { ContactResolver } from '../shared/contacts.service';
import {
  RESOURCE_VISIBLE_STATUS,
  approvedProviderIds,
  assertResourceNotReferenced,
  assertResourceOwned,
  resourceKeywordOr,
  resourceRegionScope,
} from '../shared/resource-library';
import {
  RegionFilter,
  RegionRow,
  demandGeoConfig,
  regionFromBody,
  regionColumns,
  regionFilterWhere,
  regionForCreate,
} from '../shared/region-scope';
export class LegalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly contracts: ContractsService,
    private readonly users: UserLookupService,
    private readonly demandSync: DemandSyncService,
    private readonly contacts: ContactResolver,
  ) {}
  /**
   * 资源库查询（2026-09-25 收口）：**筛选只有省、市与关键词** —— 市未选省时不生效，
   * 未填省市的资源不参与省市匹配（与名录同口径）；原「擅长领域 / 地区自由文本」筛选已删除
   * （领域是登记表单里的标签维度，选项与库内实际取值不一致，选了必然空集）。
   * 展示口径：**服务商备案通过（服务商管理中该服务商的法律服务类目为「通过」）即对外展示**，
   * 不需要逐条平台审核；该类目被停用后其资源同步不再展示。
   * 平台统筹资源（无归属服务商）直接展示；存量「不再展示 / 已驳回」保持不展示。
   */
  async lawyers(query: LawyerQuery = {}) {
    const approved = await approvedProviderIds(this.prisma, 'LEGAL_SERVICE');
    const keywordOr = resourceKeywordOr(query.keyword);
    const where: Prisma.LawyerResourceWhereInput = {
      status: RESOURCE_VISIBLE_STATUS,
      OR: [{ providerUserId: '' }, { providerUserId: { in: approved } }],
      ...resourceRegionScope(query),
      ...(keywordOr.length ? { AND: [{ OR: keywordOr }] } : {}),
    };
    if (query.kind && ['LAWYER', 'LAW_FIRM'].includes(query.kind)) {
      where.kind = query.kind;
    }
    const rows = await this.prisma.lawyerResource.findMany({
      where,
      orderBy: [{ id: 'desc' }],
    });
    return this.withStaff(rows);
  }
  /** 公开律师随账号显示（姓名 / 账号名），对齐 demo withStaff。 */
  private async withStaff<
    T extends {
      staffUserId: string;
    },
  >(rows: T[]) {
    const ids = [
      ...new Set(rows.map((row) => row.staffUserId).filter(Boolean)),
    ];
    if (!ids.length) return rows;
    const found = await this.users.lookup(ids);
    const map = new Map(found.map((item) => [item.id, item]));
    return rows.map((row) => ({
      ...row,
      staffName: map.get(row.staffUserId)?.displayName || '',
      staffUsername: map.get(row.staffUserId)?.username || '',
    }));
  }
  async createRequest(
    user: CurrentUser,
    body: Record<string, string>,
    token = '',
  ) {
    await this.identity.requireRoles(user, 'ENTERPRISE_USER');
    const title = String(body.title || '').trim();
    if (!title)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写需求标题');
    const eps = await this.identity.myEnterprises(user.userId);
    if (!eps.length)
      throw new BusinessException(ErrorCode.FORBIDDEN, '请先完善企业信息');
    const contract = await this.contracts.requireActiveContract(
      eps[0].id,
      'LEGAL_SERVICE',
    );

    const staffUserId = await this.identity.assignedStaffFor(
      contract.providerUserId,
      eps[0].id,
    );
    // 地域范围三态（不限制 / 指定地区 / 经纬度坐标）：跟着需求本身走，不取发布主体档案
    const region = regionForCreate(body);
    // fields 是需求明细的展示来源：结构化三态另存列，自由文本列改存派生文案
    const formBody = { ...body, region_scope: region.label };
    const row = await this.prisma.legalRequest.create({
      data: {
        requestNo: await allocateNo(this.prisma, 'FL'),
        contractId: contract.id,
        enterpriseId: eps[0].id,
        createdBy: user.userId,
        providerUserId: contract.providerUserId,
        staffUserId,
        lawyerId: contract.designatedAgentId,
        category: body.category || 'CONSULT',
        // 二级类目取 AIworkin 法律服务公司子树（本模块固定「法律服务」）
        subCategoryId: requireSubCategoryId('LEGAL', body.sub_category_id),
        title,
        ...regionColumns(region),
        fields: formBody,
        status: 'OPEN',
        ...(await this.contacts.stage(
          {
            enterpriseUserId: eps[0].userId,
            enterpriseId: eps[0].id,
            staffUserId,
            providerUserId: contract.providerUserId,
          },
          body,
        )),
        messages: [
          {
            role: 'ENTERPRISE',
            name: eps[0].name,
            time: msgTime(),
            text: demandText(title, '法律服务', formBody),
          },
        ],
      },
    });
    const sync = await this.demandSync.publish(
      token,
      buildLegalDraft(
        row.title,
        row.fields,
        row.category,
        row.subCategoryId,
        row,
      ),
      `legal:${row.id}`,
    );
    await this.prisma.legalRequest.update({
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
      status: row.status,
      contact_name: row.contactName,
      contact_phone: row.contactPhone,
      provider_contact_name: row.providerContactName,
      provider_contact_phone: row.providerContactPhone,
      aiworkinPublished: sync.published,
      platform_listing_id: sync.listingId,
      aiworkin_sync_status: sync.status,
      tip: sync.tip,
    };
  }
  private async listScope(
    user: CurrentUser,
    region: RegionFilter = {},
  ): Promise<import('../../generated/prisma').Prisma.LegalRequestWhereInput> {
    const [eps, identity] = await Promise.all([
      this.identity.myEnterprises(user.userId),
      this.identity.currentIdentity(user),
    ]);
    // 签约主体=服务商，作业由承办人完成；数据只有承办人与企业当事人可见

    return {
      ...visibilityWhere({
        isAdmin: this.identity.isPlatformAdmin(user),
        identity,
        userId: user.userId,
        enterpriseIds: eps.map((item) => item.id),
      }),
      // 省、市按需求本身记录的地域过滤（不限制＝两侧皆不筛选）
      ...regionFilterWhere(region),
    };
  }
  async list(user: CurrentUser, region: RegionFilter = {}) {
    const where = await this.listScope(user, region);
    const rows = await this.prisma.legalRequest.findMany({
      where,
      orderBy: { id: 'desc' },
    });
    return rows.map((row) => ({
      ...withCategoryLabels(row),
      conversationCount: replyPartyCount(asMessages(row.messages)),
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
    const where: import('../../generated/prisma').Prisma.LegalRequestWhereInput =
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
      this.prisma.legalRequest.findMany({
        where,
        orderBy: { id: query.sort ?? 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.legalRequest.count({ where }),
    ]);
    return {
      list: rows.map((row) => ({
        ...withCategoryLabels(row),
        conversationCount: replyPartyCount(asMessages(row.messages)),
      })),
      total,
      page,
      pageSize,
    };
  }
  async listStats(user: CurrentUser) {
    const where = await this.listScope(user);
    const groups = await this.prisma.legalRequest.groupBy({
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
    const row = await this.prisma.legalRequest.findFirst({
      where: { AND: [permission, { id }] },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '记录不存在或无权访问');
    const rows = [row];
    return rows.map((row) => ({
      ...withCategoryLabels(row),
      conversationCount: replyPartyCount(asMessages(row.messages)),
    }))[0];
  }

  async messages(user: CurrentUser, id: number, token = '') {
    const row = await this.require(user, id);
    const channel = await this.demandSync.conversations(
      token,
      row.platformListingId,
      row.platformMatchRunId,
      asMessages(row.messages),
    );
    return { id, conversations: channel.conversations, source: channel.source };
  }
  async postMessage(
    user: CurrentUser,
    id: number,
    text: string,
    token = '',
    conversationId = '',
  ) {
    const row = await this.require(user, id);
    const content = text.trim();
    if (!content)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '消息不能为空');
    // 服务方标签按「承办人」判定：承办职员发言也属于服务方
    const isProvider =
      !this.identity.isPlatformAdmin(user) &&
      (await this.identity.canWorkOn(user, row));
    const messages = appendMessage(
      row.messages,
      isProvider ? 'PROVIDER' : 'ENTERPRISE',
      user.username,
      content,
      conversationId,
    );
    await this.prisma.legalRequest.update({
      where: { id },
      data: { messages: messages },
    });
    const sync = await this.demandSync.reply(
      token,
      isLocalConversation(conversationId) ? '' : conversationId,
      content,
    );
    return { id, messages, aiworkin_sync: sync.synced, tip: sync.tip };
  }
  async publish(user: CurrentUser, id: number, token = '') {
    const row = await this.require(user, id);
    if (row.platformListingId) {
      return {
        id,
        aiworkinPublished: row.aiworkinPublished,
        platform_listing_id: row.platformListingId,
        aiworkin_sync_status: row.aiworkinSyncStatus,
        tip: '该需求已发布至 AIworkin 平台通道',
      };
    }
    const sync = await this.demandSync.publish(
      token,
      buildLegalDraft(
        row.title,
        row.fields,
        row.category,
        row.subCategoryId,
        row,
      ),
      `legal:${id}`,
    );
    await this.prisma.legalRequest.update({
      where: { id },
      data: {
        aiworkinPublished: sync.published,
        platformListingId: sync.listingId,
        platformMatchRunId: sync.matchRunId,
        aiworkinSyncStatus: sync.status,
        aiworkinSyncError: sync.error,
      },
    });
    return {
      id,
      aiworkinPublished: sync.published,
      platform_listing_id: sync.listingId,
      aiworkin_sync_status: sync.status,
      tip: sync.tip,
    };
  }
  /** 登记律所资源：服务商备案通过后登记即对外展示（无资源级平台审核）。律师资源仍只能通过挂靠成为公开律师。 */
  async createLawFirm(user: CurrentUser, body: Record<string, unknown>) {
    await this.identity.requireRoles(user, 'SERVICE_PROVIDER');
    const name = text(body.name || '').trim();
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写律所名称');
    const location = requireLocation(body);
    const row = await this.prisma.lawyerResource.create({
      data: {
        kind: 'LAW_FIRM',
        name,
        organization: name,
        province: location.province,
        city: location.city,
        areas: toJsonArray(body.areas),
        qualification: text(body.qualification || ''),
        licenseNo: text(body.licenseNo || ''),
        intro: text(body.intro || ''),
        cases: toJsonArray(body.cases),
        status: 'APPROVED',
        providerUserId: user.userId,
        ownerUserId: user.userId,
      },
    });
    await this.identity.audit(
      user.userId,
      'LEGAL_RESOURCE_CREATE',
      `#${row.id} ${name}`,
    );
    return row;
  }
  async updateLawyer(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown>,
  ) {
    const row = await this.requireResource(user, id);
    const name = text(body.name ?? row.name).trim();
    if (!name) throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写名称');
    const location = resolveLocation(body, row);
    const updated = await this.prisma.lawyerResource.update({
      where: { id },
      data: {
        name,
        organization: text(body.organization ?? row.organization),
        province: location.province,
        city: location.city,
        areas: body.areas === undefined ? undefined : toJsonArray(body.areas),
        qualification: text(body.qualification ?? row.qualification),
        licenseNo: text(body.licenseNo ?? row.licenseNo),
        intro: text(body.intro ?? row.intro ?? ''),
        cases: body.cases === undefined ? undefined : toJsonArray(body.cases),
      },
    });
    await this.identity.audit(
      user.userId,
      'LEGAL_RESOURCE_UPDATE',
      `#${id} ${name}`,
    );
    return updated;
  }
  async removeLawyer(user: CurrentUser, id: number) {
    const row = await this.requireResource(user, id);
    const [contracts, requests] = await Promise.all([
      this.prisma.contract.count({ where: { designatedAgentId: id } }),
      this.prisma.legalRequest.count({ where: { lawyerId: id } }),
    ]);
    assertResourceNotReferenced(
      [contracts, requests],
      `该资源已被 ${contracts} 个签约、${requests} 条法律需求引用，不可删除；请先处理相关签约与法律需求`,
    );
    await this.prisma.lawyerResource.delete({ where: { id } });
    await this.identity.audit(
      user.userId,
      'LEGAL_RESOURCE_DELETE',
      `#${id} ${row.name}`,
    );
    return { id, deleted: true };
  }
  private async requireResource(user: CurrentUser, id: number) {
    const row = await this.prisma.lawyerResource.findUnique({ where: { id } });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '律师/律所资源不存在');
    }
    const owned =
      row.ownerUserId === user.userId || row.providerUserId === user.userId;
    assertResourceOwned(owned, this.identity.isPlatformAdmin(user));
    return row;
  }
  /** 编辑法律需求：仅创建人或平台管理员。 */
  async updateRequest(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown>,
  ) {
    const row = await this.require(user, id);
    if (!isDemandOwner(user, row, this.identity.isPlatformAdmin(user))) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅需求创建人可修改',
      );
    }
    const data: Prisma.LegalRequestUpdateInput = {};
    if (body.title !== undefined) {
      const title = text(body.title).trim();
      if (!title) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写需求标题');
      }
      data.title = title;
    }
    if (body.category !== undefined) {
      data.category = text(body.category);
    }
    if (body.sub_category_id !== undefined) {
      data.subCategoryId = requireSubCategoryId('LEGAL', body.sub_category_id);
    }
    if (body.fields !== undefined && typeof body.fields === 'object') {
      data.fields = body.fields as Prisma.InputJsonValue;
    }
    // 地域范围三态：入参带三态才改；未带则保持原值（fields 内的展示文案同步为派生文案）
    const region = regionFromBody(body);
    if (region) {
      Object.assign(data, regionColumns(region));
      const baseFields =
        body.fields !== undefined && typeof body.fields === 'object'
          ? (body.fields as Record<string, unknown>)
          : row.fields && typeof row.fields === 'object'
            ? (row.fields as Record<string, unknown>)
            : {};
      data.fields = {
        ...baseFields,
        region_scope: region.label,
      };
    }
    // 联系方式可单独修改（临时换人），与业务字段解耦
    const manual = {
      contact: readContact(body, 'contact'),
      providerContact: readContact(body, 'provider_contact'),
    };
    if (
      manual.contact.name ||
      manual.contact.phone ||
      manual.providerContact.name ||
      manual.providerContact.phone
    ) {
      Object.assign(
        data,
        contactSnapshot(
          {
            contact: { name: row.contactName, phone: row.contactPhone },
            providerContact: {
              name: row.providerContactName,
              phone: row.providerContactPhone,
            },
          },
          body,
        ),
      );
    }
    const updated = await this.prisma.legalRequest.update({
      where: { id },
      data,
    });
    await this.identity.audit(
      user.userId,
      'LEGAL_REQUEST_UPDATE',
      `#${id} ${row.requestNo}`,
    );
    return {
      id,
      contact_name: updated.contactName,
      contact_phone: updated.contactPhone,
      provider_contact_name: updated.providerContactName,
      provider_contact_phone: updated.providerContactPhone,
      tip: row.platformListingId
        ? '该需求已发布至 AIworkin 平台通道，修改将在下次同步生效'
        : '已保存',
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
    const row = await this.require(user, id);
    const side = await this.identity.contactSide(user, row);
    const updated = await this.prisma.legalRequest.update({
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
      'LEGAL_CONTACTS_UPDATE',
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
  async removeRequest(user: CurrentUser, id: number) {
    const row = await this.require(user, id);
    if (!isDemandOwner(user, row, this.identity.isPlatformAdmin(user))) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅需求创建人可删除',
      );
    }
    await this.prisma.legalRequest.delete({ where: { id } });
    await this.identity.audit(
      user.userId,
      'LEGAL_REQUEST_DELETE',
      `#${id} ${row.requestNo}`,
    );
    return { id, deleted: true };
  }
  /** 单据可达性：平台管理员 / 承办人（服务商账号或承办职员） / 企业当事人。 */
  private async require(user: CurrentUser, id: number) {
    const row = await this.prisma.legalRequest.findUnique({ where: { id } });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '法律需求不存在');
    return requireEnterpriseDemandAccess(
      { identity: this.identity },
      user,
      row,
    );
  }
}
/** 资源库筛选参数（2026-09-25 起＝省 / 市 / 关键词，市需先选省） */
export type LawyerQuery = {
  kind?: string;
  province?: string;
  city?: string;
  keyword?: string;
};
function buildLegalDraft(
  title: string,
  fields: unknown,
  category: string,
  subCategoryId: string,
  region: RegionRow,
): DemandDraft {
  const record =
    fields && typeof fields === 'object'
      ? (fields as Record<string, unknown>)
      : {};
  return buildDraftFromFields(record, {
    title,
    categoryLabel: category || '法律咨询',
    fallbackDescription: '企业法律需求',
    subcategoryId: requireSubCategoryId('LEGAL', subCategoryId),
    attributes: { legalCategory: category },
    a2aConfig: demandGeoConfig(region),
  });
}
