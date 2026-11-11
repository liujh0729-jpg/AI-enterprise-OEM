import { CurrentUser } from '../auth/current-user';
import { ErrorCode } from '../common/error-code';
import { stub } from '../../test/doubles';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationService } from '../notifications/notification.service';
import { TaskCenterService } from './task-center.service';
import { TaskSourceRegistry } from './task-source.registry';
import type { TaskDraft, TaskSource } from './task-source';

function registryWith(...sources: TaskSource[]) {
  const registry = new TaskSourceRegistry();
  for (const source of sources) registry.register(source);
  return registry;
}

function serviceOf(
  prisma: object,
  notifications: object,
  sources: TaskSource[] = [],
) {
  return new TaskCenterService(
    stub<PrismaService>(prisma),
    registryWith(...sources),
    stub<NotificationService>(notifications),
  );
}

function source(key: string, label: string): TaskSource {
  return { key, label, category: 'task', collect: async () => [] };
}

const user = new CurrentUser('u1', 'u1', 'user');

describe('task center assign', () => {
  it('creates the task and notifies the assignee exactly once', async () => {
    const rows: Record<string, unknown>[] = [];
    const prisma = {
      myTask: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(
            async (input: { data: Record<string, unknown> }) => {
              const row = { id: 1, ...input.data };
              rows.push(row);
              return row;
            },
          ),
      },
    };
    const notify = jest.fn().mockResolvedValue(undefined);
    const service = serviceOf(prisma, { notify });

    const row = await service.assign({
      assigneeUserId: 'u2',
      source: 'crm',
      sourceId: 'crm-appr-1',
      title: '合同待审批',
      link: '/crm?tab=approvals',
      category: 'approval',
      createdBy: 'u3',
    });

    expect(row.id).toBe(1);
    expect(prisma.myTask.create).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      'u2',
      expect.objectContaining({ entityType: 'my_task' }),
    );
  });

  it('is idempotent by dedup key and does not re-notify on refresh', async () => {
    const existing = { id: 9, dedupKey: 'crm:crm-appr-1:u2' };
    const prisma = {
      myTask: {
        findUnique: jest.fn().mockResolvedValue(existing),
        update: jest
          .fn()
          .mockImplementation(
            async (input: { data: Record<string, unknown> }) => ({
              ...existing,
              ...input.data,
            }),
          ),
        create: jest.fn(),
      },
    };
    const notify = jest.fn();
    const service = serviceOf(prisma, { notify });

    await service.assign({
      assigneeUserId: 'u2',
      source: 'crm',
      sourceId: 'crm-appr-1',
      title: '合同待审批',
      link: '/crm?tab=approvals',
      category: 'approval',
    });

    expect(prisma.myTask.create).not.toHaveBeenCalled();
    expect(prisma.myTask.update).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('task center form draft', () => {
  it('表单定义随任务落库', async () => {
    const prisma = {
      myTask: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(
            async (input: { data: Record<string, unknown> }) => ({
              id: 2,
              status: 'OPEN',
              ...input.data,
            }),
          ),
      },
    };
    const service = serviceOf(prisma, {
      notify: jest.fn().mockResolvedValue(undefined),
    });

    await service.assign({
      assigneeUserId: 'u2',
      source: 'workflow',
      sourceId: '5:n-form',
      title: '请填写：客户回访',
      link: '/tasks',
      category: 'matter',
      formSchema: {
        title: '客户回访',
        fields: [{ key: 'result', label: '回访结果', required: true }],
      },
    });

    expect(prisma.myTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        formSchema: {
          title: '客户回访',
          fields: [{ key: 'result', label: '回访结果', required: true }],
        },
      }),
    });
  });
});

