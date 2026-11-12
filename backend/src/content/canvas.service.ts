import type {
  CanvasAssetRef,
  CanvasDoc,
  CanvasNode,
  CanvasProject,
  CanvasProjectSummary,
} from '@enterprise/contracts';
import { text } from '../common/api';
import { toJsonInput } from '../common/json-input';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  planNodeRun,
  readCanvasDoc,
  deriveCoverUrl,
  type CanvasRunSpec,
} from './canvas-plan';
import { ContentJobService } from './content-job.service';
import { DigitalAssetService } from './digital-asset.service';

/** 单画布节点上限：整包 JSON 一次读写，太大既卡前端也卡保存。 */
const NODE_LIMIT = 200;
const TITLE_MAX = 80;
const ASSET_REFS_MAX = 200;

type CanvasRow = {
  id: number;
  userId: string;
  title: string;
  doc: unknown;
  version: number;
  status: string;
  templateId: number;
  assetRefs: unknown;
  nodeCount: number;
  coverUrl: string;
  createdAt: Date;
  updatedAt: Date;
};

function assetRefsOf(raw: unknown): CanvasAssetRef[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: CanvasAssetRef[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const assetId = Number(row.assetId);
    if (!Number.isFinite(assetId)) continue;
    out.push({
      assetId,
      type: text(row.type),
      name: text(row.name),
      url: text(row.url),
    });
    if (out.length >= ASSET_REFS_MAX) break;
  }
  return out;
}

