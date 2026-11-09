import {
  MCP_ENDPOINT_PATH,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_TITLE,
  MCP_SERVER_VERSION,
} from '@enterprise/contracts';
import { CurrentUser } from '../auth/current-user';
import { AipddKeyService } from '../account/aipdd-key.service';
import { isAiGateError } from '../ai/ai-guard.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { normalizeSiteUrl, resolveSiteUrl } from '../common/site-url';
import { stripInvisible, toSingleLine } from '../common/text-safety';
import { IdentityService } from '../identity/identity.service';
import {
  MCP_OPERATIONS,
  operationSchema,
  type McpOperation,
} from '../mcp/mcp-catalog';
import { PrismaService } from '../prisma/prisma.service';
import {
  formatSecurityFailure,
  runUploadSecurityGate,
} from '../feature/skill-security';
import { geoChatMulti, type ChatMessage } from '../geo/geo-llm.client';
import { aipddBaseUrl } from './content-shared';
import { ContentModelSettingService } from './model-setting.service';
import { createZip } from './zip-write';

/** 发布入口：SkillHub 公开技能目录对应的站点；环境变量可覆盖。 */
function skillHubSiteUrl() {
  return (
    String(process.env.SKILLHUB_SITE_URL || '').trim() || 'https://skillhub.cn'
  );
}

/** 技能包分类：这是「调用本系统 MCP 的集成说明」，归到开发编程类。 */
const GENERATED_CATEGORY = 'dev-programming';
const MAX_PROMPT_CHARS = 24_000;
const MAX_SKILL_CHARS = 24_000;
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** 注意：只接受公网 DNS 域名。localhost / IP 会写进公开技能包，SkillHub 审核也会拒。 */
const PUBLIC_HOST_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

type SkillChannel = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type SkillGeneratorCatalogDomain = {
  domain: string;
  label: string;
  read: number;
  write: number;
  total: number;
  operations: {
    operationId: string;
    label: string;
    method: McpOperation['method'];
    path: string;
    write: boolean;
  }[];
};

export type GenerateSkillInput = {
  name: string;
  displayName: string;
  description: string;
  domain: string;
  operationIds: string[];
  baseUrl: string;
};

export type GeneratedSkill = {
  name: string;
  displayName: string;
  slug: string;
  domain: string;
  domainLabel: string;
  category: string;
  description: string;
  operationCount: number;
  model: string;
  skillMarkdown: string;
  files: { path: string; content: string }[];
  zipBase64: string;
  filename: string;
};

function normalizeSkillName(raw: string) {
  const name = stripInvisible(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/[-._]{2,}/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 64);
  if (!name || !SKILL_NAME_RE.test(name)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '技能名只支持小写英文字母、数字、点、下划线和短横线，且需以字母或数字开头',
    );
  }
  return name;
}

function publicBaseUrl(raw: string) {
  const base = normalizeSiteUrl(raw);
  if (!base) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '请先在「系统设置 → 站点设置」配置站点域名，或从本站管理后台访问后再生成',
    );
  }
  const url = new URL(base);
  if (!PUBLIC_HOST_RE.test(url.hostname)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '站点域名必须是公网可访问的 DNS 域名（不能是 localhost 或 IP），否则 SkillHub 审核会拒绝',
    );
  }
  return base;
}

function operationLine(operation: McpOperation) {
  return `${operation.operationId}｜${operation.label}｜${operation.method.toUpperCase()} ${operation.path}｜${
    operation.write ? '写' : '读'
  }`;
}

function schemaKeys(raw: Record<string, unknown> | null) {
  if (!raw) return '';
  const properties = raw['properties'];
  if (!properties || typeof properties !== 'object') return '';
  const required = Array.isArray(raw['required'])
    ? (raw['required'] as string[])
    : [];
  return Object.keys(properties as Record<string, unknown>)
    .map((key) => `${key}${required.includes(key) ? '*' : ''}`)
    .join(', ');
}

function operationPrompt(operations: McpOperation[]) {
  return operations
    .map((operation) => {
      const schema = operationSchema(operation.operationId);
      const pathParams = (schema?.pathParams || []).join(', ') || '无';
      const query = schemaKeys(schema?.query ?? null) || '无';
      const body = operation.hasBody
        ? schemaKeys(schema?.body ?? null) || '有请求体（详见动作清单）'
        : '无';
      return `- ${operationLine(operation)}；路径参数：${pathParams}；查询参数：${query}；请求体字段：${body}`;
    })
    .join('\n');
}

/** 模型正文可能包一层代码围栏或带 frontmatter，统一剥掉后再入库。 */
export function cleanModelMarkdown(raw: string) {
  let text = stripInvisible(raw).replace(/\r\n/g, '\n').trim();
  const fence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(text);
  if (fence) text = fence[1].trim();
  const frontmatter = /^---\n[\s\S]*?\n---\n?/.exec(text);
  if (frontmatter) text = text.slice(frontmatter[0].length).trim();
  return text;
}

