import { TAX_FORM_TYPES } from '../common/constants';
export type TaxFormType = (typeof TAX_FORM_TYPES)[number];
export function calcTaxAmount(taxType: string, form: Record<string, unknown>) {
  const num = (key: string, fallback = 0) => Number(form[key] ?? fallback) || 0;
  switch (taxType) {
    case 'vat_general':
      return round(num('output_tax') - num('input_tax'));
    case 'vat_small':
      return round(num('taxable_sales') * 0.01);
    case 'surtax':
      // 附加税 = 增值税应纳税额 ×（城建 7% + 教育费附加 3% + 地方教育附加 2%）
      return round(num('vat_payable') * 0.12);
    case 'cit_quarter':
      return round(num('profit') * 0.25);
    case 'cit_annual':
      return round(num('taxable_income') * 0.25);
    case 'stamp_duty':
      return round(num('taxable_amount') * 0.0005);
    case 'iit_withholding':
      return round(Math.max(num('income') - num('deduction', 5000), 0) * 0.03);
    case 'iit_operating_a':
      return round(num('operating_income') * 0.05);
    case 'iit_operating_b':
      return round(num('annual_income') * 0.1);
    case 'iit_operating_c':
      return round(num('summary_income') * 0.1);
    case 'ibp':
      return round(num('payroll') * 0.015);
    default:
      return round(num('tax_amount'));
  }
}
/**
 * 税种元数据（名称 / 申报频率 / 申报表模板），逐字对齐 demo `server/routes/tax.js` 的 TAX_TYPES。
 * 申报计划列表的「税种（申报频率）」列与模板提示均取自此处。
 */
export const TAX_TYPE_META: Record<
  string,
  {
    name: string;
    freq: string;
    template: string;
  }
> = {
  vat_general: {
    name: '增值税申报（一般纳税人）',
    freq: '季报',
    template: '增值税（一般纳税人）.xls',
  },
  vat_small: {
    name: '增值税申报（小规模纳税人）',
    freq: '季报',
    template: '增值税（小规模）.xls',
  },
  cit_quarter: {
    name: '企业所得税预缴申报（A类）',
    freq: '季报',
    template: '企业所得税月（季）度预缴纳税申报表（A类）.docx',
  },
  cit_annual: {
    name: '企业所得税年度汇算清缴',
    freq: '年报',
    template: '企业所得税年度申报表.xls',
  },
  stamp_duty: {
    name: '印花税申报',
    freq: '次报',
    template: '印花税申报表.doc',
  },
  surtax: {
    name: '附加税申报（城建税·教育费附加·地方教育附加）',
    freq: '季报',
    template: '增值税及附加税费申报表·附列资料（二）',
  },
  iit_withholding: {
    name: '个人所得税扣缴申报',
    freq: '月报',
    template: '个人所得税申报表.pdf',
  },
  iit_operating_a: {
    name: '个人经营所得申报（A表）',
    freq: '月/季报',
    template: '个人所得税经营所得A表.doc',
  },
  iit_operating_b: {
    name: '个人经营所得汇算（B表）',
    freq: '年报',
    template: '个人所得税经营所得B表.doc',
  },
  iit_operating_c: {
    name: '个人经营所得汇总申报（C表）',
    freq: '年报',
    template: '个人所得税经营所得C表.doc',
  },
  ibp: {
    name: '残疾人就业保障金申报',
    freq: '年报',
    template: '—',
  },
};
/** 各纳税人性质的应申报税种集合（季度 / 月度 / 年度），对齐 demo PLAN_TAX_SETS。 */
export const PLAN_TAX_SETS: Record<
  string,
  {
    quarter: string[];
    month: string[];
    year: string[];
  }
> = {
  GENERAL: {
    quarter: ['vat_general', 'cit_quarter', 'surtax'],
    month: ['iit_withholding'],
    year: ['cit_annual', 'ibp'],
  },
  SMALL_SCALE: {
    quarter: ['vat_small', 'cit_quarter', 'surtax'],
    month: ['iit_withholding'],
    year: ['cit_annual', 'ibp'],
  },
};
/** 当前申报期次：月报 YYYY-MM、季报 YYYY-Qn、年报 YYYY。 */
export function currentPeriods() {
  const now = new Date();
  const year = now.getFullYear();
  return {
    month: `${year}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    quarter: `${year}-Q${Math.floor(now.getMonth() / 3) + 1}`,
    year: String(year),
  };
}
export function taxMeta() {
  return TAX_FORM_TYPES.map((type) => ({
    type,
    label: labelOf(type),
  }));
}
function labelOf(type: TaxFormType): string {
  return TAX_TYPE_META[type]?.name || type;
}
function round(value: number) {
  return Math.round(value * 100) / 100;
}
export const AI_STEPS = [
  '采集申报表字段',
  '核对纳税人识别号',
  '计算应纳税额',
  '校验附表勾稽',
  '生成申报草稿',
  '风险扫描',
  '回写试算结果',
  '等待财务专员确认',
];
/** 8 步流水线逐项说明（申报单详情展示每步做了什么）。 */
export const AI_STEP_NOTES = [
  '从材料与账套自动采集本申报表所需字段',
  '与电子税务局登记信息比对纳税人识别号与名称',
  '按适用税率与计税依据计算应纳税（费）额',
  '校验主表与附表勾稽关系，标记差额项',
  '生成申报草稿并回写本申报单',
  '扫描进销项匹配、税负率异常等风险点',
  '回写试算结果供财务专员复核',
  '移交财务专员确认并审核',
];
export const ADVISOR_CHECKS = [
  '纳税人信息',
  '所属期',
  '销售额/收入',
  '税额计算',
  '减免优惠',
  '附件齐全',
  '签署确认',
];
