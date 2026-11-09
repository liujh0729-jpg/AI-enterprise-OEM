import type { z } from 'zod';
import type { CurrentUser } from '../auth/current-user';
import {
  generateSeoReportBodySchema,
  generateSeoSchemaBodySchema,
  seoProgrammaticGenerateBodySchema,
  seoProgrammaticPreviewBodySchema,
  submitSeoBaiduBodySchema,
  submitSeoIndexnowBodySchema,
  validateSeoSchemaBodySchema,
  saveSeoBaiduCredentialBodySchema,
} from '@enterprise/contracts';
import { parseId } from '../common/parse-id';
import type { SeoProjectService } from './seo-project.service';
import type { SeoAuditService } from './seo-audit.service';
import type { SeoKeywordService } from './seo-keyword.service';
import type { SeoRankService } from './seo-rank.service';
import type { SeoCompetitorService } from './seo-competitor.service';
import type { SeoLocalService } from './seo-local.service';
import type { SeoGoogleService } from './seo-google.service';
import type { SeoOutreachService } from './seo-outreach.service';
import type { SeoSchemaService } from './seo-schema.service';
import type { SeoProgrammaticService } from './seo-programmatic.service';
import type { SeoReportService } from './seo-report.service';

type Row = Record<string, unknown>;
type PageQuery = { page: number; pageSize: number };
type ProjectQuery = { projectId: number };

export type SeoServices = {
  projects: SeoProjectService;
  audits: SeoAuditService;
  keywords: SeoKeywordService;
  rank: SeoRankService;
  competitors: SeoCompetitorService;
  local: SeoLocalService;
  google: SeoGoogleService;
  outreach: SeoOutreachService;
  schema: SeoSchemaService;
  programmatic: SeoProgrammaticService;
  reports: SeoReportService;
};

/** SEO 工作台控制器：方法名与契约 `Seo_*` 后缀一一对应（moduleHandlers 自动路由）。 */
export class SeoController {
  constructor(private readonly s: SeoServices) {}

  // 站点档案与数据源
  listProjects(user: CurrentUser) {
    return this.s.projects.listProjects(user);
  }
  createProject(user: CurrentUser, body: Row) {
    return this.s.projects.createProject(user, body);
  }
  updateProject(user: CurrentUser, body: Row) {
    return this.s.projects.updateProject(user, body);
  }
  removeProject(user: CurrentUser, body: Row) {
    return this.s.projects.removeProject(user, body);
  }
  overview(user: CurrentUser, query: { projectId?: number }) {
    return this.s.projects.overview(user, query);
  }
  settings(user: CurrentUser) {
    return this.s.projects.settings(user);
  }
  saveProvider(user: CurrentUser, body: Row) {
    return this.s.projects.saveProvider(user, body);
  }
  clearProvider(user: CurrentUser, body: Row) {
    return this.s.projects.clearProvider(user, body);
  }
  testProvider(user: CurrentUser, body: Row) {
    return this.s.projects.testProvider(user, body);
  }

  // 站点体检
  startAudit(user: CurrentUser, body: Row) {
    return this.s.audits.startAudit(user, body);
  }
  listAudits(user: CurrentUser, query: PageQuery & ProjectQuery) {
    return this.s.audits.listAudits(user, query);
  }
  getAudit(user: CurrentUser, id: string) {
    return this.s.audits.getAudit(user, parseId(id));
  }
  explainAudit(user: CurrentUser, body: Row) {
    return this.s.audits.explainAudit(user, body);
  }

  // 关键词与 GSC
  researchKeywords(user: CurrentUser, body: Row) {
    return this.s.keywords.researchKeywords(user, body);
  }
  saveKeywords(user: CurrentUser, body: Row) {
    return this.s.keywords.saveKeywords(user, body);
  }
  listKeywords(
    user: CurrentUser,
    query: PageQuery & ProjectQuery & { q?: string; tag?: string },
  ) {
    return this.s.keywords.listKeywords(user, query);
  }
  removeKeyword(user: CurrentUser, body: Row) {
    return this.s.keywords.removeKeyword(user, body);
  }
  clusterKeywords(user: CurrentUser, body: Row) {
    return this.s.keywords.clusterKeywords(user, body);
  }
  listClusters(user: CurrentUser, query: ProjectQuery) {
    return this.s.keywords.listClusters(user, query);
  }
  importGsc(user: CurrentUser, body: Row) {
    return this.s.keywords.importGsc(user, body);
  }
  listGscImports(user: CurrentUser, query: ProjectQuery) {
    return this.s.keywords.listGscImports(user, query);
  }
  gscAnalysis(user: CurrentUser, query: ProjectQuery & { importId?: number }) {
    return this.s.keywords.gscAnalysis(user, query);
  }

