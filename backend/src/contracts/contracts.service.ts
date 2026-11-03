import { allocateNo } from '../common/document-number';
import { text } from '../common/api';
import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import {
  CATEGORY_LABELS,
  CONTRACT_CATEGORIES,
  SUBITEM_OWNERS,
  bearingRowsOf,
  isExclusiveCategory,
  isOverseasType,
  isSubItemType,
  todayDate,
} from '../common/constants';
import { ErrorCode } from '../common/error-code';
import { UserLookupService } from '../directory/user-lookup.service';
import { asArray, asRecord, asStringArray } from '../identity/identity.service';
import { IdentityService } from '../identity/identity.service';
import { isPersonalSubject } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  contactSideOf,
  contactSnapshot,
  readContact,
  sideContactBody,
} from '../shared/contacts';
import { ContactResolver } from '../shared/contacts.service';
import { LocationFilter } from '../shared/locations';
/** 服务类目 → 职员角色名（用于从绑定职员里筛出对应类目的对接人）。 */
const TYPE_ROLE_LABEL: Record<string, string> = {
  TAX_FINANCE: '财税专员',
  LEGAL_SERVICE: '法律顾问',
  IP_SERVICE: '知识产权专员',
  FLEX_WORK: '灵活用工专员',
  LOGISTICS: '物流专员',
  SUPPLY_NETWORK: '供销专员',
  MICRO: '负责人（本人）',
  EXPORT_REFUND: '出口退税专员',
  COMPANY_REG: '海外公司注册专员',
  SETTLEMENT: '跨境结算专员',
  TAX_COMPLIANCE: '海外税务合规专员',
  QUALIFICATION: '出口资质备案专员',
  BANK_ACCOUNT: '海外银行开户专员',
  INFLUENCER_VISIT: '达人探店专员',
  LIVE_SELLING: '直播带货专员',
  CONTENT_MARKETING: '内容营销专员',
  GEO_OPTIMIZATION: 'GEO优化专员',
  PRECISION_MARKETING: '精准营销专员',
  PRIVATE_DOMAIN: '私域营销专员',
  DOMESTIC_LAND: '境内陆运专员',
  CROSS_BORDER_FORWARDER: '跨境货代专员',
  WAREHOUSING: '仓储专员',
  REAL_ESTATE: '房产交易专员',
  INSURANCE: '保险专员',
  INVESTMENT: '投资理财专员',
  NON_PERFORMING_ASSET: '不良资产专员',
  AUTO_TRADE: '汽车交易专员',
  SMART_SERVICE: 'IT服务专员',
  AI_DEPLOY: 'AI实施专员',
  SOFTWARE_DEV: '软件开发专员',
  COMPUTE: '算力服务专员',
  HARDWARE: '硬件服务专员',
  DATA_SERVICE: '数据服务专员',
};
/**
 * 「哪一备案行承载该签约分类」：细项（出海 / 营销 / 物流 / 资产 / IT服务）不落独立行，
 * 落在所属类目的备案行 `serviceItems` 上；物流与供销类目另并入小微（MICRO）直营兜底。
 */
