"use client";

import { Button, Image, Progress, Space, Tag } from "antd";
import type { CommunityRun } from "@enterprise/contracts";

/** 上游还在排队或生成中的两个状态：界面据此决定要不要继续轮询、要不要给取消按钮。 */
export const ACTIVE_RUN_STATUSES = new Set(["queued", "running"]);

export function timeText(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("zh-CN", { hour12: false });
}

function sizeText(bytes: number) {
  if (!bytes) return "";
  const mb = bytes / 1024 / 1024;
  return mb >= 1
    ? `${mb.toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 产物渲染：图直接显示，视频/音频用原生播放条，其余给下载链接（地址都是本站 OSS，永久有效）。 */
function OutputBlock({ run }: { run: CommunityRun }) {
  if (!run.outputs.length) return null;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {run.outputs.map((output) => (
        <div key={`${run.id}-${output.kind}-${output.name}`}>
          <div className="text-12 muted">
            {output.name}
            {output.sizeBytes ? ` · ${sizeText(output.sizeBytes)}` : ""}
            {output.assetId ? " · 已入数字资产" : " · 转存中"}
          </div>
          {output.kind === "image" ? (
            <Image
              src={output.url}
              alt={output.name}
              style={{ maxHeight: 220, borderRadius: 8 }}
            />
          ) : output.kind === "video" ? (
            <video
              src={output.url}
              controls
              style={{ width: "100%", maxHeight: 260, borderRadius: 8 }}
            />
          ) : output.kind === "audio" ? (
            <audio src={output.url} controls style={{ width: "100%" }} />
          ) : (
            <a href={output.url} target="_blank" rel="noreferrer">
              打开产物
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * 运行台账列表：详情抽屉与「我的产物」共用同一套渲染。
 * 进度来自本站落库的轮询结果（上游产物是短命签名 URL，一律由后端转存成本站地址后才显示）。
 */
export function RunBlock({
  runs,
  busy,
  emptyText = "还没有运行记录。",
  showWorkflow = false,
  onCancel,
}: {
  runs: CommunityRun[];
  busy?: boolean;
  emptyText?: string;
  showWorkflow?: boolean;
  onCancel: (run: CommunityRun) => void;
}) {
  if (!runs.length) return <div className="text-12 muted">{emptyText}</div>;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {runs.map((run) => (
        <div
          key={run.id}
          style={{
            border: "1px solid var(--line, #f0f0f0)",
            borderRadius: 10,
            padding: "10px 12px",
          }}
        >
          <Space size={8} wrap>
            <Tag
              color={
                ACTIVE_RUN_STATUSES.has(run.status)
                  ? "processing"
                  : run.status === "succeeded"
                    ? "success"
                    : "default"
              }
            >
              {run.statusLabel}
            </Tag>
            {showWorkflow && run.workflowTitle ? (
              <strong className="text-12">{run.workflowTitle}</strong>
            ) : null}
            {run.active && run.queuePosition > 0 ? (
              <span className="text-12 muted">前面还有 {run.queuePosition} 个作业</span>
            ) : null}
            <span className="text-12 muted">{timeText(run.createdAt)}</span>
            {run.active ? (
              <Button
                size="small"
                danger
                loading={Boolean(busy)}
                onClick={() => onCancel(run)}
              >
                取消
              </Button>
            ) : null}
          </Space>
          {run.active ? (
            <Progress
              percent={
                run.progressTotal > 0
                  ? Math.min(99, Math.round((run.progressCurrent / run.progressTotal) * 100))
                  : 0
              }
              status="active"
              size="small"
            />
          ) : null}
          {run.errorText ? (
            <div className="text-12" style={{ color: "#d4380d", marginTop: 4 }}>
              {run.errorText}
            </div>
          ) : null}
          <div style={{ marginTop: 8 }}>
            <OutputBlock run={run} />
          </div>
        </div>
      ))}
    </div>
  );
}
