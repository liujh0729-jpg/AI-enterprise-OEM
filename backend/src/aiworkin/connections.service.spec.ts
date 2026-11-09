import { AiworkinClient } from './aiworkin.client';
import { ConnectionsService } from './connections.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { localRegionDictionary } from '../shared/region-dictionary';
import { stub } from '../../test/doubles';

/**
 * 省市字典的取数口径（基础数据通道）：
 * 无凭证或上游通道关闭时必须回落本地内置字典，而不是抛「请先绑定 AIPDD APIKey」，
 * 否则所有共用省市下拉的表单（身份认证、服务商备案、职员资料、三类资源库、物流/营销地域）都会卡住。
 */
function buildService(enabled: boolean, upstream?: unknown) {
  const request = jest.fn().mockResolvedValue(upstream);
  const client = stub<AiworkinClient>({
    isEnabled: () => enabled,
    request,
  });
  return { service: new ConnectionsService(client), request };
}

describe('ConnectionsService.locations', () => {
  it('falls back to the bundled dictionary when no token is available', async () => {
    const { service, request } = buildService(true);
    const result = await service.locations('');
    expect(result.source).toBe('LOCAL');
    expect(result.list.length).toBeGreaterThan(0);
    expect(request).not.toHaveBeenCalled();
  });

  it('falls back to the bundled dictionary when the upstream channel is disabled', async () => {
    const { service, request } = buildService(false);
    const result = await service.locations('sk-local-dev-key');
    expect(result.source).toBe('LOCAL');
    expect(request).not.toHaveBeenCalled();
  });

  it('proxies upstream when a token is present and the channel is enabled', async () => {
    const rows = [{ label: '北京市', value: '北京市', children: [] }];
    const { service, request } = buildService(true, rows);
    const result = await service.locations('sk-upstream-key');
    expect(result).toEqual({ list: rows, source: 'AIWORKIN' });
    expect(request).toHaveBeenCalledWith(
      '/connections/resources/locations',
      expect.objectContaining({ token: 'sk-upstream-key' }),
    );
  });

  it('rejects malformed upstream payloads', async () => {
    const { service } = buildService(true, { unexpected: true });
    await expect(service.locations('sk-upstream-key')).rejects.toThrow(
      /数据异常/,
    );
  });
});

describe('localRegionDictionary', () => {
  const list = localRegionDictionary();

  it('covers every province with de-duplicated cities', () => {
    expect(list.length).toBeGreaterThan(30);
    const provinces = new Set(list.map((row) => row.value));
    expect(provinces.size).toBe(list.length);
    expect(list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: '北京市' }),
        expect.objectContaining({ value: '广东省' }),
      ]),
    );
    const guangdong = list.find((row) => row.value === '广东省')!;
    expect(guangdong.children.map((city) => city.value)).toEqual(
      expect.arrayContaining(['广州市', '深圳市']),
    );
    expect(new Set(guangdong.children.map((city) => city.value)).size).toBe(
      guangdong.children.length,
    );
  });

  it('matches the upstream dictionary shape (label equals value)', () => {
    for (const province of list) {
      expect(province.label).toBe(province.value);
      expect(Array.isArray(province.children)).toBe(true);
      for (const city of province.children) {
        expect(city.label).toBe(city.value);
        // 二级不再重复省名：直辖市由前端 citiesOf() 补「全市」选项
        expect(city.value).not.toBe(province.value);
      }
    }
  });

  it('is cached and stays stable across calls', () => {
    expect(localRegionDictionary()).toBe(list);
  });
});