function providerTypeWhere(serviceType: string) {
  return { providerType: { in: bearingRowsOf(serviceType) } };
}
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly users: UserLookupService,
    private readonly contacts: ContactResolver,
  ) {}
  async requireActiveContract(enterpriseId: number, serviceType: string) {
    const row = await this.prisma.contract.findFirst({
      where: { enterpriseId, serviceType, status: 'ACTIVE' },
      orderBy: { id: 'asc' },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NO_ACTIVE_CONTRACT);
    }
    return row;
  }
  async activeContractBetween(
    enterpriseId: number,
    providerUserId: string,
    serviceType: string,
  ) {
    return this.prisma.contract.findFirst({
      where: {
        enterpriseId,
        providerUserId,
        serviceType,
        status: 'ACTIVE',
      },
    });
  }
  async listWhere(user: CurrentUser) {
    const q = await this.identity.qualifications(user.userId);
    const roles = this.identity.effectiveRoles(user, q.roles);
    if (roles.includes('PLATFORM_ADMIN')) {
      return {};
    }
    const [ctx, enterprises] = await Promise.all([
      this.identity.providerContext(user.userId),
      this.identity.myEnterprises(user.userId),
    ]);
    const or = [];
    if (ctx.providers.length) {
      or.push({ providerUserId: { in: ctx.providers } });
    }
    if (enterprises.length) {
      or.push({ enterpriseId: { in: enterprises.map((item) => item.id) } });
    }
    return or.length ? { OR: or } : { id: -1 };
  }
  async list(user: CurrentUser) {
    return this.decorateMany(
      await this.prisma.contract.findMany({
        where: await this.listWhere(user),
        orderBy: { id: 'desc' },
      }),
    );
  }
  async listPage(user: CurrentUser, page = 1, pageSize = 20) {
    const where = await this.listWhere(user);
    const [rows, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.contract.count({ where }),
    ]);
    return { list: await this.decorateMany(rows), total, page, pageSize };
  }
  async listStats(user: CurrentUser) {
    const groups = await this.prisma.contract.groupBy({
      by: ['status'],
      where: await this.listWhere(user),
      _count: { _all: true },
    });
    return {
      total: groups.reduce((n, row) => n + row._count._all, 0),
      active: groups.find((row) => row.status === 'ACTIVE')?._count._all || 0,
      pending: groups.find((row) => row.status === 'PENDING')?._count._all || 0,
    };
  }
  async create(
    user: CurrentUser,
    body: {
      providerUserId?: string;
      service_type?: string;
      note?: string;
      agent_id?: number;
      [key: string]: unknown;
    },
  ) {
    await this.identity.requireRoles(user, 'ENTERPRISE_USER');
    const eps = await this.identity.myEnterprises(user.userId);
    if (!eps.length) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '请先完善企业信息后再发起签约',
      );
    }
    const ep = eps[0];
    const serviceType = String(body.service_type || '');
    const providerUserId = String(body.providerUserId || '');
    if (!CONTRACT_CATEGORIES.includes(serviceType)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '服务分类不合法');
    }
    // 个人主体可浏览名录与申请加入，但「签约」属办理动作：财税与出海六细项照旧拦下
    if (
      isPersonalSubject(ep.subjectType) &&
      (serviceType === 'TAX_FINANCE' || isOverseasType(serviceType))
    ) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        `「${CATEGORY_LABELS[serviceType]}」的该项办理不面向「个人」主体：请先在「身份与资质」把主体类型变更为「企业」或「个体工商户」`,
      );
    }
    // 细项（出海 / 营销 / 物流 / 资产）落在承载备案行的 serviceItems 上：
    // 该行须已通过审核，且已申请到该细项（物流细项的承载行含「物流服务商」与「小微服务商」）
    const owners = bearingRowsOf(serviceType);
    const isSubItem = isSubItemType(serviceType);
    const bearingRows = await this.prisma.providerApplication.findMany({
      where: { userId: providerUserId, providerType: { in: owners } },
      orderBy: { id: 'desc' },
    });
    const approvedRows = bearingRows.filter(
      (item) => item.status === 'APPROVED',
    );
    if (!approvedRows.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        isSubItem
          ? `该服务商尚未通过「${CATEGORY_LABELS[owners[0]]}」备案审核`
          : '该服务商尚未通过该服务分类的备案审核',
      );
    }
    if (isSubItem) {
      const accepts = approvedRows.some((item) =>
        item.serviceItems
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
          .includes(serviceType),
      );
      if (!accepts) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `该服务商不承接「${CATEGORY_LABELS[serviceType]}」`,
        );
      }
    }
    const appoint = Number(body.agent_id || 0)
      ? await this.resolveAppointedAgent(
          providerUserId,
          serviceType,
          Number(body.agent_id),
        )
      : null;
    const dup = await this.prisma.contract.findFirst({
      where: {
        enterpriseId: ep.id,
        providerUserId,
        serviceType,
        status: { in: ['PENDING', 'ACTIVE'] },
      },
    });
    if (dup) {
      if (appoint) {
        await this.prisma.contract.update({
          where: { id: dup.id },
          data: {
            designatedAgentId: appoint.id,
            designatedAgentName: appoint.name,
            designatedAgentOrg: appoint.org,
            ...(await this.contacts.stage(
              {
                enterpriseUserId: ep.userId,
                enterpriseId: ep.id,
                staffUserId: appoint.staffUserId || '',
                providerUserId,
              },
              body,
            )),
          },
        });
        return {
          id: dup.id,
          status: dup.status,
          reused: true,
          designated_agent: appoint,
        };
      }
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `已与该服务商存在「${CATEGORY_LABELS[serviceType]}」签约`,
      );
    }
    if (isExclusiveCategory(serviceType)) {
      const occupied = await this.prisma.contract.findFirst({
        where: {
          enterpriseId: ep.id,
          serviceType,
          status: { in: ['PENDING', 'ACTIVE'] },
        },
      });
      if (occupied) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          `「${CATEGORY_LABELS[serviceType]}」已签约服务商，解约后才能再次发起`,
        );
      }
    }

    const providerOrg = await this.users.displayName(providerUserId);
    const stageContacts = await this.contacts.stage(
      {
        enterpriseUserId: ep.userId,
        enterpriseId: ep.id,
        providerUserId,
      },
      body,
    );
    const row = await this.prisma.contract.create({
      data: {
        contractNo: await allocateNo(this.prisma, 'HT'),
        providerUserId,
        providerOrg,
        enterpriseId: ep.id,
        enterpriseName: ep.name,
        serviceType,
        status: 'PENDING',
        note: String(body.note || ''),
        designatedAgentId: appoint?.id || 0,
        designatedAgentName: appoint?.name || '',
        designatedAgentOrg: appoint?.org || '',
        ...stageContacts,
      },
    });
    return {
      id: row.id,
      status: row.status,
      service_type: serviceType,
      provider_name: providerOrg,
      designated_agent: appoint,
      ...stageContacts,
    };
  }
  /** 服务商确认签约：执行侧联系方式按确认人档案刷新（可带联系方式覆盖）。 */
  async confirm(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown> = {},
  ) {
    const row = await this.prisma.contract.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '签约不存在');
    if (row.providerUserId !== user.userId) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '仅该服务商可确认签约');
    }
    if (row.status !== 'PENDING') {
      throw new BusinessException(
        ErrorCode.CONTRACT_STATE,
        '仅待确认状态的签约可确认',
      );
    }
    const stageContacts = await this.contacts.stage(
      {
        enterpriseId: row.enterpriseId,
        providerUserId: row.providerUserId,
      },
      body,
    );
    await this.prisma.contract.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        startDate: todayDate(),
        ...stageContacts,
      },
    });
    return { id, status: 'ACTIVE', ...stageContacts };
  }
  /**
   * 修改签约条款：仅签约发起企业（或平台管理员）、且仅「待确认」状态可改。
   * 生效后条款不可改，只能解约重签（避免已履行的约定被追溯篡改）；
   * 但**联系方式**在生效后仍可改（临时换对接人）。
   */
  /**
   * 改签到联系方式（临时换人）：企业当事人改企业侧、服务商账号/承办职员改服务商侧。
   * 系统已按双方对应人档案自动带出，这里只处理人工调整，不受签约状态限制。
   */
  async updateContacts(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown> = {},
  ) {
    const row = await this.prisma.contract.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '签约不存在');
    const [eps, ctx] = await Promise.all([
      this.identity.myEnterprises(user.userId),
      this.identity.providerContext(user.userId),
    ]);
    const isEnterpriseParty = eps.some((item) => item.id === row.enterpriseId);
    const isProviderParty = ctx.providers.includes(row.providerUserId);
    const isAdmin = this.identity.isPlatformAdmin(user);
    if (!isEnterpriseParty && !isProviderParty && !isAdmin) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '仅签约双方或平台管理员可修改签约联系方式',
      );
    }
    const side = contactSideOf({ isAdmin, isEnterpriseParty });
    const updated = await this.prisma.contract.update({
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
      'CONTRACT_CONTACTS_UPDATE',
      `${row.contractNo} 联系方式`,
    );
    return {
      id,
      contact_name: updated.contactName,
      contact_phone: updated.contactPhone,
      provider_contact_name: updated.providerContactName,
      provider_contact_phone: updated.providerContactPhone,
    };
  }
  async updateTerms(
    user: CurrentUser,
    id: number,
    body: {
      start_date?: string;
      end_date?: string;
      note?: string;
      [key: string]: unknown;
    },
  ) {
    const row = await this.prisma.contract.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '签约不存在');
    const ep = await this.prisma.enterpriseProfile.findUnique({
      where: { id: row.enterpriseId },
    });
    if (ep?.userId !== user.userId && !this.identity.isPlatformAdmin(user)) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '仅签约发起企业或平台管理员可修改签约条款',
      );
    }
    const contactTouched = [
      'contact_name',
      'contactName',
      'contact_phone',
      'contactPhone',
      'provider_contact_name',
      'providerContactName',
      'provider_contact_phone',
      'providerContactPhone',
    ].some((key) => body[key] !== undefined);
    if (row.status !== 'PENDING' && !contactTouched) {
      throw new BusinessException(
        ErrorCode.CONTRACT_STATE,
        '仅待确认的签约可修改条款；已生效的请解约后重签',
      );
    }
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const data: {
      startDate?: string;
      endDate?: string;
      note?: string;
      contactName?: string;
      contactPhone?: string;
      providerContactName?: string;
      providerContactPhone?: string;
    } = {};
    if (contactTouched) {
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
    if (body.start_date !== undefined) {
      const value = String(body.start_date || '').trim();
      if (value && !datePattern.test(value)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '服务起始日期格式应为 YYYY-MM-DD',
        );
      }
      data.startDate = value;
    }
    if (body.end_date !== undefined) {
      const value = String(body.end_date || '').trim();
      if (value && !datePattern.test(value)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '服务结束日期格式应为 YYYY-MM-DD',
        );
      }
      data.endDate = value;
    }
    const start = data.startDate ?? row.startDate;
    const end = data.endDate ?? row.endDate;
    if (start && end && end < start) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '服务结束日期不能早于起始日期',
      );
    }
    if (body.note !== undefined) {
      data.note = String(body.note || '').slice(0, 500);
    }
    if (!Object.keys(data).length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有需要修改的条款');
    }
    const next = await this.prisma.contract.update({ where: { id }, data });
    await this.identity.audit(
      user.userId,
      '修改签约条款',
      `${next.contractNo}（${CATEGORY_LABELS[next.serviceType] || next.serviceType}）`,
    );
    return {
      id: next.id,
      status: next.status,
      start_date: next.startDate,
      end_date: next.endDate,
      note: next.note,
      contact_name: next.contactName,
      contact_phone: next.contactPhone,
      provider_contact_name: next.providerContactName,
      provider_contact_phone: next.providerContactPhone,
    };
  }
  /** 该签约已产生的业务单据数（存在则禁止删除，保留留痕）。 */
  private async businessRefs(contractId: number) {
    const counts = await Promise.all([
      this.prisma.taxDeclaration.count({ where: { contractId } }),
      this.prisma.taxMaterialPack.count({ where: { contractId } }),
      this.prisma.logisticsOrder.count({ where: { contractId } }),
      this.prisma.smartServiceOrder.count({ where: { contractId } }),
      this.prisma.overseasClaim.count({ where: { contractId } }),
      this.prisma.legalRequest.count({ where: { contractId } }),
      this.prisma.ipRequest.count({ where: { contractId } }),
      this.prisma.flexOnboarding.count({ where: { contractId } }),
      this.prisma.flexWorkOrder.count({ where: { contractId } }),
      this.prisma.flexPayroll.count({ where: { contractId } }),
      this.prisma.consultation.count({ where: { contractId } }),
    ]);
    return counts.reduce((sum, item) => sum + item, 0);
  }
  /**
   * 删除签约：仅「待确认 / 已解约 / 已作废 / 已到期」可删；生效中须先解约；
   * 已产生业务单据的签约不可删除（历史作业与申报依据需保留）。
   */
  async remove(user: CurrentUser, id: number) {
    const row = await this.prisma.contract.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '签约不存在');
    const ep = await this.prisma.enterpriseProfile.findUnique({
      where: { id: row.enterpriseId },
    });
    if (ep?.userId !== user.userId && !this.identity.isPlatformAdmin(user)) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '仅签约发起企业或平台管理员可删除签约',
      );
    }
    if (row.status === 'ACTIVE') {
      throw new BusinessException(
        ErrorCode.CONTRACT_STATE,
        '生效中的签约不可删除，请先解约',
      );
    }
    const refs = await this.businessRefs(row.id);
    if (refs > 0) {
      throw new BusinessException(
        ErrorCode.CONTRACT_STATE,
        `该签约已产生 ${refs} 条业务单据，不可删除（保留作业与申报依据）`,
      );
    }
    await this.prisma.contract.delete({ where: { id } });
    await this.identity.audit(
      user.userId,
      '删除签约',
      `${row.contractNo}（${CATEGORY_LABELS[row.serviceType] || row.serviceType}）`,
    );
    return { id, removed: true };
  }
  async terminate(user: CurrentUser, id: number) {
    const row = await this.prisma.contract.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '签约不存在');
    const ep = await this.prisma.enterpriseProfile.findUnique({
      where: { id: row.enterpriseId },
    });
    const isParty =
      row.providerUserId === user.userId || ep?.userId === user.userId;
    if (!isParty && !this.identity.isPlatformAdmin(user)) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '仅签约双方可解约');
    }
    if (!['PENDING', 'ACTIVE'].includes(row.status)) {
      throw new BusinessException(ErrorCode.CONTRACT_STATE, '当前状态不可解约');
    }
    await this.prisma.contract.update({
      where: { id },
      data: { status: 'TERMINATED' },
    });
    return { id, status: 'TERMINATED' };
  }
  async designateStaff(
    user: CurrentUser,
    id: number,
    staffName: string,
    body: Record<string, unknown> = {},
  ) {
    await this.identity.requireRoles(user, 'SERVICE_PROVIDER');
    const row = await this.prisma.contract.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '签约不存在');
    if (row.providerUserId !== user.userId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '仅签约服务商可指定业务人员',
      );
    }
    if (row.status !== 'ACTIVE') {
      throw new BusinessException(
        ErrorCode.CONTRACT_STATE,
        '签约生效后才能指定业务人员',
      );
    }
    // 财税与细项级签约（出海 / 营销）须指派到人；其余为机构级合作
    if (row.serviceType !== 'TAX_FINANCE' && !isSubItemType(row.serviceType)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该分类无需指定业务人员',
      );
    }
    const staff = await this.providerStaffFor(
      row.providerUserId,
      row.serviceType,
    );
    const picked = staff.find((item) => item.name === staffName.trim());
    if (!picked) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        staff.length
          ? '业务人员不在该服务商已绑定生效的职员名单中'
          : `该服务商尚未绑定「${TYPE_ROLE_LABEL[row.serviceType] || '对应角色'}」职员，请先在「职员/代理人管理」完成绑定`,
      );
    }
    // 指定/改派业务人员后，执行侧联系方式自动跟随该职员档案
    const manual = readContact(body, 'provider_contact');
    const stageContacts = contactSnapshot(
      {
        contact: await this.contacts.enterprise('', row.enterpriseId),
        providerContact: {
          name: manual.name || picked.name,
          phone: manual.phone || picked.phone,
        },
      },
      body,
    );
    await this.prisma.contract.update({
      where: { id },
      data: { designatedStaff: picked, ...stageContacts },
    });
    return { id, designated_staff: picked, ...stageContacts };
  }
  async designateAgent(user: CurrentUser, id: number, agentId: number) {
    const row = await this.prisma.contract.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '签约不存在');
    if (
      !['LEGAL_SERVICE', 'IP_SERVICE', 'FLEX_WORK'].includes(row.serviceType)
    ) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该分类不支持指定承办人',
      );
    }
    const ep = await this.prisma.enterpriseProfile.findUnique({
      where: { id: row.enterpriseId },
    });
    if (ep?.userId !== user.userId && row.providerUserId !== user.userId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '仅签约双方可指定承办人',
      );
    }
    if (row.status !== 'ACTIVE') {
      throw new BusinessException(
        ErrorCode.CONTRACT_STATE,
        '签约生效后才能指定承办人',
      );
    }
    const appoint = await this.resolveAppointedAgent(
      row.providerUserId,
      row.serviceType,
      agentId,
    );
    if (!appoint) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '承办人不存在或不属于该服务商',
      );
    }
    // 指定/改派承办人后，执行侧联系方式自动跟随承办人档案/资源登记电话
    const stageContacts = await this.contacts.stage(
      {
        enterpriseId: row.enterpriseId,
        staffUserId: appoint.staffUserId || '',
        providerUserId: row.providerUserId,
      },
      {
        provider_contact_name: appoint.name,
        provider_contact_phone: appoint.phone || '',
      },
    );
    await this.prisma.contract.update({
      where: { id },
      data: {
        designatedAgentId: appoint.id,
        designatedAgentName: appoint.name,
        designatedAgentOrg: appoint.org,
        ...stageContacts,
      },
    });
    return { id, designated_agent: appoint, ...stageContacts };
  }
  async candidates(user: CurrentUser, serviceType?: string) {
    await this.identity.requireRoles(user, 'ENTERPRISE_USER');
    const rows = await this.prisma.providerApplication.findMany({
      where: {
        status: 'APPROVED',
        ...(serviceType ? providerTypeWhere(serviceType) : {}),
      },
      orderBy: { id: 'desc' },
    });
    // 一次批量取昵称（原先循环内逐行查，目录未命中缓存时是 N 次查询）
    const names = await this.users.displayNames(rows.map((row) => row.userId));
    const seen = new Set<string>();
    const out = [];
    for (const row of rows) {
      if (seen.has(`${row.userId}:${row.providerType}`)) continue;
      seen.add(`${row.userId}:${row.providerType}`);
      out.push({
        providerUserId: row.userId,
        org_name: row.orgName,
        provider_type: row.providerType,
        service_items: row.serviceItems,
        contact_name: row.contactName,
        contact_phone: row.contactPhone,
        contact_email: row.contactEmail,
        intro: row.intro,
        business_staff: asArray(row.businessStaff),
        display_name: names.get(row.userId) || row.userId,
      });
    }
    return out;
  }
  /**
   * 服务商资源库（营销/物流/资产等服务商页签共用）：已通过备案审核的服务商名录。
   * 分类过滤与「签约可选项」同一口径（细项按承载备案行取人、物流与供销并入小微兜底）；
   * 对接人只在有对应职员角色的类目下带出，无角色要求的类目为机构级合作不带人。
   */
  async providerDirectory(serviceType?: string, location?: LocationFilter) {
    const rows = await this.prisma.providerApplication.findMany({
      where: {
        status: 'APPROVED',
        ...(serviceType ? providerTypeWhere(serviceType) : {}),
        // 用户按省、市筛选服务商（名录列表页）；未筛选时不带条件
        ...(location?.province ? { province: location.province } : {}),
        ...(location?.city ? { city: location.city } : {}),
      },
      orderBy: { id: 'desc' },
    });
    // 名录一次批量取昵称 + 一次批量取绑定职员（原先每行 3~4 次查询）
    const [names, bindsByProvider] = await Promise.all([
      this.users.displayNames(rows.map((row) => row.userId)),
      this.providerStaffBinds(rows.map((row) => row.userId)),
    ]);
    const staffProfiles = await this.staffProfilesOf(bindsByProvider);
    const seen = new Set<string>();
    const out: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      // 指定分类时按机构去重（同一分区里一家机构只出现一次；物流细项有两个承载备案行）
      const key = serviceType
        ? row.userId
        : `${row.userId}:${row.providerType}`;
      if (seen.has(key)) continue;
      const items = row.serviceItems
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      // 细项落在承载备案行上：该细项未生效（未申请或未通过审核）即不出现在该分区
      if (
        serviceType &&
        SUBITEM_OWNERS[serviceType] &&
        !items.includes(serviceType)
      ) {
        continue;
      }
      seen.add(key);
      out.push({
        providerUserId: row.userId,
        providerType: row.providerType,
        orgName: row.orgName,
        uscc: row.uscc,
        qualification: row.qualification,
        serviceItems: row.serviceItems,
        serviceItemsArr: items,
        intro: row.intro,
        contactName: row.contactName,
        contactPhone: row.contactPhone,
        contactEmail: row.contactEmail,
        province: row.province,
        city: row.city,
        subjectType: row.subjectType,
        auditedAt: row.auditedAt,
        displayName: names.get(row.userId) || row.userId,
        // 对接人按「所选分类/细项」对应的角色筛；无角色要求的类目（资产等机构级）不带出
        businessStaff: TYPE_ROLE_LABEL[serviceType || row.providerType]
          ? this.staffViews(
              bindsByProvider.get(row.userId) || [],
              staffProfiles,
              serviceType || row.providerType,
            )
          : [],
      });
    }
    return out;
  }
  async myEnterprises(user: CurrentUser) {
    // 非服务商身份没有「我服务的企业」：返回空列表而不是 403（避免工作台出现必然的权限错误）
    const qualifications = await this.identity.qualifications(user.userId);
    if (!qualifications.roles.includes('SERVICE_PROVIDER')) return [];
    const contracts = await this.prisma.contract.findMany({
      where: { providerUserId: user.userId, status: 'ACTIVE' },
    });
    const ids = [...new Set(contracts.map((item) => item.enterpriseId))];
    if (!ids.length) return [];
    const [enterprises, assignments] = await Promise.all([
      this.prisma.enterpriseProfile.findMany({
        where: { id: { in: ids } },
      }),
      this.prisma.providerAssignment.findMany({
        where: { providerUserId: user.userId },
      }),
    ]);
    return enterprises.map((ep) => ({
      ...ep,
      staffUserId:
        assignments.find((item) => item.enterpriseId === ep.id)?.staffUserId ||
        '',
    }));
  }
  private async decorateMany(
    rows: Awaited<ReturnType<PrismaService['contract']['findMany']>>,
  ) {
    if (!rows.length) return [];
    const providerIds = [
      ...new Set(rows.map((row) => row.providerUserId).filter(Boolean)),
    ];
    // 服务商名称与业务人员名录各一次批量查询（原先每行 2~3 次）
    const [names, bindsByProvider] = await Promise.all([
      this.users.displayNames(providerIds),
      this.providerStaffBinds(providerIds),
    ]);
    const profiles = await this.staffProfilesOf(bindsByProvider);
    return rows.map((row) => {
      const binds = bindsByProvider.get(row.providerUserId) || [];
      return {
        ...row,
        contact_name: row.contactName,
        contact_phone: row.contactPhone,
        provider_contact_name: row.providerContactName,
        provider_contact_phone: row.providerContactPhone,
        provider_name: names.get(row.providerUserId) || row.providerUserId,
        business_staff: this.staffViews(binds, profiles, row.serviceType),
        designated_staff: asRecord(row.designatedStaff),
        designated_agent: row.designatedAgentId
          ? {
              id: row.designatedAgentId,
              name: row.designatedAgentName,
              org: row.designatedAgentOrg,
            }
          : null,
      };
    });
  }
  /** 一批服务商的「已绑定且生效」职员，按 providerUserId 分组（一次查询）。 */
  private async providerStaffBinds(providerUserIdList: string[]) {
    type StaffBind = Awaited<
      ReturnType<PrismaService['providerStaff']['findMany']>
    >[number];
    const binds: StaffBind[] = providerUserIdList.length
      ? await this.prisma.providerStaff.findMany({
          where: {
            providerUserId: { in: providerUserIdList },
            status: 'ACTIVE',
          },
          orderBy: { id: 'asc' },
        })
      : [];
    const grouped = new Map<string, StaffBind[]>();
    for (const bind of binds) {
      const list = grouped.get(bind.providerUserId);
      if (list) list.push(bind);
      else grouped.set(bind.providerUserId, [bind]);
    }
    return grouped;
  }
  /** 分组职员里出现过的职员档案（一次查询）。 */
  private async staffProfilesOf(
    grouped: Map<
      string,
      Awaited<ReturnType<PrismaService['providerStaff']['findMany']>>
    >,
  ) {
    const staffIds = [
      ...new Set(
        [...grouped.values()].flatMap((list) =>
          list.map((item) => item.staffUserId),
        ),
      ),
    ];
    if (!staffIds.length) return [];
    return this.prisma.staffProfile.findMany({
      where: { userId: { in: staffIds } },
    });
  }
  private staffViews(
    binds: Awaited<ReturnType<PrismaService['providerStaff']['findMany']>>,
    profiles: Awaited<ReturnType<PrismaService['staffProfile']['findMany']>>,
    serviceType: string,
  ) {
    if (!binds.length) return [];
    const roleLabel = TYPE_ROLE_LABEL[serviceType] || '';
    const picked = roleLabel
      ? binds.filter((item) =>
          asStringArray(item.roles).some((role) => role.includes(roleLabel)),
        )
      : binds;
    return picked.map((item) => {
      const profile = profiles.find((p) => p.userId === item.staffUserId);
      return {
        name: profile?.realName || item.staffUserId,
        title: asStringArray(item.roles)[0] || '',
        phone: profile?.phone || '',
        email: profile?.email || '',
      };
    });
  }
  /**
   * 可指定为对接人的业务人员 = 该服务商在「职员/代理人管理」里**已绑定且生效**的职员，
   * 按服务类目对应的角色名过滤（如财税→财税专员、出海→出口退税专员）；不再读备案里的业务人员名录。
   * 有角色要求的类目**筛选不到就返回空**——不再退回全部绑定职员，否则会把财税专员列成出口退税对接人。
   */
  async providerStaffFor(providerUserId: string, serviceType: string) {
    const grouped = await this.providerStaffBinds([providerUserId]);
    const binds = grouped.get(providerUserId) || [];
    if (!binds.length) return [];
    const profiles = await this.prisma.staffProfile.findMany({
      where: { userId: { in: binds.map((item) => item.staffUserId) } },
    });
    return this.staffViews(binds, profiles, serviceType);
  }
  /** 一批服务商在同一类目下的对接职员（名录页批量取，共 2 次查询）。 */
  async providerStaffForMany(
    providerUserIdList: string[],
    serviceType: string,
  ) {
    const grouped = await this.providerStaffBinds(providerUserIdList);
    const profiles = await this.staffProfilesOf(grouped);
    const out = new Map<string, ReturnType<ContractsService['staffViews']>>();
    for (const id of new Set(providerUserIdList.filter(Boolean))) {
      out.set(
        id,
        this.staffViews(grouped.get(id) || [], profiles, serviceType),
      );
    }
    return out;
  }
  /**
   * 签约指定代理人：律师 / 知产资源不再逐条平台审核（服务商备案通过即对外展示），
   * 可指派口径与资源库一致 —— 仅排除存量「不再展示 / 已驳回」。
   */
  async resolveAppointedAgent(
    providerUserId: string,
    serviceType: string,
    agentId: number,
  ) {
    if (!agentId) return null;
    if (serviceType === 'LEGAL_SERVICE') {
      const lawyer = await this.prisma.lawyerResource.findFirst({
        where: {
          id: agentId,
          kind: 'LAWYER',
          status: { notIn: ['HIDDEN', 'REJECTED'] },
          providerUserId,
        },
      });
      if (!lawyer?.staffUserId) return null;
      const bind = await this.prisma.providerStaff.findUnique({
        where: {
          providerUserId_staffUserId: {
            providerUserId,
            staffUserId: lawyer.staffUserId,
          },
        },
      });
      if (bind?.status !== 'ACTIVE') return null;
      const lawyerProfile = await this.prisma.staffProfile.findUnique({
        where: { userId: lawyer.staffUserId },
      });
      return {
        id: lawyer.id,
        name: lawyer.name,
        org: lawyer.organization,
        type: '律师',
        staffUserId: lawyer.staffUserId,
        phone: lawyerProfile?.phone || '',
      };
    }
    if (serviceType === 'IP_SERVICE') {
      const agent = await this.prisma.ipAgency.findFirst({
        where: {
          id: agentId,
          kind: 'AGENT',
          status: { notIn: ['HIDDEN', 'REJECTED'] },
          ownerUserId: providerUserId,
        },
      });
      if (!agent) return null;
      const agentRows = asArray<{
        name?: unknown;
        phone?: unknown;
      }>(agent.agents);
      return {
        id: agent.id,
        name: agent.name,
        org: agent.organization,
        type: '知产代理人',
        phone:
          agent.phone ||
          text(
            (
              agentRows.find((item) => text(item.name || '') === agent.name) ||
              agentRows[0] ||
              {}
            ).phone ?? '',
          ),
      };
    }
    if (serviceType === 'FLEX_WORK') {
      const agent = await this.prisma.flexProvider.findFirst({
        where: {
          id: agentId,
          recordType: 'AGENT',
          status: { notIn: ['HIDDEN', 'REJECTED'] },
          providerUserId,
        },
      });
      if (!agent) return null;
      const agentRows = asArray<{
        name?: unknown;
        phone?: unknown;
      }>(agent.agents);
      return {
        id: agent.id,
        name: agent.name,
        org: '',
        type: '灵活用工代理人',
        phone: text(
          (
            agentRows.find((item) => text(item.name || '') === agent.name) ||
            agentRows[0] ||
            {}
          ).phone ?? '',
        ),
      };
    }
    return null;
  }
}
