import type { TaskSource } from './task-source';

/** Push-only 源（不实现 collect，不参与对账）也在这里登记中文名，列表不显示裸 key。 */
const PUSH_SOURCE_LABELS: Record<string, string> = {
  supply: '供销网络',
  'supply-booking': '供销服务预约',
  hrm: '人事交接',
  risk: '经营异常',
  /** 营销内容：生成完成→内容审核→渠道发布（docs §8.4）。 */
  mkt: '营销内容',
  /** 会议/邮件助手提取的待确认任务（docs §11.2）。 */
  assistant: '会议/邮件行动项',
};

/** 任务源注册表：DI 单例，与 §5.8 机制同风格。 */
export class TaskSourceRegistry {
  private readonly sources = new Map<string, TaskSource>();

  register(source: TaskSource): this {
    this.sources.set(source.key, source);
    return this;
  }

  get(key: string): TaskSource | undefined {
    return this.sources.get(key);
  }

  all(): TaskSource[] {
    return [...this.sources.values()];
  }

  /** 来源中文名：列表/分组都从这里取，不写第二份。 */
  labelOf(key: string): string {
    return this.sources.get(key)?.label ?? PUSH_SOURCE_LABELS[key] ?? key;
  }
}
