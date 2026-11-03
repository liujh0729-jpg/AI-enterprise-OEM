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
  /** 触发来源：对话＝chat；定时任务 / 助理等无人值守＝schedule，MCP 写动作按它收紧。 */
  trigger: 'chat' | 'schedule';
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
