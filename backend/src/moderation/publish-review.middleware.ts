import type { Context, MiddlewareHandler } from 'hono';
import type { PublishReviewScene } from '@enterprise/contracts';
import type { ApiEnv } from '../http/types';
import type { PublishReviewService } from './publish-review.service';

/**
 * 发布审核拦截：鉴权之后、业务路由之前，按「方法 + 路径」识别发布动作。
 * 只抽取正文类字段送审，联系方式 / 编号 / 图片地址不参与；
 * 新建、编辑、发布草稿后的再次编辑都走同一张场景表，避免编辑绕过首次审核。
 */

type Rule = {
  scene: PublishReviewScene;
  method: 'POST' | 'PUT' | 'PATCH';
  pattern: RegExp;
  fields: string[];
};

const DEMAND_FIELDS = [
  'title',
  'description',
  'tags',
  'expected_result',
  'must_conditions',
  'price_description',
  'highlights',
  'cases',
  'qualifications',
];

const SERVICE_FIELDS = [
  'title',
  'description',
  'tags',
  'price_description',
  'highlights',
  'cases',
  'qualifications',
  'reference_links',
];

const DEMAND_POSTS = [
  '/enterprise/marketing',
  '/enterprise/logistics',
  '/enterprise/smart',
  '/enterprise/asset',
  '/enterprise/legal/requests',
  '/enterprise/ip/requests',
  '/enterprise/flex/work-orders',
  '/enterprise/think-tank/requests',
];

const updatePattern = (base: string) =>
  new RegExp(`^${base.replace(/[/-]/g, '\\$&')}/[^/]+$`);

const RULES: Rule[] = [
  {
    scene: 'community_post',
    method: 'POST',
    pattern: /^\/enterprise\/social\/posts$/,
    fields: ['body'],
  },
  {
    scene: 'community_post',
    method: 'POST',
    pattern: /^\/enterprise\/social\/groups\/[^/]+\/topics$/,
    fields: ['title', 'body', 'tag'],
  },
  {
    scene: 'resume',
    method: 'PUT',
    pattern: /^\/enterprise\/social\/resume$/,
    fields: [
      'headline',
      'summary',
      'objectiveRole',
      'objectiveCity',
      'objectiveType',
      'additional',
    ],
  },
  {
    scene: 'resume',
    method: 'POST',
    pattern: /^\/enterprise\/social\/resume\/items$/,
    fields: ['title', 'subtitle', 'description'],
  },
  ...DEMAND_POSTS.flatMap<Rule>((base) => [
    {
      scene: 'demand',
      method: 'POST',
      pattern: new RegExp(`^${base}$`),
      fields: DEMAND_FIELDS,
    },
    {
      scene: 'demand',
      method: 'PATCH',
      pattern: updatePattern(base),
      fields: DEMAND_FIELDS,
    },
  ]),
  {
    scene: 'demand',
    method: 'POST',
    pattern: /^\/enterprise\/market\/[^/]+\/demands$/,
    fields: DEMAND_FIELDS,
  },
  {
    scene: 'demand',
    method: 'PATCH',
    pattern: /^\/enterprise\/market\/[^/]+\/demands\/[^/]+$/,
    fields: DEMAND_FIELDS,
  },
  {
    scene: 'service',
    method: 'POST',
    pattern: /^\/enterprise\/services$/,
    fields: SERVICE_FIELDS,
  },
  {
    scene: 'service',
    method: 'PATCH',
    pattern: /^\/enterprise\/services\/[^/]+$/,
    fields: SERVICE_FIELDS,
  },
  {
    scene: 'service',
    method: 'POST',
    pattern: /^\/enterprise\/market\/[^/]+\/services$/,
    fields: SERVICE_FIELDS,
  },
  {
    scene: 'service',
    method: 'PATCH',
    pattern: /^\/enterprise\/market\/[^/]+\/services\/[^/]+$/,
    fields: SERVICE_FIELDS,
  },
];

const stripBackend = (path: string) =>
  path.replace(/^\/api\/backend(?=\/|$)/, '') || '/';

export const textOf = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (Array.isArray(value))
    return value
      .map((item) => textOf(item))
      .filter(Boolean)
      .join('、');
  return '';
};

/** 供单测与调用方复用：按方法 + 路径判定是否属于发布动作。 */
export function matchPublishRule(
  method: string,
  rawPath: string,
): Rule | undefined {
  const path = stripBackend(rawPath);
  const normalized = method.toUpperCase();
  return RULES.find(
    (item) => item.method === normalized && item.pattern.test(path),
  );
}

export function publishReviewMiddleware(
  service: PublishReviewService,
): MiddlewareHandler<ApiEnv> {
  return async (c: Context<ApiEnv>, next) => {
    const user = c.get('user');
    if (!user) return next();
    const rule = matchPublishRule(c.req.method, c.req.path);
    if (!rule) return next();
    const raw: unknown = await c.req.raw
      .clone()
      .json()
      .catch(() => undefined);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return next();
    const body = raw as Record<string, unknown>;
    await service.guard({
      userId: user.userId,
      scene: rule.scene,
      texts: rule.fields.map((field) => textOf(body[field])),
    });
    return next();
  };
}
