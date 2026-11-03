import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";
import { streamBiAsk } from "./crm";

export const biApi = {
  workbench: endpoint(endpoints.Bi_workbench),
  recent: endpoint(endpoints.Bi_recent),

  datasources: endpoint(endpoints.Bi_datasources),
  createDatasource: endpoint(endpoints.Bi_createDatasource),
  updateDatasource: endpoint(endpoints.Bi_updateDatasource),
  testDatasource: endpoint(endpoints.Bi_testDatasource),
  syncDatasource: endpoint(endpoints.Bi_syncDatasource),
  removeDatasource: endpoint(endpoints.Bi_removeDatasource),
  datasourceTables: endpoint(endpoints.Bi_datasourceTables),
  saveDatasourceField: endpoint(endpoints.Bi_saveDatasourceField),

  datasetGroups: endpoint(endpoints.Bi_datasetGroups),
  saveDatasetGroup: endpoint(endpoints.Bi_saveDatasetGroup),
  removeDatasetGroup: endpoint(endpoints.Bi_removeDatasetGroup),
  datasets: endpoint(endpoints.Bi_datasets),
  dataset: endpoint(endpoints.Bi_dataset),
  createDataset: endpoint(endpoints.Bi_createDataset),
  updateDataset: endpoint(endpoints.Bi_updateDataset),
  removeDataset: endpoint(endpoints.Bi_removeDataset),
  previewDataset: endpoint(endpoints.Bi_previewDataset),
  datasetFields: endpoint(endpoints.Bi_datasetFields),
  saveDatasetField: endpoint(endpoints.Bi_saveDatasetField),
  removeDatasetField: endpoint(endpoints.Bi_removeDatasetField),
  datasetPermissions: endpoint(endpoints.Bi_datasetPermissions),
  saveDatasetPermission: endpoint(endpoints.Bi_saveDatasetPermission),
  recommendedQuestionsForDataset: endpoint(endpoints.Bi_recommendQuestions),

  terms: endpoint(endpoints.Bi_terms),
  saveTerm: endpoint(endpoints.Bi_saveTerm),
  removeTerm: endpoint(endpoints.Bi_removeTerm),
  trainings: endpoint(endpoints.Bi_trainings),
  saveTraining: endpoint(endpoints.Bi_saveTraining),
  removeTraining: endpoint(endpoints.Bi_removeTraining),
  recommendedQuestions: endpoint(endpoints.Bi_recommendedQuestions),
  saveRecommendedQuestion: endpoint(endpoints.Bi_saveRecommendedQuestion),
  removeRecommendedQuestion: endpoint(endpoints.Bi_removeRecommendedQuestion),

  sessions: endpoint(endpoints.Bi_sessions),
  session: endpoint(endpoints.Bi_session),
  createSession: endpoint(endpoints.Bi_createSession),
  removeSession: endpoint(endpoints.Bi_removeSession),
  ask: endpoint(endpoints.Bi_ask),
  feedback: endpoint(endpoints.Bi_feedback),

  charts: endpoint(endpoints.Bi_charts),
  chart: endpoint(endpoints.Bi_chart),
  saveChart: endpoint(endpoints.Bi_saveChart),
  removeChart: endpoint(endpoints.Bi_removeChart),
  chartData: endpoint(endpoints.Bi_chartData),

  dashboards: endpoint(endpoints.Bi_dashboards),
  dashboard: endpoint(endpoints.Bi_dashboard),
  saveDashboard: endpoint(endpoints.Bi_saveDashboard),
  dashboardData: endpoint(endpoints.Bi_dashboardData),
  removeDashboard: endpoint(endpoints.Bi_removeDashboard),

  settings: endpoint(endpoints.Bi_settings),
  saveSettings: endpoint(endpoints.Bi_saveSettings),
  members: endpoint(endpoints.Bi_members),
  saveMember: endpoint(endpoints.Bi_saveMember),
  removeMember: endpoint(endpoints.Bi_removeMember),
  queryLogs: endpoint(endpoints.Bi_queryLogs),
  createExport: endpoint(endpoints.Bi_createExport),
  exportToDataTable: endpoint(endpoints.Bi_exportToDataTable),
};

export { streamBiAsk };