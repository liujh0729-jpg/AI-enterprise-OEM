"use client";

import { Button, Modal, Select, Space, Table, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import { orgStaffApi } from "@/api/collab";
import { growthApi } from "@/api/growth";
import { EmptyState, Panel } from "@/components/ui/panel";

type Advice = Awaited<ReturnType<typeof growthApi.fulfillmentAdvice>>;
type AdviceItem = NonNullable<Advice>["items"][number];
type Workspace = Awaited<ReturnType<typeof orgStaffApi.workspace>>;
type Staff = NonNullable<Workspace>["staff"][number];

const GAP_COLOR: Record<string, string> = {
  SIGNED: "gold",
  DELIVERED: "blue",
  ACCEPTED: "geekblue",
  SETTLED: "orange",
  DONE: "green",
};

const amount = (value: string) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "—";
  if (Math.abs(num) >= 10000) return `¥${(num / 10000).toFixed(1)}万`;
  return `¥${num.toFixed(0)}`;
};

/**
 * 合同履约助手：读四态聚合事实给出卡点与下一步动作，
 * 勾选后把未闭环合同派成履约任务（任务中心同一派单口）。
 */
export function FulfillmentAdvisorPanel() {
  const [advice, setAdvice] = useState<Advice>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [assignee, setAssignee] = useState("");
  const [staff, setStaff] = useState<Staff[]>([]);
  const [dispatching, setDispatching] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const next = await growthApi.fulfillmentAdvice({ query: { days: 90 } });
      setAdvice(next);
      setError("");
      setPicked([]);
    } catch (loadError) {
      setError((loadError as Error).message || "履约建议加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDispatch = async () => {
    if (!picked.length) {
      window.alert("先勾选要派单的合同");
      return;
    }
    setDispatchOpen(true);
    if (staff.length) return;
    try {
      const workspace = await orgStaffApi.workspace();
      setStaff((workspace?.staff || []).filter((item) => item.status === "ACTIVE"));
    } catch {
      setStaff([]);
    }
  };

  const submit = async () => {
    try {
      setDispatching(true);
      const result = await growthApi.dispatchFulfillment({
        body: { contractIds: picked, assigneeUserId: assignee, note: "" },
      });
      setDispatchOpen(false);
      setPicked([]);
      window.alert(
        `已派发 ${result?.created ?? 0} 条履约任务${
          result?.skipped ? `，${result.skipped} 条已闭环被跳过` : ""
        }。`,
      );
    } catch (dispatchError) {
      window.alert((dispatchError as Error).message || "派单失败");
    } finally {
      setDispatching(false);
    }
  };

  const rows = advice?.items || [];

  return (
    <Panel
      title="合同履约助手"
      titleExtra={
        <span className="muted text-12">
          按四态口径找卡点并给出下一步；结论来自
          {advice?.source === "AI" ? `模型 ${advice.model || ""}` : "规则式兜底"}
          ，只读业务数据
        </span>
      }
      extra={
        <Space size={8}>
          <Button loading={loading} onClick={() => void load()}>
            重新分析
          </Button>
          <Button type="primary" onClick={() => void openDispatch()}>
            派履约任务
          </Button>
        </Space>
      }
    >
      {error ? (
        <EmptyState text={`履约助手暂不可用：${error}`} />
      ) : rows.length ? (
        <>
          <div style={{ marginBottom: 12 }}>
            <strong>{advice?.headline}</strong>
            <div className="muted text-12">
              未闭环 {advice?.openCount ?? 0} 份 · 生成于{" "}
              {advice ? new Date(advice.generatedAt).toLocaleString() : "—"}
            </div>
          </div>
          <Table
            rowKey="contractId"
            size="small"
            dataSource={rows}
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            rowSelection={{
              selectedRowKeys: picked,
              onChange: (keys) => setPicked(keys.map((key) => Number(key))),
            }}
            columns={[
              {
                title: "合同",
                dataIndex: "contractName",
                render: (value: string, row: AdviceItem) => (
                  <div>
                    <div>{value}</div>
                    <div className="muted text-12">
                      {row.customerName} · {amount(row.amount)}
                    </div>
                  </div>
                ),
              },
              {
                title: "卡点",
                dataIndex: "gapLabel",
                width: 100,
                render: (value: string, row: AdviceItem) => (
                  <Tag color={GAP_COLOR[row.gap] || "default"}>{value}</Tag>
                ),
              },
              {
                title: "原因",
                dataIndex: "risk",
                render: (value: string) => (
                  <span className="text-12">{value}</span>
                ),
              },
              {
                title: "下一步",
                dataIndex: "action",
                render: (value: string, row: AdviceItem) => (
                  <div>
                    <div className="text-12">{value}</div>
                    <div className="muted text-12">{row.ownerRole}</div>
                  </div>
                ),
              },
            ]}
          />
        </>
      ) : (
        <EmptyState text="窗口内合同都已闭环，暂无履约建议" />
      )}

      <Modal
        title="派履约任务"
        open={dispatchOpen}
        onCancel={() => setDispatchOpen(false)}
        onOk={() => void submit()}
        okText="派单"
        confirmLoading={dispatching}
        destroyOnHidden
      >
        <div className="muted text-12" style={{ marginBottom: 12 }}>
          将为选中的 {picked.length} 份未闭环合同各派一条跟进任务，同一合同重复派发只保留一条。
        </div>
        <Select
          style={{ width: "100%" }}
          placeholder="不选则进入机构队列，由负责人改派"
          allowClear
          value={assignee || undefined}
          onChange={(value) => setAssignee(String(value || ""))}
          options={staff.map((item) => ({
            value: item.memberUserId,
            label: item.realName || item.memberUserId,
          }))}
          showSearch
          optionFilterProp="label"
        />
      </Modal>
    </Panel>
  );
}
