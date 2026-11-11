import {
  MCP_API_KEY_PREFIX,
  MCP_ENDPOINT_PATH,
  MCP_FORBIDDEN_ACTIONS,
  MCP_INSTRUCTIONS,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_TITLE,
  MCP_SERVER_VERSION,
  MCP_TOOL_NAMES,
  MCP_TOOLS,
  mcpToolArgs,
  requestPath,
  z,
  type McpToolName,
} from '@enterprise/contracts';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import {
  resolveWriteIntent,
  sanitizeParams,
  truncate,
} from '../agent-memory/agent-intent';
import {
  runAsAgent,
  currentAgentCall,
  type AgentCallContext,
} from './agent-context';
import { createAgentApp } from './agent-app';
import {
  MCP_OPERATIONS,
  MCP_READ_OPERATIONS,
  MCP_WRITE_OPERATIONS,
  fillPath,
  findOperation,
  forbiddenReasonOf,
  missingPathParams,
  operationSchema,
  validateBody,
  validateQuery,
  type McpOperation,
} from './mcp-catalog';
import type { Services } from '../http/services';

/** MCP 工具的统一返回：`structuredContent` 给程序读，`content` 给只会读文本的客户端兜底。 */
export type McpToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
};

type ToolArgs = Record<string, unknown>;

export type ExecutionResult = {
  status: number;
  code: number | undefined;
  message: string;
  data: unknown;
};

const PLAIN_TEXT_LIMIT = 6000;

function ok(structured: Record<string, unknown>): McpToolResult {
  return {
    content: [
      {
        type: 'text',
        text: truncate(JSON.stringify(structured), PLAIN_TEXT_LIMIT),
      },
    ],
    structuredContent: structured,
  };
}

/** 工具内部的业务失败按 MCP 口径仍是 result（`isError`），只有协议级问题才走 JSON-RPC error。 */
function fail(message: string, extra?: Record<string, unknown>): McpToolResult {
  return {
    content: [{ type: 'text', text: message }],
    structuredContent: { ok: false, message, ...extra },
    isError: true,
  };
}

const HOW_TO_ENABLE =
  '请用户在本系统「智能体记忆 → 可自动执行的动作」里勾选该动作并保存（保存需输入本站登录密码），之后同样的指令才会真正执行。';

/**
 * 无人值守（定时任务 / 助理）下写动作默认全拒，只出草案：
 * 半夜没人盯着的一轮对话，不能因为远端内容里藏了一句指令就把数据改了。
 * 要放开只能逐个定时任务显式勾选「允许自动执行写动作」（保存要验密）。
 * 下面几条即使放开了也仍拒：OKR 的口径类动作关乎考核，只能人工确认。
 */
const SCHEDULE_DENIED_ACTIONS: Record<string, string> = {
  Okr_objectiveSave: '定时任务只能生成目标草稿，落定目标请在对话里确认后执行',
  Okr_objectiveAssign: '定时任务不能指派目标，请在对话里确认后执行',
  Okr_krSave: '定时任务不能直接改关键结果，请在对话里确认后执行',
  Okr_planSave: '定时任务不能直接建工作计划，请在对话里确认后执行',
};

/** 没命中逐条名单时的统一措辞（无人值守且任务没放开写动作）。*/
const UNATTENDED_DENIED =
  '无人值守任务默认不执行写动作，只出草案；要自动执行请在该定时任务里勾选「允许自动执行写动作」，或在本人的对话里确认后执行。';

/**
 * 本轮能不能替用户执行这个写动作：
 * · 对话里用户就在屏幕前，下一步不对可以立刻叫停，不受这一层约束；
 * · 无人值守（定时任务 / 助理）默认全拒，只出草案；要放开只能逐个任务显式勾选（保存要验密）；
 * · OKR 口径类动作关乎考核，即便放开了也仍然逐条拒。
 */
export function unattendedDenialOf(
  operationId: string,
  call: AgentCallContext | undefined,
) {
  if (call?.trigger !== 'schedule') return '';
  return (
    SCHEDULE_DENIED_ACTIONS[operationId] ??
    (call.allowWrite === true ? '' : UNATTENDED_DENIED)
  );
}

/**
 * MCP 服务端的能力本体：六个元工具，接口清单与授权闸全部从契约层和本账号的勾选派生。
 * 真正执行动作时不重写任何业务逻辑，而是把请求交给内部自执行器（`agent-app`）——
 * 与浏览器点同一个按钮走同一个 handler、同一套校验、同一条留痕。
 */
