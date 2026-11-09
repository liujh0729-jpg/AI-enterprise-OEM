import {
  endpoints,
  type EndpointResponse,
} from "@enterprise/contracts";
import { endpoint } from "./endpoint";

/**
 * 点状 AI（§10 P2-B）：通用能力 + 各模块点。
 * 所有接口在模型不可用时返回规则式结论（mode=rule/retrieval），前端按同一结构渲染。
 */
export type AiSummarize = EndpointResponse<"Ai_summarize">["data"];
export type AiExtract = EndpointResponse<"Ai_extract">["data"];
export type AiClassify = EndpointResponse<"Ai_classify">["data"];
export type AiScore = EndpointResponse<"Ai_score">["data"];
export type AiAsk = EndpointResponse<"Ai_ask">["data"];
export type AiCrmLeadScore = EndpointResponse<"Ai_crmLeadScore">["data"];
export type AiOkrCheckKr = EndpointResponse<"Ai_okrCheckKr">["data"];
export type AiOkrProgressSummary = EndpointResponse<"Ai_okrProgressSummary">["data"];
export type AiProjectStandup = EndpointResponse<"Ai_projectStandup">["data"];
export type AiProjectSplit = EndpointResponse<"Ai_projectSplitTask">["data"];
export type AiSurveyReport = EndpointResponse<"Ai_surveyReport">["data"];
export type AiDistributionRewrite = EndpointResponse<"Ai_distributionRewrite">["data"];
export type AiMailboxAnalyze = EndpointResponse<"Ai_mailboxAnalyze">["data"];
export type AiHrmAttrition = EndpointResponse<"Ai_hrmAttrition">["data"];
export type AiLegalReview = EndpointResponse<"Ai_legalReview">["data"];
export type AiOverseasCheck = EndpointResponse<"Ai_overseasCheck">["data"];
export type AiInvoiceExtract = EndpointResponse<"Ai_invoiceExtract">["data"];
export type AiTaxCheck = EndpointResponse<"Ai_taxCheck">["data"];
export type AiSocialCompose = EndpointResponse<"Ai_socialCompose">["data"];
export type AiOaDraft = EndpointResponse<"Ai_oaDraftApplication">["data"];

export const aiApi = {
  summarize: endpoint(endpoints.Ai_summarize),
  extract: endpoint(endpoints.Ai_extract),
  classify: endpoint(endpoints.Ai_classify),
  score: endpoint(endpoints.Ai_score),
  ask: endpoint(endpoints.Ai_ask),
  crmLeadScore: endpoint(endpoints.Ai_crmLeadScore),
  okrCheckKr: endpoint(endpoints.Ai_okrCheckKr),
  okrProgressSummary: endpoint(endpoints.Ai_okrProgressSummary),
  projectStandup: endpoint(endpoints.Ai_projectStandup),
  projectSplitTask: endpoint(endpoints.Ai_projectSplitTask),
  surveyReport: endpoint(endpoints.Ai_surveyReport),
  distributionRewrite: endpoint(endpoints.Ai_distributionRewrite),
  mailboxAnalyze: endpoint(endpoints.Ai_mailboxAnalyze),
  hrmAttrition: endpoint(endpoints.Ai_hrmAttrition),
  legalReview: endpoint(endpoints.Ai_legalReview),
  overseasCheck: endpoint(endpoints.Ai_overseasCheck),
  invoiceExtract: endpoint(endpoints.Ai_invoiceExtract),
  taxCheck: endpoint(endpoints.Ai_taxCheck),
  socialCompose: endpoint(endpoints.Ai_socialCompose),
  oaDraftApplication: endpoint(endpoints.Ai_oaDraftApplication),
};
