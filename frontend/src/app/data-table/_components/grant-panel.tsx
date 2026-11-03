"use client";

import { App, Button, Space, Switch, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { Panel } from "@/components/ui/panel";
import {
  PERMISSION_LABEL,
  grantSourceLabel,
  tableApi,
  type GrantCandidate,
  type GrantView,
  type TablePermissions,
} from "./common";

const BITS: (keyof TablePermissions)[] = ["read", "create", "update", "delete"];

function emptyBits(): TablePermissions {
  return { read: false, create: false, update: false, delete: false };
}

/**
 * 共享授权：归属账号把这张表按四种操作分别授权给旗下成员。
 * 没有可授权成员（既没认证企业也没绑定职员）时整个面板不渲染。
 */
export function GrantPanel({
  table,
  onChanged,
}: {
  table: { id: number; name: string };
  onChanged: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const [view, setView] = useState<GrantView | null>(null);
  const [bits, setBits] = useState<Record<string, TablePermissions>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await tableApi.grants(table.id);
    if (result.data) {
      const next: Record<string, TablePermissions> = {};
      for (const candidate of result.data.candidates) {
        next[candidate.userId] =
          result.data.grants.find((item) => item.userId === candidate.userId)?.can ||
          emptyBits();
      }
      setView(result.data);
      setBits(next);
    }
    setLoading(false);
    if (result.message) message.error(result.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!view?.candidates.length) return null;

  const grantedCount = Object.values(bits).filter(
    (item) => item.read || item.create || item.update || item.delete,
  ).length;

  const save = () => {
    const payload = view.candidates.map((candidate) => ({
      user_id: candidate.userId,
      can_read: Boolean(bits[candidate.userId]?.read),
      can_create: Boolean(bits[candidate.userId]?.create),
      can_update: Boolean(bits[candidate.userId]?.update),
      can_delete: Boolean(bits[candidate.userId]?.delete),
    }));
    request({
      title: "保存共享授权（需密码）",
      content: `确认保存「${table.name}」的授权名单？未勾选的操作会被立即收回。`,
      okText: "保存授权",
      onOk: async () => {
        setBusy(true);
        try {
          await tableApi.saveGrants(table.id, payload);
          await Promise.all([load(), onChanged()]);
          message.success("共享授权已保存");
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const columns: ColumnsType<GrantCandidate> = [
    {
      title: "成员",
      key: "member",
      render: (_: unknown, row) => (
        <Space size={6} wrap>
          <b>{row.name}</b>
          <Tag>{grantSourceLabel(row.sources)}</Tag>
        </Space>
      ),
    },
    ...BITS.map((bit) => ({
      title: PERMISSION_LABEL[bit],
      key: bit,
      width: 72,
      align: "center" as const,
      render: (_: unknown, row: GrantCandidate) => (
        <Switch
          size="small"
          checked={Boolean(bits[row.userId]?.[bit])}
          onChange={(checked) =>
            setBits((prev) => ({
              ...prev,
              [row.userId]: { ...emptyBits(), ...prev[row.userId], [bit]: checked },
            }))
          }
        />
      ),
    })),
  ];

  return (
    <Panel
      title="共享授权"
      titleBadge={`已授权 ${grantedCount} 人`}
      extra={
        <Button loading={busy} onClick={() => void save()}>
          保存授权
        </Button>
      }
    >
      <div className="text-12 muted" style={{ marginBottom: 8 }}>
        访问 / 新增 / 修改 / 删除四个权限分别授权，互不牵连；四项都关掉即收回该成员的全部权限。
        表结构与本名单只有归属账号能改。
      </div>
      <Table<GrantCandidate>
        rowKey="userId"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={view.candidates}
        pagination={false}
      />
      {modal}
    </Panel>
  );
}
