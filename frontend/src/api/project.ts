import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const projectApi = {
  overview: endpoint(endpoints.Pj_overview),

  projects: endpoint(endpoints.Pj_listProjects),
  project: endpoint(endpoints.Pj_getProject),
  saveProject: endpoint(endpoints.Pj_saveProject),
  removeProject: endpoint(endpoints.Pj_removeProject),

  saveMember: endpoint(endpoints.Pj_saveMember),
  removeMember: endpoint(endpoints.Pj_removeMember),

  sprints: endpoint(endpoints.Pj_listSprints),
  saveSprint: endpoint(endpoints.Pj_saveSprint),
  removeSprint: endpoint(endpoints.Pj_removeSprint),

  milestones: endpoint(endpoints.Pj_listMilestones),
  saveMilestone: endpoint(endpoints.Pj_saveMilestone),
  removeMilestone: endpoint(endpoints.Pj_removeMilestone),

  tasks: endpoint(endpoints.Pj_listTasks),
  saveTask: endpoint(endpoints.Pj_saveTask),
  moveTask: endpoint(endpoints.Pj_moveTask),
  removeTask: endpoint(endpoints.Pj_removeTask),
  addRelation: endpoint(endpoints.Pj_addRelation),
  removeRelation: endpoint(endpoints.Pj_removeRelation),

  wbsSuggest: endpoint(endpoints.Pj_wbsSuggest),
  insight: endpoint(endpoints.Pj_projectInsight),
  risks: endpoint(endpoints.Pj_riskList),

  timeLogs: endpoint(endpoints.Pj_listTimeLogs),
  addTimeLog: endpoint(endpoints.Pj_addTimeLog),
  startTimer: endpoint(endpoints.Pj_startTimer),
  stopTimer: endpoint(endpoints.Pj_stopTimer),
  decideTimeLog: endpoint(endpoints.Pj_decideTimeLog),
  removeTimeLog: endpoint(endpoints.Pj_removeTimeLog),

  timesheets: endpoint(endpoints.Pj_listTimesheets),
  generateTimesheet: endpoint(endpoints.Pj_generateTimesheet),
  decideTimesheet: endpoint(endpoints.Pj_decideTimesheet),

  settings: endpoint(endpoints.Pj_settingsGet),
  saveSettings: endpoint(endpoints.Pj_settingsSave),

  costRates: endpoint(endpoints.Pj_listCostRates),
  saveCostRate: endpoint(endpoints.Pj_saveCostRate),
  removeCostRate: endpoint(endpoints.Pj_removeCostRate),
  costItems: endpoint(endpoints.Pj_listCostItems),
  saveCostItem: endpoint(endpoints.Pj_saveCostItem),
  removeCostItem: endpoint(endpoints.Pj_removeCostItem),
  projectCost: endpoint(endpoints.Pj_projectCost),
  engagements: endpoint(endpoints.Pj_listEngagements),
  saveEngagement: endpoint(endpoints.Pj_saveEngagement),
  decideEngagement: endpoint(endpoints.Pj_decideEngagement),
  removeEngagement: endpoint(endpoints.Pj_removeEngagement),

  demand: endpoint(endpoints.Pj_getDemand),
  saveDemand: endpoint(endpoints.Pj_saveDemand),
  respondDemand: endpoint(endpoints.Pj_respondDemand),
  acceptDemand: endpoint(endpoints.Pj_acceptDemand),
  closeDemand: endpoint(endpoints.Pj_closeDemand),
};
