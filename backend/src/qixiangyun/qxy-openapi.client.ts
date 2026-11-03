import { httpRequest, TransportError } from '../http/transport';
import { createHash, randomUUID } from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { QxyCredentials, QxySettingsService } from './qxy-settings.service';
type JsonObject = Record<string, unknown>;
type Token = {
  value: string;
  expiresAt: number;
};
const AUTH_ERRORS = new Set(['40100', '40101', '40102']);
const md5 = (value: string) =>
  createHash('md5').update(value, 'utf8').digest('hex');
/** API-SV1 uses Base64 of lowercase MD5 hex text, rather than digest bytes. */
export function qxyRequestSignature(
  credentials: QxyCredentials,
  body: string,
  date: string,
  token: string,
) {
  const digest = md5(
    `POST_${md5(body)}_${date}_${token}_${credentials.secret}`,
  );
  return `API-SV1:${credentials.appkey}:${Buffer.from(digest, 'utf8').toString('base64')}`;
}
export function qxyObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}
/** REST OCR and MCP tools share the same encrypted credentials. */
export class QxyOpenApiClient {
  constructor(private readonly settings: QxySettingsService) {}
  private cached?: {
    fingerprint: string;
    token: Token;
  };
  private pending?: {
    fingerprint: string;
    promise: Promise<Token>;
  };
  async configured(override?: QxyCredentials) {
    const credentials =
      override?.appkey && override?.secret
        ? override
        : await this.settings.resolve();
    return Boolean(credentials.appkey && credentials.secret);
  }
  async recognizeInvoice(
    imageData: string,
    override?: QxyCredentials,
  ): Promise<JsonObject> {
    const credentials =
      override?.appkey && override?.secret
        ? override
        : await this.settings.resolve();
    if (!credentials.appkey || !credentials.secret) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '企享云未配置报税 API Key，请平台管理员在「财税管理」新增账号并匹配企业税号，同时开通发票 OCR 权限',
      );
    }
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(credentials))
      .digest('hex');
    const body = JSON.stringify({
      imageData,
      customReqId: credentials.appkey + randomUUID().replace(/-/g, ''),
    });
    let token = await this.token(credentials, fingerprint);
    for (let attempt = 0; attempt < 2; attempt++) {
      const date = String(Date.now());
      const result = await this.request('/v2/invoice/ocr/sb', body, {
        access_token: token.value,
        req_date: date,
        req_sign: qxyRequestSignature(credentials, body, date, token.value),
      });
      // Authentication failures have not executed OCR. Only these may retry;
      // never retry a charged recognition or an ambiguous transport failure.
      if (AUTH_ERRORS.has(String(result.code)) && attempt === 0) {
        if (this.cached?.token.value === token.value) this.cached = undefined;
        token = await this.token(credentials, fingerprint);
        continue;
      }
      if (result.success !== true || String(result.code) !== '2000')
        throw this.providerError(result.code);
      return qxyObject(result.data);
    }
    throw this.providerError();
  }
  private async token(credentials: QxyCredentials, fingerprint: string) {
    if (
      this.cached?.fingerprint === fingerprint &&
      this.cached.token.expiresAt > Date.now()
    )
      return this.cached.token;
    if (this.pending?.fingerprint === fingerprint) return this.pending.promise;
    const pending = {
      fingerprint,
      promise: this.login(credentials).then((token) => {
        // A late response for old credentials cannot replace a newer login.
        if (this.pending === pending) this.cached = { fingerprint, token };
        return token;
      }),
    };
    this.pending = pending;
    try {
      return await pending.promise;
    } finally {
      if (this.pending === pending) this.pending = undefined;
    }
  }
  private async login(credentials: QxyCredentials): Promise<Token> {
    const result = await this.request(
      '/v2/public/oauth2/login',
      JSON.stringify({
        grant_type: 'client_credentials',
        client_appkey: credentials.appkey,
        client_secret: md5(credentials.secret),
      }),
    );
    const data = qxyObject(result.data);
    if (
      result.success !== true ||
      String(result.code) !== '2000' ||
      typeof data.access_token !== 'string' ||
      !data.access_token.trim()
    )
      throw this.providerError(result.code, true);
    // The login schema defines expires_in in milliseconds. Refresh at least
    // every seven days; absent expiry gets a conservative one-hour cache.
    const lifetime = Number(data.expires_in);
    const ttl = Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 3600000;
    return {
      value: data.access_token,
      expiresAt: Date.now() + Math.max(0, Math.min(ttl, 7 * 86400000) - 60000),
    };
  }
  private async request(
    path: string,
    body: string,
    headers: Record<string, string> = {},
  ): Promise<JsonObject> {
    try {
      const response = await httpRequest(`https://api.qixiangyun.com${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          ...headers,
        },
        body,
        timeoutMs: 60000,
        operation: 'qxy:openapi',
        redirect: 'error',
      });
      if (!response.ok) throw this.providerError();
      return qxyObject(response.data);
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      // Never expose upstream bodies, tokens, secrets, signatures or URLs.
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        error instanceof TransportError && error.kind === 'timeout'
          ? '企享云发票识别超时，请稍后重试'
          : '企享云发票识别服务暂时不可用，请稍后重试',
      );
    }
  }
  private providerError(code?: unknown, login = false) {
    const hints: Record<string, string> = {
      product_binding_check:
        '企享云尚未开通发票 OCR 权限，请联系企享云服务提供商开通',
      '505017': '企享云签名校验失败，请联系管理员',
      '505018': '服务器时间与企享云不一致，请联系管理员',
      '505019': '企享云签名校验失败，请联系管理员核对共享凭据',
      '505069': '企享云发票 OCR 授权已到期，请联系管理员',
      '505070': '企享云发票 OCR 调用次数已用完，请联系管理员',
    };
    const safeCode = /^\d{3,10}$/.test(String(code)) ? String(code) : '';
    return new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      hints[typeof code === 'string' ? code : safeCode] ||
        (login || AUTH_ERRORS.has(safeCode)
          ? '企享云鉴权失败，请联系管理员核对共享 AppKey、Secret 和 OCR 授权'
          : `企享云发票识别失败，请重试或联系管理员${safeCode ? `（错误码 ${safeCode}）` : ''}`),
    );
  }
}
