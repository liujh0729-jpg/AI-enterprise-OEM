"use client";

import "@xyflow/react/dist/style.css";
import {
  ArrowLeftOutlined,
  CloseOutlined,
  CloudUploadOutlined,
  CustomerServiceOutlined,
  PictureOutlined,
  PlusOutlined,
  ProfileOutlined,
  SaveOutlined,
  SettingOutlined,
  VideoCameraOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import { App, Badge, Button, Dropdown, Input, Skeleton, Tag } from "antd";
import {
  addEdge,
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CanvasDoc,
  CanvasEdge,
  CanvasEdgeRole,
  CanvasMentionRef,
  CanvasNode,
  CanvasNodeData,
  CanvasProject,
  ContentJob,
} from "@enterprise/contracts";
import { contentApi } from "@/api/content";
import { TERMINAL } from "@/components/content/generation-config";
import { AssetReferencePicker } from "@/components/content/asset-reference-picker";
import { Notice } from "@/components/ui/panel";
import { TaskDock } from "@/components/content/task-dock";
import { CanvasNodeView, EDGE_ROLE_LABEL, type CanvasFlowNode } from "./flow-nodes";
import { wiredMentions, type MentionCandidate } from "./mention-field";
import { NodePanel } from "./node-panel";

const nodeTypes: NodeTypes = { canvas: CanvasNodeView };

/** 与后端 planNodeRun 同一口径：入边按角色排序后，@ 记号才和实际喂进去的素材对得上。 */
const ROLE_ORDER: Record<CanvasEdgeRole, number> = {
  prompt: 0,
  asset: 1,
  config: 2,
  "first-frame": 3,
  "last-frame": 4,
};

const EMPTY_DOC: CanvasDoc = {
  version: 1,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

function toFlow(doc: CanvasDoc): { nodes: CanvasFlowNode[]; edges: Edge[] } {
  return {
    nodes: doc.nodes.map((node) => ({
      id: node.id,
      type: "canvas" as const,
      position: { x: node.x, y: node.y },
      data: { kind: node.data.kind, data: node.data },
    })),
    edges: doc.edges.map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      label: EDGE_ROLE_LABEL[edge.role] || edge.role,
      data: { role: edge.role },
    })),
  };
}

function toDoc(
  nodes: CanvasFlowNode[],
  edges: Edge[],
  viewport: { x: number; y: number; zoom: number },
): CanvasDoc {
  return {
    version: 1,
    nodes: nodes.map(
      (node): CanvasNode => ({
        id: node.id,
        type: node.data.kind,
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
        width: 220,
        data: node.data.data,
      }),
    ),
    edges: edges.map(
      (edge): CanvasEdge => ({
        id: edge.id,
        from: edge.source,
        to: edge.target,
        role: ((edge.data?.role as CanvasEdgeRole) || "asset") as CanvasEdgeRole,
      }),
    ),
    viewport,
  };
}

function nextId(nodes: CanvasFlowNode[], prefix: string) {
  const max = nodes.reduce((acc, node) => {
    const num = Number(node.id.replace(/^[a-z]+/, ""));
    return Number.isFinite(num) && num > acc ? num : acc;
  }, 0);
  return `${prefix}${max + 1}`;
}

/** 素材类型决定连线角色：图片默认当素材，视频/音频也走素材；首尾帧由用户在连线上切。 */
function roleForNode(node?: CanvasFlowNode): CanvasEdgeRole {
  if (!node) return "asset";
  return node.data.kind === "config" ? "config" : node.data.kind === "prompt" ? "prompt" : "asset";
}

export function CanvasEditor({ id }: { id: number }) {
  return (
    <ReactFlowProvider>
      <CanvasEditorInner id={id} />
    </ReactFlowProvider>
  );
}

