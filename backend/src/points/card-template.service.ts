import type { Prisma } from '../../generated/prisma';
import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { GapScopeService } from '../gaps/gaps.scope';
import {
  asInt,
  asNum,
  asText,
  clip,
  jsonArray,
  Row,
  safeStatus,
} from '../gaps/gaps.helpers';
import type { PrismaService } from '../prisma/prisma.service';
import { cardUnitLabel, formatQuota, isCardBillingUnit } from './card.pricing';

const STATUSES = ['ACTIVE', 'DISABLED'] as const;
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: '启用',
  DISABLED: '停用',
};

type TemplateRow = {
  id: number;
  code: string;
  name: string;
  catalogId: number;
  provider: string;
  modelKey: string;
  billingUnit: string;
  quotaTotal: unknown;
  validDays: number;
  specMultipliers: Prisma.JsonValue;
  pointsPrice: unknown;
  cashCents: number;
  perUserLimit: number;
  status: string;
  sortOrder: number;
  remark: string;
  createdAt: Date;
};

/** 倍率表最多 20 行，且只允许写在「按秒计费」的卡上。 */
const SPEC_MULTIPLIER_CAP = 20;

/**
 * 时长卡规格目录（平台管理员维护）：一张卡 = 一个模型 + 一个额度 + 一个有效期。
 *
 * 保存时把模型的 provider / modelKey / billingUnit 快照进行规格行，
 * 之后目录改名、换上游或下架都不影响已发出的卡怎么说自己配的是谁。
 */
export class CardTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: GapScopeService,
  ) {}

  private async nameMap(rows: { catalogId: number }[]) {
    const ids = Array.from(
      new Set(rows.map((row) => row.catalogId).filter((id) => id > 0)),
    );
    if (!ids.length) return new Map<number, string>();
    const catalog = await this.prisma.modelCatalog.findMany({
      where: { id: { in: ids } },
      select: { id: true, displayName: true, modelKey: true },
    });
    return new Map(
      catalog.map((row) => [row.id, row.displayName || row.modelKey]),
    );
  }

  private view(row: TemplateRow, names: Map<number, string>) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      catalogId: row.catalogId,
      provider: row.provider,
      modelKey: row.modelKey,
      modelName: names.get(row.catalogId) || row.modelKey,
      billingUnit: row.billingUnit,
      billingUnitLabel: cardUnitLabel(row.billingUnit),
      quotaTotal: asNum(row.quotaTotal),
      quotaLabel: formatQuota(row.billingUnit, asNum(row.quotaTotal)),
      validDays: row.validDays,
      specMultipliers: jsonArray(row.specMultipliers),
      pointsPrice: asNum(row.pointsPrice),
      cashCents: row.cashCents,
      perUserLimit: row.perUserLimit,
      status: row.status,
      statusLabel: STATUS_LABELS[row.status] || row.status,
      sortOrder: row.sortOrder,
      remark: row.remark,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(user: CurrentUser, opts: { admin: boolean }) {
    // 用户侧只给启用的规格（兑换码面板与「用积分换卡」都读它）；管理侧全量。
    // 登录态由 business 路由组统一校验，这里不再重复判权限。
    if (opts.admin) this.scope.requirePlatformAdmin(user);
    const rows = await this.prisma.pointCardTemplate.findMany({
      where: opts.admin ? {} : { status: 'ACTIVE' },
      orderBy: opts.admin
        ? [{ sortOrder: 'asc' }, { id: 'desc' }]
        : [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const names = await this.nameMap(rows);
    return rows.map((row) => this.view(row, names));
  }

  /** 码目录绑定卡规格时用：只认 code，不区分状态（停用规格不能再被新码绑定）。 */
  async byCode(code: string) {
    const value = asText(code).trim().toUpperCase();
    if (!value) return null;
    return this.prisma.pointCardTemplate.findUnique({ where: { code: value } });
  }

  async save(user: CurrentUser, body: Row) {
    this.scope.requirePlatformAdmin(user);
    const id = asInt(body.id);
    const code = asText(body.code).trim().toUpperCase().slice(0, 32);
    const name = clip(body.name, 80).trim();
    if (code.length < 2)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写至少 2 位的卡规格编码',
      );
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写卡名称');

    const catalogId = asInt(body.catalogId);
    if (catalogId <= 0)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择卡绑定的模型（一张卡只能绑一个模型）',
      );
    const catalog = await this.prisma.modelCatalog.findUnique({
      where: { id: catalogId },
    });
    if (!catalog)
      throw new BusinessException(ErrorCode.NOT_FOUND, '所选模型不存在');
    if (!isCardBillingUnit(catalog.billingUnit)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `${catalog.displayName || catalog.modelKey} 的计费单位是「${cardUnitLabel(
          catalog.billingUnit,
        )}」，只有按 tokens / 张 / 秒计费的模型才能建卡`,
      );
    }
    if (!catalog.enabled && !id) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该模型尚未上架，请先在模型广场上架后再建卡',
      );
    }

    const quotaTotal = asNum(body.quotaTotal);
    if (!(quotaTotal > 0))
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `请填写大于 0 的额度（单位：${cardUnitLabel(catalog.billingUnit)}）`,
      );
    const validDays = Math.min(
      3650,
      Math.max(1, asInt(body.validDays, 1) || 1),
    );
    const specMultipliers = normalizeMultipliers(
      body.specMultipliers,
      catalog.billingUnit,
    );
    const pointsPrice = Math.max(0, asNum(body.pointsPrice));
    const cashCents = Math.max(0, asInt(body.cashCents));
    // 0＝不限；上限按卡规格归并，兑换码 / 积分 / 现金三入口合计计数。
    const perUserLimit = Math.min(100, Math.max(0, asInt(body.perUserLimit)));

    const existing = id
      ? await this.prisma.pointCardTemplate.findUnique({ where: { id } })
      : null;
    if (id && !existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '卡规格不存在');
    const conflict = await this.prisma.pointCardTemplate.findUnique({
      where: { code },
    });
    if (conflict && conflict.id !== existing?.id) {
      throw new BusinessException(ErrorCode.CONFLICT, '该卡规格编码已存在');
    }

    const data = {
      code,
      name,
      catalogId: catalog.id,
      provider: catalog.provider,
      modelKey: catalog.modelKey,
      billingUnit: catalog.billingUnit,
      quotaTotal,
      validDays,
      specMultipliers: specMultipliers as Prisma.InputJsonValue,
      pointsPrice,
      cashCents,
      perUserLimit,
      status: safeStatus(body.status, STATUSES, 'ACTIVE'),
      sortOrder: Math.max(0, asInt(body.sortOrder)),
      remark: clip(body.remark, 200).trim(),
      createdBy: user.userId,
    };
    const row = existing
      ? await this.prisma.pointCardTemplate.update({
          where: { id: existing.id },
          data: { ...data, createdBy: existing.createdBy },
        })
      : await this.prisma.pointCardTemplate.create({ data });
    const names = await this.nameMap([row]);
    return this.view(row, names);
  }

  /** 停用而不是删除：已发出去的卡要能继续说明自己来自哪个规格。 */
  async disable(user: CurrentUser, codeRaw: string) {
    this.scope.requirePlatformAdmin(user);
    const code = asText(codeRaw).trim().toUpperCase();
    const row = await this.prisma.pointCardTemplate.findUnique({
      where: { code },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '卡规格不存在');
    await this.prisma.pointCardTemplate.update({
      where: { id: row.id },
      data: { status: 'DISABLED' },
    });
    // 绑它的兑换码同步失效提示：码仍可按状态停用，这里只保证不再出现在可选规格里
    return { removed: true };
  }
}

