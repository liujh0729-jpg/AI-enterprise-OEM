import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const okrApi = {
  overview: endpoint(endpoints.Okr_overview),
  context: endpoint(endpoints.Okr_context),

  cycles: endpoint(endpoints.Okr_cycleList),
  saveCycle: endpoint(endpoints.Okr_cycleSave),
  closeCycle: endpoint(endpoints.Okr_cycleClose),

  objectives: endpoint(endpoints.Okr_objectiveList),
  objective: endpoint(endpoints.Okr_objectiveDetail),
  saveObjective: endpoint(endpoints.Okr_objectiveSave),
  removeObjective: endpoint(endpoints.Okr_objectiveDelete),
  assignObjective: endpoint(endpoints.Okr_objectiveAssign),

  draftObjective: endpoint(endpoints.Okr_draftObjective),
  decomposeSuggest: endpoint(endpoints.Okr_decomposeSuggest),
  generatePlans: endpoint(endpoints.Okr_planGenerate),

  saveKr: endpoint(endpoints.Okr_krSave),
  removeKr: endpoint(endpoints.Okr_krDelete),
  saveKrProgress: endpoint(endpoints.Okr_krProgress),
  progressLogs: endpoint(endpoints.Okr_progressList),
  previewMetric: endpoint(endpoints.Okr_metricPreview),
  refreshMetric: endpoint(endpoints.Okr_metricRefresh),

  plans: endpoint(endpoints.Okr_planList),
  savePlan: endpoint(endpoints.Okr_planSave),
  updatePlan: endpoint(endpoints.Okr_planUpdate),
  removePlan: endpoint(endpoints.Okr_planDelete),
  linkPlanSchedule: endpoint(endpoints.Okr_planLinkSchedule),

  reports: endpoint(endpoints.Okr_reportList),
  report: endpoint(endpoints.Okr_reportGet),
  saveReportDraft: endpoint(endpoints.Okr_reportSaveDraft),
  submitReport: endpoint(endpoints.Okr_reportSubmit),
  withdrawReport: endpoint(endpoints.Okr_reportWithdraw),
  commentReport: endpoint(endpoints.Okr_reportComment),
  generateReport: endpoint(endpoints.Okr_reportGenerate),

  stats: endpoint(endpoints.Okr_stats),
  exportData: endpoint(endpoints.Okr_export),

  scores: endpoint(endpoints.Okr_scoreList),
  saveScore: endpoint(endpoints.Okr_scoreSave),
  withdrawScore: endpoint(endpoints.Okr_scoreWithdraw),

  settings: endpoint(endpoints.Okr_settingsGet),
  saveSettings: endpoint(endpoints.Okr_settingsSave),

  briefs: endpoint(endpoints.Okr_briefList),
  brief: endpoint(endpoints.Okr_briefGet),
  saveBrief: endpoint(endpoints.Okr_briefSave),
  removeBrief: endpoint(endpoints.Okr_briefRemove),

  dialogTurns: endpoint(endpoints.Okr_dialogList),
  sendDialog: endpoint(endpoints.Okr_dialogSend),

  decompositions: endpoint(endpoints.Okr_decompositionList),
  generateDecomposition: endpoint(endpoints.Okr_decompositionGenerate),
  simulateDecomposition: endpoint(endpoints.Okr_decompositionSimulate),
  commitDecomposition: endpoint(endpoints.Okr_decompositionCommit),

  taskLinks: endpoint(endpoints.Okr_taskLinkList),
  saveTaskLink: endpoint(endpoints.Okr_taskLinkSave),
  removeTaskLink: endpoint(endpoints.Okr_taskLinkRemove),
  assessmentPreview: endpoint(endpoints.Okr_assessmentPreview),
};
