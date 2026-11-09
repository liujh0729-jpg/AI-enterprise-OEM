import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '../../generated/prisma';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import {
  HW_DEVICE_TOKEN_PREFIX,
  HW_TOOL_NAMESPACE,
  type HwDeviceEvent,
  type HwDevice,
  type HwDeviceStatus,
  type HwKit,
  type HwKitChannel,
  type HwModel,
  type HwTool,
  type HwToolKind,
  type HwToolScope,
  type HwToolTransport,
} from '@enterprise/contracts';

/** Prisma Json 入参的统一转换：调用方传业务对象，只有这里做类型断言。 */
export const json = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

/** Json 读出的统一归一：DB 里可能是对象 / 数组 / null，业务层只处理这一份形状。 */
export function asObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

export function asList(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [];
}

export function asString(raw: unknown, max = 2000): string {
  if (typeof raw === 'string') return raw.slice(0, max);
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return '';
}

/** 路径参数里的正整数编号；非法一律 BAD_REQUEST，避免把 NaN 传进查询。 */
export function positiveId(raw: string, label: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, `${label}编号不合法`);
  }
  return id;
}

/** 可选编号：空串 / undefined 视作「不过滤」。 */
export function optionalId(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 设备令牌：`hw_` + 40 位随机十六进制；只存 SHA-256，明文只在生成那一刻返回。 */
export function newDeviceToken(): {
  token: string;
  tokenHash: string;
  tokenPrefix: string;
} {
  const token = HW_DEVICE_TOKEN_PREFIX + randomBytes(20).toString('hex');
  return {
    token,
    tokenHash: hashDeviceToken(token),
    tokenPrefix: token.slice(0, 11),
  };
}

export function toolNameOf(modelCode: string, toolCode: string): string {
  return `${HW_TOOL_NAMESPACE}${modelCode}__${toolCode}`;
}

/** 解析 `hw__<modelCode>__<toolCode>`；不是硬件工具名返回 null。 */
export function parseToolName(
  name: string,
): { modelCode: string; toolCode: string } | null {
  if (!name.startsWith(HW_TOOL_NAMESPACE)) return null;
  const rest = name.slice(HW_TOOL_NAMESPACE.length);
  const split = rest.indexOf('__');
  if (split <= 0) return null;
  return {
    modelCode: rest.slice(0, split),
    toolCode: rest.slice(split + 2),
  };
}

export function isHwToolName(name: string): boolean {
  return parseToolName(name) !== null;
}

/* ------------------------------ DTO 映射 ------------------------------ */

export function toModelDto(
  row: {
    id: number;
    code: string;
    name: string;
    vendor: string;
    chip: string;
    category: string;
    summary: string;
    coverUrl: string;
    spec: unknown;
    featured: boolean;
    enabled: boolean;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  },
  kitCount = 0,
  deviceCount = 0,
): HwModel {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    vendor: row.vendor,
    chip: row.chip,
    category: row.category,
    summary: row.summary,
    coverUrl: row.coverUrl,
    spec: asObject(row.spec),
    featured: row.featured,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    kitCount,
    deviceCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toKitDto(row: {
  id: number;
  modelId: number;
  version: string;
  channel: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  changelog: string;
  docUrl: string;
  minFirmware: string;
  downloadCount: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): HwKit {
  return {
    id: row.id,
    modelId: row.modelId,
    version: row.version,
    channel: row.channel as HwKitChannel,
    fileName: row.fileName,
    fileSize: row.fileSize,
    sha256: row.sha256,
    changelog: row.changelog,
    docUrl: row.docUrl,
    minFirmware: row.minFirmware,
    downloadCount: row.downloadCount,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toDeviceDto(
  row: {
    id: number;
    modelId: number;
    name: string;
    serialNo: string;
    tokenPrefix: string;
    status: string;
    lastSeenAt: Date | null;
    lastIp: string;
    firmwareVersion: string;
    meta: unknown;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  },
  model?: { code: string; name: string },
): HwDevice {
  return {
    id: row.id,
    modelId: row.modelId,
    modelCode: model?.code ?? '',
    modelName: model?.name ?? '',
    name: row.name,
    serialNo: row.serialNo,
    tokenPrefix: row.tokenPrefix,
    status: row.status as HwDeviceStatus,
    lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    lastIp: row.lastIp,
    firmwareVersion: row.firmwareVersion,
    meta: asObject(row.meta),
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toToolDto(
  row: {
    id: number;
    modelId: number;
    kind: string;
    scope: string;
    ownerUserId: string;
    code: string;
    name: string;
    description: string;
    transport: string;
    method: string;
    path: string;
    commandCode: string;
    params: unknown;
    response: unknown;
    examples: unknown;
    write: boolean;
    requiresGrant: boolean;
    enabled: boolean;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  },
  modelCode: string,
): HwTool {
  return {
    id: row.id,
    modelId: row.modelId,
    kind: row.kind as HwToolKind,
    scope: row.scope as HwToolScope,
    ownerUserId: row.ownerUserId,
    code: row.code,
    name: row.name,
    description: row.description,
    transport: row.transport as HwToolTransport,
    method: row.method,
    path: row.path,
    commandCode: row.commandCode,
    params: asObject(row.params),
    response: asObject(row.response),
    examples: asList(row.examples),
    write: row.write,
    requiresGrant: row.requiresGrant,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    toolName: toolNameOf(modelCode, row.code),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toEventDto(row: {
  id: number;
  kind: string;
  direction: string;
  commandCode: string;
  payload: unknown;
  ok: boolean;
  latencyMs: number;
  message: string;
  createdAt: Date;
}): HwDeviceEvent {
  return {
    id: row.id,
    kind: row.kind as HwDeviceEvent['kind'],
    direction: row.direction === 'OUT' ? 'OUT' : 'IN',
    commandCode: row.commandCode,
    payload: asObject(row.payload),
    ok: row.ok,
    latencyMs: row.latencyMs,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 工具参数 → MCP inputSchema：params 本身就是 JSON Schema，缺字段时兜一个空对象 schema。 */
export function inputSchemaOf(params: Record<string, unknown>) {
  if (params.type === 'object') return params;
  return { type: 'object', properties: {}, ...params };
}
