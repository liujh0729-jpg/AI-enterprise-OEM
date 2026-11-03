import { randomUUID } from 'node:crypto';
import { Logger } from '../common/logger';
import { PrismaClient, GeoProject, GeoQuestion } from '../../generated/prisma';
import { GeoCollectionService, weekStartOf } from './geo-collection.service';
import { geoChat, GeoChatResult } from './geo-llm.client';

jest.mock('./geo-llm.client', () => ({ geoChat: jest.fn() }));

type Lease = { id: number; token: string };
type ClaimedRun = Lease & { periodLabel: string; projectId: number };
type CollectionInternals = {
  attemptItem(
    run: ClaimedRun,
    itemId: number,
    project: GeoProject,
    question: GeoQuestion,
  ): Promise<{ error?: string }>;
  executeRun(id: number, window: { start: Date; end: Date }): Promise<void>;
  finish(lease: Lease): Promise<void>;
  failItem(lease: Lease, itemId: number, error: string): Promise<void>;
};

/** 此套件真实验证 PG 事务/行锁，只允许显式指定的本机一次性测试库。 */
function validateTestDatabase(raw: string) {
  const url = new URL(raw);
  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !/^\/aipdd_enterprise_geo_test_[a-z0-9_]+$/.test(url.pathname) ||
    [...url.searchParams.keys()].some((key) => key !== 'schema') ||
    (url.searchParams.get('schema') || 'public') !== 'public'
  ) {
    throw new Error(
      'GEO 故障测试仅允许本机 aipdd_enterprise_geo_test_* 隔离库',
    );
  }
  return raw;
}

describe('GEO collection test isolation', () => {
  it('rejects business databases and remote hosts before connecting', () => {
    for (const raw of [
      'postgresql://127.0.0.1/ae_test',
      'postgresql://example.com/aipdd_enterprise_geo_test_example',
      'postgresql://127.0.0.1/aipdd_enterprise_geo_test_example?schema=sns',
      'postgresql://127.0.0.1/aipdd_enterprise_geo_test_example?host=example.com',
    ]) {
      expect(() => validateTestDatabase(raw)).toThrow('隔离库');
    }
  });
});

