"use client";

import { Alert, App, Form, Modal, Select, Space, Tag } from "antd";
import { useEffect, useState } from "react";
import {
  workbuddyApi,
  type DispatchTarget,
  type PlanAccount,
  type WbAgentItem,
  type WbVersion,
} from "./common";

/**
 * 派发目标选择：账号 → Agent → 版本（可选，留空＝用 Agent 最新版本）。
 * 全部选项都来自腾讯云接口（Select 不让手输 ID），换账号会清空 Agent 与版本。
 */
export function AgentPicker({
  accounts,
  accountId,
  agentId,
  versionId,
  onChange,
}: {
  accounts: PlanAccount[];
  accountId?: number;
  agentId?: string;
  versionId?: string;
  onChange: (next: {
    accountId?: number;
    agentId?: string;
    versionId?: string;
  }) => void;
}) {
  const [agents, setAgents] = useState<WbAgentItem[]>([]);
  const [versions, setVersions] = useState<WbVersion[]>([]);
  const [agentError, setAgentError] = useState("");
  const [versionError, setVersionError] = useState("");
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);

  const activeAccounts = accounts.filter((item) => item.status === "active");

  useEffect(() => {
    if (!accountId) {
      setAgents([]);
      setAgentError("");
      return;
    }
    let alive = true;
    setLoadingAgents(true);
    setAgentError("");
    void workbuddyApi
      .agents({ accountId, limit: 100 })
      .then((result) => {
        if (!alive) return;
        setAgents(result.data?.items || []);
        setAgentError(result.message);
      })
      .finally(() => {
        if (alive) setLoadingAgents(false);
      });
    return () => {
      alive = false;
    };
  }, [accountId]);

  useEffect(() => {
    if (!accountId || !agentId) {
      setVersions([]);
      setVersionError("");
      return;
    }
    let alive = true;
    setLoadingVersions(true);
    setVersionError("");
    void workbuddyApi
      .agentVersions({ accountId, agentId, limit: 100 })
      .then((result) => {
        if (!alive) return;
        setVersions(result.data?.items || []);
        setVersionError(result.message);
      })
      .finally(() => {
        if (alive) setLoadingVersions(false);
      });
    return () => {
      alive = false;
    };
  }, [accountId, agentId]);

  return (
    <Space orientation="vertical" size={8} style={{ width: "100%" }}>
      <Select
        style={{ width: "100%" }}
        value={accountId}
        placeholder="选择 Workbuddy Enterprise 账号（用哪把腾讯云 Key 执行）"
        options={activeAccounts.map((item) => ({
          value: item.id,
          label: item.name,
        }))}
        onChange={(value) =>
          onChange({ accountId: value, agentId: undefined, versionId: undefined })
        }
      />
      <Select
        style={{ width: "100%" }}
        value={agentId}
        placeholder={
          accountId
            ? loadingAgents
              ? "正在读取该账号下的 Agent…"
              : "选择 Agent"
            : "先选 Workbuddy Enterprise 账号"
        }
        disabled={!accountId}
        loading={loadingAgents}
        showSearch
        optionFilterProp="label"
        notFoundContent={accountId && !loadingAgents ? "该账号下没有 Agent" : null}
        options={agents
          .filter((item) => Boolean(item.AgentId))
          .map((item) => ({
            value: String(item.AgentId),
            label: `${item.AgentName || "未命名 Agent"}（${String(item.AgentId).slice(0, 10)}）`,
          }))}
        onChange={(value) =>
          onChange({ accountId, agentId: value, versionId: undefined })
        }
      />
      <Select
        style={{ width: "100%" }}
        value={versionId || undefined}
        placeholder={agentId ? "版本（留空＝最新版本）" : "先选 Agent"}
        allowClear
        disabled={!agentId}
        loading={loadingVersions}
        options={versions
          .filter((item) => Boolean(item.VersionId))
          .map((item) => ({
            value: String(item.VersionId),
            label: `${item.VersionName || item.VersionId}${item.Status ? ` · ${item.Status}` : ""}`,
          }))}
        onChange={(value) => onChange({ accountId, agentId, versionId: value })}
      />
      {agentError ? (
        <span className="text-12" style={{ color: "var(--danger)" }}>
          {agentError}
        </span>
      ) : null}
      {versionError ? (
        <span className="text-12" style={{ color: "var(--danger)" }}>
          {versionError}
        </span>
      ) : null}
    </Space>
  );
}

/** 一个账号一行：多账号并行时，每个账号各自选 Agent 与版本。 */
function TargetRow({
  accounts,
  value,
  onChange,
}: {
  accounts: PlanAccount[];
  value: DispatchTarget;
  onChange: (next: DispatchTarget) => void;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 10,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        {accounts.find((item) => item.id === value.accountId)?.name ||
          `账号 #${value.accountId}`}
      </div>
      <AgentPicker
        accounts={accounts.filter((item) => item.id === value.accountId)}
        accountId={value.accountId}
        agentId={value.agentId}
        versionId={value.versionId}
        onChange={(next) => onChange({ ...value, ...next })}
      />
    </div>
  );
}

