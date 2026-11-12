"use client";

import { Select } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  type ContentJob,
  type ContentMediaType,
  type ContentModel,
} from "@enterprise/contracts";
import { contentApi } from "@/api/content";

export type MediaSlot = "image" | "video" | "music" | "text" | "vision" | "audio";

export type PickedModel = { channelId: number; model: string };

export type ChannelOption = { value: number; label: string };

/** 任务状态与终态判定：小工具、工作台、画布三处共用一份口径。 */
export const STATUS_LABEL: Record<string, string> = {
  PENDING: "排队中",
  RUNNING: "生成中",
  SUCCESS: "已完成",
  FAILED: "失败",
  CANCELED: "已取消",
};
export const STATUS_COLOR: Record<string, string> = {
  PENDING: "default",
  RUNNING: "processing",
  SUCCESS: "success",
  FAILED: "error",
  CANCELED: "warning",
};
export const TERMINAL = new Set(["SUCCESS", "FAILED", "CANCELED"]);

export const ACCEPT_BY_KIND: Record<string, string> = {
  image: "image/jpeg,image/png,image/webp,image/gif",
  video: "video/mp4,video/quicktime,video/webm",
  audio: "audio/mpeg,audio/wav,audio/mp4",
};

export const MEDIA_LABEL: Record<string, string> = {
  image: "图片",
  video: "视频",
  music: "音乐",
  audio: "音频",
  text: "文本",
};

/** 上游没声明档位（自定义渠道）时的兜底尺寸。 */
const IMAGE_SIZE_FALLBACK = ["auto", "1024x1024", "1024x1536", "1536x1024"];
const VIDEO_RATIO_FALLBACK = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"];
const VIDEO_RESOLUTION_FALLBACK = ["480p", "720p", "1080p"];
const VIDEO_DURATION_MIN = 1;
const VIDEO_DURATION_MAX = 30;
/** 音乐没有像素/比例概念：模型没声明时长时用 15–120 秒。 */
const MUSIC_DURATION_MIN = 15;
const MUSIC_DURATION_MAX = 120;

/** 尺寸档位由所选模型的 aipdd 能力声明决定；没有声明就退回常用像素尺寸。 */
export function imageSizeOptions(model?: ContentModel) {
  const declared = model?.capabilities?.sizes || [];
  return declared.length ? declared : IMAGE_SIZE_FALLBACK;
}

export function imageSizeLabel(value: string) {
  if (value === "auto") return "自动（由模型决定）";
  return /^\d+x\d+$/i.test(value) ? value.replace("x", " × ") : value;
}

export function defaultImageSize(options: string[]) {
  if (options.includes("1024x1024")) return "1024x1024";
  return options[0] || "1024x1024";
}

/** 视频的尺寸（画面比例）、像素规格与时长同样以所选模型的声明为准。 */
export function videoRatioOptions(model?: ContentModel) {
  const declared = model?.capabilities?.aspectRatios || [];
  return declared.length ? declared : VIDEO_RATIO_FALLBACK;
}

export function videoResolutionOptions(model?: ContentModel) {
  const declared = model?.capabilities?.resolutions || [];
  return declared.length ? declared : VIDEO_RESOLUTION_FALLBACK;
}

export function videoRatioLabel(value: string) {
  return value === "adaptive" ? "自适应" : value;
}

export function videoDurationRange(model?: ContentModel) {
  const min = model?.capabilities?.minDurationSeconds ?? VIDEO_DURATION_MIN;
  const max = model?.capabilities?.maxDurationSeconds ?? VIDEO_DURATION_MAX;
  return max >= min ? { min, max } : { min: VIDEO_DURATION_MIN, max: VIDEO_DURATION_MAX };
}

export function musicDurationRange(model?: ContentModel) {
  const min = model?.capabilities?.minDurationSeconds ?? MUSIC_DURATION_MIN;
  const max = model?.capabilities?.maxDurationSeconds ?? MUSIC_DURATION_MAX;
  return max >= min ? { min, max } : { min: MUSIC_DURATION_MIN, max: MUSIC_DURATION_MAX };
}

