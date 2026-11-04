import { RateWindow } from '../common/rate-window';
import { CurrentUser } from '../auth/current-user';
import type { CommunityAwardSettings } from '@enterprise/contracts';
import { CommunityService } from './community.service';
import { CommunityAwardService } from './community-award.service';
import { CommunityImportService } from './community-import.service';

type HandlerBody = Record<string, unknown>;

/**
 * 请求体是 unknown 的字典：只认字符串与有限数，其余按空串处理。
 * 直接 String() 会把对象变成 `[object Object]`，后面的枚举判定与文案都会被它污染。
 */
function fieldText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/**
 * 创意社区控制器：方法名与契约 operationId 去 `Community_` / `CommunityAdmin_` 前缀一致（首字母小写），
 * 由 automation-routes 的 moduleHandlers 自动映射并统一包 envelope。
 *
 * 这里只多做一件事：给「会真实出站或写库」的低频动作加进程内固定窗口限流——
 * 运行会烧用户自己的 Comfy Cloud 额度，发布会进审核队列，验密会打上游，
 * 三种都必须挡住连点与脚本刷量。
 */
export class CommunityController {
  /** 提交运行：20 次/分钟/人。 */
  private readonly runWindow = new RateWindow(20, 60_000);
  /** 发布：10 条/天/人（窗口按天，配合审核队列的量）。 */
  private readonly publishWindow = new RateWindow(10, 24 * 60 * 60_000);
  /** Key 校验：10 次/分钟/人（每次都真打上游）。 */
  private readonly keyWindow = new RateWindow(10, 60_000);
  /** 收藏与点赞：60 次/分钟/人。 */
  private readonly socialWindow = new RateWindow(60, 60_000);
  /** 运行输入图上传：20 次/分钟/人（每次都会写本站对象存储）。 */
  private readonly uploadWindow = new RateWindow(20, 60_000);
  /** 迁移预览：10 次/分钟/人（每次都真打上游列表）。 */
  private readonly importPreviewWindow = new RateWindow(10, 60_000);
  /** 开始迁移：3 次/小时/人（会批量下载并写存储，不能连点）。 */
  private readonly importRunWindow = new RateWindow(3, 60 * 60_000);

  constructor(
    readonly service: CommunityService,
    readonly awards: CommunityAwardService,
    readonly importService: CommunityImportService,
  ) {}

  private limit(window: RateWindow, user: CurrentUser, message: string) {
    window.consume(user.userId, message);
  }

  // ---------- 目录 ----------

  categories() {
    return this.service.categories();
  }

  list(
    user: CurrentUser,
    query: {
      page?: number;
      pageSize?: number;
      category?: string;
      group?: string;
      keyword?: string;
      sort?: string;
      runnable?: boolean;
      favorite?: boolean;
    },
  ) {
    return this.service.list(user, query);
  }

  detail(user: CurrentUser, code: string) {
    return this.service.detail(user, code);
  }

  // ---------- 收藏与点赞 ----------

  favorite(user: CurrentUser, code: string) {
    this.limit(this.socialWindow, user, '操作太频繁了，休息一分钟再收藏。');
    return this.service.setFavorite(user, code, true);
  }

  unfavorite(user: CurrentUser, code: string) {
    this.limit(this.socialWindow, user, '操作太频繁了，休息一分钟再取消收藏。');
    return this.service.setFavorite(user, code, false);
  }

  like(user: CurrentUser, code: string) {
    this.limit(this.socialWindow, user, '操作太频繁了，休息一分钟再点赞。');
    return this.service.toggleLike(user, code);
  }

  // ---------- Comfy Cloud 连接 ----------

  connectStatus(user: CurrentUser) {
    return this.service.connectStatus(user);
  }

  saveCredential(user: CurrentUser, body: Record<string, unknown>) {
    this.limit(
      this.keyWindow,
      user,
      '连接校验太频繁，请一分钟后再保存 API Key。',
    );
    return this.service.saveCredential(user, fieldText(body.apiKey));
  }

