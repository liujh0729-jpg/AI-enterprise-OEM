"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { identityApi } from "@/api/identity";

import { InboxOutlined } from "@ant-design/icons";
import { App, Button, Descriptions, Input, Modal, Space, Table } from "antd";
import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, Panel } from "@/components/ui/panel";

import {
  applicantDisplay,
  categoryLabel,
  fmtDate,
  type StaffApplicationRow,
} from "./common";

/**
 * 加入申请（demo staff.js：#挂靠申请）——职员/代理人在资源库或服务商详情里
 * 选择本机构发起的加入申请；审批通过后成为你的职员/代理人（同一账号可同时加入多家机构）。
 * 后端：GET /enterprise/staff/affiliations、POST /enterprise/staff/affiliations/:id/audit。
 */
export function AffiliationPanel({
  rows,
  loading,
}: {
  rows: StaffApplicationRow[];
  loading: boolean;
}) {
  const identity_auditAffMutation = useOperationMutation(identityApi.auditAff, [
    "*",
  ]);

  const { message } = App.useApp();
  const [active, setActive] = useState<StaffApplicationRow | null>(null);
  const [note, setNote] = useState("");
  const [auditing, setAuditing] = useState(false);

  const pending = rows.filter((row) => row.status === "PENDING");

  const openAudit = (row: StaffApplicationRow) => {
    setNote("");
    setActive(row);
  };

  const submitAudit = async (action: "APPROVE" | "REJECT") => {
    try {
      if (!active) return;
      const auditNote = note.trim();
      if (action === "REJECT" && !auditNote) {
        message.warning("驳回时请填写驳回原因");
        return;
      }
      setAuditing(true);
      try {
        await identity_auditAffMutation.mutateAsync({
          params: { id: String(active.id) },
          body: { action, note: auditNote },
        });

        message.success(action === "APPROVE" ? "已通过加入申请" : "已驳回");
        setActive(null);
      } finally {
        setAuditing(false);
      }
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  return (
    <Panel
      title="加入申请"
      titleBadge={
        <>
          {pending.length ? (
            <span className="badge badge-orange">
              {pending.length} 条待审批
            </span>
          ) : null}
          <span className="text-12 muted">
            职员/代理人在资源库或服务商详情选择本机构发起的加入申请；审批通过后成为你的职员/代理人（同一账号可同时加入多家机构，同一机构同一类目只留一条）
          </span>
        </>
      }
    >
      <div className="table-wrap">
        <Table<StaffApplicationRow>
          rowKey="id"
          loading={loading}
          dataSource={rows}
          pagination={false}
          size="middle"
          locale={{
            emptyText: (
              <EmptyState
                icon={<InboxOutlined aria-hidden />}
                text="暂无加入申请：职员/代理人可在资源库或服务商详情选择本机构发起「申请加入」"
              />
            ),
          }}
          columns={[
            {
              title: "申请人",
              width: 150,
              render: (_, row) => (
                <span style={{ fontWeight: 600 }}>{applicantDisplay(row)}</span>
              ),
            },
            {
              title: "手机号",
              width: 130,
              render: (_, row) => (
                <span className="text-12">
                  {row.applicant_phone || row.profile?.phone || "—"}
                </span>
              ),
            },
            {
              title: "服务类目",
              width: 120,
              render: (_, row) => (
                <span className="badge badge-sky">
                  {row.category_label || categoryLabel(row.category)}
                </span>
              ),
            },
            {
              title: "申请角色",
              width: 140,
              render: (_, row) => (
                <span className="text-12">{row.position || "—"}</span>
              ),
            },
            {
              title: "申请说明",
              ellipsis: true,
              render: (_, row) => (
                <span className="text-12 muted">{row.note || "—"}</span>
              ),
            },
            {
              title: "状态",
              width: 100,
              render: (_, row) => (
                <StatusBadge domain="affiliation" status={row.status} />
              ),
            },
            {
              title: "申请时间",
              width: 120,
              render: (_, row) => (
                <span className="text-12 muted">{fmtDate(row.createdAt)}</span>
              ),
            },
            {
              title: "操作",
              width: 120,
              render: (_, row) =>
                row.status === "PENDING" ? (
                  <Space size={6} wrap>
                    <Button type="primary" onClick={() => openAudit(row)}>
                      审批
                    </Button>
                  </Space>
                ) : (
                  <span className="text-12 muted">{row.audit_note || "—"}</span>
                ),
            },
          ]}
        />
      </div>

      <Modal
        open={Boolean(active)}
        title={`加入申请审批 · ${active ? applicantDisplay(active) : ""}`}
        width={560}
        confirmLoading={auditing}
        onCancel={() => setActive(null)}
        footer={
          <>
            <Button
              onClick={() => void submitAudit("REJECT")}
              disabled={auditing}
            >
              驳回
            </Button>
            <Button
              type="primary"
              onClick={() => void submitAudit("APPROVE")}
              loading={auditing}
            >
              通过申请
            </Button>
          </>
        }
      >
        {active ? (
          <>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="申请人">
                {applicantDisplay(active)}
              </Descriptions.Item>
              <Descriptions.Item label="服务类目">
                {active.category_label || categoryLabel(active.category)}
              </Descriptions.Item>
              <Descriptions.Item label="申请角色">
                {active.position || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="申请说明">
                {active.note || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="个人资料">
                {active.profile
                  ? `${active.profile.real_name || "—"}｜${
                      active.profile.qualification || "—"
                    }｜类目：${
                      (active.profile.categories || [])
                        .map((item) => categoryLabel(item))
                        .join("、") || "—"
                    }`
                  : "—"}
              </Descriptions.Item>
            </Descriptions>
            <div style={{ marginTop: 14 }}>
              <div style={{ marginBottom: 6 }}>审批意见（驳回必填）</div>
              <Input
                value={note}
                placeholder="通过可不填；驳回请填写原因"
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            <p className="text-12 muted" style={{ marginTop: 8 }}>
              审批通过后，TA
              即成为你的职员/代理人（角色与服务类目一致），可被分配企业并承办业务；同一账号还可加入其他机构，本机构的同一类目只保留一条有效关系。
            </p>
          </>
        ) : null}
      </Modal>
    </Panel>
  );
}
