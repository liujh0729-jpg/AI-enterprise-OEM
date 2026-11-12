"use client";

import { App, Button, Skeleton, Tag } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ContentAgentReference,
  ContentJob,
  ContentMediaType,
  ContentModel,
} from "@enterprise/contracts";
import { contentApi, createContentJobs } from "@/api/content";
import { Notice, Panel } from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";
import { AssetReferencePicker } from "./asset-reference-picker";
import {
  ChannelModelSelect,
  MEDIA_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  TERMINAL,
  useChannelModels,
} from "./generation-config";
import { TaskDock } from "./task-dock";

export type StudioReference = ContentAgentReference;

export type StudioSubmit = {
  tool: string;
  input: Record<string, unknown>;
  models: Record<string, { channelId: number; model: string }>;
  count?: number;
};

export type StudioContext = {
  model: ContentModel | undefined;
  references: StudioReference[];
  pickReferences: () => void;
  removeReference: (index: number) => void;
  submit: (payload: StudioSubmit) => void;
  submitting: boolean;
};

/**
 * 三个工作台的通用骨架：左参数区 / 右结果区 + 任务抽屉。
 * 渠道→模型选择、参考素材选择、提交、轮询结果与任务列表在这里收口；
 * 参数字段与结果展示由各工作台通过 params / result 两个 render 传入。
 */
