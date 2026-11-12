"use client";

import { App, Button, Input, InputNumber } from "antd";
import { useState } from "react";
import { musicDurationRange } from "@/components/content/generation-config";
import {
  ResultGrid,
  StudioWorkbench,
  type StudioContext,
} from "@/components/content/studio-workbench";

/**
 * 音乐创作台：风格描述 + 可选的歌词出曲。
 * 时长取所选模型声明的范围；模型没声明时给 15–120 秒（契约里 music 允许 10–300，服务端以输入为准）。
 */
export function MusicStudio() {
  const { message } = App.useApp();
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [duration, setDuration] = useState(60);

  return (
    <StudioWorkbench
      slot="music"
      media="music"
      tools={["music"]}
      title="音乐参数"
      intro="写风格与情绪，需要时贴歌词；时长跟随所选模型的声明。成品直接进数字资产。"
      params={(ctx: StudioContext) => {
        const range = musicDurationRange(ctx.model);
        const current = Math.min(range.max, Math.max(range.min, duration));
        const submit = () => {
          if (!prompt.trim()) {
            message.warning("请先写风格描述");
            return;
          }
          ctx.submit({
            tool: "music",
            input: {
              prompt: prompt.trim(),
              lyrics: lyrics.trim(),
              duration: current,
            },
            models: {},
          });
        };
        return (
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="text-12 muted">风格描述</span>
              <Input.TextArea
                autoSize={{ minRows: 3, maxRows: 8 }}
                placeholder="风格、情绪、乐器、速度"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="text-12 muted">歌词（可选）</span>
              <Input.TextArea
                autoSize={{ minRows: 6, maxRows: 14 }}
                placeholder="一句一行；留空则由模型按风格自填"
                value={lyrics}
                onChange={(event) => setLyrics(event.target.value)}
              />
            </label>
            <div style={{ display: "grid", gap: 6 }}>
              <span className="text-12 muted">{`时长（${range.min}–${range.max} 秒）`}</span>
              <InputNumber
                min={range.min}
                max={range.max}
                value={current}
                onChange={(value) => setDuration(Number(value) || range.min)}
              />
            </div>
            <Button type="primary" block loading={ctx.submitting} onClick={submit}>
              生成音乐
            </Button>
          </div>
        );
      }}
      result={({ latest }) => (
        <ResultGrid jobs={latest} emptyText="还没有成品：写好风格描述点「生成音乐」" />
      )}
    />
  );
}
