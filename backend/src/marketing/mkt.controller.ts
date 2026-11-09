import type { CurrentUser } from '../auth/current-user';
import type { MktService } from './mkt.service';

type Row = Record<string, unknown>;
type PageQuery = { page: number; pageSize: number };

/** §5.5 营销技能库控制器：方法名与契约 `Mkt_*` 后缀一一对应。 */
export class MktController {
  constructor(private readonly service: MktService) {}

  listSkills(
    user: CurrentUser,
    query: { category?: string; q?: string; enabled?: boolean },
  ) {
    return this.service.listSkills(user, query);
  }

  getSkill(user: CurrentUser, key: string) {
    return this.service.getSkill(user, key);
  }

  saveSkill(user: CurrentUser, body: Row) {
    return this.service.saveSkill(user, body);
  }

  runSkill(user: CurrentUser, body: Row) {
    return this.service.runSkill(user, body);
  }

  listRuns(
    user: CurrentUser,
    query: PageQuery & { skillKey?: string; status?: string },
  ) {
    return this.service.listRuns(user, query);
  }

  listArtifacts(
    user: CurrentUser,
    query: PageQuery & { kind?: string; status?: string; q?: string },
  ) {
    return this.service.listArtifacts(user, query);
  }

  saveArtifact(user: CurrentUser, body: Row) {
    return this.service.saveArtifact(user, body);
  }

  readContext(user: CurrentUser) {
    return this.service.readContext(user);
  }

  updateContext(user: CurrentUser, body: Row) {
    return this.service.updateContext(user, body);
  }

  listCapabilities(user: CurrentUser) {
    return this.service.listCapabilities(user);
  }

  connectAccount(user: CurrentUser, body: Row) {
    return this.service.connectAccount(user, body);
  }

  disconnectAccount(user: CurrentUser, body: Row) {
    return this.service.disconnectAccount(user, body);
  }

  callCapability(user: CurrentUser, body: Row) {
    return this.service.callCapability(user, body);
  }

  listLoops(user: CurrentUser) {
    return this.service.listLoops(user);
  }

  saveLoop(user: CurrentUser, body: Row) {
    return this.service.saveLoop(user, body);
  }

  removeLoop(user: CurrentUser, body: Row) {
    return this.service.removeLoop(user, body);
  }

  runEval(user: CurrentUser, body: Row) {
    return this.service.runEval(user, body);
  }
}
