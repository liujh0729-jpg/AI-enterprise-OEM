import { Prisma } from '../../generated/prisma';
import { readIdentitySnapshot } from './identity-snapshot';
import { IdentityService } from './identity.service';
import { UserLookupService } from '../directory/user-lookup.service';
import { AuthService } from '../auth/auth.service';
import {
  runInRequestContext,
  clearRequestMemo,
  isIdentityWrite,
} from '../common/request-context';
import { sign } from 'jsonwebtoken';
import { httpRequest } from '../http/transport';
import { createApp } from '../http/app';
import { createServices } from '../http/services';
import { IdentityController } from './identity.controller';

jest.mock('../http/transport', () => ({ httpRequest: jest.fn() }));

function model(name: string): Prisma.JsonObject {
  const definition = Prisma.dmmf.datamodel.models.find(
    (row) => row.name === name,
  )!;
  return Object.fromEntries(
    definition.fields
      .filter((field) => field.kind !== 'object')
      .map((field) => [
        field.dbName || field.name,
        !field.isRequired
          ? null
          : field.type === 'DateTime'
            ? '2026-10-24T08:30:00.123'
            : field.type === 'Int'
              ? 1
              : field.type === 'Json'
                ? []
                : '',
      ]),
  );
}

function setup() {
  const directory: Prisma.JsonObject = {
    ...model('UserDirectory'),
    user_id: 'snapshot-unit',
    username: 'unit',
    synced_at: new Date().toISOString(),
  };
  const row = {
    enterprise: {
      ...model('EnterpriseProfile'),
      user_id: 'snapshot-unit',
      status: 'APPROVED',
    },
    providerApps: [
      {
        ...model('ProviderApplication'),
        user_id: 'snapshot-unit',
        status: 'APPROVED',
        provider_type: 'TAX_FINANCE',
        service_items: '',
      },
    ],
    staffProfile: model('StaffProfile'),
    staffOf: [
      {
        ...model('ProviderStaff'),
        staff_user_id: 'snapshot-unit',
        status: 'ACTIVE',
      },
    ],
    pref: {
      ...model('IdentityPreference'),
      current_identity: 'SERVICE_PROVIDER',
    },
    directory,
    flexPayrollEnabled: true,
  };
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([row]),
    userDirectory: {
      findUnique: jest.fn(),
      upsert: jest.fn().mockResolvedValue(null),
    },
  };
  return { prisma, row };
}

