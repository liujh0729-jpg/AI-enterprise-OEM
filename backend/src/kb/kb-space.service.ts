import { KB_PAGE_TYPES } from '@enterprise/contracts';
import { ErrorCode } from '../common/error-code';
import { BusinessException } from '../common/business.exception';
import type { CurrentUser } from '../auth/current-user';
import type { IdentityService } from '../identity/identity.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { KbSpace } from '../../generated/prisma';
import { toJsonInput } from '../common/json-input';
import { clip, iso } from './kb-util';

/**
 * 知识空间与可见性（§10.2）：读面 PRIVATE=owner、ORG=组织主账号与在册成员、SHARED/PUBLIC=全站登录用户；
 * 写面 owner/平台管理员/组织主账号（ORG 空间）/空间内绑定的 WRITE 消费者（consumerId=账号 id）。
 * KbSpaceBinding 提供「当前知识库」会话上下文（Agent/分身切库），一人一行。
 */

type SpaceWithCounts = KbSpace & { pageCount: number; sourceCount: number };

/** 与契约 createKbSpaceBodySchema.parse 输出同形（服务侧自带类型，与 governance 同一做法）。 */
export interface CreateSpaceInput {
  name: string;
  description: string;
  scopeType:
    | 'PERSONAL'
    | 'ENTERPRISE'
    | 'PROVIDER'
    | 'AGENT'
    | 'AVATAR'
    | 'SERVICE_DESK';
  orgType?: 'ENTERPRISE' | 'PROVIDER';
  orgUserId?: string;
  visibility: 'PRIVATE' | 'ORG' | 'SHARED' | 'PUBLIC';
}
export interface UpdateSpaceInput {
  id: number;
  name?: string;
  description?: string;
  visibility?: 'PRIVATE' | 'ORG' | 'SHARED' | 'PUBLIC';
  status?: 'ACTIVE' | 'ARCHIVED';
}
export interface SaveSchemaInput {
  spaceId: number;
  pageTypes?: { type: string; fields: string[]; description: string }[];
  workflowPrompt?: string;
}

const DEFAULT_PAGE_TYPES = KB_PAGE_TYPES.map((type) => ({
  type,
  fields: ['title', 'tags', 'sources'],
  description:
    type === 'ENTITY'
      ? '实体页：人/组织/产品/客户等单一对象的稳定事实，wikilink 的落点'
      : type === 'CONCEPT'
        ? '概念页：术语、方法、规则的权威解释（默认页型）'
        : type === 'SUMMARY'
          ? '摘要页：单个源文档的编译产物（Ingest 生成），带源溯源'
          : type === 'COMPARISON'
            ? '对照页：多对象异同表，决策参考'
            : type === 'SYNTHESIS'
              ? '综合页：跨源结论（Ask 好答案沉淀），引用必须齐全'
              : type === 'INDEX'
                ? '索引页：空间目录（自动维护快照）'
                : '日志页：时间线叙事（consolidate 聚合产物）',
}));

const DEFAULT_WORKFLOW_PROMPT = [
  '# 空间维护规范',
  '1. 每个结论必须可溯源：页内引用使用 [[slug]] 链接，来源写入 sources。',
  '2. 新页默认 CONCEPT；单源编译产物用 SUMMARY；跨源结论用 SYNTHESIS。',
  '3. Agent/MCP 写入先进 PENDING_REVIEW，人工或规则校验通过后发布。',
  '4. 矛盾不静默覆盖：保留两说并标注出处，交给 Lint/人工裁决。',
].join('\n');

