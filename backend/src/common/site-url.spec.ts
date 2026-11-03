import { joinSiteUrl, normalizeSiteUrl } from './site-url';

describe('site url normalization (single source of site absolute address)', () => {
  it.each([
    ['https://oa.example.com', 'https://oa.example.com'],
    ['HTTPS://OA.Example.COM/', 'https://oa.example.com'],
    ['oa.example.com', 'https://oa.example.com'],
    ['http://oa.example.com:8443/portal/', 'http://oa.example.com:8443'],
    ['  http://127.0.0.1:15890  ', 'http://127.0.0.1:15890'],
  ] as const)('normalizes %s to %s', (raw, expected) => {
    expect(normalizeSiteUrl(raw)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    'ftp://oa.example.com',
    'data://oa.example.com',
    'javascript:alert(1)',
    'https://user@evil.example',
    'http://a b.example',
    'not a url',
    '/relative/path',
    'oa.example.com:port',
    null,
    undefined,
    42,
    {},
  ] as const)('rejects %s', (raw) => {
    expect(normalizeSiteUrl(raw)).toBe('');
  });

  it('joins absolute urls only when a base exists', () => {
    expect(joinSiteUrl('https://oa.example.com', '/api/v1/mcp')).toBe(
      'https://oa.example.com/api/v1/mcp',
    );
    expect(joinSiteUrl('https://oa.example.com/', 'okr')).toBe(
      'https://oa.example.com/okr',
    );
    expect(joinSiteUrl('https://oa.example.com/', '/')).toBe(
      'https://oa.example.com',
    );
    // 没配置对外地址时不给链接：对外推送宁可少个按钮，也不发打不开的相对地址
    expect(joinSiteUrl('', '/okr')).toBe('');
  });
});
