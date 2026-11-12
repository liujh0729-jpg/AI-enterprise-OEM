"use client";

import {
  CloseCircleOutlined,
  DownloadOutlined,
  ReloadOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { App, Button, Progress, Skeleton, Tag, Tooltip } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContentJob } from "@enterprise/contracts";
import { contentApi } from "@/api/content";
import { EmptyState, Notice } from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";
import { MEDIA_LABEL, STATUS_COLOR, STATUS_LABEL, TERMINAL } from "./generation-config";

/** CANCELED 任务行上常驻的口径说明：取消只停本站等待，上游算力费用不退回。 */
export const CANCELED_NOTE = "已取消 · 上游可能仍在生成并计费";

export function elapsedText(job: ContentJob) {
  const seconds = Math.max(0, Math.round(job.elapsedSeconds || 0));
  if (!seconds) return "";
  const min = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return min ? `已等待 ${min} 分 ${rest} 秒` : `已等待 ${rest} 秒`;
}

/** 取消的二次确认：把两条后果摆明，避免用户以为退了钱。 */
export function confirmCancel(
  modal: ReturnType<typeof App.useApp>["modal"],
  job: ContentJob,
  onOk: () => void,
) {
  modal.confirm({
    title: "停止这个生成任务？",
    content: (
      <div style={{ display: "grid", gap: 6 }}>
        <span>· 本站立刻停止等待，后续调度与子任务不再执行。</span>
        <span>· 上游已产生的算力费用不退回，可能仍在生成并计费。</span>
      </div>
    ),
    okText: "停止任务",
    okButtonProps: { danger: true },
    cancelText: "继续等待",
    onOk,
  });
}

/** 任务行上的渠道 · 模型（提交时选的那一套；老任务没有就留空）。 */
export function jobModelsText(job: ContentJob) {
  const models = (job.models || {}) as Record<string, unknown>;
  const first = Object.values(models).find(
    (item) => item && typeof item === "object",
  ) as { channelId?: unknown; model?: unknown } | undefined;
  const model = typeof first?.model === "string" ? first.model : "";
  if (!model) return "";
  const channelId = Number(first?.channelId);
  return Number.isInteger(channelId) && channelId !== 0 ? `渠道 ${channelId} · ${model}` : model;
}

export function JobMedia({ job }: { job: ContentJob }) {
  const output = job.output || {};
  const url = job.assetUrl || String(output.url || "");
  const fallbackUrl = String(output.audioUrl || output.videoUrl || "");
  const media = job.media || String(output.media || "");
  if (job.status !== "SUCCESS") return null;
  if (media === "image" && url) {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <RawImg
          src={url}
          alt=""
          style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6 }}
        />
      </a>
    );
  }
  if ((media === "video" || media === "music" || media === "audio") && (url || fallbackUrl)) {
    return (
      <a href={url || fallbackUrl} target="_blank" rel="noreferrer">
        <Button size="small" icon={<DownloadOutlined />}>
          打开
        </Button>
      </a>
    );
  }
  if (output.text) {
    return (
      <Tooltip title={String(output.text)}>
        <span className="text-12 muted" style={{ maxWidth: 240 }}>
          {String(output.text).slice(0, 60)}…
        </span>
      </Tooltip>
    );
  }
  return null;
}

/**
 * 任务抽屉：画布与三个工作台共用。
 * 数据直连 /enterprise/content/jobs（DB 是唯一真值），未到终态时按 3 秒轮询，终态自动停。
 */
