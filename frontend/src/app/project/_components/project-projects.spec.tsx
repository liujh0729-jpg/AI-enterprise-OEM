import { App } from 'antd';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PjProjectsTab } from './project-projects';

const mocks = vi.hoisted(() => ({
  projects: vi.fn(),
  project: vi.fn(),
  sprints: vi.fn(),
  milestones: vi.fn(),
  tasks: vi.fn(),
  projectCost: vi.fn(),
}));

vi.mock('@/api/project', () => ({
  projectApi: new Proxy(mocks, {
    get: (target, key) =>
      target[key as keyof typeof target] ?? vi.fn(async () => null),
  }),
}));

const project = {
  id: 5,
  code: 'PJ-2027-01',
  name: '华东交付项目',
  description: '制造业客户交付',
  source: 'MANUAL' as const,
  sourceRef: '',
  customerName: '苏州精工制造',
  contractId: 0,
  ownerId: 'u1',
  ownerName: '李明',
  status: 'ACTIVE',
  startDate: '2027-01-01',
  endDate: '2027-06-30',
  budgetAmount: '800000',
  budgetHours: '1200',
  currency: 'CNY',
  memberCount: 1,
  taskTotal: 2,
  taskDone: 1,
  progress: 50,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

const task = {
  id: 31,
  projectId: 5,
  projectName: '华东交付项目',
  sprintId: 0,
  milestoneId: 0,
  parentId: 0,
  title: '设备进场验收',
  description: '',
  sourceType: 'MANUAL',
  sourceId: '',
  acceptanceCriteria: [
    { key: 'a', label: '验收单已签字', required: true, evidence: '' },
  ],
  qualityRubric: {},
  assessmentWeight: '60',
  type: 'DELIVERY',
  priority: 'HIGH',
  status: 'DONE',
  assigneeType: 'STAFF',
  assigneeId: 'u2',
  assigneeName: '王工',
  estimateHours: '8',
  estimatePoints: 3,
  startDate: '2027-01-02',
  dueDate: '2027-01-10',
  completedAt: '2027-01-09',
  sortOrder: 0,
  loggedMinutes: 480,
  relations: [],
  createdAt: '2027-01-01T00:00:00.000Z',
  updatedAt: '2027-01-09T00:00:00.000Z',
};

describe('PjProjectsTab 项目 360', () => {
  it('opens the detail drawer with delivery and cost summaries', async () => {
    mocks.projects.mockResolvedValue({ list: [project], total: 1 });
    mocks.project.mockResolvedValue({
      ...project,
      members: [
        {
          id: 1,
          principalType: 'STAFF',
          principalId: 'u1',
          name: '李明',
          role: 'OWNER',
          allocationPct: 100,
          createdAt: '2026-11-01T00:00:00.000Z',
        },
      ],
      milestones: [],
    });
    mocks.sprints.mockResolvedValue([]);
    mocks.milestones.mockResolvedValue([]);
    mocks.tasks.mockResolvedValue({ list: [task], total: 1 });
    mocks.projectCost.mockResolvedValue({
      projectId: 5,
      currency: 'CNY',
      budgetAmount: '800000',
      budgetHours: '1200',
      costTotal: '320000',
      budgetUtilizationPct: 40,
      laborAmount: '200000',
      materialAmount: '60000',
      equipmentAmount: '20000',
      externalAmount: '40000',
      otherAmount: '0',
      timeLogMinutes: 6000,
      timeLogHours: '100',
      missingRateMinutes: 0,
      engagementAmount: '40000',
      engagementCount: 1,
      settledEngagementCount: 0,
      costItemCount: 2,
      byKind: [
        { kind: 'LABOR', label: '人力', items: 1, amount: '200000' },
        { kind: 'EXTERNAL', label: '外部合作', items: 1, amount: '40000' },
      ],
    });

    render(
      <App>
        <PjProjectsTab staff={[]} />
      </App>,
    );

    fireEvent.click(await screen.findByText('详情'));

    fireEvent.click(await screen.findByText('交付'));
    expect(await screen.findByText('任务总数')).toBeTruthy();
    expect(screen.getByText('设备进场验收')).toBeTruthy();

    fireEvent.click(screen.getByText('成本'));
    expect(await screen.findByText('已发生成本')).toBeTruthy();
    expect(screen.getAllByText('外部合作').length).toBeGreaterThan(0);
    expect(screen.getByText('1 单 / 已结算 0')).toBeTruthy();
    expect(mocks.project).toHaveBeenCalledWith({ params: { id: 5 } });
  });
});
