"use client";

import { App, Button, Input, Modal, Space, Table } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  OKR_REPORT_KIND_LABELS,
  type OkrReportView,
} from "@enterprise/contracts";
import { okrApi } from "@/api/okr";
import { Panel, TabStrip } from "@/components/ui/panel";
import { fmtDateTime } from "@/lib/datetime";
import {
  Toolbar,
  okrError,
  reportStatusTag,
  type OkrContextData,
} from "./okr-common";

const KIND_TABS = [
  { key: "DAILY", label: "日报" },
  { key: "WEEKLY", label: "周报" },
];

const toLines = (value: unknown) =>
  Array.isArray(value) ? value.map((item) => String(item)).join("\n") : "";

const fromLines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

type ReportForm = {
  done: string;
  blockers: string;
  next: string;
};

const emptyForm: ReportForm = { done: "", blockers: "", next: "" };

export function OkrReportsTab({ ctx }: { ctx: OkrContextData }) {
  const { message } = App.useApp();
  const canManage = ctx.isOwner || ctx.isManager;
  const selfKey = ctx.isOwner ? "" : ctx.me?.memberUserId || "";

  const [kind, setKind] = useState<"DAILY" | "WEEKLY">("DAILY");
  const [scope, setScope] = useState<"MINE" | "ALL">("MINE");
  const [reports, setReports] = useState<OkrReportView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");

  const [editorOpen, setEditorOpen] = useState(false);
  const [current, setCurrent] = useState<OkrReportView | null>(null);
  const [form, setForm] = useState<ReportForm>(emptyForm);
  const [busy, setBusy] = useState(false);

  const [commentOpen, setCommentOpen] = useState(false);
  const [commentTarget, setCommentTarget] = useState<OkrReportView | null>(null);
  const [comment, setComment] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await okrApi.reports({
        query: {
          kind,
          scope: canManage ? scope : "MINE",
        },
      });
      setReports(rows ?? []);
      setError("");
    } catch (err) {
      setError(okrError(err));
    } finally {
      setLoading(false);
    }
  }, [kind, scope, canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  const isMine = (row: OkrReportView) =>
    row.memberUserId === selfKey || (!ctx.isOwner && row.memberUserId === ctx.me?.memberUserId);

  const openRow = (row: OkrReportView) => {
    setCurrent(row);
    setForm({
      done: toLines(row.content.done),
      blockers: toLines(row.content.blockers),
      next: toLines(row.content.next),
    });
    setEditorOpen(true);
  };

  const openNew = () => {
    setCurrent(null);
    setForm(emptyForm);
    setEditorOpen(true);
  };

  const contentOf = (formValue: ReportForm) => ({
    done: fromLines(formValue.done),
    dataChange: Array.isArray(current?.content.dataChange)
      ? current.content.dataChange
      : [],
    blockers: fromLines(formValue.blockers),
    next: fromLines(formValue.next),
    attachments: Array.isArray(current?.content.attachments)
      ? current.content.attachments
      : [],
  });

  const saveDraft = async () => {
    setBusy(true);
    try {
      const saved = await okrApi.saveReportDraft({
        body: {
          kind: current ? (current.kind as "DAILY" | "WEEKLY") : kind,
          periodKey: current?.periodKey || "",
          memberUserId: "",
          content: contentOf(form),
          source: "MANUAL",
          scheduleId: 0,
        },
      });
      message.success("草稿已保存");
      setEditorOpen(false);
      await load();
      return saved;
    } catch (err) {
      message.error(okrError(err));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const saved = await okrApi.saveReportDraft({
        body: {
          kind: current ? (current.kind as "DAILY" | "WEEKLY") : kind,
          periodKey: current?.periodKey || "",
          memberUserId: "",
          content: contentOf(form),
          source: "MANUAL",
          scheduleId: 0,
        },
      });
      if (!saved) throw new Error("汇报保存失败");
      await okrApi.submitReport({ params: { id: String(saved.id) } });
      message.success("汇报已提交");
      setEditorOpen(false);
      await load();
    } catch (err) {
      message.error(okrError(err));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (row: OkrReportView) => {
    try {
      await okrApi.withdrawReport({ params: { id: String(row.id) } });
      message.success("已撤回为草稿");
      await load();
    } catch (err) {
      message.error(okrError(err));
    }
  };

  const generate = async () => {
    setBusy(true);
    try {
      await okrApi.generateReport({
        body: {
          kind,
          periodKey: "",
          memberUserId: "",
          overwrite: false,
        },
      });
      message.success("已按系统记录生成草稿");
      await load();
    } catch (err) {
      message.error(okrError(err));
    } finally {
      setBusy(false);
    }
  };

  const fillAutoDraft = () => {
    if (!current) return;
    setForm({
      done: toLines(current.autoDraft.done),
      blockers: toLines(current.autoDraft.blockers),
      next: toLines(current.autoDraft.next),
    });
  };

  const saveComment = async () => {
    if (!commentTarget) return;
    try {
      await okrApi.commentReport({
        params: { id: String(commentTarget.id) },
        body: { comment },
      });
      message.success("点评已保存");
      setCommentOpen(false);
      await load();
    } catch (err) {
      message.error(okrError(err));
    }
  };

  const editable = current
    ? isMine(current) && current.status === "DRAFT"
    : false;
  const visible = reports.filter((row) =>
    keyword ? row.periodKey.includes(keyword.trim()) : true,
  );
  const autoDraftEnabled = Boolean(ctx.settings.autoDraftEnabled);

  const columns = [
    {
      title: "归期",
      dataIndex: "periodKey",
      width: 130,
      render: (value: string) => value || "—",
    },
    ...(canManage && scope === "ALL"
      ? [
          {
            title: "成员",
            dataIndex: "memberName",
            width: 120,
            render: (value: string) => value || "账号",
          },
        ]
      : []),
    {
      title: "类型",
      dataIndex: "kind",
      width: 70,
      render: (value: string) => OKR_REPORT_KIND_LABELS[value] || value,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (value: string) => reportStatusTag(value),
    },
    {
      title: "来源",
      dataIndex: "source",
      width: 90,
      render: (value: string) =>
        value === "AGENT_AUTO" ? "Agent 自动" : value === "SYSTEM" ? "系统生成" : "人工填写",
    },
    {
      title: "提交时间",
      dataIndex: "submittedAt",
      width: 160,
      render: (value: string) => (value ? fmtDateTime(value) : "—"),
    },
    {
      title: "点评",
      dataIndex: "managerComment",
      render: (value: string) =>
        value ? <span title={value}>{value.slice(0, 24)}{value.length > 24 ? "…" : ""}</span> : "—",
    },
    {
      title: "操作",
      width: 200,
      render: (_: unknown, row: OkrReportView) => (
        <Space size={4} wrap>
          <Button type="link" size="small" onClick={() => openRow(row)}>
            {isMine(row) && row.status === "DRAFT" ? "编辑" : "查看"}
          </Button>
          {isMine(row) && row.status === "SUBMITTED" ? (
            <Button type="link" size="small" onClick={() => void withdraw(row)}>
              撤回
            </Button>
          ) : null}
          {canManage ? (
            <Button
              type="link"
              size="small"
              onClick={() => {
                setCommentTarget(row);
                setComment(row.managerComment || "");
                setCommentOpen(true);
              }}
            >
              点评
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <>
      <Panel
        title="汇报"
        extra={
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <TabStrip
              items={KIND_TABS}
              value={kind}
              onChange={(value) => setKind(value as "DAILY" | "WEEKLY")}
            />
            {canManage ? (
              <TabStrip
                items={[
                  { key: "MINE", label: "我的" },
                  { key: "ALL", label: "全部成员" },
                ]}
                value={scope}
                onChange={(value) => setScope(value as "MINE" | "ALL")}
              />
            ) : null}
          </div>
        }
      >
        <Toolbar
          hint={
            autoDraftEnabled
              ? "「生成草稿」按系统操作流水、KR 变化与计划完成情况拼结构化清单，不调用模型"
              : "自动草稿已在「设置」里关闭，开启后可用一键生成"
          }
        >
          <Button type="primary" onClick={openNew}>
            写本期汇报
          </Button>
          <Button loading={busy} disabled={!autoDraftEnabled} onClick={() => void generate()}>
            生成草稿
          </Button>
          <Input
            allowClear
            placeholder="按归期筛选，如 2026-W44 / 2026-10-31"
            style={{ width: 260 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </Toolbar>
        {error ? (
          <div className="muted" style={{ marginBottom: 8 }}>
            {error}
            <Button type="link" size="small" onClick={() => void load()}>
              重试
            </Button>
          </div>
        ) : null}
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={visible}
          columns={columns}
          pagination={false}
          locale={{ emptyText: `暂无${OKR_REPORT_KIND_LABELS[kind]}，点「写本期汇报」或「生成草稿」` }}
        />
      </Panel>

      <Modal
        title={
          current
            ? `${current.periodKey || "本期"} ${OKR_REPORT_KIND_LABELS[current.kind] || ""}`
            : `写${OKR_REPORT_KIND_LABELS[kind]}`
        }
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        width={760}
        destroyOnHidden
        footer={
          <Space>
            <Button onClick={() => setEditorOpen(false)}>关闭</Button>
            {current && Object.keys(current.autoDraft).length > 0 ? (
              <Button onClick={fillAutoDraft}>用系统草稿填充</Button>
            ) : null}
            {editable || !current ? (
              <>
                <Button loading={busy} onClick={() => void saveDraft()}>
                  保存草稿
                </Button>
                <Button type="primary" loading={busy} onClick={() => void submit()}>
                  保存并提交
                </Button>
              </>
            ) : null}
          </Space>
        }
      >
        {current ? (
          <div style={{ marginBottom: 8 }}>
            {reportStatusTag(current.status)}
            <span className="muted text-12" style={{ marginLeft: 8 }}>
              {`提交时间：${current.submittedAt ? fmtDateTime(current.submittedAt) : "未提交"}`}
            </span>
          </div>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div className="muted text-12">{`${kind === "WEEKLY" ? "本周" : "今日"}完成`}</div>
            <Input.TextArea
              rows={4}
              disabled={!editable && Boolean(current)}
              value={form.done}
              placeholder="一行一条，可手工补充"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, done: event.target.value }))
              }
            />
          </div>
          <div>
            <div className="muted text-12">数据变化（系统记录，只读）</div>
            <div className="panel-body" style={{ padding: "6px 10px" }}>
              {Array.isArray(current?.content.dataChange) &&
              current.content.dataChange.length ? (
                (current.content.dataChange as unknown[]).map((item, index) => (
                  <div key={index}>{String(item)}</div>
                ))
              ) : (
                <span className="muted">本期没有关键数据变化</span>
              )}
            </div>
          </div>
          <div>
            <div className="muted text-12">问题与阻塞</div>
            <Input.TextArea
              rows={3}
              disabled={!editable && Boolean(current)}
              value={form.blockers}
              placeholder="一行一条"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, blockers: event.target.value }))
              }
            />
          </div>
          <div>
            <div className="muted text-12">下一步</div>
            <Input.TextArea
              rows={3}
              disabled={!editable && Boolean(current)}
              value={form.next}
              placeholder="一行一条"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, next: event.target.value }))
              }
            />
          </div>
          <div>
            <div className="muted text-12">附件（系统引用，只读）</div>
            <div className="panel-body" style={{ padding: "6px 10px" }}>
              {Array.isArray(current?.content.attachments) &&
              current.content.attachments.length ? (
                (current.content.attachments as unknown[]).map((item, index) => (
                  <div key={index}>{String(item)}</div>
                ))
              ) : (
                <span className="muted">暂无附件</span>
              )}
            </div>
          </div>
          {current?.managerComment ? (
            <div>
              <div className="muted text-12">上级点评</div>
              <div className="panel-body" style={{ padding: "6px 10px" }}>
                {current.managerComment}
              </div>
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        title="点评汇报"
        open={commentOpen}
        onCancel={() => setCommentOpen(false)}
        onOk={() => void saveComment()}
        okText="保存点评"
        cancelText="取消"
      >
        <div className="muted text-12" style={{ marginBottom: 8 }}>
          {commentTarget
            ? `${commentTarget.memberName || "成员"} · ${commentTarget.periodKey}`
            : ""}
        </div>
        <Input.TextArea
          rows={4}
          maxLength={500}
          showCount
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="点评不阻断汇报，只作为复盘依据"
        />
      </Modal>
    </>
  );
}
