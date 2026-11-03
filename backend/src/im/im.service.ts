import { randomBytes } from 'node:crypto';
import { MEMBER_KIND_LABELS } from '@enterprise/contracts';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { listMyOrgs } from '../common/org-scope';
import { joinSiteUrl, resolveSiteUrl } from '../common/site-url';
import { IdentityService } from '../identity/identity.service';
import { NotificationService } from '../notifications/notification.service';
import { OrgStaffService } from '../org-staff/org-staff.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma';
import {
  FeishuClient,
  WecomClient,
  type ImDirectoryDept,
  type ImDirectoryMember,
} from './im.clients';
import { ImCrypto } from './im.crypto';

type Row = Record<string, unknown>;

/** 通讯录同步的写批次：一次事务最多改这么多行，避免长事务。 */
const BATCH_WRITE = 200;

const PROVIDER_LABELS: Record<string, string> = {
  FEISHU: '飞书',
  WECOM: '企业微信',
};
const MODULE_LABELS: Record<string, string> = {
  APPROVAL: 'OA 审批',
  TASK: 'OKR 计划任务',
  BASE: '多维表格',
  LOWCODE: '内建应用实体',
  DRIVE: '数字资产（云文档）',
  BI: 'BI 摘要',
};
const DIRECTION_LABELS: Record<string, string> = {
  PUSH: '只推送',
  PULL: '只拉取',
  BOTH: '双向',
};

function newWebhookToken() {
  return randomBytes(16).toString('hex');
}

function providerLabel(provider: string) {
  return PROVIDER_LABELS[provider] || provider;
}

/**
 * IM 连接（飞书 / 企业微信）：组织级连接器。
 * 通讯录以本系统为准（推为主，拉只用于建立绑定；不自动建账号）；
 * 通知单向推送；OA 审批与 OKR 计划按「谁发起谁审批 / 谁完成谁回写」做镜像。
 */
