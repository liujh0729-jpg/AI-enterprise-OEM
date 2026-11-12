"use client";

import { App, Button, Input, InputNumber, Select } from "antd";
import { useState } from "react";
import {
  videoDurationRange,
  videoRatioLabel,
  videoRatioOptions,
  videoResolutionOptions,
} from "@/components/content/generation-config";
import {
  ReferenceList,
  ResultGrid,
  StudioWorkbench,
  type StudioContext,
} from "@/components/content/studio-workbench";

const MAX_REFERENCES = 6;

/**
 * 视频创作台：提示词 + 首尾帧 / 参考素材出片。
 * 首尾帧 → video；仅参考图 → video-ref；视频 + 音频 → lip-sync（音频驱动口型）。
 */
export function VideoStudio() {
  const { message } = App.useApp();
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState("");
  const [ratio, setRatio] = useState("");

  return (
    <StudioWorkbench
      slot="video"
      media="video"
      tools={["video", "video-ref", "lip-sync"]}
      title="视频参数"
      intro="写动作与镜头；传首尾帧做图生视频，或用参考图 / 参考视频 / 音频出片。比例、分辨率与时长跟随所选模型的声明。"
      params={(ctx: StudioContext) => {
        const ratios = videoRatioOptions(ctx.model);
        const resolutions = videoResolutionOptions(ctx.model);
        const range = videoDurationRange(ctx.model);
        const currentRatio = ratios.includes(ratio)
          ? ratio
          : ratios.includes("16:9")
            ? "16:9"
            : ratios[0];
        const currentResolution = resolutions.includes(resolution)
          ? resolution
          : resolutions.includes("720p")
            ? "720p"
            : resolutions[0];
        const currentDuration = Math.min(range.max, Math.max(range.min, duration));
        const images = ctx.references.filter((item) => item.media === "image");
        const videos = ctx.references.filter((item) => item.media === "video");
        const audios = ctx.references.filter((item) => item.media === "audio");
        const submit = () => {
          // 音频驱动口型只看底板与音频，提示词是补充说明可以不填
          if (audios.length) {
            if (!videos.length) {
              message.warning("音频驱动口型需要同时挂一段视频当底板");
              return;
            }
            ctx.submit({
              tool: "lip-sync",
              input: { base: videos[0].url, audio: audios[0].url, prompt: prompt.trim() },
              models: {},
            });
            return;
          }
          if (!prompt.trim()) {
            message.warning("请先写提示词");
            return;
          }
          if (images.length) {
            ctx.submit({
              tool: "video-ref",
              input: {
                prompt: prompt.trim(),
                references: images.slice(0, MAX_REFERENCES).map((item) => item.url),
                duration: currentDuration,
                resolution: currentResolution,
                ratio: currentRatio,
              },
              models: {},
            });
            return;
          }
          ctx.submit({
            tool: "video",
            input: {
              prompt: prompt.trim(),
              // 只有图片才当首帧；视频在「无参考图」分支里只是底板，塞进首帧会被上游当图片地址拒绝
              firstFrame: images[0]?.url || "",
              duration: currentDuration,
              resolution: currentResolution,
              ratio: currentRatio,
            },
            models: {},
          });
        };
        return (
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="text-12 muted">提示词</span>
              <Input.TextArea
                autoSize={{ minRows: 4, maxRows: 10 }}
                placeholder="主体、动作、镜头运动、风格"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>
            <div style={{ display: "grid", gap: 6 }}>
              <span className="text-12 muted">尺寸（画面比例）</span>
              <Select
                value={currentRatio}
                options={ratios.map((value) => ({ value, label: videoRatioLabel(value) }))}
                onChange={setRatio}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <span className="text-12 muted">像素规格（分辨率）</span>
              <Select
                value={currentResolution}
                options={resolutions.map((value) => ({ value, label: value }))}
                onChange={setResolution}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <span className="text-12 muted">{`时长（${range.min}–${range.max} 秒）`}</span>
              <InputNumber
                min={range.min}
                max={range.max}
                value={currentDuration}
                onChange={(value) => setDuration(Number(value) || range.min)}
              />
            </div>
            <ReferenceList
              references={ctx.references}
              onPick={ctx.pickReferences}
              onRemove={ctx.removeReference}
              hint="参考素材（图片当首帧 / 参考图，视频当底板，音频驱动口型）"
            />
            <Button type="primary" block loading={ctx.submitting} onClick={submit}>
              生成视频
            </Button>
          </div>
        );
      }}
      result={({ latest }) => (
        <ResultGrid jobs={latest} emptyText="还没有成片：写好提示词点「生成视频」" />
      )}
    />
  );
}

