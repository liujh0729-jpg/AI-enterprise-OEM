"use client";

import {
  ArrowLeftOutlined,
  InboxOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SettingOutlined,
  ShopOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Empty,
  Input,
  InputNumber,
  Select,
  Skeleton,
  Tag,
  Upload,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CONTENT_MEDIA_TYPE_LABELS,
  CONTENT_TOOLS,
  type ContentField,
  type ContentJob,
  type ContentMediaType,
  type ContentModel,
  type ContentTool,
} from "@enterprise/contracts";
import { contentApi, uploadContentMedia } from "@/api/content";
import { Notice, PageHero, Panel } from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";
import { ToolCard, ToolCardGrid } from "@/components/ui/tool-card";
import { DomesticPdpTab } from "./_components/domestic-pdp-tab";
import { DramaAgentGuide } from "./_components/drama-agent-guide";
import { EcomPdpTab } from "./_components/ecom-pdp-tab";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "排队中",
  RUNNING: "生成中",
  SUCCESS: "已完成",
  FAILED: "失败",
  CANCELED: "已取消",
};
const STATUS_COLOR: Record<string, string> = {
  PENDING: "default",
  RUNNING: "processing",
  SUCCESS: "success",
  FAILED: "error",
  CANCELED: "warning",
};
const TERMINAL = new Set(["SUCCESS", "FAILED", "CANCELED"]);

const ACCEPT_BY_KIND: Record<string, string> = {
  image: "image/jpeg,image/png,image/webp,image/gif",
  video: "video/mp4,video/quicktime,video/webm",
  audio: "audio/mpeg,audio/wav,audio/mp4",
};

/** 上游没声明档位（自定义渠道）时的兜底尺寸。 */
const IMAGE_SIZE_FALLBACK = ["auto", "1024x1024", "1024x1536", "1536x1024"];
const VIDEO_RATIO_FALLBACK = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"];
const VIDEO_RESOLUTION_FALLBACK = ["480p", "720p", "1080p"];
const VIDEO_DURATION_MIN = 1;
const VIDEO_DURATION_MAX = 30;

/** 尺寸档位由所选模型的 aipdd 能力声明决定；没有声明就退回常用像素尺寸。 */
function imageSizeOptions(model?: ContentModel) {
  const declared = model?.capabilities?.sizes || [];
  return declared.length ? declared : IMAGE_SIZE_FALLBACK;
}

function imageSizeLabel(value: string) {
  if (value === "auto") return "自动（由模型决定）";
  return /^\d+x\d+$/i.test(value) ? value.replace("x", " × ") : value;
}

function defaultImageSize(options: string[]) {
  if (options.includes("1024x1024")) return "1024x1024";
  return options[0] || "1024x1024";
}

/** 视频的尺寸（画面比例）、像素规格与时长同样以所选模型的声明为准。 */
function videoRatioOptions(model?: ContentModel) {
  const declared = model?.capabilities?.aspectRatios || [];
  return declared.length ? declared : VIDEO_RATIO_FALLBACK;
}

function videoResolutionOptions(model?: ContentModel) {
  const declared = model?.capabilities?.resolutions || [];
  return declared.length ? declared : VIDEO_RESOLUTION_FALLBACK;
}

function videoRatioLabel(value: string) {
  return value === "adaptive" ? "自适应" : value;
}

function videoDurationRange(model?: ContentModel) {
  const min = model?.capabilities?.minDurationSeconds ?? VIDEO_DURATION_MIN;
  const max = model?.capabilities?.maxDurationSeconds ?? VIDEO_DURATION_MAX;
  return max >= min ? { min, max } : { min: VIDEO_DURATION_MIN, max: VIDEO_DURATION_MAX };
}

function initialInput(tool: ContentTool) {
  const value: Record<string, string | number> = {};
  for (const field of tool.fields) {
    if (field.defaultValue !== undefined) value[field.key] = field.defaultValue;
    else value[field.key] = field.multiple ? "" : "";
  }
  return value;
}

