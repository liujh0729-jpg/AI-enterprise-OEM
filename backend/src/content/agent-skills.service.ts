import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { stripInvisible, toSingleLine } from '../common/text-safety';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  parseSkillMarkdown,
  readZipTextFiles,
  stripCommonRoot,
} from './skill-package';

/**
 * Agent 技能（照附件的 SKILL.md 语义）：
 * 每个技能＝名称 + 一句话说明 + 全文；说明进系统提示，模型决定要不要用，用 load_skill 取全文。
 * 归属严格按登录账号，同企业其他账号看不到。
 */
export class ContentAgentSkillService {
  constructor(private readonly prisma: PrismaService) {}

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
    updatedAt: Date;
  }) {
    const files = ContentAgentSkillService.fileList(row.files);
    return {
      id: row.id,
      // 展示口径同一套清洗：不可见字符既不进系统提示，也不该在界面上藏字
      name: toSingleLine(row.name, 60),
      description: toSingleLine(row.description, 200),
      content: stripInvisible(row.content),
      fileCount: files.length,
      files,
      enabled: row.enabled,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(user: CurrentUser) {
    const rows = await this.prisma.contentAgentSkill.findMany({
      where: { userId: user.userId },
      orderBy: { id: 'asc' },
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
        ...(scoped.length ? { id: { in: scoped } } : {}),
      },
      orderBy: { id: 'asc' },
      select: { name: true, description: true },
    });
    return rows
      .map(
        (row) =>
          // 存量行也按单行清洗：这句话会进每一轮系统提示，不能让历史数据带换行或不可见字符
          `- ${toSingleLine(row.name, 60)}${row.description ? `：${toSingleLine(row.description, 200)}` : ''}`,
      )
      .join('\n');
  }

  /** 工具调用：按名字取启用中的技能全文；带 file 时取技能包里的附加文件。 */
  async read(userId: string, name: string, file?: string) {
    const rows = await this.prisma.contentAgentSkill.findMany({
      where: { userId, enabled: true },
      select: { name: true, content: true, files: true },
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
      return {
        found: true as const,
        name: row.name,
        // 正文进模型上下文前再清一遍：存量技能包可能带着零宽/双向字符
        content: stripInvisible(row.content).slice(0, 20000),
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
    return {
      found: true as const,
      name: row.name,
      content: stripInvisible(hit.content).slice(0, 20000),
      file: hit.path,
    };
  }

  /**
   * 上传 zip 技能包（照附件的目录规范）：包内必须有 SKILL.md（frontmatter 里的
   * name/description 优先，缺了用一级标题与首段兜底），其余文本文件原样存进 files。
   */
  async importZip(user: CurrentUser, bytes: Uint8Array, originalName: string) {
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
    const existing = await this.prisma.contentAgentSkill.findFirst({
      where: { userId: user.userId, name: parsed.name },
    });
    if (existing) {
      const row = await this.prisma.contentAgentSkill.update({
        where: { id: existing.id },
        data: {
          description: parsed.description,
          content: parsed.content,
          files: attached as never,
        },
      });
      return this.shape(row);
    }
    const row = await this.prisma.contentAgentSkill.create({
      data: {
        userId: user.userId,
        name: parsed.name,
        description: parsed.description,
        content: parsed.content,
        files: attached as never,
      },
    });
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
    const row = await this.prisma.contentAgentSkill.update({
      where: { id: skillId },
      data: { enabled: Boolean(body.enabled) },
    });
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
    return { removed: true };
  }
}
