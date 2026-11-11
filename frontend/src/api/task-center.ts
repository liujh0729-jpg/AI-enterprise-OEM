import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

/** 统一任务中心「我的任务」：各业务模块待办的集合视图（只读聚合 + 关闭 / 重开）。 */
export const taskCenterApi = {
  list: endpoint(endpoints.MyTask_list),
  get: endpoint(endpoints.MyTask_get),
  summary: endpoint(endpoints.MyTask_summary),
  close: endpoint(endpoints.MyTask_close),
  submitForm: endpoint(endpoints.MyTask_submitForm),
  reopen: endpoint(endpoints.MyTask_reopen),
};