const databaseUrl = process.env.GEO_COLLECTION_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const chat = jest.mocked(geoChat);
const parsedAnswer = JSON.stringify({
  brand_mentioned: 1,
  sentiment: '正面',
  citation_genre: '官网',
  excerpt: '测试品牌的真实观测',
});
const answer = (reply = parsedAnswer): GeoChatResult => ({
  reply,
  elapsedMs: 1,
  promptTokens: 1,
  completionTokens: 1,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describeDatabase('GEO collection PostgreSQL recovery', () => {
  let prisma: PrismaClient;
  let collection: GeoCollectionService;
  let service: CollectionInternals;
  let project: GeoProject;
  let question: GeoQuestion;
  let run: ClaimedRun;
  let itemId: number;
  let failDoneWrite = false;
  const settings = {
    resolve: jest.fn().mockResolvedValue({
      apiKey: 'isolated-test-key',
      model: 'isolated-test-model',
      baseUrl: 'http://127.0.0.1/unused-mocked-model',
    }),
  };
  const window = () => ({
    start: new Date(Date.now() - 60_000),
    end: new Date(Date.now() + 60_000),
  });
  const attempt = () => service.attemptItem(run, itemId, project, question);

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: validateTestDatabase(databaseUrl!) } },
    });
    // 在实际事务中注入 DONE 写失败，验证先前的 batch/observation 写入确实被 PG 回滚。
    prisma.$use(async (params, next) => {
      if (
        failDoneWrite &&
        params.model === 'GeoCollectItem' &&
        params.action === 'update' &&
        params.args.data.status === 'DONE'
      ) {
        throw new Error('simulated interruption before DONE');
      }
      const result: unknown = await next(params);
      return result;
    });
    await prisma.$connect();
  });

  beforeEach(async () => {
    chat.mockReset().mockResolvedValue(answer());
    failDoneWrite = false;
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    collection = new GeoCollectionService(prisma as never, settings as never);
    service = collection as unknown as CollectionInternals;
    project = await prisma.geoProject.create({
      data: {
        ownerUserId: 'isolated-geo-test',
        brand: '测试品牌',
        platforms: ['豆包'],
        autoCollect: 1,
        note: '仅供本机隔离故障测试',
      },
    });
    question = await prisma.geoQuestion.create({
      data: { projectId: project.id, text: '推荐哪些品牌？' },
    });
    const created = await prisma.geoCollectRun.create({
      data: {
        projectId: project.id,
        weekStart: weekStartOf(new Date()),
        periodLabel: 'test-period',
        status: 'RUNNING',
        claimedBy: randomUUID(),
        heartbeatAt: new Date(),
        planned: 1,
      },
    });
    run = {
      id: created.id,
      projectId: project.id,
      periodLabel: created.periodLabel,
      token: created.claimedBy,
    };
    const item = await prisma.geoCollectItem.create({
      data: {
        runId: run.id,
        projectId: project.id,
        questionId: question.id,
        platform: '豆包',
        rawAnswer: '已持久化的平台回答',
        modelVersion: 'test-model',
      },
    });
    itemId = item.id;
  });

  afterEach(async () => {
    failDoneWrite = false;
    jest.restoreAllMocks();
    if (!project) return;
    const batches = await prisma.geoBatch.findMany({
      where: { projectId: project.id },
      select: { id: true },
    });
    await prisma.$transaction([
      prisma.geoObservation.deleteMany({
        where: { batchId: { in: batches.map((row) => row.id) } },
      }),
      prisma.geoCollectItem.deleteMany({ where: { projectId: project.id } }),
      prisma.geoCollectRun.deleteMany({ where: { projectId: project.id } }),
      prisma.geoBatch.deleteMany({ where: { projectId: project.id } }),
      prisma.geoQuestion.deleteMany({ where: { projectId: project.id } }),
      prisma.geoProject.delete({ where: { id: project.id } }),
    ]);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('replays a completed item without another model call or observation', async () => {
    await attempt();
    await attempt();
    await service.failItem(run, itemId, 'late failure');
    expect(chat).toHaveBeenCalledTimes(1);
    expect(await prisma.geoObservation.count()).toBe(1);
    expect(await prisma.geoBatch.count()).toBe(1);
    expect(
      await prisma.geoCollectItem.findUnique({ where: { id: itemId } }),
    ).toMatchObject({ status: 'DONE', attempts: 1, error: '' });
  });

  it('rolls back observation, first batch and batch pointer if DONE cannot commit', async () => {
    failDoneWrite = true;
    await expect(attempt()).rejects.toThrow('simulated interruption');
    expect(await prisma.geoObservation.count()).toBe(0);
    expect(await prisma.geoBatch.count()).toBe(0);
    expect(
      await prisma.geoCollectRun.findUnique({ where: { id: run.id } }),
    ).toMatchObject({ batchId: 0 });
    expect(
      await prisma.geoCollectItem.findUnique({ where: { id: itemId } }),
    ).toMatchObject({ status: 'PENDING', attempts: 0, observationId: 0 });

    failDoneWrite = false;
    await attempt();
    expect(await prisma.geoObservation.count()).toBe(1);
    expect(await prisma.geoBatch.count()).toBe(1);
  });

  it('serializes concurrent result commits for the same item', async () => {
    const bothParsing = deferred<void>();
    let calls = 0;
    chat.mockImplementation(async () => {
      if (++calls === 2) bothParsing.resolve();
      await bothParsing.promise;
      return answer();
    });
    await Promise.all([attempt(), attempt()]);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(await prisma.geoObservation.count()).toBe(1);
    expect(await prisma.geoBatch.count()).toBe(1);
    expect(
      await prisma.geoCollectItem.findUnique({ where: { id: itemId } }),
    ).toMatchObject({ status: 'DONE', attempts: 1 });
  });

  it('reuses one batch when different items complete concurrently', async () => {
    const other = await prisma.geoCollectItem.create({
      data: {
        runId: run.id,
        projectId: project.id,
        questionId: question.id,
        platform: 'DeepSeek',
        rawAnswer: '另一平台的回答',
      },
    });
    await Promise.all([
      attempt(),
      service.attemptItem(run, other.id, project, question),
    ]);
    const observations = await prisma.geoObservation.findMany();
    expect(observations).toHaveLength(2);
    expect(new Set(observations.map((row) => row.batchId)).size).toBe(1);
    expect(await prisma.geoBatch.count()).toBe(1);
  });

  it('persists raw answers and retries parsing without asking again', async () => {
    await prisma.geoCollectItem.update({
      where: { id: itemId },
      data: { rawAnswer: null },
    });
    chat
      .mockResolvedValueOnce(answer('首次提问的原始回答'))
      .mockRejectedValueOnce(new Error('parse unavailable'))
      .mockResolvedValueOnce(answer());
    await expect(attempt()).resolves.toHaveProperty('error');
    expect(
      await prisma.geoCollectItem.findUnique({ where: { id: itemId } }),
    ).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      rawAnswer: '首次提问的原始回答',
    });
    await attempt();
    expect(chat).toHaveBeenCalledTimes(3);
    expect(await prisma.geoObservation.count()).toBe(1);
    expect(
      await prisma.geoCollectItem.findUnique({ where: { id: itemId } }),
    ).toMatchObject({ status: 'DONE', attempts: 2 });
  });

  it('does not let an expired lease renew itself before takeover', async () => {
    const expiredAt = new Date(Date.now() - 11 * 60_000);
    await prisma.geoCollectRun.update({
      where: { id: run.id },
      data: { heartbeatAt: expiredAt },
    });
    await expect(attempt()).rejects.toThrow('执行权已失效');
    await expect(service.finish(run)).rejects.toThrow('执行权已失效');
    expect(chat).not.toHaveBeenCalled();
    expect(
      (await prisma.geoCollectRun.findUniqueOrThrow({ where: { id: run.id } }))
        .heartbeatAt,
    ).toEqual(expiredAt);
  });

  it.each(['success', 'failure'] as const)(
    'rejects an old worker returning with %s after another worker takes over',
    async (outcome) => {
      const parsing = deferred<void>();
      const oldReply = deferred<GeoChatResult>();
      const replacementParsing = deferred<void>();
      const replacementReply = deferred<GeoChatResult>();
      chat
        .mockImplementationOnce(() => {
          parsing.resolve();
          return oldReply.promise;
        })
        .mockImplementationOnce(() => {
          replacementParsing.resolve();
          return replacementReply.promise;
        });
      // Attach the rejection assertion immediately so delayed failure cannot be unhandled.
      const oldAttempt = expect(attempt()).rejects.toThrow('执行权已失效');
      await parsing.promise;
      await prisma.geoCollectRun.update({
        where: { id: run.id },
        data: { heartbeatAt: new Date(Date.now() - 11 * 60_000) },
      });
      const replacement = new GeoCollectionService(
        prisma as never,
        settings as never,
      );
      const replacementExecution = (
        replacement as unknown as CollectionInternals
      ).executeRun(run.id, window());
      await replacementParsing.promise;
      const ownedByReplacement = await prisma.geoCollectRun.findUniqueOrThrow({
        where: { id: run.id },
      });
      expect(ownedByReplacement.status).toBe('RUNNING');
      expect(ownedByReplacement.claimedBy).not.toBe(run.token);

      if (outcome === 'success') oldReply.resolve(answer());
      else oldReply.reject(new Error('old model request failed'));
      await oldAttempt;
      await expect(service.finish(run)).rejects.toThrow('执行权已失效');
      expect(
        await prisma.geoCollectRun.findUnique({ where: { id: run.id } }),
      ).toEqual(ownedByReplacement);
      expect(await prisma.geoObservation.count()).toBe(0);
      replacementReply.resolve(answer());
      await replacementExecution;
      expect(
        await prisma.geoCollectRun.findUnique({ where: { id: run.id } }),
      ).toMatchObject({ status: 'DONE', done: 1, claimedBy: '' });
      expect(await prisma.geoObservation.count()).toBe(1);
      expect(
        await prisma.geoCollectItem.findUnique({ where: { id: itemId } }),
      ).toMatchObject({ status: 'DONE', attempts: 1, error: '' });
    },
  );

  it('stops a cancelled worker before saving its raw answer or reviving its run', async () => {
    await prisma.geoCollectItem.update({
      where: { id: itemId },
      data: { rawAnswer: null },
    });
    const asking = deferred<void>();
    const oldReply = deferred<GeoChatResult>();
    chat.mockImplementationOnce(() => {
      asking.resolve();
      return oldReply.promise;
    });
    const oldAttempt = expect(attempt()).rejects.toThrow('执行权已失效');
    await asking.promise;
    await collection.setEnabled(project.id, false, 'isolated-geo-test');
    oldReply.resolve(answer('取消后返回的回答'));
    await oldAttempt;
    await expect(service.finish(run)).rejects.toThrow('执行权已失效');
    expect(
      await prisma.geoCollectRun.findUnique({ where: { id: run.id } }),
    ).toMatchObject({ status: 'CANCELLED', claimedBy: '' });
    expect(
      await prisma.geoCollectItem.findUnique({ where: { id: itemId } }),
    ).toMatchObject({ status: 'PENDING', rawAnswer: null, attempts: 0 });
    expect(await prisma.geoObservation.count()).toBe(0);
  });

  it('allows only one of two competing workers to claim and execute a run', async () => {
    await prisma.geoCollectRun.update({
      where: { id: run.id },
      data: { status: 'PENDING', claimedBy: '' },
    });
    const replacement = new GeoCollectionService(
      prisma as never,
      settings as never,
    );
    const other = replacement as unknown as CollectionInternals;
    let newToken = '';
    chat.mockImplementation(async () => {
      newToken = (
        await prisma.geoCollectRun.findUniqueOrThrow({ where: { id: run.id } })
      ).claimedBy;
      return answer();
    });
    await Promise.all([
      service.executeRun(run.id, window()),
      other.executeRun(run.id, window()),
    ]);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(newToken).toMatch(/^[a-f0-9-]{36}$/);
    expect(newToken).not.toBe(run.token);
    expect(await prisma.geoObservation.count()).toBe(1);
    expect(
      await prisma.geoCollectRun.findUnique({ where: { id: run.id } }),
    ).toMatchObject({ status: 'DONE', done: 1, failed: 0 });
  });
  it('yields after five items and completes the remainder in a later round', async () => {
    collection = new GeoCollectionService(prisma as never, settings as never, {
      itemGapMs: 0,
    });
    service = collection as unknown as CollectionInternals;
    for (let n = 0; n < 5; n++) {
      const extra = await prisma.geoQuestion.create({
        data: { projectId: project.id, text: `问题 ${n}` },
      });
      await prisma.geoCollectItem.create({
        data: {
          runId: run.id,
          projectId: project.id,
          questionId: extra.id,
          platform: '豆包',
          rawAnswer: '已有回答',
          modelVersion: 'test-model',
        },
      });
    }
    await prisma.geoCollectRun.update({
      where: { id: run.id },
      data: { status: 'PENDING', claimedBy: '', planned: 6 },
    });
    await service.executeRun(run.id, window());
    expect(
      await prisma.geoCollectItem.count({
        where: { runId: run.id, status: 'DONE' },
      }),
    ).toBe(5);
    expect(
      await prisma.geoCollectRun.findUnique({ where: { id: run.id } }),
    ).toMatchObject({ status: 'PENDING', done: 5, claimedBy: '' });
    await service.executeRun(run.id, window());
    expect(
      await prisma.geoCollectItem.count({
        where: { runId: run.id, status: 'DONE' },
      }),
    ).toBe(6);
    expect(chat).toHaveBeenCalledTimes(6);
  });
  it('renews the lease independently while waiting for a model and returns it on shutdown', async () => {
    collection = new GeoCollectionService(prisma as never, settings as never, {
      heartbeatMs: 10,
      itemGapMs: 0,
    });
    service = collection as unknown as CollectionInternals;
    await prisma.geoCollectRun.update({
      where: { id: run.id },
      data: { status: 'PENDING', claimedBy: '' },
    });
    const started = deferred<void>();
    chat.mockImplementationOnce(
      (input) =>
        new Promise((_resolve, reject) => {
          input.signal?.addEventListener(
            'abort',
            () => reject(new Error('cancelled')),
            { once: true },
          );
          started.resolve();
        }),
    );
    const pending = service.executeRun(run.id, window());
    await started.promise;
    const first = await prisma.geoCollectRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    await new Promise((resolve) => setTimeout(resolve, 45));
    const second = await prisma.geoCollectRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(second.heartbeatAt!.getTime()).toBeGreaterThan(
      first.heartbeatAt!.getTime(),
    );
    await collection.stop(0);
    await pending;
    expect(
      await prisma.geoCollectRun.findUnique({ where: { id: run.id } }),
    ).toMatchObject({ status: 'PENDING', claimedBy: '' });
    expect(
      await prisma.geoObservation.count({ where: { questionId: question.id } }),
    ).toBe(0);
  });
});
