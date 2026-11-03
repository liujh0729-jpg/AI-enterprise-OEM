"use client";

import { Button, Input, Modal, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import {
  DEVICE_OPTIONS,
  deviceLabel,
  fileTypeLabel,
  paramEntries,
  type RpaScript,
} from "./common";

/**
 * RPA 脚本选择弹窗：从脚本列表里单选，支持按设备类型、脚本类型筛选和按名称搜索。
 * 选中的脚本名称显示在按钮上，可清空重新选择。
 */
export function ScriptPicker({
  scripts,
  selectedId,
  onChange,
  deviceType,
}: {
  scripts: RpaScript[];
  selectedId: number | null;
  onChange: (id: number | null) => void;
  deviceType: string;
}) {
  const [open, setOpen] = useState(false);
  const [filterDeviceType, setFilterDeviceType] = useState<string>(deviceType);
  const [filterFileType, setFilterFileType] = useState<string>("");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return scripts.filter((script) => {
      if (filterDeviceType && script.deviceType !== filterDeviceType) return false;
      if (filterFileType && script.fileType !== filterFileType) return false;
      if (
        search &&
        !script.name.toLowerCase().includes(search.toLowerCase()) &&
        !(script.category || "").toLowerCase().includes(search.toLowerCase())
      )
        return false;
      return true;
    });
  }, [scripts, filterDeviceType, filterFileType, search]);

  const openModal = () => {
    setFilterDeviceType(deviceType);
    setFilterFileType("");
    setSearch("");
    setOpen(true);
  };

  const selectScript = (id: number) => {
    onChange(id);
    setOpen(false);
  };

  const clearScript = () => {
    onChange(null);
  };

  const selected = scripts.find((s) => s.id === selectedId);

  const columns: ColumnsType<RpaScript> = [
    {
      title: "脚本名称",
      dataIndex: "name",
      key: "name",
      width: 200,
      render: (value: string) => <b>{value}</b>,
    },
    {
      title: "设备类型",
      dataIndex: "deviceType",
      key: "deviceType",
      width: 130,
      render: (value: string) => (
        <Tag color={value === "pc" ? "geekblue" : "purple"}>
          {deviceLabel(value)}
        </Tag>
      ),
    },
    {
      title: "脚本类型",
      dataIndex: "fileType",
      key: "fileType",
      width: 130,
      render: (value: string) => <Tag color="blue">{fileTypeLabel(value)}</Tag>,
    },
    {
      title: "分类",
      dataIndex: "category",
      key: "category",
      width: 120,
      render: (value: string) => value || "—",
    },
    {
      title: "参数",
      key: "params",
      width: 150,
      ellipsis: true,
      render: (_, row) => {
        const entries = paramEntries(row);
        return entries.length ? (
          <span className="text-12 muted">
            {entries.map(([key]) => key).join(", ")}
          </span>
        ) : (
          <span className="text-12 muted">无</span>
        );
      },
    },
    {
      title: "操作",
      key: "action",
      width: 80,
      render: (_, row) => (
        <Button type="link" onClick={() => selectScript(row.id)}>
          选择
        </Button>
      ),
    },
  ];

  return (
    <>
      <label className="data-table-form-item">
        <span className="data-table-form-label">
          RPA 脚本<b style={{ color: "var(--danger)" }}> *</b>
        </span>
        {selected ? (
          <Space>
            <Button onClick={openModal} style={{ textAlign: "left" }}>
              {selected.name}
              <span className="text-12 muted">{` (${fileTypeLabel(selected.fileType)})`}</span>
            </Button>
            <Button onClick={clearScript}>
              清空
            </Button>
          </Space>
        ) : (
          <Button onClick={openModal} block style={{ textAlign: "left" }}>
            点击选择脚本
          </Button>
        )}
      </label>

      <Modal
        open={open}
        title="选择 RPA 脚本"
        onCancel={() => setOpen(false)}
        footer={
          <Button onClick={() => setOpen(false)}>取消</Button>
        }
        width={900}
        destroyOnHidden
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Input.Search
            placeholder="搜索脚本名称或分类"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={setSearch}
            style={{ width: 220 }}
            allowClear
          />
          <Select
            placeholder="筛选设备类型"
            value={filterDeviceType || undefined}
            onChange={(value) => setFilterDeviceType(value || "")}
            allowClear
            style={{ width: 150 }}
            options={DEVICE_OPTIONS}
          />
          <Select
            placeholder="筛选脚本类型"
            value={filterFileType || undefined}
            onChange={(value) => setFilterFileType(value || "")}
            allowClear
            style={{ width: 150 }}
            options={Array.from(
              new Set(scripts.map((s) => s.fileType)),
            ).map((type) => ({ value: type, label: fileTypeLabel(type) }))}
          />
        </Space>
        <Table<RpaScript>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={filtered}
          pagination={false}
          scroll={{ y: 400 }}
        />
        <div className="text-12 muted" style={{ marginTop: 8 }}>
          共 {filtered.length} 个脚本（点击「选择」确认）
        </div>
      </Modal>
    </>
  );
}
