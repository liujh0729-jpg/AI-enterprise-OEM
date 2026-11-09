import { randomBytes } from 'node:crypto';
import type { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { joinSiteUrl, resolveSiteUrl } from '../common/site-url';
import type { PrismaService } from '../prisma/prisma.service';
import type { ScrmCorp } from '../../generated/prisma';
import { ScrmClient } from './scrm.client';
import { ScrmCrypto } from './scrm-crypto';
import { clip } from '../hrm/hrm.helpers';
import { ScrmScopeService } from './scrm.scope';

/**
 * 企微接入设置：凭据加密落库、回调地址生成、只读探针。
 * 原生 SCRM 是唯一客户同步源：启用时记 qidianPaused=true，企点侧客户导入据此拒绝。
 */
export class ScrmSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScrmScopeService,
    private readonly crypto: ScrmCrypto,
    private readonly client: ScrmClient,
  ) {}

  private async view(corp: ScrmCorp | null) {
    const base = await resolveSiteUrl(this.prisma);
    const callbackUrl = corp?.callbackKey
      ? joinSiteUrl(base, `/enterprise/wecom-scrm/callback/${corp.callbackKey}`)
      : '';
    return {
      configured: Boolean(corp),
      corpId: corp?.corpId || '',
      corpName: corp?.corpName || '',
      agentId: corp?.agentId || '',
      status: corp?.status || 'UNCONFIGURED',
      enabled: Boolean(corp?.enabled),
      hasContactSecret: Boolean(corp?.contactSecretEnc),
      hasAppSecret: Boolean(corp?.appSecretEnc),
      hasCallback: Boolean(corp?.callbackTokenEnc && corp?.aesKeyEnc),
      callbackUrl,
      syncSource: 'SCRM',
      qidianPaused: Boolean(corp?.qidianPaused),
      lastSyncAt: corp?.lastSyncAt ? corp.lastSyncAt.toISOString() : '',
      lastSyncResult: corp?.lastSyncResult || '',
    };
  }

  async settings(user: CurrentUser) {
    const org = await this.scope.resolve(user);
    return this.view(await this.scope.corp(org));
  }

  async saveSettings(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const existing = await this.scope.corp(org);
    const corpId = clip(body.corpId, 64).trim();
    if (!corpId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写企业 CorpID');
    }
    const enabled = body.enabled !== false;
    // 空字符串＝不修改；只有显式传了新值才重新加密，避免前端回显密文被二次加密
    const sealed = (value: unknown, current: string | undefined): string => {
      const raw = text(value).trim();
      if (!raw) return current || '';
      return this.crypto.encrypt(raw);
    };
    const data = {
      corpId,
      corpName: clip(body.corpName ?? existing?.corpName ?? '', 120),
      agentId: clip(body.agentId ?? existing?.agentId ?? '', 32),
      contactSecretEnc: sealed(body.contactSecret, existing?.contactSecretEnc),
      appSecretEnc: sealed(body.appSecret, existing?.appSecretEnc),
      callbackTokenEnc: sealed(body.callbackToken, existing?.callbackTokenEnc),
      aesKeyEnc: sealed(body.aesKey, existing?.aesKeyEnc),
      archiveSecretEnc: sealed(body.archiveSecret, existing?.archiveSecretEnc),
      archivePrivateKeyEnc: sealed(
        body.archivePrivateKey,
        existing?.archivePrivateKeyEnc,
      ),
      enabled,
      status: enabled ? 'ACTIVE' : 'DISABLED',
      qidianPaused: enabled,
    };
    const corp = existing
      ? await this.prisma.scrmCorp.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.scrmCorp.create({
          data: {
            ...data,
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            callbackKey: randomBytes(16).toString('hex'),
            createdBy: user.userId,
          },
        });
    return this.view(corp);
  }

  async testConnection(user: CurrentUser) {
    const org = await this.scope.requireAdmin(user);
    const { corp, secrets } = await this.scope.requireCorp(org);
    if (!secrets.contactSecret) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先填写「外部联系人 Secret」再测试',
      );
    }
    const followUsers = await this.client.followUsers(
      secrets.corpId,
      secrets.contactSecret,
    );
    let departments = 0;
    if (secrets.appSecret) {
      try {
        departments = await this.client.departments(
          secrets.corpId,
          secrets.appSecret,
        );
      } catch {
        // 通讯录权限可能没开：客户联系可用就算接入成功，部门数只作参考
        departments = 0;
      }
    }
    await this.prisma.scrmCorp.update({
      where: { id: corp.id },
      data: { status: 'ACTIVE' },
    });
    return {
      ok: true,
      message: `连接成功：${followUsers.length} 位成员具备客户联系权限`,
      departments,
    };
  }
}
