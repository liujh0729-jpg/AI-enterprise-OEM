import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { OSS_CONFIG, OssConfig, ossDirOf } from './oss.config';

/** 专用加密配置键：禁止通过通用系统参数接口读取或覆盖。 */
export const OSS_SETTINGS_KEY = 'oss_credentials';

export type OssRuntimeConfig = OssConfig & {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken: string;
};

export type OssSettingsView = OssConfig & {
  configured: boolean;
  source: 'db' | 'env' | 'none';
  updatedAt: string | null;
  /** 只回显掩码，Secret 与密文不出后端。 */
  accessKeyIdMasked: string;
};

const LIMITS = {
  bucket: 63,
  endpoint: 128,
  region: 32,
  dir: 200,
  accessKeyId: 256,
  accessKeySecret: 512,
  securityToken: 4096,
};

const BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const ENDPOINT_RE = /^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,}$/i;
const REGION_RE = /^[a-z]{2}(?:-[a-z0-9]+)+$/;
const DIR_RE = /^[A-Za-z0-9._/-]*$/;

const maskKey = (value: string) => {
  if (!value) return '';
  if (value.length <= 8) return `${value.slice(0, 2)}****`;
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
};

/**
 * OSS 配置：管理后台保存的文件存储参数（桶 / Endpoint / Region / 目录 / 凭据）。
 * - 凭据加密入库（aes-256-gcm，密钥由 EXTERNAL_CRED_KEY 派生），接口只回显掩码；
 * - 未保存过时回退部署环境变量（OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_SECURITY_TOKEN）；
 * - `current()` 是同步缓存（URL 生成用），启动时 `load()`、保存后立即刷新。
 */
export class OssSettingsService {
  private readonly key: Buffer;
  private cache: OssRuntimeConfig;

  constructor(private readonly prisma: PrismaService) {
    const source = String(process.env.EXTERNAL_CRED_KEY || '').trim();
    if (!source)
      throw new Error('EXTERNAL_CRED_KEY 未配置，无法加密 OSS 凭据');
    this.key = createHash('sha256')
      .update(`aiworkin-oss-credentials|${source}`)
      .digest();
    this.cache = this.environment();
  }

  /** 部署环境变量 + 默认桶：后台未保存时的运行配置。 */
  private environment(): OssRuntimeConfig {
    return {
      ...OSS_CONFIG,
      accessKeyId: String(process.env.OSS_ACCESS_KEY_ID || '').trim(),
      accessKeySecret: String(process.env.OSS_ACCESS_KEY_SECRET || '').trim(),
      securityToken: String(process.env.OSS_SECURITY_TOKEN || '').trim(),
    };
  }

  private row() {
    return this.prisma.systemSetting.findUnique({
      where: { key: OSS_SETTINGS_KEY },
    });
  }

  /** 启动时加载一次：解密失败按部署默认值运行，不阻塞启动（保存后可恢复）。 */
  async load() {
    try {
      await this.resolve();
    } catch {
      this.cache = this.environment();
    }
    return this.cache;
  }

  /** 同步读取当前生效配置（活码图片等 URL 生成是同步调用）。 */
  current(): OssRuntimeConfig {
    return this.cache;
  }

