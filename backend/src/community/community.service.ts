import { randomBytes } from 'node:crypto';
import {
  COMMUNITY_CATEGORIES,
  COMMUNITY_CATEGORY_LABELS,
  COMMUNITY_STATUS_LABELS,
  COMMUNITY_RUN_STATUS_LABELS,
  COMMUNITY_TITLE_MAX,
  COMMUNITY_SUMMARY_MAX,
  COMMUNITY_DESCRIPTION_MAX,
} from '@enterprise/contracts';
import type {
  CommunityAwardSettings,
  CommunityCredentialStatus,
  CommunityDraft,
  CommunityRun,
  CommunitySlot,
  CommunityWorkflowCard,
  CommunityWorkflowDetail,
} from '@enterprise/contracts';
import { Prisma } from '../../generated/prisma';
import { pageParam, pageOf, text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { Logger } from '../common/logger';
import { CurrentUser } from '../auth/current-user';
import { httpRequest } from '../http/transport';
import { assertOutboundUrl } from '../http/outbound-guard';
import { IdentityService } from '../identity/identity.service';
import { UserLookupService } from '../directory/user-lookup.service';
import { OssService } from '../oss/oss.service';
import { OSS_HOST } from '../oss/oss.config';
import { PrismaService } from '../prisma/prisma.service';
import { ComfyClient, MAX_DOWNLOAD_BYTES } from './comfy.client';
import { ComfyCrypto, maskComfyKey } from './comfy-crypto';
import { CommunityAwardService } from './community-award.service';
import {
  buildRunGraph,
  newUserWorkflowCode,
  validatePublishedGraph,
  validateSlots,
  type CommunityWorkflowGraph,
} from './community-workflow-registry';

const logger = new Logger('CommunityService');

/** 列表一次最多取这么多条（与全站 `LIST_ALL_LIMIT` 同口径，超出要靠筛选/分页）。 */
const PAGE_MAX = 200;
/** 分类页签统计时扫描的条目上限：只做分组计数，不全表聚合。 */
const CATEGORY_SCAN = 1000;

/** 运行表单里的图片输入封顶：与 Comfy Cloud「图片输入 >50MiB 拒 422」对齐。 */
const RUN_IMAGE_MAX_BYTES = MAX_DOWNLOAD_BYTES.image;

/** 与契约 `COMMUNITY_SLOT_TYPES` 同序：库里脏类型一律降级成文本框。 */
const SLOT_TYPES = [
  'text',
  'longtext',
  'int',
  'float',
  'enum',
  'seed',
  'image',
] as const;

/** Comfy Cloud 订阅与 Key 的获取入口（引导文案与错误提示都指向这里）。 */
export const COMFY_PRICING_URL = 'https://www.comfy.org/pricing';

const KEY_UNBOUND_MESSAGE =
  '还没有连接 Comfy Cloud：运行用的是你自己的 Comfy Cloud 账号与订阅积分，请先在「连接 Comfy Cloud」里粘贴保存 API Key。';

type WorkflowRow = {
  id: number;
  code: string;
  source: string;
  ownerUserId: string;
  ownerName: string;
  title: string;
  summary: string;
  description: string;
  category: string;
  groupLabel: string;
  tags: Prisma.JsonValue;
  mediaType: string;
  format: string;
  workflowJson: Prisma.JsonValue;
  slots: Prisma.JsonValue;
  coverKeys: Prisma.JsonValue;
  comfyUrl: string;
  status: string;
  auditNote: string;
  rewardedAt: Date | null;
  runCount: number;
  favoriteCount: number;
  likeCount: number;
  viewCount: number;
  createdAt: Date;
  updatedAt: Date;
};

type RunRow = {
  id: number;
  workflowId: number;
  userId: string;
  jobId: string;
  status: string;
  progressCurrent: number;
  progressTotal: number;
  queuePosition: number;
  inputs: Prisma.JsonValue;
  errorText: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type OutputRow = {
  id: number;
  runId: number;
  kind: string;
  name: string;
  ossKey: string;
  url: string;
  sizeBytes: bigint;
  assetId: number;
};

function listOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter((item) => item !== '')
    : [];
}

function slotsOf(value: unknown): CommunitySlot[] {
  if (!Array.isArray(value)) return [];
  const out: CommunitySlot[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const slot = item as Record<string, unknown>;
    const type = text(slot.type);
    const fallback = slot.defaultValue;
    out.push({
      key: text(slot.key).slice(0, 40),
      label: text(slot.label).slice(0, 60),
      type: (SLOT_TYPES as readonly string[]).includes(type)
        ? (type as CommunitySlot['type'])
        : 'text',
      nodeId: text(slot.nodeId).slice(0, 32),
      field: text(slot.field).slice(0, 60),
      defaultValue:
        typeof fallback === 'number' || typeof fallback === 'string'
          ? fallback
          : null,
      options: listOf(slot.options).slice(0, 50),
      min: numOrNull(slot.min),
      max: numOrNull(slot.max),
      required: slot.required === true,
    });
    if (out.length >= 40) break;
  }
  return out;
}

/** 库里可能存过 null / 空串 / 非法数字：契约要求 number | null，这里统一收口。 */
function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function graphOf(value: Prisma.JsonValue): CommunityWorkflowGraph {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as CommunityWorkflowGraph)
    : {};
}

/**
 * 创意社区服务：内容目录 + Key 绑定 + 站内运行 + 发布与审核。
 *
 * 三条硬口径：
 *  1. **纯 BYOK**——运行永远用调用者自己保存的 Comfy Cloud Key，本站不代付、不留平台兜底 Key；
 *  2. 明文 Key 只在服务内存里短暂存在（解密后交给 `ComfyClient`），任何响应体都不回传；
 *  3. 读可以公开（已通过/已推荐的条目），写与产物一律按 `userId` 收口。
 */
