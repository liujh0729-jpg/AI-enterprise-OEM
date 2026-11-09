import type { ContentDigitalAsset } from '@enterprise/contracts';
import { randomBytes } from 'node:crypto';
import { text as readText } from '../common/api';
import { toJsonInput } from '../common/json-input';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  PublishReviewService,
  type MediaVerdict,
} from '../moderation/publish-review.service';
import { AipddAssetClient, AIPDD_MEDIA_MAX_BYTES } from './aipdd-asset.client';
import { extractLibraryText, libraryTypeOf } from './library-extract';
import { aipddBaseUrl } from './content-shared';
import { cosine } from '../ai/retrieval-kernel';
import { ContentModelSettingService } from './model-setting.service';
import { AssetVisionService } from './vision.service';

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

/** 合并两组标签：保留原有在前，去重、限长限数（AI 候选并入人工标签时用）。 */
function mergeLabels(base: string[], extra: string[]) {
  return labelsOf([...base, ...extra]);
}

function assetType(kind: string) {
  return (ASSET_TYPES as readonly string[]).includes(kind) ? kind : 'file';
}

/** 送入向量模型的正文口径：命中的理解摘要/正文优先，其次文件名与人工标签。 */
function assetBody(row: {
  name: string;
  caption?: string | null;
  text?: string | null;
  labels: unknown;
}) {
  return (
    [row.caption, row.text, row.name, labelsOf(row.labels).join(' ')]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, 4000) || row.name
  );
}

/** 读取台账里存的向量（JSON 列）；格式不符返回 null。 */
function vectorOf(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const vector = raw.map((value) => Number(value));
  return vector.every((value) => Number.isFinite(value)) ? vector : null;
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
    caption: readText(item.caption).trim(),
    moderation: readText(item.moderation).trim(),
    moderationNote: readText(item.moderationNote).trim(),
    createdAt: readText(item.createdAt),
    updatedAt: readText(item.updatedAt),
  };
}

