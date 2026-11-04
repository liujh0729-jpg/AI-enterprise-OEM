import { PrismaService } from '../prisma/prisma.service';

/**
 * 技能 / 插件的历史版本快照：
 * 包内容由第三方（上传的 zip、SkillHub 目录）提供，同名重传会整条覆盖旧内容。
 * 覆盖前把旧版本存一份，用户能查「它原来长什么样」，也能一键回滚——
 * 否则恶意包只要同名覆盖一次，痕迹就永久没了。
 */
export type AgentAssetKind = 'skill' | 'plugin';

/** 每个条目最多留多少条历史：只防「静默替换后无法追溯」，不当网盘用。 */
const REVISION_KEEP = 10;
/** 快照里 files 的条数与单文件字数上限，和技能/插件包本身同一口径。 */
const REVISION_FILES_MAX = 60;
const REVISION_FILE_CHARS_MAX = 20000;

export type RevisionSnapshot = {
  description: string;
  content: string;
  files: unknown;
  source: string;
};

/** 快照里的包内文件：形状与 readZipTextFiles 一致，超长一律截断。 */
function filesOf(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is { path: string; content: string } =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as { path?: unknown }).path === 'string' &&
        typeof (item as { content?: unknown }).content === 'string',
    )
    .slice(0, REVISION_FILES_MAX)
    .map((item) => ({
      path: item.path.slice(0, 200),
      content: item.content.slice(0, REVISION_FILE_CHARS_MAX),
    }));
}

/** 写一条快照，并把超出保留条数的旧快照删掉。 */
export async function saveAgentRevision(
  prisma: PrismaService,
  input: {
    userId: string;
    kind: AgentAssetKind;
    itemId: number;
    name: string;
    snapshot: RevisionSnapshot;
  },
) {
  await prisma.contentAgentRevision.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      itemId: input.itemId,
      name: input.name,
      description: input.snapshot.description.slice(0, 200),
      content: input.snapshot.content,
      files: filesOf(input.snapshot.files) as never,
      source: input.snapshot.source.slice(0, 16),
    },
  });
  const stale = await prisma.contentAgentRevision.findMany({
    where: { userId: input.userId, kind: input.kind, itemId: input.itemId },
    orderBy: { id: 'desc' },
    skip: REVISION_KEEP,
    select: { id: true },
  });
  if (stale.length) {
    await prisma.contentAgentRevision.deleteMany({
      where: { id: { in: stale.map((row) => row.id) } },
    });
  }
}

/** 列表口径：不带正文，只给时间、来源、说明与包内文件数，够界面展示「哪一版换过什么」。 */
export async function listAgentRevisions(
  prisma: PrismaService,
  input: { userId: string; kind: AgentAssetKind; itemId: number },
) {
  const rows = await prisma.contentAgentRevision.findMany({
    where: { userId: input.userId, kind: input.kind, itemId: input.itemId },
    orderBy: { id: 'desc' },
    take: REVISION_KEEP,
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    source: row.source,
    fileCount: filesOf(row.files).length,
    chars: row.content.length,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** 取回滚要用的完整快照：只认本账号本条目，越界查不到。 */
export async function readAgentRevision(
  prisma: PrismaService,
  input: { userId: string; kind: AgentAssetKind; itemId: number; id: number },
) {
  const row = await prisma.contentAgentRevision.findFirst({
    where: {
      userId: input.userId,
      kind: input.kind,
      itemId: input.itemId,
      id: input.id,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    description: row.description,
    content: row.content,
    files: filesOf(row.files),
    source: row.source,
    createdAt: row.createdAt.toISOString(),
  };
}
