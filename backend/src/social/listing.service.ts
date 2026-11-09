import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { DemandService } from '../aiworkin/demand.service';
import { DemandDraft } from '../aiworkin/aiworkin.types';
import {
  MODULE_CATEGORIES,
  categoryLabels,
  leafById,
} from '../aiworkin/category-catalog';

/**
 * 供求广场本地服务（设计 §4.2 / M6）：社交板「通用发布需求 / 发布服务」。
 * - 本地发布免 Key：任何注册用户可发帖，进信息流可被浏览 / 私信对接；
 * - 同步上游需绑定 Key：经凭证解析器拿到用户绑定的 AIPDD Key，复用企业板块同一
 *   DemandService/AiworkinClient 通道调 `POST /market/listings`，只镜像上游状态。
 * userId 与 Account.id 同为字符串数字（见 social.service）。
 */
const MONEY_MODES = ['FIXED', 'STARTING', 'RANGE', 'NEGOTIABLE'];
const TYPE_LABELS: Record<string, string> = { DEMAND: '需求', SERVICE: '服务' };
/** 行记录类型：视图与草稿构造共用，免得按 any 取列丢类型（同 hiring.service）。 */
type ListingRecord = Prisma.ListingGetPayload<null>;

interface ListingCreateInput {
  type?: string;
  title?: string;
  description?: string;
  tags?: unknown;
  moneyMode?: string;
  amountMin?: number;
  amountMax?: number;
  province?: string;
  city?: string;
  contactNote?: string;
  subcategoryId?: string;
}

interface UpstreamPublishInput {
  deadline?: string;
  contactName?: string;
  contactPhone?: string;
  contactWechat?: string;
  contactEmail?: string;
  priceDescription?: string;
  serviceAreaMode?: string;
}

