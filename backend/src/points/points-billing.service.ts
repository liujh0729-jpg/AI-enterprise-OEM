import type { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { Logger } from '../common/logger';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { PointsSettingsService } from './points-settings.service';
import { PointsService } from './points.service';
import { RechargeService } from './recharge.service';

const GB = 1024 * 1024 * 1024;

function toNum(v: Prisma.Decimal | number | null | undefined): number {
  return v === null || v === undefined ? 0 : Number(v);
}
function todayKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}
function dayStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

/**
 * 计费出账日批（进程内定时触发）：
 * 1) 数字资产每日存储快照（按用户聚合字节，幂等键 userId+snapshotAt）；
 * 2) asset_storage 按 GB·天出账（扣月免费额，欠费只冻结新增永不删数据）；
 * 3) crm 席位月费（每月 1 日按 owner 聚合 ACTIVE 席位，超免费额扣费）；
 * 4) 关闭超时未支付充值单；
 * 5) 欠费状态流转与宽限。
 * 全部动作以 point_settings 的 last_daily_batch_date 做「今天只跑一次」幂等。
 */
export class PointsBillingService {
  private readonly logger = new Logger(PointsBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PointsSettingsService,
    private readonly points: PointsService,
    private readonly recharge: RechargeService,
  ) {}

