import {
  WORKFLOW_TASK_EVENTS,
  type WorkflowGraph,
} from '@enterprise/contracts';
import {
  dueCronSlots,
  parseCron,
  slotKey,
  type CronSpec,
} from './workflow-cron';

/**
 * 触发器读取与校验：图里的 `trigger.*` 节点是唯一的触发配置来源，
 * 不另建触发器表；保存 / 发布时校验，调度器与事件桥按同一份解析结果命中。
 * 外部 Webhook 触发不开放（决策 D2=C），因此这里没有 webhook 分支。
 */

export type ScheduleBinding = { nodeId: string; cron: string; spec: CronSpec };
export type EventBinding = { nodeId: string; event: string };
export type TaskBinding = { nodeId: string; event: string; source: string };

const str = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const TASK_EVENTS: readonly string[] = WORKFLOW_TASK_EVENTS;

export function validateTriggers(
  graph: WorkflowGraph,
): { ok: true } | { ok: false; message: string } {
  for (const node of graph.nodes) {
    if (node.type !== 'trigger') continue;
    const label = node.name || node.id;
    const config = node.config ?? {};
    if (node.kind === 'trigger.schedule') {
      const parsed = parseCron(str(config.cron));
      if (!parsed.ok) {
        return {
          ok: false,
          message: `节点「${label}」的 cron 不合法：${parsed.message}`,
        };
      }
    } else if (node.kind === 'trigger.event') {
      if (!str(config.event)) {
        return { ok: false, message: `节点「${label}」还没有填写事件名` };
      }
    } else if (node.kind === 'trigger.task') {
      const event = str(config.event);
      if (!TASK_EVENTS.includes(event)) {
        return {
          ok: false,
          message: `节点「${label}」的任务变化类型只能是 ${WORKFLOW_TASK_EVENTS.join(' / ')}`,
        };
      }
    }
  }
  return { ok: true };
}

export function scheduleBindings(graph: WorkflowGraph): ScheduleBinding[] {
  const out: ScheduleBinding[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'trigger' || node.kind !== 'trigger.schedule') continue;
    const cron = str(node.config?.cron);
    const parsed = parseCron(cron);
    if (parsed.ok) out.push({ nodeId: node.id, cron, spec: parsed.spec });
  }
  return out;
}

export function eventBindings(graph: WorkflowGraph): EventBinding[] {
  const out: EventBinding[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'trigger' || node.kind !== 'trigger.event') continue;
    const event = str(node.config?.event);
    if (event) out.push({ nodeId: node.id, event });
  }
  return out;
}

export function taskBindings(graph: WorkflowGraph): TaskBinding[] {
  const out: TaskBinding[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'trigger' || node.kind !== 'trigger.task') continue;
    const event = str(node.config?.event);
    if (!TASK_EVENTS.includes(event)) continue;
    out.push({ nodeId: node.id, event, source: str(node.config?.source) });
  }
  return out;
}

/** 本轮 tick 该起的定时槽：回看 window 分钟补 tick 漂移，超出窗口的错过周期不补跑。 */
export function dueScheduleSlots(
  bindings: ScheduleBinding[],
  now: Date,
  lookbackMinutes = 5,
): Array<{ binding: ScheduleBinding; slotMs: number; key: string }> {
  const toMinute = Math.floor(now.getTime() / 60_000);
  const out: Array<{
    binding: ScheduleBinding;
    slotMs: number;
    key: string;
  }> = [];
  const seen = new Set<string>();
  for (const binding of bindings) {
    for (const slotMs of dueCronSlots(
      binding.spec,
      toMinute - lookbackMinutes,
      toMinute,
      lookbackMinutes,
    )) {
      const key = slotKey(slotMs);
      // 同一工作流同一分钟只起一次：多个 cron 节点撞在同一格时不重复跑整张图。
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ binding, slotMs, key });
    }
  }
  return out.sort((a, b) => a.slotMs - b.slotMs);
}
