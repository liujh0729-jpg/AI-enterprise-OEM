import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { aiChat } from '../ai/ai-gateway';
import { type ChatMessage } from '../geo/geo-llm.client';
import { httpRequest, TransportError } from '../http/transport';
import { ModelKeyService } from '../aiworkin/model-key.service';
import {
  MAX_SCRIPT_CONTENT,
  SCRIPT_FILE_TYPE_LABELS,
  SCRIPT_FILE_TYPES_BY_DEVICE,
  assertAutomaJson,
  deviceLabel,
  normalizeDeviceType,
  normalizeFileType,
  normalizeParamsSchema,
  type ParamSpec,
} from './rpa-shared';

/** AIPDD 文字模型服务地址：平台固定，Key 用「API Key 管理」里 AIworkin 平台签发的 sk- Key。 */
const AIPDD_BASE_URL = 'https://api.aipdd.work/v1';
/** 列模型 / 校验 Key 的超时。 */
const MODELS_TIMEOUT_MS = 20000;
/** 写脚本要给模型留足时间（生成长代码远比一次问答慢）。 */
const GENERATE_TIMEOUT_MS = 180000;
const GENERATE_MAX_TOKENS = 8000;

/**
 * AI 能写的脚本类型：比特浏览器（PC）与比特云手机的 RPA 流程只能从客户端画布导出，
 * 模型生成的 JSON 无论多像都导入不进客户端，所以这两类一律不给 AI 写，让用户去客户端导出后登记。
 */
const AI_WRITABLE_FILE_TYPES = ['automa_json', 'javascript', 'python'];

type ModelCard = { id: string };

/**
 * AIPDD 模型通道：用「API Key 管理」里 AIworkin 平台签发的 sk- Key（与机器通道的 ek_ Key 分开），
 * 这里只保留默认模型偏好。Base URL 写死 `https://api.aipdd.work/v1`。
 * 生成的内容先返回给界面预览，用户确认后才走脚本保存接口落库。
 */
