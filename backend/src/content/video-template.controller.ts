import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { RateWindow } from '../common/rate-window';
import {
  VideoTemplateService,
  videoTemplateSyncToken,
} from './video-template.service';

type HandlerBody = Record<string, unknown>;

const asBool = (value: unknown) => value === true || value === 'true';
const asNum = (value: unknown) => Number(value) || 0;
/** 文本字段收口：只接受字符串 / 数字 / 布尔，其余（对象、数组、null、undefined）一律归空串。 */
const asStr = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
};

/**
 * 视频模版社区控制器：方法名与契约 operationId 去前缀一致。
 * 运行会真出站（烧用户自己的模型额度）、发布写库、付费查看动积分，
 * 三类低频动作各加一层进程内限流，挡住连点与脚本刷量。
 */
export class VideoTemplateController {
  /** 付费查看：30 次/分钟/人（每次可能扣积分）。 */
  private readonly viewWindow = new RateWindow(30, 60_000);
  /** 发布：10 条/天/人。 */
  private readonly publishWindow = new RateWindow(10, 24 * 60 * 60_000);
  /** 复刻生成：20 次/分钟/人。 */
  private readonly generateWindow = new RateWindow(20, 60_000);
  /** 收藏与评分：60 次/分钟/人。 */
  private readonly socialWindow = new RateWindow(60, 60_000);

  constructor(readonly service: VideoTemplateService) {}

  list(
    user: CurrentUser,
    query: {
      page?: number;
      pageSize?: number;
      keyword?: string;
      type?: string;
      sort?: string;
      mine?: boolean;
      favorite?: boolean;
    },
  ) {
    return this.service.list(user, query);
  }

  detail(user: CurrentUser, id: string) {
    return this.service.detail(user, this.idOf(id));
  }

  view(user: CurrentUser, id: string) {
    this.viewWindow.consume(user.userId, '操作太频繁，请稍后再试');
    return this.service.view(user, this.idOf(id));
  }

  publish(user: CurrentUser, body: HandlerBody) {
    this.publishWindow.consume(
      user.userId,
      '今天发布的模版已达上限，请明天再来',
    );
    return this.service.publish(user, {
      title: asStr(body.title),
      description: asStr(body.description),
      videoType: asStr(body.videoType),
      sampleUrl: asStr(body.sampleUrl),
      coverUrl: asStr(body.coverUrl),
      referenceImages: Array.isArray(body.referenceImages)
        ? body.referenceImages.map((item) => String(item))
        : [],
      prompt: asStr(body.prompt),
      modelChannelName: asStr(body.modelChannelName),
      modelName: asStr(body.modelName),
      viewCost: asNum(body.viewCost),
    });
  }

  remove(user: CurrentUser, id: string) {
    return this.service.remove(user, this.idOf(id));
  }

  favorite(user: CurrentUser, id: string) {
    this.socialWindow.consume(user.userId, '操作太频繁，请稍后再试');
    return this.service.setFavorite(user, this.idOf(id), true);
  }

  unfavorite(user: CurrentUser, id: string) {
    this.socialWindow.consume(user.userId, '操作太频繁，请稍后再试');
    return this.service.setFavorite(user, this.idOf(id), false);
  }

  rate(user: CurrentUser, id: string, body: HandlerBody) {
    this.socialWindow.consume(user.userId, '操作太频繁，请稍后再试');
    const score = Math.trunc(Number(body.score));
    return this.service.rate(user, this.idOf(id), score);
  }

  generate(
    user: CurrentUser,
    token: string | undefined,
    id: string,
    body: HandlerBody,
  ) {
    this.generateWindow.consume(user.userId, '操作太频繁，请稍后再试');
    const models = (body.models || {}) as {
      video?: { channelId?: unknown; model?: unknown };
    };
    return this.service.generate(user, token, this.idOf(id), {
      prompt: asStr(body.prompt),
      referenceImages: Array.isArray(body.referenceImages)
        ? body.referenceImages.map((item) => String(item))
        : undefined,
      duration: body.duration === undefined ? undefined : Number(body.duration),
      ratio: body.ratio === undefined ? undefined : asStr(body.ratio),
      resolution:
        body.resolution === undefined ? undefined : asStr(body.resolution),
      models: {
        video: {
          channelId: Number(models.video?.channelId ?? 0),
          model: asStr(models.video?.model),
        },
      },
    });
  }

  adminSettings() {
    return this.service.settings();
  }

  adminSaveSettings(token: string | undefined, body: HandlerBody) {
    return this.service.saveSettings(
      {
        showAiworkin:
          body.showAiworkin === undefined
            ? undefined
            : asBool(body.showAiworkin),
        mode:
          body.mode === 'MANUAL' || body.mode === 'SCHEDULED'
            ? body.mode
            : undefined,
        intervalMinutes:
          body.intervalMinutes === undefined
            ? undefined
            : asNum(body.intervalMinutes),
      },
      token || videoTemplateSyncToken(),
    );
  }

  adminSync(token: string | undefined) {
    return this.service.syncNow(token || videoTemplateSyncToken(), 'MANUAL');
  }

  private idOf(raw: string) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '模版编号无效');
    }
    return id;
  }
}
