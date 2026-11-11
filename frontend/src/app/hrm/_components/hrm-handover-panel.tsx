"use client";

import { Button, Checkbox, Input, Modal, Select, Space, Table, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { HrmHandover } from "@/api/hrm";
import { hrmApi } from "@/api/hrm";
import { orgStaffApi } from "@/api/collab";
import { Panel } from "@/components/ui/panel";
import { PROFILE_STATUS_LABELS, hrmError } from "./hrm-common";

type TransferableKey = "customers" | "projects" | "projectMembers";

/** 离职交接：清单只读汇总 + 客户/项目/项目成员改派；任务与审批需在各自模块逐条处理。 */
export function HrmHandoverPanel({
  memberUserId,
  memberName,
  onClosed,
}: {
  memberUserId: string | null;
  memberName: string;
  onClosed: () => void;
}) {
  const [plan, setPlan] = useState<HrmHandover | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [staff, setStaff] = useState<{ memberUserId: string; memberName: string }[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [toUserId, setToUserId] = useState("");
  const [picked, setPicked] = useState<TransferableKey[]>([
    "customers",
    "projects",
    "projectMembers",
  ]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!memberUserId) {
      setPlan(null);
      return;
    }
    setLoading(true);
    try {
      setPlan(await hrmApi.handoverChecklist({ query: { memberUserId } }));
      setError("");
    } catch (err) {
      setError(hrmError(err));
    } finally {
      setLoading(false);
    }
  }, [memberUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void orgStaffApi
      .workspace({ query: {} })
      .then((data) =>
        setStaff(
          (data?.staff || [])
            .filter((row) => row.status !== "REMOVED")
            .map((row) => ({ memberUserId: row.memberUserId, memberName: row.memberUserId })),
        ),
      )
      .catch(() => undefined);
  }, []);

  const openTransfer = () => {
    setToUserId("");
    setPicked(["customers", "projects", "projectMembers"]);
    setNote("");
    setTransferOpen(true);
  };

  const submit = async () => {
    if (!memberUserId) return;
    if (!toUserId) return;
    setBusy(true);
    try {
      const result = await hrmApi.transferHandover({
        body: {
          memberUserId,
          toUserId,
          assets: picked,
          note: note.trim(),
        },
      });
      Modal.success({
        title: "移交完成",
        content: `已把 ${result?.total ?? 0} 项改派给 ${result?.name || toUserId}，接手人已收到交接任务。`,
      });
      setTransferOpen(false);
      await load();
      onClosed();
    } catch (err) {
      Modal.error({ title: "移交失败", content: hrmError(err) });
    } finally {
      setBusy(false);
    }
  };

  const transferable = (plan?.assets || []).filter((item) => item.transferable);

  return (
    <Panel
      title={`离职交接${memberName ? ` · ${memberName}` : ""}`}
      titleExtra={
        <span className="muted text-12">
          客户、负责项目、参与项目可在平台一次改派；任务与在途审批需在对应模块逐条处理
        </span>
      }
      extra={
        memberUserId ? (
          <Button
            type="primary"
            disabled={!transferable.length}
            onClick={openTransfer}
          >
            移交资产
          </Button>
        ) : undefined
      }
    >
      {error ? (
        <div className="muted" style={{ color: "#cf1322", marginBottom: 8 }}>
          {error}
        </div>
      ) : null}
      {!memberUserId ? (
        <div className="muted text-12">在员工档案列表点「离职交接」查看清单。</div>
      ) : (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Space size={8} wrap>
            <span className="muted text-12">
              档案状态：{PROFILE_STATUS_LABELS[plan?.profileStatus || ""] || "无档案"}
            </span>
            <Tag color={plan?.closable ? "green" : "gold"}>
              {plan?.closable ? "可结案" : "待交接清零"}
            </Tag>
          </Space>
          <Table
            rowKey="key"
            size="small"
            loading={loading}
            pagination={false}
            dataSource={plan?.checklist || []}
            columns={[
              { title: "检查项", dataIndex: "label", width: 160 },
              {
                title: "未清零",
                dataIndex: "pending",
                width: 100,
                render: (value: number) =>
                  value ? <Tag color="red">{value}</Tag> : <Tag color="green">已清零</Tag>,
              },
            ]}
          />
          <Table
            rowKey="key"
            size="small"
            pagination={false}
            dataSource={plan?.assets || []}
            locale={{ emptyText: "身上没有待交接资产" }}
            columns={[
              { title: "资产", dataIndex: "label", width: 140 },
              { title: "数量", dataIndex: "count", width: 80 },
              {
                title: "明细",
                dataIndex: "items",
                render: (_: unknown, row: { items: { id: string; name: string; link: string }[] }) =>
                  row.items.length ? (
                    <Space size={4} wrap>
                      {row.items.slice(0, 8).map((item) => (
                        <a key={item.id} href={item.link} target="_blank" rel="noreferrer">
                          {item.name}
                        </a>
                      ))}
                      {row.items.length > 8 ? (
                        <span className="muted text-12">+{row.items.length - 8}</span>
                      ) : null}
                    </Space>
                  ) : (
                    "—"
                  ),
              },
              {
                title: "处理方式",
                dataIndex: "transferable",
                width: 120,
                render: (value: boolean) => (
                  <Tag color={value ? "blue" : "default"}>
                    {value ? "可批量改派" : "逐条处理"}
                  </Tag>
                ),
              },
            ]}
          />
        </Space>
      )}
      <Modal
        title="移交资产"
        open={transferOpen}
        onCancel={() => setTransferOpen(false)}
        onOk={() => void submit()}
        okText="确认移交"
        confirmLoading={busy}
        destroyOnHidden
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Select
            style={{ width: "100%" }}
            value={toUserId || undefined}
            placeholder="选择接手人"
            onChange={setToUserId}
            options={staff
              .filter((item) => item.memberUserId !== memberUserId)
              .map((item) => ({ value: item.memberUserId, label: item.memberName }))}
          />
          <Checkbox.Group
            value={picked}
            onChange={(values) => setPicked(values as TransferableKey[])}
            options={transferable.map((item) => ({
              value: item.key,
              label: `${item.label}（${item.count}）`,
            }))}
          />
          <Input.TextArea
            value={note}
            autoSize={{ minRows: 2, maxRows: 4 }}
            placeholder="交接说明（选填，会写进接手人的交接任务）"
            onChange={(event) => setNote(event.target.value)}
          />
        </Space>
      </Modal>
    </Panel>
  );
}
