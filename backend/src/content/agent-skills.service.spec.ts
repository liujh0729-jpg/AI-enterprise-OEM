import { ContentAgentSkillService } from './agent-skills.service';

/**
 * 技能摘要进系统提示的收口：条数与字符都要有上限，
 * 否则装够多技能（或写够长的说明）就能把每一轮上下文挤爆——这是配额而不是排版问题。
 */
function serviceWith(rows: { name: string; description: string }[]) {
  // 桩只模拟 Prisma 的 take：条数上限是在查询上收的，这里照同样口径回数据
  const findMany = jest
    .fn()
    .mockImplementation((query: { take?: number }) =>
      Promise.resolve(rows.slice(0, query.take ?? rows.length)),
    );
  const prisma = { contentAgentSkill: { findMany } } as never;
  return {
    service: new ContentAgentSkillService(prisma, {} as never),
    findMany,
  };
}

const lineCount = (text: string) => (text ? text.split('\n').length : 0);

describe('ContentAgentSkillService.promptSummaries', () => {
  it('技能再多也只列前 40 条，并告诉模型剩下的怎么取', async () => {
    const rows = Array.from({ length: 60 }, (_unused, index) => ({
      name: `技能${index}`,
      description: `第 ${index} 个技能`,
    }));
    const { service, findMany } = serviceWith(rows);
    const text = await service.promptSummaries('u1');
    const lines = text.split('\n');
    expect(lines).toHaveLength(41);
    expect(lines[0]).toBe('- 技能0：第 0 个技能');
    expect(lines[40]).toContain('仅列出前 40 个技能');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 41 }),
    );
  });

  it('说明再长也在字符预算处停下，不把整轮提示词挤掉', async () => {
    const rows = Array.from({ length: 40 }, (_unused, index) => ({
      name: `技能${index}`,
      description: '说'.repeat(200),
    }));
    const { service } = serviceWith(rows);
    const text = await service.promptSummaries('u1');
    expect(lineCount(text)).toBeLessThan(40);
    expect(text).toContain('仅列出前');
    expect(text.length).toBeLessThan(4200);
  });

  it('勾选了技能就只列这几个，没勾才按启用列表取', async () => {
    const { service, findMany } = serviceWith([]);
    await service.promptSummaries('u1', [0, -3, 1.5, 7, 9]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [7, 9] } }),
      }),
    );
    await service.promptSummaries('u1', []);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'u1', enabled: true }),
      }),
    );
  });

  it('历史数据里的换行与不可见字符不会带进摘要', async () => {
    const { service } = serviceWith([
      { name: '技\u200B能\nA', description: '第一行\n第二行' },
    ]);
    expect(await service.promptSummaries('u1')).toBe('- 技能 A：第一行 第二行');
  });
});
