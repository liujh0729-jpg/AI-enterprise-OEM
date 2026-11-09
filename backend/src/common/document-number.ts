import { Prisma } from '../../generated/prisma';
import { isPostgres } from './db-provider';

const sources: Record<string, { table: string; column: string }> = {
  ZJ: {
    table: 'asset_requests',
    column: 'request_no',
  },
  HT: {
    table: 'contracts',
    column: 'contract_no',
  },
  JJ: {
    table: 'flex_onboardings',
    column: 'onboarding_no',
  },
  YG: {
    table: 'flex_work_orders',
    column: 'order_no',
  },
  FP: {
    table: 'flex_payrolls',
    column: 'payroll_no',
  },
  KP: {
    table: 'invoice_requests',
    column: 'req_no',
  },
  ZX: {
    table: 'ip_requests',
    column: 'request_no',
  },
  ZC: {
    table: 'ip_requests',
    column: 'request_no',
  },
  FL: {
    table: 'legal_requests',
    column: 'request_no',
  },
  WL: {
    table: 'logistics_orders',
    column: 'order_no',
  },
  YX: {
    table: 'marketing_orders',
    column: 'order_no',
  },
  HW: {
    table: 'overseas_claims',
    column: 'claim_no',
  },
  FW: {
    table: 'provider_service_listings',
    column: 'service_no',
  },
  ZH: {
    table: 'smart_service_orders',
    column: 'order_no',
  },
  DH: {
    table: 'supply_orders',
    column: 'order_no',
  },
  YY: {
    table: 'supply_bookings',
    column: 'booking_no',
  },
  SB: {
    table: 'tax_declarations',
    column: 'decl_no',
  },
  CL: {
    table: 'tax_material_packs',
    column: 'pack_no',
  },
  OA: {
    table: 'oa_applications',
    column: 'number',
  },
  ZK: {
    table: 'think_tank_requests',
    column: 'request_no',
  },
  // 积分充值订单（充值入）：号段 RPYYYYMMDD-0001，前缀与计费单据体系同一套原子取号。
  RP: {
    table: 'recharge_orders',
    column: 'order_no',
  },
};
/** UTC day format is retained from the existing numbering rule. Gaps are permitted; duplicates are not. */
export async function allocateNo(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  prefix: string,
  now = new Date(),
  /** 模板自定义前缀（OA 的 QJ/BX…）不在登记表里时，由调用方指明编号列。 */
  custom?: { table: string; column: string },
) {
  /** 调用方指明编号列时**优先于登记表**（如 OA 模板自定义前缀恰落在 ZJ/HT 等已登记前缀时，
   *  必须回补自身表而非其它表，否则跨表共享计数器会撞唯一索引）。 */
  const source = custom ?? sources[prefix];
  if (!source) throw new Error('未登记的单据编号前缀');
  const head = `${prefix}${now.toISOString().slice(0, 10).replaceAll('-', '')}-`;
  // Identifier fragments come exclusively from the source map above, never request parameters.
  // 标识符引用符按方言：MySQL 反引号 / PostgreSQL 双引号（key 在 PG 建议加引号）。
  const quote = (name: string) =>
    Prisma.raw(isPostgres() ? `"${name}"` : `\`${name}\``);
  const column = quote(source.column);
  const table = quote(source.table);
  const keyColumn = quote('key');
  // 同一连接（事务）内原子取号，避免并发取到重复号；Gaps are permitted。
  const run = async (tx: Pick<Prisma.TransactionClient, '$queryRaw'>) => {
    let value: number;
    if (isPostgres()) {
      // PostgreSQL 单语句原子完成：首次插入「存量最大序号+1」（无存量则 1），已存在则 DO UPDATE 自增，
      // RETURNING 读回。不使计数器出现瞬时 0，兼容历史 PG 库的 CHECK (value > 0) 遗留约束。
      const rows = await tx.$queryRaw<{ value: number | bigint }[]>(
        Prisma.sql`
          INSERT INTO document_counters (${keyColumn}, value)
          SELECT ${head}, COALESCE(MAX(CASE
            WHEN substring(${column} from char_length(${head}) + 1) ~ '^[0-9]+$'
            THEN CAST(substring(${column} from char_length(${head}) + 1) AS BIGINT)
            ELSE 0 END), 0) + 1
          FROM ${table} WHERE ${column} LIKE ${head + '%'}
          ON CONFLICT (${keyColumn}) DO UPDATE SET value = document_counters.value + 1
          RETURNING value`,
      );
      value = Number(rows[0]?.value);
    } else {
      // MySQL 无 RETURNING：用 LAST_INSERT_ID(value+1) 自增并借会话变量读回。
      await tx.$queryRaw(Prisma.sql`
        INSERT IGNORE INTO document_counters (${keyColumn}, value)
        SELECT ${head}, COALESCE(MAX(CASE
          WHEN SUBSTRING(${column}, CHAR_LENGTH(${head}) + 1) REGEXP '^[0-9]+$'
          THEN CAST(SUBSTRING(${column}, CHAR_LENGTH(${head}) + 1) AS UNSIGNED)
          ELSE 0 END), 0)
        FROM ${table} WHERE ${column} LIKE ${head + '%'}`);
      await tx.$queryRaw(Prisma.sql`
        UPDATE document_counters SET value = LAST_INSERT_ID(value + 1)
        WHERE ${keyColumn} = ${head}`);
      const rows = await tx.$queryRaw<{ value: number | bigint }[]>(
        Prisma.sql`SELECT LAST_INSERT_ID() AS value`,
      );
      value = Number(rows[0]?.value);
    }
    if (!Number.isFinite(value) || value <= 0)
      throw new Error('单据编号分配失败');
    return `${head}${String(value).padStart(4, '0')}`;
  };
  // 根客户端走独立事务锁定单连接；已是事务客户端则直接复用。
  const transactable = db as Pick<Prisma.TransactionClient, '$queryRaw'> & {
    $transaction?: (fn: typeof run) => Promise<string>;
  };
  return transactable.$transaction ? transactable.$transaction(run) : run(db);
}
