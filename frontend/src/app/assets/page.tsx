"use client";

import {
  BulbOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  DeleteOutlined,
  FileOutlined,
  PictureOutlined,
  RadarChartOutlined,
  ReloadOutlined,
  ShareAltOutlined,
  SoundOutlined,
  TagsOutlined,
  ThunderboltOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Skeleton,
  Tag,
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContentDigitalAsset } from "@enterprise/contracts";
import {
  contentApi,
  uploadDigitalAsset,
  uploadDigitalAssetDirect,
} from "@/api/content";
import { AiCopilot } from "@/components/ai-copilot";
import { Notice, PageHero, Panel, TabStrip, type HeroTab } from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";
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
const MODERATION_LABEL: Record<string, { text: string; color?: string }> = {
  pass: { text: "审核通过", color: "green" },
  block: { text: "审核拦截", color: "red" },
  pending: { text: "审核中", color: "gold" },
};

function typeOf(fileName: string) {
  const ext = fileName.toLowerCase().split(".").pop() || "";
  return EXT_TYPE[ext] || "file";
}

function formatSize(mb: number) {
  if (!mb) return "—";
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(mb * 1024)} KB`;
}

/**
 * 数字资产管理：字节统一存本站 OSS，台账按账号圈定；支持筛选、打标、上传、共享与删除。
 * 历史 AIPDD 托管资产仍可正常查看，后台迁移后自动切换为本站直链。
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
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiCaption, setAiCaption] = useState("");
  const [understandingId, setUnderstandingId] = useState<number | null>(null);
  const [similar, setSimilar] = useState<{
    asset: ContentDigitalAsset;
    list: ContentDigitalAsset[];
    scores: number[];
  } | null>(null);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

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
    setAiCaption(asset.caption || "");
    setTagsOpen(true);
  };

  /** AI 候选标签：只把建议并进当前草稿，用户确认后保存，不直接写台账。 */
  const suggestTags = async () => {
    if (!editing) return;
    setAiSuggesting(true);
    try {
      const result = await contentApi.autoTagDigitalAsset({
        params: { id: String(editing.id) },
        body: { persist: false },
      });
      if (result) {
        setDraftLabels((prev) =>
          Array.from(new Set([...prev, ...result.labels])).slice(0, 20),
        );
        if (result.caption) setAiCaption(result.caption);
        message.success(
          result.mode === "llm"
            ? "AI 已给出候选标签，确认后保存"
            : "未取到可用模型，已按文件信息给出候选标签",
        );
      }
    } catch (caught) {
      message.error((caught as Error).message || "AI 打标失败");
    } finally {
      setAiSuggesting(false);
    }
  };

  /** AI 理解：图片出画面描述、文档出摘要；结果写回台账并刷新列表。 */
  const understandAsset = async (asset: ContentDigitalAsset) => {
    setUnderstandingId(asset.id);
    try {
      const result = await contentApi.extractDigitalAsset({
        params: { id: String(asset.id) },
        body: { persist: true },
      });
      if (result) {
        message.success(
          result.mode === "llm"
            ? "AI 已理解并写回摘要与标签"
            : "未取到可用模型，已按文件信息兜底理解",
        );
        await load();
      }
    } catch (caught) {
      message.error((caught as Error).message || "AI 理解失败");
    } finally {
      setUnderstandingId(null);
    }
  };

  const openSimilar = async (asset: ContentDigitalAsset) => {
    setSimilar({ asset, list: [], scores: [] });
    setSimilarLoading(true);
    try {
      const result = await contentApi.similarDigitalAssets({
        params: { id: String(asset.id) },
        query: { limit: 12 },
      });
      setSimilar({
        asset,
        list: result?.list || [],
        scores: result?.scores || [],
      });
    } catch (caught) {
      message.error((caught as Error).message || "找相似失败");
      setSimilar(null);
    } finally {
      setSimilarLoading(false);
    }
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

  const removeAsset = async (asset: ContentDigitalAsset) => {
    setDeletingId(asset.id);
    try {
      await contentApi.deleteDigitalAsset({ params: { id: String(asset.id) } });
      setList((prev) => prev.filter((item) => item.id !== asset.id));
      setTotal((prev) => Math.max(0, prev - 1));
      message.success("资产已删除");
      if (list.length === 1 && page > 1) setPage((prev) => prev - 1);
    } catch (caught) {
      message.error((caught as Error).message || "删除失败");
    } finally {
      setDeletingId(null);
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
      // 先走浏览器直传（不经服务器中转）；桶没配 CORS 等场景自动回落服务器上传。
      let direct = true;
      try {
        await uploadDigitalAssetDirect(uploadFile, uploadForm);
      } catch {
        direct = false;
        await uploadDigitalAsset(uploadFile, uploadForm);
      }
      setUploadOpen(false);
      setUploadFile(null);
      message.success(
        `${direct ? "已通过浏览器直传上传并登记" : "已上传并登记到数字资产"}；AI 理解与送审在后台补写，稍后刷新可见`,
      );
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
        desc="数字资产对应本账号：只看/管本账号上传或生成过的资产，可打标、上传、共享与删除；字节统一存本站 OSS，「共享资料」把资产按账号共享给同组织内用户（已认证企业或服务商），文件仍归上传者"
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
            共 {total} 条 · 仅本账号资产；新上传直存本站 OSS
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
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
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
                  <RawImg
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
                {MODERATION_LABEL[asset.moderation] ? (
                  <Tag color={MODERATION_LABEL[asset.moderation].color}>
                    {MODERATION_LABEL[asset.moderation].text}
                  </Tag>
                ) : null}
                <Tag style={{ marginInlineStart: "auto" }}>
                  {TYPE_LABEL[asset.type] || asset.type}
                </Tag>
              </div>

              {asset.caption ? (
                <div
                  className="text-12 muted"
                  title={asset.caption}
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {asset.caption}
                </div>
              ) : null}

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
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
                <Button
                  type="text"
                  icon={<ThunderboltOutlined aria-hidden />}
                  loading={understandingId === asset.id}
                  onClick={() => void understandAsset(asset)}
                >
                  AI 理解
                </Button>
                <Button
                  type="text"
                  icon={<RadarChartOutlined aria-hidden />}
                  onClick={() => void openSimilar(asset)}
                >
                  找相似
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
                <Popconfirm
                  title="删除这个资产？"
                  description="删除后文件会从资产列表与共享中移除，无法恢复。"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => void removeAsset(asset)}
                >
                  <Button
                    danger
                    icon={<DeleteOutlined aria-hidden />}
                    loading={deletingId === asset.id}
                  >
                    删除
                  </Button>
                </Popconfirm>
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
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginTop: 10,
            flexWrap: "wrap",
          }}
        >
          <Button
            icon={<BulbOutlined aria-hidden />}
            loading={aiSuggesting}
            onClick={() => void suggestTags()}
          >
            AI 建议标签
          </Button>
          <span className="text-12 muted">建议只并进草稿，确认保存后才写入</span>
        </div>
        {aiCaption ? (
          <div className="text-12 muted" style={{ marginTop: 8 }}>
            AI 理解：{aiCaption}
          </div>
        ) : null}
        <div className="text-12 muted" style={{ marginTop: 8 }}>
          标签保存在本系统台账；清空后保存＝移除全部标签。
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
              : "支持图片、视频、音频与 pdf/zip/office/txt 等文档，单件 ≤100MB；上传后自动理解打标（缺模型时按文件信息兜底）"}
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

      <Modal
        open={Boolean(similar)}
        title={`找相似：${similar?.asset.name || "资产"}`}
        footer={null}
        width={640}
        onCancel={() => setSimilar(null)}
      >
        <div className="text-12 muted" style={{ marginBottom: 12 }}>
          按理解摘要与标签的语义向量比较，只在本账号资产里找最相近的条目。
        </div>
        {similarLoading ? <Skeleton active paragraph={{ rows: 4 }} /> : null}
        {!similarLoading && similar && !similar.list.length ? (
          <Empty description="还没有足够相似的资产；先给资产做「AI 理解」可提升匹配效果" />
        ) : null}
        <div style={{ display: "grid", gap: 10 }}>
          {similar?.list.map((item, index) => (
            <div
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                border: "1px solid var(--line, #f0f0f0)",
                borderRadius: 10,
                padding: 8,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 8,
                  background: "#fafafa",
                  display: "grid",
                  placeItems: "center",
                  overflow: "hidden",
                  flex: "none",
                }}
              >
                {item.type === "image" ? (
                  <RawImg
                    src={item.previewUrl || item.url}
                    alt={item.name || "资产"}
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <FileOutlined aria-hidden />
                )}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.name || "未命名"}
                </div>
                <div className="text-12 muted">
                  {TYPE_LABEL[item.type] || item.type} ·{" "}
                  {formatSize(item.fileSize)}
                </div>
              </div>
              <Tag color="blue">
                相似度 {Math.round((similar.scores[index] || 0) * 100)}%
              </Tag>
              <Button
                onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}
              >
                打开
              </Button>
            </div>
          ))}
        </div>
      </Modal>

      <ShareAssetModal
        asset={sharing}
        onClose={() => setSharing(null)}
        onShared={() => void load()}
      />

      <AiCopilot
        module="assets"
        moduleLabel="数字资产"
        context={`当前视图：${
          VIEW_TABS.find((item) => item.key === view)?.label || view
        }；本账号资产 ${total} 条`}
        suggestions={["这批素材适合怎么用", "帮我挑几条做封面"]}
      />
    </div>
  );
}