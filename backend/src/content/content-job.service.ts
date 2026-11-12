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
import { AipddAssetClient } from './aipdd-asset.client';
import {
  ContentMediaService,
  type JobControl,
  type ModelOverrides,
} from './content-media.service';
import { ContentModelSettingService } from './model-setting.service';
import { DigitalAssetService } from './digital-asset.service';
import { MediaKitClient } from './mediakit.client';
import { readCanvasDoc, deriveCoverUrl } from './canvas-plan';

const logger = new Logger('ContentJob');

/** RUNNING 超过这个时长仍未收口，按「服务重启/中断」处理。 */
const STALE_RUNNING_MS = 30 * 60 * 1000;

/** 取消口径（已确认）：停止本站等待，上游已产生的算力费用不退回。 */
export const CANCEL_NOTE = '已停止本站等待；上游已产生的算力费用不退回';

const CANCELED_ERROR = `${CANCEL_NOTE}（上游可能仍在生成并计费）`;

const SUBMIT_PROGRESS = 5;
const SUBMITTED_PROGRESS = 20;
const DONE_PROGRESS = 95;

type JobRow = {
  id: number;
  userId: string;
  tool: string;
  status: string;
  input: unknown;
  models: unknown;
  output: unknown;
  assetUrl: string;
  aipddAssetId: string;
  error: string;
  source: string;
  canvasId: number;
  nodeId: string;
  runId: string;
  media: string;
  progress: number;
  cancelReason: string;
  upstreamTaskId: string;
  upstreamAcceptedAt: Date | null;
  startedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** 老行没有 media 列时按工具推断，列表分组不至于全落在「其它」。 */
function mediaOfTool(tool: string) {
  const produces = CONTENT_TOOLS[tool]?.produces;
  if (produces === 'image') return 'image';
  if (produces === 'video') return 'video';
  if (produces === 'audio') return tool === 'music' ? 'music' : 'audio';
  if (produces === 'text') return 'text';
  return '';
}

function view(row: JobRow): ContentJob {
  const running =
    row.status === 'RUNNING' && row.startedAt
      ? Math.max(0, Math.round((Date.now() - row.startedAt.getTime()) / 1000))
      : 0;
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
    source: row.source || 'tool',
    canvasId: row.canvasId || 0,
    nodeId: row.nodeId || '',
    runId: row.runId || '',
    media: row.media || mediaOfTool(row.tool),
    progress: row.progress || 0,
    cancelReason: row.cancelReason || '',
    upstreamTaskId: row.upstreamTaskId || '',
    upstreamAcceptedAt: row.upstreamAcceptedAt
      ? row.upstreamAcceptedAt.toISOString()
      : '',
    elapsedSeconds: running,
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

function extOf(media: string) {
  if (media === 'image') return 'png';
  if (media === 'video') return 'mp4';
  if (media === 'music' || media === 'audio') return 'mp3';
  return 'bin';
}

/**
 * 取消原因：把「上游到底受理了没有」写清楚，客服据此回答「为什么取消了还被扣」。
 * 受理时间用东八区，和界面其它时间口径一致。
 */
function receiptOf(row: JobRow) {
  if (!row.upstreamAcceptedAt) {
    return `${CANCEL_NOTE}；上游尚未受理这次生成`.slice(0, 200);
  }
  const at = row.upstreamAcceptedAt.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
  const task = row.upstreamTaskId ? `，子任务 ${row.upstreamTaskId}` : '';
  return `${CANCEL_NOTE}；上游已受理于 ${at}${task}`.slice(0, 200);
}

function isCancelledError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'AbortError' ||
    /abort|cancel|中断|已取消/i.test(error.message)
  );
}

export type EnqueueOptions = {
  /** tool | canvas | studio */
  source?: string;
  canvasId?: number;
  nodeId?: string;
  runId?: string;
  /** 一次提交建几条任务（生图批量；其它媒体固定 1） */
  count?: number;
};

type ExecuteOutcome = {
  output: Record<string, unknown>;
  /** 产物直链：为真才下载字节转存本站数字资产 */
  assetUrl: string;
};

