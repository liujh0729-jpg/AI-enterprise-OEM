import * as geo from '../geo/geo-llm.client';
import * as siteUrl from '../common/site-url';
import {
  buildOperationsReference,
  buildSkillMarkdown,
  cleanModelMarkdown,
  SkillGeneratorService,
} from './skill-generator.service';
import type { McpOperation } from '../mcp/mcp-catalog';
import { runUploadSecurityGate } from '../feature/skill-security';
import { AipddKeyService } from '../account/aipdd-key.service';
import { stub } from '../../test/doubles';
import type { PrismaService } from '../prisma/prisma.service';
import type { IdentityService } from '../identity/identity.service';
import type { ContentModelSettingService } from './model-setting.service';
import type { CurrentUser } from '../auth/current-user';

describe('cleanModelMarkdown', () => {
  it('剥掉整段代码围栏，只留正文', () => {
    const raw = ['```markdown', '# 技能', '', '正文内容', '```'].join('\n');
    expect(cleanModelMarkdown(raw)).toBe('# 技能\n\n正文内容');
  });

  it('剥掉模型自带的 frontmatter（frontmatter 由服务端统一生成）', () => {
    const raw = [
      '---',
      'name: crm-mcp',
      'description: 客户管理',
      '---',
      '# 客户管理 MCP 助手',
      '',
      '正文内容',
    ].join('\n');
    expect(cleanModelMarkdown(raw)).toBe('# 客户管理 MCP 助手\n\n正文内容');
  });

  it('统一换行并去掉首尾空白', () => {
    expect(cleanModelMarkdown('\r\n\n# 标题\r\n正文\r\n')).toBe('# 标题\n正文');
  });

  it('不含围栏/头部的正文原样保留', () => {
    expect(cleanModelMarkdown('## 概述\n\n调用 MCP。')).toBe(
      '## 概述\n\n调用 MCP。',
    );
  });
});

const sampleOperation: McpOperation = {
  operationId: 'Crm_customerPage',
  method: 'get',
  path: '/enterprise/crm/customers',
  domain: 'crm',
  domainLabel: '客户管理',
  label: '客户列表',
  write: false,
  hasBody: false,
  pathParams: [],
};

describe('buildSkillMarkdown', () => {
  const markdown = buildSkillMarkdown({
    name: 'crm-mcp',
    displayName: '客户管理 MCP 助手',
    description: '通过本系统 MCP 管理客户',
    baseUrl: 'https://example.com',
    body: '## 概述\n\n查询客户。',
  });

  it('根目录 SKILL.md 带完整 frontmatter 与站点域名权限声明', () => {
    expect(markdown.startsWith('---\nname: crm-mcp\n')).toBe(true);
    expect(markdown).toContain('description: 通过本系统 MCP 管理客户');
    expect(markdown).toContain('displayName: 客户管理 MCP 助手');
    expect(markdown).toContain('category: dev-programming');
    expect(markdown).toContain('permissions:\n  network:\n    - example.com');
  });

  it('正文与动作清单引用都写进包内', () => {
    expect(markdown).toContain('查询客户。');
    expect(markdown).toContain('references/mcp-operations.md');
  });
});

describe('buildOperationsReference', () => {
  it('逐动作写清方法、路径与调用顺序', () => {
    const reference = buildOperationsReference({
      baseUrl: 'https://example.com',
      displayName: '客户管理 MCP 助手',
      domainLabel: '客户管理',
      operations: [sampleOperation],
    });
    expect(reference).toContain('Crm_customerPage');
    expect(reference).toContain('GET /enterprise/crm/customers');
    expect(reference).toContain('describe_capabilities');
    expect(reference).toContain('read_data');
  });
});

describe('生成物安全门禁', () => {
  it('常规技能包（含 JSON-RPC 示例与占位 Key）能通过确定性安全校验', () => {
    const reference = buildOperationsReference({
      baseUrl: 'https://example.com',
      displayName: '客户管理 MCP 助手',
      domainLabel: '客户管理',
      operations: [sampleOperation],
    });
    const body = [
      '## 概述',
      '',
      '用本系统 MCP 查询客户列表。',
      '',
      '## 调用示例',
      '',
      '```json',
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'read_data',
          arguments: { operationId: 'Crm_customerPage', params: { page: 1 } },
        },
      }),
      '```',
      '',
      '鉴权：`Authorization: Bearer <用户的 ek_ Key>`。',
    ].join('\n');
    const markdown = buildSkillMarkdown({
      name: 'crm-mcp',
      displayName: '客户管理 MCP 助手',
      description: '通过本系统 MCP 管理客户',
      baseUrl: 'https://example.com',
      body,
    });
    const gate = runUploadSecurityGate({
      mainPath: 'SKILL.md',
      content: markdown,
      files: [{ path: 'references/mcp-operations.md', content: reference }],
    });
    expect(gate.passed).toBe(true);
  });
});

