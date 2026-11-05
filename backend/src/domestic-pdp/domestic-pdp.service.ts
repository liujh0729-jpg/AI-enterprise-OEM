import { pageOf, pageParam, text as readText } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  DomesticPdpAsset,
  DomesticPdpPack,
  Prisma,
} from '../../generated/prisma';
import { ContentMediaService } from '../content/content-media.service';
import { ContentModelSettingService } from '../content/model-setting.service';
import {
  buildPlanPrompt,
  composeImagePrompt,
  parsePlan,
  type CnBrief,
  type CnPlan,
} from './domestic-pdp.prompt';

/**
 * 国内电商商品页优化（PDP）：简报 → 规划（文本槽位）→ 逐张确认提示词 → 出图（图片槽位）。
 * 文本与图片全部经本系统模型网关（ContentModelSettingService / ContentMediaService），
 * 不直连任何外部图片 API；参考图存在时走出图的 /images/edits 通道锁定产品身份。
 */

type AssetRow = Pick<
  DomesticPdpAsset,
  | 'id'
  | 'kind'
  | 'position'
  | 'title'
  | 'purpose'
  | 'sceneKey'
  | 'copy'
  | 'prompt'
  | 'size'
  | 'status'
  | 'url'
  | 'assetId'
  | 'error'
>;

const MAX_HERO = 10;
const MAX_DETAIL = 20;
const DEFAULT_PLATFORM = '淘宝/天猫';
const DEFAULT_TONE = 'brand';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function countOf(value: unknown, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(Math.floor(number), max));
}

function clean(value: unknown, max: number): string {
  return readText(value).trim().slice(0, max);
}

function messageOf(error: unknown): string {
  if (error instanceof BusinessException) return error.message.slice(0, 500);
  if (error instanceof Error && error.message)
    return error.message.slice(0, 500);
  return '操作失败，请稍后重试';
}

