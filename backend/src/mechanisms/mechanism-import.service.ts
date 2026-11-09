import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { clip, orgKey } from '../hrm/hrm.helpers';
import type { HrmOrg } from '../hrm/hrm.scope';
import { json, num } from './mechanism.shared';
import type { PageQuery, Row } from './mechanism.shared';
import { MechanismBase } from './mechanism.base';

/** CSV 导入：字段映射、试运行与任务。 */
export class MechanismImportService extends MechanismBase {
  private readonly importModules: Record<
    string,
    {
      label: string;
      columns: string[];
      importRow: (org: HrmOrg, row: Row) => Promise<string>;
    }
  > = {
    erp_product: {
      label: '产品',
      columns: [
        'code',
        'name',
        'unit',
        'spec',
        'purchasePrice',
        'salePrice',
        'taxRate',
        'note',
      ],
      importRow: async (org, row) => {
        const name = clip(row.name, 120);
        if (!name) throw new Error('产品名称不能为空');
        const code = clip(row.code, 32) || `P${Date.now().toString(36)}`;
        await this.prisma.erpProduct.create({
          data: {
            ...orgKey(org),
            code,
            name,
            unit: clip(row.unit, 16) || '件',
            spec: clip(row.spec, 120),
            purchasePrice: num(row.purchasePrice),
            salePrice: num(row.salePrice),
            taxRate: num(row.taxRate),
            note: clip(row.note, 500),
            createdBy: org.actorId,
          },
        });
        return code;
      },
    },
    erp_vendor: {
      label: '供应商',
      columns: [
        'code',
        'name',
        'contactName',
        'phone',
        'email',
        'taxNo',
        'address',
        'note',
      ],
      importRow: async (org, row) => {
        const name = clip(row.name, 120);
        if (!name) throw new Error('供应商名称不能为空');
        const code = clip(row.code, 32) || `V${Date.now().toString(36)}`;
        await this.prisma.erpVendor.create({
          data: {
            ...orgKey(org),
            code,
            name,
            contactName: clip(row.contactName, 64),
            phone: clip(row.phone, 32),
            email: clip(row.email, 120),
            taxNo: clip(row.taxNo, 32),
            address: clip(row.address, 200),
            note: clip(row.note, 500),
          },
        });
        return code;
      },
    },
    hrm_profile: {
      label: '员工档案',
      columns: [
        'memberUserId',
        'employeeNo',
        'department',
        'employmentType',
        'hourlyRate',
        'joinedAt',
      ],
      importRow: async (org, row) => {
        const memberUserId = clip(row.memberUserId, 64);
        if (!memberUserId) throw new Error('成员账号不能为空');
        await this.prisma.hrmEmployeeProfile.upsert({
          where: {
            orgType_orgUserId_memberUserId: {
              orgType: org.orgType,
              orgUserId: org.orgUserId,
              memberUserId,
            },
          },
          create: {
            ...orgKey(org),
            memberUserId,
            employeeNo: clip(row.employeeNo, 32),
            department: clip(row.department, 64),
            employmentType: clip(row.employmentType, 16) || 'FULL_TIME',
            hourlyRate: num(row.hourlyRate),
            joinedAt: clip(row.joinedAt, 16),
          },
          update: {
            employeeNo: clip(row.employeeNo, 32),
            department: clip(row.department, 64),
            employmentType: clip(row.employmentType, 16) || 'FULL_TIME',
            hourlyRate: num(row.hourlyRate),
            joinedAt: clip(row.joinedAt, 16),
          },
        });
        return memberUserId;
      },
    },
    pj_task: {
      label: '项目任务',
      columns: [
        'projectId',
        'title',
        'type',
        'priority',
        'status',
        'assigneeId',
        'estimateHours',
        'dueDate',
      ],
      importRow: async (org, row) => {
        const projectId = Math.trunc(num(row.projectId));
        const project = await this.prisma.pjProject.findFirst({
          where: {
            id: projectId,
            orgType: org.orgType,
            orgUserId: org.orgUserId,
          },
        });
        if (!project) throw new Error('项目不存在');
        const title = clip(row.title, 200);
        if (!title) throw new Error('任务标题不能为空');
        const task = await this.prisma.pjTask.create({
          data: {
            ...orgKey(org),
            projectId,
            title,
            type: clip(row.type, 16) || 'TASK',
            priority: clip(row.priority, 16) || 'MEDIUM',
            status: clip(row.status, 16) || 'TODO',
            assigneeId: clip(row.assigneeId, 64),
            assigneeType: row.assigneeId ? 'STAFF' : 'NONE',
            estimateHours: num(row.estimateHours),
            dueDate: clip(row.dueDate, 16),
            createdBy: org.actorId,
          },
        });
        return String(task.id);
      },
    },
  };