describe('single query identity snapshot', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.mocked(httpRequest).mockReset();
  });

  it.each([
    'EnterpriseProfile',
    'ProviderApplication',
    'StaffProfile',
    'ProviderStaff',
    'IdentityPreference',
    'UserDirectory',
    'SystemSetting',
  ])('invalidates the request snapshot when %s changes', (name) => {
    expect(isIdentityWrite(name, 'update')).toBe(true);
    expect(isIdentityWrite(name, 'deleteMany')).toBe(true);
    expect(isIdentityWrite(name, 'findUnique')).toBe(false);
  });

  it('maps all model columns, JSON and UTC dates without changing the response types', async () => {
    const { prisma } = setup();
    const snapshot = await readIdentitySnapshot(
      prisma as never,
      'snapshot-unit',
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(snapshot.enterprise).toMatchObject({
      userId: 'snapshot-unit',
      createdAt: new Date('2026-10-24T08:30:00.123Z'),
      auditedAt: null,
    });
    expect(snapshot.providerApps[0]).toMatchObject({
      itemAudits: [],
      businessStaff: [],
      attachments: [],
      serviceItems: '',
    });
    expect(snapshot.staffProfile?.updatedAt).toEqual(
      new Date('2026-10-24T08:30:00.123Z'),
    );
    expect(snapshot.directory?.syncedAt).toBeInstanceOf(Date);
  });

  it('binds user ids as parameters including SQL punctuation', async () => {
    const { prisma } = setup();
    const id = "unit' OR 1=1 --";
    await readIdentitySnapshot(prisma as never, id);
    const query = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.sql).not.toContain(id);
    expect(query.values.filter((value) => value === id)).toHaveLength(6);
    expect(query.sql).toContain("e.status = 'APPROVED'");
    expect(query.sql).toContain("s.status = 'ACTIVE'");
    expect(query.sql).toContain('ORDER BY e.id DESC LIMIT 1');
    expect(query.sql).toContain('ORDER BY p.id DESC');
  });

  it('shares the snapshot only within one request and reloads after an identity write', async () => {
    const { prisma } = setup();
    await runInRequestContext(async () => {
      const first = readIdentitySnapshot(prisma as never, 'snapshot-unit');
      expect(readIdentitySnapshot(prisma as never, 'snapshot-unit')).toBe(
        first,
      );
      await first;
      clearRequestMemo();
      await readIdentitySnapshot(prisma as never, 'snapshot-unit');
    });
    await runInRequestContext(() =>
      readIdentitySnapshot(prisma as never, 'snapshot-unit'),
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it('does not retain failed snapshots and never falls back to an authorized identity', async () => {
    const { prisma } = setup();
    prisma.$queryRaw.mockRejectedValueOnce(new Error('database unavailable'));
    await runInRequestContext(async () => {
      await expect(
        readIdentitySnapshot(prisma as never, 'snapshot-unit'),
      ).rejects.toThrow('database unavailable');
      await readIdentitySnapshot(prisma as never, 'snapshot-unit');
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it.each([
    'missing-field',
    'invalid-date',
    'invalid-list',
    'missing-result',
    'invalid-flag',
  ])('rejects an incomplete snapshot: %s', async (kind) => {
    const { prisma, row } = setup();
    if (kind === 'missing-field') delete row.directory.username;
    if (kind === 'invalid-date') row.directory.created_at = 'invalid';
    if (kind === 'invalid-list') Object.assign(row, { providerApps: null });
    if (kind === 'invalid-flag')
      Object.assign(row, { flexPayrollEnabled: null });
    if (kind === 'missing-result') prisma.$queryRaw.mockResolvedValue([]);
    await expect(
      readIdentitySnapshot(prisma as never, 'snapshot-unit'),
    ).rejects.toThrow();
  });
});

describe('first identity response with real authentication and directory services', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.JWT_SECRET = 'isolated-snapshot-unit-key';
    process.env.JWT_ISSUER = 'aipdd-java-core';
    delete process.env.ADMIN_USER_IDS;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    jest.mocked(httpRequest).mockReset();
  });

  const token = () =>
    sign(
      {
        userId: 'snapshot-unit',
        username: 'unit',
        role: 'user',
        type: 'access',
      },
      process.env.JWT_SECRET!,
      { issuer: 'aipdd-java-core', expiresIn: 3600 },
    );

  it('uses one query for cold directory, full qualifications, preference and flags', async () => {
    const { prisma } = setup();
    const users = new UserLookupService(prisma as never);
    const auth = new AuthService(prisma as never, users);
    const identity = new IdentityService(prisma as never, users, {} as never);
    const me = await runInRequestContext(async () => {
      const user = await auth.authenticate('GET', '/enterprise/me', token());
      return identity.me(user!);
    });
    expect(me).toMatchObject({
      username: 'unit',
      currentIdentity: 'SERVICE_PROVIDER',
      roles: ['ENTERPRISE_USER', 'SERVICE_PROVIDER', 'PROVIDER_STAFF'],
      platformFlags: { flexPayrollEnabled: true },
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.userDirectory.findUnique).not.toHaveBeenCalled();
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it('rejects a locally disabled account without exposing a successful identity response', async () => {
    const { prisma, row } = setup();
    row.directory.enabled = 0;
    const users = new UserLookupService(prisma as never);
    const auth = new AuthService(prisma as never, users);
    const identity = new IdentityService(prisma as never, users, {} as never);
    await expect(
      runInRequestContext(async () => {
        const user = await auth.authenticate('GET', '/enterprise/me', token());
        return identity.me(user!);
      }),
    ).rejects.toThrow('user disabled');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('still waits for remote disable checks when the directory synchronization is stale', async () => {
    const { prisma, row } = setup();
    row.directory.synced_at = null;
    let finish!: (value: Awaited<ReturnType<typeof httpRequest>>) => void;
    const started = new Promise<void>((resolve) => {
      jest.mocked(httpRequest).mockImplementation(() => {
        resolve();
        return new Promise((yes) => {
          finish = yes;
        });
      });
    });
    const users = new UserLookupService(prisma as never);
    const auth = new AuthService(prisma as never, users);
    const identity = new IdentityService(prisma as never, users, {} as never);
    let finished = false;
    const response = runInRequestContext(async () => {
      const user = await auth.authenticate('GET', '/enterprise/me', token());
      return identity.me(user!);
    }).then(
      () => {
        finished = true;
        return 'allowed';
      },
      (error: Error) => {
        finished = true;
        return error.message;
      },
    );
    await started;
    expect(finished).toBe(false);
    finish({
      status: 200,
      ok: true,
      headers: new Headers(),
      data: { code: 0, data: { enabled: false } },
    });
    expect(await response).toBe('user disabled');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe('renewed first identity through the HTTP authentication boundary', () => {
  const previous = { ...process.env };
  let sequence = 0;
  beforeEach(() => {
    process.env.JWT_SECRET = 'isolated-refresh-snapshot-key';
    process.env.JWT_ISSUER = 'aipdd-java-core';
    delete process.env.ADMIN_USER_IDS;
    jest.mocked(httpRequest).mockReset();
  });
  afterEach(() => {
    process.env = { ...previous };
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function application() {
    const fixture = setup();
    const users = new UserLookupService(fixture.prisma as never);
    const identity = new IdentityService(
      fixture.prisma as never,
      users,
      {} as never,
    );
    const services = createServices();
    services.prisma = fixture.prisma as never;
    services.users = users;
    services.controllers.identityController = new IdentityController(identity);
    return { ...fixture, app: createApp(services) };
  }
  function credential(
    type: string,
    userId = 'snapshot-unit',
    expiresIn = 3600,
    secret = process.env.JWT_SECRET!,
  ) {
    return sign(
      { type, userId, username: 'unit', role: 'user', jti: String(++sequence) },
      secret,
      { issuer: 'aipdd-java-core', expiresIn },
    );
  }
  function reply(access = credential('access')) {
    return {
      status: 200,
      ok: true,
      headers: new Headers(),
      data: { code: 0, data: { token: access } },
    };
  }
  function headers() {
    return { cookie: `aiworkin_refresh_token=${credential('refresh')}` };
  }

  it.each([
    [3500, 1000],
    [500, 1200],
  ])(
    'overlaps %i ms renewal with %i ms database work while awaiting both complete checks',
    async (refreshMs, dbMs) => {
      jest.useFakeTimers();
      const { prisma, row, app } = application();
      const response = reply();
      jest
        .mocked(httpRequest)
        .mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve(response), refreshMs),
            ),
        );
      prisma.$queryRaw.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([row]), dbMs)),
      );
      let completed = false;
      const started = Date.now();
      const pending = Promise.resolve(
        app.request('/api/backend/enterprise/me', { headers: headers() }),
      ).then((r) => {
        completed = true;
        return r;
      });
      await jest.advanceTimersByTimeAsync(Math.max(refreshMs, dbMs) - 1);
      expect(completed).toBe(false);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      const result = await pending;
      expect(result.status).toBe(200);
      expect(await result.json()).toMatchObject({
        code: 0,
        data: {
          userId: 'snapshot-unit',
          roles: ['ENTERPRISE_USER', 'SERVICE_PROVIDER', 'PROVIDER_STAFF'],
        },
      });
      expect(Date.now() - started).toBe(Math.max(refreshMs, dbMs));
      expect(result.headers.get('set-cookie')).toContain('aiworkin_token=');
      expect(httpRequest).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects refused renewal even after a successful prefetched identity read', async () => {
    const { prisma, app } = application();
    jest.mocked(httpRequest).mockResolvedValue({
      status: 401,
      ok: false,
      headers: new Headers(),
      data: { code: 401 },
    });
    const result = await app.request('/api/backend/enterprise/me', {
      headers: headers(),
    });
    expect(result.status).toBe(401);
    expect(result.headers.get('set-cookie')).toBeNull();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(await result.json()).toMatchObject({ code: 401, data: null });
  });

  it.each(['bad-signature', 'expired', 'wrong-type'])(
    'rejects a %s replacement access token despite a successful prefetch',
    async (kind) => {
      jest.useFakeTimers();
      const { prisma, app } = application();
      jest
        .mocked(httpRequest)
        .mockResolvedValue(
          reply(
            credential(
              kind === 'wrong-type' ? 'refresh' : 'access',
              'snapshot-unit',
              kind === 'expired' ? -60 : 3600,
              kind === 'bad-signature'
                ? 'wrong-secret'
                : process.env.JWT_SECRET,
            ),
          ),
        );
      const pending = app.request('/api/backend/enterprise/me', {
        headers: headers(),
      });
      await jest.advanceTimersByTimeAsync(1100);
      const result = await pending;
      expect(result.status).toBe(503);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(result.headers.get('set-cookie')).toBeNull();
      expect(await result.json()).toMatchObject({ code: 503, data: null });
    },
  );

  it('keeps a locally disabled account forbidden after successful renewal', async () => {
    const { row, app } = application();
    row.directory.enabled = 0;
    jest.mocked(httpRequest).mockResolvedValue(reply());
    const result = await app.request('/api/backend/enterprise/me', {
      headers: headers(),
    });
    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({
      code: 403,
      message: 'user disabled',
      data: null,
    });
  });

  it('waits for the upstream disabled-account check after renewal if directory data is stale', async () => {
    const { row, app } = application();
    row.directory.synced_at = null;
    jest
      .mocked(httpRequest)
      .mockResolvedValueOnce(reply())
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: new Headers(),
        data: { code: 0, data: { enabled: false } },
      });
    const result = await app.request('/api/backend/enterprise/me', {
      headers: headers(),
    });
    expect(result.status).toBe(403);
    expect(httpRequest).toHaveBeenCalledTimes(2);
    expect(await result.json()).toMatchObject({
      message: 'user disabled',
      data: null,
    });
  });

  it('does not use a different subject snapshot to authorize the renewed account', async () => {
    const { prisma, row, app } = application();
    prisma.$queryRaw.mockImplementation((query: Prisma.Sql) =>
      Promise.resolve(
        query.values.includes('different-subject')
          ? [
              {
                ...row,
                directory: {
                  ...row.directory,
                  user_id: 'different-subject',
                  enabled: 0,
                },
                enterprise: null,
                providerApps: [],
                staffProfile: null,
                staffOf: [],
                pref: null,
              },
            ]
          : [row],
      ),
    );
    jest
      .mocked(httpRequest)
      .mockResolvedValue(reply(credential('access', 'different-subject')));
    const result = await app.request('/api/backend/enterprise/me', {
      headers: headers(),
    });
    expect(result.status).toBe(403);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('fails closed if the prefetched database read and the authenticated retry both fail', async () => {
    const { prisma, app } = application();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    prisma.$queryRaw.mockRejectedValue(new Error('database unavailable'));
    jest.mocked(httpRequest).mockImplementation(async () => {
      // Let the speculative failure evict its request-local entry before renewal returns.
      for (let i = 0; i < 6; i++) await Promise.resolve();
      return reply();
    });
    const result = await app.request('/api/backend/enterprise/me', {
      headers: headers(),
    });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect((await result.json()).data).toBeNull();
  });

  it('reloads qualifications and flags on the next request even if a renewal is shared', async () => {
    const { prisma, row, app } = application();
    jest.mocked(httpRequest).mockResolvedValue(reply());
    const sameSession = headers();
    expect(
      (
        await app.request('/api/backend/enterprise/me', {
          headers: sameSession,
        })
      ).status,
    ).toBe(200);
    row.providerApps = [];
    row.staffOf = [];
    row.enterprise = null as never;
    row.flexPayrollEnabled = false;
    const result = await app.request('/api/backend/enterprise/me', {
      headers: sameSession,
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      data: {
        roles: [],
        platformFlags: { flexPayrollEnabled: false },
      },
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(httpRequest).toHaveBeenCalledTimes(1);
  });
});