/**
 * 内容创作小工具（「工作台 → 内容创作」板块下的首个入口 · 与营销工具同款）：一屏工具卡片，点卡片进入该工具。
 * 表单控件由契约里的 CONTENT_TOOLS 生成；跨境电商 / 国内电商商品页优化是独立面板，同样以卡片进入。
 * 提交即建任务，长任务轮询任务表；产物一律由后端登记进本账号的 AIPDD 数字资产。
 */
export default function ContentPage() {
  const [activeKey, setActiveKey] = useState("");
  const [pdpKey, setPdpKey] = useState<"" | "ecom-pdp" | "domestic-pdp">("");
  const [dramaOpen, setDramaOpen] = useState(false);
  const [mediaKitReady, setMediaKitReady] = useState<boolean | null>(null);

  const tools = useMemo(() => Object.values(CONTENT_TOOLS), []);
  const active = activeKey ? CONTENT_TOOLS[activeKey] : null;
  const detailOpen = Boolean(active) || Boolean(pdpKey) || dramaOpen;

  useEffect(() => {
    contentApi
      .settings()
      .then((settings) => {
        setMediaKitReady(
          Boolean(settings?.channels.some((channel) => channel.provider === "mediakit")),
        );
      })
      .catch(() => setMediaKitReady(null));
  }, []);

  const visibleTools = tools.filter((tool) => !tool.hidden && !(tool.mediaKit && mediaKitReady === false));

  return (
    <div>
      <PageHero
        title="内容创作小工具"
        desc="一个卡片一个功能：写文案、生成图片/视频、配音配乐、去水印超分；跨境电商 / 国内电商商品页优化（商品简报 → 转化诊断与理由卡 → 风格锁 → 逐张确认文案与提示词后出图，国内版按广告法合规、白底首图预留平台价格区与 logo 区）；末尾的「视频创作工具」是装在自己电脑上的外部项目，点卡片先看简介与网关配置。产物自动存进本账号的 AIPDD 数字资产；模型与 Key 在「模型服务 → 模型设置」里配置"
        extra={
          detailOpen ? (
            <Button
              icon={<ArrowLeftOutlined aria-hidden />}
              onClick={() => {
                setActiveKey("");
                setPdpKey("");
                setDramaOpen(false);
              }}
            >
              返回工具总览
            </Button>
          ) : null
        }
      />

      {!detailOpen ? (
        <>
          {mediaKitReady === false ? (
            <Notice variant="info">
              视频超分与去水印走火山 AI MediaKit：在「模型设置」里加一个 MediaKit 渠道并填 Key 后，这两张卡片就会出现。
            </Notice>
          ) : null}
          <ToolCardGrid>
            {visibleTools.map((tool) => (
              <ToolCard
                key={tool.key}
                icon={<PlayCircleOutlined aria-hidden />}
                title={tool.label}
                tag={tool.mediaKit ? <Tag>MediaKit</Tag> : null}
                description={tool.description}
                onClick={() => setActiveKey(tool.key)}
              />
            ))}
            <ToolCard
              icon={<PictureOutlined aria-hidden style={{ fontSize: 20 }} />}
              title="跨境电商商品页优化"
              description="填商品简报，AI 先做转化诊断与买家理由卡、锁定整套视觉风格，再逐张给出主图 / 详情页的图面文案与出图提示词；确认后走本系统模型网关出图，有产品参考图时锁定产品身份。"
              onClick={() => setPdpKey("ecom-pdp")}
            />
            <ToolCard
              icon={<ShopOutlined aria-hidden style={{ fontSize: 20 }} />}
              title="国内电商商品页优化"
              description="面向淘宝/天猫、京东、拼多多、抖音商城与 1688：按广告法合规做转化诊断与购买理由卡，白底首图预留平台价格区与 logo 区、图面不写价格，逐张确认中文文案后走模型网关出图。"
              onClick={() => setPdpKey("domestic-pdp")}
            />
            <ToolCard
              icon={<VideoCameraOutlined aria-hidden style={{ fontSize: 20 }} />}
              title="视频创作工具"
              tag={<Tag>本地部署</Tag>}
              description="AI 短剧与视频创作工具（AIPDD Drama Agent）：装在自己电脑上的生产线，点卡片看简介与网关配置——AIPDD / AIworkin 的 API Key 直接粘贴就能用，那一页再去下载。"
              onClick={() => setDramaOpen(true)}
            />
          </ToolCardGrid>
        </>
      ) : dramaOpen ? (
        <DramaAgentGuide />
      ) : pdpKey === "ecom-pdp" ? (
        <EcomPdpTab />
      ) : pdpKey === "domestic-pdp" ? (
        <DomesticPdpTab />
      ) : active ? (
        <ContentToolPanel tool={active} />
      ) : null}
    </div>
  );
}

