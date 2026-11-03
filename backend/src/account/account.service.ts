import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import type { Account } from '../../generated/prisma';
import { AccountSettingsService, type RegisterMode } from './account-settings.service';
import { NotifyChannelService } from './notify-channel.service';
import type { PointsService } from '../points/points.service';

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const PASSWORD_MIN_LENGTH = 8;
const LOCK_THRESHOLD = 5;
const LOCK_MS = 10 * 60_000;
/** 邀请码字母表：去掉易混淆的 0/O/1/I，32 字符 × 6 位约 10 亿组合，碰撞重采样。 */
const INVITE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export type LoginContext = { ip?: string; userAgent?: string };

/**
 * 本地账户服务（开源版核心增量）：注册 / 登录 / 找回密码 / 改密 / 换绑 / 注销 / 登录日志，
 * 以及平台管理员兜底（重置密码、封禁）。上游账号服务不再参与任何环节。
 */
export class AccountService {
  /** 连错锁定：进程内窗口（重启即清零，登录日志仍完整留档）。 */
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AccountSettingsService,
    private readonly channels: NotifyChannelService,
    /** 积分域可选：注册赠分/邀请奖励尽力而为，未注入则跳过（不影响注册成功）。 */
    private readonly points?: PointsService,
  ) {}

  // ---------- 查询与转换 ----------

  async findById(id: number): Promise<Account | null> {
    return this.prisma.account.findUnique({ where: { id } });
  }
  async findByUserId(userId: string): Promise<Account | null> {
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) return null;
    return this.findById(id);
  }
  /** 会话失效判定与封禁拦截用：拿不到有效账户一律拒绝。 */
  async activeAccount(userId: string): Promise<Account | null> {
    const account = await this.findByUserId(userId);
    return account && account.status === 'ACTIVE' ? account : null;
  }

  /** 每次带会话的请求核对：封禁/注销/改密后旧令牌立即失效（token_version 比对）。 */
  async assertSessionValid(userId: string, tokenVersion: number) {
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '会话无效，请重新登录');
    }
    const account = await this.findById(id);
    if (!account) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '会话无效，请重新登录');
    }
    if (account.status === 'BANNED') {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        `账号已被封禁${account.banReason ? `：${account.banReason}` : ''}`,
      );
    }
    if (account.status === 'DELETED') {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '会话无效，请重新登录');
    }
    if (account.tokenVersion !== tokenVersion) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '会话已失效，请重新登录');
    }
  }

  private toPublic(account: Account) {
    return {
      id: String(account.id),
      username: account.username,
      email: account.email || '',
      phone: account.phone || '',
      emailVerified: account.emailVerified === 1,
      phoneVerified: account.phoneVerified === 1,
      role: account.role,
      status: account.status,
      mustChangePassword: account.mustChangePassword === 1,
      avatar: account.avatar || '',
      intro: account.intro || '',
      lang: account.lang,
      lastLoginAt: account.lastLoginAt?.toISOString() || null,
      createdAt: account.createdAt.toISOString(),
    };
  }

  // ---------- 注册 ----------

  /** 敏感操作二次验密（兼容端点 /api/auth/verify-password）：只回布尔，不抛业务错。 */
  async verifyPassword(userId: string, password: string) {
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) return false;
    const account = await this.findById(id);
    if (!account?.passwordHash || account.status !== 'ACTIVE') return false;
    return bcrypt.compare(password, account.passwordHash);
  }

  /** 开发态免密登录（/api/dev/session）：按用户名取本地账户的会话素材；不命中返回 null。 */
  async devSession(username: string) {
    const account = await this.prisma.account.findUnique({
      // 用户名统一小写存储（见 register），这里同口径匹配，避免 PG 大小写敏感查不到。
      where: { username: username.trim().toLowerCase() },
    });
    if (!account || account.status !== 'ACTIVE') return null;
    return {
      userId: String(account.id),
      username: account.username,
      role: account.role === 'PLATFORM_ADMIN' ? 'admin' : 'user',
      tokenVersion: account.tokenVersion,
    } as const;
  }

  /** 开发态账号候选列表（仅本地用户，供一键登录面板）。 */
  async listActiveForDev() {
    const rows = await this.prisma.account.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { id: 'asc' },
      take: 50,
      select: { id: true, username: true, role: true },
    });
    return rows.map((row) => ({
      username: row.username,
      userId: String(row.id),
      displayName: row.username,
      role: row.role === 'PLATFORM_ADMIN' ? 'admin' : 'user',
    }));
  }

  async register(input: {
    mode?: RegisterMode;
    username?: string;
    password?: string;
    email?: string;
    phone?: string;
    code?: string;
    /** 可选邀请码：填写则必须存在，建立邀请关系；未填/不存在时报错不静默忽略。 */
    inviteCode?: string;
  }) {
    const mode = input.mode || 'USERNAME';
    const modes = await this.settings.registerModes();
    if (!modes.includes(mode)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '该注册方式未被管理员开启');
    }
    const availability = await this.settings.channelAvailability();
    if (mode === 'EMAIL' && !availability.EMAIL) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '邮箱注册未配置 SMTP，暂不可用');
    }
    if (mode === 'PHONE' && !availability.PHONE) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '手机号注册未配置短信服务，暂不可用');
    }
    this.assertPassword(input.password || '');
    // 用户名归一化为小写：MySQL 默认排序规则不区分大小写、PostgreSQL 区分，
    // 统一在小写口径写入与匹配，才能让「大小写不敏感的用户名」在两库上行为一致（登录/唯一约束）。
    let username = (input.username || '').trim().toLowerCase();
    let email: string | null = null;
    let phone: string | null = null;
    if (mode === 'USERNAME') {
      if (!USERNAME_PATTERN.test(username)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '用户名需为 3-32 位字母、数字、下划线或连字符',
        );
      }
    } else if (mode === 'EMAIL') {
      email = (input.email || '').trim().toLowerCase();
      if (!EMAIL_PATTERN.test(email)) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '邮箱格式不正确');
      }
      await this.channels.consumeCode('REGISTER', 'EMAIL', email, input.code || '');
      // 邮箱注册自动生成可用名（截断去重留给冲突检查兜底）
      if (!username) username = email.split('@')[0].slice(0, 32).replace(/[^\w-]/g, '_');
    } else {
      phone = (input.phone || '').trim();
      if (!PHONE_PATTERN.test(phone)) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '手机号格式不正确');
      }
      await this.channels.consumeCode('REGISTER', 'SMS', phone, input.code || '');
      if (!username) username = `u_${phone.slice(-8)}`;
    }
    await this.assertUnique({ username, email, phone });
    // 邀请码（非必填）：填了就要能对上邀请人，否则明确报错
    const inviteCodeInput = (input.inviteCode || '').trim().toUpperCase();
    let inviterId: number | null = null;
    if (inviteCodeInput) {
      const inviter = await this.prisma.account.findUnique({
        where: { inviteCode: inviteCodeInput },
      });
      if (!inviter) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '邀请码不存在，请核对后重试');
      }
      inviterId = inviter.id;
    }
    // 用户名撞车时加随机后缀重试一次（邮箱/手机注册生成的名字）
    if (await this.prisma.account.findFirst({ where: { username } })) {
      username = `${username}_${randomBytes(2).toString('hex')}`.slice(0, 32);
    }
    const created = await this.prisma.account.create({
      data: {
        username,
        email,
        phone,
        passwordHash: await bcrypt.hash(input.password || '', 10),
        emailVerified: email ? 1 : 0,
        phoneVerified: phone ? 1 : 0,
        inviteCode: await this.reserveInviteCode(),
        invitedBy: inviterId,
      },
    });
    await this.syncDirectory(created);
    await this.audit(created.id.toString(), 'ACCOUNT_REGISTER', `mode=${mode}`);
    // 注册赠分 + 邀请奖励：best-effort，失败绝不阻断注册主流程。
    if (this.points) {
      try {
        await this.points.grantOnRegister(String(created.id), inviterId);
      } catch {
        // 忽略积分发放异常
      }
    }
    return this.toPublic(created);
  }

  private async assertUnique(input: {
    username: string;
    email: string | null;
    phone: string | null;
  }) {
    const or: Record<string, unknown>[] = [{ username: input.username }];
    if (input.email) or.push({ email: input.email });
    if (input.phone) or.push({ phone: input.phone });
    const clash = await this.prisma.account.findFirst({ where: { OR: or } });
    if (clash) {
      const field =
        clash.username === input.username
          ? '用户名'
          : input.email && clash.email === input.email
            ? '邮箱'
            : '手机号';
      throw new BusinessException(ErrorCode.CONFLICT, `${field}已被占用`);
    }
  }

  private assertPassword(password: string) {
    if (
      password.length < PASSWORD_MIN_LENGTH ||
      !/[A-Za-z]/.test(password) ||
      !/\d/.test(password)
    ) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '密码至少 8 位，且需同时包含字母和数字',
      );
    }
  }

  // ---------- 发送验证码（注册 / 登录 / 找回密码 / 换绑） ----------

  async sendRegisterCode(channel: 'EMAIL' | 'SMS', target: string) {
    const modes = await this.settings.registerModes();
    const mode = channel === 'EMAIL' ? 'EMAIL' : 'PHONE';
    if (!modes.includes(mode)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '该注册方式未被管理员开启');
    }
    const normalized =
      channel === 'EMAIL' ? target.trim().toLowerCase() : target.trim();
    if (channel === 'EMAIL') {
      if (!EMAIL_PATTERN.test(normalized)) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '邮箱格式不正确');
      }
      await this.channels.sendEmailCode(
        'REGISTER',
        normalized,
        '【账户注册】验证码',
        (code) => `您的注册验证码是 ${code}，5 分钟内有效。`,
      );
    } else {
      if (!PHONE_PATTERN.test(normalized)) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '手机号格式不正确');
      }
      await this.channels.sendSmsCode('REGISTER', normalized);
    }
    return { sent: true };
  }

  // ---------- 登录 ----------

  /** 本地登录：返回签好名的会话令牌（路由层写 Cookie）。 */
  async login(identifier: string, password: string, ctx: LoginContext) {
    const key = identifier.trim().toLowerCase();
    const state = this.failures.get(key);
    if (state && state.lockedUntil > Date.now()) {
      await this.logLogin(key, null, false, ctx, '尝试过于频繁，账号已临时锁定');
      throw new BusinessException(
        ErrorCode.RATE_LIMITED,
        '连续失败次数过多，账号已锁定 10 分钟',
      );
    }
    const account = await this.prisma.account.findFirst({
      where: {
        OR: [
          { username: key },
          { email: key },
          { phone: identifier.trim() },
        ],
      },
    });
    const ok =
      account?.passwordHash && (await bcrypt.compare(password, account.passwordHash));
    if (!account || !ok) {
      this.registerFailure(key);
      await this.logLogin(key, account?.id.toString(), false, ctx, '账号或密码错误');
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '账号或密码错误');
    }
    this.failures.delete(key);
    if (account.status === 'BANNED') {
      await this.logLogin(key, String(account.id), false, ctx, '账号已被封禁');
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        `账号已被封禁${account.banReason ? `：${account.banReason}` : ''}，如需申诉请联系管理员`,
      );
    }
    if (account.status === 'DELETED') {
      const cooldownMs = (await this.settings.cooldownDays()) * 86_400_000;
      const cancelled =
        account.deletedAt && Date.now() - account.deletedAt.getTime() <= cooldownMs;
      if (!cancelled) {
        await this.logLogin(key, String(account.id), false, ctx, '账号已注销');
        throw new BusinessException(ErrorCode.UNAUTHORIZED, '账号或密码错误');
      }
      // 冷静期内重新登录 = 撤销注销
      await this.prisma.account.update({
        where: { id: account.id },
        data: { status: 'ACTIVE', deletedAt: null },
      });
      await this.syncDirectory({ ...account, status: 'ACTIVE' });
      await this.audit(String(account.id), 'ACCOUNT_DEACTIVATE_CANCELLED', '冷静期内重新登录');
    }
    const renewed = await this.prisma.account.update({
      where: { id: account.id },
      data: { lastLoginAt: new Date() },
    });
    await this.logLogin(key, String(account.id), true, ctx);
    return {
      userId: String(renewed.id),
      username: renewed.username,
      role: renewed.role === 'PLATFORM_ADMIN' ? 'admin' : 'user',
      tokenVersion: renewed.tokenVersion,
      mustChangePassword: renewed.mustChangePassword === 1,
      public: this.toPublic(renewed),
    };
  }

  private registerFailure(key: string) {
    const state = this.failures.get(key) || { count: 0, lockedUntil: 0 };
    state.count += 1;
    if (state.count >= LOCK_THRESHOLD) {
      state.lockedUntil = Date.now() + LOCK_MS;
      state.count = 0;
    }
    this.failures.set(key, state);
  }

  private async logLogin(
    account: string,
    userId: string | null | undefined,
    success: boolean,
    ctx: LoginContext,
    reason?: string,
  ) {
    await this.prisma.loginLog
      .create({
        data: {
          account: account.slice(0, 160),
          userId: userId || null,
          success: success ? 1 : 0,
          reason: reason?.slice(0, 120) || null,
          ip: ctx.ip?.slice(0, 64) || null,
          userAgent: ctx.userAgent?.slice(0, 255) || null,
        },
      })
      .catch(() => undefined);
  }

  async loginLogs(user: CurrentUser, limit = 20) {
    const rows = await this.prisma.loginLog.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((row) => ({
      id: row.id,
      account: row.account,
      success: row.success === 1,
      reason: row.reason || '',
      ip: row.ip || '',
      userAgent: row.userAgent || '',
      createdAt: row.createdAt.toISOString(),
    }));
  }

  // ---------- 找回密码 ----------

  async requestPasswordReset(channel: 'EMAIL' | 'SMS', target: string) {
    const normalized =
      channel === 'EMAIL' ? target.trim().toLowerCase() : target.trim();
    const account = await this.prisma.account.findFirst({
      where: channel === 'EMAIL' ? { email: normalized } : { phone: normalized },
    });
    // 账号不存在与存在都返回成功，避免探测注册库
    if (!account) return { sent: true };
    if (channel === 'EMAIL') {
      await this.channels.sendEmailCode(
        'RESET_PASSWORD',
        normalized,
        '【找回密码】重置密码',
        (code) => `您的重置验证码是 ${code}，5 分钟内有效。`,
      );
    } else {
      await this.channels.sendSmsCode('RESET_PASSWORD', normalized);
    }
    return { sent: true };
  }

  async resetPassword(
    channel: 'EMAIL' | 'SMS',
    target: string,
    code: string,
    newPassword: string,
  ) {
    const normalized =
      channel === 'EMAIL' ? target.trim().toLowerCase() : target.trim();
    this.assertPassword(newPassword);
    await this.channels.consumeCode('RESET_PASSWORD', channel, normalized, code);
    const account = await this.prisma.account.findFirst({
      where: channel === 'EMAIL' ? { email: normalized } : { phone: normalized },
    });
    if (!account) throw new BusinessException(ErrorCode.UNAUTHORIZED, '账号不存在');
    await this.prisma.account.update({
      where: { id: account.id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 10),
        tokenVersion: { increment: 1 },
        mustChangePassword: 0,
      },
    });
    await this.audit(String(account.id), 'ACCOUNT_PASSWORD_RESET', `channel=${channel}`);
    return { reset: true };
  }

  // ---------- 登录态自助：改密 / 资料 / 换绑 / 注销 ----------

  private async ownedAccount(user: CurrentUser): Promise<Account> {
    const account = await this.findByUserId(user.userId);
    if (!account) throw new BusinessException(ErrorCode.UNAUTHORIZED, '账号不存在');
    return account;
  }

  async changePassword(user: CurrentUser, oldPassword: string, newPassword: string) {
    const account = await this.ownedAccount(user);
    if (!account.passwordHash || !(await bcrypt.compare(oldPassword, account.passwordHash))) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '原密码不正确');
    }
    this.assertPassword(newPassword);
    const updated = await this.prisma.account.update({
      where: { id: account.id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 10),
        tokenVersion: { increment: 1 },
        mustChangePassword: 0,
      },
    });
    await this.audit(user.userId, 'ACCOUNT_PASSWORD_CHANGED', '');
    // 回传新会话素材：路由据此换发 Cookie，使当前设备免重登，其余旧会话失效。
    return {
      changed: true,
      session: {
        userId: String(updated.id),
        username: updated.username,
        role: updated.role === 'PLATFORM_ADMIN' ? 'admin' : 'user',
        tokenVersion: updated.tokenVersion,
      },
    };
  }

  async updateProfile(
    user: CurrentUser,
    body: { avatar?: string; intro?: string; lang?: string },
  ) {
    const account = await this.ownedAccount(user);
    const updated = await this.prisma.account.update({
      where: { id: account.id },
      data: {
        ...(body.avatar !== undefined ? { avatar: body.avatar.slice(0, 512) } : {}),
        ...(body.intro !== undefined ? { intro: body.intro.slice(0, 500) } : {}),
        ...(body.lang !== undefined ? { lang: body.lang.slice(0, 16) } : {}),
      },
    });
    await this.syncDirectory(updated);
    return this.toPublic(updated);
  }

  async sendRebindCode(user: CurrentUser, channel: 'EMAIL' | 'SMS', target: string) {
    const normalized =
      channel === 'EMAIL' ? target.trim().toLowerCase() : target.trim();
    const clash = await this.prisma.account.findFirst({
      where: channel === 'EMAIL' ? { email: normalized } : { phone: normalized },
    });
    if (clash && clash.id.toString() !== user.userId) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该渠道已被其他账号绑定，无法换绑',
      );
    }
    if (channel === 'EMAIL') {
      if (!EMAIL_PATTERN.test(normalized)) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '邮箱格式不正确');
      }
      await this.channels.sendEmailCode(
        'REBIND',
        normalized,
        '【换绑邮箱】验证码',
        (code) => `您的换绑验证码是 ${code}，5 分钟内有效。`,
      );
    } else {
      if (!PHONE_PATTERN.test(normalized)) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '手机号格式不正确');
      }
      await this.channels.sendSmsCode('REBIND', normalized);
    }
    return { sent: true };
  }

  async confirmRebind(user: CurrentUser, channel: 'EMAIL' | 'SMS', target: string, code: string) {
    const normalized =
      channel === 'EMAIL' ? target.trim().toLowerCase() : target.trim();
    await this.channels.consumeCode('REBIND', channel, normalized, code);
    const account = await this.ownedAccount(user);
    const updated = await this.prisma.account.update({
      where: { id: account.id },
      data:
        channel === 'EMAIL'
          ? { email: normalized, emailVerified: 1 }
          : { phone: normalized, phoneVerified: 1 },
    });
    await this.syncDirectory(updated);
    await this.audit(user.userId, 'ACCOUNT_REBIND', `channel=${channel}`);
    return this.toPublic(updated);
  }

  async deactivate(user: CurrentUser) {
    const account = await this.ownedAccount(user);
    const updated = await this.prisma.account.update({
      where: { id: account.id },
      data: { status: 'DELETED', deletedAt: new Date(), tokenVersion: { increment: 1 } },
    });
    await this.syncDirectory(updated);
    await this.audit(user.userId, 'ACCOUNT_DEACTIVATED', '');
    return {
      deactivated: true,
      cooldownDays: await this.settings.cooldownDays(),
    };
  }

  async me(user: CurrentUser) {
    const account = await this.prisma.account.findUnique({
      where: { id: Number(user.userId) },
    });
    if (!account) throw new BusinessException(ErrorCode.UNAUTHORIZED, '账号不存在');
    return this.toPublic(account);
  }

  // ---------- 邀请体系 ----------

  /** 采样一个未被占用的 6 位邀请码（重试兜底后扩到 8 位，几乎不可能走到）。 */
  private async reserveInviteCode(): Promise<string> {
    for (const length of [6, 8]) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const bytes = randomBytes(length);
        const code = Array.from(
          bytes,
          (byte) => INVITE_ALPHABET[byte % INVITE_ALPHABET.length],
        ).join('');
        const clash = await this.prisma.account.findUnique({ where: { inviteCode: code } });
        if (!clash) return code;
      }
    }
    return `INV${Date.now().toString(36).toUpperCase().slice(-8)}`;
  }

  /**
   * 我的邀请信息：自己的邀请码（存量账户无码时懒生成落库）、被谁邀请、已邀请人数。
   * 邀请码本就用于对外分享，非机密。
   */
  async inviteInfo(user: CurrentUser) {
    const account = await this.ownedAccount(user);
    let inviteCode = account.inviteCode || '';
    if (!inviteCode) {
      inviteCode = await this.reserveInviteCode();
      // 并发下唯一索引兜底：冲突则重读已有码
      const updated = await this.prisma.account
        .update({ where: { id: account.id }, data: { inviteCode } })
        .catch(() => this.prisma.account.findUniqueOrThrow({ where: { id: account.id } }));
      if (!updated.inviteCode) {
        throw new BusinessException(ErrorCode.INTERNAL_ERROR, '邀请码生成失败，请稍后重试');
      }
      inviteCode = updated.inviteCode;
    }
    const [inviter, invitedCount] = await Promise.all([
      account.invitedBy
        ? this.prisma.account.findUnique({
            where: { id: account.invitedBy },
            select: { id: true, username: true },
          })
        : Promise.resolve(null),
      this.prisma.account.count({ where: { invitedBy: account.id } }),
    ]);
    return {
      inviteCode,
      invitedBy: inviter
        ? { userId: String(inviter.id), username: inviter.username }
        : null,
      invitedCount,
    };
  }

  // ---------- 平台管理员兜底 ----------

  async adminResetPassword(user: CurrentUser, userId: string) {
    const account = await this.findByUserId(userId);
    if (!account) throw new BusinessException(ErrorCode.NOT_FOUND, '用户不存在');
    const plain = `${randomBytes(6).toString('base64url')}aA1`;
    await this.prisma.account.update({
      where: { id: account.id },
      data: {
        passwordHash: await bcrypt.hash(plain, 10),
        tokenVersion: { increment: 1 },
        mustChangePassword: 1,
      },
    });
    await this.audit(user.userId, 'ADMIN_PASSWORD_RESET', `target=${userId}`);
    // 一次性明文：仅本次响应出现，之后不可再取
    return { userId, newPassword: plain, mustChangePassword: true };
  }

  async adminSetStatus(user: CurrentUser, userId: string, status: 'ACTIVE' | 'BANNED', reason = '') {
    const account = await this.findByUserId(userId);
    if (!account) throw new BusinessException(ErrorCode.NOT_FOUND, '用户不存在');
    const updated = await this.prisma.account.update({
      where: { id: account.id },
      data: {
        status,
        banReason: status === 'BANNED' ? reason.slice(0, 255) : null,
        tokenVersion: { increment: 1 },
      },
    });
    await this.syncDirectory(updated);
    await this.audit(
      user.userId,
      status === 'BANNED' ? 'ADMIN_USER_BANNED' : 'ADMIN_USER_UNBANNED',
      `target=${userId} reason=${reason}`.slice(0, 480),
    );
    return this.toPublic(updated);
  }

  async adminSearchUsers(user: CurrentUser, keyword: string, limit = 20) {
    const trimmed = keyword.trim();
    // 用户名/邮箱以小写存储，手机号为数字：关键词统一小写后 contains，保证 PG 与 MySQL 命中一致。
    const needle = trimmed.toLowerCase();
    const rows = await this.prisma.account.findMany({
      where: trimmed
        ? {
            OR: [
              { username: { contains: needle } },
              { email: { contains: needle } },
              { phone: { contains: needle } },
            ],
          }
        : {},
      orderBy: { id: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((row) => this.toPublic(row));
  }

  // ---------- 目录同步与审计 ----------

  /** user_directory 是本地 users 的投影：各模块「createdBy → 显示名」的查询不改代码。 */
  async syncDirectory(account: Pick<Account, 'id' | 'username' | 'email' | 'avatar' | 'status' | 'createdAt'>) {
    const data = {
      username: account.username,
      displayName: account.username,
      email: account.email || '',
      avatarUrl: account.avatar || '',
      role: '',
      enabled: account.status === 'ACTIVE' ? 1 : 0,
      syncedAt: new Date(),
    };
    await this.prisma.userDirectory
      .upsert({
        where: { userId: String(account.id) },
        update: data,
        create: { userId: String(account.id), createdAt: account.createdAt, ...data },
      })
      .catch(() => undefined);
  }

  private async audit(userId: string, action: string, detail: string) {
    await this.prisma.auditLog
      .create({ data: { userId, action: action.slice(0, 64), detail: detail.slice(0, 500) } })
      .catch(() => undefined);
  }
}
