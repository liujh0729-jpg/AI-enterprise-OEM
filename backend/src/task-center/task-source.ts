import { randomUUID } from 'node:crypto';
import type { TaskFormDefinition } from '@enterprise/contracts';
import type { CurrentUser } from '../auth/current-user';

/**
 * 统一任务中心的抽象点：任何板块只要实现一个 `TaskSource`，
 * 它的「待办」就会自动出现在当前账号的「我的任务」里。
 */

/** 一条待办的标准化草案：源只负责把业务对象翻译成这些字段。 */
export type TaskDraft = {
  /** 被 @ 到的账号（账号级，跨角色）；assigneeType=ORG 时留空 */
  assigneeUserId: string;
  /** 承办类型：USER 落到账号；ORG 落在机构队列，等负责人改派或到期自动落实 */
  assigneeType?: 'USER' | 'ORG';
  /** 归属主体：派给服务商时 orgType=PROVIDER、orgUserId=服务商账号 */
  orgType?: string;
  orgUserId?: string;
  /** 实际派单策略（DIRECT | ROUND_ROBIN | LOAD），只用于展示与留痕 */
  assignPolicy?: string;
  /** 派单人；自动分配写 system */
  assignedBy?: string;
  /** 派单规则匹配用（板块 + 类目 + 地域），不落任务行 */
  region?: string;
  /** 源 key：oa | okr | pj | crm | desk | contract | platform | workflow ... */
  source: string;
  /** 业务对象主键：幂等锚，空串表示每次派发都是新任务 */
  sourceId: string;
  /** 任务介绍（标题） */
  title: string;
  /** 任务介绍（正文/摘要） */
  description?: string;
  /** 点击去处理的 URL */
  link: string;
  /** 分组：approval | report | task | matter | audit */
  category: string;
  priority?: string;
  dueAt?: Date | string | null;
  createdBy?: string;
  /** 业务方状态（只展示，源回写） */
  sourceStatus?: string;
  sourceStatusLabel?: string;
  /** 业务是否已终态：终态即视为完成 */
  terminal?: boolean;
  /** 表单任务定义：任务侧据此渲染字段，提交结果写回 formData（human.form 节点） */
  formSchema?: TaskFormDefinition;
};

/** 拉取选项：`full` 用于对账，要求源返回该账号在该源下的**全部**未办任务（不受分页上限影响）。 */
export type TaskCollectOptions = { full?: boolean };

export interface TaskSource {
  key: string;
  label: string;
  category: string;
  /** Push-only 源：任务由模块主动派发，不参与「collect 未返回即关闭」的对账。 */
  push?: boolean;
  /**
   * 拉取：该账号在此源下所有「待处理」任务。
   * 默认可带上限用于列表展示；`options.full` 为 true 时必须返回全量（对账据此判缺失，§14.2）。
   */
  collect(
    user: CurrentUser,
    options?: TaskCollectOptions,
  ): Promise<TaskDraft[]>;
  /** 单条刷新：向源要最新业务状态；返回 null 表示已不存在 */
  resolve?(draft: TaskDraft): Promise<Partial<TaskDraft> | null>;
  /** 本人关闭后回调源模块（可选） */
  onClosed?(draft: TaskDraft, note: string): Promise<void>;
  /**
   * 关闭前复核（可选）：按当前库表现场判断业务异常是否真的消除，
   * cleared=false 时中心拒绝关闭并回传原因（关闭口径不以点完成为准）。
   */
  recheck?(draft: {
    assigneeUserId: string;
    source: string;
    sourceId: string;
    orgType: string;
    orgUserId: string;
  }): Promise<{ cleared: boolean; reason: string }>;
}

/** 幂等锚：同源 + 同业务 + 同收件人只保留一行；无业务主键的手工任务每次派发视为新任务。 */
export function dedupKeyOf(draft: {
  source: string;
  sourceId: string;
  assigneeUserId: string;
}): string {
  const sourceId = draft.sourceId || `m-${randomUUID()}`;
  return `${draft.source}:${sourceId}:${draft.assigneeUserId}`;
}
