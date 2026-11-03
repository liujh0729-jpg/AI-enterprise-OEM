"use client";

import { InboxOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Table,
  Upload,
} from "antd";
import type { FormInstance } from "antd";
import type { ReactNode } from "react";
import { useState } from "react";
import { uploadDigitalAsset } from "@/api/content";
import { RowListEditor, type RowField } from "@/components/row-list-editor";
import type {
  OaAttachment,
  OaCondition,
  OaField,
  OaLinkSearchItem,
  OaLinkTarget,
  OaListColumn,
} from "@enterprise/contracts";
import {
  AttachmentList,
  LinkTargetLabel,
  MemberSelect,
  memberNameOf,
  money,
  oaError,
  sizeLabel,
  type OaMember,
  type OaOrgQuery,
} from "./oa-common";
import { RefPicker } from "./link-picker";

/**
 * OA 动态表单：字段类型与条件必填都由模板配置决定，所以这里的取值/校验口径
 * 必须与后端 `backend/src/oa/oa.helpers.ts` 一字不差（客户端 + 服务端各校验一次）。
 * 明细子表复用全站唯一的逐条添加组件 RowListEditor，附件走数字资产，业务对象走 RefPicker。
 */

const numOf = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** 与后端 common/api.ts 的 text() 同口径：对象不算文本，数组用逗号拼。 */
const textOf = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => textOf(item)).filter((item) => item !== "").join(",");
  }
  return "";
};

const arrayOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const rowOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** ref 字段是否真的选到了对象：带 id 才算，空壳不算。 */
const refIdOf = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.map((item) => refIdOf(item)).find((item) => item) || "";
  }
  const row = rowOf(value);
  const fromRow = textOf(row.id ?? row.targetId).trim();
  return fromRow || textOf(value).trim();
};

/** 主金额：顶层金额字段优先，其次明细子表金额列合计（与后端 amountOf 同序）。 */
export function oaAmountOf(
  formData: Record<string, unknown>,
  fields: OaField[],
): number {
  const round = (value: number) => Math.round(value * 100) / 100;
  for (const field of fields) {
    if (field.type !== "amount") continue;
    const direct = numOf(formData[field.key], NaN);
    if (Number.isFinite(direct) && direct !== 0) return round(direct);
  }
  let total = 0;
  for (const field of fields) {
    if (field.type !== "list") continue;
    const amountKeys = field.columns
      .filter((column) => column.type === "amount")
      .map((column) => column.key);
    for (const item of arrayOf(formData[field.key])) {
      const row = rowOf(item);
      for (const key of amountKeys) total += numOf(row[key]);
    }
  }
  return Math.round(total * 100) / 100;
}

/** 条件求值：只用 amount 与选择类字段，不做任意表达式（与后端 conditionHit 同口径）。 */
export function oaConditionHit(
  condition: OaCondition | null | undefined,
  resolveValue: (field: string) => unknown,
  amount: number,
): boolean {
  if (!condition || !condition.field) return true;
  const left = condition.field === "amount" ? amount : resolveValue(condition.field);
  const right = condition.value;
  const op = condition.op;
  if (op === "contains") return textOf(left).includes(textOf(right));
  const leftNumber = numOf(left, NaN);
  const rightNumber = numOf(right, NaN);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    switch (op) {
      case "gt":
        return leftNumber > rightNumber;
      case "gte":
        return leftNumber >= rightNumber;
      case "lt":
        return leftNumber < rightNumber;
      case "lte":
        return leftNumber <= rightNumber;
      case "neq":
        return leftNumber !== rightNumber;
      default:
        return leftNumber === rightNumber;
    }
  }
  const leftText = textOf(left);
  const rightText = textOf(right);
  const order = leftText.localeCompare(rightText);
  switch (op) {
    case "gt":
      return order > 0;
    case "gte":
      return order >= 0;
    case "lt":
      return order < 0;
    case "lte":
      return order <= 0;
    case "neq":
      return leftText !== rightText;
    default:
      return leftText === rightText;
  }
}

