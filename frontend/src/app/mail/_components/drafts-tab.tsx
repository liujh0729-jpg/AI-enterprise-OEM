"use client";

import type { MailAccount, MailMessageSummary } from "@enterprise/contracts";
import { Button, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { mailApi } from "@/api/mail";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";

/**
 * 草稿箱：IMAP 直接读服务器 Drafts 文件夹（本站不存草稿）；
 * POP3 没有草稿箱，正文只在生成时返回，因此这里提示去收件箱里重新起草。
 */
export function MailDraftsTab({ accounts }: { accounts: MailAccount[] }) {
  const [accountId, setAccountId] = useState(0);
  const [rows, setRows] = useState<MailMessageSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const account = accounts.find((item) => item.id === accountId) || null;

  const load = useCallback(async () => {
    if (!accountId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const list = await mailApi.drafts({
        params: { id: String(accountId) },
        query: { limit: 30 },
      });
      setRows(list || []);
      setError("");
    } catch (caught) {
      setRows([]);
      setError((caught as Error).message || "草稿箱读取失败");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: ColumnsType<MailMessageSummary> = [
    {
      title: "主题",
      key: "subject",
      render: (_, row) => (
        <div style={{ wordBreak: "break-all" }}>{row.subject}</div>
      ),
    },
    {
      title: "时间",
      dataIndex: "receivedAt",
      key: "receivedAt",
      width: 160,
      render: (value: string) => fmtTime(value),
    },
    {
      title: "状态",
      key: "status",
      width: 120,
      render: (_, row) => <Tag color="blue">{row.statusLabel}</Tag>,
    },
  ];

  return (
    <Panel
      title="草稿箱"
      titleExtra={
        <span className="text-12 muted">
          IMAP 的草稿存在服务器草稿箱；本站不保存草稿正文
        </span>
      }
      extra={
        <Select
          style={{ width: 240 }}
          value={accountId}
          placeholder="选择邮箱"
          options={accounts.map((item) => ({
            value: item.id,
            label: item.address,
          }))}
          onChange={setAccountId}
        />
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      {!accounts.length ? (
        <EmptyState text="还没有邮箱：先到「邮箱账号」页签添加一个" />
      ) : !accountId ? (
        <EmptyState text="先选一个邮箱查看它的草稿箱" />
      ) : account?.protocol === "pop3" ? (
        <EmptyState text="POP3 没有草稿箱：在收件箱里生成的正文只会在当时返回，可复制后手动发送" />
      ) : !loading && !rows.length ? (
        <EmptyState text="这个邮箱的草稿箱是空的" />
      ) : (
        <Table<MailMessageSummary>
          size="small"
          rowKey="key"
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={false}
          scroll={{ x: "max-content" }}
        />
      )}
      <Space style={{ marginTop: 12 }}>
        <Button onClick={() => void load()} disabled={!accountId}>
          刷新
        </Button>
      </Space>
    </Panel>
  );
}