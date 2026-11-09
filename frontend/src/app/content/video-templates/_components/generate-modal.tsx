"use client";

import {
  DeleteOutlined,
  FileAddOutlined,
  PictureOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { App, Button, Input, InputNumber, Modal, Select, Space, Tag } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  VIDEO_TEMPLATE_REFERENCE_MAX,
  type ContentAgentReference,
  type ContentModel,
  type VideoTemplateDetail,
} from "@enterprise/contracts";
import { contentApi, uploadContentMedia } from "@/api/content";
import {
  AssetReferencePicker,
  nextReferenceLabel,
  referencesFromAssets,
  type ReferenceMedia,
} from "@/components/content/asset-reference-picker";
import { Notice } from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";

/** 所选模型没声明档位时的兜底可选值。 */
const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"];
const RESOLUTIONS = ["480p", "720p", "1080p"];

/** 视频复刻只收参考图。 */
const IMAGE_MEDIA: ReferenceMedia[] = ["image"];

/** 模版带来的参考图按顺序编号，重复地址直接跳过。 */
function refsFromUrls(urls: string[]): ContentAgentReference[] {
  const next: ContentAgentReference[] = [];
  for (const url of urls) {
    if (next.some((item) => item.url === url)) continue;
    next.push({
      label: nextReferenceLabel(next, "image"),
      fileName: url.split("/").pop() || url,
      url,
      media: "image",
    });
  }
  return next;
}

/**
 * 复刻生成器：把模版的提示词与参考图带过来，但模型必须使用者自己选。
 * 生成是异步任务，提交后关闭弹窗，进度与结果统一在「生成任务」页签里跟进。
 */
