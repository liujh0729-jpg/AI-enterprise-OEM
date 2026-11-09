import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { RateWindow } from '../common/rate-window';
import { toJsonInput } from '../common/json-input';
import { stripInvisible, toSingleLine } from '../common/text-safety';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  describeFindings,
  describePermissions,
  formatSecurityFailure,
  hasDeclaredPermissions,
  parseSkillSecurityMeta,
  runUploadSecurityGate,
  scanRuntimeContent,
  type SkillPermissions,
} from '../feature/skill-security';
import type { BlacklistEntryLite } from '../feature/skill-review.rules';
import type {
  PackageReviewInput,
  PackageReviewResult,
} from '../feature/skill-review.runner';
import {
  parseSkillMarkdown,
  readZipTextFiles,
  stripCommonRoot,
} from './skill-package';
import {
  listAgentRevisions,
  readAgentRevision,
  saveAgentRevision,
} from './agent-revisions';

/** 每账号技能上限：技能摘要每轮都要进系统提示，不封顶就能把上下文和数据库一起撑大。 */
const MAX_SKILLS = 100;
/** 系统提示里最多列多少条技能摘要，以及这些摘要合计多少字。 */
const SUMMARY_MAX = 40;
const SUMMARY_BUDGET = 4000;
/** 上传解包是 CPU 密集动作（zip 解压 + 正则），按账号限流。 */
const IMPORT_MAX = 20;
const IMPORT_WINDOW_MS = 60_000;

/**
 * Agent 技能（照附件的 SKILL.md 语义）：
 * 每个技能＝名称 + 一句话说明 + 全文；说明进系统提示，模型决定要不要用，用 load_skill 取全文。
 * 归属严格按登录账号，同企业其他账号看不到。
 * 技能包只当文本资料入库，服务端不执行包内任何脚本。
 */
