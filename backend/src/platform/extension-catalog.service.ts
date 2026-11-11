import {
  EXTENSION_CAPABILITIES,
  EXTENSION_CAPABILITY_STATUS_LABELS,
  extensionCapabilityDefOf,
  type ExtensionCapabilityDef,
  type ExtensionCapabilityStatus,
  type ExtensionCapabilitySaveBody,
} from '@enterprise/contracts';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import {
  EXTENSION_RELEASE,
  extensionPublished,
} from '../distribution/extension-release';
import { compareVersions } from '../upgrade/upgrade-version';
import type { PrismaService } from '../prisma/prisma.service';

/** 平台覆盖行（没有行＝全部沿用契约默认值）。 */
interface CapabilityOverrideRow {
  key: string;
  status: string;
  minVersion: string;
  grayOrgIds: unknown;
  forceUpgradeAt: Date | null;
  note: string;
}

/** 派发前的生效口径：能力状态 / 最低版本 / 灰度机构 / 强制升级时间。 */
export interface ExtensionCapabilityEffective {
  key: string;
  status: ExtensionCapabilityStatus;
  minVersion: string;
  grayOrgIds: string[];
  forceUpgradeAt: Date | null;
}

/**
 * 平台统一插件的能力目录（设计方案 §10.7）：能力定义写在契约层（EXTENSION_CAPABILITIES），
 * 本服务只把平台可运营的覆盖值（启用 / 灰度 / 强制升级 / 下线）从 extension_capabilities 表
 * 合并进来对外，无覆盖行时回落契约默认值——避免能力清单在服务端与插件各写一套。
 */
