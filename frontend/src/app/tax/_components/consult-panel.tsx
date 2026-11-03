"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { taxApi } from "@/api/tax";

import { MessageOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Modal, Select, Space, Table } from "antd";
import { useState } from "react";
import { EmptyState, Panel } from "@/components/ui/panel";

import { canWorkOn } from "@/lib/can-work-on";
import { fmtTime, type ConsultationRow, type ContractRow } from "./common";

/**
 * 财税咨询（签约企业免费）：企业发起、服务商回复（demo tax.js consultPanel）。
 */
export function ConsultPanel({
  rows,
  contracts,
  currentUserId,
  enterpriseId,
  staffOf,
  isAdmin = false,
  canAsk = true,
}: {
  rows: ConsultationRow[];
  contracts: ContractRow[];
  currentUserId: string;
  enterpriseId: number;
  staffOf?: unknown[];
  isAdmin?: boolean;
  canAsk?: boolean;
  reload: () => Promise<void>;
}) {
  const tax_askMutation = useOperationMutation(taxApi.ask, [
    "tax",
    "dashboard",
  ]);
  const tax_replyMutation = useOperationMutation(taxApi.reply, [
    "tax",
    "dashboard",
  ]);

  const { message } = App.useApp();
  const [askOpen, setAskOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [replyRow, setReplyRow] = useState<ConsultationRow | null>(null);
  const [replying, setReplying] = useState(false);
  const [askForm] = Form.useForm();
  const [replyForm] = Form.useForm();

  const activeContracts = contracts.filter(
    (item) =>
      item.status === "ACTIVE" &&
      item.serviceType === "TAX_FINANCE" &&
      Number(item.enterpriseId) === enterpriseId,
  );

  /** 回复权限（对齐后端 identity.canWorkOn）：已指派承办职员时由其回复，服务商账号不代替。 */
  const canReply = (row: ConsultationRow) =>
    isAdmin || canWorkOn({ userId: currentUserId, staffOf }, row);

  const enterpriseNameOf = (id: number) =>
    contracts.find((item) => Number(item.enterpriseId) === Number(id))
      ?.enterpriseName || "—";
  const providerNameOf = (userId: string) => {
    const hit = contracts.find((item) => item.providerUserId === userId);
    return hit?.provider_name || hit?.providerOrg || "—";
  };

  return (
    <>
      <Panel
        title="财税咨询（签约企业免费）"
        titleBadge={`${rows.length} 条`}
        extra={
          canAsk ? (
            <Button type="primary" onClick={() => setAskOpen(true)}>
              发起财税咨询
            </Button>
          ) : undefined
        }
      >
        <div className="table-wrap">
          <Table<ConsultationRow>
            rowKey="id"
            dataSource={rows}
            pagination={false}
            size="middle"
            locale={{
              emptyText: (
                <EmptyState
                  icon={<MessageOutlined aria-hidden />}
                  text="暂无咨询，等待企业发起咨询"
                />
              ),
            }}
            columns={[
              {
                title: "问题",
                dataIndex: "question",
                render: (value: string, row) => (
                  <div>
                    <div>{value}</div>
                    {row.answer ? (
                      <div className="text-12 muted" style={{ marginTop: 4 }}>
                        答：{row.answer}
                      </div>
                    ) : null}
                  </div>
                ),
              },
              {
                title: "企业",
                width: 160,
                render: (_, row) => enterpriseNameOf(row.enterpriseId),
              },
              {
                title: "服务商",
                width: 160,
                render: (_, row) => providerNameOf(row.providerUserId),
              },
              {
                title: "状态",
                width: 100,
                render: (_, row) =>
                  row.status === "REPLIED" ? (
                    <span className="badge badge-green">已回复</span>
                  ) : (
                    <span className="badge badge-orange">待处理</span>
                  ),
              },
              {
                title: "时间",
                dataIndex: "createdAt",
                width: 150,
                render: (value: string) => (
                  <span className="text-12">{fmtTime(value)}</span>
                ),
              },
              {
                title: "操作",
                width: 120,
                render: (_, row) => (
                  <Space size={6} wrap>
                    {row.status === "OPEN" && canReply(row) ? (
                      <Button
                        onClick={() => {
                          replyForm.resetFields();
                          setReplyRow(row);
                        }}
                      >
                        回复
                      </Button>
                    ) : (
                      <span className="text-12 muted">—</span>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        </div>
        <p className="text-12 muted" style={{ marginTop: 10 }}>
          提示：咨询仅对存在生效签约的组合开放；财税法规咨询由已备案的财税服务商提供专业解答。
        </p>
      </Panel>

      <Modal
        open={askOpen}
        title="发起财税咨询"
        width={560}
        okText="提交咨询"
        cancelText="取消"
        confirmLoading={asking}
        onCancel={() => setAskOpen(false)}
        onOk={async () => {
          try {
            if (!activeContracts.length) {
              message.warning("您暂未与任何服务商建立生效签约，无法发起咨询");
              return;
            }
            const values = await askForm.validateFields();
            setAsking(true);
            try {
              await tax_askMutation.mutateAsync({
                body: {
                  question: values.question,
                },
              });

              message.success("咨询已发送");
              setAskOpen(false);
              askForm.resetFields();
            } finally {
              setAsking(false);
            }
          } catch (error) {
            if (error instanceof Error)
              presentMutationError(error, (text) => message.error(text));
          }
        }}
      >
        <Form
          form={askForm}
          layout="vertical"
          initialValues={{ contractId: activeContracts[0]?.id }}
        >
          <Form.Item name="contractId" label="签约服务商">
            <Select
              options={activeContracts.map((item) => ({
                value: item.id,
                label: `${item.providerOrg || item.provider_name || "服务商"} · ${item.contractNo}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="question"
            label="咨询问题"
            rules={[{ required: true, message: "请填写咨询内容" }]}
          >
            <Input.TextArea
              rows={4}
              placeholder="请描述您的问题，如：出口退税申报时限要求？"
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(replyRow)}
        title="回复咨询"
        width={560}
        okText="提交回复"
        cancelText="取消"
        confirmLoading={replying}
        onCancel={() => setReplyRow(null)}
        onOk={async () => {
          try {
            const values = await replyForm.validateFields();
            if (!replyRow) return;
            setReplying(true);
            try {
              await tax_replyMutation.mutateAsync({
                params: { id: String(replyRow.id) },
                body: { answer: values.answer },
              });

              message.success("已回复");
              setReplyRow(null);
              replyForm.resetFields();
            } finally {
              setReplying(false);
            }
          } catch (error) {
            if (error instanceof Error)
              presentMutationError(error, (text) => message.error(text));
          }
        }}
      >
        <div className="text-12 muted" style={{ marginBottom: 8 }}>
          {replyRow
            ? `${enterpriseNameOf(replyRow.enterpriseId)}：${replyRow.question}`
            : ""}
        </div>
        <Form form={replyForm} layout="vertical">
          <Form.Item
            name="answer"
            label="回复内容"
            rules={[{ required: true, message: "回复内容不能为空" }]}
          >
            <Input.TextArea rows={4} placeholder="输入专业解答并附依据…" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
