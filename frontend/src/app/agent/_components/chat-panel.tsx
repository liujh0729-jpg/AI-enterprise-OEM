"use client";

import {
  ApiOutlined,
  ArrowLeftOutlined,
  BlockOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  FileAddOutlined,
  InfoCircleOutlined,
  KeyOutlined,
  LoadingOutlined,
  PaperClipOutlined,
  PayCircleOutlined,
  PictureOutlined,
  PlusOutlined,
  ReadOutlined,
  RightOutlined,
  RobotOutlined,
  SendOutlined,
  SettingOutlined,
  StopOutlined,
  TeamOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Checkbox,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Popover,
  Select,
  Spin,
  Switch,
  Tag,
} from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CONTENT_AGENT_MODE_LABELS,
  MCP_TOOL_NAMES,
  MCP_TOOLS,
  type ContentAgentConnector,
  type ContentAgentExpert,
  type ContentAgentMessage,
  type ContentAgentMode,
  type ContentAgentPlugin,
  type ContentAgentReference,
  type ContentAgentSkill,
  type ContentAgentPersona,
  type ContentConversation,
  type ContentLibraryItem,
} from "@enterprise/contracts";
import {
  cancelAgentMessage,
  contentApi,
  streamAgentMessage,
  uploadContentMedia,
} from "@/api/content";
import { Notice, Panel } from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";
import {
  AssetReferencePicker,
  REFERENCE_MEDIA_LABEL,
  nextReferenceLabel,
  referencesFromAssets,
} from "@/components/content/asset-reference-picker";

type ToolLine = { name: string; state: "running" | "ok" | "failed"; text?: string };
/** 「自动」时模型会在首行标注本轮选的分身；拆出来单独显示成徽标，正文不重复。 */
function splitPersonaMarker(content: string): { persona: string; body: string } {
  const match = content.match(/^\s*【分身[：:]\s*([^】\n]{1,30})】\s*\n?/);
  if (!match) return { persona: "", body: content };
  return { persona: match[1].trim(), body: content.slice(match[0].length) };
}
type MediaItem = { kind: string; url: string };
type UiMessage = {
  key: string;
  role: "user" | "assistant";
  content: string;
  references: ContentAgentReference[];
  toolLines: ToolLine[];
  media: MediaItem[];
  notices: string[];
  createdAt?: string;
  failed?: boolean;
  /** 用户点「停止」中断的那一轮：既不当作失败，也不再冒充正常回复 */
  canceled?: boolean;
};

/** 工具名按内置工具转成中文；内置 MCP（c0）用契约里的中文工具名，外部 MCP 保留远端工具名。 */
const TOOL_LABELS: Record<string, string> = {
  generate_image: "生成图片",
  generate_video: "生成视频",
  generate_music: "生成音乐",
  transcribe_audio: "语音识别",
  save_memory: "写入记忆",
  list_assets: "查看数字资产",
  load_skill: "读取技能",
  search_library: "检索资料",
  read_library: "精读资料",
  propose_library_edit: "起草改写",
  publish_to_library: "回流资料库",
  save_to_kb: "沉淀到知识库",
};

/** 本站 MCP Server 的六个元工具：名字仍是标识符，界面上按契约标题显示。 */
const BUILTIN_MCP_TITLES: Record<string, string> = Object.fromEntries(
  MCP_TOOL_NAMES.map((name) => [name, MCP_TOOLS[name].title]),
);

function toolLabel(name: string) {
  const builtin = TOOL_LABELS[name];
  if (builtin) return builtin;
  const remote = /^mcp__c(\d+)__(.+)$/.exec(name);
  if (!remote) return name;
  const title = remote[1] === "0" ? BUILTIN_MCP_TITLES[remote[2]] : undefined;
  return `MCP · ${title || remote[2]}`;
}

/** 消息时间只显示「时:分」，同一天内的对话不重复年月日。 */
function clockLabel(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** 模型回复里常把产物地址直接贴出来：只把 http(s) 段渲染成链接，其余仍按纯文本显示。 */
const URL_SPLIT = /(https?:\/\/[^\s<>()"'，。；]+)/g;

function renderRichText(text: string) {
  return text.split(URL_SPLIT).map((segment, index) =>
    /^https?:\/\//.test(segment) ? (
      <a key={index} className="agent-link" href={segment} target="_blank" rel="noreferrer">
        {segment}
      </a>
    ) : (
      <span key={index}>{segment}</span>
    ),
  );
}

const AGENT_MODES: ContentAgentMode[] = ["text", "image", "video"];
/** 每个模式对应的模型类型：图片模式只列图片模型、视频模式只列视频模型 */
const MODEL_KINDS: Record<ContentAgentMode, string> = {
  text: "text",
  image: "image",
  video: "video",
};
const MODEL_KIND_LABELS: Record<ContentAgentMode, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
};
/** 视频模式勾「超清」后的目标分辨率；MediaKit 生成式超分认这四档 */
const UPSCALE_RESOLUTIONS = ["1080p", "2k", "4k"];
const IMAGE_SIZE_FALLBACK = ["1024x1024", "1024x1536", "1536x1024"];
/** 上游没声明时长范围（自定义渠道）时的兜底区间 */
const VIDEO_DURATION_MIN = 1;
const VIDEO_DURATION_MAX = 30;
const VIDEO_DURATION_DEFAULT = 5;

/** 图片尺寸、视频分辨率与时长都只认所选模型在上游 /models 里声明的能力：写死的档位（如 720p）会被网关判为无效。 */
type ModelOption = {
  value: string;
  label: string;
  sizes: string[];
  resolutions: string[];
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
};
type ModeSelection = { channelId: number; model: string };

const emptySelections = (): Record<ContentAgentMode, ModeSelection> => ({
  text: { channelId: 0, model: "" },
  image: { channelId: 0, model: "" },
  video: { channelId: 0, model: "" },
});

function readReferences(value: unknown): ContentAgentReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const media = String(row.media || "");
    if (!["image", "video", "audio"].includes(media)) return [];
    return [
      {
        label: String(row.label || ""),
        fileName: String(row.fileName || ""),
        url: String(row.url || ""),
        media: media as ContentAgentReference["media"],
      },
    ];
  });
}

function fromServer(row: ContentAgentMessage): UiMessage {
  const tools = Array.isArray(row.toolCalls)
    ? (row.toolCalls as { name?: string; text?: string; ok?: boolean }[])
    : [];
  const media = Array.isArray(row.media)
    ? (row.media as { kind?: string; url?: string }[])
    : [];
  return {
    key: `m-${row.id}`,
    role: row.role === "user" ? "user" : "assistant",
    content: row.content,
    references: readReferences(row.references),
    toolLines: tools.map((item) => ({
      name: String(item.name || "工具"),
      state: item.ok === false ? "failed" : "ok",
      text: item.text,
    })),
    media: media
      .filter((item) => item.url)
      .map((item) => ({ kind: String(item.kind || "image"), url: String(item.url) })),
    notices: [],
    createdAt: row.createdAt,
    // 取消（已中断）是用户自己停的，不当作失败
    failed: row.status === "failed",
    canceled: row.status === "canceled",
  };
}

/**
 * 从会话消息里挑出「这一轮」的助手发言：本轮用户消息之后、下一条用户消息之前。
 * 同一会话可以并发多轮，也可能有内容完全相同的重复提问，所以按水位 id 定位本轮。
 */
function pickTurnResult(
  rows: ContentAgentMessage[],
  afterId: number,
  sentContent: string,
) {
  const mine = rows.find(
    (row) => row.role === "user" && row.id > afterId && row.content === sentContent,
  );
  const nextUser = mine
    ? rows.find((row) => row.role === "user" && row.id > mine.id)
    : undefined;
  const done = rows.filter(
    (row) =>
      row.role !== "user" &&
      row.id > (mine?.id ?? afterId) &&
      (!nextUser || row.id < nextUser.id),
  );
  return done[done.length - 1];
}

type AddPanel =
  | "root"
  | "references"
  | "skills"
  | "plugins"
  | "experts"
  | "library"
  | "connectors";

const ADD_PANEL_TITLES: Record<Exclude<AddPanel, "root">, string> = {
  references: "添加参考文件",
  skills: "选择技能",
  plugins: "选择插件",
  experts: "选择专家",
  library: "选择资料",
  connectors: "选择 MCP 连接器",
};

const ADD_ROW_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "7px 8px",
  border: "none",
  borderRadius: 8,
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  textAlign: "left",
  fontSize: 13,
};

/** 「+」浮层的一行：图标 + 名称 + 右侧当前值；带 chevron 的进入下一级。 */
function AddRow({
  icon,
  label,
  meta,
  chevron,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
  chevron?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{ ...ADD_ROW_STYLE, opacity: disabled ? 0.5 : 1 }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = "rgba(0,0,0,0.04)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ display: "flex", color: "#8c8c8c" }}>{icon}</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      {meta ? (
        <span
          className="text-12 muted"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            minWidth: 0,
            maxWidth: 132,
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {meta}
          </span>
          {chevron ? <RightOutlined style={{ fontSize: 9 }} aria-hidden /> : null}
        </span>
      ) : null}
    </button>
  );
}

