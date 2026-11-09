import {
  CONTENT_MEDIA_TYPE_LABELS,
  CONTENT_TOOLS,
  type ContentJob,
  type ContentTool,
} from '@enterprise/contracts';
import { text } from '../common/api';
import { toJsonInput } from '../common/json-input';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { Logger } from '../common/logger';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { ContentAssetService } from './asset-registry.service';
import {
  ContentMediaService,
  type ModelOverrides,
} from './content-media.service';
import { ContentModelSettingService } from './model-setting.service';
import { MediaKitClient } from './mediakit.client';

const logger = new Logger('ContentJob');

/** RUNNING 超过这个时长仍未收口，按「服务重启/中断」处理。 */
const STALE_RUNNING_MS = 30 * 60 * 1000;

type JobRow = {
  id: number;
  tool: string;
  status: string;
  input: unknown;
  models: unknown;
  output: unknown;
  assetUrl: string;
  aipddAssetId: string;
  error: string;
  createdAt: Date;
  updatedAt: Date;
};

function view(row: JobRow): ContentJob {
  return {
    id: row.id,
    tool: row.tool,
    status: row.status,
    input: (row.input || {}) as Record<string, unknown>,
    models: row.models || {},
    output: (row.output || {}) as Record<string, unknown>,
    assetUrl: row.assetUrl,
    aipddAssetId: row.aipddAssetId,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function validateInput(tool: ContentTool, body: Record<string, unknown>) {
  const input: Record<string, unknown> = {};
  for (const field of tool.fields) {
    const raw = body[field.key];
    if (field.type === 'media') {
      const list = Array.isArray(raw)
        ? raw.map((item) => text(item))
        : [text(raw)];
      const urls = list.map((item) => item.trim()).filter(Boolean);
      if (field.required && !urls.length) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `请先上传「${field.label}」`,
        );
      }
      if (!field.multiple && urls.length > 1) urls.length = 1;
      if (urls.some((url) => !/^https?:\/\//i.test(url))) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `「${field.label}」不是有效的文件地址，请重新上传`,
        );
      }
      input[field.key] = field.multiple ? urls : urls[0] || '';
      continue;
    }
    if (field.type === 'number') {
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        if (field.required) {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            `请填写「${field.label}」`,
          );
        }
        if (field.defaultValue !== undefined)
          input[field.key] = field.defaultValue;
        continue;
      }
      if (field.min !== undefined && value < field.min) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `「${field.label}」不能小于 ${field.min}`,
        );
      }
      if (field.max !== undefined && value > field.max) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `「${field.label}」不能大于 ${field.max}`,
        );
      }
      input[field.key] = value;
      continue;
    }
    const value = text(raw).trim();
    if (field.required && !value) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `请填写「${field.label}」`,
      );
    }
    input[field.key] = value || field.defaultValue || '';
  }
  return input;
}

/** 本轮用户选的模型：只收这个工具实际用到的槽位（先选渠道再选模型）。 */
function parseModels(raw: unknown, tool: ContentTool): ModelOverrides {
  const source =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const models: ModelOverrides = {};
  for (const slot of tool.slots) {
    const item = source[slot];
    if (item === undefined || item === null) continue;
    if (typeof item !== 'object') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '模型选择格式不对');
    }
    const row = item as Record<string, unknown>;
    const label = CONTENT_MEDIA_TYPE_LABELS[slot] || slot;
    const channelId = Number(row.channelId);
    const model = text(row.model).trim();
    if (!Number.isInteger(channelId) || channelId < 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `「${label}」的渠道无效，请重新选择`,
      );
    }
    if (!model) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `「${label}」还没有选模型，请先选渠道和模型`,
      );
    }
    models[slot] = { channelId, model };
  }
  return models;
}

/**
 * 内容创作的任务：卡片 → 建任务 → 后台执行（模型网关 / MediaKit）→ 产物登记 AIPDD 数字资产。
 * 图片/文本类同步完成也落一行任务，界面永远只读任务表。
 */