describe('SkillGeneratorService 生成即入库', () => {
  const originalKey = process.env.EXTERNAL_CRED_KEY;
  beforeAll(() => {
    process.env.EXTERNAL_CRED_KEY =
      'unit-test-external-credential-key-0123456789';
  });
  afterAll(() => {
    if (originalKey === undefined) delete process.env.EXTERNAL_CRED_KEY;
    else process.env.EXTERNAL_CRED_KEY = originalKey;
  });

  const user = stub<CurrentUser>({ userId: '1' });
  const safeBody = [
    '## 概述',
    '',
    '用本系统 MCP 发送站内消息，适合通知与提醒场景。',
    '',
    '## 准备工作',
    '',
    '1. 在「API Key 管理」生成 ek_ Key。',
    '2. 把 MCP Server 配进支持 Streamable HTTP 的客户端。',
    '',
    '## 调用流程',
    '',
    '先调 describe_capabilities，再调 list_operations，最后用 write_data 执行 Sns_sendMessage，',
    '鉴权统一使用 Authorization: Bearer <用户的 ek_ Key>，写动作需先在账号内勾选授权。',
    '',
    '## 注意事项',
    '',
    '未授权时服务端只返回草案，不要声称能绕过；不要写入任何真实密钥。',
  ].join('\n');

  beforeEach(() => {
    jest
      .spyOn(siteUrl, 'resolveSiteUrl')
      .mockResolvedValue('https://example.com');
    jest.spyOn(AipddKeyService.prototype, 'resolveToken').mockResolvedValue('');
    jest.spyOn(geo, 'geoChatMulti').mockResolvedValue({
      reply: safeBody,
      elapsedMs: 1,
      promptTokens: 100,
      completionTokens: 200,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function service() {
    const prisma = stub<PrismaService>({
      generatedSkill: {
        upsert: jest.fn().mockResolvedValue({}),
      },
    });
    const identity = stub<IdentityService>({
      requireAdmin: jest.fn(),
      audit: jest.fn().mockResolvedValue(undefined),
    });
    const settings = stub<ContentModelSettingService>({
      resolveTarget: jest.fn().mockResolvedValue({
        baseUrl: 'https://gateway.example.com',
        apiKey: 'sk-test',
        model: 'text-model',
      }),
    });
    return {
      generator: new SkillGeneratorService(prisma, identity, settings),
      prisma,
    };
  }

  it('生成成功后按技能名 upsert，返回可下载的文件名', async () => {
    const { generator, prisma } = service();
    const result = await generator.generate(user, {
      name: 'sns-mcp',
      displayName: '站内消息 MCP',
      description: '通过 MCP 发送站内消息',
      domain: 'sns',
      operationIds: ['Sns_sendMessage'],
      baseUrl: 'https://example.com',
    });
    expect(result.filename).toBe('sns-mcp.zip');
    expect(result.zipBase64.length).toBeGreaterThan(0);
    expect((prisma.generatedSkill.upsert as jest.Mock).mock.calls).toHaveLength(
      1,
    );
    const args = (prisma.generatedSkill.upsert as jest.Mock).mock.calls[0][0];
    expect(args.where).toEqual({ name: 'sns-mcp' });
    expect(Buffer.isBuffer(args.create.zip)).toBe(true);
    expect(args.create).toMatchObject({
      name: 'sns-mcp',
      displayName: '站内消息 MCP',
      domain: 'sns',
      operationCount: 1,
      model: 'text-model',
      filename: 'sns-mcp.zip',
      createdBy: '1',
    });
    expect(args.update).toMatchObject({ filename: 'sns-mcp.zip' });
  });

  it('列表只回摘要字段，时间转 ISO', async () => {
    const updatedAt = new Date('2026-01-02T03:04:05.000Z');
    const prisma = stub<PrismaService>({
      generatedSkill: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 3, name: 'sns-mcp', displayName: '站内消息 MCP', updatedAt },
          ]),
      },
    });
    const generator = new SkillGeneratorService(
      prisma,
      stub<IdentityService>({}),
      stub<ContentModelSettingService>({}),
    );
    const result = await generator.list();
    expect(result.total).toBe(1);
    expect(result.rows[0].updatedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(
      (prisma.generatedSkill.findMany as jest.Mock).mock.calls[0][0],
    ).not.toHaveProperty('select.zip');
  });

  it('下载按编号取 zip，非法编号与不存在分别报错', async () => {
    const zip = Buffer.from('PK-test');
    const prisma = stub<PrismaService>({
      generatedSkill: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ filename: 'sns-mcp.zip', zip }),
      },
    });
    const generator = new SkillGeneratorService(
      prisma,
      stub<IdentityService>({}),
      stub<ContentModelSettingService>({}),
    );
    await expect(generator.download('1')).resolves.toEqual({
      filename: 'sns-mcp.zip',
      bytes: zip,
    });
    await expect(generator.download('abc')).rejects.toThrow('技能包编号无效');

    (prisma.generatedSkill.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(generator.download('9')).rejects.toThrow(
      '技能包不存在或已被移除',
    );
  });
});
