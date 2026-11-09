import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { RpaCrypto } from './rpa-crypto';
import {
  BITPHONE_COMPUTE_TYPES,
  BITPHONE_REGIONS,
  normalizeChoice,
} from './rpa-shared';

const DEFAULT_API_ENDPOINT = 'http://127.0.0.1:54345';

/** 一次保存里「被提交到的键」，未出现的键保持库中原值。 */
type SettingDraft = {
  bitbrowserApiEndpoint?: string;
  bitbrowserApiKeyCipher?: string;
  bitbrowserGroupId?: string;
  bitphoneRegionId?: string;
  bitphoneComputeType?: string;
};

/**
 * RPA 设置：每个租户的比特浏览器实例配置（API 端点、密钥、默认分组、云手机地域与算力）。
 * 一个用户只有一条设置记录（createdBy 唯一），界面读不到时按默认值兜底。
 */
export class RpaSettingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly crypto: RpaCrypto,
  ) {}

  async get(user: CurrentUser) {
    const row = await this.prisma.rpaSetting.findUnique({
      where: { createdBy: user.userId },
    });
    return row ? decorate(row) : defaultSetting(user.userId);
  }

  /**
   * 保存设置：只写请求体里出现的键（与全站「设置」同一口径——没提交的字段保持原值，
   * 免得外部通道/MCP 只改一项时把其余配置静默清空）；一个键都没带就报「没有需要保存的设置」。
   */
  async upsert(user: CurrentUser, body: Record<string, unknown>) {
    const existing = await this.prisma.rpaSetting.findUnique({
      where: { createdBy: user.userId },
    });
    const data: SettingDraft = {};

    if (body.bitbrowserApiEndpoint !== undefined) {
      const endpoint = text(body.bitbrowserApiEndpoint).trim().slice(0, 500);
      data.bitbrowserApiEndpoint = endpoint || DEFAULT_API_ENDPOINT;
    }
    // 密钥留空＝不动已存密文（界面上不回显旧密钥，只回「是否已保存」）
    const apiKey = text(body.bitbrowserApiKey);
    if (apiKey) data.bitbrowserApiKeyCipher = this.crypto.encrypt(apiKey);
    if (body.bitbrowserGroupId !== undefined) {
      data.bitbrowserGroupId = text(body.bitbrowserGroupId)
        .trim()
        .slice(0, 128);
    }
    if (body.bitphoneRegionId !== undefined) {
      data.bitphoneRegionId = normalizeChoice(
        body.bitphoneRegionId,
        BITPHONE_REGIONS,
        '云手机地域',
        '',
      );
    }
    if (body.bitphoneComputeType !== undefined) {
      data.bitphoneComputeType = normalizeChoice(
        body.bitphoneComputeType,
        BITPHONE_COMPUTE_TYPES,
        '云手机算力',
        '',
      );
    }

    const changed = Object.keys(data).length;
    if (!changed) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有需要保存的设置');
    }

    const row = existing
      ? await this.prisma.rpaSetting.update({
          where: { createdBy: user.userId },
          data,
        })
      : await this.prisma.rpaSetting.create({
          data: {
            createdBy: user.userId,
            bitbrowserApiEndpoint:
              data.bitbrowserApiEndpoint ?? DEFAULT_API_ENDPOINT,
            bitbrowserApiKeyCipher: data.bitbrowserApiKeyCipher ?? '',
            bitbrowserGroupId: data.bitbrowserGroupId ?? '',
            bitphoneRegionId: data.bitphoneRegionId ?? '',
            bitphoneComputeType: data.bitphoneComputeType ?? '',
          },
        });

    await this.identity.audit(
      user.userId,
      existing ? 'RPA修改设置' : 'RPA创建设置',
      `#${row.id} API=${row.bitbrowserApiEndpoint}`,
    );

    return decorate(row);
  }
}

function defaultSetting(userId: string) {
  return {
    id: 0,
    createdBy: userId,
    bitbrowserApiEndpoint: DEFAULT_API_ENDPOINT,
    bitbrowserGroupId: '',
    bitphoneRegionId: '',
    bitphoneComputeType: '',
    hasBitbrowserApiKey: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function decorate(row: {
  id: number;
  createdBy: string;
  bitbrowserApiEndpoint: string;
  bitbrowserApiKeyCipher: string;
  bitbrowserGroupId: string;
  bitphoneRegionId: string;
  bitphoneComputeType: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    createdBy: row.createdBy,
    bitbrowserApiEndpoint: row.bitbrowserApiEndpoint,
    bitbrowserGroupId: row.bitbrowserGroupId,
    bitphoneRegionId: row.bitphoneRegionId,
    bitphoneComputeType: row.bitphoneComputeType,
    hasBitbrowserApiKey: row.bitbrowserApiKeyCipher !== '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
