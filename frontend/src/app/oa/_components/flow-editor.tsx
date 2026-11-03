"use client";

import { Button, Checkbox, Input, InputNumber, Select, Space, Tag, Tooltip } from "antd";
import type { ReactNode } from "react";
import {
  OA_APPROVAL_MODE_LABELS,
  OA_APPROVAL_MODES,
  OA_APPROVER_TYPE_LABELS,
  OA_APPROVER_TYPES,
  OA_CONDITION_OP_LABELS,
  OA_CONDITION_OPS,
  OA_EMPTY_ACTION_LABELS,
  OA_EMPTY_ACTIONS,
  ORG_BUSINESS_SCOPE_LABELS,
  ORG_BUSINESS_SCOPES,
  type OaCondition,
  type OaField,
  type OaFlowNode,
} from "@enterprise/contracts";
import { EmptyState } from "@/components/ui/panel";
import {
  MemberSelect,
  oaApproverText,
  oaConditionText,
  type OaMember,
} from "./oa-common";
import { oaAmountOf, oaConditionHit } from "./form-renderer";

/** 条件只允许挂在单据金额与 select / radio 字段上（方案 §6.1 的字面口径）。 */
const CONDITION_FIELD_TYPES = ["select", "radio"];

const MAX_NODES = 10;

const Labeled = ({ label, children }: { label: string; children: ReactNode }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <span className="muted text-12">{label}</span>
    {children}
  </div>
);

export function conditionFieldsOf(fields: OaField[]) {
  return [
    { value: "amount", label: "单据金额" },
    ...fields
      .filter((field) => CONDITION_FIELD_TYPES.includes(field.type))
      .map((field) => ({ value: field.key, label: field.label })),
  ];
}

function newNode(): OaFlowNode {
  return {
    name: "审批节点",
    approverType: "DEPT_HEAD",
    userIds: [],
    roles: [],
    department: "",
    positions: [],
    aiPreReview: {
      enabled: false,
      personaId: 0,
      principles: "",
      personaName: "",
      personaStyle: "",
      personaText: "",
    },
    mode: "ANY",
    condition: null,
    emptyAction: "SKIP",
    ccUserIds: [],
    remindAfterHours: 24,
  };
}

/**
 * 流程编辑器：串行节点逐条添加，每节点配审批人规则、会签方式、命中条件与抄送。
 * 只改传入的数组副本，保存动作由外层模板编辑器统一发起。
 */
