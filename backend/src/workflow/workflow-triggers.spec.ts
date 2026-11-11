import type { WorkflowGraph, WorkflowNode } from '@enterprise/contracts';
import {
  dueScheduleSlots,
  eventBindings,
  scheduleBindings,
  taskBindings,
  validateTriggers,
} from './workflow-triggers';

function trigger(
  id: string,
  kind: string,
  config: Record<string, unknown> = {},
): WorkflowNode {
  return {
    id,
    type: 'trigger',
    kind,
    name: id,
    operationId: '',
    params: {},
    position: { x: 0, y: 0 },
    config,
  };
}

function graph(nodes: WorkflowNode[]): WorkflowGraph {
  return { nodes, edges: [] };
}

describe('trigger validation', () => {
  it('accepts a graph without trigger nodes', () => {
    expect(validateTriggers(graph([]))).toEqual({ ok: true });
  });

  it('rejects an invalid cron with the offending node name', () => {
    const result = validateTriggers(
      graph([trigger('n1', 'trigger.schedule', { cron: 'every monday' })]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('n1');
    expect(result.message).toContain('cron');
  });

  it('rejects a missing cron / event name', () => {
    expect(
      validateTriggers(graph([trigger('n1', 'trigger.schedule')])),
    ).toEqual({ ok: false, message: expect.stringContaining('cron') });
    expect(validateTriggers(graph([trigger('n2', 'trigger.event')]))).toEqual({
      ok: false,
      message: expect.stringContaining('事件名'),
    });
  });

  it('only accepts the three task change kinds', () => {
    for (const event of ['created', 'closed', 'overdue']) {
      expect(
        validateTriggers(graph([trigger('n1', 'trigger.task', { event })])),
      ).toEqual({ ok: true });
    }
    expect(
      validateTriggers(graph([trigger('n1', 'trigger.task', { event: 'x' })])),
    ).toEqual({ ok: false, message: expect.stringContaining('created') });
  });

  it('accepts a fully configured graph', () => {
    expect(
      validateTriggers(
        graph([
          trigger('s', 'trigger.schedule', { cron: '0 9 * * 1-5' }),
          trigger('e', 'trigger.event', { event: 'crm.lead.created' }),
          trigger('t', 'trigger.task', { event: 'closed', source: 'crm' }),
        ]),
      ),
    ).toEqual({ ok: true });
  });
});

describe('trigger bindings', () => {
  it('reads only the matching trigger kind and skips unconfigured nodes', () => {
    const g = graph([
      trigger('s1', 'trigger.schedule', { cron: '*/5 * * * *' }),
      trigger('s2', 'trigger.schedule', {}),
      trigger('e1', 'trigger.event', { event: 'crm.order.approved' }),
      trigger('e2', 'trigger.event', { event: '  ' }),
      trigger('t1', 'trigger.task', { event: 'overdue', source: ' pj ' }),
      trigger('t2', 'trigger.task', { event: 'unknown' }),
      trigger('m1', 'trigger.manual'),
    ]);
    expect(scheduleBindings(g).map((item) => item.nodeId)).toEqual(['s1']);
    expect(eventBindings(g)).toEqual([
      { nodeId: 'e1', event: 'crm.order.approved' },
    ]);
    expect(taskBindings(g)).toEqual([
      { nodeId: 't1', event: 'overdue', source: 'pj' },
    ]);
  });

  it('never produces a webhook binding (external triggering is not offered)', () => {
    const g = graph([trigger('w', 'trigger.webhook')]);
    expect(scheduleBindings(g)).toEqual([]);
    expect(eventBindings(g)).toEqual([]);
    expect(taskBindings(g)).toEqual([]);
  });
});

describe('due schedule slots', () => {
  const now = new Date('2026-11-10T01:05:00Z');

  it('returns one slot per hit minute inside the lookback window', () => {
    const bindings = scheduleBindings(
      graph([trigger('s', 'trigger.schedule', { cron: '* * * * *' })]),
    );
    const slots = dueScheduleSlots(bindings, now, 3);
    expect(slots.map((item) => item.key)).toEqual([
      '2026-11-10T01:03:00Z',
      '2026-11-10T01:04:00Z',
      '2026-11-10T01:05:00Z',
    ]);
  });

  it('does not start the same workflow twice when two cron nodes hit the same minute', () => {
    const bindings = scheduleBindings(
      graph([
        trigger('s1', 'trigger.schedule', { cron: '* * * * *' }),
        trigger('s2', 'trigger.schedule', { cron: '*/5 * * * *' }),
      ]),
    );
    const slots = dueScheduleSlots(bindings, now, 3);
    expect(slots).toHaveLength(3);
    expect(new Set(slots.map((item) => item.key)).size).toBe(3);
  });

  it('returns nothing for a schedule that does not hit the window', () => {
    const bindings = scheduleBindings(
      graph([trigger('s', 'trigger.schedule', { cron: '0 9 * * *' })]),
    );
    expect(dueScheduleSlots(bindings, now)).toEqual([]);
  });

  it('returns nothing when the graph has no schedule trigger', () => {
    expect(
      dueScheduleSlots(
        scheduleBindings(graph([trigger('m', 'trigger.manual')])),
        now,
      ),
    ).toEqual([]);
  });
});
