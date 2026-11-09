import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmScopeService } from '../hrm/hrm.scope';
import type { MechanismService } from '../mechanisms/mechanism.service';
import type { AiEvalService } from '../ai/ai-eval.service';
import type { PageQuery, Row } from './project.shared';
import { ProjectBase } from './project.base';
import { ProjectCoreService } from './project-core.service';
import { ProjectInsightService } from './project-insight.service';
import { ProjectPlanningService } from './project-planning.service';
import { ProjectPlatformService } from './project-platform.service';
import { ProjectTaskService } from './project-task.service';
import { ProjectTimeService } from './project-time.service';

/**
 * §5.2 项目门面：项目主档 / 迭代里程碑 / 任务 / 风险洞察 / 工时按服务拆分，
 * 对外仍保持单一入口。组织键与 HRM 共用 (orgType, orgUserId)。
 */
export class ProjectService extends ProjectBase {
  private readonly projects: ProjectCoreService;
  private readonly planning: ProjectPlanningService;
  private readonly tasks: ProjectTaskService;
  private readonly insight: ProjectInsightService;
  private readonly time: ProjectTimeService;
  private readonly platform: ProjectPlatformService;

  constructor(
    prisma: PrismaService,
    scope: HrmScopeService,
    mechanisms: MechanismService,
    aiEval: AiEvalService,
  ) {
    super(prisma, scope, mechanisms, aiEval);
    this.projects = new ProjectCoreService(prisma, scope, mechanisms, aiEval);
    this.planning = new ProjectPlanningService(
      prisma,
      scope,
      mechanisms,
      aiEval,
    );
    this.tasks = new ProjectTaskService(prisma, scope, mechanisms, aiEval);
    this.insight = new ProjectInsightService(prisma, scope, mechanisms, aiEval);
    this.time = new ProjectTimeService(prisma, scope, mechanisms, aiEval);
    this.platform = new ProjectPlatformService(
      prisma,
      scope,
      mechanisms,
      aiEval,
    );
  }

  async listProjects(
    user: CurrentUser,
    query: PageQuery & { status?: string; q?: string },
  ) {
    return this.projects.listProjects(user, query);
  }

  async getProject(user: CurrentUser, idRaw: string) {
    return this.projects.getProject(user, idRaw);
  }

  async saveProject(user: CurrentUser, body: Row) {
    return this.projects.saveProject(user, body);
  }

  async removeProject(user: CurrentUser, body: Row) {
    return this.projects.removeProject(user, body);
  }

  async saveMember(user: CurrentUser, body: Row) {
    return this.projects.saveMember(user, body);
  }

  async removeMember(user: CurrentUser, body: Row) {
    return this.projects.removeMember(user, body);
  }

  async listSprints(user: CurrentUser, query: { projectId?: number }) {
    return this.planning.listSprints(user, query);
  }

  async saveSprint(user: CurrentUser, body: Row) {
    return this.planning.saveSprint(user, body);
  }

  async removeSprint(user: CurrentUser, body: Row) {
    return this.planning.removeSprint(user, body);
  }

  async listMilestones(user: CurrentUser, query: { projectId?: number }) {
    return this.planning.listMilestones(user, query);
  }

  async saveMilestone(user: CurrentUser, body: Row) {
    return this.planning.saveMilestone(user, body);
  }

  async removeMilestone(user: CurrentUser, body: Row) {
    return this.planning.removeMilestone(user, body);
  }

  async listTasks(
    user: CurrentUser,
    query: PageQuery & {
      projectId?: number;
      sprintId?: number;
      status?: string;
      assigneeId?: string;
      q?: string;
    },
  ) {
    return this.tasks.listTasks(user, query);
  }

  async saveTask(user: CurrentUser, body: Row) {
    return this.tasks.saveTask(user, body);
  }

  async moveTask(user: CurrentUser, body: Row) {
    return this.tasks.moveTask(user, body);
  }

  async removeTask(user: CurrentUser, body: Row) {
    return this.tasks.removeTask(user, body);
  }

  async addRelation(user: CurrentUser, body: Row) {
    return this.tasks.addRelation(user, body);
  }

  async removeRelation(user: CurrentUser, body: Row) {
    return this.tasks.removeRelation(user, body);
  }

  async wbsSuggest(user: CurrentUser, body: Row) {
    return this.tasks.wbsSuggest(user, body);
  }

  async riskList(user: CurrentUser) {
    return this.insight.riskList(user);
  }

  async projectInsight(user: CurrentUser, body: Row) {
    return this.insight.projectInsight(user, body);
  }

  async listTimeLogs(
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
    return this.time.listTimeLogs(user, query);
  }

  async addTimeLog(user: CurrentUser, body: Row) {
    return this.time.addTimeLog(user, body);
  }

  async startTimer(user: CurrentUser, body: Row) {
    return this.time.startTimer(user, body);
  }

  async stopTimer(user: CurrentUser, body: Row) {
    return this.time.stopTimer(user, body);
  }

  async decideTimeLog(user: CurrentUser, body: Row) {
    return this.time.decideTimeLog(user, body);
  }

  async removeTimeLog(user: CurrentUser, body: Row) {
    return this.time.removeTimeLog(user, body);
  }

  async listTimesheets(
    user: CurrentUser,
    query: PageQuery & {
      principalId?: string;
      status?: string;
      periodStart?: string;
    },
  ) {
    return this.time.listTimesheets(user, query);
  }

  async generateTimesheet(user: CurrentUser, body: Row) {
    return this.time.generateTimesheet(user, body);
  }

  async decideTimesheet(user: CurrentUser, body: Row) {
    return this.time.decideTimesheet(user, body);
  }

  async overview(user: CurrentUser) {
    return this.platform.overview(user);
  }

  async settingsGet(user: CurrentUser) {
    return this.platform.settingsGet(user);
  }

  async settingsSave(user: CurrentUser, body: Row) {
    return this.platform.settingsSave(user, body);
  }
}
