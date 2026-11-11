import {
  WORKFLOW_NODE_KIND_LABELS,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeSpec,
} from '@enterprise/contracts';
import { compileGraph } from './workflow-graph';
import { builtinNodeOf } from './workflow-catalog';
import { validateTriggers } from './workflow-triggers';

/**
 * 「AI 搭建工作流」的提示词与产物归一：把模型返回的草案收敛成一张能保存的图。
 *
 * 为什么不把整张节点目录塞进提示词：动作节点从契约派生，有两千多个，
 * 全量塞进去一次要几十万字符、又贵又装不下。这里按用户当轮的话检索「最相关的动作」，
 * 内置节点与本人的集成工具则全量给全；检索不到的动作让模型改用 ai.agent 节点兜底。
 */

/** 单轮提示词里最多带多少个动作节点（内置与集成工具不占这个额度）。 */
const ACTION_LIMIT = 80;

const isObj = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const str = (value: unknown): string =>
  typeof value === 'string' ? value : '';

/** 取词：ASCII 词 + 中文二元组（中文没有空格，按二元组切片做匹配）。 */
function terms(input: string): string[] {
  const lower = input.toLowerCase();
  const out = new Set<string>();
  for (const match of lower.matchAll(/[a-z0-9_]{2,}/g)) out.add(match[0]);
  for (const run of lower.match(/[\u4e00-\u9fa5]+/g) ?? []) {
    if (run.length <= 2) out.add(run);
    for (let i = 0; i + 2 <= run.length; i += 1) out.add(run.slice(i, i + 2));
  }
  return [...out];
}

/** 相关度：key / 名称命中权重高于分组与说明。 */
function score(spec: WorkflowNodeSpec, keys: string[]): number {
  const key = spec.key.toLowerCase();
  const name = spec.name.toLowerCase();
  const rest = `${spec.group} ${spec.description}`.toLowerCase();
  let total = 0;
  for (const term of keys) {
    if (key.includes(term)) total += 4;
    else if (name.includes(term)) total += 3;
    else if (rest.includes(term)) total += 1;
  }
  return total;
}

/** 内置节点全给；集成工具（连接器 / 硬件）全给；系统动作按当轮语义检索前 N 条。 */
export function selectPromptNodes(
  specs: WorkflowNodeSpec[],
  query: string,
): WorkflowNodeSpec[] {
  const builtin: WorkflowNodeSpec[] = [];
  const tools: WorkflowNodeSpec[] = [];
  const actions: WorkflowNodeSpec[] = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    if (seen.has(spec.key)) continue;
    seen.add(spec.key);
    if (builtinNodeOf(spec.key)) builtin.push(spec);
    else if (spec.kind === 'action') actions.push(spec);
    else tools.push(spec);
  }
  const keys = terms(query);
  const ranked =
    keys.length > 0
      ? actions
          .map((spec) => ({ spec, score: score(spec, keys) }))
          .sort(
            (a, b) => b.score - a.score || a.spec.key.localeCompare(b.spec.key),
          )
          .filter((entry) => entry.score > 0)
          .slice(0, ACTION_LIMIT)
          .map((entry) => entry.spec)
      : actions.slice(0, ACTION_LIMIT);
  return [...builtin, ...tools, ...ranked];
}

/** 节点目录按「内置 / 动作 / 工具」三段落进提示词，字段只保留模型要用的那几列。 */
export function buildSystemPrompt(specs: WorkflowNodeSpec[]): string {
  const builtin: string[] = [];
  const tools: string[] = [];
  const actions: string[] = [];
  for (const spec of specs) {
    const kindLabel = WORKFLOW_NODE_KIND_LABELS[spec.kind] || spec.kind;
    if (builtinNodeOf(spec.key)) {
      const schema = spec.inputSchema
        ? `\n    config: ${JSON.stringify(spec.inputSchema)}`
        : '';
      builtin.push(
        `- key=${spec.key} | ${kindLabel} | ${spec.name} | ${spec.description}${schema}`,
      );
    } else if (spec.kind === 'action') {
      actions.push(
        `- key=${spec.key} | ${spec.name}${spec.group ? ` | 分组=${spec.group}` : ''}${spec.write ? ' | 写动作' : ''}`,
      );
    } else {
      tools.push(
        `- key=${spec.key} | ${spec.name}${spec.group ? ` | ${spec.group}` : ''}`,
      );
    }
  }
  const section = (title: string, lines: string[]) =>
    lines.length ? `\n### ${title}\n${lines.join('\n')}\n` : '';
  return [
    '你是企业系统里的「工作流搭建助手」。用户用自然语言描述一个自动化流程，',
    '你把它翻译成一张可执行的工作流 DAG（有向无环图），并给用户一句中文回复。',
    '',
    '## 可用节点（只能使用下列 key，不得自造）',
    section('内置节点（配置写进 config）', builtin),
    section('系统动作（入参写进 params，路径参数写进 pathParams）', actions),
    section('集成工具（连接器 / 硬件，入参写进 params）', tools),
    '## 输出格式',
    '只输出一个 JSON 对象，不要解释文字、不要 markdown 代码围栏：',
    '{"reply":"给用户的中文回复","name":"工作流名称（≤120字）","description":"一句话说明（≤500字）",',
    ' "nodes":[{"id":"n1","key":"节点 key","name":"节点显示名","config":{},"params":{},"pathParams":{}}],',
    ' "edges":[{"id":"e1","source":"n1","target":"n2","sourceHandle":"","mapping":{}}]}',
    '',
    '## 硬约束',
    '1. 恰好一个触发节点作入口（trigger.*）；所有非触发节点都要有入边。',
    '2. key 只能取上表的值；type 由节点目录决定，你不要自己写 type。',
    '3. 图必须无环；条件分支 logic.condition 的两条出边 sourceHandle 分别填 "true" 与 "false"，其余出边留空。',
    '4. 动态取值用模板：{{input.x}} / {{vars.x}} / {{nodes.<节点id>.x}} / {{actor.userId}}；派给发起人本人时用 {{actor.userId}}。',
    '5. 不要编造具体账号、金额、单据号；用户没给的信息在 reply 里说明请其补充。',
    '6. 需要的系统动作不在列表里时，用一个 key=ai.agent 的节点描述该任务（config:{"mode":"agent","prompt":"…"}），不要臆造 key。',
    '7. 节点 id 用 n1、n2…，连线 id 用 e1、e2…；位置可省略，系统会自动排版。',
  ].join('\n');
}

