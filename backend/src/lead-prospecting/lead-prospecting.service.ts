import { pageOf, pageParam, text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { currentRequest, runInRequestContext } from '../common/request-context';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma';
import { jsonText } from '../common/sql-json';
import { geoChatMulti, type ChatMessage } from '../geo/geo-llm.client';
import { httpRequest } from '../http/transport';
import { ModelKeyService } from '../aiworkin/model-key.service';
import { DataTableService } from '../data-table/data-table.service';
import { RpaCrypto, maskKey } from '../rpa/rpa-crypto';
import { RpaLlmService } from '../rpa/rpa-llm.service';
import { buildDeliverableCsv, type DeliverableSink } from '../content/deliverable';
import {
  SUPPORTED_COUNTRIES,
  serperSearch,
  type SerperOrganicResult,
} from './lead-serper.client';

/**
 * Google 潜客线索挖掘：设置（Serper Key / 承载线索的多维表格 / 模型）→
 * 与 AI 对话澄清挖掘意图（关键词、场景、国家、数量）→ 形成任务 →
 * 后台执行（Google 搜索 → 抓页面正文 → 模型提炼 → 写入多维表格）。
 * 参考 `E:\wwwroot\bigdata` 的 AI-Google 搜索分析流程；凭据全部用户自带、落库加密，
 * 模型 Key 走「API Key 管理」的 sk- Key（与 RPA「AI 写脚本」同源）。
 */

const CHAT_TIMEOUT_MS = 90000;
const CHAT_MAX_TOKENS = 1200;
/** 单页抓取超时与正文截断长度：给模型看的正文取前段即可。 */
const PAGE_FETCH_TIMEOUT_MS = 15000;
const PAGE_TEXT_MAX = 6000;
/** 一次任务最多分析的搜索结果条数（模型调用有成本，界面按这个上限提示）。 */
const MAX_CANDIDATES = 30;
const ANALYZE_TIMEOUT_MS = 90000;
const ANALYZE_MAX_TOKENS = 1200;
/** 攒够一批就写表，任务进度也能更快反映到界面。 */
const INSERT_BATCH = 10;

/** 线索承载表的固定列模板：键名与模型输出 LEAD_JSON 的键一一对应。 */
const LEAD_TABLE_FIELDS: { fieldKey: string; name: string }[] = [
  { fieldKey: 'company_name', name: '公司名称' },
  { fieldKey: 'website', name: '官网' },
  { fieldKey: 'contact_person', name: '联系人' },
  { fieldKey: 'primary_email', name: '邮箱' },
  { fieldKey: 'phone', name: '电话' },
  { fieldKey: 'province', name: '省' },
  { fieldKey: 'city', name: '市' },
  { fieldKey: 'industry', name: '行业' },
  { fieldKey: 'source_url', name: '来源链接' },
  { fieldKey: 'ai_reason', name: 'AI判断理由' },
];

/** 线索承载表的默认表名（改名不影响模板列，只影响界面显示）。 */
const LEAD_TABLE_NAME = 'Google潜客线索';

/** 模板列键，任务选表与写行前的硬校验都用这一份。 */
const LEAD_TABLE_KEYS = LEAD_TABLE_FIELDS.map((field) => field.fieldKey);

export type LeadSpec = {
  keywords: string[];
  country: string;
  scene: string;
  num: number;
};

export class LeadProspectingService {
  /** 产物登记通道（services.ts 装配）：线索结果 CSV 存进自有 OSS 并落数字资产台账。 */
  deliverableSink?: DeliverableSink;

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly crypto: RpaCrypto,
    private readonly modelKeys: ModelKeyService,
    private readonly dataTable: DataTableService,
    private readonly llm: RpaLlmService,
  ) {}

  // ---------- 设置 ----------

  async getSettings(user: CurrentUser, token?: string) {
    const row = await this.prisma.leadProspectingSetting.findUnique({
      where: { userId: user.userId },
    });
    let serperMasked = '';
    if (row?.serperKeyCipher) {
      try {
        serperMasked = maskKey(this.crypto.decrypt(row.serperKeyCipher));
      } catch {
        serperMasked = '';
      }
    }
    const table = row?.dataTableId
      ? await this.prisma.dataTable.findUnique({
          where: { id: row.dataTableId },
          select: { id: true, name: true },
        })
      : null;
    const key = await this.keyStatus(token);
    return {
      serperConfigured: Boolean(serperMasked),
      serperMasked,
      dataTableId: table?.id || 0,
      dataTableExists: Boolean(table),
      dataTableActualName: table?.name || '',
      model: row?.model || '',
      keyConfigured: key.configured,
      keyMasked: key.keyMasked,
      keyStatusError: key.error,
      countries: SUPPORTED_COUNTRIES,
      ready: Boolean(
        serperMasked && table && (row?.model || '') && key.configured,
      ),
    };
  }

  /**
   * 可选的线索承载表：列覆盖线索模板且当前账号写得进行的那些，外加设置里记的默认表。
   * 判定与写行同源（多维表格 writableTables），能选出来的表一定写得进去。
   */
  async resultTableOptions(user: CurrentUser) {
    const row = await this.settingOf(user);
    const defaultRow = row?.dataTableId
      ? await this.prisma.dataTable.findUnique({
          where: { id: row.dataTableId },
          select: { id: true, name: true },
        })
      : null;
    const tables = await this.dataTable.writableTables(user, LEAD_TABLE_KEYS);
    const defaultTable = defaultRow
      ? {
          id: defaultRow.id,
          name: defaultRow.name,
          rowCount:
            tables.list.find((item) => item.id === defaultRow.id)?.rowCount ??
            0,
        }
      : null;
    return {
      requiredColumns: LEAD_TABLE_KEYS,
      columnLabels: LEAD_TABLE_FIELDS.map((field) => field.name),
      defaultTable,
      tables: tables.list,
    };
  }

  /**
   * 平台 sk- Key 状态：读「API Key 管理」的模型 Key 通道。通道鉴权失败/不可用时
   * 降级为「未确认配置」（keyConfigured=false + 原样带出错误），设置页其余本地项
   * （Serper Key / 线索表 / 模型）照常可看可存——辅助通道故障不许打断整页读取。
   */
  private async keyStatus(token?: string) {
    try {
      const key = await this.modelKeys.status(token);
      return {
        configured: key.configured,
        keyMasked: key.keyMasked,
        error: '',
      };
    } catch (error) {
      return {
        configured: false,
        keyMasked: '',
        error: (error as Error).message || '平台 API Key 状态读取失败',
      };
    }
  }

  /**
   * 保存基本设置：Serper API Key（可选，传了才更新）、模型（可选）、
   * 默认线索表（可选，传了才改——从已写得进去的表里选一张，不必用生成那张）。
   * 模型 Key 不在这里收——统一在「API Key 管理」维护，收到一律拒绝（与 RPA 同口径）。
   */
  async save(user: CurrentUser, body: Record<string, unknown>, token?: string) {
    if (text(body.apiKey).trim()) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '模型 API Key 已统一在「API Key 管理」维护，这里只需选择模型',
      );
    }
    const existing = await this.prisma.leadProspectingSetting.findUnique({
      where: { userId: user.userId },
    });
    const data: Record<string, unknown> = {};
    const serperApiKey = text(body.serperApiKey).trim();
    if (serperApiKey) {
      data.serperKeyCipher = this.crypto.encrypt(serperApiKey);
    }
    const model = text(body.model).trim().slice(0, 128);
    if (body.model !== undefined) data.model = model;
    if (body.dataTableId !== undefined) {
      const id = Math.floor(Number(body.dataTableId));
      if (!Number.isFinite(id) || id <= 0) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择一张线索表');
      }
      // 判定与写行同源（有新增权 + 列覆盖模板），能设为默认的表一定写得进去
      await this.dataTable.assertWritable(
        user,
        id,
        LEAD_TABLE_KEYS,
        '默认线索表',
      );
      data.dataTableId = id;
    }
    if (!Object.keys(data).length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有需要保存的设置');
    }
    const row = existing
      ? await this.prisma.leadProspectingSetting.update({
          where: { userId: user.userId },
          data,
        })
      : await this.prisma.leadProspectingSetting.create({
          data: {
            userId: user.userId,
            serperKeyCipher: '',
            model: '',
            ...data,
          },
        });
    await this.identity.audit(
      user.userId,
      '潜客挖掘保存设置',
      `${data.serperKeyCipher ? '更新Serper Key ' : ''}${
        data.model !== undefined ? `模型=${row.model || '（清空）'} ` : ''
      }${
        data.dataTableId !== undefined ? `默认线索表#${row.dataTableId}` : ''
      }`.trim(),
    );
    return this.getSettings(user, token);
  }

  /** 删除 Serper Key（界面「清除」按钮）：只清密文，不动其它设置。 */
  async removeSerperKey(user: CurrentUser, token?: string) {
    const existing = await this.prisma.leadProspectingSetting.findUnique({
      where: { userId: user.userId },
    });
    if (existing) {
      await this.prisma.leadProspectingSetting.update({
        where: { userId: user.userId },
        data: { serperKeyCipher: '' },
      });
      await this.identity.audit(
        user.userId,
        '潜客挖掘清除Key',
        `#${existing.id}`,
      );
    }
    return this.getSettings(user, token);
  }

  /**
   * 建线索承载的多维表格。表与列都走多维表格自身的创建接口，创建人即当前账号，
   * 后续任务写行同样以本人身份。
   * - 不传 name：设置页的「生成默认线索表」，幂等——已有且未被删除时直接回现状，否则新建并设为默认。
   * - 传 name：新建一张指定名字的线索表（列照样建满模板），setDefault 为真才顶掉默认表。
   */
  async createDataTable(
    user: CurrentUser,
    body: { name?: unknown; setDefault?: unknown } = {},
  ) {
    const row = await this.settingOf(user);
    const name = text(body.name).trim().slice(0, 60);
    if (!name && row?.dataTableId) {
      const table = await this.prisma.dataTable.findUnique({
        where: { id: row.dataTableId },
        select: { id: true, name: true },
      });
      if (table) {
        return {
          created: false,
          dataTableId: table.id,
          name: table.name,
          fields: LEAD_TABLE_KEYS,
        };
      }
    }
    const created = await this.dataTable.create(user, {
      name: name || LEAD_TABLE_NAME,
      description:
        '「Google 潜客线索挖掘」任务的产出表：每条线索一行，来源链接与 AI 判断理由随行进表。',
    });
    const tableId = Number((created as { id: number }).id);
    await this.dataTable.addFields(
      user,
      tableId,
      LEAD_TABLE_FIELDS.map((field) => ({
        name: field.name,
        fieldKey: field.fieldKey,
        fieldType: 'text',
      })),
    );
    // 设置页那条路径（不传名字）一定记为默认表；命名新建只在显式 setDefault 时顶掉默认表。
    const setDefault = !name || body.setDefault === true;
    if (setDefault) {
      if (row) {
        await this.prisma.leadProspectingSetting.update({
          where: { userId: user.userId },
          data: { dataTableId: tableId },
        });
      } else {
        await this.prisma.leadProspectingSetting.create({
          data: { userId: user.userId, dataTableId: tableId },
        });
      }
    }
    await this.identity.audit(
      user.userId,
      '潜客挖掘建线索表',
      `#${tableId} ${name || LEAD_TABLE_NAME}`,
    );
    return {
      created: true,
      dataTableId: tableId,
      name: name || LEAD_TABLE_NAME,
      fields: LEAD_TABLE_KEYS,
    };
  }

  /** 可选模型列表：与 RPA「AI 写脚本」同一通道（AIPDD，sk- Key）。 */
  models(user: CurrentUser, token?: string) {
    return this.llm.models(user, token);
  }

  // ---------- 意图对话 ----------

  /**
   * 与 AI 澄清挖掘意图。前置：设置必须齐（Serper Key + 线索表 + 模型 + 平台 Key），
   * 没齐一律拒绝提交自然语言。对话历史由前端整段发过来，本方法落库最近一轮问答。
   */
  async chat(user: CurrentUser, body: Record<string, unknown>, token?: string) {
    await this.requireReady(user, token);
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    const messages: ChatMessage[] = rawMessages
      .filter(
        (item) =>
          item &&
          typeof item === 'object' &&
          ['user', 'assistant'].includes(
            String((item as Record<string, unknown>).role),
          ),
      )
      .slice(-20)
      .map((item) => {
        const row = item as Record<string, unknown>;
        return {
          role: String(row.role) as 'user' | 'assistant',
          content: text(row.content).slice(0, 4000),
        };
      });
    if (!messages.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请至少发送一条消息');
    }
    const apiKey = await this.modelKeys.requireKey(token);
    const setting = await this.prisma.leadProspectingSetting.findUnique({
      where: { userId: user.userId },
    });
    const model = text(setting?.model).trim();
    const reply = await geoChatMulti({
      baseUrl: this.llm.baseUrl(),
      apiKey,
      model,
      messages: [
        { role: 'system', content: buildIntentSystemPrompt() },
        ...messages,
      ],
      maxTokens: CHAT_MAX_TOKENS,
      timeoutMs: CHAT_TIMEOUT_MS,
      userId: user.userId,
      purpose: 'chat',
    });
    const spec = parseTaskJson(reply.reply);
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      await this.prisma.leadProspectingMessage.create({
        data: {
          userId: user.userId,
          taskId: 0,
          role: 'user',
          content: lastUser.content,
        },
      });
    }
    await this.prisma.leadProspectingMessage.create({
      data: {
        userId: user.userId,
        taskId: 0,
        role: 'assistant',
        content: stripTaskJson(reply.reply),
      },
    });
    return {
      reply: stripTaskJson(reply.reply),
      spec,
      done: Boolean(spec),
      elapsedMs: reply.elapsedMs,
    };
  }

  /** 意图对话的历史（最近 50 条，时间正序）。 */
  async listMessages(user: CurrentUser) {
    const rows = await this.prisma.leadProspectingMessage.findMany({
      where: { userId: user.userId, taskId: 0 },
      orderBy: { id: 'desc' },
      take: 50,
    });
    return rows.reverse().map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.createdAt,
    }));
  }

  // ---------- 任务 ----------

  /** 对话确认后创建任务：spec 由前端把 chat 返回的 TASK_JSON 原样提交（也允许界面微调）。 */
  async createTask(
    user: CurrentUser,
    body: Record<string, unknown>,
    token?: string,
  ) {
    const spec = normalizeSpec(body.spec);
    if (!spec) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '任务参数不合法：关键词 1-8 个、国家限支持列表、目标线索数 1-50',
      );
    }
    await this.requireReady(user, token);
    const dataTableId = await this.resolveTargetTable(
      user,
      body.dataTableId,
      '线索表',
    );
    const row = await this.prisma.leadProspectingTask.create({
      data: {
        userId: user.userId,
        spec: spec as never,
        rawIntent: text(body.rawIntent).trim().slice(0, 4000),
        dataTableId,
      },
    });
    await this.identity.audit(
      user.userId,
      '潜客挖掘建任务',
      `#${row.id} ${spec.keywords.join('/')} 线索表#${dataTableId}`,
    );
    return decorateTask(row, await this.tableName(dataTableId));
  }

  /**
   * 改这个任务的线索承载表：还没跑出结果的任务（待执行 / 失败）可以换，
   * 执行中不许换（后台正往旧表写），已完成的换表等于把「查看线索」指向另一张表，也不许。
   */
  async updateTaskTable(user: CurrentUser, id: number, dataTableId: unknown) {
    const row = await this.prisma.leadProspectingTask.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '该任务不存在或不属于你',
      );
    }
    if (row.status === 'running') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '任务执行中，暂不能改线索表',
      );
    }
    if (row.status === 'success') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该任务已完成，线索表不再变更；要存到别的表请新建任务',
      );
    }
    const target = await this.resolveTargetTable(user, dataTableId, '线索表');
    const updated = await this.prisma.leadProspectingTask.update({
      where: { id },
      data: { dataTableId: target },
    });
    await this.identity.audit(
      user.userId,
      '潜客挖掘改任务线索表',
      `#${id} → #${target}`,
    );
    return decorateTask(updated, await this.tableName(target));
  }

  async listTasks(
    user: CurrentUser,
    query: { page?: number; pageSize?: number },
  ) {
    const { page, pageSize, offset } = pageParam(query.page, query.pageSize);
    const [rows, total] = await Promise.all([
      this.prisma.leadProspectingTask.findMany({
        where: { userId: user.userId },
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.leadProspectingTask.count({ where: { userId: user.userId } }),
    ]);
    const names = await this.tableNames(rows.map((row) => row.dataTableId));
    return pageOf(
      rows.map((row) => decorateTask(row, names.get(row.dataTableId) || '')),
      total,
      page,
      pageSize,
    );
  }

  async getTask(user: CurrentUser, id: number) {
    const row = await this.prisma.leadProspectingTask.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '该任务不存在或不属于你',
      );
    }
    return decorateTask(
      row,
      (await this.tableNames([row.dataTableId])).get(row.dataTableId) || '',
    );
  }

  /**
   * 开始 / 重试执行：请求内校验设置、解出两把 Key（模型 Key 需要登录态，出请求即失效），
   * 然后把搜索-抓取-提炼-写表放到后台跑，界面用任务详情轮询进度。
   * 写哪张表只看任务自己记的线索表（老任务没记时回落到设置里的默认表），不再是设置那张。
   */
  async start(user: CurrentUser, id: number, token?: string) {
    const row = await this.prisma.leadProspectingTask.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '该任务不存在或不属于你',
      );
    }
    if (row.status === 'running') {
      throw new BusinessException(ErrorCode.CONFLICT, '该任务正在执行中');
    }
    if (row.status === 'success') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该任务已完成；要再挖一轮请新建任务',
      );
    }
    await this.requireReady(user, token, { needTable: false });
    const setting = await this.settingOf(user);
    if (!setting?.serperKeyCipher) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先完成「Google 潜客」设置（Serper API Key）',
      );
    }
    const dataTableId = await this.resolveTargetTable(
      user,
      row.dataTableId,
      '线索表',
    );
    const serperKey = this.crypto.decrypt(setting.serperKeyCipher);
    const apiKey = await this.modelKeys.requireKey(token);
    const spec = normalizeSpec(row.spec);
    if (!spec) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '任务参数已失效，请重建任务',
      );
    }
    // 抢占执行权：同一任务可能被连点两次，条件更新保证只有一个赢家能进 running
    const grabbed = await this.prisma.leadProspectingTask.updateMany({
      where: { id, userId: user.userId, status: { in: ['pending', 'failed'] } },
      data: {
        status: 'running',
        dataTableId,
        totalFound: 0,
        totalSaved: 0,
        totalSkipped: 0,
        error: '',
      },
    });
    if (grabbed.count !== 1) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该任务状态已变更，请刷新后重试',
      );
    }
    const started = await this.prisma.leadProspectingTask.findUniqueOrThrow({
      where: { id },
    });
    // 后台执行不能继承这次点击的取消信号：用户关掉标签页也要把这一轮挖完
    void runInRequestContext(
      () =>
        this.run(user, started.id, spec, {
          serperKey,
          apiKey,
          model: setting.model,
          dataTableId,
        }),
      { requestId: currentRequest()?.requestId },
    ).catch(() => undefined);
    await this.identity.audit(
      user.userId,
      '潜客挖掘执行任务',
      `#${id} 关键词${spec.keywords.length}个 线索表#${dataTableId}`,
    );
    return decorateTask(started, await this.tableName(dataTableId));
  }

  async removeTask(user: CurrentUser, id: number) {
    const row = await this.prisma.leadProspectingTask.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '该任务不存在或不属于你',
      );
    }
    if (row.status === 'running') {
      throw new BusinessException(ErrorCode.CONFLICT, '任务执行中，暂不能删除');
    }
    await this.prisma.leadProspectingTask.delete({ where: { id } });
    await this.identity.audit(user.userId, '潜客挖掘删任务', `#${id}`);
    return { id, deleted: true };
  }

  // ---------- 执行流水线（后台） ----------

  private async run(
    user: CurrentUser,
    taskId: number,
    spec: LeadSpec,
    creds: {
      serperKey: string;
      apiKey: string;
      model: string;
      dataTableId: number;
    },
  ) {
    try {
      // 1) 搜索：逐关键词取结果，按域名去重，最多 MAX_CANDIDATES 条
      const seen = new Set<string>();
      const candidates: SerperOrganicResult[] = [];
      for (const keyword of spec.keywords) {
        const results = await serperSearch(
          creds.serperKey,
          keyword,
          spec.country,
          Math.min(spec.num, 20),
        );
        for (const item of results) {
          const domain = domainOf(item.link);
          if (!domain || seen.has(domain)) continue;
          seen.add(domain);
          candidates.push(item);
          if (candidates.length >= MAX_CANDIDATES) break;
        }
        if (candidates.length >= MAX_CANDIDATES) break;
      }
      await this.prisma.leadProspectingTask.update({
        where: { id: taskId },
        data: { totalFound: candidates.length },
      });

      // 2) 与线索表里已收录的域名对照（跨任务去重）
      // 只把两个键取回库外算域名，不在内存里扫全表：与大数据取数同一口径，
      // 表涨到几万行也不会像早期 take:2000 那样悄悄漏掉老线索。
      const existing = await this.prisma.$queryRaw<
        { website: string | null; source_url: string | null }[]
      >(
        Prisma.sql`SELECT ${jsonText('data', 'website')} AS website, ${jsonText('data', 'source_url')} AS source_url FROM data_table_rows WHERE table_id = ${creds.dataTableId}`,
      );
      for (const row of existing) {
        for (const value of [row.website, row.source_url]) {
          const domain = domainOf(text(value));
          if (domain) seen.add(domain);
        }
      }

      // 3) 逐条：抓正文 → 模型提炼 → 攒批写表
      let saved = 0;
      let skipped = 0;
      let batch: Record<string, unknown>[] = [];
      const deliverableRows: Record<string, unknown>[] = [];
      for (const item of candidates) {
        if (saved >= spec.num) break;
        let lead: Record<string, string> | null = null;
        try {
          const pageText = await fetchPageText(item.link);
          lead = await this.analyzePage(
            spec,
            item,
            pageText,
            creds,
            user.userId,
          );
        } catch {
          lead = null;
        }
        const domain = domainOf(item.link);
        if (!lead || !lead.company_name || (domain && seen.has(domain))) {
          skipped += 1;
        } else {
          if (domain) seen.add(domain);
          const leadRow: Record<string, unknown> = {
            company_name: lead.company_name,
            website: lead.website || item.link,
            contact_person: lead.contact_person || '',
            primary_email: lead.primary_email || '',
            phone: lead.phone || '',
            province: lead.province || '',
            city: lead.city || '',
            industry: lead.industry || '',
            source_url: item.link,
            ai_reason: lead.ai_reason || '',
          };
          batch.push(leadRow);
          deliverableRows.push(leadRow);
          if (batch.length >= INSERT_BATCH) {
            await this.dataTable.createRows(user, creds.dataTableId, batch);
            saved += batch.length;
            batch = [];
            await this.prisma.leadProspectingTask.update({
              where: { id: taskId },
              data: { totalSaved: saved, totalSkipped: skipped },
            });
          }
        }
      }
      if (batch.length) {
        await this.dataTable.createRows(user, creds.dataTableId, batch);
        saved += batch.length;
      }
      await this.prisma.leadProspectingTask.update({
        where: { id: taskId },
        data: {
          status: 'success',
          totalSaved: saved,
          totalSkipped: skipped,
        },
      });
      await this.identity.audit(
        user.userId,
        '潜客挖掘任务完成',
        `#${taskId} 收录${saved}条 跳过${skipped}条`,
      );
      // 产物归档：收录的线索导出 CSV，经登记通道存进自有 OSS 并入数字资产（尽力而为）。
      if (this.deliverableSink && deliverableRows.length) {
        await this.deliverableSink(user.userId, {
          bytes: buildDeliverableCsv(
            LEAD_TABLE_FIELDS.map((field) => ({ key: field.fieldKey, label: field.name })),
            deliverableRows,
          ),
          filename: `潜客挖掘-任务${taskId}.csv`,
          labels: ['营销工具', '潜客挖掘'],
          dir: 'marketing/lead',
          source: 'lead-prospecting',
        }).catch(() => undefined);
      }
    } catch (error) {
      const message = (error as Error)?.message || '执行失败';
      await this.prisma.leadProspectingTask
        .update({
          where: { id: taskId },
          data: { status: 'failed', error: message.slice(0, 2000) },
        })
        .catch(() => undefined);
    }
  }

  /** 单页提炼：正文抓不到时退化为「标题+摘要」判断，与 bigdata 的逐页分析同形态。 */
  private async analyzePage(
    spec: LeadSpec,
    item: SerperOrganicResult,
    pageText: string,
    creds: { apiKey: string; model: string },
    userId: string,
  ): Promise<Record<string, string> | null> {
    const reply = await geoChatMulti({
      baseUrl: this.llm.baseUrl(),
      apiKey: creds.apiKey,
      model: creds.model,
      messages: [
        { role: 'system', content: buildAnalyzeSystemPrompt(spec) },
        {
          role: 'user',
          content: `搜索结果：\n标题：${item.title}\n摘要：${item.snippet}\n链接：${item.link}\n\n网页正文节选：\n${pageText || '（正文抓取失败，仅按标题与摘要判断）'}`,
        },
      ],
      maxTokens: ANALYZE_MAX_TOKENS,
      timeoutMs: ANALYZE_TIMEOUT_MS,
      userId,
      purpose: 'batch',
    });
    const match = /LEAD_JSON\s*:\s*(\{[\s\S]*?\})\s*(?=\n|$)/.exec(reply.reply);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[1]) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      const out: Record<string, string> = {};
      for (const key of [
        'company_name',
        'website',
        'contact_person',
        'primary_email',
        'phone',
        'province',
        'city',
        'industry',
        'ai_reason',
      ]) {
        const value = parsed[key];
        out[key] = text(value).trim().slice(0, 500);
      }
      return out;
    } catch {
      return null;
    }
  }

  // ---------- 内部 ----------

  private async settingOf(user: CurrentUser) {
    return this.prisma.leadProspectingSetting.findUnique({
      where: { userId: user.userId },
    });
  }

  /**
   * 提交自然语言/建任务/执行前的统一门槛：设置没齐就拒，并说清缺哪一项。
   * `needTable` 为假时不看默认线索表——执行写的是任务自己选的表，那张表另做校验，
   * 不该被「默认表是否还在」误拦。
   */
  private async requireReady(
    user: CurrentUser,
    token?: string,
    options: { needTable?: boolean } = {},
  ) {
    const needTable = options.needTable !== false;
    const settings = await this.getSettings(user, token);
    const missing: string[] = [];
    if (!settings.serperConfigured) missing.push('Serper API Key');
    if (needTable && !settings.dataTableExists)
      missing.push('线索承载多维表格');
    if (!settings.model) missing.push('文字模型');
    if (!settings.keyConfigured) {
      missing.push(
        settings.keyStatusError
          ? `平台 API Key 状态未确认（${settings.keyStatusError}）`
          : '平台 API Key（API Key 管理）',
      );
    }
    if (missing.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `请先完成设置：${missing.join('、')}`,
      );
    }
    return settings;
  }

  /**
   * 定下这个任务写哪张线索表：指定了就用指定的（按模板列与写权限硬校验），
   * 没指定就落到设置里的默认线索表。
   */
  private async resolveTargetTable(
    user: CurrentUser,
    value: unknown,
    label: string,
  ) {
    const id = Math.floor(Number(value));
    if (!Number.isFinite(id) || id <= 0) {
      const setting = await this.settingOf(user);
      if (!setting?.dataTableId) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `请先在「Google 潜客线索挖掘」里生成默认${label}`,
        );
      }
      await this.dataTable.assertWritable(
        user,
        setting.dataTableId,
        LEAD_TABLE_KEYS,
        label,
      );
      return setting.dataTableId;
    }
    await this.dataTable.assertWritable(user, id, LEAD_TABLE_KEYS, label);
    return id;
  }

  private async tableName(tableId: number) {
    const map = await this.tableNames([tableId]);
    return map.get(tableId) || '';
  }

  /** 一批任务的目标表名（列表页一次取全；已被删除的表不在返回里，界面显示为空）。 */
  private async tableNames(tableIds: number[]) {
    const ids = [...new Set(tableIds.filter((id) => id > 0))];
    if (!ids.length) return new Map<number, string>();
    const rows = await this.prisma.dataTable.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}

