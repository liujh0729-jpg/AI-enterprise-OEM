import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { HW_DEVICE_TOKEN_HEADER } from '@enterprise/contracts';
import type { ApiEnv } from '../http/types';
import type { Services } from '../http/services';
import { BusinessException } from '../common/business.exception';
import type { DevicePrincipal } from './hardware.service';

/**
 * 设备通道：`/api/public/hardware/**`，挂在根 app 上（与问卷/活码公开通道同一套），
 * 只认设备令牌 `x-device-token: hw_...`，不走登录会话、也不能调任何业务接口。
 * 刻意不进功能开关拦截：管理员关掉「智能硬件」板块时，已接入设备的心跳不能被掐死。
 *
 * 应答形状刻意保持极简（{ ok, ... }），方便 ESP32 / Jetson 上的轻量客户端解析，
 * 不套站内统一的 code/message/data 信封。
 */

function clientIp(c: Context<ApiEnv>): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return c.req.header('x-real-ip') || '';
}

function unauthorized(message: string) {
  return { ok: false, message };
}

export function registerHardwarePublic(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  const hardware = services.hardware;

  const authenticate = async (
    c: Context<ApiEnv>,
  ): Promise<DevicePrincipal | Response> => {
    const token = c.req.header(HW_DEVICE_TOKEN_HEADER) || '';
    const device = await hardware.deviceByToken(token);
    if (!device) return c.json(unauthorized('设备令牌无效'), 401);
    if (!device.enabled) return c.json(unauthorized('设备已停用'), 403);
    return device;
  };

  const handle = async (
    c: Context<ApiEnv>,
    run: (
      device: DevicePrincipal,
      body: Record<string, unknown>,
    ) => Promise<unknown>,
  ) => {
    const device = await authenticate(c);
    if (device instanceof Response) return device;
    let body: Record<string, unknown> = {};
    if (c.req.method === 'POST') {
      body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
      if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
    }
    try {
      const data = await run(device, body);
      return c.json({ ok: true, ...(data as Record<string, unknown>) });
    } catch (error) {
      if (error instanceof BusinessException) {
        return c.json(unauthorized(error.message), error.getStatus());
      }
      return c.json(unauthorized('设备通道处理失败'), 500);
    }
  };

  // 心跳：刷新在线状态，顺带把待办指令带回去（设备不必再单独轮询）。
  app.post('/api/public/hardware/heartbeat', (c) =>
    handle(c, (device, body) => hardware.heartbeat(device, body, clientIp(c))),
  );

  // 主动拉取待办指令（与心跳返回的 commands 等价，给不带心跳回执的客户端用）。
  app.get('/api/public/hardware/commands', (c) =>
    handle(c, async (device) => ({
      commands: await hardware.pollCommands(device),
    })),
  );

  // 设备回执：按 commandCode 匹配下发指令，写结果。
  app.post('/api/public/hardware/result', (c) =>
    handle(c, (device, body) => hardware.deviceResult(device, body)),
  );
}
