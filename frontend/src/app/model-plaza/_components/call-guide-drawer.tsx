"use client";

import { CopyOutlined, ExperimentOutlined } from "@ant-design/icons";
import { App, Button, Drawer, Input, Select, Space, Tag } from "antd";
import { useMemo, useState } from "react";
import type { MpModel } from "@enterprise/contracts";
import { Notice, PillTabs } from "@/components/ui/panel";
import { HelpTopicButton } from "@/components/ui/help-topic-button";
import {
  UNIT_LABEL,
  UNIT_TAG_COLOR,
  cacheText,
  componentText,
  discountLabel,
  effectiveText,
  hasDiscount,
  officialText,
  priceText,
  tierText,
} from "@/lib/model-plaza-pricing";

type Language = "curl" | "python" | "typescript" | "javascript";

const LANGUAGE_ITEMS = [
  { key: "curl", label: "cURL" },
  { key: "python", label: "Python" },
  { key: "typescript", label: "TypeScript" },
  { key: "javascript", label: "JavaScript" },
];

const ENDPOINT_LABEL: Record<string, string> = {
  "/chat/completions": "对话",
  "/embeddings": "向量",
  "/images/generations": "文生图",
  "/images/edits": "图像编辑",
  "/audio/speech": "语音合成",
  "/audio/transcriptions": "语音识别",
  "/videos": "视频",
};

type Snippet = Record<Language, string>;

function indent(text: string, spaces: number) {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}

function json(value: unknown) {
  return JSON.stringify(value, null, 2);
}

/** 各能力的请求示例：SDK 走 OpenAI 官方客户端，多模态/异步任务走 fetch。 */
function buildSnippets(baseUrl: string, model: string, endpoint: string): Snippet {
  const key = "$MODEL_PLAZA_API_KEY";
  const url = `${baseUrl}${endpoint}`;

  if (endpoint === "/chat/completions") {
    const payload = {
      model,
      messages: [{ role: "user", content: "用一句话介绍你自己。" }],
      temperature: 0.7,
      max_tokens: 1024,
      stream: false,
    };
    return {
      curl: `curl ${url} \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '${json(payload)}'`,
      python: `from openai import OpenAI

client = OpenAI(base_url="${baseUrl}", api_key="${key}")

resp = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "用一句话介绍你自己。"}],
    temperature=0.7,
    max_tokens=1024,
)
print(resp.choices[0].message.content)`,
      typescript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: process.env.MODEL_PLAZA_API_KEY!,
});

const resp = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "用一句话介绍你自己。" }],
  temperature: 0.7,
  max_tokens: 1024,
});
console.log(resp.choices[0]?.message?.content);`,
      javascript: `const OpenAI = require("openai");

const client = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: process.env.MODEL_PLAZA_API_KEY,
});

const resp = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "用一句话介绍你自己。" }],
  temperature: 0.7,
  max_tokens: 1024,
});
console.log(resp.choices[0]?.message?.content);`,
    };
  }

  if (endpoint === "/embeddings") {
    const payload = { model, input: ["你好，世界", "第二段文本"] };
    return {
      curl: `curl ${url} \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '${json(payload)}'`,
      python: `from openai import OpenAI

client = OpenAI(base_url="${baseUrl}", api_key="${key}")

resp = client.embeddings.create(
    model="${model}",
    input=["你好，世界", "第二段文本"],
)
print(len(resp.data[0].embedding))`,
      typescript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: process.env.MODEL_PLAZA_API_KEY!,
});

const resp = await client.embeddings.create({
  model: "${model}",
  input: ["你好，世界", "第二段文本"],
});
console.log(resp.data[0]?.embedding.length);`,
      javascript: `const OpenAI = require("openai");

const client = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: process.env.MODEL_PLAZA_API_KEY,
});

const resp = await client.embeddings.create({
  model: "${model}",
  input: ["你好，世界", "第二段文本"],
});
console.log(resp.data[0]?.embedding.length);`,
    };
  }

  if (endpoint === "/images/generations") {
    const payload = {
      model,
      prompt: "一只在雨中的橘猫，胶片质感，暖色调",
      n: 1,
      size: "1024x1024",
    };
    return {
      curl: `curl ${url} \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '${json(payload)}'`,
      python: `from openai import OpenAI

client = OpenAI(base_url="${baseUrl}", api_key="${key}")

resp = client.images.generate(
    model="${model}",
    prompt="一只在雨中的橘猫，胶片质感，暖色调",
    n=1,
    size="1024x1024",
)
print(resp.data[0].url)`,
      typescript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: process.env.MODEL_PLAZA_API_KEY!,
});

