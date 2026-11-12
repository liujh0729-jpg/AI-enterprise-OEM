"use client";

import { ExportOutlined, PictureOutlined, SettingOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { CanvasEdgeRole, CanvasMentionRef, CanvasNodeData } from "@enterprise/contracts";
import { RawImg } from "@/components/ui/raw-img";
import { MENTION_MEDIA, MentionField, type MentionCandidate } from "./mention-field";

export type CanvasFlowData = {
  kind: CanvasNodeData["kind"];
  data: CanvasNodeData;
  /** 本节点的任务态摘要：生成节点用 */
  status?: string;
  progress?: number;
  message?: string;
  running?: boolean;
  /** 双击卡片头部打开右侧面板做进阶设置 */
  onOpen?: (nodeId: string) => void;
  /** 生成节点：节点内提示词框改写 */
  onPatch?: (nodeId: string, patch: Partial<CanvasNodeData>) => void;
  /** 生成节点：对着框直接生成 */
  onRun?: (nodeId: string) => void;
  /** 生成节点：提示词里 @ 的数字资产引用改写 */
  onRefs?: (nodeId: string, refs: CanvasMentionRef[]) => void;
  /** 生成节点：上游连线进来的素材（@ 菜单的第一组） */
  wired?: MentionCandidate[];
  /** 没写提示词也没接提示词节点时不给生成 */
  canRun?: boolean;
  /** 不能生成时的具体原因（提示词缺失 / 视频时长没填），用于按钮悬停提示 */
  runBlockedReason?: string;
};

export type CanvasFlowNode = Node<CanvasFlowData, "canvas">;

const KIND_LABEL: Record<string, string> = {
  prompt: "提示词",
  asset: "素材",
  config: "模型配置",
  generate: "生成",
};

const MEDIA_LABEL: Record<string, string> = {
  image: "图片",
  video: "视频",
  music: "音乐",
};

/** 连线的角色（拖到目标节点的哪个入口）：生成节点据此分出提示词/素材/首尾帧/配置。 */
export const EDGE_ROLE_LABEL: Record<CanvasEdgeRole, string> = {
  prompt: "提示词",
  asset: "素材",
  config: "配置",
  "first-frame": "首帧",
  "last-frame": "尾帧",
};

function Head({ kind, extra }: { kind: string; extra?: React.ReactNode }) {
  return (
    <div className="cv-node-head">
      <span className={`badge badge-${kind === "generate" ? "violet" : kind === "asset" ? "green" : "blue"}`}>
        {KIND_LABEL[kind] || kind}
      </span>
      {extra}
    </div>
  );
}

function nodeBody(data: CanvasNodeData) {
  if (data.kind === "prompt") {
    return (
      <div className="cv-node-text">
        {data.text.trim() ? data.text : <span className="text-12 muted">点开写提示词</span>}
      </div>
    );
  }
  if (data.kind === "asset") {
    return (
      <div className="cv-node-asset">
        {data.media === "image" && (data.previewUrl || data.url) ? (
          <RawImg src={data.previewUrl || data.url} alt="" />
        ) : (
          <div className="cv-node-asset-ph">
            <PictureOutlined aria-hidden />
          </div>
        )}
        <span className="cv-node-asset-name">{data.name || data.url}</span>
      </div>
    );
  }
  return (
    <div className="cv-node-text">
      <div>
        <SettingOutlined aria-hidden /> {data.channelName || "默认渠道"} · {data.model || "默认模型"}
      </div>
      <div className="text-12 muted">
        {[data.size, data.ratio, data.resolution, data.duration ? `${data.duration}s` : "", data.count ? `×${data.count}` : ""]
          .filter(Boolean)
          .join(" · ") || "规格由模型决定"}
      </div>
    </div>
  );
}

/**
 * 画布节点：四类节点共用一套视图（提示词 / 素材 / 模型配置 / 生成）。
 * 生成节点把提示词框与生成按钮直接做在卡片里——在画布上对着框写、对着框生成；
 * 双击卡片头部仍可打开右侧面板改渠道 / 规格等进阶项。
 */
export function CanvasNodeView({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const kind = data.data.kind;
  const running = data.running || data.status === "RUNNING" || data.status === "PENDING";

  if (kind === "generate") {
    const node = data.data;
    return (
      <div
        className={`cv-node cv-node-gen${selected ? " selected" : ""}${running ? " running" : ""}`}
      >
        <Handle type="target" position={Position.Left} id="in" />
        <div className="cv-node-head" onDoubleClick={() => data.onOpen?.(id)}>
          <span className="badge badge-violet">生成</span>
          <span className="cv-node-gen-kind">{MEDIA_LABEL[node.media] || node.media}</span>
          {data.status ? (
            <span className="cv-node-status">
              {data.message || data.status}
              {typeof data.progress === "number" && running ? ` ${data.progress}%` : ""}
            </span>
          ) : null}
        </div>
        <div
          className="cv-node-prompt-wrap nodrag"
          onDoubleClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <MentionField
            className="cv-node-prompt nodrag nowheel"
            variant="borderless"
            rows={3}
            value={node.prompt}
            placeholder="写提示词，敲 @ 引用素材；点右下角生成"
            refs={node.refs}
            wired={data.wired || []}
            mediaTypes={MENTION_MEDIA[node.media]}
            onChange={(next) => data.onPatch?.(id, { prompt: next })}
            onRefsChange={(refs) => data.onRefs?.(id, refs)}
          />
        </div>
        <div className="cv-node-gen-foot">
          <span className="text-12 muted cv-node-gen-model" title={node.model || "默认模型"}>
            {node.model || "默认模型"}
            {node.count > 1 ? ` · ×${node.count}` : ""}
          </span>
          <Tooltip
            title={
              data.canRun === false
                ? data.runBlockedReason || "先写提示词，或连一个提示词节点进来"
                : ""
            }
          >
            <Button
              size="small"
              type="primary"
              className="cv-node-run nodrag"
              icon={<ThunderboltOutlined aria-hidden />}
              loading={running}
              disabled={data.canRun === false}
              onClick={(event) => {
                event.stopPropagation();
                data.onRun?.(id);
              }}
            >
              生成
            </Button>
          </Tooltip>
        </div>
        {node.results.length ? (
          <div className="cv-node-thumbs">
            {node.results.slice(0, 4).map((item) => (
              <a key={item.jobId} href={item.url} target="_blank" rel="noreferrer" className="nodrag">
                {node.media === "image" ? (
                  <RawImg src={item.url} alt="" />
                ) : (
                  <span className="cv-node-file">
                    <ExportOutlined aria-hidden />
                  </span>
                )}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`cv-node${selected ? " selected" : ""}`}
      onDoubleClick={() => data.onOpen?.(id)}
    >
      <Handle type="source" position={Position.Right} />
      <Handle type="target" position={Position.Left} id="in" />
      <Head kind={kind} />
      {nodeBody(data.data)}
    </div>
  );
}