type EntryRow = {
  id: number;
  userId: string;
  aipddAssetId: number;
  type: string;
  name: string;
  url: string;
  previewUrl: string;
  fileSize: number;
  labels: unknown;
  ossKey: string;
  caption: string | null;
  text: string | null;
  embedding: unknown;
  embedModel: string;
  moderation: string;
  moderationNote: string;
  moderationTaskId: string;
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
    caption: row.caption || '',
    moderation: row.moderation || '',
    moderationNote: row.moderationNote || '',
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
 * 数字资产管理：字节统一存本站 OSS（新底座），台账只记归属与元数据。
 * 历史 AIPDD 托管资产（`ossKey` 为空）仍可读、可打标，并可由后台迁移任务转存本站；
 * 列表只列当前账号上传/生成过的资产，别人的与平台自带素材都不出现。
 */
export class DigitalAssetService {
  private readonly visions: AssetVisionService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ContentModelSettingService,
    private readonly client: AipddAssetClient,
    private readonly identity: IdentityService,
    private readonly storage: StorageService,
    private readonly moderation: PublishReviewService,
  ) {
    this.visions = new AssetVisionService(prisma);
  }

  private target(user: CurrentUser, token?: string) {
    const apiKey = this.settings.aipddKey(user, token);
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
      ({ baseUrl, apiKey } = this.target(keyUser ?? user, token));
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
    const { baseUrl, apiKey } = this.target(user, token);
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

  /** 路径参数 → 资产编号：非法直接拒绝，避免把 NaN 传进唯一键查询。 */
  private assetIdOf(id: string) {
    const assetId = Number(id);
    if (!Number.isInteger(assetId) || assetId === 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '资产编号无效');
    }
    return assetId;
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
        data: { labels: toJsonInput(labels) },
      });
      await this.identity.audit(
        user.userId,
        '数字资产打标',
        `#${assetId} ${labels.join(',')}`,
      );
      return fromEntry({ ...entry, labels });
    }
    const { baseUrl, apiKey } = this.target(user, token);
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
      data: { labels: toJsonInput(labels) },
    });
    await this.identity.audit(
      user.userId,
      '数字资产打标',
      `#${assetId} ${labels.join(',')}`,
    );
    return shape(updated);
  }

  /**
   * 资产 AI 理解（P1-C）：图片走视觉模型、可读文档走正文模型，缺 Key 落规则兜底。
   * persist=true（默认）时把摘要、合并标签与语义向量写回台账，供检索 / 找相似复用。
   */
  async extract(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
    token?: string,
  ) {
    const entry = await this.ownedAsset(user, this.assetIdOf(id));
    const persist = body.persist !== false;
    // 直传登记/历史资产可能没有正文：按对象键回读，确保文档理解不是空转。
    const entryText = entry.text || (await this.readEntryText(entry));
    const outcome = await this.visions.understand(
      user.userId,
      {
        name: entry.name,
        type: entry.type,
        url: entry.previewUrl || entry.url,
        text: entryText,
      },
      token,
    );
    const labels = mergeLabels(labelsOf(entry.labels), outcome.labels);
    if (persist) {
      const vector = await this.visions.embed(
        user.userId,
        assetBody({ ...entry, labels, text: entryText }),
        token,
      );
      await this.prisma.digitalAssetEntry.update({
        where: { id: entry.id },
        data: {
          caption: outcome.caption || null,
          labels: toJsonInput(labels),
          text: entryText ? entryText.slice(0, 400_000) : entry.text,
          embedding: vector.vector,
          embedModel: vector.model,
        },
      });
      await this.identity.audit(
        user.userId,
        '数字资产 AI 理解',
        `#${entry.aipddAssetId} ${outcome.mode === 'llm' ? outcome.model : '规则兜底'} ${labels.join(',')}`,
      );
    }
    return {
      assetId: entry.aipddAssetId,
      kind: outcome.kind,
      text: outcome.text,
      labels,
      caption: outcome.caption,
      model: outcome.model,
      mode: outcome.mode,
    };
  }

  /** 自动打标候选：默认只返回建议；persist=true 时把标签、摘要与向量写回台账。 */
  async autoTag(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
    token?: string,
  ) {
    const entry = await this.ownedAsset(user, this.assetIdOf(id));
    const entryText = entry.text || (await this.readEntryText(entry));
    const outcome = await this.visions.understand(
      user.userId,
      {
        name: entry.name,
        type: entry.type,
        url: entry.previewUrl || entry.url,
        text: entryText,
      },
      token,
    );
    const labels = mergeLabels(labelsOf(entry.labels), outcome.labels);
    if (body.persist === true) {
      const vector = await this.visions.embed(
        user.userId,
        assetBody({ ...entry, labels, text: entryText }),
        token,
      );
      await this.prisma.digitalAssetEntry.update({
        where: { id: entry.id },
        data: {
          caption: outcome.caption || null,
          labels: toJsonInput(labels),
          text: entryText ? entryText.slice(0, 400_000) : entry.text,
          embedding: vector.vector,
          embedModel: vector.model,
        },
      });
      await this.identity.audit(
        user.userId,
        '数字资产自动打标',
        `#${entry.aipddAssetId} ${labels.join(',')}`,
      );
    }
    return {
      assetId: entry.aipddAssetId,
      labels,
      caption: outcome.caption,
      model: outcome.model,
      mode: outcome.mode,
    };
  }

  /**
   * 找相似：整批资产用同一模型空间算向量（远端优先，失败整批回落本地袋装），
   * 按余弦从高到低返回当前账号内最相近的若干条（不含自身）。
   * 台账里已存向量（AI 理解写入）且模型一致时直接复用，缺的按批补齐（限 120 条）。
   */
  async similar(
    user: CurrentUser,
    id: string,
    token: string | undefined,
    query: Record<string, unknown>,
  ) {
    const target = await this.ownedAsset(user, this.assetIdOf(id));
    const limit = Math.min(
      50,
      Math.max(1, Math.floor(Number(query.limit) || 12)),
    );
    const rows = (await this.ownedEntries(user)) as EntryRow[];
    if (rows.length <= 1) return { list: [], scores: [] };
    const targetIndex = rows.findIndex((row) => row.id === target.id);
    let model = target.embedModel || '';
    let targetVector = vectorOf(target.embedding);
    if (!targetVector) {
      const computed = await this.visions.embed(
        user.userId,
        assetBody(target),
        token,
      );
      model = computed.model;
      targetVector = computed.vector;
    }
    if (!targetVector.length) return { list: [], scores: [] };

    const candidates = rows.filter((_, index) => index !== targetIndex);
    const vectors = new Map<number, number[]>();
    const missing: EntryRow[] = [];
    for (const row of candidates) {
      const stored = vectorOf(row.embedding);
      if (stored && row.embedModel && row.embedModel === model) {
        vectors.set(row.id, stored);
      } else {
        missing.push(row);
      }
    }
    const fill = missing.slice(0, 120);
    if (fill.length) {
      const embedded = await this.visions.embedMany(
        user.userId,
        fill.map((row) => assetBody(row)),
        token,
      );
      fill.forEach((row, index) => {
        const vector = embedded.vectors[index];
        if (vector?.length) vectors.set(row.id, vector);
      });
    }
    const ranked = candidates
      .filter((row) => vectors.has(row.id))
      .map((row) => ({
        row,
        score: cosine(targetVector, vectors.get(row.id)!),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    if (!ranked.length) return { list: [], scores: [] };

    const selected = ranked.map((item) => item.row);
    const scoreById = new Map(
      ranked.map((item) => [item.row.aipddAssetId, item.score]),
    );
    const hasPlatformRows = selected.some((row) => !row.ossKey);
    const { baseUrl, apiKey } = hasPlatformRows
      ? this.target(user, token)
      : { baseUrl: '', apiKey: '' };
    const assets = await this.hydrate(selected, baseUrl, apiKey, user);
    return {
      list: assets,
      scores: assets.map((asset) =>
        Number((scoreById.get(asset.id) ?? 0).toFixed(4)),
      ),
    };
  }

  /** 按对象键回读可读文档正文：直传登记的资产没有上传时的正文，理解与知识库投料都靠它。 */
  private async readEntryText(entry: EntryRow): Promise<string | null> {
    if (!entry.ossKey) return null;
    const libType = libraryTypeOf(entry.name);
    if (!libType) return null;
    try {
      const bytes = await this.storage.read(entry.ossKey);
      return (
        extractLibraryText(bytes, libType, { name: entry.name }).text || null
      );
    } catch {
      return null;
    }
  }

  /** 读台账行 → 自动理解/打标 + 图视频送审；异步兜底，失败只告警不阻断上传。 */
  private async enrichByAssetId(
    userId: string,
    aipddAssetId: number,
    token?: string,
  ) {
    const row = await this.prisma.digitalAssetEntry
      .findUnique({
        where: { userId_aipddAssetId: { userId, aipddAssetId } },
      })
      .catch(() => null);
    if (!row) return;
    void this.enrichEntry(row, token);
  }

  private async enrichEntry(entry: EntryRow, token?: string) {
    try {
      const entryText = entry.text || (await this.readEntryText(entry));
      if (entry.type === 'image' || (entryText && entryText.trim())) {
        const outcome = await this.visions.understand(
          entry.userId,
          {
            name: entry.name,
            type: entry.type,
            url: entry.previewUrl || entry.url,
            text: entryText,
          },
          token,
        );
        const labels = mergeLabels(labelsOf(entry.labels), outcome.labels);
        const vector = await this.visions.embed(
          entry.userId,
          assetBody({ ...entry, labels, text: entryText }),
          token,
        );
        await this.prisma.digitalAssetEntry.update({
          where: { id: entry.id },
          data: {
            caption: outcome.caption || null,
            labels: toJsonInput(labels),
            text: entryText ? entryText.slice(0, 400_000) : entry.text,
            embedding: vector.vector,
            embedModel: vector.model,
          },
        });
        await this.identity.audit(
          entry.userId,
          '数字资产自动理解',
          `#${entry.aipddAssetId} ${outcome.mode === 'llm' ? outcome.model : '规则兜底'} ${labels.join(',')}`,
        );
      }
      if (entry.type === 'image' || entry.type === 'video') {
        await this.moderateEntry(entry);
      }
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: 'asset_enrich_failed',
          assetId: entry.id,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  /** 内容安全送审并写回台账；未配置审核返回 off，不阻断主链路。 */
  private async moderateEntry(entry: EntryRow): Promise<MediaVerdict> {
    const url = entry.previewUrl || entry.url;
    let verdict: MediaVerdict;
    if (entry.type === 'image' && url) {
      verdict = await this.moderation.guardImage(url);
    } else if (entry.type === 'video' && url) {
      verdict = await this.moderation.submitVideo(url);
    } else {
      verdict = { status: 'off', labels: [], note: '', taskId: '' };
    }
    await this.prisma.digitalAssetEntry.update({
      where: { id: entry.id },
      data: {
        moderation: verdict.status,
        moderationNote: verdict.note.slice(0, 300),
        moderationTaskId: verdict.taskId.slice(0, 128),
      },
    });
    return verdict;
  }

  async moderate(user: CurrentUser, id: string) {
    const entry = await this.ownedAsset(user, this.assetIdOf(id));
    const verdict = await this.moderateEntry(entry);
    await this.identity.audit(
      user.userId,
      '数字资产内容安全',
      `#${entry.aipddAssetId} ${verdict.status} ${verdict.note}`.trim(),
    );
    return {
      assetId: entry.aipddAssetId,
      status: verdict.status,
      note: verdict.note,
      mode: verdict.status === 'off' ? ('off' as const) : ('green' as const),
    };
  }

  /** 视频审核轮询（后台调度）：只处理 pending 且有 taskId 的台账行。 */
  async pollPendingModeration(): Promise<number> {
    const rows = await this.prisma.digitalAssetEntry.findMany({
      where: { moderation: 'pending', moderationTaskId: { not: '' } },
      take: 50,
    });
    if (!rows.length) return 0;
    const verdicts = await this.moderation.pollVideos(
      rows.map((row) => row.moderationTaskId),
    );
    let updated = 0;
    for (const row of rows) {
      const verdict = verdicts[row.moderationTaskId];
      if (!verdict) continue;
      await this.prisma.digitalAssetEntry
        .update({
          where: { id: row.id },
          data: {
            moderation: verdict.status,
            moderationNote: verdict.note.slice(0, 300),
            moderationTaskId: '',
          },
        })
        .catch(() => undefined);
      updated += 1;
    }
    return updated;
  }

  /** 浏览器直传签名：只签名不落库；前端把字节直传桶后调 registerUploaded 登记台账。 */
  async presign(user: CurrentUser, body: Record<string, unknown>) {
    const filename = readText(body.filename).trim() || 'upload.bin';
    const ext = filename.toLowerCase().split('.').pop() || '';
    const extType = EXT_TYPE[ext];
    if (!extType) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '仅支持图片（jpg/png/webp/gif）、视频（mp4/mov/webm）、音频（mp3/wav/m4a）与常见文档（pdf/zip/office/txt/md/json/csv）',
      );
    }
    const size = Number(body.size) || 0;
    if (size <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '文件内容为空');
    }
    if (size > AIPDD_MEDIA_MAX_BYTES) {
      throw new BusinessException(ErrorCode.PAYLOAD_TOO_LARGE);
    }
    const requested = readText(body.type).trim();
    const type =
      requested && (ASSET_TYPES as readonly string[]).includes(requested)
        ? requested
        : extType;
    if (type !== extType && type !== 'file') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `这个文件是「${extType}」，不能按「${type}」上传`,
      );
    }
    const safeName = filename.replace(/[^\w.-]/g, '_');
    const objectPath = `enterprise/${user.userId}/library/${Date.now()}-${randomBytes(4).toString('hex')}-${safeName}`;
    return this.storage.signFormPost(objectPath, {
      maxBytes: AIPDD_MEDIA_MAX_BYTES,
    });
  }

  /**
   * 直传完成后登记台账：只允许登记 `enterprise/<自己 userId>/` 前缀下的对象，
   * 避免把别人的对象键写进自己的资产列表；对象不存在按失败处理。
   */
  async registerUploaded(
    user: CurrentUser,
    body: Record<string, unknown>,
    token?: string,
  ) {
    const key = readText(body.key).trim();
    const prefix = `enterprise/${user.userId}/`;
    if (!key || !key.startsWith(prefix)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '只能登记当前账号自己上传的文件',
      );
    }
    const stat = await this.storage.stat(key).catch(() => null);
    if (!stat?.exists) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '文件尚未上传成功，请重试',
      );
    }
    const filename =
      readText(body.filename).trim() || key.split('/').pop() || 'upload.bin';
    const ext = filename.toLowerCase().split('.').pop() || '';
    const extType = EXT_TYPE[ext] || 'file';
    const requested = readText(body.type).trim();
    const type =
      requested && (ASSET_TYPES as readonly string[]).includes(requested)
        ? requested
        : extType;
    if (type !== extType && type !== 'file') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `这个文件是「${extType}」，不能按「${type}」登记`,
      );
    }
    const displayName =
      readText(body.name).trim().slice(0, 200) || filename.slice(0, 200);
    const labels = labelsOf(body.labels);
    const publicUrl = this.storage.urlOf(key);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.digitalAssetEntry.create({
        data: {
          userId: user.userId,
          aipddAssetId: -(1 + Math.floor(Math.random() * 2_000_000_000)),
          type,
          name: displayName,
          url: publicUrl,
          previewUrl: publicUrl,
          fileSize: stat.size / 1024 / 1024,
          ossKey: key,
          migratedFrom: 'direct',
          labels: toJsonInput(labels),
        },
      });
      return tx.digitalAssetEntry.update({
        where: { id: created.id },
        data: { aipddAssetId: -created.id },
      });
    });
    await this.identity.audit(
      user.userId,
      '数字资产直传',
      `${displayName}（${row.type}）`,
    );
    // 登记后异步补理解/打标与图视频送审：失败只告警，不影响直传结果。
    void this.enrichByAssetId(user.userId, row.aipddAssetId, token);
    return fromEntry(row);
  }

  /**
   * 自有 OSS 直传 + 台账登记（新底座唯一入口）：
   * 本地行以 `ossKey` 非空判别、`aipddAssetId` 落 `-行id`（负数永不与平台正数 id 撞唯一键）。
   */
  private async storeOwned(
    userId: string,
    input: {
      bytes: Buffer;
      filename: string;
      displayName?: string;
      type?: string;
      labels: string[];
      dir: string;
      migratedFrom?: string;
      /** 抽取正文（可读文档）：供知识库按 assetId 直接投料编译（修 assetId 断链） */
      text?: string;
    },
  ): Promise<ContentDigitalAsset> {
    const storedName = (readText(input.filename).trim() || 'asset').slice(
      0,
      180,
    );
    const name = (
      readText(input.displayName ?? storedName).trim() || storedName
    ).slice(0, 200);
    const ext = storedName.toLowerCase().split('.').pop() || '';
    const type = input.type || EXT_TYPE[ext] || 'file';
    const dir =
      (input.dir || 'library').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) ||
      'library';
    const safeName = storedName.replace(/[^\w.-]/g, '_');
    const objectPath = `enterprise/${userId}/${dir}/${Date.now()}-${randomBytes(4).toString('hex')}-${safeName}`;
    const uploaded = await this.storage.put(objectPath, input.bytes);
    const labels = labelsOf(input.labels);
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
          fileSize: uploaded.size / 1024 / 1024, // 台账沿用平台口径 MB
          ossKey: uploaded.key,
          migratedFrom: input.migratedFrom || 'local',
          labels: toJsonInput(labels),
          text: input.text ? input.text.slice(0, 400_000) : null,
        },
      });
      return tx.digitalAssetEntry.update({
        where: { id: created.id },
        data: { aipddAssetId: -created.id },
      });
    });
    return fromEntry(row);
  }

  /** 把一段文本（多为 Agent 产出的报告）存成数字资产：直传本站 OSS + 台账。 */
  async uploadText(
    user: CurrentUser,
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
    const asset = await this.storeOwned(user.userId, {
      bytes: Buffer.from(content, 'utf8'),
      filename,
      type: 'file',
      labels,
      dir: 'agent',
      text: content,
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
    file: File,
    fields: Record<string, unknown>,
    token?: string,
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
    const bytes = Buffer.from(await file.arrayBuffer());
    // 可读文档顺手抽正文存台账：知识库按 assetId 投料即可直接编译（§5 P1-A 修断链）
    const libType = libraryTypeOf(name);
    let text: string | undefined;
    if (libType) {
      try {
        text = extractLibraryText(bytes, libType, { name }).text || undefined;
      } catch {
        text = undefined;
      }
    }
    const asset = await this.storeOwned(user.userId, {
      bytes,
      filename: name,
      displayName,
      type,
      labels,
      dir: 'library',
      text,
    });
    await this.identity.audit(
      user.userId,
      '数字资产上传',
      `${displayName}（${type}）`,
    );
    // 上传即打标：异步补摘要/标签/向量与图视频送审，失败只告警不阻断上传。
    void this.enrichByAssetId(user.userId, asset.id, token);
    return asset;
  }

  /**
   * 删除数字资产：先删台账（立即从列表/共享里消失），对象存储尽力删除。
   * 删除 OSS 失败只留孤儿对象，由巡检任务兜底，不影响用户完成删除。
   * 历史 AIPDD 托管资产只移除本地登记，上游副本保留（归属权在用户）。
   */
  async remove(user: CurrentUser, id: string) {
    const assetId = Number(id);
    if (!Number.isInteger(assetId) || assetId === 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '资产编号无效');
    }
    const entry = await this.ownedAsset(user, assetId);
    let objectRemoved = false;
    if (entry.ossKey) {
      try {
        await this.storage.remove(entry.ossKey);
        objectRemoved = true;
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: 'asset_object_delete_failed',
            userId: user.userId,
            assetId,
            ossKey: entry.ossKey,
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
    await this.prisma.$transaction([
      this.prisma.digitalAssetEntry.delete({ where: { id: entry.id } }),
      this.prisma.contentSharedAsset.deleteMany({
        where: { ownerUserId: user.userId, assetId: String(assetId) },
      }),
    ]);
    await this.identity.audit(
      user.userId,
      '数字资产删除',
      `#${assetId} ${entry.name}`,
    );
    return {
      id: assetId,
      deleted: true,
      objectRemoved,
      upstreamRetained: !entry.ossKey,
    };
  }

  /**
   * 自有 OSS 直传：把一段字节存进本站桶并登记进数字资产台账。
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
    return this.storeOwned(userId, {
      bytes: input.bytes,
      filename: input.filename,
      labels: input.labels ?? [input.source || 'deliverable'],
      dir: input.dir || 'deliverables',
      migratedFrom: 'local',
    });
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
