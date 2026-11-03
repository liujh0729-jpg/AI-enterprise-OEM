import { pageParam as listPageParam, text } from '../common/api';
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
import { ErrorCode } from '../common/error-code';
import { ContractsService } from '../contracts/contracts.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserLookupService } from '../directory/user-lookup.service';
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

const SERVICE_TYPE = 'THINK_TANK_SERVICE';

export class ThinkTankService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly contracts: ContractsService,
    private readonly demandSync: DemandSyncService,
    private readonly contacts: ContactResolver,
    private readonly users: UserLookupService,
  ) {}
  /**
   * 资源库查询：机构资源来自 think_tank_experts；**专家不落表**，由「挂靠通过」派生
   * （服务商备案通过 + staff_applications 该类目 APPROVED + provider_staff 仍 ACTIVE）。
   * 筛选只有省、市与关键词（与法律/知产同口径）。
   */
  async experts(query: ThinkTankExpertQuery = {}) {
    const approved = await approvedProviderIds(this.prisma, SERVICE_TYPE);
    if (query.kind === 'EXPERT') return this.expertRows(approved, query);
    const keywordOr = resourceKeywordOr(query.keyword);
    const where: Prisma.ThinkTankExpertWhereInput = {
      kind: 'ORGANIZATION',
      status: RESOURCE_VISIBLE_STATUS,
      OR: [{ providerUserId: '' }, { providerUserId: { in: approved } }],
      ...resourceRegionScope(query),
      ...(keywordOr.length ? { AND: [{ OR: keywordOr }] } : {}),
    };
    return this.prisma.thinkTankExpert.findMany({
      where,
      orderBy: [{ id: 'desc' }],
    });
  }
  /** 专家资源＝挂靠关系派生（只读）：同一职员在同一机构只看最新一条申请。 */
  private async expertRows(approved: string[], query: ThinkTankExpertQuery) {
    if (!approved.length) return [];
    const applications = await this.prisma.staffApplication.findMany({
      where: {
        category: SERVICE_TYPE,
        status: 'APPROVED',
        providerUserId: { in: approved },
      },
      orderBy: [{ id: 'desc' }],
    });
    const latest = new Map<string, (typeof applications)[number]>();
    for (const row of applications) {
      const key = `${row.staffUserId}:${row.providerUserId}`;
      if (!latest.has(key)) latest.set(key, row);
    }
    const pending = [...latest.values()];
    if (!pending.length) return [];
    const staffIds = [...new Set(pending.map((row) => row.staffUserId))];
    const providerIds = [...new Set(pending.map((row) => row.providerUserId))];
    const [profiles, bindings, orgApps, accounts] = await Promise.all([
      this.prisma.staffProfile.findMany({
        where: { userId: { in: staffIds } },
      }),
      this.prisma.providerStaff.findMany({
        where: { staffUserId: { in: staffIds }, status: 'ACTIVE' },
        select: { providerUserId: true, staffUserId: true },
      }),
      this.prisma.providerApplication.findMany({
        where: { userId: { in: providerIds }, status: 'APPROVED' },
        orderBy: { id: 'desc' },
      }),
      this.users.lookup(staffIds),
    ]);
    const bound = new Set(
      bindings.map((row) => `${row.staffUserId}:${row.providerUserId}`),
    );
    const profileMap = new Map(profiles.map((row) => [row.userId, row]));
    const accountMap = new Map(accounts.map((row) => [row.id, row]));
    const orgMap = new Map<string, string>();
    for (const app of orgApps) {
      if (!orgMap.has(app.userId)) orgMap.set(app.userId, app.orgName || '');
    }
    const province = text(query.province).trim();
    const city = text(query.city).trim();
    const keyword = text(query.keyword).trim().toLowerCase();
    return pending
      .filter((row) => bound.has(`${row.staffUserId}:${row.providerUserId}`))
      .map((row) => {
        const profile = profileMap.get(row.staffUserId);
        const account = accountMap.get(row.staffUserId);
        const org = orgMap.get(row.providerUserId) || '';
        return {
          id: row.id,
          kind: 'EXPERT',
          name:
            profile?.realName ||
            account?.displayName ||
            account?.username ||
            row.staffUserId,
          organization: org || account?.displayName || row.providerUserId,
          region: '',
          province: profile?.province || '',
          city: profile?.city || '',
          areas: [] as string[],
          qualification: profile?.qualification || '',
          licenseNo: '',
          intro: profile?.intro || '',
          cases: [] as unknown[],
          staffName: profile?.realName || account?.displayName || '',
          staffUsername: account?.username || '',
          ownerUserId: '',
          status: 'APPROVED',
          providerUserId: row.providerUserId,
          staffUserId: row.staffUserId,
          createdAt: row.createdAt.toISOString(),
        };
      })
      .filter(
        (row) =>
          (!province || row.province === province) &&
          (!city || row.city === city) &&
          (!keyword ||
            `${row.name}${row.organization}${row.intro}`
              .toLowerCase()
              .includes(keyword)),
      );
  }
  private async listScope(
    user: CurrentUser,
    region: RegionFilter = {},
  ): Promise<
    import('../../generated/prisma').Prisma.ThinkTankRequestWhereInput
  > {
    const [eps, identity] = await Promise.all([
      this.identity.myEnterprises(user.userId),
      this.identity.currentIdentity(user),
    ]);
    return {
      ...visibilityWhere({
        isAdmin: this.identity.isPlatformAdmin(user),
        identity,
        userId: user.userId,
        enterpriseIds: eps.map((item) => item.id),
      }),
      ...regionFilterWhere(region),
    };
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
    const where: import('../../generated/prisma').Prisma.ThinkTankRequestWhereInput =
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
      this.prisma.thinkTankRequest.findMany({
        where,
        orderBy: { id: query.sort ?? 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.thinkTankRequest.count({ where }),
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
    const groups = await this.prisma.thinkTankRequest.groupBy({
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
    const row = await this.prisma.thinkTankRequest.findFirst({
      where: { AND: [permission, { id }] },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '记录不存在或无权访问');
    return {
      ...withCategoryLabels(row),
      conversationCount: replyPartyCount(asMessages(row.messages)),
    };
  }
  async create(user: CurrentUser, body: Record<string, string>, token = '') {
    await this.identity.requireRoles(user, 'ENTERPRISE_USER');
    const title = String(body.title || '').trim();
    if (!title)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写需求标题');
    const eps = await this.identity.myEnterprises(user.userId);
    if (!eps.length)
      throw new BusinessException(ErrorCode.FORBIDDEN, '请先完善企业信息');
    const contract = await this.contracts.requireActiveContract(
      eps[0].id,
      SERVICE_TYPE,
    );
    const staffUserId = await this.identity.assignedStaffFor(
      contract.providerUserId,
      eps[0].id,
    );
    // 地域范围三态（不限制 / 指定地区 / 经纬度坐标）：跟着需求本身走
    const region = regionForCreate(body);
    const formBody = { ...body, region_scope: region.label };
    const row = await this.prisma.thinkTankRequest.create({
      data: {
        requestNo: await allocateNo(this.prisma, 'ZK'),
        contractId: contract.id,
        enterpriseId: eps[0].id,
        createdBy: user.userId,
        providerUserId: contract.providerUserId,
        staffUserId,
        category: body.category || 'CONSULT',
        // 二级类目取 AIworkin 企业商事财税子公司树（本模块固定「智库咨询」）
        subCategoryId: requireSubCategoryId('THINK_TANK', body.sub_category_id),
        title,
        ...regionColumns(region),
        fields: formBody,
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
            text: demandText(title, '智库咨询', formBody),
          },
        ],
      },
    });
    const sync = await this.demandSync.publish(
      token,
      buildThinkTankDraft(row.title, row.fields, row.subCategoryId, row),
      `think-tank:${row.id}`,
    );
    await this.prisma.thinkTankRequest.update({
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
    await this.prisma.thinkTankRequest.update({
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
      buildThinkTankDraft(row.title, row.fields, row.subCategoryId, row),
      `think-tank:${id}`,
    );
    await this.prisma.thinkTankRequest.update({
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
  /** 登记机构资源：服务商备案通过后登记即对外展示（专家资源由挂靠派生，不可登记）。 */
  async createExpert(user: CurrentUser, body: Record<string, unknown>) {
    await this.identity.requireRoles(user, 'SERVICE_PROVIDER');
    if (body.kind === 'EXPERT') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '专家资源由挂靠产生，不支持直接登记',
      );
    }
    const name = text(body.name || '').trim();
    if (!name) throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写名称');
    const location = requireLocation(body);
    const row = await this.prisma.thinkTankExpert.create({
      data: {
        kind: 'ORGANIZATION',
        name,
        organization: text(body.organization || name),
        province: location.province,
        city: location.city,
        areas: toJsonArray(body.areas),
        qualification: text(body.qualification || ''),
        licenseNo: text(body.licenseNo || ''),
        intro: text(body.intro || ''),
        cases: toJsonArray(body.cases),
        ownerUserId: user.userId,
        providerUserId: user.userId,
        status: 'APPROVED',
      },
    });
    await this.identity.audit(
      user.userId,
      'THINK_TANK_RESOURCE_CREATE',
      `#${row.id} ${name}`,
    );
    return row;
  }
  async updateExpert(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown>,
  ) {
    const row = await this.requireOrganization(user, id);
    const name = text(body.name ?? row.name).trim();
    if (!name) throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写名称');
    const location = resolveLocation(body, row);
    const updated = await this.prisma.thinkTankExpert.update({
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
      'THINK_TANK_RESOURCE_UPDATE',
      `#${id} ${name}`,
    );
    return updated;
  }
  async removeExpert(user: CurrentUser, id: number) {
    const row = await this.requireOrganization(user, id);
    const contracts = await this.prisma.contract.count({
      where: { designatedAgentId: id, serviceType: SERVICE_TYPE },
    });
    assertResourceNotReferenced(
      [contracts],
      `该资源已被 ${contracts} 个签约引用，不可删除；请先处理相关签约`,
    );
    await this.prisma.thinkTankExpert.delete({ where: { id } });
    await this.identity.audit(
      user.userId,
      'THINK_TANK_RESOURCE_DELETE',
      `#${id} ${row.name}`,
    );
    return { id, deleted: true };
  }
  private async requireOrganization(user: CurrentUser, id: number) {
    const row = await this.prisma.thinkTankExpert.findUnique({ where: { id } });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '智库资源不存在');
    }
    if (row.kind !== 'ORGANIZATION') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '专家资源由挂靠产生，不可直接修改或删除',
      );
    }
    assertResourceOwned(
      row.ownerUserId === user.userId,
      this.identity.isPlatformAdmin(user),
    );
    return row;
  }
  /** 编辑智库需求：仅创建人或平台管理员。 */
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
    const data: Prisma.ThinkTankRequestUpdateInput = {};
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
      data.subCategoryId = requireSubCategoryId(
        'THINK_TANK',
        body.sub_category_id,
      );
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
    const updated = await this.prisma.thinkTankRequest.update({
      where: { id },
      data,
    });
    await this.identity.audit(
      user.userId,
      'THINK_TANK_REQUEST_UPDATE',
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
   */
  async updateContacts(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown> = {},
  ) {
    const row = await this.require(user, id);
    const side = await this.identity.contactSide(user, row);
    const updated = await this.prisma.thinkTankRequest.update({
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
      'THINK_TANK_CONTACTS_UPDATE',
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
    await this.prisma.thinkTankRequest.delete({ where: { id } });
    await this.identity.audit(
      user.userId,
      'THINK_TANK_REQUEST_DELETE',
      `#${id} ${row.requestNo}`,
    );
    return { id, deleted: true };
  }
  /** 单据可达性：平台管理员 / 承办人（服务商账号或承办职员） / 企业当事人。 */
  private async require(user: CurrentUser, id: number) {
    const row = await this.prisma.thinkTankRequest.findUnique({
      where: { id },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '智库需求不存在');
    return requireEnterpriseDemandAccess(
      { identity: this.identity },
      user,
      row,
    );
  }
}

function buildThinkTankDraft(
  title: string,
  fields: unknown,
  subCategoryId: string,
  region: RegionRow,
): DemandDraft {
  const record =
    fields && typeof fields === 'object'
      ? (fields as Record<string, unknown>)
      : {};
  return buildDraftFromFields(record, {
    title,
    categoryLabel: '智库咨询',
    fallbackDescription: '企业智库咨询需求',
    subcategoryId: requireSubCategoryId('THINK_TANK', subCategoryId),
    attributes: { thinkTankCategory: 'CONSULT' },
    a2aConfig: demandGeoConfig(region),
  });
}

/** 资源库筛选参数（省 / 市 / 关键词，市需先选省；kind 为分区） */
export type ThinkTankExpertQuery = {
  kind?: string;
  province?: string;
  city?: string;
  keyword?: string;
};
