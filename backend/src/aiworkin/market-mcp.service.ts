import { AipddKeyService } from '../account/aipdd-key.service';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { McpClient } from '../content/agent-mcp.client';
import { aiworkinBaseUrl } from './aiworkin.config';
import { DemandDraft } from './aiworkin.types';

/**
 * 走 AIworkin **MCP** 通道发布需求 / 服务（平台写出只开放给 MCP，REST 写一律 401）。
 *
 * 平台没有「发布需求」这个工具，发布 = 三步：`create_demand_draft`（建私有草稿）
 * → `discover_suppliers_for_demand`（找候选服务商）→ `start_match`（发布并原子创建匹配批次）。
 * 服务发布 = `create_supply_draft` → `publish_supply`。
 *
 * 平台工具的业务失败以 `isError=true` 的**正常结果**返回（不是 JSON-RPC 错误），
 * 因此这里统一按 `code !== 'OK'` 判定失败；不做自动重试（503 冷启动交给上层留痕补发）。
 */
export type MarketMcpResult = {
  listingId: string;
  /** DRAFT（草稿）| ONLINE（已发布） */
  status: string;
  matchRunId: string;
  tip: string;
};

/** 平台默认派发的候选服务商数量（工具枚举只认 3 / 5 / 10）。 */
const TARGET_SUPPLIER_COUNT = 5;
const MCP_PATH = '/mcp';

export class MarketMcpService {
  constructor(private readonly keys: AipddKeyService) {}

  async publishDemand(
    draft: DemandDraft,
    fallbackToken: string,
    idempotencyKey: string,
  ): Promise<MarketMcpResult> {
    const client = await this.connect(fallbackToken);
    try {
      const created = await this.call(client, 'create_demand_draft', {
        idempotencyKey,
        draft: demandMcpDraft(draft),
      });
      const listingId = listingIdOf(created);
      if (draft.publishAction === 'DRAFT') {
        return {
          listingId,
          status: 'DRAFT',
          matchRunId: '',
          tip: '需求已同步至 AIworkin 平台（草稿，补齐截止时间后再次保存即发布匹配）',
        };
      }
      const selected = await this.discover(client, listingId);
      if (!selected.length) {
        return {
          listingId,
          status: 'DRAFT',
          matchRunId: '',
          tip: '平台暂无可派发的同类目服务商，需求已存为平台草稿',
        };
      }
      const started = await this.call(client, 'start_match', {
        listingId,
        selectedServiceListingIds: selected.slice(0, TARGET_SUPPLIER_COUNT),
        idempotencyKey: `${idempotencyKey}m`,
      });
      return {
        listingId,
        status: statusOf(started),
        matchRunId: text(firstOf(started, ['matchRunId'])),
        tip: '需求已发布至 AIworkin 平台并进入匹配',
      };
    } finally {
      client.close();
    }
  }

  async publishSupply(
    draft: DemandDraft,
    fallbackToken: string,
    idempotencyKey: string,
  ): Promise<MarketMcpResult> {
    const client = await this.connect(fallbackToken);
    try {
      const created = await this.call(client, 'create_supply_draft', {
        idempotencyKey,
        draft: supplyMcpDraft(draft),
      });
      const listingId = listingIdOf(created);
      const published = await this.call(client, 'publish_supply', {
        listingId,
        idempotencyKey: `${idempotencyKey}p`,
      });
      return {
        listingId,
        status: statusOf(published),
        matchRunId: '',
        tip: '服务已发布至 AIworkin 平台',
      };
    } finally {
      client.close();
    }
  }

