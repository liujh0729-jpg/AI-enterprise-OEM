export type BadgeVariant = "green" | "orange" | "red" | "sky" | "blue" | "gray";

export type StatusSpec = { label: string; variant: BadgeVariant };

/** 对齐 demo/public/assets/js/ui.js 的 Ui.badge 全局映射。 */
export const GLOBAL_STATUS: Record<string, StatusSpec> = {
  ACTIVE: { label: "生效中", variant: "green" },
  APPROVED: { label: "已通过", variant: "green" },
  PENDING: { label: "待审核", variant: "orange" },
  REJECTED: { label: "已驳回", variant: "red" },
  FROZEN: { label: "已冻结", variant: "red" },
  PASSED: { label: "复核通过", variant: "green" },
  IN_PROGRESS: { label: "服务中", variant: "sky" },
  TERMINATED: { label: "已解约", variant: "gray" },
  VOID: { label: "已作废", variant: "gray" },
  EXPIRED: { label: "已到期", variant: "gray" },
  DRAFT: { label: "草稿", variant: "gray" },
  PAID: { label: "已完成扣款", variant: "green" },
  CLOSED: { label: "已办结", variant: "green" },
  REPLIED: { label: "已回复", variant: "green" },
  MATCHING: { label: "匹配中", variant: "blue" },
  ARCHIVED: { label: "已归档", variant: "gray" },
  CANCELLED: { label: "已注销", variant: "gray" },
  DELISTED: { label: "已停用", variant: "gray" },
  HIDDEN: { label: "已隐藏", variant: "gray" },
  REVOKED: { label: "已吊销", variant: "gray" },
};

