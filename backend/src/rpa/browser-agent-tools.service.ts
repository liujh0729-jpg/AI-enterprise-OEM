import { type RcDeviceView, type RcSkillView } from '@enterprise/contracts';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import type { ChromeAgentService } from './chrome-agent.service';
import type { RpaChromeDeviceService } from './chrome-device.service';
import type { RpaChromeLibraryService } from './chrome-library.service';

/**
 * 浏览器代理的 MCP 语义层（docs/浏览器代理插件升级方案.md §七）：
 * 外部 MCP 客户端（Codex / Claude / Cursor / 自研脚本）与站内对话之外的调用方，
 * 用这一组工具驱动用户本机的 Chrome —— **设备绿灯（在线）即可派任务**，离线即拒。
 *
 * 这里只做「语义 → 既有服务」的翻译与在线闸，不重写会话逻辑：
 * 发起/停止/回放交给 `ChromeAgentService`，技能库交给 `RpaChromeLibraryService`，
 * 所以走的是与界面同一个 handler、同一份校验、同一条留痕。
 */

/** 工具返回：MCP 层按 `ok` 决定 isError，其余字段原样进 structuredContent。 */
export type BrowserToolResult = Record<string, unknown> & {
  ok: boolean;
  message: string;
};

/** 技能正文进目标时的截断长度：与 `goal` 的契约上限一致。 */
const GOAL_MAX = 1000;

function okOf(payload: Record<string, unknown>): BrowserToolResult {
  return { ok: true, message: '', ...payload };
}

function failOf(message: string): BrowserToolResult {
  return { ok: false, message };
}

/** 给外部客户端一句话讲清「为什么现在不能派任务」。 */
function offlineHint(devices: RcDeviceView[]): string {
  if (!devices.length) {
    return '本人名下还没有本地 Chrome 设备：请在浏览器里打开「AIPDD Enterprise」插件、登录本系统并保持侧边栏在线（设备亮绿灯）后再试。';
  }
  const lines = devices.map(
    (device) =>
      `${device.online ? '在线（绿灯）' : '离线'}｜${device.name}｜client_id=${device.clientId}`,
  );
  return `没有在线的本地 Chrome 设备（绿灯），无法派任务。当前设备：\n${lines.join('\n')}\n请在插件里登录并保持在线后再试。`;
}

export class BrowserAgentToolsService {
  constructor(
    private readonly devices: RpaChromeDeviceService,
    private readonly agent: ChromeAgentService,
    private readonly library: RpaChromeLibraryService,
  ) {}

