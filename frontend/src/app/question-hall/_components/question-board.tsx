"use client";

import { App, Button, Input, Modal, Radio, Select, Space, Table, Tag } from "antd";
import type { TableProps } from "antd";
import {
  QUESTION_HALL_BODY_MAX,
  QUESTION_HALL_AUTHOR_KIND_LABELS,
  QUESTION_HALL_STATUS_LABELS,
  QUESTION_HALL_TITLE_MAX,
  type QuestionHallConfig,
  type QuestionHallDetail,
  type QuestionHallQuestion,
} from "@enterprise/contracts";
import { useCallback, useEffect, useState } from "react";
import { questionHallApi } from "@/api/question-hall";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";

export type QuestionHallView =
  | "all"
  | "enterprise"
  | "public"
  | "created"
  | "joined";

const PAGE_SIZE = 20;

const STATUS_COLOR: Record<string, string> = {
  OPEN: "blue",
  RESOLVED: "green",
  CLOSED: "default",
};

function timeText(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("zh-CN", { hour12: false });
}

function scopeLabel(scope: string) {
  return scope === "PUBLIC" ? "公开" : "企业内";
}

/**
 * 专题大厅：专题讨论列表 + 发起专题 + 详情（两层楼层、AI 结案总结、关闭/重新开放/删除）。
 * 发言可以选「以某个数字分身署名」；分身只决定署名与口吻，内容仍由本人写。
 */
