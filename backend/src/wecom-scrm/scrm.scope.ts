import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { HrmScopeService, type HrmOrg } from '../hrm/hrm.scope';
import type { PrismaService } from '../prisma/prisma.service';
import type { ScrmCorp } from '../../generated/prisma';
import { ScrmCrypto } from './scrm-crypto';

/**
 * SCRM 组织口径：复用 HRM 的 (orgType, orgUserId) 归属与管理员判定，
 * 追加「企微已接入」校验和凭据解密。跨组织一律 404（查不到即拒绝，不提示存在性）。
 */

export type ScrmSecrets = {
  corpId: string;
  corpName: string;
  agentId: string;
  contactSecret: string;
  appSecret: string;
  callbackToken: string;
  aesKey: string;
  archiveSecret: string;
  archivePrivateKey: string;
};

export class ScrmScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hrm: HrmScopeService,
    private readonly crypto: ScrmCrypto,
  ) {}

  resolve(user: CurrentUser): Promise<HrmOrg> {
    return this.hrm.resolve(user);
  }

  async requireAdmin(user: CurrentUser): Promise<HrmOrg> {
    const org = await this.hrm.resolve(user);
    this.hrm.requireAdmin(org);
    return org;
  }

  memberUserIds(org: HrmOrg): Promise<string[]> {
    return this.hrm.memberUserIds(org);
  }

  names(ids: string[]): Promise<Map<string, string>> {
    return this.hrm.names(ids);
  }

  async corp(org: HrmOrg): Promise<ScrmCorp | null> {
    return this.prisma.scrmCorp.findUnique({
      where: {
        orgType_orgUserId: { orgType: org.orgType, orgUserId: org.orgUserId },
      },
    });
  }

  /** 已接入且启用；未配置/停用给出可操作提示，不产生假数据。 */
  async requireCorp(
    org: HrmOrg,
  ): Promise<{ corp: ScrmCorp; secrets: ScrmSecrets }> {
    const corp = await this.corp(org);
    if (!corp) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '尚未接入企业微信：请先在「企业微信 SCRM → 概览」填写 CorpID 与 Secret',
      );
    }
    if (!corp.enabled) {
      throw new BusinessException(
        ErrorCode.FEATURE_CLOSED,
        '企业微信 SCRM 已停用：请先在概览里重新启用',
      );
    }
    return { corp, secrets: this.secretsOf(corp) };
  }

  /** 公开回调按随机 callbackKey 找企业（URL 里不暴露组织键）。 */
  async corpByKey(key: string): Promise<ScrmCorp | null> {
    const value = String(key || '').trim();
    if (!/^[a-f0-9]{32}$/i.test(value)) return null;
    return this.prisma.scrmCorp.findUnique({ where: { callbackKey: value } });
  }

  secretsOf(corp: ScrmCorp): ScrmSecrets {
    return {
      corpId: corp.corpId,
      corpName: corp.corpName,
      agentId: corp.agentId,
      contactSecret: this.crypto.decrypt(corp.contactSecretEnc),
      appSecret: this.crypto.decrypt(corp.appSecretEnc),
      callbackToken: this.crypto.decrypt(corp.callbackTokenEnc),
      aesKey: this.crypto.decrypt(corp.aesKeyEnc),
      archiveSecret: this.crypto.decrypt(corp.archiveSecretEnc),
      archivePrivateKey: this.crypto.decrypt(corp.archivePrivateKeyEnc),
    };
  }

  /** 同步用的员工映射：企微 userid → 本系统账号 id（经 IM 连接器的成员绑定）。 */
  async staffLinks(org: HrmOrg): Promise<Map<string, string>> {
    const connectors = await this.prisma.imConnector.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        provider: 'WECOM',
      },
      select: { id: true },
    });
    if (!connectors.length) return new Map();
    const links = await this.prisma.imMemberLink.findMany({
      where: { connectorId: { in: connectors.map((row) => row.id) } },
      select: { externalUserId: true, memberUserId: true },
    });
    return new Map(
      links
        .filter((row) => row.memberUserId)
        .map((row) => [row.externalUserId, row.memberUserId]),
    );
  }

  /** 组织在册成员 id（含主账号）：客户归属、转接接收人、侧边栏员工都必须在这里面。 */
  async requireMember(org: HrmOrg, staffUserId: string): Promise<string> {
    const id = String(staffUserId || '').trim();
    if (!id) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请指定成员账号');
    }
    const members = await this.memberUserIds(org);
    if (!members.includes(id)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该账号不是本组织在册成员，请先在「职员与代理人」加入组织',
      );
    }
    return id;
  }
}
