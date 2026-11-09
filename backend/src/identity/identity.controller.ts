import { ok, text } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from './identity.service';
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}
  async me(user: CurrentUser) {
    return ok(await this.identity.me(user));
  }
  async switchIdentity(
    user: CurrentUser,
    body: {
      identity?: string;
    },
  ) {
    return ok(
      await this.identity.switchIdentity(user, String(body.identity || '')),
    );
  }
  async enterprise(user: CurrentUser) {
    return ok(await this.identity.getEnterprise(user.userId));
  }
  async submitEnterprise(user: CurrentUser, body: Record<string, string>) {
    return ok(await this.identity.submitEnterprise(user, body));
  }
  async updateEnterprise(user: CurrentUser, body: Record<string, string>) {
    return ok(await this.identity.updateEnterprise(user, body));
  }
  async removeEnterprise(user: CurrentUser) {
    return ok(await this.identity.removeEnterprise(user));
  }
  async providerApplication(user: CurrentUser) {
    return ok(await this.identity.getProviderApplications(user.userId));
  }
  async submitProvider(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.identity.submitProviderApplication(user, body));
  }
  async upload(
    user: CurrentUser,
    body: {
      files?: {
        name?: string;
        size?: number;
        contentType?: string;
        contentBase64?: string;
      }[];
    },
  ) {
    return ok(await this.identity.uploadAttachments(user, body.files || []));
  }
  async updateProvider(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(
      await this.identity.updateProviderApplication(user, parseId(id), body),
    );
  }
  async removeProvider(user: CurrentUser, id: string) {
    return ok(await this.identity.removeProviderApplication(user, parseId(id)));
  }
  async staffProfile(user: CurrentUser) {
    return ok(await this.identity.getStaffProfile(user.userId));
  }
  async submitStaff(user: CurrentUser, body: Record<string, unknown>) {
    return ok(
      await this.identity.submitStaffProfile(user, {
        real_name: text(body.real_name),
        phone: text(body.phone),
        email: text(body.email),
        region: text(body.region),
        province: text(body.province),
        city: text(body.city),
        categories: Array.isArray(body.categories)
          ? body.categories.map((item) => text(item))
          : [],
        qualification: text(body.qualification),
        intro: text(body.intro),
      }),
    );
  }
  async staff(user: CurrentUser) {
    return ok(await this.identity.listStaff(user));
  }
  async search(user: CurrentUser, q = '') {
    return ok(await this.identity.searchStaff(user, q));
  }
  async roles(user: CurrentUser) {
    await this.identity.requireRoles(user, 'SERVICE_PROVIDER');
    return ok(await this.identity.staffRoleOptions(user.userId));
  }
  async inviteStaff(
    user: CurrentUser,
    body: {
      staffUserId?: string;
      categories?: string[];
    },
  ) {
    return ok(
      await this.identity.inviteStaff(
        user,
        String(body.staffUserId || ''),
        Array.isArray(body.categories) ? body.categories : [],
      ),
    );
  }
  /** 被邀请人视角：待我确认的添加申请 */
  async myInvitations(user: CurrentUser) {
    return ok(await this.identity.myInvitations(user));
  }
  async respondInvitation(
    user: CurrentUser,
    id: string,
    body: {
      action?: string;
    },
  ) {
    return ok(
      await this.identity.respondInvitation(
        user,
        parseId(id),
        body.action === 'REJECT' ? 'REJECT' : 'APPROVE',
      ),
    );
  }
  async cancelInvitation(user: CurrentUser, id: string) {
    return ok(await this.identity.cancelInvitation(user, parseId(id)));
  }
  async bind(
    user: CurrentUser,
    body: {
      staffUserId?: string;
      roles?: string[];
    },
  ) {
    return ok(
      await this.identity.bindStaff(
        user,
        String(body.staffUserId || ''),
        Array.isArray(body.roles) ? body.roles.map(String) : [],
      ),
    );
  }
  async unbind(user: CurrentUser, staffUserId: string) {
    return ok(await this.identity.unbindStaff(user, staffUserId));
  }
  async selfUnbind(user: CurrentUser, providerUserId: string) {
    return ok(await this.identity.selfUnbindStaff(user, providerUserId));
  }
  /** 我按已申报板块能申请加入的服务商名录（「申请加入服务商」页）。 */
  async joinable(user: CurrentUser) {
    return ok(await this.identity.joinableProviders(user.userId));
  }
  async myAffiliations(user: CurrentUser) {
    return ok(await this.identity.myAffiliations(user.userId));
  }
  async inbox(user: CurrentUser) {
    return ok(await this.identity.inboxAffiliations(user));
  }
  async apply(
    user: CurrentUser,
    body: {
      providerUserId?: string;
      category?: string;
    },
  ) {
    return ok(
      await this.identity.applyAffiliation(
        user,
        String(body.providerUserId || ''),
        String(body.category || ''),
      ),
    );
  }
  /** 申请人撤回自己的加入申请（仅待审批）。 */
  async cancelAffiliation(user: CurrentUser, id: string) {
    return ok(await this.identity.cancelAffiliation(user, parseId(id)));
  }
  async auditAff(
    user: CurrentUser,
    id: string,
    body: {
      action?: 'APPROVE' | 'REJECT';
      note?: string;
    },
  ) {
    return ok(
      await this.identity.auditAffiliation(
        user,
        parseId(id),
        body.action === 'REJECT' ? 'REJECT' : 'APPROVE',
        body.note,
      ),
    );
  }
  async assign(
    user: CurrentUser,
    body: {
      enterpriseId?: number;
      staffUserId?: string;
    },
  ) {
    return ok(
      await this.identity.assignEnterprise(
        user,
        parseId(body.enterpriseId, '企业 ID'),
        String(body.staffUserId || ''),
      ),
    );
  }
  async myWork(user: CurrentUser) {
    return ok(await this.identity.myWork(user));
  }
  async apiKeys(user: CurrentUser) {
    return ok(await this.identity.listApiKeys(user.userId));
  }
  async createKey(user: CurrentUser) {
    return ok(await this.identity.createApiKey(user));
  }
  async resetKey(user: CurrentUser, id: string) {
    return ok(await this.identity.resetApiKey(user, parseId(id)));
  }
  async revokeKey(user: CurrentUser, id: string) {
    return ok(await this.identity.revokeApiKey(user, parseId(id)));
  }
  async keyUsage(user: CurrentUser, id: string) {
    return ok(await this.identity.apiKeyUsage(user, parseId(id)));
  }
  async updateKeyQuota(
    user: CurrentUser,
    id: string,
    body: { pointsQuota?: number | null },
  ) {
    return ok(
      await this.identity.updateApiKeyQuota(
        user,
        parseId(id),
        body.pointsQuota === null || body.pointsQuota === undefined
          ? null
          : Number(body.pointsQuota),
      ),
    );
  }
  async revealKey(user: CurrentUser, id: string) {
    return ok(await this.identity.revealApiKey(user, parseId(id)));
  }
}
