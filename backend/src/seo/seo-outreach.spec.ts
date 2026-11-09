import { extractContact, ruleOutreachDraft } from './seo-outreach';

describe('extractContact（只抽真实存在的联系方式，绝不编造）', () => {
  it('优先抽取 mailto', () => {
    const hit = extractContact(
      '<a href="mailto:Editor@Example.org">联系</a>',
      [],
    );
    expect(hit.email).toBe('editor@example.org');
  });

  it('抽取正文邮箱文本并归一化小写', () => {
    const hit = extractContact('<p>联系 hello@site.com 获取合作</p>', []);
    expect(hit.email).toBe('hello@site.com');
  });

  it('过滤占位/示例邮箱与图片文件名', () => {
    const hit = extractContact(
      '<p>user@example.com logo@2x.png test@domain.com</p>',
      [],
    );
    expect(hit.email).toBe('');
  });

  it('抽不到邮箱就留空，不猜测', () => {
    expect(extractContact('<p>没有任何联系方式</p>', []).email).toBe('');
  });

  it('从链接里挑联系/关于页 URL', () => {
    const hit = extractContact('<p>hi@real.com</p>', [
      { href: 'https://site.com/blog', internal: true },
      { href: 'https://site.com/contact-us', internal: true },
    ]);
    expect(hit.contactUrl).toBe('https://site.com/contact-us');
    expect(hit.email).toBe('hi@real.com');
  });
});

describe('ruleOutreachDraft（无 AI 规则草稿，不自动发送）', () => {
  const input = {
    brandName: '甲品牌',
    domain: 'example.com',
    prospectDomain: 'prospect.com',
    prospectUrl: 'https://prospect.com/post',
    angle: '',
  };

  it('包含我方品牌与对方站点，标注规则生成', () => {
    const draft = ruleOutreachDraft(input);
    expect(draft).toContain('甲品牌');
    expect(draft).toContain('prospect.com');
    expect(draft).toContain('规则模板生成');
    expect(draft).toContain('发送前请人工核对');
  });

  it('缺 angle 时留待填占位，不编造合作角度', () => {
    expect(ruleOutreachDraft(input)).toContain('〔请填写');
  });

  it('缺品牌名时退回域名', () => {
    expect(ruleOutreachDraft({ ...input, brandName: '' })).toContain(
      'example.com',
    );
  });
});
