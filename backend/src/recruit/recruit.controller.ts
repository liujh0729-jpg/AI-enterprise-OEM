import type { CurrentUser } from '../auth/current-user';
import type { RecruitService } from './recruit.service';

type Row = Record<string, unknown>;
type PageQuery = { page: number; pageSize: number };

/** AI 简历代投控制器：方法名与契约 `Recruit_*` 后缀一一对应。 */
export class RecruitController {
  constructor(private readonly service: RecruitService) {}

  getProfile(user: CurrentUser) {
    return this.service.getProfile(user);
  }

  saveProfile(user: CurrentUser, body: Row) {
    return this.service.saveProfile(user, body);
  }

  listJobs(
    user: CurrentUser,
    query: PageQuery & { q?: string; city?: string },
  ) {
    return this.service.listJobs(user, query);
  }

  evaluatePost(user: CurrentUser, body: Row) {
    return this.service.evaluatePost(user, body);
  }

  matchJobs(user: CurrentUser, body: Row) {
    return this.service.matchJobs(user, body);
  }

  optimizeResume(user: CurrentUser, body: Row) {
    return this.service.optimizeResume(user, body);
  }

  createApplication(user: CurrentUser, body: Row) {
    return this.service.createApplication(user, body);
  }

  confirmApplication(user: CurrentUser, body: Row) {
    return this.service.confirmApplication(user, body);
  }

  updateApplicationStatus(user: CurrentUser, body: Row) {
    return this.service.updateApplicationStatus(user, body);
  }

  listApplications(
    user: CurrentUser,
    query: PageQuery & { status?: string; jobId?: number },
  ) {
    return this.service.listApplications(user, query);
  }

  funnelStats(user: CurrentUser) {
    return this.service.funnelStats(user);
  }

  patternInsights(user: CurrentUser) {
    return this.service.patternInsights(user);
  }

  events(user: CurrentUser, query: { applicationId: number }) {
    return this.service.events(user, query);
  }
}
