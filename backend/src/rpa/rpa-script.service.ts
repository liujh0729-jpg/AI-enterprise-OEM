import { Prisma } from '../../generated/prisma';
import { pageParam, text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { asJsonArray, toJsonObject, toJsonArray } from '../shared/json-value';
import {
  MAX_SCRIPT_CONTENT,
  SCRIPT_FILE_TYPES_BY_DEVICE,
  SCRIPT_STATUSES,
  assertAutomaJson,
  assertBitbrowserFlowJson,
  assertBitphoneJson,
  assertChromeActions,
  normalizeChoice,
  normalizeDeviceType,
  normalizeFileType,
  normalizeParamsSchema,
  type ParamSpec,
} from './rpa-shared';

/** 一条 RPA 脚本（界面侧与本地执行器看到的同一份正文）。 */
export type RpaScriptRow = {
  id: number;
  createdBy: string;
  name: string;
  description: string;
  category: string;
  deviceType: string;
  fileType: string;
  vendorFlowId: string;
  status: string;
  content: string;
  paramsSchema: Record<string, ParamSpec>;
};

/**
 * RPA 脚本：归属＝账号（与多维表格同口径，切企业 / 服务商 / 职员身份看到的都是同一份）。
 * 被任务引用的脚本禁止删除——任务认领时要按 scriptId 取正文，删了就等于把云端任务掏空。
 */
export class RpaScriptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  async list(
    user: CurrentUser,
    query: {
      status?: string;
      deviceType?: string;
      fileType?: string;
      keyword?: string;
      page?: number | string;
      pageSize?: number | string;
    },
  ) {
    const { pageSize, offset } = pageParam(query.page, query.pageSize, 20);
    const deviceType = query.deviceType
      ? normalizeDeviceType(query.deviceType)
      : undefined;
    const status = query.status
      ? normalizeChoice(query.status, SCRIPT_STATUSES, '脚本状态', 'draft')
      : undefined;
    const fileType = query.fileType
      ? normalizeFileType(query.fileType, deviceType)
      : undefined;
    const keyword = text(query.keyword).trim();
    const where = {
      ...(this.identity.isPlatformAdmin(user)
        ? {}
        : { createdBy: user.userId }),
      ...(deviceType ? { deviceType } : {}),
      ...(status ? { status } : {}),
      ...(fileType ? { fileType } : {}),
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword } },
              { description: { contains: keyword } },
              { category: { contains: keyword } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.rpaScript.count({ where }),
      this.prisma.rpaScript.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: offset,
        take: pageSize,
        // 列表不带正文：脚本正文可能上百 KB，翻页时不必反复搬
        select: {
          id: true,
          createdBy: true,
          name: true,
          description: true,
          category: true,
          tags: true,
          deviceType: true,
          fileType: true,
          vendorFlowId: true,
          status: true,
          paramsSchema: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);
    const taskCount = await this.prisma.rpaTask.groupBy({
      by: ['scriptId'],
      where: { scriptId: { in: rows.map((row) => row.id) } },
      _count: { _all: true },
    });
    const bound = new Map(
      taskCount.map((row) => [row.scriptId, row._count._all]),
    );
    return {
      total,
      list: rows.map((row) => ({
        ...row,
        paramsSchema: normalizeParamsSchema(row.paramsSchema),
        taskCount: bound.get(row.id) || 0,
        owner: row.createdBy === user.userId,
      })),
    };
  }

  async get(user: CurrentUser, id: number) {
    const row = await this.loadVisible(user, id);
    return {
      ...decorate(row),
      taskCount: await this.prisma.rpaTask.count({ where: { scriptId: id } }),
    };
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    const name = text(body.name).trim();
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写脚本名称');
    }
    const deviceType = normalizeDeviceType(body.deviceType);
    const fileType = normalizeFileType(
      body.fileType ?? SCRIPT_FILE_TYPES_BY_DEVICE[deviceType][0],
      deviceType,
    );
    const vendorFlowId = vendorFlowIdOf(body.vendorFlowId, fileType);
    const content = requireContent(body.content);
    assertContent(fileType, content);
    const row = await this.prisma.rpaScript.create({
      data: {
        createdBy: user.userId,
        name: name.slice(0, 200),
        description: text(body.description).trim().slice(0, 500),
        category: text(body.category).trim().slice(0, 64),
        tags: tagList(body.tags),
        deviceType,
        fileType,
        vendorFlowId,
        status: normalizeChoice(
          body.status,
          SCRIPT_STATUSES,
          '脚本状态',
          'draft',
        ),
        content,
        paramsSchema: toJsonObject(normalizeParamsSchema(body.paramsSchema)),
      },
    });
    await this.identity.audit(
      user.userId,
      'RPA保存脚本',
      `#${row.id} ${row.name}`,
    );
    return decorate(row);
  }

  async update(user: CurrentUser, id: number, body: Record<string, unknown>) {
    const row = await this.loadOwned(user, id);
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = text(body.name).trim();
      if (!name) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '脚本名称不能为空');
      }
      data.name = name.slice(0, 200);
    }
    if (body.description !== undefined) {
      data.description = text(body.description).trim().slice(0, 500);
    }
    if (body.category !== undefined) {
      data.category = text(body.category).trim().slice(0, 64);
    }
    if (body.tags !== undefined) data.tags = tagList(body.tags);
    // 改设备必须同时保证脚本类型还在新设备的白名单里；老脚本迁到安卓 / iPhone 时要显式换类型
    let deviceType = row.deviceType;
    if (body.deviceType !== undefined) {
      deviceType = normalizeDeviceType(body.deviceType);
      data.deviceType = deviceType;
    }
    let fileType = row.fileType;
    if (body.fileType !== undefined) {
      fileType = normalizeFileType(body.fileType, deviceType);
      data.fileType = fileType;
    } else if (deviceType !== row.deviceType) {
      fileType = normalizeFileType(fileType, deviceType);
    }
    let vendorFlowId = row.vendorFlowId;
    if (body.vendorFlowId !== undefined) {
      vendorFlowId = vendorFlowIdOf(body.vendorFlowId, fileType);
      data.vendorFlowId = vendorFlowId;
    } else if (fileType !== row.fileType) {
      vendorFlowId = vendorFlowIdOf('', fileType);
      data.vendorFlowId = vendorFlowId;
    }
    if (body.status !== undefined) {
      data.status = normalizeChoice(
        body.status,
        SCRIPT_STATUSES,
        '脚本状态',
        row.status,
      );
    }
    if (body.paramsSchema !== undefined) {
      data.paramsSchema = normalizeParamsSchema(body.paramsSchema);
    }
    if (body.content !== undefined) {
      const content = requireContent(body.content);
      assertContent(fileType, content);
      data.content = content;
    }
    if (!Object.keys(data).length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有需要保存的修改');
    }
    const saved = await this.prisma.rpaScript.update({ where: { id }, data });
    await this.identity.audit(
      user.userId,
      'RPA修改脚本',
      `#${id} ${saved.name}`,
    );
    return decorate(saved);
  }

  async remove(user: CurrentUser, id: number) {
    const row = await this.loadOwned(user, id);
    const bound = await this.prisma.rpaTask.count({ where: { scriptId: id } });
    if (bound) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `该脚本被 ${bound} 个 RPA 任务引用，请先删除任务`,
      );
    }
    await this.prisma.rpaScript.delete({ where: { id } });
    await this.identity.audit(user.userId, 'RPA删除脚本', `#${id} ${row.name}`);
    return { id };
  }

  /** 任务侧取脚本：只认同一账号的脚本，管理员也不能代为跑别人的脚本。 */
  async loadOwned(user: CurrentUser, id: number): Promise<RpaScriptRow> {
    const row = await this.prisma.rpaScript.findUnique({ where: { id } });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, 'RPA 脚本不存在');
    if (row.createdBy !== user.userId) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '该 RPA 脚本归他人所有',
      );
    }
    return decorate(row);
  }

  private async loadVisible(user: CurrentUser, id: number) {
    const row = await this.prisma.rpaScript.findUnique({ where: { id } });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, 'RPA 脚本不存在');
    if (row.createdBy !== user.userId && !this.identity.isPlatformAdmin(user)) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '该 RPA 脚本归他人所有',
      );
    }
    return row;
  }
}

