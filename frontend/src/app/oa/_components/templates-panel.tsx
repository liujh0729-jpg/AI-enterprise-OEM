"use client";

import { App, Alert, Button, Checkbox, Drawer, Input, InputNumber, Modal, Select, Space, Switch, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import {
  OA_CONDITION_OPS,
  OA_CONDITION_OP_LABELS,
  OA_FIELD_TYPES,
  OA_FIELD_TYPE_LABELS,
  OA_LINKAGE_ACTIONS_SUPPORTED,
  OA_LINKAGE_ACTION_LABELS,
  OA_LINK_TARGETS,
  OA_LINK_TARGET_LABELS,
  OA_TEMPLATE_CATEGORIES,
  OA_TEMPLATE_CATEGORY_LABELS,
  type OaCondition,
  type OaField,
  type OaFlowNode,
  type OaLinkageRule,
  type OaListColumn,
  type OaTemplate,
  type OaTemplateSummary,
} from "@enterprise/contracts";
import { oaApi } from "@/api/oa";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { FlowEditor, FlowPreview } from "./flow-editor";
import { OaFormView } from "./form-renderer";
import {
  OaTable,
  Toolbar,
  oaError,
  orgQueryOf,
  type OaMember,
  type OaOrg,
} from "./oa-common";

/** 需要配置选项的字段类型（与后端 validateFields 同一份判断）。 */
const OPTION_TYPES = ["select", "multiSelect", "radio"];
const MAX_FIELDS = 60;

type TemplateCategory = (typeof OA_TEMPLATE_CATEGORIES)[number];

type TemplateDraft = {
  id: number;
  key: string;
  name: string;
  category: TemplateCategory;
  description: string;
  /** 模板卡片图标名：内置模板预填，编辑时原样带回，界面不单独维护。 */
  icon: string;
  numberPrefix: string;
  enabled: boolean;
  sortOrder: number;
  builtin: boolean;
  fields: OaField[];
  flow: OaFlowNode[];
  linkage: OaLinkageRule[];
};

const emptyDraft = (): TemplateDraft => ({
  id: 0,
  key: "",
  name: "",
  category: "GENERAL",
  description: "",
  icon: "",
  numberPrefix: "OA",
  enabled: true,
  sortOrder: 0,
  builtin: false,
  fields: [],
  flow: [],
  linkage: [],
});

const draftOf = (row: OaTemplate): TemplateDraft => ({
  id: row.id,
  key: row.key,
  name: row.name,
  category: (OA_TEMPLATE_CATEGORIES as readonly string[]).includes(row.category)
    ? (row.category as TemplateCategory)
    : "GENERAL",
  description: row.description,
  icon: row.icon,
  numberPrefix: row.numberPrefix,
  enabled: row.enabled,
  sortOrder: row.sortOrder,
  builtin: row.builtin,
  fields: row.fields,
  flow: row.flow,
  linkage: row.linkage,
});

const newField = (): OaField => ({
  key: "",
  label: "",
  type: "text",
  required: false,
  placeholder: "",
  help: "",
  options: [],
  visibleWhen: null,
  refTarget: "",
  columns: [],
});

const newColumn = (): OaListColumn => ({
  key: "",
  label: "",
  type: "text",
  required: false,
  options: [],
});

const newRule = (): OaLinkageRule => ({
  on: "APPROVED",
  target: "LINKED",
  action: "LOG",
  params: {},
});

/** 客户端先按后端 validateFields / validateFlow 的同一套规则拦一遍。 */
function validateTemplate(draft: TemplateDraft): string {
  if (!draft.name.trim()) return "请填写模板名称";
  if (!draft.key.trim()) return "请填写模板标识";
  if (!draft.numberPrefix.trim()) return "请填写单号前缀";
  if (!draft.fields.length) return "模板至少要有一个字段";
  if (draft.fields.length > MAX_FIELDS) return `模板字段最多 ${MAX_FIELDS} 个`;
  const keys = new Set<string>();
  for (const item of draft.fields) {
    if (!item.key.trim()) return "字段标识不能为空";
    if (!item.label.trim()) return `字段「${item.key}」缺少名称`;
    if (keys.has(item.key)) return `字段标识重复：${item.key}`;
    keys.add(item.key);
    if (item.type === "list" && !item.columns.length) {
      return `明细子表「${item.label}」需要配置列`;
    }
    if (OPTION_TYPES.includes(item.type) && !item.options.length) {
      return `选项字段「${item.label}」需要配置选项`;
    }
    for (const column of item.columns) {
      if (!column.key.trim() || !column.label.trim()) {
        return `明细子表「${item.label}」的列需要标识与名称`;
      }
      if (column.type === "select" && !column.options.length) {
        return `明细列「${column.label}」需要配置选项`;
      }
    }
  }
  if (!draft.flow.length) return "请至少配置一个审批节点";
  if (draft.flow.length > 10) return "审批流程最多 10 个节点";
  for (const [index, node] of draft.flow.entries()) {
    if (!node.name.trim()) return `第 ${index + 1} 个节点缺少名称`;
    if (node.approverType === "MEMBER" && !node.userIds.length) {
      return `第 ${index + 1} 个节点没有指定审批人`;
    }
    if (node.approverType === "ROLE" && !node.roles.length) {
      return `第 ${index + 1} 个节点没有选择业务板块`;
    }
    if (node.approverType === "DEPT_POSITION" && !node.department) {
      return `第 ${index + 1} 个节点没有选择部门`;
    }
    if (node.aiPreReview?.enabled && !node.aiPreReview.principles.trim()) {
      return `第 ${index + 1} 个节点启用了 AI 预审，请填写审核原则`;
    }
  }
  return "";
}

function FieldRow({
  field,
  index,
  total,
  onEdit,
  onRemove,
  onMove,
}: {
  field: OaField;
  index: number;
  total: number;
  onEdit: () => void;
  onRemove: () => void;
  onMove: (offset: number) => void;
}) {
  const extras = [
    field.type === "list" ? `${field.columns.length} 列` : "",
    OPTION_TYPES.includes(field.type) ? `${field.options.length} 个选项` : "",
    field.refTarget ? OA_LINK_TARGET_LABELS[field.refTarget] || field.refTarget : "",
    field.visibleWhen ? "有条件显示" : "",
  ].filter(Boolean);
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
        borderBottom: "1px solid var(--border, #e5e6eb)",
        padding: "8px 0",
      }}
    >
      <span className="muted text-12">{index + 1}</span>
      <strong>{field.label}</strong>
      <span className="muted text-12">{field.key}</span>
      <Tag>{OA_FIELD_TYPE_LABELS[field.type] || field.type}</Tag>
      {field.required ? <Tag color="gold">必填</Tag> : null}
      {extras.length ? (
        <span className="muted text-12">{extras.join(" · ")}</span>
      ) : null}
      <span style={{ marginLeft: "auto" }}>
        <Space size={4}>
          <Tooltip title="上移">
            <Button type="link" disabled={index === 0} onClick={() => onMove(-1)}>
              上移
            </Button>
          </Tooltip>
          <Tooltip title="下移">
            <Button
              type="link"
              disabled={index === total - 1}
              onClick={() => onMove(1)}
            >
              下移
            </Button>
          </Tooltip>
          <Button type="link" onClick={onEdit}>
            编辑
          </Button>
          <Button type="link" danger onClick={onRemove}>
            删除
          </Button>
        </Space>
      </span>
    </div>
  );
}

