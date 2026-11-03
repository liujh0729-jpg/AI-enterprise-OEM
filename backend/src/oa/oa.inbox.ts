import type { OaInbox, OaInboxGroup, OaInboxItem } from '@enterprise/contracts';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { ContractsService } from '../contracts/contracts.service';
import { CrmApprovalService } from '../crm/crm.approval.service';
import { FlexService } from '../flex/flex.service';
import { InvoiceService } from '../invoice/invoice.service';
import { PrismaService } from '../prisma/prisma.service';
import { asArray, num, round } from './oa.helpers';
import type { OaContext } from './oa.scope';

/** 每个来源在聚合入口里最多列几条，其余到对应模块看完整清单。 */
const ITEM_LIMIT = 5;

const OA_INBOX_SOURCE_LABELS: Record<string, string> = {
  OA: 'OA 审批单',
  CRM: 'CRM 审批',
  LOWCODE: '内建应用审批',
  OTHER: '其他人工审核',
};

/**
 * 全站审批聚合（只读）：四类来源各自复用本模块的待办口径，
 * 某一个来源取数失败只少一组，不挡住整个聚合入口。
 */
export class OaInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crmApproval: CrmApprovalService,
    private readonly invoice: InvoiceService,
    private readonly flex: FlexService,
    private readonly contracts: ContractsService,
  ) {}

  async inbox(user: CurrentUser, ctx: OaContext): Promise<OaInbox> {
    const groups: OaInboxGroup[] = [];
    const load = async (
      source: OaInboxGroup['source'],
      run: () => Promise<{ count: number; link: string; items: OaInboxItem[] }>,
    ) => {
      try {
        const { count, link, items } = await run();
        if (!count && !items.length) return;
        groups.push({
          source,
          sourceLabel: OA_INBOX_SOURCE_LABELS[source] || source,
          count,
          link,
          items,
        });
      } catch {
        // 单个来源失败静默降级，其余分组照常返回。
      }
    };
    await load('OA', () => this.oaGroup(user, ctx));
    await load('CRM', () => this.crmGroup(user));
    await load('LOWCODE', () => this.lowcodeGroup(user, ctx));
    await load('OTHER', () => this.otherGroup(user, ctx));
    return {
      total: groups.reduce((sum, group) => sum + group.count, 0),
      groups,
    };
  }

  private async oaGroup(user: CurrentUser, ctx: OaContext) {
    const apps = await this.prisma.oaApplication.findMany({
      where: {
        orgType: ctx.orgType,
        orgUserId: ctx.orgUserId,
        status: { in: ['APPROVING', 'RETURNED'] },
      },
      select: {
        id: true,
        number: true,
        title: true,
        amount: true,
      },
      orderBy: { submittedAt: 'desc' },
      take: 200,
    });
    const appMap = new Map(apps.map((row) => [row.id, row]));
    const tasks = await this.prisma.oaTask.findMany({
      where: {
        approverId: user.userId,
        status: 'PENDING',
        applicationId: { in: apps.map((row) => row.id) },
      },
      orderBy: { id: 'asc' },
    });
    return {
      count: tasks.length,
      link: '/oa?tab=todo',
      items: tasks.slice(0, ITEM_LIMIT).map((task) => {
        const app = appMap.get(task.applicationId);
        return {
          title: text(app?.title) || task.nodeName || '审批单',
          subtitle: `${text(app?.number)} ${task.nodeName || '待审批'}`.trim(),
          link: `/oa?tab=todo&id=${task.applicationId}`,
          amount: round(num(app?.amount, 0)),
        };
      }),
    };
  }

  private async crmGroup(user: CurrentUser) {
    const page = await this.crmApproval.todo(user, {
      page: 1,
      pageSize: ITEM_LIMIT,
    });
    return {
      count: page.total,
      link: '/crm?tab=approvals',
      items: page.list.slice(0, ITEM_LIMIT).map((row) => ({
        title: text(row.title) || text(row.formTypeLabel) || 'CRM 审批',
        subtitle: [
          text(row.formTypeLabel),
          text(row.nodeName),
          text(row.submitterName),
        ]
          .filter(Boolean)
          .join(' · '),
        link: `/crm?tab=approvals&id=${row.instanceId}`,
        amount: 0,
      })),
    };
  }

  private async lowcodeGroup(user: CurrentUser, ctx: OaContext) {
    const tasks = await this.prisma.lowCodeApprovalTask.findMany({
      where: { assigneeUserId: user.userId, status: 'PENDING' },
      orderBy: { id: 'asc' },
      take: 50,
    });
    if (!tasks.length) return { count: 0, link: '/lowcode', items: [] };
    const projects = await this.prisma.lowCodeProject.findMany({
      where: { id: { in: [...new Set(tasks.map((task) => task.projectId))] } },
      select: {
        id: true,
        name: true,
        orgType: true,
        orgUserId: true,
        ownerUserId: true,
      },
    });
    // 只算当前 OA 组织的项目，外加自己名下的个人项目。
    const scoped = new Set(
      projects
        .filter(
          (project) =>
            (project.orgType === ctx.orgType &&
              project.orgUserId === ctx.orgUserId) ||
            project.ownerUserId === user.userId,
        )
        .map((project) => project.id),
    );
    const mine = tasks.filter((task) => scoped.has(task.projectId));
    const names = new Map(
      projects.map((project) => [project.id, project.name]),
    );
    return {
      count: mine.length,
      link: '/lowcode',
      items: mine.slice(0, ITEM_LIMIT).map((task) => ({
        title: task.nodeName || '内建应用审批',
        subtitle: names.get(task.projectId) || `项目 #${task.projectId}`,
        link: `/lowcode/p/${task.projectId}`,
        amount: 0,
      })),
    };
  }

  private async otherGroup(user: CurrentUser, ctx: OaContext) {
    const items: OaInboxItem[] = [];
    let count = 0;

    // 发票列表的装饰行只显式声明了名称/状态等列，单据号与主键仍在对象上，这里按记录取值。
    const invoices = (
      (await this.invoice.list(user, 'REQUESTED')) as unknown as Array<
        Record<string, unknown>
      >
    ).filter((row) => row.canReview === true);
    count += invoices.length;
    items.push(
      ...invoices.slice(0, ITEM_LIMIT).map((row) => ({
        title: text(row.buyerName) || `发票申请 #${text(row.id)}`,
        subtitle: [text(row.reqNo), text(row.statusLabel)]
          .filter(Boolean)
          .join(' · '),
        link: '/tax',
        amount: round(num(row.amount, 0)),
      })),
    );

    const onboardings = (await this.flex.listOnboardings(user)).filter(
      (row) => row.status === 'SUBMITTED',
    );
    count += onboardings.length;
    items.push(
      ...onboardings.slice(0, ITEM_LIMIT).map((row) => ({
        title: text(row.agentName) || `用工进件 #${row.id}`,
        subtitle: `${text(row.onboardingNo)} 待审核`,
        link: '/flex',
        amount: 0,
      })),
    );

    const pendingContracts = (await this.contracts.list(user)).filter(
      (row) => row.status === 'PENDING',
    );
    count += pendingContracts.length;
    items.push(
      ...pendingContracts.slice(0, ITEM_LIMIT).map((row) => ({
        title:
          text(row.enterpriseName) || text(row.providerOrg) || '签约待确认',
        subtitle: `${text(row.contractNo)} 待确认`,
        link: '/contracts',
        amount: 0,
      })),
    );

    const applicationWhere = {
      orgType: ctx.orgType,
      orgUserId: ctx.orgUserId,
      status: 'PENDING',
    };
    const applications = await this.prisma.orgApplication.findMany({
      where: applicationWhere,
      select: {
        memberUserId: true,
        memberKind: true,
        roles: true,
      },
      orderBy: { id: 'desc' },
      take: ITEM_LIMIT,
    });
    count += await this.prisma.orgApplication.count({
      where: applicationWhere,
    });
    const names = await this.prisma.staffProfile.findMany({
      where: { userId: { in: applications.map((row) => row.memberUserId) } },
      select: { userId: true, realName: true },
    });
    const nameMap = new Map(
      names.map((row) => [row.userId, text(row.realName)]),
    );
    items.push(
      ...applications.map((row) => ({
        title: `${nameMap.get(row.memberUserId) || row.memberUserId} 的${
          row.memberKind === 'AGENT' ? '代理人' : '职员'
        }加入申请`,
        subtitle: asArray(row.roles).slice(0, 2).join('、') || '待确认',
        link: '/staff',
        amount: 0,
      })),
    );

    // 四个子模块各有各的页面，整组不给统一跳转，只让每条各自点进去。
    return { count, link: '', items };
  }
}