const isWide = (type: OaField["type"]) =>
  type === "textarea" || type === "list" || type === "attachment" || type === "ref";

/** 单字段是否已填：按类型判空，与后端 missingRequired 同一套规则。 */
export function oaFieldFilled(field: OaField, value: unknown): boolean {
  switch (field.type) {
    case "list":
    case "multiSelect":
    case "attachment":
      return arrayOf(value).length > 0;
    case "checkbox":
      return value === true;
    case "number":
    case "amount":
      return Number.isFinite(numOf(value, NaN));
    case "ref":
      return Boolean(refIdOf(value));
    default:
      return textOf(value).trim() !== "";
  }
}

/** 提交校验：只按可见字段判必填，草稿不校验。 */
export function oaMissingRequired(
  fields: OaField[],
  formData: Record<string, unknown>,
  amount = oaAmountOf(formData, fields),
): string[] {
  const missing: string[] = [];
  for (const field of fields) {
    const visible = oaConditionHit(field.visibleWhen, (name) => formData[name], amount);
    if (!visible || !field.required) continue;
    if (!oaFieldFilled(field, formData[field.key])) missing.push(field.label);
  }
  return missing;
}

/** 当前表单值下可见的字段（隐藏字段既不渲染也不参与必填）。 */
export function oaVisibleFields(
  fields: OaField[],
  formData: Record<string, unknown>,
): OaField[] {
  const amount = oaAmountOf(formData, fields);
  return fields.filter((field) =>
    oaConditionHit(field.visibleWhen, (name) => formData[name], amount),
  );
}

/** formData（后端原样 JSON）→ antd Form 初值。 */
export function oaInitialValues(
  fields: OaField[],
  formData?: Record<string, unknown>,
): Record<string, unknown> {
  const data = formData || {};
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const value = data[field.key] ?? field.default;
    switch (field.type) {
      case "number":
      case "amount": {
        const parsed = numOf(value, NaN);
        values[field.key] = Number.isFinite(parsed) ? parsed : undefined;
        break;
      }
      case "checkbox":
        values[field.key] = value === true;
        break;
      case "multiSelect":
        values[field.key] = arrayOf(value).map((item) => textOf(item)).filter(Boolean);
        break;
      case "list":
        values[field.key] = arrayOf(value).map((item) => cleanListRow(field.columns, item));
        break;
      case "attachment":
        values[field.key] = arrayOf(value) as OaAttachment[];
        break;
      case "ref":
        values[field.key] = refIdOf(value) ? (rowOf(value) as OaLinkSearchItem) : null;
        break;
      default:
        values[field.key] = textOf(value);
    }
  }
  return values;
}

/** 明细行只保留配置里的列，数字/金额列转成数字。 */
function cleanListRow(columns: OaListColumn[], value: unknown): Record<string, unknown> {
  const source = rowOf(value);
  const row: Record<string, unknown> = {};
  for (const column of columns) {
    const raw = source[column.key];
    if (column.type === "number" || column.type === "amount") {
      const parsed = numOf(raw, NaN);
      row[column.key] = Number.isFinite(parsed) ? parsed : null;
    } else if (column.type === "date") {
      row[column.key] = textOf(raw).trim().slice(0, 10);
    } else {
      row[column.key] = textOf(raw).trim();
    }
  }
  return row;
}

/** antd Form 值 → 落库 formData：每个字段都给明确空值，避免旧值残留。 */
export function oaFormDataOf(
  fields: OaField[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.key];
    switch (field.type) {
      case "number":
      case "amount": {
        const parsed = numOf(value, NaN);
        data[field.key] = Number.isFinite(parsed) ? parsed : null;
        break;
      }
      case "checkbox":
        data[field.key] = value === true;
        break;
      case "multiSelect":
        data[field.key] = arrayOf(value).map((item) => textOf(item)).filter(Boolean);
        break;
      case "list":
        data[field.key] = arrayOf(value).map((item) => cleanListRow(field.columns, item));
        break;
      case "attachment":
        data[field.key] = arrayOf(value) as OaAttachment[];
        break;
      case "ref":
        data[field.key] = refIdOf(value) ? (rowOf(value) as OaLinkSearchItem) : null;
        break;
      default:
        data[field.key] = textOf(value).trim();
    }
  }
  return data;
}