export class ImService {
  private readonly feishu = new FeishuClient();
  private readonly wecom = new WecomClient();

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly crypto: ImCrypto,
    private readonly orgStaff: OrgStaffService,
    private readonly notifications: NotificationService,
  ) {}

  // ---------- 组织与权限 ----------

  /** 我所属的全部组织：本人在职的机构 + 本人企业 / 服务商。 */
  private async myOrgs(user: CurrentUser) {
    return listMyOrgs(this.prisma, this.identity, user.userId);
  }

  /** 连接器只能由组织主账号或平台管理员创建 / 修改 / 删除。 */
  private async connectorFor(user: CurrentUser, id: string, manage = false) {
    const connectorId = Number(id);
    if (!Number.isInteger(connectorId) || connectorId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '连接器编号无效');
    }
    const row = await this.prisma.imConnector.findUnique({
      where: { id: connectorId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '连接器不存在');
    const orgs = await this.myOrgs(user);
    const visible = orgs.some(
      (org) => org.orgType === row.orgType && org.orgUserId === row.orgUserId,
    );
    const owner =
      row.orgType === 'ENTERPRISE' || row.orgType === 'PROVIDER'
        ? row.orgUserId === user.userId
        : false;
    if (!visible && !user.isAdmin())
      throw new BusinessException(ErrorCode.NOT_FOUND, '连接器不存在');
    if (manage && !owner && !user.isAdmin()) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只有组织主账号可以修改连接器',
      );
    }
    return { row, owner, canManage: owner || user.isAdmin() };
  }

  private shapeConnector(
    row: {
      id: number;
      provider: string;
      name: string;
      corpId: string;
      appId: string;
      agentId: string;
      appSecretEnc: string;
      contactSecretEnc: string;
      encryptKeyEnc: string;
      webhookToken: string;
      status: string;
      scopes: unknown;
      lastVerifiedAt: Date | null;
      createdAt: Date;
    },
    canManage: boolean,
  ) {
    return {
      id: row.id,
      provider: row.provider,
      providerLabel: providerLabel(row.provider),
      name: row.name,
      corpId: row.corpId,
      appId: row.appId,
      agentId: row.agentId,
      hasAppSecret: Boolean(row.appSecretEnc),
      hasContactSecret: Boolean(row.contactSecretEnc),
      hasEncryptKey: Boolean(row.encryptKeyEnc),
      webhookToken: row.webhookToken,
      webhookPath: `/api/backend/enterprise/im/events/${row.provider.toLowerCase()}/${row.webhookToken}`,
      status: row.status,
      scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
      lastVerifiedAt: row.lastVerifiedAt
        ? row.lastVerifiedAt.toISOString()
        : null,
      canManage,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** 我可见的连接器范围：管理员不受限，其余按所属组织过滤。 */
  private async connectorWhere(user: CurrentUser) {
    if (user.isAdmin()) return undefined;
    const orgs = await this.myOrgs(user);
    return {
      OR: orgs.map((org) => ({
        orgType: org.orgType,
        orgUserId: org.orgUserId,
      })),
    };
  }

  async connectors(user: CurrentUser) {
    const rows = await this.prisma.imConnector.findMany({
      where: await this.connectorWhere(user),
      orderBy: { id: 'desc' },
    });
    return rows.map((row) =>
      this.shapeConnector(row, user.isAdmin() || row.orgUserId === user.userId),
    );
  }

  async saveConnector(user: CurrentUser, body: Row) {
    const provider = text(body.provider).trim().toUpperCase();
    if (provider !== 'FEISHU' && provider !== 'WECOM') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择飞书或企业微信',
      );
    }
    const name = text(body.name).trim().slice(0, 80);
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请给连接器起个名字');
    }
    const corpId = text(body.corpId).trim().slice(0, 120);
    const appId = text(body.appId).trim().slice(0, 120);
    const appSecret = text(body.appSecret).trim().slice(0, 200);
    const agentId = text(body.agentId).trim().slice(0, 64);
    const contactSecret = text(body.contactSecret).trim().slice(0, 200);
    const verificationToken = text(body.verificationToken).trim().slice(0, 120);
    const encryptKey = text(body.encryptKey).trim().slice(0, 120);
    if (provider === 'FEISHU' && (!appId || !appSecret)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '飞书需要 App ID 与 App Secret',
      );
    }
    if (provider === 'WECOM' && (!corpId || !appSecret)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '企业微信需要企业ID与应用 Secret',
      );
    }
    const id = Number(body.id || 0);
    if (id) {
      const { row } = await this.connectorFor(user, String(id), true);
      const updated = await this.prisma.imConnector.update({
        where: { id: row.id },
        data: {
          name,
          corpId,
          appId,
          agentId,
          verificationToken,
          status:
            text(body.status).trim() === 'disabled' ? 'disabled' : 'active',
          // 留空＝保留已保存的密钥（与全站密钥面板同口径）
          ...(appSecret
            ? { appSecretEnc: this.crypto.encrypt(appSecret) }
            : {}),
          ...(contactSecret
            ? { contactSecretEnc: this.crypto.encrypt(contactSecret) }
            : {}),
          ...(encryptKey
            ? { encryptKeyEnc: this.crypto.encrypt(encryptKey) }
            : {}),
          scopes: Array.isArray(body.scopes) ? body.scopes : [],
        },
      });
      return this.shapeConnector(updated, true);
    }
    const orgs = await this.myOrgs(user);
    const org = orgs.find((item) => item.orgUserId === user.userId);
    if (!org) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只有企业主或服务商主账号可以创建 IM 连接器',
      );
    }
    try {
      const row = await this.prisma.imConnector.create({
        data: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          provider,
          name,
          corpId,
          appId,
          agentId,
          appSecretEnc: this.crypto.encrypt(appSecret),
          contactSecretEnc: this.crypto.encrypt(contactSecret),
          verificationToken,
          encryptKeyEnc: this.crypto.encrypt(encryptKey),
          webhookToken: newWebhookToken(),
          scopes: Array.isArray(body.scopes) ? body.scopes : [],
          createdBy: user.userId,
        },
      });
      return this.shapeConnector(row, true);
    } catch {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '同一组织下这个应用已经建过连接器',
      );
    }
  }

  async deleteConnector(user: CurrentUser, id: string) {
    const { row } = await this.connectorFor(user, id, true);
    await this.prisma.$transaction([
      this.prisma.imMemberLink.deleteMany({ where: { connectorId: row.id } }),
      this.prisma.imDeptLink.deleteMany({ where: { connectorId: row.id } }),
      this.prisma.imObjectBinding.deleteMany({
        where: { connectorId: row.id },
      }),
      this.prisma.imEvent.deleteMany({ where: { connectorId: row.id } }),
      this.prisma.imNotifyRule.deleteMany({ where: { connectorId: row.id } }),
      this.prisma.imConnector.delete({ where: { id: row.id } }),
    ]);
    return { removed: true };
  }

  /**
   * 站内页面对外绝对地址：IM 卡片按钮必须给完整 URL，域名跟着「平台管理后台 → 站点设置 → 站点域名」走。
   * 没配置站点域名时返回空串，由客户端兜底（飞书不带按钮 / 企微降为纯文本）。
   */
  private async siteLink(path: string) {
    return joinSiteUrl(await resolveSiteUrl(this.prisma), path);
  }

  private secrets(row: {
    appId: string;
    appSecretEnc: string;
    agentId: string;
    corpId: string;
    contactSecretEnc: string;
    encryptKeyEnc: string;
  }) {
    return {
      appId: row.appId,
      appSecret: this.crypto.decrypt(row.appSecretEnc),
      agentId: row.agentId,
      corpId: row.corpId,
      contactSecret: this.crypto.decrypt(row.contactSecretEnc),
      encryptKey: this.crypto.decrypt(row.encryptKeyEnc),
    };
  }

  async testConnector(user: CurrentUser, id: string) {
    const { row } = await this.connectorFor(user, id);
    const secret = this.secrets(row);
    try {
      if (row.provider === 'FEISHU') {
        const token = await this.feishu.tenantToken(
          secret.appId,
          secret.appSecret,
        );
        const depts = await this.feishu.departments(token);
        await this.prisma.imConnector.update({
          where: { id: row.id },
          data: { lastVerifiedAt: new Date() },
        });
        return {
          ok: true,
          message: `连接成功，读到 ${depts.length} 个部门`,
          detail: { departments: depts.length },
        };
      }
      const token = await this.wecom.token(
        secret.corpId,
        secret.contactSecret || secret.appSecret,
      );
      const depts = await this.wecom.departments(token);
      await this.prisma.imConnector.update({
        where: { id: row.id },
        data: { lastVerifiedAt: new Date() },
      });
      return {
        ok: true,
        message: `连接成功，读到 ${depts.length} 个部门`,
        detail: { departments: depts.length },
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof BusinessException
            ? error.message
            : '连接失败，请检查凭据',
        detail: {},
      };
    }
  }

  // ---------- 成员与部门 ----------

  private async memberNames(userIds: string[]) {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return new Map<string, string>();
    const [directory, staff] = await Promise.all([
      this.prisma.userDirectory.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, displayName: true, username: true },
      }),
      this.prisma.staffProfile.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, realName: true },
      }),
    ]);
    const map = new Map<string, string>();
    for (const row of staff) map.set(row.userId, row.realName);
    for (const row of directory) {
      if (!map.get(row.userId))
        map.set(row.userId, row.displayName || row.username);
    }
    return map;
  }

  private shapeMember(
    row: {
      id: number;
      connectorId: number;
      memberUserId: string;
      externalUserId: string;
      unionId: string;
      nameSnapshot: string;
      mobileSnapshot: string;
      departmentExternalId: string;
      source: string;
      status: string;
      lastSyncedAt: Date | null;
    },
    names: Map<string, string>,
  ) {
    return {
      id: row.id,
      connectorId: row.connectorId,
      memberUserId: row.memberUserId,
      memberName: row.memberUserId ? names.get(row.memberUserId) || '' : '',
      externalUserId: row.externalUserId,
      unionId: row.unionId,
      nameSnapshot: row.nameSnapshot,
      mobileSnapshot: row.mobileSnapshot,
      departmentExternalId: row.departmentExternalId,
      source: row.source,
      status: row.status,
      lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    };
  }

  async members(user: CurrentUser, id: string) {
    const { row } = await this.connectorFor(user, id);
    const links = await this.prisma.imMemberLink.findMany({
      where: { connectorId: row.id },
      orderBy: { id: 'asc' },
    });
    const names = await this.memberNames(
      links.map((item) => item.memberUserId),
    );
    const shaped = links.map((item) => this.shapeMember(item, names));
    return {
      linked: shaped.filter(
        (item) => item.memberUserId && item.status === 'LINKED',
      ),
      unlinked: shaped.filter(
        (item) => !item.memberUserId || item.status !== 'LINKED',
      ),
    };
  }

  /**
   * 组织 ↔ IM 的非对称映射：本系统在职 N 人、飞书 M 人、企微 K 人并不相等，
   * 这里把两侧人数、已绑定与两侧各自未对应的人一次列清，前端只渲染不推断。
   */
  async staffDirectory(user: CurrentUser, connectorId: string | number) {
    const { row } = await this.connectorFor(user, String(connectorId));
    const connectors = await this.prisma.imConnector.findMany({
      where: { orgType: row.orgType, orgUserId: row.orgUserId },
      orderBy: { id: 'asc' },
    });
    const connectorIds = connectors.map((item) => item.id);
    const [staffRows, links, legacyRows] = await Promise.all([
      this.prisma.orgStaff.findMany({
        where: {
          orgType: row.orgType,
          orgUserId: row.orgUserId,
          status: 'ACTIVE',
        },
        orderBy: { id: 'asc' },
      }),
      this.prisma.imMemberLink.findMany({
        where: { connectorId: { in: connectorIds } },
        orderBy: { id: 'asc' },
      }),
      // 服务商职员仍写旧表：不合并进总览会导致「本地 0 人、IM 40 人」的假象。
      row.orgType === 'PROVIDER'
        ? this.prisma.providerStaff.findMany({
            where: { providerUserId: row.orgUserId, status: 'ACTIVE' },
            orderBy: { id: 'asc' },
          })
        : Promise.resolve([] as { staffUserId: string }[]),
    ]);
    const orgStaffIds = new Set(staffRows.map((item) => item.memberUserId));
    const names = await this.memberNames([
      ...staffRows.map((item) => item.memberUserId),
      ...legacyRows.map((item) => item.staffUserId),
      row.orgUserId,
    ]);
    const localRows = [
      ...staffRows.map((staff) => ({
        memberUserId: staff.memberUserId,
        memberName: names.get(staff.memberUserId) || staff.memberUserId,
        memberKind: staff.memberKind,
        memberKindLabel:
          MEMBER_KIND_LABELS[staff.memberKind] || staff.memberKind,
        department: staff.department,
      })),
      ...legacyRows
        .filter((item) => !orgStaffIds.has(item.staffUserId))
        .map((item) => ({
          memberUserId: item.staffUserId,
          memberName: names.get(item.staffUserId) || item.staffUserId,
          memberKind: 'STAFF',
          memberKindLabel: MEMBER_KIND_LABELS.STAFF || '职员',
          department: '',
        })),
    ];
    const localIds = new Set(localRows.map((item) => item.memberUserId));
    const connectorOf = new Map(connectors.map((item) => [item.id, item]));
    const linkView = (link: (typeof links)[number]) => {
      const connector = connectorOf.get(link.connectorId);
      return {
        id: link.id,
        connectorId: link.connectorId,
        provider: connector?.provider || '',
        providerLabel: providerLabel(connector?.provider || ''),
        externalUserId: link.externalUserId,
        name: link.nameSnapshot || link.externalUserId,
        status: link.status,
      };
    };
    return {
      orgType: row.orgType,
      orgUserId: row.orgUserId,
      orgName: names.get(row.orgUserId) || row.orgUserId,
      localActive: localRows.length,
      connectors: connectors.map((connector) => {
        const own = links.filter((item) => item.connectorId === connector.id);
        const linked = own.filter(
          (item) => item.memberUserId && item.status === 'LINKED',
        );
        return {
          id: connector.id,
          provider: connector.provider,
          providerLabel: providerLabel(connector.provider),
          name: connector.name,
          status: connector.status,
          counts: {
            imMembers: own.length,
            linked: linked.length,
            imUnlinked: own.length - linked.length,
          },
        };
      }),
      locals: localRows.map((staff) => ({
        ...staff,
        links: links
          .filter((link) => link.memberUserId === staff.memberUserId)
          .map(linkView),
      })),
      imOnly: links
        .filter(
          (link) => !link.memberUserId || !localIds.has(link.memberUserId),
        )
        .map((link) => {
          const view = linkView(link);
          return {
            connectorId: view.connectorId,
            provider: view.provider,
            providerLabel: view.providerLabel,
            externalUserId: view.externalUserId,
            name: link.nameSnapshot || view.externalUserId,
            mobile: link.mobileSnapshot,
            status: link.status,
          };
        }),
    };
  }

  private async directory(row: {
    provider: string;
    appId: string;
    appSecretEnc: string;
    corpId: string;
    contactSecretEnc: string;
  }): Promise<{ members: ImDirectoryMember[]; depts: ImDirectoryDept[] }> {
    const secret = this.secrets({
      ...row,
      agentId: '',
      encryptKeyEnc: '',
    });
    if (row.provider === 'FEISHU') {
      const token = await this.feishu.tenantToken(
        secret.appId,
        secret.appSecret,
      );
      const [members, depts] = await Promise.all([
        this.feishu.users(token),
        this.feishu.departments(token),
      ]);
      return { members, depts };
    }
    const token = await this.wecom.token(
      secret.corpId,
      secret.contactSecret || secret.appSecret,
    );
    const [members, depts] = await Promise.all([
      this.wecom.users(token),
      this.wecom.departments(token),
    ]);
    return { members, depts };
  }

  async importMembers(user: CurrentUser, id: string) {
    const { row } = await this.connectorFor(user, id);
    return this.importDirectory(row);
  }

  /** 拉通讯录并建绑定：整批读一次已有映射，再分块写，避免逐人 upsert 打远端库。 */
  private async importDirectory(row: {
    id: number;
    provider: string;
    appId: string;
    appSecretEnc: string;
    corpId: string;
    contactSecretEnc: string;
    encryptKeyEnc: string;
  }) {
    const { members } = await this.directory(row);
    const mobiles = members.map((item) => item.mobile).filter(Boolean);
    const emails = members.map((item) => item.email).filter(Boolean);
    const [staff, enterprises, directory, existingRows] = await Promise.all([
      this.prisma.staffProfile.findMany({
        where: { OR: [{ phone: { in: mobiles } }, { email: { in: emails } }] },
        select: { userId: true, phone: true, email: true },
      }),
      this.prisma.enterpriseProfile.findMany({
        where: { phone: { in: mobiles } },
        select: { userId: true, phone: true },
      }),
      this.prisma.userDirectory.findMany({
        where: { email: { in: emails } },
        select: { userId: true, email: true },
      }),
      this.prisma.imMemberLink.findMany({
        where: { connectorId: row.id },
        select: {
          id: true,
          externalUserId: true,
          memberUserId: true,
          status: true,
        },
      }),
    ]);
    const byMobile = new Map<string, string>();
    const byEmail = new Map<string, string>();
    for (const item of enterprises) byMobile.set(item.phone, item.userId);
    for (const item of staff) {
      if (item.phone) byMobile.set(item.phone, item.userId);
      if (item.email) byEmail.set(item.email, item.userId);
    }
    for (const item of directory) byEmail.set(item.email, item.userId);
    const existingByExternal = new Map(
      existingRows.map((item) => [item.externalUserId, item]),
    );
    const now = new Date();
    const creates: Prisma.ImMemberLinkUncheckedCreateInput[] = [];
    const updates: {
      where: { id: number };
      data: Prisma.ImMemberLinkUpdateInput;
    }[] = [];
    let matched = 0;
    let unlinked = 0;
    for (const item of members) {
      const local =
        (item.mobile && byMobile.get(item.mobile)) ||
        (item.email && byEmail.get(item.email)) ||
        '';
      const existing = existingByExternal.get(item.externalUserId);
      const adopt = Boolean(local) && !existing?.memberUserId;
      const snapshot = {
        unionId: item.unionId,
        nameSnapshot: item.name,
        mobileSnapshot: item.mobile,
        departmentExternalId: item.departmentIds[0] || '',
        lastSyncedAt: now,
      };
      if (existing) {
        updates.push({
          where: { id: existing.id },
          data: adopt
            ? { ...snapshot, memberUserId: local, status: 'LINKED' }
            : snapshot,
        });
      } else {
        creates.push({
          connectorId: row.id,
          memberUserId: local,
          externalUserId: item.externalUserId,
          source: 'IM_PULL',
          status: local ? 'LINKED' : 'PENDING',
          ...snapshot,
        });
      }
      if (local && (!existing?.memberUserId || existing.status !== 'LINKED'))
        matched += 1;
      if (!local) unlinked += 1;
    }
    for (let offset = 0; offset < creates.length; offset += BATCH_WRITE) {
      const batch = creates.slice(offset, offset + BATCH_WRITE);
      await this.prisma.imMemberLink.createMany({
        data: batch,
        skipDuplicates: true,
      });
    }
    for (let offset = 0; offset < updates.length; offset += BATCH_WRITE) {
      const batch = updates.slice(offset, offset + BATCH_WRITE);
      await this.prisma.$transaction(
        batch.map((item) =>
          this.prisma.imMemberLink.update({
            where: item.where,
            data: item.data,
          }),
        ),
      );
    }
    return { pulled: members.length, matched, unlinked };
  }

  async linkMember(user: CurrentUser, id: string, body: Row) {
    const { row } = await this.connectorFor(user, id, true);
    const memberUserId = text(body.memberUserId).trim();
    const externalUserId = text(body.externalUserId).trim();
    if (!memberUserId || !externalUserId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择本地账号与 IM 成员',
      );
    }
    const target = await this.prisma.imMemberLink.findFirst({
      where: { connectorId: row.id, externalUserId },
    });
    if (!target) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '这位成员还没有从 IM 同步过来',
      );
    }
    const link = await this.prisma.imMemberLink.upsert({
      where: {
        connectorId_externalUserId: {
          connectorId: row.id,
          externalUserId,
        },
      },
      create: {
        connectorId: row.id,
        memberUserId,
        externalUserId,
        status: 'LINKED',
        source: 'MANUAL',
      },
      update: { memberUserId, status: 'LINKED', source: 'MANUAL' },
    });
    return this.shapeMember(link, await this.memberNames([memberUserId]));
  }

  async unlinkMember(user: CurrentUser, id: string, body: Row) {
    const { row } = await this.connectorFor(user, id, true);
    const linkId = Number(body.linkId || 0);
    if (!linkId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择要解绑的成员');
    }
    await this.prisma.imMemberLink.deleteMany({
      where: { id: linkId, connectorId: row.id },
    });
    return { removed: true };
  }

  async inviteUnlinked(user: CurrentUser, id: string, body: Row) {
    const { row } = await this.connectorFor(user, id, true);
    const externalUserId = text(body.externalUserId).trim();
    const memberUserId = text(body.memberUserId).trim();
    if (!externalUserId || !memberUserId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先选好本系统账号，再发职员邀请',
      );
    }
    await this.orgStaff.invite(user, {
      orgType: row.orgType,
      memberUserId,
    });
    await this.prisma.imMemberLink.updateMany({
      where: { connectorId: row.id, externalUserId },
      data: {
        memberUserId,
        status: 'PENDING',
        source: 'MANUAL',
        lastSyncedAt: new Date(),
      },
    });
    await this.prisma.imEvent.create({
      data: {
        connectorId: row.id,
        direction: 'OUT',
        kind: 'SYNC',
        eventId: `invite:${externalUserId}:${Date.now()}`,
        objectType: 'ORG_MEMBER',
        objectId: memberUserId,
        status: 'DONE',
        processedAt: new Date(),
        payload: { externalUserId },
      },
    });
    return {
      invited: true,
      message: '已发出职员邀请，对方在站内确认后绑定生效',
    };
  }

  async departments(user: CurrentUser, id: string) {
    const { row } = await this.connectorFor(user, id);
    const rows = await this.prisma.imDeptLink.findMany({
      where: { connectorId: row.id },
      orderBy: { department: 'asc' },
    });
    return rows.map((item) => ({
      id: item.id,
      department: item.department,
      externalDeptId: item.externalDeptId,
      name: item.name,
      parentExternalId: item.parentExternalId,
    }));
  }

  async saveDeptLink(user: CurrentUser, id: string, body: Row) {
    const { row } = await this.connectorFor(user, id, true);
    const department = text(body.department).trim().slice(0, 64);
    const externalDeptId = text(body.externalDeptId).trim().slice(0, 120);
    if (!department || !externalDeptId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写本地部门名与 IM 部门ID',
      );
    }
    const saved = await this.prisma.imDeptLink.upsert({
      where: {
        connectorId_department: { connectorId: row.id, department },
      },
      create: {
        connectorId: row.id,
        department,
        externalDeptId,
        name: text(body.name).trim().slice(0, 120),
        parentExternalId: text(body.parentExternalId).trim().slice(0, 120),
      },
      update: {
        externalDeptId,
        name: text(body.name).trim().slice(0, 120),
        parentExternalId: text(body.parentExternalId).trim().slice(0, 120),
      },
    });
    return {
      id: saved.id,
      department: saved.department,
      externalDeptId: saved.externalDeptId,
      name: saved.name,
      parentExternalId: saved.parentExternalId,
    };
  }

  // ---------- 同步对象 ----------

  private shapeBinding(row: {
    id: number;
    connectorId: number;
    module: string;
    objectKey: string;
    direction: string;
    config: unknown;
    fieldMap: unknown;
    enabled: boolean;
    lastSyncAt: Date | null;
  }) {
    return {
      id: row.id,
      connectorId: row.connectorId,
      module: row.module,
      moduleLabel: MODULE_LABELS[row.module] || row.module,
      objectKey: row.objectKey,
      direction: row.direction,
      directionLabel: DIRECTION_LABELS[row.direction] || row.direction,
      config: (row.config || {}) as Record<string, unknown>,
      fieldMap: (row.fieldMap || {}) as Record<string, string>,
      enabled: row.enabled,
      lastSyncAt: row.lastSyncAt ? row.lastSyncAt.toISOString() : null,
    };
  }

  async bindings(user: CurrentUser, id: string) {
    const { row } = await this.connectorFor(user, id);
    const rows = await this.prisma.imObjectBinding.findMany({
      where: { connectorId: row.id },
      orderBy: { id: 'asc' },
    });
    return rows.map((item) => this.shapeBinding(item));
  }

  async saveBinding(user: CurrentUser, id: string, body: Row) {
    const { row } = await this.connectorFor(user, id, true);
    const module = text(body.module).trim().toUpperCase();
    const objectKey = text(body.objectKey).trim().slice(0, 120);
    if (!objectKey) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写同步对象');
    }
    if (!MODULE_LABELS[module]) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '不支持的同步对象类型',
      );
    }
    const direction =
      text(body.direction).trim().toUpperCase() === 'PULL'
        ? 'PULL'
        : text(body.direction).trim().toUpperCase() === 'BOTH'
          ? 'BOTH'
          : 'PUSH';
    const idValue = Number(body.id || 0);
    if (idValue) {
      const exist = await this.prisma.imObjectBinding.findFirst({
        where: { id: idValue, connectorId: row.id },
      });
      if (!exist)
        throw new BusinessException(ErrorCode.NOT_FOUND, '同步对象不存在');
      const updated = await this.prisma.imObjectBinding.update({
        where: { id: exist.id },
        data: {
          objectKey,
          direction,
          config: (body.config || {}) as never,
          fieldMap: (body.fieldMap || {}) as never,
          enabled:
            body.enabled === undefined ? exist.enabled : Boolean(body.enabled),
        },
      });
      return this.shapeBinding(updated);
    }
    const saved = await this.prisma.imObjectBinding.upsert({
      where: {
        connectorId_module_objectKey: {
          connectorId: row.id,
          module,
          objectKey,
        },
      },
      create: {
        connectorId: row.id,
        module,
        objectKey,
        direction,
        config: (body.config || {}) as never,
        fieldMap: (body.fieldMap || {}) as never,
        enabled: body.enabled === undefined ? true : Boolean(body.enabled),
      },
      update: {
        direction,
        config: (body.config || {}) as never,
        fieldMap: (body.fieldMap || {}) as never,
      },
    });
    return this.shapeBinding(saved);
  }

  async deleteBinding(user: CurrentUser, id: string, bindingId: string) {
    const { row } = await this.connectorFor(user, id, true);
    const bid = Number(bindingId);
    if (!bid)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '同步对象编号无效');
    await this.prisma.imObjectLink.deleteMany({ where: { bindingId: bid } });
    await this.prisma.imObjectBinding.deleteMany({
      where: { id: bid, connectorId: row.id },
    });
    return { removed: true };
  }

  async bindingTest(user: CurrentUser, id: string, body: Row) {
    const { row } = await this.connectorFor(user, id);
    const module = text(body.module).trim().toUpperCase();
    const config = (body.config || {}) as Record<string, unknown>;
    if (module === 'BASE') {
      if (!text(config.appToken).trim() || !text(config.tableId).trim())
        return { ok: false, message: '多维表格需要填 app_token 与 table_id' };
      return { ok: true, message: '配置格式正确；真实读写请在同步时验证' };
    }
    if (module === 'APPROVAL') {
      if (!text(config.externalTemplateId).trim())
        return {
          ok: false,
          message: '审批需要填外部模板 ID（飞书审批定义 Code / 企微模板 ID）',
        };
      return { ok: true, message: '配置格式正确；真实审批请在提交单据时验证' };
    }
    if (module === 'TASK') {
      if (row.provider === 'WECOM')
        return { ok: true, message: '企微没有任务 API，只发应用消息提醒' };
      return { ok: true, message: '配置格式正确；真实任务请在推送计划时验证' };
    }
    return {
      ok: false,
      message: `${MODULE_LABELS[module] || module}暂不支持连通测试`,
    };
  }

  // ---------- 同步执行 ----------

  async syncNow(user: CurrentUser, id: string, body: Row) {
    const { row } = await this.connectorFor(user, id, true);
    const module = text(body.module).trim().toUpperCase() || 'CONTACTS';
    if (module === 'CONTACTS') {
      const result = await this.importDirectory(row);
      return {
        ok: true,
        message: `已拉取 ${result.pulled} 位成员，匹配 ${result.matched}，未绑定 ${result.unlinked}`,
        pushed: 0,
        pulled: result.pulled,
      };
    }
    if (module === 'APPROVAL') {
      const applicationId = Number(body.applicationId || 0);
      if (!applicationId)
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '请指定要推送的 OA 单据',
        );
      const result = await this.pushApproval(row, applicationId);
      return { ok: true, message: result.message, pushed: 1, pulled: 0 };
    }
    if (module === 'TASK') {
      const planIds = Array.isArray(body.planIds)
        ? body.planIds.map((item) => Number(item)).filter((item) => item > 0)
        : [];
      if (!planIds.length)
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '请选择要下发的 OKR 计划',
        );
      const result = await this.pushPlans(row, user, planIds);
      return {
        ok: true,
        message: result.message,
        pushed: result.pushed,
        pulled: 0,
      };
    }
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `${MODULE_LABELS[module] || module}不在同步范围内`,
    );
  }

  private async bindingOf(
    connectorId: number,
    module: string,
    objectKey?: string,
  ) {
    return this.prisma.imObjectBinding.findFirst({
      where: {
        connectorId,
        module,
        enabled: true,
        ...(objectKey ? { objectKey } : {}),
      },
      orderBy: { id: 'asc' },
    });
  }

  /** 同步映射只在一处写：审批实例与计划任务共用。 */
  private async saveLink(
    binding: { id: number } | null | undefined,
    module: string,
    localId: string | number,
    externalId: string,
  ) {
    if (!binding) return;
    const local = String(localId);
    const now = new Date();
    await this.prisma.imObjectLink.upsert({
      where: {
        bindingId_localId: { bindingId: binding.id, localId: local },
      },
      create: {
        bindingId: binding.id,
        module,
        localId: local,
        externalId,
        lastDirection: 'PUSH',
        lastSyncedAt: now,
      },
      update: { externalId, lastDirection: 'PUSH', lastSyncedAt: now },
    });
  }

  private async linkMemberExternal(connectorId: number, memberUserId: string) {
    const link = await this.prisma.imMemberLink.findFirst({
      where: { connectorId, memberUserId, status: 'LINKED' },
    });
    return link?.externalUserId || '';
  }

  /** 批量取绑定关系：一次查完，避免在计划循环里逐条查库。 */
  private async linkMemberExternals(connectorId: number, userIds: string[]) {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return new Map<string, string>();
    const rows = await this.prisma.imMemberLink.findMany({
      where: { connectorId, memberUserId: { in: ids }, status: 'LINKED' },
      select: { memberUserId: true, externalUserId: true },
    });
    return new Map(
      rows
        .filter((row) => row.memberUserId)
        .map((row) => [row.memberUserId, row.externalUserId]),
    );
  }

  private async pushApproval(
    connector: {
      id: number;
      provider: string;
      orgType: string;
      orgUserId: string;
      appId: string;
      appSecretEnc: string;
      agentId: string;
      corpId: string;
      contactSecretEnc: string;
      encryptKeyEnc: string;
    },
    applicationId: number,
  ) {
    const app = await this.prisma.oaApplication.findUnique({
      where: { id: applicationId },
    });
    if (!app) throw new BusinessException(ErrorCode.NOT_FOUND, 'OA 单据不存在');
    if (
      app.orgType !== connector.orgType ||
      app.orgUserId !== connector.orgUserId
    ) {
      throw new BusinessException(ErrorCode.NOT_FOUND, 'OA 单据不存在');
    }
    const binding = await this.bindingOf(connector.id, 'APPROVAL');
    const config = (binding?.config || {}) as Record<string, unknown>;
    const externalTemplateId = text(
      config.externalTemplateId || binding?.objectKey,
    ).trim();
    if (!externalTemplateId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先在「同步对象」里绑定审批模板（飞书审批定义 Code / 企微模板 ID）',
      );
    }
    const fields = Array.isArray(app.fieldsSnapshot)
      ? (app.fieldsSnapshot as Array<{ key?: string; label?: string }>)
      : [];
    const form = (app.formData || {}) as Record<string, unknown>;
    const secret = this.secrets(connector);
    if (connector.provider === 'FEISHU') {
      const externalUserId = await this.linkMemberExternal(
        connector.id,
        app.applicantId,
      );
      if (!externalUserId)
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '申请人还没有绑定飞书账号，请先在「成员映射」里绑定',
        );
      const token = await this.feishu.tenantToken(
        secret.appId,
        secret.appSecret,
      );
      const result = await this.feishu.createApprovalInstance(token, {
        approval_code: externalTemplateId,
        open_id: externalUserId,
        form: JSON.stringify(
          fields.map((field) => ({
            id: field.key || '',
            type: 'input',
            value: text(form[field.key || '']),
          })),
        ),
      });
      const externalId = text(result.instance_code).trim();
      await this.saveLink(binding, 'APPROVAL', app.id, externalId);
      return { message: `已在飞书发起审批 ${externalId}` };
    }
    const userId = await this.linkMemberExternal(connector.id, app.applicantId);
    const token = await this.wecom.token(secret.corpId, secret.appSecret);
    const result = await this.wecom.applyEvent(token, {
      creator_userid: userId || app.applicantId,
      template_id: externalTemplateId,
      use_template_approver: 1,
      apply_data: {
        contents: fields.map((field) => ({
          control: 'Text',
          id: field.key || '',
          value: { text: text(form[field.key || '']) },
        })),
      },
      summary_list: [
        {
          summary_info: [{ text: app.title || app.number, lang: 'zh_CN' }],
        },
      ],
    });
    const externalId = text(result.spNo).trim();
    await this.saveLink(binding, 'APPROVAL', app.id, externalId);
    return { message: `已在企业微信发起审批 ${externalId || ''}`.trim() };
  }

  private async pushPlans(
    connector: {
      id: number;
      provider: string;
      appId: string;
      appSecretEnc: string;
      agentId: string;
      corpId: string;
      contactSecretEnc: string;
      encryptKeyEnc: string;
    },
    user: CurrentUser,
    planIds: number[],
  ) {
    const plans = await this.prisma.okrPlan.findMany({
      where: { id: { in: planIds }, ownerUserId: user.userId },
    });
    if (!plans.length)
      throw new BusinessException(ErrorCode.NOT_FOUND, '没有可下发的计划');
    const binding = await this.bindingOf(connector.id, 'TASK');
    const config = (binding?.config || {}) as Record<string, unknown>;
    const secret = this.secrets(connector);
    const externalIds = await this.linkMemberExternals(
      connector.id,
      plans.map((plan) => plan.memberUserId),
    );
    if (connector.provider === 'WECOM') {
      const token = await this.wecom.token(secret.corpId, secret.appSecret);
      let pushed = 0;
      for (const plan of plans) {
        const externalUserId = externalIds.get(plan.memberUserId);
        if (!externalUserId) continue;
        await this.wecom.sendTextCard(
          token,
          secret.agentId,
          externalUserId,
          `计划提醒：${plan.title}`,
          `${plan.kind === 'DAY' ? '日' : plan.kind === 'WEEK' ? '周' : ''}计划 · 截止 ${plan.dueDate ? plan.dueDate.toISOString().slice(0, 10) : '未设置'}`,
          await this.siteLink('/okr'),
        );
        pushed += 1;
      }
      return { pushed, message: `已发企微提醒 ${pushed} 条` };
    }
    const token = await this.feishu.tenantToken(secret.appId, secret.appSecret);
    const tasklistId = text(config.tasklistId).trim();
    let pushed = 0;
    for (const plan of plans) {
      const externalUserId = externalIds.get(plan.memberUserId);
      if (!externalUserId) continue;
      const task = await this.feishu.createTask(token, {
        summary: plan.title.slice(0, 200),
        description: plan.detail || '',
        ...(plan.dueDate
          ? {
              due: {
                timestamp: String(Math.floor(plan.dueDate.getTime() / 1000)),
                is_all_day: true,
              },
            }
          : {}),
        members: [{ id: externalUserId, type: 'user', role: 'assignee' }],
        ...(tasklistId ? { tasklists: [{ tasklist_guid: tasklistId }] } : {}),
      });
      const taskData = task as { task?: { guid?: string }; guid?: string };
      const externalId = text(taskData.task?.guid || taskData.guid).trim();
      await this.saveLink(binding, 'TASK', plan.id, externalId);
      pushed += 1;
    }
    return { pushed, message: `已下发飞书任务 ${pushed} 条` };
  }

  async syncLogs(user: CurrentUser, id: string, query: Row) {
    const { row } = await this.connectorFor(user, id);
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const pageSize = Math.min(
      200,
      Math.max(1, Math.floor(Number(query.pageSize) || 20)),
    );
    const [total, rows] = await Promise.all([
      this.prisma.imEvent.count({ where: { connectorId: row.id } }),
      this.prisma.imEvent.findMany({
        where: { connectorId: row.id },
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      list: rows.map((item) => ({
        id: item.id,
        connectorId: item.connectorId,
        direction: item.direction,
        kind: item.kind,
        eventId: item.eventId,
        objectType: item.objectType,
        objectId: item.objectId,
        payload: (item.payload || {}) as Record<string, unknown>,
        status: item.status,
        attempts: item.attempts,
        error: item.error,
        processedAt: item.processedAt ? item.processedAt.toISOString() : null,
        createdAt: item.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  async retryEvent(user: CurrentUser, id: string, eventId: string) {
    const { row } = await this.connectorFor(user, id, true);
    const event = await this.prisma.imEvent.findUnique({
      where: { connectorId_eventId: { connectorId: row.id, eventId } },
    });
    if (!event)
      throw new BusinessException(ErrorCode.NOT_FOUND, '同步记录不存在');
    let status = 'DONE';
    let errorText = '';
    try {
      if (event.objectType === 'APPROVAL') {
        await this.applyApprovalStatus(
          row.id,
          event.objectId,
          text((event.payload as Row)?.status).trim(),
        );
      }
    } catch (caught) {
      status = 'FAILED';
      errorText = (caught as Error).message.slice(0, 500);
    }
    return {
      id: event.id,
      connectorId: event.connectorId,
      direction: event.direction,
      kind: event.kind,
      eventId: event.eventId,
      objectType: event.objectType,
      objectId: event.objectId,
      payload: (event.payload || {}) as Record<string, unknown>,
      status,
      attempts: event.attempts + 1,
      error: errorText,
      processedAt: new Date().toISOString(),
      createdAt: event.createdAt.toISOString(),
    };
  }

  // ---------- 通知 ----------

  async notifyRules(user: CurrentUser, id: string) {
    const { row } = await this.connectorFor(user, id);
    const rule = await this.prisma.imNotifyRule.findUnique({
      where: { connectorId: row.id },
    });
    return {
      rules: Array.isArray(rule?.rules) ? rule?.rules : [],
      quietHours: (rule?.quietHours || {}) as Record<string, unknown>,
    };
  }

  async saveNotifyRules(user: CurrentUser, id: string, body: Row) {
    const { row } = await this.connectorFor(user, id, true);
    const rules = Array.isArray(body.rules) ? body.rules : [];
    const saved = await this.prisma.imNotifyRule.upsert({
      where: { connectorId: row.id },
      create: {
        connectorId: row.id,
        rules: rules as never,
        quietHours: (body.quietHours || {}) as never,
      },
      update: {
        rules: rules as never,
        quietHours: (body.quietHours || {}) as never,
      },
    });
    return {
      rules: Array.isArray(saved.rules) ? saved.rules : [],
      quietHours: (saved.quietHours || {}) as Record<string, unknown>,
    };
  }

  /** 发一条测试消息：按人（需已绑定）或按群。卡片按钮只跳转，不做审批回调。 */
  async testNotify(user: CurrentUser, id: string, body: Row) {
    const { row } = await this.connectorFor(user, id);
    const target = text(body.target).trim() === 'USER' ? 'USER' : 'CHAT';
    const secret = this.secrets(row);
    const title = 'IM 连接测试';
    const content =
      '这是一条来自 AIworkin 工作台的测试消息，点按钮回到站内处理。';
    // 跳转地址跟站点域名一致：未配置时为空串，飞书卡片不带按钮、企微降为纯文本
    const link = await this.siteLink('/');
    const message = link
      ? '测试消息已发送'
      : '测试消息已发送（未配置站点域名，卡片没带跳转按钮；到平台管理后台 → 站点设置 填好站点域名后按钮才能回到本站）';
    if (row.provider === 'FEISHU') {
      const token = await this.feishu.tenantToken(
        secret.appId,
        secret.appSecret,
      );
      if (target === 'USER') {
        const memberUserId = text(body.memberUserId).trim();
        const external = await this.linkMemberExternal(row.id, memberUserId);
        if (!external)
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            '这位职员还没有绑定飞书账号',
          );
        await this.feishu.sendCard(
          token,
          'open_id',
          external,
          title,
          content,
          link,
        );
      } else {
        const chatId = text(body.chatId).trim();
        if (!chatId)
          throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写飞书群 ID');
        await this.feishu.sendCard(
          token,
          'chat_id',
          chatId,
          title,
          content,
          link,
        );
      }
      return { ok: true, message };
    }
    const token = await this.wecom.token(secret.corpId, secret.appSecret);
    const toUser =
      target === 'USER'
        ? await this.linkMemberExternal(row.id, text(body.memberUserId).trim())
        : text(body.chatId).trim();
    if (!toUser)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        target === 'USER'
          ? '这位职员还没有绑定企微账号'
          : '请填写企微群或成员 ID',
      );
    await this.wecom.sendTextCard(
      token,
      secret.agentId,
      toUser,
      title,
      content,
      link,
    );
    return { ok: true, message };
  }

  // ---------- 审批模板与计划 ----------

  async approvalTemplates(user: CurrentUser, id: string) {
    const { row } = await this.connectorFor(user, id);
    const templates = await this.prisma.oaTemplate.findMany({
      where: { orgType: row.orgType, orgUserId: row.orgUserId },
      orderBy: { id: 'asc' },
      select: { key: true, name: true, category: true },
    });
    return templates;
  }

  async publishApproval(user: CurrentUser, id: string, body: Row) {
    const { row } = await this.connectorFor(user, id, true);
    const templateKey = text(body.templateKey).trim();
    const externalTemplateId = text(body.externalTemplateId).trim();
    if (!templateKey)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择 OA 模板');
    if (!externalTemplateId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        row.provider === 'WECOM'
          ? '企业微信只能绑定后台已建好的模板，请先在企业微信后台建模板并填模板 ID'
          : '请填写飞书审批定义 Code（可在飞书后台先建好审批定义）',
      );
    }
    const template = await this.prisma.oaTemplate.findFirst({
      where: {
        key: templateKey,
        orgType: row.orgType,
        orgUserId: row.orgUserId,
      },
    });
    if (!template)
      throw new BusinessException(ErrorCode.NOT_FOUND, 'OA 模板不存在');
    const saved = await this.prisma.imObjectBinding.upsert({
      where: {
        connectorId_module_objectKey: {
          connectorId: row.id,
          module: 'APPROVAL',
          objectKey: templateKey,
        },
      },
      create: {
        connectorId: row.id,
        module: 'APPROVAL',
        objectKey: templateKey,
        direction: 'PUSH',
        config: { externalTemplateId } as never,
      },
      update: {
        config: { externalTemplateId } as never,
        enabled: true,
      },
    });
    return this.shapeBinding(saved);
  }

  async taskPublish(user: CurrentUser, id: string, body: Row) {
    const { row } = await this.connectorFor(user, id, true);
    const planIds = Array.isArray(body.planIds)
      ? body.planIds.map((item) => Number(item)).filter((item) => item > 0)
      : [];
    if (!planIds.length)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择要下发的计划');
    const result = await this.pushPlans(row, user, planIds);
    return {
      pushed: result.pushed,
      skipped: planIds.length - result.pushed,
      message: result.message,
    };
  }

  // ---------- 概览 ----------

  async overview(user: CurrentUser) {
    const connectors = await this.prisma.imConnector.findMany({
      where: await this.connectorWhere(user),
      select: { id: true, provider: true },
    });
    const ids = connectors.map((item) => item.id);
    const [linked, pending, failed, last] = await Promise.all([
      this.prisma.imMemberLink.count({
        where: { connectorId: { in: ids }, status: 'LINKED' },
      }),
      this.prisma.imMemberLink.count({
        where: { connectorId: { in: ids }, status: 'PENDING' },
      }),
      this.prisma.imEvent.count({
        where: { connectorId: { in: ids }, status: 'FAILED' },
      }),
      this.prisma.imEvent.findFirst({
        where: { connectorId: { in: ids }, status: 'DONE' },
        orderBy: { processedAt: 'desc' },
        select: { processedAt: true },
      }),
    ]);
    return {
      connectors: connectors.length,
      linkedMembers: linked,
      pendingMembers: pending,
      failedEvents: failed,
      lastSyncAt: last?.processedAt ? last.processedAt.toISOString() : null,
      providers: [...new Set(connectors.map((item) => item.provider))],
    };
  }

  // ---------- 事件回调 ----------

  /** 飞书 url_verification 要原样回 challenge；其余事件先解密、去重、再落库。 */
  async handleEvent(provider: string, token: string, body: Row): Promise<Row> {
    const connector = await this.prisma.imConnector.findUnique({
      where: { webhookToken: token },
    });
    if (!connector || connector.status !== 'active') {
      throw new BusinessException(ErrorCode.NOT_FOUND, '回调地址不存在');
    }
    if (connector.provider.toLowerCase() !== provider) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '回调地址不存在');
    }
    if (provider === 'feishu') {
      if (body.type === 'url_verification') {
        return { challenge: body.challenge };
      }
      const encrypted = text(body.encrypt).trim();
      const inner = encrypted
        ? this.feishu.decryptEvent(
            this.crypto.decrypt(connector.encryptKeyEnc),
            encrypted,
          )
        : body;
      const eventId = text(
        (inner.header as Row)?.event_id || inner.uuid || inner.event_id,
      ).trim();
      const eventType = text(
        (inner.header as Row)?.event_type || inner.type || '',
      ).trim();
      if (!eventId) return { code: 0 };
      const event = (inner.event || inner) as Row;
      const isApproval = /approval/i.test(eventType);
      const isTask = /task/i.test(eventType);
      const record = await this.recordEvent({
        connectorId: connector.id,
        eventId,
        objectType: isApproval ? 'APPROVAL' : isTask ? 'TASK' : 'OTHER',
        objectId: text(
          event.instance_code || (event.task as Row)?.guid || event.task_id,
        ).trim(),
        payload: event,
      });
      if (record.duplicate) return { code: 0 };
      try {
        if (isApproval) {
          await this.applyApprovalStatus(
            connector.id,
            record.objectId,
            text(event.status || event.operate_status).trim(),
          );
        }
        if (isTask) {
          await this.applyTaskDone(
            connector.id,
            text((event.task as Row)?.guid || event.task_id).trim(),
          );
        }
        await this.finishEvent(record.id, 'DONE');
      } catch (caught) {
        await this.finishEvent(record.id, 'FAILED', (caught as Error).message);
      }
      return { code: 0 };
    }
    // 企业微信：加密回调先解密（JSON 模式下 body 里带 encrypt）
    const encrypted = text(body.encrypt).trim();
    if (encrypted) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '企微加密回调尚未联调，请先在后台使用明文模式',
      );
    }
    const eventId = text(body.EventKey || body.MsgId || body.Event).trim();
    const record = await this.recordEvent({
      connectorId: connector.id,
      eventId,
      objectType: 'APPROVAL',
      objectId: text(body.SpNo || body.ApprId).trim(),
      payload: body,
    });
    if (!record.duplicate) {
      await this.applyApprovalStatus(
        connector.id,
        record.objectId,
        text(body.Status || body.SpStatus).trim(),
      );
      await this.finishEvent(record.id, 'DONE');
    }
    return { code: 0 };
  }

  private async recordEvent(input: {
    connectorId: number;
    eventId: string;
    objectType: string;
    objectId: string;
    payload: Row;
  }) {
    const exist = await this.prisma.imEvent.findUnique({
      where: {
        connectorId_eventId: {
          connectorId: input.connectorId,
          eventId: input.eventId,
        },
      },
    });
    if (exist)
      return { id: exist.id, objectId: exist.objectId, duplicate: true };
    const created = await this.prisma.imEvent.create({
      data: {
        connectorId: input.connectorId,
        direction: 'IN',
        kind: 'EVENT',
        eventId: input.eventId,
        objectType: input.objectType,
        objectId: input.objectId,
        payload: input.payload as never,
      },
    });
    return { id: created.id, objectId: created.objectId, duplicate: false };
  }

  private async finishEvent(id: number, status: string, error = '') {
    await this.prisma.imEvent.update({
      where: { id },
      data: {
        status,
        error: error.slice(0, 500),
        attempts: { increment: 1 },
        processedAt: new Date(),
      },
    });
  }

  /** IM 侧审批结果回写本地 OA：只改终态，不跑本地联动（镜像侧不重复审批）。 */
  private async applyApprovalStatus(
    connectorId: number,
    externalId: string,
    status: string,
  ) {
    if (!externalId) return;
    const link = await this.findLink(connectorId, 'APPROVAL', externalId);
    if (!link) return;
    const app = await this.prisma.oaApplication.findUnique({
      where: { id: Number(link.localId) },
    });
    if (!app) return;
    const normalized = status.toUpperCase();
    const mapped =
      normalized === 'APPROVED' || normalized === '2'
        ? 'APPROVED'
        : normalized === 'REJECTED' || normalized === '3'
          ? 'REJECTED'
          : normalized === 'CANCELED' || normalized === '4'
            ? 'WITHDRAWN'
            : '';
    if (!mapped || app.status === mapped) return;
    await this.prisma.oaApplication.update({
      where: { id: app.id },
      data: {
        status: mapped,
        finishedAt: new Date(),
      },
    });
    await this.notifications.notify(app.applicantId, {
      category: 'oa',
      title: `OA 单据已在 IM 完成：${
        mapped === 'APPROVED'
          ? '已通过'
          : mapped === 'REJECTED'
            ? '已驳回'
            : '已撤销'
      }`,
      body: `${app.number} ${app.title}`.trim(),
      link: `/oa?applicationId=${app.id}`,
      entityType: 'oa_application',
      entityId: app.id,
    });
  }

  /** 找本连接器下某个外部对象对应的本地映射：同一外部 ID 可能出现在别的连接器，必须按连接器收窄。 */
  private async findLink(
    connectorId: number,
    module: string,
    externalId: string,
  ) {
    const bindings = await this.prisma.imObjectBinding.findMany({
      where: { connectorId, module },
      select: { id: true },
    });
    if (!bindings.length) return null;
    return this.prisma.imObjectLink.findFirst({
      where: {
        bindingId: { in: bindings.map((item) => item.id) },
        module,
        externalId,
      },
    });
  }

  private async applyTaskDone(connectorId: number, externalId: string) {
    if (!externalId) return;
    const link = await this.findLink(connectorId, 'TASK', externalId);
    if (!link) return;
    const plan = await this.prisma.okrPlan.findUnique({
      where: { id: Number(link.localId) },
    });
    if (!plan || plan.status === 'DONE') return;
    await this.prisma.okrPlan.update({
      where: { id: plan.id },
      data: { status: 'DONE', progress: 100, doneAt: new Date() },
    });
    await this.prisma.okrProgressLog.create({
      data: {
        ownerUserId: plan.ownerUserId,
        krId: plan.krId,
        objectiveId: plan.objectiveId,
        progress: 100,
        note: '已在 IM 标记完成',
        source: 'PLAN',
        refType: 'PLAN',
        refId: String(plan.id),
      },
    });
  }
}
