jest.mock('./ai-gateway', () => ({
  tryChat: jest.fn(async () => null),
  parseJsonObject: jest.fn(() => null),
}));

import { CurrentUser } from '../auth/current-user';
import type { CrmScopeService } from '../crm/crm.scope';
import type { HrmScopeService } from '../hrm/hrm.scope';
import type { KbRetrieveService } from '../kb/kb-retrieve.service';
import type { OaScopeService } from '../oa/oa.scope';
import type { OkrScopeService } from '../okr/okr.scope';
import type { PrismaService } from '../prisma/prisma.service';
import { AiAbilitiesService } from './ai-abilities.service';
import { AiPointsService } from './ai-points.service';
import { stub } from '../../test/doubles';

const user = new CurrentUser('u1', '测试用户', 'tester');

/** 模型不可用（tryChat 返回 null）时的规则回落路径，是这些模块点的兜底口径。 */
const makeAbilities = (snippets: unknown[] = []) => {
  const kbRetrieve = {
    retrieve: jest.fn(async () => ({
      query: 'q',
      sources: ['kb'],
      snippets,
      modes: ['keyword'],
      total: snippets.length,
      spaces: [],
    })),
  };
  return new AiAbilitiesService(
    stub<PrismaService>({}),
    stub<KbRetrieveService>(kbRetrieve),
  );
};

type Deps = {
  prisma?: unknown;
  abilities?: AiAbilitiesService;
  crm?: unknown;
  okr?: unknown;
  hrm?: unknown;
  oa?: unknown;
};

const makePoints = (deps: Deps = {}) =>
  new AiPointsService(
    stub<PrismaService>(deps.prisma ?? {}),
    deps.abilities ?? makeAbilities(),
    stub<CrmScopeService>(deps.crm ?? {}),
    stub<OkrScopeService>(deps.okr ?? {}),
    stub<HrmScopeService>(deps.hrm ?? {}),
    stub<OaScopeService>(deps.oa ?? {}),
  );

describe('CRM 线索评分规则回落', () => {
  const prismaOf = () => ({
    crmLead: {
      findFirst: jest.fn(async () => ({
        name: '某科技公司',
        contactName: '',
        phone: '',
        email: '',
        source: '',
        stage: 'NEW',
        ownerId: '',
        remark: '<p>首次接触</p>',
        lastFollowAt: null,
      })),
    },
    crmFollowRecord: { findMany: jest.fn(async () => []) },
    crmFollowPlan: { count: jest.fn(async () => 0) },
  });
  const crmOf = () => ({
    requireMember: jest.fn(async () => ({ ownerUserId: 'owner1' })),
  });

  it('缺联系人信息时列出缺失项并给出首次触达建议', async () => {
    const result = await makePoints({
      prisma: prismaOf(),
      crm: crmOf(),
    }).crmLeadScore(user, { leadId: 1 });
    expect(result.mode).toBe('rule');
    expect(result.reasons.some((row) => row.includes('还缺'))).toBe(true);
    expect(result.nextStep).toContain('首次触达');
  });
});

describe('分发内容一稿多平台改写规则回落', () => {
  it('无模型时按所选平台各生成一版并给出标题与标签', async () => {
    const result = await makePoints().distributionRewrite(user, {
      title: '新品发布',
      text: '我们发布了新一代智能硬件。',
      platformCodes: ['weibo', 'xiaohongshu'],
    });
    expect(result.mode).toBe('rule');
    expect(result.versions).toHaveLength(2);
    expect(result.titles.length).toBeGreaterThan(0);
  });
});

describe('出海合规 RAG 向答', () => {
  it('无模型但命中知识库时返回可追溯引用与固定风险清单', async () => {
    const abilities = makeAbilities([
      {
        source: 'kb',
        id: 1,
        title: '欧盟 VAT 指南',
        text: '跨境电商需在目的国注册 VAT。',
        score: 0.9,
        ref: 'eu-vat',
      },
    ]);
    const result = await makePoints({ abilities }).overseasCheck(user, {
      country: '德国',
      question: '需要注册增值税吗',
    });
    expect(result.mode).toBe('retrieval');
    expect(result.citations[0]).toMatchObject({
      title: '欧盟 VAT 指南',
      ref: 'eu-vat',
    });
    expect(result.risks.length).toBeGreaterThan(0);
  });
});

describe('开票材料抽取规则回落', () => {
  it('按字段标签抽取并核对价税合计一致性', async () => {
    const result = await makePoints().invoiceExtract(user, {
      text: [
        '发票号码：12345678',
        '开票日期：2026-03-01',
        '购买方：甲方公司',
        '销售方：乙方公司',
        '金额：1000',
        '税额：60',
        '价税合计：1050',
      ].join('\n'),
    });
    expect(result.mode).toBe('rule');
    expect(result.values.invoiceNo).toBe('12345678');
    expect(result.values.invoiceDate).toBe('2026-03-01');
    expect(result.warnings.some((row) => row.includes('不一致'))).toBe(true);
  });
});

describe('OA 自然语言发起流程', () => {
  const templates = [
    {
      id: 1,
      name: '请假申请',
      description: '员工请假',
      fieldsSchema: [
        { key: 'days', label: '请假天数', type: 'number', required: true },
        { key: 'reason', label: '请假事由', type: 'textarea', required: true },
      ],
    },
    {
      id: 2,
      name: '费用报销',
      description: '差旅费用报销',
      fieldsSchema: [
        { key: 'amount', label: '报销金额', type: 'amount', required: true },
        {
          key: 'category',
          label: '费用类别',
          type: 'select',
          required: false,
          options: [
            { label: '差旅', value: 'TRAVEL' },
            { label: '办公', value: 'OFFICE' },
          ],
        },
      ],
    },
  ];
  const prismaOf = (rows: unknown[] = templates) => ({
    oaTemplate: { findMany: jest.fn(async () => rows) },
  });
  const oaOf = () => ({
    context: jest.fn(async () => ({
      orgType: 'ENTERPRISE',
      orgUserId: 'u1',
      name: '测试企业',
    })),
  });

  it('无模型时按关键词匹配模板，返回草稿与缺项提示', async () => {
    const result = await makePoints({
      prisma: prismaOf(),
      oa: oaOf(),
    }).oaDraftApplication(user, { text: '请两天年假回老家看父母' });
    expect(result.mode).toBe('rule');
    expect(result.templateId).toBe(1);
    expect(result.templateName).toBe('请假申请');
    expect(result.formData).toEqual({});
    expect(result.missing).toEqual(
      expect.arrayContaining(['请假天数', '请假事由']),
    );
  });

  it('指定模板时只在该模板上起草', async () => {
    const result = await makePoints({
      prisma: prismaOf(),
      oa: oaOf(),
    }).oaDraftApplication(user, { text: '打车去机场接客户', templateId: 2 });
    expect(result.templateId).toBe(2);
    expect(result.templateName).toBe('费用报销');
  });

  it('描述为空时报错', async () => {
    await expect(
      makePoints({ prisma: prismaOf(), oa: oaOf() }).oaDraftApplication(user, {
        text: '   ',
      }),
    ).rejects.toThrow('请用一句话描述');
  });

  it('组织没有启用模板时报错', async () => {
    await expect(
      makePoints({ prisma: prismaOf([]), oa: oaOf() }).oaDraftApplication(
        user,
        {
          text: '请假',
        },
      ),
    ).rejects.toThrow('还没有启用的申请模板');
  });
});