export function StudioWorkbench({
  slot,
  media,
  title,
  intro,
  tools,
  params,
  result,
}: {
  slot: ContentMediaType;
  /** 任务表的 media 筛选：image / video / music */
  media: string;
  title: string;
  intro: string;
  /** 本工作台可能提交的工具：任务区只列这几个，不和别的工作台串 */
  tools: string[];
  params: (ctx: StudioContext) => React.ReactNode;
  result: (ctx: { latest: ContentJob[] }) => React.ReactNode;
}) {
  const { message } = App.useApp();
  const slots = useMemo(() => [slot], [slot]);
  const { channels, picked, models, load, setPick } = useChannelModels(slots);
  const [references, setReferences] = useState<StudioReference[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [latest, setLatest] = useState<ContentJob[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  /** 本次提交的批次 id：结果区只展示这一批，不被别的媒体的历史任务冲掉 */
  const [runId, setRunId] = useState("");

  const toolKey = tools.join(",");
  const slotModels = models[slot] || [];
  const current = picked[slot];
  const model = current
    ? slotModels.find((item) => item.id === current.model)
    : undefined;

  const pollLatest = useCallback(async () => {
    try {
      const result2 = await contentApi.jobs({
        query: {
          page: 1,
          pageSize: 12,
          source: "studio",
          media,
          tool: toolKey,
        },
      });
      const list = result2?.list || [];
      setLatest(runId ? list.filter((job) => job.runId === runId) : []);
    } catch {
      // 任务抽屉自己有错误提示，这里静默
    }
  }, [media, runId, toolKey]);

  useEffect(() => {
    void pollLatest();
  }, [pollLatest]);

  const pending = latest.some((job) => !TERMINAL.has(job.status));
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => void pollLatest(), 3000);
    return () => window.clearInterval(timer);
  }, [pending, pollLatest]);

  const submit = async (payload: StudioSubmit) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const created = await createContentJobs({ ...payload, source: "studio" });
      message.success(`已提交 ${created.length || 1} 个任务，生成中`);
      setLatest(created);
      setRunId(created[0]?.runId || "");
      setRefreshKey((prev) => prev + 1);
    } catch (caught) {
      message.error((caught as Error).message || "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const ctx: StudioContext = {
    model,
    references,
    pickReferences: () => setPickerOpen(true),
    removeReference: (index) =>
      setReferences((prev) => prev.filter((_, i) => i !== index)),
    submit: (payload) => {
      if (!current?.model) {
        message.warning("请先选好渠道和模型");
        return;
      }
      if (!payload.models[slot]?.model) {
        // 工作台自己拼的 models 缺槽位时补上界面上的选择，避免两边口径不一致
        void submit({ ...payload, models: { ...payload.models, [slot]: current } });
        return;
      }
      void submit(payload);
    },
    submitting,
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Notice variant="info">{intro}</Notice>
      <div
        className="studio-grid"
        style={{
          display: "grid",
          gap: 14,
          gridTemplateColumns: "minmax(320px, 420px) minmax(0, 1fr)",
        }}
      >
        <Panel title={title}>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <span className="text-12 muted">渠道 / 模型</span>
              <ChannelModelSelect
                channels={channels}
                picked={current}
                models={slotModels}
                onChange={(next) => {
                  setPick(slot, next);
                  if (next.model) void load(slot, next.channelId, next.model);
                }}
              />
            </div>
            <Skeleton active loading={!channels.length} paragraph={{ rows: 3 }}>
              {params(ctx)}
            </Skeleton>
          </div>
        </Panel>
        <Panel title="结果">
          <div style={{ display: "grid", gap: 14 }}>
            {result({ latest })}
            <TaskDock
              source="studio"
              tool={toolKey}
              title="最近任务"
              refreshKey={refreshKey}
              onChanged={() => void pollLatest()}
            />
          </div>
        </Panel>
      </div>
      <AssetReferencePicker
        open={pickerOpen}
        existingUrls={references.map((item) => item.url)}
        onCancel={() => setPickerOpen(false)}
        onPick={(assets) => {
          setReferences((prev) => {
            const next = [...prev];
            for (const asset of assets) {
              if (!["image", "video", "audio"].includes(asset.type)) continue;
              if (next.some((item) => item.url === asset.url)) continue;
              next.push({
                label: `${MEDIA_LABEL[asset.type] || asset.type}${
                  next.filter((item) => item.media === asset.type).length + 1
                }`,
                fileName: asset.name || asset.url,
                url: asset.url,
                media: asset.type as StudioReference["media"],
              });
            }
            return next;
          });
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

/** 参考素材编号列表：工作台参数区共用（图片1 / 视频1 / 音频1，可逐个删）。 */
export function ReferenceList({
  references,
  onRemove,
  onPick,
  hint,
}: {
  references: StudioReference[];
  onRemove: (index: number) => void;
  onPick: () => void;
  hint?: string;
}) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span className="text-12 muted">{hint || "参考素材（可选）"}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {references.map((item, index) => (
          <Tag
            key={`${item.url}-${index}`}
            closable
            onClose={() => onRemove(index)}
            style={{ marginInlineEnd: 0 }}
          >
            {item.label}
          </Tag>
        ))}
        <Button size="small" onClick={onPick}>
          从数字资产选择
        </Button>
      </div>
    </div>
  );
}

/** 结果缩略图网格：出图 / 出片 / 出曲三处共用。 */
export function ResultGrid({
  jobs,
  emptyText,
}: {
  jobs: ContentJob[];
  emptyText: string;
}) {
  const done = jobs.filter((job) => job.status === "SUCCESS");
  const running = jobs.filter((job) => !TERMINAL.has(job.status));
  if (!jobs.length) {
    return <span className="text-12 muted">{emptyText}</span>;
  }
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {running.length ? (
        <div style={{ display: "grid", gap: 4 }}>
          {running.map((job) => (
            <div key={job.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Tag color={STATUS_COLOR[job.status]} style={{ marginInlineEnd: 0 }}>
                {STATUS_LABEL[job.status]}
              </Tag>
              <span className="text-12 muted">
                {MEDIA_LABEL[job.media] || job.media} #{job.id}
                {job.progress ? ` · ${job.progress}%` : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {done.length ? (
        <div
          style={{
            display: "grid",
            gap: 8,
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          }}
        >
          {done.map((job) => {
            const url = job.assetUrl || String((job.output || {}).url || "");
            const media = job.media || String((job.output || {}).media || "");
            return (
              <div
                key={job.id}
                style={{
                  border: "1px solid var(--border, #f0f0f0)",
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "var(--card)",
                }}
              >
                {media === "image" && url ? (
                  <a href={url} target="_blank" rel="noreferrer">
                    <RawImg
                      src={url}
                      alt=""
                      style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover" }}
                    />
                  </a>
                ) : media === "video" && url ? (
                  <video src={url} controls style={{ width: "100%" }} />
                ) : url ? (
                  <audio src={url} controls style={{ width: "100%", margin: 6 }} />
                ) : (
                  <div style={{ padding: 10 }} className="text-12 muted">
                    {String((job.output || {}).text || "已完成")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