function decorate(row: {
  id: number;
  createdBy: string;
  name: string;
  description: string;
  category: string;
  deviceType: string;
  tags: Prisma.JsonValue;
  fileType: string;
  vendorFlowId: string;
  status: string;
  content: string;
  paramsSchema: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    createdBy: row.createdBy,
    name: row.name,
    description: row.description,
    category: row.category,
    tags: asJsonArray(row.tags),
    deviceType: row.deviceType,
    fileType: row.fileType,
    vendorFlowId: row.vendorFlowId,
    status: row.status,
    content: row.content,
    paramsSchema: normalizeParamsSchema(row.paramsSchema),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function requireContent(raw: unknown) {
  const content = typeof raw === 'string' ? raw : '';
  if (!content.trim()) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写脚本内容');
  }
  if (content.length > MAX_SCRIPT_CONTENT) {
    throw new BusinessException(
      ErrorCode.PAYLOAD_TOO_LARGE,
      `脚本内容超过 ${MAX_SCRIPT_CONTENT} 字符上限`,
    );
  }
  return content;
}

function assertContent(fileType: string, content: string) {
  if (fileType === 'automa_json') assertAutomaJson(content);
  if (fileType === 'bitphone_json') assertBitphoneJson(content);
  if (fileType === 'bitbrowser_rpa') assertBitbrowserFlowJson(content);
  if (fileType === 'chrome_actions') assertChromeActions(content);
}

/** 比特浏览器 RPA 流程只认客户端里的任务 ID（POST /rpa/run 的 body.id），没有它就跑不起来，必填。 */
function vendorFlowIdOf(raw: unknown, fileType: string) {
  const value = text(raw).trim().slice(0, 64);
  if (fileType === 'bitbrowser_rpa' && !value) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '比特浏览器 RPA 流程要填写客户端里的 RPA 任务 ID（执行端拿它调 POST /rpa/run）',
    );
  }
  return value;
}

function tagList(raw: unknown) {
  return toJsonArray(raw);
}
