import type { PrismaService } from '../prisma/prisma.service';
import type { CurrentUser } from '../auth/current-user';
import type { PointsService } from '../points/points.service';
import type { PointsSettingsService } from '../points/points-settings.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { resolveSiteUrl } from '../common/site-url';
import { text } from '../common/api';
import { ModelCatalogService } from './catalog.service';
import { ModelUpstreamService } from './upstream.service';
import { ModelUsageService } from './usage.service';
import { ModelRelayService, upstreamErrorMessage } from './relay.service';
import type { ContentChannelPolicyService } from '../content/channel-policy.service';
import { PlatformDefaultsService } from './platform-defaults.service';
import {
  computePlazaCost,
  estimateMessagesTokens,
  estimateTokens,
  normalizeUsage,
} from './model-plaza.pricing';

type TrialBody = {
  modelId: number;
  prompt: string;
  system: string;
  temperature: number;
  maxTokens: number;
};

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : [];
}

function dayStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** 模型广场契约处理器：Mp_ 用户侧 / AdminMp_ 管理端，由 moduleHandlers 按 operationId 映射。 */
export class ModelPlazaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogSvc: ModelCatalogService,
    private readonly upstreamSvc: ModelUpstreamService,
    private readonly usageSvc: ModelUsageService,
    private readonly relay: ModelRelayService,
    private readonly points: PointsService,
    private readonly settings: PointsSettingsService,
    private readonly contentPolicy: ContentChannelPolicyService,
    private readonly platform: PlatformDefaultsService,
    private readonly requireAdmin: (user: CurrentUser) => void,
  ) {}

  // ---------- 用户侧 ----------

  catalog(user: CurrentUser) {
    return this.catalogSvc.userCatalog(user);
  }

  detail(user: CurrentUser, id: string) {
    return this.catalogSvc.detail(user, Number(id));
  }

  /** 站内在线试用：按目录价实时扣分并落用量（source=IN_APP）。 */
  async trial(user: CurrentUser, body: TrialBody) {
    const modelId = Number(body.modelId);
    if (!Number.isInteger(modelId) || modelId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择要试用的模型');
    }
    const row = await this.prisma.modelCatalog.findUnique({
      where: { id: modelId },
    });
    if (!row || !row.enabled) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '该模型未上架，暂不可试用',
      );
    }
    const endpoints = strings(row.endpoints);
    if (!endpoints.includes('/chat/completions')) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该模型不是对话模型，不支持在线试用',
      );
    }
    await this.usageSvc.assertCanCall(user.userId, {
      provider: row.provider,
      modelKey: row.modelKey,
    });
    const credentials = await this.upstreamSvc.credentials(row.upstreamId);
    const rate = (await this.settings.view()).rate;
    const prompt = text(body.prompt).trim();
    const messages = [
      ...(text(body.system).trim()
        ? [{ role: 'system', content: text(body.system).trim() }]
        : []),
      { role: 'user', content: prompt },
    ];
    const startedAt = Date.now();
    const response = await this.relay.forwardJson(
      credentials,
      '/chat/completions',
      {
        model: row.upstreamModelKey || row.modelKey,
        messages,
        temperature: Number(body.temperature ?? 0.7),
        max_tokens: Number(body.maxTokens || 1024),
        stream: false,
      },
      { signal: undefined, timeoutMs: 120_000 },
    );
    if (!response.ok) {
      await this.usageSvc.log({
        userId: user.userId,
        catalogId: row.id,
        upstreamId: row.upstreamId,
        provider: row.provider,
        modelKey: row.modelKey,
        source: 'IN_APP',
        endpoint: '/chat/completions',
        elapsedMs: Date.now() - startedAt,
        status: 'FAILED',
        message: response.text.slice(0, 200),
      });
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        upstreamErrorMessage(response.status, response.text),
      );
    }
    let payload: {
      choices?: { message?: { content?: string } }[];
      usage?: unknown;
    } = {};
    try {
      payload = JSON.parse(response.text) as typeof payload;
    } catch {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '上游返回的不是合法 JSON',
      );
    }
    const content = String(payload.choices?.[0]?.message?.content ?? '').trim();
    const measured = normalizeUsage(payload);
    const promptTokens =
      measured.promptTokens || estimateMessagesTokens(messages);
    const completionTokens =
      measured.completionTokens || estimateTokens(content);
    const cost = computePlazaCost(row, rate, {
      promptTokens,
      completionTokens,
      cacheReadTokens: measured.cacheReadTokens,
      cacheWriteTokens: measured.cacheWriteTokens,
    });
    const charged = await this.usageSvc.charge(
      user.userId,
      cost.points,
      {
        modelKey: row.modelKey,
        provider: row.provider,
        catalogId: row.id,
        refId: `trial-${row.id}`,
        source: 'IN_APP',
        promptTokens: cost.promptTokens,
        completionTokens: cost.completionTokens,
      },
      { billingUnit: cost.billingUnit },
    );
    await this.usageSvc.log({
      userId: user.userId,
      catalogId: row.id,
      upstreamId: row.upstreamId,
      provider: row.provider,
      modelKey: row.modelKey,
      source: 'IN_APP',
      endpoint: '/chat/completions',
      promptTokens: cost.promptTokens,
      completionTokens: cost.completionTokens,
      cacheReadTokens: cost.cacheReadTokens,
      cacheWriteTokens: cost.cacheWriteTokens,
      billingQuantity: cost.quantity,
      billingUnit: cost.billingUnit,
      pointsCost: charged.points,
      userCardId: charged.cardId,
      cardDeduct: charged.cardDeduct,
      rmbCost: cost.rmb,
      elapsedMs: Date.now() - startedAt,
      status: 'SUCCESS',
      message: charged.cardNote,
    });
    const summary = await this.points.summary(user.userId);
    return {
      content,
      model: row.modelKey,
      promptTokens: cost.promptTokens,
      completionTokens: cost.completionTokens,
      totalTokens:
        cost.promptTokens +
        cost.completionTokens +
        cost.cacheReadTokens +
        cost.cacheWriteTokens,
      pointsCost: charged.points,
      cardId: charged.cardId ?? 0,
      cardDeduct: charged.cardDeduct,
      cardNote: charged.cardNote,
      rmbCost: cost.rmb,
      elapsedMs: Date.now() - startedAt,
      balance: summary.balance,
    };
  }

  usage(
    user: CurrentUser,
    query: {
      page: number;
      pageSize: number;
      source: 'ALL' | 'IN_APP' | 'API';
      modelKey: string;
      from: string;
      to: string;
    },
  ) {
    return this.usageSvc.userList(user.userId, query);
  }

  usageSummary(user: CurrentUser, query: { days: number }) {
    return this.usageSvc.userSummary(user.userId, query.days);
  }

  /** 对外调用连接信息：baseURL + 我的 Key 掩码 + 当日调用数（不返回任何明文）。 */
  async connection(user: CurrentUser) {
    const [siteUrl, settingsView, keys] = await Promise.all([
      resolveSiteUrl(this.prisma),
      this.settings.view(),
      this.prisma.apiKey.findMany({
        where: { userId: user.userId, status: 'ACTIVE' },
        orderBy: { id: 'desc' },
      }),
    ]);
    const ids = keys.map((key) => key.id);
    const counts = ids.length
      ? await this.prisma.modelUsageLog.groupBy({
          by: ['apiKeyId'],
          where: {
            apiKeyId: { in: ids },
            source: 'API',
            createdAt: { gte: dayStart() },
          },
          _count: { _all: true },
        })
      : [];
    const todayOf = (id: number) =>
      counts.find((row) => row.apiKeyId === id)?._count._all ?? 0;
    const dailyLimit = Number(process.env.MODEL_PLAZA_DAILY_LIMIT || 2000);
    return {
      baseUrl: siteUrl ? `${siteUrl}/v1` : '/v1',
      rate: settingsView.rate,
      dailyLimit:
        Number.isFinite(dailyLimit) && dailyLimit > 0
          ? Math.floor(dailyLimit)
          : 2000,
      modelsPath: '/v1/models',
      keys: keys.map((key) => ({
        id: key.id,
        name: key.name || `API Key #${key.id}`,
        masked: key.masked,
        rateLimitDay: key.rateLimitDay,
        callCount: key.callCount,
        todayCalls: todayOf(key.id),
        lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
        createdAt: key.createdAt.toISOString(),
      })),
    };
  }

  /** 我当前继承的平台默认模型：资格、已用额度、各能力生效模型。 */
  platformStatus(user: CurrentUser) {
    return this.platform.userStatus(user.userId);
  }

  // ---------- 管理端 ----------

  overview(user: CurrentUser) {
    this.requireAdmin(user);
    return this.catalogSvc.overview();
  }

  upstreams(user: CurrentUser) {
    this.requireAdmin(user);
    return this.upstreamSvc.list();
  }

  platformDefaults(user: CurrentUser) {
    this.requireAdmin(user);
    return this.platform.view();
  }

  savePlatformDefaults(user: CurrentUser, body: Record<string, unknown>) {
    this.requireAdmin(user);
    return this.platform.save(user.userId, body);
  }

  saveUpstream(
    user: CurrentUser,
    body: {
      id: number;
      name: string;
      provider: string;
      baseUrl: string;
      protocol: 'openai' | 'anthropic';
      apiKey: string;
      enabled: boolean;
      remark: string;
    },
  ) {
    this.requireAdmin(user);
    if (body.protocol === 'anthropic') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '模型广场目前只支持 OpenAI 兼容渠道（/chat/completions 协议）',
      );
    }
    return this.upstreamSvc.save(user.userId, body);
  }

  removeUpstream(user: CurrentUser, id: string) {
    this.requireAdmin(user);
    return this.upstreamSvc.remove(user.userId, Number(id));
  }

  listCatalog(
    user: CurrentUser,
    query: {
      page: number;
      pageSize: number;
      keyword: string;
      provider: string;
      category: string;
      enabled: 'ALL' | 'ON' | 'OFF';
    },
  ) {
    this.requireAdmin(user);
    return this.catalogSvc.adminList(query);
  }

  saveCatalog(user: CurrentUser, body: Record<string, unknown>) {
    this.requireAdmin(user);
    return this.catalogSvc.save(user.userId, body);
  }

  toggleCatalog(user: CurrentUser, id: string, body: { enabled: boolean }) {
    this.requireAdmin(user);
    return this.catalogSvc.toggle(
      user.userId,
      Number(id),
      Boolean(body.enabled),
    );
  }

  removeCatalog(user: CurrentUser, id: string) {
    this.requireAdmin(user);
    return this.catalogSvc.remove(user.userId, Number(id));
  }

  pullModels(
    user: CurrentUser,
    body: {
      upstreamId: number;
      baseUrl: string;
      apiKey: string;
      protocol: 'openai' | 'anthropic';
    },
  ) {
    this.requireAdmin(user);
    if (body.protocol === 'anthropic') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '模型广场目前只支持 OpenAI 兼容渠道',
      );
    }
    return this.catalogSvc.pull(body);
  }

  importModels(user: CurrentUser, body: Record<string, unknown>) {
    this.requireAdmin(user);
    return this.catalogSvc.importModels(user.userId, body);
  }

  seed(user: CurrentUser) {
    this.requireAdmin(user);
    return this.catalogSvc.reseed();
  }

  channelPolicy(user: CurrentUser) {
    this.requireAdmin(user);
    return this.contentPolicy.view();
  }

  saveChannelPolicy(user: CurrentUser, body: unknown) {
    this.requireAdmin(user);
    return this.contentPolicy.save(user, body);
  }

  usageList(
    user: CurrentUser,
    query: {
      page: number;
      pageSize: number;
      source: 'ALL' | 'IN_APP' | 'API';
      modelKey: string;
      from: string;
      to: string;
      userId: string;
    },
  ) {
    this.requireAdmin(user);
    return this.usageSvc.adminList(query);
  }
}
