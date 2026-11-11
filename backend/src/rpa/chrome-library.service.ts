import { Prisma } from '../../generated/prisma';
import {
  RC_AGENT_MODE_LABELS,
  RC_AGENT_STATUS_LABELS,
  RC_SKILL_KIND_LABELS,
  type RcAgentMessageView,
  type RcAgentView,
  type RcExtractResultView,
  type RcRecordingView,
  type RcSkillView,
} from '@enterprise/contracts';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { parseId } from '../common/parse-id';
import { PrismaService } from '../prisma/prisma.service';
import { asJsonArray, toJsonObject } from '../shared/json-value';
import type { AgentSkillHint } from './chrome-agent.service';

/**
 * 浏览器代理的「本账号私有资产」台账（方案 §八 / P6）：
 * 插件侧会话（agents/messages）、技能库（personal/site）、录制→工具、抽取结果。
 * 一切按 `createdBy` 收口——同一家企业里各人各一份，越权即 404（不暴露存在性）。
 * 设备通道（插件）与界面端点（前端）共用本服务，插件自己的库管理不再过 MCP 授权闸。
 */

const CONTENT_MAX = 8000;
const SKILL_CONTENT_MAX = 20000;
const SKILL_NAME_MAX = 120;
const ACTION_MAX = 500;

