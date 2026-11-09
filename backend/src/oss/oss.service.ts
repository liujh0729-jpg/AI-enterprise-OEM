import { httpRequest, type TransportResult } from '../http/transport';
import { Logger } from '../common/logger';
import { createHash, createHmac } from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { objectContentType } from './attachment-files';
import {
  OSS_CONFIG,
  ossEncodePath,
  ossHostOf,
  ossObjectKey,
  ossPublicUrl,
} from './oss.config';
import type {
  OssRuntimeConfig,
  OssSettingsService,
} from './oss-settings.service';

export type OssUploadResult = {
  key: string;
  url: string;
  size: number;
  contentType: string;
};

export type OssObjectStat = {
  exists: boolean;
  size: number;
  contentType: string;
};

/** 1x1 透明 PNG：测试连接用固定对象，可重复覆盖，不产生业务数据。 */
const PROBE_PATH = 'healthcheck/oss-connection.png';
const PROBE_CONTENT = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * 阿里云 OSS 上传（V4 签名，PUT Object）。
 * 桶 / Endpoint / Region / 目录 / 凭据优先取管理后台保存的配置（OssSettingsService），
 * 未保存时回退部署默认值与环境变量；配置保存后无需重启。
 */
export class OssService {
  private readonly logger = new Logger(OssService.name);

  constructor(private readonly settings?: OssSettingsService) {}

  private environment(): OssRuntimeConfig {
    return {
      ...OSS_CONFIG,
      accessKeyId: String(process.env.OSS_ACCESS_KEY_ID || '').trim(),
      accessKeySecret: String(process.env.OSS_ACCESS_KEY_SECRET || '').trim(),
      securityToken: String(process.env.OSS_SECURITY_TOKEN || '').trim(),
    };
  }

  /** 同步配置（URL 生成用）：后台保存后由 OssSettingsService 刷新缓存。 */
  private current(): OssRuntimeConfig {
    return this.settings?.current() ?? this.environment();
  }

  /** 对象键 → 公开访问 URL（无需鉴权，bucket 公开读）。 */
  urlOf(path: string) {
    const config = this.current();
    return ossPublicUrl(ossObjectKey(path, config), config);
  }

  /**
   * 完整对象键 → 公开访问 URL。
   * 库里存的是 `upload()` 返回的 key（已经带目录前缀）时必须用这个：
   * `urlOf` 会再拼一次 dir，用它换出来的 URL 会多一层前缀而 404。
   */
  keyUrlOf(key: string) {
    return ossPublicUrl(String(key || '').replace(/^\/+/, ''), this.current());
  }

