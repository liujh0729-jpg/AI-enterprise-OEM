"use client";

import type { MailAccount } from "@enterprise/contracts";
import {
  App,
  Button,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { mailApi } from "@/api/mail";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";

const SECURITY_OPTIONS = [
  { value: "ssl", label: "SSL/TLS" },
  { value: "starttls", label: "STARTTLS" },
  { value: "none", label: "不加密" },
];

const PROTOCOL_OPTIONS = [
  { value: "imap", label: "IMAP" },
  { value: "pop3", label: "POP3" },
];

const REPLY_MODE_OPTIONS = [
  { value: "draft_only", label: "只写草稿" },
  { value: "auto_send", label: "写草稿并自动回复" },
];

/** 表单草稿：端口与单轮封数是数字框，密码留空＝不修改。 */
type AccountDraft = {
  id: number | null;
  address: string;
  displayName: string;
  protocol: string;
  incomingHost: string;
  incomingPort: number;
  incomingSecurity: string;
  incomingUsername: string;
  incomingPassword: string;
  inboxFolder: string;
  draftsFolder: string;
  sentFolder: string;
  outgoingHost: string;
  outgoingPort: number;
  outgoingSecurity: string;
  outgoingUsername: string;
  outgoingPassword: string;
  signature: string;
  replyMode: string;
  maxPerRun: number;
  enabled: boolean;
};

const EMPTY_DRAFT: AccountDraft = {
  id: null,
  address: "",
  displayName: "",
  protocol: "imap",
  incomingHost: "",
  incomingPort: 993,
  incomingSecurity: "ssl",
  incomingUsername: "",
  incomingPassword: "",
  inboxFolder: "INBOX",
  draftsFolder: "Drafts",
  sentFolder: "Sent",
  outgoingHost: "",
  outgoingPort: 465,
  outgoingSecurity: "ssl",
  outgoingUsername: "",
  outgoingPassword: "",
  signature: "",
  replyMode: "draft_only",
  maxPerRun: 10,
  enabled: true,
};

function draftOf(row: MailAccount): AccountDraft {
  return {
    id: row.id,
    address: row.address,
    displayName: row.displayName,
    protocol: row.protocol,
    incomingHost: row.incomingHost,
    incomingPort: row.incomingPort,
    incomingSecurity: row.incomingSecurity,
    incomingUsername: row.incomingUsername,
    incomingPassword: "",
    inboxFolder: row.inboxFolder,
    draftsFolder: row.draftsFolder,
    sentFolder: row.sentFolder,
    outgoingHost: row.outgoingHost,
    outgoingPort: row.outgoingPort,
    outgoingSecurity: row.outgoingSecurity,
    outgoingUsername: row.outgoingUsername,
    outgoingPassword: "",
    signature: row.signature,
    replyMode: row.replyMode,
    maxPerRun: row.maxPerRun,
    enabled: row.enabled,
  };
}

/** 邮箱账号：多邮箱并存，凭据只进不出；列表显示今天与本月 AI 处理量。 */
export function MailAccountsTab({
  accounts,
  loading,
  error,
  reload,
}: {
  accounts: MailAccount[];
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const [draft, setDraft] = useState<AccountDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);

  const patch = (next: Partial<AccountDraft>) =>
    setDraft((prev) => (prev ? { ...prev, ...next } : prev));

  const submit = async () => {
    if (!draft) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.address.trim())) {
      message.error("邮箱地址格式不正确，例如 name@company.com");
      return;
    }
    if (!draft.incomingHost.trim()) {
      message.error("请填写收信服务器地址");
      return;
    }
    if (!draft.id && !draft.incomingPassword.trim()) {
      message.error("请填写收信密码或授权码");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        address: draft.address.trim(),
        displayName: draft.displayName.trim(),
        protocol: draft.protocol,
        incomingHost: draft.incomingHost.trim(),
        incomingPort: draft.incomingPort,
        incomingSecurity: draft.incomingSecurity,
        incomingUsername: draft.incomingUsername.trim() || draft.address.trim(),
        inboxFolder: draft.inboxFolder.trim() || "INBOX",
        draftsFolder: draft.draftsFolder.trim() || "Drafts",
        sentFolder: draft.sentFolder.trim() || "Sent",
        outgoingHost: draft.outgoingHost.trim(),
        outgoingPort: draft.outgoingPort,
        outgoingSecurity: draft.outgoingSecurity,
        outgoingUsername:
          draft.outgoingUsername.trim() || draft.incomingUsername.trim(),
        signature: draft.signature,
        replyMode: draft.replyMode,
        maxPerRun: draft.maxPerRun,
        enabled: draft.enabled,
      };
      if (draft.incomingPassword.trim()) {
        body.incomingPassword = draft.incomingPassword.trim();
      }
      if (draft.outgoingPassword.trim()) {
        body.outgoingPassword = draft.outgoingPassword.trim();
      }
      if (draft.id) {
        await mailApi.updateAccount({
          params: { id: String(draft.id) },
          body,
        });
        message.success("邮箱已更新");
      } else {
        await mailApi.saveAccount({ body });
        message.success("邮箱已添加");
      }
      setDraft(null);
      await reload();
    } catch (caught) {
      message.error((caught as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const test = async (row: MailAccount) => {
    setTestingId(row.id);
    try {
      const result = await mailApi.testAccount({
        params: { id: String(row.id) },
      });
      if (result?.incoming && result?.outgoing) {
        message.success("收信与发信都连通了");
      } else {
        message.error(
          [result?.incoming ? "" : `收信：${result?.incomingMessage}`, result?.outgoing ? "" : `发信：${result?.outgoingMessage}`]
            .filter(Boolean)
            .join("；") || "连接测试未通过",
        );
      }
      await reload();
    } catch (caught) {
      message.error((caught as Error).message || "连接测试失败");
    } finally {
      setTestingId(null);
    }
  };

  const toggle = async (row: MailAccount, enabled: boolean) => {
    try {
      await mailApi.updateAccount({
        params: { id: String(row.id) },
        body: { enabled },
      });
      await reload();
    } catch (caught) {
      message.error((caught as Error).message || "状态修改失败");
    }
  };

  const remove = async (row: MailAccount) => {
    try {
      await mailApi.removeAccount({ params: { id: String(row.id) } });
      message.success("已删除该邮箱与它的话术、处理台账");
      await reload();
    } catch (caught) {
      message.error((caught as Error).message || "删除失败");
    }
  };

  const columns: ColumnsType<MailAccount> = [
    {
      title: "邮箱",
      key: "address",
      width: 240,
      render: (_, row) => (
        <div>
          <div style={{ wordBreak: "break-all" }}>{row.address}</div>
          <div className="text-12 muted">
            {row.displayName || "未填显示名"} · {row.protocolLabel}
          </div>
        </div>
      ),
    },
    {
      title: "收信",
      key: "incoming",
      width: 200,
      render: (_, row) => (
        <div className="text-12">
          <div>{`${row.incomingHost}:${row.incomingPort}`}</div>
          <div className="muted">{row.incomingSecurityLabel}</div>
        </div>
      ),
    },
    {
      title: "回复方式",
      key: "replyMode",
      width: 150,
      render: (_, row) => (
        <Tag color={row.replyMode === "auto_send" ? "blue" : "default"}>
          {row.replyModeLabel}
        </Tag>
      ),
    },
    {
      title: "今日处理",
      key: "today",
      width: 140,
      render: (_, row) => (
        <span>
          已发送 {row.todaySent} · 草稿 {row.todayDraft}
        </span>
      ),
    },
    {
      title: "本月累计",
      key: "month",
      width: 100,
      render: (_, row) => `${row.monthHandled} 封`,
    },
    {
      title: "最近执行",
      key: "lastRun",
      width: 180,
      render: (_, row) =>
        row.lastError ? (
          <Tooltip title={row.lastError}>
            <Tag color="error">上次出错</Tag>
          </Tooltip>
        ) : row.lastRunAt ? (
          fmtTime(row.lastRunAt)
        ) : (
          <span className="muted">还没处理过</span>
        ),
    },
    {
      title: "启用",
      key: "enabled",
      width: 80,
      render: (_, row) => (
        <Switch
          checked={row.enabled}
          onChange={(checked) => void toggle(row, checked)}
        />
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 260,
      render: (_, row) => (
        <Space size={4} wrap>
          <Button loading={testingId === row.id} onClick={() => void test(row)}>
            测试连接
          </Button>
          <Button onClick={() => setDraft(draftOf(row))}>编辑</Button>
          <Popconfirm
            title="删除这个邮箱？"
            description="它的话术与处理台账会一并删除；服务器上的邮件不受影响。"
            okText="删除"
            cancelText="取消"
            onConfirm={() => void remove(row)}
          >
            <Button danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Panel
        title="邮箱账号"
        titleExtra={
          <span className="text-12 muted">
            一个账号最多添加 20 个邮箱；邮件正文与附件不落库，每次都是实时读取
          </span>
        }
        extra={
          <Button type="primary" onClick={() => setDraft(EMPTY_DRAFT)}>
            添加邮箱
          </Button>
        }
      >
        {error ? <Notice variant="error">{error}</Notice> : null}
        {!loading && !accounts.length ? (
          <EmptyState text="还没有邮箱：点「添加邮箱」填入 POP3 / IMAP 参数即可开始收信" />
        ) : (
          <Table<MailAccount>
            size="small"
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={accounts}
            pagination={false}
            scroll={{ x: "max-content" }}
          />
        )}
      </Panel>

      <Modal
        open={Boolean(draft)}
        title={draft?.id ? "编辑邮箱" : "添加邮箱"}
        width={760}
        okText={draft?.id ? "保存修改" : "添加"}
        cancelText="取消"
        confirmLoading={saving}
        onOk={() => void submit()}
        onCancel={() => {
          if (!saving) setDraft(null);
        }}
        destroyOnHidden
      >
        {draft ? (
          <div className="data-table-form">
            <label className="data-table-form-item">
              <span className="data-table-form-label">
                邮箱地址<b style={{ color: "var(--danger)" }}> *</b>
              </span>
              <Input
                value={draft.address}
                placeholder="name@company.com"
                onChange={(event) => patch({ address: event.target.value })}
              />
            </label>
            <label className="data-table-form-item">
              <span className="data-table-form-label">显示名</span>
              <Input
                value={draft.displayName}
                placeholder="发信时显示的名字"
                onChange={(event) => patch({ displayName: event.target.value })}
              />
            </label>
            <label className="data-table-form-item">
              <span className="data-table-form-label">收信协议</span>
              <Select
                value={draft.protocol}
                options={PROTOCOL_OPTIONS}
                onChange={(value) =>
                  patch({
                    protocol: value,
                    incomingPort:
                      value === "pop3"
                        ? draft.incomingSecurity === "ssl"
                          ? 995
                          : 110
                        : draft.incomingSecurity === "ssl"
                          ? 993
                          : 143,
                  })
                }
              />
            </label>
            <label className="data-table-form-item">
              <span className="data-table-form-label">
                收信服务器<b style={{ color: "var(--danger)" }}> *</b>
              </span>
              <Input
                value={draft.incomingHost}
                placeholder="imap.example.com / pop.example.com"
                onChange={(event) => patch({ incomingHost: event.target.value })}
              />
            </label>
            <label className="data-table-form-item">
              <span className="data-table-form-label">收信端口</span>
              <InputNumber
                style={{ width: "100%" }}
                min={1}
                max={65535}
                value={draft.incomingPort}
                onChange={(value) =>
                  patch({ incomingPort: Number(value) || draft.incomingPort })
                }
              />
            </label>
            <label className="data-table-form-item">
              <span className="data-table-form-label">收信加密</span>
              <Select
                value={draft.incomingSecurity}
                options={SECURITY_OPTIONS}
                onChange={(value) => patch({ incomingSecurity: value })}
              />
            </label>
            <label className="data-table-form-item">
              <span className="data-table-form-label">收信账号</span>
              <Input
                value={draft.incomingUsername}
                placeholder="不填＝邮箱地址"
                onChange={(event) =>
                  patch({ incomingUsername: event.target.value })
                }
              />
            </label>
            <label className="data-table-form-item">
              <span className="data-table-form-label">
                收信密码 / 授权码
                {draft.id ? null : (
                  <b style={{ color: "var(--danger)" }}> *</b>
                )}
              </span>
              <Input.Password
                value={draft.incomingPassword}
                placeholder={
                  draft.id ? "留空＝不修改已保存的密码" : "多数邮箱要用授权码"
                }
                onChange={(event) =>
                  patch({ incomingPassword: event.target.value })
                }
              />
            </label>
            <label className="data-table-form-item">
              <span className="data-table-form-label">收件箱文件夹</span>
              <Input
                value={draft.inboxFolder}
                placeholder="INBOX"
                onChange={(event) => patch({ inboxFolder: event.target.value })}
              />
            </label>
            <label className="data-table-form-item">
              <span className="data-table-form-label">草稿箱文件夹</span>
              <Input
                value={draft.draftsFolder}
                placeholder={draft.protocol === "pop3" ? "POP3 无草稿箱，忽略" : "Drafts"}
                disabled={draft.protocol === "pop3"}
                onChange={(event) =>
                  patch({ draftsFolder: event.target.value })
                }
              />
            </label>
            <label className="data-table-form-item">
              <span className="data-table-form-label">发件箱文件夹</span>
              <Input
                value={draft.sentFolder}
                placeholder={draft.protocol === "pop3" ? "POP3 无发件箱，忽略" : "Sent"}
                disabled={draft.protocol === "pop3"}
                onChange={(event) => patch({ sentFolder: event.target.value })}
              />
            </label>
            <label className="data-table-form-item">
              <span className="data-table-form-label">发信服务器</span>
              <Input
                value={draft.outgoingHost}
                placeholder="smtp.example.com（不填＝不能自动发送）"
                onChange={(event) => patch({ outgoingHost: event.target.value })}
              />
            </label>
            <label className="data-table-form-item">
              <span className="data-table-form-label">发信端口</span>
              <InputNumber
                style={{ width: "100%" }}
                min={1}
                max={65535}
                value={draft.outgoingPort}
                onChange={(value) =>
                  patch({ outgoingPort: Number(value) || draft.outgoingPort })
                }
              />
            </label>
            <label className="data-table-form-item">
              <span className="data-table-form-label">发信加密</span>
              <Select
                value={draft.outgoingSecurity}
                options={SECURITY_OPTIONS}
                onChange={(value) => patch({ outgoingSecurity: value })}
              />
            </label>
            <label className="data-table-form-item">
              <span className="data-table-form-label">发信账号</span>
              <Input
                value={draft.outgoingUsername}
                placeholder="不填＝收信账号"
                onChange={(event) =>
                  patch({ outgoingUsername: event.target.value })
                }
              />
            </label>
            <label className="data-table-form-item">
              <span className="data-table-form-label">发信密码</span>
              <Input.Password
                value={draft.outgoingPassword}
                placeholder="留空＝复用收信密码"
                onChange={(event) =>
                  patch({ outgoingPassword: event.target.value })
                }
              />
            </label>
            <label className="data-table-form-item">
              <span className="data-table-form-label">回复方式</span>
              <Select
                value={draft.replyMode}
                options={REPLY_MODE_OPTIONS}
                onChange={(value) => patch({ replyMode: value })}
              />
            </label>
            <label className="data-table-form-item">
              <span className="data-table-form-label">单轮最多处理</span>
              <InputNumber
                style={{ width: "100%" }}
                min={1}
                max={50}
                value={draft.maxPerRun}
                onChange={(value) =>
                  patch({ maxPerRun: Number(value) || draft.maxPerRun })
                }
              />
            </label>
            <label
              className="data-table-form-item"
              style={{ gridColumn: "1 / -1" }}
            >
              <span className="data-table-form-label">邮件签名</span>
              <Input.TextArea
                rows={2}
                maxLength={1000}
                value={draft.signature}
                placeholder="自动加到每封回复的末尾"
                onChange={(event) => patch({ signature: event.target.value })}
              />
            </label>
          </div>
        ) : null}
      </Modal>
    </>
  );
}