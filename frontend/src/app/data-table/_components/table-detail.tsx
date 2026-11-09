"use client";

import {
  ArrowLeftOutlined,
  CopyOutlined,
  DownloadOutlined,
} from "@ant-design/icons";
import { App, Button, Space, Tag } from "antd";
import { useState } from "react";
import { GrantPanel } from "./grant-panel";
import { RowPanel } from "./row-panel";
import { ViewPanel } from "./view-panel";
import { AiPanel } from "./ai-panel";
import { TableSettingsButton } from "./settings-panel";
import { tableApi, type DataTableTable } from "./common";

/**
 * 单张多维表格：数据行 + 共享授权。
 * 列定义、列键、机器通道与飞书同步收在表头「导出 CSV」右侧的「设置」里。
 * 结构与授权只归归属账号；被授权成员按四个权限位各看各的动作。
 */
export function TableDetail({
  table,
  onBack,
  onChanged,
}: {
  table: DataTableTable;
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const [reloadKey, setReloadKey] = useState(0);

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(String(table.id));
      message.success(`表格 ID 已复制：${table.id}`);
    } catch {
      message.warning(`请手动记录表格 ID：${table.id}`);
    }
  };

  const handleExport = () => {
    window.open(tableApi.exportUrl(table.id), "_blank");
  };

  const refresh = async () => {
    setReloadKey((value) => value + 1);
    await onChanged();
  };

  return (
    <>
      <div className="data-table-head">
        <Space size={10} wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
            返回表格清单
          </Button>
          <b className="data-table-head-name">{table.name}</b>
          <Tag>表格 ID {table.id}</Tag>
          <Button icon={<CopyOutlined />} onClick={() => void copyId()}>
            复制 ID
          </Button>
          {table.can.read ? (
            <Button type="primary" icon={<DownloadOutlined />} onClick={handleExport}>
              导出 CSV
            </Button>
          ) : null}
          <TableSettingsButton table={table} onChanged={refresh} />
        </Space>
        {table.description ? (
          <div className="text-12 muted" style={{ marginTop: 6 }}>
            {table.description}
          </div>
        ) : null}
      </div>

      {table.owner ? <GrantPanel table={table} onChanged={refresh} /> : null}
      <RowPanel table={table} reloadKey={reloadKey} onChanged={refresh} />
      {table.can.read ? (
        <ViewPanel table={table} reloadKey={reloadKey} />
      ) : null}
      {table.can.read ? <AiPanel table={table} /> : null}
    </>
  );
}
