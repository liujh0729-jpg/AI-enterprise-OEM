"use client";

import { FileImageOutlined, PlayCircleOutlined, SoundOutlined } from "@ant-design/icons";
import { Input, Popover, Skeleton } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasMentionRef, ContentDigitalAsset } from "@enterprise/contracts";
import { contentApi } from "@/api/content";
import {
  isReferenceMedia,
  REFERENCE_MEDIA_LABEL,
  type ReferenceMedia,
} from "@/components/content/asset-reference-picker";
import { RawImg } from "@/components/ui/raw-img";

/** 生成节点能 @ 的素材类型：生图只收图片，视频三类都收，音乐不走参考素材。 */
export const MENTION_MEDIA: Record<"image" | "video" | "music", ReferenceMedia[]> = {
  image: ["image"],
  video: ["image", "video", "audio"],
  music: [],
};

export type MentionCandidate = {
  /** 提示词里的记号（图片1 / 视频1 / 音频1） */
  label: string;
  media: ReferenceMedia;
  name: string;
  url: string;
  previewUrl?: string;
  assetId: number;
  /** wired＝连线进来的（已经喂给生成，选中只插记号）；library＝数字资产（选中随节点存进 doc） */
  source: "wired" | "library";
  /** 连线角色（素材 / 首帧 / 尾帧），只有连线资源有 */
  roleLabel?: string;
};

