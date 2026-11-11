"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { App, Button, Input, Spin, Tag } from "antd";
import type { MyTaskRow } from "@enterprise/contracts";
import { taskCenterApi } from "@/api/task-center";
import { MobileAuthGate, MobileShell, fmtMobileTime } from "../../_components/mobile-common";

const STATUS_COLOR: Record<string, string> = {
  OPEN: "blue",
  DOING: "orange",
  DONE: "green",
  CANCELED: "default",
  EXPIRED: "red",
};

/** 我的任务详情（`/m/task/[id]`）：查看摘要并在手机上关闭（完成）任务。 */
export default function MobileTaskPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const { message } = App.useApp();
  const [row, setRow] = useState<MyTaskRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await taskCenterApi.get({ params: { id } });
      setRow(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "任务加载失败");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) void load();
  }, [id, load]);

  const close = async () => {
    setSubmitting(true);
    try {
      const next = await taskCenterApi.close({
        params: { id },
        body: { note: note.trim() || "在手机端处理" },
      });
      if (next) setRow(next);
      message.success("任务已标记为完成");
      setNote("");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "操作失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  const closed = row?.status === "DONE" || row?.status === "CANCELED";

  return (
    <MobileShell title="任务详情" sub={row?.categoryLabel || "我的任务"} backHref="/m/inbox">
      <MobileAuthGate>
        {loading ? (
          <div className="m-loading">
            <Spin />
          </div>
        ) : error ? (
          <div className="m-empty">
            <div className="m-empty-title">加载失败</div>
            <p className="m-empty-text">{error}</p>
            <Button href="/m/inbox">返回消息中心</Button>
          </div>
        ) : !row ? (
          <div className="m-empty">
            <div className="m-empty-title">任务不存在</div>
            <p className="m-empty-text">该任务可能已被关闭，或不属于当前账号。</p>
            <Button href="/m/inbox">返回消息中心</Button>
          </div>
        ) : (
          <div className="m-view">
            <div className="m-card">
              <div className="m-card-title">
                <span>{row.title}</span>
                <Tag color={STATUS_COLOR[row.status]}>{row.statusLabel}</Tag>
              </div>
              <div className="m-kv">
                <span>来源</span>
                <b>{row.sourceLabel || row.source}</b>
              </div>
              <div className="m-kv">
                <span>优先级</span>
                <b>{row.priorityLabel || row.priority}</b>
              </div>
              <div className="m-kv">
                <span>截止时间</span>
                <b style={row.overdue ? { color: "#f53f3f" } : undefined}>
                  {row.dueAt ? fmtMobileTime(row.dueAt) : "未设置"}
                  {row.overdue ? "（已逾期）" : ""}
                </b>
              </div>
              <div className="m-kv">
                <span>创建时间</span>
                <b>{fmtMobileTime(row.createdAt)}</b>
              </div>
              {row.description ? (
                <div className="m-notice-content" style={{ marginTop: 10 }}>
                  {row.description}
                </div>
              ) : null}
            </div>

            {closed ? (
              <div className="m-card">
                <div className="m-card-title">已关闭</div>
                <p className="m-hint" style={{ marginTop: 0 }}>
                  {row.closeNote || "该任务已完成或已取消。"}
                </p>
                {row.link ? <Button href={row.link}>打开业务页面</Button> : null}
                <Button href="/m/inbox" style={{ marginLeft: 8 }}>
                  返回消息中心
                </Button>
              </div>
            ) : (
              <div className="m-card">
                <div className="m-card-title">处理</div>
                <Input.TextArea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="处理说明（可选）"
                  style={{ fontSize: 16 }}
                />
                <div className="m-inline-actions" style={{ justifyContent: "flex-start", marginTop: 10 }}>
                  <Button type="primary" loading={submitting} onClick={() => void close()}>
                    标记为已完成
                  </Button>
                  {row.link ? <Button href={row.link}>打开业务页面</Button> : null}
                </div>
                <p className="m-hint">
                  手机端只能标记完成；如需审批、退回或转交，请打开业务页面在电脑端处理。
                </p>
              </div>
            )}
          </div>
        )}
      </MobileAuthGate>
    </MobileShell>
  );
}
