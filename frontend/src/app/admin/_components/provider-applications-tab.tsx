"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { adminApi } from "@/api/admin";

import { SolutionOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Descriptions,
  Input,
  Modal,
  Segmented,
  Space,
  Table,
} from "antd";
import { useMemo, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, Panel } from "@/components/ui/panel";

import { isPersonalSubject } from "@/lib/subject";
import {
  PermissionNotice,
  SUBITEM_LABEL,
  fmtSize,
  fmtTime,
  providerTypeBadge,
  subItemsText,
  useAdminData,
  type ProviderApplicationRow,
} from "./common";

/** 带细项的备案类目（出海 / 营销 / 物流（含小微）/ IT服务 / 资产交易同构）：按细项逐项审核、按细项独立签约。 */
const BEARING_TYPES = [
  "EXPORT_REFUND",
  "MARKETING",
  "LOGISTICS",
  "MICRO",
  "SMART_SERVICE",
  "ASSET_TRADE",
];

/**
 * 细项分组标题（界面禁裸枚举）：`items` 用于字段名（已含「服务」），
 * `domain` 是业务词干（拼「domain+服务」「domain+服务商」两处文案都不重复「服务」）。
 */
const BEARING_LABELS: Record<string, { items: string; domain: string }> = {
  EXPORT_REFUND: { items: "出海服务细项", domain: "跨境出海" },
  MARKETING: { items: "营销服务细项", domain: "营销" },
  LOGISTICS: { items: "物流服务细项", domain: "物流" },
  MICRO: { items: "物流服务细项", domain: "物流" },
  SMART_SERVICE: { items: "IT服务细项", domain: "IT" },
  ASSET_TRADE: { items: "资产交易细项", domain: "资产交易" },
};

/**
 * 服务商备案（demo admin.js：renderProviders）——备案列表 + 审核弹窗
 * （通过后授予服务商角色 SERVICE_PROVIDER）。
 * 后端：GET /enterprise/admin/provider-applications、
 * POST /enterprise/admin/provider-applications/:id/audit。
 */
