import type { WorkflowGraph } from '@enterprise/contracts';
import { compileGraph, resolveTemplates } from './workflow-graph';

function node(
  id: string,
  type = 'action',
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    type,
    kind: `${type}.${id}`,
    name: id,
    operationId: '',
    params: {},
    position: { x: 0, y: 0 },
    config: {},
    ...extra,
  };
}

function edge(source: string, target: string) {
  return {
    id: `${source}-${target}`,
    source,
    target,
    sourceHandle: '',
    targetHandle: '',
    mapping: {},
  };
}

function graph(
  nodes: WorkflowGraph['nodes'],
  edges: WorkflowGraph['edges'],
): WorkflowGraph {
  return { nodes, edges };
}

describe('workflow graph compile', () => {
  it('accepts a DAG and records entry nodes', () => {
    const result = compileGraph(
      graph(
        [node('a'), node('b'), node('c')],
        [edge('a', 'b'), edge('b', 'c')],
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compiled.entries).toEqual(['a']);
    expect(
      result.compiled.outgoing.get('a')?.map((item) => item.target),
    ).toEqual(['b']);
  });

  it('rejects cycles so a run cannot loop forever', () => {
    const result = compileGraph(
      graph([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')]),
    );
    expect(result).toEqual({
      ok: false,
      message: '工作流存在环（每个节点都有上游），无法执行',
    });
  });

  it('rejects duplicate ids and unknown node kinds', () => {
    expect(compileGraph(graph([node('a'), node('a')], []))).toEqual({
      ok: false,
      message: '节点 id 重复：a',
    });
    expect(compileGraph(graph([node('a', 'unknown')], []))).toMatchObject({
      ok: false,
    });
  });

  it('rejects edges pointing at a missing node', () => {
    const result = compileGraph(graph([node('a')], [edge('a', 'ghost')]));
    expect(result.ok).toBe(false);
  });
});

describe('workflow template resolution', () => {
  const context = {
    input: { lead: { name: '张三', tags: ['A', 'B'] }, count: 2 },
    vars: { greeting: '你好' },
    nodes: { n1: { data: { status: 'OPEN' }, id: 7 } },
  };

  it('keeps the original type when the whole string is one placeholder', () => {
    expect(resolveTemplates('{{input.count}}', context)).toBe(2);
    expect(resolveTemplates('{{nodes.n1.data}}', context)).toEqual({
      status: 'OPEN',
    });
    expect(resolveTemplates('{{input.lead.tags}}', context)).toEqual([
      'A',
      'B',
    ]);
  });

  it('interpolates inline placeholders as text', () => {
    expect(
      resolveTemplates('{{vars.greeting}}，{{input.lead.name}}', context),
    ).toBe('你好，张三');
  });

  it('resolves nested objects and arrays recursively', () => {
    expect(
      resolveTemplates(
        { title: '{{input.lead.name}}', list: ['{{nodes.n1.id}}', 'plain'] },
        context,
      ),
    ).toEqual({ title: '张三', list: [7, 'plain'] });
  });

  it('treats a bare path as a variable and leaves a miss undefined', () => {
    expect(resolveTemplates('{{greeting}}', context)).toBe('你好');
    expect(resolveTemplates('{{input.missing.deep}}', context)).toBeUndefined();
    expect(resolveTemplates('前缀-{{input.missing.deep}}', context)).toBe(
      '前缀-',
    );
  });
});
