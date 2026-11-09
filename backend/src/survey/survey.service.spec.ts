import { BusinessException } from '../common/business.exception';
import { CurrentUser } from '../auth/current-user';
import { SurveyService } from './survey.service';
import { stub } from '../../test/doubles';
import type { PrismaService } from '../prisma/prisma.service';
import type { DataTableService } from '../data-table/data-table.service';
import type { IdentityService } from '../identity/identity.service';

const user = new CurrentUser('u1', 'unit', 'enterprise');

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  code: 'abc123def456',
  createdBy: 'u1',
  title: '客户满意度',
  description: '',
  status: 'DRAFT',
  questions: [
    {
      id: 'q1',
      label: '满意吗',
      type: 'single',
      required: true,
      options: ['满意', '一般'],
      min: 1,
      max: 5,
    },
  ],
  settings: { allowMultiple: true, thankYouText: '谢谢' },
  tableId: 9,
  responseCount: 0,
  publishedAt: null,
  closedAt: null,
  createdAt: new Date('2026-11-07T00:00:00.000Z'),
  updatedAt: new Date('2026-11-07T00:00:00.000Z'),
  ...overrides,
});

function build() {
  const prisma = {
    marketingSurvey: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
    dataTableField: { findMany: jest.fn() },
    dataTableRow: { count: jest.fn(), findMany: jest.fn() },
  };
  const dataTables = {
    create: jest.fn(),
    addFields: jest.fn(),
    remove: jest.fn().mockResolvedValue({ id: 9, deleted: true }),
    appendSystemRow: jest.fn(),
    updateField: jest.fn(),
    deleteField: jest.fn(),
  };
  const identity = { audit: jest.fn() };
  const service = new SurveyService(
    stub<PrismaService>(prisma),
    stub<DataTableService>(dataTables),
    stub<IdentityService>(identity),
  );
  return { service, prisma, dataTables, identity };
}

describe('SurveyService', () => {
  it('创建问卷时先建回收表，再按题目建列并落问卷', async () => {
    const { service, prisma, dataTables } = build();
    dataTables.create.mockResolvedValue({ id: 9 });
    prisma.marketingSurvey.create.mockResolvedValue(row());
    const survey = await service.create(user, {
      title: '客户满意度',
      description: '',
      questions: [
        {
          label: '满意吗',
          type: 'single',
          required: true,
          options: ['满意', '一般'],
          min: 1,
          max: 5,
        },
      ],
      settings: {},
    });
    expect(dataTables.create).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ name: '问卷回收·客户满意度' }),
    );
    expect(dataTables.addFields).toHaveBeenCalledWith(user, 9, [
      expect.objectContaining({ fieldKey: 'q1', fieldType: 'select' }),
    ]);
    expect(prisma.marketingSurvey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tableId: 9, status: 'DRAFT' }),
    });
    expect(survey.sharePath).toBe('/survey/abc123def456');
  });

  it('建列失败时回滚刚建的回收表', async () => {
    const { service, prisma, dataTables } = build();
    dataTables.create.mockResolvedValue({ id: 9 });
    dataTables.addFields.mockRejectedValue(new Error('boom'));
    await expect(
      service.create(user, {
        title: '问卷',
        description: '',
        questions: [
          {
            label: '题',
            type: 'short_text',
            required: false,
            options: [],
            min: 1,
            max: 5,
          },
        ],
        settings: {},
      }),
    ).rejects.toThrow('boom');
    expect(dataTables.remove).toHaveBeenCalledWith(user, 9);
    expect(prisma.marketingSurvey.create).not.toHaveBeenCalled();
  });

  it('发布后或已有回收时不允许改题目', async () => {
    const { service, prisma } = build();
    prisma.marketingSurvey.findUnique.mockResolvedValue(
      row({ status: 'PUBLISHED', responseCount: 2 }),
    );
    await expect(
      service.update(user, 1, {
        questions: [
          {
            id: 'q1',
            label: '改过的题',
            type: 'short_text',
            required: false,
            options: [],
            min: 1,
            max: 5,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it('公开提交按题目收口后写入回收表并累加回收数', async () => {
    const { service, prisma, dataTables } = build();
    prisma.marketingSurvey.findUnique.mockResolvedValue(
      row({ status: 'PUBLISHED' }),
    );
    dataTables.appendSystemRow.mockResolvedValue({ id: 77 });
    const result = await service.submit('abc123def456', { q1: '满意' });
    expect(dataTables.appendSystemRow).toHaveBeenCalledWith(
      9,
      { q1: '满意' },
      'survey:abc123def456',
    );
    expect(prisma.marketingSurvey.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { responseCount: { increment: 1 } },
    });
    expect(result).toEqual({
      submitted: true,
      responseId: 77,
      thankYouText: '谢谢',
    });
  });

  it('已结束的问卷拒绝提交；草稿不对外暴露', async () => {
    const { service, prisma } = build();
    prisma.marketingSurvey.findUnique.mockResolvedValue(
      row({ status: 'CLOSED' }),
    );
    await expect(service.submit('abc123def456', {})).rejects.toThrow(/结束/);
    prisma.marketingSurvey.findUnique.mockResolvedValue(row());
    await expect(service.publicView('abc123def456')).rejects.toThrow(
      /尚未发布/,
    );
  });

  it('关闭后重复提交：不允许重复填写的问卷按 cookie 拒绝', async () => {
    const { service, prisma } = build();
    prisma.marketingSurvey.findUnique.mockResolvedValue(
      row({
        status: 'PUBLISHED',
        settings: { allowMultiple: false, thankYouText: '谢谢' },
      }),
    );
    await expect(
      service.submit('abc123def456', { q1: '满意' }, { seenBefore: true }),
    ).rejects.toThrow(/已经提交/);
  });
});
