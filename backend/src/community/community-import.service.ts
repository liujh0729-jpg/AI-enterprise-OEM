import { randomUUID } from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { Logger } from '../common/logger';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { UserLookupService } from '../directory/user-lookup.service';
import { OssService } from '../oss/oss.service';
import { PrismaService } from '../prisma/prisma.service';
import { toJsonInput } from '../common/json-input';
import {
  ComfyClient,
  MAX_DOWNLOAD_BYTES,
  type ComfyCloudFile,
  type ComfyCloudJob,
} from './comfy.client';
import {
  collectMedia,
  containsCredentialKey,
  looksLikeVideoWorkflow,
  safeSegment,
  suggestSlots,
  titleOfJob,
  titleOfWorkflowFile,
  uiToApi,
} from './community-comfy-convert';
import {
  detectFormat,
  newUserWorkflowCode,
  validatePublishedGraph,
  validateSlots,
  type CommunityRegistrySlot,
  type CommunityWorkflowGraph,
} from './community-workflow-registry';

const logger = new Logger('CommunityImportService');

/** 预览时最多清点多少个历史任务（列表接口轻量，取 100 足够给出量级）。 */
const PREVIEW_JOB_LIMIT = 100;
/** 单个任务最多转存多少个媒体（coverKeys 列只放 8 个）。 */
const MEDIA_PER_JOB = 8;
/** 单个任务详情只允许占这么多字节。 */
const JOB_DETAIL_BYTES = 24 * 1024 * 1024;

export type ImportTaskState = 'running' | 'done' | 'failed';

type ImportTask = {
  id: string;
  ownerUserId: string;
  state: ImportTaskState;
  total: number;
  done: number;
  importedWorkflows: number;
  importedMedia: number;
  skipped: number;
  failed: number;
  message: string;
  startedAt: string;
  finishedAt: string;
};

export type ImportStatus = {
  taskId: string;
  state: 'idle' | ImportTaskState;
  total: number;
  done: number;
  importedWorkflows: number;
  importedMedia: number;
  skipped: number;
  failed: number;
  message: string;
  startedAt: string;
  finishedAt: string;
};

const IDLE_STATUS: ImportStatus = {
  taskId: '',
  state: 'idle',
  total: 0,
  done: 0,
  importedWorkflows: 0,
  importedMedia: 0,
  skipped: 0,
  failed: 0,
  message: '',
  startedAt: '',
  finishedAt: '',
};

/**
 * Comfy Cloud → 本站的迁移服务（平台管理员专用）。
 *
 * 数据来源（v1 接口，v2 在 Comfy Cloud 上不提供历史列表）：
 *  - `GET /api/userdata?dir=workflows/&recurse=true`：已保存的工作流文件；
 *  - `GET /api/jobs?status=completed` + `/api/jobs/{id}`：历史任务的执行图与产物；
 *  - `GET /api/view`：按 ComfyUI outputs 的 `{filename, subfolder, type}` 取媒体。
 *
 * 落地口径：
 *  - 工作流作者挂在执行迁移的管理员账号名下（ownerUserId = 当前管理员）；
 *  - 图片/视频一律转存进后台设定好的存储渠道（OssService → 后台 OSS 配置），
 *    对象键写进 `coverKeys`，第一张就是封面；
 *  - 迁移前必须验 Key、验存储渠道；重复迁移按 `comfyUrl` 来源标记幂等跳过。
 *
 * 任务是进程内的（与运行调度器同口径）：同一管理员同时只能跑一个，进程重启后回到 idle。
 */
