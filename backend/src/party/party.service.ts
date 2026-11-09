import {
  PARTY_KIND_LABELS,
  PARTY_SOURCE_LABELS,
  PARTY_STATUS_LABELS,
} from '@enterprise/contracts';
import { pageOf, pageParam, text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { toJsonInput } from '../common/json-input';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type {
  TenantScopeService,
  Tenant,
} from '../tenant/tenant-scope.service';

const PARTY_ROLE_MANAGERS = ['ADMIN', 'OWNER', 'MANAGER'];
const PARTY_KINDS = ['VENDOR', 'OPC', 'INDIVIDUAL', 'PARTNER', 'CUSTOMER'];
const PARTY_STATUSES = ['ACTIVE', 'PAUSED', 'BLACKLISTED'];

type Row = Record<string, unknown>;

const asLabels = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item).trim().slice(0, 32))
    .filter(Boolean)
    .slice(0, 50);
};

const jsonObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * 统一外部主体台账：供应商 / OPC / 个人 / 合作伙伴 / 客户。
 * 项目外部协作、ERP 供应商、CRM 客户都引用这里的 partyId，联系人只维护一份。
 */
export class PartyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantScope: TenantScopeService,
  ) {}

  private assertWrite(tenant: Tenant) {
    if (tenant.isOwner) return;
    if (tenant.roles.some((role) => PARTY_ROLE_MANAGERS.includes(role))) return;
    throw new BusinessException(
      ErrorCode.FORBIDDEN,
      '只有组织负责人或管理员可以维护外部主体台账',
    );
  }

  private view(row: Row) {
    const kind = text(row.kind);
    const status = text(row.status);
    return {
      id: Number(row.id),
      kind,
      kindLabel: PARTY_KIND_LABELS[kind] || kind,
      name: text(row.name),
      contactName: text(row.contactName),
      phone: text(row.phone),
      email: text(row.email),
      taxNo: text(row.taxNo),
      address: text(row.address),
      roles: asLabels(row.roles),
      capabilities: asLabels(row.capabilities),
      rateCard: jsonObject(row.rateCard),
      availability: jsonObject(row.availability),
      compliance: jsonObject(row.compliance),
      rating: Number(row.rating ?? 0),
      source: text(row.source),
      sourceLabel: PARTY_SOURCE_LABELS[text(row.source)] || text(row.source),
      status,
      statusLabel: PARTY_STATUS_LABELS[status] || status,
      note: text(row.note),
      createdBy: text(row.createdBy),
      createdAt: (row.createdAt as Date)?.toISOString() || '',
      updatedAt: (row.updatedAt as Date)?.toISOString() || '',
    };
  }

  async list(user: CurrentUser, query: Row) {
    const tenant = await this.tenantScope.resolve(user);
    const { page, pageSize, offset } = pageParam(
      query.page as number,
      query.pageSize as number,
    );
    const kind = text(query.kind).trim().toUpperCase();
    const status = text(query.status).trim().toUpperCase();
    const keyword = text(query.q).trim();
    const where = {
      ...this.tenantScope.where(tenant),
      ...(kind ? { kind } : {}),
      ...(status ? { status } : {}),
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword } },
              { contactName: { contains: keyword } },
              { phone: { contains: keyword } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.bizParty.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: pageSize,
      }),
      this.prisma.bizParty.count({ where }),
    ]);
    return pageOf(
      rows.map((row) => this.view(row)),
      total,
      page,
      pageSize,
    );
  }

  async save(user: CurrentUser, body: Row) {
    const tenant = await this.tenantScope.resolve(user);
    this.assertWrite(tenant);
    const id = Number(body.id || 0);
    const kind = text(body.kind).trim().toUpperCase() || 'VENDOR';
    if (!PARTY_KINDS.includes(kind)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '主体类型不合法');
    }
    const status = text(body.status).trim().toUpperCase() || 'ACTIVE';
    if (!PARTY_STATUSES.includes(status)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '主体状态不合法');
    }
    const name = text(body.name).trim().slice(0, 120);
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写主体名称');
    }
    const data = {
      kind,
      name,
      contactName: text(body.contactName).trim().slice(0, 64),
      phone: text(body.phone).trim().slice(0, 32),
      email: text(body.email).trim().slice(0, 120),
      taxNo: text(body.taxNo).trim().slice(0, 32),
      address: text(body.address).trim().slice(0, 200),
      roles: toJsonInput(asLabels(body.roles)),
      capabilities: toJsonInput(asLabels(body.capabilities)),
      rateCard: toJsonInput(jsonObject(body.rateCard)),
      availability: toJsonInput(jsonObject(body.availability)),
      compliance: toJsonInput(jsonObject(body.compliance)),
      rating: Math.min(Math.max(Number(body.rating ?? 0), 0), 5),
      status,
      source: text(body.source).trim().toUpperCase().slice(0, 16) || 'MANUAL',
      note: text(body.note).trim().slice(0, 500),
    };
    const duplicate = await this.prisma.bizParty.findFirst({
      where: {
        ...this.tenantScope.where(tenant),
        name,
        ...(id ? { id: { not: id } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '同一主体名称已存在，请直接在原档案上修改',
      );
    }
    if (id) {
      const existing = await this.prisma.bizParty.findFirst({
        where: { id, ...this.tenantScope.where(tenant) },
        select: { id: true },
      });
      if (!existing) {
        throw new BusinessException(ErrorCode.NOT_FOUND, '主体档案不存在');
      }
      const row = await this.prisma.bizParty.update({ where: { id }, data });
      return this.view(row);
    }
    const row = await this.prisma.bizParty.create({
      data: {
        ...this.tenantScope.where(tenant),
        ...data,
        createdBy: user.userId,
      },
    });
    return this.view(row);
  }

  async remove(user: CurrentUser, rawId: string) {
    const tenant = await this.tenantScope.resolve(user);
    this.assertWrite(tenant);
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '主体编号不合法');
    }
    const existing = await this.prisma.bizParty.findFirst({
      where: { id, ...this.tenantScope.where(tenant) },
      select: { id: true },
    });
    if (!existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '主体档案不存在');
    }
    const engagement = await this.prisma.pjEngagement.findFirst({
      where: { partyId: id, ...this.tenantScope.where(tenant) },
      select: { id: true },
    });
    if (engagement) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该主体已有项目合作记录，不能删除；请改为「已暂停」或「黑名单」',
      );
    }
    await this.prisma.bizParty.delete({ where: { id } });
    return { id, removed: true };
  }
}
