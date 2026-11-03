import { text } from '../common/api';
import { stripInvisible } from '../common/text-safety';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';

const MEMORY_STORE_MAX_CHARS = 64000;
const MEMORY_PROMPT_MAX_CHARS = 16000;
const MEMORY_LINE_MAX = 500;

function normalize(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 200);
}

/**
 * Agent 长期记忆：一条一句话存在 content_agent_memories（按账号唯一去重）。
 * 与「操作记忆」（agent_memory_events，路由级中间件自动记录）是两份数据：
 * 这一份由模型 save_memory 或用户在「记忆」页写入，用于注入系统提示。
 */
export class ContentAgentMemoryService {
  constructor(private readonly prisma: PrismaService) {}

  private async rows(userId: string) {
    return this.prisma.contentAgentMemory.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
    });
  }

  private shape(
    rows: {
      id: number;
      kind: string;
      content: string;
      source: string;
      createdAt: Date;
    }[],
  ) {
    return {
      block: rows.map((row) => `- ${row.content}`).join('\n'),
      entries: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        content: row.content,
        source: row.source,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async list(user: CurrentUser) {
    return this.shape(await this.rows(user.userId));
  }

  /** 模型工具调用路径：规范化后已存在则跳过，避免反复记同一条。 */
  async append(user: CurrentUser, note: string) {
    const content = stripInvisible(text(note))
      .replace(/\r?\n/g, ' ')
      .trim()
      .slice(0, MEMORY_LINE_MAX);
    if (!content) return { added: false, content: '' };
    const normalized = normalize(content);
    const existing = await this.prisma.contentAgentMemory.findUnique({
      where: { userId_normalized: { userId: user.userId, normalized } },
    });
    if (existing) return { added: false, content };
    await this.prisma.contentAgentMemory.create({
      data: {
        userId: user.userId,
        kind: 'fact',
        content,
        normalized,
        source: 'agent',
      },
    });
    return { added: true, content };
  }

  /** 用户在「记忆」页整段编辑：按行重建，来源统一记为 user。 */
  async replace(user: CurrentUser, body: unknown) {
    const raw = text(body).slice(0, MEMORY_STORE_MAX_CHARS);
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*-\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 200)
      .map((line) => line.slice(0, MEMORY_LINE_MAX));
    const unique = new Map<string, string>();
    for (const line of lines) unique.set(normalize(line), line);
    await this.prisma.$transaction([
      this.prisma.contentAgentMemory.deleteMany({
        where: { userId: user.userId },
      }),
      ...(unique.size
        ? [
            this.prisma.contentAgentMemory.createMany({
              data: Array.from(unique.entries()).map(
                ([normalized, content]) => ({
                  userId: user.userId,
                  kind: 'fact',
                  content,
                  normalized,
                  source: 'user',
                }),
              ),
            }),
          ]
        : []),
    ]);
    return this.list(user);
  }

  /** 注入提示词：按尾部截断（越靠后越新）。 */
  async promptBlock(userId: string) {
    const rows = await this.prisma.contentAgentMemory.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
      select: { content: true },
    });
    const block = this.shape(
      rows.map((row, index) => ({
        id: index,
        kind: 'fact',
        // 存量记忆也清一遍不可见字符：这份内容每轮都进系统提示
        content: stripInvisible(row.content),
        source: 'agent',
        createdAt: new Date(),
      })),
    ).block;
    return block.length > MEMORY_PROMPT_MAX_CHARS
      ? block.slice(-MEMORY_PROMPT_MAX_CHARS)
      : block;
  }

  /** 最近操作摘要（只读 agent_memory_events）：给「你最近做过什么」提供上下文。 */
  async recentOperations(userId: string, take = 15) {
    const rows = await this.prisma.agentMemoryEvent.findMany({
      where: { userId },
      orderBy: { occurredAt: 'desc' },
      take,
      select: {
        action: true,
        targetLabel: true,
        outcome: true,
        occurredAt: true,
      },
    });
    return rows
      .map((row) => {
        const when = row.occurredAt
          .toISOString()
          .slice(0, 16)
          .replace('T', ' ');
        const target = row.targetLabel ? `（${row.targetLabel}）` : '';
        const outcome = row.outcome === 'ok' ? '' : ` [${row.outcome}]`;
        return `- ${when} ${row.action}${target}${outcome}`;
      })
      .join('\n');
  }
}
