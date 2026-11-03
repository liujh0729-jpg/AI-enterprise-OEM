import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CrmContext } from '../crm/crm.scope';

export type InternalDatasetKey =
  'LEADS' | 'CUSTOMERS' | 'OPPORTUNITIES' | 'CONTRACTS' | 'PAYMENTS' | 'ORDERS';

export type InternalField = {
  key: string;
  name: string;
  type: string;
  role: 'DIMENSION' | 'MEASURE';
  aggregate?: string;
  expression?: string;
  comment: string;
};

export type InternalDataset = {
  key: InternalDatasetKey;
  name: string;
  description: string;
  sql: string;
  ownerColumn: string;
  fields: InternalField[];
};

const field = (
  key: string,
  name: string,
  type: string,
  role: 'DIMENSION' | 'MEASURE',
  comment: string,
  aggregate = '',
): InternalField => ({ key, name, type, role, aggregate, comment });

export const INTERNAL_DATASETS: Record<InternalDatasetKey, InternalDataset> = {
  LEADS: {
    key: 'LEADS',
    name: 'CRM 线索',
    description: '线索名称、联系人、来源、阶段、负责人与创建时间',
    ownerColumn: 'owner_id',
    sql: `SELECT id, name, contact_name, phone, email, source, stage,
                 owner_id, last_follow_at, created_at
            FROM crm_leads
           WHERE owner_user_id = $1 AND deleted_at IS NULL`,
    fields: [
      field('id', '线索ID', 'number', 'DIMENSION', '线索唯一编号'),
      field('name', '线索名称', 'text', 'DIMENSION', '公司或线索名称'),
      field('contact_name', '联系人', 'text', 'DIMENSION', '联系人姓名'),
      field('phone', '电话', 'text', 'DIMENSION', '联系电话'),
      field('email', '邮箱', 'text', 'DIMENSION', '联系邮箱'),
      field('source', '来源', 'text', 'DIMENSION', '线索来源'),
      field('stage', '阶段', 'text', 'DIMENSION', '线索阶段'),
      field('owner_id', '负责人', 'text', 'DIMENSION', '负责人账号'),
      field('last_follow_at', '最近跟进', 'date', 'DIMENSION', '最近跟进时间'),
      field('created_at', '创建时间', 'date', 'DIMENSION', '线索创建时间'),
      {
        key: 'lead_count',
        name: '线索数',
        type: 'number',
        role: 'MEASURE' as const,
        aggregate: 'COUNT',
        expression: 'COUNT(*)',
        comment: '线索数',
      },
    ],
  },
  CUSTOMERS: {
    key: 'CUSTOMERS',
    name: 'CRM 客户',
    description: '客户名称、行业、地区、负责人与创建时间',
    ownerColumn: 'owner_id',
    sql: `SELECT id, name, industry, province, city, owner_id, last_follow_at, created_at
            FROM crm_customers
           WHERE owner_user_id = $1 AND deleted_at IS NULL`,
    fields: [
      field('id', '客户ID', 'number', 'DIMENSION', '客户唯一编号'),
      field('name', '客户名称', 'text', 'DIMENSION', '客户名称'),
      field('industry', '行业', 'text', 'DIMENSION', '所属行业'),
      field('province', '省', 'text', 'DIMENSION', '所在省'),
      field('city', '市', 'text', 'DIMENSION', '所在市'),
      field('owner_id', '负责人', 'text', 'DIMENSION', '负责人账号'),
      field('created_at', '创建时间', 'date', 'DIMENSION', '客户创建时间'),
      {
        key: 'customer_count',
        name: '客户数',
        type: 'number',
        role: 'MEASURE' as const,
        aggregate: 'COUNT',
        expression: 'COUNT(*)',
        comment: '客户数',
      },
    ],
  },
  OPPORTUNITIES: {
    key: 'OPPORTUNITIES',
    name: 'CRM 商机',
    description: '商机名称、客户、阶段、金额、赢率与预计成交',
    ownerColumn: 'o.owner_id',
    sql: `SELECT o.id, o.name, c.name AS customer_name, o.amount, o.possible,
                 s.name AS stage_name, s.type AS stage_type, o.owner_id,
                 o.expected_end_at, o.actual_end_at, o.failure_reason, o.created_at
            FROM crm_opportunities o
            LEFT JOIN crm_customers c ON c.id = o.customer_id
            LEFT JOIN crm_opportunity_stages s ON s.id = o.stage_id
           WHERE o.owner_user_id = $1 AND o.deleted_at IS NULL`,
    fields: [
      field('id', '商机ID', 'number', 'DIMENSION', '商机唯一编号'),
      field('name', '商机名称', 'text', 'DIMENSION', '商机名称'),
      field('customer_name', '客户', 'text', 'DIMENSION', '关联客户'),
      field('stage_name', '阶段', 'text', 'DIMENSION', '当前商机阶段'),
      field('stage_type', '阶段类型', 'text', 'DIMENSION', '进行中 / 结束'),
      field('owner_id', '负责人', 'text', 'DIMENSION', '负责人账号'),
      field(
        'failure_reason',
        '输单原因',
        'text',
        'DIMENSION',
        '结束商机的输单原因',
      ),
      field('expected_end_at', '预计成交', 'date', 'DIMENSION', '预计成交日期'),
      field('created_at', '创建时间', 'date', 'DIMENSION', '商机创建时间'),
      field('amount', '商机金额', 'number', 'MEASURE', '商机金额合计', 'SUM'),
      field(
        'possible',
        '可能金额',
        'number',
        'MEASURE',
        '按赢率折算的可能金额',
        'SUM',
      ),
      {
        key: 'opportunity_count',
        name: '商机数',
        type: 'number',
        role: 'MEASURE' as const,
        aggregate: 'COUNT',
        expression: 'COUNT(*)',
        comment: '商机数',
      },
    ],
  },
  CONTRACTS: {
    key: 'CONTRACTS',
    name: 'CRM 销售合同',
    description: '合同编号、客户、金额、审批状态与阶段',
    ownerColumn: 'ct.owner_id',
    sql: `SELECT ct.id, ct.number, ct.name, c.name AS customer_name, ct.amount,
                 ct.approval_status, ct.owner_id, ct.start_at, ct.end_at, ct.created_at
            FROM crm_contracts ct
            LEFT JOIN crm_customers c ON c.id = ct.customer_id
           WHERE ct.owner_user_id = $1 AND ct.deleted_at IS NULL`,
    fields: [
      field('id', '合同ID', 'number', 'DIMENSION', '合同唯一编号'),
      field('number', '合同编号', 'text', 'DIMENSION', '销售合同编号'),
      field('name', '合同名称', 'text', 'DIMENSION', '合同名称'),
      field('customer_name', '客户', 'text', 'DIMENSION', '关联客户'),
      field('approval_status', '审批状态', 'text', 'DIMENSION', '合同审批状态'),
      field('owner_id', '负责人', 'text', 'DIMENSION', '负责人账号'),
      field('start_at', '开始日期', 'date', 'DIMENSION', '合同开始日期'),
      field('end_at', '结束日期', 'date', 'DIMENSION', '合同结束日期'),
      field('created_at', '创建时间', 'date', 'DIMENSION', '合同创建时间'),
      field('amount', '合同金额', 'number', 'MEASURE', '合同金额合计', 'SUM'),
      {
        key: 'contract_count',
        name: '合同数',
        type: 'number',
        role: 'MEASURE' as const,
        aggregate: 'COUNT',
        expression: 'COUNT(*)',
        comment: '合同数',
      },
    ],
  },
  PAYMENTS: {
    key: 'PAYMENTS',
    name: 'CRM 回款',
    description: '回款计划金额、已回款、计划日期与逾期',
    ownerColumn: 'ct.owner_id',
    sql: `SELECT p.id, ct.number AS contract_number, c.name AS customer_name,
                 p.name, p.plan_amount,
                 COALESCE((SELECT SUM(r.record_amount) FROM crm_payment_records r WHERE r.payment_plan_id = p.id), 0) AS paid_amount,
                 p.plan_end_at, p.status, ct.owner_id, p.created_at
            FROM crm_payment_plans p
            LEFT JOIN crm_contracts ct ON ct.id = p.contract_id
            LEFT JOIN crm_customers c ON c.id = ct.customer_id
           WHERE p.owner_user_id = $1`,
    fields: [
      field('id', '计划ID', 'number', 'DIMENSION', '回款计划编号'),
      field('contract_number', '合同编号', 'text', 'DIMENSION', '关联合同编号'),
      field('customer_name', '客户', 'text', 'DIMENSION', '关联客户'),
      field('name', '计划名称', 'text', 'DIMENSION', '回款计划名称'),
      field('status', '状态', 'text', 'DIMENSION', '回款计划状态'),
      field('owner_id', '负责人', 'text', 'DIMENSION', '合同负责人账号'),
      field('plan_end_at', '计划日期', 'date', 'DIMENSION', '计划回款日期'),
      field('created_at', '创建时间', 'date', 'DIMENSION', '计划创建时间'),
      field(
        'plan_amount',
        '计划金额',
        'number',
        'MEASURE',
        '计划回款金额合计',
        'SUM',
      ),
      field(
        'paid_amount',
        '已回款',
        'number',
        'MEASURE',
        '已回款金额合计',
        'SUM',
      ),
      {
        key: 'plan_count',
        name: '计划数',
        type: 'number',
        role: 'MEASURE' as const,
        aggregate: 'COUNT',
        expression: 'COUNT(*)',
        comment: '计划数',
      },
    ],
  },
  ORDERS: {
    key: 'ORDERS',
    name: 'CRM 订单',
    description: '订单编号、客户、金额、审批状态与阶段',
    ownerColumn: 'od.owner_id',
    sql: `SELECT od.id, od.number, od.name, c.name AS customer_name, od.amount,
                 od.approval_status, od.owner_id, od.created_at
            FROM crm_orders od
            LEFT JOIN crm_customers c ON c.id = od.customer_id
           WHERE od.owner_user_id = $1 AND od.deleted_at IS NULL`,
    fields: [
      field('id', '订单ID', 'number', 'DIMENSION', '订单唯一编号'),
      field('number', '订单编号', 'text', 'DIMENSION', '订单编号'),
      field('name', '订单名称', 'text', 'DIMENSION', '订单名称'),
      field('customer_name', '客户', 'text', 'DIMENSION', '关联客户'),
      field('approval_status', '审批状态', 'text', 'DIMENSION', '订单审批状态'),
      field('owner_id', '负责人', 'text', 'DIMENSION', '负责人账号'),
      field('created_at', '创建时间', 'date', 'DIMENSION', '订单创建时间'),
      field('amount', '订单金额', 'number', 'MEASURE', '订单金额合计', 'SUM'),
      {
        key: 'order_count',
        name: '订单数',
        type: 'number',
        role: 'MEASURE' as const,
        aggregate: 'COUNT',
        expression: 'COUNT(*)',
        comment: '订单数',
      },
    ],
  },
};

