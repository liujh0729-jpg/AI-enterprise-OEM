import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sign } from 'jsonwebtoken';
import { endpoints } from '@enterprise/contracts';
import { createServices } from '../src/http/services';
import { createApp } from '../src/http/app';
import { loadSeedUsers } from '../src/directory/seed-users';
import { BUSINESS_IDENTITIES, SUBITEM_OWNERS } from '../src/common/constants';
import type { IdentitySnapshot } from '../src/identity/identity-snapshot';
import type { Qualifications } from '../src/identity/identity.service';
import { runInRequestContext } from '../src/common/request-context';
import { stub } from './doubles';

const url = new URL(process.env.DATABASE_URL || '');
assert.equal(url.hostname, '127.0.0.1');
assert.match(url.pathname, /^\/enterprise_page_audit_\d+_\d+$/);
assert.equal(process.env.ISOLATED_TEST, '1');
assert.equal(process.env.JAVA_BASE_URL, 'http://127.0.0.1:1');
assert.equal(process.env.AIWORKIN_ENABLED, 'false');
const services = createServices();
const prisma = services.prisma;
const app = createApp(services);
type Role = { key: string; id: string; role: string; identity: string };
const roles: Role[] = [];
const output: Record<string, unknown>[] = [];
const failures: string[] = [];
const parity: Record<string, unknown>[] = [];
const optimizedQualifications = services.identity.loadQualifications.bind(
  services.identity,
);
/** endpoints 的 response 是所有端点 schema 的并集，直接 `.safeParse` 会撑爆 tsc（TS2590）；收窄到本测试真正用到的接口。 */
function safeParseResponse(schema: unknown, value: unknown) {
  return (
    schema as { safeParse: (input: unknown) => { success: boolean } }
  ).safeParse(value);
}
// 原来的五次 Prisma 读取作为对照，身份推导继续使用同一业务实现。
async function legacyQualifications(userId: string) {
  const [enterprise, providerApps, staffProfile, staffOf, pref] =
    await Promise.all([
      prisma.enterpriseProfile.findFirst({
        where: { userId, status: 'APPROVED' },
        orderBy: { id: 'desc' },
      }),
      prisma.providerApplication.findMany({
        where: { userId },
        orderBy: { id: 'desc' },
      }),
      prisma.staffProfile.findUnique({ where: { userId } }),
      prisma.providerStaff.findMany({
        where: { staffUserId: userId, status: 'ACTIVE' },
      }),
      prisma.identityPreference.findUnique({ where: { userId } }),
    ]);
  return stub<{
    qualificationsFrom: (
      value: Pick<
        IdentitySnapshot,
        'enterprise' | 'providerApps' | 'staffProfile' | 'staffOf' | 'pref'
      >,
    ) => Qualifications;
  }>(services.identity).qualificationsFrom({
    enterprise,
    providerApps,
    staffProfile,
    staffOf,
    pref,
  });
}
const compareEndpoints = new Set([
  'Marketing_page',
  'Logistics_page',
  'SmartService_page',
  'Asset_page',
  'Legal_page',
  'Ip_page',
  'Flex_page',
  'Contracts_options',
]);
const info = console.info;
const metrics: { last?: Record<string, unknown> } = {};
const dbCallCount = () => metrics.last?.dbCallCount ?? null;
console.info = (...args: unknown[]) => {
  try {
    const parsed = JSON.parse(String(args[0]));
    if (parsed.event === 'http') metrics.last = parsed;
  } catch {
    /* no business values retained */
  }
};

