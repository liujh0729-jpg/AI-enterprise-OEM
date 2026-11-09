import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import { KbSpaceService, putLog } from './kb-space.service';
import { clip, iso } from './kb-util';

/**
 * 消费者绑定（§10.2 多消费者模型）：分身/客服/ERP/CRM 挂空间读或写。
 * WRITE 绑定同时是账号通道写权限的来源之一（consumerId 约定填账号 id 时生效）。
 */

export interface BindConsumerInput {
  spaceId: number;
  consumerType: 'AVATAR' | 'AGENT' | 'SERVICE_DESK' | 'ERP' | 'CRM';
  consumerId: string;
  role: 'READ' | 'WRITE';
  priority: number;
}

export class KbConsumerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: KbSpaceService,
  ) {}

  async list(spaceId: number, user: CurrentUser) {
    const space = await this.spaces.loadReadable(spaceId, user);
    const rows = await this.prisma.kbConsumer.findMany({
      where: { spaceId },
      orderBy: [{ priority: 'desc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      spaceId: row.spaceId,
      consumerType: row.consumerType,
      consumerId: row.consumerId,
      role: row.role as 'READ' | 'WRITE',
      priority: row.priority,
      spaceName: space.name,
      createdAt: iso(row.createdAt),
    }));
  }

  async bind(body: BindConsumerInput, user: CurrentUser) {
    const space = await this.spaces.loadWritable(body.spaceId, user);
    const consumerId = clip(body.consumerId.trim(), 64);
    const row = await this.prisma.kbConsumer.upsert({
      where: {
        spaceId_consumerType_consumerId: {
          spaceId: space.id,
          consumerType: body.consumerType,
          consumerId,
        },
      },
      create: {
        spaceId: space.id,
        consumerType: body.consumerType,
        consumerId,
        role: body.role,
        priority: body.priority,
      },
      update: { role: body.role, priority: body.priority },
    });
    await putLog(
      this.prisma,
      space.id,
      'BIND',
      `绑定消费者 ${body.consumerType}:${consumerId}（${body.role}）`,
      { consumerId: row.id },
      user.userId,
    );
    return {
      id: row.id,
      spaceId: row.spaceId,
      consumerType: row.consumerType,
      consumerId: row.consumerId,
      role: row.role as 'READ' | 'WRITE',
      priority: row.priority,
      spaceName: space.name,
      createdAt: iso(row.createdAt),
    };
  }

  async unbind(id: number, user: CurrentUser) {
    const row = await this.prisma.kbConsumer.findUnique({ where: { id } });
    if (!row) return { deleted: 0 };
    await this.spaces.loadWritable(row.spaceId, user);
    await this.prisma.kbConsumer.delete({ where: { id } });
    await putLog(
      this.prisma,
      row.spaceId,
      'BIND',
      `解绑消费者 ${row.consumerType}:${row.consumerId}`,
      {},
      user.userId,
    );
    return { deleted: 1 };
  }
}