export function GenerateTemplateModal({
  open,
  template,
  onClose,
  onGenerated,
}: {
  open: boolean;
  template: VideoTemplateDetail | null;
  onClose: () => void;
  onGenerated: () => void;
}) {
  const { message } = App.useApp();
  const [prompt, setPrompt] = useState("");
  const [references, setReferences] = useState<ContentAgentReference[]>([]);
  const [duration, setDuration] = useState(5);
  const [ratio, setRatio] = useState("16:9");
  const [resolution, setResolution] = useState("720p");
  const [channels, setChannels] = useState<{ value: number; label: string }[]>([]);
  const [channelId, setChannelId] = useState(0);
  const [models, setModels] = useState<ContentModel[]>([]);
  const [model, setModel] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);

  // 画幅 / 分辨率 / 时长都以所选模型声明的能力为准，避免提交上游后被打回。
  const selectedModel = useMemo(() => models.find((item) => item.id === model), [models, model]);
  const ratioOptions = useMemo(() => {
    const declared = selectedModel?.capabilities?.aspectRatios || [];
    return declared.length ? declared : RATIOS;
  }, [selectedModel]);
  const resolutionOptions = useMemo(() => {
    const declared = selectedModel?.capabilities?.resolutions || [];
    return declared.length ? declared : RESOLUTIONS;
  }, [selectedModel]);
  const minDuration = selectedModel?.capabilities?.minDurationSeconds ?? 1;
  const maxDuration = selectedModel?.capabilities?.maxDurationSeconds ?? 30;
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadModels = useCallback(async (nextChannelId: number, preferred = "") => {
    setModelsLoading(true);
    try {
      const result = await contentApi.models({ query: { channelId: nextChannelId } });
      const list = (result?.models || []).filter((item) => item.kind === "video");
      setModels(list);
      setModel(
        preferred && list.some((item) => item.id === preferred)
          ? preferred
          : list[0]?.id || "",
      );
    } catch {
      setModels([]);
      setModel("");
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !template) return;
    setPrompt(template.prompt);
    setReferences(refsFromUrls(template.referenceImages));
    setDuration(5);
    setRatio("16:9");
    setResolution("720p");
    setMention(null);
    setAssetPickerOpen(false);
    void (async () => {
      try {
        const settings = await contentApi.settings();
        if (!settings) return;
        const nextChannels = settings.channels.map((item) => ({
          value: item.id,
          label: item.id === 0 ? `${item.name}（内置）` : item.name,
        }));
        setChannels(nextChannels);
        const slot = settings.slots.find((item) => item.mediaType === "video");
        const initialChannel = slot?.channelId ?? nextChannels[0]?.value ?? 0;
        setChannelId(initialChannel);
        // 原模版模型只作参考；如果使用者恰好有同款就预选，没有就用自己渠道的第一个
        await loadModels(initialChannel, template.modelName || slot?.model || "");
      } catch {
        setChannels([]);
        setModels([]);
      }
    })();
  }, [open, template, loadModels]);

  useEffect(() => {
    setRatio((current) => {
      if (ratioOptions.includes(current)) return current;
      return ratioOptions.includes("16:9") ? "16:9" : ratioOptions[0] || current;
    });
    setResolution((current) => {
      if (resolutionOptions.includes(current)) return current;
      if (resolutionOptions.includes("720p")) return "720p";
      if (resolutionOptions.includes("768p")) return "768p";
      return resolutionOptions[0] || current;
    });
    setDuration((current) =>
      Math.min(
        maxDuration,
        Math.max(minDuration, Number.isFinite(current) ? current : minDuration),
      ),
    );
  }, [ratioOptions, resolutionOptions, minDuration, maxDuration]);

  /** 光标前的 `@关键词` 触发参考图选择；没有参考图时也弹，方便就地添加。 */
  const detectMention = (value: string, caret: number) => {
    const match = /(^|[\s，,。！？；;：:、（(])@([^\s@]*)$/.exec(value.slice(0, caret));
    if (!match) return null;
    return { start: caret - match[2].length - 1, query: match[2] };
  };

  const mentionOptions = useMemo(() => {
    if (!mention) return [];
    const query = mention.query.trim().toLowerCase();
    return references.filter(
      (item) =>
        !query ||
        item.label.toLowerCase().includes(query) ||
        item.fileName.toLowerCase().includes(query),
    );
  }, [mention, references]);

  // 弹层最后两行固定是添加入口，键盘上下也一并可达。
  const mentionTotal = mentionOptions.length + 2;

  const insertMention = (item: ContentAgentReference) => {
    if (!mention) return;
    const next = `${prompt.slice(0, mention.start)}@${item.label} ${prompt.slice(
      mention.start + 1 + mention.query.length,
    )}`;
    setPrompt(next);
    setMention(null);
    setMentionIndex(0);
  };

  const pickMentionIndex = (index: number) => {
    if (index < mentionOptions.length) {
      insertMention(mentionOptions[index]);
      return;
    }
    setMention(null);
    setMentionIndex(0);
    if (index === mentionOptions.length) fileRef.current?.click();
    else setAssetPickerOpen(true);
  };

  const appendReferences = (incoming: ContentAgentReference[]) => {
    if (!incoming.length) return;
    setReferences((current) => {
      const room = VIDEO_TEMPLATE_REFERENCE_MAX - current.length;
      if (room <= 0) {
        message.warning(`参考图最多 ${VIDEO_TEMPLATE_REFERENCE_MAX} 张`);
        return current;
      }
      if (incoming.length > room) {
        message.warning(`参考图最多 ${VIDEO_TEMPLATE_REFERENCE_MAX} 张，多余的没有加进来`);
      }
      return [...current, ...incoming.slice(0, room)];
    });
  };

  const addLocalFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const next: ContentAgentReference[] = [];
      for (const file of Array.from(files)) {
        try {
          const uploaded = await uploadContentMedia(file);
          if (uploaded.kind !== "image") {
            message.warning(`${file.name} 不是图片，参考图只收图片`);
            continue;
          }
          next.push({
            label: nextReferenceLabel([...references, ...next], "image"),
            fileName: uploaded.name || file.name,
            url: uploaded.url,
            media: "image",
          });
        } catch (caught) {
          message.error(`${file.name} 上传失败：${(caught as Error).message || "请重试"}`);
        }
      }
      appendReferences(next);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const generate = async () => {
    if (!template) return;
    if (!model) return message.warning("请先选择你自己的视频模型");
    setSubmitting(true);
    try {
      const created = await contentApi.generateVideoTemplate({
        params: { id: String(template.id) },
        body: {
          prompt: prompt.trim() || undefined,
          referenceImages: references.map((item) => item.url),
          duration,
          ratio,
          resolution,
          models: { video: { channelId, model } },
        },
      });
      if (!created) throw new Error("生成任务没有返回结果");
      message.success("已提交生成，可在「生成任务」里跟进进度");
      onGenerated();
    } catch (caught) {
      message.error((caught as Error).message || "生成失败");
    } finally {
      setSubmitting(false);
    }
  };

  const mentionRowStyle = (active: boolean) => ({
    display: "flex",
    gap: 8,
    alignItems: "center",
    padding: "6px 8px",
    borderRadius: 6,
    cursor: "pointer",
    background: active ? "rgba(22,119,255,0.08)" : "transparent",
  });

  return (
    <Modal
      open={open}
      title="使用模版生成 · 复刻"
      width={980}
      destroyOnHidden
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={submitting}
            disabled={!model}
            onClick={() => void generate()}
          >
            开始生成
          </Button>
        </Space>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 16 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div className="text-12 muted">
            提示词（来自模版，可改；输入 @ 引用参考图）
          </div>
          <div style={{ position: "relative" }}>
            {mention ? (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  marginTop: 6,
                  zIndex: 20,
                  width: 320,
                  maxHeight: 260,
                  overflowY: "auto",
                  background: "var(--panel, #fff)",
                  border: "1px solid var(--line, #f0f0f0)",
                  borderRadius: 8,
                  boxShadow: "0 6px 20px rgba(0,0,0,0.08)",
                  padding: 4,
                }}
                onMouseDown={(event) => event.preventDefault()}
              >
                {mentionOptions.length ? (
                  mentionOptions.map((item, index) => (
                    <div
                      key={item.url}
                      style={mentionRowStyle(index === mentionIndex)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        pickMentionIndex(index);
                      }}
                    >
                      <Tag style={{ marginInlineEnd: 0 }}>{item.label}</Tag>
                      <span
                        className="text-12 muted"
                        style={{
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.fileName}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-12 muted" style={{ padding: "6px 8px" }}>
                    还没有匹配的参考图，可以继续添加
                  </div>
                )}
                <div
                  style={{
                    height: 1,
                    margin: "4px 0",
                    background: "var(--line, #f0f0f0)",
                  }}
                />
                <div
                  style={mentionRowStyle(mentionIndex === mentionOptions.length)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pickMentionIndex(mentionOptions.length);
                  }}
                >
                  <FileAddOutlined aria-hidden />
                  <span>本地上传参考图</span>
                  <span className="text-12 muted" style={{ marginLeft: "auto" }}>
                    {`${references.length}/${VIDEO_TEMPLATE_REFERENCE_MAX}`}
                  </span>
                </div>
                <div
                  style={mentionRowStyle(mentionIndex === mentionOptions.length + 1)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pickMentionIndex(mentionOptions.length + 1);
                  }}
                >
                  <PictureOutlined aria-hidden />
                  <span>从数字资产选择</span>
                  <span className="text-12 muted" style={{ marginLeft: "auto" }}>
                    复用已传素材
                  </span>
                </div>
              </div>
            ) : null}
            <Input.TextArea
              value={prompt}
              maxLength={4000}
              autoSize={{ minRows: 5, maxRows: 10 }}
              placeholder="描述要生成的视频，输入 @ 调取参考图"
              onChange={(event) => {
                const value = event.target.value;
                setPrompt(value);
                setMention(detectMention(value, event.target.selectionStart || 0));
                setMentionIndex(0);
              }}
              onKeyDown={(event) => {
                if (!mention) return;
                if (event.key === "Escape") {
                  event.preventDefault();
                  setMention(null);
                  return;
                }
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const delta = event.key === "ArrowDown" ? 1 : -1;
                  setMentionIndex((prev) => (prev + delta + mentionTotal) % mentionTotal);
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  pickMentionIndex(Math.min(mentionIndex, mentionTotal - 1));
                }
              }}
              onBlur={() => setMention(null)}
            />
          </div>
          <div className="text-12 muted">
            参考图（可替换，最多 {VIDEO_TEMPLATE_REFERENCE_MAX} 张）
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {references.map((item) => (
              <div key={item.url} style={{ position: "relative" }}>
                <RawImg
                  src={item.url}
                  alt={item.label}
                  style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8 }}
                />
                <Tag
                  style={{
                    position: "absolute",
                    left: 4,
                    bottom: 4,
                    marginInlineEnd: 0,
                  }}
                >
                  {item.label}
                </Tag>
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  style={{ position: "absolute", top: -6, right: -6, background: "#fff" }}
                  onClick={() =>
                    setReferences((current) => current.filter((ref) => ref.url !== item.url))
                  }
                />
              </div>
            ))}
            {references.length < VIDEO_TEMPLATE_REFERENCE_MAX ? (
              <>
                <Button
                  icon={<UploadOutlined />}
                  loading={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  本地上传
                </Button>
                <Button icon={<PictureOutlined />} onClick={() => setAssetPickerOpen(true)}>
                  数字资产
                </Button>
              </>
            ) : null}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                时长（秒）
              </div>
              <InputNumber
                min={minDuration}
                max={maxDuration}
                step={1}
                style={{ width: "100%" }}
                value={duration}
                onChange={(value) => setDuration(Number(value ?? minDuration))}
              />
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                画幅
              </div>
              <Select
                style={{ width: "100%" }}
                value={ratio}
                options={ratioOptions.map((value) => ({
                  value,
                  label: value === "adaptive" ? "自适应" : value,
                }))}
                onChange={setRatio}
              />
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                分辨率
              </div>
              <Select
                style={{ width: "100%" }}
                value={resolution}
                options={resolutionOptions.map((value) => ({ value, label: value }))}
                onChange={setResolution}
              />
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
          <Notice variant="info">
            原模版使用：{template?.modelChannelName || "—"} / {template?.modelName || "—"}。
            复刻请选择你自己的视频模型，生成消耗的是你自己的额度，本站不代付。
          </Notice>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              渠道
            </div>
            <Select
              style={{ width: "100%" }}
              value={channelId}
              options={channels}
              placeholder={channels.length ? "选择渠道" : "先在模型设置里配置渠道"}
              onChange={(value) => {
                setChannelId(value);
                void loadModels(value);
              }}
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              视频模型
            </div>
            <Select
              style={{ width: "100%" }}
              value={model || undefined}
              loading={modelsLoading}
              options={models.map((item) => ({ value: item.id, label: item.id }))}
              placeholder={models.length ? "选择模型" : "该渠道没有视频模型"}
              onChange={setModel}
            />
          </div>
          <div className="text-12 muted">
            提交后会自动跳到「生成任务」页签：任务在后台排队与生成，进度和成片都在那里查看，完成后自动登记进数字资产。
          </div>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => void addLocalFiles(event.target.files)}
      />
      <AssetReferencePicker
        open={assetPickerOpen}
        mediaTypes={IMAGE_MEDIA}
        existingUrls={references.map((item) => item.url)}
        onCancel={() => setAssetPickerOpen(false)}
        onPick={(assets) => {
          const next = referencesFromAssets([], assets);
          appendReferences(
            next.map((item, index) => ({
              ...item,
              label: nextReferenceLabel(
                [...references, ...next.slice(0, index)],
                "image",
              ),
            })),
          );
          setAssetPickerOpen(false);
        }}
      />
    </Modal>
  );
}
