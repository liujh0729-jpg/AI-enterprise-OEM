import { ok } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { AipddAssetClient, mimeOf } from './aipdd-asset.client';
import { ContentAssetService } from './asset-registry.service';
import { ContentModelSettingService } from './model-setting.service';
import { ContentAgentService, type StreamEmit } from './agent.service';
import { ContentAgentScheduleService } from './agent-schedule.service';
import { ContentAgentAssistantService } from './agent-assistant.service';
import type {
  AssistantHttpResponse,
  AssistantRequest,
} from './agent-assistant.channel';
import { ContentAgentLibraryService } from './agent-library.service';
import { ContentJobService } from './content-job.service';
import { DigitalAssetService } from './digital-asset.service';
import { AssetShareService } from './asset-share.service';
import { aipddBaseUrl } from './content-shared';

/** 允许上传的素材类型：图片 / 视频 / 音频 / 文本（模型网关都要 URL，这里只做中转）。 */
const UPLOAD_EXT_KIND: Record<string, string> = {
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  gif: 'image',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  txt: 'text',
  md: 'text',
};

const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

export class ContentController {
  constructor(
    private readonly settings: ContentModelSettingService,
    private readonly assets: ContentAssetService,
    private readonly client: AipddAssetClient,
    private readonly agent: ContentAgentService,
    private readonly jobs: ContentJobService,
    private readonly digitalAssets: DigitalAssetService,
    private readonly library: ContentAgentLibraryService,
    private readonly schedules: ContentAgentScheduleService,
    private readonly assistants: ContentAgentAssistantService,
    private readonly assetShares: AssetShareService,
  ) {}

  async getSettings(user: CurrentUser, token?: string) {
    return ok(await this.settings.settings(user, token));
  }

  async saveSettings(
    user: CurrentUser,
    body: Record<string, unknown>,
    token?: string,
  ) {
    return ok(await this.settings.saveSettings(user, body, token));
  }