export class CommunityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly users: UserLookupService,
    private readonly oss: OssService,
    private readonly comfy: ComfyClient,
    private readonly crypto: ComfyCrypto,
    private readonly awards: CommunityAwardService,
  ) {}

  // ---------- 通用 ----------

  private async workflowByCode(code: string): Promise<WorkflowRow> {
    const clean = String(code || '')
      .trim()
      .slice(0, 64);
    if (!clean)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '工作流标识无效');
    const row = await this.prisma.communityWorkflow.findUnique({
      where: { code: clean },
    });
    if (!row)
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '这份工作流不存在或已被删除',
      );
    return row;
  }

  /** 目录页能看到的口径：作者本人和管理员能看到自己的所有状态，其他人只看已通过/已推荐。 */
  private visibleTo(row: WorkflowRow, user: CurrentUser) {
    if (row.source === 'OFFICIAL') {
      return row.status === 'APPROVED' || row.status === 'RECOMMENDED';
    }
    if (row.ownerUserId && row.ownerUserId === user.userId) return true;
    if (this.identity.isPlatformAdmin(user)) return true;
    return row.status === 'APPROVED' || row.status === 'RECOMMENDED';
  }

  private publishedFilter(): Prisma.CommunityWorkflowWhereInput {
    return { status: { in: ['APPROVED', 'RECOMMENDED'] } };
  }

  private coverUrls(row: WorkflowRow): string[] {
    return listOf(row.coverKeys)
      .slice(0, 8)
      .map((key) => (key.startsWith('http') ? key : this.oss.keyUrlOf(key)))
      .filter((url) => !!url);
  }

  /** 卡片：列表与详情共用，`runnable` 决定要不要给「立即运行」按钮。 */
  private async cards(
    rows: WorkflowRow[],
    user: CurrentUser,
  ): Promise<CommunityWorkflowCard[]> {
    const names = await this.authorNames(rows);
    const favorites = await this.myFlags(user, rows, 'favorite');
    const likes = await this.myFlags(user, rows, 'like');
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      title: row.title,
      summary: row.summary,
      source: row.source,
      ownerName: names.get(row.id) || row.ownerName || 'Comfy',
      category: row.category,
      categoryLabel: COMMUNITY_CATEGORY_LABELS[row.category] || row.category,
      groupLabel: row.groupLabel,
      tags: listOf(row.tags).slice(0, 12),
      mediaType: row.mediaType,
      format: row.format,
      runnable: row.format === 'api',
      covers: this.coverUrls(row),
      comfyUrl: row.comfyUrl,
      status: row.status,
      statusLabel: COMMUNITY_STATUS_LABELS[row.status] || row.status,
      runCount: row.runCount,
      favoriteCount: row.favoriteCount,
      likeCount: row.likeCount,
      viewCount: row.viewCount,
      createdAt: row.createdAt.toISOString(),
      mine: !!row.ownerUserId && row.ownerUserId === user.userId,
      favorited: favorites.has(row.id),
      liked: likes.has(row.id),
    }));
  }

  /** 作者展示名：官方条目沿用抓取时的官方作者名，用户条目查目录（批量，一次查完）。 */
  private async authorNames(rows: WorkflowRow[]): Promise<Map<number, string>> {
    const userIds = [
      ...new Set(
        rows
          .filter((row) => row.source !== 'OFFICIAL')
          .map((row) => row.ownerUserId)
          .filter((id) => !!id),
      ),
    ];
    if (!userIds.length) return new Map();
    const names = await this.users.displayNames(userIds);
    return new Map(
      rows.map((row) => [
        row.id,
        row.source === 'OFFICIAL'
          ? row.ownerName || 'Comfy'
          : names.get(row.ownerUserId) || row.ownerName || '',
      ]),
    );
  }

  private async myFlags(
    user: CurrentUser,
    rows: WorkflowRow[],
    kind: 'favorite' | 'like',
  ): Promise<Set<number>> {
    if (!rows.length) return new Set();
    const where = {
      userId: user.userId,
      workflowId: { in: rows.map((row) => row.id) },
    };
    const found =
      kind === 'favorite'
        ? await this.prisma.communityFavorite.findMany({
            where,
            select: { workflowId: true },
          })
        : await this.prisma.communityLike.findMany({
            where,
            select: { workflowId: true },
          });
    return new Set(found.map((row) => row.workflowId));
  }

  // ---------- 目录 ----------

  /** 分类页签：固定 6 类 + 每类下的场景分组（官方 Applied 分组或用户自填）；只看已发布内容，与登录身份无关。 */
  async categories() {
    const rows = await this.prisma.communityWorkflow.findMany({
      where: this.publishedFilter(),
      orderBy: [{ status: 'desc' }, { runCount: 'desc' }, { id: 'desc' }],
      take: CATEGORY_SCAN,
      select: { category: true, groupLabel: true },
    });
    const counters = new Map<
      string,
      { total: number; groups: Map<string, number> }
    >();
    for (const category of COMMUNITY_CATEGORIES) {
      counters.set(category, { total: 0, groups: new Map() });
    }
    for (const row of rows) {
      const bucket = counters.get(row.category);
      if (!bucket) continue;
      bucket.total += 1;
      const label = String(row.groupLabel || '')
        .trim()
        .slice(0, 64);
      if (label) bucket.groups.set(label, (bucket.groups.get(label) || 0) + 1);
    }
    return COMMUNITY_CATEGORIES.map((key) => {
      const bucket = counters.get(key)!;
      return {
        key,
        label: COMMUNITY_CATEGORY_LABELS[key] || key,
        count: bucket.total,
        groups: [...bucket.groups.entries()]
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
          .slice(0, 12),
      };
    });
  }

  async list(
    user: CurrentUser,
    query: {
      page?: number;
      pageSize?: number;
      category?: string;
      group?: string;
      keyword?: string;
      sort?: string;
      runnable?: boolean;
      favorite?: boolean;
    },
  ) {
    const page = pageParam(query.page, query.pageSize, 12);
    const pageSize = Math.min(page.pageSize, PAGE_MAX);
    const and: Prisma.CommunityWorkflowWhereInput[] = [this.publishedFilter()];
    const category = String(query.category || '').trim();
    if ((COMMUNITY_CATEGORIES as readonly string[]).includes(category)) {
      and.push({ category });
    }
    const group = String(query.group || '')
      .trim()
      .slice(0, 64);
    if (group) and.push({ groupLabel: group });
    if (query.runnable === true) and.push({ format: 'api' });
    const keyword = String(query.keyword || '')
      .trim()
      .slice(0, 120);
    if (keyword) {
      and.push({
        OR: [
          { title: { contains: keyword } },
          { summary: { contains: keyword } },
          { groupLabel: { contains: keyword } },
        ],
      });
    }
    if (query.favorite === true) {
      const mine = await this.prisma.communityFavorite.findMany({
        where: { userId: user.userId },
        select: { workflowId: true },
        take: 1000,
      });
      and.push({ id: { in: mine.map((row) => row.workflowId) } });
    }
    const where = { AND: and };
    // 排序：推荐＝已推荐优先，其余按热度/时间；三种都带 id 兜底，保证翻页稳定
    const orderBy: Prisma.CommunityWorkflowOrderByWithRelationInput[] =
      query.sort === 'new'
        ? [{ createdAt: 'desc' }, { id: 'desc' }]
        : query.sort === 'hot'
          ? [
              { runCount: 'desc' },
              { favoriteCount: 'desc' },
              { createdAt: 'desc' },
              { id: 'desc' },
            ]
          : [
              { status: 'desc' },
              { runCount: 'desc' },
              { likeCount: 'desc' },
              { createdAt: 'desc' },
              { id: 'desc' },
            ];
    const [total, rows] = await Promise.all([
      this.prisma.communityWorkflow.count({ where }),
      this.prisma.communityWorkflow.findMany({
        where,
        orderBy,
        skip: (page.page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return pageOf(
      await this.cards(rows as WorkflowRow[], user),
      total,
      page.page,
      pageSize,
    );
  }

  async detail(
    user: CurrentUser,
    code: string,
  ): Promise<CommunityWorkflowDetail> {
    const row = await this.workflowByCode(code);
    if (!this.visibleTo(row, user)) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '这份工作流暂时看不到');
    }
    const [card] = await this.cards([row], user);
    // 浏览量只统计目录外的真实打开，失败不影响详情读取
    void this.prisma.communityWorkflow
      .update({ where: { id: row.id }, data: { viewCount: { increment: 1 } } })
      .catch(() => undefined);
    const credential = await this.prisma.comfyCredential.findUnique({
      where: { userId: user.userId },
    });
    return {
      ...card,
      viewCount: row.viewCount + 1,
      description: row.description,
      slots: slotsOf(row.slots),
      workflowJson: graphOf(row.workflowJson),
      ownerUserId: row.ownerUserId,
      canManage: row.source !== 'OFFICIAL' && row.ownerUserId === user.userId,
      keyConnected: Boolean(credential?.keyCipher),
      auditNote: row.auditNote,
    };
  }

  // ---------- 收藏与点赞 ----------

  async setFavorite(
    user: CurrentUser,
    code: string,
    on: boolean,
  ): Promise<{ favorited: boolean; favoriteCount: number }> {
    const row = await this.workflowByCode(code);
    if (!this.visibleTo(row, user)) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '这份工作流暂时看不到');
    }
    const existing = await this.prisma.communityFavorite.findUnique({
      where: { userId_workflowId: { userId: user.userId, workflowId: row.id } },
    });
    if (on && !existing) {
      await this.prisma.$transaction([
        this.prisma.communityFavorite.create({
          data: { userId: user.userId, workflowId: row.id },
        }),
        this.prisma.communityWorkflow.update({
          where: { id: row.id },
          data: { favoriteCount: { increment: 1 } },
        }),
      ]);
    } else if (!on && existing) {
      await this.prisma.$transaction([
        this.prisma.communityFavorite.delete({ where: { id: existing.id } }),
        this.prisma.communityWorkflow.update({
          where: { id: row.id },
          data: {
            favoriteCount: { decrement: Math.min(row.favoriteCount, 1) },
          },
        }),
      ]);
    }
    const fresh = await this.prisma.communityWorkflow.findUnique({
      where: { id: row.id },
      select: { favoriteCount: true },
    });
    return {
      favorited: Boolean(
        await this.prisma.communityFavorite.findUnique({
          where: {
            userId_workflowId: { userId: user.userId, workflowId: row.id },
          },
          select: { id: true },
        }),
      ),
      favoriteCount: Math.max(0, fresh?.favoriteCount || 0),
    };
  }

  /** 点赞是开关：再点一次取消（只有一个 POST 端点，必须能反悔）。 */
  async toggleLike(
    user: CurrentUser,
    code: string,
  ): Promise<{ liked: boolean; likeCount: number }> {
    const row = await this.workflowByCode(code);
    if (!this.visibleTo(row, user)) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '这份工作流暂时看不到');
    }
    const existing = await this.prisma.communityLike.findUnique({
      where: { userId_workflowId: { userId: user.userId, workflowId: row.id } },
    });
    if (existing) {
      await this.prisma.$transaction([
        this.prisma.communityLike.delete({ where: { id: existing.id } }),
        this.prisma.communityWorkflow.update({
          where: { id: row.id },
          data: { likeCount: { decrement: Math.min(row.likeCount, 1) } },
        }),
      ]);
    } else {
      await this.prisma.$transaction([
        this.prisma.communityLike.create({
          data: { userId: user.userId, workflowId: row.id },
        }),
        this.prisma.communityWorkflow.update({
          where: { id: row.id },
          data: { likeCount: { increment: 1 } },
        }),
      ]);
    }
    const fresh = await this.prisma.communityWorkflow.findUnique({
      where: { id: row.id },
      select: { likeCount: true },
    });
    return {
      liked: !existing,
      likeCount: Math.max(0, fresh?.likeCount || 0),
    };
  }

  // ---------- Comfy Cloud Key ----------

  private statusOf(
    row: { keyMask: string; verifiedAt: Date | null; lastError: string } | null,
  ): CommunityCredentialStatus {
    return {
      connected: Boolean(row?.keyMask),
      keyMask: row?.keyMask || '',
      verifiedAt: row?.verifiedAt ? row.verifiedAt.toISOString() : null,
      lastError: row?.lastError || '',
      subscriptionRequired: true,
      pricingUrl: COMFY_PRICING_URL,
    };
  }

  async connectStatus(user: CurrentUser): Promise<CommunityCredentialStatus> {
    const row = await this.prisma.comfyCredential.findUnique({
      where: { userId: user.userId },
    });
    return this.statusOf(row);
  }

  /** 取明文 Key：运行/发布/校验都要用；没有就给用户可执行的引导文案。 */
  private async apiKeyOf(user: CurrentUser, required = true): Promise<string> {
    const row = await this.prisma.comfyCredential.findUnique({
      where: { userId: user.userId },
    });
    if (!row?.keyCipher) {
      if (!required) return '';
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        KEY_UNBOUND_MESSAGE,
      );
    }
    return this.crypto.decrypt(row.keyCipher);
  }

  /**
   * 调度器用的无上下文取 Key：未绑定或解密失败一律回空串（跳过即可，不能抛错打断轮询）。
   */
  async comfyKeyOf(userId: string): Promise<string> {
    if (!userId) return '';
    const row = await this.prisma.comfyCredential.findUnique({
      where: { userId },
    });
    if (!row?.keyCipher) return '';
    try {
      return this.crypto.decrypt(row.keyCipher);
    } catch {
      return '';
    }
  }

  /**
   * 保存 Key：先打上游探针，通过才落库。
   * 失败时把 lastError 与掩码留下（界面上能看到「上次校验失败：…」），但绝不留明文。
   */
  async saveCredential(user: CurrentUser, raw: string) {
    const apiKey = String(raw || '').trim();
    if (apiKey.length < 8 || apiKey.length > 400) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        'API Key 看起来不完整：请粘贴 platform.comfy.org → API Keys 里生成的完整字符串（只显示一次）。',
      );
    }
    const keyMask = maskComfyKey(apiKey);
    try {
      await this.comfy.verifyKey(apiKey);
    } catch (error) {
      const message =
        error instanceof BusinessException
          ? error.message
          : 'Comfy Cloud 校验失败，请稍后重试';
      await this.prisma.comfyCredential.upsert({
        where: { userId: user.userId },
        create: {
          userId: user.userId,
          // 未通过校验的 Key 只留密文与失败原因，方便用户回头改；掩码先写上
          keyCipher: this.crypto.encrypt(apiKey),
          keyMask,
          lastError: message.slice(0, 500),
        },
        update: { lastError: message.slice(0, 500) },
      });
      throw error;
    }
    await this.prisma.comfyCredential.upsert({
      where: { userId: user.userId },
      create: {
        userId: user.userId,
        keyCipher: this.crypto.encrypt(apiKey),
        keyMask,
        verifiedAt: new Date(),
        lastError: '',
      },
      update: {
        keyCipher: this.crypto.encrypt(apiKey),
        keyMask,
        verifiedAt: new Date(),
        lastError: '',
      },
    });
    await this.identity.audit(
      user.userId,
      '绑定 Comfy Cloud Key',
      `保存并通过校验（${keyMask}）`,
    );
    return this.connectStatus(user);
  }

  /** 重新校验已保存的 Key（订阅掉线时用户能自己看出问题）。 */
  async testCredential(user: CurrentUser) {
    const apiKey = await this.apiKeyOf(user);
    try {
      await this.comfy.verifyKey(apiKey);
    } catch (error) {
      const message =
        error instanceof BusinessException
          ? error.message
          : 'Comfy Cloud 校验失败，请稍后重试';
      await this.prisma.comfyCredential.update({
        where: { userId: user.userId },
        data: { lastError: message.slice(0, 500) },
      });
      throw error;
    }
    await this.prisma.comfyCredential.update({
      where: { userId: user.userId },
      data: { verifiedAt: new Date(), lastError: '' },
    });
    return this.connectStatus(user);
  }

  async clearCredential(user: CurrentUser) {
    await this.prisma.comfyCredential.deleteMany({
      where: { userId: user.userId },
    });
    await this.identity.audit(
      user.userId,
      '解除 Comfy Cloud Key',
      '本人主动清除',
    );
    return this.connectStatus(user);
  }

  // ---------- 运行 ----------

  /**
   * 运行表单里的图片输入 → Comfy Cloud asset id。
   * 前端给三种都可以：`data:image/...;base64,`、本站 OSS 完整地址、本站对象键；
   * 只允许本站桶域，避免有人拿运行入口当任意 URL 探针。
   * 同一张图在一次运行里只上传一次（多个槽位可以指同一张）。
   */
  private async uploadInputImage(
    apiKey: string,
    value: string,
    cache: Map<string, string>,
  ): Promise<string> {
    const raw = String(value || '').trim();
    const hit = cache.get(raw);
    if (hit) return hit;
    const image = await this.readInputImage(raw);
    const assetId = await this.comfy.uploadAsset(
      apiKey,
      image.bytes,
      image.filename,
      image.contentType,
    );
    cache.set(raw, assetId);
    return assetId;
  }

  private async readInputImage(
    raw: string,
  ): Promise<{ bytes: Buffer; filename: string; contentType: string }> {
    if (!raw) {
      throw new BusinessException(ErrorCode.VALIDATION_ERROR, '请先上传图片');
    }
    if (raw.startsWith('data:')) {
      const comma = raw.indexOf(',');
      const meta = raw.slice(5, comma < 0 ? undefined : comma);
      const body = comma < 0 ? '' : raw.slice(comma + 1);
      if (!/;base64/i.test(meta) || !body) {
        throw new BusinessException(
          ErrorCode.VALIDATION_ERROR,
          '图片格式不支持，请重新上传',
        );
      }
      const contentType = meta.split(';')[0] || 'image/png';
      const bytes = Buffer.from(body, 'base64');
      this.assertImageSize(bytes);
      return { bytes, filename: `input${extOf(contentType)}`, contentType };
    }
    const url = /^https?:/i.test(raw) ? raw : this.oss.keyUrlOf(raw);
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '图片地址无效，请重新上传',
      );
    }
    if (
      target.protocol !== 'https:' ||
      target.hostname.toLowerCase() !== OSS_HOST
    ) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '运行用的图片必须是本站已上传的素材（不能直接指向外链）',
      );
    }
    await assertOutboundUrl(url, '本站素材地址');
    let response;
    try {
      response = await httpRequest<Uint8Array>(url, {
        method: 'GET',
        readAs: 'bytes',
        maxBytes: RUN_IMAGE_MAX_BYTES,
        timeoutMs: 60000,
        redirect: 'error',
        operation: 'community:input-image',
      });
    } catch {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '读不到这张图片，请重新上传',
      );
    }
    if (!response.ok) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '读不到这张图片，请重新上传',
      );
    }
    const bytes = Buffer.from(response.data || new Uint8Array());
    this.assertImageSize(bytes);
    const contentType = response.headers.get('content-type') || 'image/png';
    return {
      bytes,
      filename: `${(target.pathname.split('/').pop() || 'input').replace(/[^\w.-]/g, '_').slice(0, 80)}`,
      contentType: contentType.startsWith('image/') ? contentType : 'image/png',
    };
  }

  /**
   * 运行表单里的图片输入先落本站桶（multipart 端点，见 automation-routes）。
   * 只认 image/*、封顶 50MB：Comfy Cloud 对超过 50MiB 的图片输入直接拒 422，
   * 在这里挡住比让上游报错更好受，也免得有人拿运行入口当任意外链中转。
   * 返回的对象键会原样填进 slots 的 image 值里，运行时后端再取字节换成 Comfy 资产 id。
   */
  async uploadInput(
    user: CurrentUser,
    file: { name: string; type: string; bytes: Buffer },
  ): Promise<{ key: string; url: string; size: number }> {
    if (!file.bytes?.length) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '图片是空的，请重新上传',
      );
    }
    if (!file.type.startsWith('image/')) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '运行参数里的输入只能是图片文件',
      );
    }
    this.assertImageSize(file.bytes);
    const safeName = (file.name || 'input')
      .replace(/[^\w.-]/g, '_')
      .slice(0, 80);
    const objectPath = `enterprise/${user.userId}/community-inputs/${Date.now()}-${randomBytes(
      4,
    ).toString('hex')}-${safeName}`;
    const uploaded = await this.oss.upload(objectPath, file.bytes);
    return { key: uploaded.key, url: uploaded.url, size: uploaded.size };
  }

  private assertImageSize(bytes: Buffer) {
    if (!bytes.length) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '图片是空的，请重新上传',
      );
    }
    if (bytes.length > RUN_IMAGE_MAX_BYTES) {
      throw new BusinessException(
        ErrorCode.PAYLOAD_TOO_LARGE,
        '图片超过 50MB，Comfy Cloud 会直接拒收，请换小一点的图',
      );
    }
  }

  async run(
    user: CurrentUser,
    code: string,
    inputs: Record<string, unknown>,
  ): Promise<CommunityRun> {
    const row = await this.workflowByCode(code);
    if (!this.visibleTo(row, user)) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '这份工作流暂时看不到');
    }
    if (row.format !== 'api') {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '这份工作流只有 ComfyUI 界面（save）格式，站内不能直接运行；可以下载 JSON 在你自己的 ComfyUI 里打开。',
      );
    }
    // 没 Key 就在这里拦住：下面全部调用都用的是用户自己的 Comfy 账号
    const apiKey = await this.apiKeyOf(user);
    const slots = slotsOf(row.slots);
    const cache = new Map<string, string>();
    const graph = await buildRunGraph(
      graphOf(row.workflowJson),
      slots,
      inputs || {},
      (value) => this.uploadInputImage(apiKey, value, cache),
    );
    const job = await this.comfy.submitJob(apiKey, graph);
    if (!job.id) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'Comfy Cloud 没有返回任务编号，请稍后到运行记录里确认',
      );
    }
    const created = await this.prisma.communityRun.create({
      data: {
        workflowId: row.id,
        userId: user.userId,
        jobId: job.id.slice(0, 64),
        status: job.status || 'queued',
        inputs: inputSnapshot(inputs) as never,
        startedAt: job.status === 'running' ? new Date() : null,
      },
    });
    await this.prisma.communityWorkflow.update({
      where: { id: row.id },
      data: { runCount: { increment: 1 } },
    });
    await this.identity.audit(
      user.userId,
      '创意社区运行工作流',
      `${row.code} job=${job.id.slice(0, 64)}`,
    );
    const [shaped] = await this.shapeRuns([created]);
    return shaped;
  }

  private async shapeRuns(runs: RunRow[]): Promise<CommunityRun[]> {
    if (!runs.length) return [];
    const runIds = runs.map((run) => run.id);
    const [workflows, outputs] = await Promise.all([
      this.prisma.communityWorkflow.findMany({
        where: { id: { in: [...new Set(runs.map((run) => run.workflowId))] } },
        select: { id: true, code: true, title: true },
      }),
      this.prisma.communityRunOutput.findMany({
        where: { runId: { in: runIds } },
        orderBy: { id: 'asc' },
        take: 500,
      }),
    ]);
    const byWorkflow = new Map(workflows.map((row) => [row.id, row]));
    const byRun = new Map<number, OutputRow[]>();
    for (const output of outputs as unknown as OutputRow[]) {
      const bucket = byRun.get(output.runId) || [];
      bucket.push(output);
      byRun.set(output.runId, bucket);
    }
    return runs.map((run) => ({
      id: run.id,
      workflowId: run.workflowId,
      workflowCode: byWorkflow.get(run.workflowId)?.code || '',
      workflowTitle: byWorkflow.get(run.workflowId)?.title || '',
      jobId: run.jobId,
      status: run.status,
      statusLabel: COMMUNITY_RUN_STATUS_LABELS[run.status] || run.status,
      progressCurrent: run.progressCurrent,
      progressTotal: run.progressTotal,
      queuePosition: run.queuePosition,
      inputs:
        run.inputs &&
        typeof run.inputs === 'object' &&
        !Array.isArray(run.inputs)
          ? (run.inputs as Record<string, unknown>)
          : {},
      errorText: run.errorText,
      outputs: (byRun.get(run.id) || []).map((output) => ({
        kind: output.kind,
        name: output.name,
        url:
          output.url || (output.ossKey ? this.oss.keyUrlOf(output.ossKey) : ''),
        ossKey: output.ossKey,
        sizeBytes: Number(output.sizeBytes || 0),
        assetId: output.assetId,
      })),
      createdAt: run.createdAt.toISOString(),
      finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      active: run.status === 'queued' || run.status === 'running',
    }));
  }

  /** 运行记录只本人可见（别人的 id 一律当不存在，不区分「无权」和「没有」）。 */
  private async ownRun(user: CurrentUser, id: string): Promise<RunRow> {
    const runId = Number(id);
    if (!Number.isInteger(runId) || runId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '运行记录编号无效');
    }
    const row = await this.prisma.communityRun.findFirst({
      where: { id: runId, userId: user.userId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '运行记录不存在');
    return row;
  }

  async runStatus(user: CurrentUser, id: string): Promise<CommunityRun> {
    const run = await this.ownRun(user, id);
    if ((run.status === 'queued' || run.status === 'running') && run.jobId) {
      const apiKey = await this.apiKeyOf(user, false);
      // 没 Key（或 Key 被解绑）时不阻断读取：把本地已知状态回给前端就行
      if (apiKey) {
        try {
          const job = await this.comfy.getJob(apiKey, run.jobId);
          const data: Prisma.CommunityRunUpdateInput = {
            progressCurrent: job.progressCurrent,
            progressTotal: job.progressTotal,
            queuePosition: job.queuePosition,
          };
          // `succeeded` 不在这里落库：转存产物的是调度器，先翻状态会出现「已完成但没产物」的空档
          if (job.status === 'failed' || job.status === 'canceled') {
            data.status = job.status;
            data.errorText = (job.errorText || '上游任务已结束').slice(0, 500);
            data.finishedAt = new Date();
          }
          await this.prisma.communityRun.update({
            where: { id: run.id },
            data,
          });
          Object.assign(run, data);
        } catch (error) {
          // 上游报错已翻译成中文业务提示；这里只是状态轮询，不能因为它报错打断界面，留日志即可
          if (
            error instanceof BusinessException &&
            error.errorCode === ErrorCode.RATE_LIMITED
          ) {
            logger.warn(`运行状态轮询被上游限流：run=${run.id}`);
          } else {
            logger.warn(
              `运行状态轮询失败：run=${run.id} ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    }
    const [shaped] = await this.shapeRuns([run]);
    return shaped;
  }

  async cancelRun(user: CurrentUser, id: string): Promise<CommunityRun> {
    const run = await this.ownRun(user, id);
    if (['succeeded', 'failed', 'canceled'].includes(run.status)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '这次运行已经结束，不能再取消',
      );
    }
    if (run.jobId) {
      const apiKey = await this.apiKeyOf(user);
      try {
        await this.comfy.cancelJob(apiKey, run.jobId);
      } catch (error) {
        // 上游说找不到（已被清理或本就是终态）时，本地照样标成已取消，否则界面永远卡在「排队中」
        if (
          !(error instanceof BusinessException) ||
          error.errorCode !== ErrorCode.NOT_FOUND
        ) {
          throw error;
        }
        logger.warn(`上游取消返回 404，按本地取消处理：run=${run.id}`);
      }
    }
    await this.prisma.communityRun.update({
      where: { id: run.id },
      data: {
        status: 'canceled',
        errorText: '已在本站取消',
        finishedAt: new Date(),
      },
    });
    await this.identity.audit(
      user.userId,
      '创意社区取消运行',
      `run=${run.id} job=${run.jobId}`,
    );
    const fresh = await this.prisma.communityRun.findUnique({
      where: { id: run.id },
    });
    const [shaped] = await this.shapeRuns([fresh || run]);
    return shaped;
  }

  async myRuns(
    user: CurrentUser,
    query: { page?: number; pageSize?: number; workflowCode?: string },
  ) {
    const page = pageParam(query.page, query.pageSize, 10);
    const where: Prisma.CommunityRunWhereInput = { userId: user.userId };
    const code = String(query.workflowCode || '')
      .trim()
      .slice(0, 64);
    if (code) {
      const workflow = await this.prisma.communityWorkflow.findUnique({
        where: { code },
        select: { id: true },
      });
      // 按不存在的工作流过滤就是空列表，不需要多一次往返
      if (!workflow) return pageOf([], 0, page.page, page.pageSize);
      where.workflowId = workflow.id;
    }
    const [total, rows] = await Promise.all([
      this.prisma.communityRun.count({ where }),
      this.prisma.communityRun.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      }),
    ]);
    return pageOf(
      await this.shapeRuns(rows as unknown as RunRow[]),
      total,
      page.page,
      page.pageSize,
    );
  }

  // ---------- 发布与我的发布 ----------

  /** 发布校验要拿用户自己账号的节点清单（object_info），所以发布也得先连上 Comfy Cloud。 */
  private async nodeNamesOf(user: CurrentUser): Promise<Set<string>> {
    const apiKey = await this.apiKeyOf(user);
    return this.comfy.nodeNames(apiKey);
  }

  private async ownedWorkflow(
    user: CurrentUser,
    code: string,
  ): Promise<WorkflowRow> {
    const row = await this.workflowByCode(code);
    if (row.source === 'OFFICIAL') {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '官方模板不能修改或下架',
      );
    }
    if (
      row.ownerUserId !== user.userId &&
      !this.identity.isPlatformAdmin(user)
    ) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只有作者本人可以管理这份工作流',
      );
    }
    return row;
  }

  private draftOf(row: WorkflowRow): CommunityDraft {
    return {
      id: row.id,
      code: row.code,
      title: row.title,
      category: row.category,
      categoryLabel: COMMUNITY_CATEGORY_LABELS[row.category] || row.category,
      format: row.format,
      status: row.status,
      statusLabel: COMMUNITY_STATUS_LABELS[row.status] || row.status,
      auditNote: row.auditNote,
      runCount: row.runCount,
      rewarded: Boolean(row.rewardedAt),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async myDrafts(
    user: CurrentUser,
    query: { page?: number; pageSize?: number; status?: string },
  ) {
    const page = pageParam(query.page, query.pageSize, 20);
    const where: Prisma.CommunityWorkflowWhereInput = {
      source: 'USER',
      ownerUserId: user.userId,
    };
    const status = String(query.status || '').trim();
    if (status) where.status = status;
    const [total, rows] = await Promise.all([
      this.prisma.communityWorkflow.count({ where }),
      this.prisma.communityWorkflow.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      }),
    ]);
    return pageOf(
      (rows as WorkflowRow[]).map((row) => this.draftOf(row)),
      total,
      page.page,
      page.pageSize,
    );
  }

  async publish(
    user: CurrentUser,
    raw: Record<string, unknown>,
  ): Promise<CommunityDraft> {
    const body = readPublishInput(raw);
    const nodeNames = await this.nodeNamesOf(user);
    const title = text(body.title).trim().slice(0, COMMUNITY_TITLE_MAX);
    if (!title) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '请填写工作流标题',
      );
    }
    const graph = body.workflowJson;
    validatePublishedGraph(graph, nodeNames);
    const slots = Array.isArray(body.slots) ? body.slots : [];
    validateSlots(graph as CommunityWorkflowGraph, slots, nodeNames);
    const code = newUserWorkflowCode();
    const row = await this.prisma.communityWorkflow.create({
      data: {
        code,
        source: 'USER',
        ownerUserId: user.userId,
        ownerName: (await this.users.displayName(user.userId)) || user.username,
        title,
        summary: text(body.summary).trim().slice(0, COMMUNITY_SUMMARY_MAX),
        description: text(body.description).slice(0, COMMUNITY_DESCRIPTION_MAX),
        category: pickCategory(body.category),
        groupLabel: text(body.groupLabel).trim().slice(0, 64),
        tags: cleanTags(body.tags) as never,
        mediaType: pickMedia(body.mediaType),
        format: 'api',
        workflowJson: graph as never,
        slots: slots as never,
        coverKeys: [] as never,
        comfyUrl: '',
        status: 'PENDING',
        auditNote: '已提交，等待管理员审核',
      },
    });
    await this.identity.audit(
      user.userId,
      '创意社区发布工作流',
      `${code} ${title}`,
    );
    return this.draftOf(row);
  }

  /**
   * 编辑已发布内容：改 JSON 或改参数表单一定回到待审核（审核过的内容不能偷偷换掉），
   * 只改文案则保留原状态。
   */
  async updateWorkflow(
    user: CurrentUser,
    code: string,
    raw: Record<string, unknown>,
  ): Promise<CommunityDraft> {
    const body = readPublishInput(raw);
    const row = await this.ownedWorkflow(user, code);
    const graphChanged = body.workflowJson !== undefined;
    const slotsChanged = body.slots !== undefined;
    let nodeNames: Set<string> | null = null;
    const nodes = async () => {
      // 只在真需要校验时才取节点清单（object_info 很大），改文案不联网
      if (!nodeNames) nodeNames = await this.nodeNamesOf(user);
      return nodeNames;
    };
    const graph = graphChanged ? body.workflowJson : graphOf(row.workflowJson);
    const slots = slotsChanged
      ? Array.isArray(body.slots)
        ? body.slots
        : []
      : slotsOf(row.slots);
    if (graphChanged) validatePublishedGraph(graph, await nodes());
    if (graphChanged || slotsChanged) {
      validateSlots(graph as CommunityWorkflowGraph, slots, await nodes());
    }
    const data: Prisma.CommunityWorkflowUpdateInput = {};
    if (body.title !== undefined) {
      const title = text(body.title).trim().slice(0, COMMUNITY_TITLE_MAX);
      if (!title) {
        throw new BusinessException(ErrorCode.VALIDATION_ERROR, '标题不能为空');
      }
      data.title = title;
    }
    if (body.summary !== undefined) {
      data.summary = text(body.summary).trim().slice(0, COMMUNITY_SUMMARY_MAX);
    }
    if (body.description !== undefined) {
      data.description = text(body.description).slice(
        0,
        COMMUNITY_DESCRIPTION_MAX,
      );
    }
    if (body.category !== undefined)
      data.category = pickCategory(body.category);
    if (body.groupLabel !== undefined) {
      data.groupLabel = text(body.groupLabel).trim().slice(0, 64);
    }
    if (body.tags !== undefined) data.tags = cleanTags(body.tags);
    if (body.mediaType !== undefined)
      data.mediaType = pickMedia(body.mediaType);
    if (graphChanged) {
      data.workflowJson = graph as never;
      data.format = 'api';
    }
    if (slotsChanged) data.slots = slots;
    if (graphChanged || slotsChanged || row.status === 'REJECTED') {
      data.status = 'PENDING';
      data.auditNote =
        graphChanged || slotsChanged
          ? '内容已修改，重新进入审核'
          : '已重新提交，等待管理员审核';
    }
    const fresh = await this.prisma.communityWorkflow.update({
      where: { id: row.id },
      data,
    });
    await this.identity.audit(
      user.userId,
      '创意社区修改工作流',
      `${row.code}${graphChanged ? '（含 JSON，重新送审）' : ''}`,
    );
    return this.draftOf(fresh);
  }

  async unpublish(
    user: CurrentUser,
    code: string,
  ): Promise<{ status: string }> {
    const row = await this.ownedWorkflow(user, code);
    await this.prisma.communityWorkflow.update({
      where: { id: row.id },
      data: { status: 'REMOVED', auditNote: '作者已下架' },
    });
    await this.identity.audit(user.userId, '创意社区下架工作流', row.code);
    return { status: 'REMOVED' };
  }

  // ---------- 平台后台 ----------

  async adminPending(
    user: CurrentUser,
    query: {
      page?: number;
      pageSize?: number;
      status?: string;
      keyword?: string;
    },
  ) {
    this.identity.requireAdmin(user);
    const page = pageParam(query.page, query.pageSize, 20);
    const status = String(query.status || 'PENDING').trim();
    const and: Prisma.CommunityWorkflowWhereInput[] = [
      { status: status || 'PENDING' },
    ];
    const keyword = text(query.keyword).trim().slice(0, 120);
    if (keyword) {
      and.push({
        OR: [
          { title: { contains: keyword } },
          { code: { contains: keyword } },
          { ownerUserId: { contains: keyword } },
        ],
      });
    }
    const where = { AND: and };
    const [total, rows] = await Promise.all([
      this.prisma.communityWorkflow.count({ where }),
      this.prisma.communityWorkflow.findMany({
        where,
        orderBy: { updatedAt: 'asc' },
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      }),
    ]);
    const cards = await this.cards(rows, user);
    const list = cards.map((card, index) => ({
      ...card,
      ownerUserId: (rows as WorkflowRow[])[index].ownerUserId,
      slots: slotsOf((rows as WorkflowRow[])[index].slots),
      submittedAt: (rows as WorkflowRow[])[index].updatedAt.toISOString(),
    }));
    return pageOf(list, total, page.page, page.pageSize);
  }

  /** 审核动作：四种决定都落状态与审计，只有 approve/recommend 会走发奖。 */
  async adminDecide(
    user: CurrentUser,
    code: string,
    action: 'approve' | 'reject' | 'recommend' | 'remove',
    note: string,
  ): Promise<{
    status: string;
    statusLabel: string;
    rewarded: boolean;
    rewardPoints: number;
  }> {
    this.identity.requireAdmin(user);
    const row = await this.workflowByCode(code);
    const next = DECISION_STATUS[action];
    if (!next) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '不支持的审核动作');
    }
    const clean = text(note).trim().slice(0, 500);
    if (action === 'reject' && !clean) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '驳回要写清理由，作者在前台看得到',
      );
    }
    if (
      action === 'recommend' &&
      !['APPROVED', 'RECOMMENDED'].includes(row.status)
    ) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '要先审核通过，才能推荐进市场',
      );
    }
    await this.prisma.communityWorkflow.update({
      where: { id: row.id },
      data: {
        status: next,
        auditNote: clean,
        auditedAt: new Date(),
        auditBy: user.userId,
      },
    });
    const award =
      action === 'approve' || action === 'recommend'
        ? await this.awards.award(
            user,
            {
              id: row.id,
              code: row.code,
              source: row.source,
              ownerUserId: row.ownerUserId,
              title: row.title,
            },
            action,
          )
        : { rewarded: false, points: 0, skipped: '' };
    await this.identity.audit(
      user.userId,
      '创意社区审核工作流',
      `${row.code} → ${next}${clean ? `（${clean.slice(0, 80)}）` : ''}${
        award.skipped ? `；未发奖：${award.skipped}` : ''
      }`,
    );
    return {
      status: next,
      statusLabel: COMMUNITY_STATUS_LABELS[next] || next,
      rewarded: award.rewarded,
      rewardPoints: award.points,
    };
  }

  async adminStats(user: CurrentUser) {
    this.identity.requireAdmin(user);
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const count = (where: Prisma.CommunityWorkflowWhereInput) =>
      this.prisma.communityWorkflow.count({ where });
    const [
      pending,
      approved,
      recommended,
      rejected,
      removed,
      official,
      userRows,
      runsToday,
      keyBoundUsers,
      reward,
    ] = await Promise.all([
      count({ status: 'PENDING' }),
      count({ status: 'APPROVED' }),
      count({ status: 'RECOMMENDED' }),
      count({ status: 'REJECTED' }),
      count({ status: 'REMOVED' }),
      count({ source: 'OFFICIAL' }),
      count({ source: 'USER' }),
      this.prisma.communityRun.count({ where: { createdAt: { gte: since } } }),
      this.prisma.comfyCredential.count(),
      this.prisma.pointTransaction.aggregate({
        where: {
          type: 'EARN',
          scene: { in: ['community_approve', 'community_recommend'] },
          createdAt: { gte: since },
        },
        _sum: { amount: true },
      }),
    ]);
    return {
      pending,
      approved,
      recommended,
      rejected,
      removed,
      official,
      user: userRows,
      runsToday,
      rewardPointsToday: Number(reward._sum.amount || 0),
      keyBoundUsers,
    };
  }

  /** 后台的社区积分规则：读写都要管理员。 */
  async adminSettings(user: CurrentUser): Promise<CommunityAwardSettings> {
    this.identity.requireAdmin(user);
    return this.awards.view();
  }

  async adminSaveSettings(
    user: CurrentUser,
    body: CommunityAwardSettings,
  ): Promise<CommunityAwardSettings> {
    this.identity.requireAdmin(user);
    const saved = await this.awards.save(body);
    await this.identity.audit(
      user.userId,
      '创意社区积分规则变更',
      `通过${saved.approveReward}/推荐${saved.recommendReward}/单人日帽${saved.perUserDailyCap}/全站日帽${saved.siteDailyCap}`,
    );
    return saved;
  }
}

const DECISION_STATUS: Record<string, string> = {
  approve: 'APPROVED',
  reject: 'REJECTED',
  recommend: 'RECOMMENDED',
  remove: 'REMOVED',
};

type PublishInput = {
  title?: string;
  summary?: string;
  description?: string;
  category?: string;
  groupLabel?: string;
  tags?: string[];
  mediaType?: string;
  workflowJson?: unknown;
  slots?: CommunitySlot[];
};

/**
 * 请求体收口：契约已经用 Zod 校过一轮，这里只做类型收窄与长度截断，
 * 并保持「没传」与「传空」的区别（updateWorkflow 要靠这个判断要不要重新送审）。
 */
function readPublishInput(body: Record<string, unknown>): PublishInput {
  const out: PublishInput = {};
  for (const key of [
    'title',
    'summary',
    'description',
    'category',
    'groupLabel',
    'mediaType',
  ] as const) {
    if (body[key] !== undefined) out[key] = text(body[key]);
  }
  if (body.tags !== undefined) out.tags = listOf(body.tags);
  if (body.workflowJson !== undefined) out.workflowJson = body.workflowJson;
  if (body.slots !== undefined) out.slots = slotsOf(body.slots);
  return out;
}

function pickCategory(value: unknown): string {
  const raw = text(value).trim();
  return (COMMUNITY_CATEGORIES as readonly string[]).includes(raw)
    ? raw
    : 'image';
}

function pickMedia(value: unknown): string {
  const raw = text(value).trim().toLowerCase();
  return ['image', 'video', 'audio', 'file'].includes(raw) ? raw : 'image';
}

function cleanTags(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  for (const item of list) {
    const tag = text(item).trim().slice(0, 30);
    if (tag) seen.add(tag);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

/** 运行台账只存用户填的值（标量）；data URL 只留占位，不把整张图塞进 JSON 列。 */
function inputSnapshot(
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(inputs || {})) {
    const name = String(key).slice(0, 40);
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[name] = value;
    } else if (typeof value === 'string') {
      out[name] = value.startsWith('data:')
        ? `<image ${value.length}B>`
        : value.slice(0, 2000);
    }
  }
  return out;
}

function extOf(contentType: string): string {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  if (type.includes('webp')) return '.webp';
  if (type.includes('gif')) return '.gif';
  if (type.includes('png')) return '.png';
  return '.png';
}
