import { MarketBoardService } from './market-board.service';
import { CurrentUser } from '../auth/current-user';
import { moduleCategory } from '../aiworkin/category-catalog';
import { stub } from '../../test/doubles';
import type { AiworkinClient } from '../aiworkin/aiworkin.client';
import type { DemandService } from '../aiworkin/demand.service';
import type { IdentityService } from '../identity/identity.service';
import type { ContactResolver } from '../shared/contacts.service';
import type { MarketListingRecordService } from './market-listing-record.service';

describe('market continuation pages', () => {
  const client = { isEnabled: () => true };
  const demands = {
    listMine: jest.fn(),
    listPublic: jest.fn(),
    getMine: jest.fn(),
    getPublic: jest.fn(),
    getConversation: jest.fn(),
    publish: jest.fn(),
  };
  const identity = {
    currentIdentity: jest.fn().mockResolvedValue('ENTERPRISE_USER'),
    requireRoles: jest.fn(),
    requireSubjectService: jest.fn(),
    hasServiceType: jest.fn(),
  };
  const contacts = { provider: jest.fn() };
  const records = {
    list: jest.fn(),
    find: jest.fn(),
    record: jest.fn(),
  };
  const row = (id: string, direction: 'DEMAND' | 'SUPPLY' = 'DEMAND') => ({
    id,
    direction,
    subcategoryId: moduleCategory('SUPPLY').children[0].id,
    title: id,
  });
  /** 本地台账行：「我发布的」以它为准（平台没有可按属主读回挂单的接口）。 */
  const rec = (
    id: string,
    subcategoryId = moduleCategory('SUPPLY').children[0].id,
    direction: 'DEMAND' | 'SUPPLY' = 'DEMAND',
  ) => ({
    listingId: id,
    status: 'ONLINE',
    subCategoryId: subcategoryId,
    snapshot: {},
    createdAt: new Date('2026-01-01T00:00:00Z'),
    direction,
  });
  const user = new CurrentUser('owner', 'owner', 'user');
  let service: MarketBoardService;
  beforeEach(() => {
    jest.clearAllMocks();
    identity.currentIdentity.mockResolvedValue('ENTERPRISE_USER');
    records.list.mockResolvedValue([]);
    service = new MarketBoardService(
      stub<AiworkinClient>(client),
      stub<DemandService>(demands),
      stub<IdentityService>(identity),
      stub<ContactResolver>(contacts),
      stub<MarketListingRecordService>(records),
    );
  });
  it('非供需市场的需求列表：列表＝本地台账行（不读公开池，也不打 /market/listings/mine）', async () => {
    const leaf = moduleCategory('SUPPLY').children[0].id;
    records.list.mockResolvedValue([rec('d1', leaf, 'DEMAND')]);
    const page = await service.listDemands(
      user,
      'SUPPLY',
      'platform-token',
      {},
      undefined,
      10,
    );
    expect(page.list.map((item) => item.id)).toEqual(['d1']);
    expect(page.list.map((item) => item.mine)).toEqual([true]);
    expect(page.list[0]).toMatchObject({
      conversationCount: null,
      mine: true,
      subCategoryId: leaf,
    });
    expect(records.list).toHaveBeenCalledWith('owner', 'SUPPLY', 'DEMAND');
    expect(demands.listPublic).not.toHaveBeenCalled();
    // 「我发布的」不再打平台 `/market/listings/mine`（对 API Key 一律 401）
    expect(demands.listMine).not.toHaveBeenCalled();
  });
  it('limits scanning per page and rejects a cursor used by another identity', async () => {
    demands.listPublic.mockResolvedValue({
      list: [],
      total: 1000,
      pageSize: 100,
    });
    const first = await service.listDemands(user, 'HUB', 'platform-token');
    expect(first.list).toEqual([]);
    expect(first.hasMore).toBe(true);
    expect(demands.listPublic).toHaveBeenCalledTimes(5);
    identity.currentIdentity.mockResolvedValue('SERVICE_PROVIDER');
    await expect(
      service.listDemands(user, 'HUB', 'platform-token', {}, first.nextCursor!),
    ).rejects.toThrow('重新加载');
  });

  it('供需市场需求：只读平台公开池，不扫「我发布的」，公开池不带 category 参数', async () => {
    const taxLeaf = moduleCategory('TAX').children[0].id;
    const supplyLeaf = moduleCategory('SUPPLY').children[0].id;
    records.list.mockResolvedValue([rec('a', taxLeaf)]);
    demands.listPublic.mockResolvedValue({
      list: [
        { id: 'b', direction: 'DEMAND', subcategoryId: supplyLeaf },
        { id: 'x', direction: 'SUPPLY', subcategoryId: supplyLeaf },
      ],
      total: 2,
      page: 1,
      pageSize: 100,
    });
    const page = await service.listDemands(
      user,
      'HUB',
      'platform-token',
      {},
      undefined,
      10,
    );
    expect(page.list.map((item) => item.id)).toEqual(['b']);
    expect(page.list.every((item) => item.mine === false)).toBe(true);
    // 读取只用平台 Key：绑定本人 Key 也不会去打需要平台运行时鉴权的 /market/listings/mine
    expect(demands.listMine).not.toHaveBeenCalled();
    expect(records.list).not.toHaveBeenCalled();
    expect(demands.listPublic.mock.calls[0][0]).toBe('platform-token');
    expect(demands.listPublic.mock.calls[0][1].category).toBeUndefined();
  });

  it('供需市场类目筛选：公开池带叶子的父一级类目，行再按叶子精确过滤', async () => {
    const taxLeaf = moduleCategory('TAX').children[0].id;
    const supplyLeaf = moduleCategory('SUPPLY').children[0].id;
    demands.listPublic.mockResolvedValue({
      list: [
        { id: 'a', direction: 'DEMAND', subcategoryId: taxLeaf },
        { id: 'b', direction: 'DEMAND', subcategoryId: supplyLeaf },
      ],
      total: 2,
      page: 1,
      pageSize: 100,
    });
    const page = await service.listDemands(
      user,
      'HUB',
      'platform-token',
      { categoryId: taxLeaf },
      undefined,
      10,
    );
    expect(page.list.map((item) => item.id)).toEqual(['a']);
    // 平台 `?category=` 只收一级类目：传叶子的父 key，而不是二级类目 id
    expect(demands.listPublic.mock.calls[0][1].category).toBe(
      'corporate_commercial_tax',
    );
  });

  it('供需市场类目筛选：父一级类目平台未收录时不带 category，只按叶子本地过滤', async () => {
    const thinkTankLeaf = moduleCategory('THINK_TANK').children[0].id;
    const taxLeaf = moduleCategory('TAX').children[0].id;
    demands.listPublic.mockResolvedValue({
      list: [
        { id: 'a', direction: 'SUPPLY', subcategoryId: thinkTankLeaf },
        { id: 'b', direction: 'SUPPLY', subcategoryId: taxLeaf },
      ],
      total: 2,
      page: 1,
      pageSize: 100,
    });
    const page = await service.listServices(
      user,
      'HUB',
      'platform-token',
      { categoryId: thinkTankLeaf },
      undefined,
      10,
    );
    expect(page.list.map((item) => item.id)).toEqual(['a']);
    // 「咨询服务」未收录进平台一级类目（带上会被判 400），因此只做本地叶子过滤
    expect(demands.listPublic.mock.calls[0][1].category).toBeUndefined();
  });

  it('供需市场服务：只读平台公开池，行一律标为非本账号', async () => {
    const supplyLeaf = moduleCategory('SUPPLY').children[0].id;
    demands.listPublic.mockResolvedValue({
      list: [{ id: 'p', direction: 'SUPPLY', subcategoryId: supplyLeaf }],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    const page = await service.listServices(
      user,
      'HUB',
      'platform-token',
      {},
      undefined,
      10,
    );
    expect(page.list.map((item) => item.id)).toEqual(['p']);
    expect(page.list.map((item) => item.mine)).toEqual([false]);
    expect(demands.listMine).not.toHaveBeenCalled();
    expect(demands.listPublic.mock.calls[0][0]).toBe('platform-token');
    expect(demands.listPublic.mock.calls[0][1].category).toBeUndefined();
  });

  it('供需市场明细：只读平台公开池，带本人 Key 也不打 /market/listings/mine', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    demands.getPublic.mockResolvedValue(row(id));
    const detail = await service.detail(
      user,
      'HUB',
      id,
      'platform-token',
      'DEMAND',
    );
    expect(demands.getMine).not.toHaveBeenCalled();
    expect(demands.getPublic).toHaveBeenCalledWith('platform-token', id);
    expect(detail).toMatchObject({ id, mine: false });
  });

  it('供需市场需求：scope=mine 只读本地台账，不读公开池', async () => {
    const taxLeaf = moduleCategory('TAX').children[0].id;
    records.list.mockResolvedValue([rec('m1', taxLeaf, 'DEMAND')]);
    const page = await service.listDemands(
      user,
      'HUB',
      'platform-token',
      { scope: 'mine' },
      undefined,
      10,
    );
    expect(page.list.map((item) => item.id)).toEqual(['m1']);
    expect(page.list.map((item) => item.mine)).toEqual([true]);
    expect(records.list).toHaveBeenCalledWith('owner', 'HUB', 'DEMAND');
    expect(demands.listPublic).not.toHaveBeenCalled();
    expect(demands.listMine).not.toHaveBeenCalled();
  });

  it('供需市场服务：scope=mine 只读本地台账，不读公开池', async () => {
    const leaf = moduleCategory('LEGAL').children[0].id;
    records.list.mockResolvedValue([rec('s1', leaf, 'SUPPLY')]);
    const page = await service.listServices(
      user,
      'HUB',
      'platform-token',
      { scope: 'mine' },
      undefined,
      10,
    );
    expect(page.list.map((item) => item.id)).toEqual(['s1']);
    expect(records.list).toHaveBeenCalledWith('owner', 'HUB', 'SUPPLY');
    expect(demands.listPublic).not.toHaveBeenCalled();
  });

  it('非供需市场服务：scope=all 只读公开池，不读本地台账', async () => {
    const leaf = moduleCategory('SUPPLY').children[0].id;
    demands.listPublic.mockResolvedValue({
      list: [{ id: 'p', direction: 'SUPPLY', subcategoryId: leaf }],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    const page = await service.listServices(
      user,
      'SUPPLY',
      'platform-token',
      { scope: 'all' },
      undefined,
      10,
    );
    expect(page.list.map((item) => item.id)).toEqual(['p']);
    expect(page.list.map((item) => item.mine)).toEqual([false]);
    expect(records.list).not.toHaveBeenCalled();
    expect(demands.listPublic).toHaveBeenCalledTimes(1);
  });

  it('非供需市场的服务列表：列表＝本地台账行（未绑定本人 Key 也不拦）', async () => {
    const leaf = moduleCategory('SUPPLY').children[0].id;
    records.list.mockResolvedValue([rec('s1', leaf, 'SUPPLY')]);
    const page = await service.listServices(
      user,
      'SUPPLY',
      'platform-token',
      {},
      undefined,
      10,
    );
    expect(page.list.map((item) => item.id)).toEqual(['s1']);
    expect(page.list.map((item) => item.mine)).toEqual([true]);
    expect(records.list).toHaveBeenCalledWith('owner', 'SUPPLY', 'SUPPLY');
    expect(demands.listPublic).not.toHaveBeenCalled();
    expect(demands.listMine).not.toHaveBeenCalled();
  });

  it('供需市场发布需求：跳过板块门控，标记 board=HUB 并落本地台账', async () => {
    const taxLeaf = moduleCategory('TAX').children[0].id;
    demands.publish.mockResolvedValue({
      listing: {
        id: '00000000-0000-4000-8000-000000000000',
        status: 'ONLINE',
      },
      initialMatchRunId: 'run-1',
    });
    contacts.provider.mockResolvedValue({
      name: '张三',
      phone: '13800000000',
    });
    const result = await service.createDemand(
      user,
      'HUB',
      {
        title: '找跨境财务顾问',
        description: '需要熟悉亚马逊税务',
        sub_category_id: taxLeaf,
      },
      'token',
    );
    expect(result.tip).toContain('供需市场');
    expect(demands.publish.mock.calls[0][1]).toMatchObject({
      subcategoryId: taxLeaf,
      attributes: { board: 'HUB', category: '供需市场' },
    });
    // 发布拿到平台挂单号后写本地台账：平台挂单号 + 板块 + 方向
    expect(records.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner',
        domain: 'HUB',
        direction: 'DEMAND',
        listingId: '00000000-0000-4000-8000-000000000000',
        matchRunId: 'run-1',
        subCategoryId: taxLeaf,
      }),
    );
  });

  it('供需市场发布服务：跳过板块备案门控，并落本地台账', async () => {
    const leaf = moduleCategory('LEGAL').children[0].id;
    demands.publish.mockResolvedValue({
      listing: {
        id: '00000000-0000-4000-8000-000000000001',
        status: 'ONLINE',
      },
    });
    contacts.provider.mockResolvedValue({ name: '李四', phone: '13900000000' });
    const result = await service.createService(
      user,
      'HUB',
      {
        title: '合同审查',
        description: '标准合同逐条审查',
        sub_category_id: leaf,
        money_mode: 'NEGOTIABLE',
      },
      'token',
    );
    expect(result.tip).toContain('供需市场');
    expect(demands.publish.mock.calls[0][1]).toMatchObject({
      subcategoryId: leaf,
      attributes: { board: 'HUB' },
    });
    expect(records.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner',
        domain: 'HUB',
        direction: 'SUPPLY',
        listingId: '00000000-0000-4000-8000-000000000001',
      }),
    );
  });

  it('供需市场发布：二级类目必须属于任一业务板块', async () => {
    await expect(
      service.createDemand(
        user,
        'HUB',
        { title: '无类目需求', sub_category_id: 'not-a-leaf' },
        'token',
      ),
    ).rejects.toThrow('二级类目不属于任何业务板块');
    await expect(
      service.createService(
        user,
        'HUB',
        { title: '无类目服务', description: '说明', money_mode: 'NEGOTIABLE' },
        'token',
      ),
    ).rejects.toThrow('请选择二级类目');
    expect(demands.publish).not.toHaveBeenCalled();
    expect(records.record).not.toHaveBeenCalled();
  });
});
