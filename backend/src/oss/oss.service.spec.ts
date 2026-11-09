import { Logger } from '../common/logger';
import { OssService } from './oss.service';
import { ossObjectKey, ossPublicUrl } from './oss.config';

describe('OssService', () => {
  const path = 'provider-qualifications/unit/营业 执照(1)#?.png';
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-15T12:34:56Z'));
    process.env.OSS_ACCESS_KEY_ID = 'unit-access-key';
    process.env.OSS_ACCESS_KEY_SECRET = 'unit-access-secret';
    delete process.env.OSS_SECURITY_TOKEN;
    fetchMock = jest
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock;
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  // 固定预期由阿里云 ali-oss@6.23.0 authorizationV4 独立生成。
  it.each([
    ['', '21f4c459af5d64bd20195a4a0497b6607d934af8cf90215e0fe997ad106ef456'],
    [
      'unit-sts-token',
      '1947aff62ac726faff7e51eeeeb7895ceaeb53b64c544b8d26cfe492df1e23d8',
    ],
  ])(
    'matches the official SDK V4 signature, including STS: %s',
    async (token, signature) => {
      if (token) process.env.OSS_SECURITY_TOKEN = token;
      const content = Buffer.from('test-image');
      const result = await new OssService().upload(path, content);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers.authorization).toBe(
        `OSS4-HMAC-SHA256 Credential=unit-access-key/20261015/cn-beijing/oss/aliyun_v4_request,Signature=${signature}`,
      );
      expect(headers['x-oss-security-token']).toBe(token || undefined);
      expect(headers['content-type']).toBe('image/png');
      expect(init.body).toEqual(new Uint8Array(content));
      expect(init.redirect).toBe('error');
      expect(url).toContain(
        '%E8%90%A5%E4%B8%9A%20%E6%89%A7%E7%85%A7%281%29%23%3F.png',
      );
      expect(new URL(url).search).toBe('');
      expect(new URL(url).hash).toBe('');
      expect(result).toEqual({
        key: ossObjectKey(path),
        url,
        size: content.length,
        contentType: 'image/png',
      });
      expect(new OssService().urlOf(path)).toBe(
        ossPublicUrl(ossObjectKey(path)),
      );
    },
  );

  it('rejects missing credentials before contacting OSS', async () => {
    delete process.env.OSS_ACCESS_KEY_SECRET;
    await expect(
      new OssService().upload(path, Buffer.from('x')),
    ).rejects.toMatchObject({
      errorCode: { httpStatus: 503 },
      message: expect.stringContaining('未配置'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps unsafe file types out of the public bucket', async () => {
    await expect(
      new OssService().upload('page.html', Buffer.from('<html>')),
    ).rejects.toMatchObject({ errorCode: { httpStatus: 400 } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deletes an object with a signed V4 DELETE and treats 404 as already gone', async () => {
    const service = new OssService();
    await service.remove(ossObjectKey(path));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe('DELETE');
    expect(headers.authorization).toContain(
      'OSS4-HMAC-SHA256 Credential=unit-access-key/',
    );
    expect(new URL(url).pathname).toContain(
      '%E8%90%A5%E4%B8%9A%20%E6%89%A7%E7%85%A7%281%29%23%3F.png',
    );

    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(service.remove('asset/missing.png')).resolves.toBeUndefined();
  });

  it('reads object metadata from HEAD and reports missing objects', async () => {
    const service = new OssService();
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {
          'content-length': '42',
          'content-type': 'text/markdown; charset=utf-8',
        },
      }),
    );
    await expect(service.stat('asset/report.md')).resolves.toEqual({
      exists: true,
      size: 42,
      contentType: 'text/markdown; charset=utf-8',
    });
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('HEAD');

    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(service.stat('asset/missing.md')).resolves.toEqual({
      exists: false,
      size: 0,
      contentType: '',
    });
  });

  it('reports upstream failure as 503 without logging credential-bearing XML', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        '<Error><Code>AccessDenied</Code><AccessKeyId>unit-access-key</AccessKeyId><StringToSign>unit-access-secret</StringToSign></Error>',
        {
          status: 403,
          headers: { 'x-oss-request-id': 'unit-request-id' },
        },
      ),
    );
    await expect(
      new OssService().upload(path, Buffer.from('x')),
    ).rejects.toMatchObject({
      errorCode: { httpStatus: 503 },
      message: expect.stringContaining('OSS 403 / AccessDenied'),
    });
    const log = JSON.stringify((Logger.prototype.warn as jest.Mock).mock.calls);
    expect(log).toContain('unit-request-id');
    expect(log).not.toContain('unit-access-key');
    expect(log).not.toContain('unit-access-secret');
  });

  it('times out network uploads', async () => {
    fetchMock.mockImplementation(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const outcome = expect(
      new OssService().upload(path, Buffer.from('x')),
    ).rejects.toMatchObject({ errorCode: { httpStatus: 503 } });
    await jest.advanceTimersByTimeAsync(20_000);
    await outcome;
  });
});
