import type { CurrentUser } from '../auth/current-user';
import { ErrorCode } from '../common/error-code';
import { BusinessException } from '../common/business.exception';
import type { PrismaService } from '../prisma/prisma.service';
import type { KbPage } from '../../generated/prisma';
import { toJsonInput } from '../common/json-input';
import { chunkText } from './kb-llm';
import { embedForWrite } from './kb-embed';
import { LOCAL_EMBED_DIM, LOCAL_EMBED_ID } from '../ai/retrieval-kernel';
import { KbSpaceService, putLog } from './kb-space.service';
import { excerptOf, iso, normalizeSlug, objMap, strArray } from './kb-util';

/**
 * wiki 页（编译制品层，§10.3）：slug 空间内唯一幂等 upsert；
 * 写页同时联动三件事——wikilink 解析建实体/边（图谱随写随长）、
 * 正文重切块并生成本地向量（检索随写随可用）、索引统计刷新（演进判据快照）。
 * 人在环：status 显式传入（Agent/MCP 通道传 PENDING_REVIEW）；界面作者默认 PUBLISHED。
 */

export interface WritePageInput {
  spaceId: number;
  slug: string;
  type:
    | 'ENTITY'
    | 'CONCEPT'
    | 'SUMMARY'
    | 'COMPARISON'
    | 'SYNTHESIS'
    | 'INDEX'
    | 'LOG';
  title: string;
  body: string;
  frontmatter: Record<string, unknown>;
  status?: 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED';
  sourceIds: number[];
}

