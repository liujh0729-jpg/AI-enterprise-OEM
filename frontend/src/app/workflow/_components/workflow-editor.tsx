"use client";

import "@xyflow/react/dist/style.css";
import {
  ApartmentOutlined,
  CloseOutlined,
  CloudUploadOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  RobotOutlined,
  SaveOutlined,
  SlidersOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Drawer,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
} from "antd";
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  WorkflowBudgets,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeSpec,
  WorkflowRow,
  WorkflowRun,
} from "@enterprise/contracts";
import {
  WORKFLOW_BUDGET_FIELD_LABELS,
  WORKFLOW_NODE_KIND_LABELS,
  WORKFLOW_SCOPES,
  WORKFLOW_SCOPE_LABELS,
  type WorkflowScope,
} from "@enterprise/contracts";
import { workflowApi } from "@/api/workflow";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Notice } from "@/components/ui/panel";
import { resolveStatus } from "@/lib/status";
import { WorkflowAiBuilder } from "@/app/workflow/_components/ai-builder";

/** 画布节点上挂的数据：契约节点字段 + 运行态高亮。 */
type WfNodeData = {
  label: string;
  nodeType: string;
  kindLabel: string;
  specKey: string;
  operationId: string;
  params: Record<string, unknown>;
  config: Record<string, unknown>;
  runStatus?: string;
};
type WfFlowNode = Node<WfNodeData, "wf">;
type WfEdgeData = { mapping: Record<string, string> };
type WfFlowEdge = Edge<WfEdgeData>;

const KIND_BADGE: Record<string, string> = {
  trigger: "orange",
  action: "blue",
  ai: "violet",
  logic: "sky",
  human: "green",
  integration: "gray",
};

const KIND_ORDER = ["trigger", "action", "logic", "ai", "human", "integration"];

/** 运行未到终态时继续轮询；WAITING 表示挂起等人工，不再自旋。 */
const RUN_RESTING = new Set(["DONE", "FAILED", "CANCELED", "WAITING"]);

const EMPTY_BUDGETS: WorkflowBudgets = {
  maxAiCalls: 0,
  maxTokens: 0,
  maxToolCalls: 0,
  maxBrowserActions: 0,
  maxNodes: 0,
};

/** 执行预算字段顺序 + 取值口径与上限（0＝不限）。 */
const BUDGET_FIELDS: {
  key: keyof WorkflowBudgets;
  hint: string;
  max: number;
}[] = [
  {
    key: "maxNodes",
    hint: "单次运行的节点执行次数上限，兜住循环与重复触发",
    max: 10000,
  },
  {
    key: "maxAiCalls",
    hint: "单次运行调用大模型 / Agent 的次数上限",
    max: 10000,
  },
  {
    key: "maxTokens",
    hint: "单次运行消耗的 token 上限（输入 + 输出）",
    max: 100000000,
  },
  {
    key: "maxToolCalls",
    hint: "单次运行调用系统动作 / 集成工具的次数上限",
    max: 10000,
  },
  {
    key: "maxBrowserActions",
    hint: "单次运行浏览器动作（RPA / 插件派发）次数上限",
    max: 10000,
  },
];

/** 已设上限的摘要，用于工具栏悬停与预算面板标题。 */
function budgetSummary(budgets: WorkflowBudgets): string {
  const parts = BUDGET_FIELDS.filter(({ key }) => budgets[key] > 0).map(
    ({ key }) => `${WORKFLOW_BUDGET_FIELD_LABELS[key]} ${budgets[key]}`,
  );
  return parts.length ? parts.join(" · ") : "未设上限（不限次数与用量）";
}