// ---------- 纯函数 ----------

function domainOf(url: string) {
  try {
    const host = new URL(String(url || '')).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return '';
  }
}

/** 抓网页正文并去标签：与 bigdata fetch_page_text 同思路（正则剥离，不引浏览器）。 */
async function fetchPageText(url: string): Promise<string> {
  let html = '';
  try {
    const response = await httpRequest<string>(url, {
      method: 'get',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EnterpriseLeadBot/1.0)',
      },
      timeoutMs: PAGE_FETCH_TIMEOUT_MS,
      readAs: 'text',
      concurrency: 2,
      limiterKey: 'lead:fetch',
      operation: 'lead:fetch-page',
    });
    if (!response.ok) return '';
    html = String(response.data || '');
  } catch {
    return '';
  }
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-zA-Z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, PAGE_TEXT_MAX);
}

/** 对话确认后的任务参数：非法值一律返回 null，由调用方拒收。 */
export function normalizeSpec(value: unknown): LeadSpec | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const keywords = (Array.isArray(raw.keywords) ? raw.keywords : [])
    .map((item) => text(item).trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!keywords.length) return null;
  const country = text(raw.country).trim().toLowerCase() || 'cn';
  if (!SUPPORTED_COUNTRIES.some((item) => item.code === country)) return null;
  const num = Math.floor(Number(raw.num));
  if (!Number.isFinite(num) || num < 1 || num > 50) return null;
  const scene = text(raw.scene).trim().slice(0, 2000);
  return { keywords, country, scene, num };
}