export function internalDataset(key: string): InternalDataset {
  const dataset = INTERNAL_DATASETS[key as InternalDatasetKey];
  if (!dataset) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '内置数据集不存在');
  }
  return dataset;
}

/**
 * 把 CRM 数据范围拼到内置数据集 SQL 上。
 * 参数顺序固定为 位置1=owner、位置2=负责人（DEPT 范围）。
 * - PostgreSQL：用 `$1`/`$2` 位置占位符，DEPT 用 `= ANY($2::text[])`；
 * - MySQL：`$queryRawUnsafe` 只认 `?` 且不绑定数组，故把 `$1`/`$2` 转为 `?`，
 *   `ANY(text[])`（此处恒为单元素列表）退化为等值 `= ?`。
 * @param pg 目标库是否为 PostgreSQL（默认 true 保持既有 PG 语义）。
 */
export function internalScope(
  dataset: InternalDataset,
  ctx: CrmContext,
  pg = true,
) {
  if (!pg) {
    const params: unknown[] = [ctx.ownerUserId];
    const sql = dataset.sql.replace(/\$1\b/g, '?');
    if (ctx.isAdmin || ctx.role === 'MANAGER' || ctx.dataScope === 'ALL') {
      return { sql, params };
    }
    // DEPT 与其它范围在本实现里都只作用于单个 actorId，等值即可。
    params.push(ctx.actorId);
    return { sql: `${sql} AND ${dataset.ownerColumn} = ?`, params };
  }
  const params: unknown[] = [ctx.ownerUserId];
  if (ctx.isAdmin || ctx.role === 'MANAGER' || ctx.dataScope === 'ALL') {
    return { sql: dataset.sql, params };
  }
  if (ctx.dataScope === 'DEPT') {
    params.push([ctx.actorId]);
    return {
      sql: `${dataset.sql} AND ${dataset.ownerColumn} = ANY($2::text[])`,
      params,
    };
  }
  params.push(ctx.actorId);
  return {
    sql: `${dataset.sql} AND ${dataset.ownerColumn} = $2`,
    params,
  };
}