type FinishData = {
  output?: unknown;
  assetUrl?: string;
  aipddAssetId?: string;
  error?: string;
  cancelReason?: string;
  progress?: number;
};

/**
 * 内容创作的任务：卡片 / 画布 / 工作台 → 建任务（只落 PENDING 排队）→ 调度池起跑
 * （模型网关 / MediaKit）→ 成功产物下载后登记数字资产。界面永远只读任务表。
 *
 * 口径：不引入 MQ，也不在内存里攒队列——DB 是唯一真值，起跑统一由 ContentJobWorkerPool 捞。
 */
export class ContentJobService {
  /** 本进程正在跑的任务：jobId → 中断句柄（取消时 abort 本站等待） */
  private readonly running = new Map<number, AbortController>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ContentModelSettingService,
    private readonly media: ContentMediaService,
    private readonly digitalAssets: DigitalAssetService,
    private readonly client: AipddAssetClient,
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

  /** 统一入队：校验 + 逐个落 PENDING，不在这里起跑（调度池负责）。 */
  async enqueue(
    user: CurrentUser,
    token: string | undefined,
    body: Record<string, unknown>,
    options: EnqueueOptions = {},
  ): Promise<ContentJob[]> {
    const tool = this.toolOf(text(body.tool).trim());
    const input = validateInput(
      tool,
      (body.input || {}) as Record<string, unknown>,
    );
    const models = parseModels(body.models, tool);
    await this.assertReady(user, token, tool, models);
    const source = text(options.source).trim() || 'tool';
    const requested = Number(body.count ?? options.count ?? 1);
    const batch =
      tool.produces === 'image'
        ? Math.min(4, Math.max(1, Math.round(Number(requested) || 1)))
        : 1;
    const runId =
      text(options.runId).trim() ||
      (source === 'tool'
        ? ''
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
    const rows: JobRow[] = [];
    for (let index = 0; index < batch; index += 1) {
      const row = await this.prisma.contentGenerationJob.create({
        data: {
          userId: user.userId,
          tool: tool.key,
          status: 'PENDING',
          input: toJsonInput(input),
          models: toJsonInput(models),
          source,
          canvasId: options.canvasId || 0,
          nodeId: options.nodeId || '',
          runId,
          media: mediaOfTool(tool.key),
        },
      });
      rows.push(row);
    }
    return rows.map((row) => view(row));
  }

  /** 既有调用（小工具卡片 / 视频模版复刻）只要第一条。 */
  async create(
    user: CurrentUser,
    token: string | undefined,
    body: Record<string, unknown>,
  ) {
    const [job] = await this.enqueue(user, token, body);
    return job;
  }

  // ---------------------------------------------------------------- 调度池入口

  /** 本进程在跑的任务数（调度池据此算剩余并发槽）。 */
  inflight() {
    return this.running.size;
  }

  /**
   * 条件更新占坑：只有 status='PENDING' 的那一条会被改成 RUNNING。
   * 多个 worker 同时捞到同一条时只有一个 count=1，天然互斥。
   */
  async claim(jobId: number) {
    const result = await this.prisma.contentGenerationJob.updateMany({
      where: { id: jobId, status: 'PENDING' },
      data: {
        status: 'RUNNING',
        progress: SUBMIT_PROGRESS,
        startedAt: new Date(),
      },
    });
    return result.count === 1;
  }

  /** 起跑一条已占坑的任务，不等待完成（并发由调度池控制）。 */
  start(jobId: number) {
    const controller = new AbortController();
    this.running.set(jobId, controller);
    void this.execute(jobId, controller)
      .catch((error: unknown) => {
        logger.warn(`任务执行异常 job=${jobId}: ${String(error)}`);
      })
      .finally(() => {
        this.running.delete(jobId);
      });
  }

  /**
   * 后台执行（没有请求上下文）：按 jobId 从库里取全部输入，跑完写终态。
   * 取消是「先落 CANCELED 再 abort」，终态回写一律带 status='RUNNING' 条件，
   * 已取消的行不会被覆盖回 SUCCESS。
   */
  private async execute(jobId: number, controller: AbortController) {
    const row = (await this.prisma.contentGenerationJob.findUnique({
      where: { id: jobId },
    })) as JobRow | null;
    if (!row || row.status !== 'RUNNING') return;
    const tool = CONTENT_TOOLS[row.tool];
    if (!tool) {
      await this.finish(jobId, 'FAILED', { error: '这个功能已下线' });
      return;
    }
    // 后台无请求身份：只带 userId，模型解析与用量归属都按这个账号算
    const user = new CurrentUser(row.userId, row.userId, 'user');
    const input = (row.input || {}) as Record<string, unknown>;
    const models = (row.models || {}) as ModelOverrides;
    const control: JobControl = {
      signal: controller.signal,
      source: row.source || 'tool',
      onProgress: this.progressWriter(jobId),
      onAccepted: (taskId) => void this.markAccepted(jobId, taskId),
    };
    try {
      // 后台没有请求上下文，不传令牌：渠道 0（AIPDD）的凭据由取凭据层按 userId 现取本人绑定的 Key
      const outcome = await this.executeTool(
        user,
        undefined,
        tool,
        input,
        models,
        control,
      );
      if (controller.signal.aborted) return;
      const stored = await this.store(row, outcome);
      const assetUrl = stored.assetUrl || outcome.assetUrl;
      await this.finish(jobId, 'SUCCESS', {
        output: { ...outcome.output, ...stored.output },
        assetUrl,
        aipddAssetId: stored.assetId,
        progress: 100,
      });
      await this.rememberCanvasResult(row, assetUrl, stored.assetId);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (isCancelledError(error)) {
        await this.finish(jobId, 'CANCELED', {
          error: CANCELED_ERROR,
          cancelReason: CANCEL_NOTE,
        });
        return;
      }
      const message =
        error instanceof BusinessException
          ? error.message
          : error instanceof Error
            ? error.message.slice(0, 450)
            : '生成失败，请稍后重试';
      await this.finish(jobId, 'FAILED', { error: message });
    }
  }

  /**
   * 上游受理留痕：只在第一次受理时写入（受理时间 + 子任务号），取消时据此说明「上游已计费」。
   * 网关没给子任务号（同步出图）也记受理时间，只是 taskId 留空。
   */
  private async markAccepted(jobId: number, taskId: string) {
    await this.prisma.contentGenerationJob
      .updateMany({
        where: { id: jobId, status: 'RUNNING', upstreamAcceptedAt: null },
        data: {
          upstreamAcceptedAt: new Date(),
          ...(taskId ? { upstreamTaskId: taskId.slice(0, 128) } : {}),
        },
      })
      .catch(() => undefined);
  }

  /** 进度按 5 的倍数节流写回，避免每次轮询都打一条 UPDATE。 */
  private progressWriter(jobId: number) {
    let last = 0;
    return (percent: number) => {
      const value = Math.min(94, Math.max(last, Math.round(percent)));
      if (value < last + 5 && value !== 94) return;
      last = value;
      void this.prisma.contentGenerationJob
        .updateMany({
          where: { id: jobId, status: 'RUNNING' },
          data: { progress: value },
        })
        .catch(() => undefined);
    };
  }

  /** 终态回写：一律带 status='RUNNING' 条件，被取消/收口过的行不再覆盖。 */
  private async finish(
    jobId: number,
    status: 'SUCCESS' | 'FAILED' | 'CANCELED',
    data: FinishData,
  ) {
    await this.prisma.contentGenerationJob
      .updateMany({
        where: { id: jobId, status: 'RUNNING' },
        data: {
          status,
          ...(data.output !== undefined
            ? { output: toJsonInput(data.output) }
            : {}),
          ...(data.assetUrl !== undefined ? { assetUrl: data.assetUrl } : {}),
          ...(data.aipddAssetId !== undefined
            ? { aipddAssetId: data.aipddAssetId }
            : {}),
          ...(data.error !== undefined ? { error: data.error } : {}),
          ...(data.cancelReason !== undefined
            ? { cancelReason: data.cancelReason }
            : {}),
          progress: data.progress ?? (status === 'SUCCESS' ? 100 : 0),
          finishedAt: new Date(),
        },
      })
      .catch(() => undefined);
  }

  /**
   * 画布 / 工作台产物入数字资产：下载上游直链字节存本站 OSS 并登记台账。
   * 失败只告警不阻断任务成功（任务照样回上游直链）。
   */
  private async store(row: JobRow, outcome: ExecuteOutcome) {
    const empty = {
      assetUrl: '',
      assetId: '',
      output: {} as Record<string, unknown>,
    };
    const source = row.source || 'tool';
    // 老工具继续走 AIPDD 平台登记，只有画布 / 工作台接新底座
    if (!outcome.assetUrl || source === 'tool' || !row.media) return empty;
    try {
      const bytes = await this.client.download(outcome.assetUrl);
      const asset = await this.digitalAssets.registerDeliverable(row.userId, {
        bytes: Buffer.from(bytes),
        filename: `${source}-${row.media}-${row.id}.${extOf(row.media)}`,
        labels: ['ai-generated', row.media],
        dir: source,
        source,
      });
      if (!asset?.id) {
        return {
          ...empty,
          output: { assetNote: '产物已生成，但未能存入本站数字资产' },
        };
      }
      return {
        assetUrl: asset.url || outcome.assetUrl,
        assetId: String(asset.id),
        // 已入本站台账：抹掉上游 AIPDD 平台登记器留下的提示（多为「未绑定 Key」），
        // 否则「入库成功」的产物还挂着一条平台告警，界面上会误以为没存住
        output: { assetNote: '' },
      };
    } catch (error) {
      logger.warn(
        `产物入数字资产失败 job=${row.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        ...empty,
        output: { assetNote: '产物已生成，但未能存入本站数字资产' },
      };
    }
  }

  /**
   * 画布任务成功后把产物写回生成节点的 results（封面板 / 节点上的结果依赖它）。
   * DB 是唯一真值：这里按 runId 直接读同批任务，不依赖内存态；写之前比版本号，失败只告警。
   */
  private async rememberCanvasResult(
    row: JobRow,
    url: string,
    assetId: string,
  ) {
    if (row.source !== 'canvas' || !row.canvasId || !row.nodeId || !url) return;
    try {
      const canvas = await this.prisma.contentCanvasProject.findUnique({
        where: { id: row.canvasId },
        select: { doc: true, version: true, userId: true },
      });
      if (!canvas || canvas.userId !== row.userId) return;
      const doc = readCanvasDoc(canvas.doc);
      const node = doc.nodes.find((item) => item.id === row.nodeId);
      if (!node || node.data.kind !== 'generate') return;
      if (node.data.results.some((item) => item.jobId === row.id)) return;
      node.data = {
        ...node.data,
        results: [
          ...node.data.results,
          {
            jobId: row.id,
            url,
            assetId: assetId || '',
            media: row.media || 'image',
          },
        ].slice(-24),
      };
      await this.prisma.contentCanvasProject.updateMany({
        where: { id: row.canvasId, version: canvas.version },
        data: {
          doc: toJsonInput(doc),
          version: { increment: 1 },
          // 有新产物就顺手把封面换成它，列表不用等用户再保存一次
          coverUrl: deriveCoverUrl(doc),
        },
      });
    } catch (error) {
      logger.warn(
        `画布节点结果回写失败 job=${row.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async executeTool(
    user: CurrentUser,
    token: string | undefined,
    tool: ContentTool,
    input: Record<string, unknown>,
    models: ModelOverrides,
    control: JobControl,
  ): Promise<ExecuteOutcome> {
    const str = (key: string) => text(input[key]).trim();
    const urls = (key: string) => {
      const value = input[key];
      if (Array.isArray(value))
        return value.map((item) => text(item)).filter(Boolean);
      const single = text(value).trim();
      return single ? [single] : [];
    };
    const mediaStep = async (
      pending: Promise<Record<string, unknown>>,
    ): Promise<ExecuteOutcome> => {
      control.onProgress?.(SUBMITTED_PROGRESS);
      const output = await pending;
      // 同步出图没有子任务号：上游已经返回结果，记一条受理（异步走轮询时已由 media 层记过）
      control.onAccepted?.('');
      control.onProgress?.(DONE_PROGRESS);
      return { output, assetUrl: text(output.url) };
    };
    switch (tool.key) {
      case 'image':
        return mediaStep(
          this.media.generateImage(
            user,
            token,
            {
              prompt: str('prompt'),
              size: str('size') || undefined,
            },
            models,
            control,
          ),
        );
      case 'video': {
        const frames = [...urls('firstFrame'), ...urls('lastFrame')];
        const params = {
          prompt: str('prompt'),
          duration: Number(input.duration) || undefined,
          resolution: str('resolution') || undefined,
          ratio: str('ratio') || undefined,
        };
        if (frames.length) {
          return mediaStep(
            this.media.generateVideoWithReferences(
              user,
              token,
              {
                ...params,
                references: frames.map((url) => ({
                  type: 'image' as const,
                  url,
                })),
              },
              models,
              control,
            ),
          );
        }
        return mediaStep(
          this.media.generateVideo(user, token, params, models, control),
        );
      }
      case 'video-ref':
        return mediaStep(
          this.media.generateVideoWithReferences(
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
            control,
          ),
        );
      case 'video-clone':
        return mediaStep(
          this.media.generateVideoWithReferences(
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
            control,
          ),
        );
      case 'lip-sync':
        return mediaStep(
          this.media.generateVideoWithReferences(
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
            control,
          ),
        );
      case 'replace':
        return mediaStep(
          this.media.generateVideoWithReferences(
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
            control,
          ),
        );
      case 'video-mix':
        return mediaStep(
          this.media.generateVideoWithReferences(
            user,
            token,
            {
              prompt: str('prompt'),
              duration: Number(input.duration) || undefined,
              references: urls('materials')
                .slice(0, 6)
                .map((url) => ({ type: 'image' as const, url })),
            },
            models,
            control,
          ),
        );
      case 'video-erase': {
        const kit = await this.mediakit(user);
        const url = await kit.erase({
          videoUrl: str('video'),
          mode: str('mode') || 'Subtitle',
          box: str('box') || undefined,
        });
        control.onAccepted?.('');
        return { output: { url }, assetUrl: url };
      }
      case 'video-upscale': {
        const output = await this.media.upscaleVideo(
          user,
          token,
          {
            videoUrl: str('video'),
            resolution: str('resolution') || '1080p',
          },
          control,
        );
        control.onAccepted?.('');
        return { output, assetUrl: text(output.url) };
      }
      case 'image-edit': {
        const sources = urls('image');
        return mediaStep(
          this.media.editImage(
            user,
            token,
            {
              imageUrl: sources[0] || '',
              imageUrls: sources,
              prompt: str('prompt'),
              size: str('size') || undefined,
            },
            models,
            control,
          ),
        );
      }
      case 'asr':
        return {
          output: await this.media.transcribe(
            user,
            token,
            {
              mediaUrl: str('media'),
              language: str('language') || undefined,
            },
            models,
          ),
          assetUrl: '',
        };
      case 'tts':
        return mediaStep(
          this.media.speech(
            user,
            token,
            {
              text: str('text'),
              voice: str('voice') || undefined,
              format: str('format') || undefined,
            },
            models,
            control,
          ),
        );
      case 'music':
        return mediaStep(
          this.media.music(
            user,
            token,
            {
              prompt: str('prompt'),
              lyrics: str('lyrics') || undefined,
              duration: Number(input.duration) || undefined,
            },
            models,
            control,
          ),
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
          control,
        );
        return mediaStep(
          this.media.generateVideoWithReferences(
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
            control,
          ),
        );
      }
      case 'script':
        return {
          output: await this.media.describeVideo(
            user,
            token,
            {
              videoUrl: str('video'),
              prompt:
                '请把这条视频反推成可拍摄的分镜脚本：按镜头分段，每段写画面、景别、机位、时长与台词/旁白；用简体中文。',
            },
            models,
          ),
          assetUrl: '',
        };
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
        return { output: { text: result.text }, assetUrl: '' };
      }
      default:
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '这个功能还没有实现',
        );
    }
  }

  // ---------------------------------------------------------------- 查询与操作

  /** 重启/超时后遗留的 RUNNING 统一收口（调度池每轮也会调一次）。 */
  async healStale(userId?: string) {
    const cutoff = new Date(Date.now() - STALE_RUNNING_MS);
    await this.prisma.contentGenerationJob.updateMany({
      where: {
        ...(userId ? { userId } : {}),
        status: 'RUNNING',
        updatedAt: { lt: cutoff },
      },
      data: {
        status: 'FAILED',
        error: '任务中断（服务重启或超时），请重新提交',
        finishedAt: new Date(),
      },
    });
  }

  async list(user: CurrentUser, query: Record<string, unknown>) {
    // 读接口不做全表收口：调度池每轮已经 healStale，这里再跑一次只会把「还没被调度到」的活任务误判为中断
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)));
    // tool 支持逗号分隔（三个工作台各自只关心自己会提交的那几种工具）
    const tools = text(query.tool)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const source = text(query.source).trim();
    const media = text(query.media).trim();
    const statuses = text(query.status)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const canvasId = Number(query.canvasId || 0);
    const nodeId = text(query.nodeId).trim();
    const where = {
      userId: user.userId,
      ...(tools.length === 1
        ? { tool: tools[0] }
        : tools.length > 1
          ? { tool: { in: tools } }
          : {}),
      ...(source ? { source } : {}),
      ...(media ? { media } : {}),
      ...(statuses.length ? { status: { in: statuses } } : {}),
      ...(Number.isInteger(canvasId) && canvasId > 0 ? { canvasId } : {}),
      ...(nodeId ? { nodeId } : {}),
    };
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
    return view(await this.rowOf(user, jobId));
  }

  private async rowOf(user: CurrentUser, jobId: number) {
    const row = await this.prisma.contentGenerationJob.findFirst({
      where: { id: jobId, userId: user.userId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '任务不存在');
    return row as JobRow;
  }

  /**
   * 取消：先落库 CANCELED（DB 是唯一真值，调度池不会再取），再 abort 中断本站等待。
   * 上游已产生的算力费用不退回，原因写进 cancelReason 供界面常驻展示。
   */
  async cancel(user: CurrentUser, id: string) {
    const jobId = Number(id);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '任务编号无效');
    }
    const row = await this.rowOf(user, jobId);
    if (row.status === 'CANCELED') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '任务已经取消');
    }
    if (row.status === 'SUCCESS' || row.status === 'FAILED') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '任务已经结束，不能取消',
      );
    }
    const result = await this.prisma.contentGenerationJob.updateMany({
      where: { id: jobId, status: { in: ['PENDING', 'RUNNING'] } },
      data: {
        status: 'CANCELED',
        error: CANCELED_ERROR,
        cancelReason: receiptOf(row),
        progress: 0,
        finishedAt: new Date(),
      },
    });
    if (result.count === 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '任务已经结束，不能取消',
      );
    }
    this.running.get(jobId)?.abort(new Error('用户取消任务'));
    return view(await this.rowOf(user, jobId));
  }

  /** 重试 = 同参数新建一条任务（原任务保留历史）。 */
  async retry(user: CurrentUser, id: string) {
    const jobId = Number(id);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '任务编号无效');
    }
    const row = await this.rowOf(user, jobId);
    if (row.status === 'PENDING' || row.status === 'RUNNING') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '任务还在进行中，请等它结束或先取消',
      );
    }
    // 重试请求不带请求上下文：沿用原任务的渠道与模型，凭据口径同后台执行（不传令牌）
    const models = (row.models || {}) as ModelOverrides;
    const [job] = await this.enqueue(
      user,
      undefined,
      { tool: row.tool, input: row.input, models },
      {
        source: row.source,
        canvasId: row.canvasId,
        nodeId: row.nodeId,
        runId: row.runId,
      },
    );
    return job;
  }
}
