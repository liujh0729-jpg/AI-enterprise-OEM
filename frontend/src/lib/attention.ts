/**
 * 驾驶舱「待我处理」的唯一口径：任务中心 `summary.bySource`。
 * 每个源只给一个入口，件数大于 0 才显示；明细在对应模块处理，驾驶舱不另算一套。
 */
export type AttentionRow = {
  key: string;
  label: string;
  hint: string;
  count: number;
  to: string;
};

type AttentionSource = Omit<AttentionRow, "count">;

export const ATTENTION_SOURCES: AttentionSource[] = [
  { key: "desk", label: "官网咨询待回复", hint: "分配给我的访客会话与待接入会话", to: "/service-desk" },
  { key: "oa", label: "OA 待我审批", hint: "流程里等我处理的单据", to: "/oa?tab=todo" },
  { key: "crm", label: "CRM 待办", hint: "合同、报价、发票审批与逾期回款", to: "/crm" },
  { key: "okr", label: "OKR 待办", hint: "待承接目标、待填汇报、待打分与逾期计划", to: "/okr" },
  { key: "pj", label: "项目任务", hint: "项目里分配给我的未完成任务", to: "/project" },
  { key: "workflow", label: "工作流待办", hint: "等我确认、填写或办理的流程节点", to: "/tasks" },
  { key: "contract", label: "待确认签约", hint: "等待我确认签约的服务商", to: "/contracts" },
  { key: "platform", label: "平台待审核", hint: "服务商备案与社区内容", to: "/admin/provider-applications" },
];

/** 按展示顺序展开有件数的源；未知来源不进驾驶舱（避免出现没入口的计数）。 */
export function attentionFromSources(
  bySource: { key: string; count: number }[],
): AttentionRow[] {
  const counts = new Map(bySource.map((item) => [item.key, item.count]));
  return ATTENTION_SOURCES.flatMap((item) => {
    const count = counts.get(item.key) ?? 0;
    return count > 0 ? [{ ...item, count }] : [];
  });
}
