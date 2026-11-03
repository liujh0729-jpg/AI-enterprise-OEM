import { createHmac } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from './current-user';

/**
 * 跨站登录换来的本系统会话由 Enterprise 自己签发，签发人与账号服务区分开；
 * 密钥从 JWT_SECRET 派生（HKDF 用途隔离），不会与上游令牌互相通用。
 */
export const SSO_ISSUER = 'enterprise-sso';

/** 登录勾选「30 天内自动登录」时的会话时长（秒）。 */
export const REMEMBER_TTL_SECONDS = 30 * 86400;

export function issueSsoSession(
  userId: string,
  username: string,
  role = 'user',
  tokenVersion = 0,
  /** 显式会话时长（秒）；省略时用 SSO_SESSION_TTL_SECONDS 默认。 */
  ttlSeconds?: number,
): string {
  const ttl =
    ttlSeconds && ttlSeconds > 0
      ? ttlSeconds
      : Number(process.env.SSO_SESSION_TTL_SECONDS || 172800);
  return jwt.sign(
    { userId, username, role, tokenVersion, type: 'access' },
    ssoSecret(),
    {
      algorithm: 'HS256',
      issuer: SSO_ISSUER,
      expiresIn: ttl > 0 ? ttl : 172800,
    },
  );
}

/**
 * 读未验签令牌的剩余寿命（exp - now，秒）：仅用于改密换发时保持同等时长
 * （30 天免登录会话改密后不被降级回默认 2 天）；无法解析时返回 0。
 */
export function tokenRemainingSeconds(token?: string): number {
  try {
    if (!token) return 0;
    const raw = normalizeToken(token.replace(/^Bearer\s+/i, ''));
    const decoded = jwt.decode(raw);
    if (decoded && typeof decoded === 'object' && typeof decoded.exp === 'number') {
      return Math.max(0, Math.floor(decoded.exp - Date.now() / 1000));
    }
  } catch {
    /* 不可解则视为无剩余 */
  }
  return 0;
}

/**
 * 本地会话的 token_version：改密/封禁后账户版本 +1，旧令牌立即失效。
 * 只在 parseAccessToken 验签通过后调用；遗留令牌无此字段时按 0 处理。
 */
export function ssoSessionTokenVersion(token: string): number {
  try {
    const decoded = jwt.decode(normalizeToken(token));
    if (decoded && typeof decoded === 'object' && typeof decoded.tokenVersion === 'number') {
      return decoded.tokenVersion;
    }
  } catch {
    /* 验签已在前面完成，这里只读声明 */
  }
  return 0;
}

/** 跨站登录签发的本系统会话：只能在本系统验签，拿去请求上游一定失败。 */
export function isSsoSession(token: string): boolean {
  return tokenIssuer(token) === SSO_ISSUER;
}

/** A verified refresh subject may start a speculative read, but never authenticates a request. */
export function refreshTokenUserId(token: string): string | undefined {
  try {
    const payload = jwt.verify(normalizeToken(token), jwtSecret(), {
      algorithms: ['HS256'],
      issuer: process.env.JWT_ISSUER || 'aipdd-java-core',
      clockTolerance: 10,
    }) as jwt.JwtPayload;
    if (
      payload.type === 'refresh' &&
      payload.userId &&
      typeof payload.exp === 'number' &&
      payload.exp > Date.now() / 1000
    )
      return String(payload.userId);
  } catch {
    // Opaque or unverifiable refresh tokens keep the sequential upstream flow.
  }
  return undefined;
}

export function parseAccessToken(token?: string): CurrentUser {
  if (!token) {
    throw new BusinessException(ErrorCode.UNAUTHORIZED, 'missing token');
  }
  try {
    const issuer = tokenIssuer(token);
    const payload = jwt.verify(
      normalizeToken(token),
      issuer === SSO_ISSUER ? ssoSecret() : jwtSecret(),
      {
        algorithms: ['HS256'],
        issuer: issuer === SSO_ISSUER ? SSO_ISSUER : upstreamIssuer(),
        clockTolerance: 10,
      },
    ) as jwt.JwtPayload;
    if (payload.type !== 'access') {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, 'invalid token type');
    }
    if (!payload.userId) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, 'invalid token');
    }
    return new CurrentUser(
      String(payload.userId),
      String(payload.username || payload.sub || ''),
      String(payload.role || 'user'),
    );
  } catch (error) {
    if (error instanceof BusinessException) {
      throw error;
    }
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '登录已过期');
    }
    throw new BusinessException(ErrorCode.UNAUTHORIZED, 'invalid token');
  }
}

function upstreamIssuer() {
  return process.env.JWT_ISSUER || 'aipdd-java-core';
}

/** 读取未验签的 iss 只用于选密钥；真正放行仍由下方 verify 的 issuer 校验决定。 */
function tokenIssuer(token: string) {
  const decoded = jwt.decode(normalizeToken(token));
  return decoded && typeof decoded === 'object'
    ? String(decoded.iss || '')
    : '';
}

function ssoSecret() {
  return createHmac('sha256', jwtSecret())
    .update('enterprise-sso-session')
    .digest();
}

/** 验签密钥必须由环境配置（backend/.env 的 JWT_SECRET）——没有兜底默认值，缺了直接拒绝验签。 */
function jwtSecret() {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) {
    throw new BusinessException(
      ErrorCode.UNAUTHORIZED,
      '服务端未配置 JWT_SECRET，拒绝验签',
    );
  }
  return secret;
}

function normalizeToken(token: string) {
  let value = token.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  try {
    value = decodeURIComponent(value);
  } catch {
    // keep the raw bearer token when it is not URI-encoded
  }
  return value;
}
