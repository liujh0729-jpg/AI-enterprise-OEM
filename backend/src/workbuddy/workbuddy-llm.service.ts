import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { geoChatMulti, type ChatMessage } from '../geo/geo-llm.client';
import { httpRequest, TransportError } from '../http/transport';
import { ModelKeyService } from '../aiworkin/model-key.service';
import {
  MAX_TASKS_PER_PLAN,
  normalizePlanSpec,
  shorten,
  specIsReady,
  type PlanSpec,
} from './workbuddy-shared';

/** AIPDD 文字模型服务地址：与 RPA 写脚本同一通道，共用「API Key 管理」里那把 Key。 */
const AIPDD_BASE_URL = 'https://api.aipdd.work/v1';
const MODELS_TIMEOUT_MS = 20000;
/** 澄清是对话式改稿，一轮给 120s 足够。 */
const CLARIFY_TIMEOUT_MS = 120000;
const CLARIFY_MAX_TOKENS = 3000;

type ModelCard = { id: string };

/**
 * 「口水话 → 可执行任务书」的对话通道。
 * 模型 Key 统一用「API Key 管理」那把，这里只保留默认模型偏好；不接触腾讯云凭据。
 */
export class WorkbuddyLlmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly modelKeys: ModelKeyService,
  ) {}

  /** 测试专用：套件里指向本地桩，真实部署不会设置这个变量。 */
  private baseUrl() {
    return String(process.env.GEO_LLM_BASE_URL || '').trim() || AIPDD_BASE_URL;
  }

  async setting(user: CurrentUser, token?: string) {
    const row = await this.prisma.workbuddyLlmSetting.findUnique({
      where: { userId: user.userId },
    });
    const key = await this.modelKeys.status(token);
    return {
      configured: key.configured,
      keyMasked: key.keyMasked,
      model: row?.model || '',
      baseUrl: this.baseUrl(),
    };
  }

  /** 只保存默认模型；Key 统一在「API Key 管理」维护，这里收到一律拒绝。 */
  async save(user: CurrentUser, body: Record<string, unknown>, token?: string) {
    if (text(body.apiKey).trim()) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'API Key 已统一在「API Key 管理」维护，这里只需选择默认模型',
      );
    }
    const model = text(body.model).trim().slice(0, 128);
    const row = await this.prisma.workbuddyLlmSetting.upsert({
      where: { userId: user.userId },
      create: { userId: user.userId, model },
      update: { model },
    });
    await this.identity.audit(
      user.userId,
      'Workbuddy配置默认模型',
      `默认模型${row.model ? ` ${row.model}` : '（清空）'}`,
    );
    const key = await this.modelKeys.status(token);
    return {
      configured: key.configured,
      keyMasked: key.keyMasked,
      model: row.model,
      baseUrl: this.baseUrl(),
    };
  }

  async remove(user: CurrentUser) {
    const existing = await this.prisma.workbuddyLlmSetting.findUnique({
      where: { userId: user.userId },
    });
    if (!existing) return { removed: false };
    await this.prisma.workbuddyLlmSetting.delete({
      where: { userId: user.userId },
    });
    return { removed: true };
  }

  /** 拉模型列表：既当可选模型的来源，也当「这把 Key 通不通」的校验。 */
  async models(user: CurrentUser, token?: string) {
    const apiKey = await this.modelKeys.requireKey(token);
    const baseUrl = this.baseUrl();
    try {
      const response = await httpRequest<string>(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeoutMs: MODELS_TIMEOUT_MS,
        readAs: 'text',
        operation: 'model:list',
      });
      const raw = response.data;
      if (!response.ok) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `AIPDD 校验 Key 失败（HTTP ${response.status}）：${shorten(raw)}`,
        );
      }
      let payload: { data?: ModelCard[] };
      try {
        payload = JSON.parse(raw) as { data?: ModelCard[] };
      } catch {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `AIPDD 模型列表不是合法 JSON：${shorten(raw)}`,
        );
      }
      const list = (payload.data || [])
        .map((item) => String(item?.id || '').trim())
        .filter(Boolean)
        .sort();
      if (!list.length) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          'AIPDD 返回的模型列表为空',
        );
      }
      return { baseUrl, models: list };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      if (error instanceof TransportError && error.kind === 'timeout') {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          `AIPDD 校验超时（${MODELS_TIMEOUT_MS} ms）`,
        );
      }
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `AIPDD 无法访问：${(error as Error)?.message || '网络异常'}`,
      );
    }
  }

  /**
   * 多轮澄清：带着当前任务书与历史消息问模型，模型每轮把最新任务书以 SPEC_JSON 输出。
   * 产出的步骤会由前端逐条展示，用户确认后才物化成任务行，这里不落库。
   */
  async clarify(
    user: CurrentUser,
    body: Record<string, unknown>,
    token?: string,
  ) {
    const apiKey = await this.modelKeys.requireKey(token);
    const setting = await this.prisma.workbuddyLlmSetting.findUnique({
      where: { userId: user.userId },
    });
    const model = text(body.model).trim() || setting?.model || '';
    if (!model) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择文字模型（或先把默认模型存进配置）',
      );
    }
    const messages: ChatMessage[] = (
      Array.isArray(body.messages) ? body.messages : []
    )
      .filter(
        (item) =>
          item &&
          typeof item === 'object' &&
          ['user', 'assistant', 'system'].includes(
            String((item as Record<string, unknown>).role),
          ),
      )
      .slice(-20)
      .map((item) => {
        const row = item as Record<string, unknown>;
        return {
          role: String(row.role) as 'user' | 'assistant' | 'system',
          content: text(row.content).slice(0, 4000),
        };
      });
    if (!messages.some((item) => item.role === 'user')) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请先描述你的目标');
    }
    const current = normalizePlanSpec(body.spec);
    const reply = await geoChatMulti({
      baseUrl: this.baseUrl(),
      apiKey,
      model,
      messages: [
        { role: 'system', content: buildClarifyPrompt(current) },
        ...messages,
      ],
      maxTokens: CLARIFY_MAX_TOKENS,
      timeoutMs: CLARIFY_TIMEOUT_MS,
      userId: user.userId,
      purpose: 'chat',
    });
    const extracted = extractSpec(reply.reply);
    const spec = extracted.spec ? normalizePlanSpec(extracted.spec) : current;
    return {
      reply: reply.reply,
      spec,
      ready: specIsReady(spec),
      ...(extracted.error ? { specError: extracted.error } : {}),
      elapsedMs: reply.elapsedMs,
    };
  }
}

