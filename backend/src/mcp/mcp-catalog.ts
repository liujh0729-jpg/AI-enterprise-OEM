import {
  MCP_EXCLUDED_DOMAINS,
  MCP_EXCLUDED_OPERATIONS,
  MCP_FORBIDDEN_ACTIONS,
  agentActionLabel,
  agentDomainLabel,
  endpoints,
  mcpDomainOfPath,
  z,
} from '@enterprise/contracts';

/**
 * MCP 的接口清单：一律从契约注册表 `endpoints` 派生，不写第二份清单。
 * 新增业务接口只要进了契约，外部客户端调 `list_operations` 就能看见，MCP 代码不用改。
 * 域排除与 Key 动作排除的清单在 `@enterprise/contracts`，开发者文档页读同一份。
 */

export type McpOperation = {
  operationId: string;
  /** 小写 HTTP 方法，逐字取自契约 */
  method: string;
  path: string;
  domain: string;
  domainLabel: string;
  /** 中文动作名，与「智能体记忆」操作流同一份词表 */
  label: string;
  write: boolean;
  /** 契约里声明了请求体（无体动作如「清空记忆」为 false，对外不发布 schema） */
  hasBody: boolean;
  pathParams: string[];
};

const EXCLUDED_DOMAINS = new Set<string>(MCP_EXCLUDED_DOMAINS);
const EXCLUDED_OPERATIONS = new Set<string>(MCP_EXCLUDED_OPERATIONS);

function pathParamsOf(path: string): string[] {
  return path
    .split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1));
}

function build(operationId: string): McpOperation | undefined {
  const definition = endpoints[operationId as keyof typeof endpoints];
  const method = String(definition.method).toLowerCase();
  const path = String(definition.path);
  const domain = mcpDomainOfPath(path);
  // endpoints 是几百条契约的联合，直接从联合上调 safeParse 推不出返回类型；按 z.ZodType 收口（同 toJsonSchema 的入参口径）。
  const body: z.ZodType = definition.body;
  if (
    !domain ||
    EXCLUDED_DOMAINS.has(domain) ||
    EXCLUDED_OPERATIONS.has(operationId)
  )
    return undefined;
  return {
    operationId,
    method,
    path,
    domain,
    domainLabel: agentDomainLabel(domain),
    label: agentActionLabel(operationId),
    write: method !== 'get',
    hasBody: !body.safeParse(undefined).success,
    pathParams: pathParamsOf(path),
  };
}

const ALL: McpOperation[] = Object.keys(endpoints)
  .map(build)
  .filter((row): row is McpOperation => row !== undefined);

export const MCP_OPERATIONS: readonly McpOperation[] = ALL;
export const MCP_READ_OPERATIONS = ALL.filter((row) => !row.write);
export const MCP_WRITE_OPERATIONS = ALL.filter((row) => row.write);

const BY_ID = new Map(ALL.map((row) => [row.operationId, row]));

export function findOperation(operationId: string) {
  return BY_ID.get(operationId);
}

/** 永久排除：勾选界面不给勾、授权闸直接拒，理由逐条对外可见。 */
export function forbiddenReasonOf(operationId: string): string {
  return MCP_FORBIDDEN_ACTIONS[operationId] ?? '';
}

export function isGrantable(operationId: string): boolean {
  const row = BY_ID.get(operationId);
  return Boolean(row?.write) && !forbiddenReasonOf(operationId);
}

export type McpOperationSchema = {
  pathParams: string[];
  query: Record<string, unknown> | null;
  body: Record<string, unknown> | null;
};

const schemaCache = new Map<string, McpOperationSchema>();

/** zod 4 的原生 JSON Schema 导出；个别老写法转不动时该侧留 null，不拖垮整张清单。 */
function toJsonSchema(schema: z.ZodType): Record<string, unknown> | null {
  try {
    const document = z.toJSONSchema(schema, {
      io: 'input',
      target: 'draft-07',
    }) as Record<string, unknown>;
    delete document.$schema;
    return document;
  } catch {
    return null;
  }
}

export function operationSchema(
  operationId: string,
): McpOperationSchema | undefined {
  const cached = schemaCache.get(operationId);
  if (cached) return cached;
  const operation = findOperation(operationId);
  if (!operation) return undefined;
  const definition = endpoints[operationId as keyof typeof endpoints];
  const schema: McpOperationSchema = {
    pathParams: operation.pathParams,
    query: toJsonSchema(definition.query),
    body: operation.hasBody ? toJsonSchema(definition.body) : null,
  };
  schemaCache.set(operationId, schema);
  return schema;
}

/** 契约校验请求体：草案与真实执行共用这一份判定，保证「没授权时看到的草案」＝「授权后会发的报文」。 */
export function validateBody(
  operationId: string,
  body: Record<string, unknown>,
): { ok: true } | { ok: false; message: string } {
  const definition = endpoints[operationId as keyof typeof endpoints];
  const schema: z.ZodType = definition.body;
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true };
  const first = parsed.error.issues[0];
  const path = first?.path.join('.') ?? '';
  return {
    ok: false,
    message: path
      ? `${path}: ${first?.message ?? '格式不正确'}`
      : '请求体格式不正确',
  };
}

/** 契约校验查询参数：与 `validateBody` 同一份判定，草案阶段就能告诉客户端哪里填错。 */
export function validateQuery(
  operationId: string,
  query: Record<string, unknown>,
): { ok: true } | { ok: false; message: string } {
  const definition = endpoints[operationId as keyof typeof endpoints];
  const schema: z.ZodType = definition.query;
  const parsed = schema.safeParse(query);
  if (parsed.success) return { ok: true };
  const first = parsed.error.issues[0];
  const path = first?.path.join('.') ?? '';
  return {
    ok: false,
    message: path
      ? `${path}: ${first?.message ?? '格式不正确'}`
      : '查询参数格式不正确',
  };
}

export function missingPathParams(
  operationId: string,
  pathParams: Record<string, string | number>,
): string[] {
  const operation = findOperation(operationId);
  if (!operation) return [];
  return operation.pathParams.filter(
    (name) => pathParams[name] === undefined || pathParams[name] === '',
  );
}

/** 把契约路径里的 `:id` 换成调用方给的值；每段做一次 URL 编码，避免路径注入。 */
export function fillPath(
  operationId: string,
  pathParams: Record<string, string | number>,
): string {
  const operation = findOperation(operationId);
  if (!operation) return '';
  return operation.path
    .split('/')
    .map((segment) =>
      segment.startsWith(':')
        ? encodeURIComponent(String(pathParams[segment.slice(1)] ?? ''))
        : segment,
    )
    .join('/');
}