const WIKILINK_RE = /\[\[([^\]|#]{1,80})(?:[#|][^\]]*)?\]\]/g;

export function extractWikilinks(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(WIKILINK_RE.source, 'g');
  while ((m = re.exec(String(body ?? ''))) !== null) {
    const name = m[1].trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
    if (out.length >= 40) break;
  }
  return out;
}

export class KbPageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: KbSpaceService,
  ) {}

  async rowView(row: KbPage) {
    const sourceCount = await this.prisma.kbPageSource.count({
      where: { pageId: row.id },
    });
    return {
      id: row.id,
      spaceId: row.spaceId,
      slug: row.slug,
      type: row.type,
      title: row.title,
      status: row.status,
      version: row.version,
      tags: strArray(objMap(row.frontmatter).tags),
      sourceCount,
      excerpt: excerptOf(row.body),
      updatedBy: row.updatedBy,
      updatedAt: iso(row.updatedAt),
    };
  }

  async detailView(row: KbPage) {
    const [pageSources, linkPack] = await Promise.all([
      this.prisma.kbPageSource.findMany({ where: { pageId: row.id } }),
      this.linkViews(row),
    ]);
    const sources = await this.prisma.kbSource.findMany({
      where: { id: { in: pageSources.map((item) => item.sourceId) } },
      select: { id: true, title: true, kind: true },
    });
    return {
      ...(await this.rowView(row)),
      body: row.body,
      frontmatter: objMap(row.frontmatter),
      reviewNote: row.reviewNote,
      sources: sources.map((s) => ({
        id: s.id,
        title: s.title,
        kind: s.kind,
      })),
      outLinks: linkPack.outLinks,
      inLinks: linkPack.inLinks,
      createdAt: iso(row.createdAt),
    };
  }

  /** 出/入链：经由页↔实体锚定（entity.pageId），边=mentions。 */
  private async linkViews(row: KbPage) {
    const self = await this.prisma.kbEntity.findFirst({
      where: { spaceId: row.spaceId, pageId: row.id },
    });
    if (!self) return { outLinks: [] as LinkView[], inLinks: [] as LinkView[] };
    const [out, inc] = await Promise.all([
      this.prisma.kbRelation.findMany({ where: { fromId: self.id } }),
      this.prisma.kbRelation.findMany({ where: { toId: self.id } }),
    ]);
    const entityIds = new Set<number>();
    out.forEach((r) => entityIds.add(r.toId));
    inc.forEach((r) => entityIds.add(r.fromId));
    const entities = await this.prisma.kbEntity.findMany({
      where: { id: { in: [...entityIds] }, pageId: { gt: 0 } },
    });
    const pages = await this.prisma.kbPage.findMany({
      where: { id: { in: entities.map((e) => e.pageId) } },
      select: { id: true, slug: true, title: true },
    });
    const byPageId = new Map(pages.map((p) => [p.id, p]));
    const resolve = (entityId: number): LinkView | null => {
      const entity = entities.find((e) => e.id === entityId);
      const page = entity ? byPageId.get(entity.pageId) : undefined;
      return page ? { slug: page.slug, title: page.title } : null;
    };
    const dedupe = (list: LinkView[]) => {
      const seen = new Set<string>();
      return list.filter(
        (item) => !seen.has(item.slug) && Boolean(seen.add(item.slug)),
      );
    };
    return {
      outLinks: dedupe(
        out.map((r) => resolve(r.toId)).filter(Boolean) as LinkView[],
      ),
      inLinks: dedupe(
        inc.map((r) => resolve(r.fromId)).filter(Boolean) as LinkView[],
      ),
    };
  }

  async listPages(
    query: {
      spaceId: number;
      page: number;
      pageSize: number;
      type?: string;
      status?: string;
      q?: string;
    },
    user: CurrentUser,
  ) {
    await this.spaces.loadReadable(query.spaceId, user);
    const where = {
      spaceId: query.spaceId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q } },
              { slug: { contains: normalizeSlug(query.q) } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.kbPage.count({ where }),
      this.prisma.kbPage.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: await Promise.all(rows.map((row) => this.rowView(row))),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async readPage(id: number, user: CurrentUser) {
    const row = await this.loadReadablePage(id, user);
    return this.detailView(row);
  }

  async loadReadablePage(id: number, user: CurrentUser): Promise<KbPage> {
    const row = await this.prisma.kbPage.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '页面不存在');
    await this.spaces.loadReadable(row.spaceId, user);
    return row;
  }

  async writePage(body: WritePageInput, user: CurrentUser) {
    const space = await this.spaces.loadWritable(body.spaceId, user);
    const slug = normalizeSlug(body.slug);
    if (!body.title.trim()) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '标题不能为空');
    }
    const existing = await this.prisma.kbPage.findUnique({
      where: { spaceId_slug: { spaceId: space.id, slug } },
    });
    const status = body.status ?? 'PUBLISHED';
    const frontmatter = { ...body.frontmatter };
    const row = existing
      ? await this.prisma.kbPage.update({
          where: { id: existing.id },
          data: {
            type: body.type,
            title: body.title.trim().slice(0, 200),
            body: body.body,
            frontmatter: toJsonInput(frontmatter),
            status,
            version: { increment: 1 },
            updatedBy: user.userId,
          },
        })
      : await this.prisma.kbPage.create({
          data: {
            spaceId: space.id,
            slug,
            type: body.type,
            title: body.title.trim().slice(0, 200),
            body: body.body,
            frontmatter: toJsonInput(frontmatter),
            status,
            updatedBy: user.userId,
          },
        });

    // 溯源边：只允许同空间源，逐个核（防跨空间引源）
    if (body.sourceIds.length) {
      const valid = await this.prisma.kbSource.count({
        where: { id: { in: body.sourceIds }, spaceId: space.id },
      });
      if (valid !== new Set(body.sourceIds).size) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          'sourceIds 含本空间之外的资料',
        );
      }
      await this.prisma.kbPageSource.deleteMany({ where: { pageId: row.id } });
      await this.prisma.kbPageSource.createMany({
        data: body.sourceIds
          .filter((v, i, a) => a.indexOf(v) === i)
          .map((sourceId) => ({ pageId: row.id, sourceId })),
        skipDuplicates: true,
      });
    } else {
      await this.prisma.kbPageSource.deleteMany({ where: { pageId: row.id } });
    }

    await this.syncGraph(space.id, row);
    await this.reindexChunks(space.id, row, user.userId, space.visibility);
    await putLog(
      this.prisma,
      space.id,
      'WRITE',
      `${existing ? '更新' : '新建'}页「${row.title}」（${status}）`,
      { pageId: row.id, slug: row.slug },
      user.userId,
    );
    return this.detailView(row);
  }

  /** wikilink → 实体与边；页自身也锚定实体（图谱节点=实体，挂页可跳转）。 */
  async syncGraph(spaceId: number, page: KbPage) {
    const self = await this.upsertEntity(spaceId, page.title, {
      type: strArray(objMap(page.frontmatter).entityType)[0] || 'CONCEPT',
      pageId: page.id,
    });
    if (self.pageId !== page.id) {
      await this.prisma.kbEntity.update({
        where: { id: self.id },
        data: { pageId: page.id },
      });
    }
    const links = extractWikilinks(page.body).filter(
      (name) => normalizeSlug(name) !== normalizeSlug(page.title),
    );
    for (const name of links) {
      const target = await this.upsertEntity(spaceId, name, {});
      // wikilink 目标若已有同名/slug 页，回填锚点
      if (!target.pageId) {
        const hit = await this.prisma.kbPage.findFirst({
          where: { spaceId, title: name },
          select: { id: true },
        });
        if (hit) {
          await this.prisma.kbEntity.update({
            where: { id: target.id },
            data: { pageId: hit.id },
          });
        }
      }
      if (target.id === self.id) continue;
      await this.prisma.kbRelation.upsert({
        where: {
          fromId_toId_relation: {
            fromId: self.id,
            toId: target.id,
            relation: 'mentions',
          },
        },
        create: {
          spaceId,
          fromId: self.id,
          toId: target.id,
          relation: 'mentions',
          sourcePageId: page.id,
        },
        update: { sourcePageId: page.id },
      });
    }
    return self;
  }

  private async upsertEntity(
    spaceId: number,
    name: string,
    init: { type?: string; pageId?: number },
  ) {
    const clean = name.trim().slice(0, 120);
    return this.prisma.kbEntity.upsert({
      where: { spaceId_name: { spaceId, name: clean } },
      create: {
        spaceId,
        name: clean,
        type: init.type || 'CONCEPT',
        pageId: init.pageId ?? 0,
      },
      update: init.pageId ? { pageId: init.pageId } : {},
    });
  }

  /** 正文重切块（向量随写随建，真实向量优先、失败回落本地袋装）+ 索引统计刷新。 */
  async reindexChunks(
    spaceId: number,
    page: KbPage,
    userId = '',
    visibility = '',
  ) {
    await this.prisma.kbChunk.deleteMany({ where: { pageId: page.id } });
    const pieces = chunkText(`${page.title}\n${page.body}`);
    const embed = await embedForWrite(this.prisma, userId, pieces);
    if (pieces.length) {
      // 块元数据（权限/溯源标签）：检索侧可据 type/tags/visibility 过滤
      const meta = {
        type: page.type,
        tags: strArray(
          (page.frontmatter as Record<string, unknown> | null)?.tags,
        ).slice(0, 20),
        visibility,
      };
      await this.prisma.kbChunk.createMany({
        data: pieces.map((text, ordinal) => ({
          spaceId,
          pageId: page.id,
          ordinal,
          text,
          tokens: Math.ceil(text.length / 2),
          embedding: toJsonInput(embed.vectors[ordinal] || []),
          model: embed.model,
          meta: toJsonInput(meta),
        })),
      });
    }
    await this.refreshIndex(spaceId, {
      model: embed.model,
      dim: embed.vectors[0]?.length || 0,
    });
    return pieces.length;
  }

  /** 向量重算（P1-A）：按当前 embedding 槽位重算空间内全部分块（换模型后的存量回填）。 */
  async reembedSpace(spaceId: number, user: CurrentUser) {
    const space = await this.spaces.loadWritable(spaceId, user);
    const pages = await this.prisma.kbPage.findMany({
      where: { spaceId },
      orderBy: { id: 'asc' },
      take: 5000,
    });
    let chunks = 0;
    for (const page of pages) {
      chunks += await this.reindexChunks(
        space.id,
        page,
        user.userId,
        space.visibility,
      );
    }
    const index = await this.prisma.kbIndex.findUnique({ where: { spaceId } });
    await putLog(
      this.prisma,
      space.id,
      'INGEST',
      `向量重算：${pages.length} 页 / ${chunks} 分块（${index?.model || LOCAL_EMBED_ID}）`,
      { pages: pages.length, chunks },
      user.userId,
    );
    return {
      spaceId,
      pages: pages.length,
      chunks,
      model: index?.model || LOCAL_EMBED_ID,
    };
  }

  async refreshIndex(spaceId: number, embed?: { model: string; dim: number }) {
    const [pageCount, chunkCount] = await Promise.all([
      this.prisma.kbPage.count({ where: { spaceId } }),
      this.prisma.kbChunk.count({ where: { spaceId } }),
    ]);
    const existing = await this.prisma.kbIndex.findUnique({
      where: { spaceId },
    });
    await this.prisma.kbIndex.upsert({
      where: { spaceId },
      create: {
        spaceId,
        model: embed?.model || LOCAL_EMBED_ID,
        version: 1,
        pageCount,
        chunkCount,
        embeddingDim: embed?.dim || LOCAL_EMBED_DIM,
        stats: toJsonInput({ lastWriteAt: new Date().toISOString() }),
        statsAt: new Date(),
      },
      update: {
        pageCount,
        chunkCount,
        ...(embed ? { model: embed.model, embeddingDim: embed.dim } : {}),
        version: (existing?.version ?? 0) + 1,
        stats: toJsonInput({
          ...objMap(existing?.stats),
          lastWriteAt: new Date().toISOString(),
        }),
        statsAt: new Date(),
      },
    });
  }

  async reviewPage(
    body: { id: number; decision: 'publish' | 'reject'; note: string },
    user: CurrentUser,
  ) {
    const page = await this.prisma.kbPage.findUnique({
      where: { id: body.id },
    });
    if (!page) throw new BusinessException(ErrorCode.NOT_FOUND, '页面不存在');
    await this.spaces.loadWritable(page.spaceId, user);
    if (page.status !== 'PENDING_REVIEW') {
      throw new BusinessException(ErrorCode.CONFLICT, '该页不在待审状态');
    }
    const row = await this.prisma.kbPage.update({
      where: { id: page.id },
      data: {
        status: body.decision === 'publish' ? 'PUBLISHED' : 'DRAFT',
        reviewNote: body.note.slice(0, 500),
        updatedBy: user.userId,
      },
    });
    await putLog(
      this.prisma,
      page.spaceId,
      'REVIEW',
      `${body.decision === 'publish' ? '放行' : '驳回'}页「${row.title}」`,
      { pageId: row.id, note: body.note },
      user.userId,
    );
    return this.rowView(row);
  }

  async deletePage(id: number, user: CurrentUser) {
    const page = await this.prisma.kbPage.findUnique({ where: { id } });
    if (!page) return { deleted: 0 };
    await this.spaces.loadWritable(page.spaceId, user);
    await this.prisma.kbPage.delete({ where: { id } });
    await this.prisma.kbChunk.deleteMany({ where: { pageId: id } });
    await this.prisma.kbPageSource.deleteMany({ where: { pageId: id } });
    // 实体保留（图上仍是合法节点），只断开页锚点
    await this.prisma.kbEntity.updateMany({
      where: { pageId: id },
      data: { pageId: 0 },
    });
    await this.refreshIndex(page.spaceId);
    await putLog(
      this.prisma,
      page.spaceId,
      'WRITE',
      `删除页「${page.title}」`,
      { slug: page.slug },
      user.userId,
    );
    return { deleted: 1 };
  }
}

type LinkView = { slug: string; title: string };
