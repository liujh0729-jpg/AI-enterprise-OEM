import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { toJsonInput } from '../common/json-input';
import { CrmScopeService } from './crm.scope';
import { int, iso, jsonArray, money, moneyStr } from './crm.helpers';

export class CrmProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: CrmScopeService,
  ) {}

  async list(user: CurrentUser, query: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
    const keyword = text(query.keyword).trim();
    const where = {
      ownerUserId: ctx.ownerUserId,
      ...(keyword ? { name: { contains: keyword } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.crmProduct.findMany({
        where,
        orderBy: [{ sort: 'asc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.crmProduct.count({ where }),
    ]);
    return {
      list: rows.map((row) => ({
        id: row.id,
        name: row.name,
        code: row.code,
        price: moneyStr(row.price),
        status: row.status,
        sort: row.sort,
        description: row.description,
        createdAt: iso(row.createdAt),
      })),
      total,
      page,
      pageSize,
    };
  }

  async save(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const name = text(body.name).trim().slice(0, 120);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写产品名称');
    const data = {
      name,
      code: text(body.code).slice(0, 60),
      price: money(body.price),
      status: body.status === undefined ? true : Boolean(body.status),
      sort: int(body.sort),
      description: text(body.description).slice(0, 2000),
    };
    const id = int(body.id);
    if (id) {
      const existing = await this.prisma.crmProduct.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '产品不存在');
    }
    const row = id
      ? await this.prisma.crmProduct.update({ where: { id }, data })
      : await this.prisma.crmProduct.create({
          data: { ownerUserId: ctx.ownerUserId, ...data },
        });
    if (row.ownerUserId !== ctx.ownerUserId) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '产品不存在');
    }
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      price: moneyStr(row.price),
      status: row.status,
      sort: row.sort,
      description: row.description,
      createdAt: iso(row.createdAt),
    };
  }

  async remove(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const id = Number(rawId);
    const row = await this.prisma.crmProduct.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '产品不存在');
    await this.prisma.crmProduct.delete({ where: { id } });
    return { removed: true };
  }

  async prices(user: CurrentUser) {
    const ctx = await this.scope.requireMember(user);
    const rows = await this.prisma.crmProductPrice.findMany({
      where: { ownerUserId: ctx.ownerUserId },
      orderBy: [{ sort: 'asc' }, { id: 'desc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      sort: row.sort,
      items: jsonArray(row.items),
      createdAt: iso(row.createdAt),
    }));
  }

  async savePrice(user: CurrentUser, body: Record<string, unknown>) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const name = text(body.name).trim().slice(0, 120);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写价格表名称');
    const data = {
      name,
      status: body.status === undefined ? true : Boolean(body.status),
      sort: int(body.sort),
      items: toJsonInput(jsonArray(body.items)),
    };
    const id = int(body.id);
    if (id) {
      const existing = await this.prisma.crmProductPrice.findFirst({
        where: { id, ownerUserId: ctx.ownerUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '价格表不存在');
    }
    const row = id
      ? await this.prisma.crmProductPrice.update({ where: { id }, data })
      : await this.prisma.crmProductPrice.create({
          data: { ownerUserId: ctx.ownerUserId, ...data },
        });
    if (row.ownerUserId !== ctx.ownerUserId) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '价格表不存在');
    }
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      sort: row.sort,
      items: jsonArray(row.items),
      createdAt: iso(row.createdAt),
    };
  }

  async removePrice(user: CurrentUser, rawId: string) {
    const ctx = await this.scope.requireMember(user);
    this.scope.assertAdmin(ctx);
    const id = Number(rawId);
    const row = await this.prisma.crmProductPrice.findFirst({
      where: { id, ownerUserId: ctx.ownerUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '价格表不存在');
    await this.prisma.crmProductPrice.delete({ where: { id } });
    return { removed: true };
  }
}
