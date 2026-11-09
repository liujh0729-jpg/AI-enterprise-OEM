import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const recruitApi = {
  profile: endpoint(endpoints.Recruit_getProfile),
  saveProfile: endpoint(endpoints.Recruit_saveProfile),

  jobs: endpoint(endpoints.Recruit_listJobs),
  evaluatePost: endpoint(endpoints.Recruit_evaluatePost),
  matchJobs: endpoint(endpoints.Recruit_matchJobs),
  optimizeResume: endpoint(endpoints.Recruit_optimizeResume),

  applications: endpoint(endpoints.Recruit_listApplications),
  createApplication: endpoint(endpoints.Recruit_createApplication),
  confirmApplication: endpoint(endpoints.Recruit_confirmApplication),
  updateApplicationStatus: endpoint(endpoints.Recruit_updateApplicationStatus),

  funnel: endpoint(endpoints.Recruit_funnelStats),
  insights: endpoint(endpoints.Recruit_patternInsights),
  events: endpoint(endpoints.Recruit_events),
};