const ASSET_TYPE_BY_EXT: Record<string, string> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  bmp: "image",
  mp4: "video",
  mov: "video",
  webm: "video",
  avi: "video",
  mkv: "video",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  aac: "audio",
  flac: "audio",
};

const assetTypeOf = (fileName: string) => {
  const ext = fileName.toLowerCase().split(".").pop() || "";
  return ASSET_TYPE_BY_EXT[ext] || "file";
};

const nameStem = (fileName: string) => fileName.replace(/\.[^.]+$/, "");

/** 附件上传（进数字资产）：申请单字段与评论框共用这一份实现。 */
export function AttachmentField({
  value,
  onChange,
  disabled,
}: {
  value?: unknown;
  onChange?: (next: OaAttachment[]) => void;
  disabled?: boolean;
}) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const items = (Array.isArray(value) ? value : []) as OaAttachment[];

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const asset = await uploadDigitalAsset(file, {
        type: assetTypeOf(file.name),
        name: nameStem(file.name),
      });
      onChange?.([
        ...items,
        {
          id: String(asset.id),
          name: asset.name || file.name,
          size: asset.fileSize,
          url: asset.url,
        },
      ]);
      message.success(`已上传并登记到数字资产：${file.name}`);
    } catch (error) {
      message.error(oaError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Space direction="vertical" size={6} style={{ width: "100%" }}>
      <Upload
        multiple
        showUploadList={false}
        disabled={busy || disabled}
        beforeUpload={(file) => {
          void upload(file);
          return false;
        }}
      >
        <Button icon={<InboxOutlined aria-hidden />} loading={busy} disabled={disabled}>
          上传附件
        </Button>
      </Upload>
      {items.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {items.map((item, index) => (
            <div key={`${item.id}-${index}`} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span>{item.name}</span>
              <span className="muted text-12">{sizeLabel(item.size)}</span>
              <Button
                type="link"
                danger
                disabled={disabled}
                onClick={() =>
                  onChange?.(items.filter((_, row) => row !== index))
                }
              >
                移除
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <span className="muted text-12">附件存入数字资产，逐张上传。</span>
      )}
    </Space>
  );
}

function ListField({
  field,
  value,
  onChange,
}: {
  field: OaField;
  value?: unknown;
  onChange?: (next: Record<string, unknown>[]) => void;
}) {
  const rows = (Array.isArray(value) ? value : []).map((item) => rowOf(item));
  const rowFields: RowField[] = field.columns.map((column) => ({
    name: column.key,
    label: column.label,
    type:
      column.type === "select"
        ? "select"
        : column.type === "number" || column.type === "amount"
          ? "number"
          : column.type === "date"
            ? "date"
            : "text",
    options: column.options,
    required: column.required,
    placeholder: column.type === "date" ? "YYYY-MM-DD" : undefined,
  }));
  const setRows = (next: Record<string, unknown>[]) => onChange?.(next);

  return (
    <RowListEditor
      title={field.label}
      tip={field.help || "一次只添加一条，明细金额会自动汇总成单据金额。"}
      addText={`＋ 添加${field.label}`}
      emptyText={`还没有${field.label}，点「添加」逐条录入。`}
      fields={rowFields}
      rows={rows.map((row, index) => ({ ...row, id: String(index) }))}
      columns={field.columns.map((column) => ({
        title: column.label,
        dataIndex: column.key,
        render: (row: Record<string, unknown>) =>
          column.type === "amount"
            ? money(row[column.key] || 0)
            : textOf(row[column.key]) || "—",
      }))}
      onAdd={async (row) => setRows([...rows, cleanListRow(field.columns, row)])}
      onUpdate={async (rowId, patch) =>
        setRows(
          rows.map((row, index) =>
            String(index) === rowId ? cleanListRow(field.columns, patch) : row,
          ),
        )
      }
      onRemove={async (rowId) =>
        setRows(rows.filter((_, index) => String(index) !== rowId))
      }
    />
  );
}

/**
 * Form.Item 通过克隆子元素注入 value/onChange，中间包一层组件时必须原样转发，
 * 否则输入进不了表单。
 */
function FieldControl({
  field,
  members,
  targets,
  org,
  disabled,
  value,
  checked,
  id,
  onChange,
}: {
  field: OaField;
  members: OaMember[];
  targets: OaLinkTarget[];
  org: OaOrgQuery;
  disabled?: boolean;
  value?: unknown;
  checked?: boolean;
  id?: string;
  onChange?: (...args: unknown[]) => void;
}) {
  const shared = {
    id,
    disabled,
    onChange: onChange as ((...args: unknown[]) => void) | undefined,
  };
  const options = field.options.map((item) => ({ value: item.value, label: item.label }));
  switch (field.type) {
    case "textarea":
      return <Input.TextArea {...shared} rows={3} value={textOf(value)} placeholder={field.placeholder} />;
    case "number":
      return <InputNumber {...shared} value={value as number | string | null} style={{ width: "100%" }} />;
    case "amount":
      return (
        <InputNumber
          {...shared}
          value={value as number | string | null}
          precision={2}
          prefix="￥"
          style={{ width: "100%" }}
        />
      );
    case "date":
      return <Input {...shared} type="date" value={textOf(value)} />;
    case "datetime":
      return <Input {...shared} type="datetime-local" value={textOf(value)} />;
    case "select":
      return (
        <Select
          {...shared}
          allowClear
          showSearch
          optionFilterProp="label"
          value={textOf(value) || undefined}
          options={options}
          placeholder={field.placeholder}
        />
      );
    case "multiSelect":
      return (
        <Select
          {...shared}
          mode="multiple"
          allowClear
          value={arrayOf(value).map((item) => textOf(item)).filter(Boolean)}
          options={options}
          placeholder={field.placeholder}
        />
      );
    case "radio":
      return <Radio.Group {...shared} value={textOf(value) || undefined} options={options} />;
    case "checkbox":
      return <Checkbox {...shared} checked={checked} />;
    case "user":
      return (
        <MemberSelect
          members={members}
          value={textOf(value) || undefined}
          onChange={(next) => onChange?.(next as string)}
          placeholder={field.placeholder || "选择成员"}
          disabled={disabled}
          style={{ width: "100%" }}
        />
      );
    case "attachment":
      return (
        <AttachmentField
          value={value}
          onChange={(next) => onChange?.(next)}
          disabled={disabled}
        />
      );
    case "ref":
      return (
        <RefPicker
          targets={targets}
          org={org}
          refTarget={field.refTarget}
          value={(rowOf(value).id ? (rowOf(value) as unknown as OaLinkSearchItem) : null)}
          onChange={(next) => onChange?.(next)}
          disabled={disabled}
        />
      );
    case "list":
      return <ListField field={field} value={value} onChange={(next) => onChange?.(next)} />;
    default:
      return <Input {...shared} value={textOf(value)} placeholder={field.placeholder} />;
  }
}

/** 可编辑的字段区：放在 `<Form form={form}>` 内使用，隐藏字段不渲染也不参与必填。 */
export function OaFieldItems({
  fields,
  members,
  targets,
  org,
  disabled,
}: {
  fields: OaField[];
  members: OaMember[];
  targets: OaLinkTarget[];
  org: OaOrgQuery;
  disabled?: boolean;
}) {
  return (
    <div className="form-2col">
      {fields.map((field) => (
        <Form.Item key={field.key} noStyle shouldUpdate>
          {(form: FormInstance) => {
            const values = form.getFieldsValue(true) as Record<string, unknown>;
            if (!oaVisibleFields(fields, values).some((item) => item.key === field.key)) {
              return null;
            }
            return (
              <Form.Item
                name={field.key}
                label={
                  <span>
                    {field.label}
                    {field.required ? <span style={{ color: "#f53f3f" }}> *</span> : null}
                  </span>
                }
                extra={field.help ? <span className="muted text-12">{field.help}</span> : undefined}
                rules={
                  field.required
                    ? [
                        {
                          validator: (_rule, value) =>
                            oaFieldFilled(field, value)
                              ? Promise.resolve()
                              : Promise.reject(new Error(`请填写${field.label}`)),
                        },
                      ]
                    : undefined
                }
                valuePropName={field.type === "checkbox" ? "checked" : undefined}
                style={isWide(field.type) ? { gridColumn: "1 / -1" } : undefined}
              >
                <FieldControl
                  field={field}
                  members={members}
                  targets={targets}
                  org={org}
                  disabled={disabled}
                />
              </Form.Item>
            );
          }}
        </Form.Item>
      ))}
    </div>
  );
}

function listCell(column: OaListColumn, row: Record<string, unknown>) {
  const value = row[column.key];
  if (column.type === "amount") return money(numOf(value));
  if (column.type === "number") return textOf(value) || "—";
  return textOf(value) || "—";
}

function FieldValue({
  field,
  value,
  members,
}: {
  field: OaField;
  value: unknown;
  members: OaMember[];
}) {
  switch (field.type) {
    case "checkbox":
      return <>{value === true ? "是" : "否"}</>;
    case "amount":
      return <>{Number.isFinite(numOf(value, NaN)) ? money(numOf(value)) : "—"}</>;
    case "number":
      return <>{Number.isFinite(numOf(value, NaN)) ? textOf(value) : "—"}</>;
    case "multiSelect":
      return <>{arrayOf(value).map((item) => textOf(item)).filter(Boolean).join("、") || "—"}</>;
    case "user": {
      const userId = textOf(value);
      return <>{userId ? memberNameOf(members, userId) : "—"}</>;
    }
    case "attachment": {
      const items = arrayOf(value) as OaAttachment[];
      return <AttachmentList items={items} />;
    }
    case "ref": {
      const row = rowOf(value);
      if (!refIdOf(value)) return <span className="muted text-12">—</span>;
      return (
        <>
          <span className="muted text-12">
            <LinkTargetLabel targetType={textOf(row.targetType)} />
          </span>
          <span style={{ marginLeft: 6 }}>{textOf(row.title) || textOf(row.id)}</span>
        </>
      );
    }
    case "list": {
      const rows = arrayOf(value).map((item, index) => ({ ...rowOf(item), id: String(index) }));
      if (!rows.length) return <span className="muted text-12">无明细</span>;
      return (
        <Table<Record<string, unknown>>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={rows}
          columns={field.columns.map((column) => ({
            title: column.label,
            dataIndex: column.key,
            render: (_: unknown, row: Record<string, unknown>) => listCell(column, row),
          }))}
        />
      );
    }
    case "textarea":
      return (
        <span style={{ whiteSpace: "pre-wrap" }}>{textOf(value).trim() || "—"}</span>
      );
    case "datetime":
      return <>{textOf(value).replace("T", " ") || "—"}</>;
    default:
      return <>{textOf(value).trim() || "—"}</>;
  }
}

/** 只读渲染：单据详情、审批弹窗与流程预览共用一份，隐藏字段不显示。 */
export function OaFormView({
  fields,
  formData,
  members = [],
}: {
  fields: OaField[];
  formData: Record<string, unknown>;
  members?: OaMember[];
}) {
  const visible = oaVisibleFields(fields, formData || {});
  if (!visible.length) return <span className="muted text-12">该模板没有填写项</span>;
  return (
    <div className="form-2col">
      {visible.map((field) => (
        <div
          key={field.key}
          style={isWide(field.type) ? { gridColumn: "1 / -1" } : undefined}
        >
          <div className="field-label">{field.label}</div>
          <div style={{ marginBottom: 12 }}>
            <FieldValue field={field} value={formData?.[field.key]} members={members} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 流程预览要显示主金额，表单页与详情页都从这里取。 */
export function oaAmountLabel(formData: Record<string, unknown>, fields: OaField[]): ReactNode {
  const amount = oaAmountOf(formData, fields);
  return amount ? `￥${money(amount)}` : "—";
}