/**
 * 拆解任务书 / 新建明确任务与定时任务共用的派发目标选择（唯一实现）：
 * 多选账号（最多 10 个）+ 每个账号各自选 Agent 与版本。
 * 选多个账号时步骤按顺序轮流铺到不同账号上（并行加速），不是把同一步重复发给多个 Agent。
 */
export type TargetSelection = {
  accountIds: number[];
  targets: Record<number, DispatchTarget>;
};

export const EMPTY_TARGETS: TargetSelection = { accountIds: [], targets: {} };

/** 归一化账号选择：移除的账号要连带丢掉它已选的 Agent，否则残留会悄悄派发到旧目标。 */
export function pickAccounts(
  value: TargetSelection,
  accountIds: number[],
): TargetSelection {
  const next = accountIds.slice(0, 10);
  const kept: Record<number, DispatchTarget> = {};
  next.forEach((id) => {
    if (value.targets[id]) kept[id] = value.targets[id];
  });
  return { accountIds: next, targets: kept };
}

/** 派发前的必填校验：返回的 error 非空＝还没选全。 */
export function resolveTargets(
  accounts: PlanAccount[],
  value: TargetSelection,
): { targets: DispatchTarget[]; error: string } {
  if (!value.accountIds.length) {
    return { targets: [], error: "请选择至少一个 Workbuddy Enterprise 账号" };
  }
  const rows: DispatchTarget[] = [];
  for (const id of value.accountIds) {
    const target = value.targets[id];
    if (!target?.agentId) {
      const name =
        accounts.find((item) => item.id === id)?.name || `账号 #${id}`;
      return { targets: [], error: `请为「${name}」选择 Agent` };
    }
    rows.push({ accountId: id, agentId: target.agentId, versionId: target.versionId });
  }
  return { targets: rows, error: "" };
}

export function TargetPicker({
  accounts,
  label,
  value,
  onChange,
}: {
  accounts: PlanAccount[];
  label: string;
  value: TargetSelection;
  onChange: (next: TargetSelection) => void;
}) {
  const activeAccounts = accounts.filter((item) => item.status === "active");
  return (
    <>
      <Form layout="vertical">
        <Form.Item label={label}>
          <Select
            mode="multiple"
            value={value.accountIds}
            placeholder="选择用来执行这些步骤的账号"
            options={activeAccounts.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
            onChange={(values: number[]) => onChange(pickAccounts(value, values))}
          />
        </Form.Item>
      </Form>
      <Space orientation="vertical" size={10} style={{ width: "100%" }}>
        {value.accountIds.map((id) => (
          <TargetRow
            key={id}
            accounts={activeAccounts}
            value={value.targets[id] || { accountId: id, agentId: "" }}
            onChange={(next) =>
              onChange({
                ...value,
                targets: { ...value.targets, [id]: next },
              })
            }
          />
        ))}
      </Space>
      {activeAccounts.length ? null : (
        <div className="text-12 muted" style={{ marginTop: 8 }}>
          还没有启用的 Workbuddy Enterprise 账号：先到「Workbuddy Enterprise 账号」页签绑定腾讯云密钥。
        </div>
      )}
    </>
  );
}

/**
 * 拆解任务书：把步骤摊成任务行。
 */
export function MaterializeModal({
  open,
  planTitle,
  stepCount,
  accounts,
  busy,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  planTitle: string;
  stepCount: number;
  accounts: PlanAccount[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (targets: DispatchTarget[]) => Promise<void>;
}) {
  const { message } = App.useApp();
  const [selection, setSelection] = useState<TargetSelection>(EMPTY_TARGETS);

  useEffect(() => {
    if (!open) return;
    setSelection(EMPTY_TARGETS);
  }, [open]);

  const submit = async () => {
    const { targets, error } = resolveTargets(accounts, selection);
    if (error) {
      message.error(error);
      return;
    }
    await onSubmit(targets);
  };

  return (
    <Modal
      open={open}
      title={`拆解任务书 → ${planTitle}`}
      width={720}
      onCancel={onCancel}
      onOk={() => void submit()}
      okText={busy ? "拆解中" : "拆解为任务"}
      cancelText="取消"
      confirmLoading={busy}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        title={`任务书共 ${stepCount} 步；选多个账号时，步骤按顺序轮流分给不同账号并行执行。`}
      />
      <TargetPicker
        accounts={accounts}
        label="Workbuddy Enterprise 账号（可多选，最多 10 个）"
        value={selection}
        onChange={setSelection}
      />
    </Modal>
  );
}

/** A2A 状态标签：只有 Enabled 才代表外部能通过会话接入点调这个 Agent。 */
export function A2AStatusTag({ item }: { item: WbAgentItem }) {
  const enabled = Boolean(item.A2AEnabled);
  return (
    <Tag color={enabled ? "success" : "default"}>
      {enabled ? item.A2AStatus || "已启用" : "未启用"}
    </Tag>
  );
}
