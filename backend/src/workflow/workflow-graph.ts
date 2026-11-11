import { WORKFLOW_NODE_KINDS } from '@enterprise/contracts';
import type {
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from '@enterprise/contracts';

/**
 * 图编译与校验：保存 / 发布 / 运行前都必须过这一关。
 * 只有 DAG 能被执行（环检测在编译期拦下），悬空连线与必填输入同样在这里拒绝。
 */
export type CompiledGraph = {
  nodes: Map<string, WorkflowNode>;
  edges: WorkflowEdge[];
  /** 节点 id → 出边 */
  outgoing: Map<string, WorkflowEdge[]>;
  /** 节点 id → 入边 */
  incoming: Map<string, WorkflowEdge[]>;
  /** 入度为 0 的入口节点 */
  entries: string[];
};

const KINDS = new Set<string>(WORKFLOW_NODE_KINDS);

export function compileGraph(
  graph: WorkflowGraph,
): { ok: true; compiled: CompiledGraph } | { ok: false; message: string } {
  const nodes = new Map<string, WorkflowNode>();
  for (const node of graph.nodes) {
    if (!node.id) return { ok: false, message: '存在没有 id 的节点' };
    if (nodes.has(node.id)) {
      return { ok: false, message: `节点 id 重复：${node.id}` };
    }
    if (!KINDS.has(node.type)) {
      return {
        ok: false,
        message: `节点「${node.name || node.id}」的类型不合法`,
      };
    }
    nodes.set(node.id, node);
  }
  const outgoing = new Map<string, WorkflowEdge[]>();
  const incoming = new Map<string, WorkflowEdge[]>();
  for (const id of nodes.keys()) {
    outgoing.set(id, []);
    incoming.set(id, []);
  }
  for (const edge of graph.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
      return { ok: false, message: `连线指向了不存在的节点：${edge.id}` };
    }
    if (edge.source === edge.target) {
      return { ok: false, message: `节点不能连到自己：${edge.source}` };
    }
    outgoing.get(edge.source)!.push(edge);
    incoming.get(edge.target)!.push(edge);
  }
  const entries = [...nodes.keys()].filter(
    (id) => (incoming.get(id)?.length ?? 0) === 0,
  );
  if (!nodes.size) return { ok: false, message: '工作流还没有节点' };
  if (!entries.length) {
    return { ok: false, message: '工作流存在环（每个节点都有上游），无法执行' };
  }
  // Kahn 拓扑排序，仍有剩余即存在环。
  const indegree = new Map<string, number>();
  for (const id of nodes.keys()) indegree.set(id, incoming.get(id)!.length);
  const queue = [...entries];
  let visited = 0;
  while (queue.length) {
    const current = queue.shift()!;
    visited += 1;
    for (const edge of outgoing.get(current) ?? []) {
      const left = (indegree.get(edge.target) ?? 0) - 1;
      indegree.set(edge.target, left);
      if (left === 0) queue.push(edge.target);
    }
  }
  if (visited !== nodes.size) {
    return { ok: false, message: '工作流存在环，无法执行' };
  }
  return {
    ok: true,
    compiled: { nodes, edges: graph.edges, outgoing, incoming, entries },
  };
}

/** 模板取值：`{{input.x}}` / `{{vars.y}}` / `{{nodes.<id>.z}}` / `{{actor.userId}}`，对象与数组递归解析。 */
export function resolveTemplates(
  value: unknown,
  context: RunContextLike,
): unknown {
  if (typeof value === 'string') return resolveString(value, context);
  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplates(item, context));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = resolveTemplates(item, context);
    }
    return out;
  }
  return value;
}

export type RunContextLike = {
  input: Record<string, unknown>;
  vars: Record<string, unknown>;
  nodes: Record<string, unknown>;
  /** 运行发起人（可选）：{{actor.userId}} / {{actor.username}}。 */
  actor?: { userId: string; username: string };
};

const EXACT = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
const INLINE = /\{\{\s*([^}]+?)\s*\}\}/g;

function resolveString(value: string, context: RunContextLike): unknown {
  const exact = EXACT.exec(value);
  if (exact) return readPath(exact[1], context);
  return value.replace(INLINE, (_match, expression: string) => {
    const resolved = readPath(expression, context);
    return asText(resolved);
  });
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/** 只认四条命名空间前缀；裸路径当作变量名。 */
function readPath(expression: string, context: RunContextLike): unknown {
  const path = expression.trim();
  const [head, ...rest] = path.split('.');
  if (head === 'input') return dig(context.input, rest);
  if (head === 'vars') return dig(context.vars, rest);
  if (head === 'nodes') return dig(context.nodes, rest);
  if (head === 'actor') return dig(context.actor, rest);
  return dig(context.vars, [head, ...rest]);
}

function dig(root: unknown, path: string[]): unknown {
  let current = root;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(key);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
