import type { HrmOrg } from '../hrm/hrm.scope';
import type { MechanismService } from '../mechanisms/mechanism.service';
import type { PrismaService } from '../prisma/prisma.service';

type Row = Record<string, unknown>;

/**
 * 增长联动：把「销售成交」接到「交付」上。
 * CRM 订单审批通过 → 自动立项（幂等：同组织同订单只建一次），并把项目 id 回写到订单。
 * 只做库内一致性动作；Webhook/规则仍由机制服务统一分发。
 */
export class GrowthLinkageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mechanisms: MechanismService,
  ) {}

  async onOrderApproved(org: HrmOrg, payload: Row) {
    const orderId = Number(payload.orderId);
    if (!orderId) return;
    const order = await this.prisma.crmOrder.findFirst({
      where: {
        id: orderId,
        ownerUserId: org.orgUserId,
        deletedAt: null,
      },
    });
    if (!order) return;
    if (order.projectId) {
      const existing = await this.prisma.pjProject.findFirst({
        where: { id: order.projectId, orgUserId: org.orgUserId },
        select: { id: true },
      });
      if (existing) return;
    }
    const linked = await this.prisma.pjProject.findFirst({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        source: 'CRM_ORDER',
        sourceRef: String(order.id),
      },
      select: { id: true },
    });
    let projectId = linked?.id || 0;
    if (!projectId) {
      const customer = order.customerId
        ? await this.prisma.crmCustomer.findUnique({
            where: { id: order.customerId },
            select: { name: true },
          })
        : null;
      const project = await this.prisma.pjProject.create({
        data: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          code: `DD-${order.number || order.id}`.slice(0, 32),
          name: order.name.slice(0, 120),
          description: `由 CRM 订单 ${order.number || order.id} 审批通过自动立项`,
          source: 'CRM_ORDER',
          sourceRef: String(order.id),
          customerName: customer?.name || '',
          contractId: order.contractId,
          ownerId: order.ownerId,
          status: 'PLANNING',
          budgetAmount: order.amount,
          currency: 'CNY',
          createdBy: org.actorId,
        },
      });
      projectId = project.id;
      if (order.ownerId) {
        await this.prisma.pjProjectMember.upsert({
          where: {
            projectId_principalType_principalId: {
              projectId,
              principalType: 'STAFF',
              principalId: order.ownerId,
            },
          },
          create: {
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            projectId,
            principalType: 'STAFF',
            principalId: order.ownerId,
            role: 'OWNER',
          },
          update: { role: 'OWNER' },
        });
      }
      await this.mechanisms
        .dispatch(org, 'project.created', {
          projectId,
          name: project.name,
          status: project.status,
          source: 'crm.order',
          sourceId: String(order.id),
        })
        .catch(() => undefined);
    }
    await this.prisma.crmOrder.update({
      where: { id: order.id },
      data: { projectId },
    });
  }
}
