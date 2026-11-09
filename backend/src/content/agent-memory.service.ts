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

function personaOf(raw: unknown) {
  const value = Number(raw ?? 0);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export type AgentMemoryEntry = {
  id: number;
  personaId: number;
  kind: string;
  content: string;
  source: string;
  createdAt: string;
};

/** 长期记忆的存储口：由知识库实现（智能记忆库空间里的记忆页），见 KbAgentStoreService。 */
export type AgentMemoryStore = {
  readMemoryEntries(
    userId: string,
    personaId: number,
  ): Promise<AgentMemoryEntry[]>;
  memoryBlock(userId: string, personaId: number): Promise<string>;
  replaceMemory(
    user: CurrentUser,
    personaId: number,
    lines: string[],
  ): Promise<AgentMemoryEntry[]>;
  removeMemory(user: CurrentUser, personaId: number): Promise<void>;
};

/**
 * Agent 长期记忆：一层翻译——正文住在知识库「智能记忆库」里的记忆页
 * （账号共用 personaId=0 一页、每个数字分身各一页），因此记忆天然可检索、带版本。
 * personaId=0 的账号共用记忆所有分身都注入；>0 只属于该数字分身。
 * 与「操作记忆」（agent_memory_events，路由级中间件自动记录）是两份数据。
 */
export class ContentAgentMemoryService {
  /** services 装配时注入：知识库服务晚于本服务构造，故用设置口而不是构造参数。 */
  store?: AgentMemoryStore;

  constructor(private readonly prisma: PrismaService) {}

  private memory() {
    if (!this.store) throw new Error('长期记忆存储未装配');
    return this.store;
  }

  private shape(entries: AgentMemoryEntry[]) {
    return {
      block: entries.map((row) => `- ${row.content}`).join('\n'),
      entries,
    };
  }

  async list(user: CurrentUser, rawPersonaId?: unknown) {
    const entries = await this.memory().readMemoryEntries(
      user.userId,
      personaOf(rawPersonaId),
    );
    return this.shape(entries);
  }

  /** 模型工具调用路径：规范化后已存在则跳过，避免反复记同一条。 */
  async append(user: CurrentUser, note: string, rawPersonaId?: unknown) {
    const personaId = personaOf(rawPersonaId);
    const content = stripInvisible(text(note))
      .replace(/\r?\n/g, ' ')
      .trim()
      .slice(0, MEMORY_LINE_MAX);
    if (!content) return { added: false, content: '' };
    const normalized = normalize(content);
    const existing = await this.memory().readMemoryEntries(
      user.userId,
      personaId,
    );
    if (existing.some((row) => normalize(row.content) === normalized)) {
      return { added: false, content };
    }
    await this.memory().replaceMemory(user, personaId, [
      ...existing.map((row) => row.content),
      content,
    ]);
    return { added: true, content };
  }

  /** 用户在「记忆」页整段编辑：只重建当前作用域（共用或某个分身）的那一页。 */
  async replace(user: CurrentUser, body: Record<string, unknown>) {
    const personaId = personaOf(body.personaId);
    const raw = text(body.content).slice(0, MEMORY_STORE_MAX_CHARS);
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*-\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 200)
      .map((line) => line.slice(0, MEMORY_LINE_MAX));
    const unique = new Map<string, string>();
    for (const line of lines) unique.set(normalize(line), line);
    const entries = await this.memory().replaceMemory(
      user,
      personaId,
      Array.from(unique.values()),
    );
    return this.shape(entries);
  }

  /** 注入提示词：共用记忆永远注入，指定分身时再叠加它自己的记忆。 */
  async promptBlock(userId: string, rawPersonaId?: unknown) {
    const block = await this.memory().memoryBlock(
      userId,
      personaOf(rawPersonaId),
    );
    return block.length > MEMORY_PROMPT_MAX_CHARS
      ? block.slice(-MEMORY_PROMPT_MAX_CHARS)
      : block;
  }

  /** 数字分身被删除时清掉它私有的那一页记忆（共用记忆 personaId=0 不动）。 */
  async clear(user: CurrentUser, rawPersonaId?: unknown) {
    await this.memory().removeMemory(user, personaOf(rawPersonaId));
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
