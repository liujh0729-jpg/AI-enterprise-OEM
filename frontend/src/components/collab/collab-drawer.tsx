"use client";

import { DeleteOutlined, LinkOutlined, StarFilled, StarOutlined } from "@ant-design/icons";
import { Button, Drawer, Flex, Input, Select, Space, Tag, message } from "antd";
import type { CollabTargetType } from "@enterprise/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collabApi,
  type CollabComment,
  type CollabFavorite,
  type CollabLink,
  type CollabTag,
} from "@/api/collab-base";
import { EmptyState, Notice, TabStrip } from "@/components/ui/panel";

type StaffOption = { value: string; label: string };

const TABS = [
  { key: "comments", label: "评论" },
  { key: "tags", label: "标签" },
  { key: "links", label: "资源链接" },
];

/**
 * 通用协作抽屉（方案 §5.2）：挂在任意业务对象上，按 targetType + targetId 读写评论、
 * 标签与资源链接。收藏是个人维度，放在抽屉右上角星标切换。
 */
export function CollabDrawer({
  open,
  onClose,
  targetType,
  targetId,
  title,
  staff = [],
}: {
  open: boolean;
  onClose: () => void;
  targetType: CollabTargetType;
  targetId: string;
  title?: string;
  staff?: StaffOption[];
}) {
  const [tab, setTab] = useState("comments");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [comments, setComments] = useState<CollabComment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [content, setContent] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [replyTo, setReplyTo] = useState<CollabComment | null>(null);
  const [saving, setSaving] = useState(false);

  const [tags, setTags] = useState<CollabTag[]>([]);
  const [objectTags, setObjectTags] = useState<CollabTag[]>([]);
  const [tagName, setTagName] = useState("");

  const [links, setLinks] = useState<CollabLink[]>([]);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");

  const [favorites, setFavorites] = useState<CollabFavorite[]>([]);

  const target = useMemo(
    () => ({ targetType, targetId }),
    [targetType, targetId],
  );

  const loadComments = useCallback(async () => {
    const data = await collabApi.comments({
      query: { targetType, targetId, page, pageSize: 20 },
    });
    setComments(data?.list || []);
    setTotal(data?.total || 0);
  }, [targetType, targetId, page]);

  const loadTags = useCallback(async () => {
    const [all, current] = await Promise.all([
      collabApi.tags(),
      collabApi.objectTags({ query: { targetType, targetId } }),
    ]);
    setTags(all || []);
    setObjectTags(current || []);
  }, [targetType, targetId]);

  const loadLinks = useCallback(async () => {
    setLinks((await collabApi.links({ query: { targetType, targetId } })) || []);
  }, [targetType, targetId]);

  const loadFavorites = useCallback(async () => {
    const data = await collabApi.favorites({ query: { page: 1, pageSize: 200 } });
    setFavorites(data?.list || []);
  }, []);

  useEffect(() => {
    if (!open || !targetId) return;
    setLoading(true);
    setError("");
    void Promise.all([loadComments(), loadTags(), loadLinks(), loadFavorites()])
      .catch((err) => setError(err instanceof Error ? err.message : "加载协作信息失败"))
      .finally(() => setLoading(false));
  }, [open, targetId, loadComments, loadTags, loadLinks, loadFavorites]);

  const favorited = favorites.some(
    (row) => row.targetType === targetType && row.targetId === targetId,
  );

  const submitComment = async () => {
    const text = content.trim();
    if (!text) {
      message.warning("请先输入评论内容");
      return;
    }
    setSaving(true);
    try {
      await collabApi.createComment({
        body: {
          ...target,
          content: text,
          contentHtml: "",
          parentId: replyTo?.id || 0,
          mentions,
        },
      });
      setContent("");
      setMentions([]);
      setReplyTo(null);
      setPage(1);
      await loadComments();
      message.success("已发表");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "发表失败");
    } finally {
      setSaving(false);
    }
  };

  const removeComment = async (row: CollabComment) => {
    try {
      await collabApi.removeComment({ body: { id: row.id } });
      await loadComments();
      message.success("已删除");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const addTag = async () => {
    const name = tagName.trim();
    if (!name) return;
    try {
      const created = await collabApi.saveTag({ body: { id: 0, name, color: "" } });
      if (created) await addObjectTag(created.id);
      setTagName("");
      await loadTags();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "创建标签失败");
    }
  };

  const addObjectTag = async (tagId: number) => {
    await collabApi.attachTag({ body: { ...target, tagId } });
    await loadTags();
  };

  const removeObjectTag = async (tagId: number) => {
    await collabApi.detachTag({ body: { ...target, tagId } });
    await loadTags();
  };

  const addLink = async () => {
    const url = linkUrl.trim();
    if (!url) return;
    try {
      await collabApi.addLink({ body: { ...target, url, title: linkTitle.trim(), kind: "LINK" } });
      setLinkUrl("");
      setLinkTitle("");
      await loadLinks();
      message.success("已添加链接");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "添加链接失败");
    }
  };

  const removeLink = async (id: number) => {
    try {
      await collabApi.removeLink({ body: { id } });
      await loadLinks();
      message.success("已删除链接");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除链接失败");
    }
  };

  const toggleFavorite = async () => {
    try {
      await collabApi.toggleFavorite({ body: { ...target, title: title || targetId } });
      await loadFavorites();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "收藏操作失败");
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={720}
      title={title ? `协作 · ${title}` : "协作"}
      extra={
        <Button
          type="text"
          icon={favorited ? <StarFilled style={{ color: "#faad14" }} /> : <StarOutlined />}
          onClick={() => void toggleFavorite()}
        >
          {favorited ? "已收藏" : "收藏"}
        </Button>
      }
    >
      <TabStrip items={TABS} value={tab} onChange={setTab} />
      {error ? <Notice variant="error">{error}</Notice> : null}

      {tab === "comments" ? (
        <Flex vertical gap={12} style={{ marginTop: 12 }}>
          {comments.length === 0 && !loading ? (
            <EmptyState text="还没有评论：在这里讨论任务细节、补充结论或 @ 同事。" />
          ) : null}
          {comments.map((row) => (
            <div key={row.id} className="panel" style={{ padding: 12 }}>
              <Flex justify="space-between" align="center">
                <strong>{row.authorName}</strong>
                <span className="muted text-12">
                  {new Date(row.createdAt).toLocaleString("zh-CN")}
                </span>
              </Flex>
              <div style={{ margin: "8px 0", whiteSpace: "pre-wrap" }}>{row.content}</div>
              <Space size={12}>
                <Button size="small" type="link" onClick={() => setReplyTo(row)}>
                  回复
                </Button>
                {row.canDelete ? (
                  <Button
                    size="small"
                    type="link"
                    danger
                    onClick={() => void removeComment(row)}
                  >
                    删除
                  </Button>
                ) : null}
              </Space>
            </div>
          ))}
          {total > comments.length ? (
            <Button block onClick={() => setPage((prev) => prev + 1)} loading={loading}>
              加载更多（共 {total} 条）
            </Button>
          ) : null}

          <div className="panel" style={{ padding: 12 }}>
            {replyTo ? (
              <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
                <span className="muted text-12">回复 {replyTo.authorName}</span>
                <Button size="small" type="link" onClick={() => setReplyTo(null)}>
                  取消回复
                </Button>
              </Flex>
            ) : null}
            <Input.TextArea
              rows={3}
              value={content}
              maxLength={4000}
              showCount
              placeholder="写下评论，支持 @ 同事"
              onChange={(event) => setContent(event.target.value)}
            />
            <Flex justify="space-between" align="center" style={{ marginTop: 8 }}>
              <Select
                mode="multiple"
                allowClear
                showSearch
                optionFilterProp="label"
                style={{ flex: 1, marginRight: 12 }}
                placeholder="@ 同事（可选）"
                value={mentions}
                options={staff}
                onChange={setMentions}
                maxTagCount="responsive"
              />
              <Button type="primary" loading={saving} onClick={() => void submitComment()}>
                发表
              </Button>
            </Flex>
          </div>
        </Flex>
      ) : null}

      {tab === "tags" ? (
        <Flex vertical gap={12} style={{ marginTop: 12 }}>
          <Space wrap>
            {objectTags.map((tag) => (
              <Tag key={tag.id} closable onClose={() => void removeObjectTag(tag.id)}>
                {tag.name}
              </Tag>
            ))}
            {objectTags.length === 0 ? <span className="muted">当前对象还没有标签</span> : null}
          </Space>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              value={tagName}
              placeholder="新建标签（回车添加）"
              maxLength={32}
              onChange={(event) => setTagName(event.target.value)}
              onPressEnter={() => void addTag()}
            />
            <Button onClick={() => void addTag()}>新建并添加</Button>
          </Space.Compact>
          <div>
            <div className="muted text-12" style={{ marginBottom: 6 }}>
              已有标签（点击添加）
            </div>
            <Space wrap>
              {tags
                .filter((tag) => !objectTags.some((current) => current.id === tag.id))
                .map((tag) => (
                  <Tag key={tag.id} style={{ cursor: "pointer" }} onClick={() => void addObjectTag(tag.id)}>
                    {tag.name}
                  </Tag>
                ))}
            </Space>
          </div>
        </Flex>
      ) : null}

      {tab === "links" ? (
        <Flex vertical gap={12} style={{ marginTop: 12 }}>
          {links.length === 0 && !loading ? (
            <EmptyState text="还没有资源链接：把文档、设计稿或外部链接挂在对象上，团队随时可查。" />
          ) : null}
          {links.map((row) => (
            <div key={row.id} className="panel" style={{ padding: 12 }}>
              <Flex justify="space-between" align="center">
                <a href={row.url} target="_blank" rel="noreferrer noopener">
                  <LinkOutlined /> {row.title || row.url}
                </a>
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => void removeLink(row.id)}
                />
              </Flex>
              <div className="muted text-12">
                {row.url} · {row.createdBy}
              </div>
            </div>
          ))}
          <div className="panel" style={{ padding: 12 }}>
            <Space orientation="vertical" style={{ width: "100%" }}>
              <Input
                value={linkUrl}
                placeholder="https://…"
                onChange={(event) => setLinkUrl(event.target.value)}
              />
              <Space.Compact style={{ width: "100%" }}>
                <Input
                  value={linkTitle}
                  placeholder="标题（可选）"
                  maxLength={120}
                  onChange={(event) => setLinkTitle(event.target.value)}
                />
                <Button type="primary" onClick={() => void addLink()}>
                  添加
                </Button>
              </Space.Compact>
            </Space>
          </div>
        </Flex>
      ) : null}
    </Drawer>
  );
}
