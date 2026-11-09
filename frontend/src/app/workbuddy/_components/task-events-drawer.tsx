"use client";

import { ReloadOutlined } from "@ant-design/icons";
import { Button, Drawer, Empty, Skeleton, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { Notice } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import {
  EVENT_TYPE_LABEL,
  TASK_STATUS_LABEL,
  taskStatusColor,
  workbuddyApi,
  type WbTask,
  type WbTaskEvent,
} from "./common";

const { Paragraph, Text } = Typography;

/**
 * 任务消息：Agent 会话里的输入 / 工具调用 / 回复，按 Sequence 升序。
 * 消息来自 DescribeMessageEventList（派发后由「同步进度」拉回），这里只读。
 */
export function TaskEventsDrawer({
  open,
  task,
  onClose,
}: {
  open: boolean;
  task: WbTask | null;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<WbTaskEvent[]>([]);
  const [detail, setDetail] = useState<WbTask | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !task) return;
    setLoading(true);
    setError("");
    void workbuddyApi.taskEvents(task.id).then((result) => {
      setEvents(result.data?.events || []);
      setDetail(result.data?.task || null);
      setError(result.message);
      setLoading(false);
    });
    // 同一任务重新打开时也要重取
  }, [open, task]);

  const current = detail || task;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={760}
      title={
        current ? `任务消息 · 第 ${current.seq} 步` : "任务消息"
      }
      extra={
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            if (!task) return;
            setLoading(true);
            void workbuddyApi.taskEvents(task.id).then((result) => {
              setEvents(result.data?.events || []);
              setDetail(result.data?.task || null);
              setError(result.message);
              setLoading(false);
            });
          }}
        >
          刷新
        </Button>
      }
      destroyOnHidden
    >
      {current ? (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Tag color={taskStatusColor(current.status)}>
              {TASK_STATUS_LABEL[current.status] || current.status}
            </Tag>
            {current.state ? <Tag>{`A2A：${current.state}`}</Tag> : null}
            <Tag>已同步 {current.lastEventSeq} 条</Tag>
          </div>
          <div
            className="text-13"
            style={{ marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.6 }}
          >
            {current.instruction}
          </div>
          {current.lastError ? (
            <div style={{ marginTop: 8 }}>
              <Notice variant="error">{current.lastError}</Notice>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <Notice variant="error">{error}</Notice> : null}

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : events.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {events.map((event) => (
            <div
              key={event.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "10px 12px",
                background:
                  event.eventType === "user" ? "var(--bg-muted)" : "var(--card)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <Tag
                  color={
                    event.eventType === "tool"
                      ? "gold"
                      : event.eventType === "user"
                        ? "blue"
                        : "green"
                  }
                >
                  {EVENT_TYPE_LABEL[event.eventType] || event.eventType}
                </Tag>
                <span className="text-12 muted">#{event.seq}</span>
                <span className="text-12 muted">
                  {fmtTime(event.occurredAt)}
                </span>
                {event.tokenUsage?.total ? (
                  <span className="text-12 muted">
                    {`${event.tokenUsage.input || 0} / ${event.tokenUsage.output || 0} tokens`}
                  </span>
                ) : null}
              </div>
              {event.content ? (
                <Paragraph
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    fontSize: 13,
                    lineHeight: 1.65,
                  }}
                >
                  {event.content}
                </Paragraph>
              ) : null}
              {event.toolName ? (
                <div style={{ marginTop: 6 }}>
                  <Text strong style={{ fontSize: 13 }}>
                    {`工具：${event.toolName}`}
                  </Text>
                  {event.toolInput ? (
                    <pre
                      style={{
                        margin: "6px 0 0",
                        padding: 8,
                        background: "var(--bg-muted)",
                        borderRadius: 6,
                        fontSize: 12,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        maxHeight: 220,
                        overflow: "auto",
                      }}
                    >
                      {event.toolInput}
                    </pre>
                  ) : null}
                  {event.toolOutput ? (
                    <pre
                      style={{
                        margin: "6px 0 0",
                        padding: 8,
                        background: "var(--bg-muted)",
                        borderRadius: 6,
                        fontSize: 12,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                        maxHeight: 220,
                        overflow: "auto",
                      }}
                    >
                      {event.toolOutput}
                    </pre>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <Empty
          description="还没有消息：任务派发后点计划详情的「同步进度」把会话消息拉回来"
        />
      )}
    </Drawer>
  );
}