export class McpService {
  private readonly memory: Services['agentMemory'];
  private executor?: ReturnType<typeof createAgentApp>;

  constructor(private readonly services: Services) {
    this.memory = services.agentMemory;
  }

  private executorApp() {
    this.executor ??= createAgentApp(this.services);
    return this.executor;
  }

  /** 只有 `tools/call` 会进这里；参数按契约层 `mcpToolArgs` 逐字校验，多余字段直接拒收。 */
  async callTool(
    user: CurrentUser,
    requestId: string,
    name: string,
    args: unknown,
  ): Promise<McpToolResult> {
    const toolName = name as McpToolName;
    if (!MCP_TOOL_NAMES.includes(toolName))
      return fail(
        `没有名为 ${name} 的工具，可用工具：${MCP_TOOL_NAMES.join('、')}`,
      );
    const parsed = mcpToolArgs[toolName].safeParse(args ?? {});
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const path = (first?.path ?? []).join('.') || '参数';
      return fail(`参数不正确：${path} ${first?.message ?? ''}`.trim());
    }
    const input = parsed.data as ToolArgs;
    switch (toolName) {
      case 'describe_capabilities':
        return this.describeCapabilities(user);
      case 'list_operations':
        return this.listOperations(user, input);
      case 'get_operation':
        return this.getOperation(user, String(input['operationId']));
      case 'read_data':
        return this.readData(user, requestId, input);
      case 'write_data':
        return this.writeData(user, requestId, input);
      case 'analyze_memory':
        return this.analyzeMemory(user, Number(input['eventLimit']));
      case 'mail_list_mailboxes':
        return this.mailListMailboxes(user);
      case 'mail_list_messages':
        return this.mailListMessages(user, input);
      case 'mail_read_message':
        return this.mailReadMessage(user, input);
      case 'mail_create_draft':
        return this.mailCreateDraft(user, input);
      case 'mail_send_reply':
        return this.mailSendReply(user, input);
      case 'browser_agent_start':
      case 'browser_agent_status':
      case 'browser_agent_result':
      case 'browser_agent_stop':
      case 'browser_extract':
      case 'browser_skill_list':
      case 'browser_skill_run':
        return this.browserAgent(user, toolName, input);
    }
  }

  /**
   * 浏览器代理七件套：语义层自己判定在线闸与业务含义，MCP 这一层只做信封转换。
   * 发起/抽取/运行技能/停止都是改状态的动作，沿用在其他写工具上的无人值守闸——
   * 半夜的定时任务不能因为远端一句话就把用户的浏览器接管过去。
   */
  private async browserAgent(
    user: CurrentUser,
    name: McpToolName,
    input: ToolArgs,
  ): Promise<McpToolResult> {
    const mutating =
      name !== 'browser_agent_status' &&
      name !== 'browser_agent_result' &&
      name !== 'browser_skill_list';
    if (mutating) {
      const denied = unattendedDenialOf(name, currentAgentCall());
      if (denied) return fail(denied);
    }
    const result = await this.services.rpaChrome.tools.run(user, name, input);
    if (!result) return fail(`没有名为 ${name} 的工具`);
    if (result.ok === false)
      return fail(text(result.message) || '浏览器代理未执行');
    return ok(result);
  }

  // ---------------------------------------------------------------- 六个工具

  private async describeCapabilities(
    user: CurrentUser,
  ): Promise<McpToolResult> {
    return ok({
      ok: true,
      server: {
        name: MCP_SERVER_NAME,
        title: MCP_SERVER_TITLE,
        version: MCP_SERVER_VERSION,
        protocolVersion: MCP_PROTOCOL_VERSION,
      },
      endpoint: {
        path: MCP_ENDPOINT_PATH,
        authHeaders: [
          `x-api-key: ${MCP_API_KEY_PREFIX}…`,
          `Authorization: Bearer ${MCP_API_KEY_PREFIX}…`,
        ],
        note: '两种写法是同一把 Key、同一套校验、同一条审计；标准 MCP 客户端普遍走 Bearer。',
      },
      identity: {
        userId: user.userId,
        scope:
          '记忆与可调用接口都只属于这把 Key 的登录账号：看不到其他账号的数据，也调不到平台管理后台接口。',
      },
      operations: {
        total: MCP_OPERATIONS.length,
        read: MCP_READ_OPERATIONS.length,
        write: MCP_WRITE_OPERATIONS.length,
      },
      grantedActions: await this.grantedList(user),
      forbiddenActions: Object.entries(MCP_FORBIDDEN_ACTIONS).map(
        ([action, reason]) => ({
          action,
          label: findOperation(action)?.label ?? action,
          reason,
        }),
      ),
      callOrder: [
        'describe_capabilities',
        'analyze_memory',
        'list_operations / get_operation',
        'read_data',
        'write_data',
      ],
      instructions: MCP_INSTRUCTIONS,
    });
  }

  private async listOperations(
    user: CurrentUser,
    input: ToolArgs,
  ): Promise<McpToolResult> {
    const domain = input['domain'] as string | undefined;
    const keyword = input['keyword'] as string | undefined;
    const mode = String(input['mode']);
    const limit = Number(input['limit']);
    const offset = Number(input['offset']);
    const granted = await this.memory.grantedActions(user.userId);
    const source =
      mode === 'read'
        ? MCP_READ_OPERATIONS
        : mode === 'write'
          ? MCP_WRITE_OPERATIONS
          : MCP_OPERATIONS;
    const needle = keyword?.toLowerCase() ?? '';
    const matched = source.filter((row) => {
      if (domain && row.domain !== domain && row.domainLabel !== domain)
        return false;
      if (needle) {
        const haystack =
          `${row.operationId} ${row.label} ${row.path} ${row.domain} ${row.domainLabel}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (mode === 'granted') return granted.has(row.operationId);
      return true;
    });
    const page = matched.slice(offset, offset + limit);
    return ok({
      ok: true,
      total: matched.length,
      limit,
      offset,
      returned: page.length,
      items: page.map((row) => ({
        operationId: row.operationId,
        actionLabel: row.label,
        domain: row.domain,
        domainLabel: row.domainLabel,
        method: row.method.toUpperCase(),
        path: row.path,
        write: row.write,
        granted: granted.has(row.operationId),
        forbidden: Boolean(forbiddenReasonOf(row.operationId)),
      })),
    });
  }

  private async getOperation(
    user: CurrentUser,
    operationId: string,
  ): Promise<McpToolResult> {
    const row = findOperation(operationId);
    if (!row)
      return fail(
        `没有名为 ${operationId} 的接口动作，或该动作不对 MCP 开放。请先用 list_operations 查清单。`,
      );
    const granted = await this.memory.grantedActions(user.userId);
    const forbidden = forbiddenReasonOf(operationId);
    const last = await this.memory.lastEventParams(user.userId, operationId);
    return ok({
      ok: true,
      operationId,
      actionLabel: row.label,
      domain: row.domain,
      domainLabel: row.domainLabel,
      method: row.method.toUpperCase(),
      path: row.path,
      write: row.write,
      granted: granted.has(operationId),
      autoExecutable: row.write && !forbidden && granted.has(operationId),
      forbiddenReason: forbidden,
      hint:
        row.write && !granted.has(operationId) && !forbidden
          ? HOW_TO_ENABLE
          : '',
      schema: operationSchema(operationId) ?? null,
      lastParams: last,
    });
  }

  private async readData(
    user: CurrentUser,
    requestId: string,
    input: ToolArgs,
  ): Promise<McpToolResult> {
    const operationId = String(input['operationId']);
    const row = findOperation(operationId);
    if (!row)
      return fail(
        `没有名为 ${operationId} 的接口动作，或该动作不对 MCP 开放。`,
      );
    if (row.write)
      return fail(
        `「${row.label}」是写接口，请用 write_data（受本账号勾选的授权闸约束）。`,
      );
    const pathParams = (input['pathParams'] ?? {}) as Record<
      string,
      string | number
    >;
    const missing = missingPathParams(operationId, pathParams);
    if (missing.length) return fail(`缺少路径参数：${missing.join('、')}`);
    const query = (input['query'] ?? {}) as Record<string, unknown>;
    const queryCheck = validateQuery(operationId, query);
    if (!queryCheck.ok) return fail(`查询参数不正确——${queryCheck.message}`);
    const result = await this.execute(
      user,
      requestId,
      row,
      pathParams,
      query,
      {},
    );
    if (result.code !== undefined && result.code !== 0)
      return fail(result.message || `读取失败（code ${result.code}）`, {
        operationId,
        status: result.status,
        code: result.code,
      });
    return ok({
      ok: true,
      operationId,
      actionLabel: row.label,
      data: result.data,
    });
  }

  /**
   * 授权闸：永久排除、未勾选、dryRun、参数不合法四种情况**一律不执行**，只回草案。
   * 草案用的就是同一份契约校验与同一份报文，所以「没授权时看到的草案」＝「授权后会发的报文」。
   */
  private async writeData(
    user: CurrentUser,
    requestId: string,
    input: ToolArgs,
  ): Promise<McpToolResult> {
    const operationId = String(input['operationId']);
    const row = findOperation(operationId);
    if (!row)
      return fail(
        `没有名为 ${operationId} 的接口动作，或该动作不对 MCP 开放。`,
      );
    if (!row.write) return fail(`「${row.label}」是读取接口，请用 read_data。`);
    const pathParams = (input['pathParams'] ?? {}) as Record<
      string,
      string | number
    >;
    const query = (input['query'] ?? {}) as Record<string, unknown>;
    const body = (input['body'] ?? {}) as Record<string, unknown>;
    const dryRun = Boolean(input['dryRun']);
    const missing = missingPathParams(operationId, pathParams);
    const queryCheck = validateQuery(operationId, query);
    const bodyCheck = row.hasBody
      ? validateBody(operationId, body)
      : ({ ok: true } as const);
    const forbidden = forbiddenReasonOf(operationId);
    const granted = await this.memory.grantedActions(user.userId);
    // 无人值守下两道：逐条禁区（OKR 口径类）永远拒；其余写动作要任务显式放开才执行
    const call = currentAgentCall();
    const scheduleBlocked = unattendedDenialOf(operationId, call);
    const paramsOk = !missing.length && queryCheck.ok && bodyCheck.ok;
    const allowed =
      paramsOk &&
      !forbidden &&
      !scheduleBlocked &&
      !dryRun &&
      granted.has(operationId);
    const preview = {
      method: row.method.toUpperCase(),
      path: fillPath(operationId, pathParams),
      query,
      body: row.hasBody ? body : undefined,
    };

    if (!allowed) {
      const invalid = missing.length
        ? `缺少路径参数：${missing.join('、')}`
        : !queryCheck.ok
          ? `查询参数不正确——${queryCheck.message}`
          : !bodyCheck.ok
            ? `请求体不正确——${bodyCheck.message}`
            : '';
      const reason = invalid
        ? invalid
        : forbidden
          ? `该动作永久不允许自动执行：${forbidden}`
          : scheduleBlocked
            ? scheduleBlocked
            : dryRun
              ? '调用方要求 dryRun，只出草案。'
              : `本账号没有勾选「${row.label}」自动执行。`;
      const errorCode = forbidden
        ? 'FORBIDDEN'
        : scheduleBlocked
          ? 'SCHEDULE_DENIED'
          : dryRun
            ? 'DRY_RUN'
            : invalid
              ? 'INVALID_PARAMS'
              : 'NOT_GRANTED';
      await this.recordAttempt(user, row, pathParams, body, errorCode, reason);
      return ok({
        ok: true,
        executed: false,
        operationId,
        actionLabel: row.label,
        reason,
        needsGrant: !forbidden && !scheduleBlocked && !dryRun && !invalid,
        howToEnable: forbidden
          ? '该项属永久排除，只能由用户本人在界面上手工操作。'
          : scheduleBlocked
            ? '无人值守任务只出草案；请在本人的对话里确认后再执行。'
            : HOW_TO_ENABLE,
        draft: preview,
      });
    }

    const result = await this.execute(
      user,
      requestId,
      row,
      pathParams,
      query,
      body,
    );
    const succeeded = result.code === undefined || result.code === 0;
    return ok({
      ok: succeeded,
      executed: true,
      operationId,
      actionLabel: row.label,
      status: result.status,
      code: result.code,
      message: result.message,
      data: result.data,
      request: preview,
    });
  }

  /** 收到指令后先读这一份：账号的习惯、常用参数、已授权动作，一次拿全。 */
  private async analyzeMemory(
    user: CurrentUser,
    eventLimit: number,
  ): Promise<McpToolResult> {
    const [summary, recent, preferences, grantedActions] = await Promise.all([
      this.memory.overview(user.userId),
      this.memory.events(user.userId, { pageSize: String(eventLimit) }),
      this.memory.preferences(user.userId, 20),
      this.grantedList(user),
    ]);
    return ok({
      ok: true,
      summary,
      recentEvents: recent.list,
      preferences,
      grantedActions,
      note: '记忆只属于这个登录账号：同一家企业里老板、财务、职员各有一份，互不相通。',
    });
  }

  // ---------------------------------------------------------------- 邮件工具

  /** 定时任务里只给「本次任务的邮箱」；外部机器通道按整个账号给。 */
  private mailboxScope(): number[] | undefined {
    const scope = currentAgentCall()?.mailboxIds;
    return scope && scope.length ? scope : undefined;
  }

  private async mailListMailboxes(user: CurrentUser): Promise<McpToolResult> {
    const accounts = await this.services.mailbox.accountsForTools(
      user,
      this.mailboxScope(),
    );
    return ok({
      ok: true,
      total: accounts.length,
      mailboxes: accounts.map((account) => ({
        mailboxId: account.id,
        address: account.address,
        protocol: account.protocol,
        replyMode: account.replyMode,
        replyModeLabel: account.replyModeLabel,
        maxPerRun: account.maxPerRun,
        enabled: account.enabled,
        todaySent: account.todaySent,
        todayDraft: account.todayDraft,
        monthHandled: account.monthHandled,
      })),
      note: 'mailboxId 是后续邮件工具的唯一凭据；回复方式为「只写草稿」的邮箱只能用 mail_create_draft。',
    });
  }

  private async mailListMessages(
    user: CurrentUser,
    input: ToolArgs,
  ): Promise<McpToolResult> {
    const messages = await this.services.mailbox.toolMessages(
      user,
      Number(input['mailboxId']),
      {
        unreadOnly: Boolean(input['unreadOnly']),
        sinceHours: Number(input['sinceHours']),
        limit: Number(input['limit']),
      },
      this.mailboxScope(),
    );
    return ok({
      ok: true,
      total: messages.length,
      messages,
      note: 'key 是读取正文与起草/回复的唯一凭据；正文不落库，每次实时读取。',
    });
  }

  private async mailReadMessage(
    user: CurrentUser,
    input: ToolArgs,
  ): Promise<McpToolResult> {
    const { message, account } = await this.services.mailbox.toolRead(
      user,
      Number(input['mailboxId']),
      String(input['key']),
      this.mailboxScope(),
    );
    return ok({
      ok: true,
      mailboxId: account.id,
      address: account.address,
      replyMode: account.replyMode,
      message,
    });
  }

  private async mailCreateDraft(
    user: CurrentUser,
    input: ToolArgs,
  ): Promise<McpToolResult> {
    const result = await this.services.mailbox.toolCreateDraft(
      user,
      Number(input['mailboxId']),
      text(input['key']),
      text(input['body']),
      text(input['subject']),
      this.mailboxScope(),
    );
    await this.recordMailEvent(
      user,
      'Mail_createDraft',
      input,
      result.executed ? 'ok' : 'blocked',
      '',
      result.message,
    );
    return ok({ ...result });
  }

  private async mailSendReply(
    user: CurrentUser,
    input: ToolArgs,
  ): Promise<McpToolResult> {
    const granted = await this.memory.grantedActions(user.userId);
    const result = await this.services.mailbox.toolSendReply(
      user,
      Number(input['mailboxId']),
      text(input['key']),
      text(input['body']),
      text(input['subject']),
      {
        granted: granted.has('Mail_sendReply'),
        mailboxIds: this.mailboxScope(),
      },
    );
    await this.recordMailEvent(
      user,
      'Mail_sendReply',
      input,
      result.executed ? 'ok' : 'blocked',
      result.executed ? '' : 'NOT_GRANTED',
      result.message,
    );
    return ok({ ...result });
  }

  /** 邮件动作进智能体记忆：只记邮箱与邮件 key，不记正文（正文本来就不落库）。 */
  private async recordMailEvent(
    user: CurrentUser,
    action: string,
    input: ToolArgs,
    outcome: 'ok' | 'blocked',
    errorCode: string,
    errorMessage: string,
  ) {
    const mailboxId = Number(input['mailboxId']);
    await this.memory.record({
      userId: user.userId,
      domain: 'mail',
      action,
      method: 'POST',
      path: `/enterprise/mail/accounts/${mailboxId}/${
        action === 'Mail_sendReply' ? 'replies' : 'drafts'
      }`,
      targetType: 'mail',
      targetId: text(input['key']),
      targetLabel: '',
      params: { mailboxId, key: text(input['key']) },
      outcome,
      errorCode,
      errorMessage,
      channel: 'mcp',
    });
  }

  // ---------------------------------------------------------------- 内部助手

  /**
   * 内部直接执行口（工作流动作节点等）：按 operationId 直奔内部自执行器，
   * 不套 MCP 勾选授权闸（授权由调用方负责），但仍是同一张路由表、同一份校验，
   * 身份同样经 `AsyncLocalStorage` 注入，不可伪造。
   */
  async runOperation(
    user: CurrentUser,
    requestId: string,
    operationId: string,
    input: {
      pathParams?: Record<string, string | number>;
      query?: Record<string, unknown>;
      body?: Record<string, unknown>;
    },
  ): Promise<ExecutionResult> {
    const row = findOperation(operationId);
    if (!row) {
      return {
        status: 404,
        code: undefined,
        message: `没有名为 ${operationId} 的接口动作，或该动作不对内部开放。`,
        data: undefined,
      };
    }
    const pathParams = input.pathParams ?? {};
    const missing = missingPathParams(operationId, pathParams);
    if (missing.length) {
      return {
        status: 400,
        code: undefined,
        message: `缺少路径参数：${missing.join('、')}`,
        data: undefined,
      };
    }
    return this.execute(
      user,
      requestId,
      row,
      pathParams,
      input.query ?? {},
      row.hasBody ? (input.body ?? {}) : {},
    );
  }

  private async grantedList(user: CurrentUser) {
    const granted = await this.memory.grantedActions(user.userId);
    return [...granted].sort().map((action) => ({
      action,
      label: findOperation(action)?.label ?? action,
      domainLabel: findOperation(action)?.domainLabel ?? '',
    }));
  }

  /** 授权闸拦下的写动作也要进记忆：这样「AI 想做什么、被什么挡住」在界面上看得见。 */
  private async recordAttempt(
    user: CurrentUser,
    operation: McpOperation,
    pathParams: Record<string, string | number>,
    body: Record<string, unknown>,
    errorCode: string,
    errorMessage: string,
  ) {
    const path = fillPath(operation.operationId, pathParams);
    const intent = resolveWriteIntent(operation.method, path);
    await this.memory.record({
      userId: user.userId,
      domain: operation.domain,
      action: operation.operationId,
      method: operation.method.toUpperCase(),
      path,
      targetType: intent?.targetType ?? '',
      targetId: '',
      targetLabel: '',
      params: sanitizeParams({ ...pathParams, ...body }),
      outcome: errorCode === 'INVALID_PARAMS' ? 'failed' : 'blocked',
      errorCode,
      errorMessage,
      channel: 'mcp',
    });
  }

  /**
   * 交给内部自执行器：与浏览器同一张路由表、同一个 handler、同一份校验。
   * 身份经 `AsyncLocalStorage` 注入，不读任何请求头，所以无法被伪造。
   */
  private async execute(
    user: CurrentUser,
    requestId: string,
    operation: McpOperation,
    pathParams: Record<string, string | number>,
    query: Record<string, unknown>,
    body: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    // 查询串用契约层的 `requestPath` 拼装：与浏览器发的报文逐字一致（数组＝重复参数）。
    const url = new URL(
      `http://mcp.internal${requestPath(
        fillPath(operation.operationId, pathParams),
        query,
      )}`,
    );
    const init: RequestInit = {
      method: operation.method.toUpperCase(),
      headers: { 'content-type': 'application/json' },
    };
    if (operation.hasBody) init.body = JSON.stringify(body);
    const app = this.executorApp();
    const response = await runAsAgent({ user, requestId }, async () =>
      app.fetch(new Request(url.toString(), init)),
    );
    const envelope = (await response.json().catch(() => undefined)) as
      Record<string, unknown> | undefined;
    return {
      status: response.status,
      code: typeof envelope?.code === 'number' ? envelope.code : undefined,
      message: typeof envelope?.message === 'string' ? envelope.message : '',
      data: envelope?.data,
    };
  }
}

/** `tools/list` 对外发布的工具描述符：与 `mcpToolArgs`、`MCP_TOOLS` 同源，界面「MCP Server」页也读这一份。 */
export function mcpToolDescriptors() {
  return MCP_TOOL_NAMES.map((name) => {
    const meta = MCP_TOOLS[name];
    const document = z.toJSONSchema(mcpToolArgs[name], {
      io: 'input',
      target: 'draft-07',
    }) as Record<string, unknown>;
    delete document.$schema;
    return {
      name,
      title: meta.title,
      description: meta.description,
      inputSchema: document,
      annotations: meta.annotations,
    };
  });
}
