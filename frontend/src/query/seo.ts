"use client";
import { seoApi } from "@/api/seo";
import { useBusinessMutation, useBusinessQuery } from "./business";

const PAGE = { page: 1, pageSize: 20 };

// --- 站点档案 / 总览 / 设置 ---
export const useSeoProjects = () =>
  useBusinessQuery("seo", "projects", {}, (signal) => seoApi.listProjects({}, { signal }));
export const useSeoOverview = (projectId: number) =>
  useBusinessQuery(
    "seo",
    "overview",
    { projectId },
    (signal) => seoApi.overview({ query: { projectId: projectId || undefined } }, { signal }),
    "all",
    projectId > 0,
  );
export const useSeoSettings = () =>
  useBusinessQuery("seo", "settings", {}, (signal) => seoApi.settings({}, { signal }));
export const useSeoGoogleSettings = () =>
  useBusinessQuery("seo", "google-settings", {}, (signal) => seoApi.googleSettings({}, { signal }));
export const useSeoTables = () =>
  useBusinessQuery("seo", "tables", {}, (signal) => seoApi.tables({}, { signal }));

// --- 站点体检 ---
export const useSeoAudits = (projectId: number, page = 1) =>
  useBusinessQuery(
    "seo",
    "audits",
    { projectId, page },
    (signal) => seoApi.listAudits({ query: { projectId, page, pageSize: PAGE.pageSize } }, { signal }),
    "all",
    projectId > 0,
  );
export const useSeoAuditDetail = (id: number) =>
  useBusinessQuery(
    "seo",
    "audit-detail",
    { id },
    (signal) => seoApi.getAudit({ params: { id } }, { signal }),
    "all",
    id > 0,
  );

// --- 关键词 / 聚类 / GSC ---
export const useSeoKeywords = (projectId: number, q = "", tag = "", page = 1) =>
  useBusinessQuery(
    "seo",
    "keywords",
    { projectId, q, tag, page },
    (signal) =>
      seoApi.listKeywords(
        { query: { projectId, q: q || undefined, tag: tag || undefined, page, pageSize: PAGE.pageSize } },
        { signal },
      ),
    "all",
    projectId > 0,
  );
export const useSeoClusters = (projectId: number) =>
  useBusinessQuery(
    "seo",
    "clusters",
    { projectId },
    (signal) => seoApi.listClusters({ query: { projectId } }, { signal }),
    "all",
    projectId > 0,
  );
export const useSeoGscImports = (projectId: number) =>
  useBusinessQuery(
    "seo",
    "gsc-imports",
    { projectId },
    (signal) => seoApi.listGscImports({ query: { projectId } }, { signal }),
    "all",
    projectId > 0,
  );
export const useSeoGscAnalysis = (projectId: number, importId = 0) =>
  useBusinessQuery(
    "seo",
    "gsc-analysis",
    { projectId, importId },
    (signal) =>
      seoApi.gscAnalysis({ query: { projectId, importId: importId || undefined } }, { signal }),
    "all",
    projectId > 0,
  );

// --- 排名跟踪 ---
export const useSeoTrackers = (projectId: number) =>
  useBusinessQuery(
    "seo",
    "trackers",
    { projectId },
    (signal) => seoApi.listTrackers({ query: { projectId } }, { signal }),
    "all",
    projectId > 0,
  );
export const useSeoRankKeywords = (trackerId: number) =>
  useBusinessQuery(
    "seo",
    "rank-keywords",
    { trackerId },
    (signal) => seoApi.listRankKeywords({ query: { trackerId } }, { signal }),
    "all",
    trackerId > 0,
  );
export const useSeoRankEstimate = (trackerId: number) =>
  useBusinessQuery(
    "seo",
    "rank-estimate",
    { trackerId },
    (signal) => seoApi.estimateRankCost({ query: { trackerId } }, { signal }),
    "all",
    trackerId > 0,
  );
export const useSeoRankHistory = (trackerId: number) =>
  useBusinessQuery(
    "seo",
    "rank-history",
    { trackerId },
    (signal) => seoApi.rankHistory({ query: { trackerId } }, { signal }),
    "all",
    trackerId > 0,
  );

// --- 竞品 ---
export const useSeoCompetitorOverview = (projectId: number, domain: string) =>
  useBusinessQuery(
    "seo",
    "competitor-overview",
    { projectId, domain },
    (signal) => seoApi.competitorOverview({ query: { projectId, domain } }, { signal }),
    "all",
    projectId > 0 && domain.length >= 3,
  );

