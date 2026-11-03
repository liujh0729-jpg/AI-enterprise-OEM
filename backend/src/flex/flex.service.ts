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
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { pickEditable } from '../shared/pick-editable';
import {
  appendMessage,
  asMessages,
  isLocalConversation,
  msgTime,
  replyPartyCount,
} from '../shared/channel-message';
import { visibilityWhere } from '../shared/visibility';
import { asJsonArray } from '../shared/json-value';
import {
  isDemandOwner,
  requireEnterpriseDemandAccess,
} from '../shared/demand-access';
import { BusinessException } from '../common/business.exception';
import { nowStamp } from '../common/constants';
import { ErrorCode } from '../common/error-code';
import { ContractsService } from '../contracts/contracts.service';
import { UserLookupService } from '../directory/user-lookup.service';
import { IdentityService } from '../identity/identity.service';
import { OssService } from '../oss/oss.service';
import { parseAttachmentFiles } from '../oss/attachment-files';
import { PrismaService } from '../prisma/prisma.service';
import { sideContactBody } from '../shared/contacts';
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
/** 进件材料文件（挂在 FlexOnboarding.attachments[].files）。 */
export type OnboardingFile = {
  id: string;
  name: string;
  size: number;
  url: string;
  uploaded_at: string;
};
const WORK_TYPE_LABELS: Record<string, string> = {
  FULLTIME: '全职',
  PARTTIME: '兼职',
  TEMPORARY: '临时',
};
/** 候选人阶段（需求 5.6.3：候选人推荐、面试/到岗安排）。 */
const CANDIDATE_STAGES: Record<string, string> = {
  RECOMMENDED: '已推荐',
  INTERVIEW: '面试中',
  HIRED: '已到岗',
  REJECTED: '未通过',
};
export class FlexService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly contracts: ContractsService,
    private readonly demandSync: DemandSyncService,
    private readonly users: UserLookupService,
    private readonly contacts: ContactResolver,
    private readonly oss: OssService,
  ) {}
  /**
   * 资源库查询：按机构 / 代理人两个分区（recordType）分别取数，筛选只有**省、市与关键词**
   * —— 市未选省时不生效，未填省市的资源不参与省市匹配（与名录同口径）。
   * 原「服务商类型 / 服务领域 / 地区自由文本」筛选已删除：类型列历史取值与表单词汇不一致、
   * 领域与地区无数据源，永远选不到。
   * 展示口径：**服务商备案通过（服务商管理中该服务商的灵活用工类目为「通过」）即对外展示**，
   * 不需要逐条平台审核；该类目被停用后其资源同步不再展示。
   * 平台统筹资源（无归属服务商）直接展示；存量「不再展示 / 已驳回」保持不展示。
   */

  async payrollPage(user: CurrentUser, query: Record<string, unknown>) {
    const { page, pageSize, offset } = listPageParam(
      Number(query.page ?? 1),
      Number(query.pageSize ?? 20),
    );
    const scope = await this.payrollScope(user);
    const keyword = text(query.keyword ?? '').trim();
    const where = {
      AND: [
        scope ?? {},
        {
          ...(query.status ? { status: text(query.status) } : {}),
          ...(keyword
            ? {
                OR: [
                  {
                    payrollNo: {
                      contains: keyword,
                    },
                  },
                  {
                    period: { contains: keyword },
                  },
                ],
              }
            : {}),
        },
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.flexPayroll.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.flexPayroll.count({ where }),
    ]);
    return { list: rows, total, page, pageSize };
  }
  async payrollStats(user: CurrentUser) {
    const scope = await this.payrollScope(user);
    const rows = await this.prisma.flexPayroll.groupBy({
      by: ['status'],
      where: scope ?? {},
      _count: { _all: true },
    });
    return {
      total: rows.reduce((sum, row) => sum + row._count._all, 0),
      byStatus: Object.fromEntries(
        rows.map((row) => [row.status, row._count._all]),
      ),
    };
  }

  async payrollDetail(user: CurrentUser, id: number) {
    const scope = await this.payrollScope(user);
    const row = await this.prisma.flexPayroll.findFirst({
      where: { AND: [scope ?? {}, { id }] },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '记录不存在或不可访问');
    return row;
  }
  async onboardingPage(user: CurrentUser, query: Record<string, unknown>) {
    const { page, pageSize, offset } = listPageParam(
      Number(query.page ?? 1),
      Number(query.pageSize ?? 20),
    );
    const scope = await this.onboardingScope(user);

    const where = {
      AND: [
        scope ?? {},
        { ...(query.status ? { status: text(query.status) } : {}) },
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.flexOnboarding.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.flexOnboarding.count({ where }),
    ]);
    return { list: rows, total, page, pageSize };
  }
  async onboardingStats(user: CurrentUser) {
    const scope = await this.onboardingScope(user);
    const rows = await this.prisma.flexOnboarding.groupBy({
      by: ['status'],
      where: scope ?? {},
      _count: { _all: true },
    });
    return {
      total: rows.reduce((sum, row) => sum + row._count._all, 0),
      byStatus: Object.fromEntries(
        rows.map((row) => [row.status, row._count._all]),
      ),
    };
  }

  async onboardingDetail(user: CurrentUser, id: number) {
    const scope = await this.onboardingScope(user);
    const row = await this.prisma.flexOnboarding.findFirst({
      where: { AND: [scope ?? {}, { id }] },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '记录不存在或不可访问');
    return row;
  }
  async providers(query: FlexProviderQuery = {}) {
    const approved = await approvedProviderIds(this.prisma, 'FLEX_WORK');
    const keywordOr = resourceKeywordOr(query.keyword);
    const where: Prisma.FlexProviderWhereInput = {
      status: RESOURCE_VISIBLE_STATUS,
      OR: [{ providerUserId: '' }, { providerUserId: { in: approved } }],
      ...resourceRegionScope(query),
      ...(keywordOr.length ? { AND: [{ OR: keywordOr }] } : {}),
    };
    const recordType = String(query.recordType || '').trim();
    if (recordType && ['ORG', 'AGENT'].includes(recordType)) {
      where.recordType = recordType;
    }
    return this.prisma.flexProvider.findMany({
      where,
      orderBy: [{ id: 'desc' }],
    });
  }
  async createOnboarding(user: CurrentUser, body: Record<string, unknown>) {
    await this.identity.requireRoles(user, 'ENTERPRISE_USER');
    const eps = await this.identity.myEnterprises(user.userId);
    if (!eps.length) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '请先完善企业信息');
    }
    const contract = await this.contracts.requireActiveContract(
      eps[0].id,
      'FLEX_WORK',
    );
    // 同一企业同一服务商不可重复提交待审进件
    const pending = await this.prisma.flexOnboarding.findFirst({
      where: {
        enterpriseId: eps[0].id,
        providerUserId: contract.providerUserId,
        status: 'SUBMITTED',
      },
      orderBy: { id: 'desc' },
    });
    if (pending) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '进件正在审核中，请勿重复提交',
      );
    }

    const staffUserId = await this.identity.assignedStaffFor(
      contract.providerUserId,
      eps[0].id,
    );
    const row = await this.prisma.flexOnboarding.create({
      data: {
        onboardingNo: await allocateNo(this.prisma, 'JJ'),
        contractId: contract.id,
        enterpriseId: eps[0].id,
        providerUserId: contract.providerUserId,
        staffUserId,
        agentName: contract.designatedAgentName,
        form: body.form || body,
        attachments: body.attachments || [],
        status: 'SUBMITTED',
        // 进件联系方式：企业侧 + 签约服务商/承办代理人（系统自动带出，临时换人可改）
        ...(await this.contacts.stage(
          {
            enterpriseUserId: eps[0].userId,
            enterpriseId: eps[0].id,
            staffUserId,
            providerUserId: contract.providerUserId,
          },
          body,
        )),
      },
    });
    return { id: row.id, status: row.status };
  }
  /** 进件材料上传：企业风控表 8 项附件对应的实际文件，落到平台 OSS。 */
  async uploadAttachments(
    user: CurrentUser,
    files: {
      name?: string;
      size?: number;
      contentType?: string;
      contentBase64?: string;
    }[],
  ) {
    await this.identity.requireRoles(user, 'ENTERPRISE_USER');
    const validated = parseAttachmentFiles(files);
    const ts = Date.now();
    const uploaded: OnboardingFile[] = [];
    for (const [index, { name, safe, content }] of validated.entries()) {
      const result = await this.oss.upload(
        `flex-onboardings/${user.userId}/${ts}-${index + 1}-${safe}`,
        content,
      );
      uploaded.push({
        id: `fja-${ts}-${index + 1}`,
        name,
        size: result.size,
        url: result.url,
        uploaded_at: nowStamp(),
      });
    }
    return { files: uploaded };
  }
  private async onboardingScope(user: CurrentUser) {
    const [eps, identity] = await Promise.all([
      this.identity.myEnterprises(user.userId),
      this.identity.currentIdentity(user),
    ]);
    return visibilityWhere({
      isAdmin: this.identity.isPlatformAdmin(user),
      identity,
      userId: user.userId,
      enterpriseIds: eps.map((item) => item.id),
      hasCreatedBy: false,
    });
  }
  async listOnboardings(user: CurrentUser) {
    return this.prisma.flexOnboarding.findMany({
      where: await this.onboardingScope(user),
      orderBy: { id: 'desc' },
    });
  }
  async auditOnboarding(
    user: CurrentUser,
    id: number,
    action: 'APPROVE' | 'REJECT',
    note = '',
    body: Record<string, unknown> = {},
  ) {
    const row = await this.prisma.flexOnboarding.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '进件不存在');
    if (!(await this.identity.canWorkOn(user, row))) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅被签约方的承办服务商或承办职员可见并审核',
      );
    }
    if (row.status !== 'SUBMITTED') {
      throw new BusinessException(ErrorCode.CONFLICT, '该进件已审核');
    }
    if (action === 'REJECT' && !String(note || '').trim()) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '驳回时请填写驳回原因',
      );
    }
    const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await this.prisma.flexOnboarding.update({
      where: { id },
      data: {
        status,
        rejectNote: note,
        auditedAt: new Date(),
        // 审核环节按对应人档案刷新联系方式（企业侧 + 签约方承办人）
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
    return { id, status };
  }
  /** 发布用工需求：需求字段按 AIworkin 需求模型口径（§7.3），发布走平台通道。 */
  async createWorkOrder(
    user: CurrentUser,
    body: Record<string, string>,
    token = '',
  ) {
    await this.identity.requireRoles(user, 'ENTERPRISE_USER');
    const eps = await this.identity.myEnterprises(user.userId);
    if (!eps.length) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '请先完善企业信息');
    }
    const title = String(body.title || '').trim();
    if (!title) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写需求标题');
    }
    const contract = await this.contracts.requireActiveContract(
      eps[0].id,
      'FLEX_WORK',
    );

    const staffUserId = await this.identity.assignedStaffFor(
      contract.providerUserId,
      eps[0].id,
    );
    // 地域范围三态（不限制 / 指定地区 / 经纬度坐标）：跟着需求本身走，不取发布主体档案
    const region = regionForCreate(body);
    const row = await this.prisma.flexWorkOrder.create({
      data: {
        orderNo: await allocateNo(this.prisma, 'YG'),
        contractId: contract.id,
        enterpriseId: eps[0].id,
        createdBy: user.userId,
        providerUserId: contract.providerUserId,
        staffUserId,
        agentName: contract.designatedAgentName,
        title,
        workType: WORK_TYPE_LABELS[body.work_type]
          ? body.work_type
          : 'FULLTIME',
        // 二级类目取 AIworkin 企业商事财税子公司树（本模块固定「灵活用工」）
        subCategoryId: requireSubCategoryId('FLEX', body.sub_category_id),
        description: String(body.description || body.remark || ''),
        tags: String(body.tags || ''),
        budget: String(body.budget || ''),
        expectedResult: String(body.expected_result || ''),
        mustConditions: String(body.must_conditions || ''),
        expectStart: String(body.expect_start || ''),
        deadline: String(body.deadline || ''),
        ...regionColumns(region),
        regionScope: region.label,
        emailSync: Number(body.email_sync || 0) ? 1 : 0,
        contactWechat: String(body.contact_wechat || ''),
        contactEmail: String(body.contact_email || ''),
        status: 'OPEN',
        // 需求联系方式：企业侧 + 执行方（签约服务商/承办代理人，系统自动带出，临时换人可改）
        ...(await this.contacts.stage(
          {
            enterpriseUserId: eps[0].userId,
            enterpriseId: eps[0].id,
            staffUserId,
            providerUserId: contract.providerUserId,
          },
          body,
        )),
      },
    });
    const sync = await this.demandSync.publish(
      token,
      buildWorkOrderDraft(row),
      `flex:${row.id}`,
    );
    await this.prisma.flexWorkOrder.update({
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
      order_no: row.orderNo,
      aiworkinPublished: sync.published,
      platform_listing_id: sync.listingId,
      aiworkin_sync_status: sync.status,
      tip: sync.tip,
    };
  }
  private async workOrderScope(
    user: CurrentUser,
    region: RegionFilter = {},
  ): Promise<import('../../generated/prisma').Prisma.FlexWorkOrderWhereInput> {
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
  async listWorkOrders(user: CurrentUser, region: RegionFilter = {}) {
    const where = await this.workOrderScope(user, region);
    const rows = await this.prisma.flexWorkOrder.findMany({
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
    const permission = await this.workOrderScope(user, query);
    const where: import('../../generated/prisma').Prisma.FlexWorkOrderWhereInput =
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
      this.prisma.flexWorkOrder.findMany({
        where,
        orderBy: { id: query.sort ?? 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.flexWorkOrder.count({ where }),
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
    const where = await this.workOrderScope(user);
    const groups = await this.prisma.flexWorkOrder.groupBy({
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
    const permission = await this.workOrderScope(user);
    const row = await this.prisma.flexWorkOrder.findFirst({
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

  /** 开始匹配：意向资源由服务商人工筛选后登记（flex_id 可空），进度写入消息通道。 */
  async match(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown> = {},
  ) {
    const row = await this.requireWorkOrderActor(user, id, '匹配');
    if (row.status !== 'OPEN') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该需求已进入匹配/交付流程',
      );
    }
    // 承接服务商/承办人开始匹配：执行方联系方式按对应人档案带出
    const stageContacts = await this.contacts.stage(
      {
        enterpriseId: row.enterpriseId,
        staffUserId: row.staffUserId,
        providerUserId: row.providerUserId,
      },
      body,
    );
    await this.prisma.flexWorkOrder.update({
      where: { id },
      data: { status: 'MATCHING', ...stageContacts },
    });
    return { id, status: 'MATCHING', ...stageContacts };
  }
  async messages(user: CurrentUser, id: number, token = '') {
    const row = await this.requireVisible(user, id);
    const channel = await this.demandSync.conversations(
      token,
      row.platformListingId,
      row.platformMatchRunId,
      asMessages(row.messages),
    );
    return { id, conversations: channel.conversations, source: channel.source };
  }
  /** 改联系方式可达性：平台管理员 / 承办人（服务商账号或承办职员） / 企业当事人。 */
  private async canTouchContacts(
    user: CurrentUser,
    enterpriseId: number,
    row: {
      providerUserId?: string;
      staffUserId?: string;
    },
  ) {
    if (await this.identity.canWorkOn(user, row)) return true;
    const eps = await this.identity.myEnterprises(user.userId);
    return eps.some((item) => item.id === enterpriseId);
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
    const row = await this.require(id);
    if (!(await this.canTouchContacts(user, row.enterpriseId, row))) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅企业当事人或承办人可修改联系方式',
      );
    }
    const side = await this.identity.contactSide(user, {
      enterpriseId: row.enterpriseId,
      createdBy: row.createdBy,
    });
    const updated = await this.prisma.flexWorkOrder.update({
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
      'FLEX_WORK_ORDER_CONTACTS_UPDATE',
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
  /** 进件联系方式（临时换人）：企业当事人 / 承办人可改，不受审核状态限制。 */
  async updateOnboardingContacts(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown> = {},
  ) {
    const row = await this.prisma.flexOnboarding.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '进件不存在');
    if (!(await this.canTouchContacts(user, row.enterpriseId, row))) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅企业当事人或承办人可修改联系方式',
      );
    }
    const side = await this.identity.contactSide(user, {
      enterpriseId: row.enterpriseId,
    });
    const updated = await this.prisma.flexOnboarding.update({
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
      'FLEX_ONBOARDING_CONTACTS_UPDATE',
      `#${id} ${row.onboardingNo} 联系方式`,
    );
    return {
      id,
      contact_name: updated.contactName,
      contact_phone: updated.contactPhone,
      provider_contact_name: updated.providerContactName,
      provider_contact_phone: updated.providerContactPhone,
    };
  }
  /** 发薪单联系方式（临时换人）：企业当事人 / 承办人可改，不受审核状态限制。 */
  async updatePayrollContacts(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown> = {},
  ) {
    await this.requirePayrollEnabled();
    const row = await this.prisma.flexPayroll.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '发薪单不存在');
    if (!(await this.canTouchContacts(user, row.enterpriseId, row))) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅企业当事人或承办人可修改联系方式',
      );
    }
    const side = await this.identity.contactSide(user, {
      enterpriseId: row.enterpriseId,
    });
    const updated = await this.prisma.flexPayroll.update({
      where: { id },
      data: await this.contacts.stage(
        {
          enterpriseId: row.enterpriseId,
          providerUserId: row.providerUserId,
        },
        sideContactBody(body, side, row),
      ),
    });
    await this.identity.audit(
      user.userId,
      'FLEX_PAYROLL_CONTACTS_UPDATE',
      `#${id} ${row.payrollNo} 联系方式`,
    );
    return {
      id,
      contact_name: updated.contactName,
      contact_phone: updated.contactPhone,
      provider_contact_name: updated.providerContactName,
      provider_contact_phone: updated.providerContactPhone,
    };
  }
  /** 需求消息通道：签约双方在通道内沟通（企业当事人 / 承办服务商与职员）。 */
  async postMessage(
    user: CurrentUser,
    id: number,
    text: string,
    token = '',
    conversationId = '',
  ) {
    const row = await this.requireVisible(user, id);
    const content = String(text || '').trim();
    if (!content) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '消息不能为空');
    }
    const isProviderSide = await this.identity.canWorkOn(user, row);
    const role = isProviderSide ? 'PROVIDER' : 'ENTERPRISE';
    const messages = appendMessage(
      row.messages,
      role,
      await this.senderName(user, row, isProviderSide),
      content,
      conversationId,
    );
    await this.prisma.flexWorkOrder.update({
      where: { id },
      data: { messages },
    });
    const sync = await this.demandSync.reply(
      token,
      isLocalConversation(conversationId) ? '' : conversationId,
      content,
    );
    return { id, messages, aiworkin_sync: sync.synced, tip: sync.tip };
  }
  /** 通道展示名：企业侧用企业名称、服务商侧用账号实名（对齐 demo 昵称回显）。 */
  private async senderName(
    user: CurrentUser,
    row: {
      enterpriseId: number;
    },
    isProviderSide: boolean,
  ) {
    if (!isProviderSide) {
      const ep = await this.prisma.enterpriseProfile.findUnique({
        where: { id: row.enterpriseId },
      });
      if (ep?.name) return ep.name;
    }
    return this.users.displayName(user.userId);
  }
  async addCandidates(user: CurrentUser, id: number, candidates: unknown[]) {
    const row = await this.requireWorkOrderActor(user, id, '推荐');
    const now = msgTime();
    const added = (Array.isArray(candidates) ? candidates : []).map((item) => {
      const row2 = (item || {}) as Record<string, unknown>;
      const stage = text(row2.stage || 'RECOMMENDED');
      if (!CANDIDATE_STAGES[stage]) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '候选人阶段不合法（RECOMMENDED/INTERVIEW/HIRED/REJECTED）',
        );
      }
      return {
        name: text(row2.name).trim(),
        stage,
        note: text(row2.note).trim(),
        time: now,
      };
    });
    const empty = added.find((item) => !item.name);
    if (empty) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '候选人姓名必填');
    }
    const next = [...asJsonArray(row.candidates), ...added];
    const messages = added.reduce(
      (list, item) =>
        appendMessage(
          list,
          'SYSTEM',
          '系统',
          `【候选人推荐】${item.name}（${CANDIDATE_STAGES[item.stage]}）${item.note ? `：${item.note}` : ''}`,
        ),
      asMessages(row.messages),
    );
    await this.prisma.flexWorkOrder.update({
      where: { id },
      data: {
        candidates: next as Prisma.InputJsonValue,
        status: 'IN_PROGRESS',
        messages,
      },
    });
    await this.identity.audit(
      user.userId,
      'FLEX_WORK_ORDER_CANDIDATE',
      `#${id} ${row.orderNo} +${added.length}`,
    );
    return { id, candidates: next, status: 'IN_PROGRESS' };
  }
  async addSettlement(
    user: CurrentUser,
    id: number,
    settlement: Record<string, unknown>,
  ) {
    const row = await this.requireWorkOrderActor(user, id, '结算');
    const period = text(settlement.period).trim();
    if (!period) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '结算周期必填');
    }
    const entry = {
      period,
      amount: Number(settlement.amount || 0),
      invoice: text(settlement.invoice).trim(),
      note: text(settlement.note).trim(),
      time: msgTime(),
    };
    const next = [...asJsonArray(row.settlements), entry];
    await this.prisma.flexWorkOrder.update({
      where: { id },
      data: {
        settlements: next as Prisma.InputJsonValue,
        status: 'CLOSED',
        messages: appendMessage(
          row.messages,
          'SYSTEM',
          '系统',
          `【用工结算】${entry.period} ¥${entry.amount}${entry.invoice ? `（发票：${entry.invoice}）` : ''}`,
        ),
      },
    });
    await this.identity.audit(
      user.userId,
      'FLEX_WORK_ORDER_SETTLEMENT',
      `#${id} ${row.orderNo} ${entry.period} ¥${entry.amount}`,
    );
    return { id, settlements: next, status: 'CLOSED' };
  }
  /** 编辑用工需求：仅创建人或平台管理员。 */
  async updateWorkOrder(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown>,
  ) {
    const row = await this.requireWorkOrder(user, id);
    const region = regionFromBody(body);
    const data: Prisma.FlexWorkOrderUpdateInput = {
      ...(pickEditable(
        normalizeCategoryEdit('FLEX', body),
        FLEX_EDITABLE,
      ) as Prisma.FlexWorkOrderUpdateInput),
      ...(region
        ? { ...regionColumns(region), regionScope: region.label }
        : {}),
    };
    await this.prisma.flexWorkOrder.update({ where: { id }, data });
    await this.identity.audit(
      user.userId,
      'FLEX_WORK_ORDER_UPDATE',
      `#${id} ${row.orderNo}`,
    );
    return {
      id,
      tip: row.platformListingId
        ? '该需求已发布至 AIworkin 平台通道，修改将在下次同步生效'
        : '已保存',
    };
  }
  async removeWorkOrder(user: CurrentUser, id: number) {
    const row = await this.requireWorkOrder(user, id);
    await this.prisma.flexWorkOrder.delete({ where: { id } });
    await this.identity.audit(
      user.userId,
      'FLEX_WORK_ORDER_DELETE',
      `#${id} ${row.orderNo}`,
    );
    return { id, deleted: true };
  }
  /** 编辑/删除前置：单据存在 + 创建人或平台管理员。 */
  private async requireWorkOrder(user: CurrentUser, id: number) {
    const row = await this.require(id);
    if (!isDemandOwner(user, row, this.identity.isPlatformAdmin(user))) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅需求创建人或平台管理员可操作，服务商不可修改企业填写的需求内容',
      );
    }
    return row;
  }
  /** 交付动作前置：单据存在 + 承办服务商账号或被指派承办的职员。 */
  private async requireWorkOrderActor(
    user: CurrentUser,
    id: number,
    action: string,
  ) {
    const row = await this.require(id);
    if (!(await this.identity.canWorkOn(user, row))) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        `仅承办服务商或承办职员可${action}该需求`,
      );
    }
    return row;
  }
  private async require(id: number) {
    const row = await this.prisma.flexWorkOrder.findUnique({ where: { id } });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '用工需求不存在');
    return row;
  }
  /**
   * 可达性（对齐法律/知产需求口径）：平台管理员 / 承办人（服务商账号或承办职员） / 企业当事人。
   * 消息含双方联系方式，发布是写动作，二者都不能只验「单据存在」。
   */
  private async requireVisible(user: CurrentUser, id: number) {
    const row = await this.require(id);
    return requireEnterpriseDemandAccess(
      { identity: this.identity },
      user,
      row,
      { allowCreator: true },
    );
  }
  async publish(user: CurrentUser, id: number, token = '') {
    const existing = await this.requireVisible(user, id);
    if (existing.platformListingId) {
      return {
        id,
        aiworkinPublished: existing.aiworkinPublished,
        platform_listing_id: existing.platformListingId,
        aiworkin_sync_status: existing.aiworkinSyncStatus,
        tip: '该用工需求已发布至 AIworkin 平台通道',
      };
    }
    const sync = await this.demandSync.publish(
      token,
      buildWorkOrderDraft(existing),
      `flex:${id}`,
    );
    await this.prisma.flexWorkOrder.update({
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
  /**
   * 灵工发薪板块由平台管理员在管理后台启停（默认启用）：
   * 停用时整个板块的接口一律拒绝，前端也只是不渲染该页签。
   */
  private async requirePayrollEnabled() {
    if (!(await this.identity.flexPayrollEnabled())) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '灵工发薪板块已停用，请联系平台管理员开通',
      );
    }
  }
  async createPayroll(
    user: CurrentUser,
    body: {
      period?: string;
      employees?: unknown[];
      note?: string;
      [key: string]: unknown;
    },
  ) {
    await this.requirePayrollEnabled();
    await this.identity.requireRoles(user, 'ENTERPRISE_USER');
    const eps = await this.identity.myEnterprises(user.userId);
    if (!eps.length) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '请先完善企业信息');
    }
    const contract = await this.contracts.requireActiveContract(
      eps[0].id,
      'FLEX_WORK',
    );
    const employees = Array.isArray(body.employees) ? body.employees : [];
    const seen = new Set<string>();
    for (const item of employees) {
      const row = item as {
        id_no?: string;
      };
      const idNo = String(row.id_no || '');
      if (idNo && seen.has(idNo)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '同一发薪单身份证号不可重复',
        );
      }
      if (idNo) seen.add(idNo);
    }
    const total = employees.reduce<number>((sum, item) => {
      const row = item as {
        amount?: number;
      };
      return sum + Number(row.amount || 0);
    }, 0);

    const row = await this.prisma.flexPayroll.create({
      data: {
        payrollNo: await allocateNo(this.prisma, 'FP'),
        contractId: contract.id,
        enterpriseId: eps[0].id,
        providerUserId: contract.providerUserId,
        agentName: contract.designatedAgentName,
        period: body.period || '',
        employees: employees as Prisma.InputJsonValue,
        totalAmount: total,
        note: String(body.note || '').trim(),
        status: 'PENDING',
        // 发薪联系方式：企业侧 + 承办代理人（系统自动带出，临时换人可改）
        ...(await this.contacts.stage(
          {
            enterpriseUserId: eps[0].userId,
            enterpriseId: eps[0].id,
            providerUserId: contract.providerUserId,
          },
          body,
        )),
      },
    });
    return { id: row.id, status: row.status, total_amount: total };
  }
  private async payrollScope(user: CurrentUser) {
    await this.requirePayrollEnabled();
    const [eps, identity] = await Promise.all([
      this.identity.myEnterprises(user.userId),
      this.identity.currentIdentity(user),
    ]);
    return visibilityWhere({
      isAdmin: this.identity.isPlatformAdmin(user),
      identity,
      userId: user.userId,
      enterpriseIds: eps.map((item) => item.id),
      hasCreatedBy: false,
      // 发薪单无 staff_user_id 列：承办代理人＝签约主体本人，无职员代办
      hasStaffUserId: false,
    });
  }
  async listPayrolls(user: CurrentUser) {
    return this.prisma.flexPayroll.findMany({
      where: await this.payrollScope(user),
      orderBy: { id: 'desc' },
    });
  }
  async auditPayroll(
    user: CurrentUser,
    id: number,
    action: 'APPROVE' | 'REJECT',
    note = '',
    body: Record<string, unknown> = {},
  ) {
    await this.requirePayrollEnabled();
    const row = await this.prisma.flexPayroll.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '发薪单不存在');
    if (!(await this.identity.canWorkOn(user, row))) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅承办服务商或承办职员可审核发薪',
      );
    }
    if (row.status !== 'PENDING') {
      throw new BusinessException(ErrorCode.CONFLICT, '已审核不可重复审核');
    }
    if (action === 'REJECT' && !String(note || '').trim()) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '驳回时请填写驳回原因',
      );
    }
    const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await this.prisma.flexPayroll.update({
      where: { id },
      data: {
        status,
        rejectNote: note,
        auditedAt: new Date(),
        // 审核环节按对应人档案刷新联系方式（企业侧 + 承办代理人）
        ...(await this.contacts.stage(
          {
            enterpriseId: row.enterpriseId,
            providerUserId: row.providerUserId,
          },
          body,
        )),
      },
    });
    return { id, status };
  }
  /** 登记资源：服务商备案通过后登记即对外展示（无资源级平台审核）。机构由平台统筹维护，服务商仅可登记代理人。 */
  async createProvider(user: CurrentUser, body: Record<string, unknown>) {
    const admin = this.identity.isPlatformAdmin(user);
    if (!admin) {
      await this.identity.requireRoles(user, 'SERVICE_PROVIDER');
    }
    const recordType = body.recordType === 'ORG' ? 'ORG' : 'AGENT';
    if (recordType === 'ORG' && !admin) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '机构资源由平台统筹维护，服务商仅可登记代理人',
      );
    }
    const name = text(body.name).trim();
    if (!name) throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写名称');
    const location = requireLocation(body);
    const row = await this.prisma.flexProvider.create({
      data: {
        recordType,
        name,
        organization: text(body.organization || ''),
        province: location.province,
        city: location.city,
        intro: text(body.intro || ''),
        kind: body.kind === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'COMPANY',
        fields: asJsonArray(
          body.fields as Prisma.JsonValue,
        ) as Prisma.InputJsonValue,
        licenseNo: text(body.licenseNo || ''),
        agents: asJsonArray(
          body.agents as Prisma.JsonValue,
        ) as Prisma.InputJsonValue,
        cases: asJsonArray(
          body.cases as Prisma.JsonValue,
        ) as Prisma.InputJsonValue,
        status: 'APPROVED',
        providerUserId: admin ? text(body.providerUserId || '') : user.userId,
      },
    });
    await this.identity.audit(
      user.userId,
      'FLEX_RESOURCE_CREATE',
      `#${row.id} ${recordType} ${name}`,
    );
    return row;
  }
  async updateProvider(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown>,
  ) {
    const row = await this.requireProvider(user, id);
    const name = text(body.name ?? row.name).trim();
    if (!name) throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写名称');
    const location = resolveLocation(body, row);
    const updated = await this.prisma.flexProvider.update({
      where: { id },
      data: {
        name,
        organization: text(body.organization ?? row.organization),
        province: location.province,
        city: location.city,
        intro: text(body.intro ?? row.intro),
        kind:
          body.kind === undefined
            ? undefined
            : body.kind === 'INDIVIDUAL'
              ? 'INDIVIDUAL'
              : 'COMPANY',
        fields:
          body.fields === undefined
            ? undefined
            : (asJsonArray(body.fields) as Prisma.InputJsonValue),
        licenseNo:
          body.licenseNo === undefined ? undefined : text(body.licenseNo || ''),
        agents:
          body.agents === undefined
            ? undefined
            : (asJsonArray(body.agents) as Prisma.InputJsonValue),
        cases:
          body.cases === undefined
            ? undefined
            : (asJsonArray(body.cases) as Prisma.InputJsonValue),
      },
    });
    await this.identity.audit(
      user.userId,
      'FLEX_RESOURCE_UPDATE',
      `#${id} ${name}`,
    );
    return updated;
  }
  async removeProvider(user: CurrentUser, id: number) {
    const row = await this.requireProvider(user, id);
    const [contracts, onboardings, payrolls] = await Promise.all([
      this.prisma.contract.count({ where: { designatedAgentId: id } }),
      this.prisma.flexOnboarding.count({ where: { agentName: row.name } }),
      this.prisma.flexPayroll.count({ where: { agentName: row.name } }),
    ]);
    assertResourceNotReferenced(
      [contracts, onboardings, payrolls],
      `该资源已被 ${contracts} 个签约、${onboardings} 条进件、${payrolls} 条发薪单引用，不可删除；请先处理相关签约与业务单据`,
    );
    await this.prisma.flexProvider.delete({ where: { id } });
    await this.identity.audit(
      user.userId,
      'FLEX_RESOURCE_DELETE',
      `#${id} ${row.name}`,
    );
    return { id, deleted: true };
  }
  private async requireProvider(user: CurrentUser, id: number) {
    const row = await this.prisma.flexProvider.findUnique({ where: { id } });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '灵活用工资源不存在');
    }
    assertResourceOwned(
      row.providerUserId === user.userId,
      this.identity.isPlatformAdmin(user),
    );
    return row;
  }
}
/** 资源库筛选参数（2026-09-25 起＝省 / 市 / 关键词，市需先选省；recordType 为分区） */
export type FlexProviderQuery = {
  recordType?: string;
  province?: string;
  city?: string;
  keyword?: string;
};
/** 可编辑字段：前端字段名 → 数据库列名（与 createWorkOrder 同一套表单字段名）。 */
const FLEX_EDITABLE: Record<string, string> = {
  title: 'title',
  work_type: 'workType',
  sub_category_id: 'subCategoryId',
  description: 'description',
  tags: 'tags',
  budget: 'budget',
  expected_result: 'expectedResult',
  must_conditions: 'mustConditions',
  expect_start: 'expectStart',
  deadline: 'deadline',
  region_scope: 'regionScope',
  email_sync: 'emailSync',
  contact_name: 'contactName',
  contact_phone: 'contactPhone',
  contact_wechat: 'contactWechat',
  contact_email: 'contactEmail',
};
/** 用工需求 → AIworkin 需求草稿（字段口径同 §7.3，与其余需求板块一致）。 */
function buildWorkOrderDraft(
  row: {
    title: string;
    description: string;
    tags: string;
    budget: string;
    expectedResult: string;
    mustConditions: string;
    expectStart: string;
    deadline: string;
    workType: string;
    subCategoryId: string;
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
    subcategoryId: requireSubCategoryId('FLEX', row.subCategoryId),
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
      category: '灵活用工服务',
      workType: WORK_TYPE_LABELS[row.workType] || row.workType,
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
