import { Prisma, type ProviderApplication } from '../../generated/prisma';
import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import {
  CATEGORY_LABELS,
  FLEX_PAYROLL_ENABLED_KEY,
  SERVICE_TYPES,
  SUBITEM_CATEGORY_LABELS,
  hasSubItems,
  subItemsOf,
} from '../common/constants';
import { ErrorCode } from '../common/error-code';
import { UserLookupService } from '../directory/user-lookup.service';
import { decorateProviderApp } from '../identity/identity.service';
import {
  CAPABILITY_OPEN_DATES_KEY,
  CapabilityService,
} from '../capability/capability.service';
import { GeoCollectionService } from '../geo/geo-collection.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  QXY_ACCOUNTS_KEY,
  QXY_SETTINGS_KEY,
} from '../qixiangyun/qxy-settings.service';
import { OSS_SETTINGS_KEY } from '../oss/oss-settings.service';
import { AIPDD_PLATFORM_KEY_SETTINGS } from '../account/aipdd-key.service';
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly users: UserLookupService,
    private readonly capability: CapabilityService,
    private readonly collection: GeoCollectionService,
  ) {}
  async stats(user: CurrentUser) {
    this.identity.requireAdmin(user);
    // 备案表一次 groupBy 同时给出两口径：各类型「已通过」计数 + 「待审核」总数。
    // 原来是 1 次 PENDING count + 11 次串行 for-of count（每个类型一次 round-trip）。
    const [
      enterprises,
      providerGroups,
      activeContracts,
      pendingContracts,
      declarations,
      logistics,
      smartOrders,
      lawyers,
      ipAgencies,
      flexProviders,
      users,
      providerAccounts,
      taxAmountAgg,
      overseas,
      legalRequests,
      ipRequests,
      flexOrders,
      marketingOrders,
    ] = await Promise.all([
      this.prisma.enterpriseProfile.count({ where: { status: 'APPROVED' } }),
      this.prisma.providerApplication.groupBy({
        by: ['providerType', 'status'],
        where: { status: { in: ['APPROVED', 'PENDING'] } },
        _count: { _all: true },
      }),
      this.prisma.contract.count({ where: { status: 'ACTIVE' } }),
      this.prisma.contract.count({ where: { status: 'PENDING' } }),
      this.prisma.taxDeclaration.count(),
      this.prisma.logisticsOrder.count(),
      this.prisma.smartServiceOrder.count(),
      this.prisma.lawyerResource.count({
        where: { status: { notIn: ['HIDDEN', 'REJECTED'] } },
      }),
      this.prisma.ipAgency.count({
        where: { status: { notIn: ['HIDDEN', 'REJECTED'] } },
      }),
      this.prisma.flexProvider.count({
        where: { status: { notIn: ['HIDDEN', 'REJECTED'] } },
      }),
      this.prisma.userDirectory.count(),
      // 服务商账号数按 userId 去重，交给数据库 DISTINCT，不把整表拉回进程内再 Set
      this.prisma.providerApplication.findMany({
        where: { status: 'APPROVED' },
        select: { userId: true },
        distinct: ['userId'],
      }),
      this.prisma.taxDeclaration.aggregate({ _sum: { taxAmount: true } }),
      this.prisma.overseasClaim.count(),
      this.prisma.legalRequest.count(),
      this.prisma.ipRequest.count(),
      this.prisma.flexWorkOrder.count(),
      this.prisma.marketingOrder.count(),
    ]);
    const servicesByType: Record<string, number> = {};
    for (const type of SERVICE_TYPES) servicesByType[type] = 0;
    let pendingProvider = 0;
    for (const group of providerGroups) {
      if (group.status === 'PENDING') {
        pendingProvider += group._count._all;
        continue;
      }
      if (group.providerType in servicesByType) {
        servicesByType[group.providerType] = group._count._all;
      }
    }
    // 平台总览口径（全部来自本系统自建数据）：
    // 注册用户＝本系统已识别的账号（user_directory）；服务商＝有已通过备案的服务商账号；
    // 累计申报税额＝申报单税额合计；其余为各业务单据总数。
    const providers = providerAccounts.length;
    return {
      enterprises,
      users,
      providers,
      pendingProvider,
      activeContracts,
      pendingContracts,
      declarations,
      taxAmountTotal: Number(taxAmountAgg._sum.taxAmount || 0),
      overseas,
      legalRequests,
      ipRequests,
      flexOrders,
      marketingOrders,
      logistics,
      smartOrders,
      lawyers,
      ipAgencies,
      flexProviders,
      servicesByType,
    };
  }
  async enterprises(user: CurrentUser, status?: string) {
    this.identity.requireAdmin(user);
    return this.prisma.enterpriseProfile.findMany({
      where: status ? { status } : undefined,
      orderBy: { id: 'desc' },
    });
  }
  async providerApplications(user: CurrentUser, status?: string) {
    this.identity.requireAdmin(user);
    const rows = await this.prisma.providerApplication.findMany({
      where: status ? { status } : undefined,
      orderBy: { id: 'desc' },
    });
    return this.decorateApplications(rows);
  }
  private async decorateApplications(rows: ProviderApplication[]) {
    const directory = await this.directoryMap(rows.map((row) => row.userId));
    return rows.map((row) => ({
      ...decorateProviderApp(row),
      owner_name: directory.get(row.userId)?.displayName || '',
      username: directory.get(row.userId)?.username || '',
    }));
  }
  async applicationPage(user: CurrentUser, page: number, pageSize: number) {
    this.identity.requireAdmin(user);
    const [rows, total] = await Promise.all([
      this.prisma.providerApplication.findMany({
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.providerApplication.count(),
    ]);
    return {
      list: await this.decorateApplications(rows),
      total,
      page,
      pageSize,
    };
  }
  async providerPage(user: CurrentUser, page: number, pageSize: number) {
    this.identity.requireAdmin(user);
    const where = { status: { in: ['APPROVED', 'DELISTED'] } };
    // 先按账号分页，再读取当页全部资质，避免一个服务商被切到不同页。
    const [groups, counts] = await Promise.all([
      this.prisma.providerApplication.groupBy({
        by: ['userId'],
        where,
        _max: { id: true },
        orderBy: { _max: { id: 'desc' } },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.$queryRaw<
        { total: bigint }[]
      >`SELECT COUNT(DISTINCT user_id) AS total FROM provider_applications WHERE status IN ('APPROVED','DELISTED')`,
    ]);
    const rows = await this.prisma.providerApplication.findMany({
      where: { ...where, userId: { in: groups.map((group) => group.userId) } },
      orderBy: { id: 'desc' },
    });
    const directory = await this.directoryMap(
      groups.map((group) => group.userId),
    );
    const list = groups.map((group) => {
      const apps = rows.filter((row) => row.userId === group.userId);
      return {
        userId: group.userId,
        nickname:
          directory.get(group.userId)?.displayName || apps[0]?.orgName || '',
        org: apps.find((row) => row.orgName)?.orgName || '',
        services: apps.map((row) => ({
          type: row.providerType,
          status: row.status,
          auditedAt: row.auditedAt,
          auditNote: row.auditNote,
        })),
      };
    });
    return { list, total: Number(counts[0]?.total || 0), page, pageSize };
  }
  async providerStats(user: CurrentUser) {
    this.identity.requireAdmin(user);
    return {
      serviceTotal: await this.prisma.providerApplication.count({
        where: {
          status: { in: ['APPROVED', 'DELISTED'] },
          providerType: { not: 'MICRO' },
        },
      }),
    };
  }
  /** 批量取本系统自建用户目录（AIworkin 账号名/昵称/邮箱/账号状态）。 */
  private async directoryMap(userIds: string[]) {
    const users = await this.users.lookup(userIds);
    return new Map(users.map((item) => [item.id, item]));
  }
  async auditProvider(
    user: CurrentUser,
    id: number,
    action: 'APPROVE' | 'REJECT',
    note = '',
    /** 出海服务：细项逐项审核结论 [{ item, status: 'APPROVE'|'REJECT', note }] */
    items: {
      item?: string;
      status?: string;
      note?: string;
    }[] = [],
  ) {
    this.identity.requireAdmin(user);
    const row = await this.prisma.providerApplication.findUnique({
      where: { id },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '备案申请不存在');
    if (!['PENDING', 'APPROVED'].includes(row.status)) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该申请已驳回/已撤回，请由服务商重新提交',
      );
    }
    if (action === 'APPROVE' && row.status === 'APPROVED') {
      throw new BusinessException(ErrorCode.CONFLICT, '该资质已通过审核');
    }
    // 已通过的服务商也可被「不通过」：但该类目有生效中签约时须先解约
    if (action === 'REJECT' && row.status === 'APPROVED') {
      const types = hasSubItems(row.providerType)
        ? subItemsOf(row.providerType)
        : [row.providerType];
      const active = await this.prisma.contract.count({
        where: {
          providerUserId: row.userId,
          serviceType: { in: types },
          status: 'ACTIVE',
        },
      });
      if (active > 0) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '该类目存在生效中签约，请先解约后再置为不通过',
        );
      }
    }
    /** 细项逐项审核（出海 / 营销 / 物流（含小微）/ 资产交易）：每项都要给结论，只有通过项才生效。 */
    const itemDecisions = Array.isArray(items) ? items : [];
    const bearing = hasSubItems(row.providerType);
    let serviceItems = row.serviceItems;
    let itemAudits: Prisma.InputJsonValue =
      row.itemAudits as Prisma.InputJsonValue;
    let finalStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    let auditNote = note;
    if (bearing && action === 'APPROVE') {
      const selected = (row.serviceItems || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      // 存量备案行没勾过细项：没有可审的项，直接通过会静默变「全部不通过」，先要材料
      if (!selected.length) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `该备案未勾选${SUBITEM_CATEGORY_LABELS[row.providerType] || row.providerType}细项，请先驳回并要求服务商补充细项`,
        );
      }
      const decided = new Map(
        itemDecisions.map((item) => [String(item.item || ''), item]),
      );
      const missing = selected.filter((item) => !decided.has(item));
      if (missing.length) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `${SUBITEM_CATEGORY_LABELS[row.providerType] || row.providerType}细项需逐项审核：${missing
            .map((item) => CATEGORY_LABELS[item] || item)
            .join('、')} 尚未给出结论`,
        );
      }
      const approvedItems = selected.filter(
        (item) => decided.get(item)?.status !== 'REJECT',
      );
      itemAudits = selected.map((item) => ({
        item,
        label: CATEGORY_LABELS[item] || item,
        status:
          decided.get(item)?.status === 'REJECT' ? 'REJECTED' : 'APPROVED',
        note: String(decided.get(item)?.note || ''),
      }));
      serviceItems = approvedItems.join(',');
      // 细项全部不通过 → 整体不通过
      if (!approvedItems.length) {
        finalStatus = 'REJECTED';
        auditNote =
          note ||
          `所选${SUBITEM_CATEGORY_LABELS[row.providerType] || row.providerType}细项均未通过`;
      }
    }
    const status = finalStatus;
    // 备案结论 → 审计留痕 → 小微「本人职员」登记：三段写入必须同生共死，
    // 只落一半会留下「资质已通过但没有本人职员」的机构（物流直营工单无承办人）。
    await this.prisma.$transaction(async (tx) => {
      await tx.providerApplication.update({
        where: { id },
        data: {
          status,
          auditNote,
          auditedAt: new Date(),
          serviceItems,
          ...(bearing && action === 'APPROVE' ? { itemAudits } : {}),
        },
      });
      await this.identity.audit(
        user.userId,
        '服务商备案审核',
        `${action} ${row.orgName}${
          bearing && action === 'APPROVE'
            ? `（${SUBITEM_CATEGORY_LABELS[row.providerType] || row.providerType}细项：${serviceItems || '全部不通过'}）`
            : ''
        }`,
        tx,
      );
      // 该用户已通过的全部服务资质：决定他是「小微服务商」还是「服务商」
      if (status === 'APPROVED') {
        const approved = await tx.providerApplication.findMany({
          where: { userId: row.userId, status: 'APPROVED' },
        });
        const types = new Set(approved.map((item) => item.providerType));
        // 具备 MICRO 资质（仅 MICRO 或混合）时登记「本人职员」：
        // 小微＝本人即唯一职员；混合时物流直营业务仍按小微规则（派单给本人）。
        if (types.has('MICRO')) {
          await this.identity.registerSelfStaff(row.userId, tx);
        }
      }
    });
    return { id, status };
  }
  async providers(user: CurrentUser) {
    this.identity.requireAdmin(user);
    const rows = await this.prisma.providerApplication.findMany({
      where: { status: { in: ['APPROVED', 'DELISTED'] } },
      orderBy: { id: 'desc' },
    });
    const directory = await this.directoryMap(rows.map((row) => row.userId));
    return rows.map((row) => {
      const account = directory.get(row.userId);
      return {
        ...decorateProviderApp(row),
        owner_name: account?.displayName || '',
        username: account?.username || '',
        /** 账号状态（本系统自建用户目录）：停用账号不可再开展新业务 */
        account_status: account
          ? account.enabled
            ? 'ENABLED'
            : 'DISABLED'
          : 'UNKNOWN',
        account_status_label: account
          ? account.enabled
            ? '正常'
            : '已停用'
          : '未登记',
      };
    });
  }
  async toggleService(
    user: CurrentUser,
    providerUserId: string,
    type: string,
    action: 'revoke' | 'restore',
  ) {
    this.identity.requireAdmin(user);
    const status = action === 'revoke' ? 'DELISTED' : 'APPROVED';
    await this.prisma.providerApplication.updateMany({
      where: { userId: providerUserId, providerType: type },
      data: { status },
    });
    return { providerUserId, type, status };
  }
  /** 企业能力（电子报税/电子开票）：查看某企业能力清单。 */
  async capabilities(user: CurrentUser, enterpriseId: number) {
    this.identity.requireAdmin(user);
    return this.capability.ofEnterprise(Number(enterpriseId));
  }
  /** 企业能力：开通 / 关闭；开通时可按税号匹配企享云报税 API Key。 */
  async setCapability(
    user: CurrentUser,
    enterpriseId: number,
    code: string,
    action: string,
    note = '',
    qxyAccountId = '',
  ) {
    return this.capability.setStatus(
      user,
      Number(enterpriseId),
      code,
      action === 'close' ? 'close' : 'open',
      note,
      qxyAccountId,
    );
  }
  /** 企业 × 能力矩阵（一行一个企业，含两项能力状态）。 */
  async capabilityMatrix(user: CurrentUser) {
    return (await this.capabilityPage(user)).list;
  }
  async capabilityPage(user: CurrentUser, page?: number, pageSize = 20) {
    return this.capability.adminMatrix(user, page, pageSize);
  }
  /** 待开通的能力申请。 */
  async capabilityRequests(user: CurrentUser) {
    this.identity.requireAdmin(user);
    return this.capability.pendingRequests();
  }
  async requestPage(user: CurrentUser, page: number, pageSize: number) {
    this.identity.requireAdmin(user);
    return this.capability.pendingRequestPage(page, pageSize);
  }
  async settings(user: CurrentUser) {
    this.identity.requireAdmin(user);
    const rows = await this.prisma.systemSetting.findMany();
    return Object.fromEntries(
      rows
        .filter(
          (row) =>
            row.key !== QXY_SETTINGS_KEY &&
            row.key !== QXY_ACCOUNTS_KEY &&
            row.key !== CAPABILITY_OPEN_DATES_KEY &&
            row.key !== OSS_SETTINGS_KEY &&
            row.key !== AIPDD_PLATFORM_KEY_SETTINGS,
        )
        .map((row) => [row.key, row.value]),
    );
  }
  /** 灵工发薪板块开关（管理后台「灵活用工审核」页签的按钮）：默认启用。 */
  async flexPayrollSwitch(user: CurrentUser) {
    this.identity.requireAdmin(user);
    return {
      enabled: await this.identity.flexPayrollEnabled(),
      updatedAt:
        (await this.identity.getSetting(
          `${FLEX_PAYROLL_ENABLED_KEY}_updated_at`,
        )) || '',
    };
  }
  async saveFlexPayrollSwitch(user: CurrentUser, enabled: boolean) {
    this.identity.requireAdmin(user);
    await this.identity.setFlexPayrollEnabled(enabled);
    return this.flexPayrollSwitch(user);
  }
  /** 平台级参数保存：附件存储等已改为写死配置（backend/src/oss/oss.config.ts），此处不再写入 OSS 地址。 */
  async saveSettings(user: CurrentUser, body: Record<string, string>) {
    this.identity.requireAdmin(user);
    if (Object.hasOwn(body, QXY_SETTINGS_KEY)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '企享云历史凭据请通过「财税管理」专用入口保存',
      );
    }
    if (Object.hasOwn(body, QXY_ACCOUNTS_KEY)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '企享云报税 API Key 请通过「财税管理」专用入口保存',
      );
    }
    if (Object.hasOwn(body, OSS_SETTINGS_KEY)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'OSS 配置请通过「系统配置 → 文件存储」专用入口保存',
      );
    }
    if (Object.hasOwn(body, AIPDD_PLATFORM_KEY_SETTINGS)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '平台 AIPDD APIKey 请通过「系统配置 → AIPDD 平台 Key」专用入口保存',
      );
    }
    for (const [key, value] of Object.entries(body)) {
      if (key === 'oss_base_url' || key.endsWith('_updated_at')) continue;
      await this.identity.setSetting(key, String(value ?? ''));
    }
    return this.settings(user);
  }
  /** GEO 每周采集任务量：本周计划 / 实际完成（含周日未跑完顺延次日）与逐项目明细。 */
  async geoCollectionStats(user: CurrentUser) {
    this.identity.requireAdmin(user);
    return this.collection.stats();
  }
  /** 注册用户：本系统已识别的全部账号（AIworkin 账号目录）；附带本地 users 表的邀请码与邀请人。 */
  async listUsers(user: CurrentUser) {
    this.identity.requireAdmin(user);
    const [rows, accounts] = await Promise.all([
      this.prisma.userDirectory.findMany({
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.account.findMany({
        select: { id: true, username: true, inviteCode: true, invitedBy: true },
      }),
    ]);
    const byId = new Map(accounts.map((account) => [account.id, account]));
    return rows.map((row) => {
      const account = byId.get(Number(row.userId));
      return {
        ...row,
        inviteCode: account?.inviteCode || '',
        invitedByUsername: account?.invitedBy
          ? byId.get(account.invitedBy)?.username || ''
          : '',
      };
    });
  }
  async contracts(user: CurrentUser, status?: string) {
    this.identity.requireAdmin(user);
    return this.prisma.contract.findMany({
      where: status ? { status } : undefined,
      orderBy: { id: 'desc' },
    });
  }
  async contractPage(
    user: CurrentUser,
    page: number,
    pageSize: number,
    status?: string,
  ) {
    this.identity.requireAdmin(user);
    const where = status ? { status } : undefined;
    const [list, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.contract.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }
}
