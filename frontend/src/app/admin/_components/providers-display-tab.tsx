"use client";
import { App, Button, Input, Radio, Switch, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { SyncOutlined } from "@ant-design/icons";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { platformApi, type ProviderDisplayRow } from "@/api/platform";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { fmtTime, PermissionNotice, useAdminData } from "./common";

const RESULT_COLOR: Record<string, string> = {
  SUCCESS: "green",
  FAILED: "red",
  SKIPPED: "orange",
};
const RESULT_LABEL: Record<string, string> = {
  SUCCESS: "成功",
  FAILED: "失败",
  SKIPPED: "跳过",
};

/**
 * 服务商展示与同步（设计 §6）：数据源在 AIworkin，展示权在本系统。
 * 后台可切换同步策略（手动 / 定时）、立即同步、逐项开关展示 + 排序权重 + 备注。
 */
export function ProvidersDisplayTab() {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const { data: rows, denied, loading, reload } = useAdminData(
    "providers-display",
    (signal) => platformApi.providers({ signal }),
  );
  const { data: status, reload: reloadStatus } = useAdminData(
    "provider-sync",
    (signal) => platformApi.syncStatus({ signal }),
  );

  const setMode = useOperationMutation(
    (input: { mode: "MANUAL" | "SCHEDULED" }) => platformApi.setSyncMode(input.mode),
    ["providers-display", "provider-sync"],
  );
  const syncNow = useOperationMutation(() => platformApi.syncNow(), [
    "providers-display",
    "provider-sync",
  ]);
  const patch = useOperationMutation(
    (input: { id: number; body: { visible?: boolean; sortWeight?: number; adminNote?: string } }) =>
      platformApi.updateProvider(input.id, input.body),
    ["providers-display"],
  );

  const changeMode = async (mode: "MANUAL" | "SCHEDULED") => {
    try {
      await setMode.mutateAsync({ mode });
      message.success(mode === "SCHEDULED" ? "已切换为定时同步" : "已切换为手动同步");
      await reloadStatus();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const doSync = async () => {
    setBusy(true);
    try {
      const result = await syncNow.mutateAsync();
      await reload();
      await reloadStatus();
      if (result.lastResult === "SUCCESS") message.success(`同步完成，共 ${result.lastCount} 家`);
      else if (result.lastResult === "SKIPPED") message.warning(result.lastError || "已跳过同步");
      else message.error(result.lastError || "同步失败");
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    } finally {
      setBusy(false);
    }
  };

  const columns: ColumnsType<ProviderDisplayRow> = [
    { title: "服务商", dataIndex: "name", render: (v, r) => v || r.aiworkinProviderId },
    { title: "地区", dataIndex: "region", width: 120 },
    {
      title: "资质类目",
      dataIndex: "categoryKeys",
      render: (keys: string[]) =>
        (keys || []).length ? (
          <span>
            {keys.map((k) => (
              <Tag key={k}>{k}</Tag>
            ))}
          </span>
        ) : (
          "—"
        ),
    },
    {
      title: "展示",
      dataIndex: "visible",
      width: 90,
      render: (visible: boolean, r) => (
        <Switch
          checked={visible}
          onChange={async (checked) => {
            try {
              await patch.mutateAsync({ id: r.id, body: { visible: checked } });
              await reload();
            } catch (error) {
              if (error instanceof Error)
                presentMutationError(error, (text) => message.error(text));
            }
          }}
        />
      ),
    },
    {
      title: "权重",
      dataIndex: "sortWeight",
      width: 120,
      render: (weight: number, r) => (
        <Input
          type="number"
          defaultValue={weight}
          onBlur={async (e) => {
            const next = Number(e.target.value);
            if (Number.isInteger(next) && next !== weight) {
              try {
                await patch.mutateAsync({ id: r.id, body: { sortWeight: next } });
                await reload();
              } catch (error) {
                if (error instanceof Error)
                  presentMutationError(error, (text) => message.error(text));
              }
            }
          }}
        />
      ),
    },
    {
      title: "备注",
      dataIndex: "adminNote",
      render: (note: string, r) => (
        <Input
          defaultValue={note}
          placeholder="内部备注"
          onBlur={async (e) => {
            if (e.target.value !== note) {
              try {
                await patch.mutateAsync({ id: r.id, body: { adminNote: e.target.value } });
                await reload();
              } catch (error) {
                if (error instanceof Error)
                  presentMutationError(error, (text) => message.error(text));
              }
            }
          }}
        />
      ),
    },
    {
      title: "同步时间",
      dataIndex: "syncedAt",
      width: 160,
      render: (v: string) => fmtTime(v) || "—",
    },
  ];

  return (
    <>
      <PermissionNotice denied={denied} />
      <Panel
        title="同步策略"
        extra={
          <Button icon={<SyncOutlined spin={busy} />} loading={busy} onClick={doSync}>
            立即同步
          </Button>
        }
      >
        <div style={{ marginBottom: 12 }}>
          <Radio.Group
            value={status?.mode || "MANUAL"}
            onChange={(e) => changeMode(e.target.value as "MANUAL" | "SCHEDULED")}
            disabled={setMode.isPending}
          >
            <Radio.Button value="MANUAL">手动同步</Radio.Button>
            <Radio.Button value="SCHEDULED">定时同步</Radio.Button>
          </Radio.Group>
        </div>
        <Notice variant={status?.lastResult === "FAILED" ? "error" : "info"}>
          最近同步：
          {status?.lastResult ? (
            <Tag color={RESULT_COLOR[status.lastResult] || "default"}>
              {RESULT_LABEL[status.lastResult] || status.lastResult}
            </Tag>
          ) : (
            <Tag>未同步</Tag>
          )}
          {status?.lastSyncAt ? ` ${fmtTime(status.lastSyncAt)}` : ""}
          {status?.lastCount ? ` · ${status.lastCount} 家` : ""}
          {status?.lastError ? ` · ${status.lastError}` : ""}
        </Notice>
      </Panel>

      <Panel title="服务商展示" titleBadge={<span className="text-12 muted">上游快照 × 本地展示开关</span>}>
        <Table<ProviderDisplayRow>
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={rows || []}
          pagination={false}
          locale={{
            emptyText: (
              <EmptyState text="还没有同步到服务商数据：管理员绑定 AIPDD Key 后点「立即同步」，或先接入上游服务商列表接口。" />
            ),
          }}
        />
      </Panel>
    </>
  );
}