function ContentToolPanel({ tool }: { tool: ContentTool }) {
  const { message } = App.useApp();
  const [input, setInput] = useState<Record<string, unknown>>(() => initialInput(tool));
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob] = useState<ContentJob | null>(null);
  const [jobs, setJobs] = useState<ContentJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [jobsError, setJobsError] = useState("");
  const [uploading, setUploading] = useState<string>("");
  // 本轮模型：先选渠道再选模型；每个功能用到的类型各一组
  const slotTypes = useMemo(
    () => Array.from(new Set(tool.slots)) as ContentMediaType[],
    [tool.slots],
  );
  const [channels, setChannels] = useState<{ value: number; label: string }[]>([]);
  const [picked, setPicked] = useState<
    Partial<Record<ContentMediaType, { channelId: number; model: string }>>
  >({});
  const [slotModels, setSlotModels] = useState<
    Partial<Record<ContentMediaType, ContentModel[]>>
  >({});
  const [modelsLoading, setModelsLoading] = useState(false);

  // 文生图的尺寸档位由所选模型声明；没选模型时先给常用兜底档
  const imageModel = picked.image
    ? (slotModels.image || []).find((item) => item.id === picked.image?.model)
    : undefined;
  const sizeOptions = useMemo(() => imageSizeOptions(imageModel), [imageModel]);
  const sizeFieldLabel = sizeOptions.some((value) => /^\d+x\d+$/i.test(value))
    ? "尺寸"
    : "分辨率";

  // 视频的尺寸 / 像素规格 / 时长：模型先行，档位随模型声明
  const videoModel = picked.video
    ? (slotModels.video || []).find((item) => item.id === picked.video?.model)
    : undefined;
  const ratioOptions = useMemo(() => videoRatioOptions(videoModel), [videoModel]);
  const resolutionOptions = useMemo(
    () => videoResolutionOptions(videoModel),
    [videoModel],
  );
  const durationRange = useMemo(() => videoDurationRange(videoModel), [videoModel]);
  const modelManagedFields =
    tool.key === "image"
      ? ["size"]
      : tool.key === "video"
        ? ["duration", "resolution", "ratio"]
        : [];

  const filterBySlot = useCallback((slot: ContentMediaType, models: ContentModel[]) => {
    if (slot === "vision") return models.filter((item) => item.vision);
    if (slot === "text") return models.filter((item) => item.kind === "text");
    return models.filter((item) => item.kind === slot);
  }, []);

  const loadSlotModels = useCallback(
    async (slot: ContentMediaType, channelId: number, preferred = "") => {
      setModelsLoading(true);
      try {
        const result = await contentApi.models({ query: { channelId } });
        const list = filterBySlot(slot, result?.models || []);
        setSlotModels((prev) => ({ ...prev, [slot]: list }));
        const model =
          preferred && list.some((item) => item.id === preferred)
            ? preferred
            : list[0]?.id || "";
        setPicked((prev) => ({ ...prev, [slot]: { channelId, model } }));
      } catch {
        setSlotModels((prev) => ({ ...prev, [slot]: [] }));
        setPicked((prev) => ({ ...prev, [slot]: { channelId, model: "" } }));
      } finally {
        setModelsLoading(false);
      }
    },
    [filterBySlot],
  );

  useEffect(() => {
    if (!slotTypes.length) return;
    void (async () => {
      try {
        const settings = await contentApi.settings();
        if (!settings) return;
        setChannels(
          settings.channels.map((item) => ({
            value: item.id,
            label: item.id === 0 ? `${item.name}（内置）` : item.name,
          })),
        );
        for (const slot of slotTypes) {
          const saved = settings.slots.find((item) => item.mediaType === slot);
          await loadSlotModels(slot, saved?.channelId ?? 0, saved?.model || "");
        }
      } catch {
        // 读不到模型清单时保留空选择，提交会被拦下
      }
    })();
  }, [slotTypes, loadSlotModels]);

  const loadJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const result = await contentApi.jobs({ query: { page: 1, pageSize: 20, tool: tool.key } });
      setJobs(result?.list || []);
      setJobsError("");
    } catch (caught) {
      setJobsError((caught as Error).message || "任务列表加载失败");
    } finally {
      setLoadingJobs(false);
    }
  }, [tool.key]);

  useEffect(() => {
    setInput(initialInput(tool));
    setJob(null);
    void loadJobs();
  }, [tool, loadJobs]);

  // 换模型后若原尺寸不在该模型的可选档位里，自动落到默认档
  useEffect(() => {
    if (tool.key !== "image") return;
    setInput((prev) => {
      const current = String(prev.size || "");
      if (sizeOptions.includes(current)) return prev;
      return { ...prev, size: defaultImageSize(sizeOptions) };
    });
  }, [tool.key, sizeOptions]);

  // 视频同理：换模型后尺寸 / 像素规格 / 时长越界时落到该模型支持的档位
  useEffect(() => {
    if (tool.key !== "video") return;
    setInput((prev) => {
      const next = { ...prev };
      let changed = false;
      const ratio = String(prev.ratio || "");
      if (!ratioOptions.includes(ratio)) {
        next.ratio = ratioOptions.includes("16:9")
          ? "16:9"
          : ratioOptions[0] || "16:9";
        changed = true;
      }
      const resolution = String(prev.resolution || "");
      if (!resolutionOptions.includes(resolution)) {
        next.resolution = resolutionOptions.includes("720p")
          ? "720p"
          : resolutionOptions[0] || "720p";
        changed = true;
      }
      const duration = Number(prev.duration);
      if (
        !Number.isFinite(duration) ||
        duration < durationRange.min ||
        duration > durationRange.max
      ) {
        next.duration = Math.min(
          durationRange.max,
          Math.max(durationRange.min, Number.isFinite(duration) ? duration : 5),
        );
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [tool.key, ratioOptions, resolutionOptions, durationRange]);

  // 任务未结束时每 3 秒读一次详情；job 每次更新都会重排下一轮，终态自动停。
  useEffect(() => {
    if (!job || TERMINAL.has(job.status)) return;
    const timer = window.setTimeout(async () => {
      try {
        const latest = await contentApi.job({ params: { id: String(job.id) } });
        if (!latest) return;
        setJob(latest);
        if (TERMINAL.has(latest.status)) {
          void loadJobs();
          if (latest.status === "SUCCESS") message.success("生成完成，已存入数字资产");
        }
      } catch {
        // 单轮失败也继续轮询：换一个对象引用触发下一轮
        setJob((prev) => (prev ? { ...prev } : prev));
      }
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [job, loadJobs, message]);

  const upload = async (field: ContentField, file: File) => {
    setUploading(field.key);
    try {
      const result = await uploadContentMedia(file);
      setInput((prev) => {
        if (!field.multiple) return { ...prev, [field.key]: result.url };
        const existing = String(prev[field.key] || "")
          .split("\n")
          .filter(Boolean);
        return { ...prev, [field.key]: [...existing, result.url].join("\n") };
      });
    } catch (caught) {
      message.error((caught as Error).message || "上传失败");
    } finally {
      setUploading("");
    }
  };

  const cancel = async (id: number) => {
    try {
      const updated = await contentApi.cancelJob({ params: { id: String(id) } });
      if (updated) setJob(updated);
      void loadJobs();
    } catch (caught) {
      message.error((caught as Error).message || "取消失败");
    }
  };

  const missingModel = slotTypes.some((slot) => !picked[slot]?.model);
  const missingVideoSpec =
    tool.key === "video" &&
    (!String(input.ratio || "").trim() ||
      !String(input.resolution || "").trim());

  const submit = async () => {
    if (missingModel) {
      message.warning("请先为这个功能选好渠道和模型");
      return;
    }
    if (missingVideoSpec) {
      message.warning("请先选择尺寸和像素规格");
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const field of tool.fields) {
        const raw = input[field.key];
        if (field.type === "media") {
          const urls = String(raw || "")
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean);
          payload[field.key] = field.multiple ? urls : (urls[0] || "");
          continue;
        }
        payload[field.key] = raw;
      }
      const models: Record<string, { channelId: number; model: string }> = {};
      for (const slot of slotTypes) {
        const choice = picked[slot];
        if (choice?.model) models[slot] = choice;
      }
      const created = await contentApi.createJob({
        body: { tool: tool.key, input: payload, models },
      });
      if (!created) throw new Error("任务创建失败");
      setJob(created);
      void loadJobs();
      if (created.status === "SUCCESS") message.success("生成完成，已存入数字资产");
    } catch (caught) {
      message.error((caught as Error).message || "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel
        title={tool.label}
        titleExtra={<span className="text-12 muted">{tool.description}</span>}
      >
        <div style={{ display: "grid", gap: 12, maxWidth: 760 }}>
          {tool.fields
            .filter((field) => !modelManagedFields.includes(field.key))
            .map((field) => (
            <div key={field.key} style={{ display: "grid", gap: 6 }}>
              <span className="text-12 muted">
                {field.label}
                {field.required ? <span style={{ color: "#ff4d4f" }}> *</span> : null}
              </span>
              {field.type === "textarea" ? (
                <Input.TextArea
                  value={String(input[field.key] || "")}
                  autoSize={{ minRows: 3, maxRows: 8 }}
                  placeholder={field.placeholder}
                  onChange={(event) =>
                    setInput((prev) => ({ ...prev, [field.key]: event.target.value }))
                  }
                />
              ) : field.type === "select" ? (
                <Select
                  value={String(input[field.key] || "") || undefined}
                  options={field.options}
                  placeholder="请选择"
                  style={{ maxWidth: 320 }}
                  onChange={(value) => setInput((prev) => ({ ...prev, [field.key]: value }))}
                />
              ) : field.type === "number" ? (
                <InputNumber
                  value={Number(input[field.key] ?? 0) || undefined}
                  min={field.min}
                  max={field.max}
                  style={{ width: 200 }}
                  onChange={(value) => setInput((prev) => ({ ...prev, [field.key]: value ?? "" }))}
                />
              ) : field.type === "media" ? (
                <div style={{ display: "grid", gap: 6 }}>
                  <Upload
                    accept={ACCEPT_BY_KIND[field.mediaKind || "image"]}
                    showUploadList={false}
                    beforeUpload={(file) => {
                      void upload(field, file as File);
                      return false;
                    }}
                  >
                    <Button
                      icon={<InboxOutlined aria-hidden />}
                      loading={uploading === field.key}
                    >
                      上传{field.mediaKind === "video" ? "视频" : field.mediaKind === "audio" ? "音频" : "图片"}
                      {field.multiple ? "（可多次上传）" : ""}
                    </Button>
                  </Upload>
                  <Input.TextArea
                    value={String(input[field.key] || "")}
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    placeholder="上传后自动填入直链；也可直接粘贴公网地址（多条换行）"
                    onChange={(event) =>
                      setInput((prev) => ({ ...prev, [field.key]: event.target.value }))
                    }
                  />
                </div>
              ) : (
                <Input
                  value={String(input[field.key] || "")}
                  placeholder={field.placeholder}
                  style={{ maxWidth: 420 }}
                  onChange={(event) =>
                    setInput((prev) => ({ ...prev, [field.key]: event.target.value }))
                  }
                />
              )}
              {field.help ? <span className="text-12 muted">{field.help}</span> : null}
            </div>
          ))}

          {slotTypes.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              <span className="text-12 muted">
                模型（先选渠道，再选模型；默认取「模型设置」里的槽位）
              </span>
              {slotTypes.map((slot) => {
                const choice = picked[slot];
                const list = slotModels[slot] || [];
                return (
                  <div
                    key={slot}
                    style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                  >
                    <span style={{ width: 84 }}>{CONTENT_MEDIA_TYPE_LABELS[slot]}</span>
                    <Select
                      style={{ width: 200 }}
                      value={choice?.channelId ?? undefined}
                      placeholder="选择渠道"
                      options={channels}
                      onChange={(value: number) => void loadSlotModels(slot, value)}
                    />
                    <Select
                      style={{ width: 240 }}
                      value={choice?.model || undefined}
                      placeholder={
                        modelsLoading
                          ? "正在读取模型…"
                          : list.length
                            ? "选择模型"
                            : "该渠道没有可用模型"
                      }
                      options={list.map((item) => ({ value: item.id, label: item.id }))}
                      loading={modelsLoading}
                      disabled={!list.length}
                      showSearch
                      onChange={(value: string) =>
                        setPicked((prev) => ({
                          ...prev,
                          [slot]: { channelId: choice?.channelId ?? 0, model: value },
                        }))
                      }
                    />
                    {!modelsLoading && !list.length ? (
                      <Link
                        href="/model-settings"
                        className="text-12"
                        style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        <SettingOutlined aria-hidden />
                        立即配置模型
                      </Link>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {tool.key === "image" ? (
            <div style={{ display: "grid", gap: 6 }}>
              <span className="text-12 muted">
                {sizeFieldLabel}（可选项随所选模型变化）
              </span>
              <Select
                style={{ maxWidth: 320 }}
                value={String(input.size || "") || undefined}
                options={sizeOptions.map((value) => ({
                  value,
                  label: imageSizeLabel(value),
                }))}
                showSearch
                optionFilterProp="label"
                onChange={(value) =>
                  setInput((prev) => ({ ...prev, size: value }))
                }
              />
              <span className="text-12 muted">
                选「自动」由模型决定输出尺寸；显式尺寸按所选模型声明的档位校验。
              </span>
            </div>
          ) : null}

          {tool.key === "video" ? (
            <div style={{ display: "grid", gap: 6 }}>
              <span className="text-12 muted">
                尺寸与像素规格（可选项随所选模型变化；先选上面的渠道和模型）
              </span>
              <span className="text-12 muted">尺寸（画面比例）</span>
              <Select
                style={{ maxWidth: 320 }}
                value={String(input.ratio || "") || undefined}
                options={ratioOptions.map((value) => ({
                  value,
                  label: videoRatioLabel(value),
                }))}
                disabled={!picked.video?.model}
                onChange={(value) =>
                  setInput((prev) => ({ ...prev, ratio: value }))
                }
              />
              <span className="text-12 muted">像素规格（分辨率）</span>
              <Select
                style={{ maxWidth: 320 }}
                value={String(input.resolution || "") || undefined}
                options={resolutionOptions.map((value) => ({
                  value,
                  label: value,
                }))}
                disabled={!picked.video?.model}
                onChange={(value) =>
                  setInput((prev) => ({ ...prev, resolution: value }))
                }
              />
              <span className="text-12 muted">时长（秒）</span>
              <InputNumber
                value={Number(input.duration ?? 0) || undefined}
                min={durationRange.min}
                max={durationRange.max}
                style={{ width: 200 }}
                disabled={!picked.video?.model}
                onChange={(value) =>
                  setInput((prev) => ({ ...prev, duration: value ?? "" }))
                }
              />
              <span className="text-12 muted">
                尺寸、像素规格与时长都按所选模型声明的范围校验；模型未选好前不可调整。
              </span>
            </div>
          ) : null}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Button
              type="primary"
              loading={submitting}
              disabled={missingModel || missingVideoSpec}
              onClick={() => void submit()}
            >
              开始生成
            </Button>
          </div>
        </div>
      </Panel>

      {job ? (
        <Panel
          title="本次结果"
          titleExtra={
            <span className="text-12 muted">
              <Tag color={STATUS_COLOR[job.status] || "default"}>
                {STATUS_LABEL[job.status] || job.status}
              </Tag>
              {job.aipddAssetId ? "已存入 AIPDD 数字资产" : ""}
            </span>
          }
        >
          {job.status === "FAILED" ? (
            <Notice variant="error">{job.error || "生成失败"}</Notice>
          ) : null}
          {job.status === "RUNNING" || job.status === "PENDING" ? (
            <Notice variant="info">
              生成中…视频与超分可能需要几分钟到几十分钟，可以先去别的页面，回来在这里看结果
            </Notice>
          ) : null}
          {job.status === "SUCCESS" ? <JobResult job={job} /> : null}
        </Panel>
      ) : null}

      <Panel
        title="最近任务"
        extra={
          <Button
            icon={<ReloadOutlined aria-hidden />}
            onClick={() => void loadJobs()}
          >
            刷新
          </Button>
        }
      >
        {jobsError ? <Notice variant="error">{jobsError}</Notice> : null}
        {loadingJobs ? <Skeleton active paragraph={{ rows: 3 }} /> : null}
        {!loadingJobs && !jobs.length ? <Empty description="还没有任务记录" /> : null}
        {!loadingJobs && jobs.length ? (
          <div style={{ display: "grid", gap: 10 }}>
            {jobs.map((item) => (
              <div
                key={item.id}
                style={{
                  border: "1px solid var(--line, #f0f0f0)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  display: "grid",
                  gap: 6,
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Tag color={STATUS_COLOR[item.status] || "default"}>
                    {STATUS_LABEL[item.status] || item.status}
                  </Tag>
                  <span className="text-12 muted">{item.createdAt.replace("T", " ").slice(0, 16)}</span>
                  {item.aipddAssetId ? <Tag color="success">数字资产</Tag> : null}
                </div>
                {item.status === "FAILED" ? (
                  <span className="text-12" style={{ color: "#ff4d4f" }}>{item.error}</span>
                ) : item.status === "SUCCESS" ? (
                  <JobResult job={item} compact />
                ) : item.status === "PENDING" ? (
                  <div>
                    <Button onClick={() => void cancel(item.id)}>
                      取消排队
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function JobResult({ job, compact }: { job: ContentJob; compact?: boolean }) {
  const output = (job.output || {}) as Record<string, unknown>;
  const url = String(output.url || job.assetUrl || "");
  const text = String(output.text || "");
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {url && /\.(mp4|mov|webm)(\?|$)/i.test(url) ? (
        <video
          src={url}
          controls
          style={{ maxWidth: compact ? 320 : 560, borderRadius: 8 }}
        />
      ) : url && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url) ? (
        <RawImg src={url} alt="生成结果" style={{ maxWidth: compact ? 200 : 480, borderRadius: 8 }} />
      ) : url && /\.(mp3|wav|m4a)(\?|$)/i.test(url) ? (
        <audio src={url} controls style={{ width: compact ? 320 : 480 }} />
      ) : null}
      {text ? (
        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, maxHeight: compact ? 160 : undefined, overflow: "auto" }}>
          {text}
        </div>
      ) : null}
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="text-12">
          打开原文件
        </a>
      ) : null}
      {!url && !text ? <span className="text-12 muted">任务没有返回内容</span> : null}
    </div>
  );
}