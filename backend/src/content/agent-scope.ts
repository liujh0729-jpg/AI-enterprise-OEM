import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 一次 Agent 执行的作用域：定时任务可以把「只注入哪些 MCP 连接器」、
 * 「只处理哪些邮箱」、「只用哪些插件」固定到这一轮，组提示词和调工具时都读同一份，不靠模型自觉。
 */
export type AgentRunScope = {
  connectorIds: number[];
  mailboxIds: number[];
  /** 本轮勾选的插件 id；空＝全部启用中的插件（不传同样当不收窄）。 */
  pluginIds?: number[];
  /** 本轮生效的数字分身；用于 save_memory 写入该分身的私有记忆。 */
  personaId?: number;
  /** 分身挂载的默认知识空间；kb_retrieve 没另传 space_ids 时只查这一个。 */
  spaceId?: number;
  /** 触发来源：对话＝chat；定时任务 / 助理等无人值守＝schedule，MCP 写动作按它收紧。 */
  trigger: 'chat' | 'schedule';
  /**
   * 本轮是否允许执行写动作。只有显式 true 才放开：
   * 对话里用户在屏幕前＝true；定时任务默认 false（逐任务勾选才放开），
   * 避免无人值守时被注入的远端内容驱动着改数据、发消息。
   */
  allowWrite?: boolean;
};

const storage = new AsyncLocalStorage<AgentRunScope>();

export function runWithAgentScope<T>(
  scope: AgentRunScope,
  task: () => Promise<T>,
) {
  return storage.run(scope, task);
}

export function currentAgentScope(): AgentRunScope | undefined {
  return storage.getStore();
}
