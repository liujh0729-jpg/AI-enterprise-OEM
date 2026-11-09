import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import {
  ContentAgentMemoryService,
  type AgentMemoryEntry,
  type AgentMemoryStore,
} from './agent-memory.service';
import { stub } from '../../test/doubles';

/**
 * 长期记忆现在住在知识库（记忆页），本服务只做作用域翻译：
 * 0＝账号共用（所有分身注入），>0＝只属于该分身。
 * 读/写都必须只落在当前作用域，避免改一个分身的记忆把共用记忆冲掉。
 */

const user = stub<CurrentUser>({ userId: 'u1', username: '测试用户' });

type Row = AgentMemoryEntry;

function buildService() {
  const db = new Map<number, Row[]>();
  const reads: number[] = [];
  const writes: { personaId: number; lines: string[] }[] = [];
  let seq = 0;
  const store: AgentMemoryStore = {
    readMemoryEntries: async (_userId: string, personaId: number) => {
      reads.push(personaId);
      return (db.get(personaId) || []).map((row) => ({ ...row }));
    },
    memoryBlock: async (_userId: string, personaId: number) => {
      reads.push(personaId);
      const lines = [
        ...(db.get(0) || []),
        ...(personaId > 0 ? db.get(personaId) || [] : []),
      ].map((row) => `- ${row.content}`);
      return lines.join('\n');
    },
    replaceMemory: async (
      _user: CurrentUser,
      personaId: number,
      lines: string[],
    ) => {
      writes.push({ personaId, lines });
      const rows = lines.map<Row>((content) => ({
        id: ++seq,
        personaId,
        kind: 'fact',
        content,
        source: 'store',
        createdAt: '2026-01-01T00:00:00.000Z',
      }));
      db.set(personaId, rows);
      return rows;
    },
    removeMemory: async (_user: CurrentUser, personaId: number) => {
      db.delete(personaId);
    },
  };
  const service = new ContentAgentMemoryService({} as PrismaService);
  service.store = store;
  return { service, db, reads, writes };
}

describe('ContentAgentMemoryService 分身记忆隔离', () => {
  it('不指定分身只读共用记忆', async () => {
    const { service, reads } = buildService();
    await service.list(user);
    expect(reads).toEqual([0]);
  });

  it('指定分身时读到的是该分身那一页', async () => {
    const { service, reads } = buildService();
    await service.list(user, 7);
    expect(reads).toEqual([7]);
  });

  it('工具写入规范化后已存在就跳过，不再重复记', async () => {
    const { service, db, writes } = buildService();
    db.set(7, [
      {
        id: 1,
        personaId: 7,
        kind: 'fact',
        content: '客户偏好微信沟通',
        source: 'store',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const result = await service.append(user, '  客户偏好微信沟通  ', 7);
    expect(result.added).toBe(false);
    expect(writes).toEqual([]);
  });

  it('工具写入按作用域落到对应分身', async () => {
    const { service, writes } = buildService();
    const result = await service.append(user, '  新客户要中文  ', 7);
    expect(result).toEqual({ added: true, content: '新客户要中文' });
    expect(writes).toEqual([{ personaId: 7, lines: ['新客户要中文'] }]);
  });

  it('整段编辑只重建当前作用域，并去掉重复行', async () => {
    const { service, db, writes } = buildService();
    await service.replace(user, {
      personaId: 9,
      content: '- 只回复要点\n- 用中文\n- 只回复要点',
    });
    expect(writes).toEqual([{ personaId: 9, lines: ['只回复要点', '用中文'] }]);
    expect(db.has(0)).toBe(false);
  });

  it('整段编辑清空时只清空当前作用域', async () => {
    const { service, writes } = buildService();
    await service.replace(user, { personaId: 0, content: '   ' });
    expect(writes).toEqual([{ personaId: 0, lines: [] }]);
  });

  it('注入提示词：账号共用只取共用页，选分身时叠加该分身', async () => {
    const { service, db, reads } = buildService();
    db.set(0, [
      {
        id: 1,
        personaId: 0,
        kind: 'fact',
        content: '公司统一口径',
        source: 'store',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    db.set(3, [
      {
        id: 2,
        personaId: 3,
        kind: 'fact',
        content: '分身专属口径',
        source: 'store',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    expect(await service.promptBlock('u1', 3)).toBe(
      '- 公司统一口径\n- 分身专属口径',
    );
    expect(reads).toEqual([3]);
  });

  it('注入提示词超长时截取尾部，长度不超过上限', async () => {
    const { service, db } = buildService();
    db.set(0, [
      {
        id: 1,
        personaId: 0,
        kind: 'fact',
        content: 'x'.repeat(20000),
        source: 'store',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const block = await service.promptBlock('u1');
    expect(block.length).toBe(16000);
  });
});
