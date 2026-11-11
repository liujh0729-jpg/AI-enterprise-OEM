import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { AiCodeChangeType, AiCodeEdit } from '@enterprise/contracts';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { PrismaService } from '../prisma/prisma.service';
import {
  aiCodeMaxFileBytes,
  aiCodeMaxFiles,
  aiCodeSessionDir,
} from './ai-code.config';
import { assertWritablePath, resolveInside } from './ai-code-paths';

/**
 * 暂存区：模型的所有写操作只落 update/ai-code/<sessionId>/files/<rel>，
 * 每个文件在 ai_code_edits 里登记一份「相对工作区基线」的 unified diff，供人工审阅。
 * 线上源码树在整个「对话 → 审阅」阶段一个字都不改。
 */

function sha256(content: string) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function stagingFile(sessionId: number, rel: string) {
  return resolveInside(aiCodeSessionDir(sessionId), `files/${rel}`);
}

function workspaceFile(root: string, rel: string) {
  return resolveInside(root, rel);
}

/** 工作区里的原始内容；文件不存在返回 null。 */
export function readWorkspaceText(root: string, rel: string) {
  const abs = workspaceFile(root, rel);
  if (!existsSync(abs)) return null;
  const bytes = readFileSync(abs);
  if (bytes.byteLength > aiCodeMaxFileBytes()) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `文件超过 ${Math.round(aiCodeMaxFileBytes() / 1024)}KB 上限，暂不支持读写：${rel}`,
    );
  }
  return bytes.toString('utf8');
}

/** 当前有效内容：优先取暂存区里模型改过的版本，其次工作区原文件。 */
export function readEffectiveText(
  root: string,
  sessionId: number,
  rel: string,
) {
  const staged = stagingFile(sessionId, rel);
  if (existsSync(staged)) {
    const bytes = readFileSync(staged);
    if (bytes.byteLength > aiCodeMaxFileBytes()) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `暂存文件超过 ${Math.round(aiCodeMaxFileBytes() / 1024)}KB 上限：${rel}`,
      );
    }
    return bytes.toString('utf8');
  }
  return readWorkspaceText(root, rel);
}

export function hasStagedText(sessionId: number, rel: string) {
  return existsSync(stagingFile(sessionId, rel));
}

// ---------------------------------------------------------------------------
// 行级 diff（LCS）；文件过大时退化为「公共前后缀 + 单块替换」，保证不出错也不吃内存。
// ---------------------------------------------------------------------------

type DiffOp = { type: ' ' | '-' | '+'; line: string };

const LCS_LIMIT = 4_000_000;

function splitLines(text: string) {
  return text.length ? text.replace(/\r\n/g, '\n').split('\n') : [];
}

function lcsOps(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  if (n * m > LCS_LIMIT) {
    let prefix = 0;
    while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix += 1;
    let suffix = 0;
    while (
      suffix < n - prefix &&
      suffix < m - prefix &&
      a[n - 1 - suffix] === b[m - 1 - suffix]
    ) {
      suffix += 1;
    }
    const ops: DiffOp[] = [];
    for (let i = 0; i < prefix; i += 1) ops.push({ type: ' ', line: a[i] });
    for (let i = prefix; i < n - suffix; i += 1)
      ops.push({ type: '-', line: a[i] });
    for (let i = prefix; i < m - suffix; i += 1)
      ops.push({ type: '+', line: b[i] });
    for (let i = n - suffix; i < n; i += 1) ops.push({ type: ' ', line: a[i] });
    return ops;
  }
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + (j + 1)] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: ' ', line: a[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
      ops.push({ type: '-', line: a[i] });
      i += 1;
    } else {
      ops.push({ type: '+', line: b[j] });
      j += 1;
    }
  }
  while (i < n) ops.push({ type: '-', line: a[i++] });
  while (j < m) ops.push({ type: '+', line: b[j++] });
  return ops;
}

/** 生成标准 unified diff 文本（含 ---/+++/@@ 头，3 行上下文）。 */
export function unifiedDiff(rel: string, oldText: string, newText: string) {
  const ops = lcsOps(splitLines(oldText), splitLines(newText));
  const head = [`--- a/${rel}`, `+++ b/${rel}`];
  const hunks: string[] = [];
  const changed = ops.map((op) => op.type !== ' ');
  if (!changed.some(Boolean)) return '';

  let index = 0;
  while (index < ops.length) {
    // 找下一处变更
    while (index < ops.length && !changed[index]) index += 1;
    if (index >= ops.length) break;
    const start = Math.max(0, index - 3);
    let end = index;
    // 变更块之间间隔不超过 6 行的合并成一个 hunk
    for (;;) {
      while (end < ops.length && changed[end]) end += 1;
      let lookahead = end;
      while (lookahead < ops.length && !changed[lookahead]) lookahead += 1;
      if (lookahead < ops.length && lookahead - end <= 6) {
        end = lookahead;
        continue;
      }
      end = Math.min(ops.length, end + 3);
      break;
    }
    const slice = ops.slice(start, end);
    const oldCount = slice.filter((op) => op.type !== '+').length;
    const newCount = slice.filter((op) => op.type !== '-').length;
    const oldStart =
      ops.slice(0, start).filter((op) => op.type !== '+').length + 1;
    const newStart =
      ops.slice(0, start).filter((op) => op.type !== '-').length + 1;
    hunks.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const op of slice) hunks.push(`${op.type}${op.line}`);
    index = end;
  }
  return [...head, ...hunks].join('\n');
}

