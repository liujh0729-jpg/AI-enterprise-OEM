import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { MCP_TOOL_NAMES, RC_DEVICE_TOKEN_HEADER } from '@enterprise/contracts';
import type { ApiEnv } from '../http/types';
import type { Services } from '../http/services';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { findOperation } from '../mcp/mcp-catalog';
import type { McpService } from '../mcp/mcp.service';
import { toJsonObject } from '../shared/json-value';
import type { ChromeDevicePrincipal } from './chrome-device.service';

/**
 * 本地 Chrome 插件的设备通道：`/api/public/rpa-chrome/**`，挂在根 app 上（与硬件设备通道同一套），
 * 免登录、不进功能开关，只认设备令牌 `x-chrome-token: rc_...`。插件不能用它调任何业务接口。
 *
 * 目标平台的口令永不出现在这里（D3-A）：插件在自己浏览器里登录目标平台，本通道只传「动作指令」与「页面观测」。
 * 应答形状刻意保持极简（{ ok, ... }），与硬件设备通道一致，方便插件侧轻量解析。
 */

function clientIp(c: Context<ApiEnv>): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return c.req.header('x-real-ip') || '';
}

function denied(message: string) {
  return { ok: false, message } as Record<string, unknown>;
}

/** 请求体里的对象参数：不是对象一律当空表（与 MCP 的宽松口径一致）。 */
function bag(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function registerRpaChromePublic(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
  mcp: McpService,
) {
  const devices = services.rpaChrome.device;

  const authenticate = async (
    c: Context<ApiEnv>,
  ): Promise<ChromeDevicePrincipal | Response> => {
    const token = c.req.header(RC_DEVICE_TOKEN_HEADER) || '';
    const device = await devices.deviceByToken(token);
    if (!device) {
      return c.json(
        denied('设备令牌无效或已失效，请在插件里重新登录本系统'),
        401,
      );
    }
    return device;
  };

  const handle = async (
    c: Context<ApiEnv>,
    run: (
      device: ChromeDevicePrincipal,
      body: Record<string, unknown>,
    ) => Promise<object>,
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
      return c.json({ ok: true, ...data });
    } catch (error) {
      if (error instanceof BusinessException) {
        return c.json(denied(error.message), error.getStatus());
      }
      return c.json(denied('设备通道处理失败'), 500);
    }
  };

  // 登录：用本站账号换设备令牌。目标平台口令不经过这里。
  app.post('/api/public/rpa-chrome/login', async (c) => {
    const parsed = await c.req
      .json<Record<string, unknown>>()
      .catch((): Record<string, unknown> => ({}));
    const body: Record<string, unknown> =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {};
    try {
      const data = await devices.login(
        body,
        clientIp(c),
        c.req.header('user-agent') || '',
      );
      return c.json({ ok: true, ...data });
    } catch (error) {
      if (error instanceof BusinessException) {
        return c.json(denied(error.message), error.getStatus());
      }
      return c.json(denied('登录失败，请稍后重试'), 500);
    }
  });

  // 心跳：刷新在线状态，顺带领取待执行指令与待确认动作。
  app.post('/api/public/rpa-chrome/heartbeat', (c) =>
    handle(c, (device, body) => devices.touch(device, body, clientIp(c))),
  );

  // 单条动作回执：按 commandCode 幂等。
  app.post('/api/public/rpa-chrome/result', (c) =>
    handle(c, (device, body) => devices.report(device, body)),
  );

  // 敏感动作确认：本人在插件弹窗点「允许本次 / 拒绝」。
  app.post('/api/public/rpa-chrome/confirm', (c) =>
    handle(c, (device, body) => devices.confirm(device, body)),
  );

  // 插件侧主动停止（停止按钮）：把会话与在途指令置为已取消。
  app.post('/api/public/rpa-chrome/stop', (c) =>
    handle(c, (device, body) => devices.stopFromPlugin(device, body)),
  );

  // 退出登录：清令牌，设备转为离线。
  app.post('/api/public/rpa-chrome/logout', (c) =>
    handle(c, (device) => devices.logout(device)),
  );

  // 侧边栏 Agent 引导：可用的模型（本系统模型广场）+ 额度 + 安全设置。
  app.post('/api/public/rpa-chrome/bootstrap', (c) =>
    handle(c, async (device) => {
      const user = await devices.currentUser(device);
      const [catalog, settings] = await Promise.all([
        services.rpaChrome.catalog.userCatalog(user),
        devices.settingsOf(device.userId),
      ]);
      return {
        models: catalog.list
          .filter((item) => item.available)
          .map((item) => ({
            key: item.modelKey,
            label: item.displayName,
            modelKey: item.modelKey,
          })),
        balance: catalog.balance,
        rate: catalog.rate,
        defaultModelKey: '',
        limits: {
          maxSteps: settings.maxSteps,
          stepTimeoutSeconds: settings.stepTimeoutSeconds,
          sessionTimeoutSeconds: settings.sessionTimeoutSeconds,
          blockedHosts: settings.blockedHosts,
          confirmSensitive: settings.confirmSensitive,
        },
      };
    }),
  );

  // 侧边栏 Agent 的一步决策：插件把「目标 + 页面观测 + 历史」发来，平台调一次 LLM 回一个闭集动作 / 平台工具。
  app.post('/api/public/rpa-chrome/decide', (c) =>
    handle(c, async (device, body) => {
      // 本账号已共享的工作流（wf__<id>）也进可调用工具面：以本人身份按发布版本运行。
      const user = await devices.currentUser(device);
      const [workflows, skills] = await Promise.all([
        services.workflow.toolSpecs(user).catch(() => []),
        services.rpaChrome.library.promptSkills(user).catch(() => []),
      ]);
      // 用户沉淀的技能作为长期知识进提示词：让 Agent 按既有偏好与站点套路办事。
      return services.rpaChrome.agent.decideForDevice(
        device,
        body,
        workflows,
        skills,
      );
    }),
  );

  // 「增强提示」：把一句话目标改写成更清晰的可执行目标（走本系统模型）。
  app.post('/api/public/rpa-chrome/enhance', (c) =>
    handle(c, (device, body) =>
      services.rpaChrome.agent.enhanceForDevice(device, body),
    ),
  );

  // 附件直传：把侧边栏选中的文件存进本账号数字资产，返回对象键供 Agent 引用。
  app.post('/api/public/rpa-chrome/upload', (c) =>
    handle(c, (device, body) =>
      services.rpaChrome.agent.uploadForDevice(device, body),
    ),
  );

  /**
   * 插件侧边栏 Agent 的平台工具网关：与站内 Agent / MCP 同一张契约目录。
   * · `RpaChrome_*`：侧边栏自己的台账与库（会话/消息/技能/录制/抽取），按设备令牌直连内部执行器，不过 MCP 勾选闸；
   * · 契约 operationId：按其读写自动走 read_data / write_data（写动作未授权只回草案）；
   * · MCP 元工具（list_operations 等）：原样透传，供 Agent 自行发现目录；
   * · `wf__<id>`：本账号已共享的工作流，以本人身份按发布版本同步跑完。
   * 目标平台的口令仍不经此通道（D3-A）；这里只回结构化结果。
   */
  app.post('/api/public/rpa-chrome/tool', (c) =>
    handle(c, async (device, body) => {
      const name = text(body.tool).trim().slice(0, 120);
      if (!name) {
        return {
          tool: '',
          ok: false,
          data: {},
          errorMessage: '缺少工具名（tool）',
          needsGrant: false,
          elapsedMs: 0,
        };
      }
      const args = toJsonObject(body.args);
      const started = Date.now();
      const requestId = `chrome:${device.clientId}:${Date.now().toString(36)}`;
      const user = await devices.currentUser(device);

      if (name.startsWith('wf__')) {
        const result = await services.workflow.runAsTool(user, name, args);
        return {
          tool: name,
          ok: true,
          data: { text: result.text },
          errorMessage: '',
          needsGrant: false,
          elapsedMs: Date.now() - started,
        };
      }

      // 侧边栏自己的台账/库：直连内部执行器（同一条路由、同一份校验），不套授权闸。
      if (name.startsWith('RpaChrome_') && findOperation(name)) {
        const result = await mcp.runOperation(user, requestId, name, {
          pathParams: bag(args['pathParams']) as Record<
            string,
            string | number
          >,
          query: bag(args['query']),
          body: bag(args['body']),
        });
        const succeeded = result.code === undefined || result.code === 0;
        return {
          tool: name,
          ok: succeeded,
          data: toJsonObject(result.data),
          errorMessage: succeeded ? '' : result.message,
          needsGrant: false,
          elapsedMs: Date.now() - started,
        };
      }

      const call = services.builtinMcp.current;
      const row = findOperation(name);
      const isMeta = (MCP_TOOL_NAMES as readonly string[]).includes(name);
      const toolName = isMeta
        ? name
        : row
          ? row.write
            ? 'write_data'
            : 'read_data'
          : '';
      if (!call || !toolName) {
        return {
          tool: name,
          ok: false,
          data: {},
          errorMessage: `没有名为 ${name} 的工具，或该工具不对插件开放`,
          needsGrant: false,
          elapsedMs: Date.now() - started,
        };
      }
      const payload = isMeta ? args : { operationId: name, ...args };
      const result = await call(user, requestId, toolName, payload);
      const data = result.structuredContent;
      return {
        tool: name,
        ok: !result.isError,
        data,
        errorMessage: result.isError ? text(data['message']) : '',
        needsGrant: data['needsGrant'] === true,
        elapsedMs: Date.now() - started,
      };
    }),
  );
}