function deriveDescription(body: string, domainLabel: string) {
  const paragraph = body
    .split('\n')
    .map((line) => line.trim())
    .find(
      (line) =>
        line &&
        !line.startsWith('#') &&
        !line.startsWith('---') &&
        !line.startsWith('>'),
    );
  return toSingleLine(
    paragraph || `通过本系统 MCP 使用${domainLabel}能力`,
    200,
  );
}

export function buildOperationsReference(input: {
  baseUrl: string;
  displayName: string;
  domainLabel: string;
  operations: McpOperation[];
}) {
  const blocks = input.operations.map((operation) => {
    const schema = operationSchema(operation.operationId);
    const body = schema?.body
      ? JSON.stringify(schema.body, null, 2).slice(0, 6000)
      : '';
    return [
      `### ${operation.label}（\`${operation.operationId}\`）`,
      '',
      `- 方法：\`${operation.method.toUpperCase()} ${operation.path}\``,
      `- 类型：${operation.write ? '写动作（需本账号勾选自动执行）' : '读动作'}`,
      `- 路径参数：${(schema?.pathParams || []).join('、') || '无'}`,
      schema?.query
        ? `- 查询参数 Schema：\`\`\`json\n${JSON.stringify(schema.query, null, 2).slice(0, 4000)}\n\`\`\``
        : '- 查询参数：无',
      body ? `- 请求体 Schema：\`\`\`json\n${body}\n\`\`\`` : '- 请求体：无',
    ].join('\n');
  });
  return [
    `# ${input.displayName} · MCP 动作清单`,
    '',
    `> 业务域：${input.domainLabel}；MCP 接入地址：\`${input.baseUrl}${MCP_ENDPOINT_PATH}\`。`,
    '> 本文由本系统按契约自动派生，新增接口会随重新生成进入清单。',
    '',
    '## 调用顺序',
    '',
    '1. `describe_capabilities`：确认服务端版本、可用工具与调用顺序。',
    '2. `list_operations`：按业务域或关键词查动作；`get_operation` 取单个动作的参数 Schema。',
    '3. 读动作用 `read_data`，写动作用 `write_data`；写动作受本账号授权闸约束，未授权时只返回草案。',
    '',
    '## 动作',
    '',
    ...blocks,
  ].join('\n');
}

export function buildSkillMarkdown(input: {
  name: string;
  displayName: string;
  description: string;
  baseUrl: string;
  body: string;
}) {
  const host = new URL(input.baseUrl).hostname;
  return [
    '---',
    `name: ${input.name}`,
    `description: ${input.description}`,
    `displayName: ${input.displayName}`,
    'version: 1.0.0',
    `category: ${GENERATED_CATEGORY}`,
    'permissions:',
    '  network:',
    `    - ${host}`,
    '---',
    '',
    `# ${input.displayName}`,
    '',
    input.body.trim(),
    '',
    '## 完整动作清单',
    '',
    '参数 Schema、读写类型与调用顺序见 [references/mcp-operations.md](references/mcp-operations.md)。',
    '',
  ].join('\n');
}

function skillPrompt(input: {
  name: string;
  displayName: string;
  description: string;
  domainLabel: string;
  baseUrl: string;
  operations: McpOperation[];
}) {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        '你是企业级 MCP 技能包作者。输出会被原样放进 SKILL.md 正文，供其他 AI 助手阅读。' +
        '只输出 Markdown 正文：不要 YAML frontmatter，不要用代码围栏包裹全文，不要输出写作说明或致谢。',
    },
    {
      role: 'user',
      content: [
        `请为「${input.displayName}」写一份可发布到 SkillHub 的技能说明。`,
        '',
        `- 技能标识：${input.name}`,
        `- 一句话说明：${input.description}`,
        `- 服务：${MCP_SERVER_TITLE}（${MCP_SERVER_NAME} v${MCP_SERVER_VERSION}，协议 ${MCP_PROTOCOL_VERSION}）`,
        `- 业务域：${input.domainLabel}`,
        `- MCP 接入地址：${input.baseUrl}${MCP_ENDPOINT_PATH}`,
        '- 鉴权：Authorization: Bearer <用户的 ek_ Key>（或 X-Api-Key 请求头）',
        '',
        '## 覆盖的 MCP 动作',
        operationPrompt(input.operations),
        '',
        '## 写作要求',
        '1. 说明什么时候该用这个技能、它覆盖哪些业务能力，开头给出 2~3 个典型场景。',
        '2. 写清准备步骤：生成 ek_ Key、把 MCP Server 配进支持 Streamable HTTP 的客户端。',
        '3. 给出通用调用流程：initialize → tools/list → describe_capabilities → list_operations / get_operation → read_data / write_data。',
        '4. 至少给出 2 个完整的 JSON-RPC tools/call 示例（一个读动作、一个写动作），参数用占位符。',
        '5. 写动作必须提醒用户先在「智能体记忆 → 可自动执行的动作」里勾选授权；未授权时服务端只返回草案，不要声称能绕过。',
        '6. 所有密钥一律写 <用户的 ek_ Key>，不要写任何真实密钥、Cookie 或连接串。',
        '7. 不要写 shell 命令，不要出现批量注册、自动提交、端口扫描、低于 1 秒的请求间隔、超大并发等表述。',
        '8. 只使用上面列出的动作，不要臆造接口路径或参数。',
        '9. 中文，结构建议：概述 / 适用场景 / 准备工作 / 调用流程 / 动作说明 / 调用示例 / 注意事项；控制在 1500~2500 字。',
      ]
        .join('\n')
        .slice(0, MAX_PROMPT_CHARS),
    },
  ];
  return messages;
}

