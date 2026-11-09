import { QxyClient } from './qxy.client';
import { stub } from '../../test/doubles';
import type { QxySettingsService } from './qxy-settings.service';

const credentials = { appkey: 'unit-key', secret: 'unit-secret' };
const settings = { resolve: jest.fn().mockResolvedValue(credentials) };

describe('QxyClient tool outcome', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.QXY_APPKEY;
  const originalSecret = process.env.QXY_SECRET;

  beforeEach(() => {
    process.env.QXY_APPKEY = 'unit-key';
    process.env.QXY_SECRET = 'unit-secret';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.QXY_APPKEY;
    else process.env.QXY_APPKEY = originalKey;
    if (originalSecret === undefined) delete process.env.QXY_SECRET;
    else process.env.QXY_SECRET = originalSecret;
  });

  it.each([
    {
      result: {
        isError: true,
        content: [{ type: 'text', text: '{"message":"denied"}' }],
      },
    },
    { result: { structuredContent: { success: false, code: 'DENIED' } } },
    { result: { structuredContent: { code: 'DENIED' } } },
    { result: { content: [{ type: 'text', text: 'Unexpected response' }] } },
  ])('does not report a failed tool call as success', async (payload) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, ...payload }),
    });
    const result = await new QxyClient(stub<QxySettingsService>(settings)).call(
      '/mcp/blue_invoice',
      'issue_blue_invoice_auto',
    );
    expect(result.ok).toBe(false);
  });

  it('reads newly saved credentials on each call and removes echoes from results', async () => {
    const next = { appkey: 'new-key', secret: 'new-secret' };
    settings.resolve
      .mockResolvedValueOnce(credentials)
      .mockResolvedValueOnce(next);
    const fetchMock = jest
      .fn()
      .mockImplementation(async (_url, init: RequestInit) => {
        if (typeof init.body !== 'string')
          throw new Error('missing request body');
        const body = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    code: 'OK',
                    message: body.params.arguments.client_secret,
                    echo: body.params.arguments,
                  }),
                },
              ],
            },
          }),
        );
      });
    global.fetch = fetchMock;
    const client = new QxyClient(stub<QxySettingsService>(settings));
    const first = await client.call('/mcp/blue_invoice', 'test');
    const second = await client.call('/mcp/blue_invoice', 'test');
    expect(
      JSON.parse(String(fetchMock.mock.calls[0][1].body)).params.arguments,
    ).toMatchObject({
      client_appkey: 'unit-key',
      client_secret: 'unit-secret',
    });
    expect(
      JSON.parse(String(fetchMock.mock.calls[1][1].body)).params.arguments,
    ).toMatchObject({ client_appkey: 'new-key', client_secret: 'new-secret' });
    for (const result of [first, second]) {
      for (const value of [
        ...Object.values(credentials),
        ...Object.values(next),
      ]) {
        expect(JSON.stringify(result)).not.toContain(value);
      }
      expect(result.ok).toBe(true);
    }
  });

  it('blocks calls with incomplete credentials before fetching', async () => {
    settings.resolve.mockResolvedValueOnce({ appkey: 'unit-key', secret: '' });
    global.fetch = jest.fn();
    const client = new QxyClient(stub<QxySettingsService>(settings));
    await expect(client.call('/mcp/blue_invoice', 'test')).rejects.toThrow(
      '财税管理',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('redacts current database credentials in upstream errors', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: 'unit-key unit-secret denied' },
        }),
      ),
    );
    await expect(
      new QxyClient(stub<QxySettingsService>(settings)).call(
        '/mcp/blue_invoice',
        'test',
      ),
    ).rejects.toThrow('*** *** denied');
  });
});
