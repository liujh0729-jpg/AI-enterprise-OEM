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

const abilitiesWith = (snippets: unknown[] = [], modes: string[] = []) => {
  const kbRetrieve = {
    retrieve: jest.fn(async () => ({
      query: 'q',
      sources: ['kb'],
      snippets,
      modes,
      total: snippets.length,
      spaces: [],
    })),
  };
  return {
    service: new AiAbilitiesService(
      stub<PrismaService>({}),
      stub<KbRetrieveService>(kbRetrieve),
    ),
    kbRetrieve,
  };
};

describe('通用 AI 能力规则回落', () => {
  it('摘要无模型时按句子抽取要点', async () => {
    const { service } = abilitiesWith();
    const result = await service.summarize(user, {
      text: '第一点：本季度销售增长明显。第二点：华东区贡献最大。第三点：需要关注退货率。第四点：下季度继续投入。',
      maxChars: 200,
    });
    expect(result.mode).toBe('rule');
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.points.length).toBeGreaterThan(0);
  });

  it('抽取无模型时用正则识别邮箱、电话与金额', async () => {
    const { service } = abilitiesWith();
    const result = await service.extract(user, {
      text: '联系人邮箱 sales@example.com，电话 13800138000，合同金额 12000 元，签署日期 2026-03-01。',
      fields: [
        { key: 'email', label: '邮箱' },
        { key: 'phone', label: '电话' },
        { key: 'amount', label: '金额' },
        { key: 'date', label: '日期' },
        { key: 'owner', label: '负责人' },
      ],
    });
    expect(result.mode).toBe('rule');
    expect(result.values.email).toBe('sales@example.com');
    expect(result.values.phone).toContain('13800138000');
    expect(result.missing).toContain('负责人');
  });

  it('分类无模型时按标签关键词命中', async () => {
    const { service } = abilitiesWith();
    const result = await service.classify(user, {
      text: '客户反馈发票抬头开错了，需要重新开票。',
      labels: [
        { value: 'INVOICE', label: '票据' },
        { value: 'MEETING', label: '会议' },
      ],
    });
    expect(result.mode).toBe('rule');
    expect(result.label).toBe('INVOICE');
    expect(result.labelName).toBe('票据');
  });

  it('评分无模型时按命中词与权重给出等级和建议', async () => {
    const { service } = abilitiesWith();
    const result = await service.score(user, {
      text: '客户已明确预算，本周确认采购数量，并约定了下次会议。',
      dimensions: [
        { key: 'budget', label: '预算', weight: 2 },
        { key: 'timeline', label: '时间', weight: 1 },
        { key: 'authority', label: '决策权', weight: 1 },
      ],
    });
    expect(result.mode).toBe('rule');
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.dimensions).toHaveLength(3);
    expect(result.advice.length).toBeGreaterThan(0);
  });

  it('问答无片段时明确提示知识库没有内容', async () => {
    const { service } = abilitiesWith([], ['keyword']);
    const result = await service.ask(user, { question: '报销标准是什么' });
    expect(result.mode).toBe('retrieval');
    expect(result.answer).toContain('没有检索到');
    expect(result.citations).toEqual([]);
  });

  it('问答无模型但有片段时按片段序号给出可追溯回答', async () => {
    const { service } = abilitiesWith(
      [
        {
          source: 'kb',
          id: 1,
          title: '报销制度',
          text: '差旅住宿标准为每晚 500 元。',
          score: 0.9,
          ref: 'reimburse',
        },
      ],
      ['keyword'],
    );
    const result = await service.ask(user, { question: '住宿标准是多少' });
    expect(result.mode).toBe('retrieval');
    expect(result.answer).toContain('报销制度');
    expect(result.citations[0]).toMatchObject({
      title: '报销制度',
      ref: 'reimburse',
    });
  });
});

describe('模块点状 AI 规则回落', () => {
  const points = () =>
    new AiPointsService(
      stub<PrismaService>({}),
      abilitiesWith().service,
      stub<CrmScopeService>({}),
      stub<OkrScopeService>({}),
      stub<HrmScopeService>({}),
      stub<OaScopeService>({}),
    );

  it('合同审阅无模型时命中高风险条款关键词', async () => {
    const result = await points().legalReview(user, {
      text: '本合同自动续约，乙方承担无限责任，违约金为合同金额的 200%。',
    });
    expect(result.mode).toBe('rule');
    expect(result.risks.length).toBeGreaterThan(0);
    expect(result.risks.some((risk) => risk.level === 'HIGH')).toBe(true);
  });

  it('邮件分析无模型时识别类别、优先级与待办', async () => {
    const result = await points().mailboxAnalyze(user, {
      subject: '发票重开',
      body: '您好，发票抬头开错了，请务必今天回复并重新开票。',
    });
    expect(result.mode).toBe('rule');
    expect(result.category).toBe('INVOICE');
    expect(result.priority).toBe('HIGH');
    expect(result.todos.length).toBeGreaterThan(0);
  });

  it('财税检查无模型时指出材料缺项', async () => {
    const result = await points().taxCheck(user, {
      text: '今收到服务费款项，享受免税政策。',
    });
    expect(result.mode).toBe('rule');
    expect(result.issues).toEqual(
      expect.arrayContaining([
        '缺少纳税人识别号/统一社会信用代码',
        '缺少金额或价税合计',
      ]),
    );
  });

  it('社媒文案无模型时给出主题模板并识别私信意向', async () => {
    const result = await points().socialCompose(user, {
      topic: '新品发布会 春季 智能硬件',
      platform: '小红书',
      intentText: '请问报价多少钱，想批量采购',
    });
    expect(result.mode).toBe('rule');
    expect(result.title).toContain('新品发布会');
    expect(result.intent).toBe('PURCHASE');
    expect(result.tags.length).toBeGreaterThan(0);
  });
});
