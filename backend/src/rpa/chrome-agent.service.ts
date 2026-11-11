import { randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma';
import {
  RC_AGENT_MODE_LABELS,
  RC_AGENT_MODES,
  RC_SESSION_STATUS_LABELS,
  mcpOperations,
  rcSessionTerminal,
  type RcAgentDecision,
  type RcSessionView,
  type RcStepView,
  type RcToolCall,
} from '@enterprise/contracts';
import { aiJson, resolveModel, tryChat } from '../ai/ai-gateway';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { asJsonArray, toJsonObject } from '../shared/json-value';
import type { StorageService } from '../storage/storage.service';
import type { TaskDraft } from '../task-center/task-source';
import {
  RpaChromeDeviceService,
  chromeActionNeedsConfirm,
  normalizeChromeAction,
  normalizeDecidedAction,
  type ChromeDevicePrincipal,
  type ChromeSettings,
} from './chrome-device.service';
import type { RpaTaskService } from './rpa-task.service';

/**
 * 本地 Chrome 会话引擎（docs/本地Chrome插件RPA控制方案.md §5.3 / §8 / D6-C）：
 * goal → 云端 LLM 逐步决策（闭集动作，最多 maxSteps 步）→ 插件执行 → 回页面观测 → 下一步。
 * 另可带确定性动作序列（script）逐步回放：不调 LLM、不产生 AI 积分。
 * 无假成功：插件未回执即超时失败；设备离线、连续失败、模型不给出合规动作都会如实收口。
 */

const DECISION_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;
const MAX_INVALID_DECISIONS = 2;
const MAX_CONSECUTIVE_FAILURES = 3;
const SCREENSHOT_MAX_BYTES = 3 * 1024 * 1024;
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

const SYSTEM_PROMPT = [
  '你是浏览器自动化决策器。你看到的是用户本机 Chrome 当前页面的「页面地图」（可见交互元素清单）与最近几步执行历史。',
  '你每一步只能输出一个 JSON 动作对象，不要输出多余文字。可用动作（闭集，别的动作一律无效）：',
  '{ "action": "open_tab", "url": "https://..." }  打开新标签页并跳转到该地址',
  '{ "action": "navigate", "url": "https://..." }  当前页跳转到该地址',
  '{ "action": "snapshot" }  读取当前页面地图（不确定页面时先做这个）',
  '{ "action": "read", "elementIndex": 3 }  读取页面地图中第 3 号元素的文本/属性',
  '{ "action": "act", "act": "click", "elementIndex": 3 }  点击第 3 号元素',
  '{ "action": "act", "act": "type", "elementIndex": 4, "value": "文本" }  在第 4 号输入框输入',
  '{ "action": "act", "act": "select", "elementIndex": 5, "value": "选项文本" }  选择下拉项',
  '{ "action": "act", "act": "scroll", "value": "down" }  向下滚动一屏（value 可为 up/down）',
  '{ "action": "wait", "ms": 1500 }  等待毫秒数',
  '{ "action": "screenshot" }  截图（用于确认视觉结果）',
  '{ "action": "finish", "reason": "完成原因" }  目标已达成或无法继续时结束',
  '优先用 elementIndex 指定元素（比猜选择器可靠）。若目标已达成，立即输出 finish。',
  'mode 字段表示用户的意图：act 在页面上执行操作、crawl 顺着链接批量抓取多页、extract 把当前页抽成结构化数据；按它调整策略。',
  '先判断用户意图再决定怎么输出：',
  '（1）若用户只是提问、闲聊、问你的身份/能力/用法，或要你解释、给建议、做规划而不需要操作页面，就直接输出 { "reply": "给用户的回答" }，不要勉强改动页面。',
  '（2）若用户的目标需要操作页面：当 confirmed 字段为 false 时，先输出 { "confirm": "说明你打算做的事项与完成方式（要做什么、在哪个站点/页面、怎么做、拿到什么结果，该分步就分步），并问用户是否确认执行" }，本步不要输出任何动作；当 confirmed 为 true（用户已确认）时才逐步给出动作，第一步先给出第一个动作、并在 thought 里一两句说明整体计划，不要只回计划而不动作。',
  '（3）只有在确实缺少关键信息（如目标站点、关键词、凭据）时才输出 { "question": "要问用户的话" }。',
  '除页面动作外，还可以调用「平台工具」（本系统自己的接口动作）：{ "tool": { "tool": "工具名", "args": { ... } } }。',
  '平台工具的 args：读取类填 { "query": { ... }, "pathParams": { ... } }，写入类填 { "body": { ... }, "pathParams": { ... } }；不确定参数就先调 list_operations 查（args 用 { "keyword": "关键词", "limit": 20 }）。',
  '同一个目标里，页面动作与平台工具可以交替进行（如先在页面抓取，再把结果写回平台）。写类平台工具受本账号授权闸约束，未授权只会回草案——如实告诉用户去授权即可，不要反复重试。',
  '禁止任何绕过登录/验证码、读取密码、支付或提交敏感内容的行为，除非用户目标明确要求且由用户本人确认。',
].join('\n');

/**
 * 插件 Agent 可调用的平台工具（契约派生，不写第二份清单）：只取与本场景相关的域。
 * 侧边栏自身要管的会话/技能台账端点（RpaChrome_*）与对外 openAPI 通道不在此列，避免 Agent 绕开侧边栏操作自己。
 */
const PLATFORM_TOOL_DOMAINS = ['rpa', 'mkt', 'generated-skills', 'help'];
const PLATFORM_TOOL_EXCLUDED = /^(RpaChrome_|OpenApi_rpa)/;
/** 提示词工具的条数上限：够用即可，避免每步决策都为长清单付费。 */
const PLATFORM_TOOL_LIMIT = 120;

const PLATFORM_TOOL_ROWS = mcpOperations().filter(
  (row) =>
    PLATFORM_TOOL_DOMAINS.includes(row.domain) &&
    !PLATFORM_TOOL_EXCLUDED.test(row.operationId),
);

/** 额外工具（如本账号已共享的工作流 wf__<id>）：以本人身份按发布版本运行。 */
export type AgentExtraTool = { name: string; description?: string };

/** 本账号的插件技能（personal / site）：作为长期知识注入决策提示词，让 Agent 按既有偏好与站点套路办事。 */
export type AgentSkillHint = {
  name: string;
  kindLabel: string;
  site: string;
  content: string;
};

/** 技能注入上限：条数与单条正文都收口，避免每步决策都为长知识付费。 */
const SKILL_HINT_LIMIT = 12;
const SKILL_HINT_CONTENT_MAX = 1200;

function platformToolDigest(extra: AgentExtraTool[]): string {
  const lines = PLATFORM_TOOL_ROWS.map(
    (row) => `${row.operationId}｜${row.label}｜${row.write ? '写' : '读'}`,
  );
  const extras = extra.map(
    (item) => `${item.name}｜${item.description || '已共享工作流'}｜写`,
  );
  return [...lines, ...extras].slice(0, PLATFORM_TOOL_LIMIT).join('\n');
}

/** 把本账号启用的技能拼成提示词段落：站点技能标注归属站点，个人技能标注为通用偏好。 */
function skillDigest(skills: AgentSkillHint[]): string {
  return skills
    .slice(0, SKILL_HINT_LIMIT)
    .map((skill) => {
      const scope = skill.site ? `站点=${skill.site}` : '通用';
      const body = text(skill.content).slice(0, SKILL_HINT_CONTENT_MAX);
      return `【${skill.kindLabel}】${skill.name}（${scope}）\n${body}`;
    })
    .join('\n---\n');
}

/** 把模型给的 tool 字段收敛成闭集内的工具调用；不是对象或缺工具名则视为没给。 */
function normalizeToolCall(raw: unknown): RcToolCall | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const bag = raw as Record<string, unknown>;
  const name = text(bag.tool).trim().slice(0, 120);
  if (!name) return null;
  const args =
    bag.args && typeof bag.args === 'object' && !Array.isArray(bag.args)
      ? (bag.args as Record<string, unknown>)
      : {};
  return { tool: name, args, code: text(bag.code).trim().slice(0, 64) };
}

