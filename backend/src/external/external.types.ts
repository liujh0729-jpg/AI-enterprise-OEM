export type ExternalBizType = 'TAX' | 'CUSTOMS';
export type ExternalRefType =
  'TAX_DECLARATION' | 'EXPORT_REFUND' | 'CUSTOMS_DECL';
export const SUBMISSION_STATUS = {
  QUEUED: '待报送',
  SUBMITTING: '报送中',
  ACCEPTED: '已受理',
  RECEIPT: '已取得回执',
  PAID: '已完税',
  REJECTED: '已退回',
  CANCELLED: '已作废',
} as const;
export type SubmissionStatus = keyof typeof SUBMISSION_STATUS;
/** 外报任务（通道的输入）：报文已生成，通道只负责"送出去"。 */
export type ExternalTask = {
  refType: ExternalRefType;
  refId: number;
  refNo: string;
  enterpriseId: number;
  enterpriseName: string;
  uscc: string;
  taxType: string;
  taxTypeLabel: string;
  period: string;
  taxAmount: number;
  payload: Record<string, unknown>;
  payloadHash: string;
};
export type GuideField = {
  key: string;
  label: string;
  required: boolean;
};
/** 人工通道作业指引：告诉承办人「去哪个系统、用什么账号、报什么、回填什么」。 */
export type ExternalGuide = {
  system: string;
  entry: string;
  credential: string;
  steps: string[];
  fields: GuideField[];
  notice: string;
};
export type ChannelSubmitResult = {
  status: SubmissionStatus;
  acceptNo: string;
  message: string;
};
/**
 * 通道适配层：业务代码只依赖此接口，人工 / 持牌服务商 / 直连通道实现可互换。
 */
export interface ExternalChannel {
  readonly code: string;
  readonly name: string;
  readonly bizType: ExternalBizType;
  readonly targetSystem: string;
  submit(task: ExternalTask): Promise<ChannelSubmitResult>;
  queryReceipt(
    task: ExternalTask,
    acceptNo: string,
  ): Promise<ChannelSubmitResult>;
  cancel(task: ExternalTask, acceptNo: string): Promise<void>;
}
