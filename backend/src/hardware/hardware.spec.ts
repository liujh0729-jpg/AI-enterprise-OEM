import { HW_OFFLINE_AFTER_SECONDS } from '@enterprise/contracts';
import { runWithAgentScope } from '../content/agent-scope';
import { BusinessException } from '../common/business.exception';
import type { OssService } from '../oss/oss.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  asObject,
  asString,
  hashDeviceToken,
  newDeviceToken,
  optionalId,
  parseToolName,
  positiveId,
  toolNameOf,
} from './hardware.helpers';
import {
  deviceStatusOf,
  HardwareService,
  type DevicePrincipal,
} from './hardware.service';
import { stub } from '../../test/doubles';

/**
 * 智能硬件：纯函数与设备通道的关键不变量。
 * 重点覆盖「唯一命令号 vs 工具指令码」这条——回执匹配全靠它，一旦被 payload 覆盖整条下发链就废。
 */

const fn = () => jest.fn();

function makeService(prisma: unknown) {
  return new HardwareService(prisma as PrismaService, stub<OssService>({}));
}

const principal: DevicePrincipal = {
  id: 9,
  userId: 'u1',
  modelId: 3,
  name: '车间网关',
  enabled: true,
};

const toolRow = {
  id: 42,
  modelId: 3,
  kind: 'MCP',
  scope: 'DEFAULT',
  ownerUserId: '',
  code: 'READ_TEMP',
  name: '读温度',
  description: '',
  transport: 'DEVICE',
  method: 'POST',
  path: '',
  commandCode: 'READ_TEMP',
  params: {},
  response: {},
  examples: [],
  write: true,
  requiresGrant: true,
  enabled: true,
  sortOrder: 0,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  updatedAt: new Date('2026-11-01T00:00:00Z'),
};

