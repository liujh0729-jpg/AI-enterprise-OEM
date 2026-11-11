import { WORKFLOW_TEMPLATES } from '../../frontend/src/app/workflow/workflow-templates';
import { compileGraph } from '../src/workflow/workflow-graph';
import { validateTriggers } from '../src/workflow/workflow-triggers';

/**
 * 配方模板与后端校验同源：模板创建后会走保存 / 发布同一套编译与触发器校验，
 * 这里直接在 Node 侧跑，模板缺触发、成环、cron 写错或订阅错事件名都会当场红。
 */
describe('workflow recipe templates', () => {
  it('模板 key 与名称唯一', () => {
    const keys = WORKFLOW_TEMPLATES.map((item) => item.key);
    const names = WORKFLOW_TEMPLATES.map((item) => item.name);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(WORKFLOW_TEMPLATES.map((item) => [item.key, item] as const))(
    '%s：过得了图编译与触发器校验',
    (_key, template) => {
      expect(compileGraph(template.graph).ok).toBe(true);
      expect(validateTriggers(template.graph)).toEqual({ ok: true });
    },
  );

  it.each(WORKFLOW_TEMPLATES.map((item) => [item.key, item] as const))(
    '%s：恰有一个触发，且示例入参覆盖全部 input 引用',
    (_key, template) => {
      const triggers = template.graph.nodes.filter(
        (node) => node.type === 'trigger',
      );
      expect(triggers).toHaveLength(1);
      const raw = JSON.stringify(template.graph);
      const refs = [...raw.matchAll(/\{\{input\.([A-Za-z0-9_]+)/g)].map(
        (match) => match[1],
      );
      for (const field of new Set(refs)) {
        expect(template.sampleInput).toHaveProperty(field);
      }
    },
  );

  it('事件触发只订阅真实存在的领域事件名', () => {
    const events = WORKFLOW_TEMPLATES.flatMap((template) =>
      template.graph.nodes
        .filter((node) => node.kind === 'trigger.event')
        .map((node) => node.config.event)
        .filter((event): event is string => typeof event === 'string'),
    );
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) expect(KNOWN_EVENTS).toContain(event);
  });
});

/** 与 backend 广播的领域事件名逐字一致（acquisition / recruit 两个现有桥）。 */
const KNOWN_EVENTS = [
  'acquisition.lead.created',
  'crm.lead.created',
  'crm.order.created',
  'crm.payment.received',
  'recruit.application.confirmed',
];