/** 各板块自己的状态文案（覆盖全局同名状态）。 */
export const DOMAIN_STATUS: Record<string, Record<string, StatusSpec>> = {
  contract: {
    PENDING: { label: "待确认", variant: "orange" },
    ACTIVE: { label: "生效中", variant: "green" },
    EXPIRED: { label: "已到期", variant: "gray" },
    TERMINATED: { label: "已解约", variant: "gray" },
    VOID: { label: "已作废", variant: "gray" },
  },
  logistics: {
    OPEN: { label: "已发布 · 待接收", variant: "orange" },
    PENDING: { label: "待揽收", variant: "blue" },
    IN_TRANSIT: { label: "运输中", variant: "sky" },
    DELIVERED: { label: "已签收", variant: "green" },
    EXCEPTION: { label: "异常", variant: "red" },
  },
  /** IT服务（AI 实施 / 软件开发 / 算力 / 硬件 / 数据）：发布 → 接收 → 进行中 → 交付。 */
  smart: {
    OPEN: { label: "已发布 · 待接收", variant: "orange" },
    PENDING: { label: "已接收 · 待开工", variant: "blue" },
    IN_PROGRESS: { label: "实施中", variant: "sky" },
    DELIVERED: { label: "已交付", variant: "green" },
    EXCEPTION: { label: "异常", variant: "red" },
  },
  /** 资产交易（资产租售与居间服务）：发布 → 接收 → 约看勘查 → 成交。 */
  asset: {
    OPEN: { label: "已发布 · 待接收", variant: "orange" },
    PENDING: { label: "已接收 · 待对接", variant: "blue" },
    VIEWING: { label: "约看勘查中", variant: "sky" },
    DEAL: { label: "已成交", variant: "green" },
    EXCEPTION: { label: "异常", variant: "red" },
  },
  marketing: {
    OPEN: { label: "已发布 · 待对接", variant: "orange" },
    MATCHED: { label: "已匹配 · 对接中", variant: "blue" },
    CONNECTED: { label: "已对接", variant: "sky" },
    DONE: { label: "已完成", variant: "green" },
  },
  overseas: {
    SUBMITTED: { label: "已提交", variant: "blue" },
    IN_REVIEW: { label: "办理中", variant: "sky" },
    APPROVED: { label: "审核通过 · 待退税", variant: "orange" },
    REFUNDED: { label: "已退税到账", variant: "green" },
    REJECTED: { label: "已退回", variant: "red" },
  },
  taxMaterial: {
    DRAFT: { label: "材料准备中", variant: "gray" },
    SUBMITTED: { label: "已提交", variant: "blue" },
    ANALYZED: { label: "AI 分析完成 · 待提报", variant: "orange" },
    PROCESSING: { label: "分类提报中", variant: "sky" },
    DONE: { label: "已完成", variant: "green" },
  },
  taxPlan: {
    DUE: { label: "待申报", variant: "orange" },
    IN_PROGRESS: { label: "申报中", variant: "sky" },
    DONE: { label: "已完成", variant: "green" },
  },
  taxDeclaration: {
    DRAFT: { label: "草稿填写", variant: "gray" },
    SUBMITTED: { label: "AI处理完成 · 待财务专员确认", variant: "sky" },
    CHECKING: { label: "待财务专员审核", variant: "blue" },
    FILED: { label: "已申报", variant: "orange" },
    PAID: { label: "已完成扣款", variant: "green" },
    REJECTED: { label: "已驳回", variant: "red" },
  },
  onboarding: {
    SUBMITTED: { label: "待审核", variant: "sky" },
    APPROVED: { label: "已通过", variant: "green" },
    REJECTED: { label: "已驳回", variant: "gray" },
  },
  workOrder: {
    OPEN: { label: "已发布 · 待匹配", variant: "orange" },
    MATCHING: { label: "匹配中", variant: "blue" },
    IN_PROGRESS: { label: "交付中", variant: "sky" },
    CLOSED: { label: "已办结", variant: "green" },
  },
  /** 招聘需求候选人阶段（需求 5.6.3：候选人推荐、面试/到岗安排）。 */
  candidate: {
    RECOMMENDED: { label: "已推荐", variant: "blue" },
    INTERVIEW: { label: "面试中", variant: "sky" },
    HIRED: { label: "已到岗", variant: "green" },
    REJECTED: { label: "未通过", variant: "red" },
  },
  payroll: {
    PENDING: { label: "待审核", variant: "orange" },
    APPROVED: { label: "已通过", variant: "green" },
    REJECTED: { label: "已驳回", variant: "red" },
  },
  affiliation: {
    PENDING: { label: "待审批", variant: "orange" },
    APPROVED: { label: "已通过", variant: "green" },
    REJECTED: { label: "已驳回", variant: "gray" },
  },
  taxpayer: {
    GENERAL: { label: "一般纳税人", variant: "blue" },
    SMALL_SCALE: { label: "小规模纳税人", variant: "green" },
  },
  /** 外报任务状态（申报单 → 电子税务局 / 单一窗口 报送回执状态机）。 */
  external: {
    QUEUED: { label: "待报送", variant: "orange" },
    SUBMITTING: { label: "报送中", variant: "blue" },
    ACCEPTED: { label: "已受理", variant: "sky" },
    RECEIPT: { label: "已取得回执", variant: "green" },
    PAID: { label: "已完税 · 已扣款", variant: "green" },
    REJECTED: { label: "官方退回", variant: "red" },
    CANCELLED: { label: "已作废", variant: "gray" },
  },
  /** 供销网络：订货单 / 预约单共用状态（对齐后端 SUPPLY_STATUS_LABELS）。 */
  supply: {
    DRAFT: { label: "草稿", variant: "gray" },
    SUBMITTED: { label: "已提交 · 待报价", variant: "orange" },
    QUOTED: { label: "已审核报价 · 待确认", variant: "blue" },
    ACTIVE: { label: "订单生效", variant: "green" },
    RETURNED: { label: "已驳回 · 待重新报价", variant: "red" },
    VETOED: { label: "已否决", variant: "gray" },
    CANCELLED: { label: "已取消", variant: "gray" },
  },
  /** 供销网络：站点 / 商品 / 服务上下架。 */
  supplyListing: {
    ACTIVE: { label: "启用", variant: "green" },
    FROZEN: { label: "停用", variant: "gray" },
    ONLINE: { label: "在售", variant: "green" },
    OFFLINE: { label: "已下架", variant: "gray" },
  },
  /** 工作流状态与运行状态（对齐契约 WORKFLOW_STATUSES / WORKFLOW_RUN_STATUSES）。 */
  workflow: {
    DRAFT: { label: "草稿", variant: "gray" },
    PUBLISHED: { label: "已发布", variant: "green" },
    ARCHIVED: { label: "已归档", variant: "gray" },
  },
  workflowRun: {
    PENDING: { label: "排队中", variant: "orange" },
    RUNNING: { label: "运行中", variant: "blue" },
    WAITING: { label: "等待中", variant: "sky" },
    DONE: { label: "已完成", variant: "green" },
    FAILED: { label: "已失败", variant: "red" },
    CANCELED: { label: "已取消", variant: "gray" },
    SKIPPED: { label: "已跳过", variant: "gray" },
    TIMEOUT: { label: "已超时", variant: "red" },
  },
  /** 供销网络：报价时的缺货情况说明。 */
  supplyStock: {
    SUFFICIENT: { label: "库存充足", variant: "green" },
    PARTIAL: { label: "部分缺货", variant: "orange" },
    SHORTAGE: { label: "缺货", variant: "red" },
  },
  /** 统一任务中心：中心状态机（与业务状态正交，对齐后端 TASK_STATUS_LABELS）。 */
  task: {
    OPEN: { label: "待处理", variant: "orange" },
    DOING: { label: "处理中", variant: "sky" },
    DONE: { label: "已完成", variant: "green" },
    CANCELED: { label: "已取消", variant: "gray" },
    EXPIRED: { label: "已失效", variant: "gray" },
  },
  /** 统一任务中心：优先级（对齐后端 TASK_PRIORITY_LABELS）。 */
  taskPriority: {
    LOW: { label: "低", variant: "gray" },
    NORMAL: { label: "普通", variant: "blue" },
    HIGH: { label: "高", variant: "orange" },
    URGENT: { label: "紧急", variant: "red" },
  },
};

export function resolveStatus(
  domain: string | undefined,
  status: string,
): StatusSpec {
  const scoped = domain ? DOMAIN_STATUS[domain]?.[status] : undefined;
  return (
    scoped ||
    GLOBAL_STATUS[status] || { label: status || "-", variant: "gray" }
  );
}

/** 筛选/表单下拉选项：文案唯一来源是上面的状态映射表，禁止各页再抄一份。 */
export function statusOptions(
  domain: keyof typeof DOMAIN_STATUS,
): { value: string; label: string }[] {
  return Object.entries(DOMAIN_STATUS[domain]).map(([value, spec]) => ({
    value,
    label: spec.label,
  }));
}