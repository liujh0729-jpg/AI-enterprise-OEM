import { randomBytes } from 'node:crypto';
import type { WechatMpBindingRow, WechatMpStatus } from '@enterprise/contracts';
import { pageOf, pageParam, text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { RateWindow } from '../common/rate-window';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { UserLookupService } from '../directory/user-lookup.service';
import type { IdentityService } from '../identity/identity.service';
import { maskOpenId } from './wechat-mp-crypto';
import type { WechatMpClient } from './wechat-mp.client';
import type { WechatMpSettingsService } from './wechat-mp.settings';

const SCENE_TTL_MS = 5 * 60 * 1000;
const SCENE_DAILY_LIMIT = 20;
const sceneWindow = new RateWindow(1, 30_000);

export type BindSceneResult = { ok: boolean; message: string };

/** 场景二维码 → openId ↔ userId 绑定、关注状态与后台绑定列表。 */
export class WechatMpBindingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: WechatMpSettingsService,
    private readonly client: WechatMpClient,
    private readonly users: UserLookupService,
    private readonly identity: IdentityService,
  ) {}

  async status(user: CurrentUser): Promise<WechatMpStatus> {
    const [settings, binding] = await Promise.all([
      this.settings.load(),
      this.prisma.wechatMpBinding.findUnique({
        where: { userId: user.userId },
      }),
    ]);
    return {
      enabled: settings.enabled,
      bound: Boolean(binding),
      subscribed: binding?.subscribed === true,
      muted: binding?.pushMuted === true,
      nickname: binding?.nickname || '',
      accountName: settings.accountName,
      boundAt: binding?.createdAt.toISOString() || null,
    };
  }

  async createBindScene(user: CurrentUser) {
    const runtime = await this.settings.requireRuntime();
    sceneWindow.consume(
      user.userId,
      '二维码生成过于频繁，请稍后再试（30 秒内只能生成一次）',
    );
    const since = startOfToday();
    const todayCount = await this.prisma.wechatMpBindScene.count({
      where: { userId: user.userId, createdAt: { gte: since } },
    });
    if (todayCount >= SCENE_DAILY_LIMIT) {
      throw new BusinessException(
        ErrorCode.RATE_LIMITED,
        '今天生成的绑定二维码已达上限，请明天再试或联系平台管理员',
      );
    }
    await this.prisma.wechatMpBindScene
      .deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } },
      })
      .catch(() => undefined);
    const scene = `bind_${randomBytes(16).toString('hex')}`;
    const expiresAt = new Date(Date.now() + SCENE_TTL_MS);
    await this.prisma.wechatMpBindScene.create({
      data: { scene, userId: user.userId, expiresAt },
    });
    const qrcode = await this.client.createQrcode(
      runtime,
      scene,
      Math.floor(SCENE_TTL_MS / 1000),
    );
    return {
      scene,
      qrUrl: qrcode.url,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async unbind(user: CurrentUser) {
    const result = await this.prisma.wechatMpBinding.deleteMany({
      where: { userId: user.userId },
    });
    await this.audit(user.userId, 'wechat_mp.unbind', '用户解绑微信服务号');
    return { removed: result.count > 0 };
  }

  async findByOpenId(openId: string) {
    if (!openId) return null;
    return this.prisma.wechatMpBinding.findUnique({ where: { openId } });
  }

  async touch(openId: string) {
    await this.prisma.wechatMpBinding
      .updateMany({
        where: { openId },
        data: { lastInteractionAt: new Date() },
      })
      .catch(() => undefined);
  }

  async markSubscribed(openId: string, unionId?: string) {
    await this.prisma.wechatMpBinding
      .updateMany({
        where: { openId },
        data: {
          subscribed: true,
          subscribedAt: new Date(),
          unsubscribedAt: null,
          lastInteractionAt: new Date(),
          ...(unionId ? { unionId } : {}),
        },
      })
      .catch(() => undefined);
  }

  async markUnsubscribed(openId: string) {
    await this.prisma.wechatMpBinding
      .updateMany({
        where: { openId },
        data: {
          subscribed: false,
          unsubscribedAt: new Date(),
          lastInteractionAt: new Date(),
        },
      })
      .catch(() => undefined);
  }

  async setMuted(openId: string, muted: boolean) {
    await this.prisma.wechatMpBinding
      .updateMany({
        where: { openId },
        data: { pushMuted: muted, lastInteractionAt: new Date() },
      })
      .catch(() => undefined);
  }

  /**
   * 关注 / 已关注扫码：scene 固定 userId，二维码转发也只能绑定到创建者。
   * 双向冲突（openId 已绑他人 / 当前账号已绑其他 openId）一律拒绝，要求先解绑。
   */
  async bindFromScene(
    openId: string,
    scene: string,
    unionId?: string,
  ): Promise<BindSceneResult> {
    if (!scene) return { ok: false, message: '' };
    const row = await this.prisma.wechatMpBindScene.findUnique({
      where: { scene },
    });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
      return {
        ok: false,
        message: '二维码已失效，请回到网页重新生成后再扫码。',
      };
    }
    const [openBound, userBound] = await Promise.all([
      this.prisma.wechatMpBinding.findUnique({ where: { openId } }),
      this.prisma.wechatMpBinding.findUnique({
        where: { userId: row.userId },
      }),
    ]);
    if (openBound && openBound.userId !== row.userId) {
      return {
        ok: false,
        message: '该微信已绑定其他账号。请先在原账号网页端解绑，再重新扫码。',
      };
    }
    if (userBound && userBound.openId !== openId) {
      return {
        ok: false,
        message: '当前账号已绑定其他微信。请先在网页端解绑，再重新扫码。',
      };
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.wechatMpBinding.upsert({
        where: { openId },
        create: {
          userId: row.userId,
          openId,
          unionId: unionId || null,
          subscribed: true,
          subscribedAt: new Date(),
          lastInteractionAt: new Date(),
          source: 'qrcode',
        },
        update: {
          userId: row.userId,
          subscribed: true,
          subscribedAt: new Date(),
          unsubscribedAt: null,
          lastInteractionAt: new Date(),
          ...(unionId ? { unionId } : {}),
        },
      });
      await tx.wechatMpBindScene.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      });
    });
    return { ok: true, message: '绑定成功，任务与审批提醒会推送到这个微信。' };
  }

  async listBindings(query: Record<string, unknown>) {
    const { page, pageSize, offset } = pageParam(
      query.page as string | number | undefined,
      query.pageSize as string | number | undefined,
      20,
    );
    const keyword = text(query.keyword).trim().slice(0, 80);
    const subscribed = text(query.subscribed, 'all');
    const directoryIds = keyword
      ? (
          await this.prisma.userDirectory.findMany({
            where: {
              OR: [
                { displayName: { contains: keyword } },
                { username: { contains: keyword } },
              ],
            },
            select: { userId: true },
            take: 100,
          })
        ).map((row) => row.userId)
      : [];
    const where = {
      ...(subscribed === 'yes'
        ? { subscribed: true }
        : subscribed === 'no'
          ? { subscribed: false }
          : {}),
      ...(keyword
        ? {
            OR: [
              { openId: { contains: keyword } },
              { nickname: { contains: keyword } },
              { userId: { contains: keyword } },
              ...(directoryIds.length
                ? [{ userId: { in: directoryIds } }]
                : []),
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.wechatMpBinding.count({ where }),
      this.prisma.wechatMpBinding.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: offset,
        take: pageSize,
      }),
    ]);
    const names = await this.users.displayNames(rows.map((row) => row.userId));
    const list: WechatMpBindingRow[] = rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      userName: names.get(row.userId) || row.userId,
      nickname: row.nickname,
      openIdMasked: maskOpenId(row.openId),
      subscribed: row.subscribed,
      pushMuted: row.pushMuted,
      source: row.source,
      subscribedAt: row.subscribedAt?.toISOString() || null,
      unsubscribedAt: row.unsubscribedAt?.toISOString() || null,
      lastInteractionAt: row.lastInteractionAt?.toISOString() || null,
      createdAt: row.createdAt.toISOString(),
    }));
    return pageOf(list, total, page, pageSize);
  }

  async unbindByAdmin(user: CurrentUser, userId: string) {
    this.identity.requireAdmin(user);
    const result = await this.prisma.wechatMpBinding.deleteMany({
      where: { userId },
    });
    await this.audit(
      user.userId,
      'wechat_mp.admin.unbind',
      `管理员解绑用户 ${userId}`,
    );
    return { removed: result.count > 0 };
  }

  async counts() {
    const [boundCount, subscribedCount, mutedCount] = await Promise.all([
      this.prisma.wechatMpBinding.count(),
      this.prisma.wechatMpBinding.count({ where: { subscribed: true } }),
      this.prisma.wechatMpBinding.count({ where: { pushMuted: true } }),
    ]);
    return { boundCount, subscribedCount, mutedCount };
  }

  private async audit(userId: string, action: string, detail: string) {
    await this.prisma.auditLog
      .create({ data: { userId, action, detail: detail.slice(0, 500) } })
      .catch(() => undefined);
  }
}

export function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
