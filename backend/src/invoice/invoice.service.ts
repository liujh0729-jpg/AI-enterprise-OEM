import { Prisma, type InvoiceRequest } from '../../generated/prisma';
import { allocateNo } from '../common/document-number';
import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { QxyService } from '../qixiangyun/qxy.service';
import { ContactResolver } from '../shared/contacts.service';
import { sideContactBody } from '../shared/contacts';
export const INVOICE_REQUEST_STATUS: Record<string, string> = {
  REQUESTED: '待审核',
  ISSUING: '正在提交开票',
  SUBMITTED: '已提交开票任务',
  ISSUE_UNKNOWN: '开票结果待核对',
  ISSUED: '已开具',
  REJECTED: '已驳回',
  CANCELLED: '已撤回',
};
export type InvoiceLineInput = {
  goodsCode?: string;
  goodsName?: string;
  spec?: string;
  quantity?: number;
  price?: number;
  taxRate?: string;
};
export type InvoiceRequestInput = {
  enterpriseId: number;
  invoiceType?: string;
  buyerType?: string;
  buyerName?: string;
  buyerTaxNo?: string;
  orderNo?: string;
  remark?: string;
  items?: InvoiceLineInput[];
  [key: string]: unknown;
};
/**
 * 开发票申请（需求 6.4）：**企业申请开票 → 财税承办人/财务专员审核 → 走企享云自动开票**。
 * 与「申报计划」同构：企业是发起方，服务商侧只由**承办人**审核与开具；
 * 企业已开好的发票在「已开发票」统一查询管理（企享云回查）。
 */
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly qxy: QxyService,
    private readonly contacts: ContactResolver,
  ) {}
  /** 企业发起开票申请；承办人取该企业财税承办职员。 */
  async create(user: CurrentUser, input: InvoiceRequestInput) {
    const enterpriseId = Number(input.enterpriseId || 0);
    if (!enterpriseId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择开票企业');
    }
    const enterprise = await this.prisma.enterpriseProfile.findUnique({
      where: { id: enterpriseId },
    });
    if (!enterprise) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '企业不存在');
    }
    if (
      enterprise.userId !== user.userId &&
      !this.identity.isPlatformAdmin(user)
    ) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '只能为本人所属企业申请开票',
      );
    }
    if (enterprise.status !== 'APPROVED') {
      throw new BusinessException(ErrorCode.FORBIDDEN, '企业资料尚未审核通过');
    }
    const buyerName = String(input.buyerName || '').trim();
    if (!buyerName) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写购方名称');
    }
    const items = (input.items || [])
      .map((item) => this.normalizeLine(item))
      .filter((item) => item.goodsName);
    if (!items.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请至少填写一条项目明细（货物或服务名称）',
      );
    }
    const contract = await this.prisma.contract.findFirst({
      where: { enterpriseId, serviceType: 'TAX_FINANCE', status: 'ACTIVE' },
      orderBy: { id: 'asc' },
    });
    if (!contract) {
      throw new BusinessException(
        ErrorCode.NO_ACTIVE_CONTRACT,
        '该企业尚未与财税服务商签约，无法申请开票',
      );
    }
    const staffUserId = await this.identity.assignedStaffFor(
      contract.providerUserId,
      enterpriseId,
    );
    if (!staffUserId) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '该企业尚未指派财税承办职员，请联系服务商分配后再申请开票',
      );
    }
    const bind = await this.prisma.providerStaff.findFirst({
      where: {
        providerUserId: contract.providerUserId,
        staffUserId,
        status: 'ACTIVE',
      },
    });
    if (
      !bind ||
      !Array.isArray(bind.roles) ||
      !bind.roles.some(
        (role) => typeof role === 'string' && role.includes('财税专员'),
      ) ||
      !(await this.identity.hasServiceType(
        contract.providerUserId,
        'TAX_FINANCE',
      ))
    ) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '当前财税承办职员已失去承办资格，请联系服务商重新分配',
      );
    }

    const totals = this.totalsOf(items);
    const row = await this.prisma.invoiceRequest.create({
      data: {
        reqNo: await allocateNo(this.prisma, 'KP'),
        enterpriseId,
        enterpriseName: enterprise.name,
        requestedBy: user.userId,
        providerUserId: contract.providerUserId,
        staffUserId,
        invoiceType: String(input.invoiceType || '04'),
        buyerType: String(input.buyerType || '1'),
        buyerName,
        buyerTaxNo: String(input.buyerTaxNo || '').trim(),
        orderNo: String(input.orderNo || '').trim(),
        remark: String(input.remark || '').trim(),
        items,
        amount: totals.amount,
        tax: totals.tax,
        status: 'REQUESTED',
        ...(await this.contacts.stage(
          {
            enterpriseUserId: enterprise.userId,
            enterpriseId,
            staffUserId,
            providerUserId: contract.providerUserId,
          },
          input,
        )),
      },
    });
    await this.identity.audit(
      user.userId,
      '申请开票',
      `${enterprise.name} · ${row.reqNo} → ${buyerName} ￥${totals.amount}`,
    );
    return this.detail(user, row.id);
  }
  /** 列表：企业当事人看本企业；承办职员/服务商看承办的；管理员全量。 */
  async list(user: CurrentUser, status?: string) {
    const scope = await this.scope(user);
    const where: Record<string, unknown> = {};
    if (scope) Object.assign(where, scope);
    if (status) where.status = status;
    const candidates = await this.prisma.invoiceRequest.findMany({
      where,
      orderBy: { id: 'desc' },
      take: 300,
    });
    const checks = new Map<string, Promise<boolean>>();
    for (const row of candidates) {
      const key = `${row.enterpriseId}:${row.providerUserId}:${row.staffUserId}`;
      if (!checks.has(key)) checks.set(key, this.canAccess(user, row));
    }
    const allowed = new Map<string, boolean>();
    await Promise.all(
      [...checks].map(async ([key, check]) => allowed.set(key, await check)),
    );
    const rows = candidates.filter((row) =>
      allowed.get(
        `${row.enterpriseId}:${row.providerUserId}:${row.staffUserId}`,
      ),
    );
    return this.decorateRows(user, rows);
  }
  private async decorateRows(user: CurrentUser, rows: InvoiceRequest[]) {
    const names = await this.staffNames(rows.map((row) => row.staffUserId));
    const requesterNames = await this.staffNames(
      rows.map((row) => row.requestedBy),
    );
    return Promise.all(
      rows.map(async (row) => ({
        ...this.asJson(row),
        staffName: names.get(row.staffUserId) || '',
        requesterName: requesterNames.get(row.requestedBy) || '',
        statusLabel: INVOICE_REQUEST_STATUS[row.status] || row.status,
        canReview: await this.canReview(user, row),
      })),
    );
  }
  private async accessibleWhere(
    user: CurrentUser,
  ): Promise<Prisma.InvoiceRequestWhereInput> {
    const scope = await this.scope(user);
    if (this.identity.isPlatformAdmin(user)) return {};
    // 先校验去重后的权限主体，再在数据库内分页，避免过滤当前页造成漏页和错误总数。
    const subjects = await this.prisma.invoiceRequest.findMany({
      where: scope,
      distinct: ['enterpriseId', 'providerUserId', 'staffUserId'],
      select: { enterpriseId: true, providerUserId: true, staffUserId: true },
    });
    const allowed = await Promise.all(
      subjects.map(async (subject) =>
        (await this.canAccess(user, subject)) ? subject : null,
      ),
    );
    return {
      OR: allowed.filter(
        (subject): subject is NonNullable<typeof subject> => subject !== null,
      ),
    };
  }
  async page(
    user: CurrentUser,
    query: {
      page: number;
      pageSize: number;
      status?: string;
      enterpriseId?: number;
    },
  ) {
    const { page, pageSize } = query;
    const where: Prisma.InvoiceRequestWhereInput = {
      AND: [
        await this.accessibleWhere(user),
        {
          ...(query.status ? { status: query.status } : {}),
          ...(query.enterpriseId ? { enterpriseId: query.enterpriseId } : {}),
        },
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.invoiceRequest.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.invoiceRequest.count({ where }),
    ]);
    return { list: await this.decorateRows(user, rows), total, page, pageSize };
  }
  async stats(user: CurrentUser, query: { enterpriseId?: number }) {
    const where: Prisma.InvoiceRequestWhereInput = {
      AND: [
        await this.accessibleWhere(user),
        query.enterpriseId ? { enterpriseId: query.enterpriseId } : {},
      ],
    };
    const rows = await this.prisma.invoiceRequest.groupBy({
      by: ['status'],
      where,
      _count: true,
    });
    return {
      total: rows.reduce((sum, row) => sum + row._count, 0),
      byStatus: Object.fromEntries(rows.map((row) => [row.status, row._count])),
    };
  }
  async detail(user: CurrentUser, id: number) {
    if (!Number.isFinite(id) || id <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '开票申请 ID 不合法');
    }
    const exists = await this.prisma.invoiceRequest.findUnique({
      where: { id },
    });
    if (!exists) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '开票申请不存在');
    }
    const scope = await this.scope(user);
    const row = await this.prisma.invoiceRequest.findFirst({
      where: scope ? { AND: [{ id }, scope] } : { id },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '无权查看该开票申请（仅承办人与企业当事人可见）',
      );
    }
    if (!(await this.canAccess(user, row))) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '无权查看该开票申请');
    }
    const names = await this.staffNames([row.staffUserId]);
    return {
      ...this.asJson(row),
      staffName: names.get(row.staffUserId) || '',
      statusLabel: INVOICE_REQUEST_STATUS[row.status] || row.status,
      canReview: await this.canReview(user, row),
    };
  }
  /** 审核通过后提交异步开票任务；提交状态与实际开具结果分开记录。 */
  async approve(
    user: CurrentUser,
    id: number,
    note?: string,
    body: Record<string, unknown> = {},
  ) {
    const row = await this.requireReviewable(user, id);
    const orderNo = row.orderNo || row.reqNo;
    const input = {
      invoiceType: row.invoiceType,
      buyerType: row.buyerType,
      buyerName: row.buyerName,
      buyerTaxNo: row.buyerTaxNo,
      orderNo,
      remark: row.remark,
      items: this.linesOf(row.items),
    };
    // 本地权限、企业绑定和能力门控必须先于状态抢占检查，避免明确的配置错误
    // 将申请留在“可能已送达上游”的状态。
    await this.qxy.assertAutoInvoiceReady(user, row.enterpriseId);
    const contactData = await this.contacts.stage(
      {
        enterpriseId: row.enterpriseId,
        staffUserId: row.staffUserId,
        providerUserId: row.providerUserId,
      },
      body,
    );
    // 先落稳定订单号并原子抢占，再触发不可回滚的上游调用。
    // 进程中断或超时后绝不自动改回 REQUESTED，避免再次审核重复开票。
    const claim = await this.prisma.invoiceRequest.updateMany({
      where: { id, status: 'REQUESTED' },
      data: {
        status: 'ISSUING',
        orderNo,
        reviewedBy: user.userId,
        reviewedAt: new Date(),
        ...contactData,
      },
    });
    if (claim.count !== 1) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该申请已被审核或正在开票',
      );
    }
    let result: Awaited<ReturnType<QxyService['autoIssueInvoice']>>;
    try {
      result = await this.qxy.autoIssueInvoice(user, row.enterpriseId, input);
    } catch (error) {
      await this.prisma.invoiceRequest.updateMany({
        where: { id, status: 'ISSUING' },
        data: {
          status: 'ISSUE_UNKNOWN',
          issueMessage:
            '企享云提交结果未确认，请先核对平台任务与发票，再决定后续处理',
        },
      });
      throw error;
    }
    const task = result.task;
    const taskValue =
      task && typeof task === 'object'
        ? ((task as Record<string, unknown>).taskId ??
          (task as Record<string, unknown>).task_id)
        : undefined;
    const taskId =
      typeof taskValue === 'string' || typeof taskValue === 'number'
        ? String(taskValue)
        : '';
    const updated = await this.prisma.invoiceRequest.update({
      where: { id },
      data: {
        status: 'SUBMITTED',
        issueCode: String(result.code || '').slice(0, 64),
        issueMessage: (note
          ? `${result.message}｜${note}`
          : result.message
        ).slice(0, 500),
        issueTaskId: taskId,
      },
    });
    await this.identity.audit(
      user.userId,
      '开票任务已提交',
      `${row.reqNo} · ${row.buyerName} → ${result.code}`,
    );
    return this.detail(user, updated.id);
  }
  /** 审核不通过：驳回需附原因。 */
  async reject(
    user: CurrentUser,
    id: number,
    reason: string,
    body: Record<string, unknown> = {},
  ) {
    const row = await this.requireReviewable(user, id);
    const text = String(reason || '').trim();
    if (!text) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '驳回必须填写原因');
    }
    const changed = await this.prisma.invoiceRequest.updateMany({
      where: { id, status: 'REQUESTED' },
      data: {
        status: 'REJECTED',
        reviewedBy: user.userId,
        reviewedAt: new Date(),
        rejectReason: text,
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
    if (changed.count !== 1) {
      throw new BusinessException(ErrorCode.CONFLICT, '该申请已被处理');
    }
    await this.identity.audit(
      user.userId,
      '开票申请驳回',
      `${row.reqNo} · ${row.buyerName}：${text}`,
    );
    return this.detail(user, id);
  }
  /** 改开票申请联系方式（临时换人）。 */
  async updateContacts(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown> = {},
  ) {
    if (!Number.isFinite(id) || id <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '开票申请 ID 不合法');
    }
    const row = await this.prisma.invoiceRequest.findUnique({ where: { id } });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '开票申请不存在');
    }
    const admin = this.identity.isPlatformAdmin(user);
    const enterprises = await this.identity.myEnterprises(user.userId);
    const eligible =
      enterprises.some((enterprise) => enterprise.id === row.enterpriseId) ||
      (await this.canReview(user, row));
    if (!admin && !eligible) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '仅申请人、财税承办人或平台管理员可修改联系方式',
      );
    }
    const side = await this.identity.contactSide(user, {
      enterpriseId: row.enterpriseId,
      createdBy: row.requestedBy,
    });
    const updated = await this.prisma.invoiceRequest.update({
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
      '开票联系方式修改',
      `${row.reqNo} · ${row.buyerName}`,
    );
    return {
      id,
      contact_name: updated.contactName,
      contact_phone: updated.contactPhone,
      provider_contact_name: updated.providerContactName,
      provider_contact_phone: updated.providerContactPhone,
    };
  }
  /** 企业撤回自己尚未审核的申请。 */
  async cancel(user: CurrentUser, id: number) {
    if (!Number.isFinite(id) || id <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '开票申请 ID 不合法');
    }
    const row = await this.prisma.invoiceRequest.findUnique({ where: { id } });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '开票申请不存在');
    }
    const enterprises = await this.identity.myEnterprises(user.userId);
    if (
      (row.requestedBy !== user.userId ||
        !enterprises.some(
          (enterprise) => enterprise.id === row.enterpriseId,
        )) &&
      !this.identity.isPlatformAdmin(user)
    ) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '仅申请人可撤回');
    }
    if (row.status !== 'REQUESTED') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '仅待审核的申请可撤回',
      );
    }
    const changed = await this.prisma.invoiceRequest.updateMany({
      where: { id, status: 'REQUESTED' },
      data: { status: 'CANCELLED' },
    });
    if (changed.count !== 1) {
      throw new BusinessException(ErrorCode.CONFLICT, '该申请已被处理');
    }
    return this.detail(user, id);
  }
  // ── 内部 ────────────────────────────────────────────────
  private async requireReviewable(user: CurrentUser, id: number) {
    if (!Number.isFinite(id) || id <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '开票申请 ID 不合法');
    }
    const row = await this.prisma.invoiceRequest.findUnique({ where: { id } });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '开票申请不存在');
    }
    if (!(await this.canReview(user, row))) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅该企业的财税承办人可以审核开票申请',
      );
    }
    if (row.status !== 'REQUESTED') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `当前状态（${INVOICE_REQUEST_STATUS[row.status] || row.status}）不可审核`,
      );
    }
    return row;
  }
  /** 审核权限：与全站一致的「承办人」判定（平台管理员 / 未指派时的服务商账号 / 承办职员）。 */
  private canReview(
    user: CurrentUser,
    row: {
      enterpriseId: number;
      staffUserId: string;
      providerUserId: string;
    },
  ) {
    return this.canReviewForEnterprise(user, row);
  }
  private async canAccess(
    user: CurrentUser,
    row: {
      enterpriseId: number;
      staffUserId: string;
      providerUserId: string;
    },
  ) {
    if (this.identity.isPlatformAdmin(user)) return true;
    const enterprises = await this.identity.myEnterprises(user.userId);
    if (enterprises.some((enterprise) => enterprise.id === row.enterpriseId))
      return true;
    return this.canReview(user, row);
  }
  private async canReviewForEnterprise(
    user: CurrentUser,
    row: {
      enterpriseId: number;
      staffUserId: string;
      providerUserId: string;
    },
  ) {
    return (
      (await this.identity.canWorkOn(user, row)) &&
      (await this.identity.canServeEnterprise(user, row.enterpriseId, {
        enterpriseParty: false,
      }))
    );
  }
  private async scope(user: CurrentUser) {
    if (this.identity.isPlatformAdmin(user)) return undefined;
    const enterprises = await this.identity.myEnterprises(user.userId);
    const own = { enterpriseId: { in: enterprises.map((item) => item.id) } };
    const identity = await this.identity.currentIdentity(user);
    if (identity === 'PROVIDER_STAFF') {
      const binds = await this.prisma.providerStaff.findMany({
        where: { staffUserId: user.userId, status: 'ACTIVE' },
      });
      const taxBinds = binds.filter(
        (bind) =>
          Array.isArray(bind.roles) &&
          bind.roles.some(
            (role) => typeof role === 'string' && role.includes('财税专员'),
          ),
      );
      const contracts = taxBinds.length
        ? await this.prisma.contract.findMany({
            where: {
              providerUserId: {
                in: taxBinds.map((bind) => bind.providerUserId),
              },
              serviceType: 'TAX_FINANCE',
              status: 'ACTIVE',
            },
          })
        : [];
      const assignments = contracts.length
        ? await this.prisma.providerAssignment.findMany({
            where: {
              staffUserId: user.userId,
              providerUserId: {
                in: contracts.map((contract) => contract.providerUserId),
              },
            },
          })
        : [];
      return {
        OR: [
          own,
          ...assignments
            .filter((assignment) =>
              contracts.some(
                (contract) =>
                  contract.enterpriseId === assignment.enterpriseId &&
                  contract.providerUserId === assignment.providerUserId,
              ),
            )
            .map((assignment) => ({
              enterpriseId: assignment.enterpriseId,
              providerUserId: assignment.providerUserId,
              staffUserId: user.userId,
            })),
        ],
      };
    }
    if (identity === 'SERVICE_PROVIDER') {
      const contracts = await this.prisma.contract.findMany({
        where: {
          providerUserId: user.userId,
          serviceType: 'TAX_FINANCE',
          status: 'ACTIVE',
        },
      });
      const assignments = await this.prisma.providerAssignment.findMany({
        where: { providerUserId: user.userId },
      });
      const allowedEnterpriseIds = contracts
        .filter((contract) => {
          const assignment = assignments.find(
            (item) => item.enterpriseId === contract.enterpriseId,
          );
          return (
            !assignment?.staffUserId || assignment.staffUserId === user.userId
          );
        })
        .map((contract) => contract.enterpriseId);
      return {
        OR: [
          own,
          {
            providerUserId: user.userId,
            enterpriseId: { in: allowedEnterpriseIds },
            OR: [{ staffUserId: user.userId }, { staffUserId: '' }],
          },
        ],
      };
    }
    return own;
  }
  private normalizeLine(item: InvoiceLineInput) {
    const quantity = Number(item.quantity ?? 1);
    const price = Number(item.price ?? 0);
    const rate = String(item.taxRate || '6').replace('%', '');
    const amount = Number((quantity * price).toFixed(2));
    const tax = Number(((amount * Number(rate || 0)) / 100).toFixed(2));
    return {
      goodsCode: String(item.goodsCode || '').trim(),
      goodsName: String(item.goodsName || '').trim(),
      spec: String(item.spec || '').trim(),
      quantity,
      price,
      taxRate: rate,
      amount,
      tax,
    };
  }
  private totalsOf(
    items: {
      amount: number;
      tax: number;
    }[],
  ) {
    return {
      amount: Number(
        items.reduce((sum, item) => sum + item.amount, 0).toFixed(2),
      ),
      tax: Number(items.reduce((sum, item) => sum + item.tax, 0).toFixed(2)),
    };
  }
  private linesOf(value: unknown): InvoiceLineInput[] {
    return Array.isArray(value) ? (value as InvoiceLineInput[]) : [];
  }
  private asJson(row: Record<string, unknown>) {
    return {
      ...row,
      items: this.linesOf(row.items),
      amount: Number(row.amount || 0),
      tax: Number(row.tax || 0),
    };
  }
  private async staffNames(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map<string, string>();
    const profiles = await this.prisma.staffProfile.findMany({
      where: { userId: { in: unique } },
    });
    const directory = await this.prisma.userDirectory.findMany({
      where: { userId: { in: unique } },
    });
    const map = new Map<string, string>();
    for (const id of unique) {
      map.set(
        id,
        profiles.find((item) => item.userId === id)?.realName ||
          directory.find((item) => item.userId === id)?.displayName ||
          '',
      );
    }
    return map;
  }
}
