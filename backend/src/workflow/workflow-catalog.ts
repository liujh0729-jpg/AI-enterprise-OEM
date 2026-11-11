import {
  MCP_FORBIDDEN_ACTIONS,
  WORKFLOW_NODE_KIND_LABELS,
  WORKFLOW_TASK_EVENTS,
  type WorkflowNodeSpec,
} from '@enterprise/contracts';
import {
  MCP_OPERATIONS,
  forbiddenReasonOf,
  operationSchema,
} from '../mcp/mcp-catalog';
import { buildAgentToolManifest } from '../content/agent-tool-manifest';
import type { ConnectorToolSpec } from '../content/agent-connectors.service';
import type { HardwareMcpTool } from '../hardware/hardware.service';

/**
 * 节点目录（§11.3「系统功能皆节点」的唯一口径）：
 *   - 系统动作 ← `endpoints` 契约注册表（与 MCP 清单同源，不写第二份）
 *   - 工具型 ← `AGENT_TOOL_MANIFEST` 的六类（内置 / 业务 / 连接器 / 硬件 / 技能 / 插件）
 *   - 触发 / 逻辑 / 人工 ← 本节的内置节点
 * 任何新模块只要进了契约，就自动出现在节点面板里，工作流代码不用改。
 */

type BuiltinSeed = {
  kind: string;
  key: string;
  name: string;
  description: string;
  group: string;
  write?: boolean;
  permission?: string;
  /** 节点配置表单（`config` 字段）的 JSON Schema。 */
  config?: Record<string, unknown>;
};

function jsonObject(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return { type: 'object', properties, required, additionalProperties: true };
}

function str(description: string): Record<string, unknown> {
  return { type: 'string', description };
}

function num(description: string): Record<string, unknown> {
  return { type: 'number', description };
}

