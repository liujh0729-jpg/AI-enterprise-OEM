import { App } from 'antd';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OkrBriefView } from '@enterprise/contracts';
import { OkrBriefsTab } from './okr-briefs';
import type { OkrContextData } from './okr-common';
import { stub } from '../../../test/doubles';

const mocks = vi.hoisted(() => ({
  briefs: vi.fn(),
}));

vi.mock('@/api/okr', () => ({
  okrApi: new Proxy(mocks, {
    get: (target, key) =>
      target[key as keyof typeof target] ?? vi.fn(async () => null),
  }),
}));

const brief: OkrBriefView = {
  id: 11,
  cycleId: 3,
  title: '2027 华东增长目标书',
  businessGoal: '华东区新签增长 40%',
  scopeWhat: '苏州 / 上海制造业客户',
  scopeTarget: '新签合同 4000 万',
  deliverables: [],
  startDate: '2027-01-01',
  endDate: '2027-12-31',
  budgetAmount: 800_000,
  budgetHours: 1200,
  currency: 'CNY',
  labor: [],
  materials: [],
  equipment: [],
  externalServices: [],
  constraints: '',
  status: 'DRAFT',
  statusLabel: '草稿',
  createdBy: 'u1',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  readiness: { blockers: [], warnings: [] },
};

const ctx = stub<OkrContextData>({
  cycle: { id: 3 },
  cycles: [{ id: 3 }],
});

describe('OkrBriefsTab 目标书', () => {
  it('renders the brief list with iron-triangle summary', async () => {
    mocks.briefs.mockResolvedValue([brief]);
    const onDecompose = vi.fn();

    render(
      <App>
        <OkrBriefsTab ctx={ctx} onDecompose={onDecompose} />
      </App>,
    );

    expect(screen.getAllByText('目标书').length).toBeGreaterThan(0);
    expect(screen.getByText('新建目标书')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText('2027 华东增长目标书')).toBeTruthy(),
    );
    expect(screen.getByText('800000 CNY')).toBeTruthy();
    expect(screen.getByText('2027-01-01 ~ 2027-12-31')).toBeTruthy();
    expect(mocks.briefs).toHaveBeenCalledTimes(1);
  });
});
