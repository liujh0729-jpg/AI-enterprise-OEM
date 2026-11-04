import { httpRequest, type TransportResult } from '../http/transport';
import { Logger } from '../common/logger';
import { createHash, createHmac } from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { attachmentContentType } from './attachment-files';
import {
  OSS_CONFIG,
  ossEncodePath,
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

  private async put(
    config: OssRuntimeConfig,
    path: string,
    content: Buffer,
  ): Promise<OssUploadResult> {
    const contentType = attachmentContentType(path);
    const { accessKeyId, accessKeySecret, securityToken } =
      this.credentials(config);
    const key = ossObjectKey(path, config);
    const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const scope = `${date.slice(0, 8)}/${config.region}/oss/aliyun_v4_request`;
    const headers: Record<string, string> = {
      'content-type': contentType,
      'x-oss-content-sha256': 'UNSIGNED-PAYLOAD',
      'x-oss-date': date,
      ...(securityToken ? { 'x-oss-security-token': securityToken } : {}),
    };
    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map((name) => `${name}:${headers[name]}\n`)
      .join('');
    const canonicalRequest = [
      'PUT',
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
