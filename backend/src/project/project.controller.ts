import type { CurrentUser } from '../auth/current-user';
import type { ProjectService } from './project.service';
import type { ProjectCostService } from './project-cost.service';
import type { ProjectDemandService } from './project-demand.service';

type Row = Record<string, unknown>;
type PageQuery = { page: number; pageSize: number };

/** §5.2 项目 / 任务 / 工时控制器：方法名与契约 `Pj_*` 后缀一一对应。 */
export class ProjectController {
  constructor(
    private readonly service: ProjectService,
    private readonly cost: ProjectCostService,
    private readonly demand: ProjectDemandService,
  ) {}

  overview(user: CurrentUser) {
    return this.service.overview(user);
  }

  listProjects(
    user: CurrentUser,
    query: PageQuery & { status?: string; q?: string },
  ) {
    return this.service.listProjects(user, query);
  }

  getProject(user: CurrentUser, idRaw: string) {
    return this.service.getProject(user, idRaw);
  }

  saveProject(user: CurrentUser, body: Row) {
    return this.service.saveProject(user, body);
  }

  removeProject(user: CurrentUser, body: Row) {
    return this.service.removeProject(user, body);
  }

  saveMember(user: CurrentUser, body: Row) {
    return this.service.saveMember(user, body);
  }

  removeMember(user: CurrentUser, body: Row) {
    return this.service.removeMember(user, body);
  }

  listSprints(user: CurrentUser, query: { projectId?: number }) {
    return this.service.listSprints(user, query);
  }

  saveSprint(user: CurrentUser, body: Row) {
    return this.service.saveSprint(user, body);
  }

  removeSprint(user: CurrentUser, body: Row) {
    return this.service.removeSprint(user, body);
  }

  listMilestones(user: CurrentUser, query: { projectId?: number }) {
    return this.service.listMilestones(user, query);
  }

  saveMilestone(user: CurrentUser, body: Row) {
    return this.service.saveMilestone(user, body);
  }

  removeMilestone(user: CurrentUser, body: Row) {
    return this.service.removeMilestone(user, body);
  }

  listTasks(
    user: CurrentUser,
    query: PageQuery & {
      projectId?: number;
      sprintId?: number;
      status?: string;
      assigneeId?: string;
      q?: string;
    },
  ) {
    return this.service.listTasks(user, query);
  }

  saveTask(user: CurrentUser, body: Row) {
    return this.service.saveTask(user, body);
  }

  moveTask(user: CurrentUser, body: Row) {
    return this.service.moveTask(user, body);
  }

  removeTask(user: CurrentUser, body: Row) {
    return this.service.removeTask(user, body);
  }

  addRelation(user: CurrentUser, body: Row) {
    return this.service.addRelation(user, body);
  }

  removeRelation(user: CurrentUser, body: Row) {
    return this.service.removeRelation(user, body);
  }

  wbsSuggest(user: CurrentUser, body: Row) {
    return this.service.wbsSuggest(user, body);
  }

  projectInsight(user: CurrentUser, body: Row) {
    return this.service.projectInsight(user, body);
  }

  riskList(user: CurrentUser) {
    return this.service.riskList(user);
  }

  listTimeLogs(
    user: CurrentUser,
    query: PageQuery & {
      projectId?: number;
      taskId?: number;
      principalId?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
    },
  ) {
    return this.service.listTimeLogs(user, query);
  }

  addTimeLog(user: CurrentUser, body: Row) {
    return this.service.addTimeLog(user, body);
  }

  startTimer(user: CurrentUser, body: Row) {
    return this.service.startTimer(user, body);
  }

  stopTimer(user: CurrentUser, body: Row) {
    return this.service.stopTimer(user, body);
  }

  decideTimeLog(user: CurrentUser, body: Row) {
    return this.service.decideTimeLog(user, body);
  }

  removeTimeLog(user: CurrentUser, body: Row) {
    return this.service.removeTimeLog(user, body);
  }

  listTimesheets(
    user: CurrentUser,
    query: PageQuery & {
      principalId?: string;
      status?: string;
      periodStart?: string;
    },
  ) {
    return this.service.listTimesheets(user, query);
  }

  generateTimesheet(user: CurrentUser, body: Row) {
    return this.service.generateTimesheet(user, body);
  }

  decideTimesheet(user: CurrentUser, body: Row) {
    return this.service.decideTimesheet(user, body);
  }

  settingsGet(user: CurrentUser) {
    return this.service.settingsGet(user);
  }

  settingsSave(user: CurrentUser, body: Row) {
    return this.service.settingsSave(user, body);
  }

  listCostRates(
    user: CurrentUser,
    query: PageQuery & { principalType?: string; q?: string },
  ) {
    return this.cost.listCostRates(user, query);
  }

  saveCostRate(user: CurrentUser, body: Row) {
    return this.cost.saveCostRate(user, body);
  }

  removeCostRate(user: CurrentUser, body: Row) {
    return this.cost.removeCostRate(user, body);
  }

  listCostItems(
    user: CurrentUser,
    query: PageQuery & { projectId?: number; kind?: string },
  ) {
    return this.cost.listCostItems(user, query);
  }

  saveCostItem(user: CurrentUser, body: Row) {
    return this.cost.saveCostItem(user, body);
  }

  removeCostItem(user: CurrentUser, body: Row) {
    return this.cost.removeCostItem(user, body);
  }

  projectCost(user: CurrentUser, idRaw: string) {
    return this.cost.projectCost(user, idRaw);
  }

  listEngagements(
    user: CurrentUser,
    query: PageQuery & {
      projectId?: number;
      partyId?: number;
      status?: string;
    },
  ) {
    return this.cost.listEngagements(user, query);
  }

  saveEngagement(user: CurrentUser, body: Row) {
    return this.cost.saveEngagement(user, body);
  }

  decideEngagement(user: CurrentUser, idRaw: string, body: Row) {
    return this.cost.decideEngagement(user, idRaw, body);
  }

  removeEngagement(user: CurrentUser, body: Row) {
    return this.cost.removeEngagement(user, body);
  }

  getDemand(user: CurrentUser, taskIdRaw: string) {
    return this.demand.getDemand(user, taskIdRaw);
  }

  saveDemand(user: CurrentUser, body: Row) {
    return this.demand.saveDemand(user, body);
  }

  respondDemand(user: CurrentUser, body: Row) {
    return this.demand.respondDemand(user, body);
  }

  acceptDemand(user: CurrentUser, body: Row) {
    return this.demand.acceptDemand(user, body);
  }

  closeDemand(user: CurrentUser, body: Row) {
    return this.demand.closeDemand(user, body);
  }
}