  async runDailyBatch() {
    const key = todayKey();
    const done = await this.settings.flag('last_daily_batch_date');
    if (done === key) return { skipped: true };
    const snapshotAt = dayStart();
    const summary = {
      snapshots: 0,
      storageCharged: 0,
      storageArrears: 0,
      seatCharged: 0,
      rechargesClosed: 0,
    };
    try {
      summary.snapshots = await this.snapshotStorage(snapshotAt);
      const storage = await this.chargeStorage(snapshotAt);
      summary.storageCharged = storage.charged;
      summary.storageArrears = storage.arrears;
      if (snapshotAt.getDate() === 1) {
        summary.seatCharged = await this.chargeCrmSeats(snapshotAt);
      }
      summary.rechargesClosed = await this.recharge.closeExpired(
        new Date(Date.now() - 2 * 3600_000),
      );
      await this.refreshArrearsStatus();
      // 全部成功后再落幂等标记：中途异常下轮可重试
      await this.settings.setFlag('last_daily_batch_date', key);
      this.logger.log(`积分日批完成：${JSON.stringify(summary)}`);
    } catch (error) {
      this.logger.error(
        `积分日批失败：${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
    return summary;
  }

  /** 快照每个有资产用户的当日总字节（fileSize 单位 MB）。 */
  private async snapshotStorage(snapshotAt: Date) {
    const grouped = await this.prisma.digitalAssetEntry.groupBy({
      by: ['userId'],
      _sum: { fileSize: true },
      _count: { _all: true },
    });
    let count = 0;
    for (const row of grouped) {
      const bytes = BigInt(Math.round((row._sum.fileSize || 0) * 1024 * 1024));
      await this.prisma.storageDailySnapshot.upsert({
        where: { userId_snapshotAt: { userId: row.userId, snapshotAt } },
        create: {
          userId: row.userId,
          bytesAmount: bytes,
          assetCount: row._count._all,
          snapshotAt,
        },
        update: { bytesAmount: bytes, assetCount: row._count._all },
      });
      count += 1;
    }
    return count;
  }

  /** asset_storage 按 GB·天出账：超免费额部分计费，欠费标记 ARREARS。 */
  private async chargeStorage(snapshotAt: Date) {
    const pricing = await this.prisma.modulePricing.findUnique({
      where: { code: 'asset_storage' },
    });
    if (!pricing || !pricing.enabled || pricing.mode !== 'METERED') {
      return { charged: 0, arrears: 0 };
    }
    const unitPrice = toNum(pricing.unitPriceAmount);
    const freeGB = toNum(pricing.freeQuotaAmount);
    const minCharge = toNum(pricing.minChargeAmount);
    if (unitPrice <= 0) return { charged: 0, arrears: 0 };
    const snapshots = await this.prisma.storageDailySnapshot.findMany({
      where: { snapshotAt },
    });
    let charged = 0;
    let arrears = 0;
    for (const snap of snapshots) {
      const gb = Number(snap.bytesAmount) / GB;
      const chargeableGB = Math.max(0, gb - freeGB);
      const amount = Number((chargeableGB * unitPrice).toFixed(4));
      if (amount < minCharge || amount <= 0) continue;
      try {
        const debit = await this.points.debit(snap.userId, 'SPEND', amount, {
          scene: 'asset_storage',
          refType: 'storage_snapshot',
          refId: String(snap.id),
          remark: `存储 ${gb.toFixed(2)}GB·天（免费 ${freeGB}GB）`,
        });
        await this.prisma.usageEvent.create({
          data: {
            userId: snap.userId,
            code: 'asset_storage',
            quantityAmount: chargeableGB,
            occurredAt: snapshotAt,
            billed: 1,
            billTxId: debit.txId,
            remark: `日账单 ${amount}`,
          },
        });
        charged += 1;
      } catch (error) {
        if (
          error instanceof BusinessException &&
          error.errorCode.code === ErrorCode.POINTS_INSUFFICIENT.code
        ) {
          await this.markArrears(snap.userId);
          arrears += 1;
        } else {
          throw error;
        }
      }
    }
    return { charged, arrears };
  }

  /** crm 席位月费：按 owner 聚合 ACTIVE 席位，超免费额扣费（每月 1 日出账）。 */
  private async chargeCrmSeats(snapshotAt: Date) {
    const pricing = await this.prisma.modulePricing.findUnique({
      where: { code: 'crm' },
    });
    if (!pricing || !pricing.enabled || pricing.mode !== 'METERED') return 0;
    const unitPrice = toNum(pricing.unitPriceAmount);
    const freeSeats = toNum(pricing.freeQuotaAmount);
    const minCharge = toNum(pricing.minChargeAmount);
    if (unitPrice <= 0) return 0;
    const grouped = await this.prisma.crmMember.groupBy({
      by: ['ownerUserId'],
      where: { status: 'ACTIVE' },
      _count: { memberUserId: true },
    });
    let charged = 0;
    for (const row of grouped) {
      const chargeableSeats = Math.max(0, row._count.memberUserId - freeSeats);
      const amount = Number((chargeableSeats * unitPrice).toFixed(4));
      if (amount < minCharge || amount <= 0) continue;
      try {
        const debit = await this.points.debit(
          row.ownerUserId,
          'SPEND',
          amount,
          {
            scene: 'crm',
            refType: 'crm_seat_month',
            refId: todayKey(snapshotAt),
            remark: `CRM 席位 ${row._count.memberUserId}（免费 ${freeSeats}）`,
          },
        );
        await this.prisma.usageEvent.create({
          data: {
            userId: row.ownerUserId,
            code: 'crm',
            quantityAmount: chargeableSeats,
            occurredAt: snapshotAt,
            billed: 1,
            billTxId: debit.txId,
            remark: `席位月费 ${amount}`,
          },
        });
        charged += 1;
      } catch (error) {
        if (
          error instanceof BusinessException &&
          error.errorCode.code === ErrorCode.POINTS_INSUFFICIENT.code
        ) {
          await this.markArrears(row.ownerUserId);
        } else {
          throw error;
        }
      }
    }
    return charged;
  }

  private async markArrears(userId: string) {
    await this.points.ensureAccount(userId);
    await this.prisma.pointAccount.update({
      where: { userId },
      data: { status: 'ARREARS', arrearsSince: new Date() },
    });
  }

  /**
   * 欠费宽限：状态为 ARREARS 且充值/入账后余额已回正 → 复活动费；
   * 永不自动删除数据，超宽限仅维持冻结（新增拦截在业务侧读 status 判断）。
   */
  private async refreshArrearsStatus() {
    const cfg = await this.settings.view();
    const arrears = await this.prisma.pointAccount.findMany({
      where: { status: 'ARREARS' },
    });
    for (const account of arrears) {
      if (toNum(account.balanceAmount) > 0) {
        await this.prisma.pointAccount.update({
          where: { userId: account.userId },
          data: { status: 'ACTIVE', arrearsSince: null },
        });
      }
    }
    // cfg.arrearsGraceDays 目前仅用于业务侧冻结时长展示，数据永不删除
    void cfg.arrearsGraceDays;
  }
}
