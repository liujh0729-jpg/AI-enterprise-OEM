import { MarketBoardService } from './market-board.service';
import { CurrentUser } from '../auth/current-user';
import { moduleCategory } from '../aiworkin/category-catalog';

describe('market continuation pages', () => {
  const client = { isEnabled: () => true };
  const demands = {
    listMine: jest.fn(),
    listPublic: jest.fn(),
    getMine: jest.fn(),
    getConversation: jest.fn(),
  };
  const identity = {
    currentIdentity: jest.fn().mockResolvedValue('ENTERPRISE_USER'),
  };
  const contacts = {};
  const row = (id: string) => ({
    id,
    direction: 'DEMAND',
    subcategoryId: moduleCategory('SUPPLY').children[0].id,
    title: id,
  });
  const user = new CurrentUser('owner', 'owner', 'user');
  let service: MarketBoardService;
  beforeEach(() => {
    jest.clearAllMocks();
    identity.currentIdentity.mockResolvedValue('ENTERPRISE_USER');
    service = new MarketBoardService(
      client as never,
      demands as never,
      identity as never,
      contacts as never,
    );
  });
  it('returns own summaries first, deduplicates the public pool and replays cursors without extra upstream requests', async () => {
    demands.listMine.mockResolvedValue({
      list: [row('a'), row('b')],
      total: 2,
      page: 1,
      pageSize: 100,
    });
    demands.listPublic.mockResolvedValue({
      list: [row('b'), row('c')],
      total: 2,
      page: 1,
      pageSize: 100,
    });
    const first = await service.listDemands(
      user,
      'SUPPLY',
      'token',
      'token',
      {},
      undefined,
      1,
    );
    expect(first.list.map((x) => x.id)).toEqual(['a']);
    expect(first.hasMore).toBe(true);
    const second = await service.listDemands(
      user,
      'SUPPLY',
      'token',
      'token',
      {},
      first.nextCursor!,
      1,
    );
    expect(second.list.map((x) => x.id)).toEqual(['b']);
    expect(
      await service.listDemands(
        user,
        'SUPPLY',
        'token',
        'token',
        {},
        first.nextCursor!,
        1,
      ),
    ).toEqual(second);
    const third = await service.listDemands(
      user,
      'SUPPLY',
      'token',
      'token',
      {},
      second.nextCursor!,
      1,
    );
    expect(third.list.map((x) => x.id)).toEqual(['c']);
    expect(demands.listMine).toHaveBeenCalledTimes(1);
    expect(demands.listPublic).toHaveBeenCalledTimes(1);
    expect(demands.getMine).not.toHaveBeenCalled();
    expect(demands.getConversation).not.toHaveBeenCalled();
    expect(first.list[0]).toMatchObject({
      conversationCount: null,
      mine: true,
    });
  });
  it('limits scanning per page and rejects a cursor used by another identity', async () => {
    demands.listMine.mockResolvedValue({
      list: [],
      total: 1000,
      pageSize: 100,
    });
    const first = await service.listDemands(user, 'SUPPLY', 'token', 'token');
    expect(first.list).toEqual([]);
    expect(first.hasMore).toBe(true);
    expect(demands.listMine).toHaveBeenCalledTimes(5);
    identity.currentIdentity.mockResolvedValue('SERVICE_PROVIDER');
    await expect(
      service.listDemands(
        user,
        'SUPPLY',
        'token',
        'token',
        {},
        first.nextCursor!,
      ),
    ).rejects.toThrow('重新加载');
  });
  it('skips the personal scan when the user has no bound key and reads the public pool with the platform token', async () => {
    demands.listPublic.mockResolvedValue({
      list: [row('p')],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    const page = await service.listDemands(
      user,
      'SUPPLY',
      '',
      'platform-token',
      {},
      undefined,
      1,
    );
    expect(page.list.map((x) => x.id)).toEqual(['p']);
    expect(demands.listMine).not.toHaveBeenCalled();
    expect(demands.listPublic).toHaveBeenCalledWith(
      'platform-token',
      expect.objectContaining({ page: 1 }),
    );
  });
});
