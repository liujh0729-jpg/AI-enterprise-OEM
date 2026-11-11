"use client";

import { App, Button, Input, Modal, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useState } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import {
  AI_CALL_STATUS_LABEL,
  AI_CALL_STATUS_OPTIONS,
  aiCallApi,
  extraLines,
  parseExtraLines,
  type AiCallAccount,
  type WorkbuddyAccountOption,
} from "./common";

type AccountForm = {
  name: string;
  platform: string;
  loginUrl: string;
  username: string;
  password: string;
  apiKey: string;
  cookie: string;
  extraText: string;
  status: string;
  notes: string;
  workbuddyAccountIds: number[];
};

const EMPTY: AccountForm = {
  name: "",
  platform: "",
  loginUrl: "",
  username: "",
  password: "",
  apiKey: "",
  cookie: "",
  extraText: "",
  status: "active",
  notes: "",
  workbuddyAccountIds: [],
};

/** 已存账号回填：凭据永远不回显（后端只给 hasXxx），留空即不改。 */
function toForm(row: AiCallAccount): AccountForm {
  return {
    ...EMPTY,
    name: row.name,
    platform: row.platform,
    loginUrl: row.loginUrl,
    username: row.username,
    extraText: extraLines(row.extra),
    status: row.status,
    notes: row.notes,
    workbuddyAccountIds: row.bindings.map((item) => item.workbuddyAccountId),
  };
}

/**
 * AI 调用账号：AI 自动化任务登录第三方平台要用的凭据清单。
 * 口令 / API Key / Cookie 以密文落库，界面只显「存过没有」；
 * 每个账号至少要绑定一个 Workbuddy Enterprise 账号，机器通道只按绑定放行。
 */
