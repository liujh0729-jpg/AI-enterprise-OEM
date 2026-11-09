"use client";

import { LoadingOutlined } from "@ant-design/icons";
import { AI_LEVEL_LABELS, AI_RUN_MODE_LABELS } from "@enterprise/contracts";
import { Modal, Space, Tag, Typography } from "antd";
import type { ReactNode } from "react";

/** 全站 AI 结果统一呈现：生成口径 + 等级标签 + 结果弹窗。 */

export function AiModeTag({
  mode,
  model,
}: {
  mode?: string;
  model?: string;
}) {
  const label = AI_RUN_MODE_LABELS[mode || ""] || "规则兜底";
  const color = mode === "llm" ? "blue" : mode === "retrieval" ? "purple" : "default";
  return (
    <Tag color={color} variant="filled">
      {label}
      {mode === "llm" && model ? ` · ${model}` : ""}
    </Tag>
  );
}

export function AiLevelTag({ level }: { level?: string }) {
  const color =
    level === "HIGH" ? "red" : level === "MEDIUM" ? "orange" : "green";
  return (
    <Tag color={color} variant="filled">
      {AI_LEVEL_LABELS[level || ""] || "低"}
    </Tag>
  );
}

export function AiList({
  title,
  items,
  empty,
}: {
  title: string;
  items?: string[];
  empty?: ReactNode;
}) {
  if (!items?.length) return empty ? <>{empty}</> : null;
  return (
    <div>
      <Typography.Text strong>{title}</Typography.Text>
      <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
        {items.map((item, index) => (
          <li key={`${index}-${item}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function AiResultModal({
  open,
  title,
  loading,
  mode,
  model,
  onClose,
  children,
  footer,
  width = 640,
}: {
  open: boolean;
  title: ReactNode;
  loading?: boolean;
  mode?: string;
  model?: string;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <Modal
      open={open}
      title={title}
      width={width}
      onCancel={onClose}
      footer={footer ?? null}
      destroyOnHidden
    >
      {loading ? (
        <Space>
          <LoadingOutlined spin />
          正在生成…
        </Space>
      ) : (
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          {mode ? <AiModeTag mode={mode} model={model} /> : null}
          {children}
        </Space>
      )}
    </Modal>
  );
}
