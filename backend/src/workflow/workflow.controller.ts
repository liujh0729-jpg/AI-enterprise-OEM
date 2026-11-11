import type { CurrentUser } from '../auth/current-user';
import type { WorkflowService } from './workflow.service';

/** 工作流控制器：契约 `Workflow_*` 一一对应，逻辑都在服务里。 */
export class WorkflowController {
  constructor(private readonly service: WorkflowService) {}

  list(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.list(user, query);
  }

  create(user: CurrentUser, body: Record<string, unknown>) {
    return this.service.create(user, body);
  }

  catalog(user: CurrentUser) {
    return this.service.catalog(user);
  }

  aiBuild(user: CurrentUser, body: Record<string, unknown>) {
    return this.service.aiBuild(user, body);
  }

  detail(user: CurrentUser, id: string) {
    return this.service.detail(user, id);
  }

  save(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.service.save(user, id, body);
  }

  remove(user: CurrentUser, id: string) {
    return this.service.remove(user, id);
  }

  publish(user: CurrentUser, id: string) {
    return this.service.publish(user, id);
  }

  run(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.service.run(user, id, body);
  }

  invoke(user: CurrentUser, body: Record<string, unknown>) {
    return this.service.invoke(user, body);
  }

  runDetail(user: CurrentUser, runId: string) {
    return this.service.runDetail(user, runId);
  }

  runList(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.runList(user, query);
  }

  runCancel(user: CurrentUser, runId: string) {
    return this.service.cancelRun(user, runId);
  }

  duplicate(user: CurrentUser, id: string) {
    return this.service.duplicate(user, id);
  }
}