/** 内置节点：触发器、逻辑、AI、人工、Webhook。写动作的红线在运行期由模块自身把关。 */
const BUILTIN_NODES: BuiltinSeed[] = [
  {
    kind: 'trigger',
    key: 'trigger.manual',
    name: '手动触发',
    description: '由人在列表页或编辑器点「运行」发起。',
    group: '触发',
    config: jsonObject({}),
  },
  {
    kind: 'trigger',
    key: 'trigger.schedule',
    name: '定时触发',
    description:
      '按 cron 表达式周期触发（时区 Asia/Shanghai，停机错过的周期不补跑）；运行发起人＝工作流创建人。',
    group: '触发',
    config: jsonObject({ cron: str('cron 表达式，如 0 9 * * 1-5') }, ['cron']),
  },
  {
    kind: 'trigger',
    key: 'trigger.event',
    name: '领域事件触发',
    description:
      '订阅本主体事件总线上的领域事件后自动发起运行；同一事件重复投递只起一次。',
    group: '触发',
    config: jsonObject({ event: str('事件名，如 crm.lead.created') }, [
      'event',
    ]),
  },
  {
    kind: 'trigger',
    key: 'trigger.task',
    name: '我的任务变化触发',
    description: '「我的任务」被创建 / 关闭 / 逾期时触发。',
    group: '触发',
    config: jsonObject(
      {
        event: {
          type: 'string',
          enum: [...WORKFLOW_TASK_EVENTS],
          description: '任务变化类型',
        },
        source: str('只订阅该来源的任务，留空＝全部来源，如 crm / pj / oa'),
      },
      ['event'],
    ),
  },
  {
    kind: 'logic',
    key: 'logic.condition',
    name: '条件分支',
    description: '按上游取值与期望值比较，走 true / false 两条出边。',
    group: '逻辑',
    config: jsonObject(
      {
        path: str('取值路径，如 nodes.n1.data.status'),
        operator: str('eq | ne | gt | gte | lt | lte | contains | empty'),
        value: { description: '期望值（可为数字 / 字符串 / 布尔）' },
      },
      ['path', 'operator'],
    ),
  },
  {
    kind: 'logic',
    key: 'logic.parallel',
    name: '并行分支',
    description: '所有出边同时继续，用「汇合」节点等待全部到齐。',
    group: '逻辑',
    config: jsonObject({}),
  },
  {
    kind: 'logic',
    key: 'logic.merge',
    name: '汇合',
    description: '等待所有入边到齐后继续，输出汇合了各分支结果。',
    group: '逻辑',
    config: jsonObject({}),
  },
  {
    kind: 'logic',
    key: 'logic.wait',
    name: '延时等待',
    description:
      '等待指定秒数后继续，最长 300 秒；更长的等待用「等待任务完成」。',
    group: '逻辑',
    config: jsonObject({ seconds: num('等待秒数，0–300') }, ['seconds']),
  },
  {
    kind: 'logic',
    key: 'logic.variable',
    name: '变量赋值',
    description: '把上游结果或常量写进运行变量，供下游用 {{vars.名字}} 引用。',
    group: '逻辑',
    config: jsonObject(
      {
        name: str('变量名'),
        value: { description: '取值或常量（支持 {{...}} 模板）' },
      },
      ['name'],
    ),
  },
  {
    kind: 'ai',
    key: 'ai.llm',
    name: '大模型调用',
    description: '按提示词调统一 AI 网关的文本模型，返回文本内容。',
    group: 'AI / Agent',
    config: jsonObject(
      {
        system: str('系统提示词（可选）'),
        prompt: str('用户提示词，支持 {{...}} 模板'),
      },
      ['prompt'],
    ),
  },
  {
    kind: 'ai',
    key: 'ai.retrieve',
    name: '知识库检索',
    description: '走统一 RAG 出口检索知识空间 / 资料库 / 帮助中心。',
    group: 'AI / Agent',
    config: jsonObject(
      {
        query: str('检索问题，支持 {{...}} 模板'),
        topK: num('返回条数，默认 6'),
      },
      ['query'],
    ),
  },
  {
    kind: 'ai',
    key: 'ai.agent',
    name: 'Agent / 子工作流',
    description: '把一段任务交给站内 Agent，或运行另一个已发布的工作流。',
    group: 'AI / Agent',
    config: jsonObject(
      {
        mode: str('agent | workflow'),
        prompt: str('交给 Agent 的任务描述（mode=agent）'),
        workflowId: num('目标工作流编号（mode=workflow）'),
        input: { description: '传给子工作流的入参对象' },
      },
      ['mode'],
    ),
  },
  {
    kind: 'human',
    key: 'human.assign_task',
    name: '分配任务',
    description:
      '写入「我的任务」，指派给某个账号；本节点产出任务编号供下游等待。',
    group: '人工',
    write: true,
    permission: '写入收件人的「我的任务」',
    config: jsonObject(
      {
        assignee: str('收件人账号 userId，支持 {{...}} 模板'),
        title: str('任务标题，支持 {{...}} 模板'),
        description: str('任务说明（可选）'),
        link: str('去处理链接（可选，默认 /tasks）'),
        category: str('approval | report | task | matter | audit'),
        priority: str('LOW | NORMAL | HIGH | URGENT'),
        dueDays: num('多少天后到期（可选）'),
      },
      ['assignee', 'title'],
    ),
  },
  {
    kind: 'human',
    key: 'human.wait_task',
    name: '等待任务完成',
    description:
      '挂起工作流，直到上游「分配任务」产出的任务被本人关闭，再继续。',
    group: '人工',
    config: jsonObject(
      { node: str('分配任务节点的 id（留空取最近一个）') },
      [],
    ),
  },
  {
    kind: 'human',
    key: 'human.form',
    name: '表单填写',
    description:
      '派发一张待填表单到「我的任务」，等本人提交后把字段值写入步骤产出 form 并继续。',
    group: '人工',
    write: true,
    permission: '写入收件人的「我的任务」',
    config: jsonObject(
      {
        assignee: str('收件人账号 userId'),
        title: str('表单标题'),
        fields: {
          type: 'array',
          description: '字段清单：{key,label,required}；提交值见步骤产出 form',
          items: { type: 'object' },
        },
      },
      ['assignee', 'title'],
    ),
  },
  {
    kind: 'integration',
    key: 'integration.webhook',
    name: '调用 Webhook',
    description: '向外部 HTTP 地址发一次请求，返回响应文本。',
    group: '集成',
    write: true,
    permission: '对外发起 HTTP 请求',
    config: jsonObject(
      {
        url: str('目标地址'),
        method: str('GET | POST（默认 POST）'),
        headers: { type: 'object', description: '请求头键值对' },
        body: { description: '请求体（对象，支持 {{...}} 模板）' },
      },
      ['url'],
    ),
  },
];

