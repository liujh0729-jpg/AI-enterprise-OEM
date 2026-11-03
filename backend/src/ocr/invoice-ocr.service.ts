import { decodeBase64File } from '../common/base64-file';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { QxyOpenApiClient, qxyObject } from '../qixiangyun/qxy-openapi.client';
import {
  QxyCredentials,
  QxySettingsService,
} from '../qixiangyun/qxy-settings.service';
/** Prefill only: the user confirms these fields before adding an invoice. */
export type InvoiceOcrResult = {
  kind: string;
  invoiceNo: string;
  counterparty: string;
  amount: number;
  tax: number;
  date: string;
  extra: Record<string, string>;
  mode: string;
  raw: string;
};
export class InvoiceOcrService {
  constructor(
    private readonly client: QxyOpenApiClient,
    private readonly accounts?: QxySettingsService,
  ) {}
  /** 按企业税号取「财税管理」匹配的账号凭据；未匹配时回退历史单凭据。 */
  private async credentialsOf(taxNo?: string): Promise<QxyCredentials | null> {
    if (!this.accounts) return null;
    try {
      return await this.accounts.credentialsForTaxNo(taxNo);
    } catch {
      // 账号池异常不阻塞状态查询，识别时会给出明确错误。
      return null;
    }
  }
  async status(taxNo?: string) {
    const credentials = await this.credentialsOf(taxNo);
    const configured = credentials
      ? await this.client.configured(credentials)
      : await this.client.configured();
    return {
      mode: 'qixiangyun',
      configured,
      hint: configured
        ? ''
        : '请联系平台管理员在「财税管理」新增企享云账号并匹配企业税号，同时开通发票 OCR 权限；当前可使用手工录入。',
    };
  }
  async recognize(
    imageBase64: string,
    mime: string,
    enterpriseName: string,
    taxNo?: string,
  ): Promise<InvoiceOcrResult> {
    if (!['image/jpeg', 'image/png'].includes(mime))
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '发票图片仅支持 JPG / PNG 格式',
      );
    const image = decodeBase64File(imageBase64, 8 * 1024 * 1024, '发票图片');
    if (image.length < 48)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '发票图片为空或过小');
    const credentials = await this.credentialsOf(taxNo);
    const result = credentials
      ? await this.client.recognizeInvoice(
          image.toString('base64'),
          credentials,
        )
      : await this.client.recognizeInvoice(image.toString('base64'));
    if (result.success !== true)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '企享云未能识别发票，请上传清晰的单张发票图片或手工录入',
      );
    const invoices = Array.isArray(result.datas) ? result.datas : [];
    if (invoices.length > 1)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '图片包含多张票据，请分别上传单张发票',
      );
    // data is the documented legacy single-invoice response; prefer datas.
    const fields = qxyObject(invoices[0] ?? result.data);
    const pick = (key: string) =>
      typeof fields[key] === 'string' || typeof fields[key] === 'number'
        ? String(fields[key]).trim()
        : '';
    if (!pick('fphm') && !pick('xfmc') && !pick('gfmc'))
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '未识别到发票信息，请上传清晰的单张发票图片或手工录入',
      );
    const money = (key: string): number | undefined => {
      const value = pick(key).replace(/[,，￥¥\s]/g, '');
      if (!/^-?\d+(\.\d+)?$/.test(value)) return undefined;
      const number = Number(value);
      return Number.isFinite(number)
        ? Math.round(number * 100) / 100
        : undefined;
    };
    const seller = pick('xfmc');
    const buyer = pick('gfmc');
    const normalizeName = (value: string) => value.replace(/\s/g, '');
    const name = normalizeName(enterpriseName);
    const sellerHit = Boolean(name && normalizeName(seller) === name);
    const buyerHit = Boolean(name && normalizeName(buyer) === name);
    const kind =
      sellerHit && !buyerHit ? '销项' : buyerHit && !sellerHit ? '进项' : '';
    const tax = money('se') ?? 0;
    const total = money('jshj');
    const amount =
      money('je') ??
      (total !== undefined ? Math.round((total - tax) * 100) / 100 : 0);
    const extra = {
      发票类型: pick('title') || pick('fplx'),
      发票代码: pick('fpdm'),
      销售方: seller,
      销售方税号: pick('xfsbh'),
      购买方: buyer,
      购买方税号: pick('gfsbh'),
      价税合计: total === undefined ? '' : String(total),
    };
    return {
      kind,
      invoiceNo: pick('fphm'),
      counterparty:
        kind === '销项' ? buyer : kind === '进项' ? seller : seller || buyer,
      amount,
      tax,
      date: normalizeDate(pick('kprq')),
      extra,
      mode: 'qixiangyun',
      // Whitelist review fields instead of echoing the full upstream body.
      raw: JSON.stringify(extra),
    };
  }
}
function normalizeDate(value: string) {
  const match = value.match(/^(\d{4})[-/年]?(\d{1,2})[-/月]?(\d{1,2})/);
  if (!match) return '';
  const [, year, month, day] = match;
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number(year) > 1900 &&
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === iso
    ? iso
    : '';
}
