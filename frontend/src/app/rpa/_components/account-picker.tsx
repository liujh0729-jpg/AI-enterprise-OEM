"use client";

import { Button, Input, Modal, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { type RpaAccount } from "./common";

/**
 * RPA 账号选择弹窗：从账号列表里多选，支持按平台、设备类型筛选和按用户名搜索。
 * 选中的账号以 Tag 形式显示在按钮下方，可逐个移除。
 */
export function AccountPicker({
  accounts,
  selectedIds,
  onChange,
}: {
  accounts: RpaAccount[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filterPlatform, setFilterPlatform] = useState<string>("");
  const [search, setSearch] = useState("");
  const [tempSelected, setTempSelected] = useState<number[]>(selectedIds);

  const filtered = useMemo(() => {
    return accounts.filter((account) => {
      if (filterPlatform && account.platform !== filterPlatform) return false;
      if (
        search &&
        !account.username.toLowerCase().includes(search.toLowerCase()) &&
        !account.platform.toLowerCase().includes(search.toLowerCase())
      )
        return false;
      return true;
    });
  }, [accounts, filterPlatform, search]);

  const openModal = () => {
    setTempSelected(selectedIds);
    setFilterPlatform("");
    setSearch("");
    setOpen(true);
  };

  const confirm = () => {
    onChange(tempSelected);
    setOpen(false);
  };

  const cancel = () => {
    setOpen(false);
  };

  const toggleAccount = (id: number) => {
    setTempSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const removeAccount = (id: number) => {
    onChange(selectedIds.filter((x) => x !== id));
  };

  const columns: ColumnsType<RpaAccount> = [
    {
      title: "平台",
      dataIndex: "platform",
      key: "platform",
      width: 120,
      render: (value: string) => <Tag color="blue">{value}</Tag>,
    },
    {
      title: "用户名",
      dataIndex: "username",
      key: "username",
      width: 150,
    },
    {
      title: "分组",
      dataIndex: "groupName",
      key: "groupName",
      width: 120,
      render: (value: string) => value || "—",
    },
  ];

  const selectedAccounts = accounts.filter((a) => selectedIds.includes(a.id));

  return (
    <>
      <label className="data-table-form-item">
        <span className="data-table-form-label">
          RPA 账号<b style={{ color: "var(--danger)" }}> *</b>
        </span>
        <Button onClick={openModal} block style={{ textAlign: "left" }}>
          {selectedIds.length
            ? `已选择 ${selectedIds.length} 个账号（点击修改）`
            : "点击选择账号"}
        </Button>
      </label>
      {selectedAccounts.length ? (
        <div
          className="text-12"
          style={{ gridColumn: "1 / -1", marginTop: -4, marginBottom: 8 }}
        >
          <Space wrap size={4}>
            {selectedAccounts.map((account) => (
              <Tag
                key={account.id}
                closable
                onClose={() => removeAccount(account.id)}
                color="blue"
              >
                {account.platform}/{account.username}
              </Tag>
            ))}
          </Space>
        </div>
      ) : null}

      <Modal
        open={open}
        title="选择 RPA 账号"
        onCancel={cancel}
        onOk={confirm}
        okText="确认选择"
        cancelText="取消"
        width={800}
        destroyOnHidden
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Input.Search
            placeholder="搜索平台或用户名"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={setSearch}
            style={{ width: 200 }}
            allowClear
          />
          <Select
            placeholder="筛选平台"
            value={filterPlatform || undefined}
            onChange={(value) => setFilterPlatform(value || "")}
            allowClear
            style={{ width: 150 }}
            options={Array.from(new Set(accounts.map((a) => a.platform))).map(
              (p) => ({ value: p, label: p }),
            )}
          />
        </Space>
        <Table<RpaAccount>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={filtered}
          pagination={false}
          scroll={{ y: 400 }}
          rowSelection={{
            selectedRowKeys: tempSelected,
            onChange: (keys) => setTempSelected(keys as number[]),
          }}
          onRow={(record) => ({
            // 勾选框自己会走 rowSelection.onChange，点击冒泡到行不能再翻一次，
            // 否则点一下等于选上又取消，界面上看着「点了没反应」。
            onClick: (event) => {
              const cell = (event.target as HTMLElement).closest(
                ".ant-table-selection-column",
              );
              if (cell) return;
              toggleAccount(record.id);
            },
            style: { cursor: "pointer" },
          })}
        />
        <div className="text-12 muted" style={{ marginTop: 8 }}>
          已选 {tempSelected.length} 个账号（确认后生效）
        </div>
      </Modal>
    </>
  );
}
