import { Prisma } from '../../generated/prisma';
import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { CHANNEL_CATALOG, CHANNEL_REGISTRY } from './external.channel';
import {
  buildGuide,
  buildTaxPayload,
  taxTypeLabelOf,
} from './external.message';
import { SUBMISSION_STATUS, type SubmissionStatus } from './external.types';
type TimelineEntry = {
  at: string;
  action: string;
  text: string;
  actorId: string;
  from?: string;
  to?: string;
  acceptNo?: string;
  receiptNo?: string;
};
/** 外报任务列表/详情行。 */
export type SubmissionRow = {
  id: number;
  bizType: string;
  refType: string;
  refId: number;
  refNo: string;
  enterpriseId: number;
  providerUserId: string;
  staffUserId: string;
  channelCode: string;
  period: string;
  taxType: string;
  targetSystem: string;
  payload: unknown;
  payloadHash: string;
  status: string;
  acceptNo: string;
  receiptNo: string;
  errorCode: string;
  errorMsg: string;
  attempts: number;
  guide: unknown;
  timeline: TimelineEntry[];
  submittedBy: string;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
export class ExternalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}
  /** 启动时注册通道（enabled 只在首次创建时写入，保留管理员后续开关）。 */
  async onModuleInit() {
    for (const item of CHANNEL_CATALOG) {
      await this.prisma.externalChannel.upsert({
        where: { code: item.code },
        update: { name: item.name, bizType: item.bizType },
        create: {
          code: item.code,
          name: item.name,
          bizType: item.bizType,
          enabled: item.implemented ? 1 : 0,
          config: {
            implemented: item.implemented,
            requiring: [...item.requiring],
          },
        },
      });
    }
  }
  /** 通道目录（含未开通通道与开通所需外部条件）。 */
  async channels() {
    const rows = await this.prisma.externalChannel.findMany({
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({
      code: row.code,
      name: row.name,
      bizType: row.bizType,
      enabled: row.enabled === 1,
      implemented: Boolean(CHANNEL_REGISTRY[row.code]),
      config: row.config,
    }));
  }
  /** 选择通道：当前只有人工通道可直接投用；后续通道具备条件后在此按企业维度灰度。 */
  private async pickChannel(bizType: 'TAX' | 'CUSTOMS', prefer?: string) {
    if (prefer && CHANNEL_REGISTRY[prefer]) return prefer;
    const rows = await this.prisma.externalChannel.findMany({
      where: { enabled: 1, bizType },
      orderBy: { id: 'asc' },
    });
    const hit = rows.find((row) => CHANNEL_REGISTRY[row.code]);
    if (!hit) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '暂无可用外报通道，请联系平台管理员',
      );
    }
    return hit.code;
  }
  /**
   * 报文预览：不落库，供申报单详情在审核前查看将报送的报文。
   * 同一申报单的 payloadHash 稳定可复现。
   */
  async previewForDeclaration(user: CurrentUser, declId: number) {
    const decl = await this.requireDeclaration(user, declId);
    const built = await this.buildForDeclaration(decl);
    return {
      refType: 'TAX_DECLARATION',
      refId: decl.id,
      refNo: decl.declNo,
      taxType: decl.taxType,
      taxTypeLabel: built.taxTypeLabel,
      period: decl.period,
      payload: built.payload,
      payloadHash: built.payloadHash,
      guide: buildGuide(built.task),
      targetSystem: built.task.payload.target_system,
    };
  }
  /**
   * 申报单「确认并审核」通过后生成外报任务：
   * 报文 + payloadHash + 人工通道作业指引，幂等键 refType + refId + period。
   * 权限：仅平台管理员或承办人（服务商账号/承办职员），企业当事人不可自行生成。
   */
  async createForDeclaration(user: CurrentUser, declId: number) {
    const decl = await this.prisma.taxDeclaration.findUnique({
      where: { id: declId },
    });
    if (!decl) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '申报单不存在');
    }
    if (!(await this.identity.canWorkOn(user, decl))) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '外报任务由承办人（服务商账号/承办职员）生成，企业侧只读',
      );
    }
    const actorUserId = user.userId;
    const existing = await this.prisma.externalSubmission.findUnique({
      where: {
        refType_refId_period: {
          refType: 'TAX_DECLARATION',
          refId: decl.id,
          period: decl.period,
        },
      },
    });
    if (existing) return existing;
    const built = await this.buildForDeclaration(decl);
    const channelCode = await this.pickChannel('TAX');
    const guide = buildGuide(built.task);
    const now = new Date().toISOString();
    const timeline: TimelineEntry[] = [
      {
        at: now,
        action: 'CREATE',
        text: `申报单审核通过，已生成 ${built.taxTypeLabel} 报文（${built.payloadHash.slice(0, 12)}）并排队外报`,
        actorId: actorUserId,
        to: 'QUEUED',
      },
      {
        at: now,
        action: 'GUIDE',
        text: `按作业指引在「${guide.system}」人工报送：${guide.entry}`,
        actorId: actorUserId,
      },
    ];
    const row = await this.prisma.externalSubmission.create({
      data: {
        bizType: 'TAX',
        refType: 'TAX_DECLARATION',
        refId: decl.id,
        refNo: decl.declNo,
        enterpriseId: decl.enterpriseId,
        providerUserId: decl.providerUserId,
        staffUserId: decl.staffUserId,
        channelCode,
        period: decl.period,
        taxType: decl.taxType,
        targetSystem: guide.system,
        payload: built.payload as unknown as Prisma.InputJsonValue,
        payloadHash: built.payloadHash,
        status: 'QUEUED',
        guide,
        timeline,
      },
    });
    return row;
  }
  private async buildForDeclaration(decl: {
    id: number;
    declNo: string;
    enterpriseId: number;
    taxType: string;
    period: string;
    formData: unknown;
    taxAmount: unknown;
  }) {
    const enterprise = await this.prisma.enterpriseProfile.findUnique({
      where: { id: decl.enterpriseId },
    });
    const taxTypeLabel = taxTypeLabelOf(decl.taxType);
    const { payload, payloadHash } = buildTaxPayload({
      declNo: decl.declNo,
      taxType: decl.taxType,
      period: decl.period,
      formData: (decl.formData || {}) as Record<string, unknown>,
      taxAmount: Number(decl.taxAmount || 0),
      enterpriseName: enterprise?.name || '',
      uscc: enterprise?.uscc || '',
      taxpayerType: enterprise?.taxpayerType || 'GENERAL',
    });
    return {
      payload,
      payloadHash,
      taxTypeLabel,
      task: {
        refType: 'TAX_DECLARATION' as const,
        refId: decl.id,
        refNo: decl.declNo,
        enterpriseId: decl.enterpriseId,
        enterpriseName: enterprise?.name || '',
        uscc: enterprise?.uscc || '',
        taxType: decl.taxType,
        taxTypeLabel,
        period: decl.period,
        taxAmount: Number(decl.taxAmount || 0),
        payload,
        payloadHash,
      },
    };
  }
  private async requireDeclaration(user: CurrentUser, declId: number) {
    const decl = await this.prisma.taxDeclaration.findUnique({
      where: { id: declId },
    });
    if (!decl) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '申报单不存在');
    }
    await this.assertVisible(user, {
      enterpriseId: decl.enterpriseId,
      providerUserId: decl.providerUserId,
      staffUserId: decl.staffUserId,
    });
    return decl;
  }
  async list(
    user: CurrentUser,
    query: {
      status?: string;
      bizType?: string;
      refType?: string;
    } = {},
  ) {
    const scope = await this.scope(user);
    const rows = await this.prisma.externalSubmission.findMany({
      where: {
        ...(scope || {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.bizType ? { bizType: query.bizType } : {}),
        ...(query.refType ? { refType: query.refType } : {}),
      },
      orderBy: { id: 'desc' },
      take: 200,
    });
    return Promise.all(
      rows.map((row) => this.decorate(user, row as unknown as SubmissionRow)),
    );
  }
  /** 按业务单据取外报任务（申报单详情用，同单据同属期唯一）。 */
  async byRef(user: CurrentUser, refType: string, refId: number) {
    const scope = await this.scope(user);
    const rows = await this.prisma.externalSubmission.findMany({
      where: { ...(scope || {}), refType, refId },
      orderBy: { id: 'desc' },
    });
    return Promise.all(
      rows.map((row) => this.decorate(user, row as unknown as SubmissionRow)),
    );
  }
  async detail(user: CurrentUser, id: number) {
    const row = await this.requireSubmission(user, id);
    const callbacks = await this.prisma.externalCallback.findMany({
      where: { submissionId: id },
      orderBy: { id: 'desc' },
    });
    return {
      ...(await this.decorate(user, row)),
      callbacks: callbacks.map((item) => ({
        id: item.id,
        source: item.source,
        rawBody: item.rawBody,
        signatureValid: item.signatureValid === 1,
        receivedAt: item.receivedAt,
      })),
      canAct: await this.canAct(user, row),
    };
  }
  /** 回填受理号：人工通道在官方系统提交成功后登记，状态 QUEUED → ACCEPTED。 */
  async markSubmitted(user: CurrentUser, id: number, acceptNo: string) {
    const row = await this.requireSubmission(user, id);
    await this.assertCanAct(user, row);
    if (!['QUEUED', 'SUBMITTING'].includes(row.status)) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '当前状态不可回填受理号（仅待报送/报送中可回填）',
      );
    }
    const code = String(acceptNo || '').trim();
    if (!code) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写官方受理号');
    }
    const next = await this.advance(user, row, 'ACCEPTED', {
      acceptNo: code,
      text: `已人工报送并回填受理号 ${code}`,
      submittedBy: user.userId,
      submittedAt: new Date(),
      attempts: row.attempts + 1,
    });
    return next;
  }
  /** 回填回执：状态 ACCEPTED → RECEIPT（可附回执原文，原文留痕）。 */
  async markReceipt(
    user: CurrentUser,
    id: number,
    receiptNo: string,
    rawBody = '',
  ) {
    const row = await this.requireSubmission(user, id);
    await this.assertCanAct(user, row);
    if (row.status !== 'ACCEPTED') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '请先回填受理号（已受理后）再回填回执',
      );
    }
    const code = String(receiptNo || '').trim();
    if (!code) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写官方回执号');
    }
    if (rawBody) {
      await this.recordCallback(user, id, rawBody, 'MANUAL', true);
    }
    return this.advance(user, row, 'RECEIPT', {
      receiptNo: code,
      text: `已取得申报回执 ${code}`,
    });
  }
  /** 扣款回填：资金类操作必须人工确认，状态 RECEIPT → PAID。 */
  async markPaid(user: CurrentUser, id: number, note = '') {
    const row = await this.requireSubmission(user, id);
    await this.assertCanAct(user, row);
    if (row.status !== 'RECEIPT') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '请先取得申报回执再回填扣款结果',
      );
    }
    return this.advance(user, row, 'PAID', {
      text: note
        ? `已人工确认扣款并回填：${note}`
        : '已人工确认扣款（资金类操作人工确认，未自动化）',
    });
  }
  /** 退回/失败：登记失败码与原因（写操作不自动重试，由人工决定重试或改单）。 */
  async markRejected(
    user: CurrentUser,
    id: number,
    errorCode: string,
    errorMsg: string,
    rawBody = '',
  ) {
    const row = await this.requireSubmission(user, id);
    await this.assertCanAct(user, row);
    if (['PAID', 'CANCELLED'].includes(row.status)) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '已完税/已作废的任务不可退回',
      );
    }
    const code = String(errorCode || '').trim() || 'EXTERNAL_REJECTED';
    const msg = String(errorMsg || '').trim();
    if (!msg) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写退回原因');
    }
    if (rawBody) {
      await this.recordCallback(user, id, rawBody, 'MANUAL', true);
    }
    return this.advance(user, row, 'REJECTED', {
      errorCode: code,
      errorMsg: msg,
      text: `官方退回（${code}）：${msg}`,
    });
  }
  /** 重试：退回/作废后重新排队，复用同一份报文（payloadHash 不变）。 */
  async retry(user: CurrentUser, id: number) {
    const row = await this.requireSubmission(user, id);
    await this.assertCanAct(user, row);
    if (!['REJECTED', 'CANCELLED'].includes(row.status)) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '仅退回/作废的任务可重试',
      );
    }
    return this.advance(user, row, 'QUEUED', {
      text: `人工重试（第 ${row.attempts + 1} 次），复用报文 ${row.payloadHash.slice(0, 12)}`,
      errorCode: '',
      errorMsg: '',
      attempts: row.attempts + 1,
    });
  }
  /** 作废：仅未报送（QUEUED）可作废，避免与官方已受理单据冲突。 */
  async cancel(user: CurrentUser, id: number) {
    const row = await this.requireSubmission(user, id);
    await this.assertCanAct(user, row);
    if (row.status !== 'QUEUED') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '仅待报送任务可作废（已受理需在官方系统处理）',
      );
    }
    return this.advance(user, row, 'CANCELLED', { text: '作废外报任务' });
  }
  /** 回执/回调原文留痕（不可篡改，仅追加）。 */
  async recordCallback(
    user: CurrentUser,
    id: number,
    rawBody: string,
    source = 'MANUAL',
    signatureValid = false,
  ) {
    const row = await this.requireSubmission(user, id);
    const saved = await this.prisma.externalCallback.create({
      data: {
        submissionId: row.id,
        source,
        rawBody: String(rawBody).slice(0, 20000),
        signatureValid: signatureValid ? 1 : 0,
      },
    });
    return { id: saved.id, receivedAt: saved.receivedAt };
  }
  async callbacks(user: CurrentUser, id: number) {
    const row = await this.requireSubmission(user, id);
    const rows = await this.prisma.externalCallback.findMany({
      where: { submissionId: row.id },
      orderBy: { id: 'desc' },
    });
    return rows.map((item) => ({
      id: item.id,
      source: item.source,
      rawBody: item.rawBody,
      signatureValid: item.signatureValid === 1,
      receivedAt: item.receivedAt,
    }));
  }
  // ---------- 内部 ----------
  /** 凭据访问：仅企业本人与平台管理员（凭据属企业资产）。 */
  async requireCredentialAccess(user: CurrentUser, enterpriseId: number) {
    if (!Number.isFinite(enterpriseId) || enterpriseId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '企业 ID 不合法');
    }
    if (this.identity.isPlatformAdmin(user)) return;
    const eps = await this.identity.myEnterprises(user.userId);
    if (eps.some((item) => item.id === enterpriseId)) return;
    throw new BusinessException(
      ErrorCode.ROLE_MISMATCH,
      '外报凭据仅企业本人与平台管理员可维护',
    );
  }
  private async advance(
    user: CurrentUser,
    row: SubmissionRow,
    to: SubmissionStatus,
    input: {
      text: string;
      acceptNo?: string;
      receiptNo?: string;
      errorCode?: string;
      errorMsg?: string;
      submittedBy?: string;
      submittedAt?: Date;
      attempts?: number;
    },
  ) {
    const timeline: TimelineEntry[] = [
      ...(row.timeline || []),
      {
        at: new Date().toISOString(),
        action: to,
        text: input.text,
        actorId: user.userId,
        from: row.status,
        to,
        ...(input.acceptNo ? { acceptNo: input.acceptNo } : {}),
        ...(input.receiptNo ? { receiptNo: input.receiptNo } : {}),
      },
    ];
    // 外报任务与业务单据回写同事务：只落一半会留下「任务已回执、申报单没有回执号」
    const next = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.externalSubmission.update({
        where: { id: row.id },
        data: {
          status: to,
          timeline,
          ...(input.acceptNo !== undefined ? { acceptNo: input.acceptNo } : {}),
          ...(input.receiptNo !== undefined
            ? { receiptNo: input.receiptNo }
            : {}),
          ...(input.errorCode !== undefined
            ? { errorCode: input.errorCode }
            : {}),
          ...(input.errorMsg !== undefined ? { errorMsg: input.errorMsg } : {}),
          ...(input.submittedBy !== undefined
            ? { submittedBy: input.submittedBy }
            : {}),
          ...(input.submittedAt !== undefined
            ? { submittedAt: input.submittedAt }
            : {}),
          ...(input.attempts !== undefined ? { attempts: input.attempts } : {}),
        },
      });
      // 回执/扣款结果回写业务单据（申报单是外报任务的来源，状态须一致）
      if (row.refType === 'TAX_DECLARATION' && row.refId) {
        if (to === 'RECEIPT' && input.receiptNo) {
          await tx.taxDeclaration.update({
            where: { id: row.refId },
            data: { receiptNo: input.receiptNo },
          });
        }
        if (to === 'PAID') {
          await tx.taxDeclaration.update({
            where: { id: row.refId },
            data: { status: 'PAID' },
          });
        }
      }
      return updated;
    });
    return this.decorate(user, next as SubmissionRow);
  }
  private async decorate(user: CurrentUser, row: SubmissionRow) {
    const enterprise = await this.prisma.enterpriseProfile.findUnique({
      where: { id: row.enterpriseId },
    });
    return {
      ...row,
      taxTypeLabel: row.taxType ? taxTypeLabelOf(row.taxType) : '',
      statusLabel:
        SUBMISSION_STATUS[row.status as SubmissionStatus] || row.status,
      enterpriseName: enterprise?.name || '',
      canAct: await this.canAct(user, row),
    };
  }
  /**
   * 数据可见性（与财税主线一致）：承办人 + 企业当事人。
   * 签约服务商仅可见「未指派承办人」的任务（用于分派），已由他人承办的不可见。
   */
  private isVisible(
    user: CurrentUser,
    row: {
      enterpriseId: number;
      providerUserId: string;
      staffUserId: string;
    },
    enterpriseIds: number[],
  ) {
    if (this.identity.isPlatformAdmin(user)) return true;
    if (row.staffUserId && row.staffUserId === user.userId) return true;
    if (row.providerUserId === user.userId && !row.staffUserId) return true;
    return enterpriseIds.includes(row.enterpriseId);
  }
  /** 回填/推进权限：平台管理员、承办人（服务商账号或承办职员）；企业侧只读。 */
  private async canAct(user: CurrentUser, row: SubmissionRow) {
    return this.identity.canWorkOn(user, row);
  }
  private async assertCanAct(user: CurrentUser, row: SubmissionRow) {
    if (await this.canAct(user, row)) return;
    throw new BusinessException(
      ErrorCode.ROLE_MISMATCH,
      '外报回填由承办职员或签约服务商操作，企业侧只读',
    );
  }
  private async requireSubmission(user: CurrentUser, id: number) {
    const row = await this.prisma.externalSubmission.findUnique({
      where: { id },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '外报任务不存在');
    await this.assertVisible(user, row);
    return row as SubmissionRow;
  }
  private async assertVisible(
    user: CurrentUser,
    row: {
      enterpriseId: number;
      providerUserId: string;
      staffUserId: string;
    },
  ) {
    const eps = await this.identity.myEnterprises(user.userId);
    if (
      this.isVisible(
        user,
        row,
        eps.map((item) => item.id),
      )
    )
      return;
    throw new BusinessException(
      ErrorCode.ROLE_MISMATCH,
      '数据仅对承办人与企业当事人可见',
    );
  }
  /** 数据可见范围：与财税主线一致（承办人 + 企业当事人）。 */
  private async scope(user: CurrentUser) {
    if (this.identity.isPlatformAdmin(user)) return undefined;
    const identity = await this.identity.currentIdentity(user);
    if (identity === 'PROVIDER_STAFF') {
      return { staffUserId: user.userId };
    }
    if (identity === 'SERVICE_PROVIDER') {
      return {
        providerUserId: user.userId,
        OR: [{ staffUserId: user.userId }, { staffUserId: '' }],
      };
    }
    const eps = await this.identity.myEnterprises(user.userId);
    return { enterpriseId: { in: eps.map((item) => item.id) } };
  }
}
