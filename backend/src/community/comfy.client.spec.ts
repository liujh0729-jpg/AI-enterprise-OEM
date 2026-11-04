import {
  ComfyClient,
  MAX_DOWNLOAD_BYTES,
  scanTopLevelKeys,
} from './comfy.client';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { TransportError, httpRequest } from '../http/transport';
import { assertOutboundUrl } from '../http/outbound-guard';

/**
 * Comfy Cloud 客户端的单测：把「上游错误码 → 中文可执行提示」「下载主机白名单」「字节上限」
 * 「Key 只在头里出现」这几条口径钉住——它们都是运行链路上最容易因为改上游接口而静默坏掉的地方。
 */
jest.mock('../http/transport', () => ({
  // requireActual 不收泛型参数时返 any，直接把整个 mock 工厂的返回值也带成 any
  ...jest.requireActual<Record<string, unknown>>('../http/transport'),
  httpRequest: jest.fn(),
}));
// 出站守卫本身有单测；这里只关心「有没有被调用」，不让它真去做 DNS 解析
jest.mock('../http/outbound-guard', () => ({
  assertOutboundUrl: jest.fn().mockResolvedValue(undefined),
  assertOutboundUrlSync: (value: string) => new URL(value),
}));

const mockedHttp = httpRequest as unknown as jest.Mock;
const mockedGuard = assertOutboundUrl as unknown as jest.Mock;

/** 每个用例都要干净的出站调用记录：httpRequest 复位实现，守卫只清调用历史（保留放行实现）。 */
function resetUpstream() {
  mockedHttp.mockReset();
  mockedGuard.mockClear();
}

/** 拿到拒绝出来的异常（上游错误映射的断言都要看 errorCode 与文案，不收 any）。 */
async function failure(promise: Promise<unknown>): Promise<BusinessException> {
  try {
    await promise;
  } catch (error) {
    return error as BusinessException;
  }
  throw new Error('期望上游报错，但调用成功了');
}

function response(
  status: number,
  data: unknown,
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    data,
    headers: new Headers(headers),
  };
}

const API_KEY = 'comfy-pat-secret-key-abcdef';

describe('ComfyClient 上游错误映射', () => {
  const client = new ComfyClient();
  beforeEach(resetUpstream);

  it('401 翻成「Key 的问题」，不原样透出 401，也不把 Key 带进文案', async () => {
    mockedHttp.mockResolvedValue(
      response(401, {
        code: 'UNAUTHORIZED',
        message: 'authentication required',
      }),
    );
    const error = await failure(client.getJob(API_KEY, 'job-1'));
    expect(error).toBeInstanceOf(BusinessException);
    expect(error.message).toContain('API Key');
    expect(error.message).not.toContain(API_KEY);
    // 关键：绝不能把上游 401 直接抛回前端，否则本站会把已登录用户踢出会话
    expect(error.errorCode.httpStatus).toBe(400);
  });

  it('402 与 403 分别指向积分不足与订阅未激活', async () => {
    mockedHttp.mockResolvedValue(
      response(402, { message: 'insufficient credits' }),
    );
    await expect(client.getJob(API_KEY, 'job-1')).rejects.toMatchObject({
      message: expect.stringContaining('积分不足'),
    });
    mockedHttp.mockResolvedValue(response(403, { code: 'forbidden' }));
    await expect(client.getJob(API_KEY, 'job-1')).rejects.toMatchObject({
      message: expect.stringContaining('付费订阅'),
    });
  });

  it('422 workflow_format_ui 给出「导出 API 格式」的可执行指引', async () => {
    mockedHttp.mockResolvedValue(
      response(422, {
        code: 'workflow_format_ui',
        message: 'ui format rejected',
      }),
    );
    await expect(
      client.submitJob(API_KEY, { nodes: [] as never }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Export (API)'),
    });
  });

  it('429 带上 Retry-After：按队列满/限流两种文案回，并归到本站限流错误码', async () => {
    mockedHttp.mockResolvedValue(
      response(429, { code: 'queue_full' }, { 'retry-after': '45' }),
    );
    const queueFull = await failure(client.getJob(API_KEY, 'job-1'));
    expect(queueFull.errorCode).toBe(ErrorCode.RATE_LIMITED);
    expect(queueFull.message).toContain('队列已满');
    expect(queueFull.message).toContain('45');
    mockedHttp.mockResolvedValue(
      response(429, { code: 'rate_limited' }, { 'retry-after': '1' }),
    );
    const throttled = await failure(client.getJob(API_KEY, 'job-1'));
    expect(throttled.message).toContain('限流');
    // Retry-After 缺失或为 0 时也要给出可等待的秒数，不能报「约 0 秒」
    mockedHttp.mockResolvedValue(response(429, { code: 'rate_limited' }));
    const blind = await failure(client.getJob(API_KEY, 'job-1'));
    expect(blind.message).not.toContain('约 0 秒');
  });

  it('verifyKey 把 404 当「Key 可用」：这是不排队不花钱的鉴权探针', async () => {
    mockedHttp.mockResolvedValue(response(404, { code: 'not_found' }));
    await expect(client.verifyKey(API_KEY)).resolves.toBeUndefined();
  });

  it('网络层失败只说「连不上」，不泄漏上游响应细节', async () => {
    mockedHttp.mockRejectedValue(
      new TransportError('timeout', 'upstream slow'),
    );
    await expect(client.getJob(API_KEY, 'job-1')).rejects.toMatchObject({
      message: expect.stringContaining('超时'),
    });
  });
});

