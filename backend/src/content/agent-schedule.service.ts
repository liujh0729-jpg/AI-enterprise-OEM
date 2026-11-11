import type { ContentAgentSchedule } from '@enterprise/contracts';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { assertSensitivePassword } from '../common/confirm-password';
import { ErrorCode } from '../common/error-code';
import {
  computeNextOccurrence,
  readScheduleFields,
  scheduleConfigOf,
} from '../common/schedule';
import { CurrentUser } from '../auth/current-user';
import { UserLookupService } from '../directory/user-lookup.service';
import { IdentityService } from '../identity/identity.service';
import { HrmScopeService } from '../hrm/hrm.scope';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma';
import { toJsonInput } from '../common/json-input';
import { ContentAgentExpertService } from './agent-experts.service';
import { ContentAgentService, parseReferences } from './agent.service';

const TITLE_MAX = 80;
const INSTRUCTION_MAX = 8000;
const RUNS_LIMIT = 30;
const DUE_LIMIT = 10;
const SUMMARY_MAX = 500;
/** 随任务固定的引用上限（与一轮对话里勾选的上限一致） */
const SKILL_REFS_MAX = 30;
const LIBRARY_REFS_MAX = 50;
const CONNECTOR_REFS_MAX = 20;
const MAILBOX_REFS_MAX = 20;
/** 会话标题列宽（与 agent.service 的 TITLE_MAX 一致）。 */
const CONVERSATION_TITLE_MAX = 30;
/** 邮箱范围行：每次执行按任务配置重写，用户指令里的旧行会被替换。 */
const MAIL_SCOPE_PREFIX = '本次任务只处理这些邮箱：';

/** 引用 id 数组：只留正整数并去重，超过上限截断。 */
function idList(raw: unknown, limit: number) {
  if (!Array.isArray(raw)) return [];
  const ids: number[] = [];
  for (const item of raw) {
    const value = Number(item);
    if (Number.isInteger(value) && value > 0 && !ids.includes(value)) {
      ids.push(value);
    }
    if (ids.length >= limit) break;
  }
  return ids;
}

/** 连接器 id 允许 0（本站 MCP Server）。 */
function connectorIdList(raw: unknown, limit: number) {
  if (!Array.isArray(raw)) return [];
  const ids: number[] = [];
  for (const item of raw) {
    const value = Number(item);
    if (Number.isInteger(value) && value >= 0 && !ids.includes(value)) {
      ids.push(value);
    }
    if (ids.length >= limit) break;
  }
  return ids;
}

type ScheduleRow = {
  id: number;
  userId: string;
  preset: string;
  title: string;
  instruction: string;
  conversationId: number;
  expertId: number;
  personaId: number;
  skillIds: unknown;
  pluginIds: unknown;
  libraryIds: unknown;
  connectorIds: unknown;
  mailboxIds: unknown;
  allowWrite: boolean;
  references: unknown;
  channelId: number;
  model: string;
  scheduleType: string;
  scheduleConfig: unknown;
  scheduledAt: Date | null;
  status: string;
  lastRunAt: Date | null;
  lastStatus: string;
  lastError: string;
  runCount: number;
  createdAt: Date;
  updatedAt: Date;
};

type RunRow = {
  id: number;
  scheduleId: number;
  trigger: string;
  status: string;
  conversationId: number;
  messageId: number;
  summary: string;
  error: string;
  startedAt: Date;
  finishedAt: Date | null;
};

/**
 * Agent 定时任务：到点把任务自带的指令当成一轮对话交给 Agent 跑，
 * 结果落进一条专属会话，执行历史逐条留痕（成功可直接打开那轮对话看产出）。
 * 排期字段与 RPA 任务、Workbuddy 计划同一套口径（common/schedule.ts）。
 */