export class CommunityImportService {
  private readonly tasks = new Map<string, ImportTask>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly users: UserLookupService,
    private readonly oss: OssService,
    private readonly comfy: ComfyClient,
  ) {}

  /** Key 只在这里做形状兜底；绝不回显、绝不进日志。 */
  private cleanKey(raw: unknown): string {
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (key.length < 8 || key.length > 500) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '请填写 Comfy Cloud 的 API Key',
      );
    }
    return key;
  }

  /**
   * 验证 Key 并清点可迁移内容：只调列表接口，不下载媒体、不写库。
   * 工作流目录不存在（404）按 0 处理——新账号没有已保存工作流是正常的。
   */
  async preview(user: CurrentUser, rawKey: unknown) {
    this.identity.requireAdmin(user);
    const apiKey = this.cleanKey(rawKey);
    await this.comfy.verifyKey(apiKey);
    const [files, jobs] = await Promise.all([
      this.comfy.listWorkflowFiles(apiKey).catch(() => [] as ComfyCloudFile[]),
      this.comfy
        .listJobs(apiKey, { status: 'completed', limit: PREVIEW_JOB_LIMIT })
        .catch(() => [] as ComfyCloudJob[]),
    ]);
    const completed = jobs.filter((job) => job.status === 'completed');
    return {
      verified: true,
      workflows: files.length,
      jobs: completed.length,
      media: completed.reduce(
        (sum, job) => sum + Math.min(job.outputsCount, MEDIA_PER_JOB),
        0,
      ),
    };
  }

  /**
   * 开始同步迁移：先验证 Key 与存储渠道，再清点条目、登记进程内任务并立刻返回。
   * 真正的工作流 JSON 转换与媒体转存在后台逐条执行，进度由 `status` 轮询。
   */
  async start(user: CurrentUser, body: Record<string, unknown>) {
    this.identity.requireAdmin(user);
    const apiKey = this.cleanKey(body.apiKey);
    const includeWorkflows = body.includeWorkflows !== false;
    const includeJobs = body.includeJobs !== false;
    const limit = Math.min(100, Math.max(1, Number(body.limit) || 20));
    if (!includeWorkflows && !includeJobs) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '至少要选择迁移工作流或历史任务中的一项',
      );
    }
    const previous = this.tasks.get(user.userId);
    if (previous?.state === 'running') {
      throw new BusinessException(
        ErrorCode.RATE_LIMITED,
        '上一次迁移还在进行中，请等它跑完再开始新的迁移。',
      );
    }
    // 先占位再验证：验证与清点都要打网络，期间第二个请求不能从「还没有任务」这里穿过去。
    const task: ImportTask = {
      id: randomUUID(),
      ownerUserId: user.userId,
      state: 'running',
      total: 0,
      done: 0,
      importedWorkflows: 0,
      importedMedia: 0,
      skipped: 0,
      failed: 0,
      message: '正在验证 Key 与存储渠道…',
      startedAt: new Date().toISOString(),
      finishedAt: '',
    };
    this.tasks.set(user.userId, task);

    let files: ComfyCloudFile[] = [];
    let jobs: ComfyCloudJob[] = [];
    try {
      // 点击迁移时的两道硬验证：Key 必须能打上游，媒体要落进去的存储渠道必须可用。
      await this.comfy.verifyKey(apiKey);
      if (includeJobs) {
        try {
          await this.oss.testConnection();
        } catch {
          throw new BusinessException(
            ErrorCode.SERVICE_UNAVAILABLE,
            '后台存储渠道不可用，图片和视频没法转存。请先到后台把 OSS 配置验证通过再来迁移。',
          );
        }
      }

      files = includeWorkflows
        ? await this.comfy
            .listWorkflowFiles(apiKey)
            .catch(() => [] as ComfyCloudFile[])
        : [];
      jobs = includeJobs
        ? (await this.comfy.listJobs(apiKey, { status: 'completed', limit }))
            .filter((job) => job.status === 'completed')
            .slice(0, limit)
        : [];

      const total = files.length + jobs.length;
      if (!total) {
        throw new BusinessException(
          ErrorCode.VALIDATION_ERROR,
          includeJobs
            ? '这个账号下没有可迁移的已保存工作流或已完成任务。'
            : '这个账号下没有可迁移的已保存工作流。',
        );
      }
      task.total = total;
      task.message = '正在迁移…';
    } catch (error) {
      // 验证没过就等于没开始：把上一次的完成态还回去，status 不要停在空任务上。
      if (previous) this.tasks.set(user.userId, previous);
      else this.tasks.delete(user.userId);
      throw error;
    }

    logger.log(
      `迁移任务开始 owner=${user.userId} task=${task.id} files=${files.length} jobs=${jobs.length}`,
    );

    void this.run(user, apiKey, task, { files, jobs }).catch((error) => {
      // run 内部已兜底；这里只防止未捕获拒绝把进程日志刷脏
      logger.warn(
        `迁移任务异常退出 task=${task.id} reason=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });

    return { taskId: task.id, total: task.total };
  }

  /** 进度：只回当前管理员自己那条任务（多管理员互不串台）。 */
  status(user: CurrentUser): ImportStatus {
    this.identity.requireAdmin(user);
    const task = this.tasks.get(user.userId);
    if (!task) return { ...IDLE_STATUS };
    return {
      taskId: task.id,
      state: task.state,
      total: task.total,
      done: task.done,
      importedWorkflows: task.importedWorkflows,
      importedMedia: task.importedMedia,
      skipped: task.skipped,
      failed: task.failed,
      message: task.message,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
    };
  }

  private async run(
    user: CurrentUser,
    apiKey: string,
    task: ImportTask,
    input: { files: ComfyCloudFile[]; jobs: ComfyCloudJob[] },
  ): Promise<void> {
    try {
      // 节点清单只在册与否这一个用途：危险节点与未知节点一律不进社区。
      const nodeNames = await this.comfy.nodeNames(apiKey);
      const ownerName =
        (await this.users.displayName(user.userId)) || user.username;

      for (const file of input.files) {
        try {
          const result = await this.importWorkflowFile(
            user,
            apiKey,
            nodeNames,
            ownerName,
            file,
          );
          if (result === 'imported') task.importedWorkflows += 1;
          else task.skipped += 1;
        } catch (error) {
          task.failed += 1;
          task.message = this.reasonOf(error, file.path);
        } finally {
          task.done += 1;
        }
      }

      for (const job of input.jobs) {
        try {
          const result = await this.importJob(
            user,
            apiKey,
            nodeNames,
            ownerName,
            task,
            job,
          );
          if (result === 'imported') task.importedWorkflows += 1;
          else task.skipped += 1;
        } catch (error) {
          task.failed += 1;
          task.message = this.reasonOf(error, `任务 ${job.id.slice(0, 8)}`);
        } finally {
          task.done += 1;
        }
      }

      task.state = 'done';
      task.message =
        `迁移完成：工作流 ${task.importedWorkflows} 条，` +
        `媒体 ${task.importedMedia} 个，跳过 ${task.skipped} 条，失败 ${task.failed} 条。`;
      await this.identity.audit(
        user.userId,
        '迁移 Comfy Cloud 工作流',
        `工作流 ${task.importedWorkflows} 条 / 媒体 ${task.importedMedia} 个 / ` +
          `跳过 ${task.skipped} / 失败 ${task.failed}`,
      );
      logger.log(
        `迁移任务完成 task=${task.id} workflows=${task.importedWorkflows} media=${task.importedMedia} skipped=${task.skipped} failed=${task.failed}`,
      );
    } catch (error) {
      task.state = 'failed';
      task.message =
        error instanceof BusinessException
          ? error.message
          : '迁移中断，请检查 Key 与存储渠道后重试。';
      logger.warn(
        `迁移任务失败 task=${task.id} reason=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      task.finishedAt = new Date().toISOString();
    }
  }

  private reasonOf(error: unknown, label: string): string {
    const reason =
      error instanceof BusinessException
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    return `${label}：${reason}`.slice(0, 300);
  }

  /** 已保存工作流文件：UI 格式先转 API，转不动就存原文当浏览型卡片。 */
  private async importWorkflowFile(
    user: CurrentUser,
    apiKey: string,
    nodeNames: Set<string>,
    ownerName: string,
    file: ComfyCloudFile,
  ): Promise<'imported' | 'skipped'> {
    const source = `comfy-cloud://workflow/${file.path}`.slice(0, 500);
    const existing = await this.prisma.communityWorkflow.findFirst({
      where: { comfyUrl: source },
      select: { id: true },
    });
    if (existing) return 'skipped';

    const bytes = await this.comfy.getUserDataFile(apiKey, file.path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
      return 'skipped';
    }
    if (containsCredentialKey(parsed)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '工作流里带有疑似凭据字段，已拒绝迁移入库',
      );
    }

    const prepared = this.prepareGraph(parsed, nodeNames);
    const title = titleOfWorkflowFile(file.path);
    const mediaType =
      prepared.format === 'api' && looksLikeVideoWorkflow(prepared.graph)
        ? 'video'
        : 'image';
    await this.prisma.communityWorkflow.create({
      data: {
        code: newUserWorkflowCode(),
        source: 'USER',
        ownerUserId: user.userId,
        ownerName,
        title,
        summary: `从 Comfy Cloud 迁移的已保存工作流（${file.path}）`.slice(
          0,
          500,
        ),
        description:
          `由平台管理员从 Comfy Cloud 迁移入库：${file.path}` +
          (prepared.reason ? `\n\n降级为仅浏览：${prepared.reason}` : ''),
        category: mediaType === 'video' ? 'video' : 'image',
        groupLabel: '',
        tags: toJsonInput(['Comfy Cloud', '迁移']),
        mediaType,
        format: prepared.format,
        workflowJson: toJsonInput(prepared.graph),
        slots: toJsonInput(prepared.slots),
        coverKeys: toJsonInput([]),
        comfyUrl: source,
        status: 'APPROVED',
        auditNote: '平台管理员从 Comfy Cloud 迁移，作者挂在管理员账号名下',
        auditedAt: new Date(),
        auditBy: user.userId,
      },
    });
    return 'imported';
  }

  /** 历史任务：执行图（API 格式）+ 产物全部转存进后台设定好的存储渠道。 */
  private async importJob(
    user: CurrentUser,
    apiKey: string,
    nodeNames: Set<string>,
    ownerName: string,
    task: ImportTask,
    job: ComfyCloudJob,
  ): Promise<'imported' | 'skipped'> {
    const source = `comfy-cloud://job/${job.id}`.slice(0, 500);
    const existing = await this.prisma.communityWorkflow.findFirst({
      where: { comfyUrl: source },
      select: { id: true },
    });
    if (existing) return 'skipped';

    const detail = await this.comfy.getJobDetail(apiKey, job.id);
    if (detail.status !== 'completed' || !detail.workflow) return 'skipped';
    if (JSON.stringify(detail.workflow).length > JOB_DETAIL_BYTES) {
      return 'skipped';
    }
    if (containsCredentialKey(detail.workflow)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '执行图里带有疑似凭据字段，已拒绝迁移入库',
      );
    }

    const prepared = this.prepareGraph(detail.workflow, nodeNames);
    if (prepared.format !== 'api') return 'skipped';

    const media = collectMedia(detail.outputs, detail.previewOutput);
    const coverKeys: string[] = [];
    for (const item of media.slice(0, MEDIA_PER_JOB)) {
      try {
        const maxBytes = MAX_DOWNLOAD_BYTES[item.kind];
        const downloaded = item.url
          ? await this.comfy.downloadBytes(apiKey, item.url, maxBytes)
          : await this.comfy.viewFile(apiKey, item, maxBytes);
        const uploaded = await this.oss.upload(
          `community/import/${safeSegment(job.id)}/${safeSegment(item.filename, 'output')}`,
          downloaded.bytes,
        );
        coverKeys.push(uploaded.key);
        task.importedMedia += 1;
      } catch (error) {
        // 单个产物失败不影响条目本身（封面可能缺失），但要把原因留在任务消息里
        task.message = this.reasonOf(error, `产物 ${item.filename}`);
      }
    }

    const title = titleOfJob({
      id: detail.id,
      outputs: detail.outputs,
      previewOutput: detail.previewOutput,
      workflow: detail.workflow,
    });
    const mediaType =
      media[0]?.kind ||
      (looksLikeVideoWorkflow(prepared.graph) ? 'video' : 'image');
    await this.prisma.communityWorkflow.create({
      data: {
        code: newUserWorkflowCode(),
        source: 'USER',
        ownerUserId: user.userId,
        ownerName,
        title,
        summary:
          `从 Comfy Cloud 迁移的历史任务，${media.length} 个产物已转存本站存储`.slice(
            0,
            500,
          ),
        description:
          `由平台管理员从 Comfy Cloud 迁移入库（job ${detail.id}）。` +
          '图片与视频已转存进本站存储渠道，第一张产物作为封面。',
        category: mediaType === 'video' ? 'video' : 'image',
        groupLabel: '',
        tags: toJsonInput(['Comfy Cloud', '迁移']),
        mediaType,
        format: 'api',
        workflowJson: toJsonInput(prepared.graph),
        slots: toJsonInput(prepared.slots),
        coverKeys: toJsonInput(coverKeys.slice(0, 8)),
        comfyUrl: source,
        status: 'APPROVED',
        auditNote: '平台管理员从 Comfy Cloud 迁移，作者挂在管理员账号名下',
        auditedAt: new Date(),
        auditBy: user.userId,
      },
    });
    return 'imported';
  }

  /**
   * 判定入库格式：API 图直接校验；UI 图先机械转换，转不动或节点不在册就保留原文当浏览型。
   * 返回的 `reason` 只用于描述与审计，不参与控制流。
   */
  private prepareGraph(
    raw: unknown,
    nodeNames: Set<string>,
  ): {
    format: 'api' | 'ui';
    graph: Record<string, unknown>;
    slots: CommunityRegistrySlot[];
    reason: string;
  } {
    const format = detectFormat(raw);
    if (format === 'invalid') {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '不是合法的 ComfyUI 工作流 JSON',
      );
    }
    if (format === 'api') {
      // 未知/危险节点、凭据字段、节点数与体积上限都在这里拦住
      validatePublishedGraph(raw, nodeNames);
      const graph = raw as Record<string, unknown>;
      return {
        format: 'api',
        graph,
        slots: this.slotsOf(graph, nodeNames),
        reason: '',
      };
    }

    const converted = uiToApi(raw);
    if (!converted.ok) {
      return {
        format: 'ui',
        graph: raw as Record<string, unknown>,
        slots: [],
        reason: converted.reason,
      };
    }
    try {
      validatePublishedGraph(converted.graph, nodeNames);
      return {
        format: 'api',
        graph: converted.graph,
        slots: this.slotsOf(converted.graph, nodeNames),
        reason: '',
      };
    } catch (error) {
      // 转出来的图节点不在册（自定义节点）：不硬塞成可运行，退回浏览型
      return {
        format: 'ui',
        graph: raw as Record<string, unknown>,
        slots: [],
        reason:
          error instanceof BusinessException
            ? error.message
            : '转换后的图未能通过校验',
      };
    }
  }

  /** 槽位只是「可开放参数」的便利项：校验不过就整体不开放，不拖累工作流本身。 */
  private slotsOf(
    graph: Record<string, unknown>,
    nodeNames: Set<string>,
  ): CommunityRegistrySlot[] {
    const slots = suggestSlots(graph as CommunityWorkflowGraph);
    try {
      validateSlots(graph as CommunityWorkflowGraph, slots, nodeNames);
      return slots;
    } catch {
      return [];
    }
  }
}
