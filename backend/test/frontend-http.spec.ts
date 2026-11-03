import { http, cancelSessionRequests } from '../../frontend/src/api/http';
import { z, apiEnvelope } from '@enterprise/contracts';

describe('browser HTTP transport', () => {
  const originalFetch = global.fetch;
  let mock: jest.MockedFunction<typeof fetch>;
  beforeEach(() => {
    mock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    global.fetch = mock;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    cancelSessionRequests();
  });
  it('accepts a successful null and an empty response', async () => {
    mock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, message: 'ok', data: null })),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(
      (await http('/api/auth/logout', apiEnvelope(z.null()))).data.data,
    ).toBeNull();
    expect((await http('/empty', z.null())).data).toBeNull();
  });
  it.each([
    [200, 'business', 400],
    [403, 'http', 403],
  ])('normalizes business/HTTP errors (%i)', async (status, kind, code) => {
    mock.mockResolvedValue(
      new Response(JSON.stringify({ code, message: 'rejected', data: null }), {
        status,
        headers: { 'x-request-id': 'unit-request' },
      }),
    );
    await expect(http('/unit', z.unknown())).rejects.toMatchObject({
      kind,
      status,
      code,
      requestId: 'unit-request',
    });
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('distinguishes malformed JSON from an HTML gateway error', async () => {
    mock
      .mockResolvedValueOnce(new Response('{'))
      .mockResolvedValueOnce(
        new Response('<html>upstream error</html>', { status: 502 }),
      );
    await expect(http('/unit', z.unknown())).rejects.toMatchObject({
      kind: 'protocol',
    });
    await expect(http('/unit', z.unknown())).rejects.toMatchObject({
      kind: 'http',
      status: 502,
    });
  });
  it('covers reading the body with the same deadline even if reading ignores abort', async () => {
    jest.useFakeTimers();
    const response = new Response(null, { status: 200 });
    response.text = () => new Promise<string>(() => undefined);
    mock.mockResolvedValue(response);
    const request = http('/unit', z.unknown(), { timeoutMs: 25 });
    const assertion = expect(request).rejects.toMatchObject({
      kind: 'timeout',
    });
    await jest.advanceTimersByTimeAsync(25);
    await assertion;
  });
  it('distinguishes caller cancellation and cancels requests from a retired session', async () => {
    mock.mockImplementation(
      (_path, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('abort')),
          ),
        ),
    );
    const caller = new AbortController();
    const one = http('/unit', z.unknown(), { signal: caller.signal });
    const a = expect(one).rejects.toMatchObject({ kind: 'cancelled' });
    caller.abort();
    await a;
    const two = http('/api/backend/enterprise/me', z.unknown());
    const b = expect(two).rejects.toMatchObject({ kind: 'cancelled' });
    cancelSessionRequests();
    await b;
  });
  it('lets the browser add multipart boundaries, encodes queries and retains download headers', async () => {
    mock.mockResolvedValue(
      new Response('binary', {
        headers: { 'content-disposition': 'attachment; filename=unit.txt' },
      }),
    );
    const form = new FormData();
    form.set('file', new Blob(['x']), 'unit.txt');
    const result = await http('/file', z.instanceof(Blob), {
      method: 'POST',
      body: form,
      query: { name: 'a & b' },
      responseType: 'blob',
    });
    const [path, options] = mock.mock.calls[0];
    expect(path).toBe('/file?name=a+%26+b');
    expect(new Headers(options?.headers).has('content-type')).toBe(false);
    expect(result.headers.get('content-disposition')).toContain('unit.txt');
  });
});
