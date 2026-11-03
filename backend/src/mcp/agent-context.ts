import { AsyncLocalStorage } from 'node:async_hooks';
import type { CurrentUser } from '../auth/current-user';

/**
 * MCP 自执行器的身份上下文：一次 JSON-RPC 调用内，本站接口由内部 agent app 直接执行，
 * 身份从上下文取而不是从请求头取——头部能被调用方伪造，上下文里的账号只能是鉴权过的那一个。
 */
export type AgentCallContext = {
  user: CurrentUser;
  requestId: string;
  /** 定时任务指定的邮箱范围：邮件工具只能处理这些 mailboxId，越界直接拒。 */
  mailboxIds?: number[];
  /** 触发来源：对话＝chat；定时任务 / 助理等无人值守＝schedule，OKR 落定类写动作在 schedule 下拒绝。 */
  trigger?: 'chat' | 'schedule';
};

const storage = new AsyncLocalStorage<AgentCallContext>();

/** 在指定账号的上下文里跑完这段异步代码（含其内部所有 await 分支）。 */
export function runAsAgent<T>(
  context: AgentCallContext,
  task: () => Promise<T>,
) {
  return storage.run(context, task);
}

export function currentAgentCall(): AgentCallContext | undefined {
  return storage.getStore();
}
