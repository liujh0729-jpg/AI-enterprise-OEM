import { agentActionLabel, MCP_FORBIDDEN_ACTIONS } from '@enterprise/contracts';
import type { ConnectorToolSpec } from './agent-connectors.service';
import type { HardwareMcpTool } from '../hardware/hardware.service';
import { AGENT_TOOLS } from './agent-tools';
import { BUSINESS_TOOLS } from './agent-business-tools';

/**
 * 统一工具 manifest（AI 底座 §4.3）：内置 / 业务 / 连接器 / 技能 / 插件
 * 五类能力归一成一张注册表，权限人话与红线全部从契约侧词表派生。
 * 这是「这个 Agent 到底会用哪些工具」的唯一口径：前端工具面板、文档页、
 * 副驾入口都读这一份，不再各自维护清单。
 */

export const AGENT_TOOL_KINDS = [
  'builtin',
  'business',
  'connector',
  'hardware',
  'skill',
  'plugin',
] as const;
export type AgentToolKind = (typeof AGENT_TOOL_KINDS)[number];

export const AGENT_TOOL_KIND_LABELS: Record<AgentToolKind, string> = {
  builtin: '内置工具',
  business: '业务动作',
  connector: '连接器',
  hardware: '硬件工具',
  skill: '技能',
  plugin: '插件',
};

export type AgentToolManifestEntry = {
  name: string;
  kind: AgentToolKind;
  description: string;
  write: boolean;
  /** 对应契约 operationId（内置工具无）；权限人话与红线都从它派生 */
  operationId?: string;
  /** 动作人话（如「新建线索」），与「智能体记忆」操作流同一份词表 */
  permission?: string;
  /** 权限红线：命中即不自动执行，理由逐条可见 */
  forbiddenReason?: string;
  /** 计量口径（读操作免费 / 写操作落库 / 出图耗积分） */
  billing?: string;
  /** 来源：连接器名 / 技能插件名等归属信息 */
  source?: string;
};

/** 内置工具里会改数据的动作：出图出片入库、记忆与资料库写入、跑插件命令。 */
const BUILTIN_WRITE_TOOLS = new Set([
  'generate_image',
  'generate_video',
  'save_memory',
  'save_to_kb',
  'propose_library_edit',
  'publish_to_library',
  'run_plugin_command',
]);

const BUILTIN_BILLING: Record<string, string> = {
  generate_image: '按图像生成计积分',
  generate_video: '按视频生成计积分',
};

export function builtinToolManifest(): AgentToolManifestEntry[] {
  return AGENT_TOOLS.map((tool) => {
    const name = String(tool.function.name);
    return {
      name,
      kind: 'builtin' as const,
      description: String(tool.function.description || ''),
      write: BUILTIN_WRITE_TOOLS.has(name),
      billing:
        BUILTIN_BILLING[name] ||
        (BUILTIN_WRITE_TOOLS.has(name)
          ? '写操作：按对应模块规则落库'
          : '读操作，不消耗积分'),
    };
  });
}

export function businessToolManifest(): AgentToolManifestEntry[] {
  return BUSINESS_TOOLS.map((tool) => ({
    name: String(tool.spec.function.name),
    kind: 'business' as const,
    description:
      typeof tool.spec.function.description === 'string'
        ? tool.spec.function.description
        : '',
    write: tool.write,
    operationId: tool.operationId,
    permission: agentActionLabel(tool.operationId),
    forbiddenReason: MCP_FORBIDDEN_ACTIONS[tool.operationId] || undefined,
    billing: tool.billing,
  }));
}

/** 硬件工具（hw__）：写动作的授权闸在硬件服务内部，manifest 只标注权限人话。 */
export function hardwareToolManifest(
  tools: HardwareMcpTool[],
): AgentToolManifestEntry[] {
  return tools.map((tool) => {
    const write = tool.annotations?.readOnlyHint === false;
    return {
      name: tool.name,
      kind: 'hardware' as const,
      description: tool.description,
      write,
      permission: write
        ? '硬件写工具：需本人在「智能硬件 → MCP」勾选授权；未授权/无人值守只出草案'
        : '硬件读工具：以登录人身份调用其绑定设备',
      billing: '按设备指令执行，不消耗积分',
      source: '智能硬件',
    };
  });
}

/** manifest 的技能/插件行只需要这几个字段，服务返回多出来的原样丢弃。 */
export type ManifestResource = {
  name: string;
  description?: string;
  enabled?: boolean;
  reviewStatus?: string;
};

/** 先审后用：只有过审并启用的技能/插件才进 manifest（与系统提示同一口径）。 */
function usable(rows: ManifestResource[]) {
  return rows.filter(
    (row) => row.enabled !== false && row.reviewStatus === 'passed',
  );
}

export function buildAgentToolManifest(input: {
  connectorTools: ConnectorToolSpec[];
  skills: ManifestResource[];
  plugins: ManifestResource[];
  hardwareTools?: HardwareMcpTool[];
}): AgentToolManifestEntry[] {
  const rows: AgentToolManifestEntry[] = [
    ...builtinToolManifest(),
    ...businessToolManifest(),
  ];
  for (const spec of input.connectorTools) {
    rows.push({
      name: spec.name,
      kind: 'connector',
      description: spec.description,
      // 远程工具的能力只有远端自己知道，按写权限对待，提示用户留意
      write: true,
      permission: '连接器工具：随启用范围执行，操作按连接器配置计',
      billing: '按连接器自身配置计费',
      source: spec.connectorName,
    });
  }
  rows.push(...hardwareToolManifest(input.hardwareTools || []));
  for (const skill of usable(input.skills)) {
    rows.push({
      name: skill.name,
      kind: 'skill',
      description: skill.description || '（技能未填写说明）',
      write: false,
      permission: '先审后用：过审并启用后，模型可用 load_skill 读取',
      billing: '读操作，不消耗积分',
    });
  }
  for (const plugin of usable(input.plugins)) {
    rows.push({
      name: plugin.name,
      kind: 'plugin',
      description: plugin.description || '（插件未填写说明）',
      write: true,
      permission: '先审后用：过审并启用后，模型可读取并运行其命令',
      billing: '按命令内容执行',
    });
  }
  return rows;
}
