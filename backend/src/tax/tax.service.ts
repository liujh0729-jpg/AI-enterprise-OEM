import { pageParam } from '../common/api';
import { allocateNo } from '../common/document-number';
import { randomUUID } from 'node:crypto';
import { Prisma, TaxMaterialPack, AccountSet } from '../../generated/prisma';
import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { TAX_FORM_TYPES } from '../common/constants';
import { text } from '../common/api';
import { ErrorCode } from '../common/error-code';
import { decorateProviderApp } from '../identity/identity.service';
import { ContractsService } from '../contracts/contracts.service';
import { ExternalService } from '../external/external.service';
import { IdentityService } from '../identity/identity.service';
import { InvoiceOcrService } from '../ocr/invoice-ocr.service';
import { PrismaService } from '../prisma/prisma.service';
import { sideContactBody } from '../shared/contacts';
import { ContactResolver } from '../shared/contacts.service';
import { visibilityWhere } from '../shared/visibility';
import {
  ADVISOR_CHECKS,
  AI_STEP_NOTES,
  AI_STEPS,
  PLAN_TAX_SETS,
  TAX_TYPE_META,
  calcTaxAmount,
  currentPeriods,
  taxMeta,
} from './tax-forms';
/** AI 从材料推导出的单个应申报税种（analyzeMaterial 的输出行）。 */
type MaterialTaxRow = {
  taxType: string;
  label: string;
  basis: string;
  formTemplate: string;
  form: Record<string, number>;
};
export class TaxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly contracts: ContractsService,
    private readonly external: ExternalService,
    private readonly ocr: InvoiceOcrService,
    private readonly contacts: ContactResolver,
  ) {}
  meta() {
    return { forms: taxMeta(), advisor_checks: ADVISOR_CHECKS };
  }

  async declarationPage(user: CurrentUser, query: Record<string, unknown>) {
    const { page, pageSize, offset } = pageParam(
      Number(query.page ?? 1),
      Number(query.pageSize ?? 20),
    );
    const scope = await this.scope(user);
    const keyword = text(query.keyword ?? '').trim();
    const where = {
      AND: [
        scope ?? {},
        {
          ...(query.status ? { status: text(query.status) } : {}),
          ...(query.enterpriseId
            ? { enterpriseId: Number(query.enterpriseId) }
            : {}),
          ...(keyword
            ? {
                OR: [
                  {
                    declNo: { contains: keyword },
                  },
                  {
                    title: { contains: keyword },
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
      this.prisma.taxDeclaration.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.taxDeclaration.count({ where }),
    ]);
    return { list: rows, total, page, pageSize };
  }
  async declarationStats(user: CurrentUser) {
    const scope = await this.scope(user);
    const rows = await this.prisma.taxDeclaration.groupBy({
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
  async providers() {
    const rows = await this.prisma.providerApplication.findMany({
      where: { providerType: 'TAX_FINANCE', status: 'APPROVED' },
      orderBy: { id: 'desc' },
    });
    // 详情页对接人 = 服务商已绑定生效的职员（与「指定业务人员」同一份名单），不读备案名录
    const staffByProvider = await this.contracts.providerStaffForMany(
      rows.map((row) => row.userId),
      'TAX_FINANCE',
    );
    return rows.map((row) => ({
      ...decorateProviderApp(row),
      business_staff: staffByProvider.get(row.userId) || [],
    }));
  }
  async listDeclarations(user: CurrentUser) {
    return this.prisma.taxDeclaration.findMany({
      where: await this.scope(user),
      orderBy: { id: 'desc' },
    });
  }
  /**
   * 单张申报单：按单号直达（申报计划 / 账套管理里的「查看申报单」）。
   * 列表 `listDeclarations` 仍按承办人口径，但服务商账号可**只读**打开自己名下
   * （`provider_user_id = 本人`）的申报单——申报计划已按 demo 契约向服务商放开名下全部
   * （含已指派职员的），其关联申报单必须能打开（服务商与职员体系架构需求 R17：
   * 服务商视角可见名下全部单据及承办职员）；写/推进仍由 `requireDecl` /
   * `requireDeclActor`（承办人 + 管理员）把守，这里只读。
   */
  async declarationDetail(user: CurrentUser, id: number) {
    const row = await this.prisma.taxDeclaration.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '申报单不存在');
    if (await this.canReadDeclaration(user, row)) return row;
    throw new BusinessException(
      ErrorCode.ROLE_MISMATCH,
      '数据仅对承办人与企业当事人可见',
    );
  }
  /** 申报单只读可达性：平台管理员 / 承办人 / 企业当事人 / 该单所属服务商账号本人。 */
  private async canReadDeclaration(
    user: CurrentUser,
    row: {
      providerUserId: string;
      staffUserId: string;
      enterpriseId: number;
    },
  ) {
    if (this.identity.isPlatformAdmin(user)) return true;
    if (String(row.providerUserId || '') === user.userId) return true;
    if (await this.identity.canWorkOn(user, row)) return true;
    const eps = await this.identity.myEnterprises(user.userId);
    return eps.some((item) => item.id === row.enterpriseId);
  }
  async createDeclaration(
    user: CurrentUser,
    body: {
      tax_type?: string;
      period?: string;
      title?: string;
      form_data?: Record<string, number>;
      [key: string]: unknown;
    },
  ) {
    await this.identity.requireRoles(user, 'SERVICE_PROVIDER');
    const enterprises = await this.contracts.myEnterprises(user);
    if (!enterprises.length) {
      throw new BusinessException(ErrorCode.NO_ACTIVE_CONTRACT);
    }
    const ep = enterprises[0];
    const contract = await this.contracts.requireActiveContract(
      ep.id,
      'TAX_FINANCE',
    );
    if (contract.providerUserId !== user.userId) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅签约服务商可建申报单',
      );
    }
    const taxType = body.tax_type || 'vat_general';
    if (!(TAX_FORM_TYPES as readonly string[]).includes(taxType)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '申报表类型不合法');
    }

    const form = body.form_data || {};
    const staffUserId = await this.identity.assignedStaffFor(
      user.userId,
      ep.id,
    );
    const row = await this.prisma.taxDeclaration.create({
      data: {
        declNo: await allocateNo(this.prisma, 'SB'),
        contractId: contract.id,
        enterpriseId: ep.id,
        providerUserId: user.userId,
        staffUserId,
        taxType,
        period: body.period || '',
        title: body.title || taxType,
        formData: form,
        taxAmount: calcTaxAmount(taxType, form),
        status: 'DRAFT',
        // 申报联系方式：企业侧 + 承办职员（系统自动带出，临时换人可改）
        ...(await this.contacts.stage(
          {
            enterpriseUserId: ep.userId,
            enterpriseId: ep.id,
            staffUserId,
            providerUserId: user.userId,
          },
          body,
        )),
      },
    });
    return {
      id: row.id,
      status: row.status,
      tax_amount: Number(row.taxAmount),
    };
  }
  async updateForm(
    user: CurrentUser,
    id: number,
    form: Record<
      string,
      | number
      | string
      | { taxpayerName?: string; uscc?: string; period?: string }
    >,
  ) {
    const row = await this.requireDecl(user, id);
    if (row.status !== 'DRAFT') {
      throw new BusinessException(ErrorCode.DECL_STATE, '仅草稿可改表');
    }
    // 已预填的申报表基础信息（纳税人名称/识别号/所属期）不因改数而丢失
    const current = (row.formData || {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...form };
    if (!merged.basic) merged.basic = current.basic;
    const amount = calcTaxAmount(
      row.taxType,
      merged as unknown as Record<string, number | string | undefined>,
    );
    await this.prisma.taxDeclaration.update({
      where: { id },
      data: {
        formData: merged as unknown as Prisma.InputJsonValue,
        taxAmount: amount,
      },
    });
    return { id, tax_amount: amount };
  }
  /** 改申报单联系方式（临时换人）：企业当事人改企业侧、承办人改执行侧。 */
  async updateDeclarationContacts(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown> = {},
  ) {
    const row = await this.requireDecl(user, id);
    const side = await this.identity.contactSide(user, row);
    const updated = await this.prisma.taxDeclaration.update({
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
      'TAX_CONTACTS_UPDATE',
      `${row.declNo} 联系方式`,
    );
    return {
      id,
      contact_name: updated.contactName,
      contact_phone: updated.contactPhone,
      provider_contact_name: updated.providerContactName,
      provider_contact_phone: updated.providerContactPhone,
    };
  }
  /** 改报税材料联系方式（临时换人）。 */
  async updateMaterialPackContacts(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown> = {},
  ) {
    const pack = await this.requirePack(user, id);
    const side = await this.identity.contactSide(user, pack);
    const updated = await this.prisma.taxMaterialPack.update({
      where: { id },
      data: await this.contacts.stage(
        {
          enterpriseId: pack.enterpriseId,
          staffUserId: pack.staffUserId,
          providerUserId: pack.providerUserId,
        },
        sideContactBody(body, side, pack),
      ),
    });
    await this.identity.audit(
      user.userId,
      'TAX_MATERIAL_CONTACTS_UPDATE',
      `${pack.packNo} 联系方式`,
    );
    return {
      id,
      contact_name: updated.contactName,
      contact_phone: updated.contactPhone,
      provider_contact_name: updated.providerContactName,
      provider_contact_phone: updated.providerContactPhone,
    };
  }
  async runAi(user: CurrentUser, id: number) {
    await this.requireDecl(user, id);
    const at = new Date().toISOString();
    const steps = AI_STEPS.map((text, index) => ({
      step: index + 1,
      text,
      status: 'DONE',
      note: AI_STEP_NOTES[index] || '',
      at,
    }));
    await this.prisma.taxDeclaration.update({
      where: { id },
      data: {
        aiSteps: steps,
        status: 'SUBMITTED',
      },
    });
    return { id, status: 'SUBMITTED', ai_steps: AI_STEPS };
  }
  async qc(
    user: CurrentUser,
    id: number,
    action: 'PASS' | 'REJECT',
    confirms: string[],
    note = '',
  ) {
    const row = await this.requireDeclActor(user, id, '审核');
    if (row.status !== 'SUBMITTED') {
      throw new BusinessException(ErrorCode.DECL_STATE, '请先运行 AI 处理');
    }
    if (action === 'PASS' && confirms.length < ADVISOR_CHECKS.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请完成 7 项核对');
    }
    const status = action === 'PASS' ? 'FILED' : 'REJECTED';
    // 回执号由官方系统出（外报通道回填），这里不伪造
    await this.prisma.taxDeclaration.update({
      where: { id },
      data: {
        advisorConfirms: confirms,
        qcStatus: action === 'PASS' ? 'PASSED' : 'REJECTED',
        qcNote: note,
        status,
        ...(action === 'REJECT' ? { receiptNo: '' } : {}),
      },
    });
    if (action !== 'PASS') {
      await this.syncPlanForDecl(id, false);
      return { id, status, receipt_no: '', external_submission_id: 0 };
    }
    // 计划同步：审核通过 → 该来源计划已完成
    await this.syncPlanForDecl(id, true);
    // 审核通过即生成外报任务（报文 + 作业指引，幂等），进入人工报送 → 回填受理号/回执 → 扣款
    const submission = await this.external.createForDeclaration(user, id);
    return {
      id,
      status,
      receipt_no: '',
      external_submission_id: submission.id,
      tip: '已生成外报任务：请按「外报通道」作业指引在电子税务局报送，并回填受理号与回执',
    };
  }
  /** 扣款（人工确认，不自动化）：必须已取得官方回执。 */
  async pay(user: CurrentUser, id: number) {
    const row = await this.requireDeclActor(user, id, '扣款');
    if (row.status !== 'FILED') {
      throw new BusinessException(ErrorCode.DECL_STATE, '仅已申报可扣款');
    }
    const submissions = await this.external.byRef(user, 'TAX_DECLARATION', id);
    const target = submissions[0];
    if (!target) {
      throw new BusinessException(
        ErrorCode.DECL_STATE,
        '该申报单尚未生成外报任务，请先在「外报通道」生成并报送',
      );
    }
    if (target.status !== 'RECEIPT') {
      throw new BusinessException(
        ErrorCode.DECL_STATE,
        '请先在官方系统完成申报并回填受理号与回执，再登记扣款',
      );
    }
    await this.external.markPaid(user, target.id, '申报单扣款（人工确认）');
    await this.syncPlanForDecl(id, true);
    return {
      id,
      status: 'PAID',
      tip: '已人工确认扣款：资金类操作不自动化，扣款结果与凭证随外报任务留痕',
    };
  }
  trial(taxType: string, form: Record<string, number>) {
    return {
      tax_type: taxType,
      tax_amount: calcTaxAmount(taxType, form),
      form,
    };
  }
  async saveRecord(
    user: CurrentUser,
    kind: string,
    title: string,
    snapshot: Record<string, unknown>,
  ) {
    const row = await this.prisma.taxRecord.create({
      data: {
        userId: user.userId,
        kind,
        title,
        snapshot: snapshot as Prisma.InputJsonValue,
      },
    });
    return { id: row.id };
  }
  async records(user: CurrentUser, kind?: string) {
    return this.prisma.taxRecord.findMany({
      where: { userId: user.userId, ...(kind ? { kind } : {}) },
      orderBy: { id: 'desc' },
    });
  }
  async recordPage(
    user: CurrentUser,
    query: { kind?: string; page: number; pageSize: number },
  ) {
    const { page, pageSize } = query;
    const where = {
      userId: user.userId,
      ...(query.kind ? { kind: query.kind } : {}),
    };
    const [list, total] = await Promise.all([
      this.prisma.taxRecord.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.taxRecord.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }
  async deleteRecord(user: CurrentUser, id: number) {
    await this.prisma.taxRecord.deleteMany({
      where: { id, userId: user.userId },
    });
    return { id, deleted: true };
  }
  async createAccountSet(
    user: CurrentUser,
    name: string,
    enterpriseId?: number,
  ) {
    await this.identity.requireRoles(user, 'SERVICE_PROVIDER');
    const enterprises = await this.contracts.myEnterprises(user);
    const ep =
      enterprises.find((item) => item.id === enterpriseId) || enterprises[0];
    if (!ep) throw new BusinessException(ErrorCode.NO_ACTIVE_CONTRACT);
    const row = await this.prisma.accountSet.create({
      data: {
        name,
        enterpriseId: ep.id,
        providerUserId: user.userId,
        staffUserId: await this.identity.assignedStaffFor(user.userId, ep.id),
      },
    });
    return { id: row.id, status: row.status };
  }
  async accountSetPage(
    user: CurrentUser,
    query: { page: number; pageSize: number },
  ) {
    const { page, pageSize, offset } = pageParam(query.page, query.pageSize);
    const where = await this.accountScope(user);
    const [rows, total] = await Promise.all([
      this.prisma.accountSet.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.accountSet.count({ where }),
    ]);
    return {
      list: await this.decorateAccountSets(rows),
      total,
      page,
      pageSize,
    };
  }
  async accountSetDetail(user: CurrentUser, id: number) {
    const row = await this.prisma.accountSet.findFirst({
      where: { AND: [(await this.accountScope(user)) ?? {}, { id }] },
    });
    if (!row)
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '账套不存在或不在可见范围',
      );
    return (await this.decorateAccountSets([row]))[0];
  }
  async materialPage(
    user: CurrentUser,
    query: { page: number; pageSize: number },
  ) {
    const { page, pageSize, offset } = pageParam(query.page, query.pageSize);
    const where = await this.scope(user);
    const [rows, total] = await Promise.all([
      this.prisma.taxMaterialPack.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.taxMaterialPack.count({ where }),
    ]);
    return {
      list: (await Promise.all(rows.map((row) => this.syncPackDone(row)))).map(
        decoratePack,
      ),
      total,
      page,
      pageSize,
    };
  }
  async accountSets(user: CurrentUser) {
    const rows = await this.prisma.accountSet.findMany({
      where: await this.accountScope(user),
      orderBy: { id: 'desc' },
    });
    return this.decorateAccountSets(rows);
  }
  private async decorateAccountSets(rows: AccountSet[]) {
    if (!rows.length) return [];
    /**
     * 计划统计与申报单摘要整批改查：原实现每个账套各发 2 条查询（N 个账套＝2N 次往返）。
     * 申报单按「企业 + 服务商」成对计数，一次按两侧 in 取回后按配对键在内存归组。
     */
    const [plans, decls] = await Promise.all([
      this.prisma.taxPlan.groupBy({
        by: ['accountSetId', 'status'],
        where: { accountSetId: { in: rows.map((row) => row.id) } },
        _count: { _all: true },
      }),
      this.prisma.taxDeclaration.groupBy({
        by: ['enterpriseId', 'providerUserId'],
        where: {
          enterpriseId: {
            in: [...new Set(rows.map((row) => row.enterpriseId))],
          },
          providerUserId: {
            in: [...new Set(rows.map((row) => row.providerUserId))],
          },
        },
        _count: { _all: true },
      }),
    ]);
    const planStats = new Map<
      number,
      {
        due: number;
        in_progress: number;
        done: number;
      }
    >();
    for (const item of plans) {
      const stats = planStats.get(item.accountSetId) || {
        due: 0,
        in_progress: 0,
        done: 0,
      };
      if (item.status === 'DUE') stats.due += item._count._all;
      if (item.status === 'IN_PROGRESS') stats.in_progress += item._count._all;
      if (item.status === 'DONE') stats.done += item._count._all;
      planStats.set(item.accountSetId, stats);
    }
    const declCount = new Map<string, number>();
    for (const item of decls) {
      const key = `${item.enterpriseId}|${item.providerUserId}`;
      declCount.set(key, item._count._all);
    }
    return rows.map((row) => ({
      ...row,
      plan_stats: planStats.get(row.id) || {
        due: 0,
        in_progress: 0,
        done: 0,
      },
      decl_summary: {
        count: declCount.get(`${row.enterpriseId}|${row.providerUserId}`) || 0,
      },
    }));
  }
  /**
   * 按签约企业补齐当期应申报计划（申报期到来自动生成，无需手动触发）：
   * 目标企业 = 名下有生效中 TAX_FINANCE 签约的企业（职员身份＝仅分派给自己承办的）；
   * 按纳税人性质（GENERAL / SMALL_SCALE）× 申报频率（季/月/年）生成当期应申报税种；
   * 幂等：同企业同税种同属期不重复；申报依据来源账套取企业最新在用账套。
   * 无服务商上下文（企业/个人用户视角）时静默跳过。
   */
  private async ensureCurrentPlans(user: CurrentUser) {
    const ctx = await this.identity.providerContext(user.userId);
    if (!ctx.providers.length) return { created: 0, skipped: 0 };
    const identity = await this.identity.currentIdentity(user);
    const isStaffOnly =
      identity === 'PROVIDER_STAFF' && !this.identity.isPlatformAdmin(user);
    const contracts = await this.prisma.contract.findMany({
      where: {
        providerUserId: { in: ctx.providers },
        serviceType: 'TAX_FINANCE',
        status: 'ACTIVE',
      },
      orderBy: { id: 'asc' },
    });
    const byEnterprise = new Map<number, (typeof contracts)[number]>();
    for (const item of contracts) {
      if (!byEnterprise.has(item.enterpriseId)) {
        byEnterprise.set(item.enterpriseId, item);
      }
    }
    const periods = currentPeriods();
    /**
     * 本轮每个企业都要查主办职员 / 企业档案 / 在用账套：先按企业集合整批取回再在内存里取，
     * 否则企业数一多就是每家 3 次往返（列表页每次打开都会跑一遍本方法）。
     */
    const targetContracts = [...byEnterprise.values()];
    const targetEnterpriseIds = targetContracts.map(
      (item) => item.enterpriseId,
    );
    const [assignmentRows, profileRows, activeSets] = await Promise.all([
      this.prisma.providerAssignment.findMany({
        where: { providerUserId: { in: ctx.providers } },
      }),
      this.prisma.enterpriseProfile.findMany({
        where: { id: { in: targetEnterpriseIds } },
      }),
      this.prisma.accountSet.findMany({
        where: { enterpriseId: { in: targetEnterpriseIds }, status: 'ACTIVE' },
        orderBy: { id: 'desc' },
        select: { id: true, enterpriseId: true },
      }),
    ]);
    const assignments = new Map(
      assignmentRows.map((item) => [
        `${item.providerUserId}|${item.enterpriseId}`,
        item,
      ]),
    );
    const profiles = new Map(
      profileRows.map((item) => [item.id, item] as const),
    );
    const accountSets = new Map<
      number,
      {
        id: number;
      }
    >();
    for (const item of activeSets) {
      if (!accountSets.has(item.enterpriseId))
        accountSets.set(item.enterpriseId, item);
    }
    let created = 0;
    let skipped = 0;
    // 幂等检查一次取回当期已有计划（原先每家企业每个税种各一次 findUnique）
    const existingRows = await this.prisma.taxPlan.findMany({
      where: {
        enterpriseId: { in: targetEnterpriseIds },
        period: { in: [periods.month, periods.quarter, periods.year] },
      },
      select: { enterpriseId: true, taxType: true, period: true },
    });
    const existingPlans = new Set(
      existingRows.map(
        (item) => `${item.enterpriseId}|${item.taxType}|${item.period}`,
      ),
    );
    for (const contract of targetContracts) {
      const assigned = assignments.get(
        `${contract.providerUserId}|${contract.enterpriseId}`,
      );
      // 职员身份：只生成分派给自己承办的企业
      if (isStaffOnly && assigned?.staffUserId !== user.userId) continue;
      const staffUserId = isStaffOnly
        ? user.userId
        : // 主办职员：`assignments` 已按同一批 providerUserId 整批取回，无需再查一次
          assigned?.staffUserId || '';
      const ep = profiles.get(contract.enterpriseId);
      if (!ep) continue;
      // 历史数据兼容：早期版本把「小规模」存成 SMALL，统一归一到 SMALL_SCALE
      const taxpayerType =
        ep.taxpayerType === 'SMALL' ? 'SMALL_SCALE' : ep.taxpayerType;
      const set = PLAN_TAX_SETS[taxpayerType] || PLAN_TAX_SETS.GENERAL;
      const accountSet = accountSets.get(contract.enterpriseId);
      const items: [string, string][] = [];
      (['quarter', 'month', 'year'] as const).forEach((key) => {
        (set[key] || []).forEach((taxType) =>
          items.push([taxType, periods[key]]),
        );
      });
      for (const [taxType, period] of items) {
        const key = `${contract.enterpriseId}|${taxType}|${period}`;
        if (existingPlans.has(key)) {
          skipped += 1;
          continue;
        }
        await this.prisma.taxPlan.create({
          data: {
            enterpriseId: contract.enterpriseId,
            providerUserId: contract.providerUserId,
            staffUserId,
            accountSetId: accountSet?.id || 0,
            taxType,
            period,
            status: 'DUE',
          },
        });
        // 同一轮内也按「已存在」处理，与原先逐条查库的幂等口径一致
        existingPlans.add(key);
        created += 1;
      }
    }
    return { created, skipped };
  }
  async generatePlans(user: CurrentUser) {
    const ctx = await this.identity.providerContext(user.userId);
    if (!ctx.providers.length) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '无权限：需要服务商或服务商职员身份',
      );
    }
    const { created, skipped } = await this.ensureCurrentPlans(user);
    const due = await this.prisma.taxPlan.count({
      where: { providerUserId: { in: ctx.providers }, status: 'DUE' },
    });
    await this.identity.audit(
      user.userId,
      '生成本期申报计划',
      `新增 ${created} 项申报计划（已存在跳过 ${skipped} 项）`,
    );
    return { created, skipped, due };
  }
  /** 计划「去填写」：生成关联申报单（已有则直接返回），并把计划置为申报中。 */
  async createDeclFromPlan(user: CurrentUser, planId: number) {
    const plan = await this.prisma.taxPlan.findUnique({
      where: { id: planId },
    });
    if (!plan)
      throw new BusinessException(ErrorCode.NOT_FOUND, '申报计划不存在');
    // 作业权限：计划必须由具体承办职员推进（服务商账号不代替承办人作业，本系统口径严于 demo canWorkOn）
    if (!plan.staffUserId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该业务尚未指派职员账户：请先在签约管理分配主办职员（业务必须由具体职员承办）',
      );
    }
    const isAssignedStaff = plan.staffUserId === user.userId;
    if (!isAssignedStaff && !this.identity.isPlatformAdmin(user)) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅该计划的承办职员可操作（服务商账号请在签约管理分配主办职员）',
      );
    }
    if (plan.declarationId) {
      const link = await this.prisma.taxDeclaration.findUnique({
        where: { id: plan.declarationId },
      });
      return {
        id: plan.declarationId,
        existing: true,
        decl_no: link?.declNo || '',
      };
    }
    const contract = await this.prisma.contract.findFirst({
      where: {
        enterpriseId: plan.enterpriseId,
        serviceType: 'TAX_FINANCE',
        status: 'ACTIVE',
      },
      orderBy: { id: 'asc' },
    });
    // 申报依据来源账套：计划未挂账套时取企业最新在用账套
    let accountSetId = plan.accountSetId;
    if (!accountSetId) {
      const accountSet = await this.prisma.accountSet.findFirst({
        where: { enterpriseId: plan.enterpriseId, status: 'ACTIVE' },
        orderBy: { id: 'desc' },
      });
      accountSetId = accountSet?.id || 0;
    }

    const label = TAX_TYPE_META[plan.taxType]?.name || plan.taxType;
    const created = await this.prisma.taxDeclaration.create({
      data: {
        declNo: await allocateNo(this.prisma, 'SB'),
        contractId: contract?.id || 0,
        enterpriseId: plan.enterpriseId,
        providerUserId: plan.providerUserId,
        staffUserId: plan.staffUserId,
        taxType: plan.taxType,
        period: plan.period,
        title: `${label}（${plan.period}）`,
        formData: {
          basic: await this.basicOf(plan.enterpriseId, plan.period),
        },
        status: 'DRAFT',
        // 申报联系方式：企业侧 + 承办职员（系统自动带出，临时换人可改）
        ...(await this.contacts.stage({
          enterpriseId: plan.enterpriseId,
          staffUserId: plan.staffUserId,
          providerUserId: plan.providerUserId,
        })),
      },
    });
    await this.prisma.taxPlan.update({
      where: { id: planId },
      data: { declarationId: created.id, status: 'IN_PROGRESS', accountSetId },
    });
    await this.identity.audit(
      user.userId,
      '计划去填写',
      `${label}（${plan.period}）由申报计划生成申报单 #${created.id}`,
    );
    return { id: created.id, existing: false, status: 'DRAFT' };
  }
  /** 申报单状态变更 → 同步来源申报计划（通过/完税 → DONE；驳回 → 回到待申报并解除关联）。 */
  private async syncPlanForDecl(declId: number, done: boolean) {
    const plan = await this.prisma.taxPlan.findFirst({
      where: { declarationId: declId },
    });
    if (!plan) return;
    await this.prisma.taxPlan.update({
      where: { id: plan.id },
      data: done ? { status: 'DONE' } : { status: 'DUE', declarationId: 0 },
    });
  }
  async createConsultation(user: CurrentUser, question: string) {
    await this.identity.requireRoles(user, 'ENTERPRISE_USER');
    const eps = await this.identity.myEnterprises(user.userId);
    if (!eps.length)
      throw new BusinessException(ErrorCode.FORBIDDEN, '请先完善企业信息');
    const contract = await this.contracts.requireActiveContract(
      eps[0].id,
      'TAX_FINANCE',
    );
    const row = await this.prisma.consultation.create({
      data: {
        contractId: contract.id,
        enterpriseId: eps[0].id,
        providerUserId: contract.providerUserId,
        staffUserId: await this.identity.assignedStaffFor(
          contract.providerUserId,
          eps[0].id,
        ),
        question,
        answer: '',
      },
    });
    return { id: row.id, status: row.status };
  }
  async replyConsultation(user: CurrentUser, id: number, answer: string) {
    const row = await this.prisma.consultation.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '咨询不存在');
    if (!(await this.identity.canWorkOn(user, row))) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        row.staffUserId
          ? '仅该企业的承办职员可回复（服务商账号不代替承办人作业）'
          : '请服务商先在「职员/代理人管理 · 企业分配」指定承办职员',
      );
    }
    await this.prisma.consultation.update({
      where: { id },
      data: { answer, status: 'REPLIED' },
    });
    return { id, status: 'REPLIED' };
  }
  /** 财税咨询列表：与全站一致的数据可见性（企业当事人 / 承办职员 / 未指派时的服务商账号）。 */
  async consultations(user: CurrentUser) {
    const [eps, identity] = await Promise.all([
      this.identity.myEnterprises(user.userId),
      this.identity.currentIdentity(user),
    ]);
    return this.prisma.consultation.findMany({
      where: visibilityWhere({
        isAdmin: this.identity.isPlatformAdmin(user),
        identity,
        userId: user.userId,
        enterpriseIds: eps.map((item) => item.id),
        hasCreatedBy: false,
      }),
      orderBy: { id: 'desc' },
    });
  }
  /** 企业报税材料：按「企业 × 属期」一份材料包，三步明细逐条添加。 */
  async materialPacks(user: CurrentUser) {
    const rows = await this.prisma.taxMaterialPack.findMany({
      where: await this.scope(user),
      orderBy: { id: 'desc' },
    });
    const synced = await Promise.all(rows.map((row) => this.syncPackDone(row)));
    return synced.map(decoratePack);
  }
  /** 本期 AI 清单中的税种是否都已生成申报单（demo：全提报后才进入办理中）。 */
  private async packFullyDeclared(pack: {
    id: number;
    payload: unknown;
    enterpriseId: number;
    period: string;
  }) {
    const rows = await this.analyzeMaterial(pack);
    if (!rows.length) return false;
    const decls = await this.prisma.taxDeclaration.findMany({
      where: { materialId: pack.id },
      select: { taxType: true },
    });
    return rows.every((row) =>
      decls.some((item) => item.taxType === row.taxType),
    );
  }
  /** 状态收敛（demo syncPackStatus）：清单全覆盖且申报单全部完成扣款 → 材料已完成。 */
  private async syncPackDone(pack: TaxMaterialPack): Promise<TaxMaterialPack> {
    if (pack.status !== 'PROCESSING') return pack;
    const decls = await this.prisma.taxDeclaration.findMany({
      where: { materialId: pack.id },
      select: { taxType: true, status: true },
    });
    const rows = await this.analyzeMaterial(pack);
    const covered =
      rows.length > 0 &&
      rows.every((row) => decls.some((item) => item.taxType === row.taxType));
    if (!covered || !decls.every((item) => item.status === 'PAID')) return pack;
    return this.prisma.taxMaterialPack.update({
      where: { id: pack.id },
      data: { status: 'DONE' },
    });
  }
  /**
   * 报税材料详情（对齐 demo tax-material.js）：
   * 状态概览 + 三步材料回显 + AI 分类分析结果 + 分税种提报进度（服务商据此勾选税种提报）。
   */
  async materialPackDetail(user: CurrentUser, id: number) {
    const current = await this.requirePack(user, id);
    const pack = await this.syncPackDone(current);
    const submitted = pack.status !== 'DRAFT';
    const [enterprise, provider, staff, analysisRows, decls] =
      await Promise.all([
        this.prisma.enterpriseProfile.findUnique({
          where: { id: pack.enterpriseId },
        }),
        this.prisma.providerApplication.findFirst({
          where: { userId: pack.providerUserId },
        }),
        pack.staffUserId
          ? this.prisma.staffProfile.findFirst({
              where: { userId: pack.staffUserId },
            })
          : Promise.resolve(null),
        submitted ? this.analyzeMaterial(pack) : Promise.resolve([]),
        this.prisma.taxDeclaration.findMany({
          where: { materialId: pack.id },
          orderBy: { id: 'asc' },
        }),
      ]);
    const labels = new Map<string, string>(
      taxMeta().map((item) => [String(item.type), item.label]),
    );
    const analyzedAt = pack.analyzedAt || (submitted ? pack.updatedAt : null);
    return {
      ...decoratePack(pack),
      enterprise_name: enterprise?.name || '',
      provider_name: provider?.orgName || '',
      staff_name: staff?.realName || '',
      submitted_at: pack.submittedAt || analyzedAt,
      analysis: analyzedAt
        ? this.analysisPayload(analysisRows, analyzedAt)
        : null,
      decls: decls.map((row) => ({
        id: row.id,
        decl_no: row.declNo,
        tax_type: row.taxType,
        tax_type_name: labels.get(row.taxType) || row.taxType,
        tax_amount: row.taxAmount,
        status: row.status,
        receipt_no: row.receiptNo,
        contact_name: row.contactName,
        contact_phone: row.contactPhone,
        provider_contact_name: row.providerContactName,
        provider_contact_phone: row.providerContactPhone,
      })),
    };
  }
  /** AI 分析结果出参（提交响应与材料详情共用）。 */
  private analysisPayload(rows: MaterialTaxRow[], at: Date | string) {
    const taxItems = rows.map((row) => ({
      tax_type: row.taxType,
      name: row.label,
      reason: row.basis,
      est_amount: calcTaxAmount(row.taxType, row.form),
      template: row.formTemplate,
    }));
    return {
      at,
      zero_declare: !taxItems.length,
      summary: taxItems.length
        ? `按本期提交的三步材料识别到 ${taxItems.length} 个应申报税种：${rows
            .map((item) => item.label)
            .join('、')}。`
        : '本期材料未识别出应申报税种（无工资、销项/进项发票、费用小票与无票收入数据），可按零申报处理。',
      tax_items: taxItems,
    };
  }
  /** 取当前属期材料包，不存在则创建（企业视角第一步录入即建档）。 */
  async currentMaterialPack(user: CurrentUser, period: string) {
    const currentPeriod = String(period || '').trim();
    if (!/^\d{4}-\d{2}$/.test(currentPeriod)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '属期格式应为 YYYY-MM',
      );
    }
    await this.identity.requireRoles(user, 'ENTERPRISE_USER');
    const eps = await this.identity.myEnterprises(user.userId);
    if (!eps.length) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '请先完善企业信息');
    }
    const contract = await this.contracts.requireActiveContract(
      eps[0].id,
      'TAX_FINANCE',
    );
    const existing = await this.prisma.taxMaterialPack.findUnique({
      where: {
        enterpriseId_period: { enterpriseId: eps[0].id, period: currentPeriod },
      },
    });
    if (existing) return decoratePack(existing);

    const created = await this.prisma.taxMaterialPack.create({
      data: {
        packNo: await allocateNo(this.prisma, 'CL'),
        contractId: contract.id,
        enterpriseId: eps[0].id,
        providerUserId: contract.providerUserId,
        staffUserId: await this.identity.assignedStaffFor(
          contract.providerUserId,
          eps[0].id,
        ),
        title: `${currentPeriod} 属期报税材料`,
        period: currentPeriod,
        payload: emptyPayload() as unknown as Prisma.InputJsonValue,
        files: [],
      },
    });
    await this.identity.audit(
      user.userId,
      'TAX_MATERIAL_CREATE',
      `#${created.id} ${created.packNo}`,
    );
    return decoratePack(created);
  }
  /** 逐条添加一行材料明细。 */
  async addMaterialRow(
    user: CurrentUser,
    id: number,
    section: string,
    row: Record<string, unknown>,
  ) {
    const pack = await this.requirePack(user, id);
    this.requireDraft(pack);
    const key = requireSection(section);
    const payload = normalizePayload(pack.payload);
    const entry = buildRow(key, row);
    payload[key] = [...payload[key], entry];
    const updated = await this.prisma.taxMaterialPack.update({
      where: { id },
      data: { payload: payload as unknown as Prisma.InputJsonValue },
    });
    await this.identity.audit(
      user.userId,
      'TAX_MATERIAL_ROW_ADD',
      `#${id} ${SECTION_LABELS[key]}`,
    );
    return { pack: decoratePack(updated), row: entry };
  }
  async updateMaterialRow(
    user: CurrentUser,
    id: number,
    rowId: string,
    section: string,
    patch: Record<string, unknown>,
  ) {
    const pack = await this.requirePack(user, id);
    this.requireDraft(pack);
    const key = requireSection(section);
    const payload = normalizePayload(pack.payload);
    const index = payload[key].findIndex((item) => item.id === rowId);
    if (index < 0) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '该明细不存在');
    }
    const merged = buildRow(key, { ...payload[key][index], ...patch }, false);
    payload[key][index] = { ...payload[key][index], ...merged, id: rowId };
    const updated = await this.prisma.taxMaterialPack.update({
      where: { id },
      data: { payload: payload as unknown as Prisma.InputJsonValue },
    });
    await this.identity.audit(
      user.userId,
      'TAX_MATERIAL_ROW_UPDATE',
      `#${id} ${SECTION_LABELS[key]} ${rowId}`,
    );
    return { pack: decoratePack(updated), row: payload[key][index] };
  }
  async removeMaterialRow(
    user: CurrentUser,
    id: number,
    rowId: string,
    section: string,
  ) {
    const pack = await this.requirePack(user, id);
    this.requireDraft(pack);
    const key = requireSection(section);
    const payload = normalizePayload(pack.payload);
    const next = payload[key].filter((item) => item.id !== rowId);
    if (next.length === payload[key].length) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '该明细不存在');
    }
    payload[key] = next;
    const updated = await this.prisma.taxMaterialPack.update({
      where: { id },
      data: { payload: payload as unknown as Prisma.InputJsonValue },
    });
    await this.identity.audit(
      user.userId,
      'TAX_MATERIAL_ROW_DELETE',
      `#${id} ${SECTION_LABELS[key]} ${rowId}`,
    );
    return decoratePack(updated);
  }
  /** 提交本期材料（三步齐备后由 AI 做分类提报）。 */
  async submitMaterialPack(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown> = {},
  ) {
    const pack = await this.requirePack(user, id);
    const payload = normalizePayload(pack.payload);
    if (!payload.payroll.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先逐条添加「员工与工资」明细',
      );
    }
    if (!payload.invoices.length && !payload.bank.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请至少添加一条「发票」或「银行流水」明细',
      );
    }
    if (pack.status !== 'DRAFT') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '材料已提交，请勿重复提交',
      );
    }
    // 对齐 demo：提交只做 AI 分类分析，置「AI 分析完成（零申报则直接完成）」；
    // 分税种生成申报单由服务商承办职员核对后提报（generateDeclarations）
    const rows = await this.analyzeMaterial(pack);
    const now = new Date();
    // 提交时刻按对应人档案固化联系方式（企业报税经办人 + 承办职员），入参可覆盖
    const stageContacts = await this.contacts.stage(
      {
        enterpriseId: pack.enterpriseId,
        staffUserId: pack.staffUserId,
        providerUserId: pack.providerUserId,
      },
      body,
    );
    const updated = await this.prisma.taxMaterialPack.update({
      where: { id },
      data: {
        status: rows.length ? 'ANALYZED' : 'DONE',
        submittedAt: now,
        analyzedAt: now,
        ...stageContacts,
      },
    });
    await this.identity.audit(
      user.userId,
      'TAX_MATERIAL_SUBMIT',
      `#${id} ${pack.packNo} AI 识别 ${rows.length} 个应申报税种`,
    );
    return {
      ...decoratePack(updated),
      analyzed: rows.length,
      analysis: this.analysisPayload(rows, now),
      tip: rows.length
        ? `AI 已识别 ${rows.length} 个应申报税种，待承办职员核对后分类提报`
        : '材料已提交：本期未识别出应申报税种，按零申报处理',
    };
  }
  /**
   * 按 AI 分析结果生成申报单草稿（同材料同税种幂等）。
   * 企业提交材料时自动执行；服务商也可手动重试。
   */
  private async createDeclarationsFromPack(
    pack: {
      id: number;
      packNo: string;
      payload: unknown;
      enterpriseId: number;
      period: string;
      contractId: number;
      providerUserId: string;
      staffUserId: string;
    },
    taxTypes?: string[],
    override: Record<string, unknown> = {},
  ) {
    const analysis = await this.analyzeMaterial(pack);
    const picked = taxTypes?.length
      ? analysis.filter((row) => taxTypes.includes(row.taxType))
      : analysis;
    if (!picked.length) return [];
    const basic = await this.basicOf(pack.enterpriseId, pack.period);
    // 申报联系方式：企业侧 + 承办职员（系统自动带出，临时换人可改）
    const stageContacts = await this.contacts.stage(
      {
        enterpriseId: pack.enterpriseId,
        staffUserId: pack.staffUserId,
        providerUserId: pack.providerUserId,
      },
      override,
    );
    const existing = await this.prisma.taxDeclaration.findMany({
      where: { materialId: pack.id },
    });
    const created: number[] = [];
    for (const row of picked) {
      if (existing.some((item) => item.taxType === row.taxType)) continue;

      const decl = await this.prisma.taxDeclaration.create({
        data: {
          declNo: await allocateNo(this.prisma, 'SB'),
          contractId: pack.contractId,
          enterpriseId: pack.enterpriseId,
          providerUserId: pack.providerUserId,
          staffUserId: pack.staffUserId,
          materialId: pack.id,
          taxType: row.taxType,
          period: pack.period,
          title: `${row.label}（${pack.period}）`,
          formData: { ...row.form, basic },
          taxAmount: calcTaxAmount(row.taxType, row.form),
          status: 'DRAFT',
          aiSteps: AI_STEPS.map((text, index) => ({
            step: index + 1,
            text,
            status: 'pending',
            note: AI_STEP_NOTES[index] || '',
            at: '',
          })),
          advisorConfirms: [],
          ...stageContacts,
        },
      });
      created.push(decl.id);
    }
    return created;
  }
  /** AI 分类分析：按材料推导应申报税种、依据与预估税额（企业/服务商均可查看）。 */
  async materialAnalysis(user: CurrentUser, id: number) {
    const pack = await this.requirePack(user, id);
    const rows = await this.analyzeMaterial(pack);
    const created = await this.prisma.taxDeclaration.findMany({
      where: { materialId: pack.id },
    });
    return {
      packId: pack.id,
      packNo: pack.packNo,
      period: pack.period,
      status: pack.status,
      rows: rows.map((row) => ({
        ...row,
        estimatedTax: calcTaxAmount(row.taxType, row.form),
        declarationId:
          created.find((item) => item.taxType === row.taxType)?.id || 0,
      })),
    };
  }
  /** 服务商（或平台）核对提报：按勾选的税种生成申报单，同材料同税种幂等。 */
  async generateDeclarations(
    user: CurrentUser,
    id: number,
    taxTypes?: string[],
    body: Record<string, unknown> = {},
  ) {
    const pack = await this.requirePack(user, id);
    // 材料创建时可能尚未指派职员：按「当前已指派的主办职员」解析并回填
    let staffUserId = pack.staffUserId;
    if (!staffUserId && pack.enterpriseId) {
      staffUserId = await this.identity.assignedStaffFor(
        pack.providerUserId,
        pack.enterpriseId,
      );
      if (staffUserId) {
        await this.prisma.taxMaterialPack.update({
          where: { id },
          data: { staffUserId },
        });
      }
    }
    // 核对提报是「服务商为该企业指派的承办职员」的操作；服务商账号请先在签约管理分配主办职员
    const isAssignedStaff = Boolean(staffUserId) && staffUserId === user.userId;
    if (!isAssignedStaff && !this.identity.isPlatformAdmin(user)) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        staffUserId
          ? '仅该企业的承办职员可核对提报'
          : '该企业尚未指派承办职员，请服务商先在「签约管理 · 服务企业台账」分配主办职员',
      );
    }
    if (pack.status === 'DRAFT') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '企业尚未提交本期报税材料，无法提报',
      );
    }
    if (pack.status !== 'ANALYZED') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '仅「AI 分析完成」状态的材料可分类提报',
      );
    }
    if (taxTypes && !taxTypes.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请至少勾选一个税种');
    }
    const created = await this.createDeclarationsFromPack(
      { ...pack, staffUserId },
      taxTypes,
      body,
    );
    const covered = await this.packFullyDeclared(pack);
    if (created.length && covered) {
      // AI 清单税种全部提报后才进入办理中（部分提报仍留在「待提报」，可继续勾选）
      await this.prisma.taxMaterialPack.update({
        where: { id },
        data: { status: 'PROCESSING' },
      });
    }
    await this.identity.audit(
      user.userId,
      'TAX_MATERIAL_GENERATE',
      `#${id} ${pack.packNo} 生成 ${created.length} 张申报单`,
    );
    return {
      packId: pack.id,
      created: created.length,
      declarationIds: created,
      tip: created.length
        ? `已生成 ${created.length} 张申报单（草稿），待财务专员确认并审核后正式申报`
        : '本期税种均已生成申报单，无需重复生成',
    };
  }
  /**
   * 由材料推导应申报税种。取数规则：
   * 员工工资 → 个税扣缴 + 残保金；销项/进项发票 → 增值税（按企业纳税人性质）；
   * 费用小票与无票收入 → 印花税。企业所得税需账务数据，材料阶段不臆造。
   */
  private async analyzeMaterial(pack: {
    id: number;
    payload: unknown;
    enterpriseId: number;
    period: string;
  }) {
    const payload = normalizePayload(pack.payload);
    const labels = new Map<string, string>(
      taxMeta().map((item) => [item.type, item.label]),
    );
    const templateOf = (taxType: string) =>
      taxMeta().find((item) => item.type === taxType)?.label || taxType;
    const sum = (rows: MaterialRow[], key: string) =>
      rows.reduce((acc, row) => acc + Number(row[key] || 0), 0);
    const byKind = (keyword: string) =>
      payload.invoices.filter((row) => text(row.kind || '').includes(keyword));
    const out: {
      taxType: string;
      label: string;
      basis: string;
      formTemplate: string;
      form: Record<string, number>;
    }[] = [];
    if (payload.payroll.length) {
      const income = round2(sum(payload.payroll, 'salary'));
      const headcount = payload.payroll.length;
      out.push({
        taxType: 'iit_withholding',
        label: labels.get('iit_withholding') || '个人所得税扣缴申报',
        basis: `${headcount} 名员工工资合计 ${income} 元，减除费用 5000 元/人`,
        formTemplate: templateOf('iit_withholding'),
        form: { income, deduction: 5000 * headcount },
      });
      out.push({
        taxType: 'ibp',
        label: labels.get('ibp') || '残疾人就业保障金',
        basis: `${headcount} 名员工工资总额 ${income} 元`,
        formTemplate: templateOf('ibp'),
        form: { payroll: income },
      });
    }
    const output = byKind('销项');
    const input = byKind('进项');
    if (output.length || input.length) {
      const enterprise = await this.prisma.enterpriseProfile.findUnique({
        where: { id: pack.enterpriseId },
      });
      const small = enterprise?.taxpayerType === 'SMALL_SCALE';
      const outputTax = round2(sum(output, 'tax'));
      const inputTax = round2(sum(input, 'tax'));
      const sales = round2(sum(output, 'amount'));
      const vatPayable = small
        ? round2(sales * 0.01)
        : round2(outputTax - inputTax);
      out.push({
        taxType: small ? 'vat_small' : 'vat_general',
        label:
          labels.get(small ? 'vat_small' : 'vat_general') || '增值税及附加',
        basis: small
          ? `${output.length} 张销项发票，应税销售额 ${sales} 元（小规模纳税人）`
          : `销项税额 ${outputTax} 元 − 进项税额 ${inputTax} 元（一般纳税人）`,
        formTemplate: templateOf(small ? 'vat_small' : 'vat_general'),
        form: small
          ? { taxable_sales: sales }
          : { output_tax: outputTax, input_tax: inputTax },
      });
      // 附加税以增值税应纳税额为计税依据（城建 7% + 教育费附加 3% + 地方教育附加 2%）
      if (vatPayable > 0) {
        out.push({
          taxType: 'surtax',
          label: labels.get('surtax') || '附加税申报',
          basis: `以增值税 ${vatPayable} 元为计税依据，计提城建税 7% + 教育费附加 3% + 地方教育附加 2%`,
          formTemplate: templateOf('surtax'),
          form: { vat_payable: vatPayable },
        });
      }
    }
    const stamp = [...byKind('费用'), ...byKind('无票')];
    if (stamp.length) {
      const amount = round2(sum(stamp, 'amount'));
      out.push({
        taxType: 'stamp_duty',
        label: labels.get('stamp_duty') || '印花税申报',
        basis: `费用小票与无票收入合计 ${amount} 元`,
        formTemplate: templateOf('stamp_duty'),
        form: { taxable_amount: amount },
      });
    }
    return out;
  }
  /** 发票 OCR 通道状态（未配置凭据时把提示给到前端；有材料包时按企业税号取账号）。 */
  async ocrStatus(user: CurrentUser, packId?: number) {
    let taxNo: string | undefined;
    if (packId) {
      const pack = await this.requirePack(user, packId);
      const enterprise = await this.prisma.enterpriseProfile.findUnique({
        where: { id: pack.enterpriseId },
      });
      taxNo = enterprise?.uscc || undefined;
    }
    return this.ocr.status(taxNo);
  }
  /**
   * 发票识别（企业上传发票的第二种录入方式）：
   * 与手工录入同一权限（企业本人/承办人可操作该材料包），
   * 识别结果用于预填「＋ 添加发票」的单条表单，确认后才入库（保持逐条添加）。
   */
  async ocrInvoice(
    user: CurrentUser,
    packId: number,
    imageBase64: string,
    mime: string,
  ) {
    const pack = await this.requirePack(user, packId);
    const enterprise = await this.prisma.enterpriseProfile.findUnique({
      where: { id: pack.enterpriseId },
    });
    return this.ocr.recognize(
      imageBase64,
      mime,
      enterprise?.name || '',
      enterprise?.uscc || undefined,
    );
  }
  /** 材料明细仅在「材料准备中」可增删改：提交后 AI 分析结论据此固化（demo 口径）。 */
  private requireDraft(pack: { status: string }) {
    if (pack.status !== 'DRAFT') {
      throw new BusinessException(ErrorCode.CONFLICT, '材料已提交，不能修改');
    }
  }
  /** 单据可达性：平台管理员 / 承办人（服务商账号或承办职员） / 企业当事人。 */
  private async requirePack(user: CurrentUser, id: number) {
    const pack = await this.prisma.taxMaterialPack.findUnique({
      where: { id },
    });
    if (!pack) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '报税材料不存在');
    }
    if (this.identity.isPlatformAdmin(user)) return pack;
    if (await this.identity.canWorkOn(user, pack)) return pack;
    const eps = await this.identity.myEnterprises(user.userId);
    if (eps.some((item) => item.id === pack.enterpriseId)) return pack;
    throw new BusinessException(
      ErrorCode.ROLE_MISMATCH,
      '数据仅对承办人与企业当事人可见',
    );
  }
  /**
   * 财税域数据范围（用户口径：**只有指定（承办）职员能处理对应企业的财税，其他人不可见**）：
   * - 平台管理员：全量
   * - 企业用户：本企业
   * - 职员/代理人：仅 `staffUserId = 本人`（承办中的企业）
   * - 服务商：仅本人承办（小微＝本人即职员）**或尚未指派职员**的（未指派时需服务商先指派，故可见）
   * 更换承办职员后，可见性随之转移。
   */
  private async scope(user: CurrentUser) {
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
  /**
   * 申报计划可见范围（对齐 demo GET /plans）：
   * - 平台管理员：全量
   * - 企业当事人（含企业+服务商双角色）：仅本企业计划
   * - 服务商账号：名下 TAX_FINANCE 签约企业的**全部**计划（已指派给职员的对结果仍负责）
   * - 服务商职员：仅 `staffUserId = 本人` 的计划
   * 其余身份无可见数据。
   */
  private async planScopeWhere(user: CurrentUser) {
    if (this.identity.isPlatformAdmin(user)) return {};
    const eps = await this.identity.myEnterprises(user.userId);
    if (eps.length) {
      return { enterpriseId: { in: eps.map((item) => item.id) } };
    }
    const ctx = await this.identity.providerContext(user.userId);
    if (!ctx.providers.length) return { id: { in: [] } };
    const q = await this.identity.qualifications(user.userId);
    const isOwner = q.roles.includes('SERVICE_PROVIDER');
    if (!isOwner && ctx.staffOf.length) {
      return {
        providerUserId: { in: ctx.providers },
        staffUserId: user.userId,
      };
    }
    return { providerUserId: { in: ctx.providers } };
  }
  /**
   * 归档账套。账套是企业账务查询依据：仅该账套的服务商或平台管理员可归档，
   * 且存在未办结的申报计划时禁止归档（避免历史依据被隐藏）。
   */
  async archiveAccountSet(user: CurrentUser, id: number) {
    if (!Number.isFinite(id) || id <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '账套 ID 不合法');
    }
    const row = await this.prisma.accountSet.findUnique({ where: { id } });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '账套不存在');
    }
    if (
      row.providerUserId !== user.userId &&
      !this.identity.isPlatformAdmin(user)
    ) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅该账套的服务商或平台管理员可归档',
      );
    }
    if (row.status !== 'ACTIVE') {
      throw new BusinessException(ErrorCode.CONFLICT, '该账套已归档');
    }
    const pendingPlans = await this.prisma.taxPlan.count({
      where: { accountSetId: id, status: { not: 'DONE' } },
    });
    if (pendingPlans) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `该账套还有 ${pendingPlans} 条未办结申报计划，完成后再归档`,
      );
    }
    await this.prisma.accountSet.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
    await this.identity.audit(
      user.userId,
      'TAX_ACCOUNT_SET_ARCHIVE',
      `#${id} ${row.name}`,
    );
    return { id, status: 'ARCHIVED' };
  }
  /** 申报计划列表：按身份隔离，出参对齐 demo decoratePlan（企业/税种/频率/模板/账套/承办职员/关联申报单）。 */
  async taxPlans(
    user: CurrentUser,
    period?: string,
    enterpriseId?: number,
    page = 1,
    pageSize = 20,
    accountSetId?: number,
  ) {
    // 申报期到来自动补齐当期计划（幂等）：服务商打开「申报计划」即有数据，无需手动生成
    await this.ensureCurrentPlans(user);
    const scopeWhere = await this.planScopeWhere(user);
    const where = {
      AND: [
        scopeWhere,
        {
          ...(period ? { period } : {}),
          ...(enterpriseId ? { enterpriseId } : {}),
          ...(accountSetId ? { accountSetId } : {}),
        },
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.taxPlan.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [
          { enterpriseId: 'asc' },
          { period: 'desc' },
          { taxType: 'asc' },
          { id: 'asc' },
        ],
      }),
      this.prisma.taxPlan.count({ where }),
    ]);
    const [enterprises, sets, decls, staffProfiles] = await Promise.all([
      this.prisma.enterpriseProfile.findMany({
        where: {
          id: { in: [...new Set(rows.map((row) => row.enterpriseId))] },
        },
        select: { id: true, name: true },
      }),
      this.prisma.accountSet.findMany({
        where: {
          id: { in: [...new Set(rows.map((row) => row.accountSetId))] },
        },
        select: { id: true, name: true },
      }),
      this.prisma.taxDeclaration.findMany({
        where: {
          id: { in: rows.map((row) => row.declarationId).filter(Boolean) },
        },
        select: { id: true, declNo: true, status: true, taxAmount: true },
      }),
      this.prisma.staffProfile.findMany({
        where: {
          userId: {
            in: [
              ...new Set(rows.map((row) => row.staffUserId).filter(Boolean)),
            ],
          },
        },
        select: { userId: true, realName: true },
      }),
    ]);
    const enterpriseOf = new Map(enterprises.map((row) => [row.id, row.name]));
    const setOf = new Map(sets.map((row) => [row.id, row.name]));
    const declOf = new Map(decls.map((item) => [item.id, item]));
    const staffNameOf = new Map(
      staffProfiles.map((item) => [item.userId, item.realName]),
    );
    const list = rows.map((row) => {
      const decl = row.declarationId
        ? declOf.get(row.declarationId)
        : undefined;
      const meta = TAX_TYPE_META[row.taxType] || {
        name: row.taxType,
        freq: '',
        template: '',
      };
      return {
        ...row,
        enterprise_name: enterpriseOf.get(row.enterpriseId) || '',
        staff_name: staffNameOf.get(row.staffUserId) || '',
        account_set_name: setOf.get(row.accountSetId) || '',
        decl_no: decl?.declNo || '',
        decl_status: decl?.status || '',
        tax_type_name: meta.name,
        freq: meta.freq,
        template: meta.template,
        tax_type_label: meta.name,
        declaration_no: decl?.declNo || '',
        declaration_status: decl?.status || '',
        declaration_tax_amount: decl?.taxAmount ?? 0,
        declarationId: row.declarationId,
      };
    });
    return { list, total, page, pageSize };
  }
  async taxPlanStats(user: CurrentUser, accountSetId?: number) {
    await this.ensureCurrentPlans(user);
    const scope = await this.planScopeWhere(user);
    const groups = await this.prisma.taxPlan.groupBy({
      by: ['enterpriseId', 'status'],
      where: { ...scope, ...(accountSetId ? { accountSetId } : {}) },
      _count: { _all: true },
    });
    const count = (status: string) =>
      groups
        .filter((row) => row.status === status)
        .reduce((n, row) => n + row._count._all, 0);
    return {
      total: groups.reduce((n, row) => n + row._count._all, 0),
      enterpriseCount: new Set(groups.map((row) => row.enterpriseId)).size,
      due: count('DUE'),
      in_progress: count('IN_PROGRESS'),
      done: count('DONE'),
    };
  }
  private async accountScope(user: CurrentUser) {
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
  /** 申报表基础信息（demo tax-forms.js basicHeader：纳税人名称 / 识别号 / 税款所属期）。 */
  private async basicOf(enterpriseId: number, period: string) {
    const enterprise = await this.prisma.enterpriseProfile.findUnique({
      where: { id: enterpriseId },
    });
    return {
      taxpayerName: enterprise?.name || '',
      uscc: enterprise?.uscc || '',
      period,
    };
  }
  /**
   * 单据可达性：平台管理员 / 承办人（服务商账号或承办职员） / 企业当事人。
   * 承办职员为该申报单的作业人；服务商账号已指派职员时不再代为作业。
   */
  private async requireDecl(user: CurrentUser, id: number) {
    const row = await this.prisma.taxDeclaration.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '申报单不存在');
    if (this.identity.isPlatformAdmin(user)) return row;
    if (await this.identity.canWorkOn(user, row)) return row;
    const eps = await this.identity.myEnterprises(user.userId);
    if (eps.some((item) => item.id === row.enterpriseId)) return row;
    throw new BusinessException(
      ErrorCode.ROLE_MISMATCH,
      '数据仅对承办人与企业当事人可见',
    );
  }
  /**
   * 推进类动作前置（确认并审核 / 扣款）：仅平台管理员或承办人（服务商账号/承办职员），
   * 企业当事人只读——扣款属资金类，申报推进由承办人执行（规则 8）。
   */
  private async requireDeclActor(
    user: CurrentUser,
    id: number,
    action: string,
  ) {
    const row = await this.requireDecl(user, id);
    if (!(await this.identity.canWorkOn(user, row))) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        row.staffUserId
          ? `${action}由该企业的承办职员办理（服务商账号不代替承办人作业），企业侧只读`
          : `${action}由承办财税服务的服务商或承办职员办理，企业侧只读`,
      );
    }
    return row;
  }
}
const MATERIAL_SECTIONS = ['payroll', 'invoices', 'bank'] as const;
type MaterialSection = (typeof MATERIAL_SECTIONS)[number];
/** 各步骤明细的中文名（与报税工作台一致）。 */
const SECTION_LABELS: Record<MaterialSection, string> = {
  payroll: '员工与工资',
  invoices: '发票',
  bank: '银行流水',
};
/** 数值型字段：逐条录入时按数字校验。 */
const SECTION_NUMBER_FIELDS: Record<MaterialSection, string[]> = {
  payroll: ['salary', 'socialSecurity', 'housingFund'],
  invoices: ['amount', 'tax'],
  bank: ['amount'],
};
/** 必填字段（逐条添加时校验）。 */
const SECTION_REQUIRED: Record<
  MaterialSection,
  {
    key: string;
    label: string;
  }[]
