import { CurrentUser } from '../auth/current-user';
import { OkrBriefService } from './okr-brief.service';
import { OkrDecompositionService } from './okr-decomposition.service';
import { OkrService } from './okr.service';

/** OKR 控制器：与契约 Okr_* 一一对应，只做参数透传。 */
export class OkrController {
  constructor(
    private readonly service: OkrService,
    private readonly briefs: OkrBriefService,
    private readonly decompositions: OkrDecompositionService,
  ) {}

  overview(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.overview(user, query);
  }

  context(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.context(user, query);
  }

  cycleList(user: CurrentUser) {
    return this.service.cycleList(user);
  }

  cycleSave(user: CurrentUser, body: Record<string, unknown>) {
    return this.service.cycleSave(user, body);
  }

  cycleClose(user: CurrentUser, id: string) {
    return this.service.cycleClose(user, id);
  }

  objectiveList(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.objectiveList(user, query);
  }

  objectiveDetail(user: CurrentUser, id: string) {
    return this.service.objectiveDetail(user, id);
  }

  objectiveSave(user: CurrentUser, body: Record<string, unknown>) {
    return this.service.objectiveSave(user, body);
  }

  objectiveDelete(user: CurrentUser, id: string) {
    return this.service.objectiveDelete(user, id);
  }

  objectiveAssign(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.service.objectiveAssign(user, id, body);
  }

  draftObjective(user: CurrentUser, body: Record<string, unknown>) {
    return this.service.draftObjective(user, body);
  }

  decomposeSuggest(user: CurrentUser, body: Record<string, unknown>) {
    return this.service.decomposeSuggest(user, body);
  }

  planGenerate(user: CurrentUser, body: Record<string, unknown>) {
    return this.service.planGenerate(user, body);
  }

  krSave(user: CurrentUser, body: Record<string, unknown>) {
    return this.service.krSave(user, body);
  }

  krDelete(user: CurrentUser, id: string) {
    return this.service.krDelete(user, id);
  }

  krProgress(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.service.krProgress(user, id, body);
  }

  progressList(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.progressList(user, query);
  }

  metricPreview(user: CurrentUser, body: Record<string, unknown>) {
    return this.service.metricPreview(user, body);
  }

  metricRefresh(user: CurrentUser, body: Record<string, unknown>) {
    return this.service.metricRefresh(user, body);
  }

  planList(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.planList(user, query);
  }

  planSave(user: CurrentUser, body: Record<string, unknown>) {
    return this.service.planSave(user, body);
  }

  planUpdate(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.service.planUpdate(user, id, body);
  }

  planDelete(user: CurrentUser, id: string) {
    return this.service.planDelete(user, id);
  }

  planLinkSchedule(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.service.planLinkSchedule(user, id, body);
  }

  reportList(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.reportList(user, query);
  }

  reportGet(user: CurrentUser, id: string) {
    return this.service.reportGet(user, id);
  }

  reportSaveDraft(user: CurrentUser, body: Record<string, unknown>) {
    return this.service.reportSaveDraft(user, body);
  }

  reportSubmit(user: CurrentUser, id: string) {
    return this.service.reportSubmit(user, id);
  }

  reportWithdraw(user: CurrentUser, id: string) {
    return this.service.reportWithdraw(user, id);
  }

  reportComment(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.service.reportComment(user, id, body);
  }

  reportGenerate(user: CurrentUser, body: Record<string, unknown>) {
    return this.service.reportGenerate(user, body);
  }

  stats(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.stats(user, query);
  }

  export(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.export(user, query);
  }

  scoreList(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.scoreList(user, query);
  }

  scoreSave(user: CurrentUser, body: Record<string, unknown>) {
    return this.service.scoreSave(user, body);
  }

  scoreWithdraw(user: CurrentUser, id: string) {
    return this.service.scoreWithdraw(user, id);
  }

  settingsGet(user: CurrentUser) {
    return this.service.settingsGet(user);
  }

  settingsSave(user: CurrentUser, body: Record<string, unknown>) {
    return this.service.settingsSave(user, body);
  }

  // ---------- 目标书（OKR 2.0） ----------

  briefList(user: CurrentUser, query: Record<string, unknown>) {
    return this.briefs.list(user, query);
  }

  briefGet(user: CurrentUser, id: string) {
    return this.briefs.get(user, id);
  }

  briefSave(user: CurrentUser, body: Record<string, unknown>) {
    return this.briefs.save(user, body);
  }

  briefRemove(user: CurrentUser, id: string) {
    return this.briefs.remove(user, id);
  }

  // ---------- 互动澄清 ----------

  dialogList(user: CurrentUser, id: string) {
    return this.briefs.dialogList(user, id);
  }

  dialogSend(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.briefs.dialogSend(user, id, body);
  }

  // ---------- 拆解方案 ----------

  decompositionList(user: CurrentUser, id: string) {
    return this.decompositions.list(user, id);
  }

  decompositionGenerate(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.decompositions.generate(user, id, body);
  }

  decompositionSimulate(user: CurrentUser, id: string) {
    return this.decompositions.simulate(user, id);
  }

  decompositionCommit(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.decompositions.commit(user, id, body);
  }

  // ---------- 任务关联与考核 ----------

  taskLinkList(user: CurrentUser, query: Record<string, unknown>) {
    return this.decompositions.taskLinkList(user, query);
  }

  taskLinkSave(user: CurrentUser, body: Record<string, unknown>) {
    return this.decompositions.taskLinkSave(user, body);
  }

  taskLinkRemove(user: CurrentUser, id: string) {
    return this.decompositions.taskLinkRemove(user, id);
  }

  assessmentPreview(user: CurrentUser, query: Record<string, unknown>) {
    return this.decompositions.assessmentPreview(user, query);
  }
}