export function AccountPanel({
  accounts,
  workbuddyAccounts,
  reload,
}: {
  accounts: AiCallAccount[];
  workbuddyAccounts: WorkbuddyAccountOption[];
  reload: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AiCallAccount | null>(null);
  const [form, setForm] = useState<AccountForm>(EMPTY);
  const [busy, setBusy] = useState(false);

  const patch = (next: Partial<AccountForm>) =>
    setForm((prev) => ({ ...prev, ...next }));

  const close = () => {
    setOpen(false);
    setEditing(null);
    setForm(EMPTY);
  };

  const submit = async () => {
    const name = form.name.trim();
    const platform = form.platform.trim();
    if (!name) {
      message.error("请填写账号名称");
      return;
    }
    if (!platform) {
      message.error("请填写平台名称或站点地址");
      return;
    }
    if (!form.workbuddyAccountIds.length) {
      message.error("请至少绑定一个 Workbuddy Enterprise 账号");
      return;
    }
    const secretReady = Boolean(
      form.password || form.apiKey.trim() || form.cookie.trim(),
    );
    if (!editing && !secretReady) {
      message.error("请至少填一种凭据：登录口令 / API Key / Cookie");
      return;
    }
    const body = {
      name,
      platform,
      loginUrl: form.loginUrl.trim(),
      username: form.username.trim(),
      password: form.password,
      apiKey: form.apiKey.trim(),
      cookie: form.cookie.trim(),
      extra: parseExtraLines(form.extraText),
      status: form.status,
      notes: form.notes.trim(),
      workbuddyAccountIds: form.workbuddyAccountIds,
    };
    if (editing) {
      const target = editing;
      request({
        title: "修改 AI 调用账号（需密码）",
        content: `确认修改「${target.name}」？${
          secretReady
            ? "填写的凭据会替换旧值，没填的凭据保持原样。"
            : "凭据留空＝沿用已存值。"
        }`,
        okText: "保存修改",
        onOk: async () => {
          await aiCallApi.updateAccount(target.id, body);
          close();
          await reload();
        },
      });
      return;
    }
    setBusy(true);
    try {
      await aiCallApi.createAccount(body);
      close();
      await reload();
      message.success("已登记 1 个 AI 调用账号");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = (row: AiCallAccount) => {
    request({
      title: "删除 AI 调用账号",
      content: `确认删除「${row.name}」？删除后绑定的 Workbuddy Enterprise 账号将无法再取用这份凭据。`,
      danger: true,
      okText: "确认删除",
      onOk: async () => {
        await aiCallApi.deleteAccount(row.id);
        await reload();
      },
    });
  };

  const workbuddyOptions = workbuddyAccounts.map((item) => ({
    value: item.id,
    label:
      item.status === "active" ? item.name : `${item.name}（已停用）`,
  }));

  const columns: ColumnsType<AiCallAccount> = [
    {
      title: "账号名称",
      dataIndex: "name",
      key: "name",
      width: 160,
      render: (value: string) => <b>{value}</b>,
    },
    {
      title: "平台",
      dataIndex: "platform",
      key: "platform",
      width: 180,
      ellipsis: true,
      render: (value: string, row) =>
        row.loginUrl ? (
          <a href={row.loginUrl} target="_blank" rel="noreferrer">
            {value}
          </a>
        ) : (
          value
        ),
    },
    {
      title: "登录账号",
      dataIndex: "username",
      key: "username",
      width: 170,
      ellipsis: true,
      render: (value: string) => value || "—",
    },
    {
      title: "凭据",
      key: "credentials",
      width: 190,
      render: (_, row) => {
        const tags = [
          row.hasPassword ? "口令" : "",
          row.hasApiKey ? "API Key" : "",
          row.hasCookie ? "Cookie" : "",
        ].filter(Boolean);
        return tags.length
          ? tags.map((label) => <Tag key={label}>{label}</Tag>)
          : "—";
      },
    },
    {
      title: "绑定的 Workbuddy Enterprise 账号",
      key: "bindings",
      width: 260,
      render: (_, row) =>
        row.bindings.length
          ? row.bindings.map((binding) => (
              <Tag
                key={binding.workbuddyAccountId}
                color={binding.status === "active" ? "blue" : "default"}
              >
                {binding.name}
                {binding.status === "active" ? "" : "（停用）"}
              </Tag>
            ))
          : "—",
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 90,
      render: (value: string) => (
        <Tag color={value === "active" ? "success" : "default"}>
          {AI_CALL_STATUS_LABEL[value] || value}
        </Tag>
      ),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 150,
      render: (value: string) => fmtTime(value),
    },
    {
      title: "操作",
      key: "actions",
      width: 110,
      render: (_, row) => (
        <Space.Compact>
          <Button
            onClick={() => {
              setEditing(row);
              setForm(toForm(row));
              setOpen(true);
            }}
          >
            改
          </Button>
          <Button danger onClick={() => remove(row)}>
            删
          </Button>
        </Space.Compact>
      ),
    },
  ];

  return (
    <Panel
      title="AI 调用账号"
      titleBadge={`${accounts.length} 个`}
      extra={
        <Button
          onClick={() => {
            setEditing(null);
            setForm(EMPTY);
            setOpen(true);
          }}
        >
          登记账号
        </Button>
      }
    >
      {workbuddyAccounts.length ? null : (
        <div style={{ marginBottom: 12 }}>
          <Notice variant="warn">
            还没有 Workbuddy Enterprise 账号：先到「Workbuddy Enterprise 账号」页签绑定腾讯云密钥，
            再回来登记 AI 调用账号。{" "}
            <Link href="/workbuddy?tab=accounts">去绑定账号</Link>
          </Notice>
        </div>
      )}
      {accounts.length ? (
        <Table<AiCallAccount>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={accounts}
          scroll={{ x: "max-content" }}
          pagination={false}
        />
      ) : (
        <EmptyState text="还没有 AI 调用账号：先登记第三方平台的凭据，再绑定 Workbuddy Enterprise 账号" />
      )}

      <Modal
        open={open}
        title={editing ? `修改账号（${editing.name}）` : "登记 AI 调用账号"}
        onCancel={close}
        onOk={() => void submit()}
        okText={busy ? "提交中" : editing ? "下一步（密码确认）" : "保存"}
        cancelText="取消"
        confirmLoading={busy}
        destroyOnHidden
        width={720}
      >
        <div className="data-table-form">
          <label className="data-table-form-item">
            <span className="data-table-form-label">
              账号名称<b style={{ color: "var(--danger)" }}> *</b>
            </span>
            <Input
              value={form.name}
              maxLength={128}
              placeholder="便于在任务里认出它，如「淘宝-运营店」"
              onChange={(event) => patch({ name: event.target.value })}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">
              平台<b style={{ color: "var(--danger)" }}> *</b>
            </span>
            <Input
              value={form.platform}
              maxLength={191}
              placeholder="如 淘宝 / 微信公众号 / https://www.taobao.com"
              onChange={(event) => patch({ platform: event.target.value })}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">登录入口</span>
            <Input
              value={form.loginUrl}
              maxLength={500}
              placeholder="https://…（可选）"
              onChange={(event) => patch({ loginUrl: event.target.value })}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">用户名</span>
            <Input
              value={form.username}
              maxLength={191}
              placeholder="平台登录名 / 账号 ID"
              onChange={(event) => patch({ username: event.target.value })}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">登录口令</span>
            <Input.Password
              value={form.password}
              maxLength={500}
              placeholder={
                editing
                  ? editing.hasPassword
                    ? "已保存；留空沿用，填写则替换"
                    : "未保存；按需填写"
                  : "按平台填写，保存后不再回显"
              }
              onChange={(event) => patch({ password: event.target.value })}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">API Key</span>
            <Input.Password
              value={form.apiKey}
              maxLength={2000}
              placeholder={
                editing
                  ? editing.hasApiKey
                    ? "已保存；留空沿用，填写则替换"
                    : "未保存；按需填写"
                  : "平台签发的 API Key / Access Token"
              }
              onChange={(event) => patch({ apiKey: event.target.value })}
            />
          </label>
          <label className="data-table-form-item" style={{ gridColumn: "1 / -1" }}>
            <span className="data-table-form-label">Cookie</span>
            <Input.TextArea
              value={form.cookie}
              rows={3}
              placeholder={
                editing && editing.hasCookie
                  ? "已保存；留空沿用，填写则替换"
                  : "从浏览器复制的 Cookie 原文（可选）"
              }
              onChange={(event) => patch({ cookie: event.target.value })}
            />
          </label>
          <label className="data-table-form-item" style={{ gridColumn: "1 / -1" }}>
            <span className="data-table-form-label">其他字段</span>
            <Input.TextArea
              value={form.extraText}
              rows={3}
              placeholder={"一行一条，如：\nshopId: 123456\nsubAccount: ops-a"}
              onChange={(event) => patch({ extraText: event.target.value })}
            />
          </label>
          <label className="data-table-form-item" style={{ gridColumn: "1 / -1" }}>
            <span className="data-table-form-label">
              绑定 Workbuddy Enterprise 账号
              <b style={{ color: "var(--danger)" }}> *</b>
            </span>
            <Select
              mode="multiple"
              value={form.workbuddyAccountIds}
              placeholder="选择允许取用这份凭据的 Workbuddy Enterprise 账号（可多选）"
              options={workbuddyOptions}
              onChange={(value: number[]) =>
                patch({ workbuddyAccountIds: value })
              }
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">状态</span>
            <Select
              value={form.status}
              options={AI_CALL_STATUS_OPTIONS}
              onChange={(value) => patch({ status: value })}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">备注</span>
            <Input
              value={form.notes}
              maxLength={500}
              placeholder="验证码方式、登录限制等"
              onChange={(event) => patch({ notes: event.target.value })}
            />
          </label>
        </div>
      </Modal>
      {modal}
    </Panel>
  );
}
