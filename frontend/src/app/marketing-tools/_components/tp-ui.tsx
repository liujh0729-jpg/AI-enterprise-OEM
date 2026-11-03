"use client";

import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { App, Button, Checkbox, Input, Modal, Select, Space, Spin, Table } from "antd";
import type { TableProps } from "antd";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { tpApi } from "@/api/tp";
import { EmptyState, Notice } from "@/components/ui/panel";
import {
  TP_MAPPING_FIELDS,
  TP_MAX_ROWS,
  isCostGatedAction,
  load,
  tpAccountText,
  tpActiveAccounts,
  tpCellText,
  tpDatasetLabel,
  tpProductLabel,
  tpRowKeys,
  type TpAccount,
  type TpColumnMap,
  type TpField,
  type TpMapping,
  type TpObject,
  type TpRows,
  type TpTable,
} from "./tp-common";

/**
 * 腾讯企点三张卡共用的界面原子：步骤标题、凭据选择、清单取数、键值编辑、
 * 列映射、花钱二次确认与名单批量执行。同一动作（例如「选名单来源表」）只在这里实现一次。
 */

export function TpStepTitle({
  index,
  title,
  extra,
}: {
  index: number;
  title: string;
  extra?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="panel-badge">{index}</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
      </div>
      {extra}
    </div>
  );
}

export function TpFieldLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-12 muted" style={{ marginBottom: 4 }}>
      {children}
    </div>
  );
}

/** 面板内的小节标题（不带步骤序号）：只读清单用这个。 */
export function TpSectionTitle({
  title,
  extra,
}: {
  title: string;
  extra?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 8,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
      {extra}
    </div>
  );
}

