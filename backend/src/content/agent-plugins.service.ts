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

export type PluginFile = { path: string; content: string };

export type PluginCommand = {
  name: string;
  path: string;
  description: string;
  content: string;
};

export const PLUGIN_SOURCE_UPLOAD = 'upload';
export const PLUGIN_SOURCE_SKILLHUB = 'skillhub';
/** 一个插件最多展开多少条命令（包内 commands/*.md）。 */
const COMMAND_MAX = 40;

/** 插件包里的 commands/*.md：命令名取文件名，说明与正文按 SKILL.md 同一套 frontmatter 解析。 */
export function parsePluginCommands(files: PluginFile[]): PluginCommand[] {
  return files
    .filter((file) => /(^|\/)commands\/[^/]+\.md$/i.test(file.path))
    .map((file) => {
      const fileName = (file.path.split('/').pop() || '').replace(/\.md$/i, '');
      const parsed = parseSkillMarkdown(file.content, fileName);
      return {
        name: fileName,
        path: file.path.slice(0, 200),
        description: parsed.description,
        content: parsed.content,
      };
    })
    .filter((item) => item.name)
    .slice(0, COMMAND_MAX);
}

/** 命令名匹配：兼容 `build`、`/build`、`插件名:build` 三种写法。 */
export function matchPluginCommand(
  commands: PluginCommand[],
  raw: string,
): PluginCommand | undefined {
  const key = String(raw || '')
    .trim()
    .replace(/^\/+/gu, '')
    .split(':')
    .pop()! // 至少有一段（空串也返回自身）
    .trim();
  if (!key) return undefined;
  return (
    commands.find((item) => item.name === key) ||
    commands.find((item) => item.name.toLowerCase() === key.toLowerCase()) ||
    commands.find((item) => item.name.includes(key))
  );
}

/** 展开命令正文：正文里有 `$ARGUMENTS` 就原位替换，没有就把参数附在后面。 */
export function expandPluginCommandBody(body: string, args: string) {
  const parameters = String(args || '').trim();
  const text = String(body || '');
  if (!parameters) return text;
  return text.includes('$ARGUMENTS')
    ? text.split('$ARGUMENTS').join(parameters)
    : `${text}\n\n【本次参数】${parameters}`;
}

/**
 * Agent 插件：一个插件＝名称 + 一句话说明 + 说明正文 + 包内文本文件 + 包内插件命令。
 * 来源有两种——上传 zip 插件包（根目录 plugin.json / .claude-plugin/plugin.json / PLUGIN.md），
 * 或从 SkillHub 插件目录安装（README 存成正文）。说明进系统提示，模型用 load_plugin 取全文。
 * 包内 commands/*.md 展开成插件命令：模型用 run_plugin_command 拿正文照它跑业务，
 * 本站只读文本、不执行包内任何脚本。
 * 归属严格按登录账号，同企业其他账号看不到。
 */
export class ContentAgentPluginService {
  constructor(private readonly prisma: PrismaService) {}

