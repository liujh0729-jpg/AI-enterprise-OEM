import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requestBodyLimit } from '../http/app';

describe('Hono attachment request size limits', () => {
  const app = new Hono();
  app.use('*', (c, next) =>
    bodyLimit({
      maxSize: requestBodyLimit(c.req.path),
      onError: (c) =>
        c.json(
          {
            code: 413,
            message: '请求内容过大，请减少单次上传的文件数量后重试',
            data: null,
          },
          413,
        ),
    })(c, next),
  );
  app.post('*', async (c) => {
    const body = await c.req.json<{ files: { contentBase64: string }[] }>();
    return c.json(
      { size: Buffer.from(body.files[0].contentBase64, 'base64').length },
      201,
    );
  });
  const tenMB = JSON.stringify({
    files: [
      { contentBase64: Buffer.alloc(10 * 1024 * 1024).toString('base64') },
    ],
  });
  function post(path: string, body: string) {
    return app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  }
  it.each([
    '/enterprise/identity/provider-application/attachments',
    '/api/backend/enterprise/flex/onboardings/attachments/',
  ])('accepts a 10MB file at %s', async (path) => {
    const response = await post(path, tenMB);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ size: 10 * 1024 * 1024 });
  });
  it('keeps the 12MB limit for ordinary JSON', async () => {
    const response = await post('/ordinary-json', tenMB);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: 413 });
  });
  it('rejects uploads above 16MB', async () => {
    const response = await post(
      '/enterprise/flex/onboardings/attachments',
      JSON.stringify({
        files: [{ contentBase64: 'x'.repeat(17 * 1024 * 1024) }],
      }),
    );
    expect(response.status).toBe(413);
  });
});