type Decision = { action: Record<string, unknown>; thought: string };

/** 任务中心只用到「派发 + 回写状态」两个写入口（与 TaskCenterService 同签名）。 */
type TaskPort = {
  assign(draft: TaskDraft): Promise<unknown>;
  syncStatus(input: {
    source: string;
    sourceId: string;
    assigneeUserId: string;
    sourceStatus?: string;
    sourceStatusLabel?: string;
    terminal?: boolean;
  }): Promise<unknown>;
};

/** 需要登录/验证/风控拦截的错误特征（插件遇阻即停，交人工处理）。 */
const LOGIN_BLOCK_PATTERN =
  /登录|登陆|验证码|风控|安全验证|login|sign\s*in|captcha|risk/i;

export class ChromeAgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: RpaChromeDeviceService,
    private readonly storage: StorageService,
    private readonly tasks: RpaTaskService,
  ) {}

  private taskPort?: TaskPort;

  /** 装配任务中心（docs §8.4）：浏览器待确认/需登录时派「确认/登录」待办。 */
  useTaskCenter(port: TaskPort) {
    this.taskPort = port;
  }

  /** 敏感动作停下等确认 → 「发布确认」待办（派给获授权的账号操作人本人）。 */
  private async openConfirmTask(
    session: { id: number; createdBy: string; goal: string },
    index: number,
    action: Record<string, unknown>,
  ) {
    if (!this.taskPort) return;
    const goal = session.goal.trim().slice(0, 80) || `会话 #${session.id}`;
    await this.taskPort
      .assign({
        assigneeUserId: session.createdBy,
        source: 'rpa',
        sourceId: `confirm:${session.id}:${index}`,
        title: `浏览器操作待确认：${goal}`,
        description: `第 ${index + 1} 步动作需要你本人在插件里确认后才会执行：${JSON.stringify(action).slice(0, 240)}`,
        link: '/rpa',
        category: 'approval',
        priority: 'HIGH',
        createdBy: session.createdBy,
        sourceStatus: 'WAITING_CONFIRM',
        sourceStatusLabel: '待确认',
      })
      .catch(() => null);
  }

  /** 确认已处理（允许/拒绝/超时）→ 收口确认待办。 */
  private async settleConfirmTask(
    session: { id: number; createdBy: string },
    index: number,
    label: string,
  ) {
    if (!this.taskPort) return;
    await this.taskPort
      .syncStatus({
        source: 'rpa',
        sourceId: `confirm:${session.id}:${index}`,
        assigneeUserId: session.createdBy,
        sourceStatus: 'DONE',
        sourceStatusLabel: label,
        terminal: true,
      })
      .catch(() => null);
  }

  /** 遇登录墙/验证码/风控 → 「登录/验证」待办（完成依据＝重新登录后跑通一次会话）。 */
  private async openLoginTask(
    session: { id: number; createdBy: string; clientId: string; goal: string },
    index: number,
    reason: string,
  ) {
    if (!this.taskPort) return;
    const goal = session.goal.trim().slice(0, 80) || `会话 #${session.id}`;
    await this.taskPort
      .assign({
        assigneeUserId: session.createdBy,
        source: 'rpa',
        sourceId: `login:${session.id}:${index}`,
        title: `浏览器登录/验证：${goal}`,
        description: `第 ${index + 1} 步被目标站点拦下：${reason.slice(0, 300)}。请在插件里完成登录或验证后重跑，会话跑通一次才算办结。`,
        link: '/rpa',
        category: 'matter',
        priority: 'HIGH',
        createdBy: session.createdBy,
        sourceStatus: 'NEED_LOGIN',
        sourceStatusLabel: '需登录/验证',
      })
      .catch(() => null);
  }

  /**
   * 关闭前复核（docs §8.4 完成依据）：
   * 确认类待办要等会话已离开「等待确认」；登录类待办要看到之后有跑通的会话。
   */
  async recheckBrowserTask(input: {
    assigneeUserId: string;
    sourceId: string;
  }): Promise<{ cleared: boolean; reason: string }> {
    const [kind, idRaw] = input.sourceId.split(':');
    const sessionId = Number(idRaw);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return { cleared: true, reason: '' };
    }
    const session = await this.prisma.rpaChromeSession.findFirst({
      where: { id: sessionId, createdBy: input.assigneeUserId },
      select: { status: true, id: true },
    });
    if (!session) return { cleared: true, reason: '' };
    if (kind === 'confirm') {
      if (session.status === 'WAITING_CONFIRM') {
        return {
          cleared: false,
          reason: '浏览器仍在等待你的确认，请先允许或拒绝该敏感动作',
        };
      }
      return { cleared: true, reason: '' };
    }
    if (kind === 'login') {
      const rerun = await this.prisma.rpaChromeSession.findFirst({
        where: {
          createdBy: input.assigneeUserId,
          id: { gt: session.id },
          status: 'COMPLETED',
        },
        select: { id: true },
      });
      if (!rerun) {
        return {
          cleared: false,
          reason: '还没有看到重新登录/验证后跑通的浏览器会话，请重跑一次再关闭',
        };
      }
    }
    return { cleared: true, reason: '' };
  }

  // ---------- 会话（页面 / Agent 用） ----------

  async startSession(user: CurrentUser, body: Record<string, unknown>) {
    const clientId = text(body.clientId).trim();
    if (!clientId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择要操作的本地 Chrome 设备',
      );
    }
    await this.devices.requireOnlineDevice(user, clientId);
    const taskId = Math.max(0, Math.round(Number(body.taskId) || 0));
    const modeRaw = text(body.mode).trim().toLowerCase();
    const mode = (RC_AGENT_MODES as readonly string[]).includes(modeRaw)
      ? modeRaw
      : 'act';
    let goal = text(body.goal).trim().slice(0, 1000);
    let startUrl = text(body.startUrl).trim().slice(0, 2000);
    let actions = asJsonArray(body.actions as Prisma.JsonValue)
      .map((item) => normalizeChromeAction(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    const settings = await this.devices.settingsOf(user.userId);
    let claimed: Awaited<ReturnType<RpaTaskService['claimChrome']>> | null =
      null;
    try {
      // 由任务发起：先按「原子抢单 + 落执行记录」认领，再取任务绑定的确定性动作序列
      if (taskId > 0) {
        claimed = await this.tasks.claimChrome(user.userId, taskId, clientId);
        if (!actions.length) actions = claimed.actions;
        if (!goal) goal = claimed.goal;
        if (!startUrl) startUrl = claimed.startUrl;
      }
      if (!goal && !actions.length) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '请填写要完成的目标，或给出动作序列',
        );
      }
      const maxStepsRaw = Number(body.maxSteps);
      const maxSteps = Number.isFinite(maxStepsRaw)
        ? Math.min(60, Math.max(1, Math.round(maxStepsRaw)))
        : settings.maxSteps;

      const session = await this.prisma.rpaChromeSession.create({
        data: {
          createdBy: user.userId,
          clientId,
          taskId,
          executionId: claimed ? claimed.executionId : 0,
          goal,
          startUrl,
          mode,
          status: 'RUNNING',
          maxSteps,
          model: text(body.modelKey).trim().slice(0, 128),
          script: actions as Prisma.InputJsonValue,
        },
      });
      void this.run(session.id).catch(() => undefined);
      return await this.sessionView(user, session.id);
    } catch (error) {
      // 会话没能起来：把已抢到的任务退回 pending，别让设备一直在「执行中」
      if (claimed) await this.tasks.releaseChrome(user.userId, claimed.taskId);
      throw error;
    }
  }

  async listSessions(user: CurrentUser, query: Record<string, unknown>) {
    const page = Math.max(1, Math.round(Number(query.page) || 1));
    const pageSize = Math.min(
      200,
      Math.max(1, Math.round(Number(query.pageSize) || 20)),
    );
    const where: Prisma.RpaChromeSessionWhereInput = { createdBy: user.userId };
    if (query.clientId) where.clientId = text(query.clientId);
    if (query.status) where.status = text(query.status).toUpperCase();
    const [total, rows] = await Promise.all([
      this.prisma.rpaChromeSession.count({ where }),
      this.prisma.rpaChromeSession.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, list: await this.briefsOf(user, rows) };
  }

  async activeSessions(user: CurrentUser, clientId?: string) {
    const rows = await this.prisma.rpaChromeSession.findMany({
      where: {
        createdBy: user.userId,
        status: { in: ['RUNNING', 'WAITING_CONFIRM', 'PAUSED'] },
        ...(clientId ? { clientId: text(clientId) } : {}),
      },
      orderBy: { id: 'desc' },
      take: 50,
    });
    return { list: await this.briefsOf(user, rows) };
  }

  async sessionView(
    user: CurrentUser,
    id: number,
    withSteps = true,
  ): Promise<RcSessionView> {
    const row = await this.prisma.rpaChromeSession.findFirst({
      where: { id, createdBy: user.userId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '会话不存在');
    const device = await this.prisma.rpaChromeDevice.findUnique({
      where: {
        createdBy_clientId: { createdBy: user.userId, clientId: row.clientId },
      },
      select: { name: true },
    });
    const steps = withSteps
      ? await this.prisma.rpaChromeStep.findMany({
          where: { sessionId: row.id },
          orderBy: { stepIndex: 'asc' },
        })
      : [];
    return {
      id: row.id,
      clientId: row.clientId,
      deviceName: device?.name || `Chrome · ${row.clientId.slice(0, 6)}`,
      goal: row.goal,
      mode: row.mode,
      modeLabel: RC_AGENT_MODE_LABELS[row.mode] || row.mode,
      status: row.status,
      statusLabel: RC_SESSION_STATUS_LABELS[row.status] || row.status,
      stepCount: row.stepCount,
      maxSteps: row.maxSteps,
      model: row.model,
      stopReason: row.stopReason,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt ? row.endedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      ...(withSteps ? { steps: steps.map((step) => this.stepView(step)) } : {}),
    };
  }

  private async briefsOf(
    user: CurrentUser,
    rows: Prisma.RpaChromeSessionGetPayload<object>[],
  ): Promise<RcSessionView[]> {
    const clientIds = [...new Set(rows.map((row) => row.clientId))];
    const devices = clientIds.length
      ? await this.prisma.rpaChromeDevice.findMany({
          where: { createdBy: user.userId, clientId: { in: clientIds } },
          select: { clientId: true, name: true },
        })
      : [];
    const nameMap = new Map(devices.map((item) => [item.clientId, item.name]));
    return rows.map((row) => ({
      id: row.id,
      clientId: row.clientId,
      deviceName:
        nameMap.get(row.clientId) || `Chrome · ${row.clientId.slice(0, 6)}`,
      goal: row.goal,
      mode: row.mode,
      modeLabel: RC_AGENT_MODE_LABELS[row.mode] || row.mode,
      status: row.status,
      statusLabel: RC_SESSION_STATUS_LABELS[row.status] || row.status,
      stepCount: row.stepCount,
      maxSteps: row.maxSteps,
      model: row.model,
      stopReason: row.stopReason,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt ? row.endedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private stepView(row: Prisma.RpaChromeStepGetPayload<object>): RcStepView {
    const observation = toJsonObject(row.observation);
    const shotUrl = row.screenshotKey
      ? `/api/backend/enterprise/rpa/chrome/steps/${row.id}/screenshot`
      : '';
    return {
      id: row.id,
      stepIndex: row.stepIndex,
      commandCode: row.commandCode,
      action: toJsonObject(row.action),
      thought: row.thought,
      observation,
      screenshotUrl: shotUrl,
      status: row.status,
      elapsedMs: row.elapsedMs,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ---------- 侧边栏 Agent（插件侧循环，hybrid） ----------

  /**
   * 插件侧 Agent 的一步决策：插件把「目标 + 页面观测 + 最近历史」发来，
   * 这里调一次 LLM 回一个闭集动作 / 结束 / 追问。编排在插件，模型在平台。
   * 每一步都走 aiJson → 与站内 AI 用量同口径计量（先时长卡后积分）。
   */
  async decideForDevice(
    device: ChromeDevicePrincipal,
    body: Record<string, unknown>,
    extraTools: AgentExtraTool[] = [],
    skills: AgentSkillHint[] = [],
  ): Promise<RcAgentDecision> {
    const goal = text(body.goal).trim().slice(0, 1000);
    if (!goal) throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写目标');
    const mode = text(body.mode).trim().toLowerCase();
    const settings = await this.devices.settingsOf(device.userId);
    const stepIndex = Math.max(0, Math.round(Number(body.stepIndex) || 0));
    const observation = toJsonObject(body.observation);
    const history = text(body.history).slice(0, 4000);
    const snapshot = {
      goal,
      mode: (RC_AGENT_MODES as readonly string[]).includes(mode) ? mode : 'act',
      stepIndex: stepIndex + 1,
      maxSteps: settings.maxSteps,
      confirmed: body.confirmed === true,
      observation,
      history,
    };
    const digest = platformToolDigest(extraTools);
    const skillText = skillDigest(skills);
    let lastError = '';
    for (let attempt = 0; attempt <= MAX_INVALID_DECISIONS; attempt += 1) {
      const result = await aiJson<RcAgentDecision>(this.prisma, {
        userId: device.userId,
        model: text(body.modelKey).trim().slice(0, 128) || undefined,
        module: 'rpa',
        operation: 'chrome_agent_step',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content:
              `${JSON.stringify(snapshot, null, 2)}` +
              (skillText
                ? `\n\n本账号沉淀的技能（按其偏好与站点套路办事，与用户目标冲突时以用户目标为准）：\n${skillText}`
                : '') +
              (digest
                ? `\n\n可用平台工具（工具名｜说明｜读写）：\n${digest}`
                : '') +
              (lastError
                ? `\n\n上一次输出不可用：${lastError}，请重新给出一个合规动作。`
                : ''),
          },
        ],
        maxTokens: 800,
        timeoutMs: DECISION_TIMEOUT_MS,
        purpose: 'chat',
        validate: (raw) => {
          const thought = text(raw.thought).slice(0, 1000);
          const reply = text(raw.reply).slice(0, 2000);
          const question = text(raw.question).slice(0, 500);
          const confirmText = text(raw.confirm).slice(0, 500);
          const action = normalizeDecidedAction(raw);
          const tool = normalizeToolCall(raw.tool);
          const finishReason = text(raw.reason ?? raw.finishReason).slice(
            0,
            300,
          );
          if (
            !action &&
            !tool &&
            !reply &&
            !question &&
            !confirmText &&
            !finishReason
          ) {
            lastError =
              '既没有给合法动作，也没有给出平台工具、结束原因、回复、追问或待确认说明';
            return null;
          }
          if (raw.action && !action) {
            lastError = '动作不在闭集内或缺少必要字段';
            return null;
          }
          if (raw.tool && !tool) {
            lastError = '平台工具缺少工具名（tool.tool）';
            return null;
          }
          // 已有动作或工具＝执行步：清掉对话/确认类字段；否则是结束、对话轮次或待用户确认。
          const executing = Boolean(action || tool);
          const talk = executing || Boolean(finishReason);
          return {
            thought,
            action,
            tool,
            needsConfirm: Boolean(
              action &&
              settings.confirmSensitive &&
              chromeActionNeedsConfirm(action),
            ),
            finishReason: executing ? '' : finishReason,
            reply: talk ? '' : reply,
            question: talk ? '' : question,
            confirm: talk ? '' : confirmText,
            model: '',
          };
        },
      });
      if (result) return { ...result.data, model: result.model || '' };
    }
    // 全部尝试都没拿到合规决策：先分辨是不是「压根没有可用模型」，别把「还没设置默认模型」
    // 误报成模型行为问题，给用户一句可执行的引导。
    let noModel = false;
    try {
      const resolved = await resolveModel(
        this.prisma,
        {
          userId: device.userId,
          model: text(body.modelKey).trim().slice(0, 128) || undefined,
        },
        false,
      );
      noModel = !resolved;
    } catch {
      // 解析失败＝原因未知，按模型行为处理，不改口径。
      noModel = false;
    }
    if (noModel) {
      return {
        thought: '',
        action: null,
        tool: null,
        needsConfirm: false,
        finishReason: '',
        reply:
          '还没有设置默认模型：请到「模型服务 → 模型设置」选一个默认模型后再重试。',
        question: '',
        confirm: '',
        model: '',
      };
    }
    return {
      thought: '',
      action: null,
      tool: null,
      needsConfirm: false,
      finishReason: '模型连续未给出合规动作，已停止',
      reply: '',
      question: '',
      confirm: '',
      model: '',
    };
  }

  /**
   * 「增强提示」：把用户的一句话目标改写成更清晰、可执行的目标（走本系统模型，静默失败回落原文）。
   * 只改「说法」，不改用户的意图，也不替用户杜撰站点或凭据。
   */
  async enhanceForDevice(
    device: ChromeDevicePrincipal,
    body: Record<string, unknown>,
  ): Promise<{ goal: string }> {
    const goal = text(body.goal).trim().slice(0, 1000);
    if (!goal)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请先写下目标');
    const result = await tryChat(this.prisma, {
      userId: device.userId,
      model: text(body.modelKey).trim().slice(0, 128) || undefined,
      module: 'rpa',
      operation: 'chrome_agent_enhance',
      messages: [
        {
          role: 'system',
          content:
            '你是浏览器代理的目标改写器。把用户的一句话目标改写成一条更清晰、可执行的目标：说清要在哪个站点/页面做什么动作、要拿到什么结果。保留原意，不要杜撰不存在的站点、网址或账号凭据。只输出改写后的目标文本，不要任何解释或前后缀。',
        },
        { role: 'user', content: goal },
      ],
      maxTokens: 400,
      timeoutMs: 30_000,
      purpose: 'chat',
    });
    const enhanced = text(result?.reply).trim().slice(0, 1000);
    return { goal: enhanced || goal };
  }

  /** 附件直传：把侧边栏选中的文件存进本账号的数字资产，返回对象键供 Agent 引用。 */
  async uploadForDevice(
    device: ChromeDevicePrincipal,
    body: Record<string, unknown>,
  ): Promise<{ key: string; url: string; name: string; size: number }> {
    const name = text(body.name).trim().slice(0, 200) || 'attachment';
    const data = text(body.data);
    const matched = /^data:([^;,]+)?;base64,(.*)$/s.exec(data);
    if (!matched)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '附件格式不支持');
    const bytes = Buffer.from(matched[2], 'base64');
    if (!bytes.length)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '附件内容为空');
    if (bytes.length > ATTACHMENT_MAX_BYTES) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `附件不能超过 ${Math.round(ATTACHMENT_MAX_BYTES / 1024 / 1024)}MB`,
      );
    }
    const uploaded = await this.storage.put(
      `rpa-chrome/${device.userId}/attachments/${Date.now()}-${randomBytes(4).toString('hex')}`,
      bytes,
    );
    return { key: uploaded.key, url: uploaded.url, name, size: uploaded.size };
  }

  async pauseSession(user: CurrentUser, id: number) {
    await this.requireOwned(user, id);
    await this.prisma.rpaChromeSession.updateMany({
      where: {
        id,
        createdBy: user.userId,
        status: { in: ['RUNNING', 'WAITING_CONFIRM'] },
      },
      data: { status: 'PAUSED' },
    });
    return this.sessionView(user, id);
  }

  async resumeSession(user: CurrentUser, id: number) {
    const row = await this.requireOwned(user, id);
    if (rcSessionTerminal(row.status)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '会话已结束，无法继续',
      );
    }
    await this.prisma.rpaChromeSession.update({
      where: { id },
      data: { status: 'RUNNING' },
    });
    void this.run(id).catch(() => undefined);
    return this.sessionView(user, id);
  }

  async stopSession(user: CurrentUser, id: number) {
    await this.requireOwned(user, id);
    await this.devices.cancelSession(id, 'stopped', '用户手动停止');
    return this.sessionView(user, id);
  }

  /** 重试某一步：重置该步与指令，并把会话退回该步重跑（另起一条指令）。 */
  async retryStep(user: CurrentUser, stepId: number) {
    const step = await this.prisma.rpaChromeStep.findFirst({
      where: { id: stepId, createdBy: user.userId },
    });
    if (!step) throw new BusinessException(ErrorCode.NOT_FOUND, '步骤不存在');
    const session = await this.requireOwned(user, step.sessionId);
    if (session.status === 'RUNNING' || session.status === 'WAITING_CONFIRM') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '会话正在执行，请先暂停或停止后再重试该步骤',
      );
    }
    if (session.status !== 'PAUSED' && session.status !== 'FAILED') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '只有已暂停或失败的会话可以重试步骤',
      );
    }
    await this.prisma.rpaChromeStep.update({
      where: { id: stepId },
      data: { status: 'RUNNING', errorMessage: '', elapsedMs: 0 },
    });
    await this.prisma.rpaChromeSession.update({
      where: { id: session.id },
      data: { status: 'RUNNING', stepCount: step.stepIndex, endedAt: null },
    });
    void this.run(session.id).catch(() => undefined);
    return this.sessionView(user, session.id);
  }

  /** 会话截图：仅属主可读，代理 OSS 字节（不把桶地址直接暴露给页面）。 */
  async readStepScreenshot(user: CurrentUser, stepId: number) {
    const step = await this.prisma.rpaChromeStep.findFirst({
      where: { id: stepId, createdBy: user.userId },
    });
    if (!step) throw new BusinessException(ErrorCode.NOT_FOUND, '步骤不存在');
    if (!step.screenshotKey) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '该步骤没有截图');
    }
    return this.storage.read(step.screenshotKey).then((bytes) => ({
      bytes,
      contentType: 'image/png',
    }));
  }

  private async requireOwned(user: CurrentUser, id: number) {
    const row = await this.prisma.rpaChromeSession.findFirst({
      where: { id, createdBy: user.userId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '会话不存在');
    return row;
  }

  // ---------- 决策循环 ----------

  private async run(sessionId: number) {
    const session = await this.prisma.rpaChromeSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) return;
    if (rcSessionTerminal(session.status)) return;
    try {
      await this.loop(session.id);
    } catch (error) {
      await this.finish(session.id, 'FAILED', 'error', messageOf(error));
    }
  }

  private async loop(sessionId: number) {
    const session = await this.prisma.rpaChromeSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) return;
    const settings = await this.devices.settingsOf(session.createdBy);
    const script = asJsonArray(session.script)
      .map((item) => normalizeChromeAction(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    const deadline =
      session.startedAt.getTime() + settings.sessionTimeoutSeconds * 1000;
    let consecutiveFailures = 0;

    for (let index = session.stepCount; index < session.maxSteps; index += 1) {
      const current = await this.prisma.rpaChromeSession.findUnique({
        where: { id: sessionId },
      });
      if (!current) return;
      if (rcSessionTerminal(current.status)) return;
      if (current.status === 'PAUSED') {
        await sleep(2000);
        index -= 1; // 暂停期间原地等待，不计步
        if (Date.now() > deadline) {
          await this.finish(
            sessionId,
            'TIMEOUT',
            'timeout',
            '会话超过总时长上限',
          );
          return;
        }
        continue;
      }
      // 总时长兜底：暂停也算在预算内，避免会话永久悬挂
      if (Date.now() > deadline) {
        await this.finish(
          sessionId,
          'TIMEOUT',
          'timeout',
          '会话超过总时长上限',
        );
        return;
      }
      if (
        !(await this.devices.deviceOnline(current.createdBy, current.clientId))
      ) {
        await this.finish(
          sessionId,
          'FAILED',
          'offline',
          '设备离线，无法继续执行',
        );
        return;
      }

      // 1) 取本步动作：确定性回放 or LLM 决策
      let decision: Decision;
      if (script.length) {
        if (index >= script.length) {
          await this.finish(
            sessionId,
            'COMPLETED',
            'done',
            '动作序列已全部执行完成',
          );
          return;
        }
        decision = { action: script[index], thought: '' };
      } else {
        const observation = await this.latestObservation(sessionId);
        const history = await this.recentHistory(sessionId);
        const decided = await this.decide(
          current,
          observation,
          history,
          settings,
        );
        if (!decided) {
          await this.finish(
            sessionId,
            'FAILED',
            'no_action',
            '模型没有给出可执行的合规动作',
          );
          return;
        }
        decision = decided;
      }

      if (decision.action.action === 'finish') {
        await this.finish(
          sessionId,
          'COMPLETED',
          'done',
          text(decision.action.reason).slice(0, 200) || '模型判定目标已完成',
        );
        return;
      }

      // 2) 敏感动作需人工确认
      const needsConfirm =
        settings.confirmSensitive && chromeActionNeedsConfirm(decision.action);
      const step = await this.upsertStep(
        current,
        index,
        decision,
        needsConfirm,
      );
      const command = await this.devices.enqueueCommand({
        userId: current.createdBy,
        clientId: current.clientId,
        sessionId: current.id,
        stepIndex: index,
        action: decision.action,
        needsConfirm,
      });
      await this.prisma.rpaChromeStep.update({
        where: { id: step.id },
        data: { commandCode: command.commandCode },
      });
      if (needsConfirm) {
        await this.prisma.rpaChromeSession.update({
          where: { id: sessionId },
          data: { status: 'WAITING_CONFIRM' },
        });
        // 敏感动作停下等确认：任务中心留一条「待确认」，离开确认态即收口（docs §8.4）。
        await this.openConfirmTask(current, index, decision.action);
      }

      // 3) 等插件回执（无回执即超时，绝不伪造成功）
      const outcome = await this.awaitCommand(
        command.commandCode,
        settings.stepTimeoutSeconds * 1000,
      );
      const stored = await this.persistOutcome(
        current,
        step.id,
        index,
        outcome,
      );
      if (needsConfirm) {
        await this.settleConfirmTask(
          current,
          index,
          outcome.status === 'DONE'
            ? '已确认并执行'
            : outcome.status === 'CANCELLED'
              ? '已拒绝，动作未执行'
              : outcome.status === 'TIMEOUT'
                ? '确认超时，会话已结束'
                : '确认后执行失败',
        );
      }
      // 遇登录墙/验证码/风控：立即停止并派「登录/验证」待办，不自动重试（docs §8.4）。
      const outcomeCode = text(outcome.result.code).trim();
      if (
        outcome.status === 'FAILED' &&
        (LOGIN_BLOCK_PATTERN.test(outcomeCode) ||
          LOGIN_BLOCK_PATTERN.test(stored.errorMessage))
      ) {
        const reason =
          stored.errorMessage || outcomeCode || '目标站点需要登录或验证';
        await this.openLoginTask(current, index, reason);
        await this.finish(sessionId, 'FAILED', 'need_login', reason);
        return;
      }
      await this.prisma.rpaChromeSession.update({
        where: { id: sessionId },
        data: {
          stepCount: index + 1,
          ...(current.status === 'WAITING_CONFIRM'
            ? { status: 'RUNNING' }
            : {}),
        },
      });

      if (outcome.status === 'CANCELLED') {
        await this.finish(
          sessionId,
          'CANCELLED',
          'stopped',
          '敏感动作未获允许，已停止',
        );
        return;
      }
      if (outcome.status === 'TIMEOUT') {
        await this.finish(
          sessionId,
          'FAILED',
          'timeout',
          `第 ${index + 1} 步超过 ${settings.stepTimeoutSeconds} 秒没有回执`,
        );
        return;
      }
      if (outcome.status === 'FAILED') {
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          await this.finish(
            sessionId,
            'FAILED',
            'error',
            stored.errorMessage || '连续多步执行失败',
          );
          return;
        }
      } else {
        consecutiveFailures = 0;
      }
    }

    await this.finish(
      sessionId,
      'COMPLETED',
      'max_steps',
      '已达到最大步数上限',
    );
  }

  private async upsertStep(
    session: Prisma.RpaChromeSessionGetPayload<object>,
    index: number,
    decision: Decision,
    needsConfirm: boolean,
  ) {
    const data = {
      action: decision.action as Prisma.InputJsonValue,
      thought: decision.thought.slice(0, 1000),
      status: needsConfirm ? 'PENDING_CONFIRM' : 'RUNNING',
      errorMessage: '',
      elapsedMs: 0,
    };
    return this.prisma.rpaChromeStep.upsert({
      where: {
        sessionId_stepIndex: { sessionId: session.id, stepIndex: index },
      },
      create: {
        sessionId: session.id,
        createdBy: session.createdBy,
        stepIndex: index,
        ...data,
      },
      update: { ...data, observation: {} },
    });
  }

  /** 等指令到达终态：插件逐秒轮询心跳领取并回执，这里轮询库内状态。 */
  private async awaitCommand(commandCode: string, timeoutMs: number) {
    const deadline = Date.now() + Math.max(POLL_INTERVAL_MS, timeoutMs);
    for (;;) {
      const row = await this.prisma.rpaChromeCommand.findUnique({
        where: { commandCode },
      });
      if (!row) return { status: 'FAILED' as const, result: {} };
      if (
        row.status === 'DONE' ||
        row.status === 'FAILED' ||
        row.status === 'CANCELLED'
      ) {
        return { status: row.status, result: toJsonObject(row.result) };
      }
      if (Date.now() >= deadline) {
        await this.prisma.rpaChromeCommand.updateMany({
          where: {
            commandCode,
            status: { in: ['PENDING', 'DISPATCHED', 'PENDING_CONFIRM'] },
          },
          data: { status: 'TIMEOUT', finishedAt: new Date() },
        });
        return { status: 'TIMEOUT' as const, result: {} };
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  /** 落库本步结果：截图转存 OSS（属主可读），页面观测留给下一步决策。 */
  private async persistOutcome(
    session: Prisma.RpaChromeSessionGetPayload<object>,
    stepId: number,
    index: number,
    outcome: { status: string; result: Record<string, unknown> },
  ) {
    const data: Record<string, unknown> = {
      ...toJsonObject(outcome.result.data),
    };
    const errorMessage = text(outcome.result.errorMessage).slice(0, 500);
    let screenshotKey = '';
    const shot = data.screenshot;
    if (typeof shot === 'string' && shot.startsWith('data:image/')) {
      screenshotKey = await this.storeScreenshot(session, index, shot).catch(
        () => '',
      );
      delete data.screenshot;
    }
    if (screenshotKey) data.screenshotKey = screenshotKey;
    const status =
      outcome.status === 'DONE'
        ? 'DONE'
        : outcome.status === 'CANCELLED'
          ? 'CANCELLED'
          : outcome.status === 'TIMEOUT'
            ? 'TIMEOUT'
            : 'FAILED';
    await this.prisma.rpaChromeStep.update({
      where: { id: stepId },
      data: {
        status,
        observation: data as Prisma.InputJsonValue,
        ...(screenshotKey ? { screenshotKey } : {}),
        elapsedMs: Math.max(
          0,
          Math.round(Number(outcome.result.elapsedMs) || 0),
        ),
        errorMessage,
      },
    });
    return { errorMessage };
  }

  private async storeScreenshot(
    session: Prisma.RpaChromeSessionGetPayload<object>,
    index: number,
    dataUrl: string,
  ) {
    const base64 = dataUrl.split(',')[1] || '';
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.length > SCREENSHOT_MAX_BYTES) return '';
    const path = `rpa-chrome/${session.createdBy}/${session.id}/${index}-${randomBytes(4).toString('hex')}.png`;
    const uploaded = await this.storage.put(path, bytes);
    return uploaded.key;
  }

  private async latestObservation(sessionId: number) {
    const step = await this.prisma.rpaChromeStep.findFirst({
      where: { sessionId, status: { in: ['DONE', 'FAILED'] } },
      orderBy: { stepIndex: 'desc' },
    });
    return toJsonObject(step?.observation);
  }

  private async recentHistory(sessionId: number) {
    const rows = await this.prisma.rpaChromeStep.findMany({
      where: { sessionId },
      orderBy: { stepIndex: 'desc' },
      take: 5,
    });
    return rows
      .reverse()
      .map(
        (row) =>
          `#${row.stepIndex + 1} 动作=${JSON.stringify(toJsonObject(row.action))} 结果=${row.status}${row.errorMessage ? ` 错误=${row.errorMessage}` : ''}`,
      )
      .join('\n');
  }

  /** 调一次 LLM 拿下一步动作；不合规重试 2 次，仍不合规返回 null。 */
  private async decide(
    session: Prisma.RpaChromeSessionGetPayload<object>,
    observation: Record<string, unknown>,
    history: string,
    settings: ChromeSettings,
  ): Promise<Decision | null> {
    const snapshot = {
      goal: session.goal,
      mode: session.mode,
      stepIndex: session.stepCount + 1,
      maxSteps: settings.maxSteps,
      // 云端下发的目标＝平台/用户已派单，直接执行，不再走「先确认再执行」闸。
      confirmed: true,
      observation,
      history,
    };
    let lastError = '';
    for (let attempt = 0; attempt <= MAX_INVALID_DECISIONS; attempt += 1) {
      const result = await aiJson<Decision>(this.prisma, {
        userId: session.createdBy,
        model: session.model || undefined,
        module: 'rpa',
        operation: 'chrome_decision',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content:
              `${JSON.stringify(snapshot, null, 2)}` +
              (lastError
                ? `\n\n上一次输出不可用：${lastError}，请重新给出一个合规动作。`
                : ''),
          },
        ],
        maxTokens: 800,
        timeoutMs: DECISION_TIMEOUT_MS,
        purpose: 'chat',
        validate: (raw) => {
          const action = normalizeDecidedAction(raw);
          if (!action) {
            lastError = '动作不在闭集内或缺少必要字段';
            return null;
          }
          return { action, thought: text(raw.thought).slice(0, 1000) };
        },
      });
      if (result) return result.data;
    }
    return null;
  }

  private async finish(
    sessionId: number,
    status: string,
    stopReason: string,
    message: string,
  ) {
    const now = new Date();
    // CAS 同一条收口：只有第一次把会话从「非终态」改成终态的那次调用回写执行记录，
    // 避免收尾路径（正常结束 / 循环 catch / 用户停止）重复 seal 同一条执行。
    const updated = await this.prisma.rpaChromeSession.updateMany({
      where: {
        id: sessionId,
        status: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT'] },
      },
      data: {
        status,
        stopReason: stopReason.slice(0, 32),
        errorMessage: status === 'COMPLETED' ? '' : message.slice(0, 500),
        endedAt: now,
      },
    });
    if (updated.count !== 1) return;
    const session = await this.prisma.rpaChromeSession.findUnique({
      where: { id: sessionId },
      select: {
        createdBy: true,
        executionId: true,
        taskId: true,
        stepCount: true,
      },
    });
    if (!session || session.executionId <= 0) return;
    // 复用 RpaTaskExecution 台账：会话结果 = 一次任务执行的终态（失败且还有重试次数则退回 pending）
    const execStatus =
      status === 'COMPLETED'
        ? 'success'
        : status === 'CANCELLED'
          ? 'cancelled'
          : 'failed';
    await this.tasks.finishChromeExecution(
      session.createdBy,
      session.executionId,
      {
        status: execStatus,
        errorMessage: status === 'COMPLETED' ? '' : message,
        output: {
          sessionId,
          taskId: session.taskId,
          stopReason,
          stepCount: session.stepCount,
        },
      },
    );
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageOf(error: unknown) {
  if (error instanceof BusinessException) return error.message;
  return text((error as { message?: unknown })?.message) || '会话执行异常';
}
