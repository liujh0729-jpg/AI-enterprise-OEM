import { httpRequest, TransportError } from '../http/transport';
import {
  AliyunGreenClient,
  AliyunGreenError,
  signedTextScanUrl,
  verdictOf,
} from './aliyun-green.client';

jest.mock('../http/transport', () => {
  class MockTransportError extends Error {
    constructor(
      readonly kind: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    httpRequest: jest.fn(),
    TransportError: MockTransportError,
  };
});

const mockedRequest = httpRequest as jest.MockedFunction<typeof httpRequest>;

const credentials = {
  accessKeyId: 'LTAI5tUnitTestKey',
  accessKeySecret: 'unit-test-secret',
  region: 'cn-shanghai',
};

describe('阿里云内容安全文本检测', () => {
  it('签名 URL 指向文本检测路径且不下发 AccessKeySecret', () => {
    const url = signedTextScanUrl(credentials);
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/green/text/scan');
    expect(parsed.host).toBe('green.cn-shanghai.aliyuncs.com');
    expect(parsed.searchParams.get('AccessKeyId')).toBe(
      credentials.accessKeyId,
    );
    expect(parsed.searchParams.get('Version')).toBe('2018-05-09');
    expect(parsed.searchParams.get('Signature')).toBeTruthy();
    expect(url).not.toContain(credentials.accessKeySecret);
  });

  it('归并结果按 block > review > pass，标签去重并取最高置信度', () => {
    expect(
      verdictOf({
        data: [
          {
            results: [
              { label: 'spam', suggestion: 'review', rate: 90.5 },
              { label: 'spam', suggestion: 'block', rate: 99.1 },
              { label: 'ad', suggestion: 'review', rate: 60 },
              { label: 'normal', suggestion: 'pass', rate: 99 },
            ],
          },
        ],
      }),
    ).toEqual({
      suggestion: 'block',
      label: 'spam',
      labels: ['spam', 'ad'],
      rate: 99.1,
    });
  });

  it('全部 pass 时返回 normal', () => {
    expect(
      verdictOf({
        data: [{ results: [{ label: 'normal', suggestion: 'pass' }] }],
      }),
    ).toEqual({ suggestion: 'pass', label: 'normal', labels: [], rate: 0 });
  });

  it('空文本不发请求直接放行', async () => {
    mockedRequest.mockClear();
    const result = await new AliyunGreenClient().scan({
      ...credentials,
      text: '   ',
    });
    expect(result.suggestion).toBe('pass');
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('返回体 code 非 200 时抛出带阿里云 msg 的错误', async () => {
    mockedRequest.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers(),
      data: { code: 400, msg: 'InvalidAccessKeyId.NotFound' },
    });
    await expect(
      new AliyunGreenClient().scan({ ...credentials, text: '发布内容' }),
    ).rejects.toMatchObject({
      name: 'AliyunGreenError',
      code: 400,
      message: 'InvalidAccessKeyId.NotFound',
    });
  });

  it('网络超时转换为阿里云内容安全错误', async () => {
    mockedRequest.mockRejectedValueOnce(
      new TransportError('timeout', 'upstream timeout'),
    );
    await expect(
      new AliyunGreenClient().scan({ ...credentials, text: '发布内容' }),
    ).rejects.toBeInstanceOf(AliyunGreenError);
  });

  it('成功响应带回 requestId 与整体建议', async () => {
    mockedRequest.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers(),
      data: {
        code: 200,
        requestId: 'req-unit-1',
        data: [
          {
            code: 200,
            results: [{ label: 'politics', suggestion: 'review', rate: 88 }],
          },
        ],
      },
    });
    await expect(
      new AliyunGreenClient().scan({ ...credentials, text: '发布内容' }),
    ).resolves.toEqual({
      suggestion: 'review',
      label: 'politics',
      labels: ['politics'],
      rate: 88,
      requestId: 'req-unit-1',
    });
  });
});
