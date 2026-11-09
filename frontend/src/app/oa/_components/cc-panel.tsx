"use client";

import { Alert, Button, Input, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import type { OaCc, OaOrg } from "@enterprise/contracts";
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
  type OaOrgQuery,
} from "./oa-common";

const PAGE_SIZE = 20;

export function CcPanel({
  org,
  onDetail,
}: {
  org: OaOrg | null;
  onDetail: (id: number) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<OaCc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(0);

  const orgQuery: OaOrgQuery = orgQueryOf(org);
  const { orgType, orgUserId } = orgQuery;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await oaApi.cc({
        query: { orgType, orgUserId, page, pageSize: PAGE_SIZE, keyword },
      });
      setRows(data?.list || []);
      setTotal(data?.total || 0);
      setError("");
    } catch (err) {
      setRows([]);
      setTotal(0);
      setError(oaError(err));
    } finally {
      setLoading(false);
    }
  }, [orgType, orgUserId, page, keyword]);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = async (row: OaCc) => {
    setBusyId(row.id);
    try {
      await oaApi.readCc({ params: { id: String(row.id) }, body: {} });
      await load();
    } catch (err) {
      setError(oaError(err));
    } finally {
      setBusyId(0);
    }
  };

  const columns: ColumnsType<OaCc> = [
    { title: "单号", dataIndex: "number", width: 150 },
    { title: "标题", dataIndex: "title", width: 240 },
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
      title: "状态",
      width: 100,
      render: (_, row) => (
        <ApplicationStatusTag status={row.status} label={row.statusLabel} />
      ),
    },
    {
      title: "抄送时间",
      width: 160,
      render: (_, row) => fmtDateTime(row.createdAt) || "—",
    },
    {
      title: "已读",
      width: 90,
      render: (_, row) =>
        row.readAt ? (
          <span className="text-12 muted">{fmtDateTime(row.readAt)}</span>
        ) : (
          <Tag color="gold">未读</Tag>
        ),
    },
    {
      title: "操作",
      fixed: "right",
      width: 140,
      render: (_, row) => (
        <>
          <Button type="link" onClick={() => onDetail(row.applicationId)}>
            查看
          </Button>
          {!row.readAt ? (
            <Button
              type="link"
              loading={busyId === row.id}
              onClick={() => void markRead(row)}
            >
              标记已读
            </Button>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <Panel title="抄送我的">
      <Toolbar>
        <Input.Search
          allowClear
          placeholder="搜索单号 / 标题 / 申请人"
          style={{ width: 240 }}
          value={keyword}
          onChange={(event) => {
            setKeyword(event.target.value);
            setPage(1);
          }}
        />
      </Toolbar>
      {error ? (
        <Alert
          type="error"
          showIcon
          title={error}
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <OaTable<OaCc>
        columns={columns}
        rows={rows}
        loading={loading}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        onPage={setPage}
        empty="暂无抄送你的单据"
      />
    </Panel>
  );
}