function builtinSpec(seed: BuiltinSeed): WorkflowNodeSpec {
  return {
    kind: seed.kind,
    kindLabel: WORKFLOW_NODE_KIND_LABELS[seed.kind] || seed.kind,
    key: seed.key,
    name: seed.name,
    description: seed.description,
    operationId: '',
    group: seed.group,
    write: seed.write ?? false,
    permission: seed.permission ?? '读操作，不消耗积分',
    forbiddenReason: '',
    inputSchema: seed.config ?? null,
    pathParams: [],
  };
}

/** 系统动作节点：任意契约 operationId，参数表单由其 Zod schema 自动生成。 */
export function actionNodeSpecs(): WorkflowNodeSpec[] {
  return MCP_OPERATIONS.map((operation) => {
    const schema = operationSchema(operation.operationId);
    const inputSchema = schema?.body ?? schema?.query ?? null;
    return {
      kind: 'action',
      kindLabel: WORKFLOW_NODE_KIND_LABELS.action,
      key: operation.operationId,
      name: operation.label,
      description: `${operation.domainLabel} · ${operation.method.toUpperCase()} ${operation.path}`,
      operationId: operation.operationId,
      group: operation.domainLabel,
      write: operation.write,
      permission: operation.label,
      forbiddenReason: forbiddenReasonOf(operation.operationId),
      inputSchema,
      pathParams: operation.pathParams,
    };
  });
}

/** 工具型节点：manifest 六类里可编排的部分（业务动作另按契约动作节点暴露）。 */
export function toolNodeSpecs(input: {
  connectorTools?: ConnectorToolSpec[];
  hardwareTools?: HardwareMcpTool[];
  skills?: {
    name: string;
    description?: string;
    enabled?: boolean;
    reviewStatus?: string;
  }[];
  plugins?: {
    name: string;
    description?: string;
    enabled?: boolean;
    reviewStatus?: string;
  }[];
}): WorkflowNodeSpec[] {
  const manifest = buildAgentToolManifest({
    connectorTools: input.connectorTools ?? [],
    hardwareTools: input.hardwareTools ?? [],
    skills: input.skills ?? [],
    plugins: input.plugins ?? [],
  });
  // builtin / business 已在别处暴露（内置工具不单独编排；业务动作用契约动作节点，走同一张路由表）。
  return manifest
    .filter((entry) => entry.kind === 'connector' || entry.kind === 'hardware')
    .map((entry) => ({
      kind: 'integration',
      kindLabel: WORKFLOW_NODE_KIND_LABELS.integration,
      key: entry.name,
      name: entry.name,
      description: entry.description,
      operationId: '',
      group:
        entry.source || (entry.kind === 'hardware' ? '硬件工具' : '连接器'),
      write: entry.write,
      permission: entry.permission || '按工具自身配置执行',
      forbiddenReason: '',
      inputSchema: null,
      pathParams: [],
    }));
}

/** 完整节点目录：内置 + 契约动作 + 工具型；同名节点以先出现的为准。 */
export function buildWorkflowCatalog(input: {
  connectorTools?: ConnectorToolSpec[];
  hardwareTools?: HardwareMcpTool[];
  skills?: {
    name: string;
    description?: string;
    enabled?: boolean;
    reviewStatus?: string;
  }[];
  plugins?: {
    name: string;
    description?: string;
    enabled?: boolean;
    reviewStatus?: string;
  }[];
}): WorkflowNodeSpec[] {
  const seen = new Set<string>();
  const out: WorkflowNodeSpec[] = [];
  for (const spec of [
    ...BUILTIN_NODES.map(builtinSpec),
    ...actionNodeSpecs(),
    ...toolNodeSpecs(input),
  ]) {
    if (seen.has(spec.key)) continue;
    seen.add(spec.key);
    out.push(spec);
  }
  return out;
}

/** 节点 key → 规范：运行期用它解释节点类型，避免前端传什么就执行什么。 */
export function builtinNodeOf(key: string): BuiltinSeed | undefined {
  return BUILTIN_NODES.find((seed) => seed.key === key);
}

/** 动作节点是否命中永久红线（Key 铸造、平台管理等），命中即不执行。 */
export function actionForbiddenReason(operationId: string): string {
  return MCP_FORBIDDEN_ACTIONS[operationId] ?? forbiddenReasonOf(operationId);
}