export class ExtensionCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** 归一化灰度机构 userId 列表：非字符串与空白一律丢弃。 */
  private normalizeIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item !== '');
  }

  /** 平台覆盖值优先，空则回落契约默认。 */
  private effectiveStatus(row?: CapabilityOverrideRow): string {
    return row?.status?.trim() || '';
  }

  private viewOf(def: ExtensionCapabilityDef, row?: CapabilityOverrideRow) {
    const status = this.effectiveStatus(row) || def.status;
    return {
      key: def.key,
      label: def.label,
      description: def.description,
      entry: def.entry,
      minVersion: row?.minVersion?.trim() || def.minVersion,
      status,
      statusLabel: EXTENSION_CAPABILITY_STATUS_LABELS[status] || status,
      businessModules: [...def.businessModules],
      platforms: [...def.platforms],
      actions: def.actions.map((action) => ({
        key: action.key,
        label: action.label,
        requiresConfirmation: action.requiresConfirmation,
        input: Object.fromEntries(
          Object.entries(action.input ?? {}).map(([field, spec]) => [
            field,
            { ...spec },
          ]),
        ),
        output: Object.fromEntries(
          Object.entries(action.output ?? {}).map(([field, spec]) => [
            field,
            { ...spec },
          ]),
        ),
      })),
      sitePermissions: [...def.sitePermissions],
      requiresConfirmation: def.requiresConfirmation,
      completionEvidence: [...def.completionEvidence],
      retryRule: def.retryRule,
      dataMinimization: def.dataMinimization,
      grayOrgIds: this.normalizeIds(row?.grayOrgIds),
      forceUpgradeAt: row?.forceUpgradeAt
        ? row.forceUpgradeAt.toISOString()
        : null,
      note: row?.note || '',
    };
  }

  /** 插件发布信息（不含能力清单，能力单独成列；字段与 extensionReleaseSchema 对齐）。 */
  private releaseView() {
    return {
      name: EXTENSION_RELEASE.name,
      version: EXTENSION_RELEASE.version,
      minVersion: EXTENSION_RELEASE.minVersion,
      downloadPath: EXTENSION_RELEASE.downloadPath,
      chromeStoreUrl: EXTENSION_RELEASE.chromeStoreUrl,
      edgeStoreUrl: EXTENSION_RELEASE.edgeStoreUrl,
      checksum: EXTENSION_RELEASE.checksum,
      browsers: [...EXTENSION_RELEASE.browsers],
      homepage: EXTENSION_RELEASE.homepage,
      installSteps: [...EXTENSION_RELEASE.installSteps],
      usage: [...EXTENSION_RELEASE.usage],
      changelog: EXTENSION_RELEASE.changelog.map((entry) => ({
        version: entry.version,
        date: entry.date,
        notes: [...entry.notes],
      })),
      published: extensionPublished(),
    };
  }

  private async overrideRows(): Promise<Map<string, CapabilityOverrideRow>> {
    const rows = await this.prisma.extensionCapability.findMany();
    return new Map(rows.map((row) => [row.key, row]));
  }

  /** 能力目录 + 插件发布信息（登录用户可读，前端入口与工具页共用）。 */
  async catalog() {
    const overrides = await this.overrideRows();
    return {
      release: this.releaseView(),
      capabilities: EXTENSION_CAPABILITIES.map((def) =>
        this.viewOf(def, overrides.get(def.key)),
      ),
    };
  }

  /** 派发前的生效口径；能力 key 不在契约清单里时返回 undefined。 */
  async effective(
    key: string,
  ): Promise<ExtensionCapabilityEffective | undefined> {
    const def = extensionCapabilityDefOf(key);
    if (!def) return undefined;
    const row = await this.prisma.extensionCapability.findUnique({
      where: { key },
    });
    const status = (this.effectiveStatus(row ?? undefined) ||
      def.status) as ExtensionCapabilityStatus;
    return {
      key: def.key,
      status,
      minVersion: row?.minVersion?.trim() || def.minVersion,
      grayOrgIds: this.normalizeIds(row?.grayOrgIds),
      forceUpgradeAt: row?.forceUpgradeAt ?? null,
    };
  }

  /**
   * 派发前门槛（§10.7）：业务在把浏览器任务交给插件前调用。
   * 依次校验能力状态（下线 / 停止派发 / 灰度名单）与插件版本：
   * - 已下线 / 已停止派发：一律拒绝；
   * - 灰度中：仅放行 grayOrgIds 名单内机构（未传 orgUserId＝不做灰度过滤）；
   * - 版本：上报了版本就按最低版本卡；未上报时只在强制升级时间到点后拒绝（保留兼容窗口）。
   * 校验通过返回生效口径，业务侧可据此记录/展示；不通过抛带可读文案的业务异常。
   */
  async assertDispatchable(
    key: string,
    opts: { pluginVersion?: string; orgUserId?: string } = {},
  ): Promise<ExtensionCapabilityEffective> {
    const eff = await this.effective(key);
    if (!eff)
      throw new BusinessException(ErrorCode.NOT_FOUND, '插件能力不存在');
    if (eff.status === 'RETIRED')
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该插件能力已下线，暂不可用',
      );
    if (eff.status === 'DEPRECATED')
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该插件能力已停止派发，暂不可用',
      );
    if (
      eff.status === 'GRAY' &&
      opts.orgUserId &&
      !eff.grayOrgIds.includes(opts.orgUserId)
    ) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该插件能力正在灰度中，暂未对本组织开放',
      );
    }
    const reported = (opts.pluginVersion || '').trim();
    if (eff.minVersion) {
      if (reported) {
        if (compareVersions(reported, eff.minVersion) < 0) {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            `浏览器插件版本过低（当前 v${reported}，需 v${eff.minVersion} 及以上），请升级后重试`,
          );
        }
      } else if (
        eff.forceUpgradeAt &&
        Date.now() >= eff.forceUpgradeAt.getTime()
      ) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `请升级浏览器插件到 v${eff.minVersion} 及以上后再使用（强制升级已生效）`,
        );
      }
    }
    return eff;
  }

  /** 平台维护单个能力的启用 / 灰度 / 强制升级（平台管理员）。 */
  async save(
    key: string,
    body: ExtensionCapabilitySaveBody,
    actorUserId: string,
  ) {
    const def = extensionCapabilityDefOf(key);
    if (!def)
      throw new BusinessException(ErrorCode.NOT_FOUND, '插件能力不存在');
    const existing = await this.prisma.extensionCapability.findUnique({
      where: { key },
    });
    let forceUpgradeAt = existing?.forceUpgradeAt ?? null;
    if (body.forceUpgradeAt !== undefined) {
      if (body.forceUpgradeAt === null) {
        forceUpgradeAt = null;
      } else {
        const parsed = new Date(body.forceUpgradeAt);
        if (Number.isNaN(parsed.getTime()))
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            '强制升级时间格式不正确',
          );
        forceUpgradeAt = parsed;
      }
    }
    const data = {
      status: body.status ?? existing?.status ?? '',
      minVersion:
        body.minVersion !== undefined
          ? body.minVersion.trim()
          : (existing?.minVersion ?? ''),
      grayOrgIds:
        body.grayOrgIds !== undefined
          ? body.grayOrgIds
          : this.normalizeIds(existing?.grayOrgIds),
      forceUpgradeAt,
      note: body.note ?? existing?.note ?? '',
      updatedBy: actorUserId,
    };
    const row = await this.prisma.extensionCapability.upsert({
      where: { key },
      create: { key, ...data },
      update: data,
    });
    return this.viewOf(def, row);
  }
}
