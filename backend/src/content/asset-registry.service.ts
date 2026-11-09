import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { Logger } from '../common/logger';
import { ModelKeyService } from '../aiworkin/model-key.service';
import { PrismaService } from '../prisma/prisma.service';
import { AipddAssetClient } from './aipdd-asset.client';
import { ContentCrypto } from './content-crypto';
import { aipddBaseUrl } from './content-shared';

const logger = new Logger('ContentAssetRegistry');

type RegisterInput = {
  jobId?: number;
  url: string;
  name?: string;
  kind?: string;
};

/**
 * 生成结果 → AIPDD 数字资产（自动、无开关）。
 * 平台直链直接登记；第三方/本站直链先转存到平台 `oss/upload` 再登记，
 * 保证资产在 AIPDD 侧真实存在。登记失败不阻断出片：本地台账留 failed，界面可重试。
 */
export class ContentAssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modelKeys: ModelKeyService,
    private readonly crypto: ContentCrypto,
    private readonly client: AipddAssetClient,
  ) {}

  private async resolveKey(user: CurrentUser, token?: string) {
    // 与模型设置同口径：本账号单独配的 AIPDD Key 优先，其次「API Key 管理」里的 sk- Key
    const local = await this.prisma.contentModelChannel.findFirst({
      where: { userId: user.userId, provider: 'aipdd', enabled: true },
      orderBy: { id: 'asc' },
    });
    const localKey = local?.keyCipher
      ? this.crypto.decrypt(local.keyCipher)
      : '';
    const apiKey = localKey || this.modelKeys.requireKey(token);
    const baseUrl = aipddBaseUrl();
    return { apiKey, baseUrl, origin: AipddAssetClient.origin(baseUrl) };
  }

  private isPlatformUrl(url: string, origin: string) {
    try {
      return new URL(url).host === new URL(origin).host;
    } catch {
      return false;
    }
  }

  /** 登记一次；无论成败都落台账，返回可展示的结果。 */
  async tryRegister(
    user: CurrentUser,
    token: string | undefined,
    input: RegisterInput,
  ) {
    const url = String(input.url || '').trim();
    const kind = String(input.kind || 'image').trim();
    const name = String(input.name || '')
      .trim()
      .slice(0, 200);
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, assetId: '', url, message: '生成结果没有可用的直链' };
    }
    try {
      const { apiKey, baseUrl, origin } = await this.resolveKey(user, token);
      const storedUrl = this.isPlatformUrl(url, origin)
        ? url
        : (
            await this.client.upload({
              baseUrl,
              apiKey,
              bytes: await this.client.download(url),
              filename: name || url.split('/').pop() || 'asset.bin',
              prefix: `assets/enterprise/${user.userId}`,
            })
          ).url;
      const assetId = await this.client.register({
        baseUrl,
        apiKey,
        url: storedUrl,
        name: name || storedUrl.split('/').pop() || '',
        kind,
      });
      // 归属台账：这条平台资产是这个账号生成/转存的，数字资产管理页只列台账里的
      const numericId = Number(assetId);
      if (Number.isInteger(numericId) && numericId > 0) {
        await this.prisma.digitalAssetEntry
          .upsert({
            where: {
              userId_aipddAssetId: {
                userId: user.userId,
                aipddAssetId: numericId,
              },
            },
            create: {
              userId: user.userId,
              aipddAssetId: numericId,
              type: ['image', 'video', 'audio'].includes(kind) ? kind : 'file',
              name,
              url: storedUrl,
              previewUrl: storedUrl,
              labels: ['aiworkin-enterprise'],
            },
            update: { name, url: storedUrl },
          })
          .catch((error: unknown) => {
            logger.warn(`数字资产归属台账写入失败：${String(error)}`);
          });
      }
      const row = await this.prisma.contentAsset.create({
        data: {
          userId: user.userId,
          jobId: input.jobId || 0,
          kind,
          url: storedUrl,
          aipddAssetId: assetId,
          name,
          status: 'ok',
        },
      });
      return { ok: true, assetId, url: storedUrl, message: '', row };
    } catch (error) {
      // 登记失败只告警，不影响出片（全站「辅助链路降级放行」口径）
      const message =
        error instanceof BusinessException ? error.message : '数字资产登记失败';
      if (!(error instanceof BusinessException)) {
        logger.warn(`数字资产登记异常：${String(error)}`);
      }
      const row = await this.prisma.contentAsset.create({
        data: {
          userId: user.userId,
          jobId: input.jobId || 0,
          kind,
          url,
          aipddAssetId: '',
          name,
          status: 'failed',
        },
      });
      return { ok: false, assetId: '', url, message, row };
    }
  }

  async list(user: CurrentUser, query: Record<string, unknown>) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize || 20)));
    const [rows, total] = await Promise.all([
      this.prisma.contentAsset.findMany({
        where: { userId: user.userId },
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.contentAsset.count({ where: { userId: user.userId } }),
    ]);
    return {
      list: rows.map((row) => ({
        id: row.id,
        jobId: row.jobId,
        kind: row.kind,
        url: row.url,
        aipddAssetId: row.aipddAssetId,
        name: row.name,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  async retry(user: CurrentUser, token: string | undefined, id: string) {
    const assetId = Number(id);
    if (!Number.isInteger(assetId) || assetId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '资产编号无效');
    }
    const row = await this.prisma.contentAsset.findFirst({
      where: { id: assetId, userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '资产不存在');
    }
    const result = await this.tryRegister(user, token, {
      jobId: row.jobId,
      url: row.url,
      name: row.name,
      kind: row.kind,
    });
    if (result.message) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        result.message,
      );
    }
    return {
      id: result.row?.id || row.id,
      jobId: row.jobId,
      kind: row.kind,
      url: result.url,
      aipddAssetId: result.assetId,
      name: row.name,
      status: 'ok',
      createdAt: (result.row?.createdAt || row.createdAt).toISOString(),
    };
  }
}