describe('ConnectionsService upstream proxy', () => {
  const build = (upstream: unknown, enabled = true) => {
    const request = jest.fn().mockResolvedValue(upstream);
    const client = stub<AiworkinClient>({
      isEnabled: () => enabled,
      request,
    });
    return { service: new ConnectionsService(client), request };
  };

  it('forwards whitelisted query params (repeated ones kept) and paginates', async () => {
    const { service, request } = build({ list: [{ id: 'r1' }], total: 12 });
    const page = await service.listResources('sk-key', {
      category: ['talent', 'lawyer'],
      keyword: '杭州',
      page: '2',
      unsupported: 'drop-me',
    });
    const [path, options] = request.mock.calls[0];
    expect(path).toBe(
      '/connections/resources?category=talent&category=lawyer&keyword=%E6%9D%AD%E5%B7%9E&page=2',
    );
    expect(options).toEqual(
      expect.objectContaining({ token: 'sk-key', method: 'GET' }),
    );
    expect(page).toEqual({
      list: [{ id: 'r1' }],
      total: 12,
      page: 2,
      pageSize: 9,
      source: 'AIWORKIN',
    });
  });

  it('applies default paging when the query omits it', async () => {
    const { service } = build({ list: [], total: 0 });
    const page = await service.listResources('sk-key', {});
    expect(page).toMatchObject({ page: 1, pageSize: 9, total: 0 });
  });

  it('rejects malformed list payloads', async () => {
    const { service } = build({ list: [], total: -1 });
    await expect(service.listResources('sk-key', {})).rejects.toBeInstanceOf(
      BusinessException,
    );
    const { service: broken } = build(null);
    await expect(broken.favoriteList('sk-key', {})).rejects.toMatchObject({
      errorCode: ErrorCode.AIWORKIN_UNAVAILABLE,
    });
  });

  it('reads dictionary items and favorite collections', async () => {
    const items = [{ key: 'k1', label: '选项一' }];
    const { service, request } = build(items);
    await expect(service.dictionary('sk-key', 'law/ type')).resolves.toEqual({
      list: items,
      source: 'AIWORKIN',
    });
    expect(request.mock.calls[0][0]).toBe('/dictionaries/law%2F%20type/items');

    const fav = build({ list: [{ id: 'f1' }], total: 1 });
    await fav.service.favoriteList('sk-key', { page: '3', pageSize: '15' });
    expect(fav.request.mock.calls[0][0]).toBe(
      '/connections/resources/favorites/marketing?page=3&pageSize=15',
    );

    const profile = build({ list: [], total: 0 });
    const profilePage = await profile.service.profileFavoriteList('sk-key', {
      profileType: 'lawyer',
    });
    expect(profile.request.mock.calls[0][0]).toBe(
      '/connections/profile-favorites?profileType=lawyer',
    );
    expect(profilePage.pageSize).toBe(20);
  });

  it('refuses non-array dictionary payloads', async () => {
    const { service } = build({ items: [] });
    await expect(service.dictionary('sk-key', 'code')).rejects.toMatchObject({
      errorCode: ErrorCode.AIWORKIN_UNAVAILABLE,
    });
  });

  it('resolves contact info and marks the source', async () => {
    const { service, request } = build({ wechat: 'wx', phone: '13800000000' });
    await expect(service.contact('sk-key', 'talent', 'r 1')).resolves.toEqual({
      wechat: 'wx',
      phone: '13800000000',
      source: 'AIWORKIN',
    });
    expect(request.mock.calls[0][0]).toBe(
      '/connections/resources/talent/r%201/contact',
    );
  });

  it('rejects array-like contact payloads', async () => {
    const { service } = build([{ wechat: 'wx' }]);
    await expect(
      service.contact('sk-key', 'talent', 'r1'),
    ).rejects.toMatchObject({ errorCode: ErrorCode.AIWORKIN_UNAVAILABLE });
  });

  it('toggles favorites with the verb and prefix matching the source type', async () => {
    const add = build({ favorited: true });
    await expect(
      add.service.setFavorite('sk-key', 'r 1', true),
    ).resolves.toEqual({ favorited: true, source: 'AIWORKIN' });
    expect(add.request.mock.calls[0]).toEqual([
      '/connections/resources/favorites/talent/r%201',
      expect.objectContaining({ method: 'POST', retry: 0 }),
    ]);

    const drop = build({ favorited: false });
    await drop.service.setFavorite('sk-key', 'p1', false, 'profile');
    expect(drop.request.mock.calls[0]).toEqual([
      '/connections/profile-favorites/p1',
      expect.objectContaining({ method: 'DELETE' }),
    ]);

    const invalid = build({ favorited: 'yes' });
    await expect(
      invalid.service.setFavorite('sk-key', 'r1', true),
    ).rejects.toMatchObject({ errorCode: ErrorCode.AIWORKIN_UNAVAILABLE });
  });

  it('guards the channel switch and the logged-in session', async () => {
    const closed = build({ list: [], total: 0 }, false);
    await expect(
      closed.service.listResources('sk-key', {}),
    ).rejects.toMatchObject({ errorCode: ErrorCode.AIWORKIN_UNAVAILABLE });

    const anonymous = build({ list: [], total: 0 });
    await expect(
      anonymous.service.listResources('  ', {}),
    ).rejects.toMatchObject({ errorCode: ErrorCode.UNAUTHORIZED });
    expect(anonymous.request).not.toHaveBeenCalled();
  });
});
