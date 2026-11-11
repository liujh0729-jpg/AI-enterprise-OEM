import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { clip, ds, orgKey } from '../hrm/hrm.helpers';
import type { HrmOrg } from '../hrm/hrm.scope';
import { csvCell, json } from './mechanism.shared';
import type { PageQuery, Row } from './mechanism.shared';
import { MechanismBase } from './mechanism.base';

/** 按模块导出与导出任务。 */
export class MechanismExportService extends MechanismBase {
  private readonly exportModules = [
    {
      module: 'hrm_profile',
      label: '员工档案',
      columns: [
        'memberUserId',
        'employeeNo',
        'department',
        'employmentType',
        'status',
        'joinedAt',
      ],
    },
    {
      module: 'pj_task',
      label: '项目任务',
      columns: [
        'id',
        'projectId',
        'title',
        'type',
        'priority',
        'status',
        'assigneeId',
        'estimateHours',
        'dueDate',
      ],
    },
    {
      module: 'pj_time_log',
      label: '工时流水',
      columns: [
        'id',
        'projectId',
        'taskId',
        'principalId',
        'workDate',
        'durationMinutes',
        'status',
        'source',
      ],
    },
    {
      module: 'erp_product',
      label: '产品',
      columns: [
        'id',
        'code',
        'name',
        'unit',
        'purchasePrice',
        'salePrice',
        'taxRate',
        'status',
      ],
    },
    {
      module: 'erp_vendor',
      label: '供应商',
      columns: [
        'id',
        'code',
        'name',
        'contactName',
        'phone',
        'email',
        'status',
      ],
    },
    {
      module: 'erp_stock',
      label: '库存',
      columns: [
        'warehouseId',
        'variantId',
        'onHand',
        'inTransit',
        'locked',
        'reorderPoint',
      ],
    },
  ];

  private readonly exportRowProviders = new Map<
    string,
    (org: HrmOrg, filters: Row) => Promise<Row[]>
  >();

  registerExportModule(
    definition: { module: string; label: string; columns: string[] },
    rows: (org: HrmOrg, filters: Row) => Promise<Row[]>,
  ) {
    const index = this.exportModules.findIndex(
      (item) => item.module === definition.module,
    );
    if (index >= 0) this.exportModules.splice(index, 1);
    this.exportModules.push(definition);
    this.exportRowProviders.set(definition.module, rows);
  }

  modules() {
    return this.exportModules.map((item) => ({
      module: item.module,
      label: item.label,
      columns: item.columns.map((key) => ({ key, label: key })),
      formats: ['csv', 'json'] as ('csv' | 'json')[],
    }));
  }