function buildClarifyPrompt(current: PlanSpec) {
  const known = JSON.stringify({
    goal: current.goal,
    deliverable: current.deliverable,
    acceptance: current.acceptance,
    steps: current.steps,
  });
  return `你是 Workbuddy 任务规划助手。用户会用口语描述他想达成的目标，你要和他对话，把目标收敛成一份可以直接交给 AI Agent 执行的任务书。

当前任务书（可能为空，以最新一轮对话为准持续更新）：
${known}

任务书的四个部分：
- goal：要达成什么（一句话，写清对象与结果）
- deliverable：最终交付物（文件、报表、清单、网页结果等，写清格式）
- acceptance：怎么算完成（可核对的判定条件）
- steps：执行步骤。每一步是一个可以独立交给 Agent 的任务，instruction 必须自包含（Agent 看不到对话历史），要写清输入、做什么、输出什么；title 是短标题。

规则：
1. 用中文，回复简洁友好，先确认你的理解，再指出还缺什么关键信息；
2. 一次最多追问 1-3 个真正影响执行的问题，不追问无关细节；
3. 步骤总数不超过 ${MAX_TASKS_PER_PLAN} 条，宁可少而可执行，不要堆砌；
4. 不要编造用户没说过的数字、账号、链接；缺了就问；
5. 每轮回复末尾必须输出完整任务书标记，格式严格为：
SPEC_JSON:{"goal":"…","deliverable":"…","acceptance":"…","steps":[{"title":"…","instruction":"…"}]}
该标记必须是一行合法 JSON，不要用代码围栏包起来；
6. 当四部分都已具备且步骤可执行时，在正文里告诉用户「任务书已就绪，可以生成任务了」。`;
}

/** 取最后一个 SPEC_JSON 标记；解析失败如实报给界面，不静默沿用旧稿。 */
function extractSpec(reply: string): { spec?: PlanSpec; error?: string } {
  const matches = [
    ...String(reply || '').matchAll(
      /SPEC_JSON\s*:\s*(\{[\s\S]*?\})\s*(?=\n|$)/g,
    ),
  ];
  const last = matches.length ? matches[matches.length - 1][1] : '';
  if (!last) return {};
  try {
    return { spec: normalizePlanSpec(JSON.parse(last)) };
  } catch {
    return {
      error: 'AI 返回的任务书不是合法 JSON，请让它「重新输出完整任务书」',
    };
  }
}
