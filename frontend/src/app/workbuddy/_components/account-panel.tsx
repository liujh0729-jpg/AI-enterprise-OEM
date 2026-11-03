"use client";

import { App, Button, Form, Input, Modal, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import {
  ACCOUNT_STATUS_LABEL,
  ACCOUNT_STATUS_OPTIONS,
  REGION_OPTIONS,
  regionLabel,
  workbuddyApi,
  type WbAccount,
} from "./common";

type AccountForm = {
  name: string;
  secretId: string;
  secretKey: string;
  region: string;
  status: string;
  notes: string;
};

const EMPTY: AccountForm = {
  name: "",
  secretId: "",
  secretKey: "",
  region: "ap-guangzhou",
  status: "active",
  notes: "",
};

/**
 * Workbuddy Enterprise 账号＝用户自己的腾讯云 API 密钥。一个用户可绑多把（不同企业 / 不同子账号），
 * 计划拆解时把步骤轮流铺到多把 Key 上并行执行。SecretKey 只密文落库，界面只回打码串。
 * 「校验」真打一次 DescribeAgentList，能列出 Agent 才算这把 Key 可用。
 */
export function AccountPanel({
  accounts,
  reload,
}: {
  accounts: WbAccount[];
  reload: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WbAccount | null>(null);
  const [form, setForm] = useState<AccountForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);

  const patch = (next: Partial<AccountForm>) =>
    setForm((prev) => ({ ...prev, ...next }));

  const close = () => {
    setOpen(false);
    setEditing(null);
    setForm(EMPTY);
  };

  const submit = async () => {
    if (!form.name.trim()) {
      message.error("请给这把腾讯云凭据起个名字");
      return;
    }
    if (!editing && (!form.secretId.trim() || !form.secretKey.trim())) {
      message.error("请填写 SecretId 与 SecretKey");
      return;
    }
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      region: form.region,
      status: form.status,
      notes: form.notes.trim(),
    };
    if (form.secretId.trim()) body.secretId = form.secretId.trim();
    if (form.secretKey.trim()) body.secretKey = form.secretKey.trim();
    if (editing) {
      const target = editing;
      request({
        title: "修改 Workbuddy 凭据（需密码）",
        content: `确认修改「${target.name}」？密钥留空＝沿用已存密钥。`,
        okText: "保存修改",
        onOk: async () => {
          await workbuddyApi.updateAccount(target.id, body);
          close();
          await reload();
          message.success("凭据已更新");
        },
      });
      return;
    }
    setBusy(true);
    try {
      await workbuddyApi.createAccount(body);
      close();
      await reload();
      message.success("已绑定 1 把 Workbuddy 凭据");
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (row: WbAccount) => {
    setVerifyingId(row.id);
    try {
      const result = await workbuddyApi.verifyAccount(row.id);
      message.success(
        `「${row.name}」连通：可见 ${result.agentTotal} 个 Agent`,
      );
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setVerifyingId(null);
      await reload();
    }
  };

  const remove = (row: WbAccount) => {
    request({
      title: "删除 Workbuddy 凭据",
      content: `确认删除「${row.name}」？还挂着未跑完任务的凭据会被拦住。`,
      danger: true,
      okText: "确认删除",
      onOk: async () => {
        await workbuddyApi.deleteAccount(row.id);
        await reload();
      },
    });
  };

  const columns: ColumnsType<WbAccount> = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      width: 160,
      render: (value: string) => <b>{value}</b>,
    },
    {
      title: "SecretId",
      dataIndex: "secretIdMasked",
      key: "secretIdMasked",
      width: 180,
      render: (value: string) => <code className="text-12">{value || "—"}</code>,
    },
    {
      title: "地域",
      dataIndex: "region",
      key: "region",
      width: 150,
      render: (value: string) => regionLabel(value),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 80,
      render: (value: string) => (
        <Tag color={value === "active" ? "success" : "default"}>
          {ACCOUNT_STATUS_LABEL[value] || value}
        </Tag>
      ),
    },
    {
      title: "最近校验",
      key: "verified",
      width: 220,
      render: (_, row) => (
        <div>
          <div>{row.lastVerifiedAt ? fmtTime(row.lastVerifiedAt) : "未校验"}</div>
          {row.lastError ? (
            <div className="text-12" style={{ color: "var(--danger)" }}>
              {row.lastError}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: "备注",
      dataIndex: "notes",
      key: "notes",
      width: 180,
      ellipsis: true,
      render: (value: string) => value || "—",
    },
    {
      title: "操作",
      key: "actions",
      width: 170,
      render: (_, row) => (
        <Space size={4}>
          <Button
            loading={verifyingId === row.id}
            onClick={() => void verify(row)}
          >
            校验
          </Button>
          <Button
            onClick={() => {
              setEditing(row);
              setForm({
                name: row.name,
                secretId: "",
                secretKey: "",
                region: row.region,
                status: row.status,
                notes: row.notes,
              });
              setOpen(true);
            }}
          >
            改
          </Button>
          <Button danger onClick={() => remove(row)}>
            删
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Panel
      title="Workbuddy Enterprise 账号"
      titleExtra={
        <span className="text-12 muted">
          腾讯云控制台「访问管理 → API 密钥管理」获取 SecretId / SecretKey。
          用哪把 Key 签名就只看得到那个企业的 Agent。
        </span>
      }
      titleBadge={`${accounts.length} 把凭据`}
      extra={
        <Button
          onClick={() => {
            setEditing(null);
            setForm(EMPTY);
            setOpen(true);
          }}
        >
          绑定凭据
        </Button>
      }
    >
      {accounts.length ? (
        <Table<WbAccount>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={accounts}
          scroll={{ x: "max-content" }}
          pagination={false}
        />
      ) : (
        <EmptyState text="还没有 Workbuddy 凭据：绑定一把腾讯云 API 密钥后，才能查看 Agent、拆解并派发任务" />
      )}

      <Modal
        open={open}
        title={editing ? `修改凭据（${editing.name}）` : "绑定 Workbuddy 凭据"}
        onCancel={close}
        onOk={() => void submit()}
        okText={busy ? "提交中" : editing ? "下一步（密码确认）" : "保存"}
        cancelText="取消"
        confirmLoading={busy}
        destroyOnHidden
        width={620}
      >
        <Form layout="vertical">
          <Form.Item label="名称" required>
            <Input
              value={form.name}
              maxLength={128}
              placeholder="如「主账号」「A 组加速」，仅本系统显示"
              onChange={(event) => patch({ name: event.target.value })}
            />
          </Form.Item>
          <Form.Item
            label="SecretId"
            required={!editing}
            extra={
              editing
                ? `已存 ${editing.secretIdMasked}；留空＝不修改`
                : "腾讯云 API 密钥的 SecretId"
            }
          >
            <Input
              value={form.secretId}
              maxLength={200}
              placeholder={editing ? "留空＝沿用已存 SecretId" : "AKID..."}
              onChange={(event) => patch({ secretId: event.target.value })}
              autoComplete="off"
            />
          </Form.Item>
          <Form.Item
            label="SecretKey"
            required={!editing}
            extra={
              editing
                ? "留空＝沿用已存 SecretKey；填写＝替换"
                : "密文保存，保存后不再回显"
            }
          >
            <Input.Password
              value={form.secretKey}
              maxLength={200}
              placeholder={editing ? "留空＝沿用已存 SecretKey" : "SecretKey"}
              onChange={(event) => patch({ secretKey: event.target.value })}
              autoComplete="new-password"
            />
          </Form.Item>
          <Form.Item label="资源地域" extra="按 Agent 所在地域选；签名时随 X-TC-Region 发出">
            <Select
              value={form.region}
              options={REGION_OPTIONS}
              onChange={(value) => patch({ region: value })}
            />
          </Form.Item>
          <Form.Item label="状态" extra="停用后不参与派发，历史任务与消息保留">
            <Select
              value={form.status}
              options={ACCOUNT_STATUS_OPTIONS}
              onChange={(value) => patch({ status: value })}
            />
          </Form.Item>
          <Form.Item label="备注">
            <Input.TextArea
              rows={2}
              value={form.notes}
              maxLength={500}
              placeholder="这把 Key 属于哪个企业 / 团队，便于多账号时区分"
              onChange={(event) => patch({ notes: event.target.value })}
            />
          </Form.Item>
        </Form>
      </Modal>
      {modal}
    </Panel>
  );
}
