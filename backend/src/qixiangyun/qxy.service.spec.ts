import { CurrentUser } from '../auth/current-user';
import { QxyClient } from './qxy.client';
import { QxyService } from './qxy.service';
import { QxySettingsService } from './qxy-settings.service';

describe('tax and invoice request construction', () => {
  const user = new CurrentUser('test-staff', 'test-staff', 'user');
  const enterprise = {
    id: 1,
    qxyOrgId: 'test-org',
    name: '测试企业',
    uscc: '913300000000000000',
  };
  const prisma = {
    enterpriseProfile: { findUnique: jest.fn().mockResolvedValue(enterprise) },
  };
  const identity = {
    canServeEnterprise: jest.fn().mockResolvedValue(true),
    audit: jest.fn().mockResolvedValue(undefined),
  };
  const capability = {
    ofEnterprise: jest.fn().mockResolvedValue([
      { code: 'E_TAX_FILING', status: 'OPEN' },
      { code: 'E_INVOICING', status: 'OPEN' },
    ]),
  };
  const client = {
    configured: jest.fn().mockReturnValue(true),
    call: jest.fn().mockResolvedValue({
      ok: true,
      code: 'OK',
      message: '',
      data: { taskId: 'test-task' },
    }),
  };
  const credentials = { appkey: 'pool-key', secret: 'pool-secret' };
  const accounts = {
    credentialsForTaxNo: jest.fn().mockResolvedValue(credentials),
  };
  const service = new QxyService(
    prisma as never,
    identity as never,
    capability as never,
    client as never,
    accounts as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    accounts.credentialsForTaxNo.mockResolvedValue(credentials);
    capability.ofEnterprise.mockResolvedValue([
      { code: 'E_TAX_FILING', status: 'OPEN' },
      { code: 'E_INVOICING', status: 'OPEN' },
    ]);
  });

  it('builds the tax filing period and required VAT revenue without submitting', async () => {
    await service.autoFileTax(user, 1, '2026-03', 'BDA0610606', '100.00');
    expect(client.call).toHaveBeenCalledWith(
      '/mcp/tax_init_calculation',
      'run_tax_calculation_and_filing',
      {
        aggOrgId: 'test-org',
        yzpzzlDm: 'BDA0610606',
        ssqQ: '2026-03-01',
        ssqZ: '2026-03-31',
        wkpxse: '100.00',
      },
      credentials,
    );
  });

  it('builds the invoice line amounts without submitting', async () => {
    await service.autoIssueInvoice(user, 1, {
      buyerName: '采购方',
      buyerTaxNo: '913300000000000001',
      orderNo: 'TEST-ORDER-1',
      items: [
        { goodsName: '技术服务', quantity: 2, price: 100, taxRate: '6%' },
      ],
    });
    expect(client.call).toHaveBeenCalledWith(
      '/mcp/blue_invoice',
      'issue_blue_invoice_auto',
      expect.objectContaining({
        aggOrgId: 'test-org',
        nsrsbh: enterprise.uscc,
        data: expect.objectContaining({
          gmf_nsrmc: '采购方',
          ly_ddbh: 'TEST-ORDER-1',
          xmmx: [expect.objectContaining({ je: 200, slv: '6', se: 12 })],
        }),
      }),
      credentials,
    );
  });

  it('blocks unapproved capabilities before building an upstream request', async () => {
    capability.ofEnterprise.mockResolvedValue([]);
    await expect(
      service.autoFileTax(user, 1, '2026-03', 'BDA0610606', '100.00'),
    ).rejects.toThrow('未开通');
    expect(client.call).not.toHaveBeenCalled();
  });

  it('fails fast when the tax number has no matched qixiangyun account', async () => {
    accounts.credentialsForTaxNo.mockResolvedValue(null);
    await expect(
      service.autoFileTax(user, 1, '2026-03', 'BDA0610606', '100.00'),
    ).rejects.toThrow('财税管理');
    expect(client.call).not.toHaveBeenCalled();
  });

  it('puts credentials in the MCP tool arguments for a local mock response', async () => {
    const oldKey = process.env.QXY_APPKEY;
    const oldSecret = process.env.QXY_SECRET;
    const oldBase = process.env.QXY_MCP_BASE;
    process.env.QXY_APPKEY = 'test-key';
    process.env.QXY_SECRET = 'test-secret';
    process.env.QXY_MCP_BASE = 'http://127.0.0.1:1';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { structuredContent: { success: true, code: 'OK' } },
        }),
        { status: 200 },
      ),
    );
    try {
      const oldEncryptionKey = process.env.EXTERNAL_CRED_KEY;
      process.env.EXTERNAL_CRED_KEY = 'unit-encryption-key';
      const settings = new QxySettingsService(
        {
          systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
        } as never,
        {} as never,
      );
      if (oldEncryptionKey === undefined) delete process.env.EXTERNAL_CRED_KEY;
      else process.env.EXTERNAL_CRED_KEY = oldEncryptionKey;
      await new QxyClient(settings).call(
        '/mcp/blue_invoice',
        'issue_blue_invoice_auto',
        {
          data: { ly_ddbh: 'TEST-ORDER-1' },
        },
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(
        'http://127.0.0.1:1/mcp/blue_invoice-http',
      );
      const rawBody = fetchMock.mock.calls[0][1]?.body;
      if (typeof rawBody !== 'string')
        throw new Error('MCP request body missing');
      const body = JSON.parse(rawBody) as {
        method: string;
        params: { name: string; arguments: Record<string, unknown> };
      };
      expect(body.method).toBe('tools/call');
      expect(body.params.name).toBe('issue_blue_invoice_auto');
      expect(body.params.arguments).toMatchObject({
        client_appkey: 'test-key',
        client_secret: 'test-secret',
        data: { ly_ddbh: 'TEST-ORDER-1' },
      });
    } finally {
      fetchMock.mockRestore();
      if (oldKey === undefined) delete process.env.QXY_APPKEY;
      else process.env.QXY_APPKEY = oldKey;
      if (oldSecret === undefined) delete process.env.QXY_SECRET;
      else process.env.QXY_SECRET = oldSecret;
      if (oldBase === undefined) delete process.env.QXY_MCP_BASE;
      else process.env.QXY_MCP_BASE = oldBase;
    }
  });
});