/** 浮层的二级面板：左上角返回 + 标题。 */
function AddSubPanel({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <Button type="text" icon={<ArrowLeftOutlined aria-hidden />} aria-label="返回" onClick={onBack} />
        <strong style={{ fontSize: 13 }}>{title}</strong>
      </div>
      {children}
    </div>
  );
}

/**
 * Agent 对话：左侧会话列表 + 右侧消息流。
 * 流式事件来自后端 SSE（delta / tool_start / tool_end / notice / done / error）；
 * 生成结果同时已自动登记进 AIPDD 数字资产，媒体卡里给出地址。
 * `expertToUse` 来自「专家」页签：带专家新建会话并切过来，用完回调清空。
 * `conversationToOpen` 来自「定时任务」执行记录：直接打开那条任务的结果会话。
 */
export function AgentChatPanel({
  expertToUse,
  onExpertConsumed,
  conversationToOpen,
  onConversationOpened,
}: {
  expertToUse?: ContentAgentExpert | null;
  onExpertConsumed?: () => void;
  conversationToOpen?: number | null;
  onConversationOpened?: () => void;
} = {}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [conversations, setConversations] = useState<ContentConversation[]>([]);
  const [personas, setPersonas] = useState<ContentAgentPersona[]>([]);
  /** 多分身协作：2–3 个分身各起草一份、互相评审，最后由第一位汇总 */
  const [collaborate, setCollaborate] = useState(false);
  const [collaborateIds, setCollaborateIds] = useState<number[]>([]);
  const [activeId, setActiveId] = useState(0);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  /** 在跑的轮次（气泡 key）：同一会话可以并发多轮，「停止」按气泡停对应那一轮 */
  const [runningKeys, setRunningKeys] = useState<string[]>([]);
  /** 每轮开始的时间：连接被代理收掉时收不到进度事件，至少让「已等待 N 秒」自己走 */
  const [runStartedAt, setRunStartedAt] = useState<Record<string, number>>({});
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [renaming, setRenaming] = useState<ContentConversation | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [channels, setChannels] = useState<{ value: number; label: string }[]>([]);
  // 先选渠道再选模型：文本 / 图片 / 视频各自记住自己的渠道与模型，切模式不互相覆盖
  const [selections, setSelections] =
    useState<Record<ContentAgentMode, ModeSelection>>(emptySelections);
  const [slotDefaults, setSlotDefaults] =
    useState<Record<ContentAgentMode, ModeSelection>>(emptySelections);
  const [modelsByMode, setModelsByMode] = useState<Record<ContentAgentMode, ModelOption[]>>({
    text: [],
    image: [],
    video: [],
  });
  const [loadingModelMode, setLoadingModelMode] = useState<ContentAgentMode | null>(null);
  const [modelsError, setModelsError] = useState("");
  const [mode, setMode] = useState<ContentAgentMode>("text");
  const [references, setReferences] = useState<ContentAgentReference[]>([]);
  const [uploading, setUploading] = useState(false);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [imageSize, setImageSize] = useState(IMAGE_SIZE_FALLBACK[0]);
  const [videoResolution, setVideoResolution] = useState("");
  const [videoDuration, setVideoDuration] = useState(VIDEO_DURATION_DEFAULT);
  const [upscale, setUpscale] = useState(false);
  const [upscaleResolution, setUpscaleResolution] = useState(UPSCALE_RESOLUTIONS[0]);
  // 「+」浮层：模型设置 / 添加参考文件 / 选择技能 / 选择插件 / 选择专家（模型选择直接摆在输入框下方）
  const [addOpen, setAddOpen] = useState(false);
  const [addPanel, setAddPanel] = useState<AddPanel>("root");
  /** 从数字资产管理挑参考文件的弹窗 */
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [skills, setSkills] = useState<ContentAgentSkill[]>([]);
  const [plugins, setPlugins] = useState<ContentAgentPlugin[]>([]);
  const [experts, setExperts] = useState<ContentAgentExpert[]>([]);
  const [library, setLibrary] = useState<ContentLibraryItem[]>([]);
  const [connectors, setConnectors] = useState<ContentAgentConnector[]>([]);
  const [auxLoading, setAuxLoading] = useState(false);
  const [auxError, setAuxError] = useState("");
  /** 本轮勾选的技能；空＝全部启用中的技能 */
  const [skillIds, setSkillIds] = useState<number[]>([]);
  /** 本轮勾选的插件；空＝全部启用中的插件 */
  const [pluginIds, setPluginIds] = useState<number[]>([]);
  /** 本轮指定的资料；空＝整库检索 */
  const [libraryIds, setLibraryIds] = useState<number[]>([]);
  /** 本轮引用的 MCP 连接器；空＝全部启用中的 */
  const [connectorIds, setConnectorIds] = useState<number[]>([]);
  const [switchingExpert, setSwitchingExpert] = useState(false);
  const auxLoadedRef = useRef(false);
  const loadedModesRef = useRef(new Set<ContentAgentMode>());
  /** 气泡 key → 这一轮的服务端 runId 与本地断流控制器 */
  const runsRef = useRef(
    new Map<string, { runId: string; conversationId: number; controller: AbortController }>(),
  );
  /** 有任意一轮在跑就锁定会话切换，避免消息流串到别的会话里 */
  const streaming = runningKeys.length > 0;
  const bottomRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const composerHeightRef = useRef(0);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<TextAreaRef>(null);
  // 输入区是浮层：左边界/宽度跟着「会话 + 对话」整行的实际位置走，高度用于给两栏留出底部空位
  const [composerBox, setComposerBox] = useState<{ left: number; width: number } | null>(null);
  const [composerHeight, setComposerHeight] = useState(0);

  /** 视频分辨率档位：取当前视频模型在网关声明的 supportedResolutions，没声明就不给选、也不发提示。 */
  const videoResolutionOptions = useMemo(() => {
    const picked = modelsByMode.video.find(
      (item) => item.value === selections.video.model,
    );
    return picked?.resolutions || [];
  }, [modelsByMode.video, selections.video.model]);

  useEffect(() => {
    if (!videoResolutionOptions.length) {
      if (videoResolution) setVideoResolution("");
      return;
    }
    if (!videoResolutionOptions.includes(videoResolution)) {
      setVideoResolution(videoResolutionOptions[0]);
    }
  }, [videoResolutionOptions, videoResolution]);

  /** 视频时长同理：取所选视频模型声明的 min/maxDurationSeconds，用户在这个区间里填秒数。 */
  const videoDurationRange = useMemo(() => {
    const picked = modelsByMode.video.find(
      (item) => item.value === selections.video.model,
    );
    const min = picked?.minDurationSeconds ?? VIDEO_DURATION_MIN;
    const max = picked?.maxDurationSeconds ?? VIDEO_DURATION_MAX;
    return max >= min ? { min, max } : { min: VIDEO_DURATION_MIN, max: VIDEO_DURATION_MAX };
  }, [modelsByMode.video, selections.video.model]);

  useEffect(() => {
    setVideoDuration((prev) =>
      Math.min(videoDurationRange.max, Math.max(videoDurationRange.min, prev)),
    );
  }, [videoDurationRange]);

  /** 图片尺寸同理：模型声明了 sizes 就用声明的，没声明才退回常用三档。 */
  const imageSizeOptions = useMemo(() => {
    const picked = modelsByMode.image.find((item) => item.value === selections.image.model);
    return picked?.sizes.length ? picked.sizes : IMAGE_SIZE_FALLBACK;
  }, [modelsByMode.image, selections.image.model]);

  useEffect(() => {
    if (!imageSizeOptions.includes(imageSize)) setImageSize(imageSizeOptions[0]);
  }, [imageSizeOptions, imageSize]);

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

  const loadConversations = useCallback(async (selectId?: number) => {
    try {
      const rows = (await contentApi.conversations()) || [];
      setConversations(rows);
      const next = selectId || rows[0]?.id || 0;
      setActiveId(next);
      return next;
    } catch (caught) {
      setError((caught as Error).message || "会话列表加载失败");
      return 0;
    } finally {
      setLoading(false);
    }
  }, []);

  const openConversation = useCallback(async (id: number) => {
    if (!id) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    try {
      const rows = (await contentApi.messages({ params: { id: String(id) } })) || [];
      setMessages(rows.map(fromServer));
      setError("");
    } catch (caught) {
      setError((caught as Error).message || "对话记录加载失败");
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  /** 先选渠道再选模型：只列这个模式对应类型的模型；渠道＝槽位时优先用槽位默认模型。 */
  const loadChannelModels = useCallback(
    async (targetMode: ContentAgentMode, nextChannelId: number, preferred: ModeSelection) => {
      const kind = MODEL_KINDS[targetMode];
      const label = MODEL_KIND_LABELS[targetMode];
      setLoadingModelMode(targetMode);
      setModelsByMode((prev) => ({ ...prev, [targetMode]: [] }));
      setModelsError("");
      try {
        const result = await contentApi.models({ query: { channelId: nextChannelId } });
        const list = (result?.models || [])
          .filter((item) => item.kind === kind)
          .map((item) => ({
            value: item.id,
            label: item.id,
            sizes: item.capabilities?.sizes || [],
            resolutions: item.capabilities?.resolutions || [],
            minDurationSeconds: item.capabilities?.minDurationSeconds,
            maxDurationSeconds: item.capabilities?.maxDurationSeconds,
          }));
        setModelsByMode((prev) => ({ ...prev, [targetMode]: list }));
        const picked =
          nextChannelId === preferred.channelId && list.some((item) => item.value === preferred.model)
            ? preferred.model
            : list[0]?.value || "";
        setSelections((prev) => ({
          ...prev,
          [targetMode]: { channelId: nextChannelId, model: picked },
        }));
        setModelsError("");
      } catch {
        setSelections((prev) => ({
          ...prev,
          [targetMode]: { channelId: nextChannelId, model: "" },
        }));
        setModelsError(
          nextChannelId === 0
            ? `当前登录账号还没有可用的 API Key，取不到${label}模型清单：请先到「API Key 管理」生成一把 sk- Key`
            : `这个渠道的${label}模型清单读取失败：请到「模型设置」检查渠道地址与 Key`,
        );
      } finally {
        loadedModesRef.current.add(targetMode);
        setLoadingModelMode((prev) => (prev === targetMode ? null : prev));
      }
    },
    [],
  );

  useEffect(() => {
    void loadConversations(conversationToOpen ?? undefined).then((id) => {
      if (id) void openConversation(id);
      // 定时任务指定的会话只消费一次，之后切页签仍走「最近一条会话」
      if (conversationToOpen) onConversationOpened?.();
    });
    // 渠道清单来自「模型设置」；每个模式的默认渠道/模型取同类型槽位
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
        const defaults = emptySelections();
        for (const key of AGENT_MODES) {
          const slot = settings.slots.find((item) => item.mediaType === key);
          defaults[key] = { channelId: slot?.channelId ?? 0, model: slot?.model || "" };
        }
        setSlotDefaults(defaults);
        setSelections(defaults);
        await loadChannelModels("text", defaults.text.channelId, defaults.text);
      } catch {
        // 读不到模型清单时仍可输入，发送前会提示先选模型
      }
    })();
  }, [
    conversationToOpen,
    onConversationOpened,
    loadConversations,
    openConversation,
    loadChannelModels,
  ]);

  /** 切模式：带上这个模式自己的渠道与模型；第一次切到该模式时才去拉它的模型清单。 */
  const switchMode = (next: ContentAgentMode) => {
    if (next === mode) return;
    setMode(next);
    setModelsError("");
    if (!loadedModesRef.current.has(next)) {
      void loadChannelModels(next, selections[next].channelId, slotDefaults[next]);
    }
  };

  /** 「+」浮层里的技能、插件、专家与资料清单：第一次打开时取一次，取不到只影响这几个二级面板。 */
  const loadAux = useCallback(async () => {
    setAuxLoading(true);
    try {
      const [skillRows, pluginRows, expertRows, libraryRows, connectorRows] =
        await Promise.all([
          contentApi.skills(),
          contentApi.plugins(),
          contentApi.experts(),
          contentApi.library(),
          contentApi.connectors(),
        ]);
      setSkills(skillRows || []);
      setPlugins(pluginRows || []);
      setExperts(expertRows || []);
      setLibrary(libraryRows || []);
      setConnectors(connectorRows || []);
      setAuxError("");
      auxLoadedRef.current = true;
    } catch (caught) {
      setAuxError((caught as Error).message || "技能、插件、专家与连接器清单读取失败");
    } finally {
      setAuxLoading(false);
    }
  }, []);

  const changeAddOpen = (open: boolean) => {
    setAddOpen(open);
    setAddPanel("root");
    if (open && !auxLoadedRef.current && !auxLoading) void loadAux();
  };

  /** 数字分身清单：对话区平铺选择器用；0＝自动（按每轮语义自选）。 */
  useEffect(() => {
    void contentApi
      .personas()
      .then((rows) => setPersonas(rows || []))
      .catch(() => setPersonas([]));
  }, []);

  /** 选择分身写进会话：之后每轮都按它沟通，直到用户再切；0＝自动。 */
  const applyPersona = async (personaId: number) => {
    try {
      if (!activeId) {
        const row = await contentApi.createConversation({ body: { personaId } });
        if (!row) throw new Error("创建会话失败");
        setConversations((prev) => [row, ...prev]);
        setActiveId(row.id);
        setMessages([]);
      } else {
        const row = await contentApi.updateConversation({
          params: { id: String(activeId) },
          body: { personaId },
        });
        if (!row) throw new Error("切换数字分身失败");
        setConversations((prev) =>
          prev.map((item) => (item.id === row.id ? row : item)),
        );
      }
    } catch (caught) {
      message.error((caught as Error).message || "切换数字分身失败");
    }
  };

  /** 「+ → 选择专家」：整个会话按这位专家作答；0＝取消专家。还没有会话时先建一个。 */
  const applyExpert = async (expertId: number) => {
    if (switchingExpert) return;
    setSwitchingExpert(true);
    try {
      if (!activeId) {
        const row = await contentApi.createConversation({ body: { expertId } });
        if (!row) throw new Error("创建会话失败");
        setConversations((prev) => [row, ...prev]);
        setActiveId(row.id);
        setMessages([]);
      } else {
        const row = await contentApi.updateConversation({
          params: { id: String(activeId) },
          body: { expertId },
        });
        if (!row) throw new Error("切换专家失败");
        setConversations((prev) =>
          prev.map((item) => (item.id === row.id ? row : item)),
        );
      }
      message.success(
        expertId ? "已切换到这位专家，之后的回合都按专家身份作答" : "已取消专家，恢复普通对话",
      );
      setAddOpen(false);
    } catch (caught) {
      message.error((caught as Error).message || "切换专家失败");
    } finally {
      setSwitchingExpert(false);
    }
  };

  /** 量「会话 + 对话」整行的位置与输入浮层高度：滚动、改窗口、输入区换行都要重新同步。 */
  useEffect(() => {
    if (loading) return;
    const shell = shellRef.current;
    const composer = composerRef.current;
    if (!shell || !composer) return;
    const sync = () => {
      const rect = shell.getBoundingClientRect();
      setComposerBox({ left: rect.left, width: rect.width });
      composerHeightRef.current = composer.offsetHeight;
      setComposerHeight(composer.offsetHeight);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(shell);
    observer.observe(composer);
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [loading]);

  // 输入区高度随模式、参考文件、报错提示变化：每次渲染都对一次，保证给两栏留的空位不多不少
  // 读的只有 ref、且写回有等值守卫，不会自激；规则给的「空依赖数组」会丢掉逐次同步，故豁免。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    const height = composer.offsetHeight;
    if (height && height !== composerHeightRef.current) {
      composerHeightRef.current = height;
      // 只在高度真的变了才写回去，不会自激
      setComposerHeight(height);
    }
  });

  // 浮层固定在视口底部，滚动只发生在页面内容区；新消息要停在浮层上方而不是被它压住
  useEffect(() => {
    const anchor = bottomRef.current;
    if (!anchor) return;
    anchor.scrollIntoView({ block: "end" });
    let scroller = anchor.parentElement;
    while (scroller && scroller !== document.body) {
      const style = getComputedStyle(scroller);
      if (/(auto|scroll)/.test(style.overflowY)) break;
      scroller = scroller.parentElement;
    }
    if (scroller && scroller !== document.body) {
      scroller.scrollBy({ top: composerHeightRef.current + 16 });
    }
  }, [messages]);

  const createConversation = async () => {
    try {
      const row = await contentApi.createConversation({ body: {} });
      if (!row) throw new Error("创建会话失败");
      setConversations((prev) => [row, ...prev]);
      setActiveId(row.id);
      setMessages([]);
      setError("");
    } catch (caught) {
      message.error((caught as Error).message || "创建会话失败");
    }
  };

  /** 从「专家」页签点卡片过来：用该专家开一个新会话并切到它。 */
  useEffect(() => {
    if (!expertToUse) return;
    let alive = true;
    void (async () => {
      // 换专家就换会话：在跑的轮次全部断掉，免得结果落进切换后的会话里
      for (const handle of runsRef.current.values()) handle.controller.abort();
      runsRef.current.clear();
      setRunningKeys([]);
      try {
        const row = await contentApi.createConversation({
          body: { expertId: expertToUse.id },
        });
        if (!alive) return;
        if (!row) throw new Error("创建会话失败");
        setConversations((prev) => [row, ...prev]);
        setActiveId(row.id);
        setMessages([]);
        setError("");
      } catch (caught) {
        if (alive) {
          message.error((caught as Error).message || "创建会话失败");
        }
      } finally {
        if (alive) onExpertConsumed?.();
      }
    })();
    return () => {
      alive = false;
    };
    // 只响应「换了一位专家」；回调用最新引用即可，不必重跑
  }, [expertToUse, onExpertConsumed, message]);

  // 有轮次在跑就每秒走一次表，让「已等待 N 秒」自己动——出图出片几分钟里可能收不到任何进度
  useEffect(() => {
    if (!runningKeys.length) return;
    setClockNow(Date.now());
    const timer = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [runningKeys.length]);

  const saveRename = async () => {
    if (!renaming) return;
    setSavingRename(true);
    try {
      const row = await contentApi.updateConversation({
        params: { id: String(renaming.id) },
        body: { title: renameValue.trim() },
      });
      if (row) {
        setConversations((prev) =>
          prev.map((item) => (item.id === row.id ? row : item)),
        );
      }
      setRenaming(null);
    } catch (caught) {
      message.error((caught as Error).message || "改名失败");
    } finally {
      setSavingRename(false);
    }
  };

  const removeConversation = async (id: number) => {
    try {
      await contentApi.removeConversation({ params: { id: String(id) } });
      const rest = conversations.filter((item) => item.id !== id);
      setConversations(rest);
      const next = rest[0]?.id || 0;
      setActiveId(next);
      if (next) void openConversation(next);
      else setMessages([]);
    } catch (caught) {
      message.error((caught as Error).message || "删除会话失败");
    }
  };

  /** 按气泡 key 更新那一条助手消息：同一会话可能同时有多轮在跑。 */
  const updateMessage = (key: string, update: (item: UiMessage) => UiMessage) => {
    setMessages((prev) => prev.map((item) => (item.key === key ? update(item) : item)));
  };

  /**
   * 断流不等于失败：出图/出片要跑几分钟，中间任何一环（Next 代理、网关、网络）
   * 都可能把连接掐掉，甚至一个字节都读不到，但服务端仍在跑，跑完照样落库。
   * 所以结论一律以落库为准：每 5 秒按会话查一次这一轮的结果（最长 12 分钟）。
   */
  const pollServerTurn = async (
    conversationId: number,
    bubbleKey: string,
    afterId: number,
    sentContent: string,
    isSettled: () => boolean,
    markSettled: () => void,
  ) => {
    const deadline = Date.now() + 12 * 60 * 1000;
    while (!isSettled() && runsRef.current.has(bubbleKey) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      if (isSettled() || !runsRef.current.has(bubbleKey)) return;
      let rows: ContentAgentMessage[] = [];
      try {
        rows = (await contentApi.messages({ params: { id: String(conversationId) } })) || [];
      } catch {
        continue;
      }
      const row = pickTurnResult(rows, afterId, sentContent);
      if (!row) continue;
      markSettled();
      if (row.status === "canceled") {
        updateMessage(bubbleKey, (item) => ({
          ...item,
          canceled: true,
          failed: false,
        }));
        return;
      }
      // 服务端的行有自己的 id，气泡 key 要留住，否则「生成中…」与停止按钮会丢
      updateMessage(bubbleKey, (item) => ({ ...fromServer(row), key: item.key }));
      return;
    }
  };

  /** 光标前的 `@关键词` 触发参考文件选择；没有参考文件时不弹。 */
  const detectMention = (value: string, caret: number) => {
    if (!references.length) return null;
    const match = /(^|[\s，,。！？；;：:、（(])@([^\s@]*)$/.exec(value.slice(0, caret));
    if (!match) return null;
    return { start: caret - match[2].length - 1, query: match[2] };
  };

  const insertMention = (item: ContentAgentReference) => {
    if (!mention) return;
    const next = `${input.slice(0, mention.start)}@${item.label} ${input.slice(
      mention.start + 1 + mention.query.length,
    )}`;
    setInput(next);
    setMention(null);
    setMentionIndex(0);
    requestAnimationFrame(() => {
      const area = textareaRef.current?.resizableTextArea?.textArea;
      if (!area) return;
      area.focus();
      area.setSelectionRange(next.length, next.length);
    });
  };

  const addReferences = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    const next = [...references];
    try {
      for (const file of Array.from(files)) {
        try {
          const uploaded = await uploadContentMedia(file);
          const media = String(uploaded.kind || "");
          if (media !== "image" && media !== "video" && media !== "audio") {
            message.warning(
              `${uploaded.name || file.name} 不是图片 / 音频 / 视频，参考文件只收这三类`,
            );
            continue;
          }
          next.push({
            label: nextReferenceLabel(next, media),
            fileName: uploaded.name || file.name,
            url: uploaded.url,
            media,
          });
          // 多选时逐个落标签；后面的文件失败也不丢前面已上传的
          setReferences([...next]);
        } catch (caught) {
          message.error(
            `${file.name} 上传失败：${(caught as Error).message || "请重试"}`,
          );
        }
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const current = selections[mode];
  const currentModels = modelsByMode[mode];
  const modelsLoading = loadingModelMode === mode;
  const currentExpertId = conversations.find((item) => item.id === activeId)?.expertId || 0;
  const currentExpertName = conversations.find((item) => item.id === activeId)?.expertName || "";
  const currentPersonaId =
    conversations.find((item) => item.id === activeId)?.personaId || 0;
  const currentPersonaName =
    conversations.find((item) => item.id === activeId)?.personaName || "";
  // 勾上协作时默认选前 3 个分身；分身被删后自动收敛
  useEffect(() => {
    if (!collaborate) return;
    setCollaborateIds((prev) => {
      const valid = prev
        .filter((id) => personas.some((item) => item.id === id))
        .slice(0, 3);
      return valid.length >= 2 ? valid : personas.slice(0, 3).map((item) => item.id);
    });
  }, [collaborate, personas]);
  // 换到绑了模型的分身时，把它的默认渠道/模型同步到文本选择器，界面与实际执行一致
  const appliedPersonaRef = useRef(0);
  useEffect(() => {
    if (!currentPersonaId) {
      appliedPersonaRef.current = 0;
      return;
    }
    const row = personas.find((item) => item.id === currentPersonaId);
    if (!row || appliedPersonaRef.current === row.id) return;
    if (!row.channelId && !row.model) {
      appliedPersonaRef.current = row.id;
      return;
    }
    const channelId = row.channelId > 0 ? row.channelId : selections.text.channelId;
    if (!channelId) return;
    appliedPersonaRef.current = row.id;
    void loadChannelModels("text", channelId, { channelId, model: row.model });
  }, [currentPersonaId, personas, selections.text.channelId, loadChannelModels]);
  const pickedSkills = skills.filter((skill) => skillIds.includes(skill.id));
  const pickedPlugins = plugins.filter((plugin) => pluginIds.includes(plugin.id));
  const pickedLibrary = library.filter((item) => libraryIds.includes(item.id));

  /** 「+」浮层：一级菜单（Qoder 形态）+ 两个二级面板（选择技能 / 选择专家）。 */
  const addMenu = (
    <div style={{ width: 300, padding: 2 }}>
      {addPanel === "root" ? (
        <div style={{ display: "grid", gap: 2 }}>
          <AddRow
            icon={<FileAddOutlined aria-hidden />}
            label="添加参考文件"
            meta={`${references.length} 个`}
            chevron
            onClick={() => setAddPanel("references")}
          />
          <AddRow
            icon={<ToolOutlined aria-hidden />}
            label="选择技能"
            meta={skillIds.length ? `已选 ${skillIds.length}` : "全部启用"}
            chevron
            onClick={() => setAddPanel("skills")}
          />
          <AddRow
            icon={<BlockOutlined aria-hidden />}
            label="选择插件"
            meta={pluginIds.length ? `已选 ${pluginIds.length}` : "全部启用"}
            chevron
            onClick={() => setAddPanel("plugins")}
          />
          <AddRow
            icon={<TeamOutlined aria-hidden />}
            label="选择专家"
            meta={currentExpertName || "未选"}
            chevron
            onClick={() => setAddPanel("experts")}
          />
          <AddRow
            icon={<ReadOutlined aria-hidden />}
            label="选择资料"
            meta={libraryIds.length ? `已选 ${libraryIds.length}` : "整库检索"}
            chevron
            onClick={() => setAddPanel("library")}
          />
          <AddRow
            icon={<ApiOutlined aria-hidden />}
            label="选择 MCP 连接器"
            meta={connectorIds.length ? `已选 ${connectorIds.length}` : "全部启用"}
            chevron
            onClick={() => setAddPanel("connectors")}
          />
          <AddRow
            icon={<SettingOutlined aria-hidden />}
            label="模型设置"
            meta="模型服务"
            onClick={() => {
              setAddOpen(false);
              router.push("/model-settings");
            }}
          />
        </div>
      ) : (
        <AddSubPanel
          title={ADD_PANEL_TITLES[addPanel]}
          onBack={() => setAddPanel("root")}
        >
          {addPanel === "references" ? (
            <div style={{ display: "grid", gap: 4 }}>
              <AddRow
                icon={<FileAddOutlined aria-hidden />}
                label="从本地上传"
                meta={uploading ? "上传中…" : "图片 / 视频 / 音频"}
                disabled={uploading}
                onClick={() => {
                  setAddOpen(false);
                  fileRef.current?.click();
                }}
              />
              <AddRow
                icon={<PictureOutlined aria-hidden />}
                label="从数字资产选择"
                meta="复用已传素材"
                onClick={() => {
                  setAddOpen(false);
                  setAssetPickerOpen(true);
                }}
              />
              <span className="text-12 muted" style={{ padding: "2px 8px" }}>
                {`本轮已有 ${references.length} 个参考文件；按类型自动编号，用 @ 在对话里调取。`}
              </span>
            </div>
          ) : addPanel === "skills" ? (
            <div style={{ display: "grid", gap: 8 }}>
              {auxLoading ? <Spin size="small" /> : null}
              {auxError ? (
                <span className="text-12" style={{ color: "#d4380d" }}>
                  {auxError}
                </span>
              ) : null}
              {!auxLoading && !skills.length ? (
                <span className="text-12 muted">
                  还没有技能：到「技能」页签上传 zip 技能包后再来选。
                </span>
              ) : null}
              {skills.length ? (
                <div style={{ display: "grid", gap: 4, maxHeight: 220, overflowY: "auto" }}>
                  {skills.map((skill) => (
                    <Checkbox
                      key={skill.id}
                      checked={skillIds.includes(skill.id)}
                      disabled={!skill.enabled}
                      onChange={(event) =>
                        setSkillIds((prev) =>
                          event.target.checked
                            ? [...prev, skill.id]
                            : prev.filter((id) => id !== skill.id),
                        )
                      }
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          maxWidth: 218,
                        }}
                      >
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {skill.name}
                        </span>
                        {!skill.enabled ? <Tag style={{ marginInlineEnd: 0 }}>已停用</Tag> : null}
                      </span>
                    </Checkbox>
                  ))}
                </div>
              ) : null}
              <span className="text-12 muted">
                勾选后本轮只把这些技能交给模型；不勾＝全部启用中的技能。
              </span>
              {skillIds.length ? (
                <Button
                  type="link"
                  style={{ padding: 0, height: "auto", justifySelf: "start" }}
                  onClick={() => setSkillIds([])}
                >
                  清空勾选
                </Button>
              ) : null}
            </div>
          ) : addPanel === "plugins" ? (
            <div style={{ display: "grid", gap: 8 }}>
              {auxLoading ? <Spin size="small" /> : null}
              {auxError ? (
                <span className="text-12" style={{ color: "#d4380d" }}>
                  {auxError}
                </span>
              ) : null}
              {!auxLoading && !plugins.length ? (
                <span className="text-12 muted">
                  还没有插件：到「插件」页签安装或上传 zip 插件包后再来选。
                </span>
              ) : null}
              {plugins.length ? (
                <div style={{ display: "grid", gap: 4, maxHeight: 220, overflowY: "auto" }}>
                  {plugins.map((plugin) => (
                    <Checkbox
                      key={plugin.id}
                      checked={pluginIds.includes(plugin.id)}
                      disabled={!plugin.enabled}
                      onChange={(event) =>
                        setPluginIds((prev) =>
                          event.target.checked
                            ? [...prev, plugin.id]
                            : prev.filter((id) => id !== plugin.id),
                        )
                      }
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          flexDirection: "column",
                          gap: 2,
                          maxWidth: 236,
                        }}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {plugin.name}
                          </span>
                          {!plugin.enabled ? <Tag style={{ marginInlineEnd: 0 }}>已停用</Tag> : null}
                        </span>
                        {plugin.commands.length ? (
                          <span className="text-12 muted">
                            命令：{plugin.commands.map((command) => `/${command.name}`).join(" ")}
                          </span>
                        ) : null}
                      </span>
                    </Checkbox>
                  ))}
                </div>
              ) : null}
              <span className="text-12 muted">
                勾选后本轮只用这几个插件（含它们的插件命令）；不勾＝全部启用中的插件。
              </span>
              {pluginIds.length ? (
                <Button
                  type="link"
                  style={{ padding: 0, height: "auto", justifySelf: "start" }}
                  onClick={() => setPluginIds([])}
                >
                  清空勾选
                </Button>
              ) : null}
            </div>
          ) : addPanel === "experts" ? (
            <div style={{ display: "grid", gap: 8 }}>
              {auxLoading || switchingExpert ? <Spin size="small" /> : null}
              {auxError ? (
                <span className="text-12" style={{ color: "#d4380d" }}>
                  {auxError}
                </span>
              ) : null}
              <div style={{ display: "grid", gap: 2, maxHeight: 220, overflowY: "auto" }}>
                <AddRow
                  icon={<TeamOutlined aria-hidden />}
                  label="不使用专家"
                  meta={currentExpertId ? undefined : "当前"}
                  onClick={() => void applyExpert(0)}
                />
                {experts.map((expert) => (
                  <AddRow
                    key={expert.id}
                    icon={<TeamOutlined aria-hidden />}
                    label={expert.name}
                    meta={expert.id === currentExpertId ? "当前" : `使用 ${expert.useCount} 次`}
                    onClick={() => void applyExpert(expert.id)}
                  />
                ))}
              </div>
              {!auxLoading && !experts.length ? (
                <span className="text-12 muted">
                  还没有专家：到「专家」页签用一段话生成一个。
                </span>
              ) : null}
              <span className="text-12 muted">
                选中后整个会话都按这位专家作答；专家全站共用。
              </span>
            </div>
          ) : addPanel === "library" ? (
            <div style={{ display: "grid", gap: 8 }}>
              {auxLoading ? <Spin size="small" /> : null}
              {auxError ? (
                <span className="text-12" style={{ color: "#d4380d" }}>
                  {auxError}
                </span>
              ) : null}
              {!auxLoading && !library.length ? (
                <span className="text-12 muted">
                  还没有资料：到「记忆 → 资料库」把数字资产里的文档收进来。
                </span>
              ) : null}
              {library.length ? (
                <div style={{ display: "grid", gap: 4, maxHeight: 220, overflowY: "auto" }}>
                  {library.map((item) => (
                    <Checkbox
                      key={item.id}
                      checked={libraryIds.includes(item.id)}
                      disabled={item.status !== "ready"}
                      onChange={(event) =>
                        setLibraryIds((prev) =>
                          event.target.checked
                            ? [...prev, item.id]
                            : prev.filter((id) => id !== item.id),
                        )
                      }
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          maxWidth: 218,
                        }}
                      >
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {item.name}
                        </span>
                        {item.status === "ready" ? (
                          <span className="text-12 muted">{`${item.type} · ${item.nodeCount} 片段`}</span>
                        ) : (
                          <Tag style={{ marginInlineEnd: 0 }}>
                            {item.status === "missing" ? "已删除" : "未就绪"}
                          </Tag>
                        )}
                      </span>
                    </Checkbox>
                  ))}
                </div>
              ) : null}
              <span className="text-12 muted">
                勾选后本轮只在这几篇里检索与精读；不勾＝整库检索。
              </span>
              {libraryIds.length ? (
                <Button
                  type="link"
                  style={{ padding: 0, height: "auto", justifySelf: "start" }}
                  onClick={() => setLibraryIds([])}
                >
                  清空勾选
                </Button>
              ) : null}
            </div>
          ) : addPanel === "connectors" ? (
            <div style={{ display: "grid", gap: 8 }}>
              {auxLoading ? <Spin size="small" /> : null}
              {auxError ? (
                <span className="text-12" style={{ color: "#d4380d" }}>
                  {auxError}
                </span>
              ) : null}
              {connectors.length ? (
                <div style={{ display: "grid", gap: 4, maxHeight: 220, overflowY: "auto" }}>
                  {connectors.map((item) => (
                    <Checkbox
                      key={item.id}
                      checked={connectorIds.includes(item.id)}
                      disabled={!item.enabled}
                      onChange={(event) =>
                        setConnectorIds((prev) =>
                          event.target.checked
                            ? [...prev, item.id]
                            : prev.filter((id) => id !== item.id),
                        )
                      }
                    >
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        {item.name}
                        <span className="text-12 muted">{`${item.toolCount} 个工具`}</span>
                        {!item.enabled ? <Tag style={{ marginInlineEnd: 0 }}>已停用</Tag> : null}
                      </span>
                    </Checkbox>
                  ))}
                </div>
              ) : null}
              <span className="text-12 muted">
                勾选后本轮只注入这些连接器；不勾＝全部启用中的连接器。
              </span>
              {connectorIds.length ? (
                <Button
                  type="link"
                  style={{ padding: 0, height: "auto", justifySelf: "start" }}
                  onClick={() => setConnectorIds([])}
                >
                  清空勾选
                </Button>
              ) : null}
            </div>
          ) : null}
        </AddSubPanel>
      )}
    </div>
  );

  const send = async () => {
    const content = input.trim();
    if (!content) return;
    // 文本模型始终要有一个：图片/视频模式也要靠它理解指令、调用生成工具
    if (!selections.text.model) {
      message.warning(
        mode === "text"
          ? "请先选择要用的模型（渠道 + 模型）"
          : "图片 / 视频模式还要一个文本模型来理解指令：请先切到「文本」模式选好模型",
      );
      return;
    }
    if (!current.model) {
      message.warning(
        mode === "image"
          ? "请先选择要用的图片模型（渠道 + 模型）"
          : mode === "video"
            ? "请先选择要用的视频模型（渠道 + 模型）"
            : "请先选择要用的模型（渠道 + 模型）",
      );
      return;
    }
    const turnReferences = references;
    const turnSkillIds = skillIds;
    const turnPluginIds = pluginIds;
    const turnLibraryIds = libraryIds;
    const turnConnectorIds = connectorIds;
    const turnMode = mode;
    // 只有文本模式支持协作；不足 2 个分身就当普通回合跑
    const turnPersonaIds =
      mode === "text" && collaborate && collaborateIds.length >= 2
        ? collaborateIds.slice(0, 3)
        : [];
    const turnTextChannel = selections.text.channelId;
    const turnTextModel = selections.text.model;
    const turnImageChannel = current.channelId;
    const turnImageModel = current.model;
    const turnUpscale = upscale;
    const turnUpscaleResolution = upscaleResolution;
    const turnImageSize = imageSize;
    const turnVideoResolution = videoResolution;
    const turnVideoDuration = videoDuration;
    let conversationId = activeId;
    if (!conversationId) {
      const row = await contentApi.createConversation({
        body: { personaId: currentPersonaId },
      });
      if (!row) {
        message.error("创建会话失败");
        return;
      }
      conversationId = row.id;
      setActiveId(row.id);
      setConversations((prev) => [row, ...prev]);
    }
    setInput("");
    setReferences([]);
    setSkillIds([]);
    setPluginIds([]);
    setLibraryIds([]);
    setConnectorIds([]);
    setMention(null);
    setError("");
    // 这一轮的标识：气泡 key 与发给服务端的 runId 同一个，停止时按它精确停这一轮
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const bubbleKey = `a-${runId}`;
    // 断流后按落库结果回收时的水位：此刻界面上已落库的最大消息 id
    const lastKnownId = messages.reduce((max, item) => {
      const id = item.key.startsWith("m-") ? Number(item.key.slice(2)) : NaN;
      return Number.isFinite(id) && id > max ? id : max;
    }, 0);
    setMessages((prev) => [
      ...prev,
      {
        key: `u-${runId}`,
        role: "user",
        content,
        references: turnReferences,
        toolLines: [],
        media: [],
        notices: [],
        createdAt: new Date().toISOString(),
      },
      {
        key: bubbleKey,
        role: "assistant",
        content: "",
        references: [],
        toolLines: [],
        media: [],
        notices: [],
      },
    ]);
    const controller = new AbortController();
    runsRef.current.set(bubbleKey, { runId, conversationId, controller });
    setRunningKeys((prev) => [...prev, bubbleKey]);
    setRunStartedAt((prev) => ({ ...prev, [bubbleKey]: Date.now() }));
    // 结论以服务端落库为准：SSE 再断、再静默，都靠轮询把这一轮捞回来
    let settled = false;
    let sawEvent = false;
    const pollTask = pollServerTurn(
      conversationId,
      bubbleKey,
      lastKnownId,
      content,
      () => settled,
      () => {
        settled = true;
      },
    );
    try {
      await streamAgentMessage(conversationId, content, {
        signal: controller.signal,
        runId,
        references: turnReferences,
        channelId: turnTextChannel,
        model: turnTextModel,
        mode: turnMode,
        imageChannelId: turnMode === "image" ? turnImageChannel : undefined,
        imageModel: turnMode === "image" ? turnImageModel : undefined,
        videoChannelId: turnMode === "video" ? turnImageChannel : undefined,
        videoModel: turnMode === "video" ? turnImageModel : undefined,
        videoUpscaleResolution: turnMode === "video" && turnUpscale ? turnUpscaleResolution : undefined,
        imageSize: turnMode === "image" ? turnImageSize : undefined,
        videoResolution: turnMode === "video" ? turnVideoResolution || undefined : undefined,
        videoDuration: turnMode === "video" ? turnVideoDuration : undefined,
        skillIds: turnSkillIds,
        pluginIds: turnPluginIds,
        libraryIds: turnLibraryIds,
        connectorIds: turnConnectorIds,
        personaId: currentPersonaId,
        personaIds: turnPersonaIds,
        onEvent: ({ event, data }) => {
            sawEvent = true;
            let payload: Record<string, unknown> = {};
            try {
              payload = JSON.parse(data) as Record<string, unknown>;
            } catch {
              return;
            }
            if (event === "delta") {
              const text = String(payload.text || "");
              updateMessage(bubbleKey, (item) => ({ ...item, content: item.content + text }));
            } else if (event === "tool_start") {
              const name = String(payload.name || "工具");
              updateMessage(bubbleKey, (item) => ({
                ...item,
                toolLines: [...item.toolLines, { name, state: "running" }],
              }));
            } else if (event === "tool_progress") {
              // 长工具（出图/出片）轮询期间的进度：就地更新那条「⏳ 进行中」的行
              const name = String(payload.name || "");
              const text = String(payload.text || "");
              if (!text) return;
              updateMessage(bubbleKey, (item) => {
                const lines = [...item.toolLines];
                const index = lines.map((line) => line.name).lastIndexOf(name);
                if (index >= 0) lines[index] = { ...lines[index], text };
                return { ...item, toolLines: lines };
              });
            } else if (event === "tool_end") {
              const name = String(payload.name || "工具");
              const ok = payload.ok !== false;
              const text = String(payload.text || "");
              const media = Array.isArray(payload.media)
                ? (payload.media as { kind?: string; url?: string }[])
                : [];
              updateMessage(bubbleKey, (item) => {
                const lines = [...item.toolLines];
                const index = lines.map((line) => line.name).lastIndexOf(name);
                if (index >= 0) lines[index] = { name, state: ok ? "ok" : "failed", text };
                else lines.push({ name, state: ok ? "ok" : "failed", text });
                return {
                  ...item,
                  toolLines: lines,
                  media: [
                    ...item.media,
                    ...media
                      .filter((entry) => entry.url)
                      .map((entry) => ({
                        kind: String(entry.kind || "image"),
                        url: String(entry.url),
                      })),
                  ],
                };
              });
            } else if (event === "notice") {
              const text = String(payload.text || "");
              updateMessage(bubbleKey, (item) => ({ ...item, notices: [...item.notices, text] }));
            } else if (event === "done") {
              settled = true;
              const finalText = String(payload.text || "");
              updateMessage(bubbleKey, (item) => ({
                ...item,
                content: finalText || item.content,
              }));
            } else if (event === "error") {
              settled = true;
              const text = String(payload.message || "对话失败，请稍后重试");
              setError(text);
              updateMessage(bubbleKey, (item) => ({ ...item, failed: true }));
            }
          },
        },
      );
    } catch (caught) {
      // 断流（开发代理 30 秒收流、90 秒空闲看门狗、网络抖动）都不等于这一轮失败：
      // 服务端拿到的请求照样跑完落库。只有「一个事件都没收到、服务端明确拒收」才算真失败。
      const kind = (caught as { kind?: string }).kind;
      const lost = kind === "timeout" || kind === "network" || caught instanceof TypeError;
      const stopped = !runsRef.current.has(bubbleKey);
      if (!stopped && !settled && !lost && !sawEvent) {
        settled = true;
        setError((caught as Error).message || "对话失败，请稍后重试");
        updateMessage(bubbleKey, (item) => ({ ...item, failed: true }));
      }
    } finally {
      // 流结束了还没有结论：等轮询从落库结果里把这一轮带回来
      if (!settled) await pollTask;
      if (!settled) {
        if (!runsRef.current.has(bubbleKey)) {
          // 用户点了「停止」：服务端会落一条已中断，不当失败
          updateMessage(bubbleKey, (item) => ({
            ...item,
            canceled: true,
            failed: false,
          }));
        } else {
          updateMessage(bubbleKey, (item) => ({ ...item, failed: true }));
          setError("这一轮没有等到结果，请稍后刷新对话查看");
        }
      }
      runsRef.current.delete(bubbleKey);
      setRunStartedAt((prev) => {
        const next = { ...prev };
        delete next[bubbleKey];
        return next;
      });
      setRunningKeys((prev) => prev.filter((key) => key !== bubbleKey));
      void loadConversations(conversationId);
    }
  };

  /** 停止气泡旁的那一轮：服务端按 runId 中断，本地同时断流。 */
  const stopRun = async (bubbleKey: string) => {
    const handle = runsRef.current.get(bubbleKey);
    if (!handle) return;
    runsRef.current.delete(bubbleKey);
    setRunningKeys((prev) => prev.filter((key) => key !== bubbleKey));
    try {
      await cancelAgentMessage(handle.conversationId, handle.runId);
    } catch {
      // 取消失败也照样断开本地流
    }
    handle.controller.abort();
  };

  const activeConversation = conversations.find((item) => item.id === activeId);

  const waitedLabel = (bubbleKey: string) => {
    const started = runStartedAt[bubbleKey];
    if (!started) return "生成中…";
    const seconds = Math.max(0, Math.floor((clockNow - started) / 1000));
    return `生成中 · 已等待 ${seconds} 秒`;
  };

  if (loading) return <Spin />;

  return (
    <div
      ref={shellRef}
      className="agent-shell"
      // 输入浮层盖在视口底部，这里把两栏的尾部空出来，滚到底也不会被压住
      style={{ paddingBottom: composerHeight + 24 }}
    >
      <Panel
        title="会话"
        extra={
          <Button
            icon={<PlusOutlined aria-hidden />}
            onClick={() => void createConversation()}
          >
            新建
          </Button>
        }
      >
        <div className="agent-conv-list">
          {conversations.map((item) => (
            <div
              key={item.id}
              className={`agent-conv${item.id === activeId ? " active" : ""}`}
              onClick={() => {
                if (streaming) return;
                setActiveId(item.id);
                void openConversation(item.id);
              }}
            >
              <span className="agent-conv-title">{item.title || "新会话"}</span>
              <span className="agent-conv-actions">
                <Button
                  type="text"
                  icon={<EditOutlined aria-hidden />}
                  title="重命名"
                  onClick={(event) => {
                    event.stopPropagation();
                    setRenaming(item);
                    setRenameValue(item.title || "");
                  }}
                />
                <Popconfirm
                  title="删除这个会话？"
                  okText="删除"
                  cancelText="取消"
                  onConfirm={(event) => {
                    event?.stopPropagation();
                    void removeConversation(item.id);
                  }}
                >
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined aria-hidden />}
                    title="删除"
                    onClick={(event) => event.stopPropagation()}
                  />
                </Popconfirm>
              </span>
            </div>
          ))}
          {!conversations.length ? (
            <div className="text-12 muted">还没有会话，点「新建」或直接说句话</div>
          ) : null}
        </div>
      </Panel>

      <Panel
        title="对话"
        extra={
          <>
            <Button
              icon={<KeyOutlined aria-hidden />}
              onClick={() => router.push("/developer/keys")}
            >
              管理API Key
            </Button>
            <Button
              icon={<PayCircleOutlined aria-hidden />}
              onClick={() => router.push("/points")}
            >
              积分充值
            </Button>
          </>
        }
        titleExtra={
          activeConversation?.expertName || currentPersonaName ? (
            <span className="text-12 muted">
              {[
                activeConversation?.expertName
                  ? `当前专家：${activeConversation.expertName}`
                  : "",
                currentPersonaName ? `当前分身：${currentPersonaName}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          ) : undefined
        }
      >
        {error ? <Notice variant="error">{error}</Notice> : null}
        <div className="agent-thread">
          {loadingMessages ? <Spin /> : null}
          {!messages.length && !loadingMessages ? (
            <div className="agent-empty">
              <div className="agent-empty-icon">
                <RobotOutlined aria-hidden />
              </div>
              <div className="agent-empty-title">开始一段对话</div>
              <p className="agent-empty-desc">
                在下方描述你想做的事；切到「图片 / 视频」可以就地出片，上传参考文件后用 @ 调取。
              </p>
            </div>
          ) : null}
          {messages.map((item) => {
            const running = runningKeys.includes(item.key);
            const statusChips = (
              <>
                {item.failed ? <span className="agent-chip agent-chip-danger">失败</span> : null}
                {item.canceled ? <span className="agent-chip agent-chip-muted">已中断</span> : null}
              </>
            );
            const referenceChips = item.references.length ? (
              <div className="agent-refs">
                {item.references.map((reference, index) => (
                  <span className="agent-ref" key={`${item.key}-ref-${index}`}>
                    <PaperClipOutlined aria-hidden />
                    {`@${reference.label}`}
                    <span className="agent-ref-file">{reference.fileName}</span>
                  </span>
                ))}
              </div>
            ) : null;

            if (item.role === "user") {
              return (
                <article className="agent-turn agent-turn-user" key={item.key}>
                  <div className="agent-turn-meta">
                    {statusChips}
                    <span className="agent-turn-name">我</span>
                    {item.createdAt ? (
                      <span className="agent-turn-time">{clockLabel(item.createdAt)}</span>
                    ) : null}
                  </div>
                  {referenceChips}
                  {item.content ? (
                    <div className="agent-bubble agent-bubble-user">{renderRichText(item.content)}</div>
                  ) : null}
                </article>
              );
            }

            const images = item.media.filter((media) => media.kind === "image");
            const videos = item.media.filter((media) => media.kind === "video");
            const audios = item.media.filter((media) => media.kind === "audio");
            const files = item.media.filter(
              (media) => !["image", "video", "audio"].includes(media.kind),
            );
            const personaMark = splitPersonaMarker(item.content);

            return (
              <article className="agent-turn agent-turn-agent" key={item.key}>
                <div className="agent-avatar" aria-hidden>
                  <RobotOutlined />
                </div>
                <div className="agent-turn-main">
                  <div className="agent-turn-meta">
                    <span className="agent-turn-name">Agent</span>
                    {item.createdAt ? (
                      <span className="agent-turn-time">{clockLabel(item.createdAt)}</span>
                    ) : null}
                    {statusChips}
                    {running ? (
                      <>
                        <span className="agent-running">
                          <LoadingOutlined aria-hidden />
                          {waitedLabel(item.key)}
                        </span>
                        <Button danger icon={<StopOutlined aria-hidden />} onClick={() => void stopRun(item.key)}>
                          停止
                        </Button>
                      </>
                    ) : null}
                  </div>
                  {referenceChips}
                  {personaMark.persona ? (
                    <div className="agent-turn-meta">
                      <span className="agent-chip">{`分身：${personaMark.persona}`}</span>
                    </div>
                  ) : null}
                  {personaMark.body ? (
                    <div className="agent-bubble agent-bubble-agent">
                      {renderRichText(personaMark.body)}
                    </div>
                  ) : running && !item.toolLines.length ? (
                    <div className="agent-bubble agent-bubble-agent">
                      <span className="agent-typing" aria-label="正在生成">
                        <span />
                        <span />
                        <span />
                      </span>
                    </div>
                  ) : null}
                  {item.toolLines.length ? (
                    <div className="agent-tools">
                      {item.toolLines.map((line, index) => (
                        <div className="agent-tool" data-state={line.state} key={`${item.key}-tool-${index}`}>
                          {line.state === "running" ? (
                            <LoadingOutlined aria-hidden />
                          ) : line.state === "ok" ? (
                            <CheckCircleFilled aria-hidden />
                          ) : (
                            <CloseCircleFilled aria-hidden />
                          )}
                          <span className="agent-tool-name">{toolLabel(line.name)}</span>
                          {line.text ? <span className="agent-tool-text">{line.text}</span> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {images.length ? (
                    <div className="agent-media">
                      {images.map((media, index) => (
                        <a
                          key={`${item.key}-image-${index}`}
                          className="agent-media-card"
                          href={media.url}
                          target="_blank"
                          rel="noreferrer"
                          title="打开原图"
                        >
                          <RawImg src={media.url} alt="生成结果" />
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {videos.map((media, index) => (
                    <figure className="agent-video" key={`${item.key}-video-${index}`}>
                      <video src={media.url} controls preload="metadata" playsInline />
                      <figcaption>
                        <a href={media.url} target="_blank" rel="noreferrer">
                          在新窗口打开
                        </a>
                      </figcaption>
                    </figure>
                  ))}
                  {audios.map((media, index) => (
                    <audio
                      className="agent-audio"
                      key={`${item.key}-audio-${index}`}
                      src={media.url}
                      controls
                      preload="metadata"
                    />
                  ))}
                  {files.map((media, index) => (
                    <a
                      className="agent-file"
                      key={`${item.key}-file-${index}`}
                      href={media.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <PaperClipOutlined aria-hidden />
                      打开文件
                    </a>
                  ))}
                  {item.notices.map((text, index) => (
                    <div className="agent-notice" key={`${item.key}-notice-${index}`}>
                      <InfoCircleOutlined aria-hidden />
                      <span>{text}</span>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </Panel>

      {/* 输入区是独立浮层：固定在视口底部，宽度拉满「会话 + 对话」整行，对话滚动时位置不动 */}
      <div
        ref={composerRef}
        style={{
          position: "fixed",
          left: composerBox?.left ?? 0,
          width: composerBox?.width ?? 0,
          bottom: 16,
          zIndex: 30,
          visibility: composerBox ? "visible" : "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gap: 8,
            padding: 12,
            background: "var(--panel, #fff)",
            border: "1px solid var(--line, #f0f0f0)",
            borderRadius: 12,
            boxShadow: "0 -8px 28px rgba(0,0,0,0.1)",
          }}
        >
          {references.length ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {references.map((reference) => (
                <Tag
                  key={reference.url}
                  closable
                  closeIcon={<CloseOutlined aria-hidden />}
                  onClose={(event) => {
                    event.preventDefault();
                    setReferences((prev) => prev.filter((item) => item.url !== reference.url));
                  }}
                >
                  {`@${reference.label}`}
                  <span className="text-12 muted" style={{ marginLeft: 6 }}>
                    {reference.fileName}
                  </span>
                </Tag>
              ))}
            </div>
          ) : null}
          {pickedSkills.length ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span className="text-12 muted">本轮技能</span>
              {pickedSkills.map((skill) => (
                <Tag
                  key={skill.id}
                  closable
                  closeIcon={<CloseOutlined aria-hidden />}
                  onClose={(event) => {
                    event.preventDefault();
                    setSkillIds((prev) => prev.filter((id) => id !== skill.id));
                  }}
                >
                  {skill.name}
                </Tag>
              ))}
            </div>
          ) : null}
          {pickedPlugins.length ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span className="text-12 muted">本轮插件</span>
              {pickedPlugins.map((plugin) => (
                <Tag
                  key={plugin.id}
                  closable
                  closeIcon={<CloseOutlined aria-hidden />}
                  onClose={(event) => {
                    event.preventDefault();
                    setPluginIds((prev) => prev.filter((id) => id !== plugin.id));
                  }}
                >
                  {plugin.name}
                  {plugin.commands.length ? (
                    <span className="text-12 muted" style={{ marginLeft: 6 }}>
                      {plugin.commands.map((command) => `/${command.name}`).join(" ")}
                    </span>
                  ) : null}
                </Tag>
              ))}
            </div>
          ) : null}
          {pickedLibrary.length ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span className="text-12 muted">本轮资料</span>
              {pickedLibrary.map((item) => (
                <Tag
                  key={item.id}
                  closable
                  closeIcon={<CloseOutlined aria-hidden />}
                  onClose={(event) => {
                    event.preventDefault();
                    setLibraryIds((prev) => prev.filter((id) => id !== item.id));
                  }}
                >
                  {item.name}
                </Tag>
              ))}
            </div>
          ) : null}
          <div style={{ position: "relative" }}>
            {mention && mentionOptions.length ? (
              <div
                style={{
                  position: "absolute",
                  bottom: "100%",
                  left: 0,
                  marginBottom: 6,
                  zIndex: 10,
                  minWidth: 260,
                  maxHeight: 220,
                  overflowY: "auto",
                  background: "var(--panel, #fff)",
                  border: "1px solid var(--line, #f0f0f0)",
                  borderRadius: 8,
                  boxShadow: "0 6px 20px rgba(0,0,0,0.08)",
                  padding: 4,
                }}
              >
                {mentionOptions.map((item, index) => (
                  <div
                    key={item.url}
                    onClick={() => insertMention(item)}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      padding: "6px 8px",
                      borderRadius: 6,
                      cursor: "pointer",
                      background:
                        index === mentionIndex ? "rgba(22,119,255,0.08)" : "transparent",
                    }}
                  >
                    <Tag style={{ marginInlineEnd: 0 }}>{REFERENCE_MEDIA_LABEL[item.media]}</Tag>
                    <span>{`@${item.label}`}</span>
                    <span className="text-12 muted" style={{ marginLeft: "auto" }}>
                      {item.fileName}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            <Input.TextArea
              ref={textareaRef}
              value={input}
              autoSize={{ minRows: 2, maxRows: 6 }}
              placeholder={
                mode === "text"
                  ? "说明你想做什么；下方选渠道和模型，点 + 选参考文件 / 资料 / 技能 / 专家 / MCP连接器；Enter 换行"
                  : mode === "image"
                    ? "描述要生成的图片；输入 @ 调取参考图片；Enter 换行"
                    : "描述要生成的视频；输入 @ 调取参考图片/视频/音频；Enter 换行"
              }
              onChange={(event) => {
                const value = event.target.value;
                setInput(value);
                setMention(detectMention(value, event.target.selectionStart || 0));
                setMentionIndex(0);
              }}
              onKeyDown={(event) => {
                if (mention && mentionOptions.length) {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setMention(null);
                    return;
                  }
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const delta = event.key === "ArrowDown" ? 1 : -1;
                    setMentionIndex(
                      (prev) => (prev + delta + mentionOptions.length) % mentionOptions.length,
                    );
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    insertMention(mentionOptions[Math.min(mentionIndex, mentionOptions.length - 1)]);
                    return;
                  }
                }
                // 与 Qoder 一致：Enter 只换行，发送只走「发送」按钮
              }}
            />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,audio/*,video/*"
            multiple
            hidden
            onChange={(event) => void addReferences(event.target.files)}
          />
          <AssetReferencePicker
            open={assetPickerOpen}
            existingUrls={references.map((item) => item.url)}
            onCancel={() => setAssetPickerOpen(false)}
            onPick={(assets) => {
              setReferences((prev) => referencesFromAssets(prev, assets));
              setAssetPickerOpen(false);
              setAddPanel("root");
            }}
          />
          {modelsError ? (
            <Notice variant="error">
              {modelsError}{" "}
              {current.channelId === 0 ? (
                <Link href="/developer/keys">立即配置 API Key</Link>
              ) : (
                <Link href="/model-settings">立即配置模型</Link>
              )}
            </Notice>
          ) : null}
          {mode !== "text" && !selections.text.model ? (
            <Notice variant="warn">
              {`${CONTENT_AGENT_MODE_LABELS[mode]}模式还要一个文本模型来理解指令：切到「文本」模式选好渠道和模型后再回来。`}
            </Notice>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {AGENT_MODES.map((value) => (
              <Button
                key={value}
                type={mode === value ? "primary" : "default"}
                onClick={() => switchMode(value)}
              >
                {CONTENT_AGENT_MODE_LABELS[value]}
              </Button>
            ))}
            {/* 类型按钮右边先选渠道、再选模型；更右边才是这个模式的档位（图片像素 / 视频分辨率），
                档位跟着所选模型声明的能力走。「+」只在文本模式且紧挨类型按钮，「发送」始终贴行末 */}
            {mode === "text" ? (
              <Popover
                open={addOpen}
                onOpenChange={changeAddOpen}
                trigger="click"
                placement="topLeft"
                arrow={false}
                content={addMenu}
              >
                <Button
                  shape="circle"
                  icon={<PlusOutlined aria-hidden />}
                  aria-label="添加参考文件、资料、技能、专家、MCP 连接器或模型设置"
                />
              </Popover>
            ) : null}
            {personas.length ? (
              <Select
                style={{ width: 150 }}
                prefix="分身"
                value={currentPersonaId}
                options={[
                  { value: 0, label: "自动" },
                  ...personas.map((item) => ({
                    value: item.id,
                    label: item.name,
                  })),
                ]}
                onChange={(value: number) => void applyPersona(value)}
              />
            ) : null}
            {personas.length >= 2 && mode === "text" ? (
              <>
                <span
                  className="text-12 muted"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  多分身协作
                  <Switch
                    size="small"
                    checked={collaborate}
                    onChange={(value) => {
                      setCollaborate(value);
                      if (!value) setCollaborateIds([]);
                    }}
                  />
                </span>
                {collaborate ? (
                  <Select
                    mode="multiple"
                    style={{ minWidth: 240 }}
                    maxCount={3}
                    value={collaborateIds}
                    placeholder="选 2–3 个分身（第一位负责汇总）"
                    options={personas.map((item) => ({
                      value: item.id,
                      label: item.name,
                    }))}
                    onChange={(values: number[]) =>
                      setCollaborateIds(values.slice(0, 3))
                    }
                  />
                ) : null}
              </>
            ) : null}
            <Select
              style={{ width: 160 }}
              prefix="渠道"
              value={current.channelId}
              placeholder="先选渠道"
              options={channels}
              onChange={(value: number) => {
                void loadChannelModels(mode, value, slotDefaults[mode]);
              }}
            />
            <Select
              style={{ width: 200 }}
              prefix={`${MODEL_KIND_LABELS[mode]}模型`}
              value={current.model || undefined}
              placeholder={
                modelsLoading
                  ? "正在读取模型…"
                  : currentModels.length
                    ? "选择模型"
                    : `该渠道没有${MODEL_KIND_LABELS[mode]}模型`
              }
              options={currentModels}
              loading={modelsLoading}
              disabled={!currentModels.length}
              showSearch
              optionFilterProp="label"
              onChange={(value) =>
                setSelections((prev) => ({
                  ...prev,
                  [mode]: { ...prev[mode], model: value },
                }))
              }
            />
            {mode === "image" ? (
              imageSizeOptions.length > 1 ? (
                <Select
                  style={{ width: 130 }}
                  value={imageSize}
                  options={imageSizeOptions.map((value) => ({ value, label: value }))}
                  onChange={(value) => setImageSize(value)}
                />
              ) : null
            ) : mode === "video" ? (
              <>
                {videoResolutionOptions.length > 1 ? (
                  <Select
                    style={{ width: 110 }}
                    value={videoResolution}
                    options={videoResolutionOptions.map((value) => ({ value, label: value }))}
                    onChange={(value) => setVideoResolution(value)}
                  />
                ) : null}
                {videoDurationRange.min !== videoDurationRange.max ? (
                  <InputNumber
                    style={{ width: 100 }}
                    min={videoDurationRange.min}
                    max={videoDurationRange.max}
                    precision={0}
                    step={1}
                    suffix="秒"
                    value={videoDuration}
                    disabled={!selections.video.model}
                    onChange={(value) =>
                      setVideoDuration(
                        Math.min(
                          videoDurationRange.max,
                          Math.max(
                            videoDurationRange.min,
                            Math.round(Number(value) || videoDurationRange.min),
                          ),
                        ),
                      )
                    }
                  />
                ) : null}
                <span className="text-12 muted">超清</span>
                <Switch
                  checked={upscale}
                  onChange={(value) => setUpscale(value)}
                />
                {upscale ? (
                  <Select
                    style={{ width: 100 }}
                    value={upscaleResolution}
                    options={UPSCALE_RESOLUTIONS.map((value) => ({
                      value,
                      label: value.toUpperCase(),
                    }))}
                    onChange={(value) => setUpscaleResolution(value)}
                  />
                ) : null}
              </>
            ) : null}
            {mode !== "text" ? (
              <Button
                icon={<PaperClipOutlined aria-hidden />}
                loading={uploading}
                onClick={() => fileRef.current?.click()}
              >
                添加参考文件
              </Button>
            ) : null}
            {/* 「发送」贴行末，窄屏整簇换行；生成中点它照常提交下一轮，停止按钮在对应气泡旁 */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginLeft: "auto",
                flexWrap: "wrap",
              }}
            >
              <Button
                type="primary"
                icon={<SendOutlined aria-hidden />}
                disabled={!input.trim() || !selections.text.model || !selections[mode].model}
                onClick={() => void send()}
              >
                发送
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={Boolean(renaming)}
        title="会话改名"
        okText="保存"
        cancelText="取消"
        confirmLoading={savingRename}
        onOk={() => void saveRename()}
        onCancel={() => setRenaming(null)}
      >
        <Input
          value={renameValue}
          maxLength={30}
          placeholder="给这个会话起个名字"
          onChange={(event) => setRenameValue(event.target.value)}
        />
      </Modal>
    </div>
  );
}