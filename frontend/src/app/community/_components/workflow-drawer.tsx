"use client";

import {
  App,
  Button,
  Drawer,
  Image,
  Space,
  Spin,
  Tag,
  Tooltip,
} from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  HeartFilled,
  HeartOutlined,
  LinkOutlined,
  PlayCircleOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useState } from "react";
import { communityApi } from "@/api/community";
import { Notice, Panel } from "@/components/ui/panel";
import type {
  CommunityCredentialStatus,
  CommunityRun,
  CommunityWorkflowDetail,
} from "@enterprise/contracts";
import {
  SlotFields,
  initialSlotValues,
  missingRequiredSlots,
  type SlotValues,
} from "./slot-fields";
import { RunBlock, timeText } from "./run-list";

/** 进行中的运行多久拉一次状态：上游本身也是排队 + 进度逐步补全，太快只是白打接口。 */
const POLL_MS = 6000;

/**
 * 工作流详情抽屉：说明 + 参数表单 + 立即运行 + 我的产物。
 * 运行永远在上游 Comfy Cloud 上排队执行，这里只提交一次、然后轮询本站的运行台账。
 */
export function WorkflowDrawer({
  code,
  onClose,
  credential,
  onConnect,
  onEdit,
  onCountChange,
}: {
  code: string;
  onClose: () => void;
  credential: CommunityCredentialStatus | null;
  onConnect: () => void;
  onEdit: (detail: CommunityWorkflowDetail) => void;
  onCountChange: (code: string, patch: Partial<{ favoriteCount: number; likeCount: number; favorited: boolean; liked: boolean }>) => void;
}) {
  const { message, modal } = App.useApp();
  const [detail, setDetail] = useState<CommunityWorkflowDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [values, setValues] = useState<SlotValues>({});
  const [runs, setRuns] = useState<CommunityRun[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadRuns = useCallback(async (workflowCode: string) => {
    try {
      const page = await communityApi.myRuns({
        query: { page: 1, pageSize: 8, workflowCode },
      });
      setRuns(page?.list || []);
    } catch {
      // 运行台账读不到不影响看详情，静默即可（下一次轮询还会再试）
    }
  }, []);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    communityApi
      .detail({ params: { code } })
      .then((data) => {
        if (cancelled || !data) return;
        setDetail(data);
        setValues(initialSlotValues(data.slots));
        void loadRuns(code);
      })
      .catch((caught) => {
        if (!cancelled) message.error((caught as Error).message || "工作流详情读取失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  /** 有进行中的运行才轮询；全部落终态后自动停，抽屉关了也不再打接口。 */
  useEffect(() => {
    if (!code) return;
    const active = runs.filter((run) => run.active);
    if (!active.length) return;
    const timer = setInterval(async () => {
      const settled = await Promise.all(
        active.map((run) =>
          communityApi
            .runStatus({ params: { id: String(run.id) } })
            .catch(() => null),
        ),
      );
      let touched = false;
      setRuns((current) =>
        current.map((run) => {
          const next = settled.find((item) => item && item.id === run.id);
          if (!next) return run;
          touched = true;
          return next;
        }),
      );
      if (touched) void loadRuns(code);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [code, runs, loadRuns]);

  const submit = async () => {
    if (!detail) return;
    if (!detail.keyConnected) {
      onConnect();
      return;
    }
    const missing = missingRequiredSlots(detail.slots, values);
    if (missing.length) {
      message.warning(`请先填写：${missing.join("、")}`);
      return;
    }
    setSubmitting(true);
    try {
      const run = await communityApi.run({
        params: { code: detail.code },
        body: { inputs: values },
      });
      if (!run) throw new Error("运行提交失败");
      message.success("已提交到 Comfy Cloud，正在排队生成");
      setRuns((current) => [run, ...current]);
    } catch (caught) {
      message.error((caught as Error).message || "运行提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleFavorite = async () => {
    if (!detail) return;
    try {
      const data = detail.favorited
        ? await communityApi.unfavorite({ params: { code: detail.code } })
        : await communityApi.favorite({ params: { code: detail.code } });
      if (!data) return;
      setDetail({ ...detail, favorited: data.favorited, favoriteCount: data.favoriteCount });
      onCountChange(detail.code, data);
    } catch (caught) {
      message.error((caught as Error).message || "收藏失败");
    }
  };

  const toggleLike = async () => {
    if (!detail) return;
    try {
      const data = await communityApi.like({ params: { code: detail.code } });
      if (!data) return;
      setDetail({ ...detail, liked: data.liked, likeCount: data.likeCount });
      onCountChange(detail.code, data);
    } catch (caught) {
      message.error((caught as Error).message || "点赞失败");
    }
  };

  const download = () => {
    if (!detail) return;
    const blob = new Blob([JSON.stringify(detail.workflowJson, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${detail.code}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const cancelRun = (run: CommunityRun) => {
    modal.confirm({
      title: "取消这次运行",
      content: "上游作业会被取消；已经在算的那部分积分由 Comfy Cloud 结算，本站不代收也不退。",
      okText: "取消运行",
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy(true);
        try {
          const next = await communityApi.cancelRun({ params: { id: String(run.id) } });
          if (next) setRuns((current) => current.map((item) => (item.id === next.id ? next : item)));
        } catch (caught) {
          message.error((caught as Error).message || "取消失败");
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const unpublish = () => {
    if (!detail) return;
    modal.confirm({
      title: "下架这份工作流",
      content: "下架后社区里不再显示，别人也搜不到；你自己的运行记录与已产生的产物不受影响，之后可以改好再重新提交审核。",
      okText: "确认下架",
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy(true);
        try {
          await communityApi.unpublish({ params: { code: detail.code } });
          message.success("已下架");
          onClose();
        } catch (caught) {
          message.error((caught as Error).message || "下架失败");
        } finally {
          setBusy(false);
        }
      },
    });
  };

  return (
    <Drawer
      open={Boolean(code)}
      onClose={onClose}
      width={720}
      title={detail?.title || "工作流详情"}
      extra={
        detail ? (
          <Space>
            <Tooltip title={detail.favorited ? "取消收藏" : "收藏"}>
              <Button
                icon={detail.favorited ? <StarFilled /> : <StarOutlined />}
                onClick={() => void toggleFavorite()}
              >
                {detail.favoriteCount}
              </Button>
            </Tooltip>
            <Tooltip title={detail.liked ? "取消点赞" : "点赞"}>
              <Button
                icon={detail.liked ? <HeartFilled /> : <HeartOutlined />}
                onClick={() => void toggleLike()}
              >
                {detail.likeCount}
              </Button>
            </Tooltip>
          </Space>
        ) : null
      }
    >
      {loading || !detail ? (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Spin />
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <div className="text-12 muted">
            <Space size={8} wrap>
              <Tag>{detail.categoryLabel}</Tag>
              {detail.groupLabel ? <Tag>{detail.groupLabel}</Tag> : null}
              {detail.source === "OFFICIAL" ? (
                <Tag color="blue">官方模板 · {detail.ownerName}</Tag>
              ) : (
                <span>作者：{detail.ownerName || "本站用户"}</span>
              )}
              <span>{detail.runCount} 次运行</span>
              <span>{detail.viewCount} 次浏览</span>
              <span>{timeText(detail.createdAt)}</span>
            </Space>
          </div>
          {detail.covers.length ? (
            <Image.PreviewGroup>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {detail.covers.map((cover) => (
                  <Image
                    key={cover}
                    src={cover}
                    alt={detail.title}
                    style={{ maxHeight: 200, borderRadius: 10 }}
                  />
                ))}
              </div>
            </Image.PreviewGroup>
          ) : null}
          {detail.summary ? <div>{detail.summary}</div> : null}
          {detail.description ? (
            <Panel title="说明">
              <div style={{ whiteSpace: "pre-wrap" }}>{detail.description}</div>
            </Panel>
          ) : null}
          {detail.tags.length ? (
            <Space size={6} wrap>
              {detail.tags.map((tag) => (
                <Tag key={tag}>#{tag}</Tag>
              ))}
            </Space>
          ) : null}
          {detail.status !== "RECOMMENDED" && detail.status !== "APPROVED" ? (
            <Notice variant="warn">
              当前状态：{detail.statusLabel}
              {detail.auditNote ? `（审核备注：${detail.auditNote}）` : ""}
            </Notice>
          ) : null}
          {detail.format !== "api" ? (
            <Notice variant="info">
              这份工作流只有 ComfyUI 界面（save）格式，站内不能直接运行：可以下载 JSON
              在你自己的 ComfyUI 里打开，或到 Comfy Cloud 官方页面查看示例。
            </Notice>
          ) : null}

          <Panel title="运行参数">
            <SlotFields slots={detail.slots} values={values} onChange={setValues} />
            <Space style={{ marginTop: 12 }} wrap>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                loading={submitting}
                disabled={detail.format !== "api"}
                onClick={() => void submit()}
              >
                {detail.keyConnected ? "立即运行" : "连接 Comfy Cloud 后运行"}
              </Button>
              <Button icon={<DownloadOutlined />} onClick={download}>
                下载工作流 JSON
              </Button>
              {detail.comfyUrl ? (
                <a href={detail.comfyUrl} target="_blank" rel="noreferrer">
                  <Button icon={<LinkOutlined />}>查看出处</Button>
                </a>
              ) : null}
            </Space>
            <div className="text-12 muted" style={{ marginTop: 8 }}>
              {detail.keyConnected
                ? `本次运行用你已连接的 Key（${credential?.keyMask || ""}），烧的是你自己 Comfy Cloud 订阅的积分。`
                : "还没有连接 Comfy Cloud：运行需要你自己的 API Key 与付费订阅。"}
            </div>
          </Panel>

          <Panel
            title="我的产物"
            extra={
              <Button size="small" onClick={() => void loadRuns(detail.code)}>
                刷新
              </Button>
            }
          >
            <RunBlock runs={runs} busy={busy} onCancel={cancelRun} />
          </Panel>

          {detail.canManage ? (
            <Space>
              <Button onClick={() => onEdit(detail)}>编辑并重新提交审核</Button>
              <Button danger icon={<DeleteOutlined />} loading={busy} onClick={unpublish}>
                下架
              </Button>
              <span className="text-12 muted">
                改动工作流正文或参数槽位后会重新进入待审核；只改标题与说明不影响已通过的结论。
              </span>
            </Space>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
