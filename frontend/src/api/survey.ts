import {
  apiEnvelope,
  endpoints,
  surveyPublicViewSchema,
  surveySubmitResultSchema,
  type EndpointResponse,
} from "@enterprise/contracts";
import { endpoint } from "./endpoint";
import { http } from "./http";

/** 营销问卷（营销工具）：题目与状态在业务端，回收数据落在问卷自动创建的多维表格里。 */
export type Survey = NonNullable<EndpointResponse<"Survey_detail">["data"]>;
export type SurveyResults = NonNullable<EndpointResponse<"Survey_results">["data"]>;
export type SurveyResultQuestion = SurveyResults["questions"][number];

export const surveyApi = {
  page: endpoint(endpoints.Survey_page),
  detail: endpoint(endpoints.Survey_detail),
  create: endpoint(endpoints.Survey_create),
  update: endpoint(endpoints.Survey_update),
  publish: endpoint(endpoints.Survey_publish),
  close: endpoint(endpoints.Survey_close),
  reopen: endpoint(endpoints.Survey_reopen),
  remove: endpoint(endpoints.Survey_remove),
  results: endpoint(endpoints.Survey_results),
};

/** 公开填写页（免登录）：读取问卷与提交答案，都走 /api/public/survey。 */
export async function fetchPublicSurvey(code: string) {
  const result = await http(
    `/api/public/survey/${encodeURIComponent(code)}`,
    apiEnvelope(surveyPublicViewSchema),
  );
  if (!result.data.data) throw new Error("问卷不存在或尚未发布");
  return result.data.data;
}

export async function submitPublicSurvey(
  code: string,
  answers: Record<string, unknown>,
) {
  const result = await http(
    `/api/public/survey/${encodeURIComponent(code)}`,
    apiEnvelope(surveySubmitResultSchema),
    { method: "POST", body: { answers } },
  );
  if (!result.data.data) throw new Error("提交接口没有返回结果");
  return result.data.data;
}
