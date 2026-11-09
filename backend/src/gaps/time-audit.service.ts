import type { Prisma } from '../../generated/prisma';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmOrg } from '../hrm/hrm.scope';
import type { GapScopeService } from './gaps.scope';
import { asInt, asText, iso, jsonBlock, pageParams, Row } from './gaps.helpers';

const ACTION_LABELS: Record<string, string> = {
  UPDATE: '修改',
  DELETE: '删除',
  APPROVE: '审批通过',
  REJECT: '审批驳回',
};

const minutesOf = (block: Row): number => {
  const value = Number(block.durationMinutes);
  return Number.isFinite(value) ? value : 0;
};

/** 供 project 服务在改动工时后调用：同一份「改前/改后」口径，列表与汇总都从这张表读。 */
export async function recordTimeLogEdit(
  prisma: PrismaService,
  org: Pick<HrmOrg, 'orgType' | 'orgUserId' | 'actorId'>,
  input: {
    timeLogId: number;
    action: 'UPDATE' | 'DELETE' | 'APPROVE' | 'REJECT';
    before: Row;
    after?: Row;
    reason?: string;
  },
): Promise<void> {
  await prisma.pjTimeLogEdit.create({
    data: {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      timeLogId: input.timeLogId,
      action: input.action,
      editorId: org.actorId,
      beforeJson: jsonBlock(input.before) as Prisma.InputJsonValue,
      afterJson: jsonBlock(input.after) as Prisma.InputJsonValue,
      reason: String(input.reason || '').slice(0, 500),
    },
  });
}

/**
 * B3#21 工时修改审计：只读台账，写入由项目服务在改/删/审时落一行。
 * 汇总按「操作人 × 最近 N 天」给修改/删除次数与净变化分钟数。
 */
export class TimeAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: GapScopeService,
  ) {}

  private view(row: {
    id: number;
    timeLogId: number;
    action: string;
    editorId: string;
    beforeJson: unknown;
    afterJson: unknown;
    reason: string;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      timeLogId: row.timeLogId,
      action: row.action,
      actionLabel: ACTION_LABELS[row.action] || row.action,
      editorId: row.editorId,
      before: jsonBlock(row.beforeJson),
      after: jsonBlock(row.afterJson),
      reason: row.reason,
      createdAt: iso(row.createdAt),
    };
  }

  async edits(user: CurrentUser, query: Row) {
    const org = await this.scope.resolve(user);
    const { page, pageSize, offset } = pageParams(query);
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(asText(query.action).trim()
        ? { action: asText(query.action).trim().toUpperCase() }
        : {}),
      ...(asInt(query.timeLogId) > 0
        ? { timeLogId: asInt(query.timeLogId) }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.pjTimeLogEdit.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: pageSize,
      }),
      this.prisma.pjTimeLogEdit.count({ where }),
    ]);
    return { list: rows.map((row) => this.view(row)), total, page, pageSize };
  }

  async summary(user: CurrentUser, query: Row) {
    const org = await this.scope.resolve(user);
    const days = Math.min(365, Math.max(1, asInt(query.days, 30) || 30));
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.pjTimeLogEdit.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        createdAt: { gte: since },
      },
      select: {
        editorId: true,
        action: true,
        beforeJson: true,
        afterJson: true,
      },
    });
    const byEditor = new Map<
      string,
      { edits: number; deletes: number; minutesDelta: number }
    >();
    for (const row of rows) {
      const entry = byEditor.get(row.editorId) || {
        edits: 0,
        deletes: 0,
        minutesDelta: 0,
      };
      const before = jsonBlock(row.beforeJson);
      const after = jsonBlock(row.afterJson);
      if (row.action === 'UPDATE') entry.edits += 1;
      if (row.action === 'DELETE') entry.deletes += 1;
      entry.minutesDelta += minutesOf(after) - minutesOf(before);
      byEditor.set(row.editorId, entry);
    }
    return [...byEditor.entries()]
      .map(([editorId, entry]) => ({ editorId, ...entry }))
      .sort((a, b) => b.edits + b.deletes - (a.edits + a.deletes));
  }
}