describe('硬件 helpers', () => {
  it('令牌哈希稳定且等于 SHA-256 十六进制', () => {
    const token = 'hw_abc123';
    expect(hashDeviceToken(token)).toBe(hashDeviceToken(token));
    expect(hashDeviceToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('新令牌：hw_ 前缀 + 40 位十六进制，只带哈希与短前缀', () => {
    const first = newDeviceToken();
    const second = newDeviceToken();
    expect(first.token).toMatch(/^hw_[0-9a-f]{40}$/);
    expect(first.tokenHash).toBe(hashDeviceToken(first.token));
    expect(first.tokenPrefix).toBe(first.token.slice(0, 11));
    expect(first.token).not.toBe(second.token);
  });

  it('工具名编解码可往返', () => {
    const name = toolNameOf('esp32', 'read_temp');
    expect(name).toBe('hw__esp32__read_temp');
    expect(parseToolName(name)).toEqual({
      modelCode: 'esp32',
      toolCode: 'read_temp',
    });
  });

  it('非硬件工具名一律解析为 null', () => {
    expect(parseToolName('other')).toBeNull();
    expect(parseToolName('hw__')).toBeNull();
    expect(parseToolName('hw')).toBeNull();
  });

  it('可选编号：空串/非法/非正数视作不过滤', () => {
    expect(optionalId('')).toBeUndefined();
    expect(optionalId(undefined)).toBeUndefined();
    expect(optionalId('abc')).toBeUndefined();
    expect(optionalId('0')).toBeUndefined();
    expect(optionalId('-3')).toBeUndefined();
    expect(optionalId('7')).toBe(7);
  });

  it('必填编号非法时抛 BAD_REQUEST', () => {
    expect(positiveId('7', '工具')).toBe(7);
    for (const bad of ['0', 'abc', '-1', '1.5']) {
      let error: unknown;
      try {
        positiveId(bad, '工具');
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(BusinessException);
      expect((error as BusinessException).getStatus()).toBe(400);
    }
  });

  it('Json 归一：非对象/数组一律空对象，字符串裁剪到上限', () => {
    expect(asObject(null)).toEqual({});
    expect(asObject([1, 2])).toEqual({});
    expect(asObject({ a: 1 })).toEqual({ a: 1 });
    expect(asString('abcdef', 3)).toBe('abc');
    expect(asString(12)).toBe('12');
    expect(asString({})).toBe('');
  });
});

describe('设备在线判定', () => {
  it('从未上报＝NEVER，近期＝ONLINE，超时＝OFFLINE', () => {
    expect(deviceStatusOf({ lastSeenAt: null })).toBe('NEVER');
    expect(deviceStatusOf({ lastSeenAt: new Date() })).toBe('ONLINE');
    expect(
      deviceStatusOf({
        lastSeenAt: new Date(
          Date.now() - (HW_OFFLINE_AFTER_SECONDS + 5) * 1000,
        ),
      }),
    ).toBe('OFFLINE');
  });
});

describe('设备令牌换取身份', () => {
  it('非 hw_ 前缀直接拒绝，不查库', async () => {
    const prisma = { hwDevice: { findUnique: fn() } };
    const service = makeService(prisma);
    expect(await service.deviceByToken('ek_whatever')).toBeNull();
    expect(prisma.hwDevice.findUnique).not.toHaveBeenCalled();
  });

  it('按哈希查库并返回归属信息', async () => {
    const token = 'hw_' + 'a'.repeat(40);
    const prisma = {
      hwDevice: {
        findUnique: fn().mockResolvedValue({
          id: 9,
          userId: 'u1',
          modelId: 3,
          name: '车间网关',
          enabled: false,
        }),
      },
    };
    const service = makeService(prisma);
    const found = await service.deviceByToken(token);
    expect(prisma.hwDevice.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashDeviceToken(token) },
    });
    expect(found).toEqual({
      id: 9,
      userId: 'u1',
      modelId: 3,
      name: '车间网关',
      enabled: false,
    });
  });
});

describe('指令下发与回执匹配', () => {
  it('拉取指令时：唯一命令号原样返回，工具指令码单独给出（不能被 payload 覆盖）', async () => {
    const rows = [
      {
        id: 11,
        commandCode: 'READ_TEMP__a1b2c3d4',
        payload: { commandCode: 'READ_TEMP', args: { pin: 2 } },
      },
      {
        id: 12,
        commandCode: 'SET_LED__f9e8d7c6',
        payload: { commandCode: 'SET_LED', args: { on: true } },
      },
    ];
    const prisma = {
      hwDeviceEvent: {
        findMany: fn().mockResolvedValue(rows),
        updateMany: fn().mockResolvedValue({ count: 2 }),
      },
    };
    const service = makeService(prisma);

    const out = await service.pollCommands(principal);

    expect(out).toEqual([
      {
        eventId: 11,
        commandCode: 'READ_TEMP__a1b2c3d4',
        toolCommandCode: 'READ_TEMP',
        args: { pin: 2 },
      },
      {
        eventId: 12,
        commandCode: 'SET_LED__f9e8d7c6',
        toolCommandCode: 'SET_LED',
        args: { on: true },
      },
    ]);
    // 回归：唯一命令号必须与工具指令码不同，否则回执永远匹配不上。
    expect(out[0].commandCode).not.toBe(out[0].toolCommandCode);
    // 拉过一次即标记「已投递」，避免重复下发。
    expect(prisma.hwDeviceEvent.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [11, 12] } },
      data: { message: '已投递' },
    });
  });

  it('拉取指令：无待办时不写库', async () => {
    const prisma = {
      hwDeviceEvent: { findMany: fn().mockResolvedValue([]), updateMany: fn() },
    };
    const service = makeService(prisma);
    expect(await service.pollCommands(principal)).toEqual([]);
    expect(prisma.hwDeviceEvent.updateMany).not.toHaveBeenCalled();
  });

  it('回执缺 commandCode 抛 BAD_REQUEST', async () => {
    const prisma = { hwDeviceEvent: { findFirst: fn() } };
    const service = makeService(prisma);
    await expect(
      service.deviceResult(principal, { ok: true }),
    ).rejects.toMatchObject({ errorCode: { httpStatus: 400 } });
    expect(prisma.hwDeviceEvent.findFirst).not.toHaveBeenCalled();
  });

  it('回执匹配不到下发指令抛 NOT_FOUND', async () => {
    const prisma = {
      hwDeviceEvent: { findFirst: fn().mockResolvedValue(null) },
    };
    const service = makeService(prisma);
    await expect(
      service.deviceResult(principal, { commandCode: 'X__1' }),
    ).rejects.toMatchObject({
      errorCode: { httpStatus: 404 },
    });
  });

  it('回执成功：更新下发流水为已回执并落一条 RESULT', async () => {
    const command = { id: 11, createdAt: new Date(Date.now() - 400) };
    const prisma = {
      hwDeviceEvent: {
        findFirst: fn().mockResolvedValue(command),
        update: fn().mockResolvedValue({}),
        create: fn().mockResolvedValue({}),
      },
      $transaction: fn().mockImplementation(async (ops: Promise<unknown>[]) =>
        Promise.all(ops),
      ),
    };
    const service = makeService(prisma);

    await expect(
      service.deviceResult(principal, {
        commandCode: 'READ_TEMP__a1b2c3d4',
        response: { temp: 21 },
      }),
    ).resolves.toEqual({
      received: true,
    });

    expect(prisma.hwDeviceEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 11 },
        data: expect.objectContaining({ ok: true, message: '已回执' }),
      }),
    );
    expect(prisma.hwDeviceEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'RESULT',
          commandCode: 'READ_TEMP__a1b2c3d4',
          ok: true,
        }),
      }),
    );
  });

  it('回执失败：ok=false 且带消息时按下发失败留痕', async () => {
    const prisma = {
      hwDeviceEvent: {
        findFirst: fn().mockResolvedValue({ id: 11, createdAt: new Date() }),
        update: fn().mockResolvedValue({}),
        create: fn().mockResolvedValue({}),
      },
      $transaction: fn().mockImplementation(async (ops: Promise<unknown>[]) =>
        Promise.all(ops),
      ),
    };
    const service = makeService(prisma);
    await service.deviceResult(principal, {
      commandCode: 'X__1',
      ok: false,
      message: '传感器无响应',
    });
    expect(prisma.hwDeviceEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ok: false, message: '传感器无响应' }),
      }),
    );
  });
});