/** 运行用量摘要：AI 调用 / token / 工具 / 浏览器动作 / 节点，都为 0 时显示占位。 */
function usageText(run: WorkflowRun): string {
  const usage = run.usage;
  if (!usage) return "—";
  const tokens = usage.tokenIn + usage.tokenOut;
  const parts = [
    usage.nodes ? `${usage.nodes} 节点` : "",
    usage.aiCalls ? `${usage.aiCalls} 次 AI` : "",
    tokens ? `${tokens} tokens` : "",
    usage.toolCalls ? `${usage.toolCalls} 次工具` : "",
    usage.browserActions ? `${usage.browserActions} 次浏览器` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "—";
}

function nodeField(
  node: Pick<WfFlowNode, "data">,
  spec: WorkflowNodeSpec | undefined,
): "params" | "config" {
  if (node.data.nodeType === "action") return "params";
  if (spec && spec.inputSchema !== null) return "config";
  return "params";
}

function specOf(
  specs: WorkflowNodeSpec[],
  key: string,
): WorkflowNodeSpec | undefined {
  return specs.find((spec) => spec.key === key);
}

function toFlow(
  graph: WorkflowGraph,
  specs: WorkflowNodeSpec[],
): { nodes: WfFlowNode[]; edges: WfFlowEdge[] } {
  return {
    nodes: (graph.nodes || []).map((node) => {
      const spec = specOf(specs, node.kind);
      return {
        id: node.id,
        type: "wf" as const,
        position: {
          x: Number(node.position?.x) || 0,
          y: Number(node.position?.y) || 0,
        },
        data: {
          label: node.name || spec?.name || node.kind,
          nodeType: node.type,
          kindLabel:
            WORKFLOW_NODE_KIND_LABELS[node.type] || spec?.kindLabel || node.type,
          specKey: node.kind,
          operationId: node.operationId || "",
          params: node.params || {},
          config: node.config || {},
        },
      };
    }),
    edges: (graph.edges || []).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
      data: { mapping: edge.mapping || {} },
      markerEnd: { type: MarkerType.ArrowClosed },
    })),
  };
}

function toGraph(nodes: WfFlowNode[], edges: WfFlowEdge[]): WorkflowGraph {
  return {
    nodes: nodes.map(
      (node): WorkflowNode => ({
        id: node.id,
        type: node.data.nodeType,
        kind: node.data.specKey,
        name: node.data.label,
        operationId: node.data.operationId || "",
        params: node.data.params || {},
        position: {
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
        },
        config: node.data.config || {},
      }),
    ),
    edges: edges.map(
      (edge): WorkflowEdge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle || "",
        targetHandle: edge.targetHandle || "",
        mapping: edge.data?.mapping || {},
      }),
    ),
  };
}

