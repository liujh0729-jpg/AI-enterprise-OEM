import { CursorCache } from './cursor-cache';
describe('market continuation tokens', () => {
  afterEach(() => jest.useRealTimers());
  it('isolates account/identity/filter scopes and expires tokens', () => {
    jest.useFakeTimers();
    const cache = new CursorCache<object>(300000);
    const value = { page: 2 };
    const cursor = cache.put('user-a:identity-a:filter-a', value);
    expect(cache.get('user-a:identity-a:filter-a', cursor)).toBe(value);
    expect(() => cache.get('user-b:identity-a:filter-a', cursor)).toThrow(
      '游标已过期',
    );
    jest.advanceTimersByTime(300000);
    expect(() => cache.get('user-a:identity-a:filter-a', cursor)).toThrow(
      '游标已过期',
    );
  });
  it('bounds entry count and payload bytes', () => {
    const cache = new CursorCache<object>(300000, 1, 100);
    const first = cache.put('owner', { page: 1 });
    const second = cache.put('owner', { page: 2 });
    expect(() => cache.get('owner', first)).toThrow();
    expect(cache.get('owner', second)).toEqual({ page: 2 });
    expect(() => cache.put('owner', { data: 'x'.repeat(101) })).toThrow(
      '扫描结果过大',
    );
  });
});
