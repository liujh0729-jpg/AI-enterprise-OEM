/**
 * 程序化 SEO 纯函数层：占位模板渲染、slug、自包含 HTML、sitemap、索引页。
 * 全部确定性、可离线；不调模型也能产出可用页面。
 */

import { text } from './seo-shared';

export type TemplateValues = Record<string, string>;

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (value: unknown): string =>
  text(value).replace(/[&<>"']/g, (char) => ESCAPES[char] || char);

/** 只替换 {{键}}，键两侧允许空格；未知键原样保留，便于用户发现拼错的列名。 */
export function renderTemplate(
  template: string,
  values: TemplateValues,
): string {
  return replaceKeys(template, values, escapeHtml);
}

/** 标题/关键词/slug 这类非 HTML 上下文：替换但不转义，避免 &amp; 混进 title。 */
export function renderPlain(template: string, values: TemplateValues): string {
  return replaceKeys(template, values, (value) => text(value));
}

function replaceKeys(
  template: string,
  values: TemplateValues,
  encode: (value: unknown) => string,
): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, key: string) => {
    const name = key.trim();
    if (Object.prototype.hasOwnProperty.call(values, name))
      return encode(values[name]);
    return whole;
  });
}

/** 模板里用到的占位键（去重、保序）。 */
export function templateKeys(template: string): string[] {
  const keys: string[] = [];
  for (const match of template.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    const key = match[1].trim();
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** slug：保留中文（浏览器与搜索引擎都支持），去掉路径/查询危险字符。 */
export function slugify(raw: string, fallback = 'page'): string {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[\\/:*?"<>|#%&=+~^{}[\]!$'`,;.]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  return (value || fallback).slice(0, 120);
}

export function uniqueSlug(base: string, used: Set<string>): string {
  const slug = slugify(base);
  if (!used.has(slug)) {
    used.add(slug);
    return slug;
  }
  let index = 2;
  while (used.has(`${slug}-${index}`)) index += 1;
  const final = `${slug}-${index}`;
  used.add(final);
  return final;
}

/** 缺模板时的确定性骨架：按列名逐段输出，不编造文案。 */
export function defaultTemplate(
  columns: string[],
  keywordPattern: string,
): string {
  const head = keywordPattern.trim()
    ? `<h1>${escapeHtml(keywordPattern)}</h1>`
    : `<h1>{{${columns[0] || '标题'}}}</h1>`;
  const sections = columns
    .map(
      (name) =>
        `<section><h2>${escapeHtml(name)}</h2><p>{{${name}}}</p></section>`,
    )
    .join('\n');
  return `${head}\n${sections}`;
}

export type ProgrammaticPageInput = {
  slug: string;
  title: string;
  metaDescription: string;
  body: string;
  jsonLd: string;
};

export function pageUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, '')}/${slug}/`;
}

export function pageJsonLd(input: {
  origin: string;
  slug: string;
  title: string;
  description: string;
  keywords: string;
  brandName: string;
  hubTitle: string;
}): string {
  const url = pageUrl(input.origin, input.slug);
  const node = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': url,
        url,
        name: input.title,
        description: input.description,
        keywords: input.keywords,
        inLanguage: 'zh-CN',
        isPartOf: {
          '@type': 'WebSite',
          name: input.brandName || input.origin,
          url: `${input.origin.replace(/\/+$/, '')}/`,
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: input.brandName || '首页',
            item: `${input.origin.replace(/\/+$/, '')}/`,
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: input.hubTitle,
            item: `${input.origin.replace(/\/+$/, '')}/`,
          },
          { '@type': 'ListItem', position: 3, name: input.title, item: url },
        ],
      },
    ],
  };
  return JSON.stringify(node, null, 2);
}

/** 自包含 HTML：无外链 CSS/JS，客户下载即可部署到自有域名。 */
export function pageHtml(input: {
  title: string;
  metaDescription: string;
  body: string;
  jsonLd: string;
  canonical: string;
  hubUrl: string;
  hubTitle: string;
  brandName: string;
}): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<meta name="description" content="${escapeHtml(input.metaDescription)}">
<link rel="canonical" href="${escapeHtml(input.canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(input.title)}">
<meta property="og:description" content="${escapeHtml(input.metaDescription)}">
<meta property="og:url" content="${escapeHtml(input.canonical)}">
<script type="application/ld+json">${input.jsonLd.replace(/<\//g, '<\\/')}</script>
<style>
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#1f2933;background:#fff;line-height:1.75}
.wrap{max-width:860px;margin:0 auto;padding:32px 20px 64px}
.crumb{font-size:13px;color:#6b7280;margin-bottom:20px}
.crumb a{color:#2563eb;text-decoration:none}
h1{font-size:30px;line-height:1.3;margin:0 0 20px}
h2{font-size:20px;margin:32px 0 12px;padding-bottom:8px;border-bottom:1px solid #e5e7eb}
p{margin:0 0 14px}
table{border-collapse:collapse;width:100%;margin:16px 0}
td,th{border:1px solid #e5e7eb;padding:8px 12px;text-align:left}
footer{margin-top:48px;padding-top:20px;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280}
</style>
</head>
<body>
<div class="wrap">
<nav class="crumb"><a href="${escapeHtml(input.hubUrl)}">${escapeHtml(input.hubTitle)}</a> / ${escapeHtml(input.title)}</nav>
${input.body}
<footer>${escapeHtml(input.brandName)} · <a href="${escapeHtml(input.hubUrl)}">${escapeHtml(input.hubTitle)}</a></footer>
</div>
</body>
</html>
`;
}

export function hubHtml(input: {
  title: string;
  description: string;
  origin: string;
  brandName: string;
  pages: Array<{ slug: string; title: string }>;
}): string {
  const base = input.origin.replace(/\/+$/, '');
  const items = input.pages
    .map(
      (page) =>
        `<li><a href="${escapeHtml(`./${page.slug}/`)}">${escapeHtml(page.title)}</a></li>`,
    )
    .join('\n');
  const jsonLd = JSON.stringify(
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: input.title,
      description: input.description,
      url: `${base}/`,
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: input.pages.length,
        itemListElement: input.pages.map((page, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: pageUrl(input.origin, page.slug),
          name: page.title,
        })),
      },
    },
    null,
    2,
  );
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<meta name="description" content="${escapeHtml(input.description)}">
<link rel="canonical" href="${escapeHtml(`${base}/`)}">
<script type="application/ld+json">${jsonLd.replace(/<\//g, '<\\/')}</script>
<style>
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#1f2933;line-height:1.75}
.wrap{max-width:860px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:30px;margin:0 0 12px}
p.lead{color:#4b5563;margin:0 0 28px}
ul{list-style:none;padding:0;margin:0;display:grid;gap:10px}
li a{display:block;padding:12px 16px;border:1px solid #e5e7eb;border-radius:10px;color:#1d4ed8;text-decoration:none}
li a:hover{background:#f8fafc}
footer{margin-top:40px;font-size:13px;color:#6b7280}
</style>
</head>
<body>
<div class="wrap">
<h1>${escapeHtml(input.title)}</h1>
<p class="lead">${escapeHtml(input.description)}</p>
<ul>
${items}
</ul>
<footer>${escapeHtml(input.brandName)} · 共 ${input.pages.length} 个页面</footer>
</div>
</body>
</html>
`;
}

export function sitemapXml(urls: string[], now = new Date()): string {
  const lastmod = now.toISOString().slice(0, 10);
  const entries = urls
    .map(
      (url) =>
        `  <url><loc>${escapeHtml(url)}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq></url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}
