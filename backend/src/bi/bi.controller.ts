import { CurrentUser } from '../auth/current-user';
import { BiScopeService } from './bi.scope';
import { BiDatasourceService } from './bi.datasource.service';
import { BiDatasetService } from './bi.dataset.service';
import { BiChatService } from './bi.chat.service';
import { BiChartService } from './bi.chart.service';
import { BiDashboardService } from './bi.dashboard.service';
import { BiSettingsService } from './bi.settings.service';

export class BiController {
  constructor(
    readonly scope: BiScopeService,
    readonly datasourceService: BiDatasourceService,
    readonly datasetService: BiDatasetService,
    readonly chatService: BiChatService,
    readonly chartService: BiChartService,
    readonly dashboardService: BiDashboardService,
    readonly settingsService: BiSettingsService,
  ) {}

  workbench(user: CurrentUser) {
    return this.settingsService.workbench(user);
  }
  recent(user: CurrentUser) {
    return this.settingsService.recent(user);
  }

  datasources(user: CurrentUser) {
    return this.datasourceService.list(user);
  }
  createDatasource(user: CurrentUser, body: Record<string, unknown>) {
    return this.datasourceService.create(user, body);
  }
  updateDatasource(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.datasourceService.update(user, id, body);
  }
  testDatasource(user: CurrentUser, id: string) {
    return this.datasourceService.test(user, id);
  }
  syncDatasource(user: CurrentUser, id: string) {
    return this.datasourceService.sync(user, id);
  }
  removeDatasource(user: CurrentUser, id: string) {
    return this.datasourceService.remove(user, id);
  }
  datasourceTables(user: CurrentUser, id: string) {
    return this.datasourceService.tables(user, id);
  }
  saveDatasourceField(
    user: CurrentUser,
    id: string,
    fieldId: string,
    body: Record<string, unknown>,
  ) {
    return this.datasourceService.saveField(user, id, fieldId, body);
  }

  datasetGroups(user: CurrentUser) {
    return this.datasetService.groups(user);
  }
  saveDatasetGroup(user: CurrentUser, body: Record<string, unknown>) {
    return this.datasetService.saveGroup(user, body);
  }
  removeDatasetGroup(user: CurrentUser, id: string) {
    return this.datasetService.removeGroup(user, id);
  }
  datasets(user: CurrentUser, query: Record<string, unknown>) {
    return this.datasetService.list(user, query);
  }
  dataset(user: CurrentUser, id: string) {
    return this.datasetService.get(user, id);
  }
  async datasetFields(user: CurrentUser, id: string) {
    const detail = await this.datasetService.get(user, id);
    return detail.fields;
  }
  createDataset(user: CurrentUser, body: Record<string, unknown>) {
    return this.datasetService.create(user, body);
  }
  updateDataset(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.datasetService.update(user, id, body);
  }
  removeDataset(user: CurrentUser, id: string) {
    return this.datasetService.remove(user, id);
  }
  previewDataset(
    user: CurrentUser,
    id: string,
    query: Record<string, unknown>,
  ) {
    return this.datasetService.preview(user, id, Number(query.limit) || 20);
  }
  saveDatasetField(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.datasetService.saveField(user, id, body);
  }
  removeDatasetField(user: CurrentUser, id: string, fieldId: string) {
    return this.datasetService.removeField(user, id, fieldId);
  }
  datasetPermissions(user: CurrentUser, id: string) {
    return this.datasetService.permissions(user, id);
  }
  saveDatasetPermission(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.datasetService.savePermission(user, id, body);
  }
  recommendQuestions(user: CurrentUser, id: string) {
    return this.datasetService.recommended(user, id);
  }

  terms(user: CurrentUser, query: Record<string, unknown>) {
    return this.settingsService.terms(user, query);
  }
  saveTerm(user: CurrentUser, body: Record<string, unknown>) {
    return this.settingsService.saveTerm(user, body);
  }
  removeTerm(user: CurrentUser, id: string) {
    return this.settingsService.removeTerm(user, id);
  }
  trainings(user: CurrentUser, query: Record<string, unknown>) {
    return this.settingsService.trainings(user, query);
  }
  saveTraining(user: CurrentUser, body: Record<string, unknown>) {
    return this.settingsService.saveTraining(user, body);
  }
  removeTraining(user: CurrentUser, id: string) {
    return this.settingsService.removeTraining(user, id);
  }
  recommendedQuestions(user: CurrentUser, query: Record<string, unknown>) {
    return this.settingsService.recommended(user, query);
  }
  saveRecommendedQuestion(user: CurrentUser, body: Record<string, unknown>) {
    return this.settingsService.saveRecommended(user, body);
  }
  removeRecommendedQuestion(user: CurrentUser, id: string) {
    return this.settingsService.removeRecommended(user, id);
  }

  sessions(user: CurrentUser, query: Record<string, unknown>) {
    return this.chatService.sessions(user, query);
  }
  session(user: CurrentUser, id: string) {
    return this.chatService.session(user, id);
  }
  createSession(user: CurrentUser, body: Record<string, unknown>) {
    return this.chatService.createSession(user, body);
  }
  removeSession(user: CurrentUser, id: string) {
    return this.chatService.removeSession(user, id);
  }
  ask(user: CurrentUser, body: Record<string, unknown>) {
    return this.chatService.ask(user, body);
  }
  feedback(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.chatService.feedback(user, id, body);
  }

  charts(user: CurrentUser, query: Record<string, unknown>) {
    return this.chartService.list(user, query);
  }
  chart(user: CurrentUser, id: string) {
    return this.chartService.get(user, id);
  }
  saveChart(user: CurrentUser, body: Record<string, unknown>) {
    return this.chartService.save(user, body);
  }
  removeChart(user: CurrentUser, id: string) {
    return this.chartService.remove(user, id);
  }
  chartData(user: CurrentUser, id: string) {
    return this.chartService.data(user, id);
  }

  dashboards(user: CurrentUser, query: Record<string, unknown>) {
    return this.dashboardService.list(user, query);
  }
  dashboard(user: CurrentUser, id: string) {
    return this.dashboardService.get(user, id);
  }
  saveDashboard(user: CurrentUser, body: Record<string, unknown>) {
    return this.dashboardService.save(user, body);
  }
  dashboardData(user: CurrentUser, id: string) {
    return this.dashboardService.data(user, id);
  }
  removeDashboard(user: CurrentUser, id: string) {
    return this.dashboardService.remove(user, id);
  }

  settings(user: CurrentUser) {
    return this.settingsService.settings(user);
  }
  saveSettings(user: CurrentUser, body: Record<string, unknown>) {
    return this.settingsService.saveSettings(user, body);
  }
  members(user: CurrentUser) {
    return this.settingsService.members(user);
  }
  saveMember(user: CurrentUser, body: Record<string, unknown>) {
    return this.settingsService.saveMember(user, body);
  }
  removeMember(user: CurrentUser, id: string) {
    return this.settingsService.removeMember(user, id);
  }
  queryLogs(user: CurrentUser, query: Record<string, unknown>) {
    return this.settingsService.queryLogs(user, query);
  }
  createExport(user: CurrentUser, body: Record<string, unknown>) {
    return this.settingsService.export(user, body);
  }
  exportToDataTable(user: CurrentUser, body: Record<string, unknown>) {
    return this.settingsService.exportToDataTable(user, body);
  }
}
