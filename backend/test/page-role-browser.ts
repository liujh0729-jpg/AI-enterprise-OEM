/** 仅由 audit-pages-isolated 启动；临时本机测试入口，绝不挂载到开发/生产 main。 */
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { serve } from '@hono/node-server';
import { setCookie, deleteCookie } from 'hono/cookie';
import { sign } from 'jsonwebtoken';
import { createApp } from '../src/http/app';
import { createServices } from '../src/http/services';
import { loadSeedUsers } from '../src/directory/seed-users';

const db = new URL(process.env.DATABASE_URL || '');
assert.equal(process.env.ISOLATED_TEST, '1');
assert.equal(db.hostname, '127.0.0.1');
assert.match(db.pathname, /^\/enterprise_page_audit_\d+_\d+$/);
assert.equal(process.env.JAVA_BASE_URL, 'http://127.0.0.1:1');
assert.equal(process.env.AIWORKIN_ENABLED, 'false');
const services = createServices();
const app = createApp(services);
const seed = [...loadSeedUsers().values()];
const uid = (name: string) => seed.find((u) => u.username === name)!.id;
const cases = {
  company: ['audit-COMPANY', 'user', 'ENTERPRISE_USER'],
  individual: ['audit-INDIVIDUAL', 'user', 'ENTERPRISE_USER'],
  personal: ['audit-PERSONAL', 'user', 'ENTERPRISE_USER'],
  provider: [uid('demo_all'), 'user', 'SERVICE_PROVIDER'],
  micro: [uid('demo_agent'), 'user', 'SERVICE_PROVIDER'],
  staff: [uid('demo_staff'), 'user', 'PROVIDER_STAFF'],
  unqualified: ['audit-unqualified', 'user', 'ENTERPRISE_USER'],
  admin: ['u-admin', 'admin', 'PLATFORM_ADMIN'],
  'admin-company': ['u-admin', 'admin', 'ENTERPRISE_USER'],
  'admin-provider': ['u-admin', 'admin', 'SERVICE_PROVIDER'],
  'admin-staff': ['u-admin', 'admin', 'PROVIDER_STAFF'],
} satisfies Record<string, string[]>;
app.get('/audit', (c) =>
  c.html(
    `<h1>本机隔离角色审计</h1><p>一次性测试库；线上上游关闭。</p>${Object.keys(
      cases,
    )
      .map((role) => `<p><a href="/audit/session/${role}">${role}</a></p>`)
      .join('')}`,
  ),
);
app.get('/audit/session/:role', async (c) => {
  if (c.req.param('role') === 'anonymous') {
    deleteCookie(c, 'aiworkin_token', { path: '/' });
    deleteCookie(c, 'aiworkin_refresh_token', { path: '/' });
    return c.redirect('/login');
  }
  const value = cases[c.req.param('role') as keyof typeof cases];
  if (!value) return c.text('unknown test role', 404);
  const [userId, role, currentIdentity] = value;
  await services.prisma.identityPreference.upsert({
    where: { userId },
    create: { userId, currentIdentity },
    update: { currentIdentity },
  });
  setCookie(
    c,
    'aiworkin_token',
    sign(
      { userId, username: userId, role, type: 'access' },
      process.env.JWT_SECRET!,
      { issuer: 'aipdd-java-core', expiresIn: 3600 },
    ),
    { httpOnly: true, sameSite: 'Lax', path: '/' },
  );
  return c.redirect('/');
});
const api = serve({ fetch: app.fetch, port: 1698, hostname: '127.0.0.1' });
// 复用本机前端源码，通过独立 localhost origin 访问隔离 API，避免覆盖 127.0.0.1 的真实登录 Cookie。
const proxy = createServer((incoming, response) => {
  const backend = /^\/(api|audit)(\/|$)/.test(incoming.url || '/');
  const upstream = request(
    {
      hostname: '127.0.0.1',
      port: backend ? 1698 : 15890,
      path: incoming.url,
      method: incoming.method,
      headers: incoming.headers,
    },
    (result) => {
      response.writeHead(result.statusCode || 502, result.headers);
      result.pipe(response);
    },
  );
  upstream.on('error', () => {
    response.writeHead(502);
    response.end('isolated proxy unavailable');
  });
  incoming.pipe(upstream);
});
// Next dev 的客户端初始化依赖 HMR WebSocket；只转发前端自身的升级请求。
proxy.on('upgrade', (incoming, socket, head) => {
  if (!incoming.url?.startsWith('/_next/')) {
    socket.destroy();
    return;
  }
  const upstream = connect(15890, '127.0.0.1', () => {
    const headers = incoming.rawHeaders.reduce<string[]>(
      (out, value, index, all) => {
        if (index % 2 === 0) out.push(`${value}: ${all[index + 1]}`);
        return out;
      },
      [],
    );
    upstream.write(
      `${incoming.method} ${incoming.url} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n`,
    );
    if (head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});
proxy.listen(15989, 'localhost', () => console.info('本机隔离角色页面已就绪'));
async function close() {
  proxy.close();
  api.close();
  await services.prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