  // 排名跟踪
  createTracker(user: CurrentUser, body: Row) {
    return this.s.rank.createTracker(user, body);
  }
  listTrackers(user: CurrentUser, query: ProjectQuery) {
    return this.s.rank.listTrackers(user, query);
  }
  updateTracker(user: CurrentUser, body: Row) {
    return this.s.rank.updateTracker(user, body);
  }
  removeTracker(user: CurrentUser, body: Row) {
    return this.s.rank.removeTracker(user, body);
  }
  listRankKeywords(user: CurrentUser, query: { trackerId: number }) {
    return this.s.rank.listRankKeywords(user, query);
  }
  addRankKeywords(user: CurrentUser, body: Row) {
    return this.s.rank.addRankKeywords(user, body);
  }
  removeRankKeyword(user: CurrentUser, body: Row) {
    return this.s.rank.removeRankKeyword(user, body);
  }
  estimateRankCost(user: CurrentUser, query: { trackerId: number }) {
    return this.s.rank.estimateRankCost(user, query);
  }
  runRankCheck(user: CurrentUser, body: Row) {
    return this.s.rank.runRankCheck(user, body);
  }
  rankHistory(user: CurrentUser, query: { trackerId: number }) {
    return this.s.rank.rankHistory(user, query);
  }

  // 竞品与外链分析
  competitorOverview(
    user: CurrentUser,
    query: ProjectQuery & { domain: string },
  ) {
    return this.s.competitors.competitorOverview(user, query);
  }
  competitorPages(user: CurrentUser, body: Row) {
    return this.s.competitors.competitorPages(user, body);
  }
  backlinksOverview(
    user: CurrentUser,
    query: ProjectQuery & { domain: string },
  ) {
    return this.s.competitors.backlinksOverview(user, query);
  }
  backlinksProfile(
    user: CurrentUser,
    query: PageQuery & ProjectQuery & { domain: string },
  ) {
    return this.s.competitors.backlinksProfile(user, query);
  }
  backlinksHistory(user: CurrentUser, query: ProjectQuery) {
    return this.s.competitors.backlinksHistory(user, query);
  }

  // 外链建设
  discoverProspects(user: CurrentUser, body: Row) {
    return this.s.outreach.discoverProspects(user, body);
  }
  listProspects(
    user: CurrentUser,
    query: PageQuery & ProjectQuery & { status?: string },
  ) {
    return this.s.outreach.listProspects(user, query);
  }
  addProspect(user: CurrentUser, body: Row) {
    return this.s.outreach.addProspect(user, body);
  }
  extractContact(user: CurrentUser, body: Row) {
    return this.s.outreach.extractContact(user, body);
  }
  draftOutreach(user: CurrentUser, body: Row) {
    return this.s.outreach.draftOutreach(user, body);
  }
  updateProspect(user: CurrentUser, body: Row) {
    return this.s.outreach.updateProspect(user, body);
  }
  removeProspect(user: CurrentUser, body: Row) {
    return this.s.outreach.removeProspect(user, body);
  }
  pushProspectsToMail(user: CurrentUser, body: Row) {
    return this.s.outreach.pushProspectsToMail(user, body);
  }

  // 本地 SEO
  createLocalTracker(user: CurrentUser, body: Row) {
    return this.s.local.createLocalTracker(user, body);
  }
  listLocalTrackers(user: CurrentUser, query: ProjectQuery) {
    return this.s.local.listLocalTrackers(user, query);
  }
  removeLocalTracker(user: CurrentUser, body: Row) {
    return this.s.local.removeLocalTracker(user, body);
  }
  estimateLocalCost(user: CurrentUser, query: { trackerId: number }) {
    return this.s.local.estimateLocalCost(user, query);
  }
  runLocalCheck(user: CurrentUser, body: Row) {
    return this.s.local.runLocalCheck(user, body);
  }
  localGrid(user: CurrentUser, query: { trackerId: number; runId?: number }) {
    return this.s.local.localGrid(user, query);
  }

