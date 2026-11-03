import { createQueryClient } from '../../frontend/src/query/factory';
import { queryKeys } from '../../frontend/src/query/keys';
import { presentMutationError } from '../../frontend/src/query/errors';
import { ApiError } from '@enterprise/contracts';
import { matchesInvalidationModule } from '../../frontend/src/query/invalidation';

describe('business query cache policy', () => {
  const client = createQueryClient();
  afterEach(() => client.clear());
  it('presents a mutation error once across a mutation and confirmation dialog', () => {
    const display = jest.fn();
    const error = new ApiError(
      '保存失败',
      'business',
      422,
      10001,
      'test-request',
    );
    presentMutationError(error, display);
    presentMutationError(error, display);
    presentMutationError(new ApiError('取消', 'cancelled'), display);
    expect(display).toHaveBeenCalledTimes(1);
    expect(display).toHaveBeenCalledWith('保存失败');
  });
  it('sets refresh, retry and retention policy explicitly', () => {
    expect(client.getDefaultOptions()).toMatchObject({
      queries: {
        staleTime: 0,
        gcTime: 300000,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { retry: false },
    });
  });
  it('coalesces identical in-flight requests', async () => {
    let finish!: (value: string) => void;
    const queryFn = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const one = client.fetchQuery({ queryKey: ['unit'], queryFn });
    const two = client.fetchQuery({ queryKey: ['unit'], queryFn });
    finish('ok');
    expect(await Promise.all([one, two])).toEqual(['ok', 'ok']);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
  it('isolates account, identity, enterprise and filters', () => {
    const a = queryKeys.resource(
      queryKeys.scope('a', 'enterprise', 1),
      'tax',
      'plans',
      { page: 1 },
    );
    const variants = [
      queryKeys.resource(
        queryKeys.scope('b', 'enterprise', 1),
        'tax',
        'plans',
        { page: 1 },
      ),
      queryKeys.resource(queryKeys.scope('a', 'provider', 1), 'tax', 'plans', {
        page: 1,
      }),
      queryKeys.resource(
        queryKeys.scope('a', 'enterprise', 2),
        'tax',
        'plans',
        { page: 1 },
      ),
      queryKeys.resource(
        queryKeys.scope('a', 'enterprise', 1),
        'tax',
        'plans',
        { page: 2 },
      ),
    ];
    client.setQueryData(a, 'private');
    for (const key of variants)
      expect(client.getQueryData(key)).toBeUndefined();
  });
  it.each([
    ['contracts', 'supply'],
    ['capability', 'tax'],
    ['external', 'tax'],
  ])(
    'refreshes composed %s reads across enterprise contexts',
    async (target, affected) => {
      const keys = [
        queryKeys.resource(
          queryKeys.scope('owner', 'provider', 1),
          affected,
          'list',
        ),
        queryKeys.resource(
          queryKeys.scope('owner', 'provider', 2),
          affected,
          'detail',
        ),
        queryKeys.resource(
          queryKeys.scope('other', 'provider', 1),
          affected,
          'list',
        ),
        queryKeys.resource(
          queryKeys.scope('owner', 'enterprise', 1),
          affected,
          'list',
        ),
        queryKeys.resource(
          queryKeys.scope('owner', 'provider', 1),
          'geo',
          'report',
        ),
      ];
      for (const key of keys) client.setQueryData(key, 'cached');
      await client.invalidateQueries({
        predicate: (query) =>
          query.queryKey[1] === 'owner' &&
          query.queryKey[2] === 'provider' &&
          matchesInvalidationModule(query.queryKey[4], target),
      });
      expect(
        keys.map((key) => client.getQueryState(key)?.isInvalidated),
      ).toEqual([true, true, false, false, false]);
    },
  );
  it('does not restore a late response after session cancellation and cache clear', async () => {
    let finish!: (value: string) => void;
    let signal: AbortSignal | undefined;
    const old = client
      .fetchQuery({
        queryKey: ['private', 'old'],
        queryFn: (context) => {
          signal = context.signal;
          return new Promise<string>((resolve) => {
            finish = resolve;
          });
        },
      })
      .catch(() => undefined);
    await client.cancelQueries();
    client.clear();
    finish('late');
    await old;
    expect(signal?.aborted).toBe(true);
    expect(client.getQueryData(['private', 'old'])).toBeUndefined();
  });
});