export class ContentAgentScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly users: UserLookupService,
    private readonly scope: HrmScopeService,
    private readonly agent: ContentAgentService,
    private readonly experts: ContentAgentExpertService,
  ) {}

  private shape(
    row: ScheduleRow,
    expertName: string,
    personaName: string,
  ): ContentAgentSchedule {
    return {
      id: row.id,
      preset: row.preset,
      title: row.title,
      instruction: row.instruction,
      conversationId: row.conversationId,
      expertId: row.expertId,
      expertName,
      personaId: row.personaId,
      personaName,
      skillIds: idList(row.skillIds, SKILL_REFS_MAX),
      pluginIds: idList(row.pluginIds, SKILL_REFS_MAX),
      libraryIds: idList(row.libraryIds, LIBRARY_REFS_MAX),
      connectorIds: connectorIdList(row.connectorIds, CONNECTOR_REFS_MAX),
      mailboxIds: idList(row.mailboxIds, MAILBOX_REFS_MAX),
      allowWrite: row.allowWrite === true,
      references: parseReferences(row.references),
      channelId: row.channelId,
      model: row.model,
      scheduleType:
        row.scheduleType === 'scheduled' ? 'scheduled' : 'recurring',
      scheduleConfig: scheduleConfigOf(row.scheduleConfig),
      scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : null,
      status: row.status === 'paused' ? 'paused' : 'enabled',
      lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
      lastStatus: row.lastStatus,
      lastError: row.lastError,
      runCount: row.runCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private shapeRun(row: RunRow) {
    const status =
      row.status === 'succeeded' || row.status === 'failed'
        ? row.status
        : 'running';
    return {
      id: row.id,
      scheduleId: row.scheduleId,
      trigger: row.trigger === 'manual' ? 'manual' : 'scheduled',
      status,
      conversationId: row.conversationId,
      messageId: row.messageId,
      summary: row.summary,
      error: row.error,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    };
  }

  /** 专家的名字随任务带回界面；专家被删就空着，不影响任务本身。 */
  private async expertNames(expertIds: number[]) {
    const ids = [...new Set(expertIds.filter((id) => id > 0))];
    if (!ids.length) return new Map<number, string>();
    const rows = await this.prisma.contentAgentExpert.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name] as [number, string]));
  }

  /** 分身名字同样随任务带回；分身被删就空着，任务回到「自动」。 */
  private async personaNames(personaIds: number[]) {
    const ids = [...new Set(personaIds.filter((id) => id > 0))];
    if (!ids.length) return new Map<number, string>();
    const rows = await this.prisma.contentAgentPersona.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name] as [number, string]));
  }

  /** 只能绑定自己的分身；0 / 缺省＝自动。 */
  private async bindPersona(user: CurrentUser, raw: unknown) {
    const idRaw = Number(raw ?? 0);
    const id = Number.isInteger(idRaw) && idRaw > 0 ? idRaw : 0;
    if (!id) return null;
    const row = await this.prisma.contentAgentPersona.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '数字分身不存在或已被删除',
      );
    }
    return row;
  }

  async list(user: CurrentUser) {
    const rows = await this.prisma.contentAgentSchedule.findMany({
      where: { userId: user.userId },
      orderBy: { id: 'desc' },
      take: 100,
    });
    const names = await this.expertNames(rows.map((row) => row.expertId));
    const personaNames = await this.personaNames(
      rows.map((row) => row.personaId),
    );
    return rows.map((row) =>
      this.shape(
        row,
        names.get(row.expertId) || '',
        personaNames.get(row.personaId) || '',
      ),
    );
  }

  /**
   * 定时任务的排期：建完就要有第一次执行时刻，否则调度器永远等不到它。
   * 「不排期」不算定时任务，直接拒掉。
   */
  private readSchedule(body: Record<string, unknown>) {
    const schedule = readScheduleFields(body);
    const scheduleType = text(schedule.scheduleType).trim();
    if (scheduleType === 'once' || !scheduleType) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '定时任务要选择执行时间或重复频率',
      );
    }
    if (scheduleType === 'recurring') {
      const config = scheduleConfigOf(schedule.scheduleConfig);
      if (!text(config.freq).trim()) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '周期重复要选择重复频率',
        );
      }
      schedule.scheduledAt = computeNextOccurrence(config, new Date());
    }
    return schedule;
  }

  private async bindExpert(raw: unknown) {
    const expertId = Number(raw ?? 0);
    if (!Number.isInteger(expertId) || expertId <= 0) return null;
    const expert = await this.experts.bindable(expertId);
    if (!expert) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '专家不存在或已被删除');
    }
    return expert;
  }

  /** 引用的连接器与邮箱必须属于本账号；连接器 0（本站 MCP Server）恒可用。 */
  private async validateRefs(
    user: CurrentUser,
    connectorIds: number[],
    mailboxIds: number[],
  ) {
    const externalIds = connectorIds.filter((id) => id > 0);
    if (externalIds.length) {
      const count = await this.prisma.contentAgentMcpConnector.count({
        where: { userId: user.userId, id: { in: externalIds } },
      });
      if (count !== externalIds.length) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '引用的 MCP 连接器不存在或已被删除',
        );
      }
    }
    if (mailboxIds.length && !connectorIds.includes(0)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '处理邮箱要同时引用本站 MCP Server（连接器 0），否则 Agent 调不到邮件工具',
      );
    }
    if (mailboxIds.length) {
      const count = await this.prisma.mailAccount.count({
        where: { userId: user.userId, id: { in: mailboxIds } },
      });
      if (count !== mailboxIds.length) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '指定的邮箱不存在或已被删除',
        );
      }
    }
  }

  /**
   * 执行时的指令：把任务指定的邮箱地址按最新配置写进指令末尾，
   * 并替换用户指令里可能残留的旧范围行——邮箱改了，提示词跟着改。
   */
  private async scopedInstruction(schedule: ScheduleRow) {
    const kept = schedule.instruction
      .split('\n')
      .filter((line) => !line.trim().startsWith(MAIL_SCOPE_PREFIX));
    const ids = idList(schedule.mailboxIds, MAILBOX_REFS_MAX);
    if (!ids.length) return kept.join('\n').trim();
    const rows = await this.prisma.mailAccount.findMany({
      where: { userId: schedule.userId, id: { in: ids } },
      select: { id: true, address: true },
    });
    if (!rows.length) return kept.join('\n').trim();
    const list = rows
      .map((row) => `${row.address}（mailboxId=${row.id}）`)
      .join('、');
    return [
      ...kept,
      `${MAIL_SCOPE_PREFIX}${list}。只调用这些邮箱的邮件工具，处理其他邮箱的请求一律拒绝。`,
    ]
      .join('\n')
      .trim();
  }

  private channelIdOf(raw: unknown) {
    const value = Number(raw ?? 0);
    return Number.isInteger(value) && value > 0 ? value : 0;
  }

  /**
   * 放开无人值守写动作等于「让机器半夜替我改数据」，要二次验本站登录密码：
   * 会话令牌被盗时，攻击者也不能顺手把某个任务的写动作打开。
   */
  private async assertWritePassword(user: CurrentUser, raw: unknown) {
    await assertSensitivePassword(
      this.prisma,
      user.userId,
      raw,
      '允许自动执行写动作',
    );
  }

  async save(user: CurrentUser, body: Record<string, unknown>) {
    const title = text(body.title).trim().slice(0, TITLE_MAX);
    if (!title) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请给定时任务起个名字',
      );
    }
    const instruction = text(body.instruction).trim();
    if (!instruction) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '要写清每次执行时让 Agent 做什么',
      );
    }
    if (instruction.length > INSTRUCTION_MAX) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `指令太长了，请精简到 ${INSTRUCTION_MAX} 字以内`,
      );
    }
    const schedule = this.readSchedule(body);
    const expert = await this.bindExpert(body.expertId);
    const persona = await this.bindPersona(user, body.personaId);
    const connectorIds = connectorIdList(body.connectorIds, CONNECTOR_REFS_MAX);
    const mailboxIds = idList(body.mailboxIds, MAILBOX_REFS_MAX);
    await this.validateRefs(user, connectorIds, mailboxIds);
    // 新建时默认不放开写动作；要放开得验密
    const allowWrite = body.allowWrite === true;
    if (allowWrite) await this.assertWritePassword(user, body.password);
    const row = await this.prisma.contentAgentSchedule.create({
      data: {
        userId: user.userId,
        preset: text(body.preset).trim().slice(0, 32),
        title,
        instruction,
        expertId: expert?.id || 0,
        personaId: persona?.id || 0,
        skillIds: idList(body.skillIds, SKILL_REFS_MAX),
        pluginIds: idList(body.pluginIds, SKILL_REFS_MAX),
        libraryIds: idList(body.libraryIds, LIBRARY_REFS_MAX),
        connectorIds,
        mailboxIds,
        allowWrite,
        references: parseReferences(body.references),
        channelId: this.channelIdOf(body.channelId),
        model: text(body.model).trim().slice(0, 128),
        scheduleType: String(schedule.scheduleType),
        scheduleConfig: schedule.scheduleConfig ?? {},
        scheduledAt: schedule.scheduledAt ?? null,
        status: 'enabled',
      },
    });
    await this.identity.audit(
      user.userId,
      'Agent定时任务新建',
      `#${row.id} ${row.title}${row.allowWrite ? '（允许自动写动作）' : ''}`,
    );
    return this.shape(row, expert?.name || '', persona?.name || '');
  }

  private async ownedSchedule(user: CurrentUser, id: string) {
    const scheduleId = Number(id);
    if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '定时任务编号无效');
    }
    const row = await this.prisma.contentAgentSchedule.findFirst({
      where: { id: scheduleId, userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '定时任务不存在');
    }
    return row;
  }

  async update(user: CurrentUser, id: string, body: Record<string, unknown>) {
    const existing = await this.ownedSchedule(user, id);
    const data: Prisma.ContentAgentScheduleUncheckedUpdateInput = {};
    if (body.title !== undefined) {
      const title = text(body.title).trim().slice(0, TITLE_MAX);
      if (!title) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '请给定时任务起个名字',
        );
      }
      data.title = title;
    }
    if (body.instruction !== undefined) {
      const instruction = text(body.instruction).trim();
      if (!instruction) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '要写清每次执行时让 Agent 做什么',
        );
      }
      if (instruction.length > INSTRUCTION_MAX) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `指令太长了，请精简到 ${INSTRUCTION_MAX} 字以内`,
        );
      }
      data.instruction = instruction;
    }
    if (body.scheduleType !== undefined) {
      const schedule = this.readSchedule(body);
      data.scheduleType = String(schedule.scheduleType);
      data.scheduleConfig = toJsonInput(schedule.scheduleConfig ?? {});
      data.scheduledAt = schedule.scheduledAt ?? null;
    }
    if (body.expertId !== undefined) {
      const expert = await this.bindExpert(body.expertId);
      data.expertId = expert?.id || 0;
    }
    if (body.personaId !== undefined) {
      const persona = await this.bindPersona(user, body.personaId);
      data.personaId = persona?.id || 0;
    }
    if (body.skillIds !== undefined) {
      data.skillIds = toJsonInput(idList(body.skillIds, SKILL_REFS_MAX));
    }
    if (body.pluginIds !== undefined) {
      data.pluginIds = toJsonInput(idList(body.pluginIds, SKILL_REFS_MAX));
    }
    if (body.libraryIds !== undefined) {
      data.libraryIds = toJsonInput(idList(body.libraryIds, LIBRARY_REFS_MAX));
    }
    if (body.references !== undefined) {
      data.references = toJsonInput(parseReferences(body.references));
    }
    if (body.connectorIds !== undefined || body.mailboxIds !== undefined) {
      const connectorIds =
        body.connectorIds !== undefined
          ? connectorIdList(body.connectorIds, CONNECTOR_REFS_MAX)
          : connectorIdList(existing.connectorIds, CONNECTOR_REFS_MAX);
      const mailboxIds =
        body.mailboxIds !== undefined
          ? idList(body.mailboxIds, MAILBOX_REFS_MAX)
          : idList(existing.mailboxIds, MAILBOX_REFS_MAX);
      await this.validateRefs(user, connectorIds, mailboxIds);
      data.connectorIds = toJsonInput(connectorIds);
      data.mailboxIds = toJsonInput(mailboxIds);
    }
    if (body.channelId !== undefined) {
      data.channelId = this.channelIdOf(body.channelId);
    }
    if (body.model !== undefined) {
      data.model = text(body.model).trim().slice(0, 128);
    }
    if (body.allowWrite !== undefined) {
      const allowWrite = body.allowWrite === true;
      // 开关只在「从禁到开」时要验密；关掉永远不需要代价，鼓励随时收回来
      if (allowWrite && existing.allowWrite !== true) {
        await this.assertWritePassword(user, body.password);
      }
      data.allowWrite = allowWrite;
    }
    if (body.status !== undefined) {
      const status =
        text(body.status).trim() === 'paused' ? 'paused' : 'enabled';
      data.status = status;
      // 恢复执行时把已经过去的周期推到未来，避免一恢复就立刻补跑一次；
      // 定时一次被暂停后恢复，则保留原时刻（错过就立刻跑）。
      if (
        status === 'enabled' &&
        existing.scheduleType === 'recurring' &&
        (!existing.scheduledAt || existing.scheduledAt.getTime() <= Date.now())
      ) {
        data.scheduledAt = computeNextOccurrence(
          scheduleConfigOf(existing.scheduleConfig),
          new Date(),
        );
      }
    }
    if (!Object.keys(data).length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有要改的内容');
    }
    const row = await this.prisma.contentAgentSchedule.update({
      where: { id: existing.id },
      data,
    });
    await this.identity.audit(
      user.userId,
      'Agent定时任务修改',
      `#${row.id} ${row.title}${
        data.allowWrite !== undefined
          ? `（自动写动作：${row.allowWrite ? '开' : '关'}）`
          : ''
      }${data.status === 'paused' ? '（已暂停）' : ''}`,
    );
    const expertId = Number(data.expertId ?? existing.expertId);
    const personaId = Number(data.personaId ?? existing.personaId);
    const names = await this.expertNames([expertId]);
    const personaNames = await this.personaNames([personaId]);
    return this.shape(
      row,
      names.get(expertId) || '',
      personaNames.get(personaId) || '',
    );
  }

  async remove(user: CurrentUser, id: string) {
    const existing = await this.ownedSchedule(user, id);
    await this.prisma.$transaction([
      this.prisma.contentAgentScheduleRun.deleteMany({
        where: { scheduleId: existing.id, userId: user.userId },
      }),
      this.prisma.contentAgentSchedule.delete({ where: { id: existing.id } }),
    ]);
    await this.identity.audit(
      user.userId,
      'Agent定时任务删除',
      `#${existing.id} ${existing.title}`,
    );
    return { removed: true };
  }

  async runs(user: CurrentUser, id: string) {
    const existing = await this.ownedSchedule(user, id);
    const rows = await this.prisma.contentAgentScheduleRun.findMany({
      where: { scheduleId: existing.id, userId: user.userId },
      orderBy: { id: 'desc' },
      take: RUNS_LIMIT,
    });
    return rows.map((row) => this.shapeRun(row));
  }

  /** 「立即执行」：带着请求里的登录态跑一轮，手动执行也算一次执行记录。 */
  async runNow(user: CurrentUser, id: string, token?: string) {
    const existing = await this.ownedSchedule(user, id);
    return this.execute(existing, user, token, 'manual');
  }

  /**
   * 执行一轮：先建/复用一个专属会话，再跑一轮对话并落执行记录。
   * 任何失败都记在记录上回给界面（定时链路没有界面，靠记录和审计看）。
   */
  private async execute(
    schedule: ScheduleRow,
    user: CurrentUser,
    token: string | undefined,
    trigger: 'scheduled' | 'manual',
  ) {
    const conversationId = await this.ensureConversation(schedule);
    const run = await this.prisma.contentAgentScheduleRun.create({
      data: {
        scheduleId: schedule.id,
        userId: schedule.userId,
        trigger,
        status: 'running',
        conversationId,
      },
    });
    try {
      const result = await this.agent.runSilent(
        user,
        token,
        conversationId,
        await this.scopedInstruction(schedule),
        {
          channelId: schedule.channelId,
          model: schedule.model,
          personaId: schedule.personaId,
          skillIds: idList(schedule.skillIds, SKILL_REFS_MAX),
          pluginIds: idList(schedule.pluginIds, SKILL_REFS_MAX),
          libraryIds: idList(schedule.libraryIds, LIBRARY_REFS_MAX),
          connectorIds: connectorIdList(
            schedule.connectorIds,
            CONNECTOR_REFS_MAX,
          ),
          mailboxIds: idList(schedule.mailboxIds, MAILBOX_REFS_MAX),
          // 写动作默认不放开：只有任务自带上 allowWrite=true 才让无人值守这一轮真执行修改
          allowWrite: schedule.allowWrite === true,
          references: schedule.references,
        },
      );
      const summary = result.text.trim().slice(0, SUMMARY_MAX);
      const done = await this.prisma.contentAgentScheduleRun.update({
        where: { id: run.id },
        data: {
          status: 'succeeded',
          messageId: result.messageId,
          summary,
          finishedAt: new Date(),
        },
      });
      await this.prisma.contentAgentSchedule.update({
        where: { id: schedule.id },
        data: {
          lastRunAt: new Date(),
          lastStatus: 'succeeded',
          lastError: '',
          runCount: { increment: 1 },
        },
      });
      return this.shapeRun(done);
    } catch (error) {
      const message =
        error instanceof BusinessException
          ? error.message
          : (error as Error)?.message || '执行失败，请稍后重试';
      const failed = await this.prisma.contentAgentScheduleRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          error: message.slice(0, SUMMARY_MAX),
          finishedAt: new Date(),
        },
      });
      await this.prisma.contentAgentSchedule.update({
        where: { id: schedule.id },
        data: {
          lastRunAt: new Date(),
          lastStatus: 'failed',
          lastError: message.slice(0, SUMMARY_MAX),
          runCount: { increment: 1 },
        },
      });
      await this.identity.audit(
        schedule.userId,
        'Agent定时任务执行失败',
        `#${schedule.id} ${schedule.title}：${message}`,
      );
      return this.shapeRun(failed);
    }
  }

  /** 结果只落一条专属会话：已有就复用，没有就按任务标题新建。 */
  private async ensureConversation(schedule: ScheduleRow) {
    if (schedule.conversationId > 0) {
      const existing = await this.prisma.contentAgentConversation.findFirst({
        where: { id: schedule.conversationId, userId: schedule.userId },
        select: { id: true, expertId: true },
      });
      if (existing) {
        // 任务换了专家：专属会话跟着换，下一轮就按新专家作答
        if (existing.expertId !== schedule.expertId) {
          const expert =
            schedule.expertId > 0
              ? await this.experts.bindable(schedule.expertId)
              : null;
          await this.prisma.contentAgentConversation.update({
            where: { id: existing.id },
            data: {
              expertId: expert?.id || 0,
              expertName: expert?.name || '',
            },
          });
        }
        return existing.id;
      }
    }
    const expert = schedule.expertId
      ? await this.experts.bindable(schedule.expertId)
      : null;
    const row = await this.prisma.contentAgentConversation.create({
      data: {
        userId: schedule.userId,
        title: schedule.title.slice(0, CONVERSATION_TITLE_MAX),
        model: schedule.model,
        expertId: expert?.id || 0,
        expertName: expert?.name || '',
      },
    });
    await this.prisma.contentAgentSchedule.update({
      where: { id: schedule.id },
      data: { conversationId: row.id },
    });
    return row.id;
  }

  /**
   * 调度器调用：把到点的任务各跑一轮。
   * 先把下一次执行时刻推走再跑，避免一轮没跑完就被下一个 tick 重复接走；
   * 定时一次跑完即没有下一次（scheduledAt 置空）。
   */
  async advanceDue() {
    const now = new Date();
    const due = await this.prisma.contentAgentSchedule.findMany({
      where: {
        status: 'enabled',
        scheduleType: { in: ['scheduled', 'recurring'] },
        scheduledAt: { lte: now },
      },
      orderBy: { scheduledAt: 'asc' },
      take: DUE_LIMIT,
    });
    if (!due.length) return 0;
    const owners = await this.users.lookup(due.map((row) => row.userId));
    const names = new Map(owners.map((item) => [item.id, item.username]));
    for (const schedule of due) {
      // 无人值守执行前复核账号状态：停用/封禁/注销后立即停跑并自动暂停任务，
      // 不能因为定时器还在跑就继续用旧授权消耗额度、代发消息。
      const standing = await this.scope.isStanding(schedule.userId);
      if (!standing) {
        await this.prisma.contentAgentSchedule.update({
          where: { id: schedule.id },
          data: {
            status: 'paused',
            scheduledAt: null,
            lastStatus: 'skipped',
            lastError: '账号已停用，定时任务已自动暂停',
          },
        });
        continue;
      }
      const nextAt =
        schedule.scheduleType === 'recurring'
          ? computeNextOccurrence(
              scheduleConfigOf(schedule.scheduleConfig),
              now,
            )
          : null;
      await this.prisma.contentAgentSchedule.update({
        where: { id: schedule.id },
        data: { scheduledAt: nextAt },
      });
      const user = new CurrentUser(
        schedule.userId,
        names.get(schedule.userId) || '',
        '',
      );
      await this.execute(schedule, user, undefined, 'scheduled');
    }
    return due.length;
  }
}
