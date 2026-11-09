import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { UserLookupService } from '../directory/user-lookup.service';
import { PrismaService } from '../prisma/prisma.service';

type ShareRow = {
  id: number;
  ownerUserId: string;
  assetId: string;
  assetName: string;
  assetType: string;
  assetSize: number;
  assetUrl: string;
  targetUserId: string;
  createdAt: Date;
};

/** 共享范围：已认证企业，或服务商（负责人与其在职职员之间）。 */
type ShareOrg = {
  orgType: 'ENTERPRISE' | 'PROVIDER';
  orgUserId: string;
  name: string;
};

/**
 * 共享资料：把 AIPDD 数字资产按账号共享给同一组织内的用户（多选＝多行）。
 * 组织口径：已认证企业（企业主与在职成员），或服务商（服务商与其在职职员）。
 * 资产本身仍只在 AIPDD 平台上，本表只记共享关系；文件归属仍是上传它的账号。
 */
export class AssetShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserLookupService,
  ) {}

  /** 企业主体：企业主本人，或该企业下在职成员所属的企业（成员之间可互发）。 */
  private async enterpriseOf(userId: string) {
    const own = await this.prisma.enterpriseProfile.findFirst({
      where: { userId, status: 'APPROVED' },
      select: { userId: true, name: true },
    });
    if (own) return own;
    const member = await this.prisma.orgStaff.findFirst({
      where: { orgType: 'ENTERPRISE', memberUserId: userId, status: 'ACTIVE' },
      orderBy: { id: 'asc' },
      select: { orgUserId: true },
    });
    if (!member) return null;
    return this.prisma.enterpriseProfile.findFirst({
      where: { userId: member.orgUserId, status: 'APPROVED' },
      select: { userId: true, name: true },
    });
  }

  /**
   * 服务商主体：负责人（有在册职员或备案记录），或其属下在职职员所属的服务商。
   * 服务商靠 provider_staff 挂靠关系认定，不以平台备案审核状态为准——内部共享资料与对外展示无关。
   */
  private async providerOf(userId: string): Promise<ShareOrg | null> {
    const [staffRow, application] = await Promise.all([
      this.prisma.providerStaff.findFirst({
        where: { providerUserId: userId, status: 'ACTIVE' },
        select: { id: true },
      }),
      this.prisma.providerApplication.findFirst({
        where: { userId },
        orderBy: { id: 'desc' },
        select: { orgName: true },
      }),
    ]);
    if (staffRow || application) {
      return {
        orgType: 'PROVIDER',
        orgUserId: userId,
        name: text(application?.orgName),
      };
    }
    const [member, legacy] = await Promise.all([
      this.prisma.orgStaff.findFirst({
        where: {
          orgType: 'PROVIDER',
          memberUserId: userId,
          status: 'ACTIVE',
        },
        orderBy: { id: 'asc' },
        select: { orgUserId: true },
      }),
      this.prisma.providerStaff.findFirst({
        where: { staffUserId: userId, status: 'ACTIVE' },
        orderBy: { id: 'asc' },
        select: { providerUserId: true },
      }),
    ]);
    const orgUserId = member?.orgUserId || legacy?.providerUserId;
    if (!orgUserId) return null;
    const owner = await this.prisma.providerApplication.findFirst({
      where: { userId: orgUserId },
      orderBy: { id: 'desc' },
      select: { orgName: true },
    });
    return {
      orgType: 'PROVIDER',
      orgUserId,
      name: text(owner?.orgName),
    };
  }

  /** 组织口径：企业优先（保持原行为），其次服务商。 */
  private async orgOf(userId: string): Promise<ShareOrg | null> {
    const enterprise = await this.enterpriseOf(userId);
    if (enterprise) {
      return {
        orgType: 'ENTERPRISE',
        orgUserId: enterprise.userId,
        name: enterprise.name,
      };
    }
    return this.providerOf(userId);
  }

  /** 组织在职成员（含负责人本人）：企业读 `org_staff`；服务商合并新旧两张挂靠表。 */
  private async membersOf(
    org: ShareOrg,
  ): Promise<{ userId: string; department: string }[]> {
    if (org.orgType === 'ENTERPRISE') {
      const rows = await this.prisma.orgStaff.findMany({
        where: {
          orgType: 'ENTERPRISE',
          orgUserId: org.orgUserId,
          status: 'ACTIVE',
        },
        orderBy: { id: 'asc' },
        select: { memberUserId: true, department: true },
      });
      return rows.map((row) => ({
        userId: row.memberUserId,
        department: row.department || '',
      }));
    }
    const [rows, legacyRows] = await Promise.all([
      this.prisma.orgStaff.findMany({
        where: {
          orgType: 'PROVIDER',
          orgUserId: org.orgUserId,
          status: 'ACTIVE',
        },
        orderBy: { id: 'asc' },
        select: { memberUserId: true, department: true },
      }),
      this.prisma.providerStaff.findMany({
        where: { providerUserId: org.orgUserId, status: 'ACTIVE' },
        orderBy: { id: 'asc' },
        select: { staffUserId: true, department: true },
      }),
    ]);
    const merged = new Map<string, string>();
    for (const row of [
      ...legacyRows.map((item) => ({
        userId: item.staffUserId,
        department: item.department,
      })),
      ...rows.map((item) => ({
        userId: item.memberUserId,
        department: item.department,
      })),
    ]) {
      if (!merged.get(row.userId)) merged.set(row.userId, row.department || '');
    }
    return [...merged].map(([userId, department]) => ({ userId, department }));
  }

  /** 共享目标＝同组织内**其他**账号（负责人 + 在职成员，不含本人：共享给自己没有意义）。 */
  async targets(user: CurrentUser) {
    const org = await this.orgOf(user.userId);
    if (!org) {
      return { orgName: '', users: [] };
    }
    const members = await this.membersOf(org);
    const ids = [
      ...new Set([org.orgUserId, ...members.map((item) => item.userId)]),
    ].filter((userId) => userId !== user.userId);
    const [directory, profiles] = await Promise.all([
      ids.length ? this.users.lookup(ids) : Promise.resolve([]),
      this.prisma.staffProfile.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, realName: true, phone: true },
      }),
    ]);
    const dir = new Map(directory.map((item) => [item.id, item]));
    const prof = new Map(profiles.map((item) => [item.userId, item]));
    const departmentOf = new Map(
      members.map((item) => [item.userId, item.department]),
    );
    return {
      orgName: org.name,
      users: ids.map((userId) => ({
        userId,
        name:
          text(prof.get(userId)?.realName) ||
          text(dir.get(userId)?.displayName) ||
          text(dir.get(userId)?.username) ||
          userId,
        phone: text(prof.get(userId)?.phone),
        department: departmentOf.get(userId) || '',
      })),
    };
  }

  private view(
    row: ShareRow,
    direction: 'SENT' | 'RECEIVED',
    names: Map<string, string>,
  ) {
    return {
      id: row.id,
      direction,
      ownerUserId: row.ownerUserId,
      ownerName: names.get(row.ownerUserId) || row.ownerUserId,
      targetUserId: row.targetUserId,
      targetName: names.get(row.targetUserId) || row.targetUserId,
      assetId: row.assetId,
      assetName: row.assetName,
      assetType: row.assetType,
      assetSize: Number(row.assetSize || 0),
      assetUrl: row.assetUrl,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(user: CurrentUser) {
    const rows = (await this.prisma.contentSharedAsset.findMany({
      where: {
        OR: [{ ownerUserId: user.userId }, { targetUserId: user.userId }],
      },
      orderBy: { id: 'desc' },
      take: 500,
    })) as ShareRow[];
    const ids = [
      ...new Set(
        rows
          .flatMap((row) => [row.ownerUserId, row.targetUserId])
          .filter(Boolean),
      ),
    ];
    const directory = ids.length ? await this.users.lookup(ids) : [];
    const names = new Map(
      directory.map((item) => [
        item.id,
        text(item.displayName) || text(item.username) || item.id,
      ]),
    );
    return {
      sent: rows
        .filter((row) => row.ownerUserId === user.userId)
        .map((row) => this.view(row, 'SENT', names)),
      received: rows
        .filter((row) => row.targetUserId === user.userId)
        .map((row) => this.view(row, 'RECEIVED', names)),
    };
  }

  async share(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.orgOf(user.userId);
    if (!org) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '只有已认证企业账号或服务商在职人员可以把资料共享给本组织内用户',
      );
    }
    // 资产信息一律取本账号的归属台账，不接受请求体里的名称/直链：
    // 否则共享记录能把任意 URL 塞进同事的「打开」按钮，也能拿别人的资产 id 冒充自己的。
    const assetRaw = (body.asset || {}) as Record<string, unknown>;
    const numericAssetId = Number(text(assetRaw.id).trim());
    if (!Number.isInteger(numericAssetId) || numericAssetId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择要共享的资料');
    }
    const entry = await this.prisma.digitalAssetEntry.findUnique({
      where: {
        userId_aipddAssetId: {
          userId: user.userId,
          aipddAssetId: numericAssetId,
        },
      },
    });
    if (!entry) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '资产不存在或不属于当前账号',
      );
    }
    const allowed = new Set(
      (await this.targets(user)).users.map((item) => item.userId),
    );
    const targets = [
      ...new Set(
        (Array.isArray(body.targetUserIds) ? body.targetUserIds : [])
          .map((item) => text(item).trim())
          .filter((item) => allowed.has(item)),
      ),
    ];
    if (!targets.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择要共享到的组织内用户',
      );
    }
    const data = targets.map((targetUserId) => ({
      ownerUserId: user.userId,
      assetId: String(entry.aipddAssetId),
      assetName:
        text(entry.name).trim().slice(0, 200) || String(entry.aipddAssetId),
      assetType: text(entry.type).trim().slice(0, 16) || 'file',
      assetSize: Math.max(0, Number(entry.fileSize) || 0),
      assetUrl: text(entry.url).slice(0, 2000),
      targetUserId,
    }));
    await this.prisma.$transaction(
      data.map((item) =>
        this.prisma.contentSharedAsset.upsert({
          where: {
            ownerUserId_assetId_targetUserId: {
              ownerUserId: item.ownerUserId,
              assetId: item.assetId,
              targetUserId: item.targetUserId,
            },
          },
          create: item,
          update: {
            assetName: item.assetName,
            assetType: item.assetType,
            assetSize: item.assetSize,
            assetUrl: item.assetUrl,
          },
        }),
      ),
    );
    return { shared: data.length };
  }

  async unshare(user: CurrentUser, id: string) {
    const numeric = Number(id);
    if (!Number.isInteger(numeric) || numeric <= 0) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '共享记录不存在');
    }
    const row = await this.prisma.contentSharedAsset.findFirst({
      where: { id: numeric, ownerUserId: user.userId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '共享记录不存在');
    }
    await this.prisma.contentSharedAsset.delete({ where: { id: row.id } });
    return { removed: true };
  }
}
