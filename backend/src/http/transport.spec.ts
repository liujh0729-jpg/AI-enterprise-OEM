import { httpRequest } from './transport';

describe('upstream HTTP deadlines', () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
    jest.useRealTimers();
  });
  it('times out while reading a response body', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start() {
            /* The peer never completes its body. */
          },
        }),
      ),
    );
    const assertion = expect(
      httpRequest('http://localhost/slow-body', { timeoutMs: 25 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
    await jest.advanceTimersByTimeAsync(25);
    await assertion;
  });
  it('includes semaphore waiting in the deadline and never sends timed-out queued requests', async () => {
    jest.useFakeTimers();
    const mock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockImplementation(() => new Promise(() => undefined));
    global.fetch = mock;
    const first = new AbortController();
    const a = expect(
      httpRequest('http://localhost/hold', {
        concurrency: 1,
        signal: first.signal,
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({ kind: 'cancelled' });
    const b = expect(
      httpRequest('http://localhost/wait', { concurrency: 1, timeoutMs: 25 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
    await jest.advanceTimersByTimeAsync(25);
    await b;
    expect(mock).toHaveBeenCalledTimes(1);
    first.abort();
    await a;
    global.fetch = jest.fn().mockResolvedValue(new Response('{}'));
    expect(
      (await httpRequest('http://localhost/next', { concurrency: 1 })).status,
    ).toBe(200);
  });
});