  /** 每次调用读取最新配置：后台保存后无需重启。 */
  async resolve(): Promise<OssRuntimeConfig> {
    const row = await this.row();
    if (!row?.value) {
      this.cache = this.environment();
      return this.cache;
    }
    let data: Record<string, unknown>;
    try {
      const parts = row.value.split(':');
      if (parts.length !== 3) throw new Error('invalid ciphertext');
      const [iv, tag, encrypted] = parts.map((part) =>
        Buffer.from(part, 'base64'),
      );
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString('utf8');
      data = JSON.parse(plain) as Record<string, unknown>;
    } catch {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'OSS 凭据无法读取，请在「平台管理后台 → 系统配置」重新保存 OSS 配置',
      );
    }
    this.cache = {
      bucket: this.text(data.bucket, 'Bucket', LIMITS.bucket) || OSS_CONFIG.bucket,
      endpoint:
        this.text(data.endpoint, 'Endpoint', LIMITS.endpoint) ||
        OSS_CONFIG.endpoint,
      region:
        this.text(data.region, 'Region', LIMITS.region) || OSS_CONFIG.region,
      dir: ossDirOf({
        ...OSS_CONFIG,
        dir: this.text(data.dir, '目录', LIMITS.dir),
      }),
      accessKeyId: this.text(
        data.accessKeyId,
        'AccessKey ID',
        LIMITS.accessKeyId,
      ),
      accessKeySecret: this.text(
        data.accessKeySecret,
        'AccessKey Secret',
        LIMITS.accessKeySecret,
      ),
      securityToken: this.text(
        data.securityToken,
        'STS Token',
        LIMITS.securityToken,
      ),
    };
    return this.cache;
  }

  async status(): Promise<OssSettingsView> {
    const row = await this.row();
    if (!row?.value) {
      const env = this.environment();
      const configured = Boolean(env.accessKeyId && env.accessKeySecret);
      return {
        ...this.base(env),
        configured,
        source: configured ? 'env' : 'none',
        updatedAt: null,
        accessKeyIdMasked: maskKey(env.accessKeyId),
      };
    }
    const config = await this.resolve();
    return {
      ...this.base(config),
      configured: Boolean(config.accessKeyId && config.accessKeySecret),
      source: 'db',
      updatedAt: row.updatedAt.toISOString(),
      accessKeyIdMasked: maskKey(config.accessKeyId),
    };
  }

  /**
   * 保存配置：Secret 留空表示沿用已保存值（更换时整对重填更安全，但仍允许只改桶）。
   * 保存成功后同步刷新缓存，URL 生成与上传立即生效。
   */
  async save(body: Record<string, unknown>) {
    const existing = await this.resolve();
    const bucket =
      this.text(body.bucket, 'Bucket', LIMITS.bucket) || existing.bucket;
    const endpoint =
      this.text(body.endpoint, 'Endpoint', LIMITS.endpoint) || existing.endpoint;
    const region =
      this.text(body.region, 'Region', LIMITS.region) || existing.region;
    const dir =
      body.dir === undefined
        ? ossDirOf(existing)
        : ossDirOf({
            ...OSS_CONFIG,
            dir: this.text(body.dir, '目录', LIMITS.dir),
          });
    const accessKeyId =
      this.text(body.accessKeyId, 'AccessKey ID', LIMITS.accessKeyId) ||
      existing.accessKeyId;
    const accessKeySecret =
      this.text(body.accessKeySecret, 'AccessKey Secret', LIMITS.accessKeySecret) ||
      existing.accessKeySecret;
    const securityToken =
      this.text(body.securityToken, 'STS Token', LIMITS.securityToken) ||
      existing.securityToken;

    if (!BUCKET_RE.test(bucket))
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'Bucket 需为 3-63 位小写字母、数字或中划线，且不能以中划线开头/结尾',
      );
    if (!ENDPOINT_RE.test(endpoint))
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'Endpoint 需填写域名（如 oss-cn-beijing.aliyuncs.com），不要带协议或路径',
      );
    if (!REGION_RE.test(region))
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'Region 格式不正确（如 cn-beijing）',
      );
    if (!DIR_RE.test(dir.replace(/\/$/, '')) || dir.includes('..'))
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '目录只能包含字母、数字、点、下划线、中划线与斜杠',
      );
    if (!accessKeyId || !accessKeySecret)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写 AccessKey ID 与 AccessKey Secret',
      );

    const payload: OssRuntimeConfig = {
      bucket,
      endpoint,
      region,
      dir,
      accessKeyId,
      accessKeySecret,
      securityToken,
    };
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);
    const value = [iv, cipher.getAuthTag(), encrypted]
      .map((part) => part.toString('base64'))
      .join(':');
    const row = await this.prisma.systemSetting.upsert({
      where: { key: OSS_SETTINGS_KEY },
      create: { key: OSS_SETTINGS_KEY, value },
      update: { value },
    });
    this.cache = payload;
    return {
      ...this.base(payload),
      configured: true,
      source: 'db' as const,
      updatedAt: row.updatedAt.toISOString(),
      accessKeyIdMasked: maskKey(payload.accessKeyId),
    };
  }

  private base(config: OssConfig): OssConfig {
    return {
      bucket: config.bucket,
      endpoint: config.endpoint,
      region: config.region,
      dir: config.dir,
    };
  }

  private text(value: unknown, label: string, max: number) {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string')
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `请填写有效的 ${label}`,
      );
    const text = value.trim();
    if (text.length > max)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `${label} 最多 ${max} 个字符`,
      );
    return text;
  }
}