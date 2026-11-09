import { createHash, randomUUID } from 'node:crypto';
import {
  HW_COMMAND_TIMEOUT_SECONDS,
  HW_COMMANDS_PER_MINUTE,
  HW_DEVICE_STATUSES,
  HW_OFFLINE_AFTER_SECONDS,
  HW_TOOL_KINDS,
  hwDeviceCreateBodySchema,
  hwKitSaveBodySchema,
  hwModelSaveBodySchema,
  hwToolSaveBodySchema,
  type HwDevice,
  type HwDeviceEvent,
  type HwKit,
  type HwModel,
  type HwModelDetail,
  type HwTool,
  type HwToolCallResult,
  type HwToolGrant,
  type z,
} from '@enterprise/contracts';
import type { PrismaService } from '../prisma/prisma.service';
import type { OssService } from '../oss/oss.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { currentAgentScope } from '../content/agent-scope';
import { assertOutboundUrl } from '../http/outbound-guard';
import { httpRequest, TransportError } from '../http/transport';
import {
  asObject,
  asString,
  hashDeviceToken,
  inputSchemaOf,
  json,
  newDeviceToken,
  optionalId,
  parseToolName,
  positiveId,
  toDeviceDto,
  toEventDto,
  toKitDto,
  toModelDto,
  toToolDto,
  toolNameOf,
} from './hardware.helpers';

type DeviceCreateBody = z.infer<typeof hwDeviceCreateBodySchema>;
type KitSaveBody = z.infer<typeof hwKitSaveBodySchema>;
type ToolSaveBody = z.infer<typeof hwToolSaveBodySchema>;
type ModelSaveBody = z.infer<typeof hwModelSaveBodySchema>;

type ToolRow = {
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
};

/** 设备通道：令牌只存 SHA-256，校验通过后拿到整行（含 userId，用于后续归属核对）。 */
export type DevicePrincipal = {
  id: number;
  userId: string;
  modelId: number;
  name: string;
  enabled: boolean;
};

/** 工具执行的来源：站内试调（人在屏幕前）/ 机器通道 / 站内 Agent（MCP）。 */
export type ToolCallSource = 'trial' | 'machine' | 'agent';

export type HardwareMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean };
};

export type HardwareMcpResult = {
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
};

function fail(message: string): HardwareMcpResult {
  return {
    content: [{ type: 'text', text: message }],
    structuredContent: { ok: false, message },
    isError: true,
  };
}

function ok(structured: Record<string, unknown>): HardwareMcpResult {
  return {
    content: [
      { type: 'text', text: JSON.stringify(structured).slice(0, 6000) },
    ],
    structuredContent: structured,
  };
}

/** 在线判定：从未上报过＝NEVER；心跳超时＝OFFLINE；否则 ONLINE。 */
export function deviceStatusOf(row: {
  lastSeenAt: Date | null;
}): (typeof HW_DEVICE_STATUSES)[number] {
  if (!row.lastSeenAt) return 'NEVER';
  const elapsed = Date.now() - row.lastSeenAt.getTime();
  return elapsed > HW_OFFLINE_AFTER_SECONDS * 1000 ? 'OFFLINE' : 'ONLINE';
}

