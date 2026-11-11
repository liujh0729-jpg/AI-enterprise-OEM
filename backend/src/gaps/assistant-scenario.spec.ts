import { BusinessException } from '../common/business.exception';
import { CurrentUser } from '../auth/current-user';
import type { GapScopeService } from './gaps.scope';
import type { PrismaService } from '../prisma/prisma.service';
import type { TaskDraft } from '../task-center/task-source';
import { stub } from '../../test/doubles';
import { PageAssistantService } from './assistant.service';

/**
 * docs §11.2 场景助手：一个模块一个定位；会议/邮件助手把行动项落成待确认任务。
 * 模型不可用时必须退回规则式，入口不能变死按钮。
 */

const user = new CurrentUser('u-1', 'tester', 'user');

function setup() {
  const drafts: TaskDraft[] = [];
  const prisma = {
    assistantPageQuery: {
      create: jest.fn(async () => ({ id: 1 })),
    },
  };
  const scope = {
    resolve: jest.fn(async () => ({
      orgType: 'ENTERPRISE',
      orgUserId: 'ent-1',
      actorId: 'u-1',
      isOwner: true,
      isAdmin: true,
      roles: [],
      positions: [],
      department: '',
    })),
  };
  const service = new PageAssistantService(
    stub<PrismaService>(prisma),
    stub<GapScopeService>(scope),
    {
      assign: async (draft: TaskDraft) => {
        drafts.push(draft);
        return { id: drafts.length };
      },
    },
  );
  return { service, prisma, drafts };
}

describe('场景助手（docs §11.2）', () => {
  it('注册表按路由挂场景，会议/邮件支持行动项提取', () => {
    const { service } = setup();
    const rows = service.registry();
    const of = (route: string) => rows.find((row) => row.route === route);
    expect(of('/crm')?.scenarioKey).toBe('SALES');
    expect(of('/contracts')?.scenarioKey).toBe('CONTRACT');
    expect(of('/finance')?.scenarioKey).toBe('FINANCE');
    expect(of('/erp')?.scenarioKey).toBe('PURCHASE_STOCK');
    expect(of('/hrm')?.scenarioKey).toBe('HR');
    expect(of('/service-desk')?.scenarioKey).toBe('SERVICE_DESK');
    expect(of('/marketing-tools')?.scenarioKey).toBe('MARKETING');
    expect(of('/mail')?.scenarioKey).toBe('MEETING_MAIL');
    expect(of('/mail')?.extract).toBe(true);
    expect(of('/crm')?.boundaries.length).toBeGreaterThan(0);
  });

  it('模型不可用时回答给出场景与边界（不发空答复）', async () => {
    const { service } = setup();
    const result = await service.ask(user, {
      route: '/crm',
      entityType: '',
      entityId: '',
      question: '这个商机下一步做什么',
    });
    expect(result.scenarioKey).toBe('SALES');
    expect(result.scenarioTitle).toBe('销售助手');
    expect(result.answer).toContain('销售助手');
    expect(result.boundaries).toContain('对外发送前必须由人确认');
  });

  it('会议记录提取行动项：规则式兜底并派「待确认」任务', async () => {
    const { service, drafts } = setup();
    const result = await service.extractActions(user, {
      sourceType: 'MEETING',
      sourceRef: 'meet-1',
      text: '待办：周五前把报价单发给客户\nTODO: 跟进合同盖章\n普通讨论内容',
      assigneeUserId: '',
    });
    expect(result.total).toBe(2);
    expect(drafts.map((item) => item.title)).toEqual([
      '周五前把报价单发给客户',
      '跟进合同盖章',
    ]);
    expect(drafts[0]).toMatchObject({
      source: 'assistant',
      sourceId: 'MEETING:meet-1:1',
      assigneeUserId: 'u-1',
      sourceStatusLabel: '待确认',
      link: '/oa',
    });
    expect(drafts[0].description).toContain('会议记录');
  });

  it('没识别到行动项时不造任务；空文本直接拒绝', async () => {
    const { service, drafts } = setup();
    const none = await service.extractActions(user, {
      sourceType: 'MAIL',
      sourceRef: 'mail-9',
      text: '这是一封普通通知邮件，没有行动项。',
    });
    expect(none.total).toBe(0);
    expect(drafts).toHaveLength(0);
    await expect(
      service.extractActions(user, { text: '   ' }),
    ).rejects.toBeInstanceOf(BusinessException);
  });
});
