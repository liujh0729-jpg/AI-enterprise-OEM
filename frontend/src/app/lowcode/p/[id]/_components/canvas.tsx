"use client";

import {
  Button,
  Descriptions,
  Image,
  Input,
  InputNumber,
  Select,
  Table,
  Tag,
  message,
} from "antd";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  LowCodeEntityView,
  LowCodePageView,
} from "@enterprise/contracts";
import {
  LOWCODE_CANVAS_COMPONENTS,
  LOWCODE_CANVAS_COMPONENT_LABELS,
  LOWCODE_PAGE_TYPES,
} from "@enterprise/contracts";
import { lowcodeApi } from "@/api/lowcode";
import { EmptyState, Notice } from "@/components/ui/panel";
import { RowModal, errText } from "./row-form";
import { renderCellValue } from "./views";

export type CanvasNode = {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  props: Record<string, unknown>;
};

function parseNodes(page: LowCodePageView): CanvasNode[] {
  const raw = page.config.nodes;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => item as Record<string, unknown>)
    .filter((item) => item && typeof item === "object")
    .map((item, index) => ({
      id: String(item.id || `node-${index}`),
      type: String(item.type || "TEXT"),
      x: Number(item.x) || 0,
      y: Number(item.y) || 0,
      w: Number(item.w) || 320,
      h: Number(item.h) || 160,
      props: (item.props && typeof item.props === "object" ? item.props : {}) as Record<string, unknown>,
    }));
}

const DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
  HEADING: { w: 480, h: 56 },
  TEXT: { w: 480, h: 96 },
  DIVIDER: { w: 480, h: 24 },
  IMAGE: { w: 320, h: 240 },
  BUTTON: { w: 160, h: 56 },
  METRIC: { w: 240, h: 120 },
  ENTITY_LIST: { w: 640, h: 360 },
  ENTITY_FORM: { w: 320, h: 120 },
  ENTITY_DETAIL: { w: 640, h: 360 },
  KANBAN: { w: 640, h: 360 },
  APPROVAL_INBOX: { w: 640, h: 360 },
  SPACER: { w: 480, h: 48 },
};

let canvasNodeSeq = 0;

function nextNodeId(existing: CanvasNode[]): string {
  let id = "";
  do {
    canvasNodeSeq += 1;
    id = `n${canvasNodeSeq.toString(36)}`;
  } while (existing.some((node) => node.id === id));
  return id;
}