  private credentials(config: OssRuntimeConfig) {
    const { accessKeyId, accessKeySecret, securityToken } = config;
    if (!accessKeyId || !accessKeySecret) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '文件存储未配置，请管理员在「平台管理后台 → 系统配置」配置 OSS',
      );
    }
    return { accessKeyId, accessKeySecret, securityToken };
  }

  async upload(path: string, content: Buffer): Promise<OssUploadResult> {
    const config = this.settings
      ? await this.settings.resolve()
      : this.environment();
    return this.put(config, path, content);
  }

  /**
   * 浏览器直传签名（PostObject 表单）：前端拿到 `url` + `fields` 后把文件塞进表单直接
   * POST 到桶，大文件不再过后端。签名是 HMAC-SHA1 policy，`content-length-range` 限死上限。
   */
  async signFormPost(
    path: string,
    options: { maxBytes?: number; expiresSeconds?: number } = {},
  ) {
    const config = this.settings
      ? await this.settings.resolve()
      : this.environment();
    const { accessKeyId, accessKeySecret, securityToken } =
      this.credentials(config);
    const key = ossObjectKey(path, config);
    const expiresSeconds = Math.min(
      Math.max(Number(options.expiresSeconds) || 600, 60),
      3600,
    );
    const maxBytes = Math.max(Number(options.maxBytes) || 0, 1);
    const expiration = new Date(
      Date.now() + expiresSeconds * 1000,
    ).toISOString();
    const policy = Buffer.from(
      JSON.stringify({
        expiration,
        conditions: [
          { bucket: config.bucket },
          { key },
          ['content-length-range', 0, maxBytes],
        ],
      }),
    ).toString('base64');
    const signature = createHmac('sha1', accessKeySecret)
      .update(policy)
      .digest('base64');
    return {
      url: `https://${ossHostOf(config)}`,
      fields: {
        key,
        policy,
        OSSAccessKeyId: accessKeyId,
        signature,
        ...(securityToken ? { 'x-oss-security-token': securityToken } : {}),
      },
      key,
      publicUrl: ossPublicUrl(key, config),
      expiresAt: expiration,
    };
  }

  /**
   * 删除单个对象。key 必须是 `upload()` 返回的完整对象键（已含目录前缀）。
   * 幂等：对象本来就不存在（404）视为删除成功。
   */
  async remove(key: string): Promise<void> {
    const fullKey = String(key || '').replace(/^\/+/, '');
    if (!fullKey) return;
    const config = this.settings
      ? await this.settings.resolve()
      : this.environment();
    const headers = this.signedHeaders(config, 'DELETE', fullKey);
    try {
      const response = await httpRequest<string>(
        ossPublicUrl(fullKey, config),
        {
          method: 'DELETE',
          headers,
          timeoutMs: 20000,
          readAs: 'text',
          operation: 'oss:delete',
          redirect: 'error',
        },
      );
      if (!response.ok && response.status !== 404) {
        const code =
          /<Code>([A-Za-z0-9]+)<\/Code>/.exec(response.data)?.[1] || 'Unknown';
        const requestId = response.headers.get('x-oss-request-id') || '';
        this.logger.warn(
          `OSS 删除失败: status=${response.status} code=${code} requestId=${requestId}`,
        );
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          `文件存储暂时不可用，请联系管理员（OSS ${response.status} / ${code}）`,
        );
      }
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      this.logger.warn(
        `OSS 删除失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '文件存储暂时不可用，请稍后重试',
      );
    }
  }

  /** 对象元信息（HEAD）：不存在返回 exists=false，其它错误照常抛 503。 */
  async stat(key: string): Promise<OssObjectStat> {
    const fullKey = String(key || '').replace(/^\/+/, '');
    if (!fullKey) return { exists: false, size: 0, contentType: '' };
    const config = this.settings
      ? await this.settings.resolve()
      : this.environment();
    const headers = this.signedHeaders(config, 'HEAD', fullKey);
    try {
      const response = await httpRequest<string>(
        ossPublicUrl(fullKey, config),
        {
          method: 'HEAD',
          headers,
          timeoutMs: 20000,
          readAs: 'empty',
          operation: 'oss:stat',
          redirect: 'error',
        },
      );
      if (response.status === 404) {
        return { exists: false, size: 0, contentType: '' };
      }
      if (!response.ok) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          `文件存储暂时不可用，请联系管理员（OSS ${response.status}）`,
        );
      }
      return {
        exists: true,
        size: Number(response.headers.get('content-length') || 0) || 0,
        contentType: response.headers.get('content-type') || '',
      };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      this.logger.warn(
        `OSS 元信息读取失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '文件存储暂时不可用，请稍后重试',
      );
    }
  }

  /** 读取对象字节（GET）：供文档抽取/回读，签名规则与 PUT/DELETE/HEAD 一致。 */
  async read(key: string, maxBytes = 40 * 1024 * 1024): Promise<Buffer> {
    const fullKey = String(key || '').replace(/^\/+/, '');
    if (!fullKey)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '对象键为空');
    const config = this.settings
      ? await this.settings.resolve()
      : this.environment();
    const headers = this.signedHeaders(config, 'GET', fullKey);
    try {
      const response = await httpRequest<Uint8Array>(
        ossPublicUrl(fullKey, config),
        {
          method: 'GET',
          headers,
          timeoutMs: 30000,
          maxBytes,
          readAs: 'bytes',
          operation: 'oss:read',
          redirect: 'error',
        },
      );
      if (!response.ok) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          `文件存储暂时不可用，请联系管理员（OSS ${response.status}）`,
        );
      }
      return Buffer.from(response.data);
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      this.logger.warn(
        `OSS 读取失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '文件存储暂时不可用，请稍后重试',
      );
    }
  }

  /** 测试连接：用当前生效配置上传固定探针对象，返回公开访问 URL。 */
  async testConnection() {
    const config = this.settings
      ? await this.settings.resolve()
      : this.environment();
    const result = await this.put(config, PROBE_PATH, PROBE_CONTENT);
    return {
      ...result,
      bucket: config.bucket,
      endpoint: config.endpoint,
    };
  }

  /** OSS V4 签名头：PUT/DELETE/HEAD/GET 共用同一套 CanonicalRequest 规则。 */
  private signedHeaders(
    config: OssRuntimeConfig,
    method: 'PUT' | 'DELETE' | 'HEAD' | 'GET',
    key: string,
    extra: Record<string, string> = {},
  ) {
    const { accessKeyId, accessKeySecret, securityToken } =
      this.credentials(config);
    const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const scope = `${date.slice(0, 8)}/${config.region}/oss/aliyun_v4_request`;
    const headers: Record<string, string> = {
      'x-oss-content-sha256': 'UNSIGNED-PAYLOAD',
      'x-oss-date': date,
      ...(securityToken ? { 'x-oss-security-token': securityToken } : {}),
      ...extra,
    };
    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map((name) => `${name}:${headers[name]}\n`)
      .join('');
    const canonicalRequest = [
      method,
      ossEncodePath(`/${config.bucket}/${key}`),
      '',
      canonicalHeaders,
      '',
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = [
      'OSS4-HMAC-SHA256',
      date,
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');
    let signingKey: Buffer = Buffer.from(`aliyun_v4${accessKeySecret}`);
    for (const value of [
      date.slice(0, 8),
      config.region,
      'oss',
      'aliyun_v4_request',
    ]) {
      signingKey = createHmac('sha256', signingKey).update(value).digest();
    }
    const signature = createHmac('sha256', signingKey)
      .update(stringToSign)
      .digest('hex');
    headers.authorization = `OSS4-HMAC-SHA256 Credential=${accessKeyId}/${scope},Signature=${signature}`;
    return headers;
  }

  private async put(
    config: OssRuntimeConfig,
    path: string,
    content: Buffer,
  ): Promise<OssUploadResult> {
    const contentType = objectContentType(path);
    const key = ossObjectKey(path, config);
    const headers = this.signedHeaders(config, 'PUT', key, {
      'content-type': contentType,
    });
    headers['content-length'] = String(content.length);
    let response: TransportResult<string>;
    try {
      response = await httpRequest<string>(ossPublicUrl(key, config), {
        method: 'PUT',
        headers,
        body: new Uint8Array(content),
        timeoutMs: 20000,
        readAs: 'text',
        operation: 'oss:upload',
        redirect: 'error',
      });
      if (!response.ok) {
        const body = response.data;
        // 不记录原始 XML：签名错误响应可能包含 AccessKeyId 和待签名内容。
        const code =
          /<Code>([A-Za-z0-9]+)<\/Code>/.exec(body)?.[1] || 'Unknown';
        const requestId = response.headers.get('x-oss-request-id') || '';
        this.logger.warn(
          `OSS 上传失败: status=${response.status} code=${code} requestId=${requestId}`,
        );
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          `文件存储暂时不可用，请联系管理员（OSS ${response.status} / ${code}）`,
        );
      }
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      this.logger.warn(
        `OSS 上传失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '文件存储暂时不可用，请稍后重试',
      );
    }
    return {
      key,
      url: ossPublicUrl(key, config),
      size: content.length,
      contentType,
    };
  }
}
