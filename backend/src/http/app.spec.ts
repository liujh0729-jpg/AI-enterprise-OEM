import { createApp } from './app';
import { createServices } from './services';
import { endpoints } from '@enterprise/contracts';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { issueSsoSession } from '../auth/token';

// PrismaClient 构造时要求 datasource 地址；单测不连库，没有 backend/.env 时（CI）
// 用占位连接串与临时密钥兜底，避免模块加载阶段就抛错。
process.env.DB_PROVIDER ||= 'mysql';
process.env.DATABASE_URL ||= 'mysql://unit:unit@127.0.0.1:3306/unit';
process.env.EXTERNAL_CRED_KEY ||= 'isolated-unit-credential-key';

describe('Hono routing and session boundary', () => {
  const originalEnv = { ...process.env };
  const services = createServices();
  const app = createApp(services);
  beforeEach(() => {
    process.env.JWT_SECRET = 'isolated-unit-secret';
    process.env.DEV_AUTO_LOGIN = 'false';
    jest.spyOn(services.users, 'remember').mockResolvedValue(undefined);
    // 开源版会话只认本站自签令牌，并核对账号版本；这里把账户查询固定为有效账户。
    jest.spyOn(services.prisma.account, 'findUnique').mockResolvedValue({
      id: 1,
      status: 'ACTIVE',
      tokenVersion: 0,
    } as never);
    jest.spyOn(services.users, 'requireActiveUser').mockResolvedValue({
      id: 'unit-user',
      username: 'unit',
      displayName: 'Unit',
      enabled: true,
      avatarUrl: null,
      personalIntro: null,
      createdAt: new Date(0).toISOString(),
    });
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });
  const token = () => issueSsoSession('1', 'unit');
  it.each(['/health', '/api/backend/health'])(
    'serves the public health route %s',
    async (path) => {
      const r = await app.request(path);
      expect(r.status).toBe(200);
      expect(r.headers.get('x-request-id')).toBeTruthy();
      expect(await r.json()).toMatchObject({ code: 0, data: { status: 'up' } });
    },
  );
  it('protects business routes', async () => {
    const r = await app.request('/api/backend/enterprise/me');
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ code: 401 });
  });
  it.each(['/enterprise/me', '/api/backend/enterprise/me'])(
    'preserves business errors through %s',
    async (path) => {
      jest
        .spyOn(services.controllers.identityController, 'me')
        .mockRejectedValue(
          new BusinessException(ErrorCode.FORBIDDEN, 'denied'),
        );
      const response = await app.request(path, {
        headers: { authorization: `Bearer ${token()}` },
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: 403,
        message: 'denied',
      });
      expect(response.headers.get('x-request-id')).toBeTruthy();
    },
  );
  it('reports invalid output as a server error', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest
      .spyOn(services.controllers.healthController, 'version')
      .mockReturnValue({ code: 0, message: 'ok', data: {} } as ReturnType<
        typeof services.controllers.healthController.version
      >);
    const response = await app.request('/api/backend/health/version');
    expect(response.status).toBe(500);
  });
  it('rejects invalid body before executing a business operation', async () => {
    const spy = jest.spyOn(services.controllers.invoiceController, 'create');
    const r = await app.request('/api/backend/enterprise/invoice-requests', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token()}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    expect(r.status).toBe(422);
    expect(spy).not.toHaveBeenCalled();
  });
  it.each([
    '/enterprise/invoice-requests',
    '/api/backend/enterprise/invoice-requests',
  ])('returns a client error for malformed JSON through %s', async (path) => {
    const spy = jest.spyOn(services.controllers.invoiceController, 'create');
    const response = await app.request(path, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token()}`,
        'content-type': 'application/json',
      },
      body: '{',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 400, data: null });
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });
  it('rejects cross-site cookie writes', async () => {
    const r = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: {
        origin: 'https://untrusted.invalid',
        cookie: 'aiworkin_token=unit',
      },
    });
    expect(r.status).toBe(403);
  });
  it('clears cookies through POST logout', async () => {
    const r = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'http://localhost:15889' },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
  });
  it('disables local account sign-in by default', async () => {
    expect((await app.request('/api/dev/accounts')).status).toBe(404);
  });
  it('documents every route exactly once and does not expose credentials', async () => {
    const r = await app.request('/api/openapi.json');
    expect(r.status).toBe(200);
    const doc = (await r.json()) as {
      paths: Record<string, Record<string, { operationId: string }>>;
    };
    const ids = Object.values(doc.paths).flatMap((verbs) =>
      Object.values(verbs).map((v) => v.operationId),
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of Object.keys(endpoints)) expect(ids).toContain(id);
  });
});
