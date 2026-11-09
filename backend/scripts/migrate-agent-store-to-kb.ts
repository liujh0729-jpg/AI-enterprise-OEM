/**
 * 一次性迁移：把 Agent 侧旧表里的「资料库 / 长期记忆 / 待确认改写」搬进知识库（§10.4 整合）。
 *
 * 迁移后 Agent 一律读知识库，旧表不再被任何代码读取；源表保留不动（不删数据），
 * 确认无误后可另行清理。脚本按「已存在就跳过」处理，可安全重复执行：
 * - 资料：content_agent_library_items → AGENT 空间的 KbSource（同内容 hash 天然去重）+ 摄取编译；
 *   旧片段表 content_agent_library_nodes 不再搬（知识库按自己的切块重新编译）；
 * - 长期记忆：content_agent_memories（按 personaId 分组）→ 对应记忆页（已存在则不覆盖，
 *   避免把迁移后新写的记忆冲掉）；
 * - 待确认改写：content_agent_library_drafts(pending) → PENDING_REVIEW 页。
 *
 * 用法：pnpm --filter aiworkin-enterprise-api kb:migrate-agent
 */
import { config } from 'dotenv';
config({
  path: new URL('../.env', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'),
});
import { CurrentUser } from '../src/auth/current-user';
import type { IdentityService } from '../src/identity/identity.service';
import type { AiEvalService } from '../src/ai/ai-eval.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { KbIngestService } from '../src/kb/kb-ingest.service';
import { KbPageService } from '../src/kb/kb-page.service';
import { KbSearchService } from '../src/kb/kb-search.service';
import { KbSourceService } from '../src/kb/kb-source.service';
import { KbSpaceService } from '../src/kb/kb-space.service';
import { KbAgentStoreService } from '../src/kb/kb-agent-store.service';
import { stub } from '../test/doubles';

// 迁移不该产生审计/计费副作用：这两处只用于「是不是平台管理员」与「按量扣费」
const identityStub = stub<IdentityService>({
  isPlatformAdmin: () => false,
});
const aiEvalStub = stub<AiEvalService>({
  chargeByUsage: async () => 0,
});

async function main() {
  const prisma = new PrismaService();
  const spaces = new KbSpaceService(prisma, identityStub);
  const sources = new KbSourceService(prisma, spaces);
  const pages = new KbPageService(prisma, spaces);
  const ingest = new KbIngestService(prisma, spaces, sources, pages, aiEvalStub);
  const search = new KbSearchService(prisma, spaces, pages, aiEvalStub);
  const store = new KbAgentStoreService(
    prisma,
    spaces,
    pages,
    sources,
    ingest,
    search,
  );

  try {
    const [items, memories, drafts] = await Promise.all([
      prisma.contentAgentLibraryItem.findMany({ orderBy: { id: 'asc' } }),
      prisma.contentAgentMemory.findMany({ orderBy: { id: 'asc' } }),
      prisma.contentAgentLibraryDraft.findMany({
        where: { status: 'pending' },
        orderBy: { id: 'asc' },
      }),
    ]);
    const userIds = [
      ...new Set([
        ...items.map((row) => row.userId),
        ...memories.map((row) => row.userId),
        ...drafts.map((row) => row.userId),
      ]),
    ];
    if (!userIds.length) {
      console.log('没有需要迁移的 Agent 旧数据。');
      return;
    }

    for (const userId of userIds) {
      const user = new CurrentUser(userId, '', '');
      const space = await spaces.ensureAgentSpace(userId);
      const stats = { docs: 0, skippedDocs: 0, memories: 0, drafts: 0 };

      // 1) 资料：旧条目 → KbSource + 摄取编译
      const itemById = new Map<number, number>();
      for (const item of items.filter((row) => row.userId === userId)) {
        const asset = item.aipddAssetId
          ? await prisma.digitalAssetEntry.findFirst({
              where: { userId, aipddAssetId: item.aipddAssetId },
              select: { id: true },
            })
          : null;
        const source = await sources.putExtracted(
          {
            spaceId: space.id,
            kind: 'article',
            type: 'UPLOAD',
            title: item.name || '未命名资料',
            text: item.text,
            assetId: asset?.id || 0,
            originUrl: item.url,
            errorNote: item.note || undefined,
          },
          user,
        );
        if (source.status === 'PENDING') {
          await ingest.ingest({ spaceId: space.id, sourceId: source.id }, user);
        }
        itemById.set(item.id, source.id);
        stats.docs += 1;
      }

      // 2) 长期记忆：按 personaId 分组，落到对应记忆页（已存在则不覆盖）
      const personaIds = [
        ...new Set(
          memories
            .filter((row) => row.userId === userId)
            .map((row) => row.personaId),
        ),
      ];
      for (const personaId of personaIds) {
        const existing = await store.readMemoryEntries(userId, personaId);
        if (existing.length) continue;
        const lines = memories
          .filter((row) => row.userId === userId && row.personaId === personaId)
          .map((row) => row.content.trim())
          .filter(Boolean);
        if (!lines.length) continue;
        await store.replaceMemory(user, personaId, lines);
        stats.memories += lines.length;
      }

      // 3) 待确认改写 → PENDING_REVIEW 页
      for (const draft of drafts.filter((row) => row.userId === userId)) {
        const sourceId = itemById.get(draft.itemId) || 0;
        const item = items.find((row) => row.id === draft.itemId);
        await pages.writePage(
          {
            spaceId: space.id,
            slug: `migrated-draft-${draft.id}`,
            type: 'SUMMARY',
            title: `${item?.name || `资料 #${draft.itemId}`} · 改写`,
            body: draft.after,
            frontmatter: {
              tags: ['agent-edit', 'migrated'],
              sourceId,
              reason: draft.reason,
            },
            status: 'PENDING_REVIEW',
            sourceIds: sourceId ? [sourceId] : [],
          },
          user,
        );
        stats.drafts += 1;
      }

      console.log(
        `账号 ${userId}：资料 ${stats.docs} 份、长期记忆 ${stats.memories} 条、待审改写 ${stats.drafts} 条 → 空间 #${space.id}`,
      );
    }
    console.log('迁移完成；旧表保留未删，确认无误后可另行清理。');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