  /** MCP `tools/call` 的入口：名字不属于这一组时返回 null，交回上层继续分流。 */
  async run(
    user: CurrentUser,
    name: string,
    args: Record<string, unknown>,
  ): Promise<BrowserToolResult | null> {
    switch (name) {
      case 'browser_agent_start':
        return this.start(user, args);
      case 'browser_agent_status':
        return this.status(user, args);
      case 'browser_agent_result':
        return this.result(user, args);
      case 'browser_agent_stop':
        return this.stop(user, args);
      case 'browser_extract':
        return this.extract(user, args);
      case 'browser_skill_list':
        return this.skillList(user, args);
      case 'browser_skill_run':
        return this.skillRun(user, args);
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------- 会话四件套

  private async start(
    user: CurrentUser,
    args: Record<string, unknown>,
  ): Promise<BrowserToolResult> {
    const goal = text(args['goal']).trim().slice(0, GOAL_MAX);
    if (!goal) return failOf('请给出要完成的目标（goal）');
    const mode = text(args['mode']).trim().toLowerCase() || 'act';
    return this.startOn(user, {
      goal,
      mode,
      clientId: text(args['client_id']).trim(),
      startUrl: text(args['start_url']).trim(),
      maxSteps: Math.round(Number(args['max_steps']) || 0),
    });
  }

  private async extract(
    user: CurrentUser,
    args: Record<string, unknown>,
  ): Promise<BrowserToolResult> {
    const instruction = text(args['instruction']).trim().slice(0, GOAL_MAX);
    if (!instruction) return failOf('请给出抽取要求（instruction）');
    const schemaNote = text(args['schema_note']).trim().slice(0, 2000);
    const goal = (
      schemaNote ? `${instruction}\n\n结果字段口径：${schemaNote}` : instruction
    ).slice(0, GOAL_MAX);
    return this.startOn(user, {
      goal,
      mode: 'extract',
      clientId: text(args['client_id']).trim(),
      startUrl: text(args['start_url']).trim(),
      maxSteps: 0,
    });
  }

  private async status(
    user: CurrentUser,
    args: Record<string, unknown>,
  ): Promise<BrowserToolResult> {
    const id = Math.round(Number(args['session_id']) || 0);
    if (!id) return failOf('缺少会话编号（session_id）');
    try {
      const session = await this.agent.sessionView(user, id, false);
      return okOf({
        sessionId: session.id,
        status: session.status,
        statusLabel: session.statusLabel,
        mode: session.mode,
        modeLabel: session.modeLabel,
        clientId: session.clientId,
        deviceName: session.deviceName,
        stepCount: session.stepCount,
        maxSteps: session.maxSteps,
        goal: session.goal,
        stopReason: session.stopReason,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
      });
    } catch (error) {
      return failOf(this.reasonOf(error, '会话不存在'));
    }
  }

  private async result(
    user: CurrentUser,
    args: Record<string, unknown>,
  ): Promise<BrowserToolResult> {
    const id = Math.round(Number(args['session_id']) || 0);
    if (!id) return failOf('缺少会话编号（session_id）');
    try {
      const session = await this.agent.sessionView(user, id, true);
      return okOf({
        sessionId: session.id,
        status: session.status,
        statusLabel: session.statusLabel,
        mode: session.mode,
        modeLabel: session.modeLabel,
        goal: session.goal,
        clientId: session.clientId,
        deviceName: session.deviceName,
        stepCount: session.stepCount,
        maxSteps: session.maxSteps,
        stopReason: session.stopReason,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        steps: (session.steps ?? []).map((step) => ({
          stepIndex: step.stepIndex,
          action: step.action,
          thought: step.thought,
          status: step.status,
          observation: step.observation,
          screenshotUrl: step.screenshotUrl,
          errorMessage: step.errorMessage,
        })),
      });
    } catch (error) {
      return failOf(this.reasonOf(error, '会话不存在'));
    }
  }

  private async stop(
    user: CurrentUser,
    args: Record<string, unknown>,
  ): Promise<BrowserToolResult> {
    const id = Math.round(Number(args['session_id']) || 0);
    if (!id) return failOf('缺少会话编号（session_id）');
    try {
      const session = await this.agent.stopSession(user, id);
      return okOf({
        sessionId: session.id,
        status: session.status,
        statusLabel: session.statusLabel,
        message: `已停止会话 #${id}`,
      });
    } catch (error) {
      return failOf(this.reasonOf(error, '会话不存在'));
    }
  }

  // ---------------------------------------------------------------- 技能库

  private async skillList(
    user: CurrentUser,
    args: Record<string, unknown>,
  ): Promise<BrowserToolResult> {
    const kind = text(args['kind']).trim().toLowerCase();
    const result = await this.library.listSkills(user, {
      kind: kind === 'personal' || kind === 'site' ? kind : '',
      keyword: text(args['keyword']).trim(),
    });
    const skills: RcSkillView[] = result.list;
    if (!skills.length) {
      return okOf({
        total: 0,
        skills: [],
        message:
          '本账号还没有技能：可在插件侧边栏「技能库」里沉淀偏好与站点操作知识。',
      });
    }
    return okOf({
      total: skills.length,
      skills: skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        kind: skill.kind,
        kindLabel: skill.kindLabel,
        site: skill.site,
        description: skill.description,
        enabled: skill.enabled,
      })),
    });
  }

  private async skillRun(
    user: CurrentUser,
    args: Record<string, unknown>,
  ): Promise<BrowserToolResult> {
    const wanted = text(args['skill']).trim();
    if (!wanted) return failOf('请给出要运行的技能（skill：技能名或技能编号）');
    const { list } = await this.library.listSkills(user, {});
    const matched = pickSkill(list, wanted);
    if (!matched) {
      const names = list
        .slice(0, 20)
        .map((skill) => `#${skill.id} ${skill.name}`);
      return failOf(
        `没有找到技能「${wanted}」。本账号现有技能：${names.join('；') || '（还没有技能）'}`,
      );
    }
    const goal = (text(args['goal']).trim() || matched.content).slice(
      0,
      GOAL_MAX,
    );
    if (!goal)
      return failOf(
        `技能「${matched.name}」没有正文，也没有给出 goal，无法派任务`,
      );
    const startUrl = text(args['start_url']).trim() || siteUrl(matched.site);
    const started = await this.startOn(user, {
      goal,
      mode: 'act',
      clientId: text(args['client_id']).trim(),
      startUrl,
      maxSteps: 0,
    });
    return started.ok
      ? okOf({
          ...started,
          skill: { id: matched.id, name: matched.name, kind: matched.kind },
        })
      : started;
  }

  // ---------------------------------------------------------------- 内部助手

  /** 发起会话的共同前半段：先锁定一台在线（绿灯）设备，再把能力档与目标交给会话引擎。 */
  private async startOn(
    user: CurrentUser,
    input: {
      goal: string;
      mode: string;
      clientId: string;
      startUrl: string;
      maxSteps: number;
    },
  ): Promise<BrowserToolResult> {
    const picked = await this.onlineDevice(user, input.clientId);
    if (!picked.ok) return picked;
    const clientId = String(picked['clientId']);
    try {
      const session = await this.agent.startSession(user, {
        clientId,
        goal: input.goal,
        mode: input.mode,
        ...(input.startUrl ? { startUrl: input.startUrl } : {}),
        ...(input.maxSteps ? { maxSteps: input.maxSteps } : {}),
      });
      return okOf({
        sessionId: session.id,
        clientId: session.clientId,
        deviceName: session.deviceName,
        status: session.status,
        statusLabel: session.statusLabel,
        mode: session.mode,
        modeLabel: session.modeLabel,
        goal: session.goal,
        message: `已在设备「${session.deviceName}」上发起浏览器代理会话 #${session.id}，用 browser_agent_status / browser_agent_result 跟进。`,
      });
    } catch (error) {
      return failOf(this.reasonOf(error, '发起会话失败'));
    }
  }

  /**
   * 在线闸：绿灯（ONLINE）才派任务。
   * · 指定 client_id：不存在或离线都如实说明；
   * · 未指定：本人只有一台在线设备就直接用，多台就让调用方明确指定（不替用户猜）。
   */
  private async onlineDevice(
    user: CurrentUser,
    clientId: string,
  ): Promise<BrowserToolResult> {
    const { devices } = await this.devices.listDevices(user);
    if (clientId) {
      const hit = devices.find((device) => device.clientId === clientId);
      if (!hit) {
        return failOf(
          `没有 client_id=${clientId} 的本地 Chrome 设备，请先确认设备号。`,
        );
      }
      if (!hit.online) {
        return failOf(
          `设备「${hit.name}」当前离线（红灯），无法派任务：请在插件里登录本系统并保持侧边栏在线后再试。`,
        );
      }
      return okOf({ clientId: hit.clientId, deviceName: hit.name });
    }
    const online = devices.filter((device) => device.online);
    if (!online.length) return failOf(offlineHint(devices));
    if (online.length > 1) {
      const lines = online.map(
        (device) => `${device.name}｜client_id=${device.clientId}`,
      );
      return failOf(
        `本人有 ${online.length} 台在线设备，请用 client_id 指定要派给哪一台：\n${lines.join('\n')}`,
      );
    }
    return okOf({ clientId: online[0].clientId, deviceName: online[0].name });
  }

  private reasonOf(error: unknown, fallback: string) {
    if (error instanceof BusinessException) return error.message;
    const message = text((error as { message?: unknown })?.message);
    return message || fallback;
  }
}

/** 按技能编号或名称精确匹配，其次按名称包含匹配；都不中返回 null。 */
function pickSkill(skills: RcSkillView[], wanted: string): RcSkillView | null {
  const numeric = /^\d+$/.test(wanted) ? Number(wanted) : 0;
  if (numeric) {
    const byId = skills.find((skill) => skill.id === numeric);
    if (byId) return byId;
  }
  const exact = skills.find((skill) => skill.name === wanted);
  if (exact) return exact;
  const needle = wanted.toLowerCase();
  return (
    skills.find((skill) => skill.name.toLowerCase().includes(needle)) ?? null
  );
}

/** 站点技能里的 site 可能是 hostname：补上协议再作为起始地址。 */
function siteUrl(site: string): string {
  const value = site.trim();
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}
