import { endpoints, mcpDomainOfPath } from '@enterprise/contracts';

/**
 * 意图解析：把一次 HTTP 写请求翻译成「谁在哪个业务域做了什么」。
 * operationId、业务域、对象类型全部从契约层 `endpoints` 推导，不写第二份清单，
 * 所以新增接口自动进入记忆，不会出现某个模块漏记。
 */

export type IntentMatch = {
  operationId: string;
  /** 业务域：路径首段（enterprise / api-v1 之后那一段） */
  domain: string;
  /** 对象类型：业务域后的第一个静态段，如 declarations、data-tables */
  targetType: string;
  /** 路径参数（:id 之类）解析出的实际值 */
  pathParams: Record<string, string>;
};

type TrieNode = {
  staticChildren: Map<string, TrieNode>;
  paramChild: { name: string; node: TrieNode } | null;
  /** key = 小写 method；同一路径不同方法对应不同 operationId */
  matches: Map<string, IntentMatch>;
};

function newNode(): TrieNode {
  return {
    staticChildren: new Map(),
    paramChild: null,
    matches: new Map(),
  };
}

function intentTargetType(segments: string[], domain: string): string {
  const startIndex =
    segments[0] === 'api' ? 3 : segments[0] === 'enterprise' ? 2 : 1;
  for (let index = startIndex; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment && !segment.startsWith(':') && segment !== domain)
      return segment;
  }
  return domain;
}

/**
 * 只登记写请求；读请求是「看了什么」，不进意图记忆。
 * `agent` 域不登记（否则「清空我的记忆」这条动作会把「我清过」的证据也清掉）；
 * `mcp` 域不登记（一次 MCP 调用真正执行的动作由执行器各自进记忆，套一层信封只剩噪音）。
 */
const WRITE_INDEX: TrieNode = (() => {
  const root = newNode();
  for (const [operationId, definition] of Object.entries(endpoints)) {
    const method = String(definition.method).toLowerCase();
    if (method === 'get') continue;
    const segments = String(definition.path).split('/').filter(Boolean);
    const domain = mcpDomainOfPath(String(definition.path));
    if (!domain || domain === 'agent' || domain === 'mcp') continue;
    const match: IntentMatch = {
      operationId,
      domain,
      targetType: intentTargetType(segments, domain),
      pathParams: {},
    };
    let node = root;
    for (const segment of segments) {
      if (segment.startsWith(':')) {
        if (!node.paramChild)
          node.paramChild = { name: segment.slice(1), node: newNode() };
        node = node.paramChild.node;
        continue;
      }
      let child = node.staticChildren.get(segment);
      if (!child) {
        child = newNode();
        node.staticChildren.set(segment, child);
      }
      node = child;
    }
    node.matches.set(method, match);
  }
  return root;
})();

/**
 * 按路径段走字典树，静态段优先于 `:参数` 段，所以 `/contracts/revoke` 与 `/contracts/:id`
 * 同前缀时不会互相抢占；命中的 operationId 逐字取自契约，供阶段 3 的 MCP tools/list 直接引用。
 */
export function resolveWriteIntent(
  method: string,
  rawPath: string,
): IntentMatch | undefined {
  const path = rawPath.replace(/^\/api\/backend(?=\/|$)/, '');
  if (/^\/api\/auth(\/|$)/.test(path)) return undefined;
  if (/^\/enterprise\/feishu\/events(\/|$)/.test(path)) return undefined;
  const segments = path.split('/').filter(Boolean);
  const pathParams: Record<string, string> = {};
  let node: TrieNode = WRITE_INDEX;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const child = node.staticChildren.get(segment);
    if (child) {
      node = child;
      continue;
    }
    if (node.paramChild) {
      pathParams[node.paramChild.name] = decodeSegment(segment);
      node = node.paramChild.node;
      continue;
    }
    return undefined;
  }
  const match = node.matches.get(method.toLowerCase());
  if (!match) return undefined;
  return { ...match, pathParams };
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** 最后一段路径参数＝动作直接作用的对象 id（响应里没有 id 时兜底）。 */
export function lastPathParam(pathParams: Record<string, string>): string {
  const names = Object.keys(pathParams);
  if (!names.length) return '';
  return truncate(pathParams[names[names.length - 1]], 64);
}

const SECRET_KEY_PATTERN =
  /(password|passwd|secret|token|credential|cipher|authorization|cookie|apikey|api_key|accesskey|appkey|appsecret|_ak$|_sk$|^ak$|^sk$|key)/i;

/**
 * 参数摘要脱敏：凭据类键名只留占位，长文本截断，数组只留条数与首两条样本，
 * 深度与条数封顶——记忆要能复现意图，但不能变成请求原文的副本。
 */
export function sanitizeParams(
  value: unknown,
  depth = 0,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return sanitizeObject(value, depth);
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return truncate(value, 120);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value))
    return {
      count: value.length,
      sample: value
        .slice(0, 2)
        .map((item) => sanitizeValue(item, depth + 1))
        .filter((item) => item !== undefined),
    };
  if (depth >= 3) return '[略]';
  if (typeof value === 'object') return sanitizeObject(value, depth + 1);
  if (typeof value === 'bigint') return truncate(value.toString(), 120);
  return undefined;
}

function sanitizeObject(
  value: unknown,
  depth: number,
): Record<string, unknown> {
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).slice(0, 24)) {
    const sanitized = SECRET_KEY_PATTERN.test(key)
      ? '[已脱敏]'
      : sanitizeValue(source[key], depth);
    if (sanitized !== undefined) out[key] = sanitized;
  }
  return out;
}

export function truncate(value: string | undefined, max: number): string {
  const text = (value ?? '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** 响应里能代表对象本身的字段：id 用于回放，名称/单号用于人话展示。 */
export function readTarget(data: unknown): { id: string; label: string } {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return { id: '', label: '' };
  const row = data as Record<string, unknown>;
  const id =
    typeof row.id === 'string' || typeof row.id === 'number'
      ? String(row.id)
      : '';
  const label =
    [row.name, row.title, row.label, row.tableName, row.orderNo, row.declNo]
      .map((item) => (typeof item === 'string' ? item : ''))
      .find((item) => item.length > 0) ?? '';
  return { id: truncate(id, 64), label: truncate(label, 200) };
}

/**
 * 结果判定：本站信封 code===0 才算成功，403 记为「已拦截」（权限/门控挡住），其余记失败。
 * 只读信封，不读上游原文，错误文案同样过 truncate。
 */
export function readOutcome(
  status: number,
  payload: unknown,
): {
  outcome: 'ok' | 'failed' | 'blocked';
  errorCode: string;
  errorMessage: string;
} {
  const envelope =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const code = typeof envelope.code === 'number' ? envelope.code : undefined;
  if (code === 0) return { outcome: 'ok', errorCode: '', errorMessage: '' };
  const message =
    typeof envelope.message === 'string' ? truncate(envelope.message, 500) : '';
  if (code === undefined && status >= 200 && status < 300)
    return { outcome: 'ok', errorCode: '', errorMessage: '' };
  return {
    outcome: status === 403 || code === 403 ? 'blocked' : 'failed',
    errorCode: code === undefined ? truncate(String(status), 64) : String(code),
    errorMessage: message,
  };
}
