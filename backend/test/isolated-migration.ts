import assert from 'node:assert/strict';
import { PrismaService } from '../src/prisma/prisma.service';
import { allocateNo } from '../src/common/document-number';
import { createApp } from '../src/http/app';
import { createServices } from '../src/http/services';
import { sign } from 'jsonwebtoken';
async function run() {
  const url = new URL(process.env.DATABASE_URL || '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.match(url.pathname, /^\/enterprise_migration_\d+_\d+$/);
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const day = new Date('2026-10-23T09:00:00Z');
    await prisma.assetRequest.create({
      data: {
        requestNo: 'ZJ20261023-0042',
        title: '隔离测试',
        description: 'isolated',
        createdBy: 'isolated',
        subCategoryId: 'isolated',
      },
    });
    const numbers = await Promise.all(
      Array.from({ length: 80 }, () => allocateNo(prisma, 'ZJ', day)),
    );
    assert.equal(new Set(numbers).size, 80);
    assert.equal([...numbers].sort()[0], 'ZJ20261023-0043');
    assert.equal([...numbers].sort().at(-1), 'ZJ20261023-0122');
    await prisma.assetRequest.deleteMany();
    assert.equal(await allocateNo(prisma, 'ZJ', day), 'ZJ20261023-0123');
    const services = createServices();
    const app = createApp(services);
    const health = await app.request('/health/ready');
    assert.equal(health.status, 200);
    const docs = await app.request('/api/openapi.json');
    assert.equal(docs.status, 200);
    const first = await prisma.enterpriseProfile.create({
      data: {
        userId: 'isolated-owner',
        name: 'Owner',
        uscc: 'isolated-one',
        status: 'APPROVED',
      },
    });
    const other = await prisma.enterpriseProfile.create({
      data: {
        userId: 'isolated-other',
        name: 'Other',
        uscc: 'isolated-two',
        status: 'APPROVED',
      },
    });
    await prisma.contract.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        contractNo: `isolated-${i}`,
        enterpriseId: first.id,
        providerUserId: 'isolated-provider',
        serviceType: 'LOGISTICS',
        status: i % 2 ? 'ACTIVE' : 'PENDING',
      })),
    });
    const headers = {
      authorization: `Bearer ${sign({ userId: 'isolated-owner', username: 'isolated-owner', type: 'access' }, process.env.JWT_SECRET!, { issuer: 'aipdd-java-core', expiresIn: 3600 })}`,
    };
    const list = await app.request(
      '/api/backend/enterprise/contracts?page=2&pageSize=2',
      { headers },
    );
    assert.equal(list.status, 200);
    const page = await list.json();
    assert.equal(page.data.list.length, 2);
    assert.equal(page.data.total, 5);
    assert.equal(page.data.page, 2);
    const stats = await (
      await app.request('/api/backend/enterprise/contracts/stats', { headers })
    ).json();
    assert.deepEqual(stats.data, { total: 5, active: 2, pending: 3 });
    const samples: {
      path: string;
      create: (enterpriseId: number, index: number) => Promise<{ id: number }>;
      hiddenStatus?: number;
      detailPath?: string;
    }[] = [
      {
        path: 'marketing',
        create: (enterpriseId: number, index: number) =>
          prisma.marketingOrder.create({
            data: {
              enterpriseId,
              orderNo: `mk-${index}`,
              createdBy: index < 3 ? 'isolated-owner' : 'isolated-other',
              title: `sample ${index}`,
              description: 'isolated',
            },
          }),
      },
      {
        path: 'logistics',
        create: (enterpriseId: number, index: number) =>
          prisma.logisticsOrder.create({
            data: {
              enterpriseId,
              orderNo: `lo-${index}`,
              createdBy: index < 3 ? 'isolated-owner' : 'isolated-other',
              title: `sample ${index}`,
              remark: 'isolated',
            },
          }),
      },
      {
        path: 'smart',
        create: (enterpriseId: number, index: number) =>
          prisma.smartServiceOrder.create({
            data: {
              enterpriseId,
              orderNo: `sm-${index}`,
              createdBy: index < 3 ? 'isolated-owner' : 'isolated-other',
              title: `sample ${index}`,
              description: 'isolated',
            },
          }),
      },
      {
        path: 'asset',
        create: (enterpriseId: number, index: number) =>
          prisma.assetRequest.create({
            data: {
              enterpriseId,
              requestNo: `as-${index}`,
              createdBy: index < 3 ? 'isolated-owner' : 'isolated-other',
              title: `sample ${index}`,
              description: 'isolated',
            },
          }),
      },
      {
        path: 'legal/requests',
        create: (enterpriseId: number, index: number) =>
          prisma.legalRequest.create({
            data: {
              enterpriseId,
              requestNo: `le-${index}`,
              createdBy: index < 3 ? 'isolated-owner' : 'isolated-other',
              title: `sample ${index}`,
            },
          }),
      },
      {
        path: 'ip/requests',
        create: (enterpriseId: number, index: number) =>
          prisma.ipRequest.create({
            data: {
              enterpriseId,
              requestNo: `ip-${index}`,
              createdBy: index < 3 ? 'isolated-owner' : 'isolated-other',
              title: `sample ${index}`,
            },
          }),
      },
      {
        path: 'flex/work-orders',
        create: (enterpriseId: number, index: number) =>
          prisma.flexWorkOrder.create({
            data: {
              enterpriseId,
              orderNo: `fl-${index}`,
              createdBy: index < 3 ? 'isolated-owner' : 'isolated-other',
              title: `sample ${index}`,
              description: 'isolated',
            },
          }),
      },

      {
        path: 'overseas',
        create: (enterpriseId: number, index: number) =>
          prisma.overseasClaim.create({
            data: {
              enterpriseId,
              claimNo: `oc-${index}`,
              contractId: 0,
              providerUserId: 'isolated-provider',
              serviceType: 'EXPORT_REFUND',
              remark: 'isolated',
            },
          }),
      },
      {
        path: 'flex/onboardings',
        create: (enterpriseId: number) =>
          prisma.flexOnboarding.create({
            data: {
              enterpriseId,
              contractId: 0,
              providerUserId: 'isolated-provider',
            },
          }),
      },
      {
        path: 'flex/payrolls',
        create: (enterpriseId: number, index: number) =>
          prisma.flexPayroll.create({
            data: {
              enterpriseId,
              payrollNo: `fp-${index}`,
              contractId: 0,
              providerUserId: 'isolated-provider',
            },
          }),
      },
      {
        path: 'supply/orders',
        create: (enterpriseId: number, index: number) =>
          prisma.supplyOrder.create({
            data: {
              enterpriseId,
              orderNo: `so-${index}`,
              createdBy: index < 3 ? 'isolated-owner' : 'isolated-other',
              providerUserId: 'isolated-provider',
              stationId: 0,
              expectedDate: '2026-10-23',
            },
          }),
      },
      {
        path: 'supply/bookings',
        create: (enterpriseId: number, index: number) =>
          prisma.supplyBooking.create({
            data: {
              enterpriseId,
              bookingNo: `sb-${index}`,
              createdBy: index < 3 ? 'isolated-owner' : 'isolated-other',
              providerUserId: 'isolated-provider',
              stationId: 0,
              serviceId: 0,
              planDate: '2026-10-23',
              siteAddress: 'isolated',
            },
          }),
      },
      {
        path: 'tax/decls',
        detailPath: 'tax/declarations',
        hiddenStatus: 403,
        create: (enterpriseId: number, index: number) =>
          prisma.taxDeclaration.create({
            data: {
              enterpriseId,
              declNo: `td-${index}`,
              contractId: 0,
              providerUserId: 'isolated-provider',
              taxType: 'VAT',
            },
          }),
      },
    ];
    await prisma.systemSetting.create({
      data: { key: 'flex_payroll_enabled', value: 'true' },
    });
    const adminHeaders = {
      authorization: `Bearer ${sign({ userId: 'isolated-admin', username: 'admin', role: 'admin', type: 'access' }, process.env.JWT_SECRET!, { issuer: 'aipdd-java-core', expiresIn: 3600 })}`,
    };
    for (const sample of samples) {
      const records = await Promise.all(
        [0, 1, 2, 3].map((index) =>
          sample.create(index < 3 ? first.id : other.id, index),
        ),
      );
      const path = `/api/backend/enterprise/${sample.path}`;
      const adminPage = await app.request(`${path}/page?pageSize=2`, {
        headers: adminHeaders,
      });
      assert.equal(adminPage.status, 200, `admin ${sample.path}`);
      const adminResult = await adminPage.json();
      assert.equal(adminResult.data.total, 4, `admin total ${sample.path}`);
      const adminStats = await (
        await app.request(`${path}/stats`, { headers: adminHeaders })
      ).json();
      assert.equal(adminStats.data.total, 4, `admin stats ${sample.path}`);
      const response = await app.request(`${path}/page?page=2&pageSize=2`, {
        headers,
      });
      assert.equal(response.status, 200, sample.path);
      const result = await response.json();
      assert.equal(result.data.total, 3, sample.path);
      assert.equal(result.data.list.length, 1, sample.path);
      assert.equal(
        (
          await app.request(
            `/api/backend/enterprise/${sample.detailPath ?? sample.path}/${records[3].id}`,
            { headers },
          )
        ).status,
        sample.hiddenStatus ?? 404,
        sample.path,
      );
      assert.equal(
        (
          await app.request(
            `/api/backend/enterprise/${sample.detailPath ?? sample.path}/${records[0].id}`,
            { headers },
          )
        ).status,
        200,
        sample.path,
      );
      const summary = await (
        await app.request(`${path}/stats`, { headers })
      ).json();
      assert.equal(summary.data.total, 3, sample.path);
      assert.equal(
        (await app.request(`${path}/page?pageSize=201`, { headers })).status,
        422,
        sample.path,
      );
    }
    const publishedServices = await Promise.all(
      [0, 1, 2, 3].map((index) =>
        prisma.providerServiceListing.create({
          data: {
            serviceNo: `svc-${index}`,
            domain: 'MARKETING',
            createdBy: index < 3 ? 'isolated-owner' : 'isolated-other',
            providerUserId: index < 3 ? 'isolated-owner' : 'isolated-other',
            subCategoryId: 'isolated-category',
            title: `Service ${index}`,
            description: 'isolated',
            highlights: '',
            cases: '',
            referenceLinks: '',
          },
        }),
      ),
    );
    const servicePage = await app.request(
      '/api/backend/enterprise/services/page?page=2&pageSize=2',
      { headers },
    );
    assert.equal(servicePage.status, 200);
    const serviceResult = await servicePage.json();
    assert.equal(serviceResult.data.total, 3);
    assert.equal(serviceResult.data.list.length, 1);
    assert.equal(
      (
        await app.request(
          `/api/backend/enterprise/services/${publishedServices[0].id}`,
          { headers },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await app.request(
          `/api/backend/enterprise/services/${publishedServices[3].id}`,
          { headers },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await app.request(
          '/api/backend/enterprise/services/page?pageSize=201',
          { headers },
        )
      ).status,
      422,
    );
    await prisma.taxRecord.createMany({
      data: [0, 1, 2, 3].map((index) => ({
        userId: index < 3 ? 'isolated-owner' : 'isolated-other',
        kind: index === 0 ? 'REPORT' : 'CALC',
        title: `Record ${index}`,
        snapshot: { summary: 'isolated' },
      })),
    });
    const recordPage = await app.request(
      '/api/backend/enterprise/tax/records/page?page=2&pageSize=2',
      { headers },
    );
    assert.equal(recordPage.status, 200);
    const recordResult = await recordPage.json();
    assert.equal(recordResult.data.total, 3);
    assert.equal(recordResult.data.list.length, 1);
    const filteredRecords = await (
      await app.request('/api/backend/enterprise/tax/records/page?kind=CALC', {
        headers,
      })
    ).json();
    assert.equal(filteredRecords.data.total, 2);
    await prisma.invoiceRequest.createMany({
      data: [0, 1, 2, 3].map((index) => ({
        reqNo: `invoice-${index}`,
        enterpriseId: index < 3 ? first.id : other.id,
        enterpriseName: 'isolated',
        requestedBy: index < 3 ? 'isolated-owner' : 'isolated-other',
        providerUserId: 'isolated-provider',
        staffUserId: 'isolated-staff',
        buyerName: 'Buyer',
        items: [],
        status: index === 0 ? 'ISSUED' : 'REQUESTED',
      })),
    });
    const invoicePage = await app.request(
      '/api/backend/enterprise/invoice-requests/page?page=2&pageSize=2',
      { headers },
    );
    assert.equal(invoicePage.status, 200);
    const invoiceResult = await invoicePage.json();
    assert.equal(invoiceResult.data.total, 3);
    assert.equal(invoiceResult.data.list.length, 1);
    const invoiceStats = await (
      await app.request('/api/backend/enterprise/invoice-requests/stats', {
        headers,
      })
    ).json();
    assert.equal(invoiceStats.data.total, 3);
    assert.equal(invoiceStats.data.byStatus.REQUESTED, 2);
    const foreignInvoices = await (
      await app.request(
        `/api/backend/enterprise/invoice-requests/page?enterpriseId=${other.id}`,
        { headers },
      )
    ).json();
    assert.equal(foreignInvoices.data.total, 0);
    assert.equal(
      (
        await app.request(
          '/api/backend/enterprise/invoice-requests/page?pageSize=201',
          { headers },
        )
      ).status,
      422,
    );
    for (const resource of ['account-sets', 'material-packs']) {
      const rows = await Promise.all(
        [0, 1, 2, 3].map((index) =>
          resource === 'account-sets'
            ? prisma.accountSet.create({
                data: {
                  name: `Set ${index}`,
                  enterpriseId: index < 3 ? first.id : other.id,
                  providerUserId: 'isolated-provider',
                },
              })
            : prisma.taxMaterialPack.create({
                data: {
                  packNo: `pack-${index}`,
                  contractId: 0,
                  enterpriseId: index < 3 ? first.id : other.id,
                  providerUserId: 'isolated-provider',
                  period: `2026-${index}`,
                  payload: { payroll: [], invoices: [], bank: [] },
                  files: [],
                },
              }),
        ),
      );
      const path = `/api/backend/enterprise/tax/${resource}`;
      const response = await app.request(`${path}/page?page=2&pageSize=2`, {
        headers,
      });
      assert.equal(response.status, 200, resource);
      const page = await response.json();
      assert.equal(page.data.total, 3, resource);
      assert.equal(page.data.list.length, 1, resource);
      assert.equal(
        (await app.request(`${path}/${rows[0].id}`, { headers })).status,
        200,
        resource,
      );
      assert.equal(
        (await app.request(`${path}/${rows[3].id}`, { headers })).status,
        resource === 'account-sets' ? 404 : 403,
        resource,
      );
      assert.equal(
        (await app.request(`${path}/page?pageSize=201`, { headers })).status,
        422,
        resource,
      );
      const all = await (
        await app.request(`${path}/page?pageSize=2`, { headers: adminHeaders })
      ).json();
      assert.equal(all.data.total, 4, resource);
      if (resource === 'account-sets') {
        await prisma.taxPlan.createMany({
          data: [0, 1, 2].map((index) => ({
            accountSetId: rows[0].id,
            enterpriseId: first.id,
            providerUserId: 'isolated-provider',
            taxType: `TEST-${index}`,
            period: '2026-test',
            status: index < 2 ? 'DUE' : 'DONE',
          })),
        });
        const detail = await (
          await app.request(`${path}/${rows[0].id}`, { headers })
        ).json();
        assert.deepEqual(detail.data.plan_stats, {
          due: 2,
          in_progress: 0,
          done: 1,
        });
        assert.equal(detail.data.decl_summary.count, 3);
      }
    }
    await prisma.taxPlan.create({
      data: {
        enterpriseId: other.id,
        providerUserId: 'isolated-provider',
        taxType: 'VAT',
        period: '2026-10',
      },
    });
    const forbidden = await app.request(
      `/api/backend/enterprise/tax/plans?enterpriseId=${other.id}`,
      { headers },
    );
    assert.equal(forbidden.status, 200);
    const hidden = await forbidden.json();
    assert.equal(hidden.data.total, 0);
    assert.deepEqual(hidden.data.list, []);
    await prisma.providerApplication.createMany({
      data: [0, 1, 2].flatMap((account) =>
        ['LOGISTICS', 'SMART_SERVICE', 'ASSET_TRADE'].map(
          (providerType, index) => ({
            userId: `admin-page-provider-${account}`,
            providerType,
            orgName: `Provider ${account}`,
            intro: 'isolated',
            status: index === 2 ? 'DELISTED' : 'APPROVED',
          }),
        ),
      ),
    });
    await prisma.providerApplication.create({
      data: {
        userId: 'admin-page-pending',
        providerType: 'LOGISTICS',
        orgName: 'Pending',
        intro: 'isolated',
      },
    });
    await prisma.enterpriseCapability.createMany({
      data: [first.id, other.id].flatMap((enterpriseId) =>
        ['E_TAX_FILING', 'E_INVOICING'].map((code) => ({
          enterpriseId,
          code,
          status: 'REQUESTED',
        })),
      ),
    });
    const adminPages = [
      ['contracts/page', await prisma.contract.count()],
      ['provider-applications/page', await prisma.providerApplication.count()],
      [
        'enterprises/capabilities/page',
        await prisma.enterpriseProfile.count({ where: { status: 'APPROVED' } }),
      ],
      ['capability-requests/page', 4],
      ['providers/page', 3],
    ] as const;
    for (const [resource, total] of adminPages) {
      const path = `/api/backend/enterprise/admin/${resource}`;
      const response = await app.request(`${path}?page=2&pageSize=1`, {
        headers: adminHeaders,
      });
      assert.equal(response.status, 200, resource);
      const result = await response.json();
      assert.equal(result.data.total, total, resource);
      assert.equal(result.data.list.length, 1, resource);
      assert.equal(result.data.page, 2, resource);
      if (resource === 'providers/page')
        assert.equal(
          result.data.list[0].services.length,
          3,
          '同账号的资质不得跨页拆开',
        );
      assert.equal(
        (await app.request(path, { headers })).status,
        403,
        resource,
      );
      assert.equal(
        (await app.request(`${path}?pageSize=201`, { headers: adminHeaders }))
          .status,
        422,
        resource,
      );
    }
    const providerStats = await (
      await app.request('/api/backend/enterprise/admin/providers/stats', {
        headers: adminHeaders,
      })
    ).json();
    assert.equal(providerStats.data.serviceTotal, 9);
    const summary = await (
      await app.request(
        '/api/backend/enterprise/supply/admin/overview?summariesOnly=1',
        { headers: adminHeaders },
      )
    ).json();
    assert.deepEqual(summary.data.orders, []);
    assert.deepEqual(summary.data.bookings, []);
    assert.equal(summary.data.totals.orders, await prisma.supplyOrder.count());
    assert.equal(
      summary.data.totals.bookings,
      await prisma.supplyBooking.count(),
    );
    assert(prisma.databaseMetrics.queryCount > 0, '必须记录真实 SQL 事件');
    await services.prisma.$disconnect();
  } finally {
    await prisma.$disconnect();
  }
}
void run().catch((error) => {
  console.error(error instanceof Error ? error.message : '隔离验证失败');
  process.exitCode = 1;
});