describe('task center events', () => {
  const draft = {
    assigneeUserId: 'u2',
    source: 'crm',
    sourceId: 'crm-appr-1',
    title: '合同待审批',
    link: '/crm?tab=approvals',
    category: 'approval',
  };

  it('首次建单发 created，源再次 collect 命中同一行不再发', async () => {
    const existing = { id: 1, dedupKey: 'crm:crm-appr-1:u2', status: 'OPEN' };
    const prisma = {
      myTask: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(existing),
        create: jest
          .fn()
          .mockImplementation(
            async (input: { data: Record<string, unknown> }) => ({
              id: 1,
              status: 'OPEN',
              ...input.data,
            }),
          ),
        update: jest
          .fn()
          .mockImplementation(
            async (input: { data: Record<string, unknown> }) => ({
              ...existing,
              ...input.data,
            }),
          ),
      },
    };
    const events = jest.fn().mockResolvedValue(undefined);
    const service = serviceOf(prisma, {
      notify: jest.fn().mockResolvedValue(undefined),
    });
    service.useTaskEventPort(events);

    await service.assign(draft);
    await service.assign(draft);

    expect(events).toHaveBeenCalledTimes(1);
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'created',
        task: expect.objectContaining({
          id: 1,
          source: 'crm',
          assigneeUserId: 'u2',
        }),
      }),
    );
  });

  it('本人关闭任务发 closed', async () => {
    const row = {
      id: 3,
      source: 'crm',
      sourceId: 'x',
      title: '跟单',
      link: '/crm',
      category: 'matter',
      priority: 'NORMAL',
      status: 'OPEN',
      assigneeUserId: 'u1',
      orgType: '',
      orgUserId: '',
      assigneeType: 'USER',
      assignedBy: '',
      assignedAt: null,
      assignPolicy: 'DIRECT',
      acceptedAt: null,
      createdBy: '',
      dueAt: null,
      closedAt: null,
      closedBy: '',
      closeNote: '',
      createdAt: new Date(),
    };
    const prisma = {
      myTask: {
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest
          .fn()
          .mockImplementation(
            async (input: { data: Record<string, unknown> }) => ({
              ...row,
              ...input.data,
            }),
          ),
      },
    };
    const events = jest.fn().mockResolvedValue(undefined);
    const service = serviceOf(prisma, { notify: jest.fn() });
    service.useTaskEventPort(events);

    await service.close(user, '3', {});

    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'closed',
        task: expect.objectContaining({ id: 3, status: 'DONE' }),
      }),
    );
  });

  it('逾期扫描只取回看窗口内的未办任务并发 overdue', async () => {
    const rows = [
      {
        id: 5,
        source: 'crm',
        assigneeUserId: 'u2',
        orgType: '',
        orgUserId: '',
        title: '逾期跟单',
        status: 'OPEN',
        link: '/crm',
      },
    ];
    const prisma = {
      myTask: { findMany: jest.fn().mockResolvedValue(rows) },
    };
    const events = jest.fn().mockResolvedValue(undefined);
    const service = serviceOf(prisma, { notify: jest.fn() });
    service.useTaskEventPort(events);

    const count = await service.sweepOverdue(600_000);

    expect(count).toBe(1);
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'overdue',
        task: expect.objectContaining({ id: 5 }),
      }),
    );
    expect(prisma.myTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['OPEN', 'DOING'] },
          dueAt: expect.objectContaining({ not: null }),
        }),
      }),
    );
  });
});

describe('task center form submit', () => {
  const formSchema = {
    title: '客户回访',
    fields: [
      { key: 'result', label: '回访结果', required: true },
      { key: 'next', label: '下次跟进', required: false },
    ],
  };
  const row = {
    id: 7,
    source: 'workflow',
    sourceId: '5:n-form',
    title: '请填写：客户回访',
    link: '/tasks',
    category: 'matter',
    priority: 'NORMAL',
    status: 'OPEN',
    assigneeUserId: 'u1',
    orgType: '',
    orgUserId: '',
    assigneeType: 'USER',
    assignedBy: '',
    assignedAt: null,
    assignPolicy: 'DIRECT',
    acceptedAt: null,
    createdBy: 'u1',
    dueAt: null,
    closedAt: null,
    closedBy: '',
    closeNote: '',
    formSchema,
    formData: null,
    createdAt: new Date(),
  };

  function setup(taskRow: Record<string, unknown>) {
    const prisma = {
      myTask: {
        findUnique: jest.fn().mockResolvedValue(taskRow),
        update: jest
          .fn()
          .mockImplementation(
            async (input: { data: Record<string, unknown> }) => ({
              ...taskRow,
              ...input.data,
            }),
          ),
      },
    };
    const onClosed = jest.fn().mockResolvedValue(undefined);
    const service = serviceOf(prisma, { notify: jest.fn() }, [
      { ...source('workflow', '工作流'), onClosed },
    ]);
    const events = jest.fn().mockResolvedValue(undefined);
    service.useTaskEventPort(events);
    return { prisma, service, onClosed, events };
  }

  it('缺必填时不落库、不关闭任务', async () => {
    const { prisma, service, onClosed } = setup(row);

    await expect(
      service.submitForm(user, '7', { values: { next: '明天再联系' } }),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.BAD_REQUEST,
      message: '请填写「回访结果」',
    });
    expect(prisma.myTask.update).not.toHaveBeenCalled();
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('提交后写入 formData、关闭任务并唤醒源流程', async () => {
    const { prisma, service, onClosed, events } = setup(row);

    const result = await service.submitForm(user, '7', {
      values: { result: '已成交', next: '  ' },
    });

    expect(result.status).toBe('DONE');
    expect(result.formData).toEqual({ result: '已成交' });
    expect(prisma.myTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          formData: { result: '已成交' },
          status: 'DONE',
          closedBy: 'u1',
        }),
      }),
    );
    expect(onClosed).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: '5:n-form' }),
      '',
    );
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'closed',
        task: expect.objectContaining({ id: 7 }),
      }),
    );
  });

  it('非表单任务与已关闭任务都不能提交', async () => {
    const plain = setup({ ...row, formSchema: null });
    await expect(
      plain.service.submitForm(user, '7', { values: {} }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.BAD_REQUEST });

    const closed = setup({ ...row, status: 'DONE' });
    await expect(
      closed.service.submitForm(user, '7', { values: { result: 'x' } }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.BAD_REQUEST });
  });
});