> = {
  payroll: [{ key: 'name', label: '姓名' }],
  invoices: [{ key: 'invoiceNo', label: '发票号码' }],
  bank: [{ key: 'date', label: '日期' }],
};
type MaterialRow = Record<string, unknown> & {
  id?: string;
};
type MaterialPayload = Record<MaterialSection, MaterialRow[]>;
function emptyPayload(): MaterialPayload {
  return { payroll: [], invoices: [], bank: [] };
}
function round2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
function normalizePayload(value: unknown): MaterialPayload {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const payload = emptyPayload();
  for (const section of MATERIAL_SECTIONS) {
    const rows = source[section];
    payload[section] = Array.isArray(rows) ? (rows as MaterialRow[]) : [];
  }
  return payload;
}
function requireSection(value: string): MaterialSection {
  const section = String(value || '') as MaterialSection;
  if (!MATERIAL_SECTIONS.includes(section)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `明细类型不合法（应为 ${MATERIAL_SECTIONS.join(' / ')}）`,
    );
  }
  return section;
}
/** 校验并规整单条明细；create 为 true 时生成 id 并校验必填。 */
function buildRow(
  section: MaterialSection,
  input: Record<string, unknown>,
  create = true,
): MaterialRow {
  const row: MaterialRow = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'id') continue;
    if (value === undefined) continue;
    if (SECTION_NUMBER_FIELDS[section].includes(key)) {
      const num = Number(value);
      if (text(value).trim() !== '' && !Number.isFinite(num)) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, `${key} 需为数字`);
      }
      row[key] = Number.isFinite(num) ? num : 0;
    } else {
      row[key] = text(value ?? '').trim();
    }
  }
  for (const field of SECTION_REQUIRED[section]) {
    if (create && !text(row[field.key] ?? '').trim()) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `请填写${field.label}`,
      );
    }
  }
  if (create) {
    row.id = randomUUID();
  }
  return row;
}
function decoratePack(row: {
  id: number;
  packNo: string;
  period: string;
  title: string;
  status: string;
  payload: unknown;
  providerUserId: string;
  staffUserId: string;
  enterpriseId: number;
  createdAt: Date;
  submittedAt?: Date | null;
  analyzedAt?: Date | null;
  [key: string]: unknown;
}) {
  const payload = normalizePayload(row.payload);
  return {
    ...row,
    payload,
    // 列表/详情统一用 demo 的蛇形时间字段（提交时间、分析时间、创建时间）
    created_at: row.createdAt,
    submitted_at: row.submittedAt || null,
    analyzed_at: row.analyzedAt || null,
    counts: {
      payroll: payload.payroll.length,
      invoices: payload.invoices.length,
      bank: payload.bank.length,
    },
  };
}