export function CanvasView({
  projectId,
  page,
  entities,
  canManage,
  onSaved,
}: {
  projectId: number;
  page: LowCodePageView;
  entities: LowCodeEntityView[];
  canManage: boolean;
  onSaved: () => void;
}) {
  const [nodes, setNodes] = useState<CanvasNode[]>(() => parseNodes(page));
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);

  useEffect(() => {
    setNodes(parseNodes(page));
  }, [page]);

  const selected = nodes.find((node) => node.id === selectedId);

  const update = (id: string, patch: Partial<CanvasNode>) => {
    setNodes((current) => current.map((node) => (node.id === id ? { ...node, ...patch } : node)));
  };

  const addNode = (type: string, x = 24, y = 24) => {
    const size = DEFAULT_SIZE[type] || { w: 320, h: 160 };
    const node: CanvasNode = {
      id: nextNodeId(nodes),
      type,
      x: Math.max(0, Math.round(x)),
      y: Math.max(0, Math.round(y)),
      ...size,
      props: defaultProps(type),
    };
    setNodes((current) => [...current, node]);
    setSelectedId(node.id);
    setEditing(true);
  };

  const drop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const type = event.dataTransfer.getData("text/lowcode-component");
    if (!type) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    addNode(type, event.clientX - (rect?.left || 0) - 40, event.clientY - (rect?.top || 0) - 20);
  };

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>, node: CanvasNode) => {
    if (!editing) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    dragRef.current = {
      id: node.id,
      dx: event.clientX - (rect?.left || 0) - node.x,
      dy: event.clientY - (rect?.top || 0) - node.y,
    };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    setSelectedId(node.id);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    update(drag.id, {
      x: Math.max(0, Math.round(event.clientX - (rect?.left || 0) - drag.dx)),
      y: Math.max(0, Math.round(event.clientY - (rect?.top || 0) - drag.dy)),
    });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const save = async () => {
    setSaving(true);
    try {
      await lowcodeApi.savePage({
        params: { id: String(projectId) },
        body: {
          id: page.id,
          parentId: page.parentId,
          type: page.type as (typeof LOWCODE_PAGE_TYPES)[number],
          name: page.name,
          entityId: page.entityId,
          config: { ...page.config, nodes },
          sort: page.sort,
          visible: page.visible,
        },
      });
      message.success("画布已保存");
      setEditing(false);
      onSaved();
    } catch (error) {
      message.error(errText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lowcode-canvas-wrap">
      <div className="lowcode-canvas-toolbar">
        <div>
          <strong>自由画布</strong>
          <span className="muted text-12" style={{ marginLeft: 8 }}>
            {nodes.length} 个组件
          </span>
        </div>
        <div>
          {canManage ? (
            editing ? (
              <>
                <Button
                  style={{ marginRight: 8 }}
                  danger
                  onClick={() => {
                    setNodes(parseNodes(page));
                    setEditing(false);
                  }}
                >
                  放弃修改
                </Button>
                <Button type="primary" loading={saving} onClick={() => void save()}>
                  保存画布
                </Button>
              </>
            ) : (
              <Button onClick={() => setEditing(true)}>编辑画布</Button>
            )
          ) : null}
        </div>
      </div>

      {editing ? (
        <div className="lowcode-canvas-palette">
          {LOWCODE_CANVAS_COMPONENTS.map((type) => (
            <button
              key={type}
              type="button"
              className="lowcode-palette-item"
              draggable
              onDragStart={(event) => event.dataTransfer.setData("text/lowcode-component", type)}
              onClick={() => addNode(type)}
            >
              {LOWCODE_CANVAS_COMPONENT_LABELS[type] || type}
            </button>
          ))}
          <span className="muted text-12">拖到画布上，或点一下直接添加</span>
        </div>
      ) : null}

      <div
        ref={canvasRef}
        className={editing ? "lowcode-canvas editing" : "lowcode-canvas"}
        onDragOver={(event) => event.preventDefault()}
        onDrop={drop}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        {!nodes.length ? (
          <div className="lowcode-canvas-empty">
            <EmptyState text={editing ? "从上方组件面板拖入组件开始设计。" : "画布还没有组件。"} />
          </div>
        ) : null}
        {nodes.map((node) => (
          <div
            key={node.id}
            className={
              selectedId === node.id && editing ? "lowcode-canvas-node selected" : "lowcode-canvas-node"
            }
            style={{ left: node.x, top: node.y, width: node.w, minHeight: node.h }}
            onClick={(event) => {
              event.stopPropagation();
              if (editing) setSelectedId(node.id);
            }}
          >
            {editing ? (
              <div
                className="lowcode-canvas-handle"
                onPointerDown={(event) => startDrag(event, node)}
              >
                <span>{LOWCODE_CANVAS_COMPONENT_LABELS[node.type] || node.type}</span>
                <span
                  className="lowcode-canvas-remove"
                  onClick={(event) => {
                    event.stopPropagation();
                    setNodes((current) => current.filter((item) => item.id !== node.id));
                    if (selectedId === node.id) setSelectedId(undefined);
                  }}
                >
                  删除
                </span>
              </div>
            ) : null}
            <div className="lowcode-canvas-body" style={editing ? { pointerEvents: "none" } : undefined}>
              <CanvasNodeView projectId={projectId} node={node} entities={entities} />
            </div>
          </div>
        ))}
      </div>

      {editing && selected ? (
        <NodeProps
          node={selected}
          entities={entities}
          onChange={(patch) => update(selected.id, patch)}
        />
      ) : null}
    </div>
  );
}

function defaultProps(type: string): Record<string, unknown> {
  switch (type) {
    case "HEADING":
      return { text: "标题" };
    case "TEXT":
      return { text: "在这里写说明文字。" };
    case "BUTTON":
      return { text: "按钮", url: "" };
    case "IMAGE":
      return { src: "", alt: "" };
    case "METRIC":
      return { label: "指标", entityId: 0, fieldKey: "", agg: "count" };
    case "ENTITY_LIST":
    case "ENTITY_FORM":
    case "ENTITY_DETAIL":
    case "KANBAN":
      return { entityId: 0 };
    default:
      return {};
  }
}

function NodeProps({
  node,
  entities,
  onChange,
}: {
  node: CanvasNode;
  entities: LowCodeEntityView[];
  onChange: (patch: Partial<CanvasNode>) => void;
}) {
  const entity = entities.find((item) => item.id === Number(node.props.entityId));
  const setProp = (key: string, value: unknown) =>
    onChange({ props: { ...node.props, [key]: value } });
  const needsEntity = ["METRIC", "ENTITY_LIST", "ENTITY_FORM", "ENTITY_DETAIL", "KANBAN"].includes(node.type);
  const entitySelect = (
    <Select
      style={{ width: "100%" }}
      placeholder="选择实体"
      value={Number(node.props.entityId) || undefined}
      options={entities.map((item) => ({ value: item.id, label: item.name }))}
      onChange={(value) => setProp("entityId", value)}
    />
  );

  return (
    <div className="lowcode-node-props">
      <div className="lowcode-node-props-title">
        组件属性 · {LOWCODE_CANVAS_COMPONENT_LABELS[node.type] || node.type}
      </div>
      <div className="lowcode-node-props-grid">
        {["HEADING", "TEXT", "BUTTON"].includes(node.type) ? (
          <label>
            文案
            <Input value={String(node.props.text || "")} onChange={(event) => setProp("text", event.target.value)} />
          </label>
        ) : null}
        {node.type === "BUTTON" ? (
          <label>
            跳转地址
            <Input value={String(node.props.url || "")} onChange={(event) => setProp("url", event.target.value)} placeholder="https://" />
          </label>
        ) : null}
        {node.type === "IMAGE" ? (
          <>
            <label>
              图片地址
              <Input value={String(node.props.src || "")} onChange={(event) => setProp("src", event.target.value)} placeholder="https://" />
            </label>
            <label>
              图片说明
              <Input value={String(node.props.alt || "")} onChange={(event) => setProp("alt", event.target.value)} />
            </label>
          </>
        ) : null}
        {needsEntity ? <label>数据实体{entitySelect}</label> : null}
        {node.type === "METRIC" ? (
          <>
            <label>
              指标名称
              <Input value={String(node.props.label || "")} onChange={(event) => setProp("label", event.target.value)} />
            </label>
            <label>
              聚合方式
              <Select
                style={{ width: "100%" }}
                value={String(node.props.agg || "count")}
                options={[
                  { value: "count", label: "行数" },
                  { value: "sum", label: "求和" },
                  { value: "avg", label: "平均" },
                ]}
                onChange={(value) => setProp("agg", value)}
              />
            </label>
            {node.props.agg !== "count" ? (
              <label>
                统计字段
                <Select
                  style={{ width: "100%" }}
                  value={String(node.props.fieldKey || "") || undefined}
                  options={((entity?.fields || []) as { fieldKey: string; name: string }[]).map((field) => ({
                    value: field.fieldKey,
                    label: field.name,
                  }))}
                  onChange={(value) => setProp("fieldKey", value)}
                />
              </label>
            ) : null}
          </>
        ) : null}
        <label>
          宽度
          <InputNumber style={{ width: "100%" }} min={80} value={node.w} onChange={(value) => onChange({ w: Number(value) || 80 })} />
        </label>
        <label>
          高度
          <InputNumber style={{ width: "100%" }} min={24} value={node.h} onChange={(value) => onChange({ h: Number(value) || 24 })} />
        </label>
      </div>
    </div>
  );
}

function useMiniRows(projectId: number, entityId: number | undefined, pageSize = 10) {
  const [rows, setRows] = useState<{ list: { id: number; data: Record<string, unknown> }[]; total: number }>({
    list: [],
    total: 0,
  });
  useEffect(() => {
    if (!entityId) {
      setRows({ list: [], total: 0 });
      return;
    }
    void lowcodeApi
      .entityRows({
        params: { id: String(projectId), entityId: String(entityId) },
        query: { page: 1, pageSize },
      })
      .then((result) => setRows(result as typeof rows))
      .catch(() => setRows({ list: [], total: 0 }));
  }, [projectId, entityId, pageSize]);
  return rows;
}

function CanvasNodeView({
  projectId,
  node,
  entities,
}: {
  projectId: number;
  node: CanvasNode;
  entities: LowCodeEntityView[];
}) {
  const entityId = Number(node.props.entityId) || undefined;
  const entity = entities.find((item) => item.id === entityId);

  if (node.type === "HEADING") return <h3 style={{ margin: 0 }}>{String(node.props.text || "标题")}</h3>;
  if (node.type === "TEXT") return <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{String(node.props.text || "")}</p>;
  if (node.type === "DIVIDER") return <hr style={{ border: 0, borderTop: "1px solid #e5e6eb", margin: "8px 0" }} />;
  if (node.type === "SPACER") return <div />;
  if (node.type === "IMAGE") {
    const src = String(node.props.src || "");
    return src ? <Image src={src} alt={String(node.props.alt || "")} style={{ maxWidth: "100%" }} /> : <Notice variant="warn">还没有填图片地址</Notice>;
  }
  if (node.type === "BUTTON") {
    const url = String(node.props.url || "");
    return (
      <Button type="primary" onClick={() => url && window.open(url, "_blank", "noopener")}>
        {String(node.props.text || "按钮")}
      </Button>
    );
  }
  if (node.type === "APPROVAL_INBOX") return <ApprovalMini projectId={projectId} />;
  if (!entity) return <Notice variant="warn">请在属性里选择数据实体</Notice>;

  if (node.type === "METRIC") return <MetricNode projectId={projectId} entity={entity} props={node.props} />;
  if (node.type === "ENTITY_LIST") return <ListMini projectId={projectId} entity={entity} />;
  if (node.type === "ENTITY_FORM") return <FormMini projectId={projectId} entity={entity} />;
  if (node.type === "ENTITY_DETAIL") return <DetailMini projectId={projectId} entity={entity} />;
  if (node.type === "KANBAN") return <KanbanMini projectId={projectId} entity={entity} />;
  return null;
}

function MetricNode({
  projectId,
  entity,
  props,
}: {
  projectId: number;
  entity: LowCodeEntityView;
  props: Record<string, unknown>;
}) {
  const { list, total } = useMiniRows(projectId, entity.id, 200);
  const agg = String(props.agg || "count");
  const fieldKey = String(props.fieldKey || "");
  const numbers = list.map((row) => Number(row.data[fieldKey])).filter((value) => Number.isFinite(value));
  const value =
    agg === "sum"
      ? numbers.reduce((sum, item) => sum + item, 0)
      : agg === "avg"
        ? numbers.length
          ? numbers.reduce((sum, item) => sum + item, 0) / numbers.length
          : 0
        : total;
  return (
    <div>
      <div className="muted text-12">{String(props.label || entity.name)}</div>
      <div style={{ fontSize: 28, fontWeight: 600 }}>
        {agg === "count" ? value : Math.round(value * 100) / 100}
      </div>
      {agg !== "count" ? <div className="muted text-12">按前 200 行统计</div> : null}
    </div>
  );
}

function ListMini({ projectId, entity }: { projectId: number; entity: LowCodeEntityView }) {
  const { list } = useMiniRows(projectId, entity.id, 10);
  const fields = entity.fields.slice(0, 3);
  return (
    <Table
      rowKey="id"
      size="small"
      pagination={false}
      dataSource={list}
      locale={{ emptyText: "暂无数据" }}
      columns={fields.map((field) => ({
        title: field.name,
        key: field.fieldKey,
        render: (_: unknown, row: { data: Record<string, unknown> }) =>
          renderCellValue(field.fieldType, row.data[field.fieldKey]),
      }))}
    />
  );
}

function FormMini({ projectId, entity }: { projectId: number; entity: LowCodeEntityView }) {
  const [open, setOpen] = useState(false);
  const [, setVersion] = useState(0);
  return (
    <>
      <Button type="primary" onClick={() => setOpen(true)}>
        新增{entity.name}
      </Button>
      {open ? (
        <RowModal
          open
          projectId={projectId}
          entity={entity}
          onClose={() => setOpen(false)}
          onSaved={() => setVersion((value) => value + 1)}
        />
      ) : null}
    </>
  );
}

function DetailMini({ projectId, entity }: { projectId: number; entity: LowCodeEntityView }) {
  const { list } = useMiniRows(projectId, entity.id, 50);
  const [rowId, setRowId] = useState<number>();
  const row = list.find((item) => item.id === rowId);
  return (
    <div>
      <Select
        style={{ width: "100%", marginBottom: 8 }}
        placeholder="选择一条数据"
        value={rowId}
        onChange={setRowId}
        options={list.map((item) => ({ value: item.id, label: `#${item.id}` }))}
      />
      {row ? (
        <Descriptions column={1} size="small" bordered>
          {entity.fields.map((field) => (
            <Descriptions.Item key={field.fieldKey} label={field.name}>
              {renderCellValue(field.fieldType, row.data[field.fieldKey])}
            </Descriptions.Item>
          ))}
        </Descriptions>
      ) : (
        <EmptyState text="选择数据后显示详情。" />
      )}
    </div>
  );
}

function KanbanMini({ projectId, entity }: { projectId: number; entity: LowCodeEntityView }) {
  const { list } = useMiniRows(projectId, entity.id, 200);
  const groupField = entity.fields.find((field) => field.fieldKey === entity.kanbanField);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    if (!groupField) return map;
    for (const row of list) {
      const key = String(row.data[groupField.fieldKey] ?? "未填写");
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [list, groupField]);
  if (!groupField) return <Notice variant="warn">该实体还没有看板分组字段</Notice>;
  return (
    <div className="lowcode-mini-kanban">
      {[...counts.entries()].map(([key, count]) => (
        <div key={key} className="lowcode-mini-kanban-item">
          <span>{key}</span>
          <Tag>{count}</Tag>
        </div>
      ))}
    </div>
  );
}

function ApprovalMini({ projectId }: { projectId: number }) {
  const [count, setCount] = useState<number | null>(null);
  const load = useCallback(() => {
    void lowcodeApi
      .approvalTasks({ params: { id: String(projectId) }, query: { status: "PENDING", page: 1, pageSize: 1 } })
      .then((result) => setCount(result ? result.total : null))
      .catch(() => setCount(null));
  }, [projectId]);
  useEffect(load, [load]);
  return (
    <div>
      <div className="muted text-12">待我处理</div>
      <div style={{ fontSize: 28, fontWeight: 600 }}>{count ?? "—"}</div>
      <Button size="small" onClick={load}>
        刷新
      </Button>
    </div>
  );
}
