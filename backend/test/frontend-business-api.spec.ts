import { endpoint, catalogEndpoint } from '../../frontend/src/api/endpoint';
import { z } from '@enterprise/contracts';

describe('shared endpoint contracts', () => {
  const originalFetch = global.fetch;
  let mock: jest.MockedFunction<typeof fetch>;
  beforeEach(() => {
    mock = jest.fn();
    global.fetch = mock;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });
  it('rejects missing path parameters before sending a request', async () => {
    await expect(catalogEndpoint('Geo_testSettings', {})).rejects.toThrow();
    expect(mock).not.toHaveBeenCalled();
  });
  it('encodes each path segment and accepts an intentional null result', async () => {
    mock.mockResolvedValue(
      new Response(JSON.stringify({ code: 0, message: 'ok', data: null })),
    );
    const api = endpoint({
      method: 'get',
      path: '/unit/:id',
      params: z.object({ id: z.string() }),
      query: z.object({}),
      body: z.undefined(),
      response: z.object({
        code: z.number(),
        message: z.string(),
        data: z.null(),
      }),
    });
    await expect(api({ params: { id: 'a/b ?' } })).resolves.toBeNull();
    expect(mock.mock.calls[0][0]).toBe('/api/backend/unit/a%2Fb%20%3F');
  });
  it('reports response contract drift with the server request identifier', async () => {
    mock.mockResolvedValue(
      new Response(
        JSON.stringify({ code: 0, message: 'ok', data: { id: 'wrong' } }),
        { headers: { 'x-request-id': 'contract-test' } },
      ),
    );
    const api = endpoint({
      method: 'get',
      path: '/unit',
      params: z.object({}),
      query: z.object({}),
      body: z.undefined(),
      response: z.object({
        code: z.number(),
        message: z.string(),
        data: z.object({ id: z.number() }),
      }),
    });
    await expect(api()).rejects.toMatchObject({
      kind: 'protocol',
      requestId: 'contract-test',
    });
  });
  it('preserves a business failure instead of returning an empty list', async () => {
    mock.mockResolvedValue(
      new Response(
        JSON.stringify({ code: 24002, message: '上游鉴权失败', data: null }),
        { status: 502, headers: { 'x-request-id': 'upstream-test' } },
      ),
    );
    await expect(catalogEndpoint('Tax_records')).rejects.toMatchObject({
      code: 24002,
      requestId: 'upstream-test',
    });
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
