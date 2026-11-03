import { InvoiceOcrService } from './invoice-ocr.service';
import { QxyOpenApiClient } from '../qixiangyun/qxy-openapi.client';

describe('Qixiangyun invoice OCR', () => {
  const client = { configured: jest.fn(), recognizeInvoice: jest.fn() };
  const service = new InvoiceOcrService(client as unknown as QxyOpenApiClient);
  const image = Buffer.alloc(48).toString('base64');
  const invoice = {
    fphm: '00123456789012345678',
    kprq: '2026-09-21 00:00:00',
    xfmc: '供应商',
    gfmc: '本 企业',
    je: 100,
    se: 6,
    jshj: 106,
    title: '电子发票',
    fpdm: '0123456789',
  };
  const respond = (fields: Record<string, unknown>) =>
    client.recognizeInvoice.mockResolvedValue({
      success: true,
      datas: [fields],
    });
  beforeEach(() => {
    jest.resetAllMocks();
    client.configured.mockResolvedValue(true);
    respond(invoice);
  });

  it('reads shared settings on every status check', async () => {
    await expect(service.status()).resolves.toMatchObject({
      mode: 'qixiangyun',
      configured: true,
    });
    client.configured.mockResolvedValue(false);
    await expect(service.status()).resolves.toMatchObject({
      configured: false,
      hint: expect.stringContaining('财税管理'),
    });
  });

  it('maps documented fields without truncating invoice numbers', async () => {
    await expect(
      service.recognize(image, 'image/jpeg', '本企业'),
    ).resolves.toMatchObject({
      invoiceNo: invoice.fphm,
      date: '2026-09-21',
      kind: '进项',
      counterparty: '供应商',
      amount: 100,
      tax: 6,
      mode: 'qixiangyun',
      extra: { 发票代码: invoice.fpdm, 价税合计: '106' },
    });
    expect(client.recognizeInvoice).toHaveBeenCalledWith(image);
  });

  it('infers outgoing invoices only for an exact normalized enterprise name', async () => {
    await expect(
      service.recognize(image, 'image/png', '供应商'),
    ).resolves.toMatchObject({ kind: '销项', counterparty: '本 企业' });
    await expect(
      service.recognize(image, 'image/png', '供应'),
    ).resolves.toMatchObject({ kind: '' });
  });

  it('preserves zero and negative amounts and computes missing pretax totals', async () => {
    respond({ ...invoice, je: 0, se: 0, jshj: 106 });
    await expect(
      service.recognize(image, 'image/jpeg', ''),
    ).resolves.toMatchObject({ amount: 0, tax: 0 });
    respond({ ...invoice, je: '-1,000.50', se: '-60.03' });
    await expect(
      service.recognize(image, 'image/jpeg', ''),
    ).resolves.toMatchObject({ amount: -1000.5, tax: -60.03 });
    respond({ ...invoice, je: null, se: 0, jshj: 106 });
    await expect(
      service.recognize(image, 'image/jpeg', ''),
    ).resolves.toMatchObject({ amount: 106, tax: 0 });
  });

  it.each(['20260921', '2026年9月21日', '2026/9/21'])(
    'normalizes date %s',
    async (date) => {
      respond({ ...invoice, kprq: date });
      await expect(
        service.recognize(image, 'image/jpeg', ''),
      ).resolves.toMatchObject({ date: '2026-09-21' });
    },
  );

  it('does not prefill an invalid calendar date or leak unlisted fields', async () => {
    respond({
      ...invoice,
      kprq: '2026-02-30',
      access_token: 'private-token',
      imageUrl: 'private-url',
    });
    const result = await service.recognize(image, 'image/jpeg', '');
    expect(result.date).toBe('');
    expect(JSON.stringify(result)).not.toContain('private-');
  });

  it.each([
    [{ success: false, message: 'private-token' }, '未能识别'],
    [{ success: true, datas: [] }, '未识别到'],
    [{ success: true, datas: [invoice, invoice] }, '多张票据'],
    [{ success: true, datas: [null] }, '未识别到'],
  ])(
    'rejects failed, empty or multiple-invoice responses',
    async (response, message) => {
      client.recognizeInvoice.mockResolvedValue(response);
      await expect(service.recognize(image, 'image/jpeg', '')).rejects.toThrow(
        message,
      );
    },
  );

  it('accepts the documented legacy single result and a full 8MiB image', async () => {
    client.recognizeInvoice.mockResolvedValue({ success: true, data: invoice });
    const full = Buffer.alloc(8 * 1024 * 1024).toString('base64');
    await expect(
      service.recognize(full, 'image/jpeg', ''),
    ).resolves.toMatchObject({ invoiceNo: invoice.fphm });
    expect(client.recognizeInvoice).toHaveBeenCalledWith(full);
  });

  it.each([
    [
      Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64'),
      'image/jpeg',
      '超过 8MB',
    ],
    ['not base64!'.repeat(10), 'image/jpeg', '内容无效'],
    [image, 'image/svg+xml', '仅支持'],
    [image, 'image/webp', '仅支持'],
    [Buffer.alloc(2).toString('base64'), 'image/png', '过小'],
  ])(
    'rejects invalid input before contacting the provider',
    async (value, mime, message) => {
      await expect(service.recognize(value, mime, '')).rejects.toThrow(message);
      expect(client.recognizeInvoice).not.toHaveBeenCalled();
    },
  );
});
