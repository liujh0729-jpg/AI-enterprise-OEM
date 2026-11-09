/**
 * 外链建设的纯函数部分：联系方式抽取 + 无 AI 时的草稿模板。
 * 硬口径：只抽取页面里真实存在的 mailto / 邮箱文本，抽不到就留空，绝不猜邮箱；
 * 草稿只生成文本，任何情况下都不自动发送。
 */

export type ContactHit = { email: string; contactUrl: string };

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EMAIL_VALID_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const CONTACT_PATH_RE =
  /(contact|about|write-for-us|guest-post|advertise|partners|联系|关于|合作|投稿)/i;
/** 常见占位/示例邮箱不算真实联系方式。 */
const PLACEHOLDER_RE =
  /(example\.com|domain\.com|email\.com|yourdomain|sentry\.io|wixpress|\.png$|\.jpg$|\.webp$)/i;

export function extractContact(
  html: string,
  links: Array<{ href: string; internal: boolean }>,
): ContactHit {
  const source = String(html || '');
  const mailtos = [...source.matchAll(/mailto:([^"'>?\s]+)/gi)].map((match) =>
    decodeURIComponent(match[1]).trim(),
  );
  const candidates = [...mailtos, ...(source.match(EMAIL_RE) || [])]
    .map((value) => value.replace(/[.,;:]+$/, '').toLowerCase())
    .filter(
      (value) => EMAIL_VALID_RE.test(value) && !PLACEHOLDER_RE.test(value),
    );
  const contactUrl =
    links.find((link) => CONTACT_PATH_RE.test(link.href))?.href || '';
  return {
    email: candidates[0] || '',
    contactUrl: contactUrl.slice(0, 500),
  };
}

/** 无 AI 通道时的规则草稿：结构完整、事实留空由人工补，不编造对方信息。 */
export function ruleOutreachDraft(input: {
  brandName: string;
  domain: string;
  prospectDomain: string;
  prospectUrl: string;
  angle: string;
}): string {
  const brand = input.brandName || input.domain;
  return [
    `主题：关于 ${input.prospectDomain} 读者可能感兴趣的一份补充资料`,
    '',
    '您好：',
    '',
    `我是 ${brand}（${input.domain}）的内容负责人。拜读了贵站 ${input.prospectUrl || input.prospectDomain} 的内容，` +
      '其中关于本主题的梳理对我们很有启发。',
    '',
    input.angle
      ? `我们想提出的合作角度：${input.angle}`
      : '我们想提出的合作角度：〔请填写：例如补充一份实测数据 / 提供一个案例 / 指出文中一处可更新的信息〕',
    '',
    `如果合适，我们可以提供一篇原创稿件（含可核验的数据与出处），或在贵站现有文章中补充一段引用我们整理的内容（${input.domain}）。`,
    '无论采用哪种方式，都会尊重贵站的编辑规范与署名要求。',
    '',
    '若这不是您负责的范畴，也烦请告知合适的联系人，打扰见谅。',
    '',
    '顺祝编安',
    `${brand} 内容团队`,
    '〔请填写：姓名 / 职务 / 回复邮箱〕',
    '',
    '—— 本草稿由规则模板生成（未调用 AI），发送前请人工核对事实与收件人。',
  ].join('\n');
}