export function ProviderApplicationsTab() {
  const admin_auditAppMutation = useOperationMutation(adminApi.auditApp, ["*"]);

  const { message } = App.useApp();
  const [page, setPage] = useState(1);
  const { data, loading, denied } = useAdminData(
    "apps",
    (signal) => adminApi.appPage({ query: { page, pageSize: 20 } }, { signal }),
    { page },
  );
  const stats = useAdminData("stats", (signal) =>
    adminApi.stats({}, { signal }),
  );
  const rows = data?.list ?? [];
  const pending = stats.data?.pendingProvider;

  const [active, setActive] = useState<ProviderApplicationRow | null>(null);
  const [note, setNote] = useState("");
  const [auditing, setAuditing] = useState(false);
  /** 出海细项的逐项结论（默认全部通过，可单项改不通过） */
  const [itemDecisions, setItemDecisions] = useState<
    Record<string, { item: string; status: string; note: string }>
  >({});

  const openAudit = (
    row: ProviderApplicationRow,
    // 已通过的备案用「不通过」入口进入审核弹窗；弹窗底部按状态给出对应操作
  ) => {
    setNote("");
    setItemDecisions({});
    setActive(row);
  };

  const submitAudit = async (action: "APPROVE" | "REJECT") => {
    try {
      if (!active) return;
      if (action === "REJECT" && !note.trim()) {
        message.warning("置为不通过请填写原因");
        return;
      }
      setAuditing(true);
      try {
        await admin_auditAppMutation.mutateAsync({
          params: { id: String(active.id) },
          body: {
            action,
            note: note.trim(),
            ...(BEARING_TYPES.includes(active.providerType) &&
            action === "APPROVE"
              ? {
                  items: String(active.serviceItems || "")
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean)
                    .map((item) => ({
                      item,
                      status: itemDecisions[item]?.status || "APPROVE",
                      note: itemDecisions[item]?.note || "",
                    })),
                }
              : {}),
          },
        });

        message.success(
          action === "APPROVE"
            ? "备案通过，服务商角色已授予"
            : active.status === "APPROVED"
              ? "已置为不通过，该资质停止生效"
              : "已驳回该备案申请",
        );
        setActive(null);
      } finally {
        setAuditing(false);
      }
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const files = Array.isArray(active?.attachments)
    ? active?.attachments || []
    : [];
  const staff = Array.isArray(active?.business_staff)
    ? active?.business_staff || []
    : [];
  const personal = isPersonalSubject(active?.subjectType);
  /** 该备案行是否带细项（出海 / 营销）：决定「细项」行与逐项审核面板是否渲染 */
  const bearing = active ? BEARING_LABELS[active.providerType] : undefined;
  /** 带细项类目（出海 / 营销）：按子分类逐项审核 */
  const selectedSubItems = String(active?.serviceItems || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const existingItemAudits = useMemo(() => {
    const out: Record<string, { status: string; note?: string }> = {};
    const rows = Array.isArray(active?.itemAudits)
      ? active?.itemAudits || []
      : [];
    for (const row of rows) {
      const item = String((row as { item?: string }).item || "");
      if (item) {
        out[item] = {
          status: String((row as { status?: string }).status || ""),
          note: String((row as { note?: string }).note || ""),
        };
      }
    }
    return out;
  }, [active?.itemAudits]);

  return (
    <>
      <PermissionNotice denied={denied} />

      <Panel
        title="服务商备案审核"
        titleBadge={
          <span className="badge badge-orange">
            {pending === undefined
              ? "待处理统计暂不可用"
              : `${pending} 条待处理`}
          </span>
        }
      >
        <div className="table-wrap">
          <Table<ProviderApplicationRow>
            rowKey="id"
            loading={loading}
            dataSource={rows}
            pagination={{
              current: page,
              pageSize: 20,
              total: data?.total ?? 0,
              onChange: setPage,
              showSizeChanger: false,
            }}
            size="middle"
            locale={{
              emptyText: (
                <EmptyState
                  icon={<SolutionOutlined aria-hidden />}
                  text="暂无备案申请"
                />
              ),
            }}
            columns={[
              {
                title: "机构名称",
                width: 200,
                render: (_, row) => (
                  <span style={{ fontWeight: 600 }}>{row.orgName}</span>
                ),
              },
              {
                title: "服务类型",
                width: 180,
                render: (_, row) => (
                  <div>
                    {providerTypeBadge(row.providerType)}
                    {subItemsText(row.serviceItems) ? (
                      <div className="text-12 muted" style={{ marginTop: 4 }}>
                        {`细项：${subItemsText(row.serviceItems)}`}
                      </div>
                    ) : null}
                  </div>
                ),
              },
              {
                title: "证件号",
                width: 190,
                render: (_, row) => (
                  <span className="mono text-12">
                    {isPersonalSubject(row.subjectType)
                      ? row.idCard || "—"
                      : row.uscc}
                  </span>
                ),
              },
              {
                title: "申请人",
                width: 150,
                render: (_, row) => (
                  <div>
                    <div>{row.owner_name || "—"}</div>
                    <div className="text-12 muted">{row.userId}</div>
                  </div>
                ),
              },
              {
                title: "提交时间",
                width: 150,
                render: (_, row) => (
                  <span className="text-12 muted">
                    {fmtTime(row.createdAt)}
                  </span>
                ),
              },
              {
                title: "状态",
                width: 100,
                render: (_, row) => <StatusBadge status={row.status} />,
              },
              {
                title: "操作",
                width: 190,
                render: (_, row) =>
                  row.status === "PENDING" ? (
                    <Button type="primary" onClick={() => openAudit(row)}>
                      审核
                    </Button>
                  ) : row.status === "APPROVED" ? (
                    <Space size={6}>
                      <Button onClick={() => openAudit(row)}>查看</Button>
                      <Button danger onClick={() => openAudit(row)}>
                        不通过
                      </Button>
                    </Space>
                  ) : (
                    <span className="text-12 muted">
                      {row.auditNote || "—"}
                    </span>
                  ),
              },
            ]}
          />
        </div>
      </Panel>

      <Modal
        open={Boolean(active)}
        title={`审核服务商备案：${active?.orgName || ""}`}
        width={620}
        onCancel={() => setActive(null)}
        footer={
          active?.status === "APPROVED" ? (
            <>
              <Button onClick={() => setActive(null)}>关闭</Button>
              <Button
                danger
                loading={auditing}
                onClick={() => void submitAudit("REJECT")}
              >
                置为不通过
              </Button>
            </>
          ) : (
            <>
              <Button
                danger
                disabled={auditing}
                onClick={() => void submitAudit("REJECT")}
              >
                驳回
              </Button>
              <Button
                type="primary"
                loading={auditing}
                onClick={() => void submitAudit("APPROVE")}
              >
                审核通过（授予服务商角色）
              </Button>
            </>
          )
        }
      >
        {active ? (
          <>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="主体类型">
                {personal ? "个人主体（仅小微服务商）" : "公司主体"}
              </Descriptions.Item>
              <Descriptions.Item label={personal ? "姓名" : "机构名称"}>
                {active.orgName}
              </Descriptions.Item>
              <Descriptions.Item label="服务类型">
                {providerTypeBadge(active.providerType)}
              </Descriptions.Item>
              {subItemsText(active.serviceItems) ? (
                <Descriptions.Item label={bearing ? bearing.items : "服务细项"}>
                  {subItemsText(active.serviceItems)}
                </Descriptions.Item>
              ) : null}
              {bearing ? (
                <Descriptions.Item label={`${bearing.items}逐项审核`}>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    <span className="text-12 muted">
                      {bearing.domain}
                      服务按<strong>每个子分类分别审核</strong>
                      ：默认全部通过，未通过的可单独标注原因；只有通过的细项才会生效（出现在企业的
                      {bearing.domain}
                      服务商资源库与签约候选中）。
                    </span>
                    {selectedSubItems.map((item) => (
                      <div
                        key={item}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <span className="text-12" style={{ minWidth: 110 }}>
                          {SUBITEM_LABEL[item] || item}
                        </span>
                        <Segmented
                          size="small"
                          disabled={active.status === "APPROVED"}
                          value={itemDecisions[item]?.status || "APPROVE"}
                          options={[
                            { label: "通过", value: "APPROVE" },
                            { label: "不通过", value: "REJECT" },
                          ]}
                          onChange={(value: string | number) =>
                            setItemDecisions((current) => ({
                              ...current,
                              [item]: {
                                ...(current[item] || { item }),
                                status: String(value),
                              },
                            }))
                          }
                        />
                        <Input
                          size="small"
                          disabled={active.status === "APPROVED"}
                          style={{ maxWidth: 240 }}
                          placeholder="该项意见（可选）"
                          value={itemDecisions[item]?.note || ""}
                          onChange={(event) =>
                            setItemDecisions((current) => ({
                              ...current,
                              [item]: {
                                ...(current[item] || { item }),
                                note: event.target.value,
                              },
                            }))
                          }
                        />
                        {existingItemAudits[item] ? (
                          <StatusBadge
                            status={
                              existingItemAudits[item].status === "APPROVED"
                                ? "APPROVED"
                                : "REJECTED"
                            }
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                </Descriptions.Item>
              ) : null}
              <Descriptions.Item label={personal ? "身份证号" : "信用代码"}>
                <span className="mono text-12">
                  {personal ? active.idCard || "—" : active.uscc}
                </span>
              </Descriptions.Item>
              <Descriptions.Item label="资质材料">
                {active.qualification || "—"}
              </Descriptions.Item>
              <Descriptions.Item label={`资质附件（${files.length}/10）`}>
                {files.length ? (
                  <div>
                    {files.map((file, index) => (
                      <div
                        key={`${file.name || "file"}-${index}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <a
                          className="text-12"
                          href={file.url || "#"}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {file.name}
                        </a>
                        <span className="text-12 muted">
                          {fmtSize(file.size)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-12 muted">—（未上传资质附件）</span>
                )}
              </Descriptions.Item>
              <Descriptions.Item label={`业务人员（${staff.length}）`}>
                {staff.length ? (
                  <div>
                    {staff.map((item, index) => (
                      <div
                        key={`${item.name || "staff"}-${index}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <span className="text-12">
                          {`${item.name || ""}${
                            item.title ? `（${item.title}）` : ""
                          }`}
                        </span>
                        <span className="text-12 muted">
                          {`${item.phone || "—"}${
                            item.email ? ` · ${item.email}` : ""
                          }`}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-12 muted">
                    —（未登记业务人员，签约后服务商无法指定对接人）
                  </span>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="联系人">
                {`${active.contactName || "—"} ${active.contactPhone || ""}`}
              </Descriptions.Item>
              <Descriptions.Item label="联系邮箱">
                {active.contactEmail || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="机构简介">
                {active.intro || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="申请账号">
                {`${active.owner_name || "—"}（${active.userId}）`}
              </Descriptions.Item>
            </Descriptions>

            <div style={{ marginTop: 12 }}>
              <div style={{ marginBottom: 6 }}>审核意见</div>
              <Input.TextArea
                rows={2}
                value={note}
                placeholder="审核意见（驳回时建议填写原因）"
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          </>
        ) : null}
      </Modal>
    </>
  );
}