export class RpaLlmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly modelKeys: ModelKeyService,
  ) {}

  /** 测试专用：套件里指向本地桩，真实部署不会设置这个变量。潜客挖掘共用本通道，故对外可见。 */
  baseUrl() {
    return String(process.env.GEO_LLM_BASE_URL || '').trim() || AIPDD_BASE_URL;
  }

  async setting(user: CurrentUser, token?: string) {
    const row = await this.prisma.rpaLlmSetting.findUnique({
      where: { userId: user.userId },
    });
    const key = this.modelKeys.status(token);
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
    const row = await this.prisma.rpaLlmSetting.upsert({
      where: { userId: user.userId },
      create: { userId: user.userId, model },
      update: { model },
    });
    await this.identity.audit(
      user.userId,
      'RPA配置默认模型',
      `默认模型${row.model ? ` ${row.model}` : '（清空）'}`,
    );
    const key = this.modelKeys.status(token);
    return {
      configured: key.configured,
      keyMasked: key.keyMasked,
      model: row.model,
      baseUrl: this.baseUrl(),
    };
  }

  async remove(user: CurrentUser) {
    const existing = await this.prisma.rpaLlmSetting.findUnique({
      where: { userId: user.userId },
    });
    if (!existing) return { removed: false };
    await this.prisma.rpaLlmSetting.delete({ where: { userId: user.userId } });
    return { removed: true };
  }

  /** 拉模型列表：既当作可选模型的来源，也当作「这把 Key 到底通不通」的校验。 */
  async models(user: CurrentUser, token?: string) {
    const apiKey = this.modelKeys.requireKey(token);
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
        // 上游鉴权失败不能回 401：前端见到 code 401 会把已登录的用户踢出会话
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

  /** 输入需求 + 选类型 + 选模型 → 生成脚本正文（只回预览，不落库）。 */
  async generate(
    user: CurrentUser,
    body: Record<string, unknown>,
    token?: string,
  ) {
    const requirement = text(body.requirement).trim();
    if (requirement.length < 8) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请把需求写具体一些（要打开哪个网站、做什么操作、取什么数据、存到哪里）',
      );
    }
    const deviceType = normalizeDeviceType(body.deviceType);
    const fileType = normalizeFileType(body.fileType, deviceType);
    if (!AI_WRITABLE_FILE_TYPES.includes(fileType)) {
      const writable = SCRIPT_FILE_TYPES_BY_DEVICE[deviceType].filter((type) =>
        AI_WRITABLE_FILE_TYPES.includes(type),
      );
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `「${SCRIPT_FILE_TYPE_LABELS[fileType]}」要在比特浏览器客户端里画好再导出登记，AI 写脚本只能产出：${writable.map((type) => SCRIPT_FILE_TYPE_LABELS[type]).join(' / ')}`,
      );
    }
    const setting = await this.prisma.rpaLlmSetting.findUnique({
      where: { userId: user.userId },
    });
    const reply = await aiChat(this.prisma, {
      userId: user.userId,
      token,
      model: text(body.model).trim(),
      moduleModel: setting?.model || '',
      module: 'rpa',
      operation: 'generate',
      messages: [
        {
          role: 'user',
          content: buildPrompt(requirement, fileType, deviceType),
        },
      ],
      maxTokens: GENERATE_MAX_TOKENS,
      timeoutMs: GENERATE_TIMEOUT_MS,
      purpose: 'chat',
    });
    const content = extractPayload(reply.reply, fileType);
    const paramsSchema = extractParamsSchema(reply.reply);
    if (content.length > MAX_SCRIPT_CONTENT) {
      throw new BusinessException(
        ErrorCode.PAYLOAD_TOO_LARGE,
        `生成的内容超过 ${MAX_SCRIPT_CONTENT} 字符上限，请把需求拆小一些`,
      );
    }
    return {
      deviceType,
      fileType,
      model: reply.model,
      content,
      paramsSchema,
      suggestedName: suggestName(requirement, fileType, deviceType),
      elapsedMs: reply.elapsedMs,
      promptTokens: reply.promptTokens,
      completionTokens: reply.completionTokens,
    };
  }

  /**
   * 参数填写 Chat：用户描述意图 → AI 按脚本 paramsSchema 引导补全 → 提取参数值。
   *
   * 多轮对话：前端每次把完整消息历史发过来，后端拼成 system + history 调一次模型。
   * AI 回复里如果包含 `PARAMS_JSON:{...}` 标记，后端会解析出来作为已提取的参数值。
   */
  async chatParams(
    user: CurrentUser,
    body: Record<string, unknown>,
    token?: string,
  ) {
    const scriptId = Number(body.scriptId);
    if (!scriptId || !Number.isInteger(scriptId)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请先选择脚本');
    }
    const script = await this.prisma.rpaScript.findFirst({
      where: { id: scriptId, createdBy: user.userId },
    });
    if (!script) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '该脚本不存在或不属于你',
      );
    }
    const schema = normalizeParamsSchema(script.paramsSchema);
    const entries = Object.entries(schema);
    if (!entries.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该脚本没有声明运行参数，不需要 AI 填写',
      );
    }
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    const messages: ChatMessage[] = rawMessages
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
    if (!messages.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请至少发送一条消息');
    }
    const currentParams =
      body.currentParams && typeof body.currentParams === 'object'
        ? (body.currentParams as Record<string, unknown>)
        : {};

    const setting = await this.prisma.rpaLlmSetting.findUnique({
      where: { userId: user.userId },
    });

    const systemPrompt = buildParamsSystemPrompt(
      script.name,
      entries,
      currentParams,
    );
    const chatMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];
    const reply = await aiChat(this.prisma, {
      userId: user.userId,
      token,
      model: text(body.model).trim(),
      moduleModel: setting?.model || '',
      module: 'rpa',
      operation: 'chat_params',
      messages: chatMessages,
      maxTokens: 2000,
      timeoutMs: 60000,
      purpose: 'chat',
    });
    const extracted = extractParamsFromReply(reply.reply, schema);
    return {
      reply: reply.reply,
      params: extracted,
      done: areRequiredFilled(schema, { ...currentParams, ...extracted }),
      elapsedMs: reply.elapsedMs,
    };
  }
}

