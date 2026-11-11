import type { CurrentUser } from '../auth/current-user';
import type {
  HrmProfileService,
  TransferHandoverInput,
  UpsertProfileInput,
  UpdateProfileStatusInput,
} from './hrm-profile.service';
import type {
  AddHolidayInput,
  CreateTimeOffInput,
  DecideTimeOffInput,
  HrmAttendanceService,
  RemedyClockInput,
  SavePolicyInput,
} from './hrm-attendance.service';
import type {
  CreateHiringRequestInput,
  CreateJobInput,
  DecideHiringRequestInput,
  GenerateJdInput,
  HrmRecruitService,
  UpdateJobInput,
} from './hrm-recruit.service';
import type {
  CreateApplicationInput,
  DecideApplicationInput,
  HrmTalentService,
  RateInterviewInput,
  ScheduleInterviewInput,
  UpsertCandidateInput,
} from './hrm-talent.service';
import type {
  CreateOfferInput,
  DecideOfferInput,
  HrmLifecycleService,
  SaveRubricInput,
  UpsertReviewInput,
} from './hrm-lifecycle.service';

type PageQuery = { page: number; pageSize: number };

/**
 * HRM 控制器：契约端点 id `Hrm_xxx` → 方法名 `xxx`，由 automation-routes 的
 * moduleHandlers 统一注册（自动进 OpenAPI/MCP，参数顺序＝用户、路径参数、查询、请求体）。
 */
export class HrmController {
  constructor(
    private readonly profileService: HrmProfileService,
    private readonly attendanceService: HrmAttendanceService,
    private readonly recruitService: HrmRecruitService,
    private readonly talentService: HrmTalentService,
    private readonly lifecycleService: HrmLifecycleService,
  ) {}

  // ---------- 员工档案 ----------

  listProfiles(
    user: CurrentUser,
    query: PageQuery & { department?: string; status?: string; q?: string },
  ) {
    return this.profileService.list(query, user);
  }

  upsertProfile(user: CurrentUser, body: UpsertProfileInput) {
    return this.profileService.upsert(body, user);
  }

  updateProfileStatus(user: CurrentUser, body: UpdateProfileStatusInput) {
    return this.profileService.updateStatus(body, user);
  }

  handoverChecklist(user: CurrentUser, query: { memberUserId: string }) {
    return this.profileService.handover(query.memberUserId, user);
  }

  transferHandover(user: CurrentUser, body: TransferHandoverInput) {
    return this.profileService.transferHandover(body, user);
  }

  // ---------- 假勤 ----------

  listPolicies(user: CurrentUser, query: { year?: number }) {
    return this.attendanceService.listPolicies(query, user);
  }

  savePolicy(user: CurrentUser, body: SavePolicyInput) {
    return this.attendanceService.savePolicy(body, user);
  }

  listBalances(
    user: CurrentUser,
    query: { year: number; staffUserId?: string },
  ) {
    return this.attendanceService.listBalances(query, user);
  }

  createTimeOff(user: CurrentUser, body: CreateTimeOffInput) {
    return this.attendanceService.createTimeOff(body, user);
  }

  listTimeOff(
    user: CurrentUser,
    query: PageQuery & { staffUserId?: string; status?: string },
  ) {
    return this.attendanceService.listTimeOff(query, user);
  }

  decideTimeOff(user: CurrentUser, body: DecideTimeOffInput) {
    return this.attendanceService.decideTimeOff(body, user);
  }

  clock(user: CurrentUser, body: { note?: string }) {
    return this.attendanceService.clock(body, user);
  }

  remedyClock(user: CurrentUser, body: RemedyClockInput) {
    return this.attendanceService.remedyClock(body, user);
  }

  listAttendance(
    user: CurrentUser,
    query: PageQuery & {
      staffUserId?: string;
      startDate?: string;
      endDate?: string;
    },
  ) {
    return this.attendanceService.listAttendance(query, user);
  }

  listHolidays(user: CurrentUser, query: { year: number }) {
    return this.attendanceService.listHolidays(query, user);
  }