/** 应用 unified diff（模型给 code__apply_patch 用），上下文不匹配直接拒绝。 */
export function applyUnifiedDiff(baseText: string, patch: string) {
  const base = splitLines(baseText);
  const out: string[] = [];
  let cursor = 0;
  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  let index = 0;
  let applied = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.startsWith('@@')) {
      index += 1;
      continue;
    }
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (!match) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `无法解析补丁块：${line}`,
      );
    }
    const oldStart = Number(match[1]) - 1;
    if (oldStart < cursor) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '补丁块顺序或行号不正确',
      );
    }
    while (cursor < oldStart) {
      out.push(base[cursor]);
      cursor += 1;
    }
    index += 1;
    while (index < lines.length && !lines[index].startsWith('@@')) {
      const body = lines[index];
      const marker = body.slice(0, 1);
      const content = body.slice(1);
      if (body === '' || marker === '\\') {
        index += 1;
        continue;
      }
      if (marker === ' ') {
        if (base[cursor] !== content) {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            `补丁上下文不匹配（第 ${cursor + 1} 行）：${content.slice(0, 80)}`,
          );
        }
        out.push(content);
        cursor += 1;
      } else if (marker === '-') {
        if (base[cursor] !== content) {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            `补丁删除行不匹配（第 ${cursor + 1} 行）：${content.slice(0, 80)}`,
          );
        }
        cursor += 1;
      } else if (marker === '+') {
        out.push(content);
        applied += 1;
      } else {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `无法识别的补丁行：${body.slice(0, 80)}`,
        );
      }
      index += 1;
    }
  }
  while (cursor < base.length) {
    out.push(base[cursor]);
    cursor += 1;
  }
  if (!applied && !patch.includes('@@')) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '补丁内容为空');
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// 暂存写入 + 变更登记
// ---------------------------------------------------------------------------

export type StagedWriteResult = {
  path: string;
  changeType: AiCodeChangeType | null;
  changed: boolean;
};

