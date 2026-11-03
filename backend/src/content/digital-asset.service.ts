import type { ContentDigitalAsset } from '@enterprise/contracts';
import { randomBytes } from 'node:crypto';
import { text as readText } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { OssService } from '../oss/oss.service';
import { AipddAssetClient, AIPDD_MEDIA_MAX_BYTES } from './aipdd-asset.client';
import { aipddBaseUrl } from './content-shared';
import { ContentModelSettingService } from './model-setting.service';

/** 平台类型口径：列表筛选与手动上传都落这四类；其它类型只在「全部」里显示。 */
const ASSET_TYPES = ['image', 'video', 'audio', 'file'] as const;

const EXT_TYPE: Record<string, (typeof ASSET_TYPES)[number]> = {
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  gif: 'image',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  pdf: 'file',
  zip: 'file',
  doc: 'file',
  docx: 'file',
  xls: 'file',
  xlsx: 'file',
  ppt: 'file',
  pptx: 'file',
  txt: 'file',
  md: 'file',
  json: 'file',
  csv: 'file',
};

const LABELS_MAX = 20;
const LABEL_LEN_MAX = 30;
/** 单账号最多扫描这么多条台账；更早的资产不参与筛选（避免一次拉爆平台详情接口）。 */
const SCAN_LIMIT = 500;
const DETAIL_CONCURRENCY = 8;

function labelsOf(raw: unknown) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const item of list) {
    const label = readText(item).trim().slice(0, LABEL_LEN_MAX);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
    if (labels.length >= LABELS_MAX) break;
  }
  return labels;
}

function assetType(kind: string) {
  return (ASSET_TYPES as readonly string[]).includes(kind) ? kind : 'file';
}

/** 平台资产 → 接口形状（只挑界面要用的字段）。 */
function shape(item: Record<string, unknown>): ContentDigitalAsset {
  const url = readText(item.url).trim();
  const labels = Array.isArray(item.labels) ? labelsOf(item.labels) : [];
  const size = Number(item.fileSize);
  return {
    id: Number(item.id) || 0,
    type: readText(item.type).trim() || 'file',
    name: readText(item.name).trim(),
    url,
    previewUrl: readText(item.previewUrl).trim() || url,
    fileSize: Number.isFinite(size) ? size : 0,
    labels,
    isOpen: item.isOpen === true,
    createdAt: readText(item.createdAt),
    updatedAt: readText(item.updatedAt),
  };
}

type EntryRow = {
  aipddAssetId: number;
  type: string;
  name: string;
  url: string;
  previewUrl: string;
  fileSize: number;
  labels: unknown;
  ossKey: string;
  createdAt: Date;
  updatedAt: Date;
};

/** 台账快照 → 接口形状（平台详情读不到时的兜底）。 */
function fromEntry(row: EntryRow): ContentDigitalAsset {
  return {
    id: row.aipddAssetId,
    type: row.type || 'file',
    name: row.name || '',
    url: row.url || '',
    previewUrl: row.previewUrl || row.url || '',
    fileSize: row.fileSize || 0,
    labels: labelsOf(row.labels),
    isOpen: false,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += limit) {
    const chunk = items.slice(index, index + limit);
    results.push(...(await Promise.all(chunk.map((item) => run(item)))));
  }
  return results;
}

/**
 * 数字资产管理：数据仍只存 AIPDD 平台，但**列表范围按本系统账号圈定**——
 * `digital_asset_entries` 只记「这个账号上传/生成过哪条平台资产」的归属台账，
 * 页面只列自己的资产，别人的与平台自带的共享素材都不出现；上传一律 `isOpen:false`。
 */
