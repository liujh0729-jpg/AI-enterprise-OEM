"use client";

import { App, Input, InputNumber, Modal, Select, Space, Switch } from "antd";
import { useEffect, useState } from "react";
import {
  HW_TOOL_CODE_MAX,
  HW_TOOL_CODE_PATTERN,
  HW_TOOL_DESCRIPTION_MAX,
  HW_TOOL_KINDS,
  HW_TOOL_KIND_LABELS,
  HW_TOOL_NAME_MAX,
  HW_TOOL_TRANSPORTS,
  HW_TOOL_TRANSPORT_LABELS,
  type HwTool,
  type HwToolKind,
  type HwToolSaveBody,
  type HwToolTransport,
} from "@enterprise/contracts";

type Draft = {
  kind: HwToolKind;
  code: string;
  name: string;
  description: string;
  transport: HwToolTransport;
  method: string;
  path: string;
  commandCode: string;
  paramsText: string;
  responseText: string;
  examplesText: string;
  write: boolean;
  requiresGrant: boolean;
  enabled: boolean;
  sortOrder: number;
};

const EMPTY: Draft = {
  kind: "MCP",
  code: "",
  name: "",
  description: "",
  transport: "DEVICE",
  method: "POST",
  path: "",
  commandCode: "",
  paramsText: "{}",
  responseText: "{}",
  examplesText: "[]",
  write: false,
  requiresGrant: true,
  enabled: true,
  sortOrder: 0,
};

function draftOf(initial: HwTool | null, lockKind?: HwToolKind): Draft {
  if (!initial) return { ...EMPTY, kind: lockKind ?? EMPTY.kind };
  return {
    kind: initial.kind,
    code: initial.code,
    name: initial.name,
    description: initial.description,
    transport: initial.transport,
    method: initial.method || "POST",
    path: initial.path,
    commandCode: initial.commandCode,
    paramsText: JSON.stringify(initial.params ?? {}, null, 2),
    responseText: JSON.stringify(initial.response ?? {}, null, 2),
    examplesText: JSON.stringify(initial.examples ?? [], null, 2),
    write: initial.write,
    requiresGrant: initial.requiresGrant,
    enabled: initial.enabled,
    sortOrder: initial.sortOrder,
  };
}

/**
 * 硬件工具编辑表单（型号默认工具与用户自建工具共用）：只收集并校验字段，
 * 具体落库由调用方决定（管理端走 AdminHw_，用户侧走 Hw_）。lockKind 用于把种类固定为当前页的 API / MCP。
 */