/** 明细子表的列：一次加一列，选项用逗号分隔（与内置报销模板同口径）。 */
function ColumnRows({
  columns,
  onChange,
}: {
  columns: OaListColumn[];
  onChange: (next: OaListColumn[]) => void;
}) {
  const patch = (index: number, next: Partial<OaListColumn>) =>
    onChange(columns.map((item, at) => (at === index ? { ...item, ...next } : item)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!columns.length ? (
        <span className="muted text-12">还没有列，点「＋ 添加列」逐条添加</span>
      ) : null}
      {columns.map((column, index) => (
        <div
          key={`${column.key}-${index}`}
          style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
        >
          <Input
            style={{ width: 120 }}
            value={column.key}
            maxLength={40}
            placeholder="列标识"
            onChange={(event) => patch(index, { key: event.target.value })}
          />
          <Input
            style={{ width: 130 }}
            value={column.label}
            maxLength={60}
            placeholder="列名称"
            onChange={(event) => patch(index, { label: event.target.value })}
          />
          <Select
            style={{ width: 110 }}
            value={column.type}
            options={["text", "number", "amount", "date", "select"].map((item) => ({
              value: item,
              label:
                item === "amount"
                  ? "金额"
                  : item === "date"
                    ? "日期"
                    : item === "select"
                      ? "下拉"
                      : item === "number"
                        ? "数字"
                        : "文本",
            }))}
            onChange={(value: OaListColumn["type"]) => patch(index, { type: value })}
          />
          {column.type === "select" ? (
            <Input
              style={{ width: 200 }}
              defaultValue={column.options.map((item) => item.label).join(",")}
              placeholder="选项，用逗号分隔"
              onBlur={(event) =>
                patch(index, {
                  options: event.target.value
                    .split(/[,，]/)
                    .map((text) => text.trim())
                    .filter(Boolean)
                    .map((text) => ({ label: text, value: text })),
                })
              }
            />
          ) : null}
          <Checkbox
            checked={column.required}
            onChange={(event) => patch(index, { required: event.target.checked })}
          >
            必填
          </Checkbox>
          <Button
            type="link"
            danger
            onClick={() => onChange(columns.filter((_, at) => at !== index))}
          >
            删除
          </Button>
        </div>
      ))}
      <div>
        <Button onClick={() => onChange([...columns, newColumn()])}>＋ 添加列</Button>
      </div>
    </div>
  );
}

