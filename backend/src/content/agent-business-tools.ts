import { CurrentUser } from '../auth/current-user';
import { MCP_FORBIDDEN_ACTIONS } from '@enterprise/contracts';
import { currentAgentScope } from './agent-scope';
import type { AgentActor, AgentToolResult } from './agent-tools';

/**
 * 首批业务动作工具（AI 底座 §4.3）：把「建线索 / 表格写行 / 查库存 / 发审批」
 * 从界面动作变成 Agent 可调用的工具。所有调用都以登录人身份进真正的模块服务，
 * 组织隔离、必填校验、审计都由服务自身保证——这里不另写一套权限。
 */

/** 只声明用到的最小方法面：真实服务满足结构即可注入，单测也只 mock 这几个方法。 */
export type AgentBusinessContext = {
  crmLeads: {
    create(
      user: CurrentUser,
      body: Record<string, unknown>,
    ): Promise<Record<string, unknown>>;
  };
  dataTable: {
    list(user: CurrentUser): Promise<
      {
        id: number;
        name: string;
        fields: { fieldKey: string; name: string }[];
      }[]
    >;
    createRow(
      user: CurrentUser,
      tableId: number,
      data: unknown,
    ): Promise<Record<string, unknown>>;
  };
  erp: {
    listStock(
      user: CurrentUser,
      query: {
        page: number;
        pageSize: number;
        warehouseId?: number;
        q?: string;
        lowOnly?: boolean;
      },
    ): Promise<unknown>;
  };
  oa: {
    saveDraft(
      user: CurrentUser,
      body: Record<string, unknown>,
    ): Promise<{ id: number; number?: string; title?: string }>;
    submit(user: CurrentUser, id: string): Promise<Record<string, unknown>>;
  };
  recruit: {
    updateApplicationStatus(
      user: CurrentUser,
      body: Record<string, unknown>,
    ): Promise<Record<string, unknown>>;
  };
};

export type BusinessTool = {
  /** OpenAI function 规格：对话循环把它与内置工具一起发给模型。 */
  spec: { type: 'function'; function: Record<string, unknown> };
  /** 对应的契约 operationId：权限人话与红线都从契约侧词表派生，不写第二份。 */
  operationId: string;
  write: boolean;
  /** 红线动作（MCP_FORBIDDEN_ACTIONS）不进模型工具面：注册了只会换来一次必然被拒的调用。 */
  callable: boolean;
  billing: string;
};

