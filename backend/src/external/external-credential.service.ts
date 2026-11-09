import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { toJsonInput } from '../common/json-input';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
export const CRED_TYPES = ['CA', 'SERVICE_ACCOUNT', 'IC_CARD'] as const;
/**
 * 企业维度外报凭据：只落 AES-256-GCM 密文（iv:tag:payload，统一 base64），
 * 明文仅在写入的入参中出现，绝不落库/落日志/回传前端。
 */
export class ExternalCredentialService {
  private readonly key: Buffer;
  constructor(private readonly prisma: PrismaService) {
    // 凭据加密密钥必须单独配置：不回退 JWT_SECRET（轮换验签密钥会把已存凭据一起弄废）
    const source = String(process.env.EXTERNAL_CRED_KEY || '').trim();
    if (!source) {
      throw new Error(
        'EXTERNAL_CRED_KEY 未配置：外报凭据加密需要独立的 AES-256-GCM 密钥来源（见 backend/.env.example）',
      );
    }
    this.key = createHash('sha256')
      .update(`aiworkin-external-cred|${source}`)
      .digest();
  }
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, body].map((part) => part.toString('base64')).join(':');
  }
  decrypt(sealed: string): string {
    const [ivB64, tagB64, bodyB64] = sealed.split(':');
    if (!ivB64 || !tagB64 || !bodyB64) {
      throw new BusinessException(ErrorCode.INTERNAL_ERROR, '凭据密文格式非法');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(bodyB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
  /** 列表/详情一律脱敏：只回「是否已配置 + 到期时间 + 备注」，不回密文也不回明文。 */
  async list(enterpriseId: number) {
    const rows = await this.prisma.externalCredential.findMany({
      where: { enterpriseId },
      orderBy: { id: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      enterpriseId: row.enterpriseId,
      channelCode: row.channelCode,
      credType: row.credType,
      label: row.label,
      extra: row.extra,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      configured: true,
    }));
  }
  async upsert(input: {
    enterpriseId: number;
    channelCode: string;
    credType: string;
    label?: string;
    secret: string;
    extra?: Record<string, unknown>;
    expiresAt?: string | null;
  }) {
    const credType = String(input.credType || '').toUpperCase();
    if (!(CRED_TYPES as readonly string[]).includes(credType)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `凭据类型仅支持 ${CRED_TYPES.join(' / ')}`,
      );
    }
    if (!input.secret) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '凭据内容不能为空');
    }
    const label = input.label || credType;
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '到期时间格式非法');
    }
    const data = {
      secretCipher: this.encrypt(input.secret),
      extra: toJsonInput(input.extra || {}),
      expiresAt,
    };
    const row = await this.prisma.externalCredential.upsert({
      where: {
        enterpriseId_channelCode_credType_label: {
          enterpriseId: input.enterpriseId,
          channelCode: input.channelCode,
          credType,
          label,
        },
      },
      update: data,
      create: {
        enterpriseId: input.enterpriseId,
        channelCode: input.channelCode,
        credType,
        label,
        ...data,
      },
    });
    return { id: row.id, credType: row.credType, label: row.label };
  }
  async remove(enterpriseId: number, id: number) {
    const row = await this.prisma.externalCredential.findUnique({
      where: { id },
    });
    if (!row || row.enterpriseId !== enterpriseId) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '凭据不存在');
    }
    await this.prisma.externalCredential.delete({ where: { id } });
    return { id, removed: true };
  }
}
