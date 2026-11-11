import { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationService } from '../notifications/notification.service';
import type { ContentMediaService } from '../content/content-media.service';
import { OaService } from './oa.service';
import type { OaContext, OaScopeService } from './oa.scope';
import type { OaTemplateService } from './oa.templates';
import type { OaFlowService } from './oa.flow';
import type { OaLinkageService } from './oa.linkage';
import type { OaInboxService } from './oa.inbox';
import { text } from '../common/api';
import { stub } from '../../test/doubles';

/**
 * 设计方案 §四 OA：详情/操作要以单据所属组织建立授权上下文。
 * 修复前 loadApp 在「带了 query 但没带组织」时会按全局 id 取单据，却用调用者
 * 默认组织判断管理员身份，导致别家组织的单据能被跨组织读走。
 */

const USER = new CurrentUser('u1', '张三', 'member');

/** 调用者默认组织（ent-a）的管理员上下文；别家组织 ent-b 一律解析为「非成员」。 */
const DEFAULT_CTX: OaContext = {
  orgType: 'ENTERPRISE',
  orgUserId: 'ent-a',
  name: 'A 公司',
  role: 'OWNER',
  roleLabel: '组织主账号',
  actorId: 'u1',
  isOwner: true,
  isAdmin: true,
  department: '',
  member: null,
  settings: {
    adminUserIds: [],
    deptHeads: {},
    remindAfterHours: 24,
    allowWithdraw: true,
  },
};

function build(appRow: Record<string, unknown>) {
  const prisma = {
    oaApplication: { findFirst: jest.fn(async () => appRow) },
    oaTask: { count: jest.fn(async () => 0) },
    oaCc: { count: jest.fn(async () => 0) },
    oaRecord: { findMany: jest.fn(async () => []) },
  };
  const scope = {
    // 只有 ent-a 能解析出上下文：query 指定别家组织时按「非成员」返回 null。
    resolve: jest.fn(
      async (_user: CurrentUser, query?: Record<string, unknown>) => {
        const orgUserId = text(query?.orgUserId);
        return orgUserId && orgUserId !== 'ent-a' ? null : DEFAULT_CTX;
      },
    ),
    context: jest.fn(async () => DEFAULT_CTX),
    requireAdmin: jest.fn(),
  };
  const service = new OaService(
    stub<PrismaService>(prisma),
    stub<OaScopeService>(scope),
    stub<OaTemplateService>({}),
    stub<OaFlowService>({}),
    stub<OaLinkageService>({}),
    stub<OaInboxService>({}),
    stub<NotificationService>({}),
    stub<ContentMediaService>({}),
  );
  return { service, prisma, scope };
}

describe('OA 详情按单据所属组织鉴权', () => {
  it('别家组织的单据：按全局 id 也读不到，且不拿默认组织的管理员身份放行', async () => {
    const ctx = build({
      id: 7,
      orgType: 'ENTERPRISE',
      orgUserId: 'ent-b',
      applicantId: 'other-user',
      status: 'APPROVING',
    });
    await expect(ctx.service.records(USER, '7', {})).rejects.toThrow(
      '单据不存在',
    );
    // 鉴权上下文必须取自单据所属组织，而不是调用者默认组织。
    expect(ctx.scope.resolve).toHaveBeenCalledWith(USER, {
      orgType: 'ENTERPRISE',
      orgUserId: 'ent-b',
    });
    expect(ctx.scope.context).not.toHaveBeenCalled();
    expect(ctx.prisma.oaRecord.findMany).not.toHaveBeenCalled();
  });

  it('本组织的单据：发起人可读，返回该单据记录', async () => {
    const ctx = build({
      id: 9,
      orgType: 'ENTERPRISE',
      orgUserId: 'ent-a',
      applicantId: 'u1',
      status: 'APPROVING',
    });
    await expect(ctx.service.records(USER, '9', {})).resolves.toEqual([]);
    expect(ctx.prisma.oaRecord.findMany).toHaveBeenCalledWith({
      where: { applicationId: 9 },
      orderBy: { id: 'asc' },
    });
  });

  it('本组织的单据：管理员可读（isAdmin 来自单据所属组织）', async () => {
    const ctx = build({
      id: 11,
      orgType: 'ENTERPRISE',
      orgUserId: 'ent-a',
      applicantId: 'someone-else',
      status: 'APPROVING',
    });
    await expect(ctx.service.records(USER, '11', {})).resolves.toEqual([]);
  });
});
