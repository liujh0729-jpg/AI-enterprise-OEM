import { createHash } from 'node:crypto';
import { calcTaxAmount, taxMeta } from '../tax/tax-forms';
import type { ExternalGuide, ExternalTask } from './external.types';
/** 字段中文名（与前端申报表字段一致，便于报文可读）。 */
const FIELD_LABELS: Record<string, string> = {
  output_tax: '销项税额（元）',
  input_tax: '进项税额（元）',
  taxable_sales: '应税销售额（元）',
  profit: '利润总额（元）',
  taxable_income: '应纳税所得额（元）',
  taxable_amount: '计税金额（元）',
  vat_payable: '增值税应纳税额（元）',
  income: '收入额（元）',
  deduction: '减除费用（元）',
  operating_income: '经营收入（元）',
  annual_income: '年度收入（元）',
  summary_income: '多处汇总收入（元）',
  payroll: '工资总额（元）',
  tax_amount: '应纳税额（元）',
};
/** 各税种的外报目标系统与办税入口。 */
const TAX_TARGETS: Record<
  string,
  {
    system: string;
    entry: string;
    credential: string;
    notice: string;
  }
> = {
  vat_general: {
    system: '全国统一规范电子税务局',
    entry: '我要办税 → 税费申报及缴纳 → 增值税及附加税费申报（一般纳税人）',
    credential: '企业 CA/UKey 或电子税务局子账号（企业授权）',
    notice: '销项/进项及附加税费需与账套勾稽一致；跨省项目预缴需另附。',
  },
  vat_small: {
    system: '全国统一规范电子税务局',
    entry: '我要办税 → 税费申报及缴纳 → 增值税及附加税费申报（小规模）',
    credential: '企业 CA/UKey 或电子税务局子账号（企业授权）',
    notice: '小规模纳税人月销售额未超免征额的，按免税申报处理。',
  },
  cit_quarter: {
    system: '全国统一规范电子税务局',
    entry: '我要办税 → 税费申报及缴纳 → 企业所得税月（季）度预缴申报（A 类）',
    credential: '企业 CA/UKey 或电子税务局子账号（企业授权）',
    notice: '需同步报送财务报表（资产负债表 / 利润表）后再提交预缴申报。',
  },
  cit_annual: {
    system: '全国统一规范电子税务局',
    entry: '我要办税 → 税费申报及缴纳 → 企业所得税年度申报（汇算清缴）',
    credential: '企业 CA/UKey 或电子税务局子账号（企业授权）',
    notice: '汇算清缴期为次年 5 月 31 日前；需附《纳税调整项目明细表》。',
  },
  stamp_duty: {
    system: '全国统一规范电子税务局',
    entry: '我要办税 → 税费申报及缴纳 → 财产和行为税合并纳税申报（印花税）',
    credential: '企业 CA/UKey 或电子税务局子账号（企业授权）',
    notice: '按次申报的，纳税义务发生之日起 15 日内申报。',
  },
  surtax: {
    system: '全国统一规范电子税务局',
    entry:
      '我要办税 → 税费申报及缴纳 → 增值税及附加税费申报（附列资料二·附加税费）',
    credential: '企业 CA/UKey 或电子税务局子账号（企业授权）',
    notice:
      '附加税以增值税应纳税额为计税依据（城建 7% + 教育费附加 3% + 地方教育附加 2%），随增值税同期申报。',
  },
  iit_withholding: {
    system: '自然人电子税务局（扣缴端）',
    entry: '扣缴客户端 → 人员信息采集 → 综合所得申报 → 申报表报送',
    credential: '扣缴义务人实名账号 + 人员明细（涉个人信息，禁止外传）',
    notice:
      '人员明细属敏感个人信息：仅承办职员与本人企业可见，报送后本地仅留脱敏摘要。',
  },
  iit_operating_a: {
    system: '自然人电子税务局',
    entry: '我要办税 → 经营所得申报 → A 表（预缴）',
    credential: '纳税人实名账号',
    notice: '经营所得预缴与综合所得扣缴需分开申报。',
  },
  iit_operating_b: {
    system: '自然人电子税务局',
    entry: '我要办税 → 经营所得申报 → B 表（年度汇算）',
    credential: '纳税人实名账号',
    notice: '年度汇算期为次年 3 月 31 日前。',
  },
  iit_operating_c: {
    system: '自然人电子税务局',
    entry: '我要办税 → 经营所得申报 → C 表（多处汇总）',
    credential: '纳税人实名账号',
    notice: '多处经营所得需先完成各处 B 表再汇总申报。',
  },
  ibp: {
    system: '全国统一规范电子税务局',
    entry: '我要办税 → 非税收入申报 → 残疾人就业保障金申报',
    credential: '企业 CA/UKey 或电子税务局子账号（企业授权）',
    notice: '在职职工人数与工资总额需与年报一致。',
  },
};
/** 回填字段（所有税种一致）：官方系统回填后回到本系统登记。 */
const GUIDE_FIELDS = [
  { key: 'acceptNo', label: '受理号', required: true },
  { key: 'receiptNo', label: '回执号 / 申报成功凭证号', required: true },
];
export function taxTypeLabelOf(taxType: string) {
  return taxMeta().find((item) => item.type === taxType)?.label || taxType;
}
/**
 * 报文生成器：申报单 → 电子税务局报文（本系统规范 AIWORKIN-EXT-1.0）。
 * 报文只由申报单内容决定（不含时间戳），保证同一申报单 payloadHash 稳定、可复现。
 */