export class RpaChromeLibraryService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------- 会话台账

  async listAgents(user: CurrentUser, query: Record<string, unknown>) {
    const page = Math.max(1, Math.round(Number(query.page) || 1));
    const pageSize = Math.min(
      200,
      Math.max(1, Math.round(Number(query.pageSize) || 20)),
    );
    const where: Prisma.RpaChromeAgentWhereInput = {
      createdBy: user.userId,
    };
    if (query.clientId) where.clientId = text(query.clientId).slice(0, 64);
    if (query.status)
      where.status = text(query.status).toUpperCase().slice(0, 16);
    const keyword = text(query.keyword).trim().slice(0, 100);
    if (keyword) where.goal = { contains: keyword };
    const [total, rows] = await Promise.all([
      this.prisma.rpaChromeAgent.count({ where }),
      this.prisma.rpaChromeAgent.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const names = await this.deviceNames(
      user.userId,
      rows.map((r) => r.clientId),
    );
    return {
      total,
      page,
      pageSize,
      list: rows.map((row) =>
        this.agentBrief(row, names.get(row.clientId) || ''),
      ),
    };
  }

  async agentView(user: CurrentUser, id: number): Promise<RcAgentView> {
    const row = await this.requireAgent(user.userId, id);
    const names = await this.deviceNames(user.userId, [row.clientId]);
    const messages = await this.prisma.rpaChromeMessage.findMany({
      where: { agentId: row.id, createdBy: user.userId },
      orderBy: { seq: 'asc' },
      take: 500,
    });
    return {
      ...this.agentBrief(row, names.get(row.clientId) || ''),
      messages: messages.map((item) => this.messageView(item)),
    };
  }

  /** 插件侧会话的 upsert：同一设备同一「本地会话号」重复上报只更新，不重复建行。 */
  async saveAgent(user: CurrentUser, body: Record<string, unknown>) {
    const clientId = text(body.clientId).trim().slice(0, 64);
    if (!clientId)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '缺少设备标识');
    const clientAgentId = text(body.clientAgentId).trim().slice(0, 64);
    const mode = text(body.mode).trim().toLowerCase().slice(0, 16) || 'act';
    const goal = text(body.goal).trim().slice(0, 1000);
    const data = {
      mode,
      goal,
      status: text(body.status).trim().toUpperCase().slice(0, 16) || 'RUNNING',
      stepCount: Math.max(0, Math.round(Number(body.stepCount) || 0)),
      maxSteps: Math.min(
        60,
        Math.max(1, Math.round(Number(body.maxSteps) || 25)),
      ),
      model: text(body.model).trim().slice(0, 128),
      credits: Math.max(0, Math.round(Number(body.credits) || 0)),
      stopReason: text(body.stopReason).trim().slice(0, 32),
      errorMessage: text(body.errorMessage).trim().slice(0, 500),
      startedAt: this.timeOf(body.startedAt),
      endedAt: body.endedAt ? this.timeOf(body.endedAt) : null,
    };
    const row = await this.prisma.rpaChromeAgent.upsert({
      where: {
        createdBy_clientId_clientAgentId: {
          createdBy: user.userId,
          clientId,
          clientAgentId,
        },
      },
      create: { createdBy: user.userId, clientId, clientAgentId, ...data },
      update: data,
    });
    const names = await this.deviceNames(user.userId, [clientId]);
    return this.agentBrief(row, names.get(clientId) || '');
  }

  /** 追加一条消息：seq 缺省时顺延；同 (agentId, seq) 重复上报按幂等更新。 */
  async appendMessage(
    user: CurrentUser,
    agentIdRaw: string,
    body: Record<string, unknown>,
  ) {
    const agentId = parseId(agentIdRaw, '会话 ID');
    await this.requireAgent(user.userId, agentId);
    const last = await this.prisma.rpaChromeMessage.findFirst({
      where: { agentId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    const seqRaw = Number(body.seq);
    const seq =
      Number.isFinite(seqRaw) && seqRaw > 0
        ? Math.round(seqRaw)
        : (last?.seq ?? 0) + 1;
    const data = {
      role: text(body.role).trim().slice(0, 16) || 'agent',
      kind: text(body.kind).trim().slice(0, 16) || 'text',
      content: text(body.content).slice(0, CONTENT_MAX),
      payload: toJsonObject(body.payload),
      screenshotKey: text(body.screenshotKey).trim().slice(0, 200),
    };
    const row = await this.prisma.rpaChromeMessage.upsert({
      where: { agentId_seq: { agentId, seq } },
      create: { agentId, createdBy: user.userId, seq, ...data },
      update: data,
    });
    return this.messageView(row);
  }

  // ---------------------------------------------------------------- 技能库

  async listSkills(user: CurrentUser, query: Record<string, unknown>) {
    const where: Prisma.RpaChromeSkillWhereInput = { createdBy: user.userId };
    const kind = text(query.kind).trim().toLowerCase();
    if (kind) where.kind = kind.slice(0, 16);
    const keyword = text(query.keyword).trim().slice(0, 100);
    if (keyword) {
      where.OR = [
        { name: { contains: keyword } },
        { description: { contains: keyword } },
      ];
    }
    const rows = await this.prisma.rpaChromeSkill.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return { list: rows.map((row) => this.skillView(row)) };
  }

  /** 技能 upsert：同名覆盖并把版本号 +1（跨设备一致，站点知识默认本账号私有）。 */
  async saveSkill(user: CurrentUser, body: Record<string, unknown>) {
    const name = text(body.name).trim().slice(0, SKILL_NAME_MAX);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写技能名称');
    const kindRaw = text(body.kind).trim().toLowerCase();
    const kind = kindRaw === 'site' ? 'site' : 'personal';
    const content = text(body.content).slice(0, SKILL_CONTENT_MAX);
    if (!content.trim()) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写技能内容');
    }
    const data = {
      kind,
      description: text(body.description).trim().slice(0, 500),
      content,
      site: kind === 'site' ? text(body.site).trim().slice(0, 200) : '',
      enabled: body.enabled !== false,
      version: { increment: 1 },
    };
    const row = await this.prisma.rpaChromeSkill.upsert({
      where: { createdBy_name: { createdBy: user.userId, name } },
      create: {
        createdBy: user.userId,
        name,
        kind,
        description: data.description,
        content: data.content,
        site: data.site,
        enabled: data.enabled,
      },
      update: data,
    });
    return this.skillView(row);
  }

  async removeSkill(user: CurrentUser, idRaw: string) {
    const id = parseId(idRaw, '技能 ID');
    const result = await this.prisma.rpaChromeSkill.deleteMany({
      where: { id, createdBy: user.userId },
    });
    if (!result.count)
      throw new BusinessException(ErrorCode.NOT_FOUND, '技能不存在');
    return { removed: true };
  }

  /**
   * 供 Agent 决策提示词注入的启用技能（personal / site 一并给）。
   * 只取启用项，按更新时间倒序；正文截断由调用方（提示词拼装）再做一层收口。
   */
  async promptSkills(user: CurrentUser, limit = 12): Promise<AgentSkillHint[]> {
    const rows = await this.prisma.rpaChromeSkill.findMany({
      where: { createdBy: user.userId, enabled: true },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(50, Math.max(1, Math.round(limit))),
    });
    return rows.map((row) => ({
      name: row.name,
      kindLabel: RC_SKILL_KIND_LABELS[row.kind] || row.kind,
      site: row.site,
      content: row.content,
    }));
  }

  // ---------------------------------------------------------------- 录制 → 工具

  async listRecordings(user: CurrentUser) {
    const rows = await this.prisma.rpaChromeRecording.findMany({
      where: { createdBy: user.userId },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return { list: rows.map((row) => this.recordingView(row)) };
  }

  async saveRecording(user: CurrentUser, body: Record<string, unknown>) {
    const name = text(body.name).trim().slice(0, SKILL_NAME_MAX);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写工具名称');
    const actions = asJsonArray(body.actions as Prisma.JsonValue).slice(
      0,
      ACTION_MAX,
    );
    if (!actions.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '录制里没有可复用的动作',
      );
    }
    const data = {
      site: text(body.site).trim().slice(0, 200),
      actions: actions as Prisma.InputJsonValue,
      stepCount: actions.length,
      enabled: body.enabled !== false,
    };
    const row = await this.prisma.rpaChromeRecording.upsert({
      where: { createdBy_name: { createdBy: user.userId, name } },
      create: { createdBy: user.userId, name, ...data },
      update: data,
    });
    return this.recordingView(row);
  }

  async removeRecording(user: CurrentUser, idRaw: string) {
    const id = parseId(idRaw, '工具 ID');
    const result = await this.prisma.rpaChromeRecording.deleteMany({
      where: { id, createdBy: user.userId },
    });
    if (!result.count) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '录制工具不存在');
    }
    return { removed: true };
  }

  // ---------------------------------------------------------------- 抽取结果

  async listExtracts(user: CurrentUser, query: Record<string, unknown>) {
    const where: Prisma.RpaChromeExtractWhereInput = { createdBy: user.userId };
    const agentId = Math.round(Number(query.agentId) || 0);
    if (agentId > 0) where.agentId = agentId;
    const limit = Math.min(
      200,
      Math.max(1, Math.round(Number(query.limit) || 50)),
    );
    const rows = await this.prisma.rpaChromeExtract.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit,
    });
    return { list: rows.map((row) => this.extractView(row)) };
  }

  async saveExtract(user: CurrentUser, body: Record<string, unknown>) {
    const rows = asJsonArray(body.rows as Prisma.JsonValue).slice(0, 500);
    const data = toJsonObject(body.data);
    if (!rows.length && !Object.keys(data).length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '抽取结果为空');
    }
    const row = await this.prisma.rpaChromeExtract.create({
      data: {
        createdBy: user.userId,
        agentId: Math.max(0, Math.round(Number(body.agentId) || 0)),
        url: text(body.url).trim().slice(0, 2000),
        schemaNote: text(body.schemaNote).trim().slice(0, 2000),
        data,
        rows: rows as Prisma.InputJsonValue,
        screenshotKey: text(body.screenshotKey).trim().slice(0, 200),
      },
    });
    return this.extractView(row);
  }

  // ---------------------------------------------------------------- 内部助手

  private async requireAgent(userId: string, id: number) {
    const row = await this.prisma.rpaChromeAgent.findFirst({
      where: { id, createdBy: userId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '会话不存在');
    return row;
  }

  private async deviceNames(userId: string, clientIds: string[]) {
    const unique = [...new Set(clientIds.filter(Boolean))];
    if (!unique.length) return new Map<string, string>();
    const rows = await this.prisma.rpaChromeDevice.findMany({
      where: { createdBy: userId, clientId: { in: unique } },
      select: { clientId: true, name: true },
    });
    return new Map(rows.map((row) => [row.clientId, row.name]));
  }

  private timeOf(value: unknown) {
    const raw = text(value).trim();
    const parsed = raw ? new Date(raw) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private agentBrief(
    row: Prisma.RpaChromeAgentGetPayload<object>,
    deviceName: string,
  ): RcAgentView {
    return {
      id: row.id,
      clientId: row.clientId,
      deviceName: deviceName || `Chrome · ${row.clientId.slice(0, 6)}`,
      mode: row.mode,
      modeLabel: RC_AGENT_MODE_LABELS[row.mode] || row.mode,
      goal: row.goal,
      status: row.status,
      statusLabel: RC_AGENT_STATUS_LABELS[row.status] || row.status,
      stepCount: row.stepCount,
      maxSteps: row.maxSteps,
      model: row.model,
      credits: row.credits,
      stopReason: row.stopReason,
      errorMessage: row.errorMessage,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt ? row.endedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private messageView(
    row: Prisma.RpaChromeMessageGetPayload<object>,
  ): RcAgentMessageView {
    return {
      id: row.id,
      agentId: row.agentId,
      seq: row.seq,
      role: row.role,
      kind: row.kind,
      content: row.content.slice(0, CONTENT_MAX),
      payload: toJsonObject(row.payload),
      screenshotKey: row.screenshotKey,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private skillView(row: Prisma.RpaChromeSkillGetPayload<object>): RcSkillView {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      kindLabel: RC_SKILL_KIND_LABELS[row.kind] || row.kind,
      description: row.description,
      content: row.content.slice(0, SKILL_CONTENT_MAX),
      site: row.site,
      enabled: row.enabled,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private recordingView(
    row: Prisma.RpaChromeRecordingGetPayload<object>,
  ): RcRecordingView {
    return {
      id: row.id,
      name: row.name,
      site: row.site,
      actions: asJsonArray(row.actions)
        .slice(0, ACTION_MAX)
        .map((item) => toJsonObject(item)),
      stepCount: row.stepCount,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private extractView(
    row: Prisma.RpaChromeExtractGetPayload<object>,
  ): RcExtractResultView {
    return {
      agentId: row.agentId,
      url: row.url,
      schemaNote: row.schemaNote,
      data: toJsonObject(row.data),
      rows: asJsonArray(row.rows)
        .slice(0, 500)
        .map((item) => toJsonObject(item)),
      screenshotKey: row.screenshotKey,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
