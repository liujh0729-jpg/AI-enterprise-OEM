import { Prisma } from '../../generated/prisma';
import { pageParam, text } from '../common/api';
import { allocateNo } from '../common/document-number';
import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { CATEGORY_LABELS, isOverseasType } from '../common/constants';
import { ErrorCode } from '../common/error-code';
import { UserLookupService } from '../directory/user-lookup.service';
import { decorateProviderApp } from '../identity/identity.service';
import { IdentityService } from '../identity/identity.service';
import { ContractsService } from '../contracts/contracts.service';
import { PrismaService } from '../prisma/prisma.service';
import { ContactResolver } from '../shared/contacts.service';
import { sideContactBody } from '../shared/contacts';
export class OverseasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly contracts: ContractsService,
    private readonly users: UserLookupService,
    private readonly contacts: ContactResolver,
  ) {}

  async claimPage(user: CurrentUser, query: Record<string, unknown>) {
    const { page, pageSize, offset } = pageParam(
      Number(query.page ?? 1),
      Number(query.pageSize ?? 20),
    );
    const scope = await this.claimScope(user);
    const keyword = text(query.keyword ?? '').trim();
    const where = {
      AND: [
        scope ?? { id: -1 },
        {
          ...(query.status ? { status: text(query.status) } : {}),
          ...(keyword
            ? {
                OR: [
                  {
                    claimNo: {
                      contains: keyword,
                    },
                  },
                  {
                    title: { contains: keyword },
                  },
                  {
                    country: {
                      contains: keyword,
                    },
                  },
                ],
              }
            : {}),
        },
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.overseasClaim.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.overseasClaim.count({ where }),
    ]);
    return { list: rows, total, page, pageSize };
  }
  async claimStats(user: CurrentUser) {
    const scope = await this.claimScope(user);
    const rows = await this.prisma.overseasClaim.groupBy({
      by: ['status'],
      where: scope ?? { id: -1 },
      _count: { _all: true },
    });
    return {
      total: rows.reduce((sum, row) => sum + row._count._all, 0),
      byStatus: Object.fromEntries(
        rows.map((row) => [row.status, row._count._all]),
      ),
    };
  }

  async claimDetail(user: CurrentUser, id: number) {
    const scope = await this.claimScope(user);
    const row = await this.prisma.overseasClaim.findFirst({
      where: { AND: [scope ?? { id: -1 }, { id }] },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '记录不存在或不可访问');
    return row;
  }
  async catalog() {
    const apps = await this.prisma.providerApplication.findMany({
      where: { providerType: 'EXPORT_REFUND', status: 'APPROVED' },
      orderBy: { id: 'desc' },
    });
    // 详情页对接人 = 服务商已绑定生效的职员（与「指定业务人员」同一份名单），不读备案名录
    const ids = apps.map((app) => app.userId);
    const [staffByProvider, names] = await Promise.all([
      this.contracts.providerStaffForMany(ids, 'EXPORT_REFUND'),
      this.users.displayNames(ids),
    ]);
    return apps.map((app) => ({
      ...decorateProviderApp(app),
      business_staff: staffByProvider.get(app.userId) || [],
      display_name: names.get(app.userId) || app.userId,
      items: app.serviceItems
        ? app.serviceItems.split(',').filter(Boolean)
        : [],
    }));
  }
  private async claimScope(
    user: CurrentUser,
  ): Promise<Prisma.OverseasClaimWhereInput> {
    const eps = await this.identity.myEnterprises(user.userId);
    const ctx = await this.identity.providerContext(user.userId);
    if (this.identity.isPlatformAdmin(user)) return {};
    if (ctx.providers.length && !eps.length)
      return { providerUserId: { in: ctx.providers } };
    return { enterpriseId: { in: eps.map((item) => item.id) } };
  }
  async list(user: CurrentUser) {
    return this.prisma.overseasClaim.findMany({
      where: await this.claimScope(user),
      orderBy: { id: 'desc' },
    });
  }
  async create(
    user: CurrentUser,
    body: import('@enterprise/contracts').EndpointInput<'Overseas_create'>['body'],
  ) {
    await this.identity.requireRoles(user, 'ENTERPRISE_USER');
    const serviceType = String(body.service_type || '');
    if (!isOverseasType(serviceType)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '出海服务类型不合法');
    }
    const eps = await this.identity.myEnterprises(user.userId);
    if (!eps.length) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '请先完善企业信息');
    }
    const contract = await this.contracts.requireActiveContract(
      eps[0].id,
      serviceType,
    );
    const staffUserId = await this.resolveHandlingStaff(
      contract.providerUserId,
      eps[0].id,
      contract.designatedStaff,
    );
    if (!staffUserId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该出海服务尚未指定承办职员：请服务商先在「职员/代理人管理 · 企业分配」把本企业分配给主办职员',
      );
    }

    const row = await this.prisma.overseasClaim.create({
      data: {
        claimNo: await allocateNo(this.prisma, 'HW'),
        contractId: contract.id,
        enterpriseId: eps[0].id,
        providerUserId: contract.providerUserId,
        staffUserId,
        serviceType,
        title: body.title || CATEGORY_LABELS[serviceType],
        amount: body.amount || 0,
        country: body.country || '',
        remark: body.remark || '',
        status: 'SUBMITTED',
        // 办理联系方式：企业侧 + 承办职员（系统自动带出，临时换人可改）
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
    return { id: row.id, status: row.status, claim_no: row.claimNo };
  }
  /**
   * 出海服务的承办职员：优先「企业分配」的主办职员；
   * 未分配时按签约里指定的业务人员（对接人）姓名匹配该服务商已绑定职员。
   */
  private async resolveHandlingStaff(
    providerUserId: string,
    enterpriseId: number,
    designatedStaff: unknown,
  ) {
    const assigned = await this.identity.assignedStaffFor(
      providerUserId,
      enterpriseId,
    );
    if (assigned) return assigned;
    const name = String(
      (
        designatedStaff as {
          name?: string;
        } | null
      )?.name || '',
    ).trim();
    if (!name) return '';
    const binds = await this.prisma.providerStaff.findMany({
      where: { providerUserId, status: 'ACTIVE' },
    });
    if (!binds.length) return '';
    const profiles = await this.prisma.staffProfile.findMany({
      where: { userId: { in: binds.map((item) => item.staffUserId) } },
    });
    return profiles.find((item) => item.realName === name)?.userId || '';
  }
  async advance(
    user: CurrentUser,
    id: number,
    action: string,
    body: Record<string, unknown> = {},
  ) {
    const row = await this.prisma.overseasClaim.findUnique({ where: { id } });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '出海申请不存在');
    // 作业主体是承办职员：仅被指派的职员（或平台管理员）可推进
    const isHandlingStaff =
      Boolean(row.staffUserId) && row.staffUserId === user.userId;
    const isProviderAccount = row.providerUserId === user.userId;
    if (
      !isHandlingStaff &&
      !(isProviderAccount && !row.staffUserId) &&
      !this.identity.isPlatformAdmin(user)
    ) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        row.staffUserId
          ? '仅该企业的承办职员可办理（服务商账号不代替承办人作业）'
          : '请服务商先在「职员/代理人管理 · 企业分配」指定承办职员',
      );
    }
    const next =
      action === 'ACCEPT'
        ? 'IN_REVIEW'
        : action === 'APPROVE'
          ? row.serviceType === 'EXPORT_REFUND'
            ? 'APPROVED'
            : 'APPROVED'
          : action === 'REFUND'
            ? 'REFUNDED'
            : action === 'REJECT'
              ? 'REJECTED'
              : '';
    if (!next) throw new BusinessException(ErrorCode.BAD_REQUEST, '动作不合法');
    if (action === 'REFUND' && row.serviceType !== 'EXPORT_REFUND') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '非退税类不可确认退税',
      );
    }
    const stageContacts = await this.contacts.stage(
      {
        enterpriseId: row.enterpriseId,
        staffUserId: row.staffUserId,
        providerUserId: row.providerUserId,
      },
      body,
    );
    await this.prisma.overseasClaim.update({
      where: { id },
      data: { status: next, ...stageContacts },
    });
    return { id, status: next, ...stageContacts };
  }
  /**
   * 改联系方式（临时换人）：企业当事人改企业侧、承办人改执行侧，均可不改状态。
   * 系统已按对应人档案自动带出，这里只处理人工调整。
   */
  async updateContacts(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown> = {},
  ) {
    const row = await this.prisma.overseasClaim.findUnique({ where: { id } });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '出海申请不存在');
    const admin = this.identity.isPlatformAdmin(user);
    const eps = await this.identity.myEnterprises(user.userId);
    const isEnterpriseParty = eps.some((item) => item.id === row.enterpriseId);
    const isHandlingStaff =
      Boolean(row.staffUserId) && row.staffUserId === user.userId;
    const isProviderAccount = row.providerUserId === user.userId;
    if (
      !admin &&
      !isEnterpriseParty &&
      !isHandlingStaff &&
      !isProviderAccount
    ) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅企业当事人或承办人可修改联系方式',
      );
    }
    const side = await this.identity.contactSide(user, {
      enterpriseId: row.enterpriseId,
    });
    const updated = await this.prisma.overseasClaim.update({
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
      'OVERSEAS_CONTACTS_UPDATE',
      `${row.claimNo} 联系方式`,
    );
    return {
      id,
      contact_name: updated.contactName,
      contact_phone: updated.contactPhone,
      provider_contact_name: updated.providerContactName,
      provider_contact_phone: updated.providerContactPhone,
    };
  }
}
