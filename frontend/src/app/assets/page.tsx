"use client";

import {
  CloudUploadOutlined,
  CopyOutlined,
  FileOutlined,
  PictureOutlined,
  ReloadOutlined,
  ShareAltOutlined,
  SoundOutlined,
  TagsOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Empty,
  Input,
  Modal,
  Select,
  Skeleton,
  Tag,
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContentDigitalAsset } from "@enterprise/contracts";
import {
  contentApi,
  uploadDigitalAsset,
} from "@/api/content";
import { Notice, PageHero, Panel, TabStrip, type HeroTab } from "@/components/ui/panel";
import {
  SharedAssetsPanel,
  ShareAssetModal,
} from "./_components/shared-assets-panel";

const TYPE_LABEL: Record<string, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  file: "文件",
};
const EXT_TYPE: Record<string, string> = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  gif: "image",
  mp4: "video",
  mov: "video",
  webm: "video",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
};
const TYPE_TABS: HeroTab[] = [
  { key: "all", label: "全部" },
  { key: "image", label: "图片" },
  { key: "video", label: "视频" },
  { key: "audio", label: "音频" },
  { key: "file", label: "文件" },
];
const VIEW_TABS: HeroTab[] = [
  { key: "assets", label: "数字资产" },
  { key: "shared", label: "共享资料" },
];
const TYPES = [
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
  { value: "file", label: "文件" },
];

function typeOf(fileName: string) {
  const ext = fileName.toLowerCase().split(".").pop() || "";
  return EXT_TYPE[ext] || "file";
}

