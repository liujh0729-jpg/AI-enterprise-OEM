import { App } from 'antd';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OkrBriefView } from '@enterprise/contracts';
import { OkrDecompositionTab } from './okr-decomposition';
import type { OkrContextData } from './okr-common';
import { stub } from '../../../test/doubles';

const mocks = vi.hoisted(() => ({
  briefs: vi.fn(),
  dialogTurns: vi.fn(),
  decompositions: vi.fn(),
  taskLinks: vi.fn(),
}));

vi.mock('@/api/okr', () => ({
  okrApi: new Proxy(mocks, {
    get: (target, key) =>
      target[key as keyof typeof target] ?? vi.fn(async () => null),
  }),
}));

vi.mock('@/api/project', () => ({
  projectApi: new Proxy({}, { get: () => vi.fn(async () => null) }),
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
  objectives: [],
  members: [],
});

describe('OkrDecompositionTab AI 拆解', () => {
  it('loads the brief and shows clarification plus candidate panels', async () => {
    mocks.briefs.mockResolvedValue([brief]);
    mocks.dialogTurns.mockResolvedValue([
      {
        id: 1,
        role: 'ASSISTANT',
        content: '请补充目标客户与预算边界',
        structured: {},
        createdAt: '2026-11-02T00:00:00.000Z',
      },
    ]);
    mocks.decompositions.mockResolvedValue([]);
    mocks.taskLinks.mockResolvedValue([]);

    render(
      <App>
        <OkrDecompositionTab ctx={ctx} />
      </App>,
    );

    expect(screen.getAllByText('AI 拆解').length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(screen.getByText('华东区新签增长 40%')).toBeTruthy(),
    );
    expect(screen.getByText('互动澄清')).toBeTruthy();
    expect(screen.getByText('拆解方案')).toBeTruthy();
    // 对话轮次与目标书是两条独立请求，问题文本要用 findByText 等它落渲染，避免并发跑时抖。
    expect(
      await screen.findByText('请补充目标客户与预算边界'),
    ).toBeTruthy();
    expect(screen.getByText('AI 顾问')).toBeTruthy();
    expect(mocks.dialogTurns).toHaveBeenCalledWith({ params: { id: '11' } });
  });
});
