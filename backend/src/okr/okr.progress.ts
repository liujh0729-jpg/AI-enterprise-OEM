import { PrismaService } from '../prisma/prisma.service';
import { num, progressOf, round } from './okr.helpers';

/**
 * 目标进度唯一的计算入口：
 * 有子目标＝按子目标权重折算（拆解型）；否则按 KR 权重折算；两者都没有时保留手工进度。
 * 每次重算都向上递归，保证父目标与看板口径一致。
 */
export async function recalcObjective(
  prisma: PrismaService,
  ownerUserId: string,
  objectiveId: number,
  depth = 0,
): Promise<number> {
  if (!objectiveId || depth > 8) return 0;
  const objective = await prisma.okrObjective.findFirst({
    where: { id: objectiveId, ownerUserId },
  });
  if (!objective) return 0;
  const children = await prisma.okrObjective.findMany({
    where: {
      ownerUserId,
      parentId: objectiveId,
      status: { not: 'CANCELLED' },
    },
    select: { id: true, weight: true, progress: true },
  });
  let progress = num(objective.progress);
  if (children.length) {
    progress = weighted(
      children.map((row) => ({
        weight: num(row.weight, 1),
        progress: num(row.progress),
      })),
    );
  } else {
    const krs = await prisma.okrKeyResult.findMany({
      where: { ownerUserId, objectiveId },
      select: {
        weight: true,
        direction: true,
        startValue: true,
        currentValue: true,
        targetValue: true,
      },
    });
    if (krs.length) {
      progress = weighted(
        krs.map((row) => ({
          weight: num(row.weight, 1),
          progress: progressOf(
            row.direction,
            num(row.startValue),
            num(row.currentValue),
            num(row.targetValue),
          ),
        })),
      );
    }
  }
  if (progress !== num(objective.progress)) {
    await prisma.okrObjective.update({
      where: { id: objectiveId },
      data: { progress },
    });
  }
  if (objective.parentId > 0) {
    await recalcObjective(prisma, ownerUserId, objective.parentId, depth + 1);
  }
  return progress;
}

/** 权重折算：权重全为 0 时退化为算术平均。 */
export function weighted(rows: { weight: number; progress: number }[]) {
  if (!rows.length) return 0;
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  if (total > 0) {
    return round(
      rows.reduce((sum, row) => sum + row.progress * row.weight, 0) / total,
    );
  }
  return round(rows.reduce((sum, row) => sum + row.progress, 0) / rows.length);
}