export class ListingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly demands: DemandService,
  ) {}

  // ---------- 类目字典（供求广场发布选择器，不受 AIWORKIN_ENABLED 门控） ----------
  categories() {
    return MODULE_CATEGORIES.map((m) => ({
      domain: m.domain,
      moduleLabel: m.label,
      parentName: m.parentName,
      options: m.children.map((c) => ({
        id: c.id,
        key: c.key,
        name: c.name,
        credentialTypes: c.credentialTypes,
        manualOnly: c.manualOnly,
      })),
    }));
  }

  // ---------- 视图与人物聚合 ----------
  private parseTags(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.map((t) => String(t)).filter(Boolean);
    return [];
  }
  private async persons(
    userIds: string[],
  ): Promise<
    Record<
      string,
      { userId: string; username: string; displayName: string; avatar: string }
    >
  > {
    const ids = [
      ...new Set(userIds.filter((id) => id && /^\d+$/.test(id))),
    ].map(Number);
    const map: Record<
      string,
      { userId: string; username: string; displayName: string; avatar: string }
    > = {};
    if (!ids.length) return map;
    const rows = await this.prisma.account.findMany({
      where: { id: { in: ids } },
    });
    for (const a of rows) {
      // displayName 与 social.service 同口径：前端卡片取 author.displayName，缺了会一律显示「匿名」
      map[String(a.id)] = {
        userId: String(a.id),
        username: a.username,
        displayName: a.username,
        avatar: a.avatar || '',
      };
    }
    return map;
  }
  private async views(rows: ListingRecord[]) {
    const persons = await this.persons(rows.map((r) => r.authorUserId));
    return rows.map((r) => {
      const labels = r.subcategoryId ? categoryLabels(r.subcategoryId) : null;
      return {
        id: r.id,
        author: persons[r.authorUserId] || {
          userId: r.authorUserId,
          username: '已注销',
          displayName: '已注销',
          avatar: '',
        },
        type: r.type,
        title: r.title,
        description: r.description,
        tags: this.parseTags(r.tags),
        moneyMode: r.moneyMode,
        amountMin: r.amountMin,
        amountMax: r.amountMax,
        currency: r.currency,
        province: r.province,
        city: r.city,
        contactNote: r.contactNote,
        status: r.status,
        publishedUpstream: !!r.publishedUpstream,
        aiworkinListingNo: r.aiworkinListingNo || '',
        subcategoryId: r.subcategoryId || '',
        category1: labels?.category1 || '',
        category2: labels?.category2 || '',
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  // ---------- 本地发布（免 Key） ----------
  async create(userId: string, input: ListingCreateInput) {
    const type =
      input.type === 'SERVICE'
        ? 'SERVICE'
        : input.type === 'DEMAND'
          ? 'DEMAND'
          : '';
    if (!type)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '类型必须为 DEMAND 或 SERVICE',
      );
    const title = String(input.title ?? '').trim();
    if (!title || title.length > 120)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '标题需 1-120 字');
    const description = String(input.description ?? '').trim();
    if (!description)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写详细说明');
    if (
      input.amountMin != null &&
      input.amountMax != null &&
      input.amountMin > input.amountMax
    )
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '预算下限不可大于上限',
      );
    const tags = Array.isArray(input.tags)
      ? input.tags
          .map((t) => String(t).trim())
          .filter(Boolean)
          .slice(0, 10)
      : [];
    const subcategoryId = String(input.subcategoryId ?? '').trim();
    if (subcategoryId && !leafById(subcategoryId))
      throw new BusinessException(ErrorCode.BAD_REQUEST, '二级类目不合法');
    const row = await this.prisma.listing.create({
      data: {
        authorUserId: userId,
        type,
        title,
        description,
        tags: tags,
        moneyMode:
          input.moneyMode && MONEY_MODES.includes(input.moneyMode)
            ? input.moneyMode
            : null,
        amountMin: Number.isInteger(input.amountMin)
          ? (input.amountMin as number)
          : null,
        amountMax: Number.isInteger(input.amountMax)
          ? (input.amountMax as number)
          : null,
        currency: 'AWCOIN',
        province: String(input.province ?? '').slice(0, 50),
        city: String(input.city ?? '').slice(0, 50),
        contactNote: String(input.contactNote ?? '').slice(0, 500),
        subcategoryId,
        status: 'LOCAL_PUBLISHED',
      },
    });
    const [view] = await this.views([row]);
    return view;
  }

  async feed(params: { type?: string; keyword?: string; take?: number }) {
    const where: Record<string, unknown> = {};
    if (params.type === 'DEMAND' || params.type === 'SERVICE')
      where.type = params.type;
    const take = Math.min(Math.max(Number(params.take) || 50, 1), 200);
    const rows = await this.prisma.listing.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
    });
    const views = await this.views(rows);
    const kw = String(params.keyword ?? '')
      .trim()
      .toLowerCase();
    if (!kw) return views;
    return views.filter(
      (v) =>
        v.title.toLowerCase().includes(kw) ||
        v.description.toLowerCase().includes(kw),
    );
  }

  async mine(userId: string) {
    const rows = await this.prisma.listing.findMany({
      where: { authorUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return this.views(rows);
  }

  async detail(id: number) {
    const row = await this.prisma.listing.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '供求帖不存在');
    const [view] = await this.views([row]);
    return view;
  }

  async remove(userId: string, id: number) {
    const row = await this.prisma.listing.findUnique({ where: { id } });
    if (!row || row.authorUserId !== userId)
      throw new BusinessException(ErrorCode.NOT_FOUND, '供求帖不存在');
    await this.prisma.listing.delete({ where: { id } });
    return { deleted: true };
  }

  // ---------- 同步发布到 AIworkin（需绑定 Key，由路由层 upstreamToken 门控） ----------
  private buildDraft(
    row: ListingRecord,
    input: UpstreamPublishInput,
  ): DemandDraft {
    if (!row.subcategoryId || !leafById(row.subcategoryId))
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先选择有效的二级类目再同步发布',
      );
    const direction = row.type === 'SERVICE' ? 'SUPPLY' : 'DEMAND';
    const draft: DemandDraft = {
      title: row.title,
      description: row.description,
      direction,
      subcategoryId: row.subcategoryId,
      moneyMode: (row.moneyMode as DemandDraft['moneyMode']) || 'NEGOTIABLE',
      currency: 'AWCOIN',
      publishAction: 'PUBLISH',
      tags: this.parseTags(row.tags),
    };
    if (row.amountMin != null) draft.amountMin = row.amountMin;
    if (row.amountMax != null) draft.amountMax = row.amountMax;
    if (direction === 'DEMAND') {
      // 平台需求发布态要求：未来截止时间 + 至少一种联系方式
      const deadline = String(input.deadline ?? '').trim();
      if (
        !deadline ||
        Number.isNaN(Date.parse(deadline)) ||
        Date.parse(deadline) <= Date.now()
      )
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '需求同步发布需填写晚于当前时间的截止时间',
        );
      const contactPhone = String(input.contactPhone ?? '').trim();
      const contactWechat = String(input.contactWechat ?? '').trim();
      const contactEmail = String(input.contactEmail ?? '').trim();
      if (!contactPhone && !contactWechat && !contactEmail)
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '需求同步发布需至少填写一种联系方式（电话/微信/邮箱）',
        );
      draft.deadline = deadline;
      if (input.contactName)
        draft.contactName = String(input.contactName).trim();
      if (contactPhone) draft.contactPhone = contactPhone;
      if (contactWechat) draft.contactWechat = contactWechat;
      if (contactEmail) draft.contactEmail = contactEmail;
      draft.a2aConfig = row.province
        ? {
            geoMatchMode: 'REGION',
            province: row.province,
            city: row.city || undefined,
          }
        : { geoMatchMode: 'NONE' };
    } else {
      // 平台服务发布态要求：报价说明 + 服务范围模式
      const priceDescription = String(input.priceDescription ?? '').trim();
      if (!priceDescription)
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '服务同步发布需填写报价说明',
        );
      const mode = String(
        input.serviceAreaMode ?? (row.province ? 'REGION' : 'NATIONWIDE'),
      ).toUpperCase() as NonNullable<DemandDraft['serviceArea']>['mode'];
      const area: NonNullable<DemandDraft['serviceArea']> = { mode };
      if (mode === 'REGION') {
        area.province = row.province || undefined;
        area.city = row.city || undefined;
      }
      draft.priceDescription = priceDescription;
      draft.serviceArea = area;
    }
    return draft;
  }

  async publishUpstream(
    userId: string,
    token: string,
    id: number,
    input: UpstreamPublishInput,
  ) {
    const row = await this.prisma.listing.findUnique({ where: { id } });
    if (!row || row.authorUserId !== userId)
      throw new BusinessException(ErrorCode.NOT_FOUND, '供求帖不存在');
    const draft = this.buildDraft(row, input);
    await this.prisma.listing.update({
      where: { id },
      data: { status: 'UPSTREAM_SYNCING' },
    });
    try {
      const result = await this.demands.publish(token, draft);
      const listingNo = result?.listing?.id ? String(result.listing.id) : '';
      const updated = await this.prisma.listing.update({
        where: { id },
        data: {
          status: 'UPSTREAM_LIVE',
          publishedUpstream: true,
          aiworkinListingNo: listingNo,
          aiworkinDemandNo: draft.direction === 'DEMAND' ? listingNo : '',
        },
      });
      const [view] = await this.views([updated]);
      return view;
    } catch (error) {
      await this.prisma.listing.update({
        where: { id },
        data: { status: 'SYNC_FAILED' },
      });
      throw error;
    }
  }

  async refreshStatus(userId: string, id: number, token: string) {
    const row = await this.prisma.listing.findUnique({ where: { id } });
    if (!row || row.authorUserId !== userId)
      throw new BusinessException(ErrorCode.NOT_FOUND, '供求帖不存在');
    if (!row.publishedUpstream || !row.aiworkinListingNo)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该供求帖尚未同步到上游',
      );
    let upstreamStatus = '';
    try {
      const listing = await this.demands.getMine(token, row.aiworkinListingNo);
      upstreamStatus = String(listing?.status || '');
    } catch (error) {
      if (
        error instanceof BusinessException &&
        error.errorCode === ErrorCode.NOT_FOUND
      ) {
        await this.prisma.listing.update({
          where: { id },
          data: { status: 'UPSTREAM_REJECTED' },
        });
        const rejected = await this.prisma.listing.findUnique({
          where: { id },
        });
        const [view] = await this.views([rejected!]);
        return view;
      }
      throw error;
    }
    // 上游挂单仍在（未下架/未拒），据其状态回写：仅撤回/删除类状态改本地态，其余保持 LIVE。
    const closed = [
      'RECALLED',
      'REMOVED',
      'DELETED',
      'EXPIRED',
      'CLOSED',
    ].includes(upstreamStatus);
    const status = closed ? 'UPSTREAM_REJECTED' : 'UPSTREAM_LIVE';
    await this.prisma.listing.update({ where: { id }, data: { status } });
    const refreshed = await this.prisma.listing.findUnique({ where: { id } });
    const [view] = await this.views([refreshed!]);
    return { ...view, upstreamStatus };
  }

  /** 供路由层生成错误提示：类型中文名。 */
  static typeLabel(type: string) {
    return TYPE_LABELS[type] || type;
  }
}
