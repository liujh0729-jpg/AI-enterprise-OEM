import { ok, text } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { TaxService } from './tax.service';
export class TaxController {
  constructor(private readonly tax: TaxService) {}
  async setPage(user: CurrentUser, query: { page: number; pageSize: number }) {
    return ok(await this.tax.accountSetPage(user, query));
  }
  async setDetail(user: CurrentUser, id: string) {
    return ok(await this.tax.accountSetDetail(user, parseId(id)));
  }
  async materialPage(
    user: CurrentUser,
    query: { page: number; pageSize: number },
  ) {
    return ok(await this.tax.materialPage(user, query));
  }
  meta() {
    return ok(this.tax.meta());
  }
  async declarationPage(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.tax.declarationPage(user, query));
  }
  async declarationStats(user: CurrentUser) {
    return ok(await this.tax.declarationStats(user));
  }
  async providers() {
    return ok(await this.tax.providers());
  }
  async decls(user: CurrentUser) {
    return ok(await this.tax.listDeclarations(user));
  }
  /** 单张申报单（按单号直达，如申报计划/账套里的「查看申报单」）；服务商账号对名下申报单只读。 */
  async declDetail(user: CurrentUser, id: string) {
    return ok(await this.tax.declarationDetail(user, parseId(id)));
  }
  async createDecl(user: CurrentUser, body: Record<string, unknown>) {
    return ok(
      await this.tax.createDeclaration(user, {
        ...body,
        tax_type: text(body.tax_type),
        period: text(body.period),
        title: text(body.title),
        form_data: (body.form_data || {}) as Record<string, number>,
      }),
    );
  }
  async form(
    user: CurrentUser,
    id: string,
    body: Record<
      string,
      | number
      | string
      | { taxpayerName?: string; uscc?: string; period?: string }
    >,
  ) {
    return ok(await this.tax.updateForm(user, parseId(id), body));
  }
  async declarationContacts(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(
      await this.tax.updateDeclarationContacts(user, parseId(id), body),
    );
  }
  async runAi(user: CurrentUser, id: string) {
    return ok(await this.tax.runAi(user, parseId(id)));
  }
  async qc(
    user: CurrentUser,
    id: string,
    body: {
      action?: 'PASS' | 'REJECT';
      confirms?: string[];
      note?: string;
    },
  ) {
    return ok(
      await this.tax.qc(
        user,
        parseId(id),
        body.action === 'REJECT' ? 'REJECT' : 'PASS',
        body.confirms || [],
        body.note,
      ),
    );
  }
  async pay(user: CurrentUser, id: string) {
    return ok(await this.tax.pay(user, parseId(id)));
  }
  trial(body: { tax_type?: string; form?: Record<string, number> }) {
    return ok(
      this.tax.trial(String(body.tax_type || 'vat_general'), body.form || {}),
    );
  }
  async saveTrial(
    user: CurrentUser,
    body: {
      kind?: string;
      title?: string;
      snapshot?: Record<string, unknown>;
    },
  ) {
    // 与 demo 一致的填报记录类型：申报表试算 / 工商年检 / 旧账导入 / 报表导出
    const allowed = ['CALC', 'INSPECT', 'LEGACY', 'REPORT'];
    const kind = allowed.includes(String(body.kind))
      ? String(body.kind)
      : 'CALC';
    return ok(
      await this.tax.saveRecord(
        user,
        kind,
        body.title || '填报记录',
        body.snapshot || {},
      ),
    );
  }
  async recordPage(
    user: CurrentUser,
    query: { kind?: string; page: number; pageSize: number },
  ) {
    return ok(await this.tax.recordPage(user, query));
  }
  async records(user: CurrentUser, kind?: string) {
    return ok(await this.tax.records(user, kind));
  }
  async deleteRecord(user: CurrentUser, id: string) {
    return ok(await this.tax.deleteRecord(user, parseId(id)));
  }
  async archiveSet(user: CurrentUser, id: string) {
    return ok(await this.tax.archiveAccountSet(user, parseId(id)));
  }
  async sets(user: CurrentUser) {
    return ok(await this.tax.accountSets(user));
  }
  /** 企业报税材料（按「企业 × 属期」一份材料包，三步明细逐条添加）。 */
  async materialPacks(user: CurrentUser) {
    return ok(await this.tax.materialPacks(user));
  }
  async currentMaterialPack(user: CurrentUser, period?: string) {
    return ok(await this.tax.currentMaterialPack(user, String(period || '')));
  }
  /** 报税材料详情（状态概览 + 三步材料 + AI 分析结果 + 分税种提报进度）。 */
  async materialPackDetail(user: CurrentUser, id: string) {
    return ok(await this.tax.materialPackDetail(user, parseId(id)));
  }
  async materialPackContacts(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(
      await this.tax.updateMaterialPackContacts(user, parseId(id), body),
    );
  }
  async addMaterialRow(
    user: CurrentUser,
    id: string,
    body: {
      section?: string;
      row?: Record<string, unknown>;
    },
  ) {
    return ok(
      await this.tax.addMaterialRow(
        user,
        parseId(id),
        String(body.section || ''),
        body.row || {},
      ),
    );
  }
  async updateMaterialRow(
    user: CurrentUser,
    id: string,
    rowId: string,
    body: {
      section?: string;
      patch?: Record<string, unknown>;
    },
  ) {
    return ok(
      await this.tax.updateMaterialRow(
        user,
        parseId(id),
        rowId,
        String(body.section || ''),
        body.patch || {},
      ),
    );
  }
  async removeMaterialRow(
    user: CurrentUser,
    id: string,
    rowId: string,
    section?: string,
  ) {
    return ok(
      await this.tax.removeMaterialRow(
        user,
        parseId(id),
        rowId,
        String(section || ''),
      ),
    );
  }
  async submitMaterialPack(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.tax.submitMaterialPack(user, parseId(id), body));
  }
  /** 发票 OCR 通道状态（前端据此提示需要配置哪种凭据；带材料包时按企业税号取账号）。 */
  async ocrStatus(user: CurrentUser, packId?: number) {
    return ok(await this.tax.ocrStatus(user, packId));
  }
  /**
   * 发票识别：企业上传发票的第二种方式（第一种为逐条手工录入）。
   * 图片以 base64 传入，返回预填字段，人工确认后再走「＋ 添加发票」入库。
   */
  async ocrInvoice(
    user: CurrentUser,
    id: string,
    body: {
      image_base64?: string;
      mime?: string;
    },
  ) {
    return ok(
      await this.tax.ocrInvoice(
        user,
        parseId(id),
        text(body.image_base64),
        text(body.mime, 'image/jpeg'),
      ),
    );
  }
  /** AI 分类分析结果（企业看进度、服务商核对用）。 */
  async materialAnalysis(user: CurrentUser, id: string) {
    return ok(await this.tax.materialAnalysis(user, parseId(id)));
  }
  /** 服务商核对提报：按勾选税种生成申报单（同材料同税种幂等）。 */
  async generateDeclarations(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const taxTypes = Array.isArray(body.taxTypes)
      ? body.taxTypes.map((item) => String(item)).filter(Boolean)
      : undefined;
    return ok(
      await this.tax.generateDeclarations(user, parseId(id), taxTypes, body),
    );
  }
  async createSet(
    user: CurrentUser,
    body: {
      name?: string;
      enterpriseId?: number;
    },
  ) {
    return ok(
      await this.tax.createAccountSet(
        user,
        String(body.name || '账套'),
        body.enterpriseId,
      ),
    );
  }
  async planList(
    user: CurrentUser,
    period?: string,
    enterpriseId?: number,
    page = 1,
    pageSize = 20,
    accountSetId?: number,
  ) {
    return ok(
      await this.tax.taxPlans(
        user,
        period,
        enterpriseId,
        page,
        pageSize,
        accountSetId,
      ),
    );
  }
  async planStats(user: CurrentUser, accountSetId?: number) {
    return ok(await this.tax.taxPlanStats(user, accountSetId));
  }
  /** 生成本期申报计划（服务商侧）：按纳税人性质与申报频率生成当期应申报税种，幂等。 */
  async generatePlans(user: CurrentUser) {
    return ok(await this.tax.generatePlans(user));
  }
  async fromPlan(user: CurrentUser, id: string) {
    return ok(await this.tax.createDeclFromPlan(user, parseId(id)));
  }
  async consultations(user: CurrentUser) {
    return ok(await this.tax.consultations(user));
  }
  async ask(
    user: CurrentUser,
    body: {
      question?: string;
    },
  ) {
    return ok(
      await this.tax.createConsultation(user, String(body.question || '')),
    );
  }
  async reply(
    user: CurrentUser,
    id: string,
    body: {
      answer?: string;
    },
  ) {
    return ok(
      await this.tax.replyConsultation(
        user,
        parseId(id),
        String(body.answer || ''),
      ),
    );
  }
}
