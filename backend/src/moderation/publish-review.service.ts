import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import {
  ALIYUN_RISK_LABELS,
  PUBLISH_REVIEW_REGION_LABELS,
  PUBLISH_REVIEW_SCENE_LABELS,
  type AliyunSuggestion,
  type PublishReviewDecision,
  type PublishReviewRegion,
  type PublishReviewScene,
  type PublishReviewSettings,
} from '@enterprise/contracts';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import {
  AliyunGreenClient,
  AliyunGreenError,
  type GreenScanResult,
} from './aliyun-green.client';

export const PUBLISH_REVIEW_SETTINGS_KEY = 'publish_review';
const DEFAULT_REGION: PublishReviewRegion = 'cn-shanghai';

type RuntimeSettings = {
  enabled: boolean;
  region: PublishReviewRegion;
  accessKeyId: string;
  accessKeySecret: string;
  communityPost: boolean;
  resume: boolean;
};

type SaveInput = {
  enabled: boolean;
  region: PublishReviewRegion;
  accessKeyId: string;
  accessKeySecret: string;
  scenes: { communityPost: boolean; resume: boolean };
};

type GuardInput = {
  userId: string;
  scene: PublishReviewScene;
  texts: Array<string | null | undefined>;
};

/** 媒体审核结论：off＝未接入/降级放行，pending＝视频异步待轮询，pass/block＝已出结论。 */
export type MediaVerdict = {
  status: 'pass' | 'block' | 'pending' | 'off';
  labels: string[];
  note: string;
  taskId: string;
};

const maskKey = (value: string) =>
  value ? `${value.slice(0, 4)}****${value.slice(-4)}` : '';

const sceneEnabled = (runtime: RuntimeSettings, scene: PublishReviewScene) => {
  if (
    scene === 'demand' ||
    scene === 'service' ||
    scene === 'acquisition_outreach'
  ) {
    return true;
  }
  return scene === 'resume' ? runtime.resume : runtime.communityPost;
};

const hitNames = (labels: string[]) =>
  labels
    .map((label) => ALIYUN_RISK_LABELS[label] || label)
    .filter(Boolean)
    .join('、');

export function moderationMessage(
  suggestion: AliyunSuggestion,
  labels: string[],
): string {
  const hit = hitNames(labels) || '疑似违规内容';
  return suggestion === 'block'
    ? `发布内容未通过安全审核（命中：${hit}），请修改后再发布`
    : `发布内容疑似违规（命中：${hit}），请调整措辞后重试`;
}

/**
 * 发布审核配置与执行（阿里云内容安全）：
 * - 凭据 AES-256-GCM 加密存 system_settings，接口只回掩码；
 * - 需求 / 服务为必选场景，社群发帖 / 简历由管理员按需开启；
 * - 上游超时或不可用时降级放行主链路并记 ERROR 台账，不阻断正常发布；
 * - 命中 block / review 直接拒绝本次发布（无人工复核队列时不能放行）。
 */