export class HardwareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oss: OssService,
  ) {}

  // ---------------------------------------------------------------- 硬件广场

  async plazaModels(
    userId: string,
    query: { all?: string },
  ): Promise<{ models: HwModel[] }> {
    const includeDisabled = query.all === '1';
    const rows = await this.prisma.hwModel.findMany({
      where: includeDisabled ? {} : { enabled: true },
      orderBy: [{ featured: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    });
    const kits = await this.prisma.hwDevKit.groupBy({
      by: ['modelId'],
      where: { enabled: true },
      _count: { _all: true },
    });
    const devices = await this.prisma.hwDevice.groupBy({
      by: ['modelId'],
      where: { userId },
      _count: { _all: true },
    });
    const kitCount = (id: number) =>
      kits.find((row) => row.modelId === id)?._count._all ?? 0;
    const deviceCount = (id: number) =>
      devices.find((row) => row.modelId === id)?._count._all ?? 0;
    return {
      models: rows.map((row) =>
        toModelDto(row, kitCount(row.id), deviceCount(row.id)),
      ),
    };
  }

  async plazaModel(userId: string, code: string): Promise<HwModelDetail> {
    const row = await this.prisma.hwModel.findFirst({
      where: { code, enabled: true },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '该型号未上架');
    const kits = await this.prisma.hwDevKit.findMany({
      where: { modelId: row.id, enabled: true },
      orderBy: [{ channel: 'asc' }, { id: 'desc' }],
    });
    const devices = await this.prisma.hwDevice.findMany({
      where: { userId, modelId: row.id },
      orderBy: { id: 'desc' },
      select: { id: true, name: true, lastSeenAt: true },
    });
    return {
      ...toModelDto(row, kits.length, devices.length),
      kits: kits.map(toKitDto),
      devices: devices.map((item) => ({
        id: item.id,
        name: item.name,
        status: deviceStatusOf(item),
        lastSeenAt: item.lastSeenAt ? item.lastSeenAt.toISOString() : null,
      })),
    };
  }

  /** 开发包下载：计数 +1 并给出对象存储的公开地址（桶公开读，链接本身不带凭据）。 */
  async kitDownload(userId: string, id: string) {
    const kitId = positiveId(id, '开发包');
    const row = await this.prisma.hwDevKit.findUnique({ where: { id: kitId } });
    if (!row || !row.enabled)
      throw new BusinessException(ErrorCode.NOT_FOUND, '该开发包未上架');
    const model = await this.prisma.hwModel.findUnique({
      where: { id: row.modelId },
    });
    if (!model || !model.enabled)
      throw new BusinessException(ErrorCode.NOT_FOUND, '该型号未上架');
    if (!row.ossKey)
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '该开发包尚未上传文件，请联系管理员',
      );
    await this.prisma.hwDevKit.update({
      where: { id: kitId },
      data: { downloadCount: { increment: 1 } },
    });
    return {
      url: this.oss.keyUrlOf(row.ossKey),
      fileName: row.fileName || `${model.code}-${row.version}.bin`,
      fileSize: row.fileSize,
      sha256: row.sha256,
    };
  }

  // ---------------------------------------------------------------- 我的设备

  async devices(userId: string, query: { modelId?: string }) {
    const modelId = optionalId(query.modelId);
    const rows = await this.prisma.hwDevice.findMany({
      where: { userId, ...(modelId ? { modelId } : {}) },
      orderBy: { id: 'desc' },
    });
    const models = await this.prisma.hwModel.findMany({
      where: { id: { in: rows.map((row) => row.modelId) } },
      select: { id: true, code: true, name: true },
    });
    const modelOf = (id: number) => models.find((item) => item.id === id);
    const devices = rows.map((row) => toDeviceDto(row, modelOf(row.modelId)));
    const counts = { online: 0, offline: 0, never: 0 };
    for (const device of devices) {
      if (device.status === 'ONLINE') counts.online += 1;
      else if (device.status === 'OFFLINE') counts.offline += 1;
      else counts.never += 1;
    }
    return { devices, ...counts };
  }

  async deviceCreate(
    userId: string,
    body: DeviceCreateBody,
  ): Promise<{ device: HwDevice; token: string }> {
    const model = await this.prisma.hwModel.findUnique({
      where: { id: body.modelId },
    });
    if (!model || !model.enabled)
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '该型号未上架，不能接入设备',
      );
    const { token, tokenHash, tokenPrefix } = newDeviceToken();
    const row = await this.prisma.hwDevice.create({
      data: {
        userId,
        modelId: model.id,
        name: body.name,
        serialNo: body.serialNo ?? '',
        tokenHash,
        tokenPrefix,
      },
    });
    return { device: toDeviceDto(row, model), token };
  }

  private async ownDevice(userId: string, id: number) {
    const row = await this.prisma.hwDevice.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '设备不存在');
    if (row.userId !== userId)
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能操作自己接入的设备',
      );
    return row;
  }

  async deviceUpdate(
    userId: string,
    id: string,
    body: Record<string, unknown>,
  ): Promise<HwDevice> {
    const deviceId = positiveId(id, '设备');
    const row = await this.ownDevice(userId, deviceId);
    const data: Record<string, unknown> = {};
    if (typeof body.name === 'string' && body.name.trim())
      data.name = body.name.trim();
    if (typeof body.serialNo === 'string') data.serialNo = body.serialNo.trim();
    if (typeof body.enabled === 'boolean') data.enabled = body.enabled;
    const updated = Object.keys(data).length
      ? await this.prisma.hwDevice.update({ where: { id: deviceId }, data })
      : row;
    const model = await this.prisma.hwModel.findUnique({
      where: { id: updated.modelId },
    });
    return toDeviceDto(updated, model ?? undefined);
  }

  async deviceRemove(userId: string, id: string) {
    const deviceId = positiveId(id, '设备');
    await this.ownDevice(userId, deviceId);
    // 事件流水随设备一并清掉：留着没有设备归属的流水没有意义，也免得越权读到别人的历史。
    await this.prisma.$transaction([
      this.prisma.hwDeviceEvent.deleteMany({ where: { deviceId } }),
      this.prisma.hwDevice.delete({ where: { id: deviceId } }),
    ]);
    return { removed: true };
  }

  async deviceResetToken(
    userId: string,
    id: string,
  ): Promise<{ device: HwDevice; token: string }> {
    const deviceId = positiveId(id, '设备');
    await this.ownDevice(userId, deviceId);
    const { token, tokenHash, tokenPrefix } = newDeviceToken();
    const updated = await this.prisma.hwDevice.update({
      where: { id: deviceId },
      data: { tokenHash, tokenPrefix, status: 'NEVER', lastSeenAt: null },
    });
    const model = await this.prisma.hwModel.findUnique({
      where: { id: updated.modelId },
    });
    return { device: toDeviceDto(updated, model ?? undefined), token };
  }

  async deviceEvents(
    userId: string,
    id: string,
    query: { kind?: string },
  ): Promise<{ events: HwDeviceEvent[] }> {
    const deviceId = positiveId(id, '设备');
    await this.ownDevice(userId, deviceId);
    const kind = HW_KINDS.find((item) => item === query.kind);
    const rows = await this.prisma.hwDeviceEvent.findMany({
      where: { deviceId, ...(kind ? { kind } : {}) },
      orderBy: { id: 'desc' },
      take: 100,
    });
    return { events: rows.map(toEventDto) };
  }

  // ---------------------------------------------------------------- 工具（API / MCP）

  /** 本人可见：型号默认工具 + 本人自建工具；别人的自建工具一律不出。 */
  private visibleWhere(userId: string, modelId: number) {
    return {
      modelId,
      enabled: true,
      OR: [{ scope: 'DEFAULT' }, { scope: 'USER', ownerUserId: userId }],
    };
  }

  async tools(userId: string, code: string, query: { kind?: string }) {
    const model = await this.prisma.hwModel.findFirst({
      where: { code, enabled: true },
    });
    if (!model)
      throw new BusinessException(ErrorCode.NOT_FOUND, '该型号未上架');
    const kind = HW_TOOL_KINDS.find((item) => item === query.kind);
    const rows = await this.prisma.hwTool.findMany({
      where: {
        ...this.visibleWhere(userId, model.id),
        ...(kind ? { kind } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const granted = await this.grantedToolIds(userId);
    return {
      tools: rows.map((row) => toToolDto(row, model.code)),
      granted: rows.filter((row) => granted.has(row.id)).map((row) => row.id),
    };
  }

  private async grantedToolIds(userId: string): Promise<Set<number>> {
    const rows = await this.prisma.hwToolGrant.findMany({
      where: { userId },
      select: { toolId: true },
    });
    return new Set(rows.map((row) => row.toolId));
  }

  /** 工具编码进 MCP 工具名，落库前先挡掉同型号同粒度的重名。 */
  private async assertToolCodeFree(
    modelId: number,
    kind: string,
    scope: string,
    ownerUserId: string,
    code: string,
  ) {
    const exists = await this.prisma.hwTool.findFirst({
      where: { modelId, kind, scope, ownerUserId, code },
      select: { id: true },
    });
    if (exists)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `工具编码 ${code} 已被占用`,
      );
  }

  private toolData(body: ToolSaveBody) {
    const transport = body.transport;
    if (transport === 'HTTP' && !body.path) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '设备直连工具必须填写设备上的接口路径',
      );
    }
    if (transport === 'DEVICE' && !body.commandCode) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '指令下发工具必须填写指令编码',
      );
    }
    return {
      kind: body.kind,
      code: body.code,
      name: body.name,
      description: body.description ?? '',
      transport,
      method: body.method || 'POST',
      path: body.path ?? '',
      commandCode: body.commandCode ?? '',
      params: json(body.params ?? {}),
      response: json(body.response ?? {}),
      examples: json(body.examples ?? []),
      write: body.write ?? false,
      requiresGrant: body.requiresGrant ?? true,
      enabled: body.enabled ?? true,
      sortOrder: body.sortOrder ?? 0,
    };
  }

  async toolCreate(
    userId: string,
    code: string,
    body: ToolSaveBody,
  ): Promise<HwTool> {
    const model = await this.prisma.hwModel.findFirst({
      where: { code, enabled: true },
    });
    if (!model)
      throw new BusinessException(ErrorCode.NOT_FOUND, '该型号未上架');
    await this.assertToolCodeFree(
      model.id,
      body.kind,
      'USER',
      userId,
      body.code,
    );
    const row = await this.prisma.hwTool.create({
      data: {
        ...this.toolData(body),
        modelId: model.id,
        scope: 'USER',
        ownerUserId: userId,
      },
    });
    return toToolDto(row, model.code);
  }

  private async ownTool(userId: string, id: number) {
    const row = await this.prisma.hwTool.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '工具不存在');
    if (row.scope !== 'USER' || row.ownerUserId !== userId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能修改或删除自己自建的工具',
      );
    }
    return row;
  }

  async toolUpdate(
    userId: string,
    id: string,
    body: Partial<ToolSaveBody>,
  ): Promise<HwTool> {
    const toolId = positiveId(id, '工具');
    const row = await this.ownTool(userId, toolId);
    if (body.code && body.code !== row.code) {
      await this.assertToolCodeFree(
        row.modelId,
        body.kind ?? row.kind,
        'USER',
        userId,
        body.code,
      );
    }
    const data: Record<string, unknown> = {};
    if (body.kind !== undefined) data.kind = body.kind;
    if (body.code !== undefined) data.code = body.code;
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.transport !== undefined) data.transport = body.transport;
    if (body.method !== undefined) data.method = body.method;
    if (body.path !== undefined) data.path = body.path;
    if (body.commandCode !== undefined) data.commandCode = body.commandCode;
    if (body.params !== undefined) data.params = json(body.params);
    if (body.response !== undefined) data.response = json(body.response);
    if (body.examples !== undefined) data.examples = json(body.examples);
    if (body.write !== undefined) data.write = body.write;
    if (body.requiresGrant !== undefined)
      data.requiresGrant = body.requiresGrant;
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    const updated = Object.keys(data).length
      ? await this.prisma.hwTool.update({ where: { id: toolId }, data })
      : row;
    const model = await this.prisma.hwModel.findUnique({
      where: { id: updated.modelId },
    });
    return toToolDto(updated, model?.code ?? '');
  }

  async toolRemove(userId: string, id: string) {
    const toolId = positiveId(id, '工具');
    await this.ownTool(userId, toolId);
    await this.prisma.$transaction([
      this.prisma.hwToolGrant.deleteMany({ where: { toolId } }),
      this.prisma.hwTool.delete({ where: { id: toolId } }),
    ]);
    return { removed: true };
  }

  // ---------------------------------------------------------------- 工具授权闸

  async toolGrants(
    userId: string,
    query: { modelId?: string },
  ): Promise<{ tools: HwToolGrant[]; grantedCount: number }> {
    const modelId = optionalId(query.modelId);
    const models = await this.prisma.hwModel.findMany({
      select: { id: true, code: true },
    });
    const codeOf = (id: number) =>
      models.find((item) => item.id === id)?.code ?? '';
    const rows = await this.prisma.hwTool.findMany({
      where: {
        enabled: true,
        ...(modelId ? { modelId } : {}),
        OR: [{ scope: 'DEFAULT' }, { scope: 'USER', ownerUserId: userId }],
      },
      orderBy: [{ modelId: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    });
    const granted = await this.grantedToolIds(userId);
    const tools = rows.map((row) => ({
      toolId: row.id,
      modelId: row.modelId,
      modelCode: codeOf(row.modelId),
      code: row.code,
      name: row.name,
      kind: row.kind as HwToolGrant['kind'],
      transport: row.transport as HwToolGrant['transport'],
      granted: granted.has(row.id),
    }));
    return { tools, grantedCount: tools.filter((tool) => tool.granted).length };
  }

  async toolSaveGrants(userId: string, body: { toolIds?: number[] }) {
    const wanted = new Set(body.toolIds ?? []);
    const visible = await this.prisma.hwTool.findMany({
      where: {
        enabled: true,
        OR: [{ scope: 'DEFAULT' }, { scope: 'USER', ownerUserId: userId }],
      },
      select: { id: true },
    });
    const visibleIds = new Set(visible.map((row) => row.id));
    for (const id of wanted) {
      if (!visibleIds.has(id))
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '授权清单里有不可见的工具',
        );
    }
    const current = await this.grantedToolIds(userId);
    const toAdd = [...wanted].filter((id) => !current.has(id));
    const toRemove = [...current].filter((id) => !wanted.has(id));
    if (toAdd.length) {
      await this.prisma.hwToolGrant.createMany({
        data: toAdd.map((toolId) => ({ userId, toolId })),
        skipDuplicates: true,
      });
    }
    if (toRemove.length) {
      await this.prisma.hwToolGrant.deleteMany({
        where: { userId, toolId: { in: toRemove } },
      });
    }
    return { granted: toAdd.length, revoked: toRemove.length };
  }

  /**
   * 三层闸（与平台 MCP / 连接器同一套口径）：
   * 未授权只出草案、无人值守只出草案、dryRun 只出草案。
   * 站内试调是本人当场的动作，不受「未授权」这一层拦（否则授权前没法验证工具）。
   */
  private async toolGate(input: {
    userId: string;
    tool: ToolRow;
    source: ToolCallSource;
    args: Record<string, unknown>;
    dryRun: boolean;
  }): Promise<{ reason: string; code: string } | null> {
    const { tool, source, dryRun } = input;
    if (dryRun)
      return {
        code: 'DRY_RUN',
        reason: '调用方要求 dryRun，只出草案，未真正下发。',
      };
    const scope = currentAgentScope();
    const unattended =
      scope?.trigger === 'schedule' && scope.allowWrite !== true;
    if (tool.write && unattended) {
      return {
        code: 'SCHEDULE_DENIED',
        reason:
          '无人值守任务默认不执行硬件写动作，只出草案；请在该定时任务里勾选「允许自动执行写动作」，或在本人的对话里确认后执行。',
      };
    }
    if (tool.write && tool.requiresGrant && source !== 'trial') {
      const granted = await this.grantedToolIds(input.userId);
      if (!granted.has(tool.id)) {
        return {
          code: 'NOT_GRANTED',
          reason: `本账号没有勾选「${tool.name}」可自动执行，请先在「智能硬件 → MCP / API」里授权。`,
        };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- 工具执行

  private async targetDevice(userId: string, tool: ToolRow, deviceId?: number) {
    if (deviceId) {
      const row = await this.prisma.hwDevice.findUnique({
        where: { id: deviceId },
      });
      if (!row || row.userId !== userId)
        throw new BusinessException(
          ErrorCode.NOT_FOUND,
          '设备不存在或不属于当前账号',
        );
      if (row.modelId !== tool.modelId)
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '该设备不是这个型号，不能调用它的工具',
        );
      if (!row.enabled)
        throw new BusinessException(ErrorCode.BAD_REQUEST, '该设备已停用');
      return row;
    }
    const row = await this.prisma.hwDevice.findFirst({
      where: { userId, modelId: tool.modelId, enabled: true },
      orderBy: { lastSeenAt: 'desc' },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '还没有接入该型号的设备，请先在「添加硬件」里接入',
      );
    }
    return row;
  }

  /** HTTP 直连：设备自己起 HTTP 服务，平台代调；令牌明文不出设备通道，这里带哈希自证。 */
  private async callHttp(
    device: { tokenHash: string; meta: unknown },
    tool: ToolRow,
    args: Record<string, unknown>,
  ) {
    const meta = asObject(device.meta);
    const baseUrl = asString(meta.baseUrl, 500).trim();
    if (!baseUrl) {
      return {
        ok: false,
        status: 0,
        latencyMs: 0,
        response: null,
        message:
          '设备直连工具需要设备上报自己的 HTTP 地址（心跳 meta.baseUrl）',
        reason: 'DEVICE_NO_BASE_URL',
      } satisfies HwToolCallResult;
    }
    await assertOutboundUrl(baseUrl, '设备地址');
    const url = `${baseUrl.replace(/\/+$/, '')}${tool.path.startsWith('/') ? '' : '/'}${tool.path}`;
    await assertOutboundUrl(url, '设备接口');
    const started = Date.now();
    const method = tool.method.toUpperCase();
    try {
      const result = await httpRequest<unknown>(url, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-device-token-hash': device.tokenHash,
        },
        ...(method === 'GET' || method === 'HEAD'
          ? {}
          : { body: JSON.stringify(args) }),
        timeoutMs: HW_COMMAND_TIMEOUT_SECONDS * 1000,
        readAs: 'json',
        maxBytes: 2 * 1024 * 1024,
        redirect: 'manual',
        operation: 'hardware:device-http',
      });
      return {
        ok: result.ok,
        status: result.status,
        latencyMs: Date.now() - started,
        response: result.data,
        message: result.ok ? '' : `设备返回 HTTP ${result.status}`,
        reason: result.ok ? '' : 'DEVICE_HTTP_ERROR',
      } satisfies HwToolCallResult;
    } catch (error) {
      const message =
        error instanceof TransportError && error.kind === 'timeout'
          ? '设备响应超时'
          : error instanceof Error
            ? error.message
            : '设备调用失败';
      return {
        ok: false,
        status: 0,
        latencyMs: Date.now() - started,
        response: null,
        message,
        reason: 'DEVICE_UNREACHABLE',
      } satisfies HwToolCallResult;
    }
  }

  /** 指令下发：落一条 COMMAND 流水，设备拉取后回执；同步等回执，超时明确留痕。 */
  private async callDevice(
    device: { id: number },
    tool: ToolRow,
    args: Record<string, unknown>,
  ) {
    await this.assertCommandRate(device.id);
    const commandCode = `${tool.commandCode}__${randomUUID().slice(0, 8)}`;
    const started = Date.now();
    const command = await this.prisma.hwDeviceEvent.create({
      data: {
        deviceId: device.id,
        kind: 'COMMAND',
        direction: 'OUT',
        commandCode,
        payload: json({ commandCode: tool.commandCode, args }),
        ok: false,
        latencyMs: 0,
        message: '已下发',
      },
    });
    const deadline = started + HW_COMMAND_TIMEOUT_SECONDS * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const result = await this.prisma.hwDeviceEvent.findFirst({
        where: { deviceId: device.id, kind: 'RESULT', commandCode },
      });
      if (result) {
        const payload = asObject(result.payload);
        return {
          ok: result.ok,
          status: 0,
          latencyMs: Date.now() - started,
          response: payload.response ?? payload,
          message: result.message,
          reason: result.ok ? '' : 'DEVICE_ERROR',
        } satisfies HwToolCallResult;
      }
    }
    await this.prisma.hwDeviceEvent.update({
      where: { id: command.id },
      data: { latencyMs: Date.now() - started, message: '回执超时' },
    });
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      response: null,
      message: `设备未在 ${HW_COMMAND_TIMEOUT_SECONDS} 秒内回执`,
      reason: 'DEVICE_TIMEOUT',
    } satisfies HwToolCallResult;
  }

  private async execute(input: {
    userId: string;
    tool: ToolRow;
    deviceId?: number;
    args: Record<string, unknown>;
    source: ToolCallSource;
    dryRun: boolean;
  }): Promise<HwToolCallResult> {
    const { tool, args, source, dryRun } = input;
    const model = await this.prisma.hwModel.findUnique({
      where: { id: tool.modelId },
    });
    const blocked = await this.toolGate({
      userId: input.userId,
      tool,
      source,
      args,
      dryRun,
    });
    if (blocked) {
      return {
        ok: false,
        status: 0,
        latencyMs: 0,
        response: null,
        message: `工具执行失败：${blocked.reason}`,
        reason: blocked.code,
      };
    }
    const device = await this.targetDevice(input.userId, tool, input.deviceId);
    if (
      deviceStatusOf(device) === 'OFFLINE' ||
      deviceStatusOf(device) === 'NEVER'
    ) {
      return {
        ok: false,
        status: 0,
        latencyMs: 0,
        response: null,
        message: `工具执行失败：设备「${device.name}」当前不在线`,
        reason: 'DEVICE_OFFLINE',
      };
    }
    const result =
      tool.transport === 'HTTP'
        ? await this.callHttp(device, tool, args)
        : await this.callDevice(device, tool, args);
    await this.prisma.hwDeviceEvent.create({
      data: {
        deviceId: device.id,
        kind: 'STATUS',
        direction: 'IN',
        commandCode: toolNameOf(model?.code ?? '', tool.code),
        payload: json({ args, source }),
        ok: result.ok,
        latencyMs: result.latencyMs,
        message: result.message.slice(0, 500),
      },
    });
    return result;
  }

  /** 站内试调：本人当场触发，不受「未授权」层拦；仍留一条流水。 */
  async toolTrial(
    userId: string,
    id: string,
    body: { deviceId: number; args?: Record<string, unknown> },
  ) {
    const toolId = positiveId(id, '工具');
    const row = await this.prisma.hwTool.findUnique({ where: { id: toolId } });
    if (!row || !row.enabled)
      throw new BusinessException(ErrorCode.NOT_FOUND, '工具不存在或已停用');
    if (row.scope === 'USER' && row.ownerUserId !== userId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能试调自己自建的工具',
      );
    }
    return this.execute({
      userId,
      tool: row,
      deviceId: body.deviceId,
      args: body.args ?? {},
      source: 'trial',
      dryRun: false,
    });
  }

  // ---------------------------------------------------------------- 后台管理

  async adminModels(): Promise<{ models: HwModel[] }> {
    const rows = await this.prisma.hwModel.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return { models: rows.map((row) => toModelDto(row)) };
  }

  async adminModelSave(userId: string, body: ModelSaveBody): Promise<HwModel> {
    const exists = await this.prisma.hwModel.findUnique({
      where: { code: body.code },
    });
    if (exists)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `型号编码 ${body.code} 已存在`,
      );
    const row = await this.prisma.hwModel.create({
      data: { ...this.modelData(body), createdBy: userId },
    });
    return toModelDto(row);
  }

  private modelData(body: ModelSaveBody) {
    return {
      code: body.code,
      name: body.name,
      vendor: body.vendor ?? '',
      chip: body.chip ?? '',
      category: body.category ?? '',
      summary: body.summary ?? '',
      coverUrl: body.coverUrl ?? '',
      spec: json(body.spec ?? {}),
      featured: body.featured ?? false,
      enabled: body.enabled ?? true,
      sortOrder: body.sortOrder ?? 0,
    };
  }

  async adminModelUpdate(
    id: string,
    body: Partial<ModelSaveBody>,
  ): Promise<HwModel> {
    const modelId = positiveId(id, '型号');
    const row = await this.prisma.hwModel.findUnique({
      where: { id: modelId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '型号不存在');
    if (body.code && body.code !== row.code) {
      const exists = await this.prisma.hwModel.findUnique({
        where: { code: body.code },
      });
      if (exists)
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `型号编码 ${body.code} 已存在`,
        );
    }
    const data: Record<string, unknown> = {};
    if (body.code !== undefined) data.code = body.code;
    if (body.name !== undefined) data.name = body.name;
    if (body.vendor !== undefined) data.vendor = body.vendor;
    if (body.chip !== undefined) data.chip = body.chip;
    if (body.category !== undefined) data.category = body.category;
    if (body.summary !== undefined) data.summary = body.summary;
    if (body.coverUrl !== undefined) data.coverUrl = body.coverUrl;
    if (body.spec !== undefined) data.spec = json(body.spec);
    if (body.featured !== undefined) data.featured = body.featured;
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    const updated = Object.keys(data).length
      ? await this.prisma.hwModel.update({ where: { id: modelId }, data })
      : row;
    return toModelDto(updated);
  }

  async adminModelRemove(id: string) {
    const modelId = positiveId(id, '型号');
    const devices = await this.prisma.hwDevice.count({ where: { modelId } });
    if (devices > 0)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该型号下还有已接入的设备，不能删除',
      );
    const tools = await this.prisma.hwTool.findMany({
      where: { modelId },
      select: { id: true },
    });
    await this.prisma.$transaction([
      this.prisma.hwToolGrant.deleteMany({
        where: { toolId: { in: tools.map((t) => t.id) } },
      }),
      this.prisma.hwTool.deleteMany({ where: { modelId } }),
      this.prisma.hwDevKit.deleteMany({ where: { modelId } }),
      this.prisma.hwModel.delete({ where: { id: modelId } }),
    ]);
    return { removed: true };
  }

  async adminKits(query: { modelId?: string }): Promise<{ kits: HwKit[] }> {
    const modelId = optionalId(query.modelId);
    const rows = await this.prisma.hwDevKit.findMany({
      where: modelId ? { modelId } : {},
      orderBy: [{ modelId: 'asc' }, { id: 'desc' }],
    });
    return { kits: rows.map(toKitDto) };
  }

  /** 开发包二进制直传本站 OSS：算 SHA-256 供页面校验，返回元数据由 kitSave 落库。 */
  async adminKitUpload(file: File) {
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!bytes.length)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '上传的文件为空');
    if (bytes.length > 200 * 1024 * 1024) {
      throw new BusinessException(
        ErrorCode.PAYLOAD_TOO_LARGE,
        '开发包不能超过 200MB',
      );
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const fileName = (file.name || 'kit.bin').split('/').pop()!.slice(0, 160);
    const result = await this.oss.upload(
      `hardware/kits/${randomUUID()}/${fileName}`,
      bytes,
    );
    return { fileName, fileSize: bytes.length, ossKey: result.key, sha256 };
  }

  async adminKitSave(userId: string, body: KitSaveBody): Promise<HwKit> {
    const model = await this.prisma.hwModel.findUnique({
      where: { id: body.modelId },
    });
    if (!model) throw new BusinessException(ErrorCode.NOT_FOUND, '型号不存在');
    const exists = await this.prisma.hwDevKit.findFirst({
      where: { modelId: body.modelId, version: body.version },
    });
    if (exists)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该型号下已存在这个版本号',
      );
    const row = await this.prisma.hwDevKit.create({
      data: {
        modelId: body.modelId,
        version: body.version,
        channel: body.channel ?? 'STABLE',
        fileName: body.fileName ?? '',
        fileSize: body.fileSize ?? 0,
        ossKey: body.ossKey ?? '',
        sha256: body.sha256 ?? '',
        changelog: body.changelog ?? '',
        docUrl: body.docUrl ?? '',
        minFirmware: body.minFirmware ?? '',
        enabled: body.enabled ?? true,
        createdBy: userId,
      },
    });
    return toKitDto(row);
  }

  async adminKitUpdate(id: string, body: Partial<KitSaveBody>): Promise<HwKit> {
    const kitId = positiveId(id, '开发包');
    const row = await this.prisma.hwDevKit.findUnique({ where: { id: kitId } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '开发包不存在');
    const data: Record<string, unknown> = {};
    if (body.version !== undefined) data.version = body.version;
    if (body.channel !== undefined) data.channel = body.channel;
    if (body.fileName !== undefined) data.fileName = body.fileName;
    if (body.fileSize !== undefined) data.fileSize = body.fileSize;
    if (body.ossKey !== undefined) data.ossKey = body.ossKey;
    if (body.sha256 !== undefined) data.sha256 = body.sha256;
    if (body.changelog !== undefined) data.changelog = body.changelog;
    if (body.docUrl !== undefined) data.docUrl = body.docUrl;
    if (body.minFirmware !== undefined) data.minFirmware = body.minFirmware;
    if (body.enabled !== undefined) data.enabled = body.enabled;
    const updated = Object.keys(data).length
      ? await this.prisma.hwDevKit.update({ where: { id: kitId }, data })
      : row;
    return toKitDto(updated);
  }

  async adminKitRemove(id: string) {
    const kitId = positiveId(id, '开发包');
    const row = await this.prisma.hwDevKit.findUnique({ where: { id: kitId } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '开发包不存在');
    await this.prisma.hwDevKit.delete({ where: { id: kitId } });
    return { removed: true };
  }

  async adminToolList(query: {
    modelId?: string;
    kind?: string;
  }): Promise<{ tools: HwTool[] }> {
    const modelId = optionalId(query.modelId);
    const kind = HW_TOOL_KINDS.find((item) => item === query.kind);
    const rows = await this.prisma.hwTool.findMany({
      where: { ...(modelId ? { modelId } : {}), ...(kind ? { kind } : {}) },
      orderBy: [{ modelId: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    });
    const models = await this.prisma.hwModel.findMany({
      select: { id: true, code: true },
    });
    const codeOf = (id: number) =>
      models.find((item) => item.id === id)?.code ?? '';
    return { tools: rows.map((row) => toToolDto(row, codeOf(row.modelId))) };
  }

  async adminToolSave(
    query: { modelId: string },
    body: ToolSaveBody,
  ): Promise<HwTool> {
    const modelId = positiveId(query.modelId, '型号');
    const model = await this.prisma.hwModel.findUnique({
      where: { id: modelId },
    });
    if (!model) throw new BusinessException(ErrorCode.NOT_FOUND, '型号不存在');
    await this.assertToolCodeFree(modelId, body.kind, 'DEFAULT', '', body.code);
    const row = await this.prisma.hwTool.create({
      data: {
        ...this.toolData(body),
        modelId,
        scope: 'DEFAULT',
        ownerUserId: '',
      },
    });
    return toToolDto(row, model.code);
  }

  async adminToolUpdate(
    id: string,
    body: Partial<ToolSaveBody>,
  ): Promise<HwTool> {
    const toolId = positiveId(id, '工具');
    const row = await this.prisma.hwTool.findUnique({ where: { id: toolId } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '工具不存在');
    const data: Record<string, unknown> = {};
    if (body.kind !== undefined) data.kind = body.kind;
    if (body.code !== undefined) data.code = body.code;
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.transport !== undefined) data.transport = body.transport;
    if (body.method !== undefined) data.method = body.method;
    if (body.path !== undefined) data.path = body.path;
    if (body.commandCode !== undefined) data.commandCode = body.commandCode;
    if (body.params !== undefined) data.params = json(body.params);
    if (body.response !== undefined) data.response = json(body.response);
    if (body.examples !== undefined) data.examples = json(body.examples);
    if (body.write !== undefined) data.write = body.write;
    if (body.requiresGrant !== undefined)
      data.requiresGrant = body.requiresGrant;
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    const updated = Object.keys(data).length
      ? await this.prisma.hwTool.update({ where: { id: toolId }, data })
      : row;
    const model = await this.prisma.hwModel.findUnique({
      where: { id: updated.modelId },
    });
    return toToolDto(updated, model?.code ?? '');
  }

  async adminToolRemove(id: string) {
    const toolId = positiveId(id, '工具');
    const row = await this.prisma.hwTool.findUnique({ where: { id: toolId } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '工具不存在');
    await this.prisma.$transaction([
      this.prisma.hwToolGrant.deleteMany({ where: { toolId } }),
      this.prisma.hwTool.delete({ where: { id: toolId } }),
    ]);
    return { removed: true };
  }

  // ---------------------------------------------------------------- 设备通道

  async deviceByToken(token: string): Promise<DevicePrincipal | null> {
    if (!token || !token.startsWith('hw_')) return null;
    const row = await this.prisma.hwDevice.findUnique({
      where: { tokenHash: hashDeviceToken(token) },
    });
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      modelId: row.modelId,
      name: row.name,
      enabled: row.enabled,
    };
  }

  /** 心跳：刷新在线状态与元数据（设备把自己的 HTTP 地址放在 meta.baseUrl），顺带把待办指令带回去。 */
  async heartbeat(
    device: DevicePrincipal,
    payload: Record<string, unknown>,
    ip: string,
  ) {
    const meta = asObject(payload.meta);
    let baseUrl = asString(meta.baseUrl, 500).trim();
    // 设备上报的地址可能是内网/不合法：校验不过就不落库，调用时再拒，避免把坏地址存进配置。
    if (baseUrl) {
      try {
        await assertOutboundUrl(baseUrl, '设备上报地址');
      } catch {
        baseUrl = '';
      }
    }
    const now = new Date();
    await this.prisma.hwDevice.update({
      where: { id: device.id },
      data: {
        status: 'ONLINE',
        lastSeenAt: now,
        lastIp: ip.slice(0, 64),
        firmwareVersion: asString(payload.firmwareVersion, 40),
        meta: json({ ...meta, ...(baseUrl ? { baseUrl } : {}) }),
      },
    });
    await this.prisma.hwDeviceEvent.create({
      data: {
        deviceId: device.id,
        kind: 'HEARTBEAT',
        direction: 'IN',
        commandCode: '',
        payload: json(payload),
        ok: true,
        latencyMs: 0,
        message: '',
      },
    });
    return { received: true, commands: await this.pendingCommands(device) };
  }

  /** 设备主动拉取待办指令（与心跳返回的 commands 等价）。 */
  pollCommands(device: DevicePrincipal) {
    return this.pendingCommands(device);
  }

  /** 设备拉取待办指令：取「已下发」的，标记为「已投递」，避免重复下发。 */
  private async pendingCommands(device: DevicePrincipal) {
    const rows = await this.prisma.hwDeviceEvent.findMany({
      where: {
        deviceId: device.id,
        kind: 'COMMAND',
        direction: 'OUT',
        message: '已下发',
      },
      orderBy: { id: 'asc' },
      take: 10,
    });
    if (rows.length) {
      await this.prisma.hwDeviceEvent.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: { message: '已投递' },
      });
    }
    return rows.map((row) => {
      const payload = asObject(row.payload);
      return {
        eventId: row.id,
        // 唯一命令号：设备回执时必须原样带回，平台据此匹配这次下发（不能用工具指令码，它会重复）。
        commandCode: row.commandCode,
        // 工具声明的指令码：设备按它决定执行哪个动作。
        toolCommandCode: asString(payload.commandCode, 120),
        args: asObject(payload.args),
      };
    });
  }

  /** 设备回执：按 commandCode 找回下发的那条，写结果并更新下发流水的成败与耗时。 */
  async deviceResult(
    device: DevicePrincipal,
    payload: Record<string, unknown>,
  ) {
    const commandCode = asString(payload.commandCode, 120);
    if (!commandCode)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '回执缺少 commandCode',
      );
    const command = await this.prisma.hwDeviceEvent.findFirst({
      where: { deviceId: device.id, kind: 'COMMAND', commandCode },
    });
    if (!command)
      throw new BusinessException(ErrorCode.NOT_FOUND, '没有匹配的下发指令');
    const ok = payload.ok !== false;
    const latencyMs = command.createdAt
      ? Date.now() - command.createdAt.getTime()
      : 0;
    await this.prisma.$transaction([
      this.prisma.hwDeviceEvent.update({
        where: { id: command.id },
        data: {
          ok,
          latencyMs,
          message: ok
            ? '已回执'
            : asString(payload.message, 200) || '设备执行失败',
        },
      }),
      this.prisma.hwDeviceEvent.create({
        data: {
          deviceId: device.id,
          kind: 'RESULT',
          direction: 'IN',
          commandCode,
          payload: json(payload),
          ok,
          latencyMs,
          message: asString(payload.message, 200),
        },
      }),
    ]);
    return { received: true };
  }

  /** 频控：每设备每分钟指令上限，防止把设备打挂。 */
  async assertCommandRate(deviceId: number) {
    const since = new Date(Date.now() - 60_000);
    const count = await this.prisma.hwDeviceEvent.count({
      where: {
        deviceId,
        kind: 'COMMAND',
        direction: 'OUT',
        createdAt: { gte: since },
      },
    });
    if (count >= HW_COMMANDS_PER_MINUTE) {
      throw new BusinessException(
        ErrorCode.RATE_LIMITED,
        `该设备每分钟指令已达上限（${HW_COMMANDS_PER_MINUTE} 条）`,
      );
    }
  }

  // ---------------------------------------------------------------- 机器通道 / MCP

  /** 机器通道与 MCP 共用的工具清单：本人可见（型号默认 + 本人自建）。 */
  async listVisibleTools(
    userId: string,
    modelCode?: string,
  ): Promise<{ tool: ToolRow; modelCode: string }[]> {
    const models = await this.prisma.hwModel.findMany({
      where: { enabled: true, ...(modelCode ? { code: modelCode } : {}) },
      select: { id: true, code: true },
    });
    if (!models.length) return [];
    const rows = await this.prisma.hwTool.findMany({
      where: {
        enabled: true,
        modelId: { in: models.map((model) => model.id) },
        OR: [{ scope: 'DEFAULT' }, { scope: 'USER', ownerUserId: userId }],
      },
      orderBy: [{ modelId: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    });
    const codeOf = (id: number) =>
      models.find((model) => model.id === id)?.code ?? '';
    return rows.map((row) => ({ tool: row, modelCode: codeOf(row.modelId) }));
  }

  /** 按 `hw__<model>__<tool>` 找工具；找不到或不可见都返回 null，由调用方统一报错。 */
  async findToolByName(userId: string, name: string) {
    const parsed = parseToolName(name);
    if (!parsed) return null;
    const model = await this.prisma.hwModel.findFirst({
      where: { code: parsed.modelCode, enabled: true },
    });
    if (!model) return null;
    const row = await this.prisma.hwTool.findFirst({
      where: { ...this.visibleWhere(userId, model.id), code: parsed.toolCode },
    });
    return row ? { tool: row, model } : null;
  }

  /** 机器通道 / Agent 调用：写动作过三层闸，读动作直接执行。 */
  async callByName(input: {
    userId: string;
    name: string;
    args: Record<string, unknown>;
    deviceId?: number;
    source: ToolCallSource;
    dryRun?: boolean;
  }): Promise<HwToolCallResult> {
    const found = await this.findToolByName(input.userId, input.name);
    if (!found) {
      return {
        ok: false,
        status: 0,
        latencyMs: 0,
        response: null,
        message: `工具执行失败：没有名为 ${input.name} 的硬件工具，或该工具对当前账号不可见`,
        reason: 'TOOL_NOT_FOUND',
      };
    }
    return this.execute({
      userId: input.userId,
      tool: found.tool,
      deviceId: input.deviceId,
      args: input.args,
      source: input.source,
      dryRun: input.dryRun === true,
    });
  }

  /** MCP tools/list：三个元工具 + 本人可见的全部 hw__ 工具（按型号动态出）。 */
  async mcpDescriptors(userId: string): Promise<HardwareMcpTool[]> {
    const meta: HardwareMcpTool[] = [
      {
        name: 'list_hardware_models',
        title: '列出硬件型号',
        description:
          '列出已上架的智能硬件型号（含开发包数量），用于确定要操作哪一类设备。',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'list_hardware_tools',
        title: '列出型号工具',
        description:
          '列出某型号对当前账号可见的工具（型号默认 + 本人自建），含读写标注与授权状态。',
        inputSchema: {
          type: 'object',
          properties: {
            modelCode: { type: 'string', description: '型号编码' },
          },
          required: ['modelCode'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'call_hardware_tool',
        title: '调用硬件工具',
        description:
          '按 hw__<型号>__<工具> 调用硬件工具；写动作未授权或无人值守时只返回草案。',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: '工具名 hw__<型号编码>__<工具编码>',
            },
            deviceId: {
              type: 'number',
              description: '目标设备编号，缺省取最近在线的一台',
            },
            args: { type: 'object', description: '工具参数' },
            dryRun: { type: 'boolean', description: '只出草案不执行' },
          },
          required: ['name'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
      },
    ];
    const visible = await this.listVisibleTools(userId);
    const granted = await this.grantedToolIds(userId);
    const dynamic = visible.map(({ tool, modelCode }) => ({
      name: toolNameOf(modelCode, tool.code),
      title: tool.name,
      description: `${tool.description || tool.name}（${tool.transport === 'HTTP' ? '设备直连' : '指令下发'}${tool.write ? '，写动作' : '，只读'}${tool.write && !granted.has(tool.id) ? '，未授权' : ''}）`,
      inputSchema: inputSchemaOf(asObject(tool.params)),
      annotations: { readOnlyHint: !tool.write, destructiveHint: tool.write },
    }));
    return [...meta, ...dynamic];
  }

  async mcpCall(
    userId: string,
    name: string,
    args: unknown,
  ): Promise<HardwareMcpResult> {
    const input = asObject(args);
    if (name === 'list_hardware_models') {
      const models = await this.plazaModels(userId, {});
      return ok({
        ok: true,
        models: models.models.map((model) => ({
          code: model.code,
          name: model.name,
          kitCount: model.kitCount,
        })),
      });
    }
    if (name === 'list_hardware_tools') {
      const modelCode = asString(input.modelCode, 48);
      if (!modelCode) return fail('缺少 modelCode');
      const rows = await this.listVisibleTools(userId, modelCode);
      if (!rows.length) return fail(`型号 ${modelCode} 未上架或没有可见工具`);
      const granted = await this.grantedToolIds(userId);
      return ok({
        ok: true,
        modelCode,
        tools: rows.map(({ tool }) => ({
          name: toolNameOf(modelCode, tool.code),
          title: tool.name,
          description: tool.description,
          write: tool.write,
          granted: !tool.write || granted.has(tool.id),
          inputSchema: inputSchemaOf(asObject(tool.params)),
        })),
      });
    }
    if (name === 'call_hardware_tool') {
      const toolName = asString(input.name, 160);
      if (!toolName) return fail('缺少工具名 name');
      const result = await this.callByName({
        userId,
        name: toolName,
        args: asObject(input.args),
        deviceId: optionalId(input.deviceId),
        source: 'agent',
        dryRun: input.dryRun === true,
      });
      if (!result.ok) return fail(`工具执行失败：${result.message}`);
      return ok({
        ok: true,
        executed: true,
        name: toolName,
        response: result.response,
        latencyMs: result.latencyMs,
      });
    }
    // 直接以 hw__ 工具名调用：等价于 call_hardware_tool，方便客户端把每个工具当独立工具用。
    if (parseToolName(name)) {
      const result = await this.callByName({
        userId,
        name,
        args: input,
        source: 'agent',
        dryRun: false,
      });
      if (!result.ok) return fail(`工具执行失败：${result.message}`);
      return ok({
        ok: true,
        executed: true,
        name,
        response: result.response,
        latencyMs: result.latencyMs,
      });
    }
    return fail(`没有名为 ${name} 的硬件工具`);
  }
}

/** 事件类型白名单（查询过滤用）；与契约枚举同源。 */
const HW_KINDS = ['HEARTBEAT', 'COMMAND', 'RESULT', 'STATUS'];
