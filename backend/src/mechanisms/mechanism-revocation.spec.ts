import { CurrentUser } from '../auth/current-user';
import type { AccountCrypto } from '../account/account-crypto';
import type { HrmScopeService } from '../hrm/hrm.scope';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import type { NotificationService } from '../notifications/notification.service';
import { stub } from '../../test/doubles';
import { MechanismExportService } from './mechanism-export.service';
import { MechanismShareService } from './mechanism-share.service';

const USER = new CurrentUser('u1', '张三', 'member');
// MechanismBase 里初始化 IM 加密器需要独立密钥来源，单测用全零占位。
process.env.EXTERNAL_CRED_KEY = process.env.EXTERNAL_CRED_KEY || '0'.repeat(64);
const ORG = {
  orgType: 'ENTERPRISE',
  orgUserId: 'ent-a',
  actorId: 'u1',
  isOwner: false,
  isAdmin: false,
  department: '',
};

function build(standing: boolean) {
  const exportRead = jest.fn(async () => Buffer.from('id,name\n1,甲\n'));
  const prisma = {
    exportJob: {
      findFirst: jest.fn(async () => ({
        id: 7,
        module: 'erp_product',
        format: 'csv',
        fileKey: 'exports/ent-a/7.csv',
      })),
    },
    publicShare: {
      findUnique: jest.fn(async () => ({
        id: 3,
        slug: 'abcdefgh',
        kind: 'DOC',
        targetId: '1',
        title: '季度报表',
        projection: ['name'],
        enabled: true,
        passwordHash: '',
        expiresAt: new Date(Date.now() + 86_400_000),
        viewCount: 0,
        orgType: 'ENTERPRISE',
        orgUserId: 'ent-a',
        createdBy: 'u1',
      })),
      update: jest.fn(async () => ({})),
    },
  };
  const scope = {
    resolve: jest.fn(async () => ORG),
    isStanding: jest.fn(async () => standing),
    requireAdmin: jest.fn(),
  };
  const deps = [
    stub<PrismaService>(prisma),
    stub<HrmScopeService>(scope),
    stub<AccountCrypto>({}),
    stub<StorageService>({ read: exportRead }),
    stub<NotificationService>({}),
    jest.fn(),
  ] as const;
  return {
    exporter: new MechanismExportService(...deps),
    shares: new MechanismShareService(...deps),
    prisma,
    scope,
    exportRead,
  };
}

describe('导出文件的认证下载', () => {
  it('离职后即使用旧链接也取不到内容', async () => {
    const ctx = build(false);
    await expect(ctx.exporter.download(USER, '7')).rejects.toThrow(
      /导出文件不存在或已失效/,
    );
    expect(ctx.prisma.exportJob.findFirst).not.toHaveBeenCalled();
    expect(ctx.exportRead).not.toHaveBeenCalled();
  });

  it('在册时按当前组织取文件内容', async () => {
    const ctx = build(true);
    const out = await ctx.exporter.download(USER, '7');
    expect(out).toMatchObject({
      id: 7,
      module: 'erp_product',
      format: 'csv',
      fileName: 'erp_product-7.csv',
    });
    expect(out.content).toContain('甲');
    expect(ctx.prisma.exportJob.findFirst).toHaveBeenCalledWith({
      where: { id: 7, orgType: 'ENTERPRISE', orgUserId: 'ent-a' },
    });
  });
});

describe('旧公开分享的在册复核', () => {
  it('创建人离职后分享立即失效，且不泄露失效原因', async () => {
    const ctx = build(false);
    await expect(ctx.shares.publicView('abcdefgh')).rejects.toThrow(
      /分享不存在或已关闭/,
    );
    expect(ctx.prisma.publicShare.update).not.toHaveBeenCalled();
  });

  it('在册时正常返回投影并累计浏览', async () => {
    const ctx = build(true);
    const out = await ctx.shares.publicView('abcdefgh');
    expect(out.slug).toBe('abcdefgh');
    expect(ctx.prisma.publicShare.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { viewCount: { increment: 1 } },
    });
  });
});
