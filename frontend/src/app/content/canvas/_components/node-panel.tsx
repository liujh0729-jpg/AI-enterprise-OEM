"use client";

import { DeleteOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { App, Button, Drawer, Input, InputNumber, Modal, Select, Tag } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CanvasNode,
  CanvasProjectSummary,
  ContentJob,
  ContentModel,
} from "@enterprise/contracts";
import { contentApi, copyCanvasNode } from "@/api/content";
import {
  ChannelModelSelect,
  defaultImageSize,
  imageSizeLabel,
  imageSizeOptions,
  MEDIA_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  TERMINAL,
  videoDurationRange,
  videoRatioLabel,
  videoRatioOptions,
  videoResolutionOptions,
  musicDurationRange,
} from "@/components/content/generation-config";
import { CANCELED_NOTE } from "@/components/content/task-dock";
import { Notice } from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";
import { MENTION_MEDIA, MentionField, type MentionCandidate } from "./mention-field";

const MEDIA_OPTIONS = [
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "music", label: "音乐" },
];

/**
 * 节点侧栏：左边画布选中节点后在这里改内容、选模型与规格、生成。
 * 生成节点走 /canvas/:id/nodes/:nodeId/run（服务端按连线翻译），任务在抽屉里跟踪。
 */
export function NodePanel({
  canvasId,
  node,
  channels,
  wiring,
  wired,
  onPatch,
  onDelete,
  onChanged,
  onRefreshed,
}: {
  canvasId: number;
  node: CanvasNode | null;
  channels: { value: number; label: string }[];
  /** 入边摘要：连进来的配置节点与各类素材张数 */
  wiring: {
    config: { channelId: number; model: string } | null;
    imageRefs: number;
    videoRefs: number;
    audioRefs: number;
  } | null;
  /** 入边素材明细：提示词里 @ 的第一组候选 */
  wired: MentionCandidate[];
  onPatch: (patch: Partial<CanvasNode["data"]>) => void;
  onDelete: () => void;
  /** 提交生成后回调：外层刷新画布与任务 */
  onChanged: () => void;
  /** 本批任务收口后回调：只刷新画布，不重建面板 */
  onRefreshed: () => void;
}) {
  const { message } = App.useApp();
  const [models, setModels] = useState<ContentModel[]>([]);
  const [jobs, setJobs] = useState<ContentJob[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [canvases, setCanvases] = useState<CanvasProjectSummary[]>([]);
  const [copyTarget, setCopyTarget] = useState<number | null>(null);
  const [copying, setCopying] = useState(false);

  const slot =
    node?.data.kind === "generate"
      ? node.data.media === "music"
        ? "music"
        : node.data.media
      : null;
  // 连了配置节点时渠道/模型以配置节点为准：面板置只读，避免「改了没反应」
  const configPick = wiring?.config || null;
  const channelId = configPick
    ? configPick.channelId
    : node && "channelId" in node.data
      ? node.data.channelId || 0
      : 0;

  useEffect(() => {
    if (!slot) {
      setModels([]);
      return;
    }
    let alive = true;
    void contentApi
      .models({ query: { channelId } })
      .then((result) => {
        if (!alive) return;
        setModels((result?.models || []).filter((item) => item.kind === slot));
      })
      .catch(() => alive && setModels([]));
    return () => {
      alive = false;
    };
  }, [slot, channelId]);

  const model = useMemo(() => {
    const data = node?.data;
    if (!data) return undefined;
    if (data.kind !== "generate" && data.kind !== "config") return undefined;
    // 面板显示的模型要和实际生效的一致：配置节点接管时按配置节点的模型找规格
    const id = configPick && data.kind === "generate" ? configPick.model : data.model;
    return models.find((item) => item.id === id);
  }, [models, node, configPick]);

  // 面板显示什么、提交就发什么：换模型后把越界的规格回写到节点。
  // 否则下拉框显示的是兜底档（如 480p），提交的却还是节点里的旧值（如模型不认的 720p），
  // 结果「明明选着对的档位」却被上游以「分辨率无效」拒掉。
  useEffect(() => {
    if (configPick) return; // 配置节点接管时规格以配置节点为准，不动生成节点
    const data = node?.data;
    if (!node || !data || data.kind !== "generate" || !model) return;
    if (data.media === "image") {
      const options = imageSizeOptions(model);
      const size = options.includes(String(data.size)) ? String(data.size) : defaultImageSize(options);
      if (String(data.size || "") !== size) onPatch({ size });
      return;
    }
    if (data.media !== "video") return;
    const ratios = videoRatioOptions(model);
    const resolutions = videoResolutionOptions(model);
    const ratio = ratios.includes(String(data.ratio)) ? String(data.ratio) : ratios[0];
    const resolution = resolutions.includes(String(data.resolution))
      ? String(data.resolution)
      : resolutions[0];
    if (String(data.ratio || "") !== ratio) onPatch({ ratio });
    if (String(data.resolution || "") !== resolution) onPatch({ resolution });
  }, [configPick, node, model, onPatch]);

  const lastRunId = node?.data.kind === "generate" ? node.data.lastRunId : "";
  const pollJobs = useMemo(
    () => () => {
      if (!lastRunId || !node) return;
      void contentApi
        .jobs({ query: { page: 1, pageSize: 8, canvasId, nodeId: node.id } })
        .then((result) => {
          const list = (result?.list || []).filter((job) => job.runId === lastRunId);
          setJobs(list);
        })
        .catch(() => undefined);
    },
    [canvasId, lastRunId, node],
  );

  useEffect(() => {
    setJobs([]);
    pollJobs();
  }, [pollJobs, node?.id]);

  const running = jobs.some((job) => !TERMINAL.has(job.status));
  const finished = jobs.every((job) => TERMINAL.has(job.status));
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(pollJobs, 3000);
    return () => window.clearInterval(timer);
  }, [running, pollJobs]);

  // 本批跑完后服务端已把产物写回节点 results：重新拉一次画布，让卡片与面板拿到新图
  const settled = useRef("");
  useEffect(() => {
    if (!jobs.length || !finished) return;
    const key = `${lastRunId}:${jobs.map((job) => job.status).join(",")}`;
    if (settled.current === key) return;
    settled.current = key;
    onRefreshed();
  }, [jobs, finished, lastRunId, onRefreshed]);

  if (!node) {
    return (
      <div className="cv-empty">
        点画布上的节点编辑它的内容；用画布底部的「添加节点」放生成节点（图片 / 视频 / 音乐），
        提示词可以直接写在卡片里，也可以另放提示词 / 素材 / 模型配置节点连进来
      </div>
    );
  }

  const data = node.data;
  const pick = configPick
    ? configPick
    : { channelId: data.kind === "generate" ? data.channelId : 0, model: data.kind === "generate" ? data.model : "" };
  const run = async () => {
    if (data.kind !== "generate") return;
    if (data.media === "video" && !(Number(data.duration) > 0)) {
      message.warning("请先填写视频时长（秒），再生成");
      return;
    }
    setSubmitting(true);
    try {
      const result = await contentApi.runCanvasNode({
        params: { id: String(canvasId), nodeId: node.id },
        body: {
          channelId: pick.channelId,
          model: pick.model,
          channelName: configPick
            ? channels.find((item) => item.value === configPick.channelId)?.label || ""
            : data.channelName,
          size: data.size,
          ratio: data.ratio,
          resolution: data.resolution,
          duration: data.duration,
          count: data.count,
          prompt: data.prompt,
          lyrics: data.lyrics,
        },
      });
      const count = result?.jobs?.length || 0;
      message.success(`已提交 ${count} 个任务，生成中`);
      setJobs(result?.jobs || []);
      onChanged();
    } catch (caught) {
      message.error((caught as Error).message || "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const openCopy = () => {
    setCopyOpen(true);
    setCopyTarget(null);
    void contentApi
      .canvases({ query: { page: 1, pageSize: 100 } })
      .then((result) =>
        setCanvases((result?.list || []).filter((item) => item.id !== canvasId)),
      )
      .catch(() => setCanvases([]));
  };

  const doCopy = async () => {
    if (!copyTarget) {
      message.warning("请选择目标画布");
      return;
    }
    setCopying(true);
    try {
      const result = await copyCanvasNode(canvasId, node.id, copyTarget);
      message.success(`已复制到「${result?.title || "目标画布"}」`);
      setCopyOpen(false);
    } catch (caught) {
      message.error((caught as Error).message || "复制失败");
    } finally {
      setCopying(false);
    }
  };

  return (
    <Drawer
      open
      placement="right"
      size={380}
      mask={false}
      closable={false}
      getContainer={false}
      rootStyle={{ position: "absolute" }}
      styles={{ body: { padding: 12 } }}
      title={null}
    >
      <div className="cv-panel">
        <div className="cv-panel-head">
          <Tag color="blue" style={{ marginInlineEnd: 0 }}>
            {data.kind === "generate"
              ? "生成节点"
              : data.kind === "prompt"
                ? "提示词"
                : data.kind === "asset"
                  ? "素材"
                  : "模型配置"}
          </Tag>
          <span className="text-12 muted">{node.id}</span>
          <Button
            size="small"
            danger
            type="text"
            icon={<DeleteOutlined />}
            style={{ marginLeft: "auto" }}
            onClick={onDelete}
          />
        </div>

        {data.kind === "prompt" ? (
          <label className="cv-field">
            <span className="cv-field-label">提示词</span>
            <Input.TextArea
              autoSize={{ minRows: 5, maxRows: 12 }}
              value={data.text}
              placeholder="写主体、风格、构图、镜头"
              onChange={(event) => onPatch({ text: event.target.value })}
            />
          </label>
        ) : null}

        {data.kind === "asset" ? (
          <div className="cv-field">
            <span className="cv-field-label">素材</span>
            {data.media === "image" ? (
              <RawImg
                src={data.previewUrl || data.url}
                alt=""
                style={{ width: "100%", borderRadius: 8 }}
              />
            ) : null}
            <span className="text-12 muted">
              {MEDIA_LABEL[data.media] || data.media} · {data.name || data.url}
            </span>
            <span className="text-12 muted">
              素材内容在「数字资产管理」里维护；这里只引用地址。
            </span>
          </div>
        ) : null}

        {data.kind === "config" ? (
          <ConfigFields
            channels={channels}
            data={data}
            models={models}
            onPatch={onPatch}
          />
        ) : null}

        {data.kind === "generate" ? (
          <>
            <label className="cv-field">
              <span className="cv-field-label">产出类型</span>
              <Select
                value={data.media}
                options={MEDIA_OPTIONS}
                onChange={(value) => onPatch({ media: value })}
              />
            </label>
            <div className="cv-field">
              <span className="cv-field-label">渠道 / 模型</span>
              <ChannelModelSelect
                channels={channels}
                disabled={!!configPick}
                picked={
                  configPick
                    ? configPick
                    : data.model
                      ? { channelId: data.channelId, model: data.model }
                      : undefined
                }
                models={models}
                onChange={(next) => {
                  const hit = models.find((item) => item.id === next.model);
                  onPatch({
                    channelId: next.channelId,
                    model: next.model,
                    channelName: hit ? channels.find((c) => c.value === next.channelId)?.label || "" : "",
                  });
                }}
              />
              {configPick ? (
                <span className="text-12 muted">
                  由接进来的模型配置节点决定（要改请改那个节点）
                </span>
              ) : null}
            </div>
            <GenerateSpec data={data} model={model} onPatch={onPatch} refs={wiring} />
            <label className="cv-field">
              <span className="cv-field-label">提示词</span>
              <MentionField
                autoSize={{ minRows: 3, maxRows: 8 }}
                value={data.prompt}
                placeholder="也可以直接在画布上的卡片里写；敲 @ 引用素材，留空则用连线进来的提示词节点"
                refs={data.refs}
                wired={wired}
                mediaTypes={MENTION_MEDIA[data.media]}
                onChange={(next) => onPatch({ prompt: next })}
                onRefsChange={(refs) => onPatch({ refs })}
              />
              {data.refs.length ? (
                <span className="text-12 muted">
                  {`已引用：${data.refs
                    .map((ref) => `${ref.label}（${ref.name}）`)
                    .join("、")}；删掉提示词里的记号就解除`}
                </span>
              ) : null}
            </label>
            <Button
              type="primary"
              block
              icon={<ThunderboltOutlined />}
              loading={submitting}
              disabled={
                !pick.model ||
                (data.media === "video" && !(Number(data.duration) > 0))
              }
              onClick={() => void run()}
            >
              生成
            </Button>
            <Button block onClick={openCopy}>
              复制这个节点到另一张画布
            </Button>
            {jobs.length ? (
              <div className="cv-field">
                <span className="cv-field-label">本批任务</span>
                {jobs.map((job) => {
                  const url = job.assetUrl || String((job.output || {}).url || "");
                  const note = String((job.output || {}).assetNote || "");
                  return (
                    <div key={job.id} className="cv-job-row">
                      <Tag
                        color={STATUS_COLOR[job.status] || "default"}
                        style={{ marginInlineEnd: 0 }}
                      >
                        {STATUS_LABEL[job.status] || job.status}
                      </Tag>
                      <span className="text-12 muted">
                        #{job.id}
                        {job.status === "RUNNING" && job.progress
                          ? ` · ${job.progress}%`
                          : ""}
                      </span>
                      {job.status === "SUCCESS" && url ? (
                        <a href={url} target="_blank" rel="noreferrer">
                          <Button size="small">打开</Button>
                        </a>
                      ) : null}
                      {job.status === "FAILED" && job.error ? (
                        <span className="text-12" style={{ color: "#cf1322" }}>
                          {job.error}
                        </span>
                      ) : null}
                      {job.status === "CANCELED" ? (
                        <span className="text-12" style={{ color: "#d46b08" }}>
                          {job.cancelReason || CANCELED_NOTE}
                        </span>
                      ) : null}
                      {note ? (
                        <span className="text-12" style={{ color: "#d46b08" }}>
                          {note}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </>
        ) : null}

        {data.kind === "generate" ? (
          <Notice variant="info">
            生成按连线翻译：提示词节点合并成 prompt、素材按类型当参考图 / 首尾帧 / 音频、模型配置节点优先于这里的直选。
          </Notice>
        ) : null}
      </div>

      <Modal
        open={copyOpen}
        title="复制节点到另一张画布"
        okText="复制"
        confirmLoading={copying}
        onOk={() => void doCopy()}
        onCancel={() => setCopyOpen(false)}
      >
        <span className="text-12 muted">
          连同这个节点的设置与最近产物一起复制；目标画布会追加一个新节点。
        </span>
        <Select
          style={{ width: "100%", marginTop: 8 }}
          placeholder="选择目标画布"
          value={copyTarget ?? undefined}
          options={canvases.map((item) => ({
            value: item.id,
            label: `${item.title}（${item.nodeCount} 个节点）`,
          }))}
          notFoundContent="没有其它画布，先新建一张"
          onChange={(value) => setCopyTarget(value)}
        />
      </Modal>
    </Drawer>
  );
}

function ConfigFields({
  channels,
  data,
  models,
  onPatch,
}: {
  channels: { value: number; label: string }[];
  data: Extract<CanvasNode["data"], { kind: "config" }>;
  models: ContentModel[];
  onPatch: (patch: Partial<CanvasNode["data"]>) => void;
}) {
  return (
    <div className="cv-field">
      <span className="cv-field-label">默认渠道 / 模型</span>
      <ChannelModelSelect
        channels={channels}
        picked={data.model ? { channelId: data.channelId, model: data.model } : undefined}
        models={models}
        onChange={(next) => {
          const hit = models.find((item) => item.id === next.model);
          onPatch({
            channelId: next.channelId,
            model: next.model,
            channelName: hit ? channels.find((c) => c.value === next.channelId)?.label || "" : "",
          });
        }}
      />
      <span className="text-12 muted">
        连到生成节点后，这套渠道与模型优先于生成节点上的直选。
      </span>
    </div>
  );
}

function GenerateSpec({
  data,
  model,
  onPatch,
  refs,
}: {
  data: Extract<CanvasNode["data"], { kind: "generate" }>;
  model?: ContentModel;
  onPatch: (patch: Partial<CanvasNode["data"]>) => void;
  refs: {
    config: { channelId: number; model: string } | null;
    imageRefs: number;
    videoRefs: number;
    audioRefs: number;
  } | null;
}) {
  const imageRefs = refs?.imageRefs || 0;
  if (data.media === "image") {
    const options = imageSizeOptions(model);
    const size = options.includes(String(data.size)) ? String(data.size) : defaultImageSize(options);
    return (
      <>
        <label className="cv-field">
          <span className="cv-field-label">
            {options.some((value) => /^\d+x\d+$/i.test(value)) ? "尺寸" : "分辨率"}
          </span>
          <Select
            value={size}
            options={options.map((value) => ({ value, label: imageSizeLabel(value) }))}
            onChange={(value) => onPatch({ size: value })}
          />
        </label>
        <label className="cv-field">
          <span className="cv-field-label">张数（1–4）</span>
          <InputNumber
            min={1}
            max={4}
            value={data.count || 1}
            onChange={(value) => onPatch({ count: Number(value) || 1 })}
          />
          <span className="text-12 muted">
            {imageRefs
              ? `参考图：连了 ${imageRefs} 张，作为同一次请求的参考一起送给模型。`
              : "参考图：把图片素材连到本节点，会作为同一次请求的参考图。"}
          </span>
          <span className="text-12 muted">
            张数：按 N 次独立提交，每张单独计费、单独在任务里追踪。
          </span>
        </label>
      </>
    );
  }
  if (data.media === "video") {
    const ratios = videoRatioOptions(model);
    const resolutions = videoResolutionOptions(model);
    const range = videoDurationRange(model);
    return (
      <>
        <label className="cv-field">
          <span className="cv-field-label">尺寸（画面比例）</span>
          <Select
            value={ratios.includes(String(data.ratio)) ? String(data.ratio) : ratios[0]}
            options={ratios.map((value) => ({ value, label: videoRatioLabel(value) }))}
            onChange={(value) => onPatch({ ratio: value })}
          />
        </label>
        <label className="cv-field">
          <span className="cv-field-label">像素规格（分辨率）</span>
          <Select
            value={
              resolutions.includes(String(data.resolution)) ? String(data.resolution) : resolutions[0]
            }
            options={resolutions.map((value) => ({ value, label: value }))}
            onChange={(value) => onPatch({ resolution: value })}
          />
        </label>
        <label className="cv-field">
          <span className="cv-field-label">{`时长（秒，必填 ${range.min}–${range.max}）`}</span>
          <InputNumber
            min={range.min}
            max={range.max}
            value={Number(data.duration) > 0 ? Number(data.duration) : null}
            placeholder={`请填写（${range.min}–${range.max}）`}
            status={Number(data.duration) > 0 ? undefined : "warning"}
            onChange={(value) =>
              onPatch({ duration: Number(value) > 0 ? Number(value) : undefined })
            }
          />
        </label>
      </>
    );
  }
  const range = musicDurationRange(model);
  return (
    <>
      <label className="cv-field">
        <span className="cv-field-label">{`时长（${range.min}–${range.max} 秒）`}</span>
        <InputNumber
          min={range.min}
          max={range.max}
          value={Math.min(range.max, Math.max(range.min, Number(data.duration) || range.min))}
          onChange={(value) => onPatch({ duration: Number(value) || range.min })}
        />
      </label>
      <label className="cv-field">
        <span className="cv-field-label">歌词（可选）</span>
        <Input.TextArea
          autoSize={{ minRows: 4, maxRows: 10 }}
          value={data.lyrics || ""}
          onChange={(event) => onPatch({ lyrics: event.target.value })}
        />
      </label>
    </>
  );
}
