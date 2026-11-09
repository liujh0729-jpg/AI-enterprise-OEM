import { SEO_SCHEMA_TYPES } from '@enterprise/contracts';

/**
 * JSON-LD 纯函数层：规则式生成 + 结构校验。
 * 只使用调用方给的字段，缺字段就报缺，绝不编造作者/价格/日期。
 */

export type SchemaType = (typeof SEO_SCHEMA_TYPES)[number];
export type SchemaFields = Record<string, string>;
export type JsonLdNode = Record<string, unknown>;

export const SCHEMA_TYPE_NAMES: Record<string, string> = {
  ARTICLE: 'Article',
  PRODUCT: 'Product',
  FAQ: 'FAQPage',
  ORGANIZATION: 'Organization',
  BREADCRUMB: 'BreadcrumbList',
};

const CONTEXT = 'https://schema.org';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/** 去掉空串/空数组/undefined，避免输出「headline: ""」这类假字段。 */
function compact(node: JsonLdNode): JsonLdNode {
  const out: JsonLdNode = {};
  for (const [key, value] of Object.entries(node)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    if (Array.isArray(value) && !value.length) continue;
    out[key] = value;
  }
  return out;
}

function imageList(fields: SchemaFields): string[] {
  const raw = clean(fields.image || fields.images);
  if (!raw) return [];
  return raw
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sameAsList(fields: SchemaFields): string[] {
  return clean(fields.sameAs)
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * 数组型字段双格式：优先 JSON 数组，其次按行 `名称|值` 拆分。
 * 界面只给 Record<string,string>，所以约定用竖线/换行承载多行明细。
 */
function pairs(
  raw: string,
  keys: [string, string],
): Array<Record<string, string>> {
  const input = raw.trim();
  if (!input) return [];
  if (input.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(input);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => {
            const row = (item || {}) as Record<string, unknown>;
            return {
              [keys[0]]: clean(row[keys[0]] ?? row.name ?? row.question),
              [keys[1]]: clean(
                row[keys[1]] ?? row.url ?? row.answer ?? row.text,
              ),
            };
          })
          .filter((row) => row[keys[0]]);
      }
    } catch {
      // 落到按行拆分
    }
  }
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf('|');
      if (at < 0) return { [keys[0]]: line, [keys[1]]: '' };
      return {
        [keys[0]]: line.slice(0, at).trim(),
        [keys[1]]: line.slice(at + 1).trim(),
      };
    })
    .filter((row) => row[keys[0]]);
}

function articleNode(
  fields: SchemaFields,
  pageUrl: string,
  brand: string,
): JsonLdNode {
  const author = clean(fields.author);
  return compact({
    '@context': CONTEXT,
    '@type': 'Article',
    headline: clean(fields.headline || fields.title),
    description: clean(fields.description),
    image: imageList(fields),
    author: author ? { '@type': 'Person', name: author } : undefined,
    datePublished: clean(fields.datePublished),
    dateModified: clean(fields.dateModified),
    mainEntityOfPage: pageUrl
      ? { '@type': 'WebPage', '@id': pageUrl }
      : undefined,
    publisher: brand ? { '@type': 'Organization', name: brand } : undefined,
    articleSection: clean(fields.articleSection),
    keywords: clean(fields.keywords),
    inLanguage: clean(fields.inLanguage),
  });
}

function productNode(
  fields: SchemaFields,
  pageUrl: string,
  brand: string,
): JsonLdNode {
  const price = clean(fields.price);
  const currency = clean(fields.priceCurrency || fields.currency);
  const ratingValue = clean(fields.ratingValue);
  const reviewCount = clean(fields.reviewCount || fields.ratingCount);
  const offers =
    price || currency || clean(fields.availability)
      ? compact({
          '@type': 'Offer',
          url: pageUrl || clean(fields.url),
          price,
          priceCurrency: currency,
          availability: clean(fields.availability)
            ? `https://schema.org/${clean(fields.availability)}`
            : undefined,
          itemCondition: clean(fields.itemCondition)
            ? `https://schema.org/${clean(fields.itemCondition)}`
            : undefined,
          priceValidUntil: clean(fields.priceValidUntil),
        })
      : undefined;
  return compact({
    '@context': CONTEXT,
    '@type': 'Product',
    name: clean(fields.name || fields.title),
    description: clean(fields.description),
    image: imageList(fields),
    sku: clean(fields.sku),
    mpn: clean(fields.mpn),
    gtin: clean(fields.gtin),
    brand: clean(fields.brand || brand)
      ? { '@type': 'Brand', name: clean(fields.brand || brand) }
      : undefined,
    offers,
    aggregateRating:
      ratingValue && reviewCount
        ? {
            '@type': 'AggregateRating',
            ratingValue,
            reviewCount,
            bestRating: clean(fields.bestRating) || '5',
          }
        : undefined,
  });
}