export const BUSINESS_TOOLS: BusinessTool[] = [
  {
    spec: {
      type: 'function',
      function: {
        name: 'crm_create_lead',
        description:
          '在 CRM 里创建一条线索（以当前登录人的身份落库，走 CRM 自己的权限与查重）。用户说「记一条线索 / 新来了个客户线索 / 帮我登记」时调用。返回新建线索的编号与阶段。',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: '线索名称（必填，如公司名或客户称呼）',
            },
            contact_name: { type: 'string', description: '联系人姓名' },
            phone: { type: 'string', description: '联系电话' },
            email: { type: 'string', description: '联系邮箱' },
            source: {
              type: 'string',
              description: '来源渠道，如 展会/官网/转介绍',
            },
            stage: {
              type: 'string',
              description: '线索阶段；不确定就留空（默认新建）',
            },
            remark: { type: 'string', description: '备注' },
          },
          required: ['name'],
        },
      },
    },
    operationId: 'Crm_createLead',
    write: true,
    callable: true,
    billing: '写操作：按 CRM 规则落库，不消耗积分',
  },
  {
    spec: {
      type: 'function',
      function: {
        name: 'data_table_add_row',
        description:
          '往多维表格里写入一行数据（以当前登录人的身份，列键必须是该表已有的列）。用户说「往 XX 表加一条 / 记到表格里」时调用。表用 table_id 或 table_name 指定，values 的键用列键（fieldKey），不知道列键就先问用户。',
        parameters: {
          type: 'object',
          properties: {
            table_id: {
              type: 'integer',
              description: '表格编号（与 table_name 二选一）',
            },
            table_name: {
              type: 'string',
              description:
                '表格名称（与 table_id 二选一；重名时工具会提示用编号）',
            },
            values: {
              type: 'object',
              description:
                '一行数据：列键 → 值，如 {"title":"发布会","date":"2026-11-08"}',
            },
          },
          required: ['values'],
        },
      },
    },
    operationId: 'DataTable_addRow',
    write: true,
    callable: true,
    billing: '写操作：按表格权限落库，不消耗积分',
  },
  {
    spec: {
      type: 'function',
      function: {
        name: 'erp_check_stock',
        description:
          '查 ERP 库存：按关键词（SKU/变体名）查在途、锁定与可用库存，也可只看低于补货点的低库存。用户问「XX 还有货吗 / 库存多少 / 什么缺货」时调用，读操作不改动任何数据。',
        parameters: {
          type: 'object',
          properties: {
            q: { type: 'string', description: 'SKU 或变体名关键词' },
            warehouse_id: {
              type: 'integer',
              description: '限定仓库编号（可选）',
            },
            low_only: {
              type: 'boolean',
              description: '只看低于补货点的库存（可选）',
            },
          },
        },
      },
    },
    operationId: 'Erp_listStock',
    write: false,
    callable: true,
    billing: '读操作，不消耗积分',
  },
  {
    spec: {
      type: 'function',
      function: {
        name: 'oa_start_flow',
        description:
          '以当前登录人身份发起一条 OA 审批流程：按模板创建单据并直接提交进入审批。用户说「帮我提个报销 / 请个假 / 发起 XX 审批」时调用；表单字段名以模板为准，不确定先问用户。',
        parameters: {
          type: 'object',
          properties: {
            template_id: {
              type: 'integer',
              description: '审批模板编号（必填）',
            },
            title: {
              type: 'string',
              description: '单据标题（可选，默认用模板名）',
            },
            form_data: {
              type: 'object',
              description:
                '表单内容：字段名 → 值，如 {"amount":1200,"reason":"差旅"}',
            },
          },
          required: ['template_id'],
        },
      },
    },
    operationId: 'Oa_submit',
    write: true,
    callable: true,
    billing: '写操作：真实提交审批，不消耗积分',
  },
  {
    spec: {
      type: 'function',
      function: {
        name: 'recruit_update_application',
        description:
          '变更招聘投递状态。该动作在权限红线上：投递状态变更需要本人确认，Agent 不会代为执行，请引导用户到「招聘求职」页自行操作。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: '投递编号' },
            status: { type: 'string', description: '目标状态' },
            note: { type: 'string', description: '备注' },
          },
          required: ['id', 'status'],
        },
      },
    },
    operationId: 'Recruit_updateApplicationStatus',
    write: true,
    callable: false,
    billing: '红线动作：不自动执行',
  },
];

const BY_NAME = new Map(
  BUSINESS_TOOLS.map((tool) => [tool.spec.function.name, tool]),
);

export function businessToolOf(name: string): BusinessTool | undefined {
  return BY_NAME.get(name);
}

/** 模型可调用的业务工具（红线动作除外）。 */
export function businessToolSpecs() {
  return BUSINESS_TOOLS.filter((tool) => tool.callable).map(
    (tool) => tool.spec,
  );
}

function textOf(args: Record<string, unknown>, key: string) {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}