  /** 建立一次 MCP 连接：平台 Key 优先，未配置时回落调用方传入的 Key。 */
  private async connect(fallbackToken: string) {
    const platform =
      (await this.keys.resolvePlatformToken().catch(() => '')) || '';
    const token = platform || fallbackToken;
    if (!token) {
      throw new BusinessException(
        ErrorCode.AIWORKIN_UNAVAILABLE,
        '未配置平台 AIPDD APIKey，无法通过 AIworkin MCP 发布',
      );
    }
    return new McpClient({
      transport: 'http',
      url: `${aiworkinBaseUrl()}${MCP_PATH}`,
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  /** 调一个 MCP 工具并把业务失败统一转成本系统异常。 */
  private async call(
    client: McpClient,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let raw: Record<string, unknown> | undefined;
    try {
      raw = await client.callToolRaw(name, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BusinessException(
        ErrorCode.AIWORKIN_UNAVAILABLE,
        `AIworkin MCP 调用失败：${message}`,
      );
    }
    const structured =
      asRecord(raw?.structuredContent) ?? parseTextContent(raw);
    if (!structured) {
      throw new BusinessException(
        ErrorCode.AIWORKIN_UNAVAILABLE,
        `AIworkin MCP 未返回可解析结果：${name}`,
      );
    }
    const code = text(structured.code);
    if (raw?.isError === true || (code && code !== 'OK')) {
      const message = text(structured.message) || code || '未知错误';
      throw new BusinessException(
        ErrorCode.AIWORKIN_UNAVAILABLE,
        `AIworkin 拒绝该操作：${message}`,
      );
    }
    return structured;
  }

  /** 找候选服务商，返回可直接用于 `start_match` 的 serviceListingId 列表。 */
  private async discover(client: McpClient, listingId: string) {
    const result = await this.call(client, 'discover_suppliers_for_demand', {
      listingId,
    });
    const data = asRecord(result.data) ?? result;
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    const ids: string[] = [];
    for (const item of candidates) {
      const id = text(asRecord(item)?.serviceListingId);
      if (id) ids.push(id);
    }
    return ids;
  }
}

/** `structuredContent` 缺失时，退化为解析第一条 text content 里的 JSON。 */
function parseTextContent(raw: Record<string, unknown> | undefined) {
  const content = Array.isArray(raw?.content) ? raw.content : [];
  for (const item of content) {
    const body = asRecord(item);
    if (body?.type !== 'text') continue;
    try {
      return asRecord(JSON.parse(text(body.text))) ?? undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstOf(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return '';
}

/** 结果里的挂单号：顶层 `data.listingId`，兼容 `data.listing.id`。 */
function listingIdOf(result: Record<string, unknown>) {
  const data = asRecord(result.data) ?? result;
  const id = text(
    firstOf(data, ['listingId']) ||
      firstOf(asRecord(data.listing) ?? {}, ['id']),
  );
  if (!id) {
    throw new BusinessException(
      ErrorCode.AIWORKIN_UNAVAILABLE,
      'AIworkin MCP 未返回需求标识',
    );
  }
  return id;
}

function statusOf(result: Record<string, unknown>) {
  const data = asRecord(result.data) ?? result;
  return text(
    firstOf(data, ['status']) ||
      firstOf(asRecord(data.listing) ?? {}, ['status']) ||
      'ONLINE',
  );
}

/** 去掉空值，避免命中平台的 `additionalProperties: false`。 */
function prune(source: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    if (Array.isArray(value) && !value.length) continue;
    out[key] = value;
  }
  return out;
}

/** 需求地理匹配 → 平台 `a2aConfig`（含 start_match 必需的 AI_SEARCH 与沟通目标）。 */
function demandGeoConfig(draft: DemandDraft) {
  const geo = draft.a2aConfig;
  const mode =
    geo?.geoMatchMode === 'REGION' || geo?.geoMatchMode === 'RADIUS'
      ? geo.geoMatchMode
      : 'NONE';
  return prune({
    discoveryMode: 'AI_SEARCH',
    communicationMode: 'MANUAL',
    communicationGoal:
      text(draft.expectedOutcome) ||
      `就「${draft.title}」与承接方沟通需求细节、报价与交付`,
    targetSupplierCount: TARGET_SUPPLIER_COUNT,
    geoMatchMode: mode,
    province: geo?.province,
    city: geo?.city,
    addressDetail: geo?.addressDetail,
    longitude: geo?.longitude,
    latitude: geo?.latitude,
    radiusKm: geo?.radiusKm,
  });
}

function contactFields(draft: DemandDraft) {
  return prune({
    contactName: draft.contactName,
    contactPhone: draft.contactPhone,
    contactWechat: draft.contactWechat,
    contactEmail: draft.contactEmail,
  });
}

function demandMcpDraft(draft: DemandDraft) {
  return prune({
    title: draft.title,
    description: draft.description,
    subcategoryId: draft.subcategoryId,
    demandMode: draft.demandMode,
    moneyMode: draft.moneyMode || 'NEGOTIABLE',
    currency: draft.currency,
    amountMin: draft.amountMin,
    amountMax: draft.amountMax,
    unitLabel: draft.unitLabel,
    tags: draft.tags,
    expectedOutcome: draft.expectedOutcome,
    mustHaves: draft.mustHaves,
    startAt: draft.startAt,
    deadline: draft.deadline,
    deliverables: draft.deliverables,
    acceptanceCriteria: draft.acceptanceCriteria,
    referenceLinks: draft.referenceLinks,
    attributes: draft.attributes,
    replyEmailEnabled: draft.replyEmailEnabled,
    replyEmail: draft.replyEmail,
    expiresAt: draft.expiresAt,
    ...contactFields(draft),
    a2aConfig: demandGeoConfig(draft),
  });
}

function supplyMcpDraft(draft: DemandDraft) {
  const area = draft.serviceArea;
  return prune({
    title: draft.title,
    description: draft.description,
    subcategoryId: draft.subcategoryId,
    moneyMode: draft.moneyMode || 'NEGOTIABLE',
    currency: draft.currency,
    amountMin: draft.amountMin,
    amountMax: draft.amountMax,
    unitLabel: draft.unitLabel,
    tags: draft.tags,
    deliveryMode: draft.deliveryMode,
    responseTime: draft.responseTime,
    qualifications: draft.qualifications,
    priceDescription: draft.priceDescription,
    highlights: draft.highlights,
    cases: draft.cases,
    referenceLinks: draft.referenceLinks,
    attributes: draft.attributes,
    expiresAt: draft.expiresAt,
    ...contactFields(draft),
    serviceArea: prune({
      mode: area?.mode || 'NATIONWIDE',
      province: area?.province,
      city: area?.city,
      addressDetail: area?.addressDetail,
      longitude: area?.longitude,
      latitude: area?.latitude,
      radiusKm: area?.radiusKm,
    }),
  });
}