const resp = await client.images.generate({
  model: "${model}",
  prompt: "一只在雨中的橘猫，胶片质感，暖色调",
  n: 1,
  size: "1024x1024",
});
console.log(resp.data[0]?.url);`,
      javascript: `const OpenAI = require("openai");

const client = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: process.env.MODEL_PLAZA_API_KEY,
});

const resp = await client.images.generate({
  model: "${model}",
  prompt: "一只在雨中的橘猫，胶片质感，暖色调",
  n: 1,
  size: "1024x1024",
});
console.log(resp.data[0]?.url);`,
    };
  }

  if (endpoint === "/images/edits") {
    return {
      curl: `curl ${url} \\
  -H "Authorization: Bearer ${key}" \\
  -F "model=${model}" \\
  -F "prompt=把背景换成夜晚的城市" \\
  -F "image=@input.png" \\
  -F "size=1024x1024"`,
      python: `from openai import OpenAI

client = OpenAI(base_url="${baseUrl}", api_key="${key}")

with open("input.png", "rb") as image:
    resp = client.images.edit(
        model="${model}",
        image=image,
        prompt="把背景换成夜晚的城市",
        size="1024x1024",
    )
print(resp.data[0].url)`,
      typescript: `import { readFile } from "node:fs/promises";

const form = new FormData();
form.append("model", "${model}");
form.append("prompt", "把背景换成夜晚的城市");
form.append("image", new Blob([await readFile("input.png")]), "input.png");
form.append("size", "1024x1024");

const resp = await globalThis.fetch("${url}", {
  method: "POST",
  headers: { Authorization: \`Bearer \${process.env.MODEL_PLAZA_API_KEY}\` },
  body: form,
});
console.log(await resp.json());`,
      javascript: `const { readFile } = require("node:fs/promises");

const form = new FormData();
form.append("model", "${model}");
form.append("prompt", "把背景换成夜晚的城市");
form.append("image", new Blob([await readFile("input.png")]), "input.png");
form.append("size", "1024x1024");

const resp = await globalThis.fetch("${url}", {
  method: "POST",
  headers: { Authorization: \`Bearer \${process.env.MODEL_PLAZA_API_KEY}\` },
  body: form,
});
console.log(await resp.json());`,
    };
  }

  if (endpoint === "/audio/speech") {
    const payload = {
      model,
      input: "你好，欢迎使用模型广场。",
      voice: "alloy",
      response_format: "mp3",
    };
    return {
      curl: `curl ${url} \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '${json(payload)}' \\
  --output speech.mp3`,
      python: `from openai import OpenAI

client = OpenAI(base_url="${baseUrl}", api_key="${key}")

resp = client.audio.speech.create(
    model="${model}",
    input="你好，欢迎使用模型广场。",
    voice="alloy",
)
resp.write_to_file("speech.mp3")`,
      typescript: `import OpenAI from "openai";
import { writeFileSync } from "node:fs";

const client = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: process.env.MODEL_PLAZA_API_KEY!,
});

const speech = await client.audio.speech.create({
  model: "${model}",
  input: "你好，欢迎使用模型广场。",
  voice: "alloy",
});
writeFileSync("speech.mp3", Buffer.from(await speech.arrayBuffer()));`,
      javascript: `const OpenAI = require("openai");
const { writeFileSync } = require("node:fs");

const client = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: process.env.MODEL_PLAZA_API_KEY,
});

const speech = await client.audio.speech.create({
  model: "${model}",
  input: "你好，欢迎使用模型广场。",
  voice: "alloy",
});
writeFileSync("speech.mp3", Buffer.from(await speech.arrayBuffer()));`,
    };
  }

  if (endpoint === "/audio/transcriptions") {
    return {
      curl: `curl ${url} \\
  -H "Authorization: Bearer ${key}" \\
  -F "model=${model}" \\
  -F "file=@speech.mp3" \\
  -F "language=zh"`,
      python: `from openai import OpenAI

client = OpenAI(base_url="${baseUrl}", api_key="${key}")

with open("speech.mp3", "rb") as audio:
    resp = client.audio.transcriptions.create(
        model="${model}",
        file=audio,
        language="zh",
    )
print(resp.text)`,
      typescript: `import { readFile } from "node:fs/promises";

const form = new FormData();
form.append("model", "${model}");
form.append("file", new Blob([await readFile("speech.mp3")]), "speech.mp3");
form.append("language", "zh");

const resp = await globalThis.fetch("${url}", {
  method: "POST",
  headers: { Authorization: \`Bearer \${process.env.MODEL_PLAZA_API_KEY}\` },
  body: form,
});
console.log(await resp.json());`,
      javascript: `const { readFile } = require("node:fs/promises");

const form = new FormData();
form.append("model", "${model}");
form.append("file", new Blob([await readFile("speech.mp3")]), "speech.mp3");
form.append("language", "zh");

const resp = await globalThis.fetch("${url}", {
  method: "POST",
  headers: { Authorization: \`Bearer \${process.env.MODEL_PLAZA_API_KEY}\` },
  body: form,
});
console.log(await resp.json());`,
    };
  }

  const payload = {
    model,
    prompt: "镜头缓慢推进，雨后的城市霓虹倒影",
    duration: 5,
    size: "1280x720",
  };
  return {
    curl: `curl ${url} \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '${json(payload)}'`,
    python: `import requests

resp = requests.post(
    "${url}",
    headers={"Authorization": "Bearer ${key}"},
    json=${indent(json(payload), 4)},
)
print(resp.json())`,
    typescript: `const resp = await globalThis.fetch("${url}", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.MODEL_PLAZA_API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(${indent(json(payload), 2)}),
});
console.log(await resp.json());`,
    javascript: `const resp = await globalThis.fetch("${url}", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.MODEL_PLAZA_API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(${indent(json(payload), 2)}),
});
console.log(await resp.json());`,
  };
}