function parseTaskJson(reply: string): LeadSpec | null {
  const match = /TASK_JSON\s*:\s*(\{[\s\S]*?\})\s*(?=\n|$)/.exec(
    String(reply || ''),
  );
  if (!match) return null;
  try {
    return normalizeSpec(JSON.parse(match[1]));
  } catch {
    return null;
  }
}

/** 回给界面的正文去掉 TASK_JSON 标记行（前端拿 spec 字段即可）。 */
function stripTaskJson(reply: string) {
  return String(reply || '')
    .replace(/TASK_JSON\s*:\s*\{[\s\S]*?\}\s*(?=\n|$)/, '')
    .trim();
}

function decorateTask(
  row: {
    id: number;
    userId: string;
    spec: unknown;
    rawIntent: string;
    status: string;
    totalFound: number;
    totalSaved: number;
    totalSkipped: number;
    dataTableId: number;
    error: string;
    createdAt: Date;
    updatedAt: Date;
  },
  dataTableName: string,
) {
  return {
    id: row.id,
    spec: normalizeSpec(row.spec) || row.spec,
    rawIntent: row.rawIntent,
    status: row.status,
    totalFound: row.totalFound,
    totalSaved: row.totalSaved,
    totalSkipped: row.totalSkipped,
    dataTableId: row.dataTableId,
    dataTableName,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildIntentSystemPrompt() {
  const countries = SUPPORTED_COUNTRIES.map(
    (item) => `${item.code}（${item.label}）`,
  ).join('、');
  return `你是「Google 潜客线索挖掘」的意图澄清助手。用户想通过 Google 搜索批量挖掘潜在客户线索，你的任务是把模糊的想法问清楚，形成可执行的挖掘任务参数。

需要澄清到位的信息：
1. 关键词：1-8 个可直接投给 Google 的搜索词（结合用户的行业、产品、目标客户画像给出建议并确认）；
2. 场景：这批线索用来干什么、目标客户长什么样（越具体，模型逐页判断越准）；
3. 国家：搜索地区（gl），限：${countries}；
4. 数量：目标线索条数，1-50。

要求：
- 用中文、口语化，一次最多追问一个缺口，别连着问一串；
- 用户一句话已经说全时，直接复述参数并确认，不要为问而问；
- 关键词要给出你的建议（用户只说了行业时，帮他拆成 3-5 个具体搜索词）；
- 四项都确认后，在回复末尾另起一行输出：
TASK_JSON:{"keywords":["词1","词2"],"country":"us","scene":"场景描述","num":10}
- TASK_JSON 里的 country 用两位国家码，num 是整数；未确认齐之前不要输出 TASK_JSON。`;
}

function buildAnalyzeSystemPrompt(spec: LeadSpec) {
  return `你是 B2B 潜客分析师。挖掘任务背景：
- 场景：${spec.scene || '（用户未补充，按关键词判断）'}
- 关键词：${spec.keywords.join('、')}

下面会给你一条 Google 搜索结果（标题/摘要/链接）和网页正文节选。判断该网站是否属于目标潜客，是则抽取联系信息。

只输出下面这一行，不要任何解释、不要用代码围栏：
LEAD_JSON:{"company_name":"","website":"","contact_person":"","primary_email":"","phone":"","province":"","city":"","industry":"","ai_reason":""}

规则：
- company_name 填公司注册名或官网品牌名；判断不是目标潜客、或明显是新闻/博客/政府页面时，输出空对象 LEAD_JSON:{}；
- website 填该站点首页域名链接（https:// 开头）；
- contact_person / primary_email / phone 只填正文里真实出现的，没有就留空，不要编造；
- province / city 用中文填公司地址所在地；industry 填该客户所属的中文行业；
- ai_reason 用一句中文说明为什么判定为目标潜客（或为何留空）。`;
}
