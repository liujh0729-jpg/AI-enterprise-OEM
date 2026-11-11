import { createHash, randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { ApiEnv } from '../http/types';
import type { Services } from '../http/services';
import { text } from '../common/api';
import { ErrorCode } from '../common/error-code';
import { httpRequest, TransportError } from '../http/transport';
import { isLocalApiKey, parseLocalApiKey } from './localapi';
import {
  platformBudget,
  readPlatformDefaults,
} from './platform-defaults.service';
import {
  computePlazaCost,
  estimateAudioSeconds,
  estimateMessagesTokens,
  estimateTokens,
  normalizeUsage,
} from './model-plaza.pricing';
import type { PlazaUsageInput } from './model-plaza.pricing';
import {
  ResponsesSseTranslator,
  toChatPayload,
  toResponseObject,
} from './model-plaza.responses';

/**
 * 对外通道支持的 POST 路径（目录里登记端点用的同一套口径）。
 * `/v1/responses` 是 Responses 协议入口，收到后翻译成 `/chat/completions`，
 * 因此模型目录只需登记 `/chat/completions` 即可同时服务两类客户端。
 */
const POST_PATHS = new Set([
  '/v1/chat/completions',
  '/v1/responses',
  '/v1/embeddings',
  '/v1/images/generations',
  '/v1/images/edits',
  '/v1/audio/speech',
  '/v1/audio/transcriptions',
  '/v1/videos',
]);

/** 异步任务回查：不重复计费，只按任务号找回上游。 */
const TASK_GET =
  /^\/v1\/(videos|images\/edits|audio\/speech)\/([^/]+?)(\/content)?$/;

type Principal = {
  userId: string;
  apiKeyId: number | null;
  rateLimitDay: number;
  /** 站内 LocalAPI 渠道的进程内令牌：不做 Key 日限额（另有积分与安全闸门） */
  internal: boolean;
};

function bearerToken(header: string | undefined): string | undefined {
  const match = /^\s*bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return match?.[1];
}

/** OpenAI 风格错误体：外部 SDK 只认这个形状，不能套本站 `code/message/data` 信封。 */
function errorResponse(
  status: number,
  message: string,
  type = 'invalid_request_error',
  code: string | null = null,
): Response {
  return new Response(JSON.stringify({ error: { message, type, code } }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function toOpenAiStatus(code: number): number {
  if (code === ErrorCode.POINTS_INSUFFICIENT.code) return 402;
  if (code === ErrorCode.POINTS_ARREARS.code) return 402;
  if (code === ErrorCode.UNAUTHORIZED.code) return 401;
  if (code === ErrorCode.FORBIDDEN.code) return 403;
  if (code === ErrorCode.NOT_FOUND.code) return 404;
  if (code === ErrorCode.RATE_LIMITED.code) return 429;
  if (code === ErrorCode.SERVICE_UNAVAILABLE.code) return 503;
  return 400;
}

function sseHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Nginx 默认会把 SSE 攒起来，显式关掉
    'X-Accel-Buffering': 'no',
  };
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : [];
}

/**
 * 模型广场对外网关：OpenAI 兼容的 `/v1/*`。
 *
 * 鉴权接受两种令牌：
 * - `ek_` 平台签发的 API Key（模型服务 → API Key 管理），受 `rateLimitDay` 日限额；
 * - `lk_` 站内 LocalAPI 渠道的派生令牌（用户在模型设置里选 LocalAPI 时自动带上），
 *   不受 Key 日限额约束，因为站内调用已由安全闸门与积分余额兜底。
 *
 * 计费：与上游 `aipdd.pricing` 完全同口径——token（含缓存读写）、image（按张）、
 * second（按秒）、call（按次）；官方价 × 平台折扣后再按系统汇率折积分。
 * 失败不计费，但会落一条 FAILED 流水。
 */
export function registerModelPlazaPublic(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  const plaza = services.modelPlaza;

  const authenticate = async (
    c: Context<ApiEnv>,
  ): Promise<Principal | Response> => {
    const token =
      c.req.header('x-api-key') || bearerToken(c.req.header('authorization'));
    if (!token) {
      return errorResponse(
        401,
        '缺少 API Key：请在 Authorization: Bearer <key> 或 x-api-key 头里提供',
        'authentication_error',
        'missing_api_key',
      );
    }
    if (isLocalApiKey(token)) {
      const userId = parseLocalApiKey(token);
      if (!userId) {
        return errorResponse(
          401,
          'LocalAPI 内置凭据无效',
          'authentication_error',
          'invalid_api_key',
        );
      }
      return { userId, apiKeyId: null, rateLimitDay: 0, internal: true };
    }
    const keyHash = createHash('sha256').update(token).digest('hex');
    const row = await services.prisma.apiKey.findFirst({
      where: { keyHash, status: 'ACTIVE' },
    });
    if (!row) {
      return errorResponse(
        401,
        'API Key 无效或已吊销',
        'authentication_error',
        'invalid_api_key',
      );
    }
    const account = await services.prisma.account.findUnique({
      where: { id: Number(row.userId) },
      select: { status: true },
    });
    if (!account || account.status !== 'ACTIVE') {
      return errorResponse(
        403,
        '账号不可用',
        'permission_error',
        'account_inactive',
      );
    }
    const rateLimitDay = Number(row.rateLimitDay || 0);
    if (rateLimitDay > 0) {
      const used = await plaza.usage.todayCallsByKey(row.id);
      if (used >= rateLimitDay) {
        return errorResponse(
          429,
          `该 API Key 今日调用已达上限（${rateLimitDay} 次），请明天再试`,
          'rate_limit_error',
          'rate_limit_exceeded',
        );
      }
    }
    const pointsQuota =
      row.pointsQuota === null || row.pointsQuota === undefined
        ? null
        : Number(row.pointsQuota);
    if (pointsQuota !== null && Number.isFinite(pointsQuota)) {
      const spent = await plaza.usage.pointsUsedByKey(row.id);
      if (spent >= pointsQuota) {
        return errorResponse(
          402,
          `该 API Key 的积分额度已用完（${pointsQuota} 积分），请在「模型服务 → API Key 管理」调高额度或重置`,
          'insufficient_quota',
          'points_quota_exhausted',
        );
      }
    }
    return {
      userId: row.userId,
      apiKeyId: row.id,
      rateLimitDay,
      internal: false,
    };
  };

  const modelRow = async (modelKey: string) => {
    if (!modelKey) return null;
    return services.prisma.modelCatalog.findFirst({
      where: { modelKey, enabled: true },
    });
  };

  /** 统一结算：按上游计费单位算成本 → 扣分 + 落流水；失败不计费。 */
  const settle = async (input: {
    principal: Principal;
    row: {
      id: number;
      upstreamId: number;
      provider: string;
      modelKey: string;
      quotaType: string;
      billingUnit: string;
      inputRmbPrice: unknown;
      outputRmbPrice: unknown;
      callRmbPrice: unknown;
      cacheReadRmbPrice: unknown;
      cacheWriteRmbPrice: unknown;
      minimumRmb: unknown;
      tiers: unknown;
      components: unknown;
      discountRate: unknown;
    };
    endpoint: string;
    usage: PlazaUsageInput;
    isStream: boolean;
    elapsedMs: number;
    requestId: string;
    taskId?: string;
    status?: 'SUCCESS' | 'FAILED';
    message?: string;
  }) => {
    const rate = (await services.points.settings.view()).rate;
    const cost = computePlazaCost(input.row, rate, input.usage);
    const success = (input.status ?? 'SUCCESS') === 'SUCCESS';
    // 单次限额：站内平台模型调用最多按限额扣分；超出部分由平台承担（管理员显式设置的安全帽）。
    const limits = input.principal.internal
      ? await readPlatformDefaults(services.prisma)
          .then((config) => config.limits)
          .catch(() => null)
      : null;
    const billable =
      limits && limits.perCallPoints > 0
        ? Math.min(cost.points, limits.perCallPoints)
        : cost.points;
    const cardCharge = success
      ? await plaza.usage.charge(
          input.principal.userId,
          billable,
          {
            modelKey: input.row.modelKey,
            provider: input.row.provider,
            catalogId: input.row.id,
            refId: input.taskId || input.requestId,
            source: 'API',
            promptTokens: cost.promptTokens,
            completionTokens: cost.completionTokens,
          },
          {
            billingUnit: cost.billingUnit,
            quantity: cost.quantity,
            tier: input.usage.tier,
          },
        )
      : null;
    const charged = cardCharge?.points ?? 0;
    await plaza.usage.log({
      userId: input.principal.userId,
      catalogId: input.row.id,
      upstreamId: input.row.upstreamId,
      provider: input.row.provider,
      modelKey: input.row.modelKey,
      source: 'API',
      apiKeyId: input.principal.apiKeyId,
      requestId: input.requestId,
      refId: input.taskId || '',
      endpoint: input.endpoint,
      promptTokens: cost.promptTokens,
      completionTokens: cost.completionTokens,
      cacheReadTokens: cost.cacheReadTokens,
      cacheWriteTokens: cost.cacheWriteTokens,
      billingQuantity: cost.quantity,
      billingUnit: cost.billingUnit,
      pointsCost: charged,
      userCardId: cardCharge?.cardId ?? null,
      cardDeduct: cardCharge?.cardDeduct ?? 0,
      rmbCost: success ? cost.rmb : 0,
      elapsedMs: input.elapsedMs,
      isStream: input.isStream,
      status: success ? 'SUCCESS' : 'FAILED',
      message: [input.message || '', cardCharge?.cardNote ?? '']
        .filter(Boolean)
        .join('；'),
    });
    if (input.principal.apiKeyId)
      await plaza.usage.touchKey(input.principal.apiKeyId);
    return charged;
  };

  /** 分档上下文：图像看 quality/size，视频看 resolution。 */
  const tierOf = (payload: Record<string, unknown>) => ({
    quality: typeof payload.quality === 'string' ? payload.quality : undefined,
    size: typeof payload.size === 'string' ? payload.size : undefined,
    resolution:
      typeof payload.resolution === 'string' ? payload.resolution : undefined,
  });

  const imageCountOf = (payload: Record<string, unknown>) =>
    Math.max(1, Math.floor(Number(payload.n ?? 1) || 1));

  /** 表单里的文件（/images/edits 的参考图、/audio/transcriptions 的音频）。 */
  const formFiles = (data: FormData, field: string) =>
    data
      .getAll(field)
      .filter(
        (item): item is File =>
          typeof item === 'object' &&
          item !== null &&
          'size' in item &&
          typeof item.size === 'number',
      );

  /** 请求体/上游响应 → 本次调用的计量输入（与上游 billing_unit 一一对应）。 */
  const usageOf = (input: {
    endpoint: string;
    payload: Record<string, unknown>;
    parsed: Record<string, unknown>;
    form: FormData | null;
  }): PlazaUsageInput => {
    const { endpoint, payload, parsed, form } = input;
    const measured = normalizeUsage(parsed);
    if (endpoint === '/chat/completions') {
      return {
        promptTokens:
          measured.promptTokens || estimateMessagesTokens(payload.messages),
        completionTokens:
          measured.completionTokens ||
          estimateTokens(
            String(
              (
                parsed.choices as
                  { message?: { content?: string } }[] | undefined
              )?.[0]?.message?.content ?? '',
            ),
          ),
        cacheReadTokens: measured.cacheReadTokens,
        cacheWriteTokens: measured.cacheWriteTokens,
      };
    }
    if (endpoint === '/embeddings') {
      return {
        promptTokens:
          measured.promptTokens ||
          estimateTokens(JSON.stringify(payload.input ?? '')),
      };
    }
    if (endpoint === '/images/generations' || endpoint === '/images/edits') {
      return {
        quantity: imageCountOf(payload),
        tier: tierOf(payload),
        referenceImages:
          endpoint === '/images/edits' && form
            ? formFiles(form, 'image').length
            : 0,
      };
    }
    if (endpoint === '/videos') {
      const duration = Number(payload.duration ?? parsed.duration ?? 0);
      return {
        quantity: Number.isFinite(duration) && duration > 0 ? duration : 1,
        tier: tierOf(payload),
      };
    }
    if (endpoint === '/audio/transcriptions') {
      const duration = Number(parsed.duration ?? 0);
      const file = form ? formFiles(form, 'file')[0] : undefined;
      return {
        quantity:
          Number.isFinite(duration) && duration > 0
            ? duration
            : estimateAudioSeconds({
                bytes: file?.size ?? 0,
                mime: file?.type ?? '',
              }),
      };
    }
    // /audio/speech：上游按次
    return { quantity: 1 };
  };

  /**
   * 调用前估算：站内通道先按「提示词 + 请求的最大输出」预估本次大概要扣多少分，
   * 避免一次超额调用直接把余额打穿；真实结算仍以调用后用量为准。
   */
  const estimateUsageOf = (input: {
    endpoint: string;
    payload: Record<string, unknown>;
    form: FormData | null;
  }): PlazaUsageInput => {
    const { endpoint, payload, form } = input;
    if (endpoint === '/chat/completions') {
      const maxTokens = Number(
        payload.max_tokens ?? payload.max_completion_tokens,
      );
      return {
        promptTokens: estimateMessagesTokens(payload.messages),
        completionTokens:
          Number.isFinite(maxTokens) && maxTokens > 0
            ? Math.floor(maxTokens)
            : 1024,
      };
    }
    if (endpoint === '/embeddings') {
      return {
        promptTokens: estimateTokens(JSON.stringify(payload.input ?? '')),
      };
    }
    return usageOf({ endpoint, payload, parsed: {}, form });
  };

  app.all('/v1/*', async (c) => {
    const path = c.req.path.replace(/\/+$/, '') || '/v1';
    const method = c.req.method.toUpperCase();

    const principal = await authenticate(c);
    if (principal instanceof Response) return principal;
    // 功能开关与站内菜单同口径：板块关掉后，已签发的 Key 也一并拒
    if (
      !(await services.feature.toggle.isOpen('model-plaza', principal.userId))
    ) {
      return errorResponse(
        403,
        '模型广场已被管理员关闭',
        'permission_error',
        'feature_closed',
      );
    }

    // GET /v1/models：只出已上架模型，字段对齐 OpenAI 的 list 形状
    if (method === 'GET' && path === '/v1/models') {
      const rows = await services.prisma.modelCatalog.findMany({
        where: { enabled: true },
        orderBy: [{ sort: 'desc' }, { id: 'asc' }],
      });
      return c.json({
        object: 'list',
        data: rows.map((row) => ({
          id: row.modelKey,
          object: 'model',
          created: Math.floor(row.createdAt.getTime() / 1000),
          owned_by: row.provider.toLowerCase(),
          display_name: row.displayName || row.modelKey,
          quota_type: row.quotaType,
          billing_unit: row.billingUnit,
          discount_rate: Number(row.discountRate ?? 1),
          endpoints: strings(row.endpoints),
        })),
      });
    }

    // 异步任务回查：按任务号找回发起它的上游，不重复计费
    const taskMatch = method === 'GET' ? TASK_GET.exec(path) : null;
    if (taskMatch) {
      const taskId = taskMatch[2];
      const found = await plaza.usage.upstreamOfTask(principal.userId, taskId);
      if (!found) {
        return errorResponse(
          404,
          '任务不存在或不属于当前账号',
          'invalid_request_error',
          'task_not_found',
        );
      }
      const credentials = await plaza.upstreams.credentials(found.upstreamId);
      const target = path.slice('/v1'.length);
      const response = await plaza.relay.forwardGet(credentials, target, {
        signal: c.req.raw.signal,
      });
      return new Response(response.text, {
        status: response.status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    if (method !== 'POST' || !POST_PATHS.has(path)) {
      return errorResponse(
        404,
        `不支持的接口：${method} ${path}`,
        'invalid_request_error',
        'unknown_endpoint',
      );
    }

    const contentType = c.req.header('content-type') || '';
    let bodyText = '';
    let payload: Record<string, unknown> = {};
    let form: FormData | null = null;
    if (contentType.includes('multipart/form-data')) {
      form = await c.req.formData();
      payload = { model: text(form.get('model')) };
    } else {
      bodyText = await c.req.text();
      try {
        payload = bodyText
          ? (JSON.parse(bodyText) as Record<string, unknown>)
          : {};
      } catch {
        return errorResponse(
          400,
          '请求体不是合法 JSON',
          'invalid_request_error',
          'invalid_json',
        );
      }
    }

    const modelKey = text(payload.model).trim();
    if (!modelKey) {
      return errorResponse(
        400,
        '请求体缺少 model 字段',
        'invalid_request_error',
        'missing_model',
      );
    }
    const row = await modelRow(modelKey);
    if (!row) {
      return errorResponse(
        404,
        `模型 ${modelKey} 不存在或未上架`,
        'invalid_request_error',
        'model_not_found',
      );
    }
    // Responses 协议（Codex 一类客户端）翻译成 chat/completions 走同一条通道：
    // 计量、闸门、结算全部沿用 chat 口径，只有出入参与事件形状换了外壳。
    const isResponses = path === '/v1/responses';
    if (isResponses) payload = toChatPayload(payload);
    const endpoint = isResponses
      ? '/chat/completions'
      : path.slice('/v1'.length);
    if (!strings(row.endpoints).includes(endpoint)) {
      return errorResponse(
        400,
        `模型 ${modelKey} 不支持 ${isResponses ? '/v1/responses（按 /chat/completions 处理）' : endpoint}，可用端点：${strings(row.endpoints).join('、') || '无'}`,
        'invalid_request_error',
        'unsupported_endpoint',
      );
    }

    // 站内通道（平台默认模型 / LocalAPI）：先核日/月额度与预估费用，再动上游。
    if (principal.internal) {
      const limits = await readPlatformDefaults(services.prisma)
        .then((config) => config.limits)
        .catch(() => null);
      if (limits) {
        const budget = await platformBudget(
          services.prisma,
          principal.userId,
          limits,
        );
        if (!budget.allowed) {
          return errorResponse(
            402,
            `平台模型额度已用完（今日 ${budget.todayPoints} / 本月 ${budget.monthPoints} 积分），请明天再试或联系管理员调整限额`,
            'insufficient_quota',
            'insufficient_points',
          );
        }
        const rate = (await services.points.settings.view()).rate;
        const estimateInput = estimateUsageOf({ endpoint, payload, form });
        const estimated = computePlazaCost(row, rate, estimateInput);
        if (estimated.points > 0) {
          // 卡感知闸门：有日卡时只按「卡没覆盖的差额」核余额，否则零余额用户明明持卡却被拦。
          const cover = await plaza.usage.quoteCard(
            principal.userId,
            { provider: row.provider, modelKey: row.modelKey },
            {
              billingUnit: estimated.billingUnit,
              quantity: estimated.quantity,
              tier: estimateInput.tier,
              promptTokens: estimated.promptTokens,
              completionTokens: estimated.completionTokens,
            },
            estimated.points,
          );
          if (cover.points > 0) {
            const summary = await services.points.ledger.summary(
              principal.userId,
            );
            if (summary.balance < cover.points) {
              return errorResponse(
                402,
                `${cover.hasCard ? '本次有时长卡抵扣，卡未覆盖部分' : '本次调用'}预计需要 ${cover.points.toFixed(4)} 积分，当前余额 ${summary.balance}，请充值后再试`,
                'insufficient_quota',
                'insufficient_points',
              );
            }
          }
        }
      }
    }

    // 余额闸门：零余额/欠费先拒，避免烧上游额度（持有该模型可用卡时放行）
    try {
      await plaza.usage.assertCanCall(principal.userId, {
        provider: row.provider,
        modelKey: row.modelKey,
      });
    } catch (error) {
      const code =
        error instanceof Error && 'errorCode' in error
          ? (error as { errorCode: { code: number } }).errorCode.code
          : 0;
      const message = error instanceof Error ? error.message : '余额不足';
      return errorResponse(
        toOpenAiStatus(code),
        message,
        'insufficient_quota',
        'insufficient_points',
      );
    }

    const credentials = await plaza.upstreams.credentials(row.upstreamId);
    const requestId = randomUUID();
    const startedAt = Date.now();

    // 对话流式：强制上游回传 usage，边转发边观察最后一个 chunk
    if (endpoint === '/chat/completions' && payload.stream === true) {
      // Responses 客户端只认 response.* 事件，这里逐帧改写；计费仍读原始帧。
      const translator = isResponses
        ? new ResponsesSseTranslator(
            row.modelKey,
            `resp_${requestId.replace(/-/g, '')}`,
          )
        : null;
      const encoder = new TextEncoder();
      const upstreamPayload = {
        ...payload,
        stream_options: {
          ...((payload.stream_options as object) || {}),
          include_usage: true,
        },
      };
      const upstream = await plaza.relay.forwardStream(
        credentials,
        endpoint,
        upstreamPayload,
        { signal: c.req.raw.signal },
      );
      if (!upstream.ok || !upstream.body) {
        const detail = await upstream.text().catch(() => '');
        await settle({
          principal,
          row,
          endpoint,
          usage: {
            promptTokens: estimateMessagesTokens(payload.messages),
          },
          isStream: true,
          elapsedMs: Date.now() - startedAt,
          requestId,
          status: 'FAILED',
          message: detail.slice(0, 200),
        });
        return errorResponse(
          upstream.status || 502,
          `上游返回 HTTP ${upstream.status}：${detail.slice(0, 300)}`,
          'upstream_error',
          'upstream_failed',
        );
      }
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completionText = '';
      let measuredPrompt = 0;
      let measuredCompletion = 0;
      let measuredCacheRead = 0;
      let measuredCacheWrite = 0;
      let finished = false;
      const observe = (chunk: Uint8Array) => {
        buffer += decoder.decode(chunk, { stream: true });
        let index = buffer.indexOf('\n');
        while (index >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data && data !== '[DONE]') {
              try {
                const json = JSON.parse(data) as {
                  usage?: unknown;
                  choices?: { delta?: { content?: string } }[];
                };
                const usage = normalizeUsage(json);
                if (usage.promptTokens) measuredPrompt = usage.promptTokens;
                if (usage.completionTokens)
                  measuredCompletion = usage.completionTokens;
                if (usage.cacheReadTokens)
                  measuredCacheRead = usage.cacheReadTokens;
                if (usage.cacheWriteTokens)
                  measuredCacheWrite = usage.cacheWriteTokens;
                const delta = json.choices?.[0]?.delta?.content;
                if (typeof delta === 'string') completionText += delta;
              } catch {
                // 单条事件解析失败不影响整体转发
              }
            }
          }
          index = buffer.indexOf('\n');
        }
      };
      const finish = async () => {
        if (finished) return;
        finished = true;
        await settle({
          principal,
          row,
          endpoint,
          usage: {
            promptTokens:
              measuredPrompt || estimateMessagesTokens(payload.messages),
            completionTokens:
              measuredCompletion || estimateTokens(completionText),
            cacheReadTokens: measuredCacheRead,
            cacheWriteTokens: measuredCacheWrite,
          },
          isStream: true,
          elapsedMs: Date.now() - startedAt,
          requestId,
        }).catch(() => undefined);
      };
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          if (translator) {
            controller.enqueue(encoder.encode(translator.start()));
          }
        },
        async pull(controller) {
          const chunk = await reader.read();
          if (chunk.done) {
            if (translator) {
              controller.enqueue(
                encoder.encode(
                  translator.end({
                    usage: {
                      prompt_tokens: measuredPrompt,
                      completion_tokens: measuredCompletion,
                    },
                  }),
                ),
              );
            }
            controller.close();
            await finish();
            return;
          }
          if (translator) {
            const events = translator.feed(chunk.value);
            controller.enqueue(encoder.encode(events));
          } else {
            controller.enqueue(chunk.value);
          }
          observe(chunk.value);
        },
        async cancel(reason) {
          await finish();
          await reader.cancel(reason).catch(() => undefined);
        },
      });
      return new Response(stream, { status: 200, headers: sseHeaders() });
    }

    // 其余（非流式对话 / 向量 / 图像 / 语音 / 视频提交）：JSON 与 multipart 分别透传
    let upstreamResponse: { status: number; ok: boolean; text: string };
    if (form) {
      const url = `${String(credentials.baseUrl).replace(/\/+$/, '')}${endpoint}`;
      try {
        const result = await httpRequest<string>(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${credentials.apiKey}`,
            ...(credentials.protocol === 'anthropic'
              ? { 'x-api-key': credentials.apiKey }
              : {}),
          },
          body: form,
          signal: c.req.raw.signal,
          timeoutMs: 300_000,
          readAs: 'text',
          operation: 'model-plaza:relay-form',
        });
        upstreamResponse = {
          status: result.status,
          ok: result.ok,
          text: result.data,
        };
      } catch (error) {
        if (error instanceof TransportError && error.kind === 'cancelled') {
          return errorResponse(
            499,
            '请求已取消',
            'upstream_error',
            'cancelled',
          );
        }
        return errorResponse(
          502,
          `上游请求失败：${error instanceof Error ? error.message : '连接失败'}`,
          'upstream_error',
          'upstream_failed',
        );
      }
    } else {
      upstreamResponse = await plaza.relay.forwardJson(
        credentials,
        endpoint,
        payload,
        { signal: c.req.raw.signal, timeoutMs: 300_000 },
      );
    }

    if (!upstreamResponse.ok) {
      await settle({
        principal,
        row,
        endpoint,
        usage:
          row.billingUnit === 'token'
            ? { promptTokens: estimateMessagesTokens(payload.messages) }
            : { quantity: 1 },
        isStream: false,
        elapsedMs: Date.now() - startedAt,
        requestId,
        status: 'FAILED',
        message: upstreamResponse.text.slice(0, 200),
      });
      return errorResponse(
        upstreamResponse.status >= 400 ? upstreamResponse.status : 502,
        `上游返回 HTTP ${upstreamResponse.status}：${upstreamResponse.text.slice(0, 300)}`,
        'upstream_error',
        'upstream_failed',
      );
    }

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(upstreamResponse.text) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    // 异步任务：把上游任务号记进 refId，后续 GET 回查据此找回上游
    const taskId = text(parsed.id || parsed.task_id || parsed.taskId).trim();
    await settle({
      principal,
      row,
      endpoint,
      usage: usageOf({ endpoint, payload, parsed, form }),
      isStream: false,
      elapsedMs: Date.now() - startedAt,
      requestId,
      taskId: taskId && taskId !== requestId ? taskId : '',
    });
    return new Response(
      isResponses
        ? JSON.stringify(
            toResponseObject(parsed, {
              model: row.modelKey,
              id: `resp_${requestId.replace(/-/g, '')}`,
            }),
          )
        : upstreamResponse.text,
      {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  });
}
