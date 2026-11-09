import type { CurrentUser } from '../auth/current-user';
import { httpRequest } from '../http/transport';
import { SeoSchemaService } from './seo-schema.service';
import type { SeoContext } from './seo-base.service';
import { stub } from '../../test/doubles';

jest.mock('../http/transport', () => ({ httpRequest: jest.fn() }));
jest.mock('../http/outbound-guard', () => ({
  assertOutboundUrl: jest.fn().mockResolvedValue(undefined),
}));

const user = { userId: 'u1' } as CurrentUser;

function setup(options: { verifiedAt?: Date | null } = {}) {
  const http = httpRequest as jest.Mock;
  http.mockReset().mockResolvedValue({ ok: true, status: 200, data: '' });
  const createSubmission = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: 1,
      urls: data.urls,
      responseCode: data.responseCode,
      submittedBy: data.submittedBy,
      createdAt: new Date(),
    }),
  );
  const ctx = stub<SeoContext>({
    prisma: {
      seoProject: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 7, domain: 'example.com' }),
      },
      seoIndexnowKey: {
        findUnique: jest.fn().mockResolvedValue({
          keyValue: 'abc123',
          verifiedAt:
            options.verifiedAt === undefined ? new Date() : options.verifiedAt,
        }),
      },
      seoIndexnowSubmission: { create: createSubmission },
    },
    scope: {
      resolve: jest
        .fn()
        .mockResolvedValue({ orgType: 'ENTERPRISE', orgUserId: 'u1' }),
    },
  });
  return { service: new SeoSchemaService(ctx), http, createSubmission };
}

describe('SeoSchemaService.submitIndexnow', () => {
  it('按已验证 key 组装 host / key / keyLocation / urlList 并记台账', async () => {
    const { service, http, createSubmission } = setup();
    const result = await service.submitIndexnow(user, {
      projectId: 7,
      urls: [
        'https://example.com/a',
        'https://example.com/b',
        'https://example.com/a',
      ],
    });
    expect(http).toHaveBeenCalledTimes(1);
    const [url, init] = http.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('https://api.indexnow.org/indexnow');
    expect(JSON.parse(init.body)).toEqual({
      host: 'example.com',
      key: 'abc123',
      keyLocation: 'https://example.com/abc123.txt',
      urlList: ['https://example.com/a', 'https://example.com/b'],
    });
    expect(createSubmission).toHaveBeenCalledTimes(1);
    expect(result.responseCode).toBe(200);
  });

  it('跨主机 URL 直接拒绝且不发起上游请求', async () => {
    const { service, http, createSubmission } = setup();
    await expect(
      service.submitIndexnow(user, {
        projectId: 7,
        urls: ['https://other.com/a'],
      }),
    ).rejects.toThrow(/同一主机/);
    expect(http).not.toHaveBeenCalled();
    expect(createSubmission).not.toHaveBeenCalled();
  });

  it('key 未验证时拒绝提交', async () => {
    const { service, http } = setup({ verifiedAt: null });
    await expect(
      service.submitIndexnow(user, {
        projectId: 7,
        urls: ['https://example.com/a'],
      }),
    ).rejects.toThrow(/key 文件托管验证/);
    expect(http).not.toHaveBeenCalled();
  });
});
