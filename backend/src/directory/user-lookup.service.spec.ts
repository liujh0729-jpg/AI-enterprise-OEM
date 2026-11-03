import { UserLookupService } from './user-lookup.service';
import { httpRequest } from '../http/transport';
import { runInRequestContext } from '../common/request-context';

jest.mock('../http/transport', () => ({ httpRequest: jest.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup(enabled = 1, syncedAt: Date | null = null) {
  const row = {
    userId: 'directory-unit',
    username: 'local-name',
    displayName: 'Local Name',
    email: '',
    avatarUrl: '',
    role: 'user',
    enabled,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    syncedAt,
  };
  const prisma = {
    userDirectory: {
      findUnique: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([row]),
      upsert: jest.fn().mockResolvedValue(row),
    },
  };
  return {
    prisma,
    row,
    users: new UserLookupService(prisma as never),
  };
}

describe('directory synchronization and account status', () => {
  const request = jest.mocked(httpRequest);
  beforeEach(() => request.mockReset());
  afterEach(() => jest.restoreAllMocks());

  it('batches cold directory ids, preserves requested order and caches missing ids', async () => {
    const { users, prisma, row } = setup();
    const other = { ...row, userId: 'other-directory-unit', enabled: 0 };
    prisma.userDirectory.findMany.mockResolvedValue([other, row]);
    const ids = [row.userId, '', other.userId, row.userId, 'unknown-audit-id'];
    expect(await users.lookup(ids)).toMatchObject([
      { id: row.userId, enabled: true },
      { id: other.userId, enabled: false },
    ]);
    expect(prisma.userDirectory.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.userDirectory.findUnique).not.toHaveBeenCalled();
    expect(await users.lookup(ids)).toHaveLength(2);
    expect(prisma.userDirectory.findMany).toHaveBeenCalledTimes(1);
  });

  it('allows the first verified account to load while its directory insert is pending', async () => {
    const { users, prisma, row } = setup();
    prisma.userDirectory.findUnique.mockResolvedValue(null);
    const write = deferred<typeof row>();
    prisma.userDirectory.upsert.mockReturnValue(write.promise);
    request.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      data: { code: 0, data: { displayName: 'Remote Name', enabled: true } },
    });

    await users.remember(row.userId, 'verified-name', 'verified-token');
    expect(await users.requireActiveUser(row.userId)).toMatchObject({
      username: 'verified-name',
      displayName: 'Remote Name',
      enabled: true,
    });
    expect(prisma.userDirectory.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.userDirectory.upsert).toHaveBeenCalledTimes(1);
    write.resolve(row);
  });

  it('shares cold status checks and never admits an account before a remote disable result', async () => {
    const { users, prisma, row } = setup();
    const remote = deferred<Awaited<ReturnType<typeof httpRequest>>>();
    const started = deferred<void>();
    request.mockImplementation(() => {
      started.resolve();
      return remote.promise;
    });
    const first = users.remember(row.userId, row.username, 'verified-token');
    expect(users.remember(row.userId, row.username, 'verified-token')).toBe(
      first,
    );
    let finished = false;
    const active = users.requireActiveUser(row.userId).then(
      () => {
        finished = true;
        return 'allowed';
      },
      (error: Error) => {
        finished = true;
        return error.message;
      },
    );
    await started.promise;
    expect(finished).toBe(false);
    remote.resolve({
      ok: true,
      status: 200,
      headers: new Headers(),
      data: { code: 0, data: { enabled: false } },
    });
    await first;
    expect(await active).toBe('user disabled');
    expect(request).toHaveBeenCalledTimes(1);
    expect(prisma.userDirectory.findUnique).toHaveBeenCalledTimes(1);
  });

  it('keeps bulk lookups behind the in-flight account status check', async () => {
    const { users, row, prisma } = setup();
    const remote = deferred<Awaited<ReturnType<typeof httpRequest>>>();
    const started = deferred<void>();
    request.mockImplementation(() => {
      started.resolve();
      return remote.promise;
    });
    const remembering = users.remember(
      row.userId,
      row.username,
      'verified-token',
    );
    await started.promise;
    let returned = false;
    const lookup = users.lookup([row.userId]).then((value) => {
      returned = true;
      return value;
    });
    await Promise.resolve();
    expect(returned).toBe(false);
    remote.resolve({
      ok: true,
      status: 200,
      headers: new Headers(),
      data: { code: 0, data: { enabled: false } },
    });
    await remembering;
    expect(await lookup).toMatchObject([{ id: row.userId, enabled: false }]);
    expect(prisma.userDirectory.findMany).not.toHaveBeenCalled();
  });

  it.each(['fresh', 'unavailable', 'missing-enabled'])(
    'preserves a disabled local account when remote state is %s',
    async (state) => {
      const { users, row } = setup(0, state === 'fresh' ? new Date() : null);
      if (state === 'unavailable')
        request.mockRejectedValue(new Error('offline'));
      else
        request.mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers(),
          data: { code: 0, data: { displayName: 'Updated Name' } },
        });
      await users.remember(row.userId, row.username, 'verified-token');
      await expect(users.requireActiveUser(row.userId)).rejects.toThrow(
        'user disabled',
      );
      if (state === 'fresh') expect(request).not.toHaveBeenCalled();
    },
  );

  it('keeps cached profile reads fast without skipping a stale status check', async () => {
    const { users, row, prisma } = setup(1, new Date());
    await users.remember(row.userId, row.username, 'verified-token');
    await users.remember(row.userId, row.username, 'verified-token');
    await expect(users.requireActiveUser(row.userId)).resolves.toMatchObject({
      enabled: true,
    });
    expect(prisma.userDirectory.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.userDirectory.upsert).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('handles background persistence failures and retries on the next cold read', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { users, prisma, row } = setup();
    const write = deferred<typeof row>();
    prisma.userDirectory.upsert.mockReturnValue(write.promise);
    request.mockRejectedValue(new Error('offline'));
    await users.remember(row.userId, 'changed-name', 'verified-token');
    write.reject(new Error('database unavailable'));
    await Promise.resolve();
    await expect(users.requireActiveUser(row.userId)).resolves.toMatchObject({
      enabled: true,
    });
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60000);
    prisma.userDirectory.upsert.mockResolvedValue(row);
    await users.remember(row.userId, 'changed-name', 'verified-token');
    expect(prisma.userDirectory.upsert).toHaveBeenCalledTimes(2);
  });

  it('does not inherit a disconnected request signal for shared synchronization', async () => {
    const { users, row } = setup();
    const actual =
      jest.requireActual<typeof import('../http/transport')>(
        '../http/transport',
      );
    request.mockImplementation(actual.httpRequest);
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          data: { enabled: false },
        }),
      ),
    );
    const controller = new AbortController();
    controller.abort();
    await runInRequestContext(
      () => users.remember(row.userId, row.username, 'verified-token'),
      { signal: controller.signal },
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await expect(users.requireActiveUser(row.userId)).rejects.toThrow(
      'user disabled',
    );
  });
});