  addHoliday(user: CurrentUser, body: AddHolidayInput) {
    return this.attendanceService.addHoliday(body, user);
  }

  // ---------- 招聘：用人申请 / 职位 ----------

  createHiringRequest(user: CurrentUser, body: CreateHiringRequestInput) {
    return this.recruitService.createHiringRequest(body, user);
  }

  listHiringRequests(
    user: CurrentUser,
    query: PageQuery & { status?: string },
  ) {
    return this.recruitService.listHiringRequests(query, user);
  }

  decideHiringRequest(user: CurrentUser, body: DecideHiringRequestInput) {
    return this.recruitService.decideHiringRequest(body, user);
  }

  listJobs(
    user: CurrentUser,
    query: PageQuery & { status?: string; q?: string },
  ) {
    return this.recruitService.listJobs(query, user);
  }

  getJob(user: CurrentUser, id: string) {
    return this.recruitService.getJob(Number(id), user);
  }

  createJob(user: CurrentUser, body: CreateJobInput) {
    return this.recruitService.createJob(body, user);
  }

  updateJob(user: CurrentUser, body: UpdateJobInput) {
    return this.recruitService.updateJob(body, user);
  }

  generateJd(user: CurrentUser, body: GenerateJdInput) {
    return this.recruitService.generateJd(body, user);
  }

  publishJob(user: CurrentUser, body: { id: number }) {
    return this.recruitService.publishJob(body.id, user);
  }

  // ---------- 招聘：候选人 / 投递 / 评估 ----------

  listCandidates(user: CurrentUser, query: PageQuery & { q?: string }) {
    return this.talentService.listCandidates(query, user);
  }

  upsertCandidate(user: CurrentUser, body: UpsertCandidateInput) {
    return this.talentService.upsertCandidate(body, user);
  }

  createApplication(user: CurrentUser, body: CreateApplicationInput) {
    return this.talentService.createApplication(body, user);
  }

  listApplications(
    user: CurrentUser,
    query: PageQuery & { jobId?: number; status?: string },
  ) {
    return this.talentService.listApplications(query, user);
  }

  evaluateApplication(user: CurrentUser, body: { id: number }) {
    return this.talentService.evaluateApplication(body.id, user);
  }

  decideApplication(user: CurrentUser, body: DecideApplicationInput) {
    return this.talentService.decideApplication(body, user);
  }

  // ---------- 面试与评分 ----------

  scheduleInterview(user: CurrentUser, body: ScheduleInterviewInput) {
    return this.talentService.scheduleInterview(body, user);
  }

  listInterviews(
    user: CurrentUser,
    query: PageQuery & { applicationId?: number; status?: string },
  ) {
    return this.talentService.listInterviews(query, user);
  }

  rateInterview(user: CurrentUser, body: RateInterviewInput) {
    return this.talentService.rateInterview(body, user);
  }

  calibration(user: CurrentUser) {
    return this.talentService.calibration(user);
  }

  // ---------- Offer 与盘点 ----------

  createOffer(user: CurrentUser, body: CreateOfferInput) {
    return this.lifecycleService.createOffer(body, user);
  }

  decideOffer(user: CurrentUser, body: DecideOfferInput) {
    return this.lifecycleService.decideOffer(body, user);
  }

  listOffers(user: CurrentUser, query: PageQuery & { status?: string }) {
    return this.lifecycleService.listOffers(query, user);
  }

  upsertReview(user: CurrentUser, body: UpsertReviewInput) {
    return this.lifecycleService.upsertReview(body, user);
  }

  listReviews(
    user: CurrentUser,
    query: PageQuery & { staffUserId?: string; period?: string },
  ) {
    return this.lifecycleService.listReviews(query, user);
  }

  // ---------- rubric ----------

  /** 评分表是全局默认模板（与身份无关）；user 只是 automation-routes 统一注入的首参。 */
  getRubric(user: CurrentUser, query: { code?: string }) {
    return this.lifecycleService.getRubric(query.code);
  }

  saveRubric(user: CurrentUser, body: SaveRubricInput) {
    return this.lifecycleService.saveRubric(body, user);
  }
}
