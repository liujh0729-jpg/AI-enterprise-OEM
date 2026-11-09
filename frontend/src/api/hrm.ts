import { endpoints, type EndpointResponse } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

/**
 * HRM API（方案 §5.1 / §12.9 契约端点的薄包装）：
 * 档案、假勤、招聘漏斗、面试评分、Offer 与述职盘点；视图类型从契约响应派生。
 */

export type HrmProfile = NonNullable<EndpointResponse<"Hrm_listProfiles">["data"]>["list"][number];
export type HrmPolicy = NonNullable<EndpointResponse<"Hrm_listPolicies">["data"]>[number];
export type HrmBalance = NonNullable<EndpointResponse<"Hrm_listBalances">["data"]>[number];
export type HrmTimeOff = NonNullable<EndpointResponse<"Hrm_listTimeOff">["data"]>["list"][number];
export type HrmAttendanceLog = NonNullable<EndpointResponse<"Hrm_listAttendance">["data"]>["list"][number];
export type HrmHoliday = NonNullable<EndpointResponse<"Hrm_listHolidays">["data"]>[number];
export type HrmHiringRequest = NonNullable<EndpointResponse<"Hrm_listHiringRequests">["data"]>["list"][number];
export type HrmJob = NonNullable<EndpointResponse<"Hrm_listJobs">["data"]>["list"][number];
export type HrmCandidate = NonNullable<EndpointResponse<"Hrm_listCandidates">["data"]>["list"][number];
export type HrmApplication = NonNullable<EndpointResponse<"Hrm_listApplications">["data"]>["list"][number];
export type HrmEvaluation = NonNullable<EndpointResponse<"Hrm_evaluateApplication">["data"]>;
export type HrmInterview = NonNullable<EndpointResponse<"Hrm_listInterviews">["data"]>["list"][number];
export type HrmCalibration = NonNullable<EndpointResponse<"Hrm_calibration">["data"]>;
export type HrmOffer = NonNullable<EndpointResponse<"Hrm_listOffers">["data"]>["list"][number];
export type HrmReview = NonNullable<EndpointResponse<"Hrm_listReviews">["data"]>["list"][number];
export type HrmRubric = NonNullable<EndpointResponse<"Hrm_getRubric">["data"]>;

export const hrmApi = {
  // 档案
  listProfiles: endpoint(endpoints.Hrm_listProfiles),
  upsertProfile: endpoint(endpoints.Hrm_upsertProfile),
  updateProfileStatus: endpoint(endpoints.Hrm_updateProfileStatus),
  // 假勤
  listPolicies: endpoint(endpoints.Hrm_listPolicies),
  savePolicy: endpoint(endpoints.Hrm_savePolicy),
  listBalances: endpoint(endpoints.Hrm_listBalances),
  createTimeOff: endpoint(endpoints.Hrm_createTimeOff),
  listTimeOff: endpoint(endpoints.Hrm_listTimeOff),
  decideTimeOff: endpoint(endpoints.Hrm_decideTimeOff),
  clock: endpoint(endpoints.Hrm_clock),
  remedyClock: endpoint(endpoints.Hrm_remedyClock),
  listAttendance: endpoint(endpoints.Hrm_listAttendance),
  listHolidays: endpoint(endpoints.Hrm_listHolidays),
  addHoliday: endpoint(endpoints.Hrm_addHoliday),
  // 招聘：申请 / 职位
  createHiringRequest: endpoint(endpoints.Hrm_createHiringRequest),
  listHiringRequests: endpoint(endpoints.Hrm_listHiringRequests),
  decideHiringRequest: endpoint(endpoints.Hrm_decideHiringRequest),
  listJobs: endpoint(endpoints.Hrm_listJobs),
  getJob: endpoint(endpoints.Hrm_getJob),
  createJob: endpoint(endpoints.Hrm_createJob),
  updateJob: endpoint(endpoints.Hrm_updateJob),
  generateJd: endpoint(endpoints.Hrm_generateJd),
  publishJob: endpoint(endpoints.Hrm_publishJob),
  // 招聘：候选人 / 投递
  listCandidates: endpoint(endpoints.Hrm_listCandidates),
  upsertCandidate: endpoint(endpoints.Hrm_upsertCandidate),
  createApplication: endpoint(endpoints.Hrm_createApplication),
  listApplications: endpoint(endpoints.Hrm_listApplications),
  evaluateApplication: endpoint(endpoints.Hrm_evaluateApplication),
  decideApplication: endpoint(endpoints.Hrm_decideApplication),
  // 面试
  scheduleInterview: endpoint(endpoints.Hrm_scheduleInterview),
  listInterviews: endpoint(endpoints.Hrm_listInterviews),
  rateInterview: endpoint(endpoints.Hrm_rateInterview),
  calibration: endpoint(endpoints.Hrm_calibration),
  // Offer / 述职 / rubric
  createOffer: endpoint(endpoints.Hrm_createOffer),
  decideOffer: endpoint(endpoints.Hrm_decideOffer),
  listOffers: endpoint(endpoints.Hrm_listOffers),
  upsertReview: endpoint(endpoints.Hrm_upsertReview),
  listReviews: endpoint(endpoints.Hrm_listReviews),
  getRubric: endpoint(endpoints.Hrm_getRubric),
  saveRubric: endpoint(endpoints.Hrm_saveRubric),
};
