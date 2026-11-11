import type {
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from "@enterprise/contracts";

/**
 * 内置配方模板（设计方案 P2-2 / §七 配方 1·4·5·7·8）。
 * 只用内置节点（触发 / 逻辑 / 人工），不依赖任何外部动作，复制后即可试跑：
 *   - 收件人默认 `{{actor.userId}}`（运行发起人本人），可在画布里改成具体账号；
 *   - 业务字段取自 `{{input.*}}`，每个模板附 `sampleInput` 供 Playground 粘贴；
 *   - 入参留空也能跑通（标题带固定前缀、条件缺省走 false 分支），不会报错。
 * 模板经 `Workflow_create.graph` 直接落库，无需新增接口。
 */
export type WorkflowTemplate = {
  key: string;
  name: string;
  description: string;
  graph: WorkflowGraph;
  /** 试跑示例入参：粘进编辑器 Playground 即可看到有意义的产出。 */
  sampleInput: Record<string, unknown>;
};

/** 节点构造助手：补齐契约默认字段，模板只写差异部分。 */
function node(
  id: string,
  type: string,
  kind: string,
  name: string,
  config: Record<string, unknown>,
  x: number,
  y: number,
): WorkflowNode {
  return {
    id,
    type,
    kind,
    name,
    operationId: "",
    params: {},
    position: { x, y },
    config,
  };
}

/** 连线构造助手：`sourceHandle` 用于条件分支的 true / false 出边。 */
function edge(
  id: string,
  source: string,
  target: string,
  sourceHandle = "",
): WorkflowEdge {
  return { id, source, target, sourceHandle, targetHandle: "", mapping: {} };
}

const ASSIGNEE = "{{actor.userId}}";

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: "acquisition-followup",
    name: "获客跟进",
    description:
      "获客线索创建后按意向评分分流：≥60 分自动建跟进任务派给本人，低分不打扰。对应配方 1。",
    sampleInput: {
      payload: {
        leadId: 1001,
        platform: "小红书",
        intentScore: 82,
        intentLevel: "HIGH",
      },
    },
    graph: {
      nodes: [
        node(
          "t1",
          "trigger",
          "trigger.event",
          "获客线索创建",
          { event: "acquisition.lead.created" },
          0,
          0,
        ),
        node(
          "c1",
          "logic",
          "logic.condition",
          "意向评分 ≥ 60",
          { path: "input.payload.intentScore", operator: "gte", value: 60 },
          0,
          150,
        ),
        node(
          "a1",
          "human",
          "human.assign_task",
          "建跟进任务",
          {
            assignee: ASSIGNEE,
            title: "跟进获客线索 #{{input.payload.leadId}}",
            description:
              "来源平台：{{input.payload.platform}}；意向等级：{{input.payload.intentLevel}}。请尽快建联并记录跟进结果。",
            link: "/marketing-tools",
            category: "task",
            priority: "HIGH",
            dueDays: 1,
          },
          0,
          300,
        ),
      ],
      edges: [edge("e1", "t1", "c1"), edge("e2", "c1", "a1", "true")],
    },
  },
  {
    key: "contract-renewal",
    name: "合同续约",
    description:
      "每日 09:00 巡检到期合同，生成续约确认任务派给本人（7 天内办结）。对应配方 4。",
    sampleInput: { customer: "示例科技有限公司", contractNo: "HT-2026-0001" },
    graph: {
      nodes: [
        node(
          "t1",
          "trigger",
          "trigger.schedule",
          "每日 09:00 巡检",
          { cron: "0 9 * * *" },
          0,
          0,
        ),
        node(
          "a1",
          "human",
          "human.assign_task",
          "生成续约确认任务",
          {
            assignee: ASSIGNEE,
            title: "续约确认：{{input.customer}}",
            description:
              "合同即将到期，请确认续约意向并生成续约包。合同编号：{{input.contractNo}}。",
            link: "/contracts",
            category: "approval",
            priority: "NORMAL",
            dueDays: 7,
          },
          0,
          150,
        ),
      ],
      edges: [edge("e1", "t1", "a1")],
    },
  },
  {
    key: "payment-collection",
    name: "回款催办",
    description:
      "工作日 10:00 巡检逾期回款，按逾期天数分级：>30 天升级主管（URGENT），否则常规催收。对应配方 5。",
    sampleInput: {
      customer: "示例科技有限公司",
      overdueDays: 45,
      amount: 120000,
    },
    graph: {
      nodes: [
        node(
          "t1",
          "trigger",
          "trigger.schedule",
          "工作日 10:00 巡检",
          { cron: "0 10 * * 1-5" },
          0,
          0,
        ),
        node(
          "c1",
          "logic",
          "logic.condition",
          "逾期 > 30 天",
          { path: "input.overdueDays", operator: "gt", value: 30 },
          0,
          150,
        ),
        node(
          "a1",
          "human",
          "human.assign_task",
          "升级主管催收",
          {
            assignee: ASSIGNEE,
            title: "催收升级：{{input.customer}}（逾期 {{input.overdueDays}} 天）",
            description:
              "逾期超过 30 天，升级主管介入。应收金额：{{input.amount}}。",
            link: "/crm",
            category: "matter",
            priority: "URGENT",
            dueDays: 1,
          },
          -240,
          300,
        ),
        node(
          "a2",
          "human",
          "human.assign_task",
          "常规催收",
          {
            assignee: ASSIGNEE,
            title: "催收：{{input.customer}}（逾期 {{input.overdueDays}} 天）",
            description: "请跟进回款。应收金额：{{input.amount}}。",
            link: "/crm",
            category: "matter",
            priority: "NORMAL",
            dueDays: 3,
          },
          240,
          300,
        ),
      ],
      edges: [
        edge("e1", "t1", "c1"),
        edge("e2", "c1", "a1", "true"),
        edge("e3", "c1", "a2", "false"),
      ],
    },
  },
  {
    key: "ticket-qa",
    name: "工单质检",
    description:
      "手动发起工单满意度回填：派发结构化表单到「我的任务」，挂起等待本人提交后继续。对应配方 7。",
    sampleInput: { ticketId: "GD-2026-0001" },
    graph: {
      nodes: [
        node("t1", "trigger", "trigger.manual", "手动发起质检", {}, 0, 0),
        node(
          "f1",
          "human",
          "human.form",
          "派发满意度表单",
          {
            assignee: ASSIGNEE,
            title: "工单满意度回填",
            fields: [
              { key: "satisfaction", label: "满意度（1-5）", required: true },
              { key: "comment", label: "评价说明", required: false },
            ],
          },
          0,
          150,
        ),
        node(
          "w1",
          "human",
          "human.wait_task",
          "等待回填完成",
          { node: "f1" },
          0,
          300,
        ),
      ],
      edges: [edge("e1", "t1", "f1"), edge("e2", "f1", "w1")],
    },
  },
  {
    key: "onboarding-provision",
    name: "入职开通",
    description:
      "入职进件确认后并行生成开通清单：账号开通 + 权限与资产，两路汇合后结束。对应配方 8。",
    sampleInput: {
      payload: {
        applicationId: 2001,
        jobId: 12,
        jobTitle: "前端工程师",
        company: "示例科技有限公司",
      },
    },
    graph: {
      nodes: [
        node(
          "t1",
          "trigger",
          "trigger.event",
          "入职进件确认",
          { event: "recruit.application.confirmed" },
          0,
          0,
        ),
        node("p1", "logic", "logic.parallel", "并行开通", {}, 0, 150),
        node(
          "a1",
          "human",
          "human.assign_task",
          "账号开通",
          {
            assignee: ASSIGNEE,
            title: "开通账号：{{input.payload.company}} · {{input.payload.jobTitle}}",
            description:
              "为新员工开通系统账号与邮箱。申请编号：{{input.payload.applicationId}}。",
            link: "/hrm",
            category: "task",
            priority: "HIGH",
            dueDays: 1,
          },
          -240,
          300,
        ),
        node(
          "a2",
          "human",
          "human.assign_task",
          "权限与资产",
          {
            assignee: ASSIGNEE,
            title: "权限与资产：{{input.payload.company}} · {{input.payload.jobTitle}}",
            description:
              "按岗位分配系统权限并领用资产。申请编号：{{input.payload.applicationId}}。",
            link: "/hrm",
            category: "task",
            priority: "NORMAL",
            dueDays: 2,
          },
          240,
          300,
        ),
        node("m1", "logic", "logic.merge", "汇合开通结果", {}, 0, 450),
      ],
      edges: [
        edge("e1", "t1", "p1"),
        edge("e2", "p1", "a1"),
        edge("e3", "p1", "a2"),
        edge("e4", "a1", "m1"),
        edge("e5", "a2", "m1"),
      ],
    },
  },
];