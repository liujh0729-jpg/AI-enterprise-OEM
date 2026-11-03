import { AiworkinClient } from './aiworkin.client';
import { runInRequestContext } from '../common/request-context';

describe('AIworkin retry ownership', () => {
  const original = global.fetch;
  const client = new AiworkinClient();
  afterEach(() => {
    global.fetch = original;
    jest.useRealTimers();
  });

  it('keeps the idempotency key and caller token across an explicitly retryable write', async () => {
    const mock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(
        Response.json({ message: 'unavailable' }, { status: 503 }),
      )
      .mockResolvedValueOnce(Response.json({ code: 0, data: { id: 1 } }));
    global.fetch = mock;
    await expect(
      client.request('/write', {
        method: 'POST',
        token: 'caller-a',
        idempotencyKey: 'test_operation_0001',
        retry: 1,
        body: { value: 1 },
        baseUrl: 'http://localhost',
        timeoutMs: 1000,
      }),
    ).resolves.toEqual({ id: 1 });
    expect(mock).toHaveBeenCalledTimes(2);
    for (const [, init] of mock.mock.calls) {
      expect(new Headers(init?.headers).get('idempotency-key')).toBe(
        'test_operation_0001',
      );
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer caller-a',
      );
    }
  });

  it('rejects retryable writes without an idempotency key before sending', async () => {
    global.fetch = jest.fn();
    await expect(
      client.request('/write', {
        method: 'POST',
        retry: 1,
        baseUrl: 'http://localhost',
      }),
    ).rejects.toMatchObject({ message: '写操作重试必须提供幂等键' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('cancels backoff when the enclosing HTTP request is cancelled', async () => {
    jest.useFakeTimers();
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        Response.json({ message: 'unavailable' }, { status: 503 }),
      );
    const controller = new AbortController();
    const pending = runInRequestContext(
      () =>
        client.request('/read', {
          retry: 2,
          baseUrl: 'http://localhost',
          timeoutMs: 1000,
        }),
      { signal: controller.signal },
    );
    const assertion = expect(pending).rejects.toMatchObject({
      kind: 'cancelled',
    });
    await jest.advanceTimersByTimeAsync(20);
    controller.abort();
    await assertion;
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not restart the timeout budget after a body-read timeout', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start() {
            /* stalled body */
          },
        }),
      ),
    );
    const assertion = expect(
      client.request('/read', {
        retry: 2,
        baseUrl: 'http://localhost',
        timeoutMs: 25,
      }),
    ).rejects.toMatchObject({ message: 'AIworkin 通道暂时不可达' });
    await jest.advanceTimersByTimeAsync(25);
    await assertion;
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