// 拖拽时其余节点数据不变：memo 让未变化的节点跳过重渲染，只保留被拖节点。
const WfNodeView = memo(function WfNodeView({
  data,
  selected,
}: NodeProps<WfFlowNode>) {
  const run = data.runStatus
    ? resolveStatus("workflowRun", data.runStatus)
    : null;
  return (
    <div
      className={`wf-node${selected ? " selected" : ""}${
        data.runStatus ? ` run-${data.runStatus.toLowerCase()}` : ""
      }`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="wf-node-head">
        <span className={`badge badge-${KIND_BADGE[data.nodeType] || "gray"}`}>
          {data.kindLabel}
        </span>
        {run ? <span className="wf-node-run">{run.label}</span> : null}
      </div>
      <div className="wf-node-title">{data.label}</div>
      <div className="wf-node-key">{data.specKey}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

const nodeTypes: NodeTypes = { wf: WfNodeView };

/**
 * 工作流编辑器：抽屉内整屏三栏（节点目录 / 画布 / 检查器）+ 底部 Playground。
 * 保存与发布走密码确认（修改类操作）；试跑免密，结果按 runDetail 轮询（SSE 仅 GET，前端传输层是 POST）。
 */
export function WorkflowEditor({
  id,
  readOnly = false,
  onClose,
  onSaved,
}: {
  id: number | null;
  readOnly?: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  return (
    <Drawer
      open={id !== null}
      onClose={onClose}
      placement="right"
      size="100%"
      closable={false}
      mask={{ closable: false }}
      destroyOnHidden
      className="wf-drawer"
      styles={{
        body: {
          padding: 0,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        },
      }}
    >
      {id !== null ? (
        <ReactFlowProvider>
          <WorkflowEditorInner
            key={id}
            id={id}
            readOnly={readOnly}
            onClose={onClose}
            onSaved={onSaved}
          />
        </ReactFlowProvider>
      ) : null}
    </Drawer>
  );
}

function WorkflowEditorInner({
  id,
  readOnly,
  onClose,
  onSaved,
}: {
  id: number;
  readOnly: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { message, modal: confirmModal } = App.useApp();
  const { request: requestPassword, modal: passwordModal } = usePasswordConfirm();
  const { fitView } = useReactFlow<WfFlowNode, WfFlowEdge>();
  const [detail, setDetail] = useState<WorkflowRow | null>(null);
  const [specs, setSpecs] = useState<WorkflowNodeSpec[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<WorkflowScope>("PRIVATE");
  const [budgets, setBudgets] = useState<WorkflowBudgets>(EMPTY_BUDGETS);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<WfFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<WfFlowEdge>([]);
  // 节点数组镜像：让新增节点等回调保持稳定，不因拖拽每帧变化而重建节点目录。
  const nodesRef = useRef<WfFlowNode[]>([]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [selected, setSelected] = useState<{
    type: "node" | "edge";
    id: string;
  } | null>(null);
  const [jsonDraft, setJsonDraft] = useState<{
    key: string;
    text: string;
    error: string;
  }>({ key: "", text: "", error: "" });
  const [filter, setFilter] = useState("");
  const [playOpen, setPlayOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [inputText, setInputText] = useState("{}");
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<WorkflowRun | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [row, catalog] = await Promise.all([
        workflowApi.detail({ params: { id: String(id) } }),
        workflowApi
          .catalog({})
          .catch(() => ({ nodes: [] as WorkflowNodeSpec[] })),
      ]);
      if (!row) throw new Error("工作流不存在或无权查看");
      const catalogNodes = catalog?.nodes || [];
      setDetail(row);
      setName(row.name);
      setDescription(row.description);
      setScope(row.scope as WorkflowScope);
      setBudgets(row.budgets || EMPTY_BUDGETS);
      setSpecs(catalogNodes);
      setCatalogError(
        catalogNodes.length ? "" : "节点目录加载失败，可在保存后重开本页重试",
      );
      const flow = toFlow(row.graph, catalogNodes);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setDirty(false);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id, message, setEdges, setNodes]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 运行态回写：按步骤状态给节点上色，不改动节点数据本身。 */
  const applyRunStatus = useCallback(
    (next: WorkflowRun | null) => {
      const map = new Map<string, string>(
        (next?.steps || []).map((step) => [step.nodeId, step.status]),
      );
      // 轮询周期内步骤状态多数不变：无变化时返回原数组，避免整图无谓重渲染。
      setNodes((current) => {
        let changed = false;
        const updated = current.map((node) => {
          const status = map.get(node.id);
          if (node.data.runStatus === status) return node;
          changed = true;
          return { ...node, data: { ...node.data, runStatus: status } };
        });
        return changed ? updated : current;
      });
    },
    [setNodes],
  );

  const runId = run?.id;
  const runStatus = run?.status;
  useEffect(() => {
    if (!runId || !runStatus || RUN_RESTING.has(runStatus)) return;
    let alive = true;
    const timer = setInterval(() => {
      void workflowApi
        .runDetail({ params: { runId: String(runId) } })
        .then((next) => {
          if (!alive) return;
          setRun(next);
          applyRunStatus(next);
        })
        .catch(() => undefined);
    }, 1200);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [runId, runStatus, applyRunStatus]);

  const updateNode = (nodeId: string, patch: Partial<WfNodeData>) => {
    setNodes((current) =>
      current.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node,
      ),
    );
    setDirty(true);
  };

  const addNode = useCallback(
    (spec: WorkflowNodeSpec) => {
      if (readOnly) return;
      const current = nodesRef.current;
      const max = current.reduce((acc, node) => {
        const num = Number(node.id.replace(/^n/, ""));
        return Number.isFinite(num) && num > acc ? num : acc;
      }, 0);
      const nodeId = `n${max + 1}`;
      const index = current.length;
      setNodes((prev) => [
        ...prev,
        {
          id: nodeId,
          type: "wf",
          position: {
            x: 80 + (index % 4) * 230,
            y: 80 + Math.floor(index / 4) * 130,
          },
          data: {
            label: spec.name || spec.key,
            nodeType: spec.kind,
            kindLabel:
              spec.kindLabel ||
              WORKFLOW_NODE_KIND_LABELS[spec.kind] ||
              spec.kind,
            specKey: spec.key,
            operationId: spec.operationId || "",
            params: {},
            config: {},
          },
        },
      ]);
      setSelected({ type: "node", id: nodeId });
      setDirty(true);
    },
    [readOnly, setNodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) return;
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: `e${Date.now().toString(36)}`,
            data: { mapping: {} },
            markerEnd: { type: MarkerType.ArrowClosed },
          },
          current,
        ),
      );
      setDirty(true);
    },
    [readOnly, setEdges],
  );

  const autoLayout = async () => {
    if (!nodes.length) return;
    try {
      const ELK = (await import("elkjs/lib/elk.bundled.js")).default;
      const elk = new ELK();
      const layout = await elk.layout({
        id: "root",
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": "RIGHT",
          "elk.spacing.nodeNode": "48",
          "elk.layered.spacing.nodeNodeBetweenLayers": "72",
        },
        children: nodes.map((node) => ({ id: node.id, width: 200, height: 78 })),
        edges: edges.map((edge) => ({
          id: edge.id,
          sources: [edge.source],
          targets: [edge.target],
        })),
      });
      const positions = new Map<string, { x: number; y: number }>();
      for (const child of layout.children || []) {
        positions.set(child.id, { x: child.x || 0, y: child.y || 0 });
      }
      setNodes((current) =>
        current.map((node) => ({
          ...node,
          position: positions.get(node.id) || node.position,
        })),
      );
      setDirty(true);
      setTimeout(() => void fitView({ padding: 0.2, duration: 300 }), 40);
    } catch {
      message.warning("自动排版失败：请先检查节点连线是否成环");
    }
  };

  /** 把 AI 产出的图写回画布：整体替换节点与连线，标脏后由工具栏「保存」持久化。 */
  const applyAiGraph = useCallback(
    (payload: { name: string; description: string; graph: WorkflowGraph }) => {
      const flow = toFlow(payload.graph, specs);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setSelected(null);
      setDirty(true);
      setAiOpen(false);
      message.success("已应用到画布，确认后点「保存」");
      setTimeout(() => void fitView({ padding: 0.2, duration: 300 }), 40);
    },
    [fitView, message, setEdges, setNodes, specs],
  );

  /**
   * React Flow 每次渲染都可能回调选中集合，且每次都传新的数组/对象：
   * 只在选中项真正变化时更新 state，否则 setState 会触发无限重渲染（Maximum update depth）。
   */
  const onSelectionChange = useCallback(
    ({ nodes: pickedNodes, edges: pickedEdges }: OnSelectionChangeParams) => {
      const next =
        pickedNodes.length === 1
          ? { type: "node" as const, id: pickedNodes[0].id }
          : pickedEdges.length === 1
            ? { type: "edge" as const, id: pickedEdges[0].id }
            : null;
      setSelected((prev) =>
        prev?.type === next?.type && prev?.id === next?.id ? prev : next,
      );
    },
    [],
  );

  const persist = async (silent: boolean) => {
    if (!name.trim()) {
      message.warning("请填写工作流名称");
      return;
    }
    setSaving(true);
    try {
      const updated = await workflowApi.save({
        params: { id: String(id) },
        body: {
          name: name.trim(),
          description,
          scope,
          budgets,
          graph: toGraph(nodes, edges),
        },
      });
      if (!updated) {
        message.error("保存失败：未返回工作流");
        return;
      }
      setDetail(updated);
      setDirty(false);
      if (!silent) message.success("已保存");
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    requestPassword({
      title: "保存工作流",
      okText: "保存",
      content: "保存后画布、节点参数与可见性立即更新；已发布版本快照不受影响。",
      onOk: async () => {
        await persist(true);
      },
    });
  };

  const publish = () => {
    if (dirty) {
      message.warning("画布有未保存改动，请先保存再发布");
      return;
    }
    if (!nodes.length) {
      message.warning("画布为空，至少放一个节点再发布");
      return;
    }
    requestPassword({
      title: "发布工作流",
      okText: "发布当前版本",
      content:
        "发布会把当前画布冻结为可调用版本；共享范围内可在 Agent / MCP 中按 wf__编号 调用。",
      onOk: async () => {
        setPublishing(true);
        try {
          const row = await workflowApi.publish({ params: { id: String(id) } });
          if (!row) {
            message.error("发布失败：未返回工作流");
            return;
          }
          setDetail(row);
          onSaved?.();
          message.success(`已发布 v${row.publishedVersion ?? row.version}`);
        } finally {
          setPublishing(false);
        }
      },
    });
  };

  const startRun = async () => {
    let input: Record<string, unknown> = {};
    if (inputText.trim()) {
      try {
        const parsed: unknown = JSON.parse(inputText);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("需要 JSON 对象");
        }
        input = parsed as Record<string, unknown>;
      } catch {
        message.warning("输入必须是 JSON 对象，例如 {\"leadId\": 12}");
        return;
      }
    }
    setRunning(true);
    setPlayOpen(true);
    try {
      const created = await workflowApi.run({
        params: { id: String(id) },
        body: { input },
      });
      setRun(created);
      applyRunStatus(created);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const close = () => {
    if (!dirty) {
      onClose();
      return;
    }
    confirmModal.confirm({
      title: "放弃未保存的改动？",
      content: "画布与节点参数尚未保存，关闭后本次改动会丢失。",
      okText: "放弃并关闭",
      cancelText: "继续编辑",
      okButtonProps: { danger: true },
      onOk: onClose,
    });
  };

  const selectedKey = selected ? `${selected.type}:${selected.id}` : "";
  const selectedNode =
    selected?.type === "node"
      ? nodes.find((node) => node.id === selected.id)
      : undefined;
  const selectedEdge =
    selected?.type === "edge"
      ? edges.find((edge) => edge.id === selected.id)
      : undefined;
  const selectedSpec = selectedNode
    ? specOf(specs, selectedNode.data.specKey)
    : undefined;
  const field = selectedNode ? nodeField(selectedNode, selectedSpec) : null;
  const currentJson = useMemo(
    () =>
      selectedNode && field
        ? selectedNode.data[field]
        : selectedEdge
          ? selectedEdge.data?.mapping || {}
          : null,
    [field, selectedEdge, selectedNode],
  );
  const activeDraft = jsonDraft.key === selectedKey ? jsonDraft : null;
  // 拖拽只改节点坐标、不改 data：缓存序列化结果，避免每帧对参数做 JSON.stringify。
  const jsonText = useMemo(
    () =>
      currentJson === null
        ? ""
        : activeDraft
          ? activeDraft.text
          : JSON.stringify(currentJson, null, 2),
    [activeDraft, currentJson],
  );

  const changeJson = (text: string) => {
    if (!selected) return;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("需要 JSON 对象");
      }
      if (selected.type === "node" && selectedNode && field) {
        updateNode(selectedNode.id, { [field]: parsed });
      }
      if (selected.type === "edge") {
        setEdges((current) =>
          current.map((edge) =>
            edge.id === selected.id
              ? {
                  ...edge,
                  data: { mapping: parsed as Record<string, string> },
                }
              : edge,
          ),
        );
        setDirty(true);
      }
      setJsonDraft({ key: selectedKey, text, error: "" });
    } catch {
      setJsonDraft({
        key: selectedKey,
        text,
        error: "JSON 格式不正确，尚未写回",
      });
    }
  };

  const groups = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    const matched = specs.filter(
      (spec) =>
        !keyword ||
        spec.name.toLowerCase().includes(keyword) ||
        spec.key.toLowerCase().includes(keyword) ||
        (spec.group || "").toLowerCase().includes(keyword),
    );
    return KIND_ORDER.map((kind) => ({
      kind,
      label: WORKFLOW_NODE_KIND_LABELS[kind] || kind,
      items: matched.filter((spec) => spec.kind === kind),
    })).filter((group) => group.items.length);
  }, [filter, specs]);

  const nodeLabel = (nodeId: string) =>
    nodes.find((node) => node.id === nodeId)?.data.label || nodeId;

  // 节点目录是长列表：只在筛选词/目录/只读态变化时重建，拖拽期间不参与重渲染。
  const catalog = useMemo(
    () => (
      <aside className="wf-catalog">
        <Input
          allowClear
          size="small"
          placeholder="搜索节点"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          style={{ marginBottom: 8 }}
        />
        {catalogError ? <Notice variant="warn">{catalogError}</Notice> : null}
        {readOnly ? (
          <Notice variant="info">只读：仅创建人可编辑</Notice>
        ) : null}
        {groups.length === 0 ? (
          <EmptyState text="没有匹配的节点" />
        ) : (
          groups.map((group) => (
            <div className="wf-catalog-group" key={group.kind}>
              <div className="wf-catalog-title">
                <span>{group.label}</span>
                <span className="muted text-12">{group.items.length}</span>
              </div>
              {group.items.map((spec) => (
                <div
                  key={spec.key}
                  className={`wf-catalog-item${readOnly ? " disabled" : ""}`}
                  role="button"
                  tabIndex={readOnly ? -1 : 0}
                  title={spec.description || spec.name}
                  onClick={() => addNode(spec)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      addNode(spec);
                    }
                  }}
                >
                  <span className="wf-catalog-name">{spec.name}</span>
                  {spec.write ? (
                    <span className="badge badge-orange">写</span>
                  ) : null}
                  {!readOnly ? (
                    <PlusOutlined className="wf-catalog-add" aria-hidden />
                  ) : null}
                </div>
              ))}
            </div>
          ))
        )}
      </aside>
    ),
    [addNode, catalogError, filter, groups, readOnly],
  );

  return (
    <div className="wf-editor">
      <div className="wf-toolbar">
        <Button
          icon={<CloseOutlined />}
          onClick={close}
          aria-label="关闭编辑器"
        />
        <div className="wf-toolbar-title">
          <Input
            value={name}
            disabled={readOnly}
            maxLength={120}
            style={{ maxWidth: 320 }}
            onChange={(event) => {
              setName(event.target.value);
              setDirty(true);
            }}
          />
          {detail ? (
            <span
              className={`badge badge-${resolveStatus("workflow", detail.status).variant}`}
            >
              {detail.statusLabel || resolveStatus("workflow", detail.status).label}
            </span>
          ) : null}
          {detail?.publishedVersion ? (
            <span className="text-12 muted">已发布 v{detail.publishedVersion}</span>
          ) : null}
          {dirty ? <Tag color="orange">未保存</Tag> : null}
        </div>
        <div className="wf-toolbar-actions">
          <Select
            value={scope}
            disabled={readOnly}
            style={{ width: 130 }}
            onChange={(value) => {
              setScope(value);
              setDirty(true);
            }}
            options={WORKFLOW_SCOPES.map((value) => ({
              value,
              label: WORKFLOW_SCOPE_LABELS[value],
            }))}
          />
          <Tooltip title={`执行预算：${budgetSummary(budgets)}`}>
            <Button
              icon={<SlidersOutlined />}
              onClick={() => setBudgetOpen(true)}
            >
              执行预算
            </Button>
          </Tooltip>
          <Tooltip title="按连线自动分层排布">
            <Button icon={<ApartmentOutlined />} onClick={() => void autoLayout()}>
              自动排版
            </Button>
          </Tooltip>
          <Tooltip title="用自然语言让 AI 在当前画布上搭建 / 调整">
            <Button
              icon={<RobotOutlined />}
              disabled={readOnly}
              onClick={() => setAiOpen(true)}
            >
              AI搭建工作流
            </Button>
          </Tooltip>
          <Button
            icon={<SaveOutlined />}
            disabled={readOnly}
            loading={saving}
            onClick={save}
          >
            保存
          </Button>
          <Button
            type="primary"
            icon={<CloudUploadOutlined />}
            disabled={readOnly || dirty}
            loading={publishing}
            onClick={publish}
          >
            发布
          </Button>
          <Button
            icon={<PlayCircleOutlined />}
            loading={running}
            onClick={() => void startRun()}
          >
            试跑
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="wf-loading">
          <Spin />
        </div>
      ) : (
        <div className="wf-body">
          {catalog}

          <div className="wf-canvas">
            <ReactFlow<WfFlowNode, WfFlowEdge>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeDragStop={() => setDirty(true)}
              onNodesDelete={() => setDirty(true)}
              onEdgesDelete={() => setDirty(true)}
              onSelectionChange={onSelectionChange}
              nodesDraggable={!readOnly}
              nodesConnectable={!readOnly}
              deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
              onlyRenderVisibleElements
              fitView
              minZoom={0.2}
              maxZoom={1.8}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={16} />
              <Controls showInteractive={false} />
            </ReactFlow>
            {nodes.length === 0 && !readOnly ? (
              <div className="wf-canvas-hint">
                从左侧节点目录点击添加：先放「触发器」，再连动作与分支
              </div>
            ) : null}
          </div>

          <aside className="wf-inspector">
            {selectedNode ? (
              <>
                <div className="wf-inspector-head">
                  <span className={`badge badge-${KIND_BADGE[selectedNode.data.nodeType] || "gray"}`}>
                    {selectedNode.data.kindLabel}
                  </span>
                  <span className="text-12 muted">{selectedNode.id}</span>
                </div>
                <label className="wf-field">
                  <span className="wf-field-label">节点名称</span>
                  <Input
                    size="small"
                    value={selectedNode.data.label}
                    disabled={readOnly}
                    onChange={(event) =>
                      updateNode(selectedNode.id, { label: event.target.value })
                    }
                  />
                </label>
                <div className="wf-field">
                  <span className="wf-field-label">节点类型</span>
                  <code className="wf-code">{selectedNode.data.specKey}</code>
                </div>
                {selectedSpec?.description ? (
                  <div className="wf-field">
                    <span className="wf-field-label">说明</span>
                    <div className="text-12 muted">{selectedSpec.description}</div>
                  </div>
                ) : null}
                {field ? (
                  <label className="wf-field">
                    <span className="wf-field-label">
                      {field === "params" ? "调用参数（JSON）" : "节点配置（JSON）"}
                    </span>
                    <Input.TextArea
                      className="wf-json"
                      autoSize={{ minRows: 8, maxRows: 20 }}
                      spellCheck={false}
                      disabled={readOnly}
                      value={jsonText}
                      status={activeDraft?.error ? "error" : undefined}
                      onChange={(event) => changeJson(event.target.value)}
                    />
                    <span className="text-12 muted">
                      {activeDraft?.error ||
                        "支持 {{input.xxx}} / {{nodes.节点ID.xxx}} 引用上游输出"}
                    </span>
                  </label>
                ) : null}
              </>
            ) : selectedEdge ? (
              <>
                <div className="wf-inspector-head">
                  <span className="badge badge-sky">连线</span>
                  <span className="text-12 muted">{selectedEdge.id}</span>
                </div>
                <div className="wf-field">
                  <span className="wf-field-label">方向</span>
                  <div className="text-12">
                    {nodeLabel(selectedEdge.source)} → {nodeLabel(selectedEdge.target)}
                  </div>
                </div>
                <label className="wf-field">
                  <span className="wf-field-label">参数映射（JSON）</span>
                  <Input.TextArea
                    className="wf-json"
                    autoSize={{ minRows: 6, maxRows: 16 }}
                    spellCheck={false}
                    disabled={readOnly}
                    value={jsonText}
                    status={activeDraft?.error ? "error" : undefined}
                    onChange={(event) => changeJson(event.target.value)}
                  />
                  <span className="text-12 muted">
                    {activeDraft?.error ||
                      "左侧是下游参数名，右侧是上游取值表达式"}
                  </span>
                </label>
              </>
            ) : (
              <div className="wf-inspector-empty">
                <WarningOutlined aria-hidden />
                <div>点画布上的节点或连线查看与修改参数</div>
              </div>
            )}
          </aside>
        </div>
      )}

      {playOpen ? (
        <section className="wf-playground">
          <div className="wf-playground-head">
            <strong>试跑</strong>
            {run ? (
              <span
                className={`badge badge-${resolveStatus("workflowRun", run.status).variant}`}
              >
                {run.statusLabel || resolveStatus("workflowRun", run.status).label}
              </span>
            ) : null}
            {run ? <span className="text-12 muted">运行 #{run.id}</span> : null}
            {run ? (
              <span className="text-12 muted">用量：{usageText(run)}</span>
            ) : null}
            <Space style={{ marginLeft: "auto" }}>
              <Button size="small" onClick={() => setPlayOpen(false)}>
                收起
              </Button>
            </Space>
          </div>
          <div className="wf-playground-grid">
            <div className="wf-playground-input">
              <div className="wf-field-label">输入（JSON 对象）</div>
              <Input.TextArea
                className="wf-json"
                autoSize={{ minRows: 5, maxRows: 12 }}
                spellCheck={false}
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
              />
              <Button
                type="primary"
                size="small"
                icon={<PlayCircleOutlined />}
                loading={running}
                onClick={() => void startRun()}
                style={{ marginTop: 8 }}
              >
                运行
              </Button>
            </div>
            <div className="wf-playground-steps">
              {!run ? (
                <div className="text-12 muted">
                  运行后在这里逐步显示节点结果；等待人工的流程会停在「等待中」。
                </div>
              ) : run.steps.length === 0 ? (
                <div className="text-12 muted">正在排队…</div>
              ) : (
                <div className="wf-steps">
                  {run.steps.map((step) => {
                    const spec = resolveStatus("workflowRun", step.status);
                    return (
                      <div className="wf-step" key={step.id}>
                        <span className={`badge badge-${spec.variant}`}>
                          {spec.label === step.status ? step.status : spec.label}
                        </span>
                        <span className="wf-step-name">{nodeLabel(step.nodeId)}</span>
                        <span className="text-12 muted">
                          {step.durationMs ? `${step.durationMs} ms` : ""}
                        </span>
                        {step.error ? (
                          <div className="wf-step-error">{step.error}</div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
              {run?.error ? (
                <Notice variant="error">{run.error}</Notice>
              ) : null}
              {run && run.budgetStop && run.budgetStop !== "NONE" ? (
                <Notice variant="warn">
                  本次运行触达执行预算（{run.budgetStopLabel || run.budgetStop}），已在超预算边界停止。
                </Notice>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <Modal
        title="执行预算"
        open={budgetOpen}
        onCancel={() => setBudgetOpen(false)}
        onOk={() => setBudgetOpen(false)}
        okText="完成"
        cancelButtonProps={{ style: { display: "none" } }}
        destroyOnHidden
        width={520}
      >
        <p className="text-12 muted" style={{ marginTop: 4 }}>
          单次运行超过任一上限即停在节点边界并记「超预算」；0 表示不限。
          {readOnly ? "只读：仅创建人可改。" : "改动随工具栏「保存」生效。"}
        </p>
        <div className="wf-budget-form">
          {BUDGET_FIELDS.map((field) => (
            <label className="wf-field" key={field.key}>
              <span className="wf-field-label">
                {WORKFLOW_BUDGET_FIELD_LABELS[field.key]}
              </span>
              <InputNumber
                min={0}
                max={field.max}
                style={{ width: 200 }}
                disabled={readOnly}
                value={budgets[field.key]}
                onChange={(value) => {
                  setBudgets((prev) => ({
                    ...prev,
                    [field.key]: Math.max(0, Math.floor(Number(value) || 0)),
                  }));
                  setDirty(true);
                }}
              />
              <span className="text-12 muted">{field.hint}</span>
            </label>
          ))}
        </div>
      </Modal>

      <WorkflowAiBuilder
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        graph={toGraph(nodes, edges)}
        onApply={applyAiGraph}
      />

      {passwordModal}
    </div>
  );
}
