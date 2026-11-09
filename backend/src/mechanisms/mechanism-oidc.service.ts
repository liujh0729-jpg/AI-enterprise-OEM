import { createHash, randomBytes } from 'node:crypto';
import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { httpRequest } from '../http/transport';
import { clip } from '../hrm/hrm.helpers';
import { text } from './mechanism.shared';
import type { Row } from './mechanism.shared';
import { MechanismBase } from './mechanism.base';

/** OIDC 身份源发现、测试与登录。 */
export class MechanismOidcService extends MechanismBase {
  private oidcView(row: {
    id: number;
    code: string;
    name: string;
    issuer: string;
    clientId: string;
    clientSecretCipher: string;
    scopes: string;
    enabled: boolean;
    autoProvision: boolean;
    defaultRole: string;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      issuer: row.issuer,
      clientId: row.clientId,
      clientSecretMasked: row.clientSecretCipher ? '••••••' : '',
      scopes: row.scopes,
      enabled: row.enabled,
      autoProvision: row.autoProvision,
      defaultRole: row.defaultRole,
      redirectUri: '',
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listProviders(user: CurrentUser) {
    this.requirePlatformAdmin(user);
    const rows = await this.prisma.oidcProvider.findMany({
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => this.oidcView(row));
  }

  async saveProvider(user: CurrentUser, body: Row) {
    this.requirePlatformAdmin(user);
    const id = Number(body.id ?? 0);
    const secret = text(body.clientSecret).trim();
    const data = {
      code: clip(body.code, 32).toLowerCase(),
      name: clip(body.name, 80),
      issuer: clip(body.issuer, 300).replace(/\/+$/, ''),
      clientId: clip(body.clientId, 200),
      scopes: clip(body.scopes, 200) || 'openid profile email',
      enabled: body.enabled !== false,
      autoProvision: Boolean(body.autoProvision),
      defaultRole: clip(body.defaultRole, 16) || 'user',
    };
    const row = id
      ? await this.prisma.oidcProvider.update({
          where: { id },
          data: {
            ...data,
            ...(secret
              ? { clientSecretCipher: this.crypto.encrypt(secret) }
              : {}),
          },
        })
      : await this.prisma.oidcProvider.create({
          data: {
            ...data,
            clientSecretCipher: secret ? this.crypto.encrypt(secret) : '',
            createdBy: user.userId,
          },
        });
    return this.oidcView(row);
  }

  async removeProvider(user: CurrentUser, body: Row) {
    this.requirePlatformAdmin(user);
    const id = Number(body.id);
    const row = await this.prisma.oidcProvider.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '身份源不存在');
    await this.prisma.oidcProvider.delete({ where: { id } });
    return { id };
  }

  private async discovery(issuer: string): Promise<Row> {
    const cached = this.discoveryCache.get(issuer);
    if (cached && Date.now() - cached.at < 10 * 60_000) return cached.value;
    const result = await httpRequest<Row>(
      `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`,
      { timeoutMs: 10_000, operation: 'oidc.discovery' },
    );
    const value = result.data || {};
    this.discoveryCache.set(issuer, { at: Date.now(), value });
    return value;
  }

  async testProvider(user: CurrentUser, body: Row) {
    this.requirePlatformAdmin(user);
    const row = await this.prisma.oidcProvider.findUnique({
      where: { id: Number(body.id) },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '身份源不存在');
    try {
      const meta = await this.discovery(row.issuer);
      return {
        ok: Boolean(meta.authorization_endpoint && meta.token_endpoint),
        issuer: text(meta.issuer) || row.issuer,
        authorizationEndpoint: text(meta.authorization_endpoint),
        tokenEndpoint: text(meta.token_endpoint),
        message: '发现文档读取成功',
      };
    } catch (error) {
      return {
        ok: false,
        issuer: row.issuer,
        authorizationEndpoint: '',
        tokenEndpoint: '',
        message: clip(
          error instanceof Error ? error.message : '发现文档读取失败',
          300,
        ),
      };
    }
  }

  async oidcProviderByCode(code: string) {
    return this.prisma.oidcProvider.findUnique({
      where: { code: code.toLowerCase() },
    });
  }

  async oidcAuthorizeUrl(
    code: string,
    redirectUri: string,
    state: string,
  ): Promise<string> {
    const provider = await this.oidcProviderByCode(code);
    if (!provider || !provider.enabled) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '身份源不存在或已停用');
    }
    const meta = await this.discovery(provider.issuer);
    const endpoint = text(meta.authorization_endpoint);
    if (!endpoint)
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '身份源未提供授权端点',
      );
    const url = new URL(endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', provider.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', provider.scopes);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async oidcExchange(
    code: string,
    authCode: string,
    redirectUri: string,
  ): Promise<{
    userId: string;
    username: string;
    role: string;
    tokenVersion: number;
  }> {
    const provider = await this.oidcProviderByCode(code);
    if (!provider || !provider.enabled) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '身份源不存在或已停用');
    }
    const meta = await this.discovery(provider.issuer);
    const tokenEndpoint = text(meta.token_endpoint);
    if (!tokenEndpoint)
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '身份源未提供令牌端点',
      );
    const secret = provider.clientSecretCipher
      ? this.crypto.decrypt(provider.clientSecretCipher)
      : '';
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: redirectUri,
      client_id: provider.clientId,
      ...(secret ? { client_secret: secret } : {}),
    });
    const tokenResult = await httpRequest<Row>(tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      timeoutMs: 15_000,
      operation: 'oidc.token',
    });
    const accessToken = text(tokenResult.data?.access_token);
    if (!accessToken)
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '身份源未返回访问令牌',
      );
    const userinfoEndpoint = text(meta.userinfo_endpoint);
    let profile: Row = {};
    if (userinfoEndpoint) {
      const info = await httpRequest<Row>(userinfoEndpoint, {
        headers: { authorization: `Bearer ${accessToken}` },
        timeoutMs: 10_000,
        operation: 'oidc.userinfo',
      });
      profile = info.data || {};
    }
    const subject = text(profile.sub).trim();
    const email = text(profile.email).trim().toLowerCase();
    if (!subject && !email) {
      throw new BusinessException(
        ErrorCode.UNAUTHORIZED,
        '身份源未返回可识别的用户标识',
      );
    }
    let account = email
      ? await this.prisma.account.findFirst({
          where: { OR: [{ email }, { username: email.slice(0, 64) }] },
        })
      : null;
    if (!account) {
      if (!provider.autoProvision) {
        throw new BusinessException(
          ErrorCode.UNAUTHORIZED,
          '该账号尚未开通，请联系管理员',
        );
      }
      const base =
        (
          email.split('@')[0] ||
          `oidc_${createHash('sha256').update(subject).digest('hex').slice(0, 10)}`
        )
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, '_')
          .slice(0, 28) || 'oidc_user';
      let username = base;
      for (let i = 0; i < 5; i += 1) {
        const clash = await this.prisma.account.findUnique({
          where: { username },
        });
        if (!clash) break;
        username = `${base}_${randomBytes(2).toString('hex')}`.slice(0, 32);
      }
      account = await this.prisma.account.create({
        data: {
          username,
          email: email || null,
          role: provider.defaultRole === 'admin' ? 'PLATFORM_ADMIN' : 'USER',
          emailVerified: email ? 1 : 0,
        },
      });
    }
    if (account.status !== 'ACTIVE') {
      throw new BusinessException(ErrorCode.FORBIDDEN, '该账号已停用');
    }
    await this.prisma.account.update({
      where: { id: account.id },
      data: { lastLoginAt: new Date() },
    });
    return {
      userId: String(account.id),
      username: account.username,
      role: account.role === 'PLATFORM_ADMIN' ? 'admin' : 'user',
      tokenVersion: account.tokenVersion,
    };
  }
}