export class ContentJobService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ContentModelSettingService,
    private readonly media: ContentMediaService,
    private readonly assets: ContentAssetService,
  ) {}

  private toolOf(key: string) {
    const tool = CONTENT_TOOLS[key];
    if (!tool) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '这个功能不存在');
    }
    return tool;
  }

  /** MediaKit 只做视频增强，凭据取「模型设置 → 火山 AI MediaKit」渠道。 */
  private async mediakit(user: CurrentUser) {
    const credentials = await this.settings.mediakitCredentials(user);
    return new MediaKitClient(credentials.baseUrl, credentials.apiKey);
  }

  private async assertReady(
    user: CurrentUser,
    token: string | undefined,
    tool: ContentTool,
    models: ModelOverrides,
  ) {
    for (const slot of tool.slots) {
      await this.settings.resolveTarget(user, slot, token, models[slot]);
    }
    if (tool.mediaKit) await this.mediakit(user);
  }

  async create(
    user: CurrentUser,
    token: string | undefined,
    body: Record<string, unknown>,
  ) {
    const tool = this.toolOf(text(body.tool).trim());
    const input = validateInput(
      tool,
      (body.input || {}) as Record<string, unknown>,
    );
    const models = parseModels(body.models, tool);
    await this.assertReady(user, token, tool, models);
    const row = await this.prisma.contentGenerationJob.create({
      data: {
        userId: user.userId,
        tool: tool.key,
        status: 'PENDING',
        input: toJsonInput(input),
        models: toJsonInput(models),
      },
    });
    void this.run(row.id, user, token, tool, input, models).catch(
      (error: unknown) => {
        logger.warn(`任务启动异常 job=${row.id}: ${String(error)}`);
      },
    );
    return view(row);
  }

  private async run(
    id: number,
    user: CurrentUser,
    token: string | undefined,
    tool: ContentTool,
    input: Record<string, unknown>,
    models: ModelOverrides,
  ) {
    await this.prisma.contentGenerationJob.update({
      where: { id },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    try {
      const output = await this.execute(user, token, tool, input, models);
      const url = text(output.url);
      const assetId = text(output.assetId);
      await this.prisma.contentGenerationJob.update({
        where: { id },
        data: {
          status: 'SUCCESS',
          output: toJsonInput(output),
          assetUrl: url,
          aipddAssetId: assetId,
          finishedAt: new Date(),
        },
      });
    } catch (error) {
      const message =
        error instanceof BusinessException
          ? error.message
          : error instanceof Error
            ? error.message.slice(0, 450)
            : '生成失败，请稍后重试';
      await this.prisma.contentGenerationJob.update({
        where: { id },
        data: { status: 'FAILED', error: message, finishedAt: new Date() },
      });
    }
  }

  private async execute(
    user: CurrentUser,
    token: string | undefined,
    tool: ContentTool,
    input: Record<string, unknown>,
    models: ModelOverrides,
  ): Promise<Record<string, unknown>> {
    const str = (key: string) => text(input[key]).trim();
    const urls = (key: string) => {
      const value = input[key];
      if (Array.isArray(value))
        return value.map((item) => text(item)).filter(Boolean);
      const single = text(value).trim();
      return single ? [single] : [];
    };
    switch (tool.key) {
      case 'image':
        return this.media.generateImage(
          user,
          token,
          {
            prompt: str('prompt'),
            size: str('size') || undefined,
          },
          models,
        );
      case 'video': {
        const frames = [...urls('firstFrame'), ...urls('lastFrame')];
        if (frames.length) {
          return this.media.generateVideoWithReferences(
            user,
            token,
            {
              prompt: str('prompt'),
              duration: Number(input.duration) || undefined,
              resolution: str('resolution') || undefined,
              ratio: str('ratio') || undefined,
              references: frames.map((url) => ({
                type: 'image' as const,
                url,
              })),
            },
            models,
          );
        }
        return this.media.generateVideo(
          user,
          token,
          {
            prompt: str('prompt'),
            duration: Number(input.duration) || undefined,
            resolution: str('resolution') || undefined,
            ratio: str('ratio') || undefined,
          },
          models,
        );
      }
      case 'video-ref':
        return this.media.generateVideoWithReferences(
          user,
          token,
          {
            prompt: str('prompt'),
            duration: Number(input.duration) || undefined,
            resolution: str('resolution') || undefined,
            ratio: str('ratio') || undefined,
            references: urls('references')
              .slice(0, 6)
              .map((url) => ({ type: 'image' as const, url })),
          },
          models,
        );
      case 'video-clone':
        return this.media.generateVideoWithReferences(
          user,
          token,
          {
            prompt: str('prompt'),
            references: [
              { type: 'video', url: str('video') },
              ...urls('references')
                .slice(0, 4)
                .map((url) => ({ type: 'image' as const, url })),
            ],
          },
          models,
        );
      case 'lip-sync':
        return this.media.generateVideoWithReferences(
          user,
          token,
          {
            prompt: str('prompt') || '保持人物口型与音频同步',
            references: [
              { type: 'video', url: str('base') },
              { type: 'audio', url: str('audio') },
            ],
          },
          models,
        );
      case 'replace':
        return this.media.generateVideoWithReferences(
          user,
          token,
          {
            prompt: `把源视频里的${str('mode') || '人物'}替换成参考图中的${str('mode') || '人物'}，保持动作与镜头一致`,
            references: [
              { type: 'video', url: str('video') },
              { type: 'image', url: str('subject') },
            ],
          },
          models,
        );
      case 'video-mix':
        return this.media.generateVideoWithReferences(
          user,
          token,
          {
            prompt: str('prompt'),
            duration: Number(input.duration) || undefined,
            references: urls('materials').map((url) => ({
              type: 'image' as const,
              url,
            })),
          },
          models,
        );
      case 'video-erase': {
        const kit = await this.mediakit(user);
        const url = await kit.erase({
          videoUrl: str('video'),
          mode: str('mode') || 'Subtitle',
          box: str('box') || undefined,
        });
        const asset = await this.assets.tryRegister(user, token, {
          url,
          kind: 'video',
          name: `去水印-${Date.now()}.mp4`,
        });
        return {
          url,
          assetId: asset.assetId,
          assetNote: asset.ok ? '' : asset.message,
        };
      }
      case 'video-upscale':
        return this.media.upscaleVideo(user, token, {
          videoUrl: str('video'),
          resolution: str('resolution') || '1080p',
        });
      case 'image-edit':
        return this.media.editImage(
          user,
          token,
          {
            imageUrl: str('image'),
            prompt: str('prompt'),
          },
          models,
        );
      case 'asr':
        return this.media.transcribe(
          user,
          token,
          {
            mediaUrl: str('media'),
            language: str('language') || undefined,
          },
          models,
        );
      case 'tts':
        return this.media.speech(
          user,
          token,
          {
            text: str('text'),
            voice: str('voice') || undefined,
            format: str('format') || undefined,
          },
          models,
        );
      case 'music':
        return this.media.music(
          user,
          token,
          {
            prompt: str('prompt'),
            lyrics: str('lyrics') || undefined,
            duration: Number(input.duration) || undefined,
          },
          models,
        );
      case 'dubbing': {
        const speech = await this.media.speech(
          user,
          token,
          {
            text: str('text'),
            voice: str('voice') || undefined,
            format: 'mp3',
          },
          models,
        );
        return this.media.generateVideoWithReferences(
          user,
          token,
          {
            prompt: '保持人物口型与这段新配音同步，画面其余部分不变',
            references: [
              { type: 'video', url: str('video') },
              { type: 'audio', url: speech.url },
            ],
          },
          models,
        );
      }
      case 'script':
        return this.media.describeVideo(
          user,
          token,
          {
            videoUrl: str('video'),
            prompt:
              '请把这条视频反推成可拍摄的分镜脚本：按镜头分段，每段写画面、景别、机位、时长与台词/旁白；用简体中文。',
          },
          models,
        );
      case 'copywriting': {
        const kind = str('kind') || '口播稿';
        const tone = str('tone');
        const result = await this.media.generateText(
          user,
          token,
          {
            system: `你是资深中文内容策划，请直接写一篇${kind}${tone ? `，语气${tone}` : ''}，不要输出解释。`,
            user: str('topic'),
          },
          models,
        );
        return { text: result };
      }
      default:
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '这个功能还没有实现',
        );
    }
  }

  /** 重启/超时后遗留的 RUNNING 统一收口，避免界面一直转圈。 */
  private async healStale(userId: string) {
    const cutoff = new Date(Date.now() - STALE_RUNNING_MS);
    await this.prisma.contentGenerationJob.updateMany({
      where: { userId, status: 'RUNNING', updatedAt: { lt: cutoff } },
      data: {
        status: 'FAILED',
        error: '任务中断（服务重启或超时），请重新提交',
        finishedAt: new Date(),
      },
    });
  }

  async list(user: CurrentUser, query: Record<string, unknown>) {
    await this.healStale(user.userId);
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)));
    const tool = text(query.tool).trim();
    const where = { userId: user.userId, ...(tool ? { tool } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.contentGenerationJob.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.contentGenerationJob.count({ where }),
    ]);
    return {
      list: rows.map((row) => view(row as JobRow)),
      total,
      page,
      pageSize,
    };
  }

  async get(user: CurrentUser, id: string) {
    const jobId = Number(id);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '任务编号无效');
    }
    const row = await this.prisma.contentGenerationJob.findFirst({
      where: { id: jobId, userId: user.userId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '任务不存在');
    return view(row);
  }

  async cancel(user: CurrentUser, id: string) {
    const jobId = Number(id);
    const row = await this.prisma.contentGenerationJob.findFirst({
      where: { id: jobId, userId: user.userId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '任务不存在');
    if (row.status !== 'PENDING') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '任务已经在执行，不能中途取消',
      );
    }
    const updated = await this.prisma.contentGenerationJob.update({
      where: { id: jobId },
      data: { status: 'CANCELED', finishedAt: new Date() },
    });
    return view(updated);
  }
}