describe('ComfyClient 提交与请求头', () => {
  const client = new ComfyClient();
  beforeEach(resetUpstream);

  it('提交时注入 extra_data 的 api_key_comfy_org，并带一次性 Idempotency-Key', async () => {
    mockedHttp.mockResolvedValue(
      response(201, { id: 'job-42', status: 'queued' }),
    );
    const job = await client.submitJob(API_KEY, {
      '1': { class_type: 'SaveImage', inputs: {} },
    });
    expect(job).toEqual({ id: 'job-42', status: 'queued' });
    const [url, init] = mockedHttp.mock.calls[0];
    expect(String(url)).toContain('/api/v2/jobs');
    expect(init.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(typeof init.headers['idempotency-key']).toBe('string');
    expect(init.redirect).toBe('manual');
    const body = JSON.parse(init.body);
    expect(body.extra_data.api_key_comfy_org).toBe(API_KEY);
    expect(body.workflow['1'].class_type).toBe('SaveImage');
  });

  it('object_info 走 v1 的 X-API-Key，并且顶层键扫描不吃嵌套结构', async () => {
    mockedHttp.mockResolvedValue(
      response(
        200,
        Buffer.from(
          JSON.stringify({
            KSampler: { input: { required: { seed: ['INT', {}] } } },
            TextEncodeQwenImageEditPlus: { input: {} },
          }),
        ),
      ),
    );
    const names = await client.nodeNames(API_KEY);
    // 只取顶层键＝节点名：嵌套的 input/required/seed 不能混进来
    expect([...names].sort()).toEqual([
      'KSampler',
      'TextEncodeQwenImageEditPlus',
    ]);
    const [, init] = mockedHttp.mock.calls[0];
    expect(init.headers['x-api-key']).toBe(API_KEY);
    expect(init.headers.authorization).toBeUndefined();
    expect(init.readAs).toBe('bytes');
  });

  it('节点清单按 Key 缓存 30 分钟：第二次取不再打上游', async () => {
    mockedHttp.mockResolvedValue(
      response(200, Buffer.from('{"SaveImage":{}}')),
    );
    const local = new ComfyClient();
    await local.nodeNames('key-cache-probe-000001');
    await local.nodeNames('key-cache-probe-000001');
    expect(mockedHttp).toHaveBeenCalledTimes(1);
  });
});

describe('ComfyClient 下载转存', () => {
  const client = new ComfyClient();
  beforeEach(resetUpstream);

  it('白名单外的下载地址直接拒，且不发起任何出站请求', async () => {
    await expect(
      client.downloadBytes(API_KEY, 'https://evil.example.com/leak.png', 1024),
    ).rejects.toMatchObject({ message: expect.stringContaining('主机白名单') });
    expect(mockedHttp).not.toHaveBeenCalled();
  });

  it('下载目标每一跳都过一遍守卫（明文 http / 内网地址由守卫拒收）', async () => {
    mockedHttp.mockResolvedValue(
      response(200, Buffer.from('x'), { 'content-type': 'image/png' }),
    );
    await client.downloadBytes(API_KEY, 'http://cloud.comfy.org/a.png', 1024);
    expect(assertOutboundUrl).toHaveBeenCalledWith(
      'http://cloud.comfy.org/a.png',
      expect.any(String),
    );
  });

  it('302 跳到官方签名域后继续取，第二跳不带 Key', async () => {
    mockedHttp
      .mockResolvedValueOnce(
        response(302, new Uint8Array(), {
          location: 'https://comfy-prod.storage.googleapis.com/jobs/out.png',
        }),
      )
      .mockResolvedValueOnce(
        response(200, Buffer.from('fake-image'), {
          'content-type': 'image/png',
        }),
      );
    const result = await client.downloadBytes(
      API_KEY,
      'https://cloud.comfy.org/api/v2/assets/abc/content',
      MAX_DOWNLOAD_BYTES.image,
    );
    expect(result.contentType).toBe('image/png');
    expect(Buffer.compare(result.bytes, Buffer.from('fake-image'))).toBe(0);
    expect(mockedHttp).toHaveBeenCalledTimes(2);
    const second = mockedHttp.mock.calls[1];
    expect(String(second[0])).toContain('storage.googleapis.com');
    expect(second[1].headers.authorization).toBeUndefined();
  });

  it('302 指向站外主机时中断：不把 Key 带进第三方请求', async () => {
    mockedHttp.mockResolvedValue(
      response(302, new Uint8Array(), {
        location: 'https://attacker.com/x.png',
      }),
    );
    await expect(
      client.downloadBytes(
        API_KEY,
        'https://cloud.comfy.org/api/v2/assets/a/content',
        1024,
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('主机白名单') });
    expect(mockedHttp).toHaveBeenCalledTimes(1);
  });

  it('超过字节上限时按「产物过大已放弃」报，而不是静默截断', async () => {
    mockedHttp.mockRejectedValue(
      new TransportError('protocol', 'body too large'),
    );
    await expect(
      client.downloadBytes(
        API_KEY,
        'https://cloud.comfy.org/api/v2/assets/a/content',
        16,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('超过大小上限'),
    });
  });

  it('重定向连环跳超过 4 跳就停', async () => {
    mockedHttp.mockResolvedValue(
      response(302, new Uint8Array(), {
        location: 'https://a.storage.googleapis.com/x',
      }),
    );
    await expect(
      client.downloadBytes(
        API_KEY,
        'https://cloud.comfy.org/api/v2/assets/a/content',
        1024,
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('重定向次数过多'),
    });
  });
});

describe('scanTopLevelKeys', () => {
  it('只取顶层键：嵌套同名键与字符串值都不算', () => {
    const bytes = Buffer.from(
      '{"KSampler":{"input":{"required":{"seed":["INT"]}}},"SaveImage":{},"名称 带\\"引号":{"a":1},"node\\u0041":{"b":"值"}}',
    );
    const keys = scanTopLevelKeys(new Uint8Array(bytes));
    expect(keys.has('KSampler')).toBe(true);
    expect(keys.has('SaveImage')).toBe(true);
    // 转义必须还原：class_type 是 JSON.parse 出来的，两边对不上就会把合法节点拒了
    expect(keys.has('名称 带"引号')).toBe(true);
    expect(keys.has('nodeA')).toBe(true);
    expect(keys.has('seed')).toBe(false);
    expect(keys.has('input')).toBe(false);
    expect(keys.has('值')).toBe(false);
  });
});
