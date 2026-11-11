import type { TaskAssignmentRuleInput } from '@enterprise/contracts';
import type { CurrentUser } from '../auth/current-user';
import type { TaskAssignmentService } from './task-assignment.service';
import type { TaskCenterService } from './task-center.service';
import type { TaskRouterService } from './task-router.service';

/** 任务中心控制器：MyTask_* 一一对应；moduleHandlers 按后缀映射方法名。 */
export class TaskCenterController {
  constructor(
    private readonly service: TaskCenterService,
    private readonly router: TaskRouterService,
  ) {}

  list(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.list(user, query);
  }

  get(user: CurrentUser, id: string) {
    return this.service.get(user, id);
  }

  summary(user: CurrentUser) {
    return this.service.summary(user);
  }

  close(user: CurrentUser, id: string, body: { note?: string }) {
    return this.service.close(user, id, body || {});
  }

  submitForm(
    user: CurrentUser,
    id: string,
    body: { values?: Record<string, string>; note?: string },
  ) {
    return this.service.submitForm(user, id, body || {});
  }

  reopen(user: CurrentUser, id: string) {
    return this.service.reopen(user, id);
  }

  orgList(user: CurrentUser, query: Record<string, unknown>) {
    return this.router.orgInbox(user, query);
  }

  assign(
    user: CurrentUser,
    id: string,
    body: { toUserId?: string; strategy?: string; note?: string },
  ) {
    return this.router.reassign(user, id, body || {});
  }

  claim(user: CurrentUser, id: string) {
    return this.router.claim(user, id);
  }

  assignmentLog(user: CurrentUser, id: string) {
    return this.router.assignmentLogs(user, id);
  }
}

/** 派单规则控制器：TaskRule_* 一一对应。 */
export class TaskAssignmentController {
  constructor(private readonly service: TaskAssignmentService) {}

  list(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.list(user, query);
  }

  create(user: CurrentUser, body: TaskAssignmentRuleInput) {
    return this.service.create(user, body);
  }

  update(
    user: CurrentUser,
    id: string,
    body: Partial<TaskAssignmentRuleInput>,
  ) {
    return this.service.update(user, id, body || {});
  }

  remove(user: CurrentUser, id: string) {
    return this.service.remove(user, id);
  }

  audit(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.audit(user, query);
  }
}
