"use client";

import {
  DeleteOutlined,
  LockOutlined,
  StarFilled,
  StarOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { App, Button, Drawer, Rate, Space, Tag } from "antd";
import { useEffect, useState } from "react";
import type { VideoTemplateDetail } from "@enterprise/contracts";
import { contentApi } from "@/api/content";
import { EmptyState } from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";

function timeText(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

/**
 * 模版详情抽屉（参考 liblib 视频特效页）：左侧样片、右侧配方与操作。
 * 付费模版在未解锁前照样能看样片，但提示词 / 参考图 / 发布者模型只显示锁态。
 */
export function TemplateDrawer({
  id,
  open,
  onClose,
  onChanged,
  onUse,
}: {
  id: number;
  open: boolean;
  onClose: () => void;
  onChanged: (id: number, patch: Partial<{ favoriteCount: number; favorited: boolean; ratingAvg: number; ratingCount: number; myRating: number; useCount: number; viewCount: number }>) => void;
  onUse: (detail: VideoTemplateDetail) => void;
}) {
  const { message, modal } = App.useApp();
  const [detail, setDetail] = useState<VideoTemplateDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!open || !id) return;
    setLoading(true);
    setDetail(null);
    contentApi
      .videoTemplate({ params: { id: String(id) } })
      .then((data) => setDetail(data || null))
      .catch((caught) => message.error((caught as Error).message || "模版详情读取失败"))
      .finally(() => setLoading(false));
  }, [open, id, message]);

  const toggleFavorite = async () => {
    if (!detail) return;
    setBusy("favorite");
    try {
      const result = detail.favorited
        ? await contentApi.unfavoriteVideoTemplate({ params: { id: String(detail.id) } })
        : await contentApi.favoriteVideoTemplate({ params: { id: String(detail.id) } });
      if (!result) return;
      setDetail({ ...detail, favorited: result.favorited, favoriteCount: result.favoriteCount });
      onChanged(detail.id, { favorited: result.favorited, favoriteCount: result.favoriteCount });
    } catch (caught) {
      message.error((caught as Error).message || "操作失败");
    } finally {
      setBusy("");
    }
  };

  const payToView = () => {
    if (!detail) return;
    modal.confirm({
      title: "查看配方",
      content: `本次查看将扣除 ${detail.viewCost} 积分，积分由发布者获得；同一模版只需支付一次。`,
      okText: "确认支付",
      okButtonProps: { danger: false },
      onOk: async () => {
        setBusy("view");
        try {
          const next = await contentApi.viewVideoTemplate({ params: { id: String(detail.id) } });
          if (!next) return;
          setDetail(next);
          onChanged(detail.id, { viewCount: next.viewCount });
          message.success("已解锁配方");
        } catch (caught) {
          message.error((caught as Error).message || "支付失败");
        } finally {
          setBusy("");
        }
      },
    });
  };

  const rate = async (score: number) => {
    if (!detail) return;
    try {
      const result = await contentApi.rateVideoTemplate({
        params: { id: String(detail.id) },
        body: { score },
      });
      if (!result) return;
      setDetail({
        ...detail,
        myRating: result.myRating,
        ratingAvg: result.ratingAvg,
        ratingCount: result.ratingCount,
      });
      onChanged(detail.id, {
        myRating: result.myRating,
        ratingAvg: result.ratingAvg,
        ratingCount: result.ratingCount,
      });
      message.success("评分已更新");
    } catch (caught) {
      message.error((caught as Error).message || "评分失败");
    }
  };

  const remove = () => {
    if (!detail) return;
    modal.confirm({
      title: "删除这个模版",
      content: "删除后收藏、评分与查看记录一并清除，且不可恢复。",
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await contentApi.removeVideoTemplate({ params: { id: String(detail.id) } });
          message.success("已删除");
          onClose();
          onChanged(detail.id, {});
        } catch (caught) {
          message.error((caught as Error).message || "删除失败");
        }
      },
    });
  };

  return (
    <Drawer
      open={open}
      size="large"
      destroyOnHidden
      title={detail?.title || "模版详情"}
      onClose={onClose}
      extra={
        detail ? (
          <Space size={8}>
            <Button
              icon={detail.favorited ? <StarFilled style={{ color: "#faad14" }} /> : <StarOutlined />}
              loading={busy === "favorite"}
              onClick={() => void toggleFavorite()}
            >
              {detail.favorited ? "已收藏" : "收藏"}
            </Button>
            {detail.canManage ? (
              <Button danger icon={<DeleteOutlined />} onClick={remove}>
                删除
              </Button>
            ) : null}
          </Space>
        ) : null
      }
    >
      {loading ? (
        <EmptyState text="正在读取模版…" />
      ) : !detail ? (
        <EmptyState text="模版不存在或已下架。" />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 18 }}>
          <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
            <video
              src={detail.sampleUrl}
              poster={detail.coverUrl || undefined}
              controls
              style={{ width: "100%", borderRadius: 12, background: "#000", aspectRatio: "9 / 12", objectFit: "contain" }}
            />
            <Space size={6} wrap>
              <Tag color="blue">{detail.videoTypeLabel}</Tag>
              {detail.source === "AIWORKIN" ? <Tag color="purple">AIWORKIN</Tag> : null}
              {detail.locked ? <Tag color="gold">付费配方</Tag> : null}
              {detail.mine ? <Tag color="green">我发布的</Tag> : null}
            </Space>
            <div className="text-12 muted">发布：{timeText(detail.createdAt)}</div>
          </div>
          <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Rate
                allowHalf
                value={detail.ratingAvg}
                disabled
                style={{ fontSize: 14 }}
              />
              <span className="text-12 muted">
                {detail.ratingAvg || 0} 分 · {detail.ratingCount} 人评分
              </span>
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }} className="text-12 muted">
              <span>{detail.ownerName}</span>
              <span>{detail.useCount} 次使用</span>
              <span>{detail.viewCount} 次查看</span>
              <span>{detail.favoriteCount} 收藏</span>
              <span>{detail.viewCost > 0 ? `查看需 ${detail.viewCost} 积分` : "免费查看"}</span>
            </div>
            {detail.description ? (
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{detail.description}</div>
            ) : null}
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                我的评分
              </div>
              <Rate value={detail.myRating} onChange={(value) => void rate(value)} />
            </div>
            {detail.locked ? (
              <div
                style={{
                  border: "1px dashed var(--line, #d9d9d9)",
                  borderRadius: 12,
                  padding: 16,
                  display: "grid",
                  gap: 10,
                  justifyItems: "center",
                }}
              >
                <LockOutlined style={{ fontSize: 24, color: "#faad14" }} />
                <div style={{ textAlign: "center" }}>
                  配方需 {detail.viewCost} 积分解锁：提示词、参考图与发布者所用模型会在支付后展示，
                  积分由发布者获得，同一模版只扣一次。
                </div>
                <Button
                  type="primary"
                  loading={busy === "view"}
                  onClick={payToView}
                >
                  支付 {detail.viewCost} 积分查看
                </Button>
              </div>
            ) : (
              <>
                <div>
                  <div className="text-12 muted" style={{ marginBottom: 6 }}>
                    生成提示词
                  </div>
                  <pre
                    className="mono text-12"
                    style={{
                      whiteSpace: "pre-wrap",
                      background: "#f7f7f7",
                      borderRadius: 10,
                      padding: 12,
                      margin: 0,
                    }}
                  >
                    {detail.prompt || "—"}
                  </pre>
                </div>
                <div>
                  <div className="text-12 muted" style={{ marginBottom: 6 }}>
                    参考图
                  </div>
                  {detail.referenceImages.length ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {detail.referenceImages.map((url) => (
                        <RawImg
                          key={url}
                          src={url}
                          alt="参考图"
                          style={{ width: 88, height: 88, objectFit: "cover", borderRadius: 8 }}
                        />
                      ))}
                    </div>
                  ) : (
                    <span className="text-12 muted">发布者没有上传参考图</span>
                  )}
                </div>
                <div className="text-12 muted">
                  发布者所用模型：{detail.modelChannelName || "—"} / {detail.modelName || "—"}
                </div>
                <Button
                  type="primary"
                  size="large"
                  icon={<ThunderboltOutlined />}
                  onClick={() => onUse(detail)}
                >
                  使用模版生成
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