describe('工具执行三层闸', () => {
  const gate = (
    service: HardwareService,
    input: {
      source: 'trial' | 'machine' | 'agent';
      dryRun: boolean;
      tool?: Partial<typeof toolRow>;
    },
  ) =>
    stub<{
      toolGate: (value: unknown) => Promise<{ code: string } | null>;
    }>(service).toolGate({
      userId: 'u1',
      tool: { ...toolRow, ...input.tool },
      source: input.source,
      args: {},
      dryRun: input.dryRun,
    });

  it('dryRun 一律只出草案，不真正下发', async () => {
    const service = makeService({});
    expect(
      await gate(service, { source: 'machine', dryRun: true }),
    ).toMatchObject({ code: 'DRY_RUN' });
  });

  it('无人值守定时任务：写工具只出草案', async () => {
    const service = makeService({});
    const result = await runWithAgentScope(
      {
        connectorIds: [],
        mailboxIds: [],
        trigger: 'schedule',
        allowWrite: false,
      },
      () => gate(service, { source: 'agent', dryRun: false }),
    );
    expect(result).toMatchObject({ code: 'SCHEDULE_DENIED' });
  });

  it('机器通道写工具未授权只出草案', async () => {
    const prisma = { hwToolGrant: { findMany: fn().mockResolvedValue([]) } };
    const service = makeService(prisma);
    expect(
      await gate(service, { source: 'machine', dryRun: false }),
    ).toMatchObject({ code: 'NOT_GRANTED' });
  });

  it('机器通道写工具已授权放行', async () => {
    const prisma = {
      hwToolGrant: { findMany: fn().mockResolvedValue([{ toolId: 42 }]) },
    };
    const service = makeService(prisma);
    expect(
      await gate(service, { source: 'machine', dryRun: false }),
    ).toBeNull();
  });

  it('站内试调不受授权层拦（授权前要能自测）', async () => {
    const prisma = { hwToolGrant: { findMany: fn() } };
    const service = makeService(prisma);
    expect(await gate(service, { source: 'trial', dryRun: false })).toBeNull();
    expect(prisma.hwToolGrant.findMany).not.toHaveBeenCalled();
  });

  it('只读工具不需要授权', async () => {
    const prisma = { hwToolGrant: { findMany: fn() } };
    const service = makeService(prisma);
    expect(
      await gate(service, {
        source: 'machine',
        dryRun: false,
        tool: { write: false },
      }),
    ).toBeNull();
    expect(prisma.hwToolGrant.findMany).not.toHaveBeenCalled();
  });
});

describe('站内试调的归属限制', () => {
  it('不能试调他人自建工具', async () => {
    const prisma = {
      hwTool: {
        findUnique: fn().mockResolvedValue({
          ...toolRow,
          scope: 'USER',
          ownerUserId: 'other',
        }),
      },
    };
    const service = makeService(prisma);
    await expect(
      service.toolTrial('u1', '42', { deviceId: 9 }),
    ).rejects.toMatchObject({
      errorCode: { httpStatus: 403 },
    });
  });
});