export class ContentAgentSkillService {
  private readonly importLimiter = new RateWindow(IMPORT_MAX, IMPORT_WINDOW_MS);
  /** 审查挂钩（§5.9 先审后用）：装配时由 services.ts 属性注入 SkillReviewRunner.enqueue。 */
  reviewHook?: (
    kind: 'skill' | 'plugin',
    itemId: number,
    userId: string,
  ) => void;
  /** 上传前同步审查（用户配置的 LLM 判定安全/不安全）：装配时由 services.ts 注入。 */
  uploadReview?: (
    userId: string,
    pkg: PackageReviewInput,
  ) => Promise<PackageReviewResult>;
  /** 运行期复扫用的平台出口黑名单：装配时由 services.ts 注入。 */
  blacklistProvider?: () => Promise<BlacklistEntryLite[]>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  private static fileList(raw: unknown) {
    if (!Array.isArray(raw)) return [] as { path: string; content: string }[];
    return raw
      .filter(
        (item): item is { path: string; content: string } =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as { path?: unknown }).path === 'string' &&
          typeof (item as { content?: unknown }).content === 'string',
      )
      .map((item) => ({ path: item.path, content: item.content }));
  }

  private shape(row: {
    id: number;
    name: string;
    description: string;
    content: string;
    files?: unknown;
    enabled: boolean;
    reviewStatus: string;
    reviewVerdict?: unknown;
    updatedAt: Date;
  }) {
    const files = ContentAgentSkillService.fileList(row.files);
    const verdict =
      row.reviewVerdict && typeof row.reviewVerdict === 'object'
        ? (row.reviewVerdict as {
            summary?: unknown;
            permissionAcknowledgedAt?: unknown;
            category?: unknown;
            permissions?: unknown;
            permissionsDeclared?: unknown;
          })
        : {};
    // 权限/分类优先取上传审查时的结论；存量行没有结论时回落到正文 frontmatter
    const meta = parseSkillSecurityMeta(stripInvisible(row.content));
    const permissions =
      verdict.permissions && typeof verdict.permissions === 'object'
        ? (verdict.permissions as SkillPermissions)
        : meta.permissions;
    const category =
      typeof verdict.category === 'string' && verdict.category
        ? verdict.category
        : meta.category;
    return {
      id: row.id,
      // 展示口径同一套清洗：不可见字符既不进系统提示，也不该在界面上藏字
      name: toSingleLine(row.name, 60),
      description: toSingleLine(row.description, 200),
      content: stripInvisible(row.content),
      fileCount: files.length,
      files,
      enabled: row.enabled,
      // 审查状态回传上传人（§5.9.3 Agent 反馈闭环）：pending/rejected/needsAdmin 都要能看见原因
      reviewStatus: row.reviewStatus,
      reviewMessage: String(
        typeof verdict.summary === 'string' ? verdict.summary : '',
      ).slice(0, 500),
      category,
      permissions,
      permissionsDeclared:
        typeof verdict.permissionsDeclared === 'boolean'
          ? verdict.permissionsDeclared
          : hasDeclaredPermissions(permissions),
      permissionsAcknowledged: Boolean(verdict.permissionAcknowledgedAt),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(user: CurrentUser) {
    const rows = await this.prisma.contentAgentSkill.findMany({
      where: { userId: user.userId },
      orderBy: { id: 'asc' },
      take: MAX_SKILLS,
    });
    return rows.map((row) => this.shape(row));
  }

  /**
   * 系统提示里的技能摘要：只给名字与一句说明，正文不占上下文。
   * 带 ids（输入区 + 浮层里勾选的技能）时只列这些；没勾＝列全部启用中的技能。
   */
  async promptSummaries(userId: string, ids?: number[]) {
    const scoped = (ids || []).filter((id) => Number.isInteger(id) && id > 0);
    const rows = await this.prisma.contentAgentSkill.findMany({
      where: {
        userId,
        enabled: true,
        // 先审后用：未过审的技能不进系统提示（§5.9.6 启用约束）
        reviewStatus: 'passed',
        ...(scoped.length ? { id: { in: scoped } } : {}),
      },
      orderBy: { id: 'asc' },
      select: { name: true, description: true },
      // 条数与字符双收口：技能装得再多，也不会把这一轮提示词挤爆；
      // 多取一条只为知道「还有没有」，好诚实告诉模型剩下的怎么取
      take: SUMMARY_MAX + 1,
    });
    const listed = rows.slice(0, SUMMARY_MAX);
    let budget = SUMMARY_BUDGET;
    const lines: string[] = [];
    for (const row of listed) {
      // 存量行也按单行清洗：这句话会进每一轮系统提示，不能让历史数据带换行或不可见字符
      const line = `- ${toSingleLine(row.name, 60)}${
        row.description ? `：${toSingleLine(row.description, 200)}` : ''
      }`;
      if (line.length > budget) break;
      budget -= line.length + 1;
      lines.push(line);
    }
    if (lines.length < listed.length || rows.length > listed.length) {
      lines.push(
        `（仅列出前 ${lines.length} 个技能，其余未列出的技能仍可用 load_skill 按名字取）`,
      );
    }
    return lines.join('\n');
  }

  /** 工具调用：按名字取启用中的技能全文；带 file 时取技能包里的附加文件。 */
  async read(userId: string, name: string, file?: string) {
    const rows = await this.prisma.contentAgentSkill.findMany({
      where: { userId, enabled: true, reviewStatus: 'passed' },
      select: { name: true, content: true, files: true },
      take: MAX_SKILLS,
    });
    const target = String(name || '').trim();
    const row =
      rows.find((item) => item.name === target) ||
      rows.find((item) => item.name.includes(target) && target);
    if (!row) {
      return {
        found: false as const,
        hint: rows.map((item) => item.name).join('、'),
      };
    }
    const wanted = String(file || '').trim();
    if (!wanted) {
      // 正文进模型上下文前再清一遍：存量技能包可能带着零宽/双向字符
      const content = stripInvisible(row.content).slice(0, 20000);
      await this.assertRuntimeSafe(userId, row.name, '', content);
      return {
        found: true as const,
        name: row.name,
        content,
        file: '',
      };
    }
    const files = ContentAgentSkillService.fileList(row.files);
    const hit =
      files.find((item) => item.path === wanted) ||
      files.find((item) => item.path.endsWith(wanted)) ||
      files.find((item) => item.path.includes(wanted));
    if (!hit) {
      return {
        found: false as const,
        hint: `技能「${row.name}」里没有文件 ${wanted}；包内文件：${files
          .map((item) => item.path)
          .join('、')}`,
      };
    }
    const content = stripInvisible(hit.content).slice(0, 20000);
    await this.assertRuntimeSafe(userId, row.name, hit.path, content);
    return {
      found: true as const,
      name: row.name,
      content,
      file: hit.path,
    };
  }

  /** 运行期复扫：读取前再查一遍，命中即中止本轮（存量包也覆盖）。 */
  private async assertRuntimeSafe(
    userId: string,
    name: string,
    file: string,
    content: string,
  ) {
    const blacklist = this.blacklistProvider
      ? await this.blacklistProvider()
      : [];
    const findings = scanRuntimeContent(
      [{ path: file || 'SKILL.md', content }],
      blacklist,
    );
    if (!findings.length) return;
    const detail = describeFindings(findings);
    await this.identity.audit(
      userId,
      'Agent技能运行期拦截',
      `「${name}」${detail}`.slice(0, 1200),
    );
    throw new BusinessException(
      ErrorCode.AGENT_SECURITY_BLOCKED,
      `技能「${name}」命中运行期安全规则：${detail}。本次运行已中止。`,
    );
  }

  /**
   * 上传前审查：用户配置的 LLM 分析决定放行/拒绝；确定性四组结果一并写入台账。
   * 未装配审查引擎（单测/离线）时退回静态检查，放行后仍走异步重审。
   */
  private async reviewBeforeStore(
    user: CurrentUser,
    name: string,
    mainPath: string,
    content: string,
    files: { path: string; content: string }[],
  ): Promise<PackageReviewResult> {
    if (this.uploadReview) {
      return this.uploadReview(user.userId, {
        kind: 'skill',
        name,
        mainPath,
        content,
        files,
      });
    }
    const gate = runUploadSecurityGate({ mainPath, content, files });
    return {
      passed: gate.passed,
      status: gate.passed ? 'pending' : 'rejected',
      decision: gate.passed ? 'unreviewed' : 'reject',
      riskLevel: gate.passed ? 'unknown' : 'high',
      summary: gate.passed
        ? '已通过静态检查，待 AI 复核'
        : formatSecurityFailure(gate),
      violations: gate.firstFailure?.findings || [],
      groups: gate.groups,
      deterministic: gate.groups.flatMap((group) => group.findings),
      category: gate.category,
      permissions: gate.permissions,
      metaDeclared: gate.metaDeclared,
      model: '',
      tokens: 0,
    };
  }

  /** 审查结论落库：summary 给上传人看，category/permissions 供启用时二次确认。 */
  private verdictOf(review: PackageReviewResult) {
    return {
      decision: review.decision,
      riskLevel: review.riskLevel,
      violations: review.violations,
      summary: review.summary,
      model: review.model,
      source: 'upload',
      category: review.category,
      permissions: review.permissions,
      permissionsDeclared:
        review.metaDeclared || hasDeclaredPermissions(review.permissions),
    };
  }

  /**
   * 上传 zip 技能包（照附件的目录规范）：包内必须有 SKILL.md（frontmatter 里的
   * name/description 优先，缺了用一级标题与首段兜底），其余文本文件原样存进 files。
   */
  async importZip(user: CurrentUser, bytes: Uint8Array, originalName: string) {
    // 解压与解析都在本进程里跑：不拦频率，一个人连续传大包就能把 CPU 占满
    this.importLimiter.consume(user.userId, '技能包上传过于频繁，请稍后再试');
    const buffer = Buffer.from(bytes);
    const packageFiles = stripCommonRoot(readZipTextFiles(buffer));
    const skillFile = packageFiles.find((file) =>
      /(^|\/)skill\.md$/i.test(file.path),
    );
    if (!skillFile) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '技能包里没有 SKILL.md：请把技能说明放在 zip 根目录的 SKILL.md（可带 references/ 等文本文件）',
      );
    }
    const fallback =
      originalName
        .replace(/\.zip$/i, '')
        .split('/')
        .pop() || '技能';
    const parsed = parseSkillMarkdown(skillFile.content, fallback);
    const attached = packageFiles
      .filter((file) => file !== skillFile)
      .slice(0, 60)
      .map((file) => ({
        path: file.path.slice(0, 200),
        content: stripInvisible(file.content).slice(0, 20000),
      }));
    const review = await this.reviewBeforeStore(
      user,
      parsed.name,
      skillFile.path,
      parsed.content,
      attached,
    );
    // 用户配置的 LLM 判定不安全（或无法完成分析）→ 直接失败，不落库
    if (!review.passed) {
      await this.identity.audit(
        user.userId,
        '技能包上传安全拦截',
        `「${parsed.name}」来自 ${originalName.slice(0, 80)}：${review.summary}`.slice(
          0,
          1500,
        ),
      );
      throw new BusinessException(
        ErrorCode.SKILL_SECURITY_REJECTED,
        review.summary || '技能包未通过上传安全审查，未入库',
      );
    }
    const reviewVerdict = toJsonInput(this.verdictOf(review));
    const pendingReview = review.status === 'pending';
    const existing = await this.prisma.contentAgentSkill.findFirst({
      where: { userId: user.userId, name: parsed.name },
    });
    if (existing) {
      // 同名覆盖前先把旧版存成快照：事后能查出它原来是什么内容，也能回滚
      await saveAgentRevision(this.prisma, {
        userId: user.userId,
        kind: 'skill',
        itemId: existing.id,
        name: existing.name,
        snapshot: {
          description: existing.description,
          content: existing.content,
          files: existing.files,
          source: 'upload',
        },
      });
      const row = await this.prisma.contentAgentSkill.update({
        where: { id: existing.id },
        data: {
          description: parsed.description,
          content: parsed.content,
          files: toJsonInput(attached),
          // 同名覆盖即重审：旧版结论与权限确认不继承
          enabled: false,
          reviewStatus: review.status,
          reviewVerdict,
        },
      });
      if (pendingReview) this.reviewHook?.('skill', row.id, user.userId);
      await this.identity.audit(
        user.userId,
        'Agent技能覆盖更新',
        `「${row.name}」由技能包 ${originalName.slice(0, 80)} 重新导入，上传安全审查已通过`,
      );
      return this.shape(row);
    }
    const count = await this.prisma.contentAgentSkill.count({
      where: { userId: user.userId },
    });
    if (count >= MAX_SKILLS) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `技能最多 ${MAX_SKILLS} 个，请先停用或删除不再使用的技能`,
      );
    }
    const row = await this.prisma.contentAgentSkill.create({
      data: {
        userId: user.userId,
        name: parsed.name,
        description: parsed.description,
        content: parsed.content,
        files: toJsonInput(attached),
        // 上传即审：通过才入库；仍需用户启用后才可被模型调用
        enabled: false,
        reviewStatus: review.status,
        reviewVerdict,
      },
    });
    if (pendingReview) this.reviewHook?.('skill', row.id, user.userId);
    await this.identity.audit(
      user.userId,
      'Agent技能新增',
      `「${row.name}」来自技能包 ${originalName.slice(0, 80)}，上传安全审查已通过`,
    );
    return this.shape(row);
  }

  /** 只允许改启用开关：技能内容一律来自 zip 技能包（同名重传即更新），不在页面手改。 */
  async setEnabled(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const skillId = Number(id);
    if (!Number.isInteger(skillId) || skillId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '技能编号无效');
    }
    const existing = await this.prisma.contentAgentSkill.findFirst({
      where: { id: skillId, userId: user.userId },
    });
    if (!existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '技能不存在');
    // 启用前置：未过审的技能不允许启用（绝对安全门，§5.9.1 ③）
    if (body.enabled && existing.reviewStatus !== 'passed') {
      throw new BusinessException(
        ErrorCode.SKILL_NOT_PASSED,
        existing.reviewStatus === 'rejected'
          ? '技能包未通过安全审查，不能启用：请整改后重新上传'
          : '技能包尚未通过安全审查，不能启用：审查进行中或需到治理台人工放行',
      );
    }
    const verdict =
      existing.reviewVerdict && typeof existing.reviewVerdict === 'object'
        ? (existing.reviewVerdict as Record<string, unknown>)
        : {};
    let verdictUpdate: Record<string, unknown> | null = null;
    if (body.enabled) {
      const meta = parseSkillSecurityMeta(stripInvisible(existing.content));
      const permissions =
        verdict.permissions && typeof verdict.permissions === 'object'
          ? (verdict.permissions as SkillPermissions)
          : meta.permissions;
      const category =
        typeof verdict.category === 'string' && verdict.category
          ? verdict.category
          : meta.category;
      // 1.2 权限二次确认：声明了权限的技能，用户必须在启用时明确同意
      if (
        hasDeclaredPermissions(permissions) &&
        !verdict.permissionAcknowledgedAt
      ) {
        if (body.confirmPermissions !== true) {
          throw new BusinessException(
            ErrorCode.SKILL_PERMISSIONS_UNCONFIRMED,
            `技能「${existing.name}」声明了以下权限，启用前请确认：${describePermissions(
              permissions,
            ).join('；')}`,
          );
        }
        verdictUpdate = {
          ...verdict,
          category,
          permissions,
          permissionsDeclared: true,
          permissionAcknowledgedAt: new Date().toISOString(),
        };
      }
    }
    const row = await this.prisma.contentAgentSkill.update({
      where: { id: skillId },
      data: {
        enabled: Boolean(body.enabled),
        ...(verdictUpdate ? { reviewVerdict: toJsonInput(verdictUpdate) } : {}),
      },
    });
    await this.identity.audit(
      user.userId,
      'Agent技能启停',
      `「${row.name}」${row.enabled ? '启用' : '停用'}${
        row.enabled && verdictUpdate ? '（已确认声明权限）' : ''
      }`,
    );
    return this.shape(row);
  }

  async remove(user: CurrentUser, id: string) {
    const skillId = Number(id);
    if (!Number.isInteger(skillId) || skillId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '技能编号无效');
    }
    const existing = await this.prisma.contentAgentSkill.findFirst({
      where: { id: skillId, userId: user.userId },
    });
    if (!existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '技能不存在');
    await this.prisma.contentAgentSkill.delete({ where: { id: skillId } });
    await this.identity.audit(
      user.userId,
      'Agent技能删除',
      `「${existing.name}」`,
    );
    return { removed: true };
  }

  /** 历史版本列表（不含正文）：技能被同名重传覆盖过多少次、每次多久，都能回溯。 */
  async revisions(user: CurrentUser, id: string) {
    const skillId = Number(id);
    if (!Number.isInteger(skillId) || skillId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '技能编号无效');
    }
    const existing = await this.prisma.contentAgentSkill.findFirst({
      where: { id: skillId, userId: user.userId },
    });
    if (!existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '技能不存在');
    return listAgentRevisions(this.prisma, {
      userId: user.userId,
      kind: 'skill',
      itemId: existing.id,
    });
  }

  /** 回到某个历史版本：回滚前把当前内容也存一份，回滚本身可逆。 */
  async restore(user: CurrentUser, id: string, body: Record<string, unknown>) {
    const skillId = Number(id);
    if (!Number.isInteger(skillId) || skillId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '技能编号无效');
    }
    const revisionId = Number(body.revisionId);
    if (!Number.isInteger(revisionId) || revisionId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '历史版本编号无效');
    }
    const existing = await this.prisma.contentAgentSkill.findFirst({
      where: { id: skillId, userId: user.userId },
    });
    if (!existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '技能不存在');
    const revision = await readAgentRevision(this.prisma, {
      userId: user.userId,
      kind: 'skill',
      itemId: existing.id,
      id: revisionId,
    });
    if (!revision) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '历史版本不存在');
    }
    await saveAgentRevision(this.prisma, {
      userId: user.userId,
      kind: 'skill',
      itemId: existing.id,
      name: existing.name,
      snapshot: {
        description: existing.description,
        content: existing.content,
        files: existing.files,
        source: 'upload',
      },
    });
    const row = await this.prisma.contentAgentSkill.update({
      where: { id: existing.id },
      data: {
        description: revision.description,
        content: revision.content,
        files: toJsonInput(revision.files),
        // 回滚即内容变更：同样重审（旧版 passed 不自动继承，§5.9.6）
        enabled: false,
        reviewStatus: 'pending',
        // 审查结论与权限确认都属于旧版本，不能带到回滚后的内容上
        reviewVerdict: {},
      },
    });
    this.reviewHook?.('skill', row.id, user.userId);
    await this.identity.audit(
      user.userId,
      'Agent技能回滚',
      `「${row.name}」回到历史版本 #${revision.id}，已重新提交安全审查`,
    );
    return this.shape(row);
  }
}