export function QuestionBoard({ view }: { view: QuestionHallView }) {
  const { message, modal } = App.useApp();
  const { request: requestPassword, modal: passwordModal } =
    usePasswordConfirm();
  const [rows, setRows] = useState<QuestionHallQuestion[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [config, setConfig] = useState<QuestionHallConfig>({
    personas: [],
    orgName: "",
  });

  const [askOpen, setAskOpen] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    body: "",
    scope: "ENTERPRISE" as "ENTERPRISE" | "PUBLIC",
  });
  const [saving, setSaving] = useState(false);

  const [detailId, setDetailId] = useState(0);
  const [detail, setDetail] = useState<QuestionHallDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyPersonaId, setReplyPersonaId] = useState(0);
  const [replyTo, setReplyTo] = useState<{ id: number; label: string } | null>(
    null,
  );
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(
    async (nextPage: number) => {
      setLoading(true);
      try {
        const data = await questionHallApi.questions({
          query: {
            page: nextPage,
            pageSize: PAGE_SIZE,
            scope:
              view === "enterprise"
                ? "ENTERPRISE"
                : view === "public"
                  ? "PUBLIC"
                  : undefined,
            status: (status || undefined) as
              | "OPEN"
              | "RESOLVED"
              | "CLOSED"
              | undefined,
            mine:
              view === "created" || view === "joined" ? view : undefined,
            keyword: keyword.trim() || undefined,
          },
        });
        setRows(data?.list || []);
        setTotal(data?.total || 0);
        if (!data) setError("专题讨论列表读取失败");
        else setError("");
      } catch (caught) {
        setRows([]);
        setTotal(0);
        setError((caught as Error).message || "专题讨论列表读取失败");
      } finally {
        setLoading(false);
      }
    },
    [status, keyword, view],
  );

  useEffect(() => {
    void reload(1);
    setPage(1);
  }, [reload]);

  useEffect(() => {
    void questionHallApi
      .config()
      .then((data) => setConfig(data || { personas: [], orgName: "" }))
      .catch(() => setConfig({ personas: [], orgName: "" }));
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const data = await questionHallApi.detail({ params: { id: String(id) } });
      setDetail(data);
    } catch (caught) {
      message.error((caught as Error).message || "专题讨论详情读取失败");
    } finally {
      setDetailLoading(false);
    }
  }, [message]);

  const openDetail = useCallback(
    (id: number) => {
      setDetailId(id);
      setDetail(null);
      setReplyText("");
      setReplyPersonaId(0);
      setReplyTo(null);
      void loadDetail(id);
    },
    [loadDetail],
  );

  const closeDetail = () => {
    setDetailId(0);
    setDetail(null);
  };

  /** 系统消息里的「查看专题」会带 ?id=，进来直接打开那条专题讨论。 */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = Number(
      new URLSearchParams(window.location.search).get("id") || 0,
    );
    if (id > 0) openDetail(id);
  }, [openDetail]);

  const submitAsk = async () => {
    if (!draft.title.trim()) {
      message.warning("请填写专题讨论标题");
      return;
    }
    if (!draft.body.trim()) {
      message.warning("请描述本次专题讨论的内容");
      return;
    }
    setSaving(true);
    try {
      const row = await questionHallApi.create({
        body: {
          title: draft.title.trim(),
          body: draft.body.trim(),
          scope: draft.scope,
        },
      });
      message.success("专题讨论已发布");
      setAskOpen(false);
      setDraft({ title: "", body: "", scope: "ENTERPRISE" });
      await reload(1);
      setPage(1);
      if (row?.id) openDetail(row.id);
    } catch (caught) {
      message.error((caught as Error).message || "发起失败");
    } finally {
      setSaving(false);
    }
  };

  const sendReply = async () => {
    if (!detail || !replyText.trim()) {
      message.warning("请先写点内容");
      return;
    }
    setSending(true);
    try {
      const data = await questionHallApi.reply({
        params: { id: String(detail.question.id) },
        body: {
          content: replyText.trim(),
          parentId: replyTo?.id || 0,
          personaId: replyPersonaId,
        },
      });
      setDetail(data);
      setReplyText("");
      setReplyTo(null);
      await reload(page);
    } catch (caught) {
      message.error((caught as Error).message || "发言失败");
    } finally {
      setSending(false);
    }
  };

  const runAction = async (work: () => Promise<unknown>, tip: string) => {
    setBusy(true);
    try {
      await work();
      message.success(tip);
      await reload(page);
      if (detailId) await loadDetail(detailId);
    } catch (caught) {
      message.error((caught as Error).message || "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const confirmResolve = () => {
    if (!detail) return;
    const count = detail.messages.length;
    modal.confirm({
      title: detail.summaries.length ? "重新结案" : "结案并生成 AI 总结",
      content: `将读取本专题讨论下全部 ${count} 条发言，由 AI 生成结案总结。结案后仍可继续发言，也可以再次重新结案。`,
      okText: "结案",
      onOk: () =>
        runAction(
          () =>
            questionHallApi.resolve({
              params: { id: String(detail.question.id) },
            }),
          "已结案",
        ),
    });
  };

  const confirmClose = () => {
    if (!detail) return;
    modal.confirm({
      title: "关闭专题讨论",
      content: "关闭后大厅里不再显示这条专题讨论，也不能继续发言；发起人与管理员可在「已关闭」里重新开放。",
      okText: "关闭讨论",
      onOk: () =>
        runAction(
          () =>
            questionHallApi.close({
              params: { id: String(detail.question.id) },
            }),
          "专题讨论已关闭",
        ),
    });
  };

  const deleteQuestion = () => {
    if (!detail) return;
    const id = detail.question.id;
    requestPassword({
      title: "删除专题讨论",
      content: "删除后专题讨论与全部发言都不再显示，且不能恢复。",
      okText: "确认删除",
      danger: true,
      onOk: async () => {
        await questionHallApi.remove({ params: { id: String(id) } });
        message.success("专题讨论已删除");
        closeDetail();
        await reload(page);
      },
    });
  };

  const deleteReply = (messageId: number) => {
    requestPassword({
      title: "删除发言",
      content: "删除这条发言时会连同它下面的回复一起隐藏。",
      okText: "确认删除",
      danger: true,
      onOk: async () => {
        await questionHallApi.removeReply({
          params: { id: String(messageId) },
        });
        message.success("发言已删除");
        if (detailId) await loadDetail(detailId);
        await reload(page);
      },
    });
  };

  const columns: TableProps<QuestionHallQuestion>["columns"] = [
    {
      title: "专题讨论",
      dataIndex: "title",
      render: (_value, row) => (
        <div>
          <Button type="link" style={{ paddingInline: 0 }} onClick={() => openDetail(row.id)}>
            {row.title}
          </Button>
          <div className="text-12 muted" style={{ maxWidth: 520, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.body}
          </div>
        </div>
      ),
    },
    {
      title: "范围",
      dataIndex: "scope",
      width: 90,
      render: (_value, row) => <Tag>{scopeLabel(row.scope)}</Tag>,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (_value, row) => (
        <Tag color={STATUS_COLOR[row.status] || "default"}>
          {QUESTION_HALL_STATUS_LABELS[row.status] || row.status}
        </Tag>
      ),
    },
    { title: "发言人", dataIndex: "authorName", width: 140 },
    { title: "回复", dataIndex: "replyCount", width: 70 },
    {
      title: "最后发言",
      dataIndex: "lastReplyAt",
      width: 180,
      render: (value: string) => timeText(value),
    },
    {
      title: "操作",
      width: 90,
      render: (_value, row) => (
        <Button onClick={() => openDetail(row.id)}>查看</Button>
      ),
    },
  ];

  const topMessages = detail?.messages.filter((item) => item.parentId === 0) || [];
  const childrenOf = (id: number) =>
    detail?.messages.filter((item) => item.parentId === id) || [];

  return (
    <>
      <Panel
        title="专题讨论"
        titleExtra={
          <Space size={8} wrap>
            <Input
              style={{ width: 220 }}
              allowClear
              placeholder="搜索专题标题或内容，回车查询"
              maxLength={120}
              onChange={(event) => setKeyword(event.target.value)}
              onPressEnter={() => {
                setPage(1);
                void reload(1);
              }}
            />
            <Select
              style={{ width: 120 }}
              value={status || "all"}
              options={[
                { value: "all", label: "全部状态" },
                { value: "OPEN", label: "进行中" },
                { value: "RESOLVED", label: "已结案" },
                { value: "CLOSED", label: "已关闭" },
              ]}
              onChange={(value) => {
                setStatus(value === "all" ? "" : value);
                setPage(1);
              }}
            />
          </Space>
        }
        extra={
          <Button type="primary" onClick={() => setAskOpen(true)}>
            发起专题讨论
          </Button>
        }
      >
        {error ? <Notice variant="warn">{error}</Notice> : null}
        {!loading && !rows.length ? (
          <EmptyState text="还没有专题讨论。企业内专题只有同组织与签约伙伴的职员能参与；公开专题所有登录账号都能参与。" />
        ) : (
          <div className="table-wrap">
            <Table<QuestionHallQuestion>
              rowKey="id"
              loading={loading}
              dataSource={rows}
              columns={columns}
              size="middle"
              scroll={{ x: "max-content" }}
              pagination={{
                current: page,
                pageSize: PAGE_SIZE,
                total,
                showSizeChanger: false,
                onChange: (next) => {
                  setPage(next);
                  void reload(next);
                },
              }}
            />
          </div>
        )}
      </Panel>

      <Modal
        open={askOpen}
        title="发起专题讨论"
        okText="发布"
        confirmLoading={saving}
        destroyOnHidden
        width={640}
        onCancel={() => setAskOpen(false)}
        onOk={() => void submitAsk()}
      >
        <div style={{ display: "grid", gap: 14 }}>
          <Radio.Group
            value={draft.scope}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, scope: event.target.value }))
            }
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            <Radio value="ENTERPRISE">
              {`企业内（${config.orgName || "本组织"}及签约/承办伙伴的职员可参与）`}
            </Radio>
            <Radio value="PUBLIC">公开（任何登录账号都可以参与）</Radio>
          </Radio.Group>
          <Input
            value={draft.title}
            maxLength={QUESTION_HALL_TITLE_MAX}
            placeholder="一句话说清这次要讨论的专题"
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, title: event.target.value }))
            }
          />
          <Input.TextArea
            value={draft.body}
            maxLength={QUESTION_HALL_BODY_MAX}
            showCount
            autoSize={{ minRows: 5, maxRows: 12 }}
            placeholder="补充专题背景、已经试过什么、希望讨论哪些方向"
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, body: event.target.value }))
            }
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(detailId)}
        title={detail?.question.title || "专题讨论详情"}
        width={900}
        footer={null}
        destroyOnHidden
        onCancel={closeDetail}
      >
        {detailLoading || !detail ? (
          <div className="text-12 muted">读取中…</div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Tag>{scopeLabel(detail.question.scope)}</Tag>
              <Tag color={STATUS_COLOR[detail.question.status] || "default"}>
                {QUESTION_HALL_STATUS_LABELS[detail.question.status] ||
                  detail.question.status}
              </Tag>
              <span className="text-12 muted">
                {`${detail.question.authorName} · ${timeText(detail.question.createdAt)} · ${detail.question.replyCount} 条发言`}
              </span>
              <Space size={8} style={{ marginLeft: "auto" }} wrap>
                {detail.question.canManage ? (
                  <>
                    <Button type="primary" loading={busy} onClick={confirmResolve}>
                      {detail.summaries.length ? "重新结案" : "结案并生成AI总结"}
                    </Button>
                    {detail.question.status === "CLOSED" ? (
                      <Button
                        loading={busy}
                        onClick={() =>
                          void runAction(
                            () =>
                              questionHallApi.reopen({
                                params: { id: String(detail.question.id) },
                              }),
                            "专题讨论已重新开放",
                          )
                        }
                      >
                        重新开放
                      </Button>
                    ) : (
                      <Button loading={busy} onClick={confirmClose}>
                        关闭讨论
                      </Button>
                    )}
                    <Button danger onClick={deleteQuestion}>
                      删除讨论
                    </Button>
                  </>
                ) : null}
              </Space>
            </div>

            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>
              {detail.question.body}
            </div>

            {detail.summaries.length ? (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  {`AI 结案总结（第 ${detail.summaries[0].seq} 次结案，基于 ${
                    detail.summaries[0].messageCount
                  } 条发言${detail.summaries[0].truncated ? "，较长已截取最近部分" : ""}）`}
                </div>
                <div
                  className="panel"
                  style={{
                    padding: 12,
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.8,
                    maxHeight: 320,
                    overflow: "auto",
                  }}
                >
                  {detail.summaries[0].content}
                </div>
                {detail.summaries.length > 1 ? (
                  <details style={{ marginTop: 8 }}>
                    <summary className="text-12 muted">
                      {`历史结案（${detail.summaries.length - 1} 次）`}
                    </summary>
                    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                      {detail.summaries.slice(1).map((item) => (
                        <div key={item.id} className="text-12">
                          <div className="muted">{`第 ${item.seq} 次 · ${timeText(item.createdAt)}`}</div>
                          <div style={{ whiteSpace: "pre-wrap" }}>{item.content}</div>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            ) : null}

            <div style={{ display: "grid", gap: 10 }}>
              {!topMessages.length ? (
                <div className="text-12 muted">还没有发言。</div>
              ) : (
                topMessages.map((item) => (
                  <div key={item.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600 }}>{item.authorLabel}</span>
                      {item.authorKind === "AVATAR" ? (
                        <Tag>{QUESTION_HALL_AUTHOR_KIND_LABELS.AVATAR}</Tag>
                      ) : null}
                      <span className="text-12 muted">{timeText(item.createdAt)}</span>
                      <Space size={4} style={{ marginLeft: "auto" }}>
                        {detail.question.canReply ? (
                          <Button
                            type="link"
                            size="small"
                            onClick={() => setReplyTo({ id: item.id, label: item.authorLabel })}
                          >
                            回复
                          </Button>
                        ) : null}
                        {item.canDelete ? (
                          <Button type="link" size="small" danger onClick={() => deleteReply(item.id)}>
                            删除
                          </Button>
                        ) : null}
                      </Space>
                    </div>
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>{item.body}</div>
                    {childrenOf(item.id).map((child) => (
                      <div
                        key={child.id}
                        style={{
                          marginLeft: 24,
                          marginTop: 8,
                          paddingLeft: 10,
                          borderLeft: "2px solid var(--border)",
                        }}
                      >
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 600 }}>{child.authorLabel}</span>
                          {child.authorKind === "AVATAR" ? (
                            <Tag>{QUESTION_HALL_AUTHOR_KIND_LABELS.AVATAR}</Tag>
                          ) : null}
                          <span className="text-12 muted">{timeText(child.createdAt)}</span>
                          {child.canDelete ? (
                            <Button
                              type="link"
                              size="small"
                              danger
                              style={{ marginLeft: "auto" }}
                              onClick={() => deleteReply(child.id)}
                            >
                              删除
                            </Button>
                          ) : null}
                        </div>
                        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>{child.body}</div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>

            {detail.question.canReply ? (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="text-12 muted">我以</span>
                  <Select
                    style={{ width: 200 }}
                    value={replyPersonaId}
                    options={[
                      { value: 0, label: "本人" },
                      ...config.personas.map((item) => ({
                        value: item.id,
                        label: `${item.name}（数字分身）`,
                      })),
                    ]}
                    onChange={(value: number) => setReplyPersonaId(value)}
                  />
                  {replyTo ? (
                    <Tag
                      closable
                      onClose={(event) => {
                        event.preventDefault();
                        setReplyTo(null);
                      }}
                    >
                      {`回复 ${replyTo.label}`}
                    </Tag>
                  ) : null}
                </div>
                <Input.TextArea
                  value={replyText}
                  maxLength={QUESTION_HALL_BODY_MAX}
                  autoSize={{ minRows: 3, maxRows: 8 }}
                  placeholder="写下你的看法；用分身署名时，内容仍由你自己写。"
                  onChange={(event) => setReplyText(event.target.value)}
                />
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button type="primary" loading={sending} onClick={() => void sendReply()}>
                    发送
                  </Button>
                </div>
              </div>
            ) : (
              <Notice variant="info">
                {detail.question.status === "CLOSED"
                  ? "专题讨论已关闭，不能继续发言。"
                  : "你不在这个专题讨论的参与范围内。"}
              </Notice>
            )}
          </div>
        )}
      </Modal>
      {passwordModal}
    </>
  );
}