function faqNode(fields: SchemaFields): JsonLdNode {
  const rows = pairs(clean(fields.questions || fields.faq), [
    'question',
    'answer',
  ]);
  return compact({
    '@context': CONTEXT,
    '@type': 'FAQPage',
    mainEntity: rows.map((row) =>
      compact({
        '@type': 'Question',
        name: row.question,
        acceptedAnswer: row.answer
          ? { '@type': 'Answer', text: row.answer }
          : undefined,
      }),
    ),
  });
}

function organizationNode(
  fields: SchemaFields,
  pageUrl: string,
  brand: string,
): JsonLdNode {
  const telephone = clean(fields.telephone || fields.phone);
  const email = clean(fields.email);
  return compact({
    '@context': CONTEXT,
    '@type': 'Organization',
    name: clean(fields.name || brand),
    url: clean(fields.url) || pageUrl,
    logo: clean(fields.logo),
    description: clean(fields.description),
    sameAs: sameAsList(fields),
    address: clean(fields.address)
      ? { '@type': 'PostalAddress', streetAddress: clean(fields.address) }
      : undefined,
    contactPoint:
      telephone || email
        ? compact({
            '@type': 'ContactPoint',
            telephone,
            email,
            contactType: clean(fields.contactType) || 'customer service',
            areaServed: clean(fields.areaServed),
            availableLanguage: clean(fields.availableLanguage),
          })
        : undefined,
  });
}

function breadcrumbNode(fields: SchemaFields, pageUrl: string): JsonLdNode {
  const rows = pairs(clean(fields.items || fields.breadcrumbs), [
    'name',
    'url',
  ]);
  return compact({
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: rows.map((row, index) =>
      compact({
        '@type': 'ListItem',
        position: index + 1,
        name: row.name,
        item: row.url || (index === rows.length - 1 ? pageUrl : ''),
      }),
    ),
  });
}

/** 规则式生成：确定性、可离线、不收费；缺字段由校验层如实报出。 */
export function buildJsonLd(input: {
  type: SchemaType;
  fields: SchemaFields;
  pageUrl?: string;
  brandName?: string;
}): string {
  const fields = input.fields || {};
  const pageUrl = clean(input.pageUrl);
  const brand = clean(input.brandName);
  let node: JsonLdNode;
  switch (input.type) {
    case 'PRODUCT':
      node = productNode(fields, pageUrl, brand);
      break;
    case 'FAQ':
      node = faqNode(fields);
      break;
    case 'ORGANIZATION':
      node = organizationNode(fields, pageUrl, brand);
      break;
    case 'BREADCRUMB':
      node = breadcrumbNode(fields, pageUrl);
      break;
    default:
      node = articleNode(fields, pageUrl, brand);
  }
  return JSON.stringify(node, null, 2);
}

const REQUIRED_HINTS: Record<string, string[]> = {
  ARTICLE: ['headline（标题）', 'author（作者）', 'datePublished（发布日期）'],
  PRODUCT: [
    'name（产品名）',
    'offers.price + priceCurrency（价格与币种）或 aggregateRating',
  ],
  FAQ: ['mainEntity（至少一条问答，含 name 与 acceptedAnswer.text）'],
  ORGANIZATION: ['name（组织名）', 'url（官网地址）'],
  BREADCRUMB: ['itemListElement（至少两级，含 position 与 name）'],
};

export const requiredHints = (type: string): string[] =>
  REQUIRED_HINTS[type] || [];

