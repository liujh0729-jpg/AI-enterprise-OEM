import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { BusinessException } from '../common/business.exception';
import { aiCodeMaxFileBytes } from './ai-code.config';
import {
  assertListablePath,
  assertReadablePath,
  isAllowedPath,
  isDeniedPath,
  normalizeRepoPath,
  resolveInside,
} from './ai-code-paths';
import {
  readEffectiveText,
  readWorkspaceText,
  type AiCodeStaging,
} from './ai-code-staging';

/**
 * 代码工具：模型只能通过这 6 个工具读写暂存区，没有任何执行命令的能力；
 * 构建、迁移、重启只由 runner 以参数数组执行。
 */

const MAX_READ_LINES = 4000;
const MAX_LIST_ENTRIES = 400;
const MAX_GREP_FILES = 3000;
const MAX_GREP_HITS = 80;

export const AI_CODE_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'code__list_dir',
      description:
        '列出源码目录下的文件与子目录（只读）。path 用仓库相对路径，如 backend/src 或 frontend/src/app；根目录传空字符串。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '仓库相对目录；根目录传空字符串',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'code__read_file',
      description:
        '读取源码文件（只读，带行号）。写文件前必须先读，确认现状。path 用仓库相对路径。可选 start/end 只读片段。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '仓库相对路径，如 backend/src/http/app.ts',
          },
          start: { type: 'integer', description: '可选起始行（从 1 开始）' },
          end: { type: 'integer', description: '可选结束行（含）' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'code__grep',
      description:
        '在源码里做正则检索（只读）。返回命中的文件:行号:内容。path 收窄检索目录，glob 过滤文件名（如 *.ts）。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '正则表达式' },
          path: {
            type: 'string',
            description: '可选：仓库相对目录，默认搜全部允许目录',
          },
          glob: { type: 'string', description: '可选：文件名通配，如 *.tsx' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'code__write_file',
      description:
        '把完整文件内容写入暂存区（新建或整文件覆盖）。改动不会立即生效，管理员审阅后才会应用。**整文件重写优先用本工具**，避免补丁上下文对不上。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '仓库相对路径' },
          content: {
            type: 'string',
            description: '完整文件内容（包含全部原有代码）',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'code__apply_patch',
      description:
        '对已有文件按 unified diff 打补丁（写入暂存区）。补丁必须包含 @@ 块与足够的上下文行；上下文不匹配会被拒绝——这时请改用 code__write_file 整文件重写。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '仓库相对路径' },
          patch: {
            type: 'string',
            description:
              'unified diff 文本（可省略 ---/+++ 头，但必须有 @@ -a,b +c,d @@ 块）',
          },
        },
        required: ['path', 'patch'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'code__delete_file',
      description:
        '删除一个源文件（登记为删除变更，暂存区生效，管理员审阅后才真正删除）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '仓库相对路径' },
        },
        required: ['path'],
      },
    },
  },
];

export type AiCodeToolResult = {
  text: string;
  changed: boolean;
  path?: string;
};

export type AiCodeToolContext = {
  root: string;
  sessionId: number;
  staging: AiCodeStaging;
};

function clip(text: string, max = 40_000) {
  return text.length > max
    ? `${text.slice(0, max)}\n…（内容过长已截断）`
    : text;
}

function globToRegExp(glob: string) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

const SEARCH_ROOTS = [
  'backend/src',
  'frontend/src',
  'packages/contracts/src',
  'backend/prisma',
  'docs',
];

function walk(root: string, dir: string, out: string[], limit: number) {
  if (out.length >= limit) return;
  let entries: string[];
  try {
    entries = readdirSync(resolveInside(root, dir));
  } catch {
    return;
  }
  for (const name of entries) {
    if (out.length >= limit) return;
    const rel = dir ? `${dir}/${name}` : name;
    if (isDeniedPath(rel)) continue;
    let stat;
    try {
      stat = statSync(resolveInside(root, rel));
    } catch {
      continue;
    }
    if (stat.isDirectory()) walk(root, rel, out, limit);
    else if (stat.isFile() && stat.size <= aiCodeMaxFileBytes()) out.push(rel);
  }
}

