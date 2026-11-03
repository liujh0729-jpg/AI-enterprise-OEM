import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma';
import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import {
  BUSINESS_IDENTITIES,
  CATEGORY_LABELS,
  FLEX_PAYROLL_ENABLED_KEY,
  IDENTITY_PRIORITY,
  STAFF_CATEGORIES,
  SUBITEM_CATEGORY_LABELS,
  SUBITEM_OWNERS,
  bearingRowsOf,
  contractTypesOfBearingRow,
  hasSubItems,
  isServiceType,
  nowStamp,
  staffCategoryCovers,
  subItemsOf,
} from '../common/constants';
import { text } from '../common/api';
import { ErrorCode } from '../common/error-code';
import { requestMemo } from '../common/request-context';
import {
  readIdentitySnapshot,
  type IdentitySnapshot,
} from './identity-snapshot';
import { UserLookupService } from '../directory/user-lookup.service';
import { OssService } from '../oss/oss.service';
import { parseAttachmentFiles } from '../oss/attachment-files';
import { PrismaService } from '../prisma/prisma.service';
import { ContactSide, contactSideOf } from '../shared/contacts';
import { requireLocation, resolveLocation } from '../shared/locations';
export type Attachment = {
  id: string;
  name: string;
  size: number;
  url: string;
  uploaded_at: string;
};
export type BusinessStaff = {
  name: string;
  title: string;
  phone: string;
  email: string;
};
/**
 * 用户主体类型（用户身份下三分）：企业 / 个体工商户 / 个人。
 * 认证材料随主体类型改变 —— 企业＝名称 + 统一社会信用代码；个体工商户＝字号名称 + 统一社会信用代码 + 经营者；
 * 个人＝姓名 + 身份证号（无统一社会信用代码；整页可浏览，但**财税与出海的签约 / 申报 / 账套 / 发布需求四类办理动作**需企业或个体工商户主体）。
 */
export const USER_SUBJECT_TYPES = [
  'COMPANY',
  'INDIVIDUAL',
  'PERSONAL',
] as const;
export const USER_SUBJECT_LABELS: Record<string, string> = {
  COMPANY: '企业',
  INDIVIDUAL: '个体工商户',
  PERSONAL: '个人',
};
/** 主体类型归一：非法值返回空串，由调用方决定是否回落到默认 COMPANY。 */
export function normalizeSubjectType(value: unknown) {
  const type = text(value ?? '')
    .trim()
    .toUpperCase();
  return (USER_SUBJECT_TYPES as readonly string[]).includes(type) ? type : '';
}
/** 是否个人主体（财税与出海四类办理动作限企业与个体工商户，浏览与申请加入不受限）。 */
export function isPersonalSubject(subjectType?: string | null) {
  return (
    String(subjectType || '')
      .trim()
      .toUpperCase() === 'PERSONAL'
  );
}
/** 个人主体的身份证号（18 位，末位可为 X）。 */
export function isIdCard(value: unknown) {
  return /^\d{17}[\dX]$/.test(
    text(value ?? '')
      .trim()
      .toUpperCase(),
  );
}
const STAFF_ROLE_BY_TYPE: Record<
  string,
  {
    role: string;
    category: string;
  }
> = {
  TAX_FINANCE: { role: '财税专员', category: '财税服务' },
  LEGAL_SERVICE: { role: '法律顾问', category: '法律服务' },
  IP_SERVICE: { role: '知识产权专员', category: '知识产权服务' },
  THINK_TANK_SERVICE: { role: '智库顾问', category: '智库服务' },
  FLEX_WORK: { role: '灵活用工专员', category: '灵活用工服务' },
  SUPPLY_NETWORK: { role: '供销专员', category: '供销服务' },
};
/**
 * 细项 → 职员角色（出海 6 项 / 营销 6 项 / 物流 3 项 / 资产交易 5 项 / IT服务 5 项）。`group` 是角色所属的业务板块，
 * 用于「可添加的职员角色」列表分组显示；挂靠与指派都按细项粒度。
 */
const SUBITEM_STAFF_ROLE: Record<
  string,
  {
    role: string;
    label: string;
    group: string;
  }
> = {
  EXPORT_REFUND: { role: '出口退税专员', label: '出口退税', group: '跨境出海' },
  COMPANY_REG: {
    role: '海外公司注册专员',
    label: '海外公司注册',
    group: '跨境出海',
  },
  SETTLEMENT: { role: '跨境结算专员', label: '跨境结算', group: '跨境出海' },
  TAX_COMPLIANCE: {
    role: '海外税务合规专员',
    label: '海外税务合规',
    group: '跨境出海',
  },
  QUALIFICATION: {
    role: '出口资质备案专员',
    label: '出口资质备案',
    group: '跨境出海',
  },
  BANK_ACCOUNT: {
    role: '海外银行开户专员',
    label: '海外银行开户',
    group: '跨境出海',
  },
  INFLUENCER_VISIT: {
    role: '达人探店专员',
    label: '达人探店',
    group: '营销服务',
  },
  LIVE_SELLING: {
    role: '直播带货专员',
    label: '直播带货',
    group: '营销服务',
  },
  CONTENT_MARKETING: {
    role: '内容营销专员',
    label: '内容营销',
    group: '营销服务',
  },
  GEO_OPTIMIZATION: {
    role: 'GEO优化专员',
    label: 'GEO优化',
    group: '营销服务',
  },
  PRECISION_MARKETING: {
    role: '精准营销专员',
    label: '精准营销',
    group: '营销服务',
  },
  PRIVATE_DOMAIN: {
    role: '私域营销专员',
    label: '私域营销',
    group: '营销服务',
  },
  DOMESTIC_LAND: {
    role: '境内陆运专员',
    label: '境内陆运',
    group: '物流服务',
  },
  CROSS_BORDER_FORWARDER: {
    role: '跨境货代专员',
    label: '跨境货代',
    group: '物流服务',
  },
  WAREHOUSING: {
    role: '仓储专员',
    label: '仓储',
    group: '物流服务',
  },
  REAL_ESTATE: {
    role: '房产交易专员',
    label: '房产销售/租赁',
    group: '资产交易',
  },
  INSURANCE: { role: '保险专员', label: '保险', group: '资产交易' },
  INVESTMENT: {
    role: '投资理财专员',
    label: '投资理财',
    group: '资产交易',
  },
  NON_PERFORMING_ASSET: {
    role: '不良资产专员',
    label: '不良资产',
    group: '资产交易',
  },
  AUTO_TRADE: { role: '汽车交易专员', label: '汽车交易', group: '资产交易' },
  AI_DEPLOY: { role: 'AI实施专员', label: 'AI实施', group: 'IT服务' },
  SOFTWARE_DEV: { role: '软件开发专员', label: '软件开发', group: 'IT服务' },
  COMPUTE: { role: '算力服务专员', label: '算力服务', group: 'IT服务' },
  HARDWARE: { role: '硬件服务专员', label: '硬件服务', group: 'IT服务' },
  DATA_SERVICE: {
    role: '数据服务专员',
    label: '数据服务',
    group: 'IT服务',
  },
};
/**
 * 可申请加入的类目：出海 / 营销 / 物流 / 资产交易 / IT服务按 **细项** 申请，
 * 其余板块按板块本身申请。一个职员/代理人可同时加入多家机构，
 * 同一家机构的同一类目只留一条有效申请（不再跨机构占用类目）。
 */
const AFFILIATION_CATEGORIES: string[] = [
  ...new Set([...STAFF_CATEGORIES, ...Object.keys(SUBITEM_STAFF_ROLE)]),
];
/**
 * 职员申报的分类 → 可申请加入的分类清单：带细项的板块（出海/营销/物流/资产/IT服务）
 * 展开为该板块全部细项，其余板块即自身；已申报到细项的原样保留。
 */
function applyCodesOf(declared: readonly string[]): string[] {
  const out = new Set<string>();
  for (const item of declared) {
    if (!AFFILIATION_CATEGORIES.includes(item)) continue;
    const items = hasSubItems(item) ? subItemsOf(item) : [];
    if (items.length) for (const code of items) out.add(code);
    else out.add(item);
  }
  return [...out];
}
/** 可申请分类的界面名：细项带所属板块（物流服务 · 仓储），板块用整块业务名。 */
function joinCodeLabel(code: string) {
  const item = CATEGORY_LABELS[code] || code;
  const board = SUBITEM_OWNERS[code]
    ?.map((owner) => SUBITEM_CATEGORY_LABELS[owner])
    .find(Boolean);
  return board && board !== item ? `${board} · ${item}` : item;
}
/** 可申请加入的机构卡片（含本人对该机构的申请／绑定状态）。 */
type JoinableProvider = {
  providerUserId: string;
  orgName: string;
  nickname: string;
  qualification: string;
  province: string;
  city: string;
  intro: string;
  serviceItems: string[];
  /** 本人对该分类在该机构的最新申请状态：PENDING／APPROVED／REJECTED／CANCELLED／''。 */
  applicationStatus: string;
  applicationId: number;
  /** 已是该机构在册职员（绑定生效）。 */
  bound: boolean;
};
/** 可申请加入的分类分区。 */
type JoinableSection = {
  code: string;
  label: string;
  providerCount: number;
  providers: JoinableProvider[];
};
/** 类目编码 → 角色名（与服务商「添加职员」时勾选的角色一致）。 */
function roleLabelOf(code: string) {
  return (
    STAFF_ROLE_BY_TYPE[code]?.role ||
    SUBITEM_STAFF_ROLE[code]?.role ||
    CATEGORY_LABELS[code] ||
    code
  );
}
function dedupeItems(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : text(raw ?? '')
        .split(',')
        .map((item) => item.trim());
  return [
    ...new Set(list.map((item) => String(item || '').trim()).filter(Boolean)),
  ];
}
/**
 * 备案细项入参：`{ LOGISTICS: [...], MARKETING: [...] }`（同时勾多个带细项类目时用），
 * 也兼容旧的扁平数组/逗号串——按各类目的合法细项集合分发（跨类目的项自然落到空集并被拒绝）。
 */
