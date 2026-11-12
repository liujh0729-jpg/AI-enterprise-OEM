"use client";

import { App, Button, Input, InputNumber, Select } from "antd";
import { useState } from "react";
import {
  defaultImageSize,
  imageSizeLabel,
  imageSizeOptions,
} from "@/components/content/generation-config";
import {
  ReferenceList,
  ResultGrid,
  StudioWorkbench,
  type StudioContext,
} from "@/components/content/studio-workbench";

const MAX_REFERENCES = 6;

/**
 * 生图工作台：提示词 + 最多 6 张参考图，按张数 1–4 批量出图。
 * 无参考图走文生图（image），有参考图走带图重绘（image-edit）；尺寸只认所选模型声明。
 */
export function ImageStudio() {
  const { message } = App.useApp();
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(1);
  const [size, setSize] = useState("");

  return (
    <StudioWorkbench
      slot="image"
      media="image"
      tools={["image", "image-edit"]}
      title="生图参数"
      intro="写画面描述、按张数批量出图；可挂最多 6 张参考图锁定主体。尺寸档位跟随所选模型声明的能力。"
      params={(ctx: StudioContext) => {
        const options = imageSizeOptions(ctx.model);
        const current = options.includes(size) ? size : defaultImageSize(options);
        const urls = ctx.references.map((item) => item.url).slice(0, MAX_REFERENCES);
        const submit = () => {
          if (!prompt.trim()) {
            message.warning("请先写提示词");
            return;
          }
          ctx.submit(
            urls.length
              ? {
                  tool: "image-edit",
                  input: { image: urls, prompt: prompt.trim(), size: current },
                  models: {},
                  count,
                }
              : {
                  tool: "image",
                  input: { prompt: prompt.trim(), size: current },
                  models: {},
                  count,
                },
          );
        };
        return (
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="text-12 muted">提示词</span>
              <Input.TextArea
                autoSize={{ minRows: 4, maxRows: 10 }}
                placeholder="主体、风格、构图、光影"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="text-12 muted">
                {options.some((value) => /^\d+x\d+$/i.test(value)) ? "尺寸" : "分辨率"}
              </span>
              <Select
                value={current}
                options={options.map((value) => ({
                  value,
                  label: imageSizeLabel(value),
                }))}
                onChange={setSize}
              />
            </label>
            <div style={{ display: "grid", gap: 6 }}>
              <span className="text-12 muted">张数（1–4）</span>
              <InputNumber min={1} max={4} value={count} onChange={(value) => setCount(Number(value) || 1)} />
            </div>
            <ReferenceList
              references={ctx.references}
              onPick={ctx.pickReferences}
              onRemove={ctx.removeReference}
              hint={`参考图（可选，最多 ${MAX_REFERENCES} 张；挂了参考图就走带图重绘）`}
            />
            <Button type="primary" block loading={ctx.submitting} onClick={submit}>
              生成图片
            </Button>
          </div>
        );
      }}
      result={({ latest }) => (
        <ResultGrid jobs={latest} emptyText="还没有出图结果：写好提示词点「生成图片」" />
      )}
    />
  );
}
