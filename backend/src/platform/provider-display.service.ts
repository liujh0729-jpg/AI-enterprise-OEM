import { PrismaService } from '../prisma/prisma.service';
import { AiworkinClient } from '../aiworkin/aiworkin.client';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

export type ProviderSyncMode = 'MANUAL' | 'SCHEDULED';

export interface ProviderSyncStatus {
  mode: ProviderSyncMode;
  lastSyncAt: string;
  lastResult: 'SUCCESS' | 'FAILED' | 'SKIPPED' | '';
  lastError: string;
  lastCount: number;
}

interface SyncSnapshot {
  id?: string;
  aiworkinProviderId?: string;
  name?: string;
  categoryKeys?: string[];
  region?: string;
  intro?: string;
}

/**
 * 服务商展示与同步（设计 §6）：数据源在 AIworkin，展示权在本系统。
 * - provider_display 表存上游快照 + 本地 visible / sort_weight / admin_note；
 * - 同步策略 MANUAL | SCHEDULED 存 system_settings，由后台切换；
 * - 「立即同步」走上游取服务商列表，失败只记录不抛出（保证离线可跑通后台）。
 */
export class ProviderDisplayService {
  static readonly SYNC_MODE_KEY = 'provider_sync_mode';
  static readonly SYNC_STATUS_KEY = 'provider_sync_status';

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: AiworkinClient,
  ) {}

  private async read(key: string): Promise<string> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    return row?.value || '';
  }
  private async write(key: string, value: string) {
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  async getSyncMode(): Promise<ProviderSyncMode> {
    const raw = (await this.read(ProviderDisplayService.SYNC_MODE_KEY)).trim();
    return raw === 'SCHEDULED' ? 'SCHEDULED' : 'MANUAL';
  }
  async setSyncMode(mode: ProviderSyncMode) {
    if (mode !== 'MANUAL' && mode !== 'SCHEDULED') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '同步策略仅支持 MANUAL / SCHEDULED');
    }
    await this.write(ProviderDisplayService.SYNC_MODE_KEY, mode);
    return this.status();
  }
  async status(): Promise<ProviderSyncStatus> {
    const mode = await this.getSyncMode();
    let stored: Partial<ProviderSyncStatus> = {};
    try {
      stored = JSON.parse(await this.read(ProviderDisplayService.SYNC_STATUS_KEY)) || {};
    } catch {
      stored = {};
    }
    return {
      mode,
      lastSyncAt: String(stored.lastSyncAt || ''),
      lastResult: (stored.lastResult as ProviderSyncStatus['lastResult']) || '',
      lastError: String(stored.lastError || ''),
      lastCount: Number(stored.lastCount) || 0,
    };
  }

  /** 后台列表：全部快照，按展示开关 + 权重排序。 */
  async listAdmin() {
    const rows = await this.prisma.providerDisplay.findMany({
      orderBy: [{ visible: 'desc' }, { sortWeight: 'desc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.shape(row));
  }
  /** 前台列表：仅 visible 的快照。 */
  async listPublic() {
    const rows = await this.prisma.providerDisplay.findMany({
      where: { visible: true },
      orderBy: [{ sortWeight: 'desc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.shape(row));
  }

  private shape(row: {
    id: number;
    aiworkinProviderId: string;
    snapshot: unknown;
    visible: boolean;
    sortWeight: number;
    adminNote: string;
    syncedAt: Date;
  }) {
    const snap = (row.snapshot || {}) as SyncSnapshot;
    return {
      id: row.id,
      aiworkinProviderId: row.aiworkinProviderId,
      name: snap.name || row.aiworkinProviderId,
      categoryKeys: Array.isArray(snap.categoryKeys) ? snap.categoryKeys : [],
      region: snap.region || '',
      intro: snap.intro || '',
      visible: row.visible,
      sortWeight: row.sortWeight,
      adminNote: row.adminNote,
      syncedAt: row.syncedAt.toISOString(),
    };
  }

  async updateDisplay(
    id: number,
    patch: { visible?: boolean; sortWeight?: number; adminNote?: string },
  ) {
    const data: Record<string, unknown> = {};
    if (patch.visible !== undefined) data.visible = Boolean(patch.visible);
    if (patch.sortWeight !== undefined) data.sortWeight = Math.trunc(Number(patch.sortWeight)) || 0;
    if (patch.adminNote !== undefined) data.adminNote = String(patch.adminNote).slice(0, 500);
    if (!Object.keys(data).length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有需要更新的字段');
    }
    const updated = await this.prisma.providerDisplay
      .update({ where: { id }, data })
      .catch(() => null);
    if (!updated) throw new BusinessException(ErrorCode.NOT_FOUND, '服务商展示记录不存在');
    return this.shape(updated);
  }

  /**
   * 立即同步：走上游取服务商列表并落快照。上游不可达 / 未启用 / 未绑定 Key 时
   * 不抛异常，只把失败写进同步状态（后台可见、可重试），保证本地后台始终可用。
   */
  async syncNow(token: string) {
    const at = new Date().toISOString();
    if (!this.client.isEnabled() || !token) {
      const result: ProviderSyncStatus = {
        mode: await this.getSyncMode(),
        lastSyncAt: at,
        lastResult: 'SKIPPED',
        lastError: token ? 'AIworkin 通道已关闭' : '当前管理员未绑定 AIPDD Key，无法拉取上游',
        lastCount: 0,
      };
      await this.write(ProviderDisplayService.SYNC_STATUS_KEY, JSON.stringify(result));
      return result;
    }
    try {
      const page = await this.client.request<{ list?: SyncSnapshot[] }>(
        '/providers/marketplace',
        { token, retry: 0 },
      );
      const items = Array.isArray(page?.list) ? page.list : [];
      let count = 0;
      for (const item of items) {
        const providerId = String(item.aiworkinProviderId || item.id || '').trim();
        if (!providerId) continue;
        const snapshot = {
          name: item.name || providerId,
          categoryKeys: Array.isArray(item.categoryKeys) ? item.categoryKeys : [],
          region: item.region || '',
          intro: item.intro || '',
        };
        await this.prisma.providerDisplay.upsert({
          where: { aiworkinProviderId: providerId },
          create: {
            aiworkinProviderId: providerId,
            snapshot: snapshot as object,
            syncedAt: new Date(),
          },
          update: { snapshot: snapshot as object, syncedAt: new Date() },
        });
        count += 1;
      }
      const result: ProviderSyncStatus = {
        mode: await this.getSyncMode(),
        lastSyncAt: at,
        lastResult: 'SUCCESS',
        lastError: '',
        lastCount: count,
      };
      await this.write(ProviderDisplayService.SYNC_STATUS_KEY, JSON.stringify(result));
      return result;
    } catch (error) {
      const message =
        error instanceof BusinessException ? error.message : '上游同步失败';
      const result: ProviderSyncStatus = {
        mode: await this.getSyncMode(),
        lastSyncAt: at,
        lastResult: 'FAILED',
        lastError: message.slice(0, 300),
        lastCount: 0,
      };
      await this.write(ProviderDisplayService.SYNC_STATUS_KEY, JSON.stringify(result));
      return result;
    }
  }
}
