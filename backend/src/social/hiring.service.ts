import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { DemandService } from '../aiworkin/demand.service';
import { DemandDraft } from '../aiworkin/aiworkin.types';
import {
  categoryLabels,
  defaultSubCategoryId,
  requireSubCategoryId,
} from '../aiworkin/category-catalog';

/**
 * 招聘专区本地服务（商务人脉 → 招聘，移植 SNS 的 HiringPost）：
 * - 本地发布免 Key：任何注册用户都能发岗位，进招聘广场信息流，可被浏览 / 站内私信对接；
 * - 同步上游需绑定 Key：岗位本质是「用工需求」，与供求广场共用 DemandService/AiworkinClient
 *   通道，方向固定 DEMAND，二级类目取本系统灵工板块镜像的「灵活用工」——平台没有招聘专属
 *   一级类目，用工需求本就挂在该子树（同 `flex.service.ts` 的 buildWorkOrderDraft 口径）。
 * userId 与 Account.id 同为字符串数字（见 social.service）。
 */
const SALARY_MODES = ['FIXED', 'STARTING', 'RANGE', 'NEGOTIABLE'];
/** 招聘类型（沿用 SNS 招聘专区取值，默认全职）；同时作为上游 attributes 的中文标签。 */
const TYPE_LABELS: Record<string, string> = {
  FULL_TIME: '全职',
  PART_TIME: '兼职',
  INTERNSHIP: '实习',
  TEMPORARY: '临时 / 日结',
  DISPATCH: '劳务派遣',
};
/** 招聘需求在上游的归属类目：与灵工板块同一子树，发帖人不选、同步时固定注入。 */
const SYNC_DOMAIN = 'FLEX';
/** 行记录类型：视图与草稿构造共用，免得按 any 取列丢类型。 */
type HiringRecord = Prisma.HiringPostGetPayload<null>;

interface HiringCreateInput {
  type?: string;
  title?: string;
  description?: string;
  headCount?: number;
  salaryMode?: string;
  salaryMin?: number;
  salaryMax?: number;
  tags?: unknown;
  province?: string;
  city?: string;
  contactNote?: string;
  deadline?: string;
}

interface UpstreamPublishInput {
  deadline?: string;
  contactName?: string;
  contactPhone?: string;
  contactWechat?: string;
  contactEmail?: string;
}