/**
 * 平台管理员「生成 Skill」：
 * 选业务域 → 按该域的动作清单调用管理员自己的文本模型 → 生成根目录 SKILL.md 的技能包。
 * 目录从 `MCP_OPERATIONS` 派生，接口增加时无需改本服务。
 */
export class SkillGeneratorService {
  private readonly aipddKeys: AipddKeyService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly settings: ContentModelSettingService,
  ) {
    this.aipddKeys = new AipddKeyService(prisma);
  }

  async catalog(user: CurrentUser) {
    this.identity.requireAdmin(user);
    const baseUrl = await resolveSiteUrl(this.prisma);
    return {
      baseUrl,
      siteConfigured: Boolean(baseUrl),
      endpointPath: MCP_ENDPOINT_PATH,
      category: GENERATED_CATEGORY,
      skillHubUrl: skillHubSiteUrl(),
      domains: this.domains(),
    };
  }

  async generate(user: CurrentUser, input: GenerateSkillInput) {
    this.identity.requireAdmin(user);
    const name = normalizeSkillName(input.name);
    const displayName = toSingleLine(input.displayName, 60);
    if (!displayName) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写展示名');
    }
    const domain = input.domain.trim();
    const pool = MCP_OPERATIONS.filter((row) => row.domain === domain);
    if (!pool.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '业务域不存在，或该业务域当前没有对 MCP 开放的动作',
      );
    }
    const wanted = new Set(input.operationIds);
    const operations = pool.filter((row) => wanted.has(row.operationId));
    if (!operations.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请至少选择一个该业务域下的 MCP 动作',
      );
    }
    if (operations.length !== wanted.size) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '选择中包含不属于该业务域或不对 MCP 开放的动作，请刷新后重试',
      );
    }

    const configuredBase = await resolveSiteUrl(this.prisma);
    const baseUrl = publicBaseUrl(configuredBase || input.baseUrl);
    const description =
      toSingleLine(input.description, 200) ||
      `通过本系统 MCP 使用${pool[0].domainLabel}能力`;
    const channel = await this.resolveChannel(user);
    const result = await geoChatMulti({
      baseUrl: channel.baseUrl,
      apiKey: channel.apiKey,
      model: channel.model,
      messages: skillPrompt({
        name,
        displayName,
        description,
        domainLabel: pool[0].domainLabel,
        baseUrl,
        operations,
      }),
      maxTokens: 3200,
      timeoutMs: 120_000,
      userId: user.userId,
      purpose: 'batch',
    });
    const body = cleanModelMarkdown(result.reply);
    if (body.length < 80) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '模型没有返回可用的技能正文，请重试或更换文本模型',
      );
    }
    const skillMarkdown = buildSkillMarkdown({
      name,
      displayName,
      description:
        toSingleLine(input.description, 200) ||
        deriveDescription(body, pool[0].domainLabel),
      baseUrl,
      body: body.slice(0, MAX_SKILL_CHARS),
    });
    const files = [
      {
        path: 'references/mcp-operations.md',
        content: buildOperationsReference({
          baseUrl,
          displayName,
          domainLabel: pool[0].domainLabel,
          operations,
        }),
      },
    ];
    // 生成物也要过同一套确定性门禁：模型偶尔会写进 shell 命令、内网地址或密钥样例。
    const gate = runUploadSecurityGate({
      mainPath: 'SKILL.md',
      content: skillMarkdown,
      files,
    });
    if (!gate.passed) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `模型生成的技能包未通过安全校验，请重试：${formatSecurityFailure(gate)}`,
      );
    }
    const zip = createZip([
      { path: 'SKILL.md', content: skillMarkdown },
      ...files.map((file) => ({ path: file.path, content: file.content })),
    ]);
    const filename = `${name}.zip`;
    // 生成即上架：开放集成 → Skill 页签读这张表；同名技能重新生成时覆盖为新包。
    await this.prisma.generatedSkill.upsert({
      where: { name },
      create: {
        name,
        displayName,
        description,
        domain,
        domainLabel: pool[0].domainLabel,
        category: GENERATED_CATEGORY,
        operationCount: operations.length,
        model: channel.model,
        filename,
        zip,
        createdBy: user.userId,
      },
      update: {
        displayName,
        description,
        domain,
        domainLabel: pool[0].domainLabel,
        category: GENERATED_CATEGORY,
        operationCount: operations.length,
        model: channel.model,
        filename,
        zip,
      },
    });
    await this.identity.audit(
      user.userId,
      'SKILL_GENERATED',
      `name=${name} domain=${domain} ops=${operations.length} model=${channel.model} tokens=${
        result.promptTokens + result.completionTokens
      }`,
    );
    return {
      name,
      displayName,
      slug: name,
      domain,
      domainLabel: pool[0].domainLabel,
      category: GENERATED_CATEGORY,
      description,
      operationCount: operations.length,
      model: channel.model,
      skillMarkdown,
      files,
      zipBase64: zip.toString('base64'),
      filename,
    } satisfies GeneratedSkill;
  }

  /** 开放集成 → Skill：平台管理员生成过的技能包清单，按更新时间倒序。 */
  async list() {
    const rows = await this.prisma.generatedSkill.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        displayName: true,
        description: true,
        domain: true,
        domainLabel: true,
        category: true,
        operationCount: true,
        model: true,
        filename: true,
        updatedAt: true,
      },
    });
    return {
      total: rows.length,
      rows: rows.map((row) => ({
        ...row,
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  /** 下载技能包：只回 zip 字节与文件名，列表接口不回传 zip。 */
  async download(rawId: string) {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '技能包编号无效');
    }
    const row = await this.prisma.generatedSkill.findUnique({
      where: { id },
      select: { filename: true, zip: true },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '技能包不存在或已被移除',
      );
    }
    return { filename: row.filename, bytes: Buffer.from(row.zip) };
  }

  private domains(): SkillGeneratorCatalogDomain[] {
    const map = new Map<string, SkillGeneratorCatalogDomain>();
    for (const operation of MCP_OPERATIONS) {
      const item = map.get(operation.domain) ?? {
        domain: operation.domain,
        label: operation.domainLabel,
        read: 0,
        write: 0,
        total: 0,
        operations: [],
      };
      if (operation.write) item.write += 1;
      else item.read += 1;
      item.total += 1;
      item.operations.push({
        operationId: operation.operationId,
        label: operation.label,
        method: operation.method,
        path: operation.path,
        write: operation.write,
      });
      map.set(operation.domain, item);
    }
    return [...map.values()]
      .map((item) => ({
        ...item,
        operations: item.operations.sort((left, right) =>
          left.label.localeCompare(right.label, 'zh-CN'),
        ),
      }))
      .sort(
        (left, right) =>
          right.total - left.total ||
          left.label.localeCompare(right.label, 'zh-CN'),
      );
  }

  /** 管理员模型：模型设置的「文本」通道优先；未配置时回落账号 AIPDD Key + 审查/生成模型。 */
  private async resolveChannel(user: CurrentUser): Promise<SkillChannel> {
    const envModel = String(
      process.env.SKILL_GENERATOR_MODEL || process.env.SKILL_REVIEW_MODEL || '',
    )
      .trim()
      .slice(0, 64);
    let token = '';
    try {
      token = await this.aipddKeys.resolveToken(user.userId);
    } catch {
      token = '';
    }
    try {
      const target = await this.settings.resolveTarget(
        user,
        'text',
        token || undefined,
      );
      if (target.apiKey && target.model) {
        return {
          baseUrl: target.baseUrl,
          apiKey: target.apiKey,
          model: envModel || target.model,
        };
      }
    } catch (error) {
      // 闸门拒绝（主开关关闭/限流）必须显式暴露，不能落到 AIPDD 回落绕过。
      if (isAiGateError(error)) throw error;
      // 未配置默认文本通道：走下面的 AIPDD 回落
    }
    if (token) {
      const model = envModel || (await this.fallbackModel(user.userId));
      if (model) {
        return { baseUrl: aipddBaseUrl(), apiKey: token, model };
      }
    }
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '请先在「模型设置」为「文本」选择默认模型（或绑定 AIPDD Key 并配置模型）后再生成',
    );
  }

  private async fallbackModel(userId: string) {
    const [rpa, workbuddy] = await Promise.all([
      this.prisma.rpaLlmSetting.findUnique({ where: { userId } }),
      this.prisma.workbuddyLlmSetting.findUnique({ where: { userId } }),
    ]);
    return String(rpa?.model || workbuddy?.model || '')
      .trim()
      .slice(0, 64);
  }
}