function subItemSelection(
  raw: unknown,
  bearingTypes: string[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (raw && !Array.isArray(raw) && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      out[key.trim()] = dedupeItems(value);
    }
    return out;
  }
  const flat = dedupeItems(raw);
  for (const type of bearingTypes) {
    const allowed = subItemsOf(type);
    out[type] = flat.filter((item) => allowed.includes(item));
  }
  return out;
}
/** 带细项的类目必须逐项选到合法细项（一项都不选＝不合法）。 */
function assertSubItems(
  perCategory: Record<string, string[]>,
  bearingTypes: string[],
) {
  for (const type of bearingTypes) {
    const allowed = subItemsOf(type);
    const selected = perCategory[type] || [];
    const bad = selected.filter((item) => !allowed.includes(item));
    if (bad.length || !selected.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `请选择合法的${SUBITEM_CATEGORY_LABELS[type] || type}细项`,
      );
    }
  }
}
/** `qualifications()` 的结果：一次身份判定的全部依据。 */
export type Qualifications = Awaited<
  ReturnType<IdentityService['loadQualifications']>
>;
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserLookupService,
    private readonly oss: OssService,
  ) {}
  /**
   * 身份判定：一次请求内同一 userId 只查一轮库（`requireRoles` + `currentIdentity` +
   * `providerContext` 这类组合会重复调用）。缓存只在请求上下文内存活，
   * 且任何写入身份表的操作都会作废它，因此刚提交/刚审核完的判定不会读到旧值。
   * 不在请求上下文内（定时任务、脚本）时不缓存，每次直接查库。
   */
  qualifications(userId: string): Promise<Qualifications> {
    return requestMemo(`qualifications:${userId}`, () =>
      this.loadQualifications(userId),
    );
  }
  async loadQualifications(userId: string) {
    return this.qualificationsFrom(
      await readIdentitySnapshot(this.prisma, userId),
    );
  }
  private qualificationsFrom({
    enterprise,
    providerApps,
    staffProfile,
    staffOf,
    pref,
  }: Pick<
    IdentitySnapshot,
    'enterprise' | 'providerApps' | 'staffProfile' | 'staffOf' | 'pref'
  >) {
    const roles: string[] = [];
    if (enterprise) roles.push('ENTERPRISE_USER');
    if (providerApps.some((item) => item.status === 'APPROVED')) {
      roles.push('SERVICE_PROVIDER');
    }
    if (staffOf.length) roles.push('PROVIDER_STAFF');
    // 身份偏好仅在「仍持有该身份」时生效：备案被撤销/解绑后不再回落到失效身份。
    // 未选偏好时按 IDENTITY_PRIORITY 取默认身份（服务商 > 职员 > 用户）。
    const preferred = pref?.currentIdentity || '';
    const currentIdentity =
      preferred && roles.includes(preferred)
        ? preferred
        : IDENTITY_PRIORITY.find((item) => roles.includes(item)) ||
          'ENTERPRISE_USER';
    return {
      roles,
      enterprise,
      providerApps,
      staffProfile,
      staffOf,
      currentIdentity,
      preferredIdentity: preferred,
    };
  }
  async requireRoles(user: CurrentUser, ...needed: string[]) {
    const q = await this.qualifications(user.userId);
    const roles = this.effectiveRoles(user, q.roles);
    if (!needed.some((role) => roles.includes(role))) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        `需要身份 ${needed.join('/')}`,
      );
    }
    return { ...q, roles };
  }
  /**
   * 主体类型办理门控：**个人用户（主体类型＝个人）不能办理财税与出海业务**（签约 / 申报 / 账套 / 发布需求）。
   * 仅当以「用户」身份访问时生效 —— 服务商 / 职员 / 平台管理员身份照常可用。
   */
  async requireSubjectService(user: CurrentUser, serviceLabel: string) {
    if (this.isPlatformAdmin(user)) return;
    if ((await this.currentIdentity(user)) !== 'ENTERPRISE_USER') return;
    const enterprise = await this.getEnterprise(user.userId);
    if (!enterprise || !isPersonalSubject(enterprise.subjectType)) return;
    throw new BusinessException(
      ErrorCode.ROLE_MISMATCH,
      `${serviceLabel}不面向个人用户开放：请以「企业」或「个体工商户」主体办理`,
    );
  }
  effectiveRoles(user: CurrentUser, businessRoles: string[]) {
    if (this.isPlatformAdmin(user)) {
      return [...BUSINESS_IDENTITIES, 'PLATFORM_ADMIN'];
    }
    return [...businessRoles];
  }
  private resolveCurrentIdentity(user: CurrentUser, q: Qualifications) {
    const allowed = this.effectiveRoles(user, q.roles);
    if (allowed.includes(q.preferredIdentity)) return q.preferredIdentity;
    return this.isPlatformAdmin(user) ? 'PLATFORM_ADMIN' : q.currentIdentity;
  }
  /** 非抛错版身份判定：用于「可选动作」（如公开需求池回复即接单）。 */
  async hasRole(user: CurrentUser, role: string) {
    const q = await this.qualifications(user.userId);
    return this.effectiveRoles(user, q.roles).includes(role);
  }
  isPlatformAdmin(user: CurrentUser) {
    const extra = (process.env.ADMIN_USER_IDS || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return user.isAdmin() || extra.includes(user.userId);
  }
  requireAdmin(user: CurrentUser) {
    if (!this.isPlatformAdmin(user)) {
      throw new BusinessException(ErrorCode.ROLE_MISMATCH, '需要平台管理员');
    }
  }
  /**
   * 改联系方式时操作方**自己的那一侧**（用户口径：企业只能改企业自己的，
   * 服务商只能改服务商自己的，职员只能改职员自己的）：
   * - 平台管理员：两侧都可改（不受限）；
   * - 企业当事人（本单据企业档案的归属用户 / 本人发起）：企业侧；
   * - 承办职员与服务商账号：执行侧。
   */
  async contactSide(
    user: CurrentUser,
    row: {
      enterpriseId?: number | null;
      createdBy?: string | null;
    },
  ): Promise<ContactSide> {
    const isAdmin = this.isPlatformAdmin(user);
    let isEnterpriseParty = Boolean(
      row.createdBy && row.createdBy === user.userId,
    );
    const enterpriseId = Number(row.enterpriseId || 0);
    if (!isEnterpriseParty && enterpriseId) {
      const profile = await this.prisma.enterpriseProfile.findUnique({
        where: { id: enterpriseId },
      });
      isEnterpriseParty = profile?.userId === user.userId;
    }
    return contactSideOf({ isAdmin, isEnterpriseParty });
  }
  async me(user: CurrentUser) {
    const [directory, snapshot] = await Promise.all([
      this.users.requireActiveUser(user.userId),
      readIdentitySnapshot(this.prisma, user.userId),
    ]);
    const q = this.qualificationsFrom(snapshot);
    const roles = this.effectiveRoles(user, q.roles);
    return {
      userId: user.userId,
      username: directory.username,
      displayName: directory.displayName,
      email: directory.email,
      avatarUrl: directory.avatarUrl,
      javaRole: user.role,
      roles,
      // 管理员可切换全部业务身份；未选择时默认平台管理员。
      currentIdentity: this.resolveCurrentIdentity(user, q),
      // 普通账号只返回已取得的身份；管理员包含全部业务身份。
      identities: [
        ...BUSINESS_IDENTITIES.filter((item) => roles.includes(item)),
        ...(this.isPlatformAdmin(user) ? (['PLATFORM_ADMIN'] as const) : []),
      ],
      enterprise: q.enterprise,
      providerApps: q.providerApps.map(decorateProviderApp),
      staffProfile: q.staffProfile
        ? {
            ...q.staffProfile,
            categories: asStringArray(q.staffProfile.categories),
          }
        : null,
      staffOf: q.staffOf,
      /** 服务商类型：仅 MICRO＝小微服务商（本人即唯一职员）；含非 MICRO＝服务商（需指派职员）。 */
      providerKind: deriveProviderKind(q.providerApps),
      qualified: {
        ENTERPRISE_USER: q.roles.includes('ENTERPRISE_USER'),
        SERVICE_PROVIDER: q.roles.includes('SERVICE_PROVIDER'),
        PROVIDER_STAFF: q.roles.includes('PROVIDER_STAFF'),
      },
      // 平台级板块开关（由平台管理员在管理后台控制，前端据此决定栏目是否出现）
      platformFlags: {
        flexPayrollEnabled: snapshot.flexPayrollEnabled,
      },
    };
  }
  async switchIdentity(user: CurrentUser, identity: string) {
    const q = await this.qualifications(user.userId);
    const allowed = this.effectiveRoles(user, q.roles);
    if (!allowed.includes(identity)) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        `未持有身份 ${identity}，不可切换`,
      );
    }
    await this.prisma.identityPreference.upsert({
      where: { userId: user.userId },
      create: { userId: user.userId, currentIdentity: identity },
      update: { currentIdentity: identity },
    });
    return { currentIdentity: identity, identities: allowed };
  }
  async getEnterprise(userId: string) {
    return this.prisma.enterpriseProfile.findFirst({
      where: { userId },
      orderBy: { id: 'desc' },
    });
  }
  async submitEnterprise(
    user: CurrentUser,
    body: {
      name?: string;
      uscc?: string;
      subject_type?: string;
      id_card?: string;
      taxpayer_type?: string;
      industry?: string;
      legal_person?: string;
      phone?: string;
      address?: string;
      province?: string;
      city?: string;
      qxy_org_id?: string;
    },
  ) {
    const subjectType = normalizeSubjectType(body.subject_type) || 'COMPANY';
    const personal = isPersonalSubject(subjectType);
    const name = text(body.name).trim();
    const uscc = text(body.uscc).trim().toUpperCase();
    const idCard = text(body.id_card).trim().toUpperCase();
    const { province, city } = requireLocation(body);
    if (personal) {
      if (!name || !isIdCard(idCard)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '个人用户需填写姓名与 18 位身份证号',
        );
      }
    } else if (!name || !uscc) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `${subjectType === 'INDIVIDUAL' ? '个体工商户名称（字号）' : '企业名称'}与统一社会信用代码必填`,
      );
    }
    const exists = await this.prisma.enterpriseProfile.findFirst({
      where: { userId: user.userId },
      orderBy: { id: 'desc' },
    });
    if (exists?.status === 'APPROVED') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '企业档案已同步，无需重复提交',
      );
    }
    const row = await this.prisma.enterpriseProfile.create({
      data: {
        userId: user.userId,
        name,
        uscc: personal ? '' : uscc,
        subjectType,
        idCard: personal ? idCard : '',
        // 个人主体不适用纳税人性质（不开放财税服务），留空
        taxpayerType: personal ? '' : body.taxpayer_type || 'GENERAL',
        industry: body.industry || '',
        legalPerson: body.legal_person || '',
        phone: body.phone || '',
        address: body.address || '',
        province,
        city,
        qxyOrgId: text(body.qxy_org_id).trim(),
        status: 'APPROVED',
        auditNote: `提交即生效（主体类型：${USER_SUBJECT_LABELS[subjectType]}）`,
        auditedAt: new Date(),
      },
    });
    await this.audit(
      user.userId,
      '同步用户档案',
      `${USER_SUBJECT_LABELS[subjectType]}「${name}」`,
    );
    return { id: row.id, status: row.status };
  }
  /**
   * 用户档案修改：行业/法人/电话/地址可直接改；
   * 主体信息（主体类型、名称、统一社会信用代码、身份证号、纳税人性质）在**存在生效中签约**时锁定，
   * 因为签约主体与申报口径（一般纳税人/小规模）必须与档案一致。
   */
  async updateEnterprise(
    user: CurrentUser,
    body: {
      name?: string;
      uscc?: string;
      subject_type?: string;
      id_card?: string;
      taxpayer_type?: string;
      industry?: string;
      legal_person?: string;
      phone?: string;
      address?: string;
      province?: string;
      city?: string;
      qxy_org_id?: string;
    },
  ) {
    const row = await this.prisma.enterpriseProfile.findFirst({
      where: { userId: user.userId },
      orderBy: { id: 'desc' },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '尚未提交企业信息');
    }
    if (row.status !== 'APPROVED') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '企业档案当前未生效，请重新提交企业信息',
      );
    }
    const subjectType =
      body.subject_type === undefined
        ? row.subjectType
        : normalizeSubjectType(body.subject_type) || row.subjectType;
    const personal = isPersonalSubject(subjectType);
    const name = body.name === undefined ? row.name : text(body.name).trim();
    const uscc =
      body.uscc === undefined ? row.uscc : text(body.uscc).trim().toUpperCase();
    const idCard =
      body.id_card === undefined
        ? row.idCard
        : text(body.id_card).trim().toUpperCase();
    const taxpayerType =
      body.taxpayer_type === undefined
        ? row.taxpayerType
        : text(body.taxpayer_type).trim().toUpperCase();
    if (personal) {
      if (!name || !isIdCard(idCard)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '个人用户需填写姓名与 18 位身份证号',
        );
      }
    } else if (!name || !uscc) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `${subjectType === 'INDIVIDUAL' ? '个体工商户名称（字号）' : '企业名称'}与统一社会信用代码必填`,
      );
    }
    if (!personal && !['GENERAL', 'SMALL_SCALE'].includes(taxpayerType)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '纳税人性质仅支持 GENERAL / SMALL_SCALE',
      );
    }
    const subjectChanged =
      subjectType !== row.subjectType ||
      name !== row.name ||
      uscc !== row.uscc ||
      taxpayerType !== row.taxpayerType ||
      idCard !== row.idCard;
    const location = resolveLocation(body, row);
    if (subjectChanged && !this.isPlatformAdmin(user)) {
      const active = await this.prisma.contract.count({
        where: { enterpriseId: row.id, status: 'ACTIVE' },
      });
      if (active > 0) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '存在生效中签约，主体类型 / 名称 / 统一社会信用代码 / 身份证号 / 纳税人性质不可修改；如有变更请先解约或联系平台管理员',
        );
      }
    }
    const next = await this.prisma.enterpriseProfile.update({
      where: { id: row.id },
      data: {
        name,
        uscc: personal ? '' : uscc,
        subjectType,
        idCard: personal ? idCard : '',
        taxpayerType: personal ? '' : taxpayerType,
        industry:
          body.industry === undefined
            ? row.industry
            : text(body.industry).trim(),
        legalPerson:
          body.legal_person === undefined
            ? row.legalPerson
            : text(body.legal_person).trim(),
        phone: body.phone === undefined ? row.phone : text(body.phone).trim(),
        address:
          body.address === undefined ? row.address : text(body.address).trim(),
        province: location.province,
        city: location.city,
        qxyOrgId: personal
          ? ''
          : body.qxy_org_id === undefined
            ? row.qxyOrgId
            : text(body.qxy_org_id).trim(),
      },
    });
    await this.audit(
      user.userId,
      '修改用户档案',
      `${USER_SUBJECT_LABELS[subjectType]}「${next.name}」`,
    );
    return {
      id: next.id,
      name: next.name,
      uscc: next.uscc,
      subject_type: next.subjectType,
      taxpayer_type: next.taxpayerType,
      updated: true,
    };
  }
  /** 企业档案可删除的前置：无签约、无任何业务单据（保留签约与作业留痕）。 */
  async removeEnterprise(user: CurrentUser) {
    const row = await this.prisma.enterpriseProfile.findFirst({
      where: { userId: user.userId },
      orderBy: { id: 'desc' },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '尚未提交企业信息');
    }
    const enterpriseId = row.id;
    const contracts = await this.prisma.contract.count({
      where: { enterpriseId },
    });
    if (contracts > 0) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `该企业已有 ${contracts} 条签约记录，不可删除（保留签约留痕）`,
      );
    }
    const counts = await Promise.all([
      this.prisma.taxDeclaration.count({ where: { enterpriseId } }),
      this.prisma.taxMaterialPack.count({ where: { enterpriseId } }),
      this.prisma.accountSet.count({ where: { enterpriseId } }),
      this.prisma.logisticsOrder.count({ where: { enterpriseId } }),
      this.prisma.smartServiceOrder.count({ where: { enterpriseId } }),
      this.prisma.marketingOrder.count({ where: { enterpriseId } }),
      this.prisma.overseasClaim.count({ where: { enterpriseId } }),
      this.prisma.legalRequest.count({ where: { enterpriseId } }),
      this.prisma.ipRequest.count({ where: { enterpriseId } }),
      this.prisma.flexOnboarding.count({ where: { enterpriseId } }),
      this.prisma.flexWorkOrder.count({ where: { enterpriseId } }),
      this.prisma.flexPayroll.count({ where: { enterpriseId } }),
      this.prisma.consultation.count({ where: { enterpriseId } }),
    ]);
    const refs = counts.reduce((sum, item) => sum + item, 0);
    if (refs > 0) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `该企业已产生 ${refs} 条业务单据，不可删除（保留作业留痕）`,
      );
    }
    // 删除与留痕同事务：档案没了却查不到删除记录，就无法解释企业为何消失
    await this.prisma.$transaction(async (tx) => {
      await tx.enterpriseProfile.delete({ where: { id: enterpriseId } });
      await this.audit(user.userId, '删除企业档案', `企业「${row.name}」`, tx);
    });
    return { id: enterpriseId, removed: true };
  }
  async getProviderApplications(userId: string) {
    const list = await this.prisma.providerApplication.findMany({
      where: { userId },
      orderBy: { id: 'desc' },
    });
    if (!list.length) return null;
    const latestByType = new Map<string, (typeof list)[number]>();
    for (const item of [...list].reverse()) {
      latestByType.set(item.providerType, item);
    }
    return {
      ...decorateProviderApp(list[0]),
      items: [...latestByType.values()].map(decorateProviderApp),
    };
  }
  async submitProviderApplication(
    user: CurrentUser,
    body: Record<string, unknown>,
  ) {
    const raw = Array.isArray(body.provider_types)
      ? body.provider_types
      : [body.provider_type];
    const types = [
      ...new Set(raw.map((item) => String(item || '').trim()).filter(Boolean)),
    ];
    const orgName = text(body.org_name).trim();
    if (!types.length || !orgName) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '服务类型与机构名称必填',
      );
    }
    const isPersonal = body.subject_type === 'PERSONAL';
    const microOnly = types.every((item) => item === 'MICRO');
    if (isPersonal && !microOnly) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '个人主体仅适用于小微服务商（MICRO）备案',
      );
    }
    let uscc = text(body.uscc).trim();
    let idCard = '';
    if (isPersonal) {
      idCard = text(body.id_card).trim();
      if (!/^\d{17}[\dXx]$/.test(idCard)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '身份证号格式不正确',
        );
      }
      uscc = '';
    } else if (!uscc) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '统一社会信用代码必填',
      );
    }
    const contactName = text(body.contact_name).trim();
    const contactPhone = text(body.contact_phone).trim();
    const contactEmail = text(body.contact_email).trim();
    const intro = text(body.intro).trim();
    // 所在省、市：备案时必选，名录按省市筛选服务商（选项取平台省市字典）
    const { province, city } = requireLocation(body);
    if (!contactName || !contactPhone || !contactEmail || !intro) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '联系人、联系电话、联系邮箱与机构简介必填',
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '联系邮箱格式不正确');
    }
    const invalid = types.filter((item) => !isServiceType(item));
    if (invalid.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `服务类型不合法：${invalid.join('、')}`,
      );
    }
    // 带细项的类目（出海 / 营销 / 物流 / 小微 / 资产交易）同构：
    // 细项决定备案行的适用范围，逐项审核、按细项签约
    const bearingTypes = types.filter((type) => hasSubItems(type));
    const perCategory = subItemSelection(body.service_items, bearingTypes);
    assertSubItems(perCategory, bearingTypes);
    const files = normalizeAttachments(body.attachments);
    const staff = normalizeBusinessStaff(body.business_staff);
    const submitted: {
      id: number;
      type: string;
    }[] = [];
    const skipped: {
      type: string;
      reason: string;
    }[] = [];
    // 一次取回已有备案行，按类型保留「最新一条」的状态（原先每个类型一次 findFirst）
    const historyRows = await this.prisma.providerApplication.findMany({
      where: { userId: user.userId, providerType: { in: types } },
      orderBy: { id: 'asc' },
      select: { providerType: true, status: true },
    });
    const latestStatus = new Map<string, string>();
    for (const row of historyRows)
      latestStatus.set(row.providerType, row.status);
    for (const type of types) {
      const last = latestStatus.get(type);
      if (last && ['PENDING', 'APPROVED'].includes(last)) {
        skipped.push({
          type,
          reason: last === 'PENDING' ? '审核中' : '已开通',
        });
        continue;
      }
      const row = await this.prisma.providerApplication.create({
        data: {
          userId: user.userId,
          providerType: type,
          orgName,
          uscc,
          idCard,
          subjectType: isPersonal ? 'PERSONAL' : 'COMPANY',
          qualification: text(body.qualification),
          contactName,
          contactPhone,
          contactEmail,
          province,
          city,
          intro,
          serviceItems: hasSubItems(type)
            ? (perCategory[type] || []).join(',')
            : '',
          attachments: files,
          businessStaff: staff,
          status: 'PENDING',
        },
      });
      submitted.push({ id: row.id, type });
    }
    if (!submitted.length) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '所选服务类型均已提交过（审核中或已开通）',
      );
    }
    await this.audit(
      user.userId,
      '服务商备案申请',
      `申请 ${submitted
        .map((item) => CATEGORY_LABELS[item.type] || item.type)
        .join('、')}`,
    );
    return {
      id: submitted[0].id,
      ids: submitted.map((item) => item.id),
      status: 'PENDING',
      submitted: submitted.map((item) => item.type),
      skipped,
      attachments: files,
      business_staff: staff,
    };
  }
  /** 该类目下是否存在生效中签约（备案主体/类目变更的前置校验）。 */
  private async hasActiveContractForType(
    providerUserId: string,
    providerType: string,
  ) {
    return this.prisma.contract.count({
      where: {
        providerUserId,
        serviceType: { in: contractTypesOfBearingRow(providerType) },
        status: 'ACTIVE',
      },
    });
  }
  /**
   * 修改服务商备案：
   * - 联系方式 / 简介 / 附件 / 业务职员 → 直接生效；
   * - 主体信息（机构名称、统一社会信用代码 / 身份证、出海细项）→ **重置为待复审**
   *   （类目门控与签约资格依赖备案内容，变更须平台复审）；
   * - 该类目已有生效中签约时禁止变更主体信息，须先解约。
   */
  async updateProviderApplication(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown>,
  ) {
    const row = await this.prisma.providerApplication.findUnique({
      where: { id },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '备案记录不存在');
    }
    if (row.userId !== user.userId && !this.isPlatformAdmin(user)) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅备案人本人或平台管理员可修改备案',
      );
    }
    if (!['PENDING', 'APPROVED'].includes(row.status)) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '已驳回 / 已撤回的备案不可修改，请重新提交备案',
      );
    }
    const isPersonal = row.subjectType === 'PERSONAL';
    const orgName =
      body.org_name === undefined ? row.orgName : text(body.org_name).trim();
    const uscc = body.uscc === undefined ? row.uscc : text(body.uscc).trim();
    const idCard =
      body.id_card === undefined ? row.idCard : text(body.id_card).trim();
    if (!orgName) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '机构名称必填');
    }
    if (isPersonal) {
      if (!/^\d{17}[\dXx]$/.test(idCard)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '身份证号格式不正确',
        );
      }
    } else if (!uscc) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '统一社会信用代码必填',
      );
    }
    const contactName =
      body.contact_name === undefined
        ? row.contactName
        : text(body.contact_name).trim();
    const contactPhone =
      body.contact_phone === undefined
        ? row.contactPhone
        : text(body.contact_phone).trim();
    const contactEmail =
      body.contact_email === undefined
        ? row.contactEmail
        : text(body.contact_email).trim();
    const intro =
      body.intro === undefined ? row.intro : text(body.intro).trim();
    if (!contactName || !contactPhone || !contactEmail || !intro) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '联系人、联系电话、联系邮箱与机构简介必填',
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '联系邮箱格式不正确');
    }
    const qualification =
      body.qualification === undefined
        ? row.qualification
        : text(body.qualification).trim();
    // 所在省、市（备案修改同样必填；变更不触发主体复审）
    const location = resolveLocation(body, row);
    let serviceItems = row.serviceItems;
    if (body.service_items !== undefined) {
      const bearing = hasSubItems(row.providerType);
      const raw = Array.isArray(body.service_items)
        ? body.service_items
        : typeof body.service_items === 'object' && body.service_items
          ? (body.service_items as Record<string, unknown>)[row.providerType]
          : body.service_items;
      const items = dedupeItems(raw);
      if (bearing) {
        assertSubItems({ [row.providerType]: items }, [row.providerType]);
      }
      serviceItems = items.join(',');
    }
    const attachments =
      body.attachments === undefined
        ? null
        : normalizeAttachments(body.attachments);
    const businessStaff =
      body.business_staff === undefined
        ? null
        : normalizeBusinessStaff(body.business_staff);
    const subjectChanged =
      orgName !== row.orgName ||
      uscc !== row.uscc ||
      idCard !== row.idCard ||
      serviceItems !== row.serviceItems;
    if (subjectChanged) {
      const active = await this.hasActiveContractForType(
        row.userId,
        row.providerType,
      );
      if (active > 0) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '该类目存在生效中签约，不可变更备案主体信息；请先解约',
        );
      }
    }
    const next = await this.prisma.providerApplication.update({
      where: { id },
      data: {
        orgName,
        uscc: isPersonal ? '' : uscc,
        idCard: isPersonal ? idCard : '',
        qualification,
        contactName,
        contactPhone,
        contactEmail,
        province: location.province,
        city: location.city,
        intro,
        serviceItems,
        ...(attachments ? { attachments } : {}),
        ...(businessStaff ? { businessStaff } : {}),
        ...(subjectChanged
          ? {
              status: 'PENDING',
              auditNote: '备案主体信息变更，待平台复审',
              auditedAt: null,
            }
          : {}),
      },
    });
    await this.audit(
      user.userId,
      '修改服务商备案',
      `#${id} ${CATEGORY_LABELS[row.providerType] || row.providerType}${subjectChanged ? '（主体变更，转待复审）' : ''}`,
    );
    return decorateProviderApp(next);
  }
  /** 撤回/删除服务商备案：已通过备案的类目若有生效中签约则不可撤回（否则解除签约资格）。 */
  async removeProviderApplication(user: CurrentUser, id: number) {
    const row = await this.prisma.providerApplication.findUnique({
      where: { id },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '备案记录不存在');
    }
    if (row.userId !== user.userId && !this.isPlatformAdmin(user)) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅备案人本人或平台管理员可撤回备案',
      );
    }
    if (row.status === 'APPROVED') {
      const active = await this.hasActiveContractForType(
        row.userId,
        row.providerType,
      );
      if (active > 0) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '该类目存在生效中签约，不可撤回备案；请先解约',
        );
      }
    }
    await this.prisma.providerApplication.delete({ where: { id } });
    await this.audit(
      user.userId,
      '撤回服务商备案',
      `#${id} ${CATEGORY_LABELS[row.providerType] || row.providerType}`,
    );
    return { id, removed: true };
  }
  async uploadAttachments(
    user: CurrentUser,
    files: {
      name?: string;
      size?: number;
      contentType?: string;
      contentBase64?: string;
    }[],
  ) {
    const validated = parseAttachmentFiles(files);
    const ts = Date.now();
    const uploaded: Attachment[] = [];
    for (const [index, { name, safe, content }] of validated.entries()) {
      const result = await this.oss.upload(
        `provider-qualifications/${user.userId}/${ts}-${index + 1}-${safe}`,
        content,
      );
      uploaded.push({
        id: `att-${ts}-${index + 1}`,
        name,
        size: result.size,
        url: result.url,
        uploaded_at: nowStamp(),
      });
    }
    return { files: uploaded, tip: '' };
  }
  async getStaffProfile(userId: string) {
    const row = await this.prisma.staffProfile.findUnique({
      where: { userId },
    });
    return row ? { ...row, categories: asStringArray(row.categories) } : null;
  }
  async submitStaffProfile(
    user: CurrentUser,
    body: {
      real_name?: string;
      phone?: string;
      email?: string;
      region?: string;
      province?: string;
      city?: string;
      categories?: string[];
      qualification?: string;
      intro?: string;
    },
  ) {
    const name = String(body.real_name || '').trim();
    const tel = String(body.phone || '').trim();
    const intro = String(body.intro || '').trim();
    if (!name || !tel || !intro) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '真实姓名、联系电话与个人简介必填',
      );
    }
    // 常驻省、市：提交资料时必选（服务商按省市挑选承办人，用户按省市筛选服务商）
    const { province, city } = requireLocation(body);
    const cats = [
      ...new Set((body.categories || []).map((item) => String(item).trim())),
    ];
    if (
      !cats.length ||
      cats.some(
        (item) => !(STAFF_CATEGORIES as readonly string[]).includes(item),
      )
    ) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请至少选择一个合法服务类目',
      );
    }
    const exist = await this.prisma.staffProfile.findUnique({
      where: { userId: user.userId },
    });
    const data = {
      realName: name,
      phone: tel,
      email: String(body.email || '').trim(),
      region: String(body.region || '').trim(),
      province,
      city,
      categories: cats,
      qualification: String(body.qualification || '').trim(),
      intro,
    };
    if (exist) {
      await this.prisma.staffProfile.update({
        where: { userId: user.userId },
        data,
      });
    } else {
      await this.prisma.staffProfile.create({
        data: { userId: user.userId, ...data },
      });
    }
    return { real_name: name, categories: cats, updated: !!exist };
  }
  async hasServiceType(userId: string, type: string) {
    // 细项不单独落 providerType，而是记在承载备案行（可多个：物流细项在物流服务商与小微服务商行）
    // 的 serviceItems 里；未申请该细项即视为不承接（EXPORT_REFUND 既是类目也是细项，同样要落在细项里）。
    // 备案行已在 `qualifications()` 里按 userId 全量取过，这里直接筛，不再多查一次库。
    const { providerApps } = await this.qualifications(userId);
    const bearing = bearingRowsOf(type);
    const rows = providerApps.filter(
      (row) => row.status === 'APPROVED' && bearing.includes(row.providerType),
    );
    if (!rows.length) return false;
    if (!SUBITEM_OWNERS[type]) return true;
    return rows.some((row) =>
      (row.serviceItems || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .includes(type),
    );
  }
  async approvedTypes(userId: string) {
    const { providerApps } = await this.qualifications(userId);
    return (
      providerApps
        .filter((row) => row.status === 'APPROVED')
        // 与原来的无 ORDER BY 查询同序（按 id 升序）
        .sort((a, b) => a.id - b.id)
        .map((row) => row.providerType)
    );
  }
  /** 名下已备案企业：全系统最热的身份读取（58 处调用），同一请求内只查一次。 */
  myEnterprises(userId: string) {
    return requestMemo(`myEnterprises:${userId}`, () =>
      this.prisma.enterpriseProfile.findMany({
        where: { userId, status: 'APPROVED' },
        orderBy: { id: 'desc' },
      }),
    );
  }
  async providerContext(userId: string) {
    const q = await this.qualifications(userId);
    const providers = new Set<string>();
    if (q.roles.includes('SERVICE_PROVIDER')) providers.add(userId);
    for (const bind of q.staffOf) providers.add(bind.providerUserId);
    return { providers: [...providers], staffOf: q.staffOf };
  }
  /**
   * 服务商侧作业权限（对齐 demo canWorkOn）：签约主体是服务商，具体事由承办人做。
   * - 服务商账号：本人名下且未指派他人工承办的单据；
   * - 承办职员：本单 `staffUserId = 本人` 且仍被该服务商绑定（ACTIVE）时，仅可操作分派给自己的单据。
   */
  async canWorkOn(
    user: CurrentUser,
    row: {
      providerUserId?: string;
      staffUserId?: string;
    },
  ) {
    if (this.isPlatformAdmin(user)) return true;
    const providerUserId = String(row.providerUserId || '');
    if (providerUserId && providerUserId === user.userId) {
      const staffUserId = String(row.staffUserId || '');
      return !staffUserId || staffUserId === user.userId;
    }
    if (String(row.staffUserId || '') === user.userId) {
      const bind = await this.prisma.providerStaff.findFirst({
        where: {
          providerUserId,
          staffUserId: user.userId,
          status: 'ACTIVE',
        },
      });
      return Boolean(bind);
    }
    return false;
  }
  /**
   * 企业级作业权限（无业务单据行的场景，如企享云自动申报/开票、已开发票查询）：
   * 平台管理员｜企业当事人（`options.enterpriseParty` 显式关闭时除外）｜该企业生效签约的承办人——
   * 已指派时仅该承办职员（含本人即服务商账号），未指派时服务商账号本人可作业。
   */
  async canServeEnterprise(
    user: CurrentUser,
    enterpriseId: number,
    options: {
      enterpriseParty?: boolean;
    } = {},
  ) {
    if (this.isPlatformAdmin(user)) return true;
    const eps = await this.myEnterprises(user.userId);
    if (eps.some((item) => item.id === enterpriseId)) {
      return options.enterpriseParty !== false;
    }
    // 企享云只服务财税签约。分派记录本身不是授权：它可能属于其他服务、已解约，
    // 或指向已经解绑的职员。
    const ownTaxContract = await this.prisma.contract.findFirst({
      where: {
        enterpriseId,
        providerUserId: user.userId,
        serviceType: 'TAX_FINANCE',
        status: 'ACTIVE',
      },
    });
    if (
      ownTaxContract &&
      (await this.hasServiceType(user.userId, 'TAX_FINANCE'))
    ) {
      const assignment = await this.prisma.providerAssignment.findUnique({
        where: {
          providerUserId_enterpriseId: {
            providerUserId: user.userId,
            enterpriseId,
          },
        },
      });
      return !assignment?.staffUserId || assignment.staffUserId === user.userId;
    }
    const binds = await this.prisma.providerStaff.findMany({
      where: { staffUserId: user.userId, status: 'ACTIVE' },
    });
    const taxBinds = binds.filter(
      (bind) =>
        Array.isArray(bind.roles) &&
        bind.roles.some(
          (role) => typeof role === 'string' && role.includes('财税专员'),
        ),
    );
    if (!taxBinds.length) return false;
    const contracts = await this.prisma.contract.findMany({
      where: {
        enterpriseId,
        providerUserId: { in: taxBinds.map((bind) => bind.providerUserId) },
        serviceType: 'TAX_FINANCE',
        status: 'ACTIVE',
      },
      select: { providerUserId: true },
    });
    const approvedProviders: string[] = [];
    for (const contract of contracts) {
      if (await this.hasServiceType(contract.providerUserId, 'TAX_FINANCE')) {
        approvedProviders.push(contract.providerUserId);
      }
    }
    if (!approvedProviders.length) return false;
    const assignment = await this.prisma.providerAssignment.findFirst({
      where: {
        enterpriseId,
        staffUserId: user.userId,
        providerUserId: { in: approvedProviders },
      },
    });
    return Boolean(assignment);
  }
  async staffRoleOptions(userId: string) {
    const apps = await this.prisma.providerApplication.findMany({
      where: { userId, status: 'APPROVED' },
    });
    const out: {
      role: string;
      category: string;
      code: string;
    }[] = [];
    const seen = new Set<string>();
    const push = (role: string, category: string, code: string) => {
      if (seen.has(role)) return;
      seen.add(role);
      out.push({ role, category, code });
    };
    for (const app of apps) {
      if (hasSubItems(app.providerType)) {
        for (const item of app.serviceItems.split(',').filter(Boolean)) {
          const role = SUBITEM_STAFF_ROLE[item];
          if (role) push(role.role, `${role.group} · ${role.label}`, item);
        }
        continue;
      }
      const role = STAFF_ROLE_BY_TYPE[app.providerType];
      if (role) push(role.role, role.category, app.providerType);
    }
    return out;
  }
  async listStaff(user: CurrentUser) {
    await this.requireRoles(user, 'SERVICE_PROVIDER');
    const rows = await this.prisma.providerStaff.findMany({
      where: { providerUserId: user.userId },
      orderBy: { id: 'desc' },
    });
    const staffIds = [
      ...new Set(rows.map((row) => row.staffUserId).filter(Boolean)),
    ];
    // 目录与职员档案各一次批量查：原来每行 2 次查询（displayName + staffProfile），N 名职员 = 2N 个 round-trip
    const [directory, profiles] = await Promise.all([
      this.directoryMap(staffIds),
      staffIds.length
        ? this.prisma.staffProfile.findMany({
            where: { userId: { in: staffIds } },
          })
        : Promise.resolve([]),
    ]);
    const profileMap = new Map(
      profiles.map((row) => [
        row.userId,
        { ...row, categories: asStringArray(row.categories) },
      ]),
    );
    return rows.map((row) => {
      const entry = directory.get(row.staffUserId);
      return {
        ...row,
        staff_name: entry?.displayName || entry?.username || row.staffUserId,
        username: entry?.username || '',
        display_name: entry?.displayName || '',
        email: entry?.email || '',
        profile: profileMap.get(row.staffUserId) || null,
      };
    });
  }
  /** 批量取本系统自建用户目录（AIworkin 账号名/昵称/邮箱）。 */
  private async directoryMap(userIds: string[]) {
    const users = await this.users.lookup(userIds);
    return new Map(users.map((item) => [item.id, item]));
  }
  async searchStaff(user: CurrentUser, query: string) {
    await this.requireRoles(user, 'SERVICE_PROVIDER');
    const q = query.trim();
    if (!q) return [];
    const rows = await this.prisma.staffProfile.findMany({
      where: {
        OR: [
          { realName: { contains: q } },
          { phone: { contains: q } },
        ],
      },
      take: 20,
    });
    return rows.map((row) => ({
      userId: row.userId,
      real_name: row.realName,
      phone: row.phone,
      categories: asStringArray(row.categories),
    }));
  }
  /** 当前业务身份（用于数据可见性判定：身份决定数据范围）。 */
  async currentIdentity(user: CurrentUser) {
    const q = await this.qualifications(user.userId);
    return this.resolveCurrentIdentity(user, q);
  }
  /**
   * 服务商发起「添加职员/代理人」申请：**不直接建立绑定**，待被邀请人确认后生效。
   * 前置：目标必须是已注册且启用的 AIworkin 账号。
   */
  async inviteStaff(
    user: CurrentUser,
    staffUserId: string,
    categories: string[],
  ) {
    await this.requireRoles(user, 'SERVICE_PROVIDER');
    const target = String(staffUserId || '').trim();
    if (!target) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择要添加的账号');
    }
    if (target === user.userId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '不能把自己添加为职员（小微服务商本人即职员，无需添加）',
      );
    }
    await this.users.requireActiveUser(target);
    const profile = await this.prisma.staffProfile.findUnique({
      where: { userId: target },
    });
    if (!profile) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该账号尚未提交个人资料（职员/代理人身份），不可添加',
      );
    }
    const cats = [
      ...new Set(
        categories.map((item) => String(item || '').trim()).filter(Boolean),
      ),
    ];
    if (!cats.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择角色（类目）');
    }
    const invalid = cats.filter(
      (item) => !AFFILIATION_CATEGORIES.includes(item),
    );
    if (invalid.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `角色类目不合法：${invalid.join('、')}`,
      );
    }
    // 同一机构同类目只留一条有效申请/邀请（职员可同时属于多家机构，不再跨机构占用类目）
    const occupiedRows = await this.prisma.staffApplication.findMany({
      where: {
        staffUserId: target,
        providerUserId: user.userId,
        category: { in: cats },
        status: { in: ['PENDING', 'APPROVED'] },
      },
      select: { category: true },
    });
    const occupied = new Set(occupiedRows.map((item) => item.category));
    for (const category of cats) {
      if (occupied.has(category)) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          `该账号在本机构的「${CATEGORY_LABELS[category] || category}」已有绑定或待处理申请`,
        );
      }
    }
    const existing = await this.prisma.providerStaff.findUnique({
      where: {
        providerUserId_staffUserId: {
          providerUserId: user.userId,
          staffUserId: target,
        },
      },
    });
    if (existing?.status === 'ACTIVE') {
      throw new BusinessException(ErrorCode.CONFLICT, '该账号已是你的职员');
    }
    const row = await this.prisma.staffApplication.create({
      data: {
        staffUserId: target,
        providerUserId: user.userId,
        category: cats[0],
        direction: 'PROVIDER_INVITE',
        roles: cats.join(','),
        status: 'PENDING',
      },
    });
    await this.audit(
      user.userId,
      '职员添加申请',
      `#${row.id} → ${target}（${cats
        .map((item) => CATEGORY_LABELS[item] || item)
        .join('、')}）`,
    );
    return { id: row.id, status: 'PENDING' };
  }
  /** 被邀请人视角：待我确认的添加申请（附机构名与角色，便于「我的服务商」展示）。 */
  async myInvitations(user: CurrentUser) {
    const rows = await this.prisma.staffApplication.findMany({
      where: {
        staffUserId: user.userId,
        direction: 'PROVIDER_INVITE',
        status: 'PENDING',
      },
      orderBy: { id: 'desc' },
    });
    const names = await this.providerInfoMap(
      rows.map((row) => row.providerUserId),
    );
    return rows.map((row) => ({
      ...row,
      provider_name:
        names.get(row.providerUserId)?.orgName ||
        names.get(row.providerUserId)?.name ||
        row.providerUserId,
      role_labels: (row.roles || row.category)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map(roleLabelOf),
    }));
  }
  /** 机构展示信息：备案机构名 + AIworkin 账号昵称/用户名。 */
  private async providerInfoMap(userIds: string[]) {
    const ids = [...new Set(userIds.filter(Boolean))];
    const [apps, directory] = await Promise.all([
      this.prisma.providerApplication.findMany({
        where: { userId: { in: ids }, status: 'APPROVED' },
        orderBy: { id: 'desc' },
      }),
      this.directoryMap(ids),
    ]);
    const out = new Map<
      string,
      {
        name: string;
        orgName: string;
      }
    >();
    for (const id of ids) {
      const app = apps.find((item) => item.userId === id);
      const account = directory.get(id);
      out.set(id, {
        name: account?.displayName || account?.username || id,
        orgName: app?.orgName || '',
      });
    }
    return out;
  }
  /** 被邀请人确认 / 拒绝（仅本人可操作）。 */
  async respondInvitation(
    user: CurrentUser,
    id: number,
    action: 'APPROVE' | 'REJECT',
  ) {
    const row = await this.prisma.staffApplication.findUnique({
      where: { id },
    });
    if (!row || row.direction !== 'PROVIDER_INVITE') {
      throw new BusinessException(ErrorCode.NOT_FOUND, '添加申请不存在');
    }
    if (row.staffUserId !== user.userId) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅被邀请人本人可确认该申请',
      );
    }
    if (row.status !== 'PENDING') {
      throw new BusinessException(ErrorCode.CONFLICT, '该申请已处理');
    }
    const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    // 申请结论与绑定关系同事务：只改结论会留下「已确认却没绑定」的职员
    await this.prisma.$transaction(async (tx) => {
      await tx.staffApplication.update({
        where: { id },
        data: { status, auditedAt: new Date() },
      });
      if (action === 'APPROVE') {
        const roles = (row.roles || row.category)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .map(roleLabelOf);
        const exist = await tx.providerStaff.findUnique({
          where: {
            providerUserId_staffUserId: {
              providerUserId: row.providerUserId,
              staffUserId: row.staffUserId,
            },
          },
        });
        if (!exist) {
          await tx.providerStaff.create({
            data: {
              providerUserId: row.providerUserId,
              staffUserId: row.staffUserId,
              roles: roles.length ? roles : [row.category],
              status: 'ACTIVE',
            },
          });
        } else if (exist.status !== 'ACTIVE') {
          await tx.providerStaff.update({
            where: { id: exist.id },
            data: { status: 'ACTIVE' },
          });
        }
      }
      await this.audit(user.userId, '职员添加确认', `#${id} ${status}`, tx);
    });
    return { id, status };
  }
  /** 服务商撤回自己发起的添加申请。 */
  async cancelInvitation(user: CurrentUser, id: number) {
    const row = await this.prisma.staffApplication.findUnique({
      where: { id },
    });
    if (!row || row.direction !== 'PROVIDER_INVITE') {
      throw new BusinessException(ErrorCode.NOT_FOUND, '添加申请不存在');
    }
    if (row.providerUserId !== user.userId) {
      throw new BusinessException(ErrorCode.ROLE_MISMATCH, '仅发起方可撤回');
    }
    if (row.status !== 'PENDING') {
      throw new BusinessException(ErrorCode.CONFLICT, '该申请已处理');
    }
    await this.prisma.staffApplication.update({
      where: { id },
      data: { status: 'CANCELLED', auditedAt: new Date() },
    });
    await this.audit(user.userId, '职员添加撤回', `#${id}`);
    return { id, status: 'CANCELLED' };
  }
  async bindStaff(user: CurrentUser, staffUserId: string, roles: string[]) {
    await this.requireRoles(user, 'SERVICE_PROVIDER');
    const profile = await this.prisma.staffProfile.findUnique({
      where: { userId: staffUserId },
    });
    if (!profile) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该账号尚未提交个人资料，不可绑定',
      );
    }
    const exist = await this.prisma.providerStaff.findUnique({
      where: {
        providerUserId_staffUserId: {
          providerUserId: user.userId,
          staffUserId,
        },
      },
    });
    if (exist?.status === 'ACTIVE') {
      throw new BusinessException(ErrorCode.CONFLICT, '该职员已绑定');
    }
    const row = exist
      ? await this.prisma.providerStaff.update({
          where: { id: exist.id },
          data: { status: 'ACTIVE', roles },
        })
      : await this.prisma.providerStaff.create({
          data: {
            providerUserId: user.userId,
            staffUserId,
            roles,
            status: 'ACTIVE',
          },
        });
    await this.audit(user.userId, '绑定职员', profile.realName);
    return { id: row.id, staffUserId };
  }
  async unbindStaff(user: CurrentUser, staffUserId: string) {
    await this.requireRoles(user, 'SERVICE_PROVIDER');
    await this.releaseStaff(user.userId, staffUserId);
    return { staffUserId, status: 'DISABLED' };
  }
  /** 职员自助解绑：职员主动解除与某服务商的绑定。 */
  async selfUnbindStaff(user: CurrentUser, providerUserId: string) {
    await this.releaseStaff(providerUserId, user.userId);
    await this.audit(user.userId, '自助解绑', `provider=${providerUserId}`);
    return { providerUserId, status: 'DISABLED' };
  }
  /** 解绑同时释放在办单据，避免离职职员留在承办字段中阻塞服务商。 */
  private async releaseStaff(providerUserId: string, staffUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.providerStaff.updateMany({
        where: { providerUserId, staffUserId, status: 'ACTIVE' },
        data: { status: 'DISABLED' },
      });
      await tx.providerAssignment.deleteMany({
        where: { providerUserId, staffUserId },
      });
      const base = { providerUserId, staffUserId };
      await tx.taxDeclaration.updateMany({
        where: { ...base, NOT: { status: 'PAID' } },
        data: { staffUserId: '' },
      });
      await tx.overseasClaim.updateMany({
        where: { ...base, status: { notIn: ['REFUNDED', 'REJECTED'] } },
        data: { staffUserId: '' },
      });
      await tx.consultation.updateMany({
        where: { ...base, status: 'OPEN' },
        data: { staffUserId: '' },
      });
      await tx.accountSet.updateMany({
        where: { ...base, status: 'ACTIVE' },
        data: { staffUserId: '' },
      });
      await tx.legalRequest.updateMany({
        where: { ...base, NOT: { status: 'CLOSED' } },
        data: { staffUserId: '' },
      });
      await tx.ipRequest.updateMany({
        where: { ...base, NOT: { status: 'CLOSED' } },
        data: { staffUserId: '' },
      });
      await tx.flexWorkOrder.updateMany({
        where: { ...base, NOT: { status: 'CLOSED' } },
        data: { staffUserId: '' },
      });
      await tx.flexOnboarding.updateMany({
        where: { ...base, status: 'SUBMITTED' },
        data: { staffUserId: '' },
      });
      await tx.taxPlan.updateMany({
        where: { ...base, NOT: { status: 'DONE' } },
        data: { staffUserId: '' },
      });
      await tx.invoiceRequest.updateMany({
        where: {
          ...base,
          status: {
            in: ['REQUESTED', 'ISSUING', 'SUBMITTED', 'ISSUE_UNKNOWN'],
          },
        },
        data: { staffUserId: '' },
      });
    });
  }
  /**
   * 职员/代理人可申请加入的服务商（「申请加入服务商」页一个接口出全部）：
   * 按本人申报的板块展开成可申请分类（带细项的板块展开为其全部细项），
   * 每张卡片带上本人对该机构的申请/绑定状态，避免前端按分类逐个请求名录。
   */
  async joinableProviders(userId: string) {
    const profile = await this.prisma.staffProfile.findUnique({
      where: { userId },
    });
    const declared = asStringArray(profile?.categories ?? []);
    // 未提交个人资料的账号（个人用户等）也要能浏览名录：卡片动作会引导先去「身份与资质」补资料
    const codes = applyCodesOf(declared.length ? declared : STAFF_CATEGORIES);
    if (!codes.length)
      return { hasProfile: Boolean(profile), declared, sections: [] };
    const owners = [...new Set(codes.flatMap((code) => bearingRowsOf(code)))];
    const [approvedApps, myApps, binds] = await Promise.all([
      this.prisma.providerApplication.findMany({
        where: {
          status: 'APPROVED',
          providerType: { in: owners },
          // 双身份账号不能申请加入自己
          userId: { not: userId },
        },
        orderBy: { id: 'desc' },
      }),
      this.prisma.staffApplication.findMany({
        where: { staffUserId: userId },
        orderBy: { id: 'asc' },
      }),
      this.prisma.providerStaff.findMany({
        where: { staffUserId: userId, status: 'ACTIVE' },
        select: { providerUserId: true },
      }),
    ]);
    const names = await this.providerInfoMap(
      approvedApps.map((row) => row.userId),
    );
    const bound = new Set(binds.map((row) => row.providerUserId));
    // 同一机构同一分类只看最新一条：待审批／已加入要压掉早前的驳回与撤回
    const latestApp = new Map<string, (typeof myApps)[number]>();
    for (const row of myApps)
      latestApp.set(`${row.category}:${row.providerUserId}`, row);

    const sections: JoinableSection[] = [];
    for (const code of codes) {
      const bearing = bearingRowsOf(code);
      const seen = new Set<string>();
      const providers: JoinableProvider[] = approvedApps
        .filter((row) => {
          if (!bearing.includes(row.providerType)) return false;
          if (seen.has(row.userId)) return false;
          // 细项分区只收该细项已生效的机构（细项记在承载备案行的 serviceItems 上）
          if (SUBITEM_OWNERS[code]) {
            const items = row.serviceItems
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean);
            if (!items.includes(code)) return false;
          }
          seen.add(row.userId);
          return true;
        })
        .map((row) => {
          const application = latestApp.get(`${code}:${row.userId}`);
          return {
            providerUserId: row.userId,
            orgName: row.orgName || names.get(row.userId)?.name || row.userId,
            nickname: names.get(row.userId)?.name || row.userId,
            qualification: row.qualification,
            province: row.province,
            city: row.city,
            intro: row.intro,
            serviceItems: row.serviceItems
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean),
            applicationStatus: application?.status || '',
            applicationId: application?.id || 0,
            bound: bound.has(row.userId),
          };
        });
      if (!providers.length) continue;
      sections.push({
        code,
        label: joinCodeLabel(code),
        providerCount: providers.length,
        providers,
      });
    }
    return { hasProfile: Boolean(profile), declared, sections };
  }
  async applyAffiliation(
    user: CurrentUser,
    providerUserId: string,
    category: string,
  ) {
    const profile = await this.prisma.staffProfile.findUnique({
      where: { userId: user.userId },
    });
    if (!profile) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先在「身份与资质」提交个人资料（职员/代理人），再申请加入服务商',
      );
    }
    if (!AFFILIATION_CATEGORIES.includes(category)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '申请加入的服务板块不合法',
      );
    }
    // 申报的板块决定能申请加入哪些机构：细项归类到板块（仓储→物流、直播带货→营销）
    const declared = asStringArray(profile.categories);
    if (!staffCategoryCovers(declared, category)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `你的个人资料未申报「${
          CATEGORY_LABELS[category] || category
        }」所属板块，请先到「身份与资质」补充服务类目后再申请加入`,
      );
    }
    // hasServiceType 已按承载备案行取人（物流细项与物流/供销类目都含小微直营兜底）
    if (!(await this.hasServiceType(providerUserId, category))) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '目标机构未开通该类目',
      );
    }
    // 一个职员/代理人可加入多家机构：同类目不再限制机构家数，只拦「同一家机构的同一类目重复申请」
    const duplicate = await this.prisma.staffApplication.findFirst({
      where: {
        staffUserId: user.userId,
        providerUserId,
        category,
        status: { in: ['PENDING', 'APPROVED'] },
      },
    });
    if (duplicate) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        duplicate.status === 'APPROVED'
          ? `你已加入该机构的「${CATEGORY_LABELS[category] || category}」`
          : `对该机构的「${
              CATEGORY_LABELS[category] || category
            }」已有一条待审批申请`,
      );
    }
    // 服务商直接绑定（职员管理「添加职员」）不留申请行，这里按在职绑定的角色拦同名类目
    // （同一家机构可承担多个板块，只拦重复的那一个，不拦整家机构）
    const boundLabel = CATEGORY_LABELS[category] || category;
    const bind = await this.prisma.providerStaff.findFirst({
      where: { providerUserId, staffUserId: user.userId, status: 'ACTIVE' },
      select: { roles: true },
    });
    if (bind && asStringArray(bind.roles).includes(boundLabel)) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `你已加入该机构的「${boundLabel}」`,
      );
    }
    const row = await this.prisma.staffApplication.create({
      data: {
        staffUserId: user.userId,
        providerUserId,
        category,
        status: 'PENDING',
      },
    });
    return { id: row.id, status: 'PENDING' };
  }
  async myAffiliations(userId: string) {
    const rows = await this.prisma.staffApplication.findMany({
      where: { staffUserId: userId },
      orderBy: { id: 'desc' },
    });
    const names = await this.providerInfoMap(
      rows.map((row) => row.providerUserId),
    );
    return rows.map((row) => ({
      ...row,
      provider_name:
        names.get(row.providerUserId)?.orgName ||
        names.get(row.providerUserId)?.name ||
        row.providerUserId,
      category_label: CATEGORY_LABELS[row.category] || row.category,
      role_labels: (row.roles || row.category)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map(roleLabelOf),
    }));
  }
  /** 职员/代理人撤回自己发起的加入申请（仅待审批可撤回）。 */
  async cancelAffiliation(user: CurrentUser, id: number) {
    const row = await this.prisma.staffApplication.findUnique({
      where: { id },
    });
    if (!row || row.direction !== 'STAFF_APPLY') {
      throw new BusinessException(ErrorCode.NOT_FOUND, '加入申请不存在');
    }
    if (row.staffUserId !== user.userId) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅申请人本人可撤回加入申请',
      );
    }
    if (row.status !== 'PENDING') {
      throw new BusinessException(ErrorCode.CONFLICT, '该申请已处理');
    }
    await this.prisma.staffApplication.update({
      where: { id },
      data: { status: 'CANCELLED', auditedAt: new Date() },
    });
    await this.audit(
      user.userId,
      '加入申请撤回',
      `#${id} ${CATEGORY_LABELS[row.category] || row.category}`,
    );
    return { id, status: 'CANCELLED' };
  }
  async inboxAffiliations(user: CurrentUser) {
    await this.requireRoles(user, 'SERVICE_PROVIDER');
    const rows = await this.prisma.staffApplication.findMany({
      where: { providerUserId: user.userId },
      orderBy: { id: 'desc' },
    });
    // 列表要能看清「谁在申请」：姓名/手机号/本人资料 + AIworkin 账号（本系统自建目录）
    const directory = await this.directoryMap(
      rows.map((row) => row.staffUserId),
    );
    const profiles = await this.prisma.staffProfile.findMany({
      where: {
        userId: { in: [...new Set(rows.map((row) => row.staffUserId))] },
      },
    });
    return rows.map((row) => {
      const profile = profiles.find((item) => item.userId === row.staffUserId);
      const account = directory.get(row.staffUserId);
      return {
        ...row,
        applicant_name: profile?.realName || account?.displayName || '',
        applicant_username: account?.username || '',
        applicant_email: account?.email || '',
        applicant_phone: profile?.phone || '',
        position: profile?.qualification || '',
        category_label: CATEGORY_LABELS[row.category] || row.category,
        role_labels: (row.roles || row.category)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .map(roleLabelOf),
        profile: profile
          ? {
              realName: profile.realName,
              phone: profile.phone,
              email: profile.email,
              region: profile.region,
              qualification: profile.qualification,
              categories: asStringArray(profile.categories),
            }
          : null,
      };
    });
  }
  async auditAffiliation(
    user: CurrentUser,
    id: number,
    action: 'APPROVE' | 'REJECT',
    note = '',
  ) {
    await this.requireRoles(user, 'SERVICE_PROVIDER');
    const row = await this.prisma.staffApplication.findUnique({
      where: { id },
    });
    if (!row || row.providerUserId !== user.userId) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '加入申请不存在');
    }
    if (row.status !== 'PENDING') {
      throw new BusinessException(ErrorCode.CONFLICT, '该申请已审核');
    }
    const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    // 申请结论 → 职员绑定 → 公开律师登记：三段写入同生共死，
    // 否则中途失败会留下「申请已通过但人没绑上」或「绑上了但律所名录查不到他」的半截状态
    await this.prisma.$transaction(async (tx) => {
      await tx.staffApplication.update({
        where: { id },
        data: { status, note, auditedAt: new Date() },
      });
      if (action !== 'APPROVE') return;
      const exist = await tx.providerStaff.findUnique({
        where: {
          providerUserId_staffUserId: {
            providerUserId: user.userId,
            staffUserId: row.staffUserId,
          },
        },
      });
      if (!exist) {
        await tx.providerStaff.create({
          data: {
            providerUserId: user.userId,
            staffUserId: row.staffUserId,
            roles: [CATEGORY_LABELS[row.category] || row.category],
            status: 'ACTIVE',
          },
        });
      } else {
        // 同一机构可承担多个类目：后续审批通过要并入角色，否则职员管理里看不到这一条
        const label = CATEGORY_LABELS[row.category] || row.category;
        const roles = asStringArray(exist.roles);
        await tx.providerStaff.update({
          where: { id: exist.id },
          data: {
            status: 'ACTIVE',
            roles: roles.includes(label) ? roles : [...roles, label],
          },
        });
      }
      if (row.category === 'LEGAL_SERVICE') {
        await this.ensurePublicLawyer(user.userId, row.staffUserId, tx);
      }
    });
    return { id, status };
  }
  async ensurePublicLawyer(
    providerUserId: string,
    staffUserId: string,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const profile = await client.staffProfile.findUnique({
      where: { userId: staffUserId },
    });
    const firm = await client.lawyerResource.findFirst({
      where: {
        providerUserId,
        kind: 'LAW_FIRM',
        status: { notIn: ['HIDDEN', 'REJECTED'] },
      },
    });
    const exist = await client.lawyerResource.findFirst({
      where: { staffUserId, kind: 'LAWYER' },
    });
    const name =
      profile?.realName || (await this.users.displayName(staffUserId));
    // 公开律师的省市随律所（无律所时随本人职员档案）——省、市是资源库唯一地域筛选维度，不能留空
    const province = firm?.province || profile?.province || '';
    const city = firm?.city || profile?.city || '';
    if (exist) {
      await client.lawyerResource.update({
        where: { id: exist.id },
        data: {
          name,
          organization: firm?.name || exist.organization,
          province: province || exist.province,
          city: city || exist.city,
          providerUserId,
          status: 'APPROVED',
          qualification: profile?.qualification || exist.qualification,
        },
      });
      return exist.id;
    }
    const created = await client.lawyerResource.create({
      data: {
        kind: 'LAWYER',
        name,
        organization: firm?.name || '',
        province,
        city,
        qualification: profile?.qualification || '',
        status: 'APPROVED',
        providerUserId,
        staffUserId,
        ownerUserId: providerUserId,
      },
    });
    return created.id;
  }
  async assignEnterprise(
    user: CurrentUser,
    enterpriseId: number,
    staffUserId: string,
  ) {
    await this.requireRoles(user, 'SERVICE_PROVIDER');
    const contract = await this.prisma.contract.findFirst({
      where: {
        enterpriseId,
        providerUserId: user.userId,
        status: 'ACTIVE',
      },
    });
    if (!contract) {
      throw new BusinessException(
        ErrorCode.NO_ACTIVE_CONTRACT,
        '未与该企业建立生效签约，无法分派承办职员',
      );
    }
    const bind = await this.prisma.providerStaff.findUnique({
      where: {
        providerUserId_staffUserId: {
          providerUserId: user.userId,
          staffUserId,
        },
      },
    });
    if (!bind || bind.status !== 'ACTIVE') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '职员未绑定');
    }
    const row = await this.prisma.providerAssignment.upsert({
      where: {
        providerUserId_enterpriseId: {
          providerUserId: user.userId,
          enterpriseId,
        },
      },
      create: {
        providerUserId: user.userId,
        enterpriseId,
        staffUserId,
      },
      update: { staffUserId },
    });
    await this.flowOrdersToStaff(user.userId, enterpriseId, staffUserId);
    return { id: row.id, staffUserId };
  }
  async assignedStaffFor(providerUserId: string, enterpriseId: number) {
    const row = await this.prisma.providerAssignment.findUnique({
      where: {
        providerUserId_enterpriseId: { providerUserId, enterpriseId },
      },
    });
    return row?.staffUserId || '';
  }
  async myWork(user: CurrentUser) {
    const assignments = await this.prisma.providerAssignment.findMany({
      where: { staffUserId: user.userId },
    });
    const enterpriseRows = assignments.length
      ? await this.prisma.enterpriseProfile.findMany({
          where: { id: { in: assignments.map((row) => row.enterpriseId) } },
          select: {
            id: true,
            name: true,
            uscc: true,
            taxpayerType: true,
            industry: true,
            legalPerson: true,
            phone: true,
          },
        })
      : [];
    const enterpriseMap = new Map(enterpriseRows.map((row) => [row.id, row]));
    const binds = await this.prisma.providerStaff.findMany({
      where: { staffUserId: user.userId, status: 'ACTIVE' },
    });
    const info = await this.providerInfoMap(
      binds.map((row) => row.providerUserId),
    );
    return {
      assignments: assignments.map((row) => {
        const enterprise = enterpriseMap.get(row.enterpriseId);
        return {
          ...row,
          enterpriseName: enterprise?.name || '',
          uscc: enterprise?.uscc || '',
          taxpayerType: enterprise?.taxpayerType || '',
          industry: enterprise?.industry || '',
          legalPerson: enterprise?.legalPerson || '',
          phone: enterprise?.phone || '',
        };
      }),
      binds: binds.map((row) => ({
        ...row,
        provider_name: info.get(row.providerUserId)?.name || row.providerUserId,
        org_name: info.get(row.providerUserId)?.orgName || '',
      })),
    };
  }
  private async flowOrdersToStaff(
    providerUserId: string,
    enterpriseId: number,
    staffUserId: string,
  ) {
    // 在办单据一次事务改派：Promise.all 各占一条连接，中途失败会留下
    // 「一部分单据已换承办人、一部分还是旧人」的分裂状态
    await this.prisma.$transaction([
      this.prisma.taxDeclaration.updateMany({
        where: { providerUserId, enterpriseId, NOT: { status: 'PAID' } },
        data: { staffUserId },
      }),
      this.prisma.overseasClaim.updateMany({
        where: {
          providerUserId,
          enterpriseId,
          status: { notIn: ['REFUNDED', 'REJECTED'] },
        },
        data: { staffUserId },
      }),
      this.prisma.consultation.updateMany({
        where: { providerUserId, enterpriseId, status: 'OPEN' },
        data: { staffUserId },
      }),
      this.prisma.accountSet.updateMany({
        where: { providerUserId, enterpriseId, status: 'ACTIVE' },
        data: { staffUserId },
      }),
      this.prisma.legalRequest.updateMany({
        where: { providerUserId, enterpriseId, NOT: { status: 'CLOSED' } },
        data: { staffUserId },
      }),
      this.prisma.ipRequest.updateMany({
        where: { providerUserId, enterpriseId, NOT: { status: 'CLOSED' } },
        data: { staffUserId },
      }),
      this.prisma.flexWorkOrder.updateMany({
        where: { providerUserId, enterpriseId, NOT: { status: 'CLOSED' } },
        data: { staffUserId },
      }),
      this.prisma.flexOnboarding.updateMany({
        where: { providerUserId, enterpriseId, status: 'SUBMITTED' },
        data: { staffUserId },
      }),
      // 申报计划（申报期自动生成，可能早于指派）：未办结的改由新承办职员承办
      this.prisma.taxPlan.updateMany({
        where: { providerUserId, enterpriseId, NOT: { status: 'DONE' } },
        data: { staffUserId },
      }),
      this.prisma.invoiceRequest.updateMany({
        where: { providerUserId, enterpriseId, status: 'REQUESTED' },
        data: { staffUserId },
      }),
    ]);
  }
  async getSetting(key: string) {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    return row?.value || '';
  }
  async setSetting(key: string, value: string) {
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    return { key, value };
  }
  /** 灵工发薪板块是否启用：平台管理员在管理后台开关，**未设置即启用**（只有显式 'false' 才停用）。 */
  async flexPayrollEnabled() {
    return (await this.getSetting(FLEX_PAYROLL_ENABLED_KEY)) !== 'false';
  }
  /** 板块开关写入口：同时回写 _updated_at，供管理后台展示最后操作时间。 */
  async setFlexPayrollEnabled(enabled: boolean) {
    await this.setSetting(FLEX_PAYROLL_ENABLED_KEY, enabled ? 'true' : 'false');
    await this.setSetting(`${FLEX_PAYROLL_ENABLED_KEY}_updated_at`, nowStamp());
    return enabled;
  }
  /**
   * 小微服务商（仅 MICRO 资质）审核通过时登记「本人职员」：
   * 本人既是服务商又是唯一职员，物流等直营工单的承办人即本人（staff_id = 本人）。
   * 幂等：重复审核不产生重复记录。
   */
  async registerSelfStaff(
    userId: string,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const exist = await client.providerStaff.findUnique({
      where: {
        providerUserId_staffUserId: {
          providerUserId: userId,
          staffUserId: userId,
        },
      },
    });
    if (exist) {
      if (exist.status !== 'ACTIVE') {
        await client.providerStaff.update({
          where: { id: exist.id },
          data: { status: 'ACTIVE' },
        });
      }
      return { id: exist.id, created: false };
    }
    const row = await client.providerStaff.create({
      data: {
        providerUserId: userId,
        staffUserId: userId,
        roles: ['负责人（本人）'],
        status: 'ACTIVE',
      },
    });
    await this.audit(userId, '小微服务商本人职员登记', `#${row.id}`, client);
    return { id: row.id, created: true };
  }
  async audit(
    userId: string,
    action: string,
    detail: string,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    await client.auditLog.create({ data: { userId, action, detail } });
  }
  async listApiKeys(userId: string) {
    return this.prisma.apiKey.findMany({
      where: { userId },
      orderBy: { id: 'desc' },
      select: {
        id: true,
        userId: true,
        masked: true,
        status: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
  }
  async createApiKey(user: CurrentUser) {
    const plain = `ek_${randomBytes(24).toString('hex')}`;
    const row = await this.prisma.apiKey.create({
      data: {
        userId: user.userId,
        keyHash: createHash('sha256').update(plain).digest('hex'),
        masked: maskKey(plain),
      },
    });
    await this.audit(user.userId, 'API_KEY_CREATE', `#${row.id} ${row.masked}`);
    return {
      id: row.id,
      plainKey: plain,
      masked: row.masked,
      tip: '明文仅本次展示一次，请妥善保存',
    };
  }
  /** API Key 调用记录：本账号近 20 条 API 相关动作（生成/重置/吊销/调用）。 */
  async apiKeyUsage(user: CurrentUser, id: number) {
    const key = await this.prisma.apiKey.findFirst({
      where: { id, userId: user.userId },
    });
    if (!key) {
      throw new BusinessException(ErrorCode.NOT_FOUND, 'API Key 不存在');
    }
    return this.prisma.auditLog.findMany({
      where: { userId: user.userId, action: { startsWith: 'API' } },
      orderBy: { id: 'desc' },
      take: 20,
      select: { id: true, action: true, detail: true, createdAt: true },
    });
  }
  async resetApiKey(user: CurrentUser, id: number) {
    const exist = await this.prisma.apiKey.findFirst({
      where: { id, userId: user.userId },
    });
    if (!exist)
      throw new BusinessException(ErrorCode.NOT_FOUND, 'API Key 不存在');
    const plain = `ek_${randomBytes(24).toString('hex')}`;
    await this.prisma.apiKey.update({
      where: { id },
      data: {
        keyHash: createHash('sha256').update(plain).digest('hex'),
        masked: maskKey(plain),
        status: 'ACTIVE',
      },
    });
    await this.audit(user.userId, 'API_KEY_RESET', `#${id} 旧 Key 已失效`);
    return { id, plainKey: plain, masked: maskKey(plain) };
  }
  async revokeApiKey(user: CurrentUser, id: number) {
    await this.prisma.apiKey.updateMany({
      where: { id, userId: user.userId },
      data: { status: 'REVOKED' },
    });
    await this.audit(user.userId, 'API_KEY_REVOKE', `#${id}`);
    return { id, status: 'REVOKED' };
  }
}
/**
 * 服务商类型判定（对齐需求 3.3）：
 * - 仅 MICRO 资质 → `MICRO`（小微服务商：本人即唯一职员，派单给本人，不经职员体系）
 * - 含任一非 MICRO → `STANDARD`（服务商：业务指派到具体职员，工单与职员绑定，未指派不可推进）
 * - 混合（MICRO + 非 MICRO）→ `STANDARD`，但物流直营业务仍按小微规则（本人作业）
 * - 无已通过备案 → `NONE`
 */
export function deriveProviderKind(
  apps: {
    providerType: string;
    status: string;
  }[],
) {
  const types = new Set(
    apps
      .filter((item) => item.status === 'APPROVED')
      .map((item) => item.providerType),
  );
  if (!types.size) return 'NONE' as const;
  const nonMicro = [...types].filter((item) => item !== 'MICRO');
  if (!nonMicro.length) return 'MICRO' as const;
  return 'STANDARD' as const;
}
export function decorateProviderApp(row: {
  attachments: Prisma.JsonValue;
  businessStaff: Prisma.JsonValue;
  [key: string]: unknown;
}) {
  return {
    ...row,
    attachments: asArray(row.attachments),
    business_staff: asArray(row.businessStaff),
  };
}
export function asArray<T = unknown>(value: Prisma.JsonValue): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
export function asStringArray(value: Prisma.JsonValue) {
  return asArray(value).map((item) => String(item));
}
export function asRecord(value: Prisma.JsonValue) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function normalizeAttachments(list: unknown): Attachment[] {
  return (Array.isArray(list) ? list : [])
    .slice(0, 10)
    .map((item, index) => {
      const row = (item || {}) as Record<string, unknown>;
      return {
        id: text(row.id, `att-${Date.now().toString(36)}-${index + 1}`),
        name: text(row.name).trim(),
        size: Number(row.size || 0) || 0,
        url: text(row.url).trim(),
        uploaded_at: text(row.uploaded_at),
      };
    })
    .filter((item) => item.name);
}
function maskKey(plain: string) {
  return `${plain.slice(0, 6)}****${plain.slice(-4)}`;
}
function normalizeBusinessStaff(list: unknown): BusinessStaff[] {
  return (Array.isArray(list) ? list : [])
    .slice(0, 5)
    .map((item) => {
      const row = (item || {}) as Record<string, unknown>;
      return {
        name: text(row.name).trim(),
        title: text(row.title).trim(),
        phone: text(row.phone).trim(),
        email: text(row.email).trim(),
      };
    })
    .filter((item) => item.name && item.phone);
}