  // Google 双轨同步
  googleSettings(user: CurrentUser) {
    return this.s.google.googleSettings(user);
  }
  saveGoogleClient(user: CurrentUser, body: Row) {
    return this.s.google.saveGoogleClient(user, body);
  }
  googleAuthUrl(user: CurrentUser, query: { service: string }) {
    return this.s.google.googleAuthUrl(user, query);
  }
  googleCallback(
    user: CurrentUser,
    query: { code?: string; state?: string; error?: string },
  ) {
    return this.s.google.googleCallback(user, query);
  }
  connectGoogle(user: CurrentUser, body: Row) {
    return this.s.google.connectGoogle(user, body);
  }
  disconnectGoogle(user: CurrentUser, body: Row) {
    return this.s.google.disconnectGoogle(user, body);
  }
  syncGoogle(user: CurrentUser, body: Row) {
    return this.s.google.syncGoogle(user, body);
  }
  ga4Rows(user: CurrentUser, query: ProjectQuery) {
    return this.s.google.ga4Rows(user, query);
  }

  // 结构化数据与收录
  generateSchema(
    user: CurrentUser,
    body: z.infer<typeof generateSeoSchemaBodySchema>,
  ) {
    return this.s.schema.generateSchema(user, body);
  }
  validateSchema(
    user: CurrentUser,
    body: z.infer<typeof validateSeoSchemaBodySchema>,
  ) {
    return this.s.schema.validateSchema(user, body);
  }
  setupIndexnow(user: CurrentUser, body: ProjectQuery) {
    return this.s.schema.setupIndexnow(user, body);
  }
  verifyIndexnow(user: CurrentUser, body: ProjectQuery) {
    return this.s.schema.verifyIndexnow(user, body);
  }
  submitIndexnow(
    user: CurrentUser,
    body: z.infer<typeof submitSeoIndexnowBodySchema>,
  ) {
    return this.s.schema.submitIndexnow(user, body);
  }
  indexnowHistory(user: CurrentUser, query: ProjectQuery) {
    return this.s.schema.indexnowHistory(user, query);
  }
  baiduCredential(user: CurrentUser, query: ProjectQuery) {
    return this.s.schema.baiduCredential(user, query);
  }
  saveBaiduCredential(
    user: CurrentUser,
    body: z.infer<typeof saveSeoBaiduCredentialBodySchema>,
  ) {
    return this.s.schema.saveBaiduCredential(user, body);
  }
  submitBaidu(
    user: CurrentUser,
    body: z.infer<typeof submitSeoBaiduBodySchema>,
  ) {
    return this.s.schema.submitBaidu(user, body);
  }
  baiduHistory(user: CurrentUser, query: ProjectQuery) {
    return this.s.schema.baiduHistory(user, query);
  }

  // 程序化页面
  programmaticPreview(
    user: CurrentUser,
    body: z.infer<typeof seoProgrammaticPreviewBodySchema>,
  ) {
    return this.s.programmatic.programmaticPreview(user, body);
  }
  programmaticGenerate(
    user: CurrentUser,
    body: z.infer<typeof seoProgrammaticGenerateBodySchema>,
  ) {
    return this.s.programmatic.programmaticGenerate(user, body);
  }
  programmaticRuns(user: CurrentUser, query: ProjectQuery) {
    return this.s.programmatic.programmaticRuns(user, query);
  }
  programmaticPages(user: CurrentUser, query: { runId: number }) {
    return this.s.programmatic.programmaticPages(user, query);
  }
  programmaticExport(user: CurrentUser, query: { runId: number }) {
    return this.s.programmatic.programmaticExport(user, query);
  }

  // 报告与研究日志
  generateReport(
    user: CurrentUser,
    body: z.infer<typeof generateSeoReportBodySchema>,
  ) {
    return this.s.reports.generateReport(user, body);
  }
  listReports(user: CurrentUser, query: ProjectQuery) {
    return this.s.reports.listReports(user, query);
  }
  shareReport(user: CurrentUser, body: Row) {
    return this.s.reports.shareReport(user, { id: Number(body.id) });
  }
  researchLog(user: CurrentUser, query: PageQuery & ProjectQuery) {
    return this.s.projects.researchLog(user, query);
  }
}
