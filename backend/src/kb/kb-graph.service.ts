import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { KbLintRun } from '../../generated/prisma';
import { toJsonInput } from '../common/json-input';
import { extractWikilinks } from './kb-page.service';
import { KbSpaceService, putLog } from './kb-space.service';
import { iso, objMap } from './kb-util';

/**
 * 知识图谱与巡检（§10.5 Graph + Lint 操作）：
 * - 子图：实体节点 + mentions/自定义边，可按实体展开 1~2 跳，200 节点截断；
 * - 洞察四类：枢纽（入度 top）、孤儿（无任何边）、矛盾（同一对实体挂多种关系）、
 *   缺失交叉引用（正文 wikilink 指向的实体还没有页）；
 * - Lint：把实时洞察固化成台账行（演进留痕）。
 */

const NODE_CAP = 200;

export class KbGraphService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: KbSpaceService,
  ) {}

  async graph(
    query: { spaceId: number; entityId?: number; depth: number },
    user: CurrentUser,
  ) {
    await this.spaces.loadReadable(query.spaceId, user);
    const relations = await this.prisma.kbRelation.findMany({
      where: { spaceId: query.spaceId },
      take: 4000,
    });
    const keepIds = new Set<number>();
    if (query.entityId) {
      keepIds.add(query.entityId);
      let frontier = new Set<number>([query.entityId]);
      for (let hop = 0; hop < query.depth; hop += 1) {
        const next = new Set<number>();
        for (const rel of relations) {
          if (frontier.has(rel.fromId)) next.add(rel.toId);
          if (frontier.has(rel.toId)) next.add(rel.fromId);
        }
        next.forEach((id) => {
          if (!keepIds.has(id)) keepIds.add(id);
        });
        frontier = next;
        if (keepIds.size >= NODE_CAP) break;
      }
    }
    const involved = relations.filter(
      (rel) =>
        !query.entityId || (keepIds.has(rel.fromId) && keepIds.has(rel.toId)),
    );
    const nodeIds = query.entityId
      ? keepIds
      : new Set(involved.flatMap((rel) => [rel.fromId, rel.toId]));
    if (!query.entityId) {
      // 全图模式：按度数取 top 节点，防大图拖垮前端
      const degree = new Map<number, number>();
      for (const rel of involved) {
        degree.set(rel.fromId, (degree.get(rel.fromId) ?? 0) + 1);
        degree.set(rel.toId, (degree.get(rel.toId) ?? 0) + 1);
      }
      [...degree.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, NODE_CAP)
        .forEach(([id]) => nodeIds.add(id));
    }
    const entities = await this.prisma.kbEntity.findMany({
      where: { spaceId: query.spaceId, id: { in: [...nodeIds] } },
      take: NODE_CAP + 10,
    });
    const pages = await this.prisma.kbPage.findMany({
      where: {
        id: { in: entities.map((e) => e.pageId).filter((id) => id > 0) },
      },
      select: { id: true, slug: true },
    });
    const slugByPage = new Map(pages.map((p) => [p.id, p.slug]));
    const edges = involved.filter(
      (rel) => nodeIds.has(rel.fromId) && nodeIds.has(rel.toId),
    );
    const degreeOf = new Map<number, number>();
    for (const rel of edges) {
      degreeOf.set(rel.fromId, (degreeOf.get(rel.fromId) ?? 0) + 1);
      degreeOf.set(rel.toId, (degreeOf.get(rel.toId) ?? 0) + 1);
    }
    const truncated = entities.length >= NODE_CAP || edges.length >= 4000;
    return {
      nodes: entities.slice(0, NODE_CAP).map((entity) => ({
        id: entity.id,
        name: entity.name,
        type: entity.type,
        pageSlug: entity.pageId ? slugByPage.get(entity.pageId) || '' : '',
        degree: degreeOf.get(entity.id) ?? 0,
      })),
      edges: edges.map((rel) => ({
        from: rel.fromId,
        to: rel.toId,
        relation: rel.relation,
        weight: rel.weight,
      })),
      truncated,
    };
  }

  async insights(spaceId: number, user: CurrentUser) {
    await this.spaces.loadReadable(spaceId, user);
    const [entities, relations, pages] = await Promise.all([
      this.prisma.kbEntity.findMany({ where: { spaceId }, take: 3000 }),
      this.prisma.kbRelation.findMany({ where: { spaceId }, take: 6000 }),
      this.prisma.kbPage.findMany({
        where: { spaceId, status: 'PUBLISHED' },
        select: { id: true, slug: true, title: true, body: true },
        take: 1000,
      }),
    ]);
    const entityById = new Map(entities.map((e) => [e.id, e]));
    const inDegree = new Map<number, number>();
    const touched = new Set<number>();
    const pairRelations = new Map<string, Set<string>>();
    for (const rel of relations) {
      inDegree.set(rel.toId, (inDegree.get(rel.toId) ?? 0) + 1);
      touched.add(rel.fromId);
      touched.add(rel.toId);
      const key = `${rel.fromId}:${rel.toId}`;
      const set = pairRelations.get(key) || new Set<string>();
      set.add(rel.relation);
      pairRelations.set(key, set);
    }
    const hubs = [...inDegree.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, deg]) => ({
        entityId: id,
        name: entityById.get(id)?.name || '',
        inDegree: deg,
      }));
    const orphans = entities
      .filter((e) => !touched.has(e.id))
      .slice(0, 50)
      .map((e) => ({ entityId: e.id, name: e.name, hasPage: e.pageId > 0 }));
    const conflicts: { entity: string; pages: string[]; note: string }[] = [];
    for (const [key, relSet] of pairRelations) {
      if (relSet.size < 2) continue;
      const [fromId, toId] = key.split(':').map(Number);
      const from = entityById.get(fromId);
      const to = entityById.get(toId);
      if (!from || !to) continue;
      const linkedPages = [from, to]
        .map((e) =>
          e.pageId ? pages.find((p) => p.id === e.pageId)?.slug || '' : '',
        )
        .filter(Boolean);
      conflicts.push({
        entity: `${from.name} → ${to.name}`,
        pages: linkedPages,
        note: `同一实体对挂了 ${relSet.size} 种关系（${[...relSet].join('、')}），请人工确认口径`,
      });
      if (conflicts.length >= 20) break;
    }
    const missingRefs: { pageSlug: string; wikilink: string }[] = [];
    const entityByName = new Map(entities.map((e) => [e.name, e]));
    for (const page of pages) {
      for (const link of extractWikilinks(page.body)) {
        const entity = entityByName.get(link);
        if (!entity || entity.pageId === 0) {
          missingRefs.push({ pageSlug: page.slug, wikilink: link });
        }
        if (missingRefs.length >= 100) break;
      }
      if (missingRefs.length >= 100) break;
    }
    const chunkCount = await this.prisma.kbChunk.count({ where: { spaceId } });
    return {
      hubs,
      orphans,
      conflicts,
      missingRefs,
      stats: {
        entities: entities.length,
        relations: relations.length,
        pages: pages.length,
        chunks: chunkCount,
      },
    };
  }

  async lint(spaceId: number, user: CurrentUser) {
    await this.spaces.loadWritable(spaceId, user);
    const found = await this.insights(spaceId, user);
    const summary = [
      `枢纽 ${found.hubs.length}`,
      `孤儿 ${found.orphans.length}`,
      `矛盾 ${found.conflicts.length}`,
      `缺失引用 ${found.missingRefs.length}`,
    ].join(' / ');
    const row = await this.prisma.kbLintRun.create({
      data: {
        spaceId,
        status: 'DONE',
        findings: toJsonInput(found),
        summary,
        createdBy: user.userId,
        finishedAt: new Date(),
      },
    });
    await putLog(
      this.prisma,
      spaceId,
      'LINT',
      `健康巡检：${summary}`,
      {},
      user.userId,
    );
    return lintView(row);
  }

  async lintRuns(
    query: { spaceId: number; page: number; pageSize: number },
    user: CurrentUser,
  ) {
    await this.spaces.loadReadable(query.spaceId, user);
    const where = { spaceId: query.spaceId };
    const [total, rows] = await Promise.all([
      this.prisma.kbLintRun.count({ where }),
      this.prisma.kbLintRun.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: rows.map(lintView),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async indexStats(spaceId: number, user: CurrentUser) {
    await this.spaces.loadReadable(spaceId, user);
    // 首次访问建行：统计口径以实时 count 为准（不依赖写触发才刷新）
    const row = await this.prisma.kbIndex.upsert({
      where: { spaceId },
      create: { spaceId },
      update: {},
    });
    const [pageCount, chunkCount] = await Promise.all([
      this.prisma.kbPage.count({ where: { spaceId } }),
      this.prisma.kbChunk.count({ where: { spaceId } }),
    ]);
    return {
      spaceId,
      model: row.model || 'local-hash-256',
      version: row.version,
      pageCount,
      chunkCount,
      embeddingDim: row.embeddingDim || 256,
      stats: objMap(row.stats),
      statsAt: iso(row.statsAt),
    };
  }

  async logs(
    query: { spaceId: number; page: number; pageSize: number },
    user: CurrentUser,
  ) {
    await this.spaces.loadReadable(query.spaceId, user);
    const where = { spaceId: query.spaceId };
    const [total, rows] = await Promise.all([
      this.prisma.kbLog.count({ where }),
      this.prisma.kbLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: rows.map((row) => ({
        id: row.id,
        spaceId: row.spaceId,
        kind: row.kind,
        summary: row.summary,
        detail: objMap(row.detail),
        actorUserId: row.actorUserId,
        createdAt: iso(row.createdAt),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}

function lintView(row: KbLintRun) {
  return {
    id: row.id,
    spaceId: row.spaceId,
    status: row.status as 'RUNNING' | 'DONE' | 'FAILED',
    findings: objMap(row.findings),
    summary: row.summary,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    finishedAt: iso(row.finishedAt),
  };
}
