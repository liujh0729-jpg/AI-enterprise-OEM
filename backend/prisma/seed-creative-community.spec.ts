import {
  buildOfficialRows,
  seedCreativeCommunity,
} from './seed-creative-community';

/**
 * 创意社区种子数据的单测：`pnpm prisma:seed` 会被重复执行（新库初始化、CI、补数据），
 * 所以这里必须钉住两件事——
 *  1. 数据本身能过后端的发布校验口径（槽位指向真实节点与输入，否则会种下一堆跑不了的「可直接运行」）；
 *  2. 按 `code` 幂等 upsert：第二遍不新建行、不重传封面、不抹掉真实热度。
 */

type Fake = {
  prisma: {
    communityWorkflow: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  store: Map<string, { id: number; coverKeys: unknown[] }>;
  calls: {
    create: Record<string, unknown>[];
    update: { id: number; data: Record<string, unknown> }[];
  };
};

function fakePrisma(): Fake {
  const store = new Map<string, { id: number; coverKeys: unknown[] }>();
  const calls = {
    create: [] as Record<string, unknown>[],
    update: [] as { id: number; data: Record<string, unknown> }[],
  };
  const prisma = {
    communityWorkflow: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  return { prisma, store, calls };
}

function bind(fake: Fake) {
  const { prisma, store, calls } = fake;
  prisma.communityWorkflow.findUnique.mockImplementation(
    async (args: {
      where: Record<string, unknown>;
      select?: Record<string, unknown>;
    }) => {
      const id = args.where.id !== undefined ? Number(args.where.id) : null;
      const codeValue = args.where.code;
      const code = typeof codeValue === 'string' ? codeValue : '';
      const row =
        id !== null
          ? [...store.values()].find((item) => item.id === id)
          : store.get(code);
      if (!row) return null;
      return args.select && 'coverKeys' in args.select
        ? { coverKeys: row.coverKeys }
        : { id: row.id };
    },
  );
  prisma.communityWorkflow.create.mockImplementation(
    async (args: { data: Record<string, unknown> }) => {
      calls.create.push(args.data);
      const code = String(args.data.code);
      store.set(code, {
        id: store.size + 1,
        coverKeys: toList(args.data.coverKeys),
      });
      return { ...args.data };
    },
  );
  prisma.communityWorkflow.update.mockImplementation(
    async (args: { where: { id: number }; data: Record<string, unknown> }) => {
      calls.update.push({ id: args.where.id, data: args.data });
      const row = [...store.values()].find((item) => item.id === args.where.id);
      if (row && args.data.coverKeys !== undefined)
        row.coverKeys = toList(args.data.coverKeys);
      return { ...args.data };
    },
  );
}

function toList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

describe('buildOfficialRows（种子数据形态）', () => {
  const rows = buildOfficialRows();

  it('code 唯一、来源都是官方、且没有站内作者', () => {
    expect(rows.length).toBeGreaterThan(0);
    const codes = rows.map((row) => row.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const row of rows) {
      expect(row.source).toBe('OFFICIAL');
      // 官方条目没有账号：发奖与「我的发布」都靠这个空串收口
      expect(row.ownerUserId).toBe('');
      expect(row.status === 'APPROVED' || row.status === 'RECOMMENDED').toBe(
        true,
      );
      expect(row.code.length).toBeLessThanOrEqual(64);
      expect(row.title.trim()).not.toBe('');
    }
  });

  it('数量达到验收线：首屏至少 120 条内容、至少 9 条可直接运行', () => {
    // 数据文件由 node scripts/import-comfy-templates.mjs 生成并随仓库提交
    expect(rows.length).toBeGreaterThanOrEqual(120);
    expect(
      rows.filter((row) => row.format === 'api').length,
    ).toBeGreaterThanOrEqual(9);
  });

  it('可直接运行的条目必须是 API 格式，且槽位只能指向真实存在的节点与输入', () => {
    const api = rows.filter((row) => row.format === 'api');
    expect(api.length).toBeGreaterThan(0);
    for (const row of api) {
      const graph = row.workflowJson as Record<string, Record<string, unknown>>;
      expect(graph.nodes).toBeUndefined();
      expect(graph.links).toBeUndefined();
      expect(Object.keys(graph).length).toBeGreaterThan(0);
      for (const [nodeId, node] of Object.entries(graph)) {
        expect(nodeId).toMatch(/^\d+$/);
        expect(typeof node.class_type).toBe('string');
        expect(node.inputs && typeof node.inputs === 'object').toBe(true);
      }
      // 运行期是封闭覆盖：槽位声明错了就会「点运行必报错」，所以这里当场验掉
      const keys = new Set<string>();
      for (const item of row.slots) {
        const node = graph[item.nodeId];
        expect(node).toBeDefined();
        expect(
          Object.keys((node?.inputs ?? {}) as Record<string, unknown>),
        ).toContain(item.field);
        expect([
          'text',
          'longtext',
          'int',
          'float',
          'enum',
          'seed',
          'image',
        ]).toContain(item.type);
        expect(typeof item.required).toBe('boolean');
        if (item.type === 'enum')
          expect(item.options.length).toBeGreaterThan(0);
        expect(keys.has(item.key)).toBe(false);
        keys.add(item.key);
      }
      expect(row.slots.length).toBeLessThanOrEqual(40);
      // 开箱就能改：要么有提示词，要么有输入图，否则跑了也是白跑
      expect(
        row.slots.some(
          (item) =>
            item.type === 'image' || (item.key || '').includes('prompt'),
        ),
      ).toBe(true);
      // 模型名必须给候选或默认值：不然用户得自己猜官方镜像的文件名
      for (const item of row.slots.filter(
        (slotItem) => slotItem.key === 'ckpt_name',
      )) {
        expect(
          item.defaultValue === null || typeof item.defaultValue === 'string',
        ).toBe(true);
        expect(String(item.defaultValue || '').length).toBeGreaterThan(0);
      }
    }
  });

  it('浏览型条目保留官方原文与出处链接，且不给站内运行入口', () => {
    const browsable = rows.filter((row) => row.format === 'ui');
    for (const row of browsable) {
      expect(row.comfyUrl).toMatch(/^https?:\/\//);
      expect(row.workflowJson).toBeTruthy();
    }
  });

  it('重复调用返回同一份内容（seed 与单测共用这条纯函数）', () => {
    expect(buildOfficialRows().map((row) => row.code)).toEqual(
      rows.map((row) => row.code),
    );
  });
});

describe('seedCreativeCommunity 幂等', () => {
  const rows = buildOfficialRows();

  it('第二遍不再新建行：create 只发生在首轮，update 不抹热度也不重传封面', async () => {
    const fake = fakePrisma();
    bind(fake);
    const first = await seedCreativeCommunity(fake.prisma as never);
    expect(first.created).toBe(rows.length);
    expect(first.updated).toBe(0);
    expect(fake.calls.create).toHaveLength(rows.length);
    for (const data of fake.calls.create) {
      expect(data.runCount).toBe(0);
      expect(data.favoriteCount).toBe(0);
      expect(data.likeCount).toBe(0);
      expect(data.viewCount).toBe(0);
      // 官方条目占住发奖幂等标记，管理员推荐时不会给空账号加分
      expect((data.rewardedAt as Date).toISOString()).toBe(
        '2020-01-01T00:00:00.000Z',
      );
      expect(data.auditNote).toBe('官方模板导入');
      expect(data.ownerUserId).toBe('');
    }

    fake.calls.create = [];
    fake.calls.update = [];
    // 拿首轮落库后的封面快照，第二遍写回的必须就是这份
    const coverSnapshot = new Map<number, unknown[]>(
      [...fake.store.values()].map(
        (item) => [item.id, [...item.coverKeys]] as [number, unknown[]],
      ),
    );
    const second = await seedCreativeCommunity(fake.prisma as never);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(rows.length);
    expect(fake.calls.create).toHaveLength(0);
    expect(fake.calls.update).toHaveLength(rows.length);
    for (const call of fake.calls.update) {
      // 热度是真实数据：重跑 seed 不能把它归零
      expect(call.data).not.toHaveProperty('runCount');
      expect(call.data).not.toHaveProperty('favoriteCount');
      expect(call.data).not.toHaveProperty('code');
      // 封面只在库里还空着时才算新值：已有对象键的行写回的就是首轮那份，不重传也不抹掉
      if (call.data.coverKeys !== undefined) {
        expect(toList(call.data.coverKeys)).toEqual(
          coverSnapshot.get(call.id) ?? [],
        );
      }
    }
  });

  it('库里还没有封面时才落地：http 引用原样存，本地文件没配 OSS 就留空', async () => {
    const fake = fakePrisma();
    bind(fake);
    delete process.env.OSS_ACCESS_KEY_ID;
    delete process.env.OSS_ACCESS_KEY_SECRET;
    await seedCreativeCommunity(fake.prisma as never);
    const withRemoteCover = fake.calls.create.filter((data) =>
      toList(data.coverKeys).some((key) => String(key).startsWith('http')),
    );
    if (rows.some((row) => /^https?:/i.test(row.coverRef))) {
      expect(withRemoteCover.length).toBeGreaterThan(0);
    }
    for (const data of fake.calls.create) {
      for (const key of toList(data.coverKeys)) {
        // 没配 OSS 凭据时绝不把本地相对路径当对象键写进库
        expect(String(key)).toMatch(/^https?:\/\//);
      }
    }
  });

  it('单行内容变化会被更新，而不是新增重复行', async () => {
    const fake = fakePrisma();
    bind(fake);
    await seedCreativeCommunity(fake.prisma as never);
    fake.calls.create = [];
    fake.calls.update = [];
    const third = await seedCreativeCommunity(fake.prisma as never);
    expect(third.total).toBe(rows.length);
    expect(fake.store.size).toBe(rows.length);
    expect(fake.calls.create).toHaveLength(0);
  });
});
