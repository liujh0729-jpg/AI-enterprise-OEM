import type { PrismaService } from '../prisma/prisma.service';
import { num, progressOf } from './okr.helpers';
import { recalcObjective } from './okr.progress';

type Row = Record<string, unknown>;
/** HrmOrg 用 orgUserId，OkrContext 用 ownerUserId，这里统一取值。 */
type OrgKey = { orgType: string; orgUserId?: string; ownerUserId?: string };

const userIdOf = (org: OrgKey) => org.orgUserId || org.ownerUserId || '';

/**
 * 任务 ↔ 关键结果自动回写。
 * 口径：任务完成时按「链接贡献值」累加到 KR 当前值；链接未单独设定贡献值时，
 * 平均分摊「起始值 → 目标值」的差额。任务重开则按同一公式回退。
 * 只在 KR 挂了任务链接时才动 KR，手工指标与自动指标互不覆盖（后者由 OkrMetricsService 负责）。
 */
export class OkrTaskLinkageService {
  constructor(private readonly prisma: PrismaService) {}

  async onTaskStatus(org: OrgKey, payload: Row) {
    const taskId = Number(payload.taskId);
    if (!taskId) return;
    const userId = userIdOf(org);
    if (!userId) return;
    const links = await this.prisma.okrTaskLink.findMany({
      where: { orgType: org.orgType, orgUserId: userId, taskId },
    });
    if (!links.length) return;
    const krIds = [...new Set(links.map((row) => row.krId).filter(Boolean))];
    for (const krId of krIds) {
      await this.recomputeKr(org, krId, String(taskId));
    }
    const objectiveIds = [
      ...new Set(
        links.filter((row) => !row.krId).map((row) => row.objectiveId),
      ),
    ];
    for (const objectiveId of objectiveIds) {
      await recalcObjective(this.prisma, userId, objectiveId);
    }
  }

  /** 增删任务链接后重算，避免 KR 值与链接集合脱节。 */
  async recomputeKr(org: OrgKey, krId: number, refId = '') {
    if (!krId) return;
    const userId = userIdOf(org);
    if (!userId) return;
    const kr = await this.prisma.okrKeyResult.findFirst({
      where: { id: krId, ownerUserId: userId },
    });
    if (!kr) return;
    const links = await this.prisma.okrTaskLink.findMany({
      where: { orgType: org.orgType, orgUserId: userId, krId },
    });
    const startValue = num(kr.startValue);
    const targetValue = num(kr.targetValue);
    if (!links.length) {
      await recalcObjective(this.prisma, userId, kr.objectiveId);
      return;
    }
    const tasks = await this.prisma.pjTask.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: userId,
        id: { in: links.map((row) => row.taskId) },
      },
      select: { id: true, status: true },
    });
    const done = new Set(
      tasks.filter((row) => row.status === 'DONE').map((row) => row.id),
    );
    const share = Math.abs(targetValue - startValue) / links.length;
    const sign = kr.direction === 'DOWN' ? -1 : 1;
    const moved = links.reduce((sum, link) => {
      if (!done.has(link.taskId)) return sum;
      const explicit = num(link.targetValue);
      return sum + (explicit > 0 ? explicit : share);
    }, 0);
    const low = Math.min(startValue, targetValue);
    const high = Math.max(startValue, targetValue);
    const after = Math.min(
      high,
      Math.max(low, Math.round((startValue + sign * moved) * 10000) / 10000),
    );
    const before = num(kr.currentValue);
    if (Math.abs(after - before) < 0.00005) {
      await recalcObjective(this.prisma, userId, kr.objectiveId);
      return;
    }
    await this.prisma.okrProgressLog.create({
      data: {
        ownerUserId: userId,
        krId: kr.id,
        objectiveId: kr.objectiveId,
        before,
        after,
        progress: progressOf(kr.direction, startValue, after, targetValue),
        note: `任务联动回写（${done.size}/${links.length} 项完成）`,
        source: 'AUTO',
        authorId: '',
        refType: 'TASK',
        refId: String(refId || krId),
      },
    });
    await this.prisma.okrKeyResult.update({
      where: { id: kr.id },
      data: { currentValue: after },
    });
    await recalcObjective(this.prisma, userId, kr.objectiveId);
  }
}