export async function runAiCodeTool(
  name: string,
  args: Record<string, unknown>,
  context: AiCodeToolContext,
): Promise<AiCodeToolResult> {
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  try {
    if (name === 'code__list_dir') {
      const raw = text(args.path).trim();
      const rel = raw ? normalizeRepoPath(raw) : '';
      assertListablePath(rel);
      const abs = rel
        ? resolveInside(context.root, rel)
        : resolveInside(context.root, '.');
      if (!existsSync(abs) || !statSync(abs).isDirectory()) {
        return { text: `目录不存在：${rel || '/'}`, changed: false };
      }
      const entries = readdirSync(abs)
        .filter((entry) => !isDeniedPath(rel ? `${rel}/${entry}` : entry))
        .slice(0, MAX_LIST_ENTRIES)
        .map((entry) => {
          const childRel = rel ? `${rel}/${entry}` : entry;
          try {
            return statSync(resolveInside(context.root, childRel)).isDirectory()
              ? `${entry}/`
              : entry;
          } catch {
            return entry;
          }
        });
      return {
        text: `目录 ${rel || '/'}：\n${entries.join('\n') || '（空）'}`,
        changed: false,
      };
    }
    if (name === 'code__read_file') {
      const rel = normalizeRepoPath(args.path);
      assertReadablePath(rel);
      const content = readEffectiveText(context.root, context.sessionId, rel);
      if (content === null) {
        return {
          text: `文件不存在：${rel}（可用 code__write_file 新建）`,
          changed: false,
        };
      }
      const lines = content.replace(/\r\n/g, '\n').split('\n');
      const start = Math.max(1, Number(args.start) || 1);
      const end = Math.min(lines.length, Number(args.end) || lines.length);
      if (end < start) return { text: '行号范围不正确', changed: false };
      if (end - start + 1 > MAX_READ_LINES) {
        return {
          text: `一次读取不能超过 ${MAX_READ_LINES} 行，请用 start/end 分段读取（共 ${lines.length} 行）`,
          changed: false,
        };
      }
      const body = lines
        .slice(start - 1, end)
        .map(
          (line, index) => `${String(start + index).padStart(5, ' ')}\t${line}`,
        )
        .join('\n');
      return {
        text: clip(
          `文件 ${rel}（第 ${start}-${end} 行 / 共 ${lines.length} 行）：\n${body}`,
        ),
        changed: false,
      };
    }
    if (name === 'code__grep') {
      const pattern = text(args.pattern);
      if (!pattern) return { text: '缺少正则 pattern', changed: false };
      let re: RegExp;
      try {
        re = new RegExp(pattern, 'i');
      } catch {
        return { text: `正则不合法：${pattern}`, changed: false };
      }
      const glob = text(args.glob).trim();
      const matcher = glob ? globToRegExp(glob) : null;
      const baseDir = text(args.path).trim();
      const roots = baseDir ? [normalizeRepoPath(baseDir)] : SEARCH_ROOTS;
      for (const dir of roots) assertListablePath(dir);
      const files: string[] = [];
      for (const dir of roots) walk(context.root, dir, files, MAX_GREP_FILES);
      const hits: string[] = [];
      for (const rel of files) {
        if (matcher && !matcher.test(rel.split('/').pop() || '')) continue;
        let content: string;
        try {
          if (!isAllowedPath(rel)) continue;
          content =
            readEffectiveText(context.root, context.sessionId, rel) ??
            readFileSync(resolveInside(context.root, rel), 'utf8');
        } catch {
          continue;
        }
        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          if (!re.test(lines[index])) continue;
          hits.push(`${rel}:${index + 1}: ${lines[index].slice(0, 300)}`);
          if (hits.length >= MAX_GREP_HITS) break;
        }
        if (hits.length >= MAX_GREP_HITS) break;
      }
      return {
        text: hits.length
          ? clip(
              `命中 ${hits.length} 条${hits.length >= MAX_GREP_HITS ? '（已截断）' : ''}：\n${hits.join('\n')}`,
            )
          : '没有命中',
        changed: false,
      };
    }
    if (name === 'code__write_file') {
      const rel = normalizeRepoPath(args.path);
      const result = await context.staging.writeFile(
        context.sessionId,
        rel,
        text(args.content),
      );
      return {
        text: result.changed
          ? `已写入暂存区：${rel}（${result.changeType}）；管理员审阅后才会应用到线上`
          : `内容与现有文件一致，无需变更：${rel}`,
        changed: result.changed,
        path: rel,
      };
    }
    if (name === 'code__apply_patch') {
      const rel = normalizeRepoPath(args.path);
      const result = await context.staging.applyPatch(
        context.sessionId,
        rel,
        text(args.patch),
      );
      return {
        text: result.changed
          ? `补丁已应用到暂存区：${rel}`
          : `补丁不产生实际变更：${rel}`,
        changed: result.changed,
        path: rel,
      };
    }
    if (name === 'code__delete_file') {
      const rel = normalizeRepoPath(args.path);
      const result = await context.staging.deleteFile(context.sessionId, rel);
      return {
        text: result.changed
          ? `已登记删除：${rel}（管理员审阅后才会真正删除）`
          : `文件不存在，无需删除：${rel}`,
        changed: result.changed,
        path: rel,
      };
    }
    return { text: `未知的代码工具：${name}`, changed: false };
  } catch (error) {
    if (error instanceof BusinessException) {
      return { text: `工具调用失败：${error.message}`, changed: false };
    }
    throw error;
  }
}

/** 读工作区某个文件是否存在（提示模型前给个轻量信号）。 */
export function workspaceHas(root: string, rel: string) {
  return readWorkspaceText(root, rel) !== null;
}