function editView(row: {
  id: number;
  sessionId: number;
  path: string;
  changeType: string;
  oldSha: string;
  newSha: string;
  bytes: number;
  diff: string | null;
  status: string;
  appliedJobId: number | null;
  updatedAt: Date;
}): AiCodeEdit {
  return {
    id: row.id,
    sessionId: row.sessionId,
    path: row.path,
    changeType: row.changeType as AiCodeChangeType,
    oldSha: row.oldSha,
    newSha: row.newSha,
    bytes: row.bytes,
    diff: row.diff || '',
    status: row.status as AiCodeEdit['status'],
    appliedJobId: row.appliedJobId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class AiCodeStaging {
  constructor(
    private readonly prisma: PrismaService,
    private readonly root: string,
  ) {}

  sessionDir(sessionId: number) {
    const dir = aiCodeSessionDir(sessionId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }

  /** 写入 / 覆盖一个文件到暂存区，并按「相对工作区基线」登记 diff。 */
  async writeFile(sessionId: number, rel: string, content: string) {
    assertWritablePath(rel);
    if (Buffer.byteLength(content, 'utf8') > aiCodeMaxFileBytes()) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `写入内容超过 ${Math.round(aiCodeMaxFileBytes() / 1024)}KB 上限：${rel}`,
      );
    }
    const base = readWorkspaceText(this.root, rel);
    const staged = stagingFile(sessionId, rel);
    if (base === content) {
      // 与工作区完全一致＝无实际变更：撤掉暂存与登记，避免空 diff 噪音
      rmSync(staged, { force: true });
      await this.prisma.aiCodeEdit.deleteMany({
        where: { sessionId, path: rel },
      });
      return {
        path: rel,
        changeType: null,
        changed: false,
      } satisfies StagedWriteResult;
    }
    mkdirSync(dirname(staged), { recursive: true });
    writeFileSync(staged, content, 'utf8');
    await this.record(sessionId, rel, base, content);
    return {
      path: rel,
      changeType: base === null ? 'added' : 'modified',
      changed: true,
    } satisfies StagedWriteResult;
  }

  /** 删除文件：只登记删除变更，等执行器落地时再删真文件。 */
  async deleteFile(sessionId: number, rel: string) {
    assertWritablePath(rel);
    const base = readWorkspaceText(this.root, rel);
    if (base === null) {
      // 工作区本来就没有：清掉可能的暂存残留，等同无变更
      rmSync(stagingFile(sessionId, rel), { force: true });
      await this.prisma.aiCodeEdit.deleteMany({
        where: { sessionId, path: rel },
      });
      return {
        path: rel,
        changeType: null,
        changed: false,
      } satisfies StagedWriteResult;
    }
    rmSync(stagingFile(sessionId, rel), { force: true });
    await this.record(sessionId, rel, base, null);
    return {
      path: rel,
      changeType: 'deleted',
      changed: true,
    } satisfies StagedWriteResult;
  }

  /** 按 unified diff 打补丁（基于当前有效内容）。 */
  async applyPatch(sessionId: number, rel: string, patch: string) {
    assertWritablePath(rel);
    const base = readEffectiveText(this.root, sessionId, rel);
    if (base === null) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `文件不存在，无法打补丁（可直接用 code__write_file 新建）：${rel}`,
      );
    }
    const next = applyUnifiedDiff(base, patch);
    return this.writeFile(sessionId, rel, next);
  }

  private async record(
    sessionId: number,
    rel: string,
    base: string | null,
    next: string | null,
  ) {
    const count = await this.prisma.aiCodeEdit.count({ where: { sessionId } });
    const exists = await this.prisma.aiCodeEdit.findUnique({
      where: { sessionId_path: { sessionId, path: rel } },
    });
    if (!exists && count >= aiCodeMaxFiles()) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `本次会话变更文件数已达上限 ${aiCodeMaxFiles()}，请先清理不需要的改动`,
      );
    }
    const changeType: AiCodeChangeType =
      base === null ? 'added' : next === null ? 'deleted' : 'modified';
    const oldText = base ?? '';
    const newText = next ?? '';
    const diff = unifiedDiff(rel, oldText, newText);
    const data = {
      changeType,
      oldSha: base === null ? '' : sha256(base),
      newSha: next === null ? '' : sha256(next),
      bytes: Buffer.byteLength(newText, 'utf8'),
      diff,
      // 重新改过的文件回到「待审阅」，避免旧批准作用于新内容
      status: 'pending',
      appliedJobId: null,
    };
    const row = exists
      ? await this.prisma.aiCodeEdit.update({
          where: { id: exists.id },
          data,
        })
      : await this.prisma.aiCodeEdit.create({
          data: { sessionId, path: rel, ...data },
        });
    return row;
  }

  async list(sessionId: number) {
    const rows = await this.prisma.aiCodeEdit.findMany({
      where: { sessionId },
      orderBy: [{ path: 'asc' }],
    });
    return rows.map(editView);
  }

  /** 采纳 / 弃用某个文件；path 为空＝全部弃用。 */
  async setStatus(
    sessionId: number,
    path: string,
    status: 'approved' | 'rejected',
  ) {
    await this.prisma.aiCodeEdit.updateMany({
      where: path
        ? { sessionId, path }
        : { sessionId, status: { not: 'applied' } },
      data: { status },
    });
    return this.list(sessionId);
  }

  /** 弃用＝撤掉暂存文件与登记（删除类变更也要清登记）。 */
  async revert(sessionId: number, path: string) {
    const rows = await this.prisma.aiCodeEdit.findMany({
      where: path
        ? { sessionId, path, status: { not: 'applied' } }
        : { sessionId, status: { not: 'applied' } },
    });
    for (const row of rows) {
      rmSync(stagingFile(sessionId, row.path), { force: true });
    }
    const removed = await this.prisma.aiCodeEdit.deleteMany({
      where: path
        ? { sessionId, path, status: { not: 'applied' } }
        : { sessionId, status: { not: 'applied' } },
    });
    return { reverted: removed.count, list: await this.list(sessionId) };
  }

  /** 执行器要落地的文件集：只取已采纳的变更。 */
  async approvedFiles(sessionId: number) {
    const rows = await this.prisma.aiCodeEdit.findMany({
      where: { sessionId, status: 'approved' },
      orderBy: [{ path: 'asc' }],
    });
    return rows.map((row) => ({
      path: row.path,
      changeType: row.changeType as AiCodeChangeType,
      stagedFile: hasStagedText(sessionId, row.path)
        ? stagingFile(sessionId, row.path)
        : '',
    }));
  }

  /** 把已采纳的文件快照进任务目录，交给独立 runner 落地（避免执行期暂存区再被改动）。 */
  snapshot(sessionId: number, targetDir: string) {
    return this.approvedFiles(sessionId).then((files) => {
      for (const file of files) {
        if (!file.stagedFile) continue;
        const dest = resolveInside(targetDir, file.path);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, readFileSync(file.stagedFile));
      }
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(
        resolveInside(targetDir, 'manifest.json'),
        JSON.stringify(
          {
            files: files.map(({ path, changeType }) => ({ path, changeType })),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      return { files, total: files.length };
    });
  }

  /** 标记为已落地；失败回滚时由升级任务服务改回 approved。 */
  async markApplied(sessionId: number, jobId: number) {
    await this.prisma.aiCodeEdit.updateMany({
      where: { sessionId, status: 'approved' },
      data: { status: 'applied', appliedJobId: jobId },
    });
  }
}
