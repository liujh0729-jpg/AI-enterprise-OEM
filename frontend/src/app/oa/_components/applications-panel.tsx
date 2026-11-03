"use client";

import { Alert, App, Button, Input, Select } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import {
  OA_APPLICATION_STATUSES,
  OA_APPLICATION_STATUS_LABELS,
} from "@enterprise/contracts";
import type {
  OaApplicationSummary,
  OaOrg,
  OaTemplateSummary,
} from "@enterprise/contracts";
import { oaApi } from "@/api/oa";
import { Panel } from "@/components/ui/panel";
import {
  ApplicationStatusTag,
  OaTable,
  Toolbar,
  fmtDateTime,
  money,
  oaError,
  orgQueryOf,
  type OaMember,
  type OaOrgQuery,
} from "./oa-common";

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  ...OA_APPLICATION_STATUSES.map((status) => ({
    value: status,
    label: OA_APPLICATION_STATUS_LABELS[status] || status,
  })),
];

/** 当前节点（含审批人）：在途取冻结快照里的节点名 + 待处理人，其余按状态收口。 */
function currentNodeText(row: OaApplicationSummary) {
  const parts = [
    row.currentNodeName,
    row.currentApprovers.map((item) => item.name).join("、"),
  ].filter(Boolean);
  return parts.join(" · ") || (row.status === "DRAFT" ? "未提交" : "已结束");
}

/**
 * 我发起的 / 全部单据共用一份实现：差别只有 scope（后端据此收窄可见范围）、
 * 右上角按钮（导出只认管理员，新建入口留给「我发起的」）和行内「继续填写」。
 */
export function ApplicationsPanel({
  scope,
  org,
  templates,
  members,
  onDetail,
  onEdit,
  onNew,
}: {
  scope: "MINE" | "ALL";
  org: OaOrg | null;
  templates: OaTemplateSummary[];
  members: OaMember[];
  onDetail: (id: number) => void;
  onEdit: (id: number) => void;
  onNew?: () => void;
}) {
  const { message } = App.useApp();
  const [status, setStatus] = useState("");
  const [templateId, setTemplateId] = useState(0);
  const [department, setDepartment] = useState("");
  const [keyword, setKeyword] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<OaApplicationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const orgQuery: OaOrgQuery = orgQueryOf(org);
  const { orgType, orgUserId } = orgQuery;

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setLoading(true);
      try {
        const data = await oaApi.applications({
          query: {
            orgType,
            orgUserId,
            scope,
            page,
            pageSize: PAGE_SIZE,
            status,
            templateId,
            department,
            keyword,
            from,
            to,
          },
        });
        if (!alive) return;
        setRows(data?.list || []);
        setTotal(data?.total || 0);
        setError("");
      } catch (err) {
        if (!alive) return;
        setRows([]);
        setTotal(0);
        setError(oaError(err));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [
    orgType,
    orgUserId,
    scope,
    page,
    status,
    templateId,
    department,
    keyword,
    from,
    to,
  ]);

  const departments = [
    ...new Set(members.map((member) => member.department).filter(Boolean)),
  ];

  const exportCsv = async () => {
    setExporting(true);
    try {
      const result = await oaApi.exportCsv({
        query: {
          orgType,
          orgUserId,
          status,
          templateId,
          department,
          keyword,
          from,
          to,
        },
      });
      if (!result) throw new Error("导出失败");
      const blob = new Blob([result.content], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      message.success(`已导出 ${result.rows} 条`);
      if (result.truncated) {
        message.warning(
          "数据量超出上限，只导出了最前面的一部分，请缩小筛选范围后再导出",
        );
      }
    } catch (err) {
      message.error(oaError(err));
    } finally {
      setExporting(false);
    }
  };

  const columns: ColumnsType<OaApplicationSummary> = [
    { title: "单号", dataIndex: "number", width: 150 },
    { title: "模板", dataIndex: "templateName", width: 140 },
    { title: "标题", dataIndex: "title", width: 220 },
    {
      title: "申请人 / 部门",
      width: 170,
      render: (_, row) => (
        <div className="exec-row-main">
          <span>{row.applicantName || "—"}</span>
          <span className="exec-row-hint">{row.department || "未填部门"}</span>
        </div>
      ),
    },
    {
      title: "金额",
      dataIndex: "amount",
      width: 120,
      align: "right",
      render: (value: number) => money(value),
    },
    {
      title: "当前节点",
      width: 190,
      render: (_, row) => currentNodeText(row),
    },
    {
      title: "状态",
      width: 100,
      render: (_, row) => (
        <ApplicationStatusTag status={row.status} label={row.statusLabel} />
      ),
    },
    {
      title: "提交时间",
      width: 160,
      render: (_, row) => fmtDateTime(row.submittedAt) || "—",
    },
    {
      title: "操作",
      fixed: "right",
      width: 130,
      render: (_, row) => (
        <>
          <Button type="link" onClick={() => onDetail(row.id)}>
            详情
          </Button>
          {scope === "MINE" &&
          (row.status === "DRAFT" || row.status === "RETURNED") ? (
            <Button type="link" onClick={() => onEdit(row.id)}>
              继续填写
            </Button>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <Panel
      title={scope === "MINE" ? "我发起的" : "全部单据"}
      extra={
        scope === "ALL" ? (
          <Button loading={exporting} onClick={() => void exportCsv()}>
            导出 CSV
          </Button>
        ) : onNew ? (
          <Button type="primary" onClick={onNew}>
            新建申请
          </Button>
        ) : null
      }
    >
      <Toolbar hint="按提交时间筛选，未提交的按创建时间">
        <Select
          style={{ width: 140 }}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          options={STATUS_OPTIONS}
        />
        <Select
          style={{ width: 170 }}
          value={templateId}
          onChange={(value) => {
            setTemplateId(value);
            setPage(1);
          }}
          options={[
            { value: 0, label: "全部模板" },
            ...templates.map((template) => ({
              value: template.id,
              label: template.name,
            })),
          ]}
        />
        <Select
          style={{ width: 150 }}
          value={department}
          onChange={(value) => {
            setDepartment(value);
            setPage(1);
          }}
          options={[
            { value: "", label: "全部部门" },
            ...departments.map((name) => ({ value: name, label: name })),
          ]}
        />
        <Input.Search
          allowClear
          placeholder="搜索单号 / 标题 / 申请人"
          style={{ width: 220 }}
          value={keyword}
          onChange={(event) => {
            setKeyword(event.target.value);
            setPage(1);
          }}
        />
        <Input
          type="date"
          style={{ width: 140 }}
          value={from}
          onChange={(event) => {
            setFrom(event.target.value);
            setPage(1);
          }}
        />
        <Input
          type="date"
          style={{ width: 140 }}
          value={to}
          onChange={(event) => {
            setTo(event.target.value);
            setPage(1);
          }}
        />
      </Toolbar>
      {error ? (
        <Alert
          type="error"
          showIcon
          message={error}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <OaTable<OaApplicationSummary>
        columns={columns}
        rows={rows}
        loading={loading}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        onPage={setPage}
        empty={scope === "MINE" ? "还没有发起过申请" : "暂无单据"}
      />
    </Panel>
  );
}