function CanvasEditorInner({ id }: { id: number }) {
  const { message } = App.useApp();
  const router = useRouter();
  const { fitView, getViewport } = useReactFlow<CanvasFlowNode, Edge>();
  const [project, setProject] = useState<CanvasProject | null>(null);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [channels, setChannels] = useState<{ value: number; label: string }[]>([]);
  const [jobs, setJobs] = useState<ContentJob[]>([]);
  const [taskVersion, setTaskVersion] = useState(0);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const nodesRef = useRef<CanvasFlowNode[]>([]);
  const openPanel = useCallback((nodeId: string) => setSelected(nodeId), []);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const row = await contentApi.canvas({ params: { id: String(id) } });
      if (!row) throw new Error("画布不存在或无权查看");
      setProject(row);
      setTitle(row.title);
      const doc = (row.doc || EMPTY_DOC) as CanvasDoc;
      const flow = toFlow(doc);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setDirty(false);
      setTimeout(() => void fitView({ padding: 0.2 }), 80);
      setError("");
    } catch (caught) {
      setError((caught as Error).message || "画布加载失败");
    } finally {
      setLoading(false);
    }
  }, [id, fitView, setEdges, setNodes]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 只把服务端写回的节点结果并进本地（版本号 / 标题 / 位置 / 连线保持不动）。 */
  const refreshDoc = useCallback(async () => {
    try {
      const row = await contentApi.canvas({ params: { id: String(id) } });
      if (!row) return;
      const doc = (row.doc || EMPTY_DOC) as CanvasDoc;
      const generated = new Map(
        doc.nodes
          .filter((node) => node.data.kind === "generate" && node.data.results.length)
          .map((node) => [node.id, node.data]),
      );
      setNodes((prev) =>
        prev.map((node) => {
          const next = generated.get(node.id);
          if (!next || next.kind !== "generate") return node;
          return {
            ...node,
            data: {
              ...node.data,
              data: {
                ...node.data.data,
                results: next.results,
                lastRunId: next.lastRunId,
              },
            },
          };
        }),
      );
      // 后台回写也递增了行版本：本地同步跟上，下一次保存才不会误报版本冲突
      setProject((prev) => (prev ? { ...prev, version: row.version } : prev));
    } catch {
      // 刷新失败保持原样，任务收口时会再试
    }
  }, [id, setNodes]);

  useEffect(() => {
    void contentApi
      .settings()
      .then((settings) => {
        if (!settings) return;
        setChannels(
          settings.channels.map((item) => ({
            value: item.id,
            label: item.name,
          })),
        );
      })
      .catch(() => undefined);
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const result = await contentApi.jobs({
        query: { page: 1, pageSize: 60, canvasId: id },
      });
      setJobs(result?.list || []);
    } catch {
      // 任务区自己有错误提示，这里只影响卡片上的状态摘要
    }
  }, [id]);

  const pending = jobs.some((job) => !TERMINAL.has(job.status));
  const pendingCount = jobs.filter((job) => !TERMINAL.has(job.status)).length;
  useEffect(() => {
    void loadJobs();
  }, [loadJobs, taskVersion]);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => void loadJobs(), 3000);
    return () => window.clearInterval(timer);
  }, [pending, loadJobs]);

  /** 保存当前画布；返回是否落库成功（「保存并退出」据此决定要不要跳回列表）。 */
  const persist = useCallback(
    async (silent: boolean) => {
      if (!project) return false;
      // 保存期间再有改动会置回 dirty，落库完成后再走下一轮自动保存，不会把新改动当成已保存
      setSaving(true);
      setDirty(false);
      try {
        const doc = toDoc(nodesRef.current, edges, getViewport());
        const updated = await contentApi.saveCanvas({
          params: { id: String(id) },
          body: { title: title.trim() || project.title, doc, version: project.version },
        });
        if (!updated) {
          message.error("保存失败：未返回画布");
          setDirty(true);
          return false;
        }
        setProject(updated);
        if (!silent) message.success("已保存");
        return true;
      } catch (caught) {
        setDirty(true);
        const reason = (caught as Error).message || "保存失败";
        // 单画布是单人私有，冲突只可能来自「同一账号的另一个标签页」：不做自动合并，提示刷新后重编
        message.error(
          reason.includes("别处更新")
            ? "画布已在别处更新：请刷新页面后重新编辑（不会自动合并）"
            : reason,
        );
        return false;
      } finally {
        setSaving(false);
      }
    },
    [project, title, edges, getViewport, id, message],
  );

  // 自动保存：改动后停下 2.5 秒写一次；正在保存或没改动就跳过
  useEffect(() => {
    if (!dirty || saving || !project) return;
    const timer = window.setTimeout(() => void persist(true), 2500);
    return () => window.clearTimeout(timer);
  }, [dirty, saving, project, persist, nodes, edges]);

  const addNode = useCallback(
    (kind: CanvasNodeData["kind"], extra?: Partial<CanvasNodeData>) => {
      const current = nodesRef.current;
      const prefix = kind === "prompt" ? "p" : kind === "asset" ? "a" : kind === "config" ? "c" : "g";
      const nodeId = nextId(current, prefix);
      const x = 80 + (current.length % 4) * 280;
      const y = 80 + Math.floor(current.length / 4) * 220;
      const base: Record<string, CanvasNodeData> = {
        prompt: { kind: "prompt", text: "" },
        asset: {
          kind: "asset",
          assetId: 0,
          name: "",
          media: "image",
          url: "",
          previewUrl: "",
        },
        config: {
          kind: "config",
          channelId: 0,
          channelName: "",
          model: "",
          count: 1,
        },
        generate: {
          kind: "generate",
          media: "image",
          prompt: "",
          channelId: 0,
          channelName: "",
          model: "",
          count: 1,
          refs: [],
          results: [],
          lastRunId: "",
        },
      };
      const data = { ...base[kind], ...(extra || {}) } as CanvasNodeData;
      setNodes((prev) => [
        ...prev,
        { id: nodeId, type: "canvas", position: { x, y }, data: { kind, data } },
      ]);
      setSelected(nodeId);
      setDirty(true);
    },
    [setNodes],
  );

  const addAssetNodes = (assets: {
    id: number;
    name: string;
    type: string;
    url: string;
    previewUrl: string;
  }[]) => {
    const current = nodesRef.current;
    let base = current.reduce((acc, node) => {
      const num = Number(node.id.replace(/^[a-z]+/, ""));
      return Number.isFinite(num) && num > acc ? num : acc;
    }, 0);
    const added = assets
      .filter((asset) => ["image", "video", "audio"].includes(asset.type))
      .map((asset, index) => {
        base += 1;
        return {
          id: `a${base}`,
          type: "canvas" as const,
          position: {
            x: 80 + ((current.length + index) % 4) * 280,
            y: 80 + Math.floor((current.length + index) / 4) * 220,
          },
          data: {
            kind: "asset" as const,
            data: {
              kind: "asset" as const,
              assetId: asset.id,
              name: asset.name,
              media: asset.type as "image" | "video" | "audio",
              url: asset.url,
              previewUrl: asset.previewUrl || asset.url,
            },
          },
        };
      });
    if (!added.length) return;
    setNodes((prev) => [...prev, ...added]);
    setDirty(true);
  };

  const onConnect = useCallback(
    (connection: Connection) => {
      const source = nodesRef.current.find((node) => node.id === connection.source);
      const role = roleForNode(source);
      setEdges((prev) =>
        addEdge(
          {
            ...connection,
            id: `e${Date.now().toString(36)}`,
            label: EDGE_ROLE_LABEL[role],
            data: { role },
          },
          prev,
        ),
      );
      setDirty(true);
    },
    [setEdges],
  );

  /** 图片素材连到视频生成节点后，双击连线在 素材 / 首帧 / 尾帧 之间切换（连线语义由这里决定）。 */
  const cycleEdgeRole = useCallback(
    (edge: Edge) => {
      const current = (edge.data?.role as CanvasEdgeRole) || "asset";
      const order: CanvasEdgeRole[] = ["asset", "first-frame", "last-frame"];
      const next = order[(order.indexOf(current) + 1) % order.length];
      // 首帧 / 尾帧各只允许一条：同一目标上同角色的旧连线退回「素材」
      setEdges((prev) =>
        prev.map((item) => {
          if (item.id === edge.id) {
            return { ...item, label: EDGE_ROLE_LABEL[next], data: { role: next } };
          }
          if (
            item.target === edge.target &&
            item.data?.role === next &&
            (next === "first-frame" || next === "last-frame")
          ) {
            return { ...item, label: EDGE_ROLE_LABEL.asset, data: { role: "asset" } };
          }
          return item;
        }),
      );
      setDirty(true);
    },
    [setEdges],
  );

  const patchNode = useCallback((nodeId: string, patch: Partial<CanvasNodeData>) => {
    setNodes((prev) =>
      prev.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, data: { ...node.data.data, ...patch } as CanvasNodeData } }
          : node,
      ),
    );
    setDirty(true);
  }, [setNodes]);

  const deleteNode = (nodeId: string) => {
    setNodes((prev) => prev.filter((node) => node.id !== nodeId));
    setEdges((prev) => prev.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setSelected(null);
    setDirty(true);
  };

  /** 连了「模型配置」节点的生成节点：渠道与模型以配置节点为准（与面板同一口径）。 */
  const configByNode = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const map = new Map<string, { channelId: number; model: string }>();
    for (const edge of edges) {
      const source = byId.get(edge.source);
      const data = source?.data.data;
      if (!data || data.kind !== "config") continue;
      if (map.has(edge.target)) continue;
      map.set(edge.target, { channelId: data.channelId, model: data.model });
    }
    return map;
  }, [edges, nodes]);

  /** 接了提示词节点的生成节点：没写提示词也能生成。 */
  const promptFedNodes = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const set = new Set<string>();
    for (const edge of edges) {
      const source = byId.get(edge.source);
      if (source?.data.kind === "prompt") set.add(edge.target);
    }
    return set;
  }, [edges, nodes]);

  /**
   * 每个生成节点能 @ 的连线素材：入边先按角色排序再按类型编号，
   * 与后端 planNodeRun 组装素材的顺序一致，提示词里的 @图片2 才对得上第二张参考图。
   */
  const wiredByNode = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const incoming = new Map<string, Edge[]>();
    for (const edge of edges) {
      const list = incoming.get(edge.target);
      if (list) list.push(edge);
      else incoming.set(edge.target, [edge]);
    }
    const map = new Map<string, MentionCandidate[]>();
    for (const [targetId, list] of incoming) {
      const target = byId.get(targetId)?.data.data;
      if (!target || target.kind !== "generate" || target.media === "music") continue;
      const sorted = [...list].sort(
        (a, b) =>
          ROLE_ORDER[(a.data?.role as CanvasEdgeRole) || "asset"] -
          ROLE_ORDER[(b.data?.role as CanvasEdgeRole) || "asset"],
      );
      const rows = sorted.flatMap((edge) => {
        const source = byId.get(edge.source)?.data.data;
        if (!source || source.kind !== "asset" || !source.url) return [];
        const role = (edge.data?.role as CanvasEdgeRole) || "asset";
        return [
          {
            role: EDGE_ROLE_LABEL[role] || "素材",
            media: source.media,
            name: source.name || source.url,
            url: source.url,
            previewUrl: source.previewUrl,
            assetId: source.assetId,
          },
        ];
      });
      map.set(targetId, wiredMentions(rows));
    }
    return map;
  }, [edges, nodes]);

  /** 卡片上的 @ 改写的是节点里存的引用（连线素材另走 edges，不进这里）。 */
  const patchNodeRefs = useCallback(
    (nodeId: string, refs: CanvasMentionRef[]) => patchNode(nodeId, { refs }),
    [patchNode],
  );

  /** 卡片上的「生成」：对着节点里的提示词框直接提交，不用先选中再开右侧面板。 */
  const runNode = useCallback(
    async (nodeId: string) => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      if (!node) return;
      const data = node.data.data;
      if (data.kind !== "generate") return;
      if (data.media === "video" && !(Number(data.duration) > 0)) {
        message.warning("请先在右侧面板填写视频时长（秒），再生成");
        setSelected(nodeId);
        return;
      }
      const cfg = configByNode.get(nodeId);
      const channelId = cfg ? cfg.channelId : data.channelId || 0;
      const model = cfg ? cfg.model : data.model;
      setSelected(nodeId);
      try {
        const result = await contentApi.runCanvasNode({
          params: { id: String(id), nodeId },
          body: {
            channelId,
            model,
            channelName: cfg
              ? channels.find((item) => item.value === cfg.channelId)?.label || ""
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
        setTaskVersion((prev) => prev + 1);
        void loadJobs();
        void refreshDoc();
      } catch (caught) {
        message.error((caught as Error).message || "提交失败");
      }
    },
    [channels, configByNode, id, loadJobs, message, refreshDoc],
  );

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selected) || null,
    [nodes, selected],
  );

  // 选中节点的入边摘要：配置节点接管渠道/模型、连了几张参考素材（面板据此只读与说明）
  const wiring = useMemo(() => {
    if (!selected) return null;
    const byId = new Map(nodes.map((node) => [node.id, node]));
    let config: { channelId: number; model: string } | null = null;
    let imageRefs = 0;
    let videoRefs = 0;
    let audioRefs = 0;
    for (const edge of edges) {
      if (edge.target !== selected) continue;
      const source = byId.get(edge.source);
      if (!source) continue;
      const data = source.data.data;
      if (data.kind === "config") {
        if (!config) config = { channelId: data.channelId, model: data.model };
        continue;
      }
      if (data.kind !== "asset") continue;
      if (data.media === "image") imageRefs += 1;
      else if (data.media === "video") videoRefs += 1;
      else audioRefs += 1;
    }
    return { config, imageRefs, videoRefs, audioRefs };
  }, [edges, nodes, selected]);

  // 生成节点把最近一批任务的状态挂到卡片上：排队 / 生成中 / 已出几张，打开画布就能看到
  const batchState = useMemo(() => {
    const map = new Map<string, { status: string; progress?: number; message: string }>();
    for (const node of nodes) {
      const data = node.data.data;
      if (data.kind !== "generate" || !data.lastRunId) continue;
      const batch = jobs.filter((job) => job.runId === data.lastRunId);
      if (!batch.length) continue;
      const running = batch.find((job) => !TERMINAL.has(job.status));
      const done = batch.filter((job) => job.status === "SUCCESS").length;
      const failed = batch.filter((job) => job.status === "FAILED").length;
      if (running) {
        map.set(node.id, {
          status: running.status,
          progress: running.progress,
          message: "生成中",
        });
      } else {
        map.set(node.id, {
          status: failed ? "FAILED" : "SUCCESS",
          message: `已完成 ${done}/${batch.length}${failed ? ` · 失败 ${failed}` : ""}`,
        });
      }
    }
    return map;
  }, [nodes, jobs]);

  // 每个节点都带上「双击开面板 / 卡片内改提示词 / 卡片内生成」，生成节点再挂上本批任务态
  const displayNodes = useMemo(
    () =>
      nodes.map((node) => {
        const data = node.data.data;
        const state = batchState.get(node.id);
        const blockedReason =
          data.kind !== "generate"
            ? ""
            : !(Boolean(data.prompt.trim()) || promptFedNodes.has(node.id))
              ? "先写提示词，或连一个提示词节点进来"
              : data.media === "video" && !(Number(data.duration) > 0)
                ? "先在右侧面板填写视频时长（秒）"
                : "";
        const canRun = data.kind !== "generate" ? undefined : blockedReason === "";
        return {
          ...node,
          data: {
            ...node.data,
            ...(state || {}),
            onOpen: openPanel,
            onPatch: (nodeId: string, patch: Partial<CanvasNodeData>) => patchNode(nodeId, patch),
            onRun: (nodeId: string) => void runNode(nodeId),
            onRefs: patchNodeRefs,
            wired: wiredByNode.get(node.id) || [],
            canRun,
            runBlockedReason: blockedReason,
            running: Boolean(state && (state.status === "RUNNING" || state.status === "PENDING")),
          },
        };
      }),
    [nodes, batchState, openPanel, patchNode, patchNodeRefs, promptFedNodes, runNode, wiredByNode],
  );

  // 画布内的「+」菜单：先按产出类型选（图片 / 视频 / 音乐），再是提示词 / 素材 / 模型配置
  const addMenu = [
    {
      key: "image",
      label: "图片生成节点",
      icon: <PictureOutlined />,
      onClick: () => addNode("generate", { media: "image" }),
    },
    {
      key: "video",
      label: "视频生成节点",
      icon: <VideoCameraOutlined />,
      onClick: () => addNode("generate", { media: "video" }),
    },
    {
      key: "music",
      label: "音乐生成节点",
      icon: <CustomerServiceOutlined />,
      onClick: () => addNode("generate", { media: "music" }),
    },
    { type: "divider" as const },
    {
      key: "prompt",
      label: "提示词节点（喂给生成节点）",
      icon: <FileTextOutlined />,
      onClick: () => addNode("prompt"),
    },
    {
      key: "asset",
      label: "从数字资产选素材",
      icon: <PictureOutlined />,
      onClick: () => setPickerOpen(true),
    },
    {
      key: "config",
      label: "模型配置节点（喂给生成节点）",
      icon: <SettingOutlined />,
      onClick: () => addNode("config"),
    },
  ];

  return (
    <div className="cv-immersive">
      {error ? <Notice variant="error">{error}</Notice> : null}
      {loading ? (
        <div className="cv-loading">
          <Skeleton active paragraph={{ rows: 6 }} />
        </div>
      ) : (
        <div className="cv-editor">
          <div className="cv-canvas">
            <ReactFlow<CanvasFlowNode, Edge>
              nodes={displayNodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={(changes) => {
                onNodesChange(changes);
                if (changes.some((item) => item.type === "position" && item.dragging === false)) {
                  setDirty(true);
                }
              }}
              onEdgesChange={(changes) => {
                onEdgesChange(changes);
                if (changes.some((item) => item.type === "remove")) setDirty(true);
              }}
              onConnect={onConnect}
              onEdgeDoubleClick={(_, edge) => cycleEdgeRole(edge)}
              onNodeClick={(_, node) => setSelected(node.id)}
              onPaneClick={() => setSelected(null)}
              onNodesDelete={() => setDirty(true)}
              minZoom={0.2}
              maxZoom={1.8}
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={16} />
              <Controls showInteractive={false} />
            </ReactFlow>
            {!nodes.length ? (
              <div className="cv-hint">
                点画布底部的「添加节点」放一个生成节点：选图片 / 视频 / 音乐，提示词直接写在卡片里，点卡片上的生成就能出片
              </div>
            ) : null}

            <div className="cv-topbar">
              <Button
                type="text"
                icon={<ArrowLeftOutlined />}
                onClick={() => router.push("/content/canvas")}
              >
                返回画布
              </Button>
              <Input
                value={title}
                maxLength={120}
                variant="borderless"
                className="cv-topbar-title"
                onChange={(event) => {
                  setTitle(event.target.value);
                  setDirty(true);
                }}
                onBlur={() => {
                  if (project && title.trim() && title !== project.title) void persist(true);
                }}
              />
              {project ? (
                <Tag color="default" style={{ marginInlineEnd: 0 }}>
                  {`v${project.version}`}
                </Tag>
              ) : null}
              {dirty ? <Tag color="orange">未保存</Tag> : null}
              <div className="cv-topbar-actions">
                <Button
                  icon={<SaveOutlined />}
                  loading={saving}
                  disabled={!dirty}
                  onClick={() => void persist(false)}
                >
                  保存
                </Button>
                <Button
                  type="primary"
                  icon={<CloudUploadOutlined />}
                  loading={saving}
                  onClick={() => {
                    void (async () => {
                      if (await persist(false)) router.push("/content/canvas");
                    })();
                  }}
                >
                  保存并退出
                </Button>
              </div>
            </div>

            <div className="cv-dock">
              <Dropdown menu={{ items: addMenu }} trigger={["click"]} placement="topLeft">
                <Button type="primary" shape="round" icon={<PlusOutlined />}>
                  添加节点
                </Button>
              </Dropdown>
              <span className="cv-dock-tip">再把它和素材 / 提示词连线</span>
              <Badge count={pendingCount} size="small" offset={[-2, 2]}>
                <Button
                  shape="round"
                  icon={<ProfileOutlined />}
                  onClick={() => setTaskOpen((prev) => !prev)}
                >
                  任务
                </Button>
              </Badge>
            </div>
          </div>

          {selectedNode ? (
            <NodePanel
              canvasId={id}
              node={{
                id: selectedNode.id,
                type: selectedNode.data.kind,
                x: selectedNode.position.x,
                y: selectedNode.position.y,
                width: 220,
                data: selectedNode.data.data,
              }}
              channels={channels}
              wiring={wiring}
              wired={wiredByNode.get(selectedNode.id) || []}
              onPatch={(patch) => patchNode(selectedNode.id, patch)}
              onDelete={() => deleteNode(selectedNode.id)}
              onChanged={() => {
                setTaskVersion((prev) => prev + 1);
                void load();
              }}
              onRefreshed={() => void refreshDoc()}
            />
          ) : null}

          {taskOpen ? (
            <div className="cv-taskdock">
              <div className="cv-taskdock-head">
                <strong>画布任务</strong>
                <Button
                  size="small"
                  type="text"
                  icon={<CloseOutlined />}
                  onClick={() => setTaskOpen(false)}
                />
              </div>
              <div className="cv-taskdock-body">
                <TaskDock canvasId={id} title="" refreshKey={taskVersion} />
              </div>
            </div>
          ) : null}
        </div>
      )}

      <AssetReferencePicker
        open={pickerOpen}
        existingUrls={nodes
          .filter((node) => node.data.kind === "asset")
          .map((node) => String((node.data.data as { url?: string }).url || ""))}
        onCancel={() => setPickerOpen(false)}
        onPick={(assets) => {
          addAssetNodes(assets);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

