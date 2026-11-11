import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { cpSync } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import type {
  AiCodeEditsResult,
  AiCodeEdit,
  AiCodeExportResult,
  AiCodeMessage,
  AiCodeModel,
  AiCodeOverview,
  AiCodeSession,
  AiCodeSessionDetail,
  AiCodeToolCall,
  AiCodeUnlockResult,
} from '@enterprise/contracts';
import { AI_CODE_CONFIRM_TEXT } from '@enterprise/contracts';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { CurrentUser } from '../auth/current-user';
import type { IdentityService } from '../identity/identity.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { UserLookupService } from '../directory/user-lookup.service';
import type { ContentModelSettingService } from '../content/model-setting.service';
import { LOCALAPI_CHANNEL_ID } from '../model-plaza/localapi';
import { assertSensitivePassword } from '../common/confirm-password';
import { deployment, installDir, updateDir } from '../upgrade/upgrade.config';
import { diskFreeBytes, upgradeTools } from '../upgrade/upgrade-backup.service';
import { currentCommit, currentVersion } from '../upgrade/upgrade-version';
import type { UpgradeJobService } from '../upgrade/upgrade-job.service';
import {
  aiCodeAllowApply,
  aiCodeEnabled,
  aiCodeExportsDir,
  aiCodeHistoryLimit,
  aiCodeMaxFileBytes,
  aiCodeMaxFiles,
  aiCodeSessionDir,
} from './ai-code.config';
import { AiCodeEngine } from './ai-code-engine';
import { AiCodeStaging } from './ai-code-staging';
import {
  issueUnlock,
  isUnlocked,
  requireUnlock,
  unlockExpiresAt,
} from './ai-code-unlock';

const LEGACY_ARCHIVE = 'tar';
/** 参考附件里的文本类文件：直接内联进提示词（图片走视觉通道）。 */
const TEXT_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.css',
  '.scss',
  '.html',
  '.sql',
  '.yml',
  '.yaml',
  '.txt',
  '.prisma',
]);