export class KbSpaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  isWriteConsumer(spaceId: number, userId: string): Promise<boolean> {
    return this.prisma.kbConsumer
      .findFirst({
        where: { spaceId, consumerId: userId, role: 'WRITE' },
      })
      .then((row) => Boolean(row));
  }

  async canRead(space: KbSpace, user: CurrentUser): Promise<boolean> {
    if (this.identity.isPlatformAdmin(user)) return true;
    if (space.ownerUserId === user.userId) return true;
    if (space.visibility === 'SHARED' || space.visibility === 'PUBLIC') {
      return true;
    }
    if (
      space.visibility === 'ORG' &&
      space.orgUserId &&
      (space.orgUserId === user.userId ||
        Boolean(
          await this.prisma.orgStaff.findFirst({
            where: {
              orgType: space.orgType || 'ENTERPRISE',
              orgUserId: space.orgUserId,
              memberUserId: user.userId,
              status: 'ACTIVE',
            },
          }),
        ))
    ) {
      return true;
    }
    return false;
  }

  async canWrite(space: KbSpace, user: CurrentUser): Promise<boolean> {
    if (this.identity.isPlatformAdmin(user)) return true;
    if (space.ownerUserId === user.userId) return true;
    return this.isWriteConsumer(space.id, user.userId);
  }

  /** 读闸：不存在/无权统一 404（不泄露空间存在性）。 */
  async loadReadable(spaceId: number, user: CurrentUser): Promise<KbSpace> {
    const space = await this.prisma.kbSpace.findUnique({
      where: { id: spaceId },
    });
    if (!space || !(await this.canRead(space, user))) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '知识空间不存在');
    }
    return space;
  }

  async loadWritable(spaceId: number, user: CurrentUser): Promise<KbSpace> {
    const space = await this.prisma.kbSpace.findUnique({
      where: { id: spaceId },
    });
    if (!space)
      throw new BusinessException(ErrorCode.NOT_FOUND, '知识空间不存在');
    // 先读后写两级闸；但 WRITE 消费者隐含读（否则绑定即写永远不可达）
    const readable = await this.canRead(space, user);
    const writable = await this.canWrite(space, user);
    if (!readable && !writable) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '知识空间不存在');
    }
    if (!writable) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '没有该知识空间的写权限',
      );
    }
    if (space.status === 'ARCHIVED') {
      throw new BusinessException(ErrorCode.CONFLICT, '空间已归档，不可写入');
    }
    return space;
  }

  async toView(
    space: KbSpace,
    counts?: { pageCount: number; sourceCount: number },
  ): Promise<SpaceWithCounts> {
    const resolved =
      counts ??
      (space.id
        ? {
            pageCount: await this.prisma.kbPage.count({
              where: { spaceId: space.id },
            }),
            sourceCount: await this.prisma.kbSource.count({
              where: { spaceId: space.id },
            }),
          }
        : { pageCount: 0, sourceCount: 0 });
    return { ...space, ...resolved };
  }

  async listSpaces(user: CurrentUser) {
    const rows = await this.prisma.kbSpace.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    const visible: SpaceWithCounts[] = [];
    for (const row of rows) {
      if (await this.canRead(row, user)) visible.push(await this.toView(row));
    }
    return visible;
  }

  async createSpace(body: CreateSpaceInput, user: CurrentUser) {
    let orgUserId = '';
    let orgType = '';
    if (body.orgType) {
      orgType = body.orgType;
      orgUserId = body.orgUserId || user.userId;
      if (orgUserId !== user.userId && !this.identity.isPlatformAdmin(user)) {
        throw new BusinessException(
          ErrorCode.ROLE_MISMATCH,
          '只能为本人名下的组织建空间',
        );
      }
    }
    const scopeType: string =
      body.scopeType === 'PERSONAL' && orgType ? 'ENTERPRISE' : body.scopeType;
    const row = await this.prisma.kbSpace.create({
      data: {
        orgType,
        orgUserId,
        ownerUserId: user.userId,
        scopeType,
        name: clip(body.name.trim(), 120),
        description: clip(body.description.trim(), 500),
        visibility: body.visibility,
      },
    });
    await putLog(
      this.prisma,
      row.id,
      'WRITE',
      `创建空间「${row.name}」`,
      {},
      user.userId,
    );
    return this.toView(row, { pageCount: 0, sourceCount: 0 });
  }

  async updateSpace(body: UpdateSpaceInput, user: CurrentUser) {
    const space = await this.loadReadable(body.id, user);
    if (
      space.ownerUserId !== user.userId &&
      !this.identity.isPlatformAdmin(user)
    ) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '仅空间归属人可修改空间设置',
      );
    }
    const row = await this.prisma.kbSpace.update({
      where: { id: space.id },
      data: {
        ...(body.name !== undefined
          ? { name: clip(body.name.trim(), 120) }
          : {}),
        ...(body.description !== undefined
          ? { description: clip(body.description.trim(), 500) }
          : {}),
        ...(body.visibility !== undefined
          ? { visibility: body.visibility }
          : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      },
    });
    return this.toView(row);
  }

  getSpace(id: number, user: CurrentUser) {
    return this.loadReadable(id, user).then((row) => this.toView(row));
  }

  /** 会话绑定空间（当前知识库）：读自身绑定，未绑定 null。 */
  async currentSpace(user: CurrentUser) {
    const binding = await this.prisma.kbSpaceBinding.findUnique({
      where: { userId: user.userId },
    });
    if (!binding) return null;
    const space = await this.prisma.kbSpace.findUnique({
      where: { id: binding.spaceId },
    });
    if (!space || !(await this.canRead(space, user))) return null;
    return this.toView(space);
  }

  async selectSpace(spaceId: number, user: CurrentUser) {
    const space = await this.loadReadable(spaceId, user);
    await this.prisma.kbSpaceBinding.upsert({
      where: { userId: user.userId },
      create: { userId: user.userId, spaceId: space.id },
      update: { spaceId: space.id },
    });
    return this.toView(space);
  }

  /** 用户默认记忆空间（§10.4）：AGENT 归属、私见，找不到就建。 */
  async ensureAgentSpace(userId: string): Promise<KbSpace> {
    const existing = await this.prisma.kbSpace.findFirst({
      where: { ownerUserId: userId, scopeType: 'AGENT', status: 'ACTIVE' },
      orderBy: { id: 'asc' },
    });
    if (existing) return existing;
    return this.prisma.kbSpace.create({
      data: {
        ownerUserId: userId,
        scopeType: 'AGENT',
        name: '我的智能记忆库',
        description: 'Agent 操作记忆提炼与对话回流用的默认空间（自动创建）',
        visibility: 'PRIVATE',
      },
    });
  }

  /** 召回/回流用的生效空间：显式 spaceId > 会话绑定 > AGENT 默认空间。 */
  async resolveActiveSpace(
    user: CurrentUser,
    spaceId?: number,
  ): Promise<KbSpace> {
    if (spaceId) return this.loadReadable(spaceId, user);
    const binding = await this.prisma.kbSpaceBinding.findUnique({
      where: { userId: user.userId },
    });
    if (binding) {
      const space = await this.prisma.kbSpace.findUnique({
        where: { id: binding.spaceId },
      });
      if (space && (await this.canRead(space, user))) return space;
    }
    return this.ensureAgentSpace(user.userId);
  }

  async schemaView(spaceId: number, user: CurrentUser) {
    await this.loadReadable(spaceId, user);
    const row = await this.prisma.kbSchema.findUnique({
      where: { spaceId },
    });
    return {
      spaceId,
      pageTypes: row ? normalizePageTypes(row.pageTypes) : DEFAULT_PAGE_TYPES,
      workflowPrompt: row?.workflowPrompt || DEFAULT_WORKFLOW_PROMPT,
      version: row?.version ?? 0,
      updatedBy: row?.updatedBy || '',
      updatedAt: iso(row?.updatedAt),
    };
  }

  async saveSchema(body: SaveSchemaInput, user: CurrentUser) {
    await this.loadWritable(body.spaceId, user);
    const existing = await this.prisma.kbSchema.findUnique({
      where: { spaceId: body.spaceId },
    });
    const row = await this.prisma.kbSchema.upsert({
      where: { spaceId: body.spaceId },
      create: {
        spaceId: body.spaceId,
        pageTypes: toJsonInput(body.pageTypes ?? DEFAULT_PAGE_TYPES),
        workflowPrompt: body.workflowPrompt ?? DEFAULT_WORKFLOW_PROMPT,
        version: 1,
        updatedBy: user.userId,
      },
      update: {
        ...(body.pageTypes ? { pageTypes: toJsonInput(body.pageTypes) } : {}),
        ...(body.workflowPrompt !== undefined
          ? { workflowPrompt: body.workflowPrompt }
          : {}),
        version: (existing?.version ?? 0) + 1,
        updatedBy: user.userId,
      },
    });
    return this.schemaView(row.spaceId, user);
  }
}

function normalizePageTypes(raw: unknown) {
  if (!Array.isArray(raw)) return DEFAULT_PAGE_TYPES;
  const list = raw
    .filter(
      (item): item is { type: string; fields: string[]; description: string } =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as { type?: unknown }).type === 'string',
    )
    .map((item) => ({
      type: String(item.type).slice(0, 24),
      fields: Array.isArray(item.fields)
        ? item.fields.map(String).slice(0, 30)
        : [],
      description: String(item.description ?? '').slice(0, 300),
    }));
  return list.length ? list : DEFAULT_PAGE_TYPES;
}

/** 时间线台账写入（各服务共用）：写失败绝不影响主流程。 */
export async function putLog(
  prisma: PrismaService,
  spaceId: number,
  kind: string,
  summary: string,
  detail: Record<string, unknown>,
  actorUserId: string,
) {
  await prisma.kbLog
    .create({
      data: {
        spaceId,
        kind,
        summary: clip(summary, 500),
        detail: toJsonInput(detail),
        actorUserId,
      },
    })
    .catch(() => undefined);
}