export function ToolEditorModal({
  open,
  initial,
  lockKind,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial: HwTool | null;
  lockKind?: HwToolKind;
  saving: boolean;
  onClose: () => void;
  onSubmit: (body: HwToolSaveBody) => Promise<void>;
}) {
  const { message } = App.useApp();
  const [draft, setDraft] = useState<Draft>(EMPTY);

  useEffect(() => {
    if (open) setDraft(draftOf(initial, lockKind));
  }, [open, initial, lockKind]);

  const patch = (next: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...next }));

  const submit = async () => {
    const code = draft.code.trim();
    const name = draft.name.trim();
    if (!HW_TOOL_CODE_PATTERN.test(code)) {
      message.warning("工具编码需要 2-64 位，以小写字母或数字开头，只能用小写字母、数字、连字符与下划线");
      return;
    }
    if (!name) {
      message.warning("请填写工具名称");
      return;
    }
    if (draft.transport === "HTTP" && !draft.path.trim()) {
      message.warning("设备直连（HTTP）工具需要填写接口路径");
      return;
    }
    if (draft.transport === "DEVICE" && !draft.commandCode.trim()) {
      message.warning("指令下发（DEVICE）工具需要填写指令编码 commandCode");
      return;
    }
    let params: Record<string, unknown>;
    let response: Record<string, unknown>;
    let examples: unknown[];
    try {
      const parsed = JSON.parse(draft.paramsText || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      params = parsed as Record<string, unknown>;
    } catch {
      message.warning("参数 Schema 必须是 JSON 对象");
      return;
    }
    try {
      const parsed = JSON.parse(draft.responseText || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      response = parsed as Record<string, unknown>;
    } catch {
      message.warning("响应必须是 JSON 对象");
      return;
    }
    try {
      const parsed = JSON.parse(draft.examplesText || "[]");
      if (!Array.isArray(parsed)) throw new Error();
      examples = parsed;
    } catch {
      message.warning("示例必须是 JSON 数组");
      return;
    }
    await onSubmit({
      kind: lockKind ?? draft.kind,
      code,
      name,
      description: draft.description.trim(),
      transport: draft.transport,
      method: draft.method.trim() || "POST",
      path: draft.path.trim(),
      commandCode: draft.commandCode.trim(),
      params,
      response,
      examples,
      write: draft.write,
      requiresGrant: draft.requiresGrant,
      enabled: draft.enabled,
      sortOrder: draft.sortOrder,
    });
  };

  return (
    <Modal
      open={open}
      title={initial ? `编辑工具 · ${initial.name}` : "新增工具"}
      onCancel={onClose}
      onOk={() => void submit()}
      confirmLoading={saving}
      okText="保存"
      width={720}
      destroyOnHidden
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <div className="form-2col">
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>种类</div>
            <Select
              style={{ width: "100%" }}
              value={lockKind ?? draft.kind}
              disabled={Boolean(lockKind)}
              onChange={(value) => patch({ kind: value })}
              options={HW_TOOL_KINDS.map((item) => ({ value: item, label: HW_TOOL_KIND_LABELS[item] }))}
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>执行通道</div>
            <Select
              style={{ width: "100%" }}
              value={draft.transport}
              onChange={(value) => patch({ transport: value })}
              options={HW_TOOL_TRANSPORTS.map((item) => ({ value: item, label: HW_TOOL_TRANSPORT_LABELS[item] }))}
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>工具编码（进 MCP 工具名 hw__型号__编码）</div>
            <Input
              className="mono"
              value={draft.code}
              maxLength={HW_TOOL_CODE_MAX}
              disabled={Boolean(initial)}
              placeholder="read-gpio / set-led"
              onChange={(event) => patch({ code: event.target.value })}
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>工具名称</div>
            <Input
              value={draft.name}
              maxLength={HW_TOOL_NAME_MAX}
              placeholder="读取 GPIO 电平"
              onChange={(event) => patch({ name: event.target.value })}
            />
          </div>
          {draft.transport === "HTTP" ? (
            <>
              <div>
                <div className="text-12 muted" style={{ marginBottom: 4 }}>HTTP 方法</div>
                <Input
                  className="mono"
                  value={draft.method}
                  maxLength={8}
                  placeholder="POST / GET"
                  onChange={(event) => patch({ method: event.target.value })}
                />
              </div>
              <div>
                <div className="text-12 muted" style={{ marginBottom: 4 }}>接口路径（拼在设备 baseUrl 后）</div>
                <Input
                  className="mono"
                  value={draft.path}
                  maxLength={300}
                  placeholder="/gpio/read"
                  onChange={(event) => patch({ path: event.target.value })}
                />
              </div>
            </>
          ) : (
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>指令编码 commandCode（设备按它匹配执行）</div>
              <Input
                className="mono"
                value={draft.commandCode}
                maxLength={64}
                placeholder="READ_GPIO"
                onChange={(event) => patch({ commandCode: event.target.value })}
              />
            </div>
          )}
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>排序（越小越靠前）</div>
            <InputNumber
              style={{ width: "100%" }}
              value={draft.sortOrder}
              onChange={(value) => patch({ sortOrder: Number(value ?? 0) })}
            />
          </div>
        </div>

        <div>
          <div className="text-12 muted" style={{ marginBottom: 4 }}>说明</div>
          <Input.TextArea
            rows={2}
            maxLength={HW_TOOL_DESCRIPTION_MAX}
            value={draft.description}
            onChange={(event) => patch({ description: event.target.value })}
          />
        </div>
        <div>
          <div className="text-12 muted" style={{ marginBottom: 4 }}>参数 Schema（JSON 对象，API 参数表与 MCP inputSchema 同源）</div>
          <Input.TextArea
            rows={4}
            className="mono"
            value={draft.paramsText}
            placeholder='{"type":"object","properties":{"pin":{"type":"integer"}}}'
            onChange={(event) => patch({ paramsText: event.target.value })}
          />
        </div>
        <div>
          <div className="text-12 muted" style={{ marginBottom: 4 }}>响应（JSON 对象）</div>
          <Input.TextArea
            rows={3}
            className="mono"
            value={draft.responseText}
            placeholder='{"value":1}'
            onChange={(event) => patch({ responseText: event.target.value })}
          />
        </div>
        <div>
          <div className="text-12 muted" style={{ marginBottom: 4 }}>示例（JSON 数组）</div>
          <Input.TextArea
            rows={3}
            className="mono"
            value={draft.examplesText}
            placeholder='[{"args":{"pin":2},"response":{"value":1}}]'
            onChange={(event) => patch({ examplesText: event.target.value })}
          />
        </div>
        <Space size={24} wrap>
          <Space>
            <Switch checked={draft.write} onChange={(value) => patch({ write: value })} />
            <span>写动作（会改设备状态 / 下发指令）</span>
          </Space>
          <Space>
            <Switch checked={draft.requiresGrant} onChange={(value) => patch({ requiresGrant: value })} />
            <span>写动作需授权</span>
          </Space>
          <Space>
            <Switch checked={draft.enabled} onChange={(value) => patch({ enabled: value })} />
            <span>启用</span>
          </Space>
        </Space>
      </Space>
    </Modal>
  );
}