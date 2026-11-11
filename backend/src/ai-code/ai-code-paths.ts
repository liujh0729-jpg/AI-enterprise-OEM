import { relative, resolve, sep } from 'node:path';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

/**
 * AI 编程的路径策略：读写都收敛在源码白名单内，写操作更严。
 * 模型只能拿到工作区相对路径（posix 分隔），任何绝对路径、`..` 穿越、符号链接逃逸都拒绝。
 */

/** 允许读写的源码目录（仓库相对路径，posix）。 */
const ALLOWED_PREFIXES = [
  'backend/src/',
  'frontend/src/',
  'packages/contracts/src/',
  'backend/prisma/',
  'docs/',
];

/** 无论白名单怎么写都要拒绝的片段 / 文件。 */
const DENY_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'coverage',
  '.turbo',
  'generated',
  '.qoder',
  '.vscode',
  '.idea',
]);

function reject(message: string): never {
  throw new BusinessException(ErrorCode.BAD_REQUEST, message);
}

/** 统一成仓库相对的 posix 路径；不合规直接抛业务异常。 */
export function normalizeRepoPath(input: unknown) {
  const raw = (typeof input === 'string' ? input : '')
    .trim()
    .replace(/\\/g, '/');
  if (!raw) reject('请提供文件路径（仓库相对路径，如 backend/src/main.ts）');
  if (raw.includes('\0')) reject('路径包含非法字符');
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) {
    reject(`只接受仓库相对路径，不能使用绝对路径：${raw}`);
  }
  const segments = raw
    .split('/')
    .filter((segment) => segment && segment !== '.');
  if (segments.some((segment) => segment === '..')) {
    reject(`路径不能包含 .. 穿越：${raw}`);
  }
  const rel = segments.join('/');
  if (!rel) reject('路径不能是仓库根目录');
  return rel;
}

/** 判断一个（已归一化的）路径是否命中硬性拒绝规则。 */
export function isDeniedPath(rel: string) {
  const segments = rel.split('/');
  if (segments.some((segment) => DENY_SEGMENTS.has(segment))) return true;
  const name = segments[segments.length - 1] || '';
  if (name === '.env' || name.startsWith('.env.')) return true;
  if (/\.(log|lockb)$/i.test(name) && name !== 'pnpm-lock.yaml') return true;
  return false;
}

/** 是否在可读写的源码白名单内。 */
export function isAllowedPath(rel: string) {
  return ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

/**
 * 列目录 / 检索允许的目录：白名单内，或白名单的上级目录（如 backend 足以收敛到 backend/src）。
 * 允许空串＝仓库根，但列出的条目仍按拒绝规则过滤。
 */
export function isListablePath(rel: string) {
  if (!rel) return true;
  const normalized = rel.replace(/\/$/, '');
  if (isAllowedPath(`${normalized}/`)) return true;
  return ALLOWED_PREFIXES.some((prefix) => prefix.startsWith(`${normalized}/`));
}

export function assertListablePath(rel: string) {
  if (isDeniedPath(rel)) reject(`该目录不允许访问：${rel}`);
  if (!isListablePath(rel)) {
    reject(
      `该目录不在允许的源码范围内：${rel || '/'}（仅支持 ${ALLOWED_PREFIXES.map((prefix) => prefix.replace(/\/$/, '')).join('、')}）`,
    );
  }
}

/** 读文件：白名单 + 拒绝规则都必须通过。 */
export function assertReadablePath(rel: string) {
  if (isDeniedPath(rel)) {
    reject(`该路径不允许读写：${rel}（.env / 构建产物 / 依赖目录等一律禁止）`);
  }
  if (!isAllowedPath(rel)) {
    reject(
      `该路径不在允许的源码范围内：${rel}（仅支持 ${ALLOWED_PREFIXES.map((prefix) => prefix.replace(/\/$/, '')).join('、')}）`,
    );
  }
}

/** 写文件：与读一致，但额外禁止改写迁移目录之外的环境与部署配置。 */
export function assertWritablePath(rel: string) {
  assertReadablePath(rel);
  if (
    rel.startsWith('backend/prisma/migrations/') &&
    !/\/migration\.sql$/.test(rel)
  ) {
    reject('迁移目录只允许写 migration.sql');
  }
}

/** 把仓库相对路径解析到工作区内，并再次校验没有越界（含软链接解析后的结果）。 */
export function resolveInside(root: string, rel: string) {
  const base = resolve(root);
  const abs = resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + sep)) {
    reject(`路径越界：${rel}`);
  }
  return abs;
}

/** 文件绝对路径 → 仓库相对 posix 路径；越界返回空串。 */
export function toRepoPath(root: string, abs: string) {
  const rel = relative(resolve(root), abs).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) return '';
  return rel;
}
