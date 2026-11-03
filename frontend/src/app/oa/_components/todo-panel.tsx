"use client";

import { RightOutlined } from "@ant-design/icons";
import { Alert, Button, Input, Select, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type {
  OaInbox,
  OaInboxGroup,
  OaOrg,
  OaTask,
  OaTemplateSummary,
} from "@enterprise/contracts";
import { oaApi } from "@/api/oa";
import { ColumnSwitch, EmptyState, Panel } from "@/components/ui/panel";
import {
  OaTable,
  TaskStatusTag,
  Toolbar,
  fmtDateTime,
  money,
  oaError,
  orgQueryOf,
  type OaOrgQuery,
} from "./oa-common";

const PAGE_SIZE = 20;

const SUB_VIEWS = [
  { value: "PENDING", label: "待处理" },
  { value: "DONE", label: "已处理" },
];

/** 其他系统的待办只到对应模块处理，OA 这边只读列出。 */
function InboxGroup({ group }: { group: OaInboxGroup }) {
  const router = useRouter();
  return (
    <div className="exec-list">
      {group.items.map((item, index) => (
        <button
          key={`${group.source}-${index}-${item.link}`}
          type="button"
          className="exec-row"
          onClick={() => router.push(item.link)}
        >
          <span className="exec-row-main">
            <span className="exec-row-label">{item.title}</span>
            {item.subtitle ? (
              <span className="exec-row-hint">{item.subtitle}</span>
            ) : null}
          </span>
          {item.amount > 0 ? (
            <span className="text-12 muted">金额 {money(item.amount)}</span>
          ) : null}
          <span className="text-12 muted">
            前往处理 <RightOutlined />
          </span>
        </button>
      ))}
      {!group.items.length ? (
        <div className="text-12 muted" style={{ padding: "8px 0" }}>
          共 {group.count} 条，请到{group.sourceLabel}查看完整清单
        </div>
      ) : null}
    </div>
  );
}

export function TodoPanel({
  org,
  templates,
  onDetail,
}: {
  org: OaOrg | null;
  templates: OaTemplateSummary[];
  onDetail: (id: number) => void;
}) {
  const [view, setView] = useState("PENDING");
  const [keyword, setKeyword] = useState("");
  const [templateId, setTemplateId] = useState(0);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<OaTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inbox, setInbox] = useState<OaInbox | null>(null);
  const [inboxError, setInboxError] = useState("");

  const orgQuery: OaOrgQuery = orgQueryOf(org);
  const { orgType, orgUserId } = orgQuery;

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setLoading(true);
      try {
        const query = {
          orgType,
          orgUserId,
          page,
          pageSize: PAGE_SIZE,
          keyword,
        };
        const data =
          view === "PENDING"
            ? await oaApi.tasks({ query: { ...query, templateId } })
            : await oaApi.done({ query });
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
  }, [orgType, orgUserId, view, keyword, templateId, page]);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const data = await oaApi.approvalInbox({ query: { orgType, orgUserId } });
        if (!alive) return;
        setInbox(data);
        setInboxError("");
      } catch (err) {
        if (!alive) return;
        setInbox(null);
        setInboxError(oaError(err));
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [orgType, orgUserId]);

  const columns: ColumnsType<OaTask> = [
    { title: "单号", dataIndex: "number", width: 150 },
    { title: "模板", dataIndex: "templateName", width: 140 },
    { title: "标题", dataIndex: "title", width: 220 },
    {
      title: "申请人 / 部门",
      width: 180,
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
      title: "节点",
      width: 160,
      render: (_, row) => (
        <div className="exec-row-main">
          <span>{row.nodeName || "审批"}</span>
          <span className="exec-row-hint">{row.modeLabel}</span>
        </div>
      ),
    },
    {
      title: "状态",
      width: 100,
      render: (_, row) => <TaskStatusTag status={row.status} />,
    },
    {
      title: "提交时间",
      width: 160,
      render: (_, row) => fmtDateTime(row.submittedAt) || "—",
    },
    {
      title: "操作",
      fixed: "right",
      width: 90,
      render: (_, row) => (
        <Button type="link" onClick={() => onDetail(row.applicationId)}>
          详情
        </Button>
      ),
    },
  ];

  const otherGroups = (inbox?.groups || []).filter(
    (group) => group.source !== "OA" && group.count > 0,
  );

  return (
    <>
      <Panel
        title="其他系统待办"
        titleBadge={
          inbox ? (
            <span className="text-12 muted">
              共 {inbox.total} 条，点击即到对应模块处理
            </span>
          ) : null
        }
      >
        {inboxError ? (
          <Alert
            type="warning"
            showIcon
            message={`其他系统待办加载失败：${inboxError}`}
          />
        ) : otherGroups.length ? (
          <div className="exec-list">
            {otherGroups.map((group) => (
              <div key={group.source}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 8px 2px",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{group.sourceLabel}</span>
                  <Tag>{group.count}</Tag>
                </div>
                <InboxGroup group={group} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="其他系统暂无待你处理的审批" />
        )}
      </Panel>
      <Panel title="待我审批">
        <ColumnSwitch
          value={view}
          onChange={(next) => {
            setView(next);
            setPage(1);
            // 已处理清单只支持关键词筛选，切过去时把模板筛选一并清掉。
            if (next !== "PENDING") setTemplateId(0);
          }}
          options={SUB_VIEWS}
        />
        <Toolbar>
          {view === "PENDING" ? (
            <Select
              style={{ width: 180 }}
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
          ) : null}
          <Input.Search
            allowClear
            placeholder="搜索单号 / 标题 / 申请人"
            style={{ width: 240 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onSearch={() => setPage(1)}
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
        <OaTable<OaTask>
          columns={columns}
          rows={rows}
          loading={loading}
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
          onPage={setPage}
          empty={view === "PENDING" ? "暂无待你审批的单据" : "暂无已处理记录"}
        />
      </Panel>
    </>
  );
}