function summary(row: CanvasRow): CanvasProjectSummary {
  return {
    id: row.id,
    title: row.title,
    version: row.version,
    status: row.status,
    templateId: row.templateId,
    nodeCount: row.nodeCount,
    coverUrl: row.coverUrl,
    assetRefs: assetRefsOf(row.assetRefs),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function detail(row: CanvasRow): CanvasProject {
  return { ...summary(row), doc: readCanvasDoc(row.doc) };
}

function cleanTitle(raw: unknown) {
  return text(raw).trim().slice(0, TITLE_MAX);
}

/** 保存时从整包 JSON 派生冗余列：节点数、资源引用摘要、封面、画布文档版本。 */
function derive(doc: CanvasDoc) {
  const nodes: CanvasNode[] = doc.nodes;
  const seen = new Set<number>();
  const assetRefs: CanvasAssetRef[] = [];
  for (const node of nodes) {
    if (node.type !== 'asset' || node.data.kind !== 'asset') continue;
    const assetId = Number(node.data.assetId);
    if (!Number.isFinite(assetId) || seen.has(assetId)) continue;
    seen.add(assetId);
    assetRefs.push({
      assetId,
      type: text(node.data.media),
      name: text(node.data.name),
      url: text(node.data.url),
    });
    if (assetRefs.length >= ASSET_REFS_MAX) break;
  }
  // 提示词里 @ 的数字资产也是引用：按资源查引用时不漏
  for (const node of nodes) {
    if (assetRefs.length >= ASSET_REFS_MAX) break;
    if (node.type !== 'generate' || node.data.kind !== 'generate') continue;
    for (const ref of node.data.refs) {
      const assetId = Number(ref.assetId);
      if (!Number.isFinite(assetId) || seen.has(assetId)) continue;
      seen.add(assetId);
      assetRefs.push({
        assetId,
        type: text(ref.media),
        name: text(ref.name),
        url: text(ref.url),
      });
      if (assetRefs.length >= ASSET_REFS_MAX) break;
    }
  }
  return {
    nodeCount: nodes.length,
    assetRefs,
    // 封面取图与产物回写同口径：最近一次成功产物优先，素材图兜底
    coverUrl: deriveCoverUrl(doc),
    docVersion: Number(doc.version) > 0 ? Math.round(Number(doc.version)) : 1,
  };
}

export type CanvasRunBody = CanvasRunSpec & {
  channelId?: number;
  model?: string;
  channelName?: string;
};

/**
 * AI 画布：主表存整包 JSON 快照，version 做乐观锁；nodeCount / assetRefs / coverUrl
 * 由保存时派生并落成真实列（列表排序、按资源查引用不扫 JSON）。
 */
export class CanvasProjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: ContentJobService,
    private readonly digitalAssets: DigitalAssetService,
  ) {}

  private async rowOf(user: CurrentUser, id: number) {
    const row = await this.prisma.contentCanvasProject.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '画布不存在');
    }
    return row as CanvasRow;
  }

  private idOf(id: string) {
    const value = Number(id);
    if (!Number.isInteger(value) || value <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '画布编号无效');
    }
    return value;
  }

  async list(user: CurrentUser, query: Record<string, unknown>) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)));
    const keyword = text(query.keyword).trim();
    const status = text(query.status).trim();
    const where = {
      userId: user.userId,
      ...(status ? { status } : {}),
      ...(keyword ? { title: { contains: keyword } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.contentCanvasProject.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.contentCanvasProject.count({ where }),
    ]);
    return {
      list: rows.map((row) => summary(row as CanvasRow)),
      total,
      page,
      pageSize,
    };
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    const doc: CanvasDoc = readCanvasDoc(body.doc);
    const derived = derive(doc);
    const row = await this.prisma.contentCanvasProject.create({
      data: {
        userId: user.userId,
        title: cleanTitle(body.title) || '未命名画布',
        doc: toJsonInput(doc),
        version: 0,
        templateId: Number(body.templateId) || 0,
        nodeCount: derived.nodeCount,
        assetRefs: toJsonInput(derived.assetRefs),
        coverUrl: derived.coverUrl,
      },
    });
    return detail(row);
  }

  async get(user: CurrentUser, id: string) {
    return detail(await this.rowOf(user, this.idOf(id)));
  }

  /**
   * 保存：整包 JSON 一次写回；body.version 与库里的不一致就 409（别处改过了），
   * 避免用旧快照覆盖同事刚保存的版本。
   */
  async save(user: CurrentUser, id: string, body: Record<string, unknown>) {
    const canvasId = this.idOf(id);
    const row = await this.rowOf(user, canvasId);
    const doc = readCanvasDoc(body.doc);
    if (doc.nodes.length > NODE_LIMIT) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `单张画布最多 ${NODE_LIMIT} 个节点：请新建一张画布，并用画布上的「复制这个节点到另一张画布」把节点搬过去`,
      );
    }
    if (body.version !== undefined && body.version !== null) {
      const expected = Number(body.version);
      if (Number.isInteger(expected) && expected !== row.version) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '画布已在别处更新，请刷新后再保存',
        );
      }
    }
    const derived = derive(doc);
    const updated = await this.prisma.contentCanvasProject.updateMany({
      where: { id: canvasId, userId: user.userId, version: row.version },
      data: {
        title: cleanTitle(body.title) || row.title,
        doc: toJsonInput(doc),
        version: { increment: 1 },
        // 文档 version 与行 version 分开：文档 version 给前端做格式演进，行 version 做乐观锁
        nodeCount: derived.nodeCount,
        assetRefs: toJsonInput(derived.assetRefs),
        coverUrl: derived.coverUrl,
      },
    });
    if (updated.count === 0) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '画布已在别处更新，请刷新后再保存',
      );
    }
    return detail(await this.rowOf(user, canvasId));
  }

  async rename(user: CurrentUser, id: string, body: Record<string, unknown>) {
    const canvasId = this.idOf(id);
    await this.rowOf(user, canvasId);
    const title = cleanTitle(body.title);
    if (!title) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '画布名称不能为空');
    }
    await this.prisma.contentCanvasProject.update({
      where: { id: canvasId },
      data: { title },
    });
    return detail(await this.rowOf(user, canvasId));
  }

  async remove(user: CurrentUser, id: string) {
    const canvasId = this.idOf(id);
    await this.rowOf(user, canvasId);
    await this.prisma.contentCanvasProject.delete({ where: { id: canvasId } });
    return { removed: true };
  }

  /**
   * 跨画布复用节点：把当前画布上的一个节点（含它的设置与最近产物）复制到另一张自己的画布。
   * 大画布撞到 200 节点上限时，用户靠这一步把节点搬到新画布继续做，不用手工重建。
   */
  async copyNode(
    user: CurrentUser,
    id: string,
    nodeId: string,
    body: Record<string, unknown>,
  ) {
    const sourceId = this.idOf(id);
    const targetId = this.idOf(text(body.targetCanvasId));
    if (sourceId === targetId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '目标画布就是当前画布，请选择另一张',
      );
    }
    const source = await this.rowOf(user, sourceId);
    const target = await this.rowOf(user, targetId);
    const sourceDoc = readCanvasDoc(source.doc);
    const node = sourceDoc.nodes.find((item) => item.id === nodeId);
    if (!node) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '节点不存在，可能已被删除',
      );
    }
    const targetDoc = readCanvasDoc(target.doc);
    if (targetDoc.nodes.length >= NODE_LIMIT) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `目标画布已达 ${NODE_LIMIT} 个节点上限，请先在目标画布精简后再复制`,
      );
    }
    const prefix = node.id.replace(/\d+$/, '') || 'n';
    const max = targetDoc.nodes.reduce((acc, item) => {
      const num = Number(item.id.replace(/^[a-z]+/, ''));
      return Number.isFinite(num) && num > acc ? num : acc;
    }, 0);
    const bottom = targetDoc.nodes.reduce(
      (acc, item) => Math.max(acc, item.y),
      0,
    );
    targetDoc.nodes.push({
      ...node,
      id: `${prefix}${max + 1}`,
      x: 80,
      y: bottom + 240,
      data: { ...node.data },
    });
    const derived = derive(targetDoc);
    const updated = await this.prisma.contentCanvasProject.updateMany({
      where: { id: targetId, userId: user.userId, version: target.version },
      data: {
        doc: toJsonInput(targetDoc),
        version: { increment: 1 },
        nodeCount: derived.nodeCount,
        assetRefs: toJsonInput(derived.assetRefs),
        coverUrl: derived.coverUrl,
      },
    });
    if (updated.count === 0) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '目标画布刚在别处更新，请刷新后重试',
      );
    }
    return { canvasId: targetId, title: target.title };
  }

  /**
   * 跑一个生成节点：图 → 表单（planNodeRun 纯函数）→ 入队；
   * 生图按 count 批量建任务，同一批共享 runId，节点据此聚合结果。
   */
  async runNode(
    user: CurrentUser,
    id: string,
    nodeId: string,
    body: CanvasRunBody = {},
    token?: string,
  ) {
    const canvasId = this.idOf(id);
    const row = await this.rowOf(user, canvasId);
    const doc = readCanvasDoc(row.doc);
    // 素材以资产 ID 为准：提交前按 assetId 解析最新可用地址（含共享范围），断链直接报错
    await this.refreshAssetUrls(user, doc, nodeId);
    const plan = planNodeRun(doc, nodeId, body);
    const primary = Object.values(plan.models)[0];
    const jobs = await this.jobs.enqueue(
      user,
      token,
      {
        tool: plan.tool,
        input: plan.input,
        models: plan.models,
        count: plan.count,
      },
      {
        source: 'canvas',
        canvasId,
        nodeId,
        count: plan.count,
      },
    );
    const runId = jobs[0]?.runId || '';
    await this.rememberRun(
      user,
      canvasId,
      nodeId,
      runId,
      plan.media,
      primary
        ? {
            channelId: primary.channelId,
            model: primary.model,
            channelName: text(body.channelName).trim(),
          }
        : undefined,
      body,
    );
    return { runId, jobs };
  }

  /**
   * 素材以资产 ID 为准：提交前把生成节点入边上的素材地址按 assetId 重新解析（本人资产优先，
   * 其次他人共享给我的），断链就报「已删除或无权访问」。解析只作用于本次提交的临时文档，
   * 不回写快照——地址随资产变动，不该固化在画布里。
   */
  private async refreshAssetUrls(
    user: CurrentUser,
    doc: CanvasDoc,
    nodeId: string,
  ) {
    const byId = new Map(doc.nodes.map((item) => [item.id, item]));
    const incoming = doc.edges.filter((edge) => edge.to === nodeId);
    for (const edge of incoming) {
      const node = byId.get(edge.from);
      if (!node || node.data.kind !== 'asset' || !node.data.assetId) continue;
      const resolved = await this.digitalAssets.resolveForUse(
        user,
        node.data.assetId,
      );
      if (!resolved?.url) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `素材「${node.data.name || `#${node.data.assetId}`}」已删除或无权访问，请在画布上重新从数字资产选择`,
        );
      }
      node.data = {
        ...node.data,
        url: resolved.url,
        previewUrl:
          node.data.media === 'image' ? resolved.url : node.data.previewUrl,
        name: resolved.name || node.data.name,
      };
    }
    const target = byId.get(nodeId);
    if (!target || target.data.kind !== 'generate') return;
    // 提示词里 @ 的数字资产同样以 assetId 为准：地址变了跟着变，断链当场报错
    for (const ref of target.data.refs) {
      if (!ref.assetId) continue;
      const resolved = await this.digitalAssets.resolveForUse(
        user,
        ref.assetId,
      );
      if (!resolved?.url) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `提示词里引用的「${ref.name || `#${ref.assetId}`}」已删除或无权访问，请重新从数字资产选择`,
        );
      }
      ref.url = resolved.url;
      if (resolved.name) ref.name = resolved.name;
    }
  }

  /** 把这次提交的模型/规格/runId 写回节点，刷新后画布仍记得上次怎么出的图。 */
  private async rememberRun(
    user: CurrentUser,
    canvasId: number,
    nodeId: string,
    runId: string,
    media: 'image' | 'video' | 'music',
    picked:
      { channelId: number; model: string; channelName: string } | undefined,
    body: CanvasRunBody,
  ) {
    const row = await this.rowOf(user, canvasId);
    const doc = readCanvasDoc(row.doc);
    const node = doc.nodes.find((item) => item.id === nodeId);
    if (!node || node.data.kind !== 'generate') return;
    node.data = {
      ...node.data,
      media,
      lastRunId: runId,
      ...(picked?.model
        ? {
            channelId: picked.channelId,
            model: picked.model,
            channelName: picked.channelName || node.data.channelName,
          }
        : {}),
      ...(body.size !== undefined ? { size: String(body.size) } : {}),
      ...(body.ratio !== undefined ? { ratio: String(body.ratio) } : {}),
      ...(body.resolution !== undefined
        ? { resolution: String(body.resolution) }
        : {}),
      ...(body.duration !== undefined
        ? { duration: Number(body.duration) }
        : {}),
      ...(body.count !== undefined ? { count: Number(body.count) } : {}),
    };
    await this.prisma.contentCanvasProject.update({
      where: { id: canvasId },
      data: { doc: toJsonInput(doc) },
    });
  }
}
