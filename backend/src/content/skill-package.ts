import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { stripInvisible, toSingleLine } from '../common/text-safety';
import { readZipEntries } from './zip-read';

/** 技能包文本文件白名单：只收可直接进上下文阅读的文本，二进制一律忽略。 */
const TEXT_EXTENSIONS = [
  '.md',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.csv',
  '.html',
  '.xml',
];
const MAX_ENTRIES = 60;
const MAX_FILE_BYTES = 200 * 1024;
const MAX_TOTAL_BYTES = 600 * 1024;

type Entry = { path: string; content: string };

/** 技能包只收可直接进上下文阅读的文本，二进制一律忽略。 */
export function readZipTextFiles(buffer: Buffer) {
  const files = readZipEntries(buffer, {
    extensions: TEXT_EXTENSIONS,
    maxEntries: MAX_ENTRIES,
    maxFileBytes: MAX_FILE_BYTES,
    maxTotalBytes: MAX_TOTAL_BYTES,
  })
    .map((entry) => ({
      path: entry.path,
      content: Buffer.from(entry.bytes).toString('utf8'),
    }))
    .filter((entry) => entry.content.trim());
  if (!files.length) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      'zip 里没有可读的文本文件（支持 .md / .txt / .json / .yaml / .yml / .csv）',
    );
  }
  return files;
}

/** 去掉压缩包外层的那一层同名目录（zip 常见 `<skill>/SKILL.md` 结构）。 */
export function stripCommonRoot(files: Entry[]) {
  if (!files.length) return files;
  const roots = new Set(
    files.map((file) =>
      file.path.includes('/') ? file.path.split('/')[0] : '',
    ),
  );
  if (roots.size !== 1 || roots.has('')) return files;
  const root = Array.from(roots)[0];
  return files.map((file) => ({
    ...file,
    path: file.path.slice(root.length + 1),
  }));
}

/** 解析 SKILL.md 的 frontmatter（name / description），没有就用正文首行兜底。 */
export function parseSkillMarkdown(markdown: string, fallbackName: string) {
  const text = stripInvisible(markdown).replace(/\r\n/g, '\n');
  let name = '';
  let description = '';
  let body = text.trim();
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (match) {
    body = text.slice(match[0].length).trim();
    for (const line of match[1].split('\n')) {
      const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
      if (!pair) continue;
      const key = pair[1].toLowerCase();
      const value = pair[2].replace(/^["']|["']$/g, '').trim();
      if (key === 'name') name = value;
      if (key === 'description') description = value;
    }
  }
  if (!name) {
    const heading = /^#\s+(.+)$/m.exec(body);
    name = heading ? heading[1].trim() : fallbackName;
  }
  if (!description) {
    const firstParagraph = body
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('#'));
    description = firstParagraph || '';
  }
  return {
    // 名称与一句话说明会随每轮系统提示注入，只保留单行且剥掉不可见字符
    name: toSingleLine(name, 60),
    description: toSingleLine(description.replace(/^#+\s*/, ''), 200),
    content: stripInvisible(body).slice(0, 20000),
  };
}
