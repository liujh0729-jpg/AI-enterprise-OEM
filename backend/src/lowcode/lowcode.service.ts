import { Prisma } from '../../generated/prisma';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { UserLookupService } from '../directory/user-lookup.service';
import { listMyOrgs } from '../common/org-scope';
import { IdentityService } from '../identity/identity.service';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { LowCodeAccessService } from './lowcode.access.service';
import {
  BUILTIN_ROLE_DEFS,
  PAGE_TYPE_LABELS,
  ROLE_LABELS,
  TEMPLATES,
  type LowCodeProjectRow,
  actionsOf,
  pageVisible,
  projectTypeLabel,
  templateByKey,
} from './lowcode.shared';

const PROJECT_NAME_MAX = 100;

/** 内建应用成员卡片沿用单值岗位：取 org_staff.positions 的第一条名称（老 title 已并入该字段）。 */
function firstPositionName(value: Prisma.JsonValue): string {
  if (!Array.isArray(value)) return '';
  const first = value[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) return '';
  const name = (first as Record<string, unknown>).name;
  return typeof name === 'string' ? name : '';
}

/** 项目 / 成员 / 角色 / 权限 / 数据规则。实体与行数据见各自服务。 */
export class LowCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly users: UserLookupService,
    private readonly notifications: NotificationService,
    private readonly access: LowCodeAccessService,
  ) {}

  // ---------- 项目 ----------

  async list(
    user: CurrentUser,
    query: { scope?: string; type?: string; keyword?: string },
  ) {
    const memberships = await this.prisma.lowCodeProjectMember.findMany({
      where: { memberUserId: user.userId, status: 'ACTIVE' },
      select: { projectId: true },
    });
    const memberProjectIds = memberships.map((row) => row.projectId);
    const scope = text(query.scope) || 'all';
    const where: Prisma.LowCodeProjectWhereInput = { status: 'ACTIVE' };
    if (scope === 'mine') where.ownerUserId = user.userId;
    else if (scope === 'joined') {
      where.id = { in: memberProjectIds.length ? memberProjectIds : [-1] };
    } else if (scope === 'enterprise') {
      const orgs = await listMyOrgs(this.prisma, this.identity, user.userId);
      where.OR = orgs.length
        ? orgs.map((org) => ({
            orgType: org.orgType,
            orgUserId: org.orgUserId,
          }))
        : [{ id: -1 }];
    } else {
      where.OR = [
        { ownerUserId: user.userId },
        { id: { in: memberProjectIds.length ? memberProjectIds : [-1] } },
      ];
    }
    if (query.type) where.type = text(query.type);
    const keyword = text(query.keyword).trim();
    if (keyword) {
      where.AND = [
        {
          OR: [
            { name: { contains: keyword } },
            { description: { contains: keyword } },
          ],
        },
      ];
    }
    const projects = await this.prisma.lowCodeProject.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return this.views(user, projects);
  }

  async templates(user: CurrentUser) {
    const organizations = await this.access.organizations(user);
    return {
      templates: TEMPLATES.map((item) => ({
        key: item.key,
        type: item.type,
        name: item.name,
        description: item.description,
        icon: item.icon,
      })),
      organizations,
    };
  }

  async create(
    user: CurrentUser,
    body: {
      name: string;
      templateKey: string;
      description: string;
      orgType: string;
      orgUserId: string;
      icon: string;
    },
  ) {
    const name = text(body.name).trim().slice(0, PROJECT_NAME_MAX);
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写项目名称');
    }
    const template =
      templateByKey(text(body.templateKey)) || templateByKey('BLANK');
    if (!template) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '项目模板不存在');
    }
    const orgType = text(body.orgType).trim();
    const orgUserId = text(body.orgUserId).trim();
    await this.access.assertOrganization(user, orgType, orgUserId);

    const created = await this.prisma.$transaction(async (tx) => {
      const project = await tx.lowCodeProject.create({
        data: {
          ownerUserId: user.userId,
          orgType,
          orgUserId,
          name,
          description: text(body.description).trim().slice(0, 500),
          icon: text(body.icon).trim().slice(0, 64) || template.icon,
          type: template.type,
          settings: {},
        },
      });
      await tx.lowCodeRole.createMany({
        data: BUILTIN_ROLE_DEFS.map((role) => ({
          projectId: project.id,
          key: role.key,
          name: role.name,
          builtin: true,
          description: role.description,
        })),
        skipDuplicates: true,
      });
      if (template.entities.length) {
        const entityIds: number[] = [];
        for (const entity of template.entities) {
          const table = await tx.dataTable.create({
            data: {
              createdBy: user.userId,
              name: `${project.name} · ${entity.name}`.slice(0, 200),
              description: `内建应用「${project.name}」的${entity.name}实体`,
              projectId: project.id,
            },
          });
          await tx.dataTableField.createMany({
            data: entity.fields.map((field, index) => ({
              tableId: table.id,
              name: field.name,
              fieldKey: field.key,
              fieldType: field.type,
              sortOrder: index,
              options:
                field.type === 'select' ? { choices: field.choices || [] } : {},
              required: Boolean(field.required),
            })),
          });
          const entityRow = await tx.lowCodeEntity.create({
            data: {
              projectId: project.id,
              dataTableId: table.id,
              name: entity.name,
              icon: entity.icon,
              formLayout: {},
              listLayout: entity.listColumns
                ? { columns: entity.listColumns }
                : {},
              kanbanField: entity.kanbanField || '',
              sort: entityIds.length,
            },
          });
          entityIds.push(entityRow.id);
        }
        for (const [index, page] of template.pages.entries()) {
          await tx.lowCodePage.create({
            data: {
              projectId: project.id,
              type: page.type,
              name: page.name,
              entityId:
                page.entityIndex === undefined
                  ? 0
                  : entityIds[page.entityIndex] || 0,
              config: (page.config || {}) as Prisma.InputJsonValue,
              sort: index,
              builtin: true,
            },
          });
        }
        if (template.approval) {
          const flow = await tx.lowCodeApprovalFlow.create({
            data: {
              projectId: project.id,
              entityId: entityIds[template.approval.entityIndex] || 0,
              name: template.approval.name,
              status: 'ACTIVE',
              version: 1,
            },
          });
          await tx.lowCodeApprovalFlowVersion.create({
            data: {
              flowId: flow.id,
              version: 1,
              nodes: template.approval.nodes as Prisma.InputJsonValue,
              createdBy: user.userId,
            },
          });
        }
      }
      return project;
    });

    await this.identity.audit(
      user.userId,
      '内建应用新建项目',
      `#${created.id} ${created.name}`,
    );
    const [view] = await this.views(user, [created]);
    return view;
  }

  async detail(user: CurrentUser, raw: unknown) {
    const access = await this.access.resolve(user, raw);
    const projectId = access.project.id;
    const [entities, pages, members, roles, myPendingApprovals] =
      await Promise.all([
        this.prisma.lowCodeEntity.findMany({
          where: { projectId },
          orderBy: [{ sort: 'asc' }, { id: 'asc' }],
        }),
        this.prisma.lowCodePage.findMany({
          where: { projectId },
          orderBy: [{ sort: 'asc' }, { id: 'asc' }],
        }),
        this.prisma.lowCodeProjectMember.findMany({
          where: { projectId, status: 'ACTIVE' },
          orderBy: { id: 'asc' },
        }),
        this.prisma.lowCodeRole.findMany({
          where: { projectId },
          orderBy: { id: 'asc' },
        }),
        this.prisma.lowCodeApprovalTask.count({
          where: {
            projectId,
            assigneeUserId: user.userId,
            status: 'PENDING',
          },
        }),
      ]);
    const tables = entities.length
      ? await this.prisma.dataTableField.findMany({
          where: { tableId: { in: entities.map((item) => item.dataTableId) } },
          orderBy: { sortOrder: 'asc' },
        })
      : [];
    const fieldsByTable = new Map<number, typeof tables>();
    for (const field of tables) {
      const list = fieldsByTable.get(field.tableId) || [];
      list.push(field);
      fieldsByTable.set(field.tableId, list);
    }
    const rowCounts = entities.length
      ? await this.prisma.dataTableRow.groupBy({
          by: ['tableId'],
          where: {
            tableId: { in: entities.map((item) => item.dataTableId) },
          },
          _count: { _all: true },
        })
      : [];
    const rowCountMap = new Map(
      rowCounts.map((item) => [item.tableId, item._count._all]),
    );
    const [view] = await this.views(user, [access.project]);
    return {
      project: view,
      myRoleKey: access.roleKey,
      myRoleName: access.roleName,
      permissions: access.permissions,
      entities: entities.map((entity) => ({
        ...entity,
        fields: (fieldsByTable.get(entity.dataTableId) || []).map((field) => ({
          ...field,
          options: field.options as Record<string, unknown>,
        })),
        rowCount: rowCountMap.get(entity.dataTableId) || 0,
      })),
      pages: pages
        .filter((page) => pageVisible(access, page))
        .map((page) => ({
          ...page,
          typeLabel: PAGE_TYPE_LABELS[page.type] || page.type,
        })),
      members: await this.memberViews(members),
      roles: await this.roleViews(projectId, roles),
      myPendingApprovals,
    };
  }

  async update(
    user: CurrentUser,
    raw: unknown,
    body: {
      name?: string;
      description?: string;
      icon?: string;
      status?: string;
      settings?: Record<string, unknown>;
    },
  ) {
    const access = await this.access.requireManage(user, raw);
    const data: Prisma.LowCodeProjectUncheckedUpdateInput = {};
    if (body.name !== undefined) {
      const name = text(body.name).trim().slice(0, PROJECT_NAME_MAX);
      if (!name)
        throw new BusinessException(ErrorCode.BAD_REQUEST, '项目名称不能为空');
      data.name = name;
    }
    if (body.description !== undefined) {
      data.description = text(body.description).trim().slice(0, 500);
    }
    if (body.icon !== undefined)
      data.icon = text(body.icon).trim().slice(0, 64);
    if (body.status !== undefined) {
      data.status = body.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE';
    }
    if (body.settings !== undefined) {
      const current = (access.project.settings || {}) as Record<
        string,
        unknown
      >;
      data.settings = { ...current, ...body.settings } as Prisma.InputJsonValue;
    }
    if (!Object.keys(data).length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有需要保存的修改');
    }
    const row = await this.prisma.lowCodeProject.update({
      where: { id: access.project.id },
      data,
    });
    await this.identity.audit(
      user.userId,
      '内建应用修改项目',
      `#${row.id} ${row.name}`,
    );
    const [view] = await this.views(user, [row]);
    return view;
  }

  async remove(user: CurrentUser, raw: unknown) {
    const access = await this.access.requireOwner(user, raw);
    const projectId = access.project.id;
    const entities = await this.prisma.lowCodeEntity.findMany({
      where: { projectId },
      select: { dataTableId: true },
    });
    const tableIds = entities.map((item) => item.dataTableId);
    await this.prisma.$transaction(async (tx) => {
      if (tableIds.length) {
        await tx.dataTableRow.deleteMany({
          where: { tableId: { in: tableIds } },
        });
        await tx.dataTableField.deleteMany({
          where: { tableId: { in: tableIds } },
        });
        await tx.dataTable.deleteMany({ where: { id: { in: tableIds } } });
      }
      const flows = await tx.lowCodeApprovalFlow.findMany({
        where: { projectId },
        select: { id: true },
      });
      const instances = await tx.lowCodeApprovalInstance.findMany({
        where: { projectId },
        select: { id: true },
      });
      if (flows.length) {
        await tx.lowCodeApprovalFlowVersion.deleteMany({
          where: { flowId: { in: flows.map((item) => item.id) } },
        });
      }
      if (instances.length) {
        await tx.lowCodeApprovalTask.deleteMany({
          where: { instanceId: { in: instances.map((item) => item.id) } },
        });
        await tx.lowCodeApprovalRecord.deleteMany({
          where: { instanceId: { in: instances.map((item) => item.id) } },
        });
      }
      await tx.lowCodeApprovalInstance.deleteMany({ where: { projectId } });
      await tx.lowCodeApprovalFlow.deleteMany({ where: { projectId } });
      await tx.lowCodePage.deleteMany({ where: { projectId } });
      await tx.lowCodeEntity.deleteMany({ where: { projectId } });
      await tx.lowCodeDataRule.deleteMany({ where: { projectId } });
      await tx.lowCodeRolePermission.deleteMany({ where: { projectId } });
      await tx.lowCodeProjectMember.deleteMany({ where: { projectId } });
      await tx.lowCodeRole.deleteMany({ where: { projectId } });
      await tx.lowCodeProject.delete({ where: { id: projectId } });
    });
    await this.identity.audit(
      user.userId,
      '内建应用删除项目',
      `#${projectId} ${access.project.name}`,
    );
    return { removed: true };
  }

  async availableTables(user: CurrentUser, raw: unknown) {
    const access = await this.access.requireManage(user, raw);
    const projectId = access.project.id;
    const tables = await this.prisma.dataTable.findMany({
      where: {
        createdBy: access.project.ownerUserId,
        OR: [{ projectId: 0 }, { projectId }],
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    if (!tables.length) return [];
    const [fieldCounts, rowCounts] = await Promise.all([
      this.prisma.dataTableField.groupBy({
        by: ['tableId'],
        where: { tableId: { in: tables.map((item) => item.id) } },
        _count: { _all: true },
      }),
      this.prisma.dataTableRow.groupBy({
        by: ['tableId'],
        where: { tableId: { in: tables.map((item) => item.id) } },
        _count: { _all: true },
      }),
    ]);
    const fieldMap = new Map(
      fieldCounts.map((item) => [item.tableId, item._count._all]),
    );
    const rowMap = new Map(
      rowCounts.map((item) => [item.tableId, item._count._all]),
    );
    return tables.map((table) => ({
      id: table.id,
      name: table.name,
      description: table.description,
      fieldCount: fieldMap.get(table.id) || 0,
      rowCount: rowMap.get(table.id) || 0,
      projectId: table.projectId,
    }));
  }

  private async views(user: CurrentUser, projects: LowCodeProjectRow[]) {
    if (!projects.length) return [];
    const ids = projects.map((item) => item.id);
    const orgUserIds = [
      ...new Set(projects.map((item) => item.orgUserId).filter(Boolean)),
    ];
    const ownerIds = [...new Set(projects.map((item) => item.ownerUserId))];
    const [
      memberCounts,
      entityCounts,
      pageCounts,
      myMemberships,
      roles,
      names,
      enterprises,
      providers,
    ] = await Promise.all([
      this.prisma.lowCodeProjectMember.groupBy({
        by: ['projectId'],
        where: { projectId: { in: ids }, status: 'ACTIVE' },
        _count: { _all: true },
      }),
      this.prisma.lowCodeEntity.groupBy({
        by: ['projectId'],
        where: { projectId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.lowCodePage.groupBy({
        by: ['projectId'],
        where: { projectId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.lowCodeProjectMember.findMany({
        where: {
          projectId: { in: ids },
          memberUserId: user.userId,
          status: 'ACTIVE',
        },
      }),
      this.prisma.lowCodeRole.findMany({ where: { projectId: { in: ids } } }),
      this.users.displayNames(ownerIds),
      orgUserIds.length
        ? this.prisma.enterpriseProfile.findMany({
            where: { userId: { in: orgUserIds } },
            select: { userId: true, name: true },
          })
        : Promise.resolve([]),
      orgUserIds.length
        ? this.prisma.providerApplication.findMany({
            where: { userId: { in: orgUserIds }, status: 'APPROVED' },
            select: { userId: true, orgName: true },
          })
        : Promise.resolve([]),
    ]);
    const memberMap = new Map(
      memberCounts.map((item) => [item.projectId, item._count._all]),
    );
    const entityMap = new Map(
      entityCounts.map((item) => [item.projectId, item._count._all]),
    );
    const pageMap = new Map(
      pageCounts.map((item) => [item.projectId, item._count._all]),
    );
    const myMemberMap = new Map(
      myMemberships.map((item) => [item.projectId, item]),
    );
    const roleMap = new Map(roles.map((item) => [item.id, item]));
    const enterpriseMap = new Map(
      enterprises.map((item) => [item.userId, item.name]),
    );
    const providerMap = new Map(
      providers.map((item) => [item.userId, item.orgName]),
    );
    return projects.map((project) => {
      const isOwner = project.ownerUserId === user.userId;
      const membership = myMemberMap.get(project.id);
      const role = membership
        ? membership.roleId
          ? roleMap.get(membership.roleId)
          : roles.find(
              (item) => item.projectId === project.id && item.key === 'MEMBER',
            )
        : null;
      const roleKey = isOwner
        ? 'OWNER'
        : role?.key || (membership ? 'MEMBER' : '');
      return {
        ...project,
        type: project.type,
        typeLabel: projectTypeLabel(project.type),
        ownerName: names.get(project.ownerUserId) || project.ownerUserId,
        orgName:
          project.orgType === 'ENTERPRISE'
            ? enterpriseMap.get(project.orgUserId) || ''
            : project.orgType === 'PROVIDER'
              ? providerMap.get(project.orgUserId) || ''
              : '',
        memberCount: memberMap.get(project.id) || 0,
        entityCount: entityMap.get(project.id) || 0,
        pageCount: pageMap.get(project.id) || 0,
        myRoleKey: roleKey,
        myRoleName: roleKey
          ? role?.name || ROLE_LABELS[roleKey] || roleKey
          : '',
        isOwner,
        canManage: isOwner || roleKey === 'ADMIN',
      };
    });
  }

  // ---------- 成员 ----------

  private async memberViews(
    rows: Array<{
      id: number;
      projectId: number;
      memberUserId: string;
      roleId: number;
      department: string;
      title: string;
      status: string;
      createdAt: Date;
    }>,
  ) {
    if (!rows.length) return [];
    const names = await this.users.displayNames(
      rows.map((row) => row.memberUserId),
    );
    const roles = await this.prisma.lowCodeRole.findMany({
      where: {
        projectId: { in: [...new Set(rows.map((row) => row.projectId))] },
      },
    });
    const roleMap = new Map(roles.map((role) => [role.id, role]));
    return rows.map((row) => {
      const role = row.roleId ? roleMap.get(row.roleId) : null;
      return {
        ...row,
        memberName: names.get(row.memberUserId) || row.memberUserId,
        roleKey: role?.key || 'MEMBER',
        roleName: role?.name || ROLE_LABELS.MEMBER,
      };
    });
  }

  private async roleViews(
    projectId: number,
    roles: Array<{
      id: number;
      projectId: number;
      key: string;
      name: string;
      builtin: boolean;
      description: string;
      createdAt: Date;
    }>,
  ) {
    const [counts, permissions] = await Promise.all([
      this.prisma.lowCodeProjectMember.groupBy({
        by: ['roleId'],
        where: { projectId, status: 'ACTIVE' },
        _count: { _all: true },
      }),
      this.prisma.lowCodeRolePermission.findMany({ where: { projectId } }),
    ]);
    const countMap = new Map(
      counts.map((item) => [item.roleId, item._count._all]),
    );
    return roles.map((role) => ({
      ...role,
      memberCount:
        (countMap.get(role.id) || 0) + (role.key === 'OWNER' ? 1 : 0),
      permissions: permissions
        .filter((item) => item.roleId === role.id)
        .map((item) => ({
          resourceType: item.resourceType,
          resourceId: item.resourceId,
          actions: actionsOf(item.actions),
        })),
    }));
  }

  async members(user: CurrentUser, raw: unknown) {
    const access = await this.access.resolve(user, raw);
    const projectId = access.project.id;
    const [rows, roles] = await Promise.all([
      this.prisma.lowCodeProjectMember.findMany({
        where: { projectId, status: 'ACTIVE' },
        orderBy: { id: 'asc' },
      }),
      this.prisma.lowCodeRole.findMany({
        where: { projectId },
        orderBy: { id: 'asc' },
      }),
    ]);
    return {
      rows: await this.memberViews(rows),
      candidates: await this.candidateRows(access, ''),
      roles: await this.roleViews(projectId, roles),
      orgType: access.project.orgType,
    };
  }

  async memberCandidates(
    user: CurrentUser,
    raw: unknown,
    query: { keyword?: string },
  ) {
    const access = await this.access.resolve(user, raw);
    return this.candidateRows(access, text(query.keyword).trim());
  }

  private async candidateRows(
    access: Awaited<ReturnType<LowCodeAccessService['resolve']>>,
    keyword: string,
  ) {
    const project = access.project;
    const existing = await this.prisma.lowCodeProjectMember.findMany({
      where: { projectId: project.id, status: 'ACTIVE' },
      select: { memberUserId: true },
    });
    const taken = new Set(existing.map((row) => row.memberUserId));
    taken.add(project.ownerUserId);
    if (project.orgType && project.orgUserId) {
      const staff = await this.prisma.orgStaff.findMany({
        where: {
          orgType: project.orgType,
          orgUserId: project.orgUserId,
          status: 'ACTIVE',
        },
        orderBy: { id: 'asc' },
      });
      const ids = staff
        .map((row) => row.memberUserId)
        .filter((id) => !taken.has(id));
      const names = await this.users.displayNames(ids);
      const kw = keyword.toLowerCase();
      return staff
        .filter((row) => !taken.has(row.memberUserId))
        .map((row) => ({
          userId: row.memberUserId,
          name: names.get(row.memberUserId) || row.memberUserId,
          department: row.department || '',
          title: firstPositionName(row.positions),
          source: 'ORG',
        }))
        .filter(
          (row) =>
            !kw ||
            row.name.toLowerCase().includes(kw) ||
            row.userId.toLowerCase().includes(kw) ||
            row.department.toLowerCase().includes(kw),
        )
        .slice(0, 200);
    }
    const where: Prisma.UserDirectoryWhereInput = { enabled: 1 };
    if (keyword) {
      where.OR = [
        { userId: { contains: keyword } },
        // username 已小写归一存储；PG 大小写敏感，这里同口径下推，与 MySQL(CI) 命中一致。
        { username: { contains: keyword.toLowerCase() } },
        { displayName: { contains: keyword } },
      ];
    }
    const rows = await this.prisma.userDirectory.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    return rows
      .filter((row) => !taken.has(row.userId))
      .map((row) => ({
        userId: row.userId,
        name: row.displayName || row.username || row.userId,
        department: '',
        title: '',
        source: 'DIRECTORY',
      }));
  }

  async memberAdd(
    user: CurrentUser,
    raw: unknown,
    body: { userIds: string[]; roleId: number },
  ) {
    const access = await this.access.requireManage(user, raw);
    const projectId = access.project.id;
    const roleId = Number(body.roleId || 0);
    if (roleId) await this.assertRole(projectId, roleId, false);
    const userIds = [
      ...new Set(body.userIds.map((item) => text(item)).filter(Boolean)),
    ];
    if (!userIds.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择要添加的成员');
    }
    // 组织项目只能加本组织在职成员；个人项目只加目录里存在的账号
    let allowed = new Set(userIds);
    let staffMap = new Map<
      string,
      { department: string; title: string; memberKind: string }
    >();
    if (access.project.orgType && access.project.orgUserId) {
      const staff = await this.prisma.orgStaff.findMany({
        where: {
          orgType: access.project.orgType,
          orgUserId: access.project.orgUserId,
          status: 'ACTIVE',
          memberUserId: { in: userIds },
        },
      });
      staffMap = new Map(
        staff.map((row) => [
          row.memberUserId,
          {
            department: row.department || '',
            title: firstPositionName(row.positions),
            memberKind: row.memberKind,
          },
        ]),
      );
      allowed = new Set(staff.map((row) => row.memberUserId));
    } else {
      const directory = await this.prisma.userDirectory.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true },
      });
      allowed = new Set(directory.map((row) => row.userId));
    }
    allowed.delete(access.project.ownerUserId);
    let added = 0;
    for (const userId of userIds) {
      if (!allowed.has(userId)) continue;
      const profile = staffMap.get(userId);
      await this.prisma.lowCodeProjectMember.upsert({
        where: {
          projectId_memberUserId: { projectId, memberUserId: userId },
        },
        create: {
          projectId,
          memberUserId: userId,
          roleId,
          department: profile?.department || '',
          title: profile?.title || '',
          status: 'ACTIVE',
        },
        update: {
          roleId,
          department: profile?.department || '',
          title: profile?.title || '',
          status: 'ACTIVE',
        },
      });
      added += 1;
    }
    if (!added) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        access.project.orgType
          ? '所选账号不在本组织的在职成员里'
          : '所选账号不存在或已经是项目成员',
      );
    }
    await this.notifications.notifyMany(
      userIds.filter((id) => allowed.has(id)),
      {
        category: 'automation',
        title: `你被加入内建应用「${access.project.name}」`,
        body: `角色：${access.roleName === '所有者' ? '所有者' : '由项目管理员分配'}`,
        link: `/lowcode/p/${projectId}`,
        entityType: 'lowcode_project',
        entityId: projectId,
      },
    );
    await this.identity.audit(
      user.userId,
      '内建应用添加成员',
      `#${projectId} ${added} 人`,
    );
    return { added, skipped: userIds.length - added };
  }

  async memberUpdate(
    user: CurrentUser,
    raw: unknown,
    memberIdRaw: string,
    body: { roleId: number },
  ) {
    const access = await this.access.requireManage(user, raw);
    const memberId = Number(memberIdRaw);
    const member = await this.prisma.lowCodeProjectMember.findFirst({
      where: { id: memberId, projectId: access.project.id, status: 'ACTIVE' },
    });
    if (!member) throw new BusinessException(ErrorCode.NOT_FOUND, '成员不存在');
    const roleId = Number(body.roleId || 0);
    if (roleId) await this.assertRole(access.project.id, roleId, false);
    await this.prisma.lowCodeProjectMember.update({
      where: { id: member.id },
      data: { roleId },
    });
    await this.identity.audit(
      user.userId,
      '内建应用调整成员角色',
      `#${access.project.id} 成员 ${member.memberUserId} → 角色 ${roleId}`,
    );
    const rows = await this.prisma.lowCodeProjectMember.findMany({
      where: { id: member.id },
    });
    const [view] = await this.memberViews(rows);
    return view;
  }

  async memberRemove(user: CurrentUser, raw: unknown, memberIdRaw: string) {
    const access = await this.access.requireManage(user, raw);
    const memberId = Number(memberIdRaw);
    const member = await this.prisma.lowCodeProjectMember.findFirst({
      where: { id: memberId, projectId: access.project.id, status: 'ACTIVE' },
    });
    if (!member) throw new BusinessException(ErrorCode.NOT_FOUND, '成员不存在');
    await this.prisma.lowCodeProjectMember.update({
      where: { id: member.id },
      data: { status: 'REMOVED', roleId: 0 },
    });
    await this.identity.audit(
      user.userId,
      '内建应用移除成员',
      `#${access.project.id} 成员 ${member.memberUserId}`,
    );
    return { removed: true };
  }

  private async assertRole(
    projectId: number,
    roleId: number,
    allowOwner: boolean,
  ) {
    const role = await this.prisma.lowCodeRole.findFirst({
      where: { id: roleId, projectId },
    });
    if (!role) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '角色不存在');
    }
    if (role.key === 'OWNER' && !allowOwner) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '所有者角色不能分配给成员',
      );
    }
    return role;
  }

  // ---------- 角色与权限 ----------

  async roles(user: CurrentUser, raw: unknown) {
    const access = await this.access.resolve(user, raw);
    const roles = await this.prisma.lowCodeRole.findMany({
      where: { projectId: access.project.id },
      orderBy: { id: 'asc' },
    });
    return this.roleViews(access.project.id, roles);
  }

  async roleSave(
    user: CurrentUser,
    raw: unknown,
    body: { id: number; key: string; name: string; description: string },
  ) {
    const access = await this.access.requireManage(user, raw);
    const projectId = access.project.id;
    const name = text(body.name).trim().slice(0, 50);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写角色名称');
    if (body.id) {
      const role = await this.assertRole(projectId, body.id, true);
      if (role.key === 'OWNER') {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '所有者角色不可修改',
        );
      }
      const row = await this.prisma.lowCodeRole.update({
        where: { id: role.id },
        data: {
          name,
          description: text(body.description).trim().slice(0, 200),
        },
      });
      await this.identity.audit(
        user.userId,
        '内建应用修改角色',
        `#${projectId} ${row.name}`,
      );
      const [view] = await this.roleViews(projectId, [row]);
      return view;
    }
    const key =
      text(body.key)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '_')
        .slice(0, 32) || `CUSTOM_${Date.now().toString(36).toUpperCase()}`;
    const exists = await this.prisma.lowCodeRole.findFirst({
      where: { projectId, key },
    });
    if (exists) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '角色标识已存在，请换一个',
      );
    }
    const row = await this.prisma.lowCodeRole.create({
      data: {
        projectId,
        key,
        name,
        builtin: false,
        description: text(body.description).trim().slice(0, 200),
      },
    });
    await this.identity.audit(
      user.userId,
      '内建应用新建角色',
      `#${projectId} ${row.name}`,
    );
    const [view] = await this.roleViews(projectId, [row]);
    return view;
  }

  async roleDelete(user: CurrentUser, raw: unknown, roleIdRaw: string) {
    const access = await this.access.requireManage(user, raw);
    const role = await this.assertRole(
      access.project.id,
      Number(roleIdRaw),
      true,
    );
    if (role.builtin) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '内置角色不能删除');
    }
    const used = await this.prisma.lowCodeProjectMember.count({
      where: {
        projectId: access.project.id,
        roleId: role.id,
        status: 'ACTIVE',
      },
    });
    if (used) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `还有 ${used} 名成员使用该角色，请先调整他们的角色`,
      );
    }
    await this.prisma.$transaction([
      this.prisma.lowCodeRolePermission.deleteMany({
        where: { roleId: role.id },
      }),
      this.prisma.lowCodeDataRule.deleteMany({ where: { roleId: role.id } }),
      this.prisma.lowCodeRole.delete({ where: { id: role.id } }),
    ]);
    await this.identity.audit(
      user.userId,
      '内建应用删除角色',
      `#${access.project.id} ${role.name}`,
    );
    return { removed: true };
  }

  async rolePermissions(user: CurrentUser, raw: unknown, roleIdRaw: string) {
    const access = await this.access.requireManage(user, raw);
    const projectId = access.project.id;
    const role = await this.assertRole(projectId, Number(roleIdRaw), true);
    const [permissions, entities, pages] = await Promise.all([
      this.prisma.lowCodeRolePermission.findMany({
        where: { roleId: role.id },
      }),
      this.prisma.lowCodeEntity.findMany({
        where: { projectId },
        orderBy: [{ sort: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.lowCodePage.findMany({
        where: { projectId },
        orderBy: [{ sort: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const fields = entities.length
      ? await this.prisma.dataTableField.findMany({
          where: { tableId: { in: entities.map((item) => item.dataTableId) } },
          orderBy: { sortOrder: 'asc' },
        })
      : [];
    const [roleView] = await this.roleViews(projectId, [role]);
    return {
      role: roleView,
      permissions: permissions.map((item) => ({
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        actions: actionsOf(item.actions),
      })),
      entities: entities.map((entity) => ({
        id: entity.id,
        name: entity.name,
        fields: fields
          .filter((field) => field.tableId === entity.dataTableId)
          .map((field) => ({ fieldKey: field.fieldKey, name: field.name })),
      })),
      pages: pages.map((page) => ({
        id: page.id,
        name: page.name,
        type: page.type,
      })),
    };
  }

  async rolePermissionSave(
    user: CurrentUser,
    raw: unknown,
    roleIdRaw: string,
    body: {
      permissions: Array<{
        resourceType: string;
        resourceId: string;
        actions: string[];
      }>;
    },
  ) {
    const access = await this.access.requireManage(user, raw);
    const projectId = access.project.id;
    const role = await this.assertRole(projectId, Number(roleIdRaw), true);
    if (role.key === 'OWNER') {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '所有者权限不可修改');
    }
    const validTypes = new Set(['PAGE', 'ENTITY', 'FIELD', 'ACTION']);
    const rows = body.permissions
      .filter(
        (item) =>
          validTypes.has(item.resourceType) &&
          item.resourceId.length <= 64 &&
          Array.isArray(item.actions),
      )
      .map((item) => ({
        projectId,
        roleId: role.id,
        resourceType: item.resourceType,
        resourceId: text(item.resourceId).slice(0, 64),
        actions: [
          ...new Set(
            item.actions.map((action) => text(action)).filter(Boolean),
          ),
        ].slice(0, 12),
      }));
    await this.prisma.$transaction(async (tx) => {
      await tx.lowCodeRolePermission.deleteMany({
        where: { roleId: role.id, projectId },
      });
      if (rows.length) {
        await tx.lowCodeRolePermission.createMany({
          data: rows.map((row) => ({ ...row, actions: row.actions })),
        });
      }
    });
    await this.identity.audit(
      user.userId,
      '内建应用保存角色权限',
      `#${projectId} ${role.name} · ${rows.length} 条`,
    );
    return { saved: rows.length };
  }

  // ---------- 数据规则 ----------

  async dataRules(
    user: CurrentUser,
    raw: unknown,
    query: { entityId?: number },
  ) {
    const access = await this.access.requireManage(user, raw);
    const entityId = Number(query.entityId || 0);
    const rows = await this.prisma.lowCodeDataRule.findMany({
      where: {
        projectId: access.project.id,
        ...(entityId ? { OR: [{ entityId }, { entityId: 0 }] } : {}),
      },
      orderBy: { id: 'asc' },
    });
    return rows;
  }

  async dataRuleSave(
    user: CurrentUser,
    raw: unknown,
    body: {
      id: number;
      entityId: number;
      roleId: number;
      field: string;
      op: string;
      value: string;
    },
  ) {
    const access = await this.access.requireManage(user, raw);
    const projectId = access.project.id;
    const field = text(body.field).trim().slice(0, 64);
    if (!field)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择规则字段');
    const allowedOps = new Set([
      '=',
      '!=',
      '>',
      '>=',
      '<',
      '<=',
      'IN',
      'LIKE',
      'BETWEEN',
    ]);
    if (!allowedOps.has(body.op)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '不支持的比较方式');
    }
    const entityId = Number(body.entityId || 0);
    if (entityId) {
      const entity = await this.prisma.lowCodeEntity.findFirst({
        where: { id: entityId, projectId },
      });
      if (!entity)
        throw new BusinessException(ErrorCode.BAD_REQUEST, '实体不存在');
      if (field !== 'createdBy') {
        const column = await this.prisma.dataTableField.findFirst({
          where: { tableId: entity.dataTableId, fieldKey: field },
        });
        if (!column) {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            `字段「${field}」不存在`,
          );
        }
      }
    }
    const roleId = Number(body.roleId || 0);
    if (roleId) await this.assertRole(projectId, roleId, false);
    const value = text(body.value).trim().slice(0, 200);
    if (!value)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写规则值');
    const data = { entityId, roleId, field, op: body.op, value };
    const row = body.id
      ? await this.prisma.lowCodeDataRule
          .updateMany({
            where: { id: body.id, projectId },
            data,
          })
          .then(async () => {
            const found = await this.prisma.lowCodeDataRule.findFirst({
              where: { id: body.id, projectId },
            });
            if (!found)
              throw new BusinessException(ErrorCode.NOT_FOUND, '规则不存在');
            return found;
          })
      : await this.prisma.lowCodeDataRule.create({
          data: { projectId, ...data },
        });
    await this.identity.audit(
      user.userId,
      '内建应用保存数据规则',
      `#${projectId} ${field} ${body.op} ${value}`,
    );
    return row;
  }

  async dataRuleDelete(user: CurrentUser, raw: unknown, ruleIdRaw: string) {
    const access = await this.access.requireManage(user, raw);
    const ruleId = Number(ruleIdRaw);
    const rule = await this.prisma.lowCodeDataRule.findFirst({
      where: { id: ruleId, projectId: access.project.id },
    });
    if (!rule) throw new BusinessException(ErrorCode.NOT_FOUND, '规则不存在');
    await this.prisma.lowCodeDataRule.delete({ where: { id: rule.id } });
    await this.identity.audit(
      user.userId,
      '内建应用删除数据规则',
      `#${access.project.id} 规则 ${rule.id}`,
    );
    return { removed: true };
  }
}