const MEDIA_ICON: Record<ReferenceMedia, React.ReactNode> = {
  image: <FileImageOutlined aria-hidden />,
  video: <PlayCircleOutlined aria-hidden />,
  audio: <SoundOutlined aria-hidden />,
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 记号是否还在提示词里（@图片1 与 @图片11 要分得开，数字后缀不算命中）。 */
export function mentionAlive(text: string, label: string) {
  return new RegExp(`@${escapeRegExp(label)}(?!\\d)`).test(text);
}

/** 下一个可用记号：按类型从 1 起，接着已用过的往后排（图片1 / 视频1 / 音频1）。 */
export function nextMentionLabel(used: string[], media: ReferenceMedia) {
  const prefix = REFERENCE_MEDIA_LABEL[media];
  const max = used.reduce((acc, label) => {
    if (!label.startsWith(prefix)) return acc;
    const num = Number((/^[^\d]*(\d+)$/.exec(label) || [])[1]) || 0;
    return num > acc ? num : acc;
  }, 0);
  return `${prefix}${max + 1}`;
}

/** 连线素材按后端口径编号：入边先按角色排序，再按类型从 1 起连续编号。 */
export function wiredMentions(
  rows: { role: string; media: ReferenceMedia; name: string; url: string; previewUrl?: string; assetId: number }[],
): MentionCandidate[] {
  const counters: Record<ReferenceMedia, number> = { image: 0, video: 0, audio: 0 };
  const out: MentionCandidate[] = [];
  for (const row of rows) {
    if (!row.url) continue;
    // 同一地址只算一份（后端也是按地址去重的）
    if (out.some((item) => item.url === row.url)) continue;
    counters[row.media] += 1;
    out.push({
      label: `${REFERENCE_MEDIA_LABEL[row.media]}${counters[row.media]}`,
      media: row.media,
      name: row.name || row.url,
      url: row.url,
      previewUrl: row.previewUrl,
      assetId: row.assetId,
      source: "wired",
      roleLabel: row.role,
    });
  }
  return out;
}

/**
 * 提示词输入框：敲 @ 打开资源菜单——上游连进来的素材（已喂给生成，选中只插记号）
 * 与数字资产（选中后随节点存进 doc，由后端并进参考素材）。记号删掉即解除引用。
 */
export function MentionField({
  value,
  onChange,
  refs,
  onRefsChange,
  wired,
  mediaTypes,
  placeholder,
  className,
  variant,
  rows,
  autoSize,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  refs: CanvasMentionRef[];
  onRefsChange: (refs: CanvasMentionRef[]) => void;
  wired: MentionCandidate[];
  /** 允许 @ 的素材类型；空数组＝这个节点不接素材，退回普通输入框 */
  mediaTypes: ReferenceMedia[];
  placeholder?: string;
  className?: string;
  variant?: "outlined" | "borderless" | "filled";
  rows?: number;
  autoSize?: { minRows: number; maxRows: number };
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [triggerAt, setTriggerAt] = useState(-1);
  const [library, setLibrary] = useState<ContentDigitalAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const caretRef = useRef(0);
  // 事件里直接抓真实 textarea：Popover 会克隆子元素，组件 ref 不一定留得住
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const enabled = mediaTypes.length > 0 && !disabled;
  const mediaKey = mediaTypes.join(",");

  useEffect(() => {
    if (!open) return;
    const allowed = mediaKey ? (mediaKey.split(",") as ReferenceMedia[]) : [];
    if (!allowed.length) return;
    setKeyword("");
    setError("");
    setLoading(true);
    let alive = true;
    void contentApi
      .digitalAssets({
        query: {
          page: 1,
          pageSize: 100,
          type: allowed.length === 1 ? allowed[0] : undefined,
        },
      })
      .then((result) => {
        if (!alive) return;
        setLibrary(
          (result?.list || []).filter(
            (item) => isReferenceMedia(item.type) && allowed.includes(item.type),
          ),
        );
      })
      .catch((caught) => {
        if (!alive) return;
        setLibrary([]);
        setError((caught as Error).message || "数字资产读取失败");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, mediaKey]);

  const ownedUrls = useMemo(
    () => new Set([...wired.map((item) => item.url), ...refs.map((item) => item.url)]),
    [wired, refs],
  );
  const wiredRows = useMemo(
    () => wired.filter((item) => mediaTypes.includes(item.media)),
    // mediaTypes 是 MENTION_MEDIA 里的常量数组，身份稳定
    [wired, mediaTypes],
  );
  const libraryRows = useMemo(() => {
    const word = keyword.trim().toLowerCase();
    return library.filter(
      (item) =>
        !ownedUrls.has(item.url) &&
        (!word || (item.name || item.url).toLowerCase().includes(word)),
    );
  }, [library, ownedUrls, keyword]);

  const close = () => {
    setOpen(false);
    setTriggerAt(-1);
  };

  // 菜单由 @ 触发（Popover 无内置 trigger）：点到菜单和输入框以外的地方就收起
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".cv-mention-panel, .cv-mention-anchor")) return;
      close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  /** 提示词改动后把已不在文本里的记号对应的引用摘掉，引用始终和文本一致。 */
  const apply = useCallback(
    (text: string) => {
      onChange(text);
      const alive = refs.filter((ref) => mentionAlive(text, ref.label));
      if (alive.length !== refs.length) onRefsChange(alive);
    },
    [onChange, onRefsChange, refs],
  );

  const pick = (candidate: MentionCandidate) => {
    let label = candidate.label;
    if (candidate.source === "library") {
      label = nextMentionLabel(
        [...wired.map((item) => item.label), ...refs.map((item) => item.label)],
        candidate.media,
      );
      onRefsChange([
        ...refs,
        {
          label,
          media: candidate.media,
          assetId: candidate.assetId,
          name: candidate.name,
          url: candidate.url,
        },
      ]);
    }
    const caret = triggerAt >= 0 ? triggerAt : caretRef.current;
    const next =
      value[caret] === "@"
        ? `${value.slice(0, caret)}@${label} ${value.slice(caret + 1)}`
        : `${value}${value && !value.endsWith(" ") ? " " : ""}@${label} `;
    apply(next);
    close();
    areaRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    areaRef.current = event.currentTarget;
    if (!enabled) return;
    caretRef.current = event.currentTarget.selectionStart ?? 0;
    if (event.key === "@") {
      setTriggerAt(caretRef.current);
      setOpen(true);
      return;
    }
    if (event.key === "Escape") {
      close();
      return;
    }
    if (open && !["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"].includes(event.key)) {
      close();
    }
  };

  const thumb = (candidate: MentionCandidate) =>
    candidate.media === "image" && (candidate.previewUrl || candidate.url) ? (
      <RawImg className="cv-mention-thumb" src={candidate.previewUrl || candidate.url} alt="" />
    ) : (
      <span className="cv-mention-thumb cv-mention-thumb-ph">{MEDIA_ICON[candidate.media]}</span>
    );

  const panel = (
    <div className="cv-mention-panel">
      <div className="cv-mention-group">
        <div className="cv-mention-title">上游连进来的素材</div>
        {wiredRows.length ? (
          wiredRows.map((item) => (
            <button
              type="button"
              key={`w-${item.url}`}
              className="cv-mention-row"
              onClick={() => pick(item)}
            >
              {thumb(item)}
              <span className="cv-mention-name">{item.name}</span>
              <span className="cv-mention-token">{`@${item.label}`}</span>
              {item.roleLabel && item.roleLabel !== "素材" ? (
                <span className="cv-mention-role">{item.roleLabel}</span>
              ) : null}
            </button>
          ))
        ) : (
          <div className="cv-mention-empty">
            这个节点还没有素材连进来；也可以直接挑下面的数字资产，用 @ 引用。
          </div>
        )}
      </div>
      <div className="cv-mention-group">
        <div className="cv-mention-title">数字资产</div>
        <Input
          size="small"
          allowClear
          placeholder="搜索资产名"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        {error ? <div className="cv-mention-empty">{error}</div> : null}
        {loading ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : libraryRows.length ? (
          libraryRows.map((item) => (
            <button
              type="button"
              key={`l-${item.id}`}
              className="cv-mention-row"
              onClick={() =>
                pick({
                  label: "",
                  media: item.type as ReferenceMedia,
                  name: item.name || item.url,
                  url: item.url,
                  previewUrl: item.previewUrl || item.url,
                  assetId: item.id,
                  source: "library",
                })
              }
            >
              {item.type === "image" && (item.previewUrl || item.url) ? (
                <RawImg className="cv-mention-thumb" src={item.previewUrl || item.url} alt="" />
              ) : (
                <span className="cv-mention-thumb cv-mention-thumb-ph">
                  {MEDIA_ICON[item.type as ReferenceMedia]}
                </span>
              )}
              <span className="cv-mention-name">{item.name || item.url}</span>
              <span className="cv-mention-role">{REFERENCE_MEDIA_LABEL[item.type as ReferenceMedia]}</span>
            </button>
          ))
        ) : (
          <div className="cv-mention-empty">
            {`数字资产里没有可用的${mediaTypes.map((item) => REFERENCE_MEDIA_LABEL[item]).join(" / ")}素材；先到「数字资产管理」上传。`}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <Popover
      open={open && enabled}
      content={panel}
      trigger={[]}
      arrow={false}
      placement="topLeft"
      getPopupContainer={() => document.body}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <Input.TextArea
        className={[className, "cv-mention-anchor"].filter(Boolean).join(" ")}
        value={value}
        placeholder={placeholder}
        variant={variant}
        disabled={disabled}
        rows={rows}
        autoSize={autoSize}
        onChange={(event) => apply(event.target.value)}
        onKeyDown={onKeyDown}
        onSelect={(event) => {
          areaRef.current = event.currentTarget;
          caretRef.current = event.currentTarget.selectionStart ?? 0;
        }}
      />
    </Popover>
  );
}
