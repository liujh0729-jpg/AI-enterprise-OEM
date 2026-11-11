"use client";

import type {
  MailAccount,
  MailMessage,
  MailMessageSummary,
} from "@enterprise/contracts";
import {
  App,
  Button,
  Drawer,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { mailApi } from "@/api/mail";
import { aiApi, type AiMailboxAnalyze } from "@/api/ai";
import { AiLevelTag, AiList, AiResultModal } from "@/components/ai-result";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import Link from "next/link";
import { fmtTime } from "@/lib/datetime";

type InboxRow = MailMessageSummary & {
  mailboxId: number;
  mailboxAddress: string;
};

const STATUS_COLOR: Record<string, string> = {
  pending: "default",
  draft: "blue",
  sent: "success",
  skipped: "gold",
};

/** 收件箱：实时读取服务器，按账号切换或聚合「全部邮箱」；正文只在打开时出现。 */
export function MailInboxTab({ accounts }: { accounts: MailAccount[] }) {
  const { message } = App.useApp();
  const [accountId, setAccountId] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [viewing, setViewing] = useState<InboxRow | null>(null);
  const [detail, setDetail] = useState<MailMessage | null>(null);
  const [detailText, setDetailText] = useState("");
  const [detailAttachments, setDetailAttachments] = useState<
    { name: string; size: number; contentType: string }[]
  >([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [subject, setSubject] = useState("");
  const [reply, setReply] = useState("");
  const [acting, setActing] = useState<"" | "draft" | "send">("");
  const [actionNote, setActionNote] = useState("");
  const [aiMail, setAiMail] = useState<AiMailboxAnalyze | null>(null);
  const [aiMailOpen, setAiMailOpen] = useState(false);
  const [aiMailLoading, setAiMailLoading] = useState(false);

  const load = useCallback(async () => {
    const targets = (
      accountId ? accounts.filter((item) => item.id === accountId) : accounts
    ).filter((item) => item.enabled);
    if (!targets.length) {
      setRows([]);
      setError("");
      return;
    }
    setLoading(true);
    const settled = await Promise.allSettled(
      targets.map(async (account) => {
        const list = await mailApi.messages({
          params: { id: String(account.id) },
          query: {
            limit: 20,
            ...(unreadOnly ? { unreadOnly: "true" } : {}),
          },
        });
        return (list || []).map((item) => ({
          ...item,
          mailboxId: account.id,
          mailboxAddress: account.address,
        }));
      }),
    );
    const merged: InboxRow[] = [];
    let firstError = "";
    for (const result of settled) {
      if (result.status === "fulfilled") merged.push(...result.value);
      else if (!firstError) firstError = (result.reason as Error).message;
    }
    setRows(
      merged.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
    );
    setError(firstError);
    setLoading(false);
  }, [accountId, accounts, unreadOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const openMessage = async (row: InboxRow) => {
    setViewing(row);
    setDetail(null);
    setDetailText("");
    setDetailAttachments([]);
    setSubject(row.subject);
    setReply("");
    setActionNote("");
    setDetailError("");
    setDetailLoading(true);
    try {
      const data = await mailApi.message({
        params: { id: String(row.mailboxId), key: row.key },
        query: {},
      });
      if (data) {
        setDetail(data);
        setDetailText(data.text);
        setDetailAttachments(data.attachments || []);
        setSubject(
          /^re:/i.test(data.subject) ? data.subject : `Re: ${data.subject}`,
        );
      }
    } catch (caught) {
      setDetailError((caught as Error).message || "邮件正文读取失败");
    } finally {
      setDetailLoading(false);
    }
  };

  const runAiMail = async () => {
    if (!viewing) return;
    if (!detailText.trim()) {
      message.warning("正文还没读取到，稍后再试");
      return;
    }
    setAiMailOpen(true);
    setAiMailLoading(true);
    setAiMail(null);
    try {
      setAiMail(
        await aiApi.mailboxAnalyze({
          body: {
            subject: viewing.subject || undefined,
            from: detail?.fromAddress || viewing.fromAddress || undefined,
            body: detailText,
          },
        }),
      );
    } catch (caught) {
      message.error((caught as Error).message || "AI 分析失败");
      setAiMailOpen(false);
    } finally {
      setAiMailLoading(false);
    }
  };

  const act = async (kind: "draft" | "send") => {
    if (!viewing) return;
    if (!reply.trim()) {
      message.error(
        <>
          请先写回复正文，或在「知识与话术」里配置命中这类邮件的话术{" "}
          <Link href="/mail?tab=scripts">去配置话术</Link>
        </>,
      );
      return;
    }
    setActing(kind);
    setActionNote("");
    try {
      const body = { key: viewing.key, subject, body: reply };
      const result =
        kind === "draft"
          ? await mailApi.saveDraft({
              params: { id: String(viewing.mailboxId) },
              body,
            })
          : await mailApi.sendReply({
              params: { id: String(viewing.mailboxId) },
              body,
            });
      const note = [result?.message || "", result?.matchedScript ? `命中话术：${result.matchedScript}` : ""]
        .filter(Boolean)
        .join("；");
      setActionNote(note);
      if (kind === "send") message.success("回复已发送");
      else message.success("已生成草稿");
      await load();
    } catch (caught) {
      message.error((caught as Error).message || "操作失败");
    } finally {
      setActing("");
    }
  };

  const columns: ColumnsType<InboxRow> = [
    {
      title: "状态",
      key: "status",
      width: 110,
      render: (_, row) => (
        <Tag color={STATUS_COLOR[row.status] || "default"}>
          {row.statusLabel}
        </Tag>
      ),
    },
    {
      title: "邮箱",
      key: "mailbox",
      width: 200,
      render: (_, row) => (
        <span className="text-12" style={{ wordBreak: "break-all" }}>
          {row.mailboxAddress}
        </span>
      ),
    },
    {
      title: "发件人",
      key: "from",
      width: 200,
      render: (_, row) => (
        <div style={{ wordBreak: "break-all" }}>
          <div>{row.fromName || row.fromAddress}</div>
          <div className="text-12 muted">{row.fromAddress}</div>
        </div>
      ),
    },
    {
      title: "主题",
      key: "subject",
      width: 320,
      render: (_, row) => (
        <div>
          <div style={{ wordBreak: "break-all" }}>
            {row.unread ? <b>{row.subject}</b> : row.subject}
          </div>
          {row.snippet ? (
            <div className="text-12 muted" style={{ marginTop: 2 }}>
              {row.snippet}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: "时间",
      key: "receivedAt",
      width: 150,
      render: (_, row) => fmtTime(row.receivedAt),
    },
    {
      title: "附件",
      key: "attachments",
      width: 80,
      render: (_, row) => (row.hasAttachments ? "有" : <span className="muted">—</span>),
    },
    {
      title: "操作",
      key: "actions",
      width: 100,
      render: (_, row) => (
        <Button onClick={() => void openMessage(row)}>查看</Button>
      ),
    },
  ];

  return (
    <>
      <Panel
        title="收件箱"
        titleExtra={
          <span className="text-12 muted">
            实时读取服务器，不保存正文；每个邮箱取最近 20 封
          </span>
        }
        extra={
          <Space size={8} wrap>
            <Select
              style={{ width: 220 }}
              value={accountId}
              options={[
                { value: 0, label: "全部邮箱" },
                ...accounts.map((item) => ({
                  value: item.id,
                  label: item.enabled
                    ? item.address
                    : `${item.address}（已停用）`,
                  disabled: !item.enabled,
                })),
              ]}
              onChange={setAccountId}
            />
            <span className="text-12 muted">只看未读</span>
            <Switch checked={unreadOnly} onChange={setUnreadOnly} />
            <Button onClick={() => void load()} loading={loading}>
              刷新
            </Button>
          </Space>
        }
      >
        {error ? <Notice variant="warn">{error}</Notice> : null}
        {!accounts.length ? (
          <EmptyState
            text="还没有邮箱：先到「邮箱账号」页签添加一个"
            action={<Link href="/mail?tab=accounts">去添加邮箱</Link>}
          />
        ) : !loading && !rows.length ? (
          <EmptyState text="没有符合条件的邮件（POP3 没有已读标记，处理过的会计入台账）" />
        ) : (
          <Table<InboxRow>
            size="small"
            rowKey={(row) => `${row.mailboxId}:${row.key}`}
            loading={loading}
            columns={columns}
            dataSource={rows}
            pagination={false}
            scroll={{ x: "max-content" }}
          />
        )}
      </Panel>

      <Drawer
        open={Boolean(viewing)}
        size={720}
        title={viewing ? `邮件 · ${viewing.subject}` : "邮件"}
        onClose={() => setViewing(null)}
        extra={
          detail ? (
            <Button onClick={() => void runAiMail()}>AI 摘要与回复</Button>
          ) : null
        }
      >
        {detailError ? <Notice variant="error">{detailError}</Notice> : null}
        {detail ? (
          <>
            <div className="text-12 muted" style={{ marginBottom: 8 }}>
              {`发件人：${detail.fromName || detail.fromAddress} <${detail.fromAddress}> · ${fmtTime(detail.receivedAt)}`}
            </div>
            {detailAttachments.length ? (
              <div className="text-12 muted" style={{ marginBottom: 8 }}>
                附件（不下载）：
                {detailAttachments
                  .map((item) => `${item.name}（${Math.ceil(item.size / 1024)}KB）`)
                  .join("、")}
              </div>
            ) : null}
            <div
              style={{
                whiteSpace: "pre-wrap",
                maxHeight: 320,
                overflow: "auto",
                border: "1px solid var(--border, #eee)",
                borderRadius: 8,
                padding: 12,
                marginBottom: 16,
                background: "var(--bg-subtle, #fafafa)",
              }}
            >
              {detailLoading ? "正在读取正文…" : detailText || "（正文为空）"}
            </div>
            <label className="data-table-form-item">
              <span className="data-table-form-label">主题</span>
              <Input
                value={subject}
                maxLength={200}
                onChange={(event) => setSubject(event.target.value)}
              />
            </label>
            <label className="data-table-form-item">
              <span className="data-table-form-label">回复正文</span>
              <Input.TextArea
                rows={8}
                maxLength={8000}
                showCount
                value={reply}
                placeholder="留空时按「知识与话术」命中的话术生成；没有命中会提示先写正文"
                onChange={(event) => setReply(event.target.value)}
              />
            </label>
            <Space size={8} wrap style={{ marginTop: 12 }}>
              <Button
                loading={acting === "draft"}
                onClick={() => void act("draft")}
              >
                生成草稿
              </Button>
              <Popconfirm
                title="确认发送这封回复？"
                description="会直接通过 SMTP 发给对方，发出后不可撤回。"
                okText="发送"
                cancelText="取消"
                onConfirm={() => void act("send")}
              >
                <Button type="primary" loading={acting === "send"}>
                  发送回复
                </Button>
              </Popconfirm>
              <Tooltip title="POP3 没有草稿箱：草稿只在本轮结果里返回，可复制后自行发送">
                <span className="text-12 muted">
                  {actionNote || "草稿位置取决于收信协议"}
                </span>
              </Tooltip>
            </Space>
          </>
        ) : (
          <EmptyState text={detailLoading ? "正在读取正文…" : "正文没有读到"} />
        )}
      </Drawer>

      <AiResultModal
        open={aiMailOpen}
        title={viewing ? `AI 邮件分析 · ${viewing.subject}` : "AI 邮件分析"}
        loading={aiMailLoading}
        mode={aiMail?.mode}
        model={aiMail?.model}
        onClose={() => setAiMailOpen(false)}
        footer={
          aiMail?.replyDraft ? (
            <Button
              type="primary"
              onClick={() => {
                setReply(aiMail.replyDraft);
                setAiMailOpen(false);
                message.success("已填入回复框，可继续修改后发送");
              }}
            >
              使用回信草稿
            </Button>
          ) : null
        }
      >
        {aiMail ? (
          <>
            <Space wrap>
              <Tag>{aiMail.categoryLabel}</Tag>
              <AiLevelTag level={aiMail.priority} />
            </Space>
            <div>{aiMail.summary}</div>
            <AiList
              title="待办"
              items={aiMail.todos.map((todo) =>
                todo.dueAt ? `${todo.text}（${todo.dueAt}）` : todo.text,
              )}
            />
            {aiMail.replyDraft ? (
              <div>
                <strong>回信草稿</strong>
                <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>
                  {aiMail.replyDraft}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </AiResultModal>
    </>
  );
}