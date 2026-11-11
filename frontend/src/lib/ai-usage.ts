/**
 * AI 用量事实的中文口径（AI 底座方案 §4.4）。
 * 板块 / 科目 / 洞察归属三套编码都在这一处映射，后台与用户侧用量页共用，避免同词不同译。
 */

/** 计费科目 code（BillingRule.code / PointTransaction.scene / UsageEvent.code）。 */
export const BILLING_SUBJECT_LABELS: Record<string, string> = {
  ai_call: "AI 调用（未配科目）",
  ai_customer: "AI 客服会话",
  ai_service: "AI 内容生成",
  asset_storage: "数字资产存储",
  bi: "BI 查询",
  crm: "CRM 席位",
  hrm_resume_score: "简历/JD 智能评分",
  insight_report: "AI 洞察报告",
  jd_generate: "AI 生成 JD",
  kb_consolidate: "知识记忆提炼",
  kb_ingest: "知识库投料",
  kb_lint: "知识图谱体检",
  kb_query: "知识库问答",
  mkt_skill_eval: "营销技能评测",
  mkt_skill_run: "营销技能执行",
  oa: "OA 单据",
  recruit_job_eval: "职位评估",
  recruit_resume_tailor: "简历定制",
  seo_audit_ai: "SEO 体检解读",
  seo_keyword_ai: "SEO 关键词扩展/聚类",
  seo_competitor_ai: "SEO 竞品差距分析",
  seo_schema_ai: "SEO 结构化数据生成",
  seo_report_ai: "SEO 报告撰写",
  seo_outreach_ai: "SEO 外联草稿",
  seo_programmatic_ai: "SEO 程序化页面",
  skill_review: "技能安全审查",
};

/** 用量事实的板块维度（UsageEvent.module，由调用方在网关入参里声明）。 */
export const AI_MODULE_LABELS: Record<string, string> = {
  ai: "通用 AI",
  bigdata: "多维表格问数",
  bi: "BI 报表",
  content: "内容创作",
  crm: "客户管理",
  data_table: "多维表格",
  geo: "GEO 监测",
  hrm: "人力资源",
  kb: "知识库",
  legal: "法务合规",
  lead_prospecting: "线索挖掘",
  lowcode: "低代码",
  mkt: "营销技能",
  overseas: "出海服务",
  project: "项目任务",
  recruit: "招聘代投",
  rpa: "RPA 自动化",
  seo: "SEO 优化",
  service_desk: "客服工作台",
  skill: "技能中心",
  think_tank: "智库",
  workbuddy: "AI 助手",
};

/** AI 洞察记录的归属板块（AiInsightRecord.scope）。 */
export const INSIGHT_SCOPE_LABELS: Record<string, string> = {
  erp: "进销存",
  project: "项目任务",
  rule: "自动化规则",
};

/** 积分流水场景（PointTransaction.scene）：赚分类场景在此，消耗类场景回落科目名。 */
export const TX_SCENE_LABELS: Record<string, string> = {
  ai_customer: "AI 客服",
  asset_storage: "资产存储",
  oa: "OA 提交",
  admin: "管理员调整",
  gift: "积分赠送",
  invite: "邀请",
  register: "注册",
  service_package: "购买套餐",
  service_package_refund: "套餐退款",
  service_package_rollback: "套餐建单回滚",
};

export function billingSubjectLabel(code: string): string {
  return BILLING_SUBJECT_LABELS[code] || code || "—";
}

export function txSceneLabel(scene: string): string {
  if (!scene) return "—";
  return TX_SCENE_LABELS[scene] || BILLING_SUBJECT_LABELS[scene] || scene;
}

/** 空板块＝改造前落的历史用量行，统一显示为「其他」而不是裸编码。 */
export function aiModuleLabel(module: string): string {
  return AI_MODULE_LABELS[module] || (module ? module : "其他");
}

export function insightScopeLabel(scope: string): string {
  return INSIGHT_SCOPE_LABELS[scope] || scope || "—";
}

/** token 数按千分位显示，积分最多 4 位小数（与积分页同口径）。 */
export function fmtTokens(value: number | null | undefined): string {
  return (Number(value) || 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

export function fmtUsagePoints(value: number | null | undefined): string {
  return (Number(value) || 0).toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}
