"use client";

import { PlusOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Checkbox,
  Input,
  Modal,
  Select,
  Space,
  Tooltip,
} from "antd";
import { useState } from "react";

/**
 * 结果承载表的选取层（大数据查询 / 潜客挖掘共用一份）。
 *
 * 一张表能不能当某个任务的结果表，判定只在后端 DataTableService 里做一次：
 * 当前账号有该表的新增权，且列已覆盖工具模板的全部列键（写行拒收未知列键）。
 * 所以这里只渲染后端给的候选清单，不再自己比对列。
 */

/** 可作为结果表写入目标的多维表格。 */
export type ResultTableOption = {
  id: number;
  name: string;
  rowCount: number;
};

export type ResultTableOptions = {
  /** 该工具结果表必须覆盖的列键，用来解释「为什么我建的表选不到」。 */
  requiredColumns: string[];
  /** 同一模板的中文列名。 */
  columnLabels: string[];
  /** 设置里记的默认结果表（未设置或已删除时为 null）。 */
  defaultTable: ResultTableOption | null;
  tables: ResultTableOption[];
};

function CreateTableModal({
  open,
  onCancel,
  onCreate,
  label,
  templateName,
  columnLabels,
  showSetDefault,
}: {
  open: boolean;
  onCancel: () => void;
  onCreate: (name: string, setDefault: boolean) => Promise<void>;
  /** 「结果表」/「线索表」。 */
  label: string;
  templateName: string;
  columnLabels: string[];
  showSetDefault: boolean;
}) {
  const { message } = App.useApp();
  const [name, setName] = useState("");
  const [setDefault, setSetDefault] = useState(false);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setName("");
    setSetDefault(false);
    onCancel();
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      message.warning(`请先填写${label}名称`);
      return;
    }
    setBusy(true);
    try {
      await onCreate(trimmed, showSetDefault ? setDefault : false);
      setName("");
      setSetDefault(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`新建一张${label}`}
      okText="创建"
      confirmLoading={busy}
      onCancel={close}
      onOk={() => void submit()}
    >
      <div className="text-12 muted" style={{ marginBottom: 10 }}>
        {columnLabels.length
          ? `新表会带上「${templateName}」模板的全部 ${columnLabels.length} 列：${columnLabels.join("、")}。`
          : `新表会带上「${templateName}」模板的全部列。`}
      </div>
      <Input
        autoFocus
        maxLength={60}
        value={name}
        placeholder={`${label}名称，例如「${templateName}-10月」`}
        onChange={(event) => setName(event.target.value)}
        onPressEnter={() => void submit()}
      />
      {showSetDefault ? (
        <Checkbox
          style={{ marginTop: 12 }}
          checked={setDefault}
          onChange={(event) => setSetDefault(event.target.checked)}
        >
          同时设为默认{label}（后续新任务默认写入这张表）
        </Checkbox>
      ) : null}
    </Modal>
  );
}

/**
 * 结果表选择器：候选下拉 +（给了 onCreate 才出现的）新建入口。
 * value 为 0 表示「跟随设置里的默认结果表」，界面按实际默认表名说明当前落点。
 */
export function TablePicker({
  options,
  loading = false,
  value,
  onChange,
  onCreate,
  label,
  templateName,
  showSetDefault = false,
  createHint,
  disabled,
  size,
  width = 260,
}: {
  options: ResultTableOptions | null;
  /** 候选仍在读取中：只有真在读的时候才显示「读取中…」，读失败要如实说读取失败。 */
  loading?: boolean;
  /** 0＝跟随设置里的默认结果表。 */
  value: number;
  onChange: (id: number) => void;
  /** 父层负责建表并刷新候选；返回新表 ID 时本组件把它选上。不传＝不提供新建入口。 */
  onCreate?: (name: string, setDefault: boolean) => Promise<number | null>;
  label: string;
  templateName: string;
  showSetDefault?: boolean;
  /** 新建按钮的说明：设置页是「保存后才成为默认表」，与任务页「不必设为默认」不同。 */
  createHint?: string;
  disabled?: boolean;
  size?: "small" | "middle" | "large";
  width?: number | string;
}) {
  const [creating, setCreating] = useState(false);
  const tables = options?.tables || [];
  const defaultId = options?.defaultTable?.id || 0;

  return (
    <>
      <Space size={6} wrap>
        <Select
          size={size}
          style={{ width }}
          disabled={disabled || !options}
          value={value || undefined}
          placeholder={
            options === null
              ? loading
                ? `${label}读取中…`
                : `${label}读取失败，请刷新重试`
              : tables.length
                ? `选择${label}`
                : `没有可写入的${label}`
          }
          notFoundContent={
            options && !tables.length
              ? `没有可写入的${label}：需要该表已带齐模板要求的 ${options.requiredColumns.length} 列，且你有新增权限`
              : undefined
          }
          onChange={(next) => onChange(Number(next))}
          options={tables.map((table) => ({
            value: table.id,
            label: `${table.name}${table.id === defaultId ? "（默认）" : ""} · ${table.rowCount} 行`,
          }))}
        />
        {onCreate ? (
          <Tooltip
            title={createHint || `按模板新建一张${label}，不必设为默认`}
          >
            <Button
              size={size}
              icon={<PlusOutlined aria-hidden />}
              disabled={disabled || !options}
              onClick={() => setCreating(true)}
            >
              新建{label}
            </Button>
          </Tooltip>
        ) : null}
        {options?.defaultTable && !value ? (
          <span className="text-12 muted">{`不选则写入默认${label}「${options.defaultTable.name}」`}</span>
        ) : null}
      </Space>
      <CreateTableModal
        open={creating}
        label={label}
        templateName={templateName}
        columnLabels={options?.columnLabels || []}
        showSetDefault={showSetDefault}
        onCancel={() => setCreating(false)}
        onCreate={async (name, setDefault) => {
          if (!onCreate) return;
          const id = await onCreate(name, setDefault);
          setCreating(false);
          if (id) onChange(id);
        }}
      />
    </>
  );
}