export function buildTaxPayload(input: {
  declNo: string;
  taxType: string;
  period: string;
  formData: Record<string, unknown>;
  taxAmount: number;
  enterpriseName: string;
  uscc: string;
  taxpayerType: string;
}): {
  payload: Record<string, unknown>;
  payloadHash: string;
} {
  const target = TAX_TARGETS[input.taxType];
  const payload = {
    spec: 'AIWORKIN-EXT-1.0',
    kind: 'TAX_DECLARATION',
    target_system: target?.system || '全国统一规范电子税务局',
    taxpayer: {
      name: input.enterpriseName,
      uscc: input.uscc,
      taxpayer_type: input.taxpayerType || 'GENERAL',
    },
    declaration: {
      decl_no: input.declNo,
      tax_type: input.taxType,
      tax_type_label: taxTypeLabelOf(input.taxType),
      period: input.period,
    },
    form: {
      items: Object.entries(input.formData).map(([key, value]) => ({
        key,
        label: FIELD_LABELS[key] || key,
        value,
      })),
    },
    computed: {
      tax_amount: input.taxAmount,
      lines: taxLines(input.taxType, input.formData),
    },
    attachments: [] as string[],
  };
  return { payload, payloadHash: payloadHashOf(payload) };
}
/** 税种明细行（勾稽依据与税率），与 calcTaxAmount 的口径保持一致。 */
function taxLines(
  taxType: string,
  form: Record<string, unknown>,
): {
  item: string;
  basis: string;
  rate: string;
  amount: number;
}[] {
  const num = (key: string, fallback = 0) => Number(form[key] ?? fallback) || 0;
  const round = (value: number) => Math.round(value * 100) / 100;
  switch (taxType) {
    case 'vat_general': {
      const output = num('output_tax');
      const input = num('input_tax');
      return [
        { item: '销项税额', basis: '本期销项', rate: '—', amount: output },
        { item: '进项税额', basis: '本期认证进项', rate: '—', amount: input },
        {
          item: '应纳税额',
          basis: '销项 − 进项',
          rate: '—',
          amount: round(output - input),
        },
      ];
    }
    case 'vat_small': {
      const sales = num('taxable_sales');
      return [
        { item: '应税销售额', basis: '本期销售额', rate: '—', amount: sales },
        {
          item: '应纳增值税',
          basis: '销售额 × 征收率',
          rate: '1%',
          amount: round(sales * 0.01),
        },
      ];
    }
    case 'cit_quarter':
      return [
        {
          item: '应纳所得税额',
          basis: '利润总额 × 预缴税率',
          rate: '25%',
          amount: round(num('profit') * 0.25),
        },
      ];
    case 'cit_annual':
      return [
        {
          item: '应纳所得税额',
          basis: '应纳税所得额 × 税率',
          rate: '25%',
          amount: round(num('taxable_income') * 0.25),
        },
      ];
    case 'stamp_duty':
      return [
        {
          item: '印花税',
          basis: '计税金额 × 税率',
          rate: '0.05%',
          amount: round(num('taxable_amount') * 0.0005),
        },
      ];
    case 'surtax': {
      const vat = num('vat_payable');
      return [
        {
          item: '城建税',
          basis: '增值税应纳税额 × 7%',
          rate: '7%',
          amount: round(vat * 0.07),
        },
        {
          item: '教育费附加',
          basis: '增值税应纳税额 × 3%',
          rate: '3%',
          amount: round(vat * 0.03),
        },
        {
          item: '地方教育附加',
          basis: '增值税应纳税额 × 2%',
          rate: '2%',
          amount: round(vat * 0.02),
        },
        {
          item: '附加税合计',
          basis: '增值税应纳税额 × 12%',
          rate: '12%',
          amount: round(vat * 0.12),
        },
      ];
    }
    case 'iit_withholding': {
      const income = num('income');
      const deduction = num('deduction', 5000);
      return [
        { item: '收入额', basis: '本期工资薪金', rate: '—', amount: income },
        { item: '减除费用', basis: '起征点', rate: '—', amount: deduction },
        {
          item: '应扣缴个税',
          basis: '（收入 − 减除费用）× 预扣率',
          rate: '3%',
          amount: round(Math.max(income - deduction, 0) * 0.03),
        },
      ];
    }
    case 'iit_operating_a':
      return [
        {
          item: '应纳经营所得个税',
          basis: '经营收入 × 预征率',
          rate: '5%',
          amount: round(num('operating_income') * 0.05),
        },
      ];
    case 'iit_operating_b':
      return [
        {
          item: '应纳经营所得个税',
          basis: '年度收入 × 税率',
          rate: '10%',
          amount: round(num('annual_income') * 0.1),
        },
      ];
    case 'iit_operating_c':
      return [
        {
          item: '应纳经营所得个税',
          basis: '多处汇总收入 × 税率',
          rate: '10%',
          amount: round(num('summary_income') * 0.1),
        },
      ];
    case 'ibp':
      return [
        {
          item: '残保金',
          basis: '工资总额 × 征收率',
          rate: '1.5%',
          amount: round(num('payroll') * 0.015),
        },
      ];
    default:
      return [
        {
          item: '应纳税（费）额',
          basis: '申报表单值',
          rate: '—',
          amount: calcTaxAmount(taxType, form as Record<string, number>),
        },
      ];
  }
}
/** 人工通道作业指引。 */
export function buildGuide(task: ExternalTask): ExternalGuide {
  const target = TAX_TARGETS[task.taxType];
  return {
    system: target?.system || '全国统一规范电子税务局',
    entry: target?.entry || '我要办税 → 税费申报及缴纳',
    credential:
      target?.credential || '企业 CA/UKey 或电子税务局子账号（企业授权）',
    steps: [
      `打开「${target?.system || '电子税务局'}」并登录（${target?.credential || '企业 CA/UKey'}）`,
      `进入「${target?.entry || '申报入口'}」`,
      `按下方报文填写申报表：${task.taxTypeLabel} · 属期 ${task.period || '—'} · 应纳税额 ¥${task.taxAmount.toFixed(2)}`,
      '核对无误后提交申报，并抄录官方「受理号」',
      '申报成功后抄录「回执号 / 申报成功凭证号」并回填本系统',
      '需扣款的，在官方系统完成扣款后回填扣款结果（资金类操作须人工确认）',
    ],
    fields: GUIDE_FIELDS,
    notice: target?.notice || '请核对纳税人信息与属期后再提交。',
  };
}
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`;
}
export function payloadHashOf(payload: unknown) {
  return createHash('sha256')
    .update(stableStringify(payload), 'utf8')
    .digest('hex');
}
