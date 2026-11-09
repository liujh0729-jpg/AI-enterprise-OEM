import { App } from 'antd';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CustomersTab } from './crm-parties';

const mocks = vi.hoisted(() => ({
  customers: vi.fn(),
  members: vi.fn(),
  customer360: vi.fn(),
  scrmContacts: vi.fn(),
}));

vi.mock('@/api/crm', () => ({
  crmApi: new Proxy(
    {
      customers: mocks.customers,
      members: mocks.members,
      customer360: mocks.customer360,
    },
    {
      get: (target, key) =>
        target[key as keyof typeof target] ?? vi.fn(async () => null),
    },
  ),
}));

vi.mock('@/api/scrm', () => ({
  scrmContactApi: new Proxy(
    { contacts: mocks.scrmContacts },
    {
      get: (target, key) =>
        target[key as keyof typeof target] ?? vi.fn(async () => null),
    },
  ),
}));

vi.mock('@/app/oa/_components/oa-launch-button', () => ({
  OaLaunchButton: () => null,
}));

const customer = {
  id: 7,
  name: '苏州精工制造',
  ownerId: 'u1',
  ownerName: '李明',
  poolId: 0,
  poolName: '',
  inPool: false,
  collectionAt: '',
  lastFollowAt: '',
  frozen: false,
  freezeReason: '',
  approvalStatus: 'APPROVED',
  approvalStatusLabel: '已通过',
  industry: '制造业',
  province: '江苏',
  city: '苏州',
  contactCount: 1,
  opportunityCount: 0,
  contractAmount: '0',
  custom: {},
  remark: '',
  createdAt: '2026-10-01T00:00:00.000Z',
};

const contact = {
  id: 1,
  customerId: 7,
  name: '张经理',
  phone: '13800000000',
  email: 'zhang@example.com',
  title: '采购经理',
  ownerId: 'u1',
  ownerName: '李明',
  enabled: true,
  disableReason: '',
  custom: {},
  createdAt: '2026-10-01T00:00:00.000Z',
};

describe('CustomersTab 客户 360', () => {
  it('opens the 360 drawer with contacts and WeCom tabs', async () => {
    mocks.customers.mockResolvedValue({ list: [customer], total: 1 });
    mocks.members.mockResolvedValue({ rows: [] });
    mocks.customer360.mockResolvedValue({
      customer,
      contacts: [contact],
      collaborations: [],
      relations: [],
      opportunities: [],
      contracts: [],
      paymentPlans: [],
      paymentRecords: [],
      invoices: [],
      orders: [],
      follows: [],
      plans: [],
      ownerHistory: [],
      titles: [],
    });
    mocks.scrmContacts.mockResolvedValue({ list: [], total: 0 });

    render(
      <App>
        <CustomersTab customers={[{ id: 7, name: '苏州精工制造' }]} />
      </App>,
    );

    fireEvent.click(await screen.findByText('360'));

    expect(await screen.findByText('企微（0）')).toBeTruthy();
    expect(screen.getByText('联系人（1）')).toBeTruthy();
    expect(screen.getByText('张经理')).toBeTruthy();
    expect(mocks.customer360).toHaveBeenCalledWith({ params: { id: '7' } });
    expect(mocks.scrmContacts).toHaveBeenCalledWith({
      query: { page: 1, pageSize: 50, crmCustomerId: 7 },
    });
  });
});