const Labeled = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <div className="muted text-12" style={{ marginBottom: 4 }}>
      {label}
    </div>
    {children}
  </div>
);

/** 单字段编辑：一次只填一个字段，保存后回到上方字段清单。 */
function FieldModal({
  open,
  field,
  others,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** 传入＝编辑该字段；为空＝新增。 */
  field: OaField | null;
  others: OaField[];
  onClose: () => void;
  onSubmit: (next: OaField) => void;
}) {
  const [draft, setDraft] = useState<OaField>(newField);

  useEffect(() => {
    if (open) setDraft(field ? { ...field } : newField());
  }, [open, field]);

  const patch = (next: Partial<OaField>) => setDraft((prev) => ({ ...prev, ...next }));

  const changeType = (type: OaField["type"]) =>
    setDraft((prev) => ({
      ...prev,
      type,
      default: undefined,
      options: OPTION_TYPES.includes(type) ? prev.options : [],
      columns: type === "list" ? prev.columns : [],
      refTarget: type === "ref" ? prev.refTarget : "",
    }));

  const error = (() => {
    if (!draft.key.trim()) return "字段标识不能为空";
    if (!draft.label.trim()) return "字段名称不能为空";
    if (others.some((item) => item.key === draft.key)) {
      return `字段标识「${draft.key}」已存在`;
    }
    if (draft.type === "list" && !draft.columns.length) return "明细子表需要配置列";
    if (OPTION_TYPES.includes(draft.type) && !draft.options.length) {
      return "选项字段需要至少一个选项";
    }
    for (const column of draft.columns) {
      if (!column.key.trim() || !column.label.trim()) {
        return "明细列需要标识与名称";
      }
      if (column.type === "select" && !column.options.length) {
        return `明细列「${column.label}」需要配置选项`;
      }
    }
    return "";
  })();

  const submit = () => {
    if (error) return;
    onSubmit({ ...draft, key: draft.key.trim(), label: draft.label.trim() });
  };

  const conditionOptions = others.map((item) => ({
    value: item.key,
    label: item.label || item.key,
  }));

  return (
    <Modal
      open={open}
      destroyOnHidden
      width={720}
      title={field ? `编辑字段 · ${field.label}` : "添加字段"}
      okText={field ? "保存字段" : "添加"}
      cancelText="取消"
      okButtonProps={{ disabled: Boolean(error) }}
      onCancel={onClose}
      onOk={submit}
    >
      <div className="form-2col">
        <Labeled label="字段标识（提交数据里的键名）">
          <Input
            value={draft.key}
            maxLength={40}
            placeholder="如 leaveType"
            onChange={(event) => patch({ key: event.target.value })}
          />
        </Labeled>
        <Labeled label="字段名称">
          <Input
            value={draft.label}
            maxLength={60}
            placeholder="如 请假类型"
            onChange={(event) => patch({ label: event.target.value })}
          />
        </Labeled>
        <Labeled label="类型">
          <Select
            style={{ width: "100%" }}
            value={draft.type}
            options={OA_FIELD_TYPES.map((item) => ({
              value: item,
              label: OA_FIELD_TYPE_LABELS[item] || item,
            }))}
            onChange={changeType}
          />
        </Labeled>
        <Labeled label="是否必填">
          <Switch
            checked={draft.required}
            onChange={(checked) => patch({ required: checked })}
          />
        </Labeled>
        <Labeled label="占位提示">
          <Input
            value={draft.placeholder}
            maxLength={120}
            onChange={(event) => patch({ placeholder: event.target.value })}
          />
        </Labeled>
        <Labeled label="填写说明">
          <Input
            value={draft.help}
            maxLength={200}
            onChange={(event) => patch({ help: event.target.value })}
          />
        </Labeled>
        {draft.type === "ref" ? (
          <Labeled label="限定业务对象（不选＝任意可关联对象）">
            <Select
              style={{ width: "100%" }}
              value={draft.refTarget || ""}
              options={[
                { value: "", label: "任意业务对象" },
                ...OA_LINK_TARGETS.map((item) => ({
                  value: item,
                  label: OA_LINK_TARGET_LABELS[item] || item,
                })),
              ]}
              onChange={(value: string) => patch({ refTarget: value })}
            />
          </Labeled>
        ) : null}
        {["text", "textarea", "number", "amount", "date", "datetime", "checkbox", ...OPTION_TYPES].includes(
          draft.type,
        ) ? (
          <Labeled label="默认值（新建单据时预填，发起人可改）">
            {OPTION_TYPES.includes(draft.type) ? (
              <Select
                mode={draft.type === "multiSelect" ? "multiple" : undefined}
                style={{ width: "100%" }}
                allowClear
                value={
                  draft.type === "multiSelect"
                    ? ((draft.default as string[]) || [])
                    : (draft.default as string | undefined)
                }
                options={draft.options.map((item) => ({
                  value: item.value,
                  label: item.label,
                }))}
                onChange={(value) => patch({ default: value })}
              />
            ) : draft.type === "checkbox" ? (
              <Switch
                checked={Boolean(draft.default)}
                onChange={(checked) => patch({ default: checked })}
              />
            ) : (
              <Input
                type={
                  draft.type === "number" || draft.type === "amount"
                    ? "number"
                    : draft.type === "date"
                      ? "date"
                      : draft.type === "datetime"
                        ? "datetime-local"
                        : "text"
                }
                value={draft.default === undefined ? "" : String(draft.default)}
                onChange={(event) => {
                  const raw = event.target.value;
                  patch({
                    default:
                      draft.type === "number" || draft.type === "amount"
                        ? raw === ""
                          ? undefined
                          : Number(raw)
                        : raw,
                  });
                }}
              />
            )}
          </Labeled>
        ) : null}
      </div>

      {OPTION_TYPES.includes(draft.type) ? (
        <div style={{ marginTop: 12 }}>
          <Labeled label="选项（选项文字即提交值，流程条件按值匹配）">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {draft.options.map((option, index) => (
                <div key={`${option.value}-${index}`} style={{ display: "flex", gap: 6 }}>
                  <Input
                    value={option.label}
                    maxLength={60}
                    placeholder="选项文字"
                    onChange={(event) => {
                      const text = event.target.value;
                      patch({
                        options: draft.options.map((item, at) =>
                          at === index ? { label: text, value: text } : item,
                        ),
                      });
                    }}
                  />
                  <Button
                    type="link"
                    danger
                    onClick={() =>
                      patch({ options: draft.options.filter((_, at) => at !== index) })
                    }
                  >
                    删除
                  </Button>
                </div>
              ))}
              <div>
                <Button
                  onClick={() =>
                    patch({ options: [...draft.options, { label: "", value: "" }] })
                  }
                >
                  ＋ 添加选项
                </Button>
              </div>
            </div>
          </Labeled>
        </div>
      ) : null}

      {draft.type === "list" ? (
        <div style={{ marginTop: 12 }}>
          <Labeled label="明细子表的列（行在填单时逐条添加）">
            <ColumnRows
              columns={draft.columns}
              onChange={(columns) => patch({ columns })}
            />
          </Labeled>
        </div>
      ) : null}

      <div style={{ marginTop: 12 }}>
        <Checkbox
          checked={Boolean(draft.visibleWhen)}
          onChange={(event) =>
            patch({
              visibleWhen: event.target.checked
                ? {
                    field: conditionOptions[0]?.value || "",
                    op: "eq",
                    value: "",
                  }
                : null,
            })
          }
        >
          仅当其他字段满足条件时显示
        </Checkbox>
        {draft.visibleWhen ? (
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
              marginTop: 8,
            }}
          >
            <Select
              style={{ width: 180 }}
              value={draft.visibleWhen.field}
              options={conditionOptions}
              onChange={(value: string) =>
                patch({
                  visibleWhen: { ...(draft.visibleWhen as OaCondition), field: value },
                })
              }
            />
            <Select
              style={{ width: 120 }}
              value={draft.visibleWhen.op}
              options={OA_CONDITION_OPS.map((item) => ({
                value: item,
                label: OA_CONDITION_OP_LABELS[item] || item,
              }))}
              onChange={(value: (typeof OA_CONDITION_OPS)[number]) =>
                patch({
                  visibleWhen: { ...(draft.visibleWhen as OaCondition), op: value },
                })
              }
            />
            <Input
              style={{ width: 160 }}
              value={String(draft.visibleWhen.value ?? "")}
              placeholder="字段值"
              onChange={(event) =>
                patch({
                  visibleWhen: {
                    ...(draft.visibleWhen as OaCondition),
                    value: event.target.value,
                  },
                })
              }
            />
          </div>
        ) : null}
      </div>
      {error ? (
        <div className="text-12" style={{ marginTop: 10, color: "var(--danger)" }}>
          {error}
        </div>
      ) : null}
    </Modal>
  );
}