  private async exportRows(
    org: HrmOrg,
    moduleKey: string,
    filters: Row = {},
  ): Promise<Row[]> {
    const provider = this.exportRowProviders.get(moduleKey);
    if (provider) return provider(org, filters);
    const where = { orgType: org.orgType, orgUserId: org.orgUserId };
    switch (moduleKey) {
      case 'hrm_profile':
        return (
          await this.prisma.hrmEmployeeProfile.findMany({
            where,
            orderBy: { id: 'asc' },
          })
        ).map((row) => ({
          memberUserId: row.memberUserId,
          employeeNo: row.employeeNo,
          department: row.department,
          employmentType: row.employmentType,
          status: row.status,
          joinedAt: row.joinedAt,
        }));
      case 'pj_task':
        return (
          await this.prisma.pjTask.findMany({ where, orderBy: { id: 'asc' } })
        ).map((row) => ({
          id: row.id,
          projectId: row.projectId,
          title: row.title,
          type: row.type,
          priority: row.priority,
          status: row.status,
          assigneeId: row.assigneeId,
          estimateHours: ds(row.estimateHours),
          dueDate: row.dueDate,
        }));
      case 'pj_time_log':
        return (
          await this.prisma.pjTimeLog.findMany({
            where,
            orderBy: { id: 'asc' },
          })
        ).map((row) => ({
          id: row.id,
          projectId: row.projectId,
          taskId: row.taskId,
          principalId: row.principalId,
          workDate: row.workDate,
          durationMinutes: row.durationMinutes,
          status: row.status,
          source: row.source,
        }));
      case 'erp_product':
        return (
          await this.prisma.erpProduct.findMany({
            where,
            orderBy: { id: 'asc' },
          })
        ).map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          unit: row.unit,
          purchasePrice: ds(row.purchasePrice),
          salePrice: ds(row.salePrice),
          taxRate: ds(row.taxRate),
          status: row.status,
        }));
      case 'erp_vendor':
        return (
          await this.prisma.erpVendor.findMany({
            where,
            orderBy: { id: 'asc' },
          })
        ).map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          contactName: row.contactName,
          phone: row.phone,
          email: row.email,
          status: row.status,
        }));
      case 'erp_stock':
        return (
          await this.prisma.erpStock.findMany({ where, orderBy: { id: 'asc' } })
        ).map((row) => ({
          warehouseId: row.warehouseId,
          variantId: row.variantId,
          onHand: ds(row.onHand),
          inTransit: ds(row.inTransit),
          locked: ds(row.locked),
          reorderPoint: ds(row.reorderPoint),
        }));
      default:
        throw new BusinessException(ErrorCode.BAD_REQUEST, '该模块不支持导出');
    }
  }

  private exportJobView(row: {
    id: number;
    module: string;
    format: string;
    status: string;
    rowCount: number;
    progress: number;
    fileKey: string;
    error: string;
    createdAt: Date;
    finishedAt: Date | null;
  }) {
    return {
      id: row.id,
      module: row.module,
      format: row.format as 'csv' | 'json',
      status: row.status,
      rowCount: row.rowCount,
      progress: row.progress,
      // 不再回传桶的公开直链（下载后离职仍可访问）；改为需登录态复权的认证端点。
      fileUrl: row.fileKey
        ? `/api/backend/enterprise/export/jobs/${row.id}/download`
        : '',
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : '',
    };
  }

  async createExportJob(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const moduleKey = clip(body.module, 32);
    const format = body.format === 'json' ? 'json' : 'csv';
    const definition = this.exportModules.find(
      (item) => item.module === moduleKey,
    );
    if (!definition)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '该模块不支持导出');
    const rows = await this.exportRows(
      org,
      moduleKey,
      (body.filters || {}) as Row,
    );
    let fileKey = '';
    let status = 'DONE';
    let error = '';
    try {
      const content =
        format === 'json'
          ? JSON.stringify(rows, null, 2)
          : [
              definition.columns.join(','),
              ...rows.map((row) =>
                definition.columns.map((key) => csvCell(row[key])).join(','),
              ),
            ].join('\n');
      const uploaded = await this.storage.put(
        `exports/${org.orgUserId}/${moduleKey}-${Date.now()}.${format}`,
        Buffer.from(content, 'utf8'),
      );
      fileKey = uploaded.key;
    } catch (err) {
      status = 'FAILED';
      error = clip(
        err instanceof Error ? err.message : '导出文件写入失败',
        500,
      );
    }
    const job = await this.prisma.exportJob.create({
      data: {
        ...orgKey(org),
        module: moduleKey,
        format,
        status,
        rowCount: rows.length,
        progress: status === 'DONE' ? 100 : 0,
        fileKey,
        error,
        filters: json(body.filters || {}),
        createdBy: user.userId,
        finishedAt: new Date(),
      },
    });
    return this.exportJobView(job);
  }

  async exportJobs(user: CurrentUser, query: PageQuery) {
    const org = await this.org(user);
    const where = { orgType: org.orgType, orgUserId: org.orgUserId };
    const [total, rows] = await Promise.all([
      this.prisma.exportJob.count({ where }),
      this.prisma.exportJob.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: rows.map((row) => this.exportJobView(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * 认证下载导出文件：每次按当前账号重新解析组织关系并复核在册资格，
   * 离职/被移出组织后即使拿到旧链接也取不到内容；文件按组织隔离，不泄露存在性。
   */
  async download(user: CurrentUser, rawId: string) {
    const org = await this.org(user);
    const standing = await this.scope.isStanding(user.userId, {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
    });
    if (!standing) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '导出文件不存在或已失效',
      );
    }
    const id = Number(rawId);
    const row =
      Number.isInteger(id) && id > 0
        ? await this.prisma.exportJob.findFirst({
            where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
          })
        : null;
    if (!row?.fileKey) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '导出文件不存在或已失效',
      );
    }
    const content = await this.storage.read(row.fileKey).catch(() => null);
    if (!content) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '导出文件已不可用');
    }
    return {
      id: row.id,
      module: row.module,
      format: row.format as 'csv' | 'json',
      fileName: `${row.module}-${row.id}.${row.format}`,
      content: content.toString('utf8'),
    };
  }

  async removeExportJob(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = Number(body.id);
    const row = await this.prisma.exportJob.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '导出记录不存在');
    if (row.fileKey)
      await this.storage.remove(row.fileKey).catch(() => undefined);
    await this.prisma.exportJob.delete({ where: { id } });
    return { id };
  }
}