describe('task center refresh reconciliation', () => {
  function listPrisma(updateMany: jest.Mock) {
    return {
      myTask: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany,
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
  }

  it('对账以全量拉取为准：缺失的历史待办被置完成', async () => {
    const collect = jest.fn(async () => [] as TaskDraft[]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = serviceOf(listPrisma(updateMany), { notify: jest.fn() }, [
      { key: 'oa', label: 'OA 审批', category: 'approval', collect },
    ]);

    await service.list(user, {});

    // 关键：对账请求的是全量（full=true），不能拿「单次分页」的缺失判定办结。
    expect(collect).toHaveBeenCalledWith(user, { full: true });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source: 'oa',
          status: { in: ['OPEN', 'DOING'] },
        }),
        data: expect.objectContaining({ status: 'DONE' }),
      }),
    );
  });

  it('Push 源不参与「缺失即办结」的对账', async () => {
    const collect = jest.fn(async () => [] as TaskDraft[]);
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const service = serviceOf(listPrisma(updateMany), { notify: jest.fn() }, [
      {
        key: 'workflow',
        label: '工作流',
        category: 'task',
        push: true,
        collect,
      },
    ]);

    await service.list(user, {});

    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('task center summary', () => {
  it('counts pending/due/overdue/closed and groups unclosed by category and source', async () => {
    const now = Date.now();
    const prisma = {
      myTask: {
        count: jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(1),
        findMany: jest.fn().mockResolvedValue([
          { status: 'OPEN', category: 'approval', source: 'oa', dueAt: null },
          {
            status: 'DOING',
            category: 'task',
            source: 'workflow',
            dueAt: null,
          },
          {
            status: 'OPEN',
            category: 'matter',
            source: 'crm',
            dueAt: new Date(now - 60_000),
          },
          { status: 'DONE', category: 'approval', source: 'oa', dueAt: null },
          { status: 'CANCELED', category: 'task', source: 'pj', dueAt: null },
        ]),
      },
    };
    const service = serviceOf(prisma, { notify: jest.fn() }, [
      source('oa', 'OA 审批'),
      source('workflow', '工作流'),
      source('crm', 'CRM'),
      source('pj', '项目管理'),
    ]);

    const summary = await service.summary(user, true);

    expect(summary.pending).toBe(3);
    expect(summary.doing).toBe(1);
    expect(summary.overdue).toBe(1);
    expect(summary.closed).toBe(2);
    expect(summary.orgPending).toBe(2);
    expect(summary.unassigned).toBe(1);
    expect(summary.total).toBe(5);
    expect(summary.byCategory).toEqual([
      { key: 'approval', label: '审批', count: 1 },
      { key: 'report', label: '汇报', count: 0 },
      { key: 'task', label: '任务', count: 1 },
      { key: 'matter', label: '事务', count: 1 },
      { key: 'audit', label: '审核', count: 0 },
    ]);
    expect(summary.bySource).toEqual([
      { key: 'oa', label: 'OA 审批', count: 1 },
      { key: 'workflow', label: '工作流', count: 1 },
      { key: 'crm', label: 'CRM', count: 1 },
    ]);
  });
});