export function TaskDock({
  open = true,
  source,
  canvasId,
  tool,
  title = "任务",
  refreshKey,
  onChanged,
}: {
  open?: boolean;
  /** 发起端筛选：tool | canvas | studio */
  source?: string;
  canvasId?: number;
  tool?: string;
  title?: string;
  /** 外部提交后置一个新值即刷新列表 */
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const { message, modal } = App.useApp();
  const [jobs, setJobs] = useState<ContentJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      // 三个工作台同源（source=studio），靠 tool 区分：不传就互相串任务
      const result = await contentApi.jobs({
        query: {
          page: 1,
          pageSize: 30,
          source: source || undefined,
          canvasId: canvasId || undefined,
          tool: tool || undefined,
        },
      });
      setJobs(result?.list || []);
      setError("");
    } catch (caught) {
      setError((caught as Error).message || "任务列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [source, canvasId, tool]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load, refreshKey]);

  const active = useMemo(
    () => jobs.filter((job) => !TERMINAL.has(job.status)).map((job) => job.id).join(","),
    [jobs],
  );
  useEffect(() => {
    if (!open || !active) return;
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [open, active, load]);

  const cancel = (job: ContentJob) => {
    confirmCancel(modal, job, async () => {
      try {
        const updated = await contentApi.cancelJob({ params: { id: String(job.id) } });
        if (updated) {
          setJobs((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        } else {
          void load();
        }
        onChanged?.();
      } catch (caught) {
        message.error((caught as Error).message || "取消失败");
      }
    });
  };

  const retry = async (job: ContentJob) => {
    try {
      const created = await contentApi.retryJob({ params: { id: String(job.id) } });
      if (created) {
        setJobs((prev) => [created, ...prev]);
        message.success("已重新排队");
      }
      void load();
      onChanged?.();
    } catch (caught) {
      message.error((caught as Error).message || "重试失败");
    }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 4 }} />;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <strong>{title}</strong>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>
          刷新
        </Button>
      </div>
      {error ? <Notice variant="error">{error}</Notice> : null}
      {!jobs.length ? (
        <EmptyState text="还没有任务：提交生成后在这里看排队、进度与结果" />
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {jobs.map((job) => {
            const canceled = job.status === "CANCELED";
            const modelsText = jobModelsText(job);
            const assetNote = String(job.output?.assetNote || "");
            return (
              <div
                key={job.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  border: "1px solid var(--border, #f0f0f0)",
                  borderRadius: 8,
                  background: canceled ? "rgba(250,173,20,.06)" : undefined,
                }}
              >
                <Tag color={STATUS_COLOR[job.status] || "default"} style={{ marginInlineEnd: 0 }}>
                  {STATUS_LABEL[job.status] || job.status}
                </Tag>
                <span className="text-12 muted">#{job.id}</span>
                <span className="text-12">{MEDIA_LABEL[job.media] || job.media || job.tool}</span>
                <div style={{ flex: 1, minWidth: 120 }}>
                  {job.status === "RUNNING" ? (
                    <Progress
                      percent={job.progress}
                      size="small"
                      status="active"
                      showInfo={false}
                    />
                  ) : null}
                  {job.status === "RUNNING" ? (
                    <span className="text-12 muted">{elapsedText(job)}</span>
                  ) : null}
                  {modelsText ? (
                    <div className="text-12 muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {modelsText}
                    </div>
                  ) : null}
                  {job.upstreamTaskId ? (
                    <div className="text-12 muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {`上游子任务 ${job.upstreamTaskId}`}
                    </div>
                  ) : null}
                  {assetNote ? (
                    <span className="text-12" style={{ color: "#d46b08" }}>
                      {assetNote}
                    </span>
                  ) : null}
                  {canceled ? (
                    <span className="text-12" style={{ color: "#d46b08" }}>
                      {job.cancelReason || CANCELED_NOTE}
                    </span>
                  ) : null}
                  {job.status === "FAILED" && job.error ? (
                    <span className="text-12" style={{ color: "#cf1322" }}>
                      {job.error}
                    </span>
                  ) : null}
                </div>
                <JobMedia job={job} />
                {!TERMINAL.has(job.status) ? (
                  <Button
                    size="small"
                    danger
                    icon={<CloseCircleOutlined />}
                    onClick={() => cancel(job)}
                  >
                    取消
                  </Button>
                ) : job.status === "FAILED" || canceled ? (
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    onClick={() => void retry(job)}
                  >
                    重试
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-12 muted" style={{ marginTop: 8 }}>
        <StopOutlined aria-hidden /> 取消只停本站等待；上游已产生的算力费用不退回。
      </p>
    </div>
  );
}