  private static fileList(raw: unknown) {
    if (!Array.isArray(raw)) return [] as PluginFile[];
    return raw
      .filter(
        (item): item is PluginFile =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as { path?: unknown }).path === 'string' &&
          typeof (item as { content?: unknown }).content === 'string',
      )
      .map((item) => ({ path: item.path, content: item.content }));
  }

  /** 给界面与系统提示看的命令清单（不带正文）。 */
  private static commandList(files: PluginFile[]) {
    return parsePluginCommands(files).map((command) => ({
      name: command.name,
      description: command.description,
      path: command.path,
    }));
  }

  private shape(row: {
    id: number;
    name: string;
    description: string;
    content: string;
    files?: unknown;
    source: string;
    sourceSlug: string;
    enabled: boolean;
    updatedAt: Date;
  }) {
    const files = ContentAgentPluginService.fileList(row.files);
    return {
      id: row.id,
      // 展示口径同一套清洗：不可见字符既不进系统提示，也不该在界面上藏字
      name: toSingleLine(row.name, 60),
      description: toSingleLine(row.description, 200),
      content: stripInvisible(row.content),
      fileCount: files.length,
      files,
      commands: ContentAgentPluginService.commandList(files),
      source: row.source,
      sourceSlug: row.sourceSlug,
      enabled: row.enabled,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(user: CurrentUser) {
    const rows = await this.prisma.contentAgentPlugin.findMany({
      where: { userId: user.userId },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => this.shape(row));
  }

  /**
   * 系统提示里的插件摘要：只给名字、一句说明与命令名，正文不占上下文。
   * 带 ids（输入区 + 浮层里勾选的插件）时只列这些；没勾＝列全部启用中的插件。
   */
  async promptSummaries(userId: string, ids?: number[]) {
    const rows = await this.enabledPlugins(userId, ids);
    return rows
      .map((row) => {
        const commands = ContentAgentPluginService.commandList(
          ContentAgentPluginService.fileList(row.files),
        );
        const hint = commands.length
          ? `（插件命令：${commands.map((command) => command.name).join('、')}）`
          : '';
        return `- ${toSingleLine(row.name, 60)}${
          row.description ? `：${toSingleLine(row.description, 200)}` : ''
        }${hint}`;
      })
      .join('\n');
  }

  /** 启用中的插件：带 ids（本轮/本任务勾选的）时只取这几个，否则取全部。 */
  private enabledPlugins(userId: string, ids?: number[]) {
    const scoped = (ids || []).filter((id) => Number.isInteger(id) && id > 0);
    return this.prisma.contentAgentPlugin.findMany({
      where: {
        userId,
        enabled: true,
        ...(scoped.length ? { id: { in: scoped } } : {}),
      },
      orderBy: { id: 'asc' },
    });
  }

  /** 工具调用：按名字取启用中的插件正文；带 file 时取插件包里的附加文件。 */
  async read(
    userId: string,
    name: string,
    file?: string,
    ids?: number[],
  ): Promise<
    | { found: false; hint: string }
    | { found: true; name: string; content: string; file: string }
  > {
    const rows = (await this.enabledPlugins(userId, ids)).map((row) => ({
      name: row.name,
      content: row.content,
      files: row.files,
    }));
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
        content: stripInvisible(row.content).slice(0, 20000),
        file: '',
      };
    }
    const files = ContentAgentPluginService.fileList(row.files);
    const hit =
      files.find((item) => item.path === wanted) ||
      files.find((item) => item.path.endsWith(wanted)) ||
      files.find((item) => item.path.includes(wanted));
    if (!hit) {
      return {
        found: false as const,
        hint: `插件「${row.name}」里没有文件 ${wanted}；包内文件：${files
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
   * 工具调用：把插件包内 commands/*.md 的正文展开出来（$ARGUMENTS 换成实参）。
   * 只读文本、不执行包内任何脚本：命令里要做的业务，仍由模型用站内工具 / MCP 连接器完成。
   */
  async runCommand(
    userId: string,
    input: {
      plugin: string;
      command: string;
      args: string;
      /** 本轮/本任务勾选的插件 id；空＝全部启用中的插件 */
      ids?: number[];
    },
  ) {
    const wanted = String(input.plugin || '').trim();
    if (!wanted) {
      return { found: false as const, hint: '', command: '' };
    }
    const rows = await this.enabledPlugins(userId, input.ids);
    const row =
      rows.find((item) => item.name === wanted) ||
      rows.find((item) => item.name.includes(wanted) && wanted);
    if (!row) {
      return {
        found: false as const,
        command: '',
        hint: rows.map((item) => item.name).join('、'),
      };
    }
    const commands = parsePluginCommands(
      ContentAgentPluginService.fileList(row.files),
    );
    if (!commands.length) {
      return {
        found: false as const,
        command: '',
        hint: `插件「${row.name}」里没有 commands/*.md 命令文件；要读它的说明请用 load_plugin`,
      };
    }
    const hit = matchPluginCommand(commands, input.command);
    if (!hit) {
      return {
        found: false as const,
        command: '',
        hint: `插件「${row.name}」里没有命令 ${input.command || '（空）'}；可用命令：${commands
          .map(
            (item) =>
              `${item.name}${item.description ? `（${item.description}）` : ''}`,
          )
          .join('、')}`,
      };
    }
    const content = expandPluginCommandBody(
      stripInvisible(hit.content).slice(0, 20000),
      stripInvisible(String(input.args || '')),
    );
    return {
      found: true as const,
      plugin: row.name,
      command: hit.name,
      path: hit.path,
      content,
      hint: '',
    };
  }

  /**
   * 上传 zip 插件包：清单取 .claude-plugin/plugin.json、根目录 plugin.json 或 PLUGIN.md
   * （三者都没有就拒绝）；正文优先 PLUGIN.md，其次根目录 README.md；
   * 其余文本文件（skills/、commands/ 等）原样存进 files。同名插件重传即覆盖更新。
   */
  async importZip(user: CurrentUser, bytes: Uint8Array, originalName: string) {
    const packageFiles = stripCommonRoot(readZipTextFiles(Buffer.from(bytes)));
    const manifestFile =
      packageFiles.find((file) =>
        /(^|\/)\.claude-plugin\/plugin\.json$/i.test(file.path),
      ) || packageFiles.find((file) => /(^|\/)plugin\.json$/i.test(file.path));
    const markdownFile = packageFiles.find((file) =>
      /(^|\/)plugin\.md$/i.test(file.path),
    );
    if (!manifestFile && !markdownFile) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '插件包里没有 plugin.json 或 PLUGIN.md：请把插件清单放在 zip 根目录的 plugin.json（或 .claude-plugin/plugin.json），也可以写 PLUGIN.md 说明',
      );
    }
    const fallback =
      originalName
        .replace(/\.zip$/i, '')
        .split('/')
        .pop() || '插件';
    let name = '';
    let description = '';
    if (manifestFile) {
      let manifest: unknown;
      try {
        manifest = JSON.parse(manifestFile.content);
      } catch {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          'plugin.json 不是合法的 JSON：请检查插件清单的逗号与引号',
        );
      }
      if (manifest && typeof manifest === 'object') {
        const row = manifest as Record<string, unknown>;
        name = typeof row.name === 'string' ? row.name : '';
        description =
          typeof row.description === 'string' ? row.description : '';
      }
    }
    let body = '';
    if (markdownFile) {
      const parsed = parseSkillMarkdown(markdownFile.content, fallback);
      if (!name) name = parsed.name;
      if (!description) description = parsed.description;
      body = parsed.content;
    }
    const readmeFile = packageFiles.find((file) =>
      /(^|\/)readme\.md$/i.test(file.path),
    );
    if (!body && readmeFile) {
      body = stripInvisible(readmeFile.content).slice(0, 20000);
    }
    const mainPaths = new Set(
      [manifestFile?.path, markdownFile?.path, readmeFile?.path].filter(
        (path): path is string => Boolean(path),
      ),
    );
    const attached = packageFiles
      .filter((file) => !mainPaths.has(file.path))
      .slice(0, 60)
      .map((file) => ({
        path: file.path.slice(0, 200),
        content: stripInvisible(file.content).slice(0, 20000),
      }));
    const finalName = toSingleLine(name || fallback, 60);
    const finalDescription = toSingleLine(description, 200);
    const existing = await this.prisma.contentAgentPlugin.findFirst({
      where: { userId: user.userId, name: finalName },
    });
    if (existing) {
      const row = await this.prisma.contentAgentPlugin.update({
        where: { id: existing.id },
        data: {
          description: finalDescription,
          content: body,
          files: attached as never,
          source: PLUGIN_SOURCE_UPLOAD,
          sourceSlug: '',
        },
      });
      return this.shape(row);
    }
    const row = await this.prisma.contentAgentPlugin.create({
      data: {
        userId: user.userId,
        name: finalName,
        description: finalDescription,
        content: body,
        files: attached as never,
        source: PLUGIN_SOURCE_UPLOAD,
      },
    });
    return this.shape(row);
  }

  /** 从 SkillHub 插件目录安装：README 存成正文，同名插件覆盖并直接启用。 */
  async installFromDirectory(
    user: CurrentUser,
    input: {
      name: string;
      description: string;
      content: string;
      sourceSlug: string;
    },
  ) {
    const name = toSingleLine(input.name, 60);
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '插件名称无效');
    }
    const description = toSingleLine(input.description, 200);
    const content = stripInvisible(input.content).slice(0, 20000);
    const sourceSlug = toSingleLine(input.sourceSlug, 120);
    const existing = await this.prisma.contentAgentPlugin.findFirst({
      where: { userId: user.userId, name },
    });
    if (existing) {
      const row = await this.prisma.contentAgentPlugin.update({
        where: { id: existing.id },
        data: {
          description,
          content,
          files: [] as never,
          source: PLUGIN_SOURCE_SKILLHUB,
          sourceSlug,
          enabled: true,
        },
      });
      return this.shape(row);
    }
    const row = await this.prisma.contentAgentPlugin.create({
      data: {
        userId: user.userId,
        name,
        description,
        content,
        files: [] as never,
        source: PLUGIN_SOURCE_SKILLHUB,
        sourceSlug,
      },
    });
    return this.shape(row);
  }

  /** 只允许改启用开关：插件内容一律来自插件包或插件目录，不在页面手改。 */
  async setEnabled(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    const pluginId = Number(id);
    if (!Number.isInteger(pluginId) || pluginId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '插件编号无效');
    }
    const existing = await this.prisma.contentAgentPlugin.findFirst({
      where: { id: pluginId, userId: user.userId },
    });
    if (!existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '插件不存在');
    }
    const row = await this.prisma.contentAgentPlugin.update({
      where: { id: pluginId },
      data: { enabled: Boolean(body.enabled) },
    });
    return this.shape(row);
  }

  async remove(user: CurrentUser, id: string) {
    const pluginId = Number(id);
    if (!Number.isInteger(pluginId) || pluginId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '插件编号无效');
    }
    const existing = await this.prisma.contentAgentPlugin.findFirst({
      where: { id: pluginId, userId: user.userId },
    });
    if (!existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '插件不存在');
    }
    await this.prisma.contentAgentPlugin.delete({ where: { id: pluginId } });
    return { removed: true };
  }
}
