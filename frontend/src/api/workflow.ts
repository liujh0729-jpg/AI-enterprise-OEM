import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

/** 工作流：可视化编排（列表 / 编辑 / 发布 / 试跑）。 */
export const workflowApi = {
  list: endpoint(endpoints.Workflow_list),
  create: endpoint(endpoints.Workflow_create),
  catalog: endpoint(endpoints.Workflow_catalog),
  // AI 搭建是「一轮对话产一张图」，给模型留足生成时间，别套默认 30 秒超时。
  aiBuild: endpoint(endpoints.Workflow_aiBuild, { timeoutMs: 150000 }),
  detail: endpoint(endpoints.Workflow_detail),
  save: endpoint(endpoints.Workflow_save),
  remove: endpoint(endpoints.Workflow_remove),
  publish: endpoint(endpoints.Workflow_publish),
  duplicate: endpoint(endpoints.Workflow_duplicate),
  run: endpoint(endpoints.Workflow_run),
  runDetail: endpoint(endpoints.Workflow_runDetail),
  runList: endpoint(endpoints.Workflow_runList),
  runCancel: endpoint(endpoints.Workflow_runCancel),
};
