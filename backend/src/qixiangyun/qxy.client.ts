import { httpRequest, type TransportResult } from '../http/transport';
import { Logger } from '../common/logger';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { QxyCredentials, QxySettingsService } from './qxy-settings.service';
/** 企享云 MCP（报税=企税申报服务 / 开票=数电开票服务）。 */
export type QxyToolResult = {
  ok: boolean;
  code: string;
  message: string;
  data: unknown;
  raw: string;
};
const DEFAULT_BASE = 'https://mcp.qixiangyun.com';
type JsonRpcResponse = {
  id?: number | string;
  result?: {
    content?: {
      type?: string;
      text?: string;
    }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
  error?: {
    code?: number;
    message?: string;
  };
};
/**
 * 企享云 MCP 客户端：JSON-RPC over HTTP Streamable（`<mount>-http`）。
 * 鉴权按对方文档：**每次 tools/call 的参数里带 client_appkey + client_secret**（不走 HTTP 头）。
 */
export class QxyClient {
  private readonly logger = new Logger(QxyClient.name);
  constructor(private readonly settings: QxySettingsService) {}
  private base() {
    return String(process.env.QXY_MCP_BASE || DEFAULT_BASE).replace(/\/+$/, '');
  }
  private async credentials(override?: QxyCredentials) {
    if (override?.appkey && override?.secret) return override;
    const { appkey, secret } = await this.settings.resolve();
    if (!appkey || !secret) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '企享云未配置报税 API Key，请平台管理员在「财税管理」新增账号并匹配税号',
      );
    }
    return { appkey, secret };
  }
  /** 上游报错可能夹带请求参数：抹掉本系统配置的 appkey / secret 再回显，并截断长度。 */
  private mask(text: string, credentials: QxyCredentials, limit = 160) {
    let out = text;
    for (const raw of [credentials.appkey, credentials.secret]) {
      const value = String(raw || '').trim();
      if (value) {
        out = out.split(JSON.stringify(value).slice(1, -1)).join('***');
        out = out.split(value).join('***');
      }
    }
    return out.length > limit ? `${out.slice(0, limit)}…` : out;
  }
  private redact(value: unknown, credentials: QxyCredentials): unknown {
    if (typeof value === 'string')
      return this.mask(value, credentials, Infinity);
    if (Array.isArray(value))
      return value.map((item) => this.redact(item, credentials));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          this.mask(key, credentials, Infinity),
          /^(client_)?(appkey|secret)$/i.test(key)
            ? '***'
            : this.redact(item, credentials),
        ]),
      );
    }
    return value;
  }
  /** 调用某个子服务的 MCP Tool；凭据可由调用方按企业税号传入（不传则用全局配置）。 */
  async call(
    mount: string,
    tool: string,
    args: Record<string, unknown> = {},
    override?: QxyCredentials,
  ): Promise<QxyToolResult> {
    const credentials = await this.credentials(override);
    const url = `${this.base()}${mount.startsWith('/') ? mount : `/${mount}`}-http`;
    const body = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: tool,
        arguments: {
          ...args,
          client_appkey: credentials.appkey,
          client_secret: credentials.secret,
        },
      },
    };
    let response: TransportResult<string>;
    try {
      response = await httpRequest<string>(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(body),
        timeoutMs: 60000,
        readAs: 'text',
        operation: 'qxy:mcp',
        cache: 'no-store',
      });
    } catch (error) {
      this.logger.warn(
        `企享云 MCP 调用失败(${tool}): ${this.mask(error instanceof Error ? error.message : String(error), credentials)}`,
      );
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '企享云服务暂时不可用，请稍后重试',
      );
    }
    const text = response.data;
    const payload = this.parse(text);
    if (!response.ok || !payload) {
      // 上游正文只进服务端日志，不回显给调用方（可能含请求参数与凭据片段）
      this.logger.warn(
        `企享云返回异常(${tool} HTTP ${response.status}): ${this.mask(text, credentials)}`,
      );
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `企享云返回异常（HTTP ${response.status}），请稍后重试或联系平台管理员`,
      );
    }
    if (payload.error) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `企享云调用失败：${this.mask(String(payload.error.message || payload.error.code || ''), credentials)}`,
      );
    }
    if (!payload.result) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '企享云返回异常：缺少工具执行结果',
      );
    }
    const raw = payload.result.content?.[0]?.text || '';
    const data =
      payload.result?.structuredContent || this.tryJson(raw) || raw || null;
    const envelope = (data || {}) as {
      success?: boolean;
      code?: string;
      message?: string;
    };
    const explicitCode = envelope.code == null ? '' : String(envelope.code);
    const successFlag = envelope.success === true;
    const successCode = ['OK', 'SUCCESS', '0', '200'].includes(
      explicitCode.toUpperCase(),
    );
    const code = explicitCode || (successFlag ? 'OK' : 'UNKNOWN');
    const ok =
      payload.result.isError !== true &&
      envelope.success !== false &&
      (successFlag || successCode);
    return {
      ok,
      code: this.mask(code, credentials),
      message: this.mask(String(envelope.message || ''), credentials),
      data: this.redact(data, credentials),
      raw: this.mask(raw, credentials, 2000),
    };
  }
  /** 列出某子服务的工具（联调/自检用）。 */
  async tools(mount: string) {
    const url = `${this.base()}${mount.startsWith('/') ? mount : `/${mount}`}-http`;
    const response = await httpRequest<string>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
      cache: 'no-store',
      timeoutMs: 60000,
      readAs: 'text',
      operation: 'qxy:tools',
    });
    const payload = this.parse(response.data) as {
      result?: {
        tools?: {
          name?: string;
          description?: string;
        }[];
      };
    } | null;
    return payload?.result?.tools || [];
  }
  /** 检查当前凭据是否完整且可读取，不向企享云发送请求。 */
  async configured() {
    const credentials = await this.settings.resolve();
    return Boolean(credentials.appkey && credentials.secret);
  }
  private parse(text: string): JsonRpcResponse | null {
    const match = text.match(/data:\s*(\{[\s\S]*\})/);
    const candidate = match ? match[1] : text;
    try {
      return JSON.parse(candidate) as JsonRpcResponse;
    } catch {
      return null;
    }
  }
  private tryJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
}
