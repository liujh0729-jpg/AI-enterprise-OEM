import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { toJsonObject } from '../shared/json-value';
import { DataTableService } from './data-table.service';
import type { Prisma } from '../../generated/prisma';

/**
 * 表格视图：网格 / 看板 / 汇总三种呈现，视图只影响怎么看，不改数据。
 * 读与 AI 视图共用「有访问权即可看」，保存与删除跟列定义同口径——只归表归属账号。
 * 新增视图落点：`POST /enterprise/data-tables/:id/views`，AI 生成视图是同一张表的一种草稿。
 */
const VIEW_TYPES = ['GRID', 'KANBAN', 'DASHBOARD'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

function normalizeType(value: unknown): ViewType {
  const raw = text(value).trim().toUpperCase();
  return (VIEW_TYPES as readonly string[]).includes(raw)
    ? (raw as ViewType)
    : 'GRID';
}

export function decorateView(row: {
  id: number;
  tableId: number;
  createdBy: string;
  name: string;
  type: string;
  config: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    tableId: row.tableId,
    createdBy: row.createdBy,
    name: row.name,
    type: row.type,
    config: row.config,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DataTableViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tables: DataTableService,
    private readonly identity: IdentityService,
  ) {}

  async list(user: CurrentUser, tableId: number) {
    await this.tables.authorize(user, tableId, 'read');
    const rows = await this.prisma.dataTableView.findMany({
      where: { tableId },
      orderBy: { id: 'asc' },
    });
    return rows.map(decorateView);
  }

  /** 保存视图：带 id 是改，不带是新建。结构归归属账号。 */
  async save(
    user: CurrentUser,
    tableId: number,
    body: Record<string, unknown>,
  ) {
    const access = await this.tables.authorize(user, tableId, 'read');
    if (!access.owner) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '只有表归属账号可以保存视图',
      );
    }
    const name = text(body.name).trim();
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写视图名称');
    const type = normalizeType(body.type);
    const config = toJsonObject(body.config);
    const id = Number(body.id) || 0;
    if (id > 0) {
      const exists = await this.prisma.dataTableView.findFirst({
        where: { id, tableId },
        select: { id: true },
      });
      if (!exists)
        throw new BusinessException(ErrorCode.NOT_FOUND, '该视图不存在');
      const row = await this.prisma.dataTableView.update({
        where: { id },
        data: { name: name.slice(0, 200), type, config },
      });
      await this.identity.audit(
        user.userId,
        '多维表格改视图',
        `#${tableId} ${row.name}`,
      );
      return decorateView(row);
    }
    const row = await this.prisma.dataTableView.create({
      data: {
        tableId,
        createdBy: user.userId,
        name: name.slice(0, 200),
        type,
        config,
      },
    });
    await this.identity.audit(
      user.userId,
      '多维表格存视图',
      `#${tableId} ${row.name}（${type}）`,
    );
    return decorateView(row);
  }

  async remove(user: CurrentUser, tableId: number, viewId: number) {
    const access = await this.tables.authorize(user, tableId, 'read');
    if (!access.owner) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '只有表归属账号可以删除视图',
      );
    }
    const row = await this.prisma.dataTableView.findFirst({
      where: { id: viewId, tableId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '该视图不存在');
    await this.prisma.dataTableView.delete({ where: { id: viewId } });
    await this.identity.audit(
      user.userId,
      '多维表格删视图',
      `#${tableId} ${row.name}`,
    );
    return { id: viewId, deleted: true };
  }
}