export class HiringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly demands: DemandService,
  ) {}

  // ---------- 字典 ----------
  /** 招聘类型字典（发布弹层选择器）。 */
  types() {
    return Object.entries(TYPE_LABELS).map(([value, label]) => ({
      value,
      label,
    }));
  }
  /** 上游归属类目（只读展示：招聘固定发往该二级类目，不提供选择器）。 */
  syncCategory() {
    const subcategoryId = defaultSubCategoryId(SYNC_DOMAIN);
    return { subcategoryId, ...categoryLabels(subcategoryId) };
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
      map[String(a.id)] = {
        userId: String(a.id),
        username: a.username,
        displayName: a.username,
        avatar: a.avatar || '',
      };
    }
    return map;
  }
  private async views(rows: HiringRecord[]) {
    const persons = await this.persons(rows.map((r) => r.userId));
    return rows.map((r) => ({
      id: r.id,
      author: persons[r.userId] || {
        userId: r.userId,
        username: '已注销',
        displayName: '已注销',
        avatar: '',
      },
      type: r.type,
      typeLabel: TYPE_LABELS[r.type] || r.type,
      title: r.title,
      description: r.description,
      headCount: r.headCount,
      salaryMode: r.salaryMode,
      salaryMin: r.salaryMin,
      salaryMax: r.salaryMax,
      currency: r.currency,
      tags: this.parseTags(r.tags),
      province: r.province,
      city: r.city,
      contactNote: r.contactNote,
      deadline: r.deadline,
      status: r.status,
      publishedUpstream: !!r.publishedUpstream,
      aiworkinListingNo: r.aiworkinListingNo || '',
      subcategoryId: r.subcategoryId,
      category1: categoryLabels(r.subcategoryId)?.category1 || '',
      category2: categoryLabels(r.subcategoryId)?.category2 || '',
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  // ---------- 本地发布（免 Key） ----------
  async create(userId: string, input: HiringCreateInput) {
    const type = TYPE_LABELS[String(input.type ?? '')]
      ? String(input.type)
      : '';
    if (!type)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '招聘类型不合法');
    const title = String(input.title ?? '').trim();
    if (!title || title.length > 100)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '岗位名称需 1-100 字');
    const description = String(input.description ?? '').trim();
    if (!description)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写职位描述与任职要求',
      );
    const headCount = Number.isInteger(input.headCount)
      ? (input.headCount as number)
      : 1;
    if (headCount < 1 || headCount > 9999)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '招聘人数需为 1-9999');
    if (
      input.salaryMin != null &&
      input.salaryMax != null &&
      input.salaryMin > input.salaryMax
    )
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '薪资下限不可大于上限',
      );
    const tags = Array.isArray(input.tags)
      ? input.tags
          .map((t) => String(t).trim())
          .filter(Boolean)
          .slice(0, 10)
      : [];
    const row = await this.prisma.hiringPost.create({
      data: {
        userId,
        type,
        title,
        description,
        headCount,
        salaryMode:
          input.salaryMode && SALARY_MODES.includes(input.salaryMode)
            ? input.salaryMode
            : null,
        salaryMin: Number.isInteger(input.salaryMin)
          ? (input.salaryMin as number)
          : null,
        salaryMax: Number.isInteger(input.salaryMax)
          ? (input.salaryMax as number)
          : null,
        currency: 'AWCOIN',
        tags: tags,
        province: String(input.province ?? '').slice(0, 50),
        city: String(input.city ?? '').slice(0, 50),
        contactNote: String(input.contactNote ?? '').slice(0, 500),
        deadline: String(input.deadline ?? '').slice(0, 64),
        // 上游归属类目在发帖时就落好：同步时只补联系方式与截止时间，不再让发帖人猜类目
        subcategoryId: defaultSubCategoryId(SYNC_DOMAIN),
        status: 'LOCAL_PUBLISHED',
      },
    });
    const [view] = await this.views([row]);
    return view;
  }

  async feed(params: { type?: string; keyword?: string; take?: number }) {
    const where: Prisma.HiringPostWhereInput = {};
    if (TYPE_LABELS[String(params.type ?? '')]) where.type = params.type;
    const take = Math.min(Math.max(Number(params.take) || 50, 1), 200);
    const rows = await this.prisma.hiringPost.findMany({
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
    const rows = await this.prisma.hiringPost.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return this.views(rows);
  }

  async detail(id: number) {
    const row = await this.prisma.hiringPost.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '招聘帖不存在');
    const [view] = await this.views([row]);
    return view;
  }

  async remove(userId: string, id: number) {
    const row = await this.prisma.hiringPost.findUnique({ where: { id } });
    if (!row || row.userId !== userId)
      throw new BusinessException(ErrorCode.NOT_FOUND, '招聘帖不存在');
    await this.prisma.hiringPost.delete({ where: { id } });
    return { deleted: true };
  }

  // ---------- 同步发布到 AIworkin（需绑定 Key，由路由层 upstreamToken 门控） ----------
  private buildDraft(
    row: HiringRecord,
    input: UpstreamPublishInput,
  ): DemandDraft {
    // 计价方式入库前已按 SALARY_MODES 拦过，这里只为把 string 收窄回平台的 MoneyMode
    const moneyMode = SALARY_MODES.includes(String(row.salaryMode))
      ? (row.salaryMode as DemandDraft['moneyMode'])
      : undefined;
    // 类目取发帖时落库的「灵活用工」，缺省再兜一次模块默认值，保证 ID 必在平台类目树内
    const subcategoryId = requireSubCategoryId(
      SYNC_DOMAIN,
      String(row.subcategoryId || '') || defaultSubCategoryId(SYNC_DOMAIN),
    );
    // 报名截止：优先取本次同步填写，其次取发帖时填的 deadline（招聘帖的常态字段）
    const deadline =
      String(input.deadline ?? '').trim() || String(row.deadline ?? '').trim();
    if (!deadline || Number.isNaN(Date.parse(deadline)))
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '招聘同步发布需填写截止时间（如 2026-12-31）',
      );
    if (Date.parse(deadline) <= Date.now())
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '招聘同步发布的截止时间需晚于当前时间',
      );
    const contactPhone = String(input.contactPhone ?? '').trim();
    const contactWechat = String(input.contactWechat ?? '').trim();
    const contactEmail = String(input.contactEmail ?? '').trim();
    if (!contactPhone && !contactWechat && !contactEmail)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '招聘同步发布需至少填写一种联系方式（电话 / 微信 / 邮箱）',
      );
    const draft: DemandDraft = {
      title: row.title,
      description: row.description,
      direction: 'DEMAND',
      subcategoryId,
      moneyMode: moneyMode || 'NEGOTIABLE',
      currency: 'AWCOIN',
      publishAction: 'PUBLISH',
      tags: this.parseTags(row.tags),
      deadline,
      contactName: String(input.contactName ?? '').trim() || undefined,
      contactPhone: contactPhone || undefined,
      contactWechat: contactWechat || undefined,
      contactEmail: contactEmail || undefined,
      // 工作地点：有省份按地区匹配，没有则不限（与供求广场需求同口径）
      a2aConfig: row.province
        ? {
            geoMatchMode: 'REGION',
            province: row.province,
            city: row.city || undefined,
          }
        : { geoMatchMode: 'NONE' },
      attributes: {
        category: '招聘用工',
        hiringType: TYPE_LABELS[row.type] || row.type,
        headCount: String(row.headCount),
        salaryNote: row.contactNote || undefined,
      },
    };
    if (row.salaryMin != null) draft.amountMin = row.salaryMin;
    if (row.salaryMax != null) draft.amountMax = row.salaryMax;
    return draft;
  }

  async publishUpstream(
    userId: string,
    token: string,
    id: number,
    input: UpstreamPublishInput,
  ) {
    const row = await this.prisma.hiringPost.findUnique({ where: { id } });
    if (!row || row.userId !== userId)
      throw new BusinessException(ErrorCode.NOT_FOUND, '招聘帖不存在');
    const draft = this.buildDraft(row, input);
    await this.prisma.hiringPost.update({
      where: { id },
      data: { status: 'UPSTREAM_SYNCING' },
    });
    try {
      const result = await this.demands.publish(token, draft);
      const listingNo = result?.listing?.id ? String(result.listing.id) : '';
      const updated = await this.prisma.hiringPost.update({
        where: { id },
        data: {
          status: 'UPSTREAM_LIVE',
          publishedUpstream: true,
          aiworkinListingNo: listingNo,
          aiworkinDemandNo: listingNo,
          // 发帖时没填截止时间时，把本次同步用的截止时间回写，卡片上能显示报名截止
          deadline: String(input.deadline ?? '').trim() || row.deadline,
        },
      });
      const [view] = await this.views([updated]);
      return view;
    } catch (error) {
      await this.prisma.hiringPost.update({
        where: { id },
        data: { status: 'SYNC_FAILED' },
      });
      throw error;
    }
  }

  async refreshStatus(userId: string, id: number, token: string) {
    const row = await this.prisma.hiringPost.findUnique({ where: { id } });
    if (!row || row.userId !== userId)
      throw new BusinessException(ErrorCode.NOT_FOUND, '招聘帖不存在');
    if (!row.publishedUpstream || !row.aiworkinListingNo)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该招聘帖尚未同步到上游',
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
        await this.prisma.hiringPost.update({
          where: { id },
          data: { status: 'UPSTREAM_REJECTED' },
        });
        const rejected = await this.prisma.hiringPost.findUnique({
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
    await this.prisma.hiringPost.update({ where: { id }, data: { status } });
    const refreshed = await this.prisma.hiringPost.findUnique({
      where: { id },
    });
    const [view] = await this.views([refreshed!]);
    return { ...view, upstreamStatus };
  }
}