/**
 * 倍率表校验：只允许按秒计费的卡配置，行形如 `{ match: { video_resolution: '720p' }, multiplier: 2 }`。
 * 空表是合法状态，语义为「一律按 1 倍计」；未命中档位也回落 1 倍（D7=A）。
 */
function normalizeMultipliers(raw: unknown, billingUnit: string) {
  const rows = jsonArray(raw);
  if (!rows.length) return [];
  if (billingUnit !== 'second') {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '只有按秒计费的视频卡需要配置规格倍率，图片卡与 tokens 卡一律按 1 计',
    );
  }
  if (rows.length > SPEC_MULTIPLIER_CAP) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `规格倍率最多 ${SPEC_MULTIPLIER_CAP} 行`,
    );
  }
  return rows.map((row) => {
    const rawMatch = row.match;
    const match: Row =
      rawMatch && typeof rawMatch === 'object' && !Array.isArray(rawMatch)
        ? (rawMatch as Row)
        : {};
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(match || {})) {
      const name = key.trim();
      const text = asText(value).trim().toLowerCase();
      if (!name || !text) continue;
      normalized[name] = text;
    }
    if (!Object.keys(normalized).length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '规格倍率缺少档位，例如 { video_resolution: "720p" }',
      );
    }
    const multiplier = asNum(row.multiplier);
    if (!(multiplier > 0) || multiplier > 1000) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '规格倍率必须大于 0 且不超过 1000',
      );
    }
    return { match: normalized, multiplier: Number(multiplier.toFixed(4)) };
  });
}