/**
 * 单个模型的调用说明：端点切换 + 四种语言示例 + 支持参数 + 速率限制。
 * baseURL 来自「接入方式」的站点地址，不在前端硬编码。
 */
export function CallGuideDrawer({
  model,
  baseUrl,
  onClose,
  onTrial,
}: {
  model: MpModel | null;
  baseUrl: string;
  onClose: () => void;
  /** 抽屉里直接发起在线试用（仅支持对话端点的可用模型）。 */
  onTrial?: (model: MpModel) => void;
}) {
  const { message } = App.useApp();
  const [language, setLanguage] = useState<Language>("curl");
  const [endpoint, setEndpoint] = useState("");

  const endpoints = model?.endpoints ?? [];
  const activeEndpoint = endpoint && endpoints.includes(endpoint)
    ? endpoint
    : endpoints[0] || "/chat/completions";

  const snippets = useMemo(
    () =>
      model
        ? buildSnippets(baseUrl || "", model.modelKey, activeEndpoint)
        : null,
    [activeEndpoint, baseUrl, model],
  );

  const copy = async () => {
    if (!snippets) return;
    try {
      await navigator.clipboard.writeText(snippets[language]);
      message.success("示例已复制");
    } catch {
      message.error("复制失败，请手动选择复制");
    }
  };

  /** Base URL 与 Model ID 是外部客户端（Qoder / Codex）唯一要手填的两项，单独可复制。 */
  const copyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success(`${label} 已复制`);
    } catch {
      message.error("复制失败，请手动选择复制");
    }
  };

  return (
    <Drawer
      open={Boolean(model)}
      size={860}
      title={model ? `调用方式 · ${model.displayName || model.modelKey}` : "调用方式"}
      onClose={onClose}
      extra={
        <Space size={8}>
          <Button icon={<CopyOutlined aria-hidden />} onClick={() => void copy()}>
            复制示例
          </Button>
          {model?.available && model.endpoints.includes("/chat/completions") && onTrial ? (
            <Button
              type="primary"
              icon={<ExperimentOutlined aria-hidden />}
              onClick={() => onTrial(model)}
            >
              在线试用
            </Button>
          ) : null}
        </Space>
      }
    >
      {model && snippets ? (
        <Space orientation="vertical" size={14} style={{ width: "100%" }}>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              模型标识（Model ID）
            </div>
            <Space.Compact style={{ width: "100%", maxWidth: 560 }}>
              <Input readOnly value={model.modelKey} className="mono" />
              <Button
                icon={<CopyOutlined aria-hidden />}
                onClick={() => void copyValue(model.modelKey, "Model ID")}
              >
                复制
              </Button>
            </Space.Compact>
          </div>

          {baseUrl ? (
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>Base URL</div>
              <Space.Compact style={{ width: "100%", maxWidth: 560 }}>
                <Input readOnly value={baseUrl} className="mono" />
                <Button
                  icon={<CopyOutlined aria-hidden />}
                  onClick={() => void copyValue(baseUrl, "Base URL")}
                >
                  复制
                </Button>
              </Space.Compact>
            </div>
          ) : null}

          {endpoints.length > 1 ? (
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>调用端点</div>
              <Select
                style={{ width: 280 }}
                value={activeEndpoint}
                onChange={setEndpoint}
                options={endpoints.map((item) => ({
                  value: item,
                  label: `${ENDPOINT_LABEL[item] || item}（${item}）`,
                }))}
              />
            </div>
          ) : (
            <div className="text-12 muted">
              端点：<span className="mono">{activeEndpoint}</span>
            </div>
          )}

          <div>
            <PillTabs
              items={LANGUAGE_ITEMS}
              value={language}
              onChange={(key) => setLanguage(key as Language)}
              style={{ marginBottom: 10 }}
            />
            <pre
              className="mono"
              style={{
                margin: 0,
                padding: 14,
                background: "var(--bg-subtle, #f7f8fa)",
                borderRadius: 8,
                overflowX: "auto",
                fontSize: 12,
                lineHeight: 1.7,
              }}
            >
              {snippets[language]}
            </pre>
            <div className="text-12 muted" style={{ marginTop: 6 }}>
              把 <span className="mono">$MODEL_PLAZA_API_KEY</span> 换成「API Key 管理」里签发的 sk- Key；
              所有示例都走本站 OpenAI 兼容网关，按目录价扣积分。
            </div>
          </div>

          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>支持的参数</div>
            <Space size={4} wrap>
              {model.params.length ? (
                model.params.map((param) => (
                  <Tag key={param} className="mono">{param}</Tag>
                ))
              ) : (
                <span className="text-12 muted">未登记</span>
              )}
            </Space>
            <div className="text-12 muted" style={{ marginTop: 6 }}>
              以上为网关透传字段，具体支持度以该模型上游为准。
            </div>
          </div>

          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>速率限制</div>
            <Notice variant="info">{model.rateLimit.note}</Notice>
          </div>

          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>计费</div>
            <Space size={6} wrap style={{ marginBottom: 6 }}>
              <Tag color={UNIT_TAG_COLOR[model.billingUnit]}>
                {UNIT_LABEL[model.billingUnit]}
              </Tag>
              {hasDiscount(model) ? (
                <Tag color="red">
                  平台折扣 {discountLabel(model.price.discountRate)}
                </Tag>
              ) : null}
            </Space>
            <div className="text-12">
              {hasDiscount(model) ? (
                <>
                  <span className="mp-price-old">{officialText(model)}</span>
                  <span className="mp-price-now">{effectiveText(model)}</span>
                </>
              ) : (
                <span>{officialText(model)}</span>
              )}
            </div>
            <div className="text-12" style={{ marginTop: 4 }}>
              实付 {priceText(model)}
            </div>
            {cacheText(model) ? (
              <div className="text-12 muted" style={{ marginTop: 4 }}>
                {cacheText(model)}
              </div>
            ) : null}
            {tierText(model) ? (
              <div className="text-12 muted" style={{ marginTop: 4 }}>
                分档：{tierText(model)}
              </div>
            ) : null}
            {componentText(model) ? (
              <div className="text-12 muted" style={{ marginTop: 4 }}>
                附加：{componentText(model)}
              </div>
            ) : null}
            <div className="text-12 muted" style={{ marginTop: 4 }}>
              计费单位与上游一致；积分按系统汇率换算，用户不可单独设置。
              命中模型且仍有额度的时长卡优先扣卡，卡未覆盖部分才扣积分。
            </div>
          </div>

          <div>
            <div className="text-12" style={{ marginBottom: 6 }}>
              外部客户端配置：在 Qoder / Codex 里填
              <b> Base URL </b>、<b>API Key</b> 与 <b>Model ID</b>（就是上面的
              Model ID），计费与站内试用同一套规则；只认 Responses 协议的客户端可直接指向
              <b> /v1/responses</b>。
            </div>
            <HelpTopicButton topic="in-external-clients" label="在 Qoder / Codex 里怎么配" />
          </div>
        </Space>
      ) : null}
    </Drawer>
  );
}
