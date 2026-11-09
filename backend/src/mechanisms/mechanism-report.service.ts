import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { clip } from '../hrm/hrm.helpers';
import { num } from './mechanism.shared';
import type { Row } from './mechanism.shared';
import { MechanismBase } from './mechanism.base';

/** 报表目录。 */
export class MechanismReportService extends MechanismBase {
  private reportView(row: {
    id: number;
    code: string;
    name: string;
    module: string;
    description: string;
    path: string;
    icon: string;
    showInMenu: boolean;
    sortOrder: number;
    enabled: boolean;
    planCode: string;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      module: row.module,
      description: row.description,
      path: row.path,
      icon: row.icon,
      showInMenu: row.showInMenu,
      sortOrder: row.sortOrder,
      enabled: row.enabled,
      planCode: row.planCode,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listCatalog(
    user: CurrentUser,
    query: { module?: string; menuOnly?: boolean },
  ) {
    this.requirePlatformAdmin(user);
    const rows = await this.prisma.biReportCatalog.findMany({
      where: {
        ...(query.module ? { module: query.module } : {}),
        ...(query.menuOnly ? { showInMenu: true, enabled: true } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.reportView(row));
  }

  async saveCatalog(user: CurrentUser, body: Row) {
    this.requirePlatformAdmin(user);
    const id = Number(body.id ?? 0);
    const data = {
      code: clip(body.code, 64),
      name: clip(body.name, 80),
      module: clip(body.module, 32),
      description: clip(body.description, 300),
      path: clip(body.path, 200),
      icon: clip(body.icon, 32) || 'chart',
      showInMenu: body.showInMenu !== false,
      sortOrder: Math.trunc(num(body.sortOrder)),
      enabled: body.enabled !== false,
      planCode: clip(body.planCode, 32),
    };
    const row = id
      ? await this.prisma.biReportCatalog.update({ where: { id }, data })
      : await this.prisma.biReportCatalog.create({
          data: { ...data, createdBy: user.userId },
        });
    return this.reportView(row);
  }

  async removeCatalog(user: CurrentUser, body: Row) {
    this.requirePlatformAdmin(user);
    const id = Number(body.id);
    const row = await this.prisma.biReportCatalog.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '报表不存在');
    await this.prisma.biReportCatalog.delete({ where: { id } });
    return { id };
  }
}