/** 每种脚本类型各有各的产出契约；再按目标设备补一句运行环境，本地执行端才能拿到正文直接跑。 */
function buildPrompt(
  requirement: string,
  fileType: string,
  deviceType: string,
) {
  const runtime =
    deviceType === 'pc'
      ? '运行环境：本地比特浏览器（PC 客户端）里打开窗口跑网页，用 Automa 或浏览器内 JS / Python 操作页面。'
      : deviceType === 'android'
        ? '运行环境：本地执行端通过比特浏览器云手机接口（POST /phone/openphone、/phone/running、/phone/installApp、/phone/launchApp、/phone/uploadFile 等）操作一台安卓云手机，脚本要用 HTTP 接口驱动设备，不要写只能在本机浏览器里跑的 DOM 代码。'
        : '运行环境：iPhone 云手机。比特浏览器对 iOS 只开放环境管理，没有控制接口也没有 RPA，脚本要写成能被执行端自己的 iOS 工具链（Appium / WebDriverAgent）调用的通用步骤，所有对外交互走 HTTP。';
  const common = `目标设备：${deviceLabel(deviceType)}\n${runtime}\n\n需求：\n${requirement}\n\n要求：\n1) 只输出成品，不要解释文字，不要用 markdown 代码围栏；\n2) 参数一律从运行参数里取，不要硬编码账号口令；\n3) 关键步骤要有可核对的日志输出；\n4) 在脚本内容之后，另起一行输出 PARAMS_SCHEMA:{...}，JSON 格式列出脚本需要的所有运行参数，每个参数包含 label（中文名）、required（是否必填）、default（默认值，可选）。例如：PARAMS_SCHEMA:{"keyword":{"label":"搜索关键词","required":true},"city":{"label":"城市","required":false,"default":"北京"}}。如果脚本不需要任何参数，输出 PARAMS_SCHEMA:{}。\n`;
  if (fileType === 'automa_json') {
    return `${common}请输出一个可直接被 Automa（浏览器扩展）导入的工作流 JSON，且必须是合法 JSON 对象：
顶层字段为 name、version、drawflow、settings；
drawflow 里 nodes 与 edges 都是对象，每个节点含 id、labels、data（含 name、type、attributes）、position；
按需求顺序选用 Automa 的节点类型，例如 new-tab、trigger、elements-action（click/type）、conditions、delay、http-request、data-table、js-code。`;
  }
  if (fileType === 'python') {
    return `${common}请输出一个可直接运行的 Python 3 脚本：
运行参数从环境变量 RPA_PARAMS（JSON 字符串）读取；
PC 网页自动化优先使用 playwright.sync_api，接口类任务用 requests；云手机任务用 requests 调比特浏览器本地 HTTP 接口，接口基址也由执行端从环境变量读取（基址在客户端「系统设置」里，脚本不要硬编码端口）；
结束时把结果打印成一行 JSON，形如 {"status":"success","data":{...}}，失败时打印 {"status":"failed","error":"…"}。`;
  }
  return `${common}请输出一个 JavaScript 脚本：
定义 async function run(params) 作为入口，运行端会以 run(RPA_PARAMS) 调用；
PC 场景在浏览器上下文里执行（可用 document.querySelector、fetch），云手机场景改用 fetch 调执行端注入的比特浏览器本地接口基址；不要用 CommonJS/ESM import；
返回 { status: 'success', data: {...} } 或抛出带说明的错误。`;
}

/** 去掉围栏并取出正文：JSON 取最外层花括号配对的那一段，代码取整段。 */
function extractPayload(reply: string, fileType: string) {
  const raw = String(reply || '')
    .replace(/^\s*```[a-zA-Z]*\s*/, '')
    .replace(/```\s*$/, '')
    .replace(/PARAMS_SCHEMA\s*:\s*\{[\s\S]*?\}\s*(?=\n|$)/, '')
    .trim();
  if (!raw) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '模型没有返回内容，请重试或换一种需求表述',
    );
  }
  if (fileType !== 'automa_json') return raw;
  const start = raw.indexOf('{');
  if (start < 0) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '模型没有返回 Automa 工作流 JSON，请重试或换一种需求表述',
    );
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const json = raw.slice(start, index + 1);
        try {
          JSON.parse(json);
        } catch {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            '模型返回的 Automa JSON 解析失败，请重试',
          );
        }
        assertAutomaJson(json);
        return json;
      }
    }
  }
  throw new BusinessException(
    ErrorCode.BAD_REQUEST,
    '模型返回的 Automa JSON 括号不配对，请重试',
  );
}

