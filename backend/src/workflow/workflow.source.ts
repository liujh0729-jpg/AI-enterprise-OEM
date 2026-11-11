import type { TaskSource } from '../task-center/task-source';
import { dedupKeyOf } from '../task-center/task-source';
import type { WorkflowEngine } from './workflow-engine';

/**
 * 工作流任务源：工作流派发到「我的任务」的待办由本适配器收口。
 * - 拉取：工作流任务是 Push 通道写入的，不参与 collect（返回空，避免被对账误关）。
 * - 关闭回调：把「等待任务完成 / 表单填写」节点唤醒，续跑剩下的步骤。
 */
export function workflowSource(engine: WorkflowEngine): TaskSource {
  return {
    key: 'workflow',
    label: '工作流',
    category: 'task',
    // Push-only：工作流任务是节点执行时推送写入的，不参与「collect 未返回即关闭」的对账。
    push: true,
    collect: () => Promise.resolve([]),
    async onClosed(draft, note) {
      await engine.resumeByDedupKey(dedupKeyOf(draft), note);
    },
  };
}
