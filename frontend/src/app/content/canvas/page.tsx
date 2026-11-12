"use client";

import { DeleteOutlined, EditOutlined, PlusOutlined, PictureOutlined } from "@ant-design/icons";
import { App, Button, Card, Input, Modal, Skeleton, Tag } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { CanvasProjectSummary } from "@enterprise/contracts";
import { contentApi } from "@/api/content";
import { EmptyState, Notice, PageHero, Panel } from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";
import { ImageStudio } from "@/components/content/image-studio";
import { MusicStudio } from "@/components/content/music-studio";
import { VideoStudio } from "@/components/content/video-studio";

const TABS = [
  { key: "canvas", label: "我的画布" },
  { key: "image", label: "生图工作台" },
  { key: "video", label: "视频创作台" },
  { key: "music", label: "音乐创作台" },
];

function CanvasLibrary() {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [rows, setRows] = useState<CanvasProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [applied, setApplied] = useState("");
  const [creating, setCreating] = useState(false);
  const [rename, setRename] = useState<{ id: number; title: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await contentApi.canvases({
        query: { page: 1, pageSize: 60, keyword: applied || undefined },
      });
      setRows(result?.list || []);
      setError("");
    } catch (caught) {
      setError((caught as Error).message || "画布列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [applied]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const row = await contentApi.createCanvas({ body: { title: "未命名画布" } });
      if (row) router.push(`/content/canvas/${row.id}`);
    } catch (caught) {
      message.error((caught as Error).message || "新建画布失败");
    } finally {
      setCreating(false);
    }
  };

  const remove = (row: CanvasProjectSummary) => {
    modal.confirm({
      title: `删除画布「${row.title}」？`,
      content: "画布快照会一并删除；已生成的产物在数字资产里保留。",
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await contentApi.deleteCanvas({ params: { id: String(row.id) } });
          setRows((prev) => prev.filter((item) => item.id !== row.id));
        } catch (caught) {
          message.error((caught as Error).message || "删除失败");
        }
      },
    });
  };

  const saveRename = async () => {
    if (!rename?.title.trim()) {
      message.warning("画布名称不能为空");
      return;
    }
    try {
      const row = await contentApi.renameCanvas({
        params: { id: String(rename.id) },
        body: { title: rename.title.trim() },
      });
      if (row) {
        setRows((prev) =>
          prev.map((item) => (item.id === row.id ? { ...item, title: row.title } : item)),
        );
      }
      setRename(null);
    } catch (caught) {
      message.error((caught as Error).message || "改名失败");
    }
  };

  return (
    <Panel
      title="我的画布"
      titleExtra={<span className="text-12 muted">仅本人可见</span>}
      extra={
        <div style={{ display: "flex", gap: 8 }}>
          <Input.Search
            allowClear
            placeholder="按名称查找"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onSearch={(value) => setApplied(value.trim())}
            style={{ width: 200 }}
          />
          <Button type="primary" icon={<PlusOutlined />} loading={creating} onClick={() => void create()}>
            新建画布
          </Button>
        </div>
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      {loading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : !rows.length ? (
        <EmptyState
          text="还没有画布：新建一张，把提示词、数字资产素材与生成节点连起来"
          action={
            <Button icon={<PlusOutlined />} onClick={() => void create()}>
              新建画布
            </Button>
          }
        />
      ) : (
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          }}
        >
          {rows.map((row) => (
            <Card
              key={row.id}
              hoverable
              onClick={() => router.push(`/content/canvas/${row.id}`)}
              cover={
                row.coverUrl ? (
                  <RawImg
                    src={row.coverUrl}
                    alt=""
                    style={{ width: "100%", height: 130, objectFit: "cover" }}
                  />
                ) : (
                  <div
                    style={{
                      height: 130,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--muted, #999)",
                      background: "var(--fill, #fafafa)",
                    }}
                  >
                    <PictureOutlined aria-hidden style={{ fontSize: 22 }} />
                  </div>
                )
              }
            >
              <Card.Meta
                title={row.title}
                description={
                  <span className="text-12 muted">
                    {`${row.nodeCount} 个节点 · v${row.version}`}
                  </span>
                }
              />
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                {row.assetRefs.length ? (
                  <Tag style={{ marginInlineEnd: 0 }}>{`引用 ${row.assetRefs.length} 个素材`}</Tag>
                ) : null}
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined />}
                  style={{ marginLeft: "auto" }}
                  onClick={(event) => {
                    event.stopPropagation();
                    setRename({ id: row.id, title: row.title });
                  }}
                />
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={(event) => {
                    event.stopPropagation();
                    remove(row);
                  }}
                />
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal
        title="重命名画布"
        open={Boolean(rename)}
        okText="保存"
        onOk={() => void saveRename()}
        onCancel={() => setRename(null)}
        destroyOnHidden
      >
        <Input
          maxLength={120}
          value={rename?.title || ""}
          onChange={(event) =>
            setRename((prev) => (prev ? { ...prev, title: event.target.value } : prev))
          }
        />
      </Modal>
    </Panel>
  );
}

/**
 * AI 画布：一个入口四个 Tab（我的画布 / 生图工作台 / 视频创作台 / 音乐创作台）。
 * 当前 Tab 记在 ?tab= 里，刷新与分享链接都能回到同一页；编辑器是独立页 /content/canvas/[id]。
 */
export default function CanvasPage() {
  const router = useRouter();
  const search = useSearchParams();
  const fromUrl = search.get("tab") || "";
  const [tab, setTab] = useState(TABS.some((item) => item.key === fromUrl) ? fromUrl : "canvas");

  useEffect(() => {
    if (fromUrl && TABS.some((item) => item.key === fromUrl)) setTab(fromUrl);
  }, [fromUrl]);

  const change = (key: string) => {
    setTab(key);
    router.replace(key === "canvas" ? "/content/canvas" : `/content/canvas?tab=${key}`);
  };

  return (
    <div>
      <PageHero
        title="AI 画布"
        desc="在我的画布里用节点编排创作（提示词 / 数字资产素材 / 模型配置 / 生成），也可以直接在生图、视频、音乐工作台里出片出曲。生成任务都可取消与重试；产物统一进数字资产。画布仅本人可见，生成出来的产物按数字资产的共享规则处理。"
        tabs={TABS}
        activeTab={tab}
        onTabChange={change}
      />
      {tab === "image" ? (
        <ImageStudio />
      ) : tab === "video" ? (
        <VideoStudio />
      ) : tab === "music" ? (
        <MusicStudio />
      ) : (
        <CanvasLibrary />
      )}
    </div>
  );
}