  private applyMapping(mapping: Row, row: Row): Row {
    const entries = Object.entries(mapping || {});
    if (!entries.length) return row;
    const out: Row = {};
    for (const [target, source] of entries) out[target] = row[String(source)];
    return out;
  }

  async listMaps(user: CurrentUser, query: { module?: string }) {
    const org = await this.org(user);
    const rows = await this.prisma.importFieldMap.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        ...(query.module ? { module: query.module } : {}),
      },
      orderBy: { id: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      module: row.module,
      name: row.name,
      mapping: (row.mapping || {}) as Record<string, string>,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async saveMap(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = Number(body.id ?? 0);
    const data = {
      module: clip(body.module, 32),
      name: clip(body.name, 64),
      mapping: json(body.mapping || {}),
    };
    if (id) {
      const existing = await this.prisma.importFieldMap.findFirst({
        where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '映射方案不存在');
      const row = await this.prisma.importFieldMap.update({
        where: { id },
        data,
      });
      return {
        id: row.id,
        module: row.module,
        name: row.name,
        mapping: row.mapping as Record<string, string>,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    }
    const row = await this.prisma.importFieldMap.create({
      data: { ...orgKey(org), ...data },
    });
    return {
      id: row.id,
      module: row.module,
      name: row.name,
      mapping: row.mapping as Record<string, string>,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async removeMap(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = Number(body.id);
    const row = await this.prisma.importFieldMap.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '映射方案不存在');
    await this.prisma.importFieldMap.delete({ where: { id } });
    return { id };
  }

  async createJob(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const moduleKey = clip(body.module, 32);
    const definition = this.importModules[moduleKey];
    if (!definition)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '该模块不支持导入');
    const rows = (body.rows as Row[]) || [];
    const errors: { row: number; message: string }[] = [];
    let success = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const mapped = this.applyMapping(
        (body.mapping || {}) as Row,
        rows[index],
      );
      try {
        if (body.dryRun !== true) await definition.importRow(org, mapped);
        success += 1;
      } catch (error) {
        errors.push({
          row: index + 1,
          message: clip(
            error instanceof Error ? error.message : '导入失败',
            200,
          ),
        });
      }
    }
    if (body.saveMapAs && body.mapping && Object.keys(body.mapping).length) {
      await this.prisma.importFieldMap.upsert({
        where: {
          orgType_orgUserId_module_name: {
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            module: moduleKey,
            name: clip(body.saveMapAs, 64),
          },
        },
        create: {
          ...orgKey(org),
          module: moduleKey,
          name: clip(body.saveMapAs, 64),
          mapping: json(body.mapping),
        },
        update: { mapping: json(body.mapping) },
      });
    }
    const job = await this.prisma.importJob.create({
      data: {
        ...orgKey(org),
        module: moduleKey,
        fileName: clip(body.fileName, 200),
        total: rows.length,
        success,
        failed: errors.length,
        status: 'DONE',
        errors: json(errors),
        createdBy: user.userId,
        finishedAt: new Date(),
      },
    });
    return this.importJobView(job);
  }

  private importJobView(row: {
    id: number;
    module: string;
    fileName: string;
    total: number;
    success: number;
    failed: number;
    status: string;
    errors: unknown;
    createdAt: Date;
    finishedAt: Date | null;
  }) {
    return {
      id: row.id,
      module: row.module,
      fileName: row.fileName,
      total: row.total,
      success: row.success,
      failed: row.failed,
      status: row.status,
      errors: Array.isArray(row.errors)
        ? (row.errors as { row: number; message: string }[]).map((item) => ({
            row: Number(item.row) || 0,
            message: String(item.message ?? ''),
          }))
        : [],
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : '',
    };
  }

  async jobs(user: CurrentUser, query: PageQuery & { module?: string }) {
    const org = await this.org(user);
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(query.module ? { module: query.module } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.importJob.count({ where }),
      this.prisma.importJob.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: rows.map((row) => this.importJobView(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async removeJob(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = Number(body.id);
    const row = await this.prisma.importJob.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '导入记录不存在');
    await this.prisma.importJob.delete({ where: { id } });
    return { id };
  }
}