function formatSize(mb: number) {
  if (!mb) return "—";
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(mb * 1024)} KB`;
}

/**
 * 数字资产管理：完全同步 AIPDD 平台的数字资产（列表/标签/上传都走平台），本系统不落副本。
 * 支持按文件 / 图片 / 视频 / 音频筛选、关键词与标签过滤、打标和直接上传。
 */
export default function DigitalAssetsPage() {
  const { message } = App.useApp();
  const [view, setView] = useState("assets");
  const [sharing, setSharing] = useState<ContentDigitalAsset | null>(null);
  const [type, setType] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [label, setLabel] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const pageSize = 24;
  const [list, setList] = useState<ContentDigitalAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [labelOptions, setLabelOptions] = useState<string[]>([]);

  const [tagsOpen, setTagsOpen] = useState(false);
  const [editing, setEditing] = useState<ContentDigitalAsset | null>(null);
  const [draftLabels, setDraftLabels] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadForm, setUploadForm] = useState<{ type: string; name: string; labels: string[] }>({
    type: "image",
    name: "",
    labels: [],
  });
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const query = useMemo(
    () => ({
      page,
      pageSize,
      type: type === "all" ? undefined : type,
      keyword: appliedKeyword || undefined,
      label,
    }),
    [page, type, appliedKeyword, label],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await contentApi.digitalAssets({ query });
      if (result) {
        setList(result.list);
        setTotal(result.total);
      }
      setError("");
    } catch (caught) {
      setError((caught as Error).message || "数字资产读取失败");
      setList([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    contentApi
      .digitalAssetLabels()
      .then((labels) => setLabelOptions(labels || []))
      .catch(() => setLabelOptions([]));
  }, []);

  const openTags = (asset: ContentDigitalAsset) => {
    setEditing(asset);
    setDraftLabels(asset.labels);
    setTagsOpen(true);
  };

  const saveTags = async () => {
    if (!editing) return;
    setSavingTags(true);
    try {
      const updated = await contentApi.tagDigitalAsset({
        params: { id: String(editing.id) },
        body: { labels: draftLabels },
      });
      if (updated) {
        setList((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      }
      setTagsOpen(false);
      message.success("标签已保存");
    } catch (caught) {
      message.error((caught as Error).message || "标签保存失败");
    } finally {
      setSavingTags(false);
    }
  };

  const pickFile = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploadFile(file);
    const guessed = typeOf(file.name);
    setUploadForm({
      type: guessed,
      name: file.name.replace(/\.[^.]+$/, ""),
      labels: [],
    });
    if (fileRef.current) fileRef.current.value = "";
  };

  const doUpload = async () => {
    if (!uploadFile) {
      message.warning("请先选择要上传的文件");
      return;
    }
    setUploading(true);
    try {
      await uploadDigitalAsset(uploadFile, uploadForm);
      setUploadOpen(false);
      setUploadFile(null);
      message.success("已上传并登记到数字资产");
      setPage(1);
      await load();
      contentApi
        .digitalAssetLabels()
        .then((labels) => setLabelOptions(labels || []))
        .catch(() => undefined);
    } catch (caught) {
      message.error((caught as Error).message || "上传失败");
    } finally {
      setUploading(false);
    }
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      message.success("链接已复制");
    } catch {
      message.warning("浏览器不允许复制，请打开原文件再复制");
    }
  };

  const maxPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <PageHero
        title="数字资产管理"
        desc="数字资产对应本账号的 AIPDD 账号：只看/管本账号上传或生成过的资产，可打标、上传与共享；「共享资料」把资产按账号共享给企业内用户，文件仍归上传者"
        tabs={VIEW_TABS}
        activeTab={view}
        onTabChange={setView}
      />

      {view === "shared" ? (
        <SharedAssetsPanel />
      ) : (
        <>
      {error ? <Notice variant="error">{`数字资产读取失败：${error}`}</Notice> : null}

      <Panel
        title="资产列表"
        titleExtra={
          <span className="text-12 muted">
            共 {total} 条 · 仅本账号资产；打标与上传会同步到 AIPDD
          </span>
        }
        extra={
          <>
            <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void load()}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<CloudUploadOutlined aria-hidden />}
              onClick={() => {
                setUploadFile(null);
                setUploadForm({ type: "image", name: "", labels: [] });
                setUploadOpen(true);
              }}
            >
              上传资产
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          <Input.Search
            allowClear
            placeholder="按名称搜索"
            style={{ width: 260 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onSearch={(value) => {
              setAppliedKeyword(value.trim());
              setPage(1);
            }}
          />
          <Select
            allowClear
            placeholder="按标签筛选"
            style={{ width: 200 }}
            value={label}
            options={labelOptions.map((item) => ({ value: item, label: item }))}
            onChange={(value) => {
              setLabel(value);
              setPage(1);
            }}
          />
          <TabStrip
            items={TYPE_TABS}
            value={type}
            onChange={(key) => {
              setType(key);
              setPage(1);
            }}
            style={{ marginLeft: "auto" }}
          />
        </div>

        {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
        {!loading && !list.length ? (
          <Empty
            description={
              type === "all"
                ? "还没有数字资产，点右上角「上传资产」或在内容创作里生成"
                : `这个类型下还没有资产`
            }
          />
        ) : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
          }}
        >
          {list.map((asset) => (
            <div
              key={asset.id}
              style={{
                border: "1px solid var(--line, #f0f0f0)",
                borderRadius: 12,
                padding: 12,
                display: "grid",
                gap: 8,
                alignContent: "start",
              }}
            >
              <div
                style={{
                  height: 140,
                  borderRadius: 8,
                  background: "#fafafa",
                  display: "grid",
                  placeItems: "center",
                  overflow: "hidden",
                }}
              >
                {asset.type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 平台直链，不走图片优化
                  <img
                    src={asset.previewUrl || asset.url}
                    alt={asset.name || "资产"}
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                  />
                ) : asset.type === "video" ? (
                  <video
                    src={asset.url}
                    controls
                    preload="metadata"
                    style={{ maxWidth: "100%", maxHeight: "100%" }}
                  />
                ) : asset.type === "audio" ? (
                  <div style={{ display: "grid", gap: 8, justifyItems: "center", width: "100%", padding: 10 }}>
                    <SoundOutlined style={{ fontSize: 26 }} aria-hidden />
                    <audio src={asset.url} controls style={{ width: "100%" }} />
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 6, justifyItems: "center" }}>
                    <FileOutlined style={{ fontSize: 30 }} aria-hidden />
                    <span className="text-12 muted">{TYPE_LABEL[asset.type] || asset.type}</span>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {asset.type === "image" ? (
                  <PictureOutlined aria-hidden />
                ) : asset.type === "video" ? (
                  <VideoCameraOutlined aria-hidden />
                ) : asset.type === "audio" ? (
                  <SoundOutlined aria-hidden />
                ) : (
                  <FileOutlined aria-hidden />
                )}
                <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {asset.name || "未命名"}
                </strong>
                <Tag style={{ marginInlineStart: "auto" }}>
                  {TYPE_LABEL[asset.type] || asset.type}
                </Tag>
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {asset.labels.length ? (
                  asset.labels.map((item) => <Tag key={item}>{item}</Tag>)
                ) : (
                  <span className="text-12 muted">没有标签</span>
                )}
                <Button
                  type="text"
                  icon={<TagsOutlined aria-hidden />}
                  onClick={() => openTags(asset)}
                >
                  打标
                </Button>
              </div>

              <div className="text-12 muted">
                {formatSize(asset.fileSize)} · {asset.updatedAt ? asset.updatedAt.slice(0, 10) : "—"}
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Button
                  icon={<CopyOutlined aria-hidden />}
                  onClick={() => void copyLink(asset.url)}
                >
                  复制链接
                </Button>
                <Button onClick={() => window.open(asset.url, "_blank", "noopener,noreferrer")}>
                  打开原文件
                </Button>
                <Button
                  icon={<ShareAltOutlined aria-hidden />}
                  onClick={() => setSharing(asset)}
                >
                  共享
                </Button>
              </div>
            </div>
          ))}
        </div>

        {total > pageSize ? (
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 14 }}>
            <Button disabled={page <= 1} onClick={() => setPage((prev) => prev - 1)}>
              上一页
            </Button>
            <span className="text-12 muted">
              第 {page} / {maxPage} 页
            </span>
            <Button disabled={page >= maxPage} onClick={() => setPage((prev) => prev + 1)}>
              下一页
            </Button>
          </div>
        ) : null}
      </Panel>
        </>
      )}

      <Modal
        open={tagsOpen}
        title={`打标：${editing?.name || "资产"}`}
        okText="保存"
        cancelText="取消"
        confirmLoading={savingTags}
        onOk={() => void saveTags()}
        onCancel={() => setTagsOpen(false)}
      >
        <Select
          mode="tags"
          style={{ width: "100%" }}
          value={draftLabels}
          placeholder="输入标签，回车确认；也可以从已有标签里选"
          options={labelOptions.map((item) => ({ value: item, label: item }))}
          onChange={(values: string[]) => setDraftLabels(values)}
          maxCount={20}
        />
        <div className="text-12 muted" style={{ marginTop: 8 }}>
          标签会直接写到 AIPDD 平台；清空后保存＝移除全部标签。
        </div>
      </Modal>

      <Modal
        open={uploadOpen}
        title="上传资产"
        okText="上传并登记"
        cancelText="取消"
        confirmLoading={uploading}
        onOk={() => void doUpload()}
        onCancel={() => setUploadOpen(false)}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <input
            ref={fileRef}
            type="file"
            hidden
            onChange={(event) => pickFile(event.target.files)}
          />
          <Button icon={<CloudUploadOutlined aria-hidden />} onClick={() => fileRef.current?.click()}>
            选择文件
          </Button>
          <div className="text-12 muted">
            {uploadFile
              ? `${uploadFile.name}（${formatSize(uploadFile.size / 1024 / 1024)}）`
              : "支持图片、视频、音频与 pdf/zip/office/txt 等文档，单件 ≤100MB"}
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>
              资产类型
            </div>
            <Select
              style={{ width: "100%" }}
              value={uploadForm.type}
              options={TYPES}
              onChange={(value) => setUploadForm((prev) => ({ ...prev, type: value }))}
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>
              资产名称
            </div>
            <Input
              value={uploadForm.name}
              placeholder="默认用文件名"
              onChange={(event) => setUploadForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>
              标签（可选）
            </div>
            <Select
              mode="tags"
              style={{ width: "100%" }}
              value={uploadForm.labels}
              options={labelOptions.map((item) => ({ value: item, label: item }))}
              placeholder="输入或选择标签"
              onChange={(values: string[]) => setUploadForm((prev) => ({ ...prev, labels: values }))}
              maxCount={20}
            />
          </div>
        </div>
      </Modal>

      <ShareAssetModal
        asset={sharing}
        onClose={() => setSharing(null)}
        onShared={() => void load()}
      />
    </div>
  );
}