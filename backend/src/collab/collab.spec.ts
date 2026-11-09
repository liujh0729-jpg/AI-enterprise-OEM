import { collabLinkOf, commentHtmlOf, safeLinkUrl } from './collab.service';

describe('collab helpers', () => {
  it('纯文本评论转义后包成段落，脚本残片不会原样落库', () => {
    expect(commentHtmlOf('第一行\n\n第二行', '')).toBe(
      '<p>第一行</p><p>第二行</p>',
    );
    const escaped = commentHtmlOf('<img src=x onerror=alert(1)>', '');
    expect(escaped).not.toContain('<img');
    expect(escaped).toContain('&lt;img');
  });

  it('富文本评论走白名单清洗，script 整段丢弃、javascript: 链接被摘掉', () => {
    const html = commentHtmlOf(
      '正文',
      '<p>正文</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<p>正文</p>');
    expect(html).not.toContain('href=');
  });

  it('资源链接只放行 http(s)，其他协议与畸形地址一律拒绝', () => {
    expect(safeLinkUrl('https://example.com/a?b=1')).toBe(
      'https://example.com/a?b=1',
    );
    expect(safeLinkUrl('http://example.com')).toBe('http://example.com/');
    expect(safeLinkUrl('javascript:alert(1)')).toBe('');
    expect(safeLinkUrl('data:text/html;base64,xxx')).toBe('');
    expect(safeLinkUrl('not a url')).toBe('');
    expect(safeLinkUrl('')).toBe('');
  });

  it('通知跳转按目标类型落到对应模块页签，未知类型回落到协作入口', () => {
    expect(collabLinkOf('TASK', '42')).toBe(
      '/project?tab=tasks&type=TASK&id=42',
    );
    expect(collabLinkOf('PROJECT', '3')).toBe(
      '/project?tab=projects&type=PROJECT&id=3',
    );
    expect(collabLinkOf('ORDER', '7')).toBe('/erp?type=ORDER&id=7');
    expect(collabLinkOf('CANDIDATE', '9')).toBe('/recruit?type=CANDIDATE&id=9');
    expect(collabLinkOf('CUSTOMER', 'c1')).toBe('/crm?type=CUSTOMER&id=c1');
    expect(collabLinkOf('OTHER', 'x')).toBe('/collab?type=OTHER&id=x');
  });
});