function nodesOf(parsed: unknown): JsonLdNode[] {
  if (Array.isArray(parsed)) return parsed.flatMap(nodesOf);
  if (!parsed || typeof parsed !== 'object') return [];
  const node = parsed as JsonLdNode;
  if (Array.isArray(node['@graph'])) return nodesOf(node['@graph']);
  return [node];
}

function typeOf(node: JsonLdNode): string {
  const raw = node['@type'];
  if (Array.isArray(raw)) return clean(raw[0]);
  return clean(raw);
}

function asNode(value: unknown): JsonLdNode | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonLdNode)
    : null;
}

function checkArticle(node: JsonLdNode, errors: string[], warnings: string[]) {
  if (!clean(node.headline)) errors.push('文章缺少 headline（标题）');
  else if (clean(node.headline).length > 110)
    warnings.push('headline 超过 110 字符，搜索结果里会被截断');
  const author = asNode(node.author) || asNode((node.author as unknown[])?.[0]);
  if (!author || !clean(author.name))
    errors.push('文章缺少 author.name（作者名）');
  if (!clean(node.datePublished))
    errors.push('文章缺少 datePublished（发布日期）');
  if (!imageList({ image: stringifyImages(node.image) }).length)
    warnings.push(
      '文章建议补 image（至少一张 1200px 宽图），否则拿不到大图富结果',
    );
}

function stringifyImages(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value))
    return value
      .map((item) =>
        typeof item === 'string' ? item : clean(asNode(item)?.url),
      )
      .filter(Boolean)
      .join('\n');
  return clean(asNode(value)?.url);
}

function checkProduct(node: JsonLdNode, errors: string[], warnings: string[]) {
  if (!clean(node.name)) errors.push('产品缺少 name（产品名）');
  const offers = asNode(node.offers) || asNode((node.offers as unknown[])?.[0]);
  const rating = asNode(node.aggregateRating);
  const hasOffer = Boolean(
    offers && clean(offers.price) && clean(offers.priceCurrency),
  );
  const hasRating = Boolean(rating && clean(rating.ratingValue));
  if (!hasOffer && !hasRating)
    errors.push(
      '产品需要 offers.price + offers.priceCurrency，或 aggregateRating.ratingValue，二者至少其一',
    );
  if (offers && clean(offers.price) && !clean(offers.priceCurrency))
    errors.push('offers 有 price 但缺 priceCurrency（币种，如 CNY/USD）');
  if (offers && clean(offers.price) && !Number.isFinite(Number(offers.price)))
    errors.push('offers.price 必须是数字');
  if (!stringifyImages(node.image)) warnings.push('产品建议补 image');
  if (!clean(node.description)) warnings.push('产品建议补 description');
}

function checkFaq(node: JsonLdNode, errors: string[]) {
  const list = Array.isArray(node.mainEntity) ? node.mainEntity : [];
  if (!list.length) {
    errors.push('FAQ 缺少 mainEntity（问答列表）');
    return;
  }
  list.forEach((item, index) => {
    const question = asNode(item);
    if (!question || !clean(question.name)) {
      errors.push(`第 ${index + 1} 条问答缺 name（问题）`);
      return;
    }
    const answer = asNode(question.acceptedAnswer);
    if (!answer || !clean(answer.text))
      errors.push(`第 ${index + 1} 条问答缺 acceptedAnswer.text（答案）`);
  });
}

function checkOrganization(
  node: JsonLdNode,
  errors: string[],
  warnings: string[],
) {
  if (!clean(node.name)) errors.push('组织缺少 name（组织名）');
  if (!clean(node.url)) errors.push('组织缺少 url（官网地址）');
  if (!clean(node.logo)) warnings.push('组织建议补 logo（112×112px 以上）');
}

function checkBreadcrumb(node: JsonLdNode, errors: string[]) {
  const list = Array.isArray(node.itemListElement) ? node.itemListElement : [];
  if (list.length < 2) {
    errors.push('面包屑至少需要两级 itemListElement');
    return;
  }
  list.forEach((item, index) => {
    const entry = asNode(item);
    if (!entry || !clean(entry.name))
      errors.push(`第 ${index + 1} 级面包屑缺 name`);
    if (entry && Number(entry.position) !== index + 1)
      errors.push(`第 ${index + 1} 级面包屑 position 应为 ${index + 1}`);
    if (entry && index < list.length - 1 && !clean(entry.item))
      errors.push(`第 ${index + 1} 级面包屑缺 item（链接），只有末级可省略`);
  });
}