export class PublishReviewService {
  private readonly key: Buffer;
  private warnedUpstream = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client = new AliyunGreenClient(),
  ) {
    const source = String(process.env.EXTERNAL_CRED_KEY || '').trim();
    if (!source)
      throw new Error('EXTERNAL_CRED_KEY 未配置，无法加密发布审核凭据');
    this.key = createHash('sha256')
      .update(`aiworkin-publish-review|${source}`)
      .digest();
  }

  private row() {
    return this.prisma.systemSetting.findUnique({
      where: { key: PUBLISH_REVIEW_SETTINGS_KEY },
    });
  }

  private encrypt(data: RuntimeSettings): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(
        JSON.stringify({
          enabled: data.enabled,
          region: data.region,
          accessKeyId: data.accessKeyId,
          accessKeySecret: data.accessKeySecret,
          scenes: {
            communityPost: data.communityPost,
            resume: data.resume,
          },
        }),
        'utf8',
      ),
      cipher.final(),
    ]);
    return [
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  private decrypt(value: string): RuntimeSettings {
    const parts = value.split(':');
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
    const data = JSON.parse(plain) as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === 'string' ? value : '');
    const region = text(data.region);
    const scenes = (data.scenes || {}) as Record<string, unknown>;
    return {
      enabled: data.enabled !== false,
      region: Object.hasOwn(PUBLISH_REVIEW_REGION_LABELS, region)
        ? (region as PublishReviewRegion)
        : DEFAULT_REGION,
      accessKeyId: text(data.accessKeyId),
      accessKeySecret: text(data.accessKeySecret),
      communityPost: scenes.communityPost === true,
      resume: scenes.resume === true,
    };
  }

  private async runtime(): Promise<RuntimeSettings> {
    const row = await this.row();
    if (!row?.value) {
      return {
        enabled: true,
        region: DEFAULT_REGION,
        accessKeyId: '',
        accessKeySecret: '',
        communityPost: false,
        resume: false,
      };
    }
    try {
      return this.decrypt(row.value);
    } catch {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '发布审核凭据无法读取，请在「平台管理后台 → 发布审核」重新保存配置',
      );
    }
  }

  async view(): Promise<PublishReviewSettings> {
    const row = await this.row();
    const runtime = await this.runtime().catch(() => null);
    const configured = Boolean(
      runtime?.accessKeyId && runtime?.accessKeySecret,
    );
    return {
      enabled: runtime?.enabled ?? true,
      configured,
      region: runtime?.region ?? DEFAULT_REGION,
      accessKeyIdMasked: maskKey(runtime?.accessKeyId || ''),
      scenes: {
        communityPost: runtime?.communityPost ?? false,
        resume: runtime?.resume ?? false,
        demand: true,
        service: true,
      },
      source: row?.value ? 'db' : 'none',
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  async save(input: SaveInput, adminUserId: string) {
    const existing = await this.runtime();
    const accessKeyId = input.accessKeyId.trim() || existing.accessKeyId;
    const accessKeySecret =
      input.accessKeySecret.trim() || existing.accessKeySecret;
    if (!accessKeyId || !accessKeySecret) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写阿里云 AccessKey ID 与 AccessKey Secret',
      );
    }
    if (!Object.hasOwn(PUBLISH_REVIEW_REGION_LABELS, input.region)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '接入区域不合法');
    }
    const runtime: RuntimeSettings = {
      enabled: input.enabled,
      region: input.region,
      accessKeyId,
      accessKeySecret,
      communityPost: input.scenes.communityPost,
      resume: input.scenes.resume,
    };
    await this.prisma.systemSetting.upsert({
      where: { key: PUBLISH_REVIEW_SETTINGS_KEY },
      create: {
        key: PUBLISH_REVIEW_SETTINGS_KEY,
        value: this.encrypt(runtime),
      },
      update: { value: this.encrypt(runtime) },
    });
    await this.prisma.auditLog
      .create({
        data: {
          userId: adminUserId,
          action: 'PUBLISH_REVIEW_CONFIG_SAVED',
          detail: `region=${input.region} enabled=${input.enabled} communityPost=${input.scenes.communityPost} resume=${input.scenes.resume}`,
        },
      })
      .catch(() => undefined);
    return this.view();
  }

  async test(text: string) {
    const runtime = await this.runtime();
    if (!runtime.accessKeyId || !runtime.accessKeySecret) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先保存阿里云 AccessKey，再测试审核',
      );
    }
    const result = await this.call(runtime, text);
    return {
      ...result,
      message:
        result.suggestion === 'pass'
          ? '通过：未发现违规内容'
          : moderationMessage(result.suggestion, result.labels),
    };
  }

  /**
   * 媒体（图 / 视频）审核凭据：未配置或总开关关闭时返回 null。
   * 与文本审核共用同一份凭据与开关，仅场景不同（媒体用 porn/terrorism/ad/political_content）。
   */
  private async mediaRuntime(): Promise<RuntimeSettings | null> {
    let runtime: RuntimeSettings;
    try {
      runtime = await this.runtime();
    } catch {
      return null;
    }
    if (!runtime.enabled || !runtime.accessKeyId || !runtime.accessKeySecret) {
      return null;
    }
    return runtime;
  }

  /**
   * 图片同步送审：未配置返回 off（放行主链路），上游异常同样降级 off 且只告警一次。
   * 命中 block / review 记 block，调用方据此隐藏或标记该数字资产。
   */
  async guardImage(url: string): Promise<MediaVerdict> {
    const runtime = await this.mediaRuntime();
    if (!runtime) return { status: 'off', labels: [], note: '', taskId: '' };
    try {
      const result = await this.client.scanImage({
        accessKeyId: runtime.accessKeyId,
        accessKeySecret: runtime.accessKeySecret,
        region: runtime.region,
        url,
      });
      const blocked = result.suggestion !== 'pass';
      return {
        status: blocked ? 'block' : 'pass',
        labels: result.labels,
        note: blocked ? hitNames(result.labels) : '',
        taskId: '',
      };
    } catch (error) {
      this.warnUpstream(error);
      return { status: 'off', labels: [], note: '', taskId: '' };
    }
  }

  /** 视频异步送审：返回 taskId 供轮询；未配置返回 off（不做异步审核）。 */
  async submitVideo(url: string): Promise<MediaVerdict> {
    const runtime = await this.mediaRuntime();
    if (!runtime) return { status: 'off', labels: [], note: '', taskId: '' };
    try {
      const taskId = await this.client.submitVideoScan({
        accessKeyId: runtime.accessKeyId,
        accessKeySecret: runtime.accessKeySecret,
        region: runtime.region,
        url,
      });
      return taskId
        ? { status: 'pending', labels: [], note: '', taskId }
        : { status: 'off', labels: [], note: '', taskId: '' };
    } catch (error) {
      this.warnUpstream(error);
      return { status: 'off', labels: [], note: '', taskId: '' };
    }
  }

  /** 视频结果轮询：只返回已出结论的 taskId，未完成的由调用方保持 pending 下次再查。 */
  async pollVideos(taskIds: string[]): Promise<Record<string, MediaVerdict>> {
    const ids = [...new Set(taskIds.filter(Boolean))];
    if (!ids.length) return {};
    const runtime = await this.mediaRuntime();
    if (!runtime) return {};
    try {
      const results = await this.client.videoScanResults({
        accessKeyId: runtime.accessKeyId,
        accessKeySecret: runtime.accessKeySecret,
        region: runtime.region,
        taskIds: ids,
      });
      const out: Record<string, MediaVerdict> = {};
      for (const [taskId, result] of Object.entries(results)) {
        const blocked = result.suggestion !== 'pass';
        out[taskId] = {
          status: blocked ? 'block' : 'pass',
          labels: result.labels,
          note: blocked ? hitNames(result.labels) : '',
          taskId,
        };
      }
      return out;
    } catch (error) {
      this.warnUpstream(error);
      return {};
    }
  }

  private warnUpstream(error: unknown) {
    if (this.warnedUpstream) return;
    this.warnedUpstream = true;
    console.warn(
      JSON.stringify({
        event: 'publish_review_upstream_failed',
        message: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }

  /**
   * 发布前送审：未配置 / 场景关闭 / 文本为空时直接放行。
   * 上游异常只记 ERROR 台账并放行，避免第三方故障拖垮本站发布主链路。
   */
  async guard(input: GuardInput): Promise<void> {
    let runtime: RuntimeSettings;
    try {
      runtime = await this.runtime();
    } catch {
      return;
    }
    if (
      !runtime.enabled ||
      !runtime.accessKeyId ||
      !runtime.accessKeySecret ||
      !sceneEnabled(runtime, input.scene)
    ) {
      return;
    }
    const text = input.texts
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, 10000);
    if (!text) return;

    let result: GreenScanResult;
    try {
      result = await this.call(runtime, text);
    } catch (error) {
      await this.log({
        scene: input.scene,
        userId: input.userId,
        decision: 'ERROR',
        suggestion: 'pass',
        labels: [],
        snippet: text,
        reason: error instanceof Error ? error.message : '发布审核调用异常',
        requestId: '',
      });
      this.warnUpstream(error);
      return;
    }
    if (result.suggestion === 'pass') return;
    await this.log({
      scene: input.scene,
      userId: input.userId,
      decision: result.suggestion === 'block' ? 'BLOCK' : 'REVIEW',
      suggestion: result.suggestion,
      labels: result.labels,
      snippet: text,
      reason: moderationMessage(result.suggestion, result.labels),
      requestId: result.requestId,
    });
    throw new BusinessException(
      ErrorCode.CONTENT_MODERATION_BLOCKED,
      moderationMessage(result.suggestion, result.labels),
    );
  }

  async logs(query: {
    page: number;
    pageSize: number;
    scene?: string;
    decision?: string;
  }) {
    const where = {
      ...(query.scene ? { scene: query.scene } : {}),
      ...(query.decision ? { decision: query.decision } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.publishReviewLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.publishReviewLog.count({ where }),
    ]);
    return {
      list: rows.map((row) => ({
        id: row.id,
        scene: row.scene as PublishReviewScene,
        sceneLabel:
          PUBLISH_REVIEW_SCENE_LABELS[row.scene as PublishReviewScene] ||
          row.scene,
        userId: row.userId,
        decision: row.decision as PublishReviewDecision,
        suggestion: row.suggestion as AliyunSuggestion,
        labels: row.labels ? row.labels.split(',').filter(Boolean) : [],
        snippet: row.snippet,
        reason: row.reason,
        requestId: row.requestId,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  private async call(
    runtime: RuntimeSettings,
    text: string,
  ): Promise<GreenScanResult> {
    try {
      return await this.client.scan({
        accessKeyId: runtime.accessKeyId,
        accessKeySecret: runtime.accessKeySecret,
        region: runtime.region,
        text,
      });
    } catch (error) {
      if (error instanceof AliyunGreenError) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `阿里云内容安全调用失败：${error.message}`,
        );
      }
      throw error;
    }
  }

  private async log(input: {
    scene: PublishReviewScene;
    userId: string;
    decision: PublishReviewDecision;
    suggestion: AliyunSuggestion;
    labels: string[];
    snippet: string;
    reason: string;
    requestId: string;
  }) {
    await this.prisma.publishReviewLog
      .create({
        data: {
          scene: input.scene,
          userId: input.userId,
          decision: input.decision,
          suggestion: input.suggestion,
          labels: input.labels.join(',').slice(0, 200),
          snippet: input.snippet.slice(0, 200),
          reason: input.reason.slice(0, 500),
          requestId: input.requestId.slice(0, 64),
        },
      })
      .catch(() => undefined);
  }
}