// --- 外链分析 ---
export const useSeoBacklinksOverview = (projectId: number, domain: string) =>
  useBusinessQuery(
    "seo",
    "backlinks-overview",
    { projectId, domain },
    (signal) => seoApi.backlinksOverview({ query: { projectId, domain } }, { signal }),
    "all",
    projectId > 0 && domain.length >= 3,
  );
export const useSeoBacklinksProfile = (projectId: number, domain: string, page = 1) =>
  useBusinessQuery(
    "seo",
    "backlinks-profile",
    { projectId, domain, page },
    (signal) =>
      seoApi.backlinksProfile({ query: { projectId, domain, page, pageSize: PAGE.pageSize } }, { signal }),
    "all",
    projectId > 0 && domain.length >= 3,
  );
export const useSeoBacklinksHistory = (projectId: number) =>
  useBusinessQuery(
    "seo",
    "backlinks-history",
    { projectId },
    (signal) => seoApi.backlinksHistory({ query: { projectId } }, { signal }),
    "all",
    projectId > 0,
  );

// --- 外链建设 ---
export const useSeoProspects = (projectId: number, status = "", page = 1) =>
  useBusinessQuery(
    "seo",
    "prospects",
    { projectId, status, page },
    (signal) =>
      seoApi.listProspects(
        { query: { projectId, status: status || undefined, page, pageSize: PAGE.pageSize } },
        { signal },
      ),
    "all",
    projectId > 0,
  );

// --- 本地 SEO ---
export const useSeoLocalTrackers = (projectId: number) =>
  useBusinessQuery(
    "seo",
    "local-trackers",
    { projectId },
    (signal) => seoApi.listLocalTrackers({ query: { projectId } }, { signal }),
    "all",
    projectId > 0,
  );
export const useSeoLocalEstimate = (trackerId: number) =>
  useBusinessQuery(
    "seo",
    "local-estimate",
    { trackerId },
    (signal) => seoApi.estimateLocalCost({ query: { trackerId } }, { signal }),
    "all",
    trackerId > 0,
  );
export const useSeoLocalGrid = (trackerId: number, runId = 0) =>
  useBusinessQuery(
    "seo",
    "local-grid",
    { trackerId, runId },
    (signal) =>
      seoApi.localGrid({ query: { trackerId, runId: runId || undefined } }, { signal }),
    "all",
    trackerId > 0,
  );

// --- Google GA4 ---
export const useSeoGa4Rows = (projectId: number) =>
  useBusinessQuery(
    "seo",
    "ga4-rows",
    { projectId },
    (signal) => seoApi.ga4Rows({ query: { projectId } }, { signal }),
    "all",
    projectId > 0,
  );

// --- 收录：IndexNow / 百度 ---
export const useSeoIndexnowHistory = (projectId: number) =>
  useBusinessQuery(
    "seo",
    "indexnow-history",
    { projectId },
    (signal) => seoApi.indexnowHistory({ query: { projectId } }, { signal }),
    "all",
    projectId > 0,
  );
export const useSeoBaiduCredential = (projectId: number) =>
  useBusinessQuery(
    "seo",
    "baidu-credential",
    { projectId },
    (signal) => seoApi.baiduCredential({ query: { projectId } }, { signal }),
    "all",
    projectId > 0,
  );
export const useSeoBaiduHistory = (projectId: number) =>
  useBusinessQuery(
    "seo",
    "baidu-history",
    { projectId },
    (signal) => seoApi.baiduHistory({ query: { projectId } }, { signal }),
    "all",
    projectId > 0,
  );

// --- 程序化页面 ---
export const useSeoProgrammaticRuns = (projectId: number) =>
  useBusinessQuery(
    "seo",
    "programmatic-runs",
    { projectId },
    (signal) => seoApi.programmaticRuns({ query: { projectId } }, { signal }),
    "all",
    projectId > 0,
  );
export const useSeoProgrammaticPages = (runId: number) =>
  useBusinessQuery(
    "seo",
    "programmatic-pages",
    { runId },
    (signal) => seoApi.programmaticPages({ query: { runId } }, { signal }),
    "all",
    runId > 0,
  );

// --- 报告 / 研究日志 ---
export const useSeoReports = (projectId: number) =>
  useBusinessQuery(
    "seo",
    "reports",
    { projectId },
    (signal) => seoApi.listReports({ query: { projectId } }, { signal }),
    "all",
    projectId > 0,
  );