export class DomesticPdpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ContentModelSettingService,
    private readonly media: ContentMediaService,
  ) {}

  // ---------- 就绪状态 ----------

  async meta(user: CurrentUser, token?: string) {
    const settings = await this.settings.settings(user, token);
    const channelName = (channelId: number) =>
      settings.channels.find((channel) => channel.id === channelId)?.name || '';
    const labelOf = (mediaType: 'text' | 'image') => {
      const slot = settings.slots.find((item) => item.mediaType === mediaType);
      if (!slot?.model) return '';
      const name = channelName(slot.channelId) || '未知渠道';
      return `${name} · ${slot.model}`;
    };
    const textLabel = labelOf('text');
    const imageLabel = labelOf('image');
    const missing: string[] = [];
    if (!textLabel) missing.push('文本');
    if (!imageLabel) missing.push('图片');
    return {
      textReady: Boolean(textLabel),
      imageReady: Boolean(imageLabel),
      textLabel,
      imageLabel,
      hint: missing.length
        ? `请先到「内容创作 → 模型设置」为「${missing.join('」「')}」选择默认模型；没有自定义渠道时，用本账号绑定的 AIPDD API Key 走内置渠道。`
        : '规划与出图都已就绪：先生成规划，再逐张确认中文文案与提示词并出图。',
    };
  }

  // ---------- 图包台账 ----------

  async list(user: CurrentUser, query: { page?: number; pageSize?: number }) {
    const { page, pageSize, offset } = pageParam(
      query.page,
      query.pageSize,
      20,
    );
    const where = { userId: user.userId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.domesticPdpPack.count({ where }),
      this.prisma.domesticPdpPack.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: offset,
        take: pageSize,
        include: { assets: { select: { kind: true, status: true } } },
      }),
    ]);
    return pageOf(
      rows.map((row) => this.summaryOf(row)),
      total,
      page,
      pageSize,
    );
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    const brief = this.briefOf(body);
    const row = await this.prisma.domesticPdpPack.create({
      data: {
        userId: user.userId,
        productName: brief.productName,
        category: brief.category,
        platform: brief.platform,
        tone: brief.tone,
        status: 'draft',
        input: brief,
        plan: {},
      },
    });
    return this.detail(user, row.id);
  }

  async detail(user: CurrentUser, id: number) {
    const row = await this.mustGet(user, id);
    const assets = await this.prisma.domesticPdpAsset.findMany({
      where: { packId: row.id },
    });
    return this.detailOf(row, assets);
  }

  async remove(user: CurrentUser, id: number) {
    const row = await this.mustGet(user, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.domesticPdpAsset.deleteMany({ where: { packId: row.id } });
      await tx.domesticPdpPack.delete({ where: { id: row.id } });
    });
    return { id: row.id, deleted: true };
  }

  // ---------- 规划 ----------

  /**
   * 一次文本模型调用产出：转化驱动、购买理由卡、风格锁、全部主图/详情页的中文文案与场景正文。
   * 重新规划会重建资产清单（已出的图随之失效），界面需二次确认。
   */
  async plan(user: CurrentUser, token: string | undefined, id: number) {
    const row = await this.mustGet(user, id);
    const brief = this.briefOf(record(row.input));
    await this.prisma.domesticPdpPack.update({
      where: { id: row.id },
      data: { status: 'planning', error: '' },
    });
    try {
      const prompt = buildPlanPrompt(brief);
      const raw = await this.media.generateText(user, token, prompt);
      const { plan, assets } = parsePlan(raw, brief);
      await this.prisma.$transaction(async (tx) => {
        await tx.domesticPdpAsset.deleteMany({ where: { packId: row.id } });
        if (assets.length) {
          await tx.domesticPdpAsset.createMany({
            data: assets.map((asset) => ({
              packId: row.id,
              kind: asset.kind,
              position: asset.position,
              sceneKey: asset.sceneKey,
              title: asset.title,
              purpose: asset.purpose,
              copy: asset.copy,
              prompt: composeImagePrompt(plan, asset, brief),
              size: asset.size,
              status: 'pending',
            })),
          });
        }
        await tx.domesticPdpPack.update({
          where: { id: row.id },
          data: {
            plan: plan,
            status: 'planned',
            error: '',
          },
        });
      });
    } catch (error) {
      await this.prisma.domesticPdpPack.update({
        where: { id: row.id },
        data: { status: 'failed', error: messageOf(error) },
      });
      throw error;
    }
    return this.detail(user, row.id);
  }

  // ---------- 提示词与出图 ----------

  async updateAsset(
    user: CurrentUser,
    id: number,
    assetId: number,
    body: Record<string, unknown>,
  ) {
    const row = await this.mustGet(user, id);
    const asset = await this.mustAsset(row.id, assetId);
    const data: Prisma.DomesticPdpAssetUpdateInput = {};
    if (body.title !== undefined) data.title = clean(body.title, 191);
    if (body.purpose !== undefined) data.purpose = clean(body.purpose, 191);
    if (body.copy !== undefined) data.copy = clean(body.copy, 4000);
    if (body.prompt !== undefined) data.prompt = clean(body.prompt, 8000);
    if (body.size !== undefined) data.size = clean(body.size, 16);
    if (Object.keys(data).length) {
      await this.prisma.domesticPdpAsset.update({
        where: { id: asset.id },
        data,
      });
    }
    return this.detail(user, row.id);
  }

  /**
   * 单张出图：先用「改词即生成」的口径落库最新提示词，再按参考图选择网关通道。
   * 单张失败不回滚整个图包：错误写回该资产的 error，界面可原地重试。
   */
  async generate(
    user: CurrentUser,
    token: string | undefined,
    id: number,
    assetId: number,
    body: Record<string, unknown>,
  ) {
    const row = await this.mustGet(user, id);
    const asset = await this.mustAsset(row.id, assetId);
    const brief = this.briefOf(record(row.input));
    const prompt = clean(body.prompt, 8000) || asset.prompt;
    const size = clean(body.size, 16) || asset.size;
    if (!prompt) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '这张图还没有提示词，请先补充提示词再生成',
      );
    }
    await this.prisma.domesticPdpAsset.update({
      where: { id: asset.id },
      data: { prompt, size, status: 'generating', error: '' },
    });
    try {
      const result = brief.referenceUrls.length
        ? await this.media.editImage(user, token, {
            imageUrls: brief.referenceUrls,
            prompt,
            size: size || undefined,
            namePrefix: asset.title || '商品页图',
          })
        : await this.media.generateImage(user, token, {
            prompt,
            size: size || undefined,
          });
      await this.prisma.domesticPdpAsset.update({
        where: { id: asset.id },
        data: {
          status: 'done',
          url: result.url,
          assetId: result.assetId,
          error: result.assetNote
            ? `图已生成，数字资产登记未完成：${result.assetNote}`
            : '',
        },
      });
    } catch (error) {
      await this.prisma.domesticPdpAsset.update({
        where: { id: asset.id },
        data: { status: 'failed', error: messageOf(error) },
      });
    }
    await this.refreshStatus(row.id);
    return this.detail(user, row.id);
  }

  // ---------- 内部 ----------

  private briefOf(body: Record<string, unknown>): CnBrief {
    const productName = clean(body.productName, 120);
    if (!productName) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写商品名称');
    }
    const heroCount = countOf(body.heroCount, MAX_HERO);
    const detailCount = countOf(body.detailCount, MAX_DETAIL);
    if (heroCount + detailCount === 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '主图与详情页数量不能同时为 0，请至少设置一张',
      );
    }
    const references = Array.isArray(body.referenceUrls)
      ? body.referenceUrls
      : [];
    return {
      productName,
      category: clean(body.category, 64),
      platform: clean(body.platform, 32) || DEFAULT_PLATFORM,
      tone: clean(body.tone, 16) || DEFAULT_TONE,
      audience: clean(body.audience, 200),
      price: clean(body.price, 64),
      sellingPoints: clean(body.sellingPoints, 2000),
      specs: clean(body.specs, 2000),
      evidence: clean(body.evidence, 2000),
      promo: clean(body.promo, 500),
      difference: clean(body.difference, 1000),
      styleName: clean(body.styleName, 120),
      colorPalette: clean(body.colorPalette, 200),
      compliance: body.compliance !== false,
      heroCount,
      detailCount,
      referenceUrls: references
        .map((item) => clean(item, 1000))
        .filter((item) => /^https?:\/\//i.test(item))
        .slice(0, 6),
      shotPlan: clean(body.shotPlan, 4000),
    };
  }

  private async mustGet(
    user: CurrentUser,
    id: number,
  ): Promise<DomesticPdpPack> {
    const row = await this.prisma.domesticPdpPack.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '图包不存在或已删除');
    }
    return row;
  }

  private async mustAsset(packId: number, assetId: number) {
    const asset = await this.prisma.domesticPdpAsset.findFirst({
      where: { id: assetId, packId },
    });
    if (!asset) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '这张图不存在或已随重新规划被替换',
      );
    }
    return asset;
  }

  private summaryOf(
    row: DomesticPdpPack & { assets: { kind: string; status: string }[] },
  ) {
    const brief = record(row.input);
    const hero = row.assets.filter((item) => item.kind === 'hero').length;
    const detail = row.assets.filter((item) => item.kind === 'detail').length;
    return {
      id: row.id,
      productName: row.productName,
      category: row.category,
      platform: row.platform || clean(brief.platform, 32),
      tone: row.tone || DEFAULT_TONE,
      status: row.status,
      heroCount: hero || countOf(brief.heroCount, MAX_HERO),
      detailCount: detail || countOf(brief.detailCount, MAX_DETAIL),
      doneCount: row.assets.filter((item) => item.status === 'done').length,
      totalCount: row.assets.length,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private detailOf(row: DomesticPdpPack, assets: AssetRow[]) {
    const list = [...assets].sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'hero' ? -1 : 1;
      return left.position - right.position;
    });
    const plan = record(row.plan);
    return {
      ...this.summaryOf({ ...row, assets: list }),
      input: record(row.input),
      plan: Object.keys(plan).length ? (plan as CnPlan) : null,
      assets: list.map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        position: asset.position,
        title: asset.title,
        purpose: asset.purpose,
        sceneKey: asset.sceneKey,
        copy: asset.copy,
        prompt: asset.prompt,
        size: asset.size,
        status: asset.status,
        url: asset.url,
        assetId: asset.assetId,
        error: asset.error,
      })),
    };
  }

  /** 图包汇总状态：全部出图→completed；正在出图→generating；部分完成→partial。 */
  private async refreshStatus(packId: number) {
    const assets = await this.prisma.domesticPdpAsset.findMany({
      where: { packId },
      select: { status: true },
    });
    const done = assets.filter((item) => item.status === 'done').length;
    const running = assets.some((item) => item.status === 'generating');
    const status =
      assets.length > 0 && done === assets.length
        ? 'completed'
        : running
          ? 'generating'
          : done > 0
            ? 'partial'
            : 'planned';
    await this.prisma.domesticPdpPack.update({
      where: { id: packId },
      data: { status },
    });
  }
}