export class DigitalAssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ContentModelSettingService,
    private readonly client: AipddAssetClient,
    private readonly identity: IdentityService,
    private readonly oss: OssService,
  ) {}

  private async target(user: CurrentUser, token?: string) {
    const apiKey = await this.settings.aipddKey(user, token);
    const baseUrl = aipddBaseUrl();
    return { baseUrl, apiKey };
  }

  private async ownedEntries(user: CurrentUser) {
    return this.prisma.digitalAssetEntry.findMany({
      where: { userId: user.userId },
      orderBy: { updatedAt: 'desc' },
      take: SCAN_LIMIT,
    });
  }

  private async hydrate(
    rows: EntryRow[],
    baseUrl: string,
    apiKey: string,
    user: CurrentUser,
  ) {
    const assets = await mapLimit(rows, DETAIL_CONCURRENCY, async (row) => {
      // ossKey 非空＝字节存自有 OSS 桶（新底座/营销产物）：直接读台账，不经 AIPDD 平台详情。
      if (row.ossKey) return fromEntry(row);
      try {
        const detail = await this.client.detail({
          baseUrl,
          apiKey,
          id: row.aipddAssetId,
        });
        return shape(detail);
      } catch (error) {
        // 平台侧已删除：从台账里清掉，不挡住其它资产
        if (
          error instanceof BusinessException &&
          error.message.includes('HTTP 404')
        ) {
          await this.prisma.digitalAssetEntry
            .deleteMany({
              where: { userId: user.userId, aipddAssetId: row.aipddAssetId },
            })
            .catch(() => undefined);
          return null;
        }
        return fromEntry(row);
      }
    });
    return assets.filter((item): item is ContentDigitalAsset => Boolean(item));
  }

  async list(
    user: CurrentUser,
    token: string | undefined,
    query: Record<string, unknown>,
    keyUser?: CurrentUser,
  ) {
    const type = readText(query.type).trim();
    if (type && !(ASSET_TYPES as readonly string[]).includes(type)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '资产类型不被支持');
    }
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 24)));
    const keyword = readText(query.keyword).trim().toLowerCase();
    const label = readText(query.label).trim();

    const rows = (await this.ownedEntries(user)) as EntryRow[];
    // 台账按 `user` 圈定；平台 Key 跟着 token 的真实持有者走（见 keyUser 注释）。
    // 只有存在「非本地(无 ossKey)」的旧资产时才需要平台凭证，纯本地资产不触上游。
    const hasPlatformRows = rows.some((row) => !row.ossKey);
    let baseUrl = '';
    let apiKey = '';
    if (hasPlatformRows) {
      ({ baseUrl, apiKey } = await this.target(keyUser ?? user, token));
    }
    const assets = await this.hydrate(rows, baseUrl, apiKey, user);
    const filtered = assets.filter((asset) => {
      if (type && assetType(asset.type) !== type) return false;
      if (keyword && !asset.name.toLowerCase().includes(keyword)) return false;
      if (label && !asset.labels.includes(label)) return false;
      return true;
    });
    const start = (page - 1) * pageSize;
    return {
      list: filtered.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize,
    };
  }

  async labels(user: CurrentUser, token?: string) {
    const { baseUrl, apiKey } = await this.target(user, token);
    const [platform, rows] = await Promise.all([
      this.client.labelOptions({ baseUrl, apiKey }).catch(() => []),
      this.ownedEntries(user),
    ]);
    const seen = new Set(platform);
    for (const row of rows) {
      for (const label of labelsOf(row.labels)) seen.add(label);
    }
    return Array.from(seen);
  }

  private async ownedAsset(user: CurrentUser, id: number) {
    const entry = await this.prisma.digitalAssetEntry.findUnique({
      where: {
        userId_aipddAssetId: { userId: user.userId, aipddAssetId: id },
      },
    });
    if (!entry) {
      // 只允许操作自己上传/生成的资产，猜别人的 id 也不行
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '资产不存在或不属于当前账号',
      );
    }
    return entry;
  }

  async tag(
    user: CurrentUser,
    token: string | undefined,
    id: string,
    body: Record<string, unknown>,
  ) {
    const assetId = Number(id);
    if (!Number.isInteger(assetId) || assetId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '资产编号无效');
    }
    const entry = await this.ownedAsset(user, assetId);
    const labels = labelsOf(body.labels);
    // 本地资产（字节在自有 OSS）：只改台账标签，不回写 AIPDD 平台。
    if (entry.ossKey) {
      await this.prisma.digitalAssetEntry.update({
        where: {
          userId_aipddAssetId: { userId: user.userId, aipddAssetId: assetId },
        },
        data: { labels: labels as never },
      });
      await this.identity.audit(user.userId, '数字资产打标', `#${assetId} ${labels.join(',')}`);
      return fromEntry({ ...entry, labels } as unknown as EntryRow);
    }
    const { baseUrl, apiKey } = await this.target(user, token);
    const updated = await this.client.update({
      baseUrl,
      apiKey,
      id: assetId,
      patch: { labels },
    });
    await this.prisma.digitalAssetEntry.update({
      where: {
        userId_aipddAssetId: { userId: user.userId, aipddAssetId: assetId },
      },
      data: { labels: labels as never },
    });
    await this.identity.audit(
      user.userId,
      '数字资产打标',
      `#${assetId} ${labels.join(',')}`,
    );
    return shape(updated);
  }

  /** 上传后的公共尾巴：登记到平台 → 读回详情 → 写归属台账。 */
  private async registerAndRecord(
    user: CurrentUser,
    baseUrl: string,
    apiKey: string,
    input: {
      url: string;
      name: string;
      type: (typeof ASSET_TYPES)[number];
      labels: string[];
    },
  ) {
    const id = await this.client.register({
      baseUrl,
      apiKey,
      url: input.url,
      name: input.name,
      kind: input.type,
      labels: input.labels,
    });
    const numericId = Number(id);
    const asset =
      Number.isInteger(numericId) && numericId > 0
        ? shape(await this.client.detail({ baseUrl, apiKey, id: numericId }))
        : shape({
            id: 0,
            type: input.type,
            name: input.name,
            url: input.url,
            labels: input.labels,
            isOpen: false,
          });
    if (asset.id > 0) {
      await this.prisma.digitalAssetEntry.upsert({
        where: {
          userId_aipddAssetId: { userId: user.userId, aipddAssetId: asset.id },
        },
        create: {
          userId: user.userId,
          aipddAssetId: asset.id,
          type: assetType(asset.type),
          name: asset.name,
          url: asset.url,
          previewUrl: asset.previewUrl,
          fileSize: asset.fileSize,
          labels: asset.labels as never,
        },
        update: {
          type: assetType(asset.type),
          name: asset.name,
          url: asset.url,
          previewUrl: asset.previewUrl,
          fileSize: asset.fileSize,
          labels: asset.labels as never,
        },
      });
    }
    return asset;
  }

  /** 把一段文本（多为 Agent 产出的报告）存成数字资产：上传 → 登记 → 台账。失败抛错，由调用方决定是否降级。 */
  async uploadText(
    user: CurrentUser,
    token: string | undefined,
    input: { name: string; content: string; labels?: string[] },
  ) {
    const content = readText(input.content);
    if (!content.trim()) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '内容为空，无法存成数字资产',
      );
    }
    const rawName = readText(input.name).trim().slice(0, 190);
    const filename = `${rawName || 'agent-report'}.md`;
    const labels = labelsOf(input.labels ?? ['agent-report']);
    const { baseUrl, apiKey } = await this.target(user, token);
    const uploaded = await this.client.upload({
      baseUrl,
      apiKey,
      bytes: new TextEncoder().encode(content),
      filename,
      prefix: `assets/enterprise/${user.userId}/agent`,
    });
    const asset = await this.registerAndRecord(user, baseUrl, apiKey, {
      url: uploaded.url,
      name: filename,
      type: 'file',
      labels,
    });
    await this.identity.audit(
      user.userId,
      '数字资产上传',
      `${filename}（file）`,
    );
    return asset;
  }

  async upload(
    user: CurrentUser,
    token: string | undefined,
    file: File,
    fields: Record<string, unknown>,
    keyUser?: CurrentUser,
  ) {
    const name = readText(file.name) || 'upload.bin';
    const ext = name.toLowerCase().split('.').pop() || '';
    const extType = EXT_TYPE[ext];
    if (!extType) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '仅支持图片（jpg/png/webp/gif）、视频（mp4/mov/webm）、音频（mp3/wav/m4a）与常见文档（pdf/zip/office/txt/md/json/csv）',
      );
    }
    if (!file.size) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '文件内容为空');
    }
    if (file.size > AIPDD_MEDIA_MAX_BYTES) {
      throw new BusinessException(ErrorCode.PAYLOAD_TOO_LARGE);
    }
    const requested = readText(fields.type).trim();
    const type =
      requested && (ASSET_TYPES as readonly string[]).includes(requested)
        ? (requested as (typeof ASSET_TYPES)[number])
        : extType;
    // 允许把任意文件标成「文件」，但不能把视频说成图片、把音频说成视频
    if (type !== extType && type !== 'file') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `这个文件是「${extType}」，不能按「${type}」上传`,
      );
    }
    const displayName = readText(fields.name).trim().slice(0, 200) || name;
    const labels = labelsOf(fields.labels);
    const { baseUrl, apiKey } = await this.target(keyUser ?? user, token);
    const uploaded = await this.client.upload({
      baseUrl,
      apiKey,
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: name,
      prefix: `assets/enterprise/${user.userId}/library`,
    });
    const asset = await this.registerAndRecord(user, baseUrl, apiKey, {
      url: uploaded.url,
      name: displayName,
      type,
      labels,
    });
    await this.identity.audit(
      user.userId,
      '数字资产上传',
      `${displayName}（${type}）`,
    );
    return asset;
  }

  /**
   * 自有 OSS 直传：把一段字节存进本站桶并登记进数字资产台账（新底座路径）。
   * 本地行以 `ossKey` 非空判别、`aipddAssetId` 落 `-行id`（负数永不与平台正数 id 撞唯一键）。
   * 供营销工具产物（CSV/报告/导入结果）归档与后续存量迁移复用；不依赖用户绑定 AIPDD Key。
   */
  async putLocal(
    userId: string,
    input: {
      bytes: Buffer;
      filename: string;
      labels?: string[];
      dir?: string;
      source?: string;
    },
  ): Promise<ContentDigitalAsset> {
    const name = (readText(input.filename).trim() || 'deliverable').slice(0, 180);
    const ext = name.toLowerCase().split('.').pop() || '';
    const type = EXT_TYPE[ext] || 'file';
    const dir = (input.dir || 'deliverables').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'deliverables';
    const safeName = name.replace(/[^\w.\-]/g, '_');
    const objectPath = `enterprise/${userId}/${dir}/${Date.now()}-${randomBytes(4).toString('hex')}-${safeName}`;
    const uploaded = await this.oss.upload(objectPath, input.bytes);
    const labels = labelsOf(input.labels ?? [input.source || 'deliverable']);
    const row = await this.prisma.$transaction(async (tx) => {
      // 事务内先给一个随机负占位（只为通过唯一键插入），随即改写成稳定的 `-行id`。
      const created = await tx.digitalAssetEntry.create({
        data: {
          userId,
          aipddAssetId: -(1 + Math.floor(Math.random() * 2_000_000_000)),
          type,
          name,
          url: uploaded.url,
          previewUrl: uploaded.url,
          fileSize: uploaded.size / 1024 / 1024, // 平台口径 MB
          ossKey: uploaded.key,
          migratedFrom: 'local',
          labels: labels as never,
        },
      });
      return tx.digitalAssetEntry.update({
        where: { id: created.id },
        data: { aipddAssetId: -created.id },
      });
    });
    return fromEntry(row as unknown as EntryRow);
  }

  /** 营销工具产物登记入口（后台任务无请求上下文，按 userId 直落）：尽力而为，
   * 失败只记日志不抛出，绝不阻断营销任务主流程。由 bigdata/lead 等工具在任务成功尾部调用。
   */
  async registerDeliverable(
    userId: string,
    input: {
      bytes: Buffer;
      filename: string;
      labels?: string[];
      dir?: string;
      source?: string;
    },
  ) {
    try {
      const asset = await this.putLocal(userId, input);
      await this.identity.audit(
        userId,
        '营销产物入资产',
        `${input.filename}（${input.source || 'deliverable'}）`,
      );
      return asset;
    } catch (error) {
      // 产物归档失败不影响任务本身；OSS 未配置等场景静默降级。
      console.warn(
        JSON.stringify({
          event: 'deliverable_register_failed',
          userId,
          filename: input.filename,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      return null;
    }
  }
}