/** 从 AI 回复里提取 PARAMS_SCHEMA:{...} 标记后的 JSON 对象。 */
function extractParamsSchema(reply: string): Record<string, unknown> {
  const match = String(reply || '').match(
    /PARAMS_SCHEMA\s*:\s*(\{[\s\S]*?\})\s*(?=\n|$)/,
  );
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function suggestName(
  requirement: string,
  fileType: string,
  deviceType: string,
) {
  const suffix =
    fileType === 'automa_json'
      ? 'Automa 流程'
      : fileType === 'python'
        ? 'Python 脚本'
        : 'JS 脚本';
  const deviceTag = deviceType === 'pc' ? '' : `${deviceLabel(deviceType)} · `;
  const head = requirement
    .replace(/\s+/g, '')
    .slice(0, 24)
    .replace(/[，。；：、,.；:?！!]/g, '');
  return `${deviceTag}${head || '自动生成'}（${suffix}）`.slice(0, 60);
}

function shorten(value: string) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** 参数 Chat 的 system prompt：告诉 AI 脚本有哪些参数、哪些已填、哪些缺。 */
function buildParamsSystemPrompt(
  scriptName: string,
  entries: [string, ParamSpec][],
  currentParams: Record<string, unknown>,
) {
  const paramList = entries
    .map(([key, spec]) => {
      const filled = currentParams[key];
      const filledText =
        filled !== undefined && filled !== null && filled !== ''
          ? `（已填：${JSON.stringify(filled)}）`
          : '（未填）';
      const required = spec.required ? '【必填】' : '【选填】';
      const defaultText =
        spec.default !== undefined && spec.default !== null
          ? `，默认值：${JSON.stringify(spec.default)}`
          : '';
      return `  - ${key}（${spec.label}）${required}${defaultText}${filledText}`;
    })
    .join('\n');
  return `你是一个 RPA 任务参数填写助手。用户正在为脚本「${scriptName}」配置运行参数。

该脚本需要以下参数：
${paramList}

你的任务：
1. 理解用户的意图描述，从中提取出对应参数的值
2. 如果用户一次性描述了所有参数的意图，直接给出所有参数值
3. 如果用户只描述了部分参数，先填已知的，然后追问缺少的必填参数
4. 回答要简洁友好，用中文

当你确定了参数值时，在回复末尾加上参数 JSON 块，格式为：
PARAMS_JSON:{"参数键1":"值1","参数键2":"值2"}

注意：
- PARAMS_JSON 里的键必须严格匹配上面列出的参数键名
- 只包含你有把握的参数，不确定的不要放进去
- 每次回复都可以更新 PARAMS_JSON（包含之前已确认的 + 新确认的）
- 如果所有必填参数都已填好，告诉用户「参数已齐全，可以提交了」`;
}

/** 从 AI 回复里提取 PARAMS_JSON:{...} 标记中的参数对象。 */
function extractParamsFromReply(
  reply: string,
  schema: Record<string, ParamSpec>,
): Record<string, string> {
  const match = /PARAMS_JSON\s*:\s*(\{[\s\S]*?\})/.exec(reply || '');
  if (!match) return {};
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const result: Record<string, string> = {};
  for (const key of Object.keys(schema)) {
    const value = parsed[key];
    if (value === undefined || value === null) continue;
    result[key] =
      typeof value === 'object' ? JSON.stringify(value) : text(value);
  }
  return result;
}

/** 判定所有必填参数是否都已填值。 */
function areRequiredFilled(
  schema: Record<string, ParamSpec>,
  params: Record<string, unknown>,
): boolean {
  for (const [key, spec] of Object.entries(schema)) {
    if (!spec.required) continue;
    const value = params[key];
    if (value === undefined || value === null || value === '') return false;
  }
  return true;
}