/** 分层排版：按最长路径（Kahn）给每个节点定层，层内按出现顺序纵向排开。成环时未定层的一律留在第 0 层。 */
function autoLayout(nodes: WorkflowNode[], edges: WorkflowEdge[]): void {
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const node of nodes) {
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }
  for (const edge of edges) {
    if (!indegree.has(edge.target) || !outgoing.has(edge.source)) continue;
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)!.push(edge.target);
  }
  const layer = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const queue = nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  while (queue.length) {
    const current = queue.shift()!;
    const depth = layer.get(current) ?? 0;
    for (const next of outgoing.get(current) ?? []) {
      if ((layer.get(next) ?? 0) < depth + 1) layer.set(next, depth + 1);
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  const counts = new Map<number, number>();
  for (const node of nodes) {
    const depth = layer.get(node.id) ?? 0;
    const at = counts.get(depth) ?? 0;
    counts.set(depth, at + 1);
    node.position = { x: 80 + depth * 240, y: 80 + at * 140 };
  }
}

export type AiBuildGraph = {
  graph: WorkflowGraph;
  ready: boolean;
  issues: string[];
};

/**
 * 归一模型产物：只认目录里有的 key，type / operationId / 名称一律以目录为准；
 * 未知节点与悬空连线剔除并记进 issues；缺位置时自动分层排版。
 */
export function normalizeAiGraph(
  raw: Record<string, unknown>,
  specs: WorkflowNodeSpec[],
): AiBuildGraph {
  const byKey = new Map(specs.map((spec) => [spec.key, spec]));
  const issues: string[] = [];
  const idMap = new Map<string, string>();
  const nodes: WorkflowNode[] = [];
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  let needsLayout = false;
  for (const entry of rawNodes) {
    if (!isObj(entry)) continue;
    const key = str(entry.key).trim();
    const spec = byKey.get(key);
    if (!spec) {
      issues.push(`忽略了未知节点「${key || '（空）'}」`);
      continue;
    }
    const id = `n${nodes.length + 1}`;
    const rawId = str(entry.id).trim();
    if (rawId && !idMap.has(rawId)) idMap.set(rawId, id);
    const builtin = Boolean(builtinNodeOf(spec.key));
    const params = builtin ? {} : isObj(entry.params) ? entry.params : {};
    const config: Record<string, unknown> = builtin
      ? isObj(entry.config)
        ? entry.config
        : {}
      : {};
    if (
      !builtin &&
      isObj(entry.pathParams) &&
      Object.keys(entry.pathParams).length
    ) {
      config.pathParams = entry.pathParams;
    }
    const position = isObj(entry.position)
      ? { x: Number(entry.position.x), y: Number(entry.position.y) }
      : { x: 0, y: 0 };
    const placed =
      Number.isFinite(position.x) &&
      Number.isFinite(position.y) &&
      (position.x !== 0 || position.y !== 0);
    if (!placed) needsLayout = true;
    nodes.push({
      id,
      type: spec.kind,
      kind: spec.key,
      name: str(entry.name).trim() || spec.name || spec.key,
      operationId: spec.operationId || '',
      params,
      position: placed ? position : { x: 0, y: 0 },
      config,
    });
  }
  const edges: WorkflowEdge[] = [];
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];
  for (const entry of rawEdges) {
    if (!isObj(entry)) continue;
    const source = idMap.get(str(entry.source).trim());
    const target = idMap.get(str(entry.target).trim());
    if (!source || !target || source === target) continue;
    const mapping: Record<string, string> = {};
    if (isObj(entry.mapping)) {
      for (const [from, to] of Object.entries(entry.mapping)) {
        mapping[from] = str(to);
      }
    }
    edges.push({
      id: `e${edges.length + 1}`,
      source,
      target,
      sourceHandle: str(entry.sourceHandle).trim(),
      targetHandle: str(entry.targetHandle).trim(),
      mapping,
    });
  }
  const graph: WorkflowGraph = { nodes, edges };
  if (needsLayout && nodes.length) autoLayout(nodes, edges);
  if (!nodes.length) {
    issues.push('这一轮还没有生成可用节点');
    return { graph, ready: false, issues };
  }
  const compiled = compileGraph(graph);
  if (!compiled.ok) issues.push(compiled.message);
  const triggers = compiled.ok
    ? validateTriggers(graph)
    : { ok: true as const };
  if (compiled.ok && !triggers.ok) issues.push(triggers.message);
  if (!nodes.some((node) => node.type === 'trigger')) {
    issues.push(
      '还没有触发节点：可加一个 trigger.manual / trigger.schedule / trigger.event',
    );
  }
  return { graph, ready: compiled.ok && triggers.ok, issues };
}