/** 按媒体槽位从渠道模型清单里挑出可用项（文本/视觉按模型标记过滤）。 */
export function filterBySlot(slot: ContentMediaType | MediaSlot, models: ContentModel[]) {
  if (slot === "vision") return models.filter((item) => item.vision);
  if (slot === "text") return models.filter((item) => item.kind === "text");
  return models.filter((item) => item.kind === slot);
}

/**
 * 渠道 → 模型 → 规格的取数：小工具、三个工作台与画布节点面板共用。
 * 读「模型设置」里的槽位默认值作为初值，再按用户选择加载该渠道的模型清单。
 */
export function useChannelModels(slotTypes: ContentMediaType[]) {
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [picked, setPicked] = useState<Partial<Record<ContentMediaType, PickedModel>>>({});
  const [models, setModels] = useState<Partial<Record<ContentMediaType, ContentModel[]>>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (slot: ContentMediaType, channelId: number, preferred = "") => {
      setLoading(true);
      try {
        const result = await contentApi.models({ query: { channelId } });
        const list = filterBySlot(slot, result?.models || []);
        setModels((prev) => ({ ...prev, [slot]: list }));
        const model =
          preferred && list.some((item) => item.id === preferred) ? preferred : list[0]?.id || "";
        setPicked((prev) => ({ ...prev, [slot]: { channelId, model } }));
      } catch {
        setModels((prev) => ({ ...prev, [slot]: [] }));
        setPicked((prev) => ({ ...prev, [slot]: { channelId, model: "" } }));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const key = slotTypes.join(",");
  useEffect(() => {
    if (!key) return;
    void (async () => {
      try {
        const settings = await contentApi.settings();
        if (!settings) return;
        setChannels(
          settings.channels.map((item) => ({
            value: item.id,
            label: item.name,
          })),
        );
        for (const slot of key.split(",") as ContentMediaType[]) {
          const saved = settings.slots.find((item) => item.mediaType === slot);
          await load(slot, saved?.channelId ?? 0, saved?.model || "");
        }
      } catch {
        // 读不到模型清单时保留空选择，提交会被拦下
      }
    })();
  }, [key, load]);

  const modelOf = (slot: ContentMediaType) => {
    const pick = picked[slot];
    return pick ? (models[slot] || []).find((item) => item.id === pick.model) : undefined;
  };

  const setPick = (slot: ContentMediaType, next: PickedModel) => {
    setPicked((prev) => ({ ...prev, [slot]: next }));
  };

  return {
    channels,
    picked,
    models,
    loading,
    load,
    modelOf,
    setPick,
    missing: slotTypes.some((slot) => !picked[slot]?.model),
  };
}

/** 渠道 + 模型两连选：换渠道自动重拉该渠道的模型清单。 */
export function ChannelModelSelect({
  channels,
  picked,
  models,
  onChange,
  disabled,
}: {
  channels: ChannelOption[];
  picked?: PickedModel;
  models: ContentModel[];
  onChange: (next: PickedModel) => void;
  /** 渠道/模型由外部决定时置为只读（画布上接了配置节点） */
  disabled?: boolean;
}) {
  const channelId = picked?.channelId ?? 0;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Select
        style={{ minWidth: 180, flex: 1 }}
        value={channels.length ? channelId : undefined}
        placeholder="选择渠道"
        options={channels}
        disabled={disabled}
        onChange={(value) => onChange({ channelId: value, model: "" })}
      />
      <Select
        style={{ minWidth: 200, flex: 1 }}
        value={picked?.model || undefined}
        placeholder="选择模型"
        options={models.map((item) => ({ value: item.id, label: item.id }))}
        disabled={disabled}
        onChange={(value) => onChange({ channelId, model: value })}
      />
    </div>
  );
}

/** 批量提交返回的任务按状态汇总，任务抽屉里给一句人话。 */
export function jobStatusSummary(jobs: ContentJob[]) {
  const count = (status: string) => jobs.filter((job) => job.status === status).length;
  const parts = [
    count("SUCCESS") ? `${count("SUCCESS")} 个成功` : "",
    count("RUNNING") ? `${count("RUNNING")} 个生成中` : "",
    count("PENDING") ? `${count("PENDING")} 个排队中` : "",
    count("FAILED") ? `${count("FAILED")} 个失败` : "",
    count("CANCELED") ? `${count("CANCELED")} 个已取消` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "—";
}