  async saveChannel(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.settings.saveChannel(user, body));
  }

  async removeChannel(user: CurrentUser, id: string) {
    return ok(await this.settings.removeChannel(user, id));
  }

  async testChannel(
    user: CurrentUser,
    body: Record<string, unknown>,
    token?: string,
  ) {
    return ok(await this.settings.testChannel(user, body, token));
  }

  async models(
    user: CurrentUser,
    query: Record<string, unknown>,
    token?: string,
  ) {
    const channelId = Number(query.channelId || 0);
    return ok(await this.settings.models(user, channelId, token));
  }

  async listAssets(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.assets.list(user, query));
  }

  async registerAsset(user: CurrentUser, id: string, token?: string) {
    return ok(await this.assets.retry(user, token, id));
  }

  // ---------- 内容创作任务 ----------

  async listJobs(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.jobs.list(user, query));
  }

  async createJob(
    user: CurrentUser,
    token: string | undefined,
    body: Record<string, unknown>,
  ) {
    return ok(await this.jobs.create(user, token, body));
  }

  async job(user: CurrentUser, id: string) {
    return ok(await this.jobs.get(user, id));
  }

  async cancelJob(user: CurrentUser, id: string) {
    return ok(await this.jobs.cancel(user, id));
  }

  // ---------- Agent 技能 ----------

  async listSkills(user: CurrentUser) {
    return ok(await this.agent.listSkills(user));
  }

  async toggleSkill(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.agent.toggleSkill(user, id, body));
  }

  async removeSkill(user: CurrentUser, id: string) {
    return ok(await this.agent.removeSkill(user, id));
  }

  async skillRevisions(user: CurrentUser, id: string) {
    return ok(await this.agent.skillRevisions(user, id));
  }

  async restoreSkill(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.agent.restoreSkill(user, id, body));
  }

  // ---------- Agent 插件 ----------

  async listPlugins(user: CurrentUser) {
    return ok(await this.agent.listPlugins(user));
  }

  async togglePlugin(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.agent.togglePlugin(user, id, body));
  }

  async removePlugin(user: CurrentUser, id: string) {
    return ok(await this.agent.removePlugin(user, id));
  }

  async pluginRevisions(user: CurrentUser, id: string) {
    return ok(await this.agent.pluginRevisions(user, id));
  }

  async restorePlugin(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.agent.restorePlugin(user, id, body));
  }

  // ---------- Agent 专家（全站共用，创建人可删） ----------

  async listExperts(user: CurrentUser) {
    return ok(await this.agent.listExperts(user));
  }

  async createExpert(
    user: CurrentUser,
    token: string | undefined,
    body: Record<string, unknown>,
  ) {
    return ok(await this.agent.createExpert(user, token, body));
  }

  async removeExpert(user: CurrentUser, id: string) {
    return ok(await this.agent.removeExpert(user, id));
  }

  // ---------- MCP 连接器（内置一条本站 MCP Server） ----------

  async listConnectors(user: CurrentUser) {
    return ok(await this.agent.listConnectors(user));
  }

  async createConnector(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.agent.createConnector(user, body));
  }

  async updateConnector(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.agent.updateConnector(user, id, body));
  }

  async removeConnector(user: CurrentUser, id: string) {
    return ok(await this.agent.removeConnector(user, id));
  }

  async testConnector(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.agent.testConnector(user, body));
  }

  /** 上传 zip 技能包：包内 SKILL.md 必须存在，其余文本文件一并存下。 */
  async importSkill(user: CurrentUser, file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '文件内容为空');
    }
    if (bytes.length > 5 * 1024 * 1024) {
      throw new BusinessException(ErrorCode.PAYLOAD_TOO_LARGE);
    }
    return ok(
      await this.agent.importSkill(user, bytes, file.name || 'skill.zip'),
    );
  }

  /** 上传 zip 插件包：包内 plugin.json 或 PLUGIN.md 必须存在，其余文本文件一并存下。 */
  async importPlugin(user: CurrentUser, file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '文件内容为空');
    }
    if (bytes.length > 5 * 1024 * 1024) {
      throw new BusinessException(ErrorCode.PAYLOAD_TOO_LARGE);
    }
    return ok(
      await this.agent.importPlugin(user, bytes, file.name || 'plugin.zip'),
    );
  }

  // ---------- Agent 会话与长期记忆 ----------

  async listConversations(user: CurrentUser) {
    return ok(await this.agent.listConversations(user));
  }

  async createConversation(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.agent.createConversation(user, body));
  }

  async updateConversation(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.agent.updateConversation(user, id, body));
  }

  async removeConversation(user: CurrentUser, id: string) {
    return ok(await this.agent.removeConversation(user, id));
  }

  async messages(user: CurrentUser, id: string) {
    return ok(await this.agent.messages(user, id));
  }

  async memories(user: CurrentUser) {
    return ok(await this.agent.memories(user));
  }

  async saveMemories(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.agent.saveMemories(user, body));
  }

  // ---------- 数字分身（一个账号多个风格 + 人设，记忆共用一套） ----------

  async personas(user: CurrentUser) {
    return ok(await this.agent.listPersonas(user));
  }

  async createPersona(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.agent.createPersona(user, body));
  }

  async updatePersona(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.agent.updatePersona(user, id, body));
  }

  async deletePersona(user: CurrentUser, id: string) {
    return ok(await this.agent.removePersona(user, id));
  }

  // ---------- Agent 资料库（数字资产里挑文档进来，供模型按问题检索） ----------

  async listLibrary(user: CurrentUser) {
    return ok(await this.library.list(user));
  }

  async libraryAdd(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.library.add(user, body));
  }

  async libraryRemove(user: CurrentUser, id: string) {
    return ok(await this.library.remove(user, id));
  }

  async libraryNodes(user: CurrentUser, id: string) {
    return ok(await this.library.nodes(user, id));
  }

  async librarySearch(
    user: CurrentUser,
    token: string | undefined,
    body: Record<string, unknown>,
  ) {
    return ok(await this.library.search(user, token, body));
  }

  async libraryPublish(
    user: CurrentUser,
    token: string | undefined,
    body: Record<string, unknown>,
  ) {
    return ok(await this.library.publish(user, token, body));
  }

  async libraryDrafts(user: CurrentUser) {
    return ok(await this.library.drafts(user));
  }

  async libraryDraftDecide(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.library.decideDraft(user, id, body));
  }

  async listSchedules(user: CurrentUser) {
    return ok(await this.schedules.list(user));
  }

  async saveSchedule(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.schedules.save(user, body));
  }

  async updateSchedule(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.schedules.update(user, id, body));
  }

  async removeSchedule(user: CurrentUser, id: string) {
    return ok(await this.schedules.remove(user, id));
  }

  async scheduleRuns(user: CurrentUser, id: string) {
    return ok(await this.schedules.runs(user, id));
  }

  async runScheduleNow(
    user: CurrentUser,
    token: string | undefined,
    id: string,
  ) {
    return ok(await this.schedules.runNow(user, id, token));
  }

  async listAssistantChannels(user: CurrentUser) {
    return ok(await this.assistants.list(user));
  }

  async saveAssistantChannel(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.assistants.save(user, body));
  }

  async updateAssistantChannel(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.assistants.update(user, id, body));
  }

  async removeAssistantChannel(user: CurrentUser, id: string) {
    return ok(await this.assistants.remove(user, id));
  }

  async testAssistantChannel(user: CurrentUser, id: string) {
    return ok(await this.assistants.test(user, id));
  }

  async assistantMessages(user: CurrentUser, id: string) {
    return ok(await this.assistants.messages(user, id));
  }

  /** 第三方消息平台回调：原样返回平台要求的应答，不走统一信封。 */
  handleAssistantCallback(
    token: string,
    request: AssistantRequest,
  ): Promise<AssistantHttpResponse> {
    return this.assistants.handleCallback(token, request);
  }

  cancelAgent(user: CurrentUser, id: string, runId?: string) {
    return ok(this.agent.cancel(user, id, runId));
  }

  async digitalAssetList(
    user: CurrentUser,
    token: string | undefined,
    query: Record<string, unknown>,
  ) {
    return ok(await this.digitalAssets.list(user, token, query));
  }

  async digitalAssetLabels(user: CurrentUser, token: string | undefined) {
    return ok(await this.digitalAssets.labels(user, token));
  }

  async tagDigitalAsset(
    user: CurrentUser,
    token: string | undefined,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.digitalAssets.tag(user, token, id, body));
  }

  async uploadDigitalAsset(
    user: CurrentUser,
    token: string | undefined,
    file: File,
    fields: Record<string, unknown>,
  ) {
    return ok(await this.digitalAssets.upload(user, token, file, fields));
  }

  async sharedAssets(user: CurrentUser) {
    return ok(await this.assetShares.list(user));
  }

  async shareTargets(user: CurrentUser) {
    return ok(await this.assetShares.targets(user));
  }

  async shareAsset(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.assetShares.share(user, body));
  }

  async unshareAsset(user: CurrentUser, id: string) {
    return ok(await this.assetShares.unshare(user, id));
  }

  async streamAgent(
    user: CurrentUser,
    token: string | undefined,
    id: string,
    body: Record<string, unknown>,
    emit: StreamEmit,
  ) {
    return this.agent.stream(user, token, id, body, emit);
  }

  /** 素材上传：直接落到 AIPDD 数字资产云，返回模型网关可抓取的公网直链。 */
  async upload(user: CurrentUser, token: string | undefined, file: File) {
    const name = String(file.name || 'upload.bin');
    const ext = name.toLowerCase().split('.').pop() || '';
    const kind = UPLOAD_EXT_KIND[ext];
    if (!kind) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '仅支持 jpg / png / webp / gif / mp4 / mov / webm / mp3 / wav / m4a / txt / md 格式的素材',
      );
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      throw new BusinessException(ErrorCode.PAYLOAD_TOO_LARGE);
    }
    if (!file.size) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '文件内容为空');
    }
    const apiKey = await this.settings.aipddKey(user, token);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const uploaded = await this.client.upload({
      baseUrl: aipddBaseUrl(),
      apiKey,
      bytes,
      filename: name,
      prefix: `assets/enterprise/${user.userId}/inputs`,
    });
    return {
      url: uploaded.url,
      name,
      size: file.size,
      contentType: mimeOf(name),
      kind,
    };
  }
}