/** 审批结果联动：一期只做写回执与改写字段两个动作（与后端支持集一致）。 */
function LinkageEditor({
  rules,
  onChange,
}: {
  rules: OaLinkageRule[];
  onChange: (next: OaLinkageRule[]) => void;
}) {
  const patch = (index: number, next: Partial<OaLinkageRule>) =>
    onChange(rules.map((item, at) => (at === index ? { ...item, ...next } : item)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {!rules.length ? (
        <EmptyState icon={<span aria-hidden />} text="没有联动动作，审批结束只做留痕" />
      ) : null}
      {rules.map((rule, index) => (
        <div
          key={`${rule.on}-${rule.target}-${index}`}
          style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
        >
          <Select
            style={{ width: 130 }}
            value={rule.on}
            options={[
              { value: "APPROVED", label: "审批通过时" },
              { value: "REJECTED", label: "被驳回时" },
            ]}
            onChange={(value: "APPROVED" | "REJECTED") => patch(index, { on: value })}
          />
          <Select
            style={{ width: 190 }}
            value={rule.target}
            options={[
              { value: "LINKED", label: "单据关联的业务对象" },
              ...OA_LINK_TARGETS.map((item) => ({
                value: item,
                label: OA_LINK_TARGET_LABELS[item] || item,
              })),
            ]}
            onChange={(value: string) => patch(index, { target: value })}
          />
          <Select
            style={{ width: 160 }}
            value={rule.action}
            options={OA_LINKAGE_ACTIONS_SUPPORTED.map(
              (item): { value: OaLinkageRule["action"]; label: string } => ({
                value: item,
                label: OA_LINKAGE_ACTION_LABELS[item] || item,
              }),
            )}
            onChange={(value: OaLinkageRule["action"]) =>
              patch(index, {
                action: value,
                params: value === "SET_FIELD" ? { fieldKey: "", value: "" } : {},
              })
            }
          />
          {rule.action === "SET_FIELD" ? (
            <>
              <Input
                style={{ width: 160 }}
                value={String(rule.params.fieldKey ?? "")}
                placeholder="目标字段标识"
                onChange={(event) =>
                  patch(index, {
                    params: { ...rule.params, fieldKey: event.target.value },
                  })
                }
              />
              <Input
                style={{ width: 160 }}
                value={String(rule.params.value ?? "")}
                placeholder="改写后的值"
                onChange={(event) =>
                  patch(index, {
                    params: { ...rule.params, value: event.target.value },
                  })
                }
              />
            </>
          ) : null}
          <Button
            type="link"
            danger
            style={{ marginLeft: "auto" }}
            onClick={() => onChange(rules.filter((_, at) => at !== index))}
          >
            删除
          </Button>
        </div>
      ))}
      <div>
        <Button onClick={() => onChange([...rules, newRule()])}>＋ 添加联动动作</Button>
      </div>
    </div>
  );
}

/**
 * 模板与流程（管理员）：模板清单 + 单条模板编辑（字段 / 流程 / 联动 / 预览）+ 审批设置入口。
 * 改 / 删 / 停用走全站统一口令确认弹窗，新建与复制免密。
 */
export function TemplatesPanel({
  org,
  members,
  functions,
  onChanged,
}: {
  org: OaOrg | null;
  members: OaMember[];
  functions: {
    departments: { name: string; description: string }[];
    positions: { name: string; description: string }[];
    personas: { id: number; name: string; style: string; persona: string }[];
  };
  /** 模板变化后让页壳重新拉一次清单（新建抽屉的模板卡片跟着更新）。 */
  onChanged: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const [rows, setRows] = useState<OaTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("");
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [draft, setDraft] = useState<TemplateDraft>(emptyDraft);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldEditing, setFieldEditing] = useState<OaField | null>(null);
  const [fieldIndex, setFieldIndex] = useState(-1);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [copySource, setCopySource] = useState<OaTemplateSummary | null>(null);
  const [copyKey, setCopyKey] = useState("");
  const [copyName, setCopyName] = useState("");
  const [copyBusy, setCopyBusy] = useState(false);

  const orgQuery = orgQueryOf(org);
  const { orgType, orgUserId } = orgQuery;

  const load = async () => {
    setLoading(true);
    try {
      const data = await oaApi.templates({
        query: {
          orgType,
          orgUserId,
          ...(category ? { category } : {}),
          ...(enabledOnly ? { enabledOnly: true } : {}),
        },
      });
      setRows(data || []);
      setError("");
    } catch (err) {
      setRows([]);
      setError(oaError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- org 参数按值变化触发
  }, [orgType, orgUserId, category, enabledOnly]);

  const openNew = () => {
    setDraft(emptyDraft());
    setEditorOpen(true);
  };

  const openEdit = async (id: number) => {
    setLoading(true);
    try {
      const detail = await oaApi.templateDetail({
        params: { id: String(id) },
        query: orgQuery,
      });
      if (!detail) throw new Error("模板加载失败");
      setDraft(draftOf(detail));
      setEditorOpen(true);
    } catch (err) {
      message.error(oaError(err));
    } finally {
      setLoading(false);
    }
  };

  const patchDraft = (next: Partial<TemplateDraft>) =>
    setDraft((prev) => ({ ...prev, ...next }));

  const moveField = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= draft.fields.length) return;
    const copy = [...draft.fields];
    const [row] = copy.splice(index, 1);
    copy.splice(target, 0, row);
    patchDraft({ fields: copy });
  };

  const submitField = (next: OaField) => {
    const fields = [...draft.fields];
    if (fieldIndex >= 0) fields[fieldIndex] = next;
    else fields.push(next);
    patchDraft({ fields });
    setFieldOpen(false);
    setFieldEditing(null);
    setFieldIndex(-1);
  };

  const persist = async () => {
    const invalid = validateTemplate(draft);
    if (invalid) {
      message.warning(invalid);
      return;
    }
    setSaving(true);
    try {
      await oaApi.saveTemplate({
        body: {
          ...orgQuery,
          id: draft.id,
          key: draft.key.trim(),
          name: draft.name.trim(),
          category: draft.category,
          description: draft.description,
          icon: draft.icon,
          numberPrefix: draft.numberPrefix.trim(),
          fields: draft.fields,
          flow: draft.flow,
          linkage: draft.linkage,
          enabled: draft.enabled,
          sortOrder: draft.sortOrder,
        },
      });
      message.success(draft.id ? "模板已保存" : "模板已创建");
      setEditorOpen(false);
      await load();
      await onChanged();
    } catch (err) {
      message.error(oaError(err));
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (!draft.id) {
      void persist();
      return;
    }
    request({
      title: "保存模板",
      content: `修改「${draft.name}」会影响之后发起的该类单据。`,
      okText: "确认保存",
      onOk: persist,
    });
  };

  const toggle = (row: OaTemplateSummary) => {
    request({
      title: row.enabled ? "停用模板" : "启用模板",
      content: row.enabled
        ? `停用后「${row.name}」不再出现在新建申请里，已有单据不受影响。`
        : `启用后「${row.name}」可以再次发起申请。`,
      okText: "确认",
      danger: row.enabled,
      onOk: async () => {
        try {
          await oaApi.toggleTemplate({
            params: { id: String(row.id) },
            body: { enabled: !row.enabled },
          });
          message.success(row.enabled ? "已停用" : "已启用");
          await load();
          await onChanged();
        } catch (err) {
          message.error(oaError(err));
        }
      },
    });
  };

  const remove = (row: OaTemplateSummary) => {
    request({
      title: "删除模板",
      content: `确定删除「${row.name}」吗？已发起的单据仍保留历史快照。`,
      okText: "确认删除",
      danger: true,
      onOk: async () => {
        try {
          await oaApi.deleteTemplate({ params: { id: String(row.id) } });
          message.success("已删除模板");
          await load();
          await onChanged();
        } catch (err) {
          message.error(oaError(err));
        }
      },
    });
  };

  const submitCopy = async () => {
    if (!copySource) return;
    if (!copyKey.trim()) {
      message.warning("请填写新模板标识");
      return;
    }
    setCopyBusy(true);
    try {
      await oaApi.copyTemplate({
        params: { id: String(copySource.id) },
        body: { key: copyKey.trim(), name: copyName.trim() },
      });
      message.success("已复制为新模板");
      setCopySource(null);
      await load();
      await onChanged();
    } catch (err) {
      message.error(oaError(err));
    } finally {
      setCopyBusy(false);
    }
  };

  const columns: ColumnsType<OaTemplateSummary> = [
    {
      title: "名称",
      dataIndex: "name",
      width: 220,
      render: (value: string, row) => (
        <div className="exec-row-main">
          <span>
            {value}
            {row.builtin ? <Tag style={{ marginLeft: 6 }}>内置</Tag> : null}
          </span>
          <span className="exec-row-hint">{row.description || "—"}</span>
        </div>
      ),
    },
    {
      title: "分类",
      dataIndex: "categoryLabel",
      width: 110,
      render: (value: string, row) => value || OA_TEMPLATE_CATEGORY_LABELS[row.category] || row.category,
    },
    { title: "单号前缀", dataIndex: "numberPrefix", width: 100 },
    {
      title: "流程节点",
      dataIndex: "nodeCount",
      width: 100,
      render: (value: number) => `${value} 个`,
    },
    {
      title: "联动动作",
      dataIndex: "linkageCount",
      width: 100,
      render: (value: number) => (value ? `${value} 条` : "未配置"),
    },
    {
      title: "状态",
      width: 140,
      render: (_, row) => (
        <div className="exec-row-main">
          <span>
            <Tag color={row.enabled ? "green" : "default"}>
              {row.enabled ? "启用中" : "已停用"}
            </Tag>
            <span className="muted text-12">第 {row.version} 版</span>
          </span>
          <span className="exec-row-hint">
            {row.openCount ? `在途单据 ${row.openCount} 张` : "无在途单据"}
          </span>
        </div>
      ),
    },
    { title: "排序", dataIndex: "sortOrder", width: 80 },
    {
      title: "操作",
      fixed: "right",
      width: 240,
      render: (_, row) => (
        <Space size={0}>
          <Button type="link" onClick={() => void openEdit(row.id)}>
            编辑
          </Button>
          <Button
            type="link"
            onClick={() => {
              setCopySource(row);
              setCopyKey("");
              setCopyName(`${row.name} 副本`);
            }}
          >
            复制
          </Button>
          <Button type="link" onClick={() => toggle(row)}>
            {row.enabled ? "停用" : "启用"}
          </Button>
          {row.builtin ? null : (
            <Button type="link" danger onClick={() => remove(row)}>
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <>
      <Panel
        title="申请模板"
        titleBadge={`${rows.length} 个`}
        extra={
          <Button type="primary" onClick={openNew}>
            ＋ 新建模板
          </Button>
        }
      >
        <Toolbar hint="内置模板只能停用，不能删除">
          <Select
            style={{ width: 150 }}
            value={category}
            onChange={setCategory}
            options={[
              { value: "", label: "全部分类" },
              ...OA_TEMPLATE_CATEGORIES.map((item) => ({
                value: item,
                label: OA_TEMPLATE_CATEGORY_LABELS[item] || item,
              })),
            ]}
          />
          <Select
            style={{ width: 140 }}
            value={enabledOnly ? "ENABLED" : ""}
            onChange={(value) => setEnabledOnly(value === "ENABLED")}
            options={[
              { value: "", label: "含已停用" },
              { value: "ENABLED", label: "只看启用" },
            ]}
          />
        </Toolbar>
        {error ? (
          <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />
        ) : null}
        <OaTable<OaTemplateSummary>
          columns={columns}
          rows={rows}
          loading={loading}
          empty="该组织还没有申请模板"
        />
      </Panel>

      <Drawer
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        width={880}
        destroyOnHidden
        title={draft.id ? `编辑模板 · ${draft.name}` : "新建模板"}
        styles={{ body: { background: "var(--bg, #f7f8fa)" } }}
        footer={
          <Space style={{ width: "100%", justifyContent: "flex-end" }}>
            <Button onClick={() => setEditorOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={save}>
              保存模板
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Panel title="基本信息">
            <div className="form-2col">
              <Labeled label="模板名称">
                <Input
                  value={draft.name}
                  maxLength={40}
                  placeholder="如 差旅报销"
                  onChange={(event) => patchDraft({ name: event.target.value })}
                />
              </Labeled>
              <Labeled label="模板标识（创建后不可改）">
                <Input
                  value={draft.key}
                  maxLength={40}
                  disabled={draft.id > 0}
                  placeholder="如 travel_expense"
                  onChange={(event) => patchDraft({ key: event.target.value })}
                />
              </Labeled>
              <Labeled label="分类">
                <Select
                  style={{ width: "100%" }}
                  value={draft.category}
                  options={OA_TEMPLATE_CATEGORIES.map((item) => ({
                    value: item,
                    label: OA_TEMPLATE_CATEGORY_LABELS[item] || item,
                  }))}
                  onChange={(value: TemplateCategory) => patchDraft({ category: value })}
                />
              </Labeled>
              <Labeled label="单号前缀">
                <Input
                  value={draft.numberPrefix}
                  maxLength={8}
                  placeholder="如 BX"
                  onChange={(event) => patchDraft({ numberPrefix: event.target.value })}
                />
              </Labeled>
              <Labeled label="排序（越小越靠前）">
                <InputNumber
                  min={0}
                  precision={0}
                  value={draft.sortOrder}
                  onChange={(value) => patchDraft({ sortOrder: Number(value) || 0 })}
                />
              </Labeled>
              <Labeled label="启用">
                <Switch
                  checked={draft.enabled}
                  onChange={(checked) => patchDraft({ enabled: checked })}
                />
              </Labeled>
              <div style={{ gridColumn: "1 / -1" }}>
                <Labeled label="说明（新建申请时显示在模板卡片上）">
                  <Input
                    value={draft.description}
                    maxLength={200}
                    onChange={(event) => patchDraft({ description: event.target.value })}
                  />
                </Labeled>
              </div>
            </div>
          </Panel>

          <Panel
            title="表单字段"
            titleBadge={`${draft.fields.length} 个`}
            extra={
              <Button
                disabled={draft.fields.length >= MAX_FIELDS}
                onClick={() => {
                  setFieldEditing(null);
                  setFieldIndex(-1);
                  setFieldOpen(true);
                }}
              >
                ＋ 添加字段
              </Button>
            }
          >
            {!draft.fields.length ? (
              <EmptyState text="还没有字段，点右上角「＋ 添加字段」逐条录入" />
            ) : (
              draft.fields.map((field, index) => (
                <FieldRow
                  key={`${field.key}-${index}`}
                  field={field}
                  index={index}
                  total={draft.fields.length}
                  onEdit={() => {
                    setFieldEditing(field);
                    setFieldIndex(index);
                    setFieldOpen(true);
                  }}
                  onRemove={() =>
                    patchDraft({
                      fields: draft.fields.filter((_, at) => at !== index),
                    })
                  }
                  onMove={(offset) => moveField(index, offset)}
                />
              ))
            )}
          </Panel>

          <Panel
            title="审批流程"
            titleBadge={`${draft.flow.length} 个节点`}
            titleExtra={<span className="muted text-12">节点按顺序串行，最多 10 个</span>}
          >
            <FlowEditor
              nodes={draft.flow}
              fields={draft.fields}
              members={members}
              functions={functions}
              onChange={(flow) => patchDraft({ flow })}
            />
          </Panel>

          <Panel title="审批结果联动">
            <LinkageEditor
              rules={draft.linkage}
              onChange={(linkage) => patchDraft({ linkage })}
            />
            <div className="muted text-12" style={{ marginTop: 8 }}>
              改写字段只支持内建应用与多维表格的行，其余对象只写审批回执。
            </div>
          </Panel>

          <Panel title="表单预览">
            <OaFormView fields={draft.fields} formData={{}} members={members} />
          </Panel>

          <Panel title="流程预览">
            <FlowPreview
              nodes={draft.flow}
              fields={draft.fields}
              members={members}
              formData={{}}
            />
          </Panel>
        </Space>
      </Drawer>

      <FieldModal
        open={fieldOpen}
        field={fieldEditing}
        others={draft.fields.filter((_, at) => at !== fieldIndex)}
        onClose={() => {
          setFieldOpen(false);
          setFieldEditing(null);
          setFieldIndex(-1);
        }}
        onSubmit={submitField}
      />

      <Modal
        open={Boolean(copySource)}
        destroyOnHidden
        title={copySource ? `复制模板 · ${copySource.name}` : "复制模板"}
        okText="复制"
        cancelText="取消"
        confirmLoading={copyBusy}
        onCancel={() => setCopySource(null)}
        onOk={() => void submitCopy()}
      >
        <Notice variant="info">复制会以该模板的字段、流程与联动为底新建一个自定义模板。</Notice>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          <Labeled label="新模板标识">
            <Input
              value={copyKey}
              maxLength={40}
              placeholder="如 expense_v2"
              onChange={(event) => setCopyKey(event.target.value)}
            />
          </Labeled>
          <Labeled label="新模板名称">
            <Input
              value={copyName}
              maxLength={40}
              onChange={(event) => setCopyName(event.target.value)}
            />
          </Labeled>
        </div>
      </Modal>
      {modal}
    </>
  );
}
