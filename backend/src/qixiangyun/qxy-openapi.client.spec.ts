import { createHash } from 'node:crypto';
import { QxyOpenApiClient, qxyRequestSignature } from './qxy-openapi.client';
import { QxySettingsService } from './qxy-settings.service';

const credentials = { appkey: 'unit-app', secret: 'unit-secret' };
const md5 = (value: string) => createHash('md5').update(value).digest('hex');
const response = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
const login = (token = 'unit-token') =>
  response({
    success: true,
    code: '2000',
    data: { access_token: token, expires_in: 1296000000 },
  });
const invoice = () =>
  response({
    success: true,
    code: '2000',
    data: { success: true, datas: [{ fphm: '00123456' }] },
  });

describe('Qixiangyun OpenAPI', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.MockedFunction<typeof fetch>;
  let settings: { resolve: jest.Mock };
  let client: QxyOpenApiClient;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    settings = { resolve: jest.fn().mockResolvedValue(credentials) };
    client = new QxyOpenApiClient(settings as unknown as QxySettingsService);
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('matches the documented MD5-hex then Base64 signature format', () => {
    const body = '{"nsrsbh":"915211111111111111"}';
    expect(md5(body)).toBe('4e7f9b81e299ad014cfbc6949c3f4e04');
    // Synthetic, self-consistent vector (no real credentials).
    const token = 'unit-token';
    expect(
      qxyRequestSignature(
        {
          appkey: 'unit-app',
          secret: 'unit-secret',
        },
        body,
        '1581588537349',
        token,
      ),
    ).toBe('API-SV1:unit-app:ZTcxY2ZjOTdiZDhlNjk0M2E0MGJmNmUxZTY1MGQ4OTg=');
  });

  it('shares settings, hashes only the login secret and signs the exact OCR body', async () => {
    fetchMock
      .mockResolvedValueOnce(login())
      .mockResolvedValueOnce(invoice())
      .mockResolvedValueOnce(invoice());
    await expect(
      client.recognizeInvoice('base64-image'),
    ).resolves.toMatchObject({ success: true });
    await client.recognizeInvoice('next-image');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.qixiangyun.com/v2/public/oauth2/login');
    expect(JSON.parse(request?.body as string)).toEqual({
      grant_type: 'client_credentials',
      client_appkey: credentials.appkey,
      client_secret: md5(credentials.secret),
    });
    const [ocrUrl, ocr] = fetchMock.mock.calls[1];
    expect(ocrUrl).toBe('https://api.qixiangyun.com/v2/invoice/ocr/sb');
    const headers = ocr?.headers as Record<string, string>;
    expect(headers.req_sign).toBe(
      qxyRequestSignature(
        credentials,
        ocr?.body as string,
        headers.req_date,
        'unit-token',
      ),
    );
    expect(JSON.parse(ocr?.body as string)).toEqual({
      imageData: 'base64-image',
      customReqId: expect.stringMatching(/^unit-app[0-9a-f]{32}$/),
    });
    expect(settings.resolve).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent logins and uses updated shared credentials immediately', async () => {
    fetchMock.mockImplementation(async (url) =>
      (url as string).endsWith('/login') ? login() : invoice(),
    );
    await Promise.all([
      client.recognizeInvoice('a'),
      client.recognizeInvoice('b'),
    ]);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        (url as string).endsWith('/login'),
      ),
    ).toHaveLength(1);
    settings.resolve.mockResolvedValue({
      appkey: 'replacement',
      secret: 'replacement-secret',
    });
    await client.recognizeInvoice('c');
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        (url as string).endsWith('/login'),
      ),
    ).toHaveLength(2);
    expect(
      JSON.parse(fetchMock.mock.calls[3][1]?.body as string).client_appkey,
    ).toBe('replacement');
  });

  it('refreshes expired authentication once without retrying business failures', async () => {
    fetchMock
      .mockResolvedValueOnce(login())
      .mockResolvedValueOnce(response({ success: false, code: '40101' }))
      .mockResolvedValueOnce(login('new-token'))
      .mockResolvedValueOnce(invoice());
    await client.recognizeInvoice('a');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    fetchMock.mockResolvedValueOnce(
      response({
        success: false,
        code: '505070',
        message: 'unit-secret unit-token',
      }),
    );
    await expect(client.recognizeInvoice('b')).rejects.toThrow(
      '调用次数已用完',
    );
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('explains the real unprovisioned OCR response without retrying it', async () => {
    fetchMock.mockResolvedValueOnce(login()).mockResolvedValueOnce(
      response({
        success: false,
        code: 'product_binding_check',
        message: 'unit-secret unit-token',
      }),
    );
    await expect(client.recognizeInvoice('a')).rejects.toThrow(
      '尚未开通发票 OCR 权限',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caches only until expiry and refreshes at least every seven days', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(async (url) =>
      (url as string).endsWith('/login') ? login() : invoice(),
    );
    await client.recognizeInvoice('a');
    jest.advanceTimersByTime(7 * 86400000);
    await client.recognizeInvoice('b');
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        (url as string).endsWith('/login'),
      ),
    ).toHaveLength(2);
  });

  it('rejects missing settings or malformed login without exposing credentials', async () => {
    settings.resolve.mockResolvedValue({ appkey: '', secret: '' });
    await expect(client.recognizeInvoice('a')).rejects.toThrow('财税管理');
    expect(fetchMock).not.toHaveBeenCalled();
    settings.resolve.mockResolvedValue(credentials);
    fetchMock.mockResolvedValue(
      response({
        success: true,
        code: '2000',
        data: { error_msg: 'unit-secret unit-token' },
      }),
    );
    await expect(client.recognizeInvoice('b')).rejects.toThrow('鉴权失败');
  });

  it('does not return upstream credentials in HTTP or network errors', async () => {
    fetchMock.mockRejectedValue(new Error('unit-secret unit-token'));
    await expect(client.recognizeInvoice('a')).rejects.toThrow(
      '服务暂时不可用',
    );
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(client.recognizeInvoice('b')).rejects.toThrow('发票识别失败');
  });

  it('keeps its timeout active while reading a response body', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(
      async (_url, options) =>
        ({
          ok: true,
          text: () =>
            new Promise((_resolve, reject) => {
              options?.signal?.addEventListener('abort', () =>
                reject(new Error('aborted')),
              );
            }),
        }) as Response,
    );
    const request = client.recognizeInvoice('a');
    const assertion = expect(request).rejects.toThrow('超时');
    await jest.advanceTimersByTimeAsync(60000);
    await assertion;
  });
});
