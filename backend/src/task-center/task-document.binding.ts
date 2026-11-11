import type { Prisma } from '../../generated/prisma';

/**
 * 任务 ↔ 业务单据的承办人绑定（决策 D3=A）：
 * 服务商改派/接单必须与单据 `staffUserId` 同事务，任务可见性与单据可见性永远一致。
 * 各板块只在这里登记一个「按 sourceId 改承办人」的实现，不各写一套同步。
 */
export type TaskDocumentBinding = {
  source: string;
  /** sourceId（如 `so-12`）→ 单据主键；解析不了返回 null */
  idOf(sourceId: string): number | null;
  /** 在调用方事务里改承办人；返回 false 表示单据不存在，调用方必须抛错回滚 */
  setStaff(
    tx: Prisma.TransactionClient,
    id: number,
    staffUserId: string,
  ): Promise<boolean>;
};

export class TaskDocumentRegistry {
  private readonly bindings = new Map<string, TaskDocumentBinding>();

  register(binding: TaskDocumentBinding): this {
    this.bindings.set(binding.source, binding);
    return this;
  }

  get(source: string): TaskDocumentBinding | undefined {
    return this.bindings.get(source);
  }
}

function prefixed(prefix: string) {
  return (sourceId: string): number | null => {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(sourceId);
    if (!match) return null;
    const id = Number(match[1]);
    return Number.isInteger(id) && id > 0 ? id : null;
  };
}

const supplyOrderBinding: TaskDocumentBinding = {
  source: 'supply',
  idOf: prefixed('so'),
  async setStaff(tx, id, staffUserId) {
    const result = await tx.supplyOrder.updateMany({
      where: { id },
      data: { staffUserId },
    });
    return result.count === 1;
  },
};

const supplyBookingBinding: TaskDocumentBinding = {
  source: 'supply-booking',
  idOf: prefixed('sb'),
  async setStaff(tx, id, staffUserId) {
    const result = await tx.supplyBooking.updateMany({
      where: { id },
      data: { staffUserId },
    });
    return result.count === 1;
  },
};

/** 首批登记：供销订货单/服务预约单。B7 补其余板块时在这里继续 register。 */
export function registerTaskDocumentBindings(): TaskDocumentRegistry {
  return new TaskDocumentRegistry()
    .register(supplyOrderBinding)
    .register(supplyBookingBinding);
}