export const useSeoResearchLog = (projectId: number, page = 1) =>
  useBusinessQuery(
    "seo",
    "research-log",
    { projectId, page },
    (signal) =>
      seoApi.researchLog({ query: { projectId, page, pageSize: PAGE.pageSize } }, { signal }),
    "all",
    projectId > 0,
  );

/** SEO 写操作统一刷新 seo 与 dashboard 模块（跨企业上下文）。 */
export function useSeoActions() {
  const invalidate = ["seo", "dashboard"];
  return {
    createProject: useBusinessMutation(seoApi.createProject, invalidate),
    updateProject: useBusinessMutation(seoApi.updateProject, invalidate),
    removeProject: useBusinessMutation(seoApi.removeProject, invalidate),
    saveProvider: useBusinessMutation(seoApi.saveProvider, invalidate),
    clearProvider: useBusinessMutation(seoApi.clearProvider, invalidate),
    testProvider: useBusinessMutation(seoApi.testProvider, []),
    startAudit: useBusinessMutation(seoApi.startAudit, invalidate),
    explainAudit: useBusinessMutation(seoApi.explainAudit, invalidate),
    researchKeywords: useBusinessMutation(seoApi.researchKeywords, invalidate),
    saveKeywords: useBusinessMutation(seoApi.saveKeywords, invalidate),
    removeKeyword: useBusinessMutation(seoApi.removeKeyword, invalidate),
    clusterKeywords: useBusinessMutation(seoApi.clusterKeywords, invalidate),
    importGsc: useBusinessMutation(seoApi.importGsc, invalidate),
    createTracker: useBusinessMutation(seoApi.createTracker, invalidate),
    updateTracker: useBusinessMutation(seoApi.updateTracker, invalidate),
    removeTracker: useBusinessMutation(seoApi.removeTracker, invalidate),
    addRankKeywords: useBusinessMutation(seoApi.addRankKeywords, invalidate),
    removeRankKeyword: useBusinessMutation(seoApi.removeRankKeyword, invalidate),
    runRankCheck: useBusinessMutation(seoApi.runRankCheck, invalidate),
    competitorPages: useBusinessMutation(seoApi.competitorPages, invalidate),
    discoverProspects: useBusinessMutation(seoApi.discoverProspects, invalidate),
    addProspect: useBusinessMutation(seoApi.addProspect, invalidate),
    extractContact: useBusinessMutation(seoApi.extractContact, invalidate),
    draftOutreach: useBusinessMutation(seoApi.draftOutreach, invalidate),
    updateProspect: useBusinessMutation(seoApi.updateProspect, invalidate),
    removeProspect: useBusinessMutation(seoApi.removeProspect, invalidate),
    pushProspectsToMail: useBusinessMutation(seoApi.pushProspectsToMail, invalidate),
    createLocalTracker: useBusinessMutation(seoApi.createLocalTracker, invalidate),
    removeLocalTracker: useBusinessMutation(seoApi.removeLocalTracker, invalidate),
    runLocalCheck: useBusinessMutation(seoApi.runLocalCheck, invalidate),
    saveGoogleClient: useBusinessMutation(seoApi.saveGoogleClient, invalidate),
    connectGoogle: useBusinessMutation(seoApi.connectGoogle, invalidate),
    disconnectGoogle: useBusinessMutation(seoApi.disconnectGoogle, invalidate),
    syncGoogle: useBusinessMutation(seoApi.syncGoogle, invalidate),
    generateSchema: useBusinessMutation(seoApi.generateSchema, invalidate),
    validateSchema: useBusinessMutation(seoApi.validateSchema, []),
    setupIndexnow: useBusinessMutation(seoApi.setupIndexnow, invalidate),
    verifyIndexnow: useBusinessMutation(seoApi.verifyIndexnow, invalidate),
    submitIndexnow: useBusinessMutation(seoApi.submitIndexnow, invalidate),
    saveBaiduCredential: useBusinessMutation(seoApi.saveBaiduCredential, invalidate),
    submitBaidu: useBusinessMutation(seoApi.submitBaidu, invalidate),
    programmaticPreview: useBusinessMutation(seoApi.programmaticPreview, []),
    programmaticGenerate: useBusinessMutation(seoApi.programmaticGenerate, invalidate),
    generateReport: useBusinessMutation(seoApi.generateReport, invalidate),
    shareReport: useBusinessMutation(seoApi.shareReport, invalidate),
  };
}