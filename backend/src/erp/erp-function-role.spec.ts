import { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmScopeService, HrmOrg } from '../hrm/hrm.scope';
import type { MechanismService } from '../mechanisms/mechanism.service';
import type { AiEvalService } from '../ai/ai-eval.service';
import { ErpService } from './erp.service';
import { stub } from '../../test/doubles';

/**
 * 设计方案 §四/§3.4：ERP 管理操作按职能域（采购/库存/财务）分别授权，
 * 不再复用 HR 管理角色判断——HR 角色不自动获得采购/财务/库存管理权。
 */

const user = new CurrentUser('u1', '张三', 'member');

const BASE: HrmOrg = {
  orgType: 'ENTERPRISE',
  orgUserId: 'ent-a',
  actorId: 'u1',
  isOwner: false,
  isAdmin: false,
  roles: [],
  positions: [],
  department: '',
};

const orgOf = (overrides: Partial<HrmOrg> = {}): HrmOrg => ({
  ...BASE,
  ...overrides,
});

/** 空请求体只用于探测「职能域鉴权」；放行后会走到各方法自己的业务校验/查空。 */
const ALLOWED_MSG = {
  INVENTORY: '分类不存在',
  PURCHASE: '供应商不存在',
  FINANCE: '请填写税率名称',
} as const;

type Domain = keyof typeof ALLOWED_MSG;

function build(org: HrmOrg) {
  const prisma = {
    erpCategory: { findFirst: jest.fn(async () => null) },
    erpVendor: { findFirst: jest.fn(async () => null) },
  };
  const service = new ErpService(
    stub<PrismaService>(prisma),
    stub<HrmScopeService>({ resolve: jest.fn(async () => org) }),
    stub<MechanismService>({ dispatch: jest.fn(async () => undefined) }),
    stub<AiEvalService>({}),
  );
  return { service, prisma };
}

const call = {
  INVENTORY: (s: ErpService) => s.removeCategory(user, {}),
  PURCHASE: (s: ErpService) => s.removeVendor(user, {}),
  FINANCE: (s: ErpService) => s.saveTaxRate(user, {}),
} satisfies Record<Domain, (s: ErpService) => Promise<unknown>>;

const expectAllowed = (p: Promise<unknown>, domain: Domain) =>
  expect(p).rejects.toThrow(ALLOWED_MSG[domain]);

const expectDenied = (p: Promise<unknown>) =>
  expect(p).rejects.toThrow(/职能权限/);

describe('ERP 职能权限：采购/库存/财务分别授权', () => {
  it('组织主账号可管理全部职能域', async () => {
    const { service } = build(orgOf({ isOwner: true }));
    await expectAllowed(call.INVENTORY(service), 'INVENTORY');
    await expectAllowed(call.PURCHASE(service), 'PURCHASE');
    await expectAllowed(call.FINANCE(service), 'FINANCE');
  });

  it('ERP 管理员角色（ADMIN）可管理全部职能域', async () => {
    const { service } = build(orgOf({ roles: ['ADMIN'] }));
    await expectAllowed(call.INVENTORY(service), 'INVENTORY');
    await expectAllowed(call.PURCHASE(service), 'PURCHASE');
    await expectAllowed(call.FINANCE(service), 'FINANCE');
  });

  it('仅持有 HR 角色的成员没有 ERP 管理权（核心缺陷）', async () => {
    const { service } = build(orgOf({ roles: ['HR'] }));
    await expectDenied(call.INVENTORY(service));
    await expectDenied(call.PURCHASE(service));
    await expectDenied(call.FINANCE(service));
  });

  it('财务角色只能进财务域，进不了采购与库存', async () => {
    const { service } = build(orgOf({ roles: ['FINANCE'] }));
    await expectAllowed(call.FINANCE(service), 'FINANCE');
    await expectDenied(call.INVENTORY(service));
    await expectDenied(call.PURCHASE(service));
  });

  it('采购角色只能进采购域，进不了财务与库存', async () => {
    const { service } = build(orgOf({ roles: ['PURCHASE'] }));
    await expectAllowed(call.PURCHASE(service), 'PURCHASE');
    await expectDenied(call.INVENTORY(service));
    await expectDenied(call.FINANCE(service));
  });

  it('库存角色只能进库存域，进不了采购与财务', async () => {
    const { service } = build(orgOf({ roles: ['INVENTORY'] }));
    await expectAllowed(call.INVENTORY(service), 'INVENTORY');
    await expectDenied(call.PURCHASE(service));
    await expectDenied(call.FINANCE(service));
  });

  it('中文岗位角色码同样生效', async () => {
    const purchasing = build(orgOf({ roles: ['采购'] }));
    await expectAllowed(call.PURCHASE(purchasing.service), 'PURCHASE');
    await expectDenied(call.INVENTORY(purchasing.service));
    const finance = build(orgOf({ roles: ['财务'] }));
    await expectAllowed(call.FINANCE(finance.service), 'FINANCE');
    await expectDenied(call.PURCHASE(finance.service));
  });

  it('岗位名称命中职能域关键词即授权（企业「职能管理」岗位自由命名）', async () => {
    const purchasing = build(orgOf({ positions: ['采购主管'] }));
    await expectAllowed(call.PURCHASE(purchasing.service), 'PURCHASE');
    await expectDenied(call.INVENTORY(purchasing.service));
    await expectDenied(call.FINANCE(purchasing.service));
    const warehouse = build(orgOf({ positions: ['仓库管理员'] }));
    await expectAllowed(call.INVENTORY(warehouse.service), 'INVENTORY');
    await expectDenied(call.PURCHASE(warehouse.service));
    const accounting = build(orgOf({ positions: ['会计'] }));
    await expectAllowed(call.FINANCE(accounting.service), 'FINANCE');
    await expectDenied(call.INVENTORY(accounting.service));
  });

  it('无关岗位名称不授予任何 ERP 职能域', async () => {
    const { service } = build(orgOf({ positions: ['销售代表', '客服'] }));
    await expectDenied(call.INVENTORY(service));
    await expectDenied(call.PURCHASE(service));
    await expectDenied(call.FINANCE(service));
  });

  it('平台管理员身份（非主账号、无职能角色）不自动获得 ERP 管理权', async () => {
    const { service, prisma } = build(orgOf({ isAdmin: true, roles: [] }));
    await expectDenied(call.INVENTORY(service));
    await expectDenied(call.PURCHASE(service));
    await expectDenied(call.FINANCE(service));
    expect(prisma.erpCategory.findFirst).not.toHaveBeenCalled();
    expect(prisma.erpVendor.findFirst).not.toHaveBeenCalled();
  });

  it('被拒时在查库前拦下（不读目标记录）', async () => {
    const { service, prisma } = build(orgOf({ roles: ['HR'] }));
    await expectDenied(call.INVENTORY(service));
    expect(prisma.erpCategory.findFirst).not.toHaveBeenCalled();
    await expectDenied(call.PURCHASE(service));
    expect(prisma.erpVendor.findFirst).not.toHaveBeenCalled();
  });
});
