import {
  buildSignedBody,
  canonicalQuery,
  flattenParams,
  percentEncode,
  signRpc,
} from './aliyun-rpc';

describe('阿里云 RPC 签名器', () => {
  // 阿里云官方文档《RPC 风格 API 签名》给的固定向量（AccessKeySecret=testsecret）。
  const documented = {
    AccessKeyId: 'testid',
    Action: 'DescribeRegions',
    Format: 'XML',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: '3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf',
    SignatureVersion: '1.0',
    Timestamp: '2016-02-23T12:46:24Z',
    Version: '2014-05-26',
  };

  it('复现官方示例的签名结果', () => {
    expect(
      signRpc({
        params: documented,
        accessKeySecret: 'testsecret',
        method: 'GET',
      }),
    ).toBe('OLeaidS1JvxuMvnyHOwuJ+uX5qY=');
  });

  it('CanonicalizedQueryString 按 key 字典序并做 RFC3986 编码', () => {
    expect(canonicalQuery({ B: '2', A: 'x y', 'C!': '1~2' })).toBe(
      'A=x%20y&B=2&C%21=1~2',
    );
  });

  it("percentEncode 编码 !'()* 但保留 ~", () => {
    expect(percentEncode("a!b'c(d)e*f~g")).toBe('a%21b%27c%28d%29e%2Af~g');
  });

  it('数组按 Name.n 展开，空值不下发', () => {
    expect(
      flattenParams({ Tags: ['a', 'b'], Empty: '', Skip: null, N: 1 }),
    ).toEqual({ 'Tags.1': 'a', 'Tags.2': 'b', N: '1' });
  });

  it('签名报文包含固定算法字段与 Signature', () => {
    const body = buildSignedBody({
      action: 'QueryReceiverByParam',
      version: '2015-11-23',
      accessKeyId: 'LTAI5tUnitTest',
      accessKeySecret: 'secret',
      params: { PageSize: 50 },
    });
    expect(body).toContain('Action=QueryReceiverByParam');
    expect(body).toContain('Version=2015-11-23');
    expect(body).toContain('SignatureMethod=HMAC-SHA1');
    expect(body).toContain('SignatureVersion=1.0');
    expect(body).toContain('Format=JSON');
    expect(body).toMatch(/&Signature=[A-Za-z0-9%]+$/);
  });
});
