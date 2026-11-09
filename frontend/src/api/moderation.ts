import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

/**
 * 发布审核 API（阿里云内容安全）：
 * 配置只回掩码；测试用已保存凭据；台账只记拦截 / 待复核 / 调用失败。
 */
export type PublishReviewSettings = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"PublishReview_settings">["data"]
>;

export type PublishReviewLog = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"PublishReview_logs">["data"]
>["list"][number];

export type PublishReviewTestResult = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"PublishReview_test">["data"]
>;

export const publishReviewApi = {
  view: endpoint(endpoints.PublishReview_settings),
  save: endpoint(endpoints.PublishReview_save),
  test: endpoint(endpoints.PublishReview_test),
  logs: endpoint(endpoints.PublishReview_logs),
};