function checkUrls(node: JsonLdNode, pageUrl: string, warnings: string[]) {
  const candidates = [
    clean(node.url),
    clean(asNode(node.mainEntityOfPage)?.['@id']),
    clean(asNode(node.offers)?.url),
  ].filter(Boolean);
  for (const value of candidates) {
    if (!/^https?:\/\//i.test(value)) {
      warnings.push(`${value} 不是绝对地址，结构化数据里的链接需要完整 URL`);
      continue;
    }
    if (pageUrl && value.replace(/\/$/, '') !== pageUrl.replace(/\/$/, ''))
      warnings.push(
        `声明的页面地址 ${value} 与当前页面 ${pageUrl} 不一致，请确认是否标错页`,
      );
  }
}

export type JsonLdValidation = {
  jsonLd: string;
  valid: boolean;
  issues: string[];
};

/** 结构校验：JSON 可解析 + @context + 按类型查必填；告警与错误分开，只有错误才判不通过。 */
export function validateJsonLd(raw: string, pageUrl = ''): JsonLdValidation {
  const input = raw.trim();
  if (!input) return { jsonLd: '', valid: false, issues: ['JSON-LD 内容为空'] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    return {
      jsonLd: input,
      valid: false,
      issues: [
        `JSON 解析失败：${error instanceof Error ? error.message : '格式错误'}`,
      ],
    };
  }
  const nodes = nodesOf(parsed);
  if (!nodes.length)
    return { jsonLd: input, valid: false, issues: ['未找到结构化数据节点'] };
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const node of nodes) {
    const context = node['@context'];
    const contextText = Array.isArray(context)
      ? context.map((item) => clean(item)).join(' ')
      : clean(context);
    if (!/schema\.org/i.test(contextText))
      errors.push('缺少 @context: "https://schema.org"');
    const type = typeOf(node);
    const key = Object.keys(SCHEMA_TYPE_NAMES).find(
      (item) => SCHEMA_TYPE_NAMES[item].toLowerCase() === type.toLowerCase(),
    );
    if (!key) {
      warnings.push(
        `@type "${type || '未填写'}" 不在本工作台校验范围（文章/产品/常见问题/组织/面包屑），只做了 JSON 与 @context 检查`,
      );
      continue;
    }
    if (key === 'ARTICLE') checkArticle(node, errors, warnings);
    if (key === 'PRODUCT') checkProduct(node, errors, warnings);
    if (key === 'FAQ') checkFaq(node, errors);
    if (key === 'ORGANIZATION') checkOrganization(node, errors, warnings);
    if (key === 'BREADCRUMB') checkBreadcrumb(node, errors);
    checkUrls(node, pageUrl, warnings);
  }
  return {
    jsonLd: JSON.stringify(parsed, null, 2),
    valid: errors.length === 0,
    issues: [...errors, ...warnings],
  };
}

/** 生成结果里由模型补写的文案字段：只允许这几个，其余一律以用户字段为准。 */
export const LLM_FILLABLE = ['description', 'headline', 'name'] as const;

/**
 * 合并模型输出：只接受白名单文案字段，且原字段为空时才采纳，
 * 防止模型把用户填的价格/作者/日期改掉或凭空补造。
 */
export function mergeLlmText(
  base: string,
  llmRaw: string,
  fields: SchemaFields,
): { jsonLd: string; used: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(llmRaw);
  } catch {
    return { jsonLd: base, used: false };
  }
  const source = asNode(parsed);
  if (!source) return { jsonLd: base, used: false };
  let target: JsonLdNode;
  try {
    target = JSON.parse(base) as JsonLdNode;
  } catch {
    return { jsonLd: base, used: false };
  }
  let used = false;
  for (const key of LLM_FILLABLE) {
    if (clean(fields[key])) continue;
    const value = clean(source[key]);
    if (!value || value.length > 300) continue;
    target[key] = value;
    used = true;
  }
  return { jsonLd: used ? JSON.stringify(target, null, 2) : base, used };
}
