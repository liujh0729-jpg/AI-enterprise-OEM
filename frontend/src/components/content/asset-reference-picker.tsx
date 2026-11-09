"use client";

import type {
  ContentAgentReference,
  ContentDigitalAsset,
} from "@enterprise/contracts";
import { Checkbox, Input, Modal, Skeleton, Tag } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { contentApi } from "@/api/content";
import { Notice, PillTabs } from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";

export type ReferenceMedia = ContentAgentReference["media"];

export const REFERENCE_MEDIA_LABEL: Record<ReferenceMedia, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
};

const REFERENCE_MEDIA: ReferenceMedia[] = ["image", "video", "audio"];

export function isReferenceMedia(value: string): value is ReferenceMedia {
  return REFERENCE_MEDIA.includes(value as ReferenceMedia);
}

/** 参考文件按类型从 1 编号（图片1 / 视频1 / 音频1），删掉中间的也不重排。 */
export function nextReferenceLabel(
  references: ContentAgentReference[],
  media: ReferenceMedia,
) {
  const used = references
    .filter((item) => item.media === media)
    .map((item) => Number((/^[^\d]*(\d+)$/.exec(item.label) || [])[1]) || 0);
  return `${REFERENCE_MEDIA_LABEL[media]}${Math.max(0, ...used) + 1}`;
}

/** 数字资产 → 参考文件：按选择顺序接着已有编号往后排，重复地址直接跳过。 */
export function referencesFromAssets(
  existing: ContentAgentReference[],
  assets: ContentDigitalAsset[],
) {
  const next = [...existing];
  for (const asset of assets) {
    if (!isReferenceMedia(asset.type)) continue;
    if (next.some((item) => item.url === asset.url)) continue;
    next.push({
      label: nextReferenceLabel(next, asset.type),
      fileName: asset.name || asset.url.split("/").pop() || asset.url,
      url: asset.url,
      media: asset.type,
    });
  }
  return next;
}

const ALL_FILTERS = [
  { key: "all", label: "全部" },
  { key: "image", label: "图片" },
  { key: "video", label: "视频" },
  { key: "audio", label: "音频" },
];

const TYPE_LABEL: Record<string, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
};

function formatSize(mb: number) {
  if (!mb) return "—";
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(mb * 1024)} KB`;
}

/**
 * 从数字资产里挑参考文件：只列图片 / 视频 / 音频，本地已加过的按地址去重。
 * Agent 对话与定时任务的「+ → 添加参考文件」共用这一个弹窗。
 */
export function AssetReferencePicker({
  open,
  existingUrls,
  onCancel,
  onPick,
  mediaTypes = REFERENCE_MEDIA,
}: {
  open: boolean;
  existingUrls: string[];
  onCancel: () => void;
  onPick: (assets: ContentDigitalAsset[]) => void;
  /** 只列这几类素材；视频复刻等场景只收图片。 */
  mediaTypes?: ReferenceMedia[];
}) {
  const [filter, setFilter] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [assets, setAssets] = useState<ContentDigitalAsset[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setFilter("all");
    setKeyword("");
    setAppliedKeyword("");
    setPicked([]);
  }, [open]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await contentApi.digitalAssets({
        query: {
          page: 1,
          pageSize: 100,
          type: filter === "all" ? undefined : filter,
          keyword: appliedKeyword || undefined,
        },
      });
      setAssets(
        (result?.list || []).filter(
          (item) => isReferenceMedia(item.type) && mediaTypes.includes(item.type),
        ),
      );
      setError("");
    } catch (caught) {
      setAssets([]);
      setError((caught as Error).message || "数字资产读取失败");
    } finally {
      setLoading(false);
    }
  }, [filter, appliedKeyword, mediaTypes]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const existing = useMemo(() => new Set(existingUrls), [existingUrls]);
  const pickedAssets = assets.filter((item) => picked.includes(item.id));
  const filters = useMemo(
    () =>
      ALL_FILTERS.filter(
        (item) => item.key === "all" || mediaTypes.includes(item.key as ReferenceMedia),
      ),
    [mediaTypes],
  );

  return (
    <Modal
      open={open}
      title="从数字资产选择参考文件"
      okText={picked.length ? `添加 ${picked.length} 个` : "添加"}
      okButtonProps={{ disabled: !picked.length }}
      onOk={() => onPick(pickedAssets)}
      onCancel={onCancel}
      width={720}
      destroyOnHidden
    >
      <div style={{ display: "grid", gap: 10 }}>
        <span className="text-12 muted">
          {`只收${mediaTypes.map((item) => REFERENCE_MEDIA_LABEL[item]).join(" / ")}；选中后自动编号，可用 @ 在提示词里引用。`}
        </span>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <PillTabs
            items={filters}
            value={filter}
            onChange={setFilter}
            size="small"
            variant="soft"
          />
          <Input.Search
            allowClear
            placeholder="搜索资产名"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onSearch={(value) => setAppliedKeyword(value.trim())}
            style={{ width: 220, marginLeft: "auto" }}
          />
        </div>
        {error ? <Notice variant="error">{error}</Notice> : null}
        {loading ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : !assets.length ? (
          <Notice variant="info">
            {`数字资产里还没有${mediaTypes.map((item) => REFERENCE_MEDIA_LABEL[item]).join(" / ")}。先到`}
            <Link href="/assets">数字资产管理</Link>
            {"上传一份。"}
          </Notice>
        ) : (
          <div
            style={{ display: "grid", gap: 6, maxHeight: 360, overflowY: "auto" }}
          >
            {assets.map((asset) => {
              const added = existing.has(asset.url);
              return (
                <label
                  key={asset.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 8px",
                    border: "1px solid var(--line, #f0f0f0)",
                    borderRadius: 8,
                    cursor: added ? "not-allowed" : "pointer",
                    opacity: added ? 0.6 : 1,
                  }}
                >
                  <Checkbox
                    checked={added || picked.includes(asset.id)}
                    disabled={added}
                    onChange={(event) =>
                      setPicked((prev) =>
                        event.target.checked
                          ? [...prev, asset.id]
                          : prev.filter((id) => id !== asset.id),
                      )
                    }
                  />
                  {asset.type === "image" && asset.previewUrl ? (
                    <RawImg
                      src={asset.previewUrl}
                      alt=""
                      style={{
                        width: 36,
                        height: 36,
                        objectFit: "cover",
                        borderRadius: 6,
                      }}
                    />
                  ) : null}
                  <span
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {asset.name || asset.url}
                    </span>
                    <span className="text-12 muted">
                      {`${TYPE_LABEL[asset.type] || asset.type} · ${formatSize(asset.fileSize)}`}
                      {asset.labels.length
                        ? ` · ${asset.labels.slice(0, 3).join("、")}`
                        : ""}
                    </span>
                  </span>
                  {added ? (
                    <Tag style={{ marginLeft: "auto", marginInlineEnd: 0 }}>
                      已添加
                    </Tag>
                  ) : null}
                </label>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