function intOf(args: Record<string, unknown>, key: string) {
  const value = Number(args[key]);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

/** 回给模型的执行结果统一截断：库存页、行数据都可能很长，别把上下文挤爆。 */
function brief(value: unknown, max = 1200) {
  const raw = JSON.stringify(value, null, 0) ?? '';
  return raw.length > max ? `${raw.slice(0, max)}…（已截断）` : raw;
}

/** 表名 → 表编号：重名或不认识都不猜，把候选摆出来让用户定。 */
async function resolveTableId(
  context: AgentBusinessContext,
  user: CurrentUser,
  name: string,
): Promise<{ id: number; name: string } | { error: string }> {
  const tables = await context.dataTable.list(user);
  const hit = tables.filter((table) => table.name.trim() === name.trim());
  if (hit.length === 1) return { id: hit[0].id, name: hit[0].name };
  if (hit.length > 1) {
    return {
      error: `有 ${hit.length} 张同名表格（编号 ${hit.map((t) => `#${t.id}`).join('、')}），请用户提供表格编号 table_id`,
    };
  }
  const sample = tables.slice(0, 20).map((t) => `#${t.id} ${t.name}`);
  return {
    error: `没有找到名为「${name}」的表格。当前可见的表格：${sample.join('；') || '（还没有表格）'}`,
  };
}

/** 执行一次业务工具；名字不属于业务工具时返回 null，交回内置工具分流。 */
export async function runBusinessTool(
  name: string,
  args: Record<string, unknown>,
  context: AgentBusinessContext,
  actor: AgentActor,
): Promise<AgentToolResult | null> {
  const tool = businessToolOf(name);
  if (!tool) return null;
  // 权限红线复用契约侧清单：这些动作只能由本人在界面上发起，Agent 一律不代执行。
  const forbidden = MCP_FORBIDDEN_ACTIONS[tool.operationId];
  if (forbidden || !tool.callable) {
    return {
      text: `这个动作在权限红线上，Agent 不能代为执行：${forbidden || '该动作需要本人确认'}。请让用户到对应模块页面自行操作。`,
    };
  }
  // 副驾/定时任务没放开写时不改业务数据；对话默认 allowWrite=true 不受影响。
  const scope = currentAgentScope();
  if (tool.write && scope && scope.allowWrite !== true) {
    return {
      text: '这一轮是只读模式，不能改业务数据；请让用户在页面上操作，或打开副驾的「允许执行动作」后再试。',
    };
  }
  const user = actor.user;
  if (name === 'crm_create_lead') {
    const leadName = textOf(args, 'name');
    if (!leadName) return { text: '缺少线索名称（name），无法创建线索' };
    const row = await context.crmLeads.create(user, {
      name: leadName,
      contactName: textOf(args, 'contact_name'),
      phone: textOf(args, 'phone'),
      email: textOf(args, 'email'),
      source: textOf(args, 'source'),
      stage: textOf(args, 'stage'),
      remark: textOf(args, 'remark'),
    });
    return {
      text: `线索已创建（以 ${user.username} 的身份）：${brief(row, 800)}`,
    };
  }
  if (name === 'data_table_add_row') {
    const values = args.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return { text: '缺少 values（列键 → 值的对象），无法写入表格' };
    }
    const tableId = intOf(args, 'table_id');
    let id = tableId;
    let tableName = `#${tableId}`;
    if (!id) {
      const tableNameArg = textOf(args, 'table_name');
      if (!tableNameArg) {
        return {
          text: '请提供 table_id 或 table_name 之一，指定要写入哪张表格',
        };
      }
      const resolved = await resolveTableId(context, user, tableNameArg);
      if ('error' in resolved) return { text: resolved.error };
      id = resolved.id;
      tableName = resolved.name;
    }
    const row = await context.dataTable.createRow(user, id, values);
    return {
      text: `已写入表格「${tableName}」一行：${brief(row, 800)}`,
    };
  }
  if (name === 'erp_check_stock') {
    const page = await context.erp.listStock(user, {
      page: 1,
      pageSize: 20,
      warehouseId: intOf(args, 'warehouse_id') || undefined,
      q: textOf(args, 'q') || undefined,
      lowOnly: args.low_only === true,
    });
    return { text: `库存查询结果：${brief(page)}` };
  }
  if (name === 'oa_start_flow') {
    const templateId = intOf(args, 'template_id');
    if (!templateId)
      return { text: '缺少审批模板编号（template_id），无法发起流程' };
    const formData =
      args.form_data &&
      typeof args.form_data === 'object' &&
      !Array.isArray(args.form_data)
        ? (args.form_data as Record<string, unknown>)
        : {};
    const draft = await context.oa.saveDraft(user, {
      templateId,
      title: textOf(args, 'title'),
      formData,
    });
    const submitted = await context.oa.submit(user, String(draft.id));
    return {
      text: `审批已提交（以 ${user.username} 的身份）：${brief(submitted, 800)}`,
    };
  }
  return { text: `业务工具 ${name} 还没有实现执行逻辑` };
}