/** 读凭据：三张卡与连接设置面板共用一份清单（一个产品一套）。 */
export function useTpAccounts() {
  const [accounts, setAccounts] = useState<TpAccount[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const result = await load(tpApi.accounts());
    if (result.data) {
      setAccounts(result.data);
      setError("");
    } else {
      setError(result.message || "企点凭据读取失败");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { accounts, error, loading, reload };
}

/** 读名单来源表：列表接口已带回列与行数，不用再逐表读结构。 */
export function useTpTables() {
  const [tables, setTables] = useState<TpTable[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const result = await load(tpApi.tables());
    if (result.data) {
      setTables(result.data.filter((item) => item.can.read));
      setError("");
    } else {
      setError(result.message || "多维表格读取失败");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { tables, error, loading, reload };
}

/**
 * 凭据选择：该产品只有一条启用凭据时不渲染下拉（单选不出控件），
 * 一条也没有时只给一句去「连接设置」的指引。
 */
export function TpAccountPicker({
  accounts,
  error = "",
  product,
  value,
  onChange,
  onGoSettings,
  width = 300,
}: {
  accounts: TpAccount[] | null;
  error?: string;
  product: string;
  value: number;
  onChange: (id: number) => void;
  onGoSettings: () => void;
  width?: number | string;
}) {
  const usable = useMemo(
    () => (accounts ? tpActiveAccounts(accounts, product) : []),
    [accounts, product],
  );

  if (error) return <Notice variant="warn">{error}</Notice>;
  if (!accounts)
    return <span className="text-12 muted">企点凭据读取中…</span>;
  if (!usable.length)
    return (
      <Notice variant="warn">
        {`还没有可用的「${tpProductLabel(product)}」凭据。`}
        <Button type="link" onClick={onGoSettings} style={{ paddingInline: 6 }}>
          去配置
        </Button>
      </Notice>
    );
  if (usable.length === 1)
    return (
      <span className="text-12 muted">{`凭据：${tpAccountText(usable[0])}`}</span>
    );
  return (
    <Select
      style={{ width }}
      allowClear
      value={value || undefined}
      placeholder="默认使用第一个启用的凭据"
      onChange={(next) => onChange(Number(next || 0))}
      options={usable.map((item) => ({
        value: item.id,
        label: tpAccountText(item),
      }))}
    />
  );
}

/**
 * 企点清单：列按返回键自动生成（上游各产品字段名不同，联调前不写死），
 * 值收成一行文本；行尾动作由调用方给（查看详情、发起跟进等）。
 */
export function TpRowsTable({
  rows,
  loading = false,
  total,
  action,
  pageSize = 10,
  emptyText = "企点没有返回数据",
}: {
  rows: TpObject[];
  loading?: boolean;
  total?: number;
  action?: (row: TpObject) => ReactNode;
  pageSize?: number;
  emptyText?: string;
}) {
  const keys = useMemo(() => tpRowKeys(rows), [rows]);
  const columns = useMemo(() => {
    const list: NonNullable<TableProps<TpObject>["columns"]> = keys.map(
      (key) => ({
        title: key,
        dataIndex: key,
        ellipsis: true,
        render: (_: unknown, row: TpObject) => tpCellText(row[key]),
      }),
    );
    if (action) {
      list.push({
        title: "操作",
        width: 140,
        render: (_: unknown, row: TpObject) => action(row),
      });
    }
    return list;
  }, [keys, action]);

  if (loading)
    return (
      <div style={{ padding: 18, textAlign: "center" }}>
        <Spin />
      </div>
    );
  if (!rows.length) return <EmptyState text={emptyText} />;
  return (
    <div className="table-wrap">
      <Table<TpObject>
        rowKey={(_row, index) => String(index)}
        size="middle"
        dataSource={rows}
        columns={columns}
        scroll={{ x: "max-content" }}
        pagination={
          rows.length > pageSize
            ? {
                pageSize,
                showSizeChanger: false,
                showTotal:
                  total !== undefined && total > rows.length
                    ? () => `企点返回 ${total} 行，本页 ${rows.length} 行`
                    : undefined,
              }
            : false
        }
      />
    </div>
  );
}

/** 企点详情对象：按「字段名 + 值」逐行列出，嵌套值收成 JSON 文本。 */
export function TpObjectView({ value }: { value: TpObject }) {
  const entries = Object.entries(value);
  if (!entries.length) return <EmptyState text="企点没有返回内容" />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {entries.map(([key, item]) => (
        <div
          key={key}
          style={{ display: "flex", gap: 10, alignItems: "baseline" }}
        >
          <span className="text-12 muted" style={{ minWidth: 170 }}>
            {key}
          </span>
          <span
            className="text-12"
            style={{ minWidth: 0, flex: 1, wordBreak: "break-all" }}
          >
            {tpCellText(item, 4000)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 客户详情 / 分群详情这类单对象结果的统一弹窗：三张卡共用一份实现。 */
export function useTpObjectModal(width = 760) {
  const [value, setValue] = useState<{ title: string; data: TpObject } | null>(
    null,
  );
  const modal = (
    <Modal
      open={Boolean(value)}
      title={value?.title}
      footer={null}
      width={width}
      destroyOnHidden
      onCancel={() => setValue(null)}
    >
      {value ? <TpObjectView value={value.data} /> : null}
    </Modal>
  );
  return { open: setValue, modal };
}

export type TpPair = { key: string; value: string };


export function pairsToMap(pairs: TpPair[]): TpColumnMap {
  const out: TpColumnMap = {};
  for (const item of pairs) {
    const key = item.key.trim();
    const value = item.value.trim();
    if (key && value) out[key] = value;
  }
  return out;
}

export function mapToPairs(map: TpColumnMap): TpPair[] {
  return Object.entries(map).map(([key, value]) => ({ key, value }));
}

/**
 * 键值对编辑（列映射与上游报文共用一份）：一次加一条，左右两侧各自可以是
 * 下拉（值来自已知集合）或手输（字段名以企点文档为准，联调阶段只改这一处）。
 */
export function TpPairEditor({
  rows,
  onChange,
  keyLabel,
  valueLabel,
  keyOptions,
  valueOptions,
  addText,
  hint,
}: {
  rows: TpPair[];
  onChange: (next: TpPair[]) => void;
  keyLabel: string;
  valueLabel: string;
  /** 传了＝该侧用下拉，不传＝手输。 */
  keyOptions?: { value: string; label: string }[];
  valueOptions?: { value: string; label: string }[];
  addText: string;
  hint?: ReactNode;
}) {
  const patch = (index: number, next: Partial<TpPair>) =>
    onChange(
      rows.map((item, position) =>
        position === index ? { ...item, ...next } : item,
      ),
    );

  const renderSide = (
    item: TpPair,
    index: number,
    side: "key" | "value",
    options: { value: string; label: string }[] | undefined,
    label: string,
  ) =>
    options ? (
      <Select
        style={{ width: 260 }}
        value={item[side] || undefined}
        placeholder={`选择${label}`}
        showSearch
        optionFilterProp="label"
        onChange={(next) => patch(index, { [side]: String(next) })}
        options={options}
      />
    ) : (
      <Input
        style={{ width: 220 }}
        value={item[side]}
        maxLength={120}
        placeholder={label}
        onChange={(event) => patch(index, { [side]: event.target.value })}
      />
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.length ? (
        rows.map((item, index) => (
          <Space key={`pair-${index}`} size={8} wrap>
            {renderSide(item, index, "key", keyOptions, keyLabel)}
            {renderSide(item, index, "value", valueOptions, valueLabel)}
            <Button
              icon={<DeleteOutlined aria-hidden />}
              aria-label={`删除第 ${index + 1} 条`}
              onClick={() => onChange(rows.filter((_, p) => p !== index))}
            />
          </Space>
        ))
      ) : (
        <div className="text-12 muted">还没有内容，点下面的按钮逐条添加。</div>
      )}
      <div>
        <Button
          type="dashed"
          icon={<PlusOutlined aria-hidden />}
          onClick={() => onChange([...rows, { key: "", value: "" }])}
        >
          {addText}
        </Button>
      </div>
      {hint ? <div className="text-12 muted">{hint}</div> : null}
    </div>
  );
}

/**
 * 花钱/真实触达动作的二次确认：先显示本次人数，再勾选确认；勾选前不给执行。
 * 与后端 COST_GATED 同一份清单，漏勾时后端也会拒收。
 */
export function TpCostConfirm({
  rowCount,
  actionLabel,
  checked,
  onChange,
}: {
  rowCount: number;
  actionLabel: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div>
      <Checkbox
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      >
        {`我确认：${actionLabel}会对 ${rowCount.toLocaleString()} 行产生真实发送或额度消耗`}
      </Checkbox>
      <div className="text-12 muted" style={{ marginTop: 4 }}>
        {`单次最多 ${TP_MAX_ROWS.toLocaleString()} 行；未勾选不会提交给企点。`}
      </div>
    </div>
  );
}

/**
 * 单对象写入的唯一实现：上游字段名以企点接口文档为准，联调阶段用键值对逐条填，
 * 不把每个产品的字段写死成表单。调用方负责把选中的凭据与固定参数并入 payload。
 */
export function TpObjectWriter({
  index,
  title,
  actionLabel,
  accountId,
  submit,
  hint,
  confirmLabel,
}: {
  index: number;
  title: string;
  actionLabel: string;
  accountId: number;
  submit: (payload: TpObject) => Promise<string>;
  hint?: ReactNode;
  /** 真花钱 / 真触达的单对象动作：勾选后才允许执行（后端同一份闸）。 */
  confirmLabel?: string;
}) {
  const { message } = App.useApp();
  const [pairs, setPairs] = useState<TpPair[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const run = async () => {
    const payload = pairsToMap(pairs);
    if (!Object.keys(payload).length) {
      message.warning("请先填要提交给企点的字段");
      return;
    }
    if (confirmLabel && !confirmed) {
      message.warning(`请先勾选「${confirmLabel}」`);
      return;
    }
    setBusy(true);
    try {
      const text = await submit({
        accountId,
        ...payload,
        ...(confirmLabel ? { confirmCost: true } : {}),
      });
      message.success(text);
    } catch (error) {
      message.error((error as Error).message || "提交失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <TpStepTitle index={index} title={title} />
      <TpPairEditor
        rows={pairs}
        onChange={setPairs}
        keyLabel="企点字段"
        valueLabel="值"
        addText="添加字段"
        hint={hint || "字段名以上游接口文档为准；固定参数（凭据、类型等）已自动带上。"}
      />
      {confirmLabel ? (
        <div style={{ marginTop: 10 }}>
          <Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}>
            {confirmLabel}
          </Checkbox>
        </div>
      ) : null}
      <div
        style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}
      >
        <Button type="primary" loading={busy} onClick={() => void run()}>
          {`执行${actionLabel}`}
        </Button>
      </div>
    </section>
  );
}

/**
 * 清单类只读面板的统一外壳：关键词 + 附加条件 + 分页，取数交给调用方
 * （GET 走 query、POST 走 body 都在 loadRows 里收口，面板只管读数与翻页）。
 */
export function TpReadPanel({
  title,
  tip,
  loadRows,
  filters = [],
  reloadKey = "",
  action,
  pageSize = 20,
  emptyText = "企点没有返回数据",
}: {
  title: string;
  tip?: ReactNode;
  loadRows: (
    input: { page: number; pageSize: number; keyword: string } & TpObject,
  ) => Promise<TpRows | null>;
  filters?: { name: string; label: string; placeholder?: string }[];
  /** 卡片级上下文变了要重查（例如企微企业ID/应用ID 提交后）。 */
  reloadKey?: string;
  action?: (row: TpObject) => ReactNode;
  pageSize?: number;
  emptyText?: string;
}) {
  const [keyword, setKeyword] = useState("");
  const [draftKeyword, setDraftKeyword] = useState("");
  const [extra, setExtra] = useState<TpObject>({});
  const [page, setPage] = useState(1);
  const [stamp, setStamp] = useState(0);
  const [rows, setRows] = useState<TpObject[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(
    async () => {
      setLoading(true);
      const result = await load(loadRows({ page, pageSize, keyword, ...extra }));
      if (result.data) {
        setRows(result.data.rows || []);
        setTotal(result.data.total || 0);
        setError("");
      } else {
        setRows([]);
        setTotal(0);
        setError(result.message || "企点数据读取失败");
      }
      setLoading(false);
    },
    [loadRows, page, pageSize, keyword, extra],
  );

  useEffect(() => {
    void reload();
  }, [reload, stamp, reloadKey]);

  const query = () => {
    setKeyword(draftKeyword);
    setPage(1);
    setStamp((value) => value + 1);
  };

  return (
    <div>
      <TpSectionTitle
        title={title}
        extra={
          <Button
            icon={<ReloadOutlined aria-hidden />}
            loading={loading}
            onClick={() => setStamp((value) => value + 1)}
          >
            刷新
          </Button>
        }
      />
      {tip ? (
        <div className="text-12 muted" style={{ marginBottom: 8 }}>
          {tip}
        </div>
      ) : null}
      <Space size={8} wrap style={{ marginBottom: 10 }}>
        {filters.map((item) => (
          <Input
            key={item.name}
            style={{ width: 200 }}
            placeholder={item.placeholder || item.label}
            maxLength={120}
            value={String(extra[item.name] ?? "")}
            onChange={(event) =>
              setExtra((prev) => ({
                ...prev,
                [item.name]: event.target.value,
              }))
            }
          />
        ))}
        <Input
          style={{ width: 220 }}
          placeholder="关键词，回车查询"
          maxLength={120}
          value={draftKeyword}
          onChange={(event) => setDraftKeyword(event.target.value)}
          onPressEnter={query}
        />
        <Button icon={<SearchOutlined aria-hidden />} onClick={query}>
          查询
        </Button>
        {total > rows.length ? (
          <span className="text-12 muted">{`共 ${total} 行`}</span>
        ) : null}
      </Space>
      {error ? (
        <div style={{ marginBottom: 8 }}>
          <Notice variant="warn">{error}</Notice>
        </div>
      ) : null}
      {page > 1 || total > pageSize ? (
        <Space size={8} style={{ marginBottom: 8 }}>
          <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            上一页
          </Button>
          <span className="text-12 muted">{`第 ${page} 页`}</span>
          <Button
            disabled={page * pageSize >= total}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </Space>
      ) : null}
      <TpRowsTable
        rows={rows}
        loading={loading}
        total={total}
        action={action}
        emptyText={emptyText}
      />
    </div>
  );
}

/** 多维表格的下拉（名单来源 / 结果承载共用一份）。 */
export function TpTableSelect({
  tables,
  loading,
  error,
  value,
  onChange,
  label,
  optional = false,
  width = 360,
}: {
  tables: TpTable[] | null;
  loading: boolean;
  error: string;
  value: number;
  onChange: (id: number) => void;
  label: string;
  /** true＝可以不选（不选的后果由调用方解释，例如导出只记台账）。 */
  optional?: boolean;
  width?: number | string;
}) {
  return (
    <Space size={8} wrap>
      <Select
        style={{ width }}
        showSearch
        optionFilterProp="label"
        allowClear={optional}
        value={value || undefined}
        placeholder={
          loading
            ? `${label}读取中…`
            : error
              ? `${label}读取失败，请刷新重试`
              : tables?.length
                ? `选择${label}`
                : `没有可读的${label}`
        }
        onChange={(next) => onChange(Number(next || 0))}
        options={(tables || []).map((item) => ({
          value: item.id,
          label: `${item.name} · ${item.rowCount} 行`,
        }))}
      />
    </Space>
  );
}

/** 表列下拉的候选：列名给人看，值用 fieldKey（提交给后端的就是它）。 */
export function fieldOptions(
  fields: TpField[],
): { value: string; label: string }[] {
  return fields.map((field) => ({ value: field.fieldKey, label: field.name }));
}

/** 按字段名猜列：先精确，再忽略大小写与下划线包含，猜不到就留空让人手选。 */
export function guessFieldKey(fields: TpField[], hints: string[]): string {
  const normalized = (value: string) => value.toLowerCase().replace(/_/g, "");
  for (const hint of hints) {
    const want = normalized(hint);
    const exact = fields.find(
      (field) =>
        normalized(field.fieldKey) === want || normalized(field.name) === want,
    );
    if (exact) return exact.fieldKey;
  }
  for (const hint of hints) {
    const want = normalized(hint);
    const loose = fields.find(
      (field) =>
        normalized(field.fieldKey).includes(want) ||
        normalized(field.name).includes(want),
    );
    if (loose) return loose.fieldKey;
  }
  return "";
}

/**
 * 名单批量执行的唯一实现：选来源表 → 列映射（可记住）→ 卡片给的附加参数 →
 * 花钱动作先显示人数并勾选 → 提交。行数与 1 万上限都在这里拦一次，
 * 后端还会按同一份清单再校验一次。
 */
export function TpBatchForm({
  index,
  action,
  actionLabel,
  datasetKey,
  requiredKeys = [],
  accountId,
  params,
  paramsReady = true,
  paramsEditor,
  submit,
  onDone,
}: {
  /** 卡片内的第几步（面板里的 ① ② ③）。 */
  index: number;
  /** 后端操作 ID（花钱判定按它，与后端 COST_GATED 同一份清单）。 */
  action: string;
  actionLabel: string;
  datasetKey: string;
  /** 必须映射上的企点字段（后端会拒收的那些）。 */
  requiredKeys?: string[];
  /** 0＝用该产品第一个启用的凭据。 */
  accountId: number;
  /** 卡片自己收集的附加参数（模板ID、计划ID、分群ID等）。 */
  params: TpObject;
  /** 附加参数没填齐时不给执行，并说明缺什么。 */
  paramsReady?: boolean;
  paramsEditor?: ReactNode;
  /** 返回一句结果文案（任务已建 / 写入了多少条）。 */
  submit: (body: TpObject) => Promise<string>;
  onDone?: (message: string) => void;
}) {
  const { message } = App.useApp();
  const { tables, error: tablesError, loading, reload } = useTpTables();
  const [tableId, setTableId] = useState(0);
  const [pairs, setPairs] = useState<TpPair[]>([]);
  const [confirmCost, setConfirmCost] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mappings, setMappings] = useState<TpMapping[]>([]);

  const costGated = isCostGatedAction(action);
  const table = useMemo(
    () => (tables || []).find((item) => item.id === tableId) || null,
    [tables, tableId],
  );
  const options = useMemo(
    () => (table ? fieldOptions(table.fields) : []),
    [table],
  );

  const reloadMappings = useCallback(async () => {
    const result = await load(tpApi.mappings());
    if (result.data) setMappings(result.data);
  }, []);

  useEffect(() => {
    void reloadMappings();
  }, [reloadMappings]);

  /** 换表时：先用记住的映射，没有就按默认字段清单铺一遍并尽量猜列。 */
  const selectTable = useCallback(
    (id: number) => {
      setTableId(id);
      setConfirmCost(false);
      const target = (tables || []).find((item) => item.id === id);
      if (!target) return;
      const remembered = mappings.find(
        (item) => item.datasetKey === datasetKey && item.tableId === id,
      );
      if (remembered) {
        setPairs(mapToPairs(remembered.columnMap as TpColumnMap));
        return;
      }
      const preset = TP_MAPPING_FIELDS[datasetKey] || [];
      setPairs(
        preset.map((item) => ({
          key: item.key,
          value: guessFieldKey(target.fields, [item.key, item.label]),
        })),
      );
    },
    [tables, mappings, datasetKey],
  );

  useEffect(() => {
    if (!tables || tables.length !== 1 || tableId) return;
    selectTable(tables[0].id);
  }, [tables, tableId, selectTable]);

  const mapping = pairsToMap(pairs);
  const rowCount = table?.rowCount || 0;
  const overLimit = rowCount > TP_MAX_ROWS;
  const missingRequired = requiredKeys.filter((key) => !mapping[key]);
  const halfFilled = pairs.some(
    (item) =>
      (item.key.trim() && !item.value.trim()) ||
      (!item.key.trim() && item.value.trim()),
  );
  const canSubmit =
    Boolean(table) &&
    rowCount > 0 &&
    !halfFilled &&
    !missingRequired.length &&
    !overLimit &&
    paramsReady &&
    (!costGated || confirmCost);

  const saveMapping = async () => {
    if (!table || !Object.keys(mapping).length) {
      message.warning("先选表并填好映射，才能记住");
      return;
    }
    try {
      await tpApi.saveMapping({
        body: {
          datasetKey,
          tableId: table.id,
          tableName: table.name,
          columnMap: mapping,
        },
      });
      message.success("列映射已记住，下次执行同一动作自动带出");
      await reloadMappings();
    } catch (error) {
      message.error((error as Error).message || "映射保存失败");
    }
  };

  const execute = async () => {
    if (!table) return;
    if (halfFilled) {
      message.warning("还有映射只填了一半，请把字段名和来源列都补齐");
      return;
    }
    if (missingRequired.length) {
      message.warning(`请先映射：${missingRequired.join("、")}`);
      return;
    }
    if (costGated && !confirmCost) {
      message.warning(`请先勾选「${actionLabel}会产生真实发送或额度消耗」`);
      return;
    }
    setSubmitting(true);
    try {
      const text = await submit({
        accountId,
        tableId: table.id,
        tableName: table.name,
        mapping,
        confirmCost,
        ...params,
      });
      message.success(text);
      onDone?.(text);
    } catch (error) {
      message.error((error as Error).message || "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section>
      <TpStepTitle
        index={index}
        title={`${actionLabel}（名单来自多维表格）`}
        extra={
          <Button
            icon={<ReloadOutlined aria-hidden />}
            onClick={() => void reload()}
          >
            刷新表
          </Button>
        }
      />
      <TpTableSelect
        tables={tables}
        loading={loading}
        error={tablesError}
        value={tableId}
        onChange={selectTable}
        label="名单表"
      />
      {table ? (
        <div className="text-12 muted" style={{ marginTop: 6 }}>
          {`${table.fields.length} 列 · ${table.rowCount.toLocaleString()} 行${
            table.owner ? "" : "（他人共享的表）"
          }`}
          {overLimit
            ? `；超过单次上限 ${TP_MAX_ROWS.toLocaleString()} 行，请先拆表`
            : ""}
        </div>
      ) : null}

      {paramsEditor ? (
        <div style={{ marginTop: 12 }}>{paramsEditor}</div>
      ) : null}

      <div style={{ marginTop: 12 }}>
        <TpFieldLabel>
          {`列映射（${tpDatasetLabel(datasetKey)}：企点字段 ← 表格列）`}
        </TpFieldLabel>
        <TpPairEditor
          rows={pairs}
          onChange={setPairs}
          keyLabel="企点字段"
          valueLabel="来源列"
          valueOptions={options}
          addText="添加映射"
          hint={
            requiredKeys.length
              ? `必映射：${requiredKeys.join("、")}。字段名以企点接口文档为准，可逐条改。`
              : "字段名以企点接口文档为准，可逐条改。"
          }
        />
        <div style={{ marginTop: 8 }}>
          <Button onClick={() => void saveMapping()}>记住这套映射</Button>
        </div>
      </div>

      {costGated ? (
        <div style={{ marginTop: 12 }}>
          <TpCostConfirm
            rowCount={rowCount}
            actionLabel={actionLabel}
            checked={confirmCost}
            onChange={setConfirmCost}
          />
        </div>
      ) : null}

      <div
        style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}
      >
        <Button
          type="primary"
          loading={submitting}
          disabled={!canSubmit}
          onClick={() => void execute()}
        >
          {`执行${actionLabel}`}
        </Button>
      </div>
      {!paramsReady ? (
        <div className="text-12 muted" style={{ marginTop: 6 }}>
          上面的必填项还没补齐，补齐后才能执行。
        </div>
      ) : null}
    </section>
  );
}