export function FlowEditor({
  nodes,
  fields,
  members,
  functions,
  onChange,
}: {
  nodes: OaFlowNode[];
  fields: OaField[];
  members: OaMember[];
  functions: {
    departments: { name: string; description: string }[];
    positions: { name: string; description: string }[];
    personas: { id: number; name: string; style: string; persona: string }[];
  };
  onChange: (next: OaFlowNode[]) => void;
}) {
  const patch = (index: number, next: Partial<OaFlowNode>) =>
    onChange(nodes.map((node, at) => (at === index ? { ...node, ...next } : node)));

  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= nodes.length) return;
    const copy = [...nodes];
    const [row] = copy.splice(index, 1);
    copy.splice(target, 0, row);
    onChange(copy);
  };

  const conditionOptions = conditionFieldsOf(fields);

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {!nodes.length ? (
        <EmptyState text="还没有审批节点，提交后单据直接结束" />
      ) : null}
      {nodes.map((node, index) => (
        <div
          key={`${node.name}-${index}`}
          style={{
            border: "1px solid var(--border, #e5e6eb)",
            borderRadius: 8,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="muted text-12">节点 {index + 1}</span>
            <Input
              value={node.name}
              maxLength={60}
              style={{ width: 200 }}
              placeholder="节点名称"
              onChange={(event) => patch(index, { name: event.target.value })}
            />
            <Tooltip title="节点审批人从哪儿来">
              <Select
                style={{ width: 160 }}
                value={node.approverType}
                options={OA_APPROVER_TYPES.map((item) => ({
                  value: item,
                  label: OA_APPROVER_TYPE_LABELS[item] || item,
                }))}
                onChange={(value: (typeof OA_APPROVER_TYPES)[number]) =>
                  patch(index, { approverType: value })
                }
              />
            </Tooltip>
            <Select
              style={{ width: 140 }}
              value={node.mode}
              options={OA_APPROVAL_MODES.map((item) => ({
                value: item,
                label: OA_APPROVAL_MODE_LABELS[item] || item,
              }))}
              onChange={(value: (typeof OA_APPROVAL_MODES)[number]) =>
                patch(index, { mode: value })
              }
            />
            <span style={{ marginLeft: "auto" }}>
              <Space size={4}>
                <Button type="link" disabled={index === 0} onClick={() => move(index, -1)}>
                  上移
                </Button>
                <Button
                  type="link"
                  disabled={index === nodes.length - 1}
                  onClick={() => move(index, 1)}
                >
                  下移
                </Button>
                <Button
                  type="link"
                  danger
                  onClick={() => onChange(nodes.filter((_, at) => at !== index))}
                >
                  删除
                </Button>
              </Space>
            </span>
          </div>

          {node.approverType === "MEMBER" ? (
            <Labeled label="指定审批人（可多选）">
              <MemberSelect
                members={members}
                mode="multiple"
                value={node.userIds}
                placeholder="选择组织成员"
                style={{ width: "100%" }}
                onChange={(next) => patch(index, { userIds: next as string[] })}
              />
            </Labeled>
          ) : null}

          {node.approverType === "ROLE" ? (
            <Labeled label="业务板块（该板块下的 ACTIVE 成员都会收到）">
              <Select
                mode="multiple"
                style={{ width: "100%" }}
                value={node.roles}
                placeholder="选择业务板块"
                options={ORG_BUSINESS_SCOPES.map((item) => ({
                  value: item,
                  label: ORG_BUSINESS_SCOPE_LABELS[item] || item,
                }))}
                onChange={(value: string[]) => patch(index, { roles: value })}
              />
            </Labeled>
          ) : null}

          {node.approverType === "DEPT_POSITION" ? (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Labeled label="部门（必选）">
                <Select
                  style={{ minWidth: 220 }}
                  value={node.department || undefined}
                  placeholder="选择部门"
                  options={functions.departments.map((item) => ({
                    value: item.name,
                    label: item.name,
                  }))}
                  onChange={(value: string) =>
                    patch(index, { department: value || "", positions: [] })
                  }
                />
              </Labeled>
              <Labeled label="岗位（不选＝该部门全部在职成员）">
                <Select
                  mode="multiple"
                  style={{ minWidth: 280 }}
                  value={node.positions}
                  placeholder="选择岗位"
                  options={functions.positions.map((item) => ({
                    value: item.name,
                    label: item.description
                      ? `${item.name}（${item.description}）`
                      : item.name,
                  }))}
                  onChange={(value: string[]) => patch(index, { positions: value })}
                />
              </Labeled>
              {!functions.departments.length ? (
                <span className="muted text-12" style={{ alignSelf: "center" }}>
                  还没有部门：先到「职员/代理人管理 → 职能管理」里配置部门与岗位
                </span>
              ) : null}
            </div>
          ) : null}

          <div
            style={{
              borderTop: "1px dashed var(--border, #e5e6eb)",
              paddingTop: 10,
              display: "grid",
              gap: 8,
            }}
          >
            <Checkbox
              checked={node.aiPreReview.enabled}
              onChange={(event) =>
                patch(index, {
                  aiPreReview: {
                    ...node.aiPreReview,
                    enabled: event.target.checked,
                  },
                })
              }
            >
              启用 AI 预审（先按设定给出建议，再由审批人本人决定）
            </Checkbox>
            {node.aiPreReview.enabled ? (
              <>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <Labeled label="数字分身（可选）">
                    <Select
                      allowClear
                      style={{ minWidth: 220 }}
                      value={node.aiPreReview.personaId || undefined}
                      placeholder="不使用分身"
                      options={functions.personas.map((item) => ({
                        value: item.id,
                        label: item.name,
                      }))}
                      onChange={(value) => {
                        const picked = functions.personas.find(
                          (item) => item.id === value,
                        );
                        patch(index, {
                          aiPreReview: {
                            ...node.aiPreReview,
                            personaId: value || 0,
                            personaName: picked?.name || "",
                            personaStyle: picked?.style || "",
                            personaText: picked?.persona || "",
                          },
                        });
                      }}
                    />
                  </Labeled>
                </div>
                <Labeled label="审核原则（必填，预审只按这里的口径判断）">
                  <Input.TextArea
                    rows={3}
                    maxLength={2000}
                    showCount
                    value={node.aiPreReview.principles}
                    placeholder="例如：金额超过 5000 必须附发票；差旅须写明起止地点与事由；材料不全时建议补充而不是直接通过"
                    onChange={(event) =>
                      patch(index, {
                        aiPreReview: {
                          ...node.aiPreReview,
                          principles: event.target.value,
                        },
                      })
                    }
                  />
                </Labeled>
                {!functions.personas.length ? (
                  <span className="muted text-12">
                    还没有数字分身：可先到「Agent → 数字分身」创建，预审会按默认语气输出。
                  </span>
                ) : null}
              </>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <Checkbox
              checked={Boolean(node.condition)}
              onChange={(event) =>
                patch(index, {
                  condition: event.target.checked
                    ? { field: "amount", op: "gte", value: 0 }
                    : null,
                })
              }
            >
              仅条件命中时走该节点
            </Checkbox>
            {node.condition ? (
              <>
                <Select
                  style={{ width: 170 }}
                  value={node.condition.field}
                  options={conditionOptions}
                  onChange={(value: string) =>
                    patch(index, {
                      condition: { ...(node.condition as OaCondition), field: value },
                    })
                  }
                />
                <Select
                  style={{ width: 130 }}
                  value={node.condition.op}
                  options={OA_CONDITION_OPS.map((item) => ({
                    value: item,
                    label: OA_CONDITION_OP_LABELS[item] || item,
                  }))}
                  onChange={(value: (typeof OA_CONDITION_OPS)[number]) =>
                    patch(index, {
                      condition: { ...(node.condition as OaCondition), op: value },
                    })
                  }
                />
                <Input
                  style={{ width: 140 }}
                  value={String(node.condition.value ?? "")}
                  placeholder="阈值或选项值"
                  onChange={(event) => {
                    const raw = event.target.value;
                    const numeric = Number(raw);
                    patch(index, {
                      condition: {
                        ...(node.condition as OaCondition),
                        value: raw.trim() !== "" && Number.isFinite(numeric)
                          ? numeric
                          : raw,
                      },
                    });
                  }}
                />
              </>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <Labeled label="无人可派时">
              <Select
                style={{ width: 200 }}
                value={node.emptyAction}
                options={OA_EMPTY_ACTIONS.map((item) => ({
                  value: item,
                  label: OA_EMPTY_ACTION_LABELS[item] || item,
                }))}
                onChange={(value: (typeof OA_EMPTY_ACTIONS)[number]) =>
                  patch(index, { emptyAction: value })
                }
              />
            </Labeled>
            <Labeled label="停留提醒（小时，0＝不提醒）">
              <InputNumber
                min={0}
                max={720}
                precision={0}
                value={node.remindAfterHours}
                onChange={(value) =>
                  patch(index, { remindAfterHours: Number(value) || 0 })
                }
              />
            </Labeled>
            <Labeled label="该节点通过后抄送">
              <MemberSelect
                members={members}
                mode="multiple"
                value={node.ccUserIds}
                placeholder="不抄送"
                style={{ minWidth: 240 }}
                onChange={(next) => patch(index, { ccUserIds: next as string[] })}
              />
            </Labeled>
          </div>
        </div>
      ))}

      {nodes.length < MAX_NODES ? (
        <Button onClick={() => onChange([...nodes, newNode()])}>＋ 添加审批节点</Button>
      ) : (
        <span className="muted text-12">审批流程最多 {MAX_NODES} 个节点</span>
      )}
    </Space>
  );
}

/**
 * 流程预览：模板编辑器与新建申请共用一份，按当前填写高亮会走到的节点。
 * 金额阈值之类的条件写在预览里，让发起人提交前就知道流程会怎么走。
 */
export function FlowPreview({
  nodes,
  fields,
  members,
  formData,
}: {
  nodes: OaFlowNode[];
  fields: OaField[];
  members: OaMember[];
  formData: Record<string, unknown>;
}) {
  if (!nodes.length) {
    return <EmptyState text="该模板没有审批节点，提交后直接结束" />;
  }
  const amount = oaAmountOf(formData, fields);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {nodes.map((node, index) => {
        const hit = oaConditionHit(node.condition, (name) => formData[name], amount);
        return (
          <div
            key={`${node.name}-${index}`}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
              opacity: hit ? 1 : 0.55,
            }}
          >
            <Tag>{index + 1}</Tag>
            <strong>{node.name}</strong>
            <span className="muted text-12">{oaApproverText(node, members)}</span>
            <span className="muted text-12">
              {OA_APPROVAL_MODE_LABELS[node.mode] || node.mode}
            </span>
            {node.condition?.field ? (
              <span className="muted text-12">
                当 {oaConditionText(node.condition, fields)}
              </span>
            ) : null}
            <span className="muted text-12">
              {OA_EMPTY_ACTION_LABELS[node.emptyAction] || node.emptyAction}
            </span>
            {!hit ? <Tag>按当前填写不会走到</Tag> : null}
          </div>
        );
      })}
    </div>
  );
}
