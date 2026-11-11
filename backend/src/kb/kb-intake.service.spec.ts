import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import { KbIntakeService } from './kb-intake.service';
import { KbSourceService } from './kb-source.service';
import type { KbSpaceService } from './kb-space.service';
import { httpRequest } from '../http/transport';
import { stub } from '../../test/doubles';

/**
 * P1-A 摄取管道单测：URL 抓取 / 文件上传（可读文档抽取 + 图片音视频诚实缺口）/
 * 飞书文档（未配凭据如实报错）/ assetId 断链修复（资产存正文后可直接编译）。
 */

jest.mock('../http/transport', () => ({ httpRequest: jest.fn() }));
jest.mock('../http/outbound-guard', () => ({
  assertOutboundUrl: jest.fn(async () => undefined),
}));

const mockedHttp = stub<jest.Mock>(httpRequest);
const user = { userId: 'u1' } as CurrentUser;

function makePrisma() {
  return {
    kbSource: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 1,
        createdAt: new Date('2026-11-01T00:00:00Z'),
        updatedAt: new Date('2026-11-01T00:00:00Z'),
        ingestedAt: null,
        assetId: 0,
        ossKey: '',
        originUrl: '',
        ...data,
      })),
    },
    kbLog: { create: jest.fn(async () => ({})) },
    digitalAssetEntry: { findUnique: jest.fn(async () => null) },
  };
}

function makeService(prisma = makePrisma()) {
  const spaces = {
    loadWritable: jest.fn(async (id: number) => ({
      id,
      visibility: 'PRIVATE',
    })),
  };
  const storage = {
    put: jest.fn(async (path: string) => ({
      key: path,
      url: `https://oss.example/${path}`,
      size: 10,
      contentType: '',
    })),
  };
  const sources = new KbSourceService(
    stub<PrismaService>(prisma),
    stub<KbSpaceService>(spaces),
  );
  const feishuCreds = jest.fn(async () => null);
  const service = new KbIntakeService(
    stub<KbSpaceService>(spaces),
    sources,
    stub<StorageService>(storage),
    feishuCreds,
  );
  return { service, prisma, spaces, storage, sources, feishuCreds };
}

describe('KbIntakeService 摄取管道', () => {
  beforeEach(() => mockedHttp.mockReset());

  it('URL 抓取：抽正文落行，type=URL 且带原始地址', async () => {
    mockedHttp.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers(),
      data: new TextEncoder().encode(
        '<html><head><title>退款说明</title></head><body><h1>退款</h1><p>收到货 7 日内可申请退款。</p></body></html>',
      ),
    });
    const { service, prisma } = makeService();
    const row = await service.addUrl(
      {
        spaceId: 3,
        url: 'https://example.com/refund',
        title: '',
        kind: 'article',
      },
      user,
    );
    expect(mockedHttp).toHaveBeenCalledWith(
      'https://example.com/refund',
      expect.objectContaining({ readAs: 'bytes', redirect: 'manual' }),
    );
    expect(row).toMatchObject({ type: 'URL', status: 'PENDING' });
    expect(row.originUrl).toBe('https://example.com/refund');
    expect(prisma.kbSource.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'URL',
          originUrl: 'https://example.com/refund',
        }),
      }),
    );
    expect(row.title).toBe('退款说明');
    expect(row.chars).toBeGreaterThan(0);
  });

  it('URL 抓取：抓不到正文如实报错，不编造', async () => {
    mockedHttp.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers(),
      data: new TextEncoder().encode(
        '<html><body><script>1</script></body></html>',
      ),
    });
    const { service } = makeService();
    await expect(
      service.addUrl(
        {
          spaceId: 3,
          url: 'https://example.com/x',
          title: '',
          kind: 'article',
        },
        user,
      ),
    ).rejects.toThrow('网页未抓取到可读正文');
  });

  it('文件上传：可读文档抽取正文，type=UPLOAD 且字节进 OSS 桶', async () => {
    const { service, storage } = makeService();
    const file = new File(
      [Buffer.from('# 标题\n\n这是投料的正文内容，用于检索。', 'utf8')],
      'note.md',
      { type: 'text/markdown' },
    );
    const row = await service.addUpload(file, { spaceId: 5 }, user);
    expect(storage.put).toHaveBeenCalled();
    expect(row).toMatchObject({ type: 'UPLOAD', status: 'PENDING' });
    expect(row.chars).toBeGreaterThan(0);
  });

  it('文件上传：图片落 OCR 类型并给明确缺口指引（不伪造成正文）', async () => {
    const { service } = makeService();
    const file = new File([Buffer.from('89504e47', 'hex')], 'scan.png', {
      type: 'image/png',
    });
    const row = await service.addUpload(file, { spaceId: 5 }, user);
    expect(row.type).toBe('OCR');
    expect(row.status).toBe('FAILED');
    expect(row.error).toContain('识别能力');
  });

  it('飞书导入：未配置应用凭据如实报错', async () => {
    const { service } = makeService();
    await expect(
      service.addFeishu(
        {
          spaceId: 1,
          url: 'https://feishu.cn/docx/abc123',
          token: '',
          title: '',
          kind: 'note',
        },
        user,
      ),
    ).rejects.toThrow('未配置飞书应用凭据');
  });

  it('assetId 断链修复：资产已存正文时可直接编译（状态 PENDING）', async () => {
    const prisma = makePrisma();
    prisma.digitalAssetEntry.findUnique = stub<
      typeof prisma.digitalAssetEntry.findUnique
    >(
      jest.fn(async () => ({
        id: 9,
        userId: 'u1',
        text: '资产抽取出来的正文',
        ossKey: 'enterprise/u1/library/9.pdf',
      })),
    );
    const sources = new KbSourceService(
      stub<PrismaService>(prisma),
      stub<KbSpaceService>({
        loadWritable: jest.fn(async (id: number) => ({ id })),
      }),
    );
    const created = await sources.addSource(
      { spaceId: 1, kind: 'article', title: '资产资料', text: '', assetId: 9 },
      user,
    );
    expect(created.status).toBe('PENDING');
    expect(created.chars).toBeGreaterThan(0);
  });
});