export type AiCodeUploadFile = {
  name: string;
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

type SessionRow = {
  id: number;
  ownerId: string;
  title: string;
  model: string;
  status: string;
  stagingDir: string;
  jobId: number | null;
  lastMessage: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * AI 编程服务：会话 / 消息 / 暂存区审阅 / 导出补丁 / 在线应用（复用平台升级执行器）。
 * 模型只写暂存区；真正落到线上源码树永远由 upgrade-runner 在备份之后完成。
 */
export class AiCodeService {
  private readonly staging: AiCodeStaging;
  private readonly engine = new AiCodeEngine();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ContentModelSettingService,
    private readonly identity: IdentityService,
    private readonly users: UserLookupService,
    private readonly jobs: UpgradeJobService,
  ) {
    this.staging = new AiCodeStaging(prisma, installDir());
  }

  // ------------------------------------------------------------------ 概览

  async overview(user: CurrentUser): Promise<AiCodeOverview> {
    this.assertAdmin(user);
    const [active, model] = await Promise.all([
      this.jobs.codeEditActiveJob(),
      this.currentModel(user),
    ]);
    const deploy = deployment();
    return {
      enabled: aiCodeEnabled(),
      allowApply: aiCodeAllowApply(),
      unlocked: isUnlocked(user.userId),
      unlockExpiresAt: unlockExpiresAt(user.userId),
      workspace: {
        root: installDir(),
        updateDir: updateDir(),
        version: currentVersion(),
        commit: currentCommit(),
        branch: process.env.UPGRADE_BRANCH || '',
        deploymentMode: deploy.mode,
        autoRestart: deploy.autoRestart,
        hostUpgradeRequired: deploy.hostUpgradeRequired,
        hostCommand: deploy.hostCommand,
      },
      activeJob: active,
      diskFreeBytes: diskFreeBytes(),
      tools: upgradeTools(),
      model,
      limits: {
        maxFiles: aiCodeMaxFiles(),
        maxFileBytes: aiCodeMaxFileBytes(),
      },
    };
  }

  async unlock(
    user: CurrentUser,
    body: { password: string },
  ): Promise<AiCodeUnlockResult> {
    this.assertAdmin(user);
    await assertSensitivePassword(
      this.prisma,
      user.userId,
      body.password,
      'AI 编程（后台自助改码）',
    );
    const expiresAt = issueUnlock(user.userId);
    await this.audit(user, '解锁 AI 编程', `票据有效至 ${expiresAt}`);
    return {
      unlocked: true,
      expiresAt,
      ttlMinutes: Math.max(
        1,
        Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000),
      ),
    };
  }

  async models(user: CurrentUser) {
    this.assertAdmin(user);
    const catalog = await this.settings
      .models(user, LOCALAPI_CHANNEL_ID)
      .catch(() => null);
    const current = await this.currentModel(user);
    const list: AiCodeModel[] = (catalog?.models || [])
      .filter((item) => item.kind === 'text')
      .map((item) => ({
        id: item.id,
        label: item.id,
        provider: catalog?.baseUrl ? '模型广场' : '',
        capabilities: item.vision ? ['text', 'vision'] : ['text'],
        current: item.id === current,
      }));
    if (current && !list.some((item) => item.id === current)) {
      list.unshift({
        id: current,
        label: current,
        provider: '',
        capabilities: ['text'],
        current: true,
      });
    }
    return { list, current };
  }

  // ------------------------------------------------------------------ 会话

  async sessions(user: CurrentUser) {
    this.assertAdmin(user);
    const rows = await this.prisma.aiCodeSession.findMany({
      where: { ownerId: user.userId },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    return { list: await this.sessionViews(rows) };
  }

  async createSession(
    user: CurrentUser,
    body: { title: string; model: string },
  ) {
    this.assertAdmin(user);
    const model = body.model.trim() || (await this.currentModel(user));
    const row = await this.prisma.aiCodeSession.create({
      data: {
        ownerId: user.userId,
        title:
          body.title.trim() || `改码会话 ${new Date().toLocaleString('zh-CN')}`,
        model,
        status: 'ACTIVE',
        stagingDir: aiCodeSessionDir(0),
      },
    });
    await this.prisma.aiCodeSession.update({
      where: { id: row.id },
      data: { stagingDir: this.staging.sessionDir(row.id) },
    });
    await this.audit(user, '新建 AI 编程会话', `#${row.id} 模型 ${model}`);
    return this.detail(row.id, user.userId);
  }

  async session(user: CurrentUser, id: string) {
    this.assertAdmin(user);
    return this.detail(Number(id), user.userId);
  }

  async edits(user: CurrentUser, id: string): Promise<AiCodeEditsResult> {
    this.assertAdmin(user);
    const sessionId = Number(id);
    await this.ownedSession(sessionId, user.userId);
    const list = await this.staging.list(sessionId);
    return this.editsSummary(list);
  }

  async revert(user: CurrentUser, id: string, body: { path: string }) {
    this.assertAdmin(user);
    const sessionId = Number(id);
    await this.ownedSession(sessionId, user.userId);
    requireUnlock(user.userId);
    const result = await this.staging.revert(sessionId, body.path.trim());
    await this.audit(
      user,
      body.path ? '弃用暂存变更' : '弃用全部暂存变更',
      `会话 #${sessionId}${body.path ? ` ${body.path}` : ''}`,
    );
    return result;
  }

  /** 逐文件采纳 / 弃用：采纳只是把状态改成 approved，落地仍要「备份并执行」。 */
  async approve(
    user: CurrentUser,
    id: string,
    body: { path: string; status: 'approved' | 'rejected' },
  ) {
    this.assertAdmin(user);
    const sessionId = Number(id);
    await this.ownedSession(sessionId, user.userId);
    requireUnlock(user.userId);
    const list = await this.staging.setStatus(
      sessionId,
      body.path.trim(),
      body.status,
    );
    await this.audit(
      user,
      body.status === 'approved' ? '采纳暂存变更' : '弃用暂存变更',
      `会话 #${sessionId} ${body.path}`,
    );
    return this.editsSummary(list);
  }

  // ------------------------------------------------------------------ 导出 / 应用

  async export(user: CurrentUser, id: string): Promise<AiCodeExportResult> {
    this.assertAdmin(user);
    const sessionId = Number(id);
    const session = await this.ownedSession(sessionId, user.userId);
    requireUnlock(user.userId);
    const files = await this.staging.approvedFiles(sessionId);
    if (!files.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '还没有已采纳的变更，无法导出补丁包',
      );
    }
    const dir = resolve(aiCodeExportsDir(), `${sessionId}-${Date.now()}`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const file of files) {
      if (!file.stagedFile) continue;
      const dest = resolve(dir, file.path);
      mkdirSync(resolve(dest, '..'), { recursive: true });
      cpSync(file.stagedFile, dest);
    }
    writeFileSync(
      resolve(dir, 'ai-code.patch.json'),
      JSON.stringify(
        {
          sessionId,
          title: session.title,
          model: session.model,
          version: currentVersion(),
          files: files.map(({ path, changeType }) => ({ path, changeType })),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    const fileName = `ai-code-${sessionId}-${Date.now()}.tar.gz`;
    const target = resolve(aiCodeExportsDir(), fileName);
    await this.tar(dir, target);
    const bytes = statSync(target).size;
    const sha256 = createHash('sha256')
      .update(readFileSync(target))
      .digest('hex');
    await this.audit(
      user,
      '导出 AI 编程补丁包',
      `会话 #${sessionId} ${files.length} 个文件`,
    );
    return {
      fileName,
      bytes,
      sha256,
      url: `/api/backend/enterprise/admin/ai-code/exports/${fileName}`,
    };
  }

  async apply(
    user: CurrentUser,
    body: {
      sessionId: number;
      backupDatabase: boolean;
      backupCode: boolean;
      autoRollback: boolean;
      conflictStrategy: 'overwrite' | 'abort';
      confirmation: string;
    },
  ) {
    this.assertAdmin(user);
    if (!aiCodeEnabled()) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'AI 编程功能当前未开启',
      );
    }
    if (!aiCodeAllowApply()) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '当前只允许导出补丁包（在线应用已被关闭）',
      );
    }
    requireUnlock(user.userId);
    if (String(body.confirmation).trim() !== AI_CODE_CONFIRM_TEXT) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `确认文本不正确，请输入「${AI_CODE_CONFIRM_TEXT}」`,
      );
    }
    const session = await this.ownedSession(
      Number(body.sessionId),
      user.userId,
    );
    const files = await this.staging.approvedFiles(session.id);
    if (!files.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '还没有已采纳的变更，无法执行',
      );
    }
    const job = await this.jobs.createCodeEdit(user, {
      sessionId: session.id,
      title: session.title,
      fromVersion: currentVersion(),
      stagingDir: this.staging.sessionDir(session.id),
      files: files.map(({ path, changeType }) => ({ path, changeType })),
      options: {
        backupDatabase: true,
        backupCode: body.backupCode,
        autoRollback: body.autoRollback,
        conflictStrategy: body.conflictStrategy,
      },
    });
    await this.staging.markApplied(session.id, job.id);
    await this.prisma.aiCodeSession.update({
      where: { id: session.id },
      data: { jobId: job.id, status: 'APPLIED' },
    });
    await this.audit(
      user,
      '发起 AI 编程在线应用',
      `会话 #${session.id} 任务 #${job.id} ${files.length} 个文件`,
    );
    return job;
  }

  // ------------------------------------------------------------------ 对话

  async chat(
    user: CurrentUser,
    token: string | undefined,
    id: string,
    body: Record<string, unknown>,
    emit: (event: string, data: Record<string, unknown>) => Promise<void>,
  ) {
    this.assertAdmin(user);
    if (!aiCodeEnabled()) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'AI 编程功能当前未开启',
      );
    }
    const sessionId = Number(id);
    const session = await this.ownedSession(sessionId, user.userId);
    requireUnlock(user.userId);

    const content = (
      typeof body.content === 'string' ? body.content : ''
    ).trim();
    const rawRefs = Array.isArray(body.references) ? body.references : [];
    const refs = rawRefs
      .map((item) =>
        item && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : {},
      )
      .map((item) => ({
        name: typeof item.name === 'string' ? item.name : '',
        url: typeof item.url === 'string' ? item.url : '',
      }))
      .filter((item) => item.url)
      .slice(0, 6);
    if (!content && !refs.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请输入内容或上传附件',
      );
    }

    const userRow = await this.prisma.aiCodeMessage.create({
      data: {
        sessionId,
        role: 'user',
        content,
        model: session.model,
        referencesJson: JSON.stringify(refs),
        status: 'DONE',
      },
    });
    await this.prisma.aiCodeSession.update({
      where: { id: sessionId },
      data: {
        lastMessage:
          content.slice(0, 200) || refs.map((ref) => ref.name).join('、'),
      },
    });
    await emit('message', { id: userRow.id, role: 'user' });

    const assistant = await this.prisma.aiCodeMessage.create({
      data: {
        sessionId,
        role: 'assistant',
        content: '',
        model: session.model,
        status: 'STREAMING',
      },
    });

    const history = await this.history(sessionId);
    const attachments = this.attachmentParts(sessionId, refs);
    if (attachments.text) {
      const last = history[history.length - 1];
      if (last?.role === 'user')
        last.content = `${last.content}\n\n${attachments.text}`;
      else history.push({ role: 'user', content: attachments.text });
    }
    const target = await this.resolveTarget(user, token, session.model);
    let text = '';
    const toolCalls: AiCodeToolCall[] = [];
    try {
      const result = await this.engine.run({
        model: target.model,
        protocol: target.protocol,
        baseUrl: target.baseUrl,
        apiKey: target.apiKey,
        system: await this.systemPrompt(session),
        history,
        images: attachments.images,
        toolContext: {
          root: installDir(),
          sessionId,
          staging: this.staging,
        },
        signal: new AbortController().signal,
        emit: async (event) => {
          if (event.type === 'delta') text += event.text;
          await emit(event.type, event);
        },
      });
      text = result.text;
      toolCalls.push(...result.toolCalls);
      await this.prisma.aiCodeMessage.update({
        where: { id: assistant.id },
        data: {
          content: text,
          toolCallsJson: JSON.stringify(toolCalls),
          status: 'DONE',
        },
      });
      await emit('done', { id: assistant.id, text });
    } catch (error) {
      const message =
        error instanceof BusinessException
          ? error.message
          : '对话失败，请稍后重试';
      await this.prisma.aiCodeMessage.update({
        where: { id: assistant.id },
        data: {
          content: text,
          error: message,
          status: 'ERROR',
          toolCallsJson: JSON.stringify(toolCalls),
        },
      });
      throw error;
    }
  }

  /** 参考图 / 文件上传：落会话附件目录，对话时按需内联给模型。 */
  async upload(user: CurrentUser, id: string, file: AiCodeUploadFile) {
    this.assertAdmin(user);
    const sessionId = Number(id);
    await this.ownedSession(sessionId, user.userId);
    requireUnlock(user.userId);
    if (!file || !file.name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择要上传的文件');
    }
    if (file.size > 8 * 1024 * 1024) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '单个附件不能超过 8MB',
      );
    }
    const dir = resolve(this.staging.sessionDir(sessionId), 'uploads');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const safe = basename(file.name).replace(/[^\w.\-()\u4e00-\u9fa5]/g, '_');
    const name = `${Date.now()}-${safe}`;
    const target = resolve(dir, name);
    const stream = createWriteStream(target, { mode: 0o600 });
    stream.end(Buffer.from(await file.arrayBuffer()));
    await new Promise<void>((done, reject) => {
      stream.on('finish', () => done());
      stream.on('error', reject);
    });
    return {
      name: file.name,
      storedName: name,
      url: `/api/backend/enterprise/admin/ai-code/sessions/${sessionId}/uploads/${name}`,
      mime: file.type || '',
      bytes: file.size,
    };
  }

  /** 下载附件 / 补丁包：都要求平台管理员；附件限本会话目录。 */
  readUpload(user: CurrentUser, id: string, name: string) {
    this.assertAdmin(user);
    const sessionId = Number(id);
    const dir = resolve(this.staging.sessionDir(sessionId), 'uploads');
    const target = resolve(dir, basename(name));
    if (!target.startsWith(dir) || !existsSync(target)) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '附件不存在');
    }
    return target;
  }

  readExport(user: CurrentUser, name: string) {
    this.assertAdmin(user);
    const dir = aiCodeExportsDir();
    const target = resolve(dir, basename(name));
    if (!target.startsWith(dir) || !existsSync(target)) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '补丁包不存在或已被清理',
      );
    }
    return target;
  }

  // ------------------------------------------------------------------ 内部

  private assertAdmin(user: CurrentUser) {
    if (!user.isAdmin()) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '仅平台管理员可使用 AI 编程',
      );
    }
  }

  private async ownedSession(
    sessionId: number,
    userId: string,
  ): Promise<SessionRow> {
    const row = await this.prisma.aiCodeSession.findUnique({
      where: { id: sessionId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '会话不存在');
    if (row.ownerId !== userId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只能访问自己创建的改码会话',
      );
    }
    return row;
  }

  private async sessionViews(rows: SessionRow[]): Promise<AiCodeSession[]> {
    const ids = rows.map((row) => row.id);
    const [editCounts, pendingCounts, messageCounts] = await Promise.all([
      this.groupCount('aiCodeEdit', ids),
      this.groupCount('aiCodeEdit', ids, { status: 'pending' }),
      this.groupCount('aiCodeMessage', ids),
    ]);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      model: row.model,
      status: row.status as AiCodeSession['status'],
      ownerId: Number(row.ownerId),
      ownerName: '',
      messageCount: messageCounts.get(row.id) || 0,
      editCount: editCounts.get(row.id) || 0,
      pendingCount: pendingCounts.get(row.id) || 0,
      jobId: row.jobId,
      lastMessage: row.lastMessage,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  private async groupCount(
    model: 'aiCodeEdit' | 'aiCodeMessage',
    ids: number[],
    where: Record<string, unknown> = {},
  ) {
    const map = new Map<number, number>();
    if (!ids.length) return map;
    const rows =
      model === 'aiCodeEdit'
        ? await this.prisma.aiCodeEdit.groupBy({
            by: ['sessionId'],
            where: { sessionId: { in: ids }, ...where },
            _count: { _all: true },
          })
        : await this.prisma.aiCodeMessage.groupBy({
            by: ['sessionId'],
            where: { sessionId: { in: ids }, ...where },
            _count: { _all: true },
          });
    for (const row of rows) map.set(row.sessionId, row._count._all);
    return map;
  }

  private async detail(
    sessionId: number,
    userId: string,
  ): Promise<AiCodeSessionDetail> {
    const row = await this.ownedSession(sessionId, userId);
    const messages = await this.prisma.aiCodeMessage.findMany({
      where: { sessionId },
      orderBy: { id: 'asc' },
      take: 200,
    });
    const ownerName = await this.users.displayName(row.ownerId).catch(() => '');
    const [view] = await this.sessionViews([row]);
    return {
      ...view,
      ownerName,
      stagingDir: row.stagingDir,
      messages: messages.map((message) => this.messageView(message)),
    };
  }

  private messageView(row: {
    id: number;
    sessionId: number;
    role: string;
    content: string;
    model: string;
    referencesJson: string | null;
    toolCallsJson: string | null;
    status: string;
    error: string;
    createdAt: Date;
  }): AiCodeMessage {
    const references = this.parseArray<AiCodeMessage['references'][number]>(
      row.referencesJson,
    );
    const toolCalls = this.parseArray<AiCodeToolCall>(row.toolCallsJson);
    return {
      id: row.id,
      sessionId: row.sessionId,
      role: row.role as AiCodeMessage['role'],
      content: row.content,
      model: row.model,
      references,
      toolCalls,
      status: row.status as AiCodeMessage['status'],
      error: row.error,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private parseArray<T>(json: string | null): T[] {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json) as unknown;
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  private editsSummary(list: AiCodeEdit[]): AiCodeEditsResult {
    const by = (type: AiCodeEdit['changeType']) =>
      list.filter((item) => item.changeType === type).length;
    return {
      list,
      summary: {
        files: list.length,
        added: by('added'),
        modified: by('modified'),
        deleted: by('deleted'),
        bytes: list.reduce((sum, item) => sum + item.bytes, 0),
        pending: list.filter((item) => item.status === 'pending').length,
      },
      risky: {
        schema: list.some((item) => item.path.endsWith('schema.prisma')),
        migrations: list.some((item) =>
          item.path.startsWith('backend/prisma/migrations/'),
        ),
        dependencies: list.some(
          (item) =>
            item.path === 'package.json' ||
            item.path === 'pnpm-lock.yaml' ||
            item.path.endsWith('/package.json'),
        ),
      },
    };
  }

  private async history(sessionId: number) {
    const limit = aiCodeHistoryLimit();
    const rows = await this.prisma.aiCodeMessage.findMany({
      where: { sessionId, status: { in: ['DONE', 'STREAMING'] } },
      orderBy: { id: 'desc' },
      take: limit,
    });
    return rows
      .reverse()
      .filter((row) => row.role === 'user' || row.role === 'assistant')
      .filter((row) => row.content.trim() || row.role === 'user')
      .map((row) => ({
        role: row.role as 'user' | 'assistant',
        content: row.content || '（本轮没有文字输出，只调用了工具）',
      }));
  }

  /** 附件 → 图片 base64（视觉模型）；文本类文件直接内联进提示。 */
  /** 附件分流：图片交给视觉通道，文本类内联进本轮提示（单文件上限 200KB）。 */
  private attachmentParts(
    sessionId: number,
    refs: { name: string; url: string }[],
  ): { images: { mime: string; dataUrl: string }[]; text: string } {
    const images: { mime: string; dataUrl: string }[] = [];
    const notes: string[] = [];
    for (const ref of refs) {
      const name = ref.url.split('/').pop() || '';
      const target = resolve(
        this.staging.sessionDir(sessionId),
        'uploads',
        basename(name),
      );
      if (!existsSync(target)) continue;
      const ext = extname(ref.name).toLowerCase();
      if (/^\.(png|jpe?g|webp|gif)$/.test(ext)) {
        const mime = `image/${ext.slice(1).replace('jpg', 'jpeg')}`;
        const bytes = readFileSync(target);
        if (bytes.byteLength > 6 * 1024 * 1024) continue;
        images.push({
          mime,
          dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
        });
        continue;
      }
      if (!TEXT_EXT.has(ext)) continue;
      const bytes = readFileSync(target);
      if (bytes.byteLength > 200 * 1024) continue;
      notes.push(
        `### 附件：${ref.name}\n\`\`\`\n${bytes.toString('utf8')}\n\`\`\``,
      );
    }
    return { images, text: notes.join('\n\n') };
  }

  private async currentModel(user: CurrentUser) {
    const slot = await this.settings.slotOf(user, 'text').catch(() => null);
    return slot?.model || '';
  }

  private async resolveTarget(
    user: CurrentUser,
    token: string | undefined,
    model: string,
  ) {
    return this.settings.resolveTarget(
      user,
      'text',
      token,
      model ? { channelId: LOCALAPI_CHANNEL_ID, model } : undefined,
    );
  }

  private async systemPrompt(session: SessionRow) {
    const existing = await this.staging.list(session.id);
    const changed = existing
      .slice(0, 40)
      .map((item) => `- ${item.path}（${item.changeType}，${item.status}）`)
      .join('\n');
    return [
      '你是「AI 编程」助手，负责按管理员的要求修改本系统的源码。',
      '',
      '规则（必须遵守）：',
      '1. 只能通过 code__ 系列工具读写代码：list_dir / read_file / grep / write_file / apply_patch / delete_file。你没有执行命令的能力。',
      '2. 允许改动的目录：backend/src、frontend/src、packages/contracts/src、backend/prisma、docs。其余路径（.env、node_modules、构建产物等）一律拒绝。',
      '3. 改动只写入暂存区，管理员审阅差异后才会应用；不要假设已经生效。',
      '4. 写文件前先 read_file 看现状；整文件重写用 code__write_file（最稳），只有小幅改动才用 code__apply_patch。',
      '5. 契约（packages/contracts）改动必须前后端同步：改 DTO 后同步后端控制器与前端调用，避免类型不一致。',
      '6. 回复用中文，简洁说明：准备改哪些文件、每个文件改什么、有什么风险。',
      '7. 不要输出大段完整代码到对话里，把代码写进文件，用一句话描述改动即可。',
      '',
      `当前版本：${currentVersion()}；工作区：${installDir()}`,
      changed ? `\n本次会话已改动的文件：\n${changed}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async tar(sourceDir: string, target: string) {
    const command =
      process.platform === 'win32'
        ? resolve(
            process.env.SystemRoot || 'C:\\Windows',
            'System32',
            'tar.exe',
          )
        : LEGACY_ARCHIVE;
    await new Promise<void>((done, reject) => {
      const child = spawn(command, ['-czf', target, '-C', sourceDir, '.'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      child.on('error', reject);
      child.on('exit', (code) =>
        code === 0 ? done() : reject(new Error(`打包失败：${code}`)),
      );
    });
    rmSync(sourceDir, { recursive: true, force: true });
  }

  private async audit(user: CurrentUser, action: string, detail: string) {
    try {
      await this.identity.audit(user.userId, action, detail);
    } catch {
      // 审计失败不影响主流程
    }
  }
}