  testCredential(user: CurrentUser) {
    this.limit(this.keyWindow, user, '连接校验太频繁，请一分钟后再试。');
    return this.service.testCredential(user);
  }

  clearCredential(user: CurrentUser) {
    return this.service.clearCredential(user);
  }

  // ---------- 运行 ----------

  run(user: CurrentUser, code: string, body: Record<string, unknown>) {
    this.limit(
      this.runWindow,
      user,
      '运行太频繁了，请等一分钟再试：跑的是你自己 Comfy Cloud 订阅的额度，本站不会替你排队垫付。',
    );
    const inputs =
      body.inputs &&
      typeof body.inputs === 'object' &&
      !Array.isArray(body.inputs)
        ? (body.inputs as Record<string, unknown>)
        : {};
    return this.service.run(user, code, inputs);
  }

  runStatus(user: CurrentUser, id: string) {
    return this.service.runStatus(user, id);
  }

  /** multipart 端点单独登记（不进 JSON 契约）：字节已由路由读好交下来。 */
  uploadInput(
    user: CurrentUser,
    file: { name: string; type: string; bytes: Buffer },
  ) {
    this.limit(this.uploadWindow, user, '上传图片太频繁，请等一分钟再试。');
    return this.service.uploadInput(user, file);
  }

  cancelRun(user: CurrentUser, id: string) {
    return this.service.cancelRun(user, id);
  }

  myRuns(
    user: CurrentUser,
    query: { page?: number; pageSize?: number; workflowCode?: string },
  ) {
    return this.service.myRuns(user, query);
  }

  // ---------- 我的发布 ----------

  myDrafts(
    user: CurrentUser,
    query: { page?: number; pageSize?: number; status?: string },
  ) {
    return this.service.myDrafts(user, query);
  }

  publish(user: CurrentUser, body: Record<string, unknown>) {
    this.limit(
      this.publishWindow,
      user,
      '今天发布的工作流已经到 10 条，先把已有的一条改好更有价值。',
    );
    return this.service.publish(user, body);
  }

  updateWorkflow(
    user: CurrentUser,
    code: string,
    body: Record<string, unknown>,
  ) {
    this.limit(
      this.publishWindow,
      user,
      '今天修改发布内容的次数已达上限，明天再继续。',
    );
    return this.service.updateWorkflow(user, code, body);
  }

  unpublish(user: CurrentUser, code: string) {
    return this.service.unpublish(user, code);
  }

  // ---------- 平台后台 ----------

  pending(
    user: CurrentUser,
    query: {
      page?: number;
      pageSize?: number;
      status?: string;
      keyword?: string;
    },
  ) {
    return this.service.adminPending(user, query);
  }

  decide(user: CurrentUser, code: string, body: HandlerBody) {
    const action = fieldText(body.action) as
      'approve' | 'reject' | 'recommend' | 'remove';
    return this.service.adminDecide(user, code, action, fieldText(body.note));
  }

  stats(user: CurrentUser) {
    return this.service.adminStats(user);
  }

  settings(user: CurrentUser) {
    return this.service.adminSettings(user);
  }

  saveSettings(user: CurrentUser, body: CommunityAwardSettings) {
    return this.service.adminSaveSettings(user, body);
  }

  // ---------- 迁移 Comfy Cloud 工作流 ----------

  importPreview(user: CurrentUser, body: Record<string, unknown>) {
    this.limit(
      this.importPreviewWindow,
      user,
      '验证太频繁，请一分钟后再试（每次都会真打 Comfy Cloud）。',
    );
    return this.importService.preview(user, body.apiKey);
  }

  importStart(user: CurrentUser, body: Record<string, unknown>) {
    this.limit(
      this.importRunWindow,
      user,
      '迁移太频繁：每小时最多 3 次，等上一批媒体转存完再继续。',
    );
    return this.importService.start(user, body);
  }

  importStatus(user: CurrentUser) {
    return this.importService.status(user);
  }
}
