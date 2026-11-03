"use client";

import { App, Button, Input, InputNumber, Modal, Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import {
  ACCOUNT_STATUS_LABEL,
  ACCOUNT_STATUS_OPTIONS,
  ENV_TYPE_OPTIONS,
  PLATFORM_OPTIONS,
  PROXY_METHOD_LABEL,
  PROXY_METHOD_OPTIONS,
  PROXY_TYPE_LABEL,
  PROXY_TYPE_OPTIONS,
  platformLabel,
  rpaApi,
  type RpaAccount,
} from "./common";

type AccountForm = {
  platform: string;
  nickname: string;
  username: string;
  password: string;
  loginUrl: string;
  envType: number;
  groupId: string;
  status: string;
  proxyMethod: number;
  proxyType: string;
  proxyHost: string;
  proxyPort: number;
  proxyUserName: string;
  proxyPassword: string;
  notes: string;
};

const EMPTY: AccountForm = {
  platform: "",
  nickname: "",
  username: "",
  password: "",
  loginUrl: "",
  envType: 1,
  groupId: "",
  status: "active",
  proxyMethod: 2,
  proxyType: "noproxy",
  proxyHost: "",
  proxyPort: 0,
  proxyUserName: "",
  proxyPassword: "",
  notes: "",
};

const STATUS_COLOR: Record<string, string> = {
  active: "success",
  disabled: "default",
  banned: "error",
  pending: "warning",
};

/** 由已存账号回填表单：两类口令都永远不回显（后端只给 has*），留空即不改。 */
function toForm(row: RpaAccount): AccountForm {
  return {
    ...EMPTY,
    platform: row.platform,
    nickname: row.nickname,
    username: row.username,
    loginUrl: row.loginUrl,
    envType: row.envType,
    groupId: row.groupId,
    status: row.status,
    proxyMethod: row.proxyMethod,
    proxyType: row.proxyType,
    proxyHost: row.proxyHost,
    proxyPort: row.proxyPort,
    proxyUserName: row.proxyUserName,
    notes: row.notes,
  };
}

/** 代理一列：按结构化字段拼出可读文本。 */
function proxyText(row: RpaAccount) {
  if (row.proxyType === "noproxy" || !row.proxyHost) return "直连";
  const method = PROXY_METHOD_LABEL[row.proxyMethod] || "自定义";
  const type = PROXY_TYPE_LABEL[row.proxyType] || row.proxyType;
  return `${method} · ${type} · ${row.proxyHost}:${row.proxyPort}`;
}

/**
 * RPA 账号：本地执行端登录目标平台要用的凭据清单，按账号归属。
 * 一个账号可以同时登记 PC 窗口编号与云手机环境 ID，任务绑定时按任务设备取对应字段。
 * 口令提交后以密文落库，界面只显「已保存 / 未保存」，任何接口都不回显明文；
 * 明文只在本地执行端认领任务时随派发返回一次。
 */
export function AccountPanel({
  accounts,
  reload,
}: {
  accounts: RpaAccount[];
  reload: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RpaAccount | null>(null);
  const [form, setForm] = useState<AccountForm>(EMPTY);
  const [busy, setBusy] = useState(false);

  const patch = (next: Partial<AccountForm>) =>
    setForm((prev) => ({ ...prev, ...next }));

  const submit = async () => {
    const platform = form.platform.trim();
    const username = form.username.trim();
    const body = {
      platform,
      nickname: form.nickname.trim(),
      username,
      loginUrl: form.loginUrl.trim(),
      envType: form.envType,
      groupId: form.groupId.trim(),
      status: form.status,
      proxyMethod: form.proxyMethod,
      proxyType: form.proxyType,
      proxyHost: form.proxyHost.trim(),
      proxyPort: form.proxyPort,
      proxyUserName: form.proxyUserName.trim(),
      proxyPassword: form.proxyPassword,
      notes: form.notes.trim(),
      password: form.password,
    };
    if (editing) {
      const target = editing;
      request({
        title: "修改 RPA 账号（需密码）",
        content: `确认修改「${target.platform} / ${target.username}」？${
          form.password || form.proxyPassword
            ? "填写的登录 / 代理口令会一并替换。"
            : "口令留空＝沿用已存口令。"
        }`,
        okText: "保存修改",
        onOk: async () => {
          await rpaApi.updateAccount(target.id, body);
          close();
          await reload();
        },
      });
      return;
    }
    setBusy(true);
    try {
      await rpaApi.createAccount(body);
      close();
      await reload();
      message.success("已登记 1 个 RPA 账号");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setOpen(false);
    setEditing(null);
    setForm(EMPTY);
  };

  const remove = (row: RpaAccount) => {
    request({
      title: "删除 RPA 账号",
      content: `确认删除「${row.platform} / ${row.username}」？被 RPA 任务引用的账号要先调整任务才能删。`,
      danger: true,
      okText: "确认删除",
      onOk: async () => {
        await rpaApi.deleteAccount(row.id);
        await reload();
      },
    });
  };

  const columns: ColumnsType<RpaAccount> = [
    {
      title: "平台",
      dataIndex: "platform",
      key: "platform",
      width: 160,
      render: (value: string) => <b>{platformLabel(value)}</b>,
    },
    {
      title: "登录账号",
      dataIndex: "username",
      key: "username",
      width: 180,
      render: (value: string, row) => (
        <span>
          {value}
          {row.nickname ? (
            <span className="text-12 muted">{` （${row.nickname}）`}</span>
          ) : null}
        </span>
      ),
    },
    {
      title: "分组 ID",
      dataIndex: "groupId",
      key: "groupId",
      width: 120,
      ellipsis: true,
      render: (value: string) => value || "—",
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 90,
      render: (value: string) => (
        <Tag color={STATUS_COLOR[value] || "default"}>
          {ACCOUNT_STATUS_LABEL[value] || value}
        </Tag>
      ),
    },
    {
      title: "登录口令",
      key: "password",
      width: 100,
      render: (_, row) => (row.hasPassword ? "已保存" : "未保存"),
    },
    {
      title: "代理",
      key: "proxy",
      width: 200,
      ellipsis: true,
      render: (_, row) => proxyText(row),
    },
    {
      title: "最近派发",
      dataIndex: "lastLoginAt",
      key: "lastLoginAt",
      width: 150,
      render: (value: string | null) => fmtTime(value),
    },
    {
      title: "操作",
      key: "actions",
      width: 110,
      render: (_, row) => (
        <Button.Group>
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
        </Button.Group>
      ),
    },
  ];

  return (
    <Panel
      title="RPA 账号"
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
      {accounts.length ? (
        <Table<RpaAccount>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={accounts}
          scroll={{ x: "max-content" }}
          pagination={false}
        />
      ) : (
        <EmptyState text="还没有 RPA 账号：本地执行端要靠它登录目标平台，先登记一个" />
      )}

      <Modal
        open={open}
        title={editing ? `修改账号（${editing.username}）` : "登记 RPA 账号"}
        onCancel={close}
        onOk={() => void submit()}
        okText={busy ? "提交中" : editing ? "下一步（密码确认）" : "保存"}
        cancelText="取消"
        confirmLoading={busy}
        destroyOnHidden
        width={640}
      >
        <div className="data-table-form">
          <label className="data-table-form-item">
            <span className="data-table-form-label">
              平台<b style={{ color: "var(--danger)" }}> *</b>
            </span>
            <Select
              value={form.platform || undefined}
              showSearch
              placeholder="选择目标平台（对齐比特浏览器 platform 下拉）"
              options={PLATFORM_OPTIONS}
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase()) ||
                (option?.value as string)?.toLowerCase().includes(input.toLowerCase())
              }
              onChange={(value) => patch({ platform: value })}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">
              登录账号<b style={{ color: "var(--danger)" }}> *</b>
            </span>
            <Input
              value={form.username}
              maxLength={191}
              placeholder="本地执行端要用的登录名"
              onChange={(event) => patch({ username: event.target.value })}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">
              登录口令{editing ? "" : " *"}
            </span>
            <Input.Password
              value={form.password}
              placeholder={
                editing
                  ? "留空＝沿用已存口令；填写＝替换"
                  : "执行端登录要用的口令，保存后不再回显"
              }
              onChange={(event) => patch({ password: event.target.value })}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">昵称</span>
            <Input
              value={form.nickname}
              maxLength={128}
              placeholder="平台上的显示名"
              onChange={(event) => patch({ nickname: event.target.value })}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">分组 ID</span>
            <Input
              value={form.groupId}
              maxLength={128}
              placeholder="比特浏览器 /group/list 返回的分组 ID"
              onChange={(event) => patch({ groupId: event.target.value })}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">账号状态</span>
            <Select
              value={form.status}
              options={ACCOUNT_STATUS_OPTIONS}
              onChange={(value) => patch({ status: value })}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">云手机计费方式</span>
            <Select
              value={form.envType}
              placeholder="套餐计费 / 按时计费（云手机任务必填）"
              options={ENV_TYPE_OPTIONS}
              onChange={(value) => patch({ envType: value })}
            />
          </label>
          <div className="text-12 muted" style={{ gridColumn: "1 / -1" }}>
            云手机任务要求同一批账号统一计费模式；环境 ID 由执行时动态分配，不在账号上登记。
          </div>
          <label className="data-table-form-item">
            <span className="data-table-form-label">登录入口</span>
            <Input
              value={form.loginUrl}
              maxLength={500}
              placeholder="https://…"
              onChange={(event) => patch({ loginUrl: event.target.value })}
            />
          </label>
          <div className="text-12 muted" style={{ gridColumn: "1 / -1", fontWeight: 600 }}>
            代理配置（对齐比特浏览器 /browser/add 的 proxy 字段）
          </div>
          <label className="data-table-form-item">
            <span className="data-table-form-label">代理方式</span>
            <Select
              value={form.proxyMethod}
              options={PROXY_METHOD_OPTIONS}
              onChange={(value) => patch({ proxyMethod: value })}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">代理类型</span>
            <Select
              value={form.proxyType}
              options={PROXY_TYPE_OPTIONS}
              onChange={(value) => patch({ proxyType: value })}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">代理主机</span>
            <Input
              value={form.proxyHost}
              maxLength={255}
              placeholder="如 127.0.0.1（代理类型非直连时填写）"
              onChange={(event) => patch({ proxyHost: event.target.value })}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">代理端口</span>
            <InputNumber
              value={form.proxyPort}
              min={0}
              max={65535}
              placeholder="如 7890"
              style={{ width: "100%" }}
              onChange={(value) => patch({ proxyPort: value ?? 0 })}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">代理用户名</span>
            <Input
              value={form.proxyUserName}
              maxLength={200}
              placeholder="代理需要认证时填写"
              onChange={(event) =>
                patch({ proxyUserName: event.target.value })
              }
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">代理密码</span>
            <Input.Password
              value={form.proxyPassword}
              maxLength={200}
              placeholder={
                editing
                  ? "留空＝沿用已存口令；填写＝替换"
                  : "代理需要认证时填写，保存后不再回显"
              }
              onChange={(event) =>
                patch({ proxyPassword: event.target.value })
              }
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">备注</span>
            <Input.TextArea
              rows={2}
              value={form.notes}
              maxLength={500}
              placeholder="验证码方式、绑定手机等执行端要知道的信息"
              onChange={(event) => patch({ notes: event.target.value })}
            />
          </label>
        </div>
      </Modal>
      {modal}
    </Panel>
  );
}