async function run() {
  await prisma.$connect();
  for (const user of loadSeedUsers().values()) {
    await prisma.userDirectory.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        enabled: 1,
        syncedAt: new Date(),
      },
      update: { syncedAt: new Date() },
    });
  }
  for (const subjectType of ['COMPANY', 'INDIVIDUAL', 'PERSONAL']) {
    const id = `audit-${subjectType}`;
    await prisma.enterpriseProfile.create({
      data: { userId: id, name: id, uscc: '', subjectType, status: 'APPROVED' },
    });
    roles.push({
      key: subjectType,
      id,
      role: 'user',
      identity: 'ENTERPRISE_USER',
    });
  }
  const types = [
    'TAX_FINANCE',
    'EXPORT_REFUND',
    'LOGISTICS',
    'LEGAL_SERVICE',
    'IP_SERVICE',
    'FLEX_WORK',
    'MARKETING',
    'SUPPLY_NETWORK',
    'ASSET_TRADE',
    'SMART_SERVICE',
    'MICRO',
  ];
  for (const providerType of types) {
    const id = `audit-provider-${providerType}`;
    await prisma.providerApplication.create({
      data: {
        userId: id,
        providerType,
        orgName: id,
        intro: '',
        status: 'APPROVED',
        serviceItems: Object.entries(SUBITEM_OWNERS)
          .filter(([, owner]) =>
            owner.includes(
              providerType === 'MICRO' ? 'LOGISTICS' : providerType,
            ),
          )
          .map(([item]) => item)
          .join(','),
      },
    });
    roles.push({
      key: `provider-${providerType}`,
      id,
      role: 'user',
      identity: 'SERVICE_PROVIDER',
    });
  }
  roles.push(
    {
      key: 'provider-all',
      id: 'u-all',
      role: 'user',
      identity: 'SERVICE_PROVIDER',
    },
    { key: 'staff', id: 'u-staff', role: 'user', identity: 'PROVIDER_STAFF' },
    {
      key: 'unqualified',
      id: 'audit-unqualified',
      role: 'user',
      identity: 'ENTERPRISE_USER',
    },
    ...[...BUSINESS_IDENTITIES, 'PLATFORM_ADMIN'].map((identity) => ({
      key: `admin-${identity}`,
      id: 'u-admin',
      role: 'admin',
      identity,
    })),
  );
  // 种子别名不作为事实推断：这里核对实际 ID，并为新增主体登记本地目录。
  const seed = [...loadSeedUsers().values()];
  roles.find((r) => r.key === 'provider-all')!.id = seed.find(
    (u) => u.username === 'demo_all',
  )!.id;
  roles.find((r) => r.key === 'staff')!.id = seed.find(
    (u) => u.username === 'demo_staff',
  )!.id;
  roles.push({
    key: 'micro-personal',
    id: seed.find((u) => u.username === 'demo_agent')!.id,
    role: 'user',
    identity: 'SERVICE_PROVIDER',
  });
  for (const role of roles) {
    await prisma.userDirectory.upsert({
      where: { userId: role.id },
      create: {
        userId: role.id,
        username: role.id,
        displayName: '隔离审计账号',
        enabled: 1,
        syncedAt: new Date(),
      },
      update: { syncedAt: new Date() },
    });
  }
  // 只含本库读取接口；上游建联/GEO采集与敏感配置另行验证，避免将离线上游故障算作数据库结果。
  const prefixes = [
    'Admin_',
    'Asset_',
    'Capability_',
    'Contracts_',
    'Flex_',
    'Identity_',
    'Invoice_',
    'Ip_',
    'Legal_',
    'Logistics_',
    'Marketing_',
    'Overseas_',
    'Services_',
    'SmartService_',
    'Supply_',
    'Tax_',
  ];
  const skip = new Set(['Tax_currentMaterialPack', 'Identity_search']);
  const definitions = Object.entries(endpoints).filter(
    ([name, e]) =>
      e.method === 'get' &&
      !e.path.includes(':') &&
      !skip.has(name) &&
      prefixes.some((p) => name.startsWith(p)),
  );
  for (const role of roles) {
    await prisma.identityPreference.upsert({
      where: { userId: role.id },
      create: { userId: role.id, currentIdentity: role.identity },
      update: { currentIdentity: role.identity },
    });
    const headers = {
      authorization: `Bearer ${sign({ userId: role.id, username: role.id, role: role.role, type: 'access' }, process.env.JWT_SECRET!, { issuer: 'aipdd-java-core', expiresIn: 3600 })}`,
    };
    const me = await (await app.request('/enterprise/me', { headers })).json();
    if (role.key !== 'unqualified')
      assert.equal(me.data.currentIdentity, role.identity, role.key);
    for (const [name, definition] of definitions) {
      let baseline: { body: unknown; dbCalls: unknown } | undefined;
      if (compareEndpoints.has(name)) {
        services.identity.loadQualifications = legacyQualifications;
        try {
          const before = await app.request(definition.path, { headers });
          baseline = {
            body: await before.json(),
            dbCalls: metrics.last?.dbCallCount,
          };
        } finally {
          services.identity.loadQualifications = optimizedQualifications;
        }
      }
      metrics.last = undefined;
      const started = performance.now();
      const response = await app.request(definition.path, { headers });
      const body = await response.json();
      const row = {
        role: role.key,
        endpoint: name,
        status: response.status,
        code: body.code,
        elapsedMs: Math.round(performance.now() - started),
        dbCalls: dbCallCount(),
      };
      output.push(row);
      if (baseline) {
        try {
          assert.deepEqual(body, baseline.body);
        } catch {
          failures.push(`${role.key} ${name}: legacy response parity`);
        }
        parity.push({
          role: role.key,
          endpoint: name,
          beforeDbCalls: baseline.dbCalls,
          afterDbCalls: row.dbCalls,
          responseEqual: JSON.stringify(body) === JSON.stringify(baseline.body),
        });
      }
      if (response.status >= 500)
        failures.push(
          `${role.key} ${name}: ${response.status} ${body.message}`,
        );
      if (
        response.status === 200 &&
        !safeParseResponse(definition.response, body).success
      )
        failures.push(`${role.key} ${name}: response schema`);
      if (
        name.startsWith('Admin_') &&
        role.role !== 'admin' &&
        response.status !== 403
      )
        failures.push(`${role.key} ${name}: admin boundary ${response.status}`);
      if (
        role.key === 'PERSONAL' &&
        /^(Tax_|Overseas_)/.test(name) &&
        response.status !== 403
      )
        failures.push(
          `${role.key} ${name}: personal subject boundary ${response.status}`,
        );
    }
  }
  for (const [name, definition] of definitions) {
    const response = await app.request(definition.path);
    output.push({ role: 'anonymous', endpoint: name, status: response.status });
    if (response.status !== 401)
      failures.push(`anonymous ${name}: ${response.status}`);
  }
  const disabledId = 'audit-disabled';
  await prisma.userDirectory.create({
    data: {
      userId: disabledId,
      username: disabledId,
      displayName: '隔离禁用账号',
      enabled: 0,
      syncedAt: new Date(),
    },
  });
  const disabledToken = sign(
    { userId: disabledId, username: disabledId, role: 'user', type: 'access' },
    process.env.JWT_SECRET!,
    { issuer: 'aipdd-java-core', expiresIn: 3600 },
  );
  const disabledChecks: { path: string; status: number }[] = [];
  for (const path of [
    '/enterprise/me',
    '/enterprise/contracts',
    '/enterprise/marketing',
  ]) {
    const response = await app.request(path, {
      headers: { authorization: `Bearer ${disabledToken}` },
    });
    assert.equal(response.status, 403, `disabled account ${path}`);
    disabledChecks.push({ path, status: response.status });
  }
  const disabledKey = 'isolated-disabled-owner-key';
  await prisma.apiKey.create({
    data: {
      userId: disabledId,
      masked: 'isolated-disabled',
      keyHash: createHash('sha256').update(disabledKey).digest('hex'),
      keyPrefix: 'isolated',
      status: 'ACTIVE',
    },
  });
  const disabledApi = await app.request('/api/v1/contracts', {
    headers: { 'x-api-key': disabledKey },
  });
  assert.equal(disabledApi.status, 403, 'disabled API key owner');
  disabledChecks.push({
    path: '/api/v1/contracts',
    status: disabledApi.status,
  });
  let releaseWrite!: () => void;
  let startedWrite!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const started = new Promise<void>((resolve) => {
    startedWrite = resolve;
  });
  let holdWrite = true;
  prisma.$use(async (params, next) => {
    if (
      holdWrite &&
      params.model === 'IdentityPreference' &&
      /^update/.test(params.action)
    ) {
      holdWrite = false;
      startedWrite();
      await gate;
    }
    const result: unknown = await next(params);
    return result;
  });
  await runInRequestContext(async () => {
    const userId = 'u-admin';
    const previous = await services.identity.qualifications(userId);
    const desired =
      previous.preferredIdentity === 'ENTERPRISE_USER'
        ? 'SERVICE_PROVIDER'
        : 'ENTERPRISE_USER';
    const write = Promise.resolve(
      prisma.identityPreference.update({
        where: { userId },
        data: { currentIdentity: desired },
      }),
    );
    await started;
    try {
      assert.equal(
        (await services.identity.qualifications(userId)).preferredIdentity,
        previous.preferredIdentity,
      );
    } finally {
      releaseWrite();
    }
    await write;
    assert.equal(
      (await services.identity.qualifications(userId)).preferredIdentity,
      desired,
      'identity snapshot must refresh after a concurrent write commits',
    );
  });
  writeFileSync(
    join(process.env.PAGE_AUDIT_OUTPUT!, 'api-role-matrix.json'),
    JSON.stringify(
      {
        environment: 'isolated localhost PostgreSQL; upstream disabled',
        roles: roles.map((r) => r.key).concat('anonymous'),
        endpoints: definitions.length,
        cases: output.length,
        identityReadParity: parity,
        concurrentIdentityWriteInvalidation: 'passed',
        disabledAccountChecks: disabledChecks,
        failures,
        results: output,
        limitations: [
          '列表/统计/选项读取冒烟与管理员边界；不代表浏览器逐角色验收',
          '4xx 记录为拒绝或参数要求，不当作业务功能通过',
          '详情和跨主体可见性由隔离回归补充',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  info(
    `角色 ${roles.length + 1}，读取接口 ${definitions.length}，组合 ${output.length}，失败 ${failures.length}`,
  );
  assert.deepEqual(failures, []);
}
void run().finally(async () => {
  console.info = info;
  await prisma.$disconnect();
});
