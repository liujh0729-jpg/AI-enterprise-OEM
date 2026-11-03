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
import { ModelKeyService } from '../aiworkin/model-key.service';
import { DataTableService } from '../data-table/data-table.service';
import { RpaLlmService } from '../rpa/rpa-llm.service';
import { buildDeliverableCsv, type DeliverableSink } from '../content/deliverable';
import {
  BIGDATA_DATASETS,
  type BigdataDatasetKey,
  type BigdataFilterField,
} from '@enterprise/contracts';
import { BIGDATA_MAX_LIMIT, queryBigdata } from './bigdata-upstream.client';

/**
 * 大数据查询（营销工具）：五个彼此独立的数据集（企业 / 全球贸易采购商 / 全球商务人士 /
 * 全球达人 / 全球POI 地点）共用这一套流程——
 * 设置（结果多维表格 + 模型）→ 与 AI 对话把自然语言需求解析成上游查询参数 →
 * 形成任务 → 后台执行（查上游 → 按源数据ID去重 → 逐批写入结果表）。
 *
 * 数据集的列模板、可筛选字段、表名与示例话术都在 contracts 的 `BIGDATA_DATASETS`
 * 里声明一次，后端建表 / 校验参数 / 拼提示词与前端渲染共用同一份。
 * 上游通道不带凭据（大数据平台当前为开放查询），模型 Key 走「API Key 管理」的 sk- Key，
 * 与 RPA「AI 写脚本」、潜客挖掘同源。
 */

const CHAT_TIMEOUT_MS = 90000;
const CHAT_MAX_TOKENS = 1200;
/** 攒够一批就写表：任务进度更快反映到界面，也躲开多维表格单次 200 行的上限。 */
const INSERT_BATCH = 200;
/** 单个筛选值的长度上限（上游是 LIKE 匹配，长值没有意义）。 */
const FILTER_VALUE_MAX = 200;

export type BigdataSpec = {
  filters: Record<string, unknown>;
  limit: number;
  scene: string;
};

export class BigdataQueryService {
  /** 产物登记通道（services.ts 装配）：任务结果 CSV 存进自有 OSS 并落数字资产台账。 */
  deliverableSink?: DeliverableSink;

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly modelKeys: ModelKeyService,
    private readonly dataTable: DataTableService,
    private readonly llm: RpaLlmService,
  ) {}

  // ---------- 设置 ----------

  async getSettings(
    user: CurrentUser,
    dataset: BigdataDatasetKey,
    token?: string,
  ) {
    const definition = BIGDATA_DATASETS[dataset];
    const row = await this.settingRow(user, dataset);
    const table = row?.dataTableId
      ? await this.prisma.dataTable.findUnique({
          where: { id: row.dataTableId },
          select: { id: true, name: true },
        })
      : null;
    const columnCount = table
      ? await this.prisma.dataTableField.count({ where: { tableId: table.id } })
      : 0;
    const key = await this.keyStatus(token);
    return {
      dataset,
      label: definition.label,
      dataTableId: table?.id || 0,
      dataTableExists: Boolean(table),
      tableName: definition.tableName,
      dataTableActualName: table?.name || '',
      columnCount,
      model: row?.model || '',
      keyConfigured: key.configured,
      keyMasked: key.keyMasked,
      keyStatusError: key.error,
      ready: Boolean(table && (row?.model || '') && key.configured),
    };
  }

  /**
   * 该数据集可选的结果表：列覆盖模板且当前账号写得进行的那些，外加设置里记的默认表。
   * 判定口径复用多维表格的 writableTables，与写行校验同源（这里能选的一定写得进去）。
   */
  async resultTableOptions(user: CurrentUser, dataset: BigdataDatasetKey) {
    const definition = BIGDATA_DATASETS[dataset];
    const requiredColumns = definition.columns.map((column) => column.fieldKey);
    const row = await this.settingRow(user, dataset);
    const defaultRow = row?.dataTableId
      ? await this.prisma.dataTable.findUnique({
          where: { id: row.dataTableId },
          select: { id: true, name: true },
        })
      : null;
    const tables = await this.dataTable.writableTables(user, requiredColumns);
    let defaultTable = null as null | {
      id: number;
      name: string;
      rowCount: number;
    };
    if (defaultRow) {
      defaultTable = {
        id: defaultRow.id,
        name: defaultRow.name,
        rowCount:
          tables.list.find((item) => item.id === defaultRow.id)?.rowCount ?? 0,
      };
    }
    return {
      requiredColumns,
      columnLabels: definition.columns.map((column) => column.name),
      defaultTable,
      tables: tables.list,
    };
  }

  /**
   * 平台 sk- Key 状态：读「API Key 管理」的模型 Key 通道。通道鉴权失败/不可用时
   * 降级为「未确认配置」（keyConfigured=false + 原样带出错误），结果表与模型这些本地项
   * 照常可看可存——辅助通道故障不许打断整页读取。
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
   * 保存设置：默认模型（可选）、默认结果表（可选，传了才改——从已写得进去的表里选一张）。
   * 模型 Key 统一在「API Key 管理」维护，收到一律拒绝（与潜客挖掘同口径）。
   */
  async save(
    user: CurrentUser,
    dataset: BigdataDatasetKey,
    body: Record<string, unknown>,
    token?: string,
  ) {
    if (text(body.apiKey).trim()) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '模型 API Key 已统一在「API Key 管理」维护，这里只需选择模型',
      );
    }
    const definition = BIGDATA_DATASETS[dataset];
    const data: Record<string, unknown> = {};
    if (body.model !== undefined) {
      data.model = text(body.model).trim().slice(0, 128);
    }
    if (body.dataTableId !== undefined) {
      const id = Math.floor(Number(body.dataTableId));
      if (!Number.isFinite(id) || id <= 0) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择一张结果表');
      }
      // 判定与写行同源（有新增权 + 列覆盖模板），能设为默认的表一定写得进去
      await this.dataTable.assertWritable(
        user,
        id,
        definition.columns.map((column) => column.fieldKey),
        `${definition.label}默认结果表`,
      );
      data.dataTableId = id;
    }
    if (!Object.keys(data).length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有需要保存的设置');
    }
    const existing = await this.settingRow(user, dataset);
    const row = existing
      ? await this.prisma.bigdataQuerySetting.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.bigdataQuerySetting.create({
          data: { userId: user.userId, dataset, model: '', ...data },
        });
    await this.identity.audit(
      user.userId,
      '大数据查询保存设置',
      `${dataset} ${
        data.model !== undefined ? `模型=${row.model || '（清空）'} ` : ''
      }${data.dataTableId !== undefined ? `默认结果表#${row.dataTableId}` : ''}`.trim(),
    );
    return this.getSettings(user, dataset, token);
  }

  /**
   * 建该数据集的结果多维表格。
   * - 不传 name：设置页的「生成默认结果表」，幂等——已有且未被删除时直接回现状，否则按模板名新建并设为默认。
   * - 传 name：新建一张指定名字的结果表（列照样按模板建满），只有 setDefault 为真才改默认表，
   *   所以「某个任务想单独存一张表」不会把设置里的默认表顶掉。
   */
  async createDataTable(
    user: CurrentUser,
    dataset: BigdataDatasetKey,
    body: { name?: unknown; setDefault?: unknown } = {},
  ) {
    const definition = BIGDATA_DATASETS[dataset];
    const fields = definition.columns.map((column) => column.fieldKey);
    const name = text(body.name).trim().slice(0, 60);
    const row = await this.settingRow(user, dataset);
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
          fields,
        };
      }
    }
    const created = await this.dataTable.create(user, {
      name: name || definition.tableName,
      description: definition.tableDescription,
    });
    const tableId = Number((created as { id: number }).id);
    await this.dataTable.addFields(
      user,
      tableId,
      definition.columns.map((column) => ({
        name: column.name,
        fieldKey: column.fieldKey,
        fieldType: column.fieldType,
      })),
    );
    // 设置页那条路径（不传名字）一定记为默认表；命名新建只在显式 setDefault 时顶掉默认表。
    const setDefault = !name || body.setDefault === true;
    if (setDefault) {
      if (row) {
        await this.prisma.bigdataQuerySetting.update({
          where: { id: row.id },
          data: { dataTableId: tableId },
        });
      } else {
        await this.prisma.bigdataQuerySetting.create({
          data: { userId: user.userId, dataset, dataTableId: tableId },
        });
      }
    }
    await this.identity.audit(
      user.userId,
      '大数据查询建结果表',
      `${dataset} #${tableId} ${name || definition.tableName}`,
    );
    return {
      created: true,
      dataTableId: tableId,
      name: name || definition.tableName,
      fields,
    };
  }

  /** 可选模型列表：与 RPA「AI 写脚本」同一通道（AIPDD，sk- Key）。 */
  models(user: CurrentUser, token?: string) {
    return this.llm.models(user, token);
  }

  // ---------- 需求对话 ----------

  /**
   * 与 AI 澄清数据需求。前置：该数据集设置必须齐（结果表 + 模型 + 平台 Key）。
   * 对话历史由前端整段发过来，本方法落库最近一轮问答（按数据集分开留存）。
   */
  async chat(
    user: CurrentUser,
    dataset: BigdataDatasetKey,
    body: Record<string, unknown>,
    token?: string,
  ) {
    await this.requireReady(user, dataset, token);
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
    const setting = await this.settingRow(user, dataset);
    const reply = await geoChatMulti({
      baseUrl: this.llm.baseUrl(),
      apiKey,
      model: text(setting?.model).trim(),
      messages: [
        { role: 'system', content: buildIntentSystemPrompt(dataset) },
        ...messages,
      ],
      maxTokens: CHAT_MAX_TOKENS,
      timeoutMs: CHAT_TIMEOUT_MS,
      userId: user.userId,
      purpose: 'chat',
    });
    const spec = parseQueryJson(dataset, reply.reply);
    const lastUser = [...messages]
      .reverse()
      .find((item) => item.role === 'user');
    if (lastUser) {
      await this.prisma.bigdataQueryMessage.create({
        data: {
          userId: user.userId,
          dataset,
          taskId: 0,
          role: 'user',
          content: lastUser.content,
        },
      });
    }
    const shown = stripQueryJson(reply.reply);
    await this.prisma.bigdataQueryMessage.create({
      data: {
        userId: user.userId,
        dataset,
        taskId: 0,
        role: 'assistant',
        content: shown,
      },
    });
    return {
      reply: shown,
      spec,
      done: Boolean(spec),
      elapsedMs: reply.elapsedMs,
    };
  }

  /** 需求对话的历史（该数据集最近 50 条，时间正序）。 */
  async listMessages(user: CurrentUser, dataset: BigdataDatasetKey) {
    const rows = await this.prisma.bigdataQueryMessage.findMany({
      where: { userId: user.userId, dataset, taskId: 0 },
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

  /** 对话确认后创建任务：spec 由前端把 QUERY_JSON 原样提交（也允许界面微调）。 */
  async createTask(
    user: CurrentUser,
    dataset: BigdataDatasetKey,
    body: Record<string, unknown>,
  ) {
    const spec = normalizeSpec(dataset, body.spec);
    if (!spec) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `${BIGDATA_DATASETS[dataset].label}任务参数不合法：至少要有一个筛选条件，条数 1-${BIGDATA_MAX_LIMIT}`,
      );
    }
    const dataTableId = await this.resolveTargetTable(
      user,
      dataset,
      body.dataTableId,
    );
    const row = await this.prisma.bigdataQueryTask.create({
      data: {
        userId: user.userId,
        dataset,
        spec: spec as never,
        rawIntent: text(body.rawIntent).trim().slice(0, 4000),
        dataTableId,
      },
    });
    await this.identity.audit(
      user.userId,
      '大数据查询建任务',
      `${dataset} #${row.id} 取${spec.limit}条 结果表#${dataTableId}`,
    );
    return decorateTask(row, await this.tableName(user, dataTableId));
  }

  /**
   * 改任务的结果表：还没跑出结果的任务（待执行 / 失败）可以换目标表，
   * 执行中不许换（后台正在往旧表写），已完成的换表等于把「查看结果」指向另一张表，也不许。
   */
  async updateTaskTable(
    user: CurrentUser,
    dataset: BigdataDatasetKey,
    id: number,
    dataTableId: unknown,
  ) {
    const row = await this.prisma.bigdataQueryTask.findFirst({
      where: { id, userId: user.userId, dataset },
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
        '任务执行中，暂不能改结果表',
      );
    }
    if (row.status === 'success') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该任务已完成，结果表不再变更；要存到别的表请新建任务',
      );
    }
    const target = await this.resolveTargetTable(user, dataset, dataTableId);
    const updated = await this.prisma.bigdataQueryTask.update({
      where: { id },
      data: { dataTableId: target },
    });
    await this.identity.audit(
      user.userId,
      '大数据查询改任务结果表',
      `${dataset} #${id} → #${target}`,
    );
    return decorateTask(updated, await this.tableName(user, target));
  }

  async listTasks(
    user: CurrentUser,
    dataset: BigdataDatasetKey,
    query: { page?: number; pageSize?: number },
  ) {
    const { page, pageSize, offset } = pageParam(query.page, query.pageSize);
    const [rows, total] = await Promise.all([
      this.prisma.bigdataQueryTask.findMany({
        where: { userId: user.userId, dataset },
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.bigdataQueryTask.count({
        where: { userId: user.userId, dataset },
      }),
    ]);
    const names = await this.tableNames(rows.map((row) => row.dataTableId));
    return pageOf(
      rows.map((row) => decorateTask(row, names.get(row.dataTableId) || '')),
      total,
      page,
      pageSize,
    );
  }

  async getTask(user: CurrentUser, dataset: BigdataDatasetKey, id: number) {
    const row = await this.prisma.bigdataQueryTask.findFirst({
      where: { id, userId: user.userId, dataset },
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
   * 开始 / 重试执行：请求内只校验结果表（取数与写表用不到模型 Key），
   * 然后把「查上游 → 去重 → 写表」放到后台跑，界面用任务列表轮询进度。
   */
  async start(user: CurrentUser, dataset: BigdataDatasetKey, id: number) {
    const row = await this.prisma.bigdataQueryTask.findFirst({
      where: { id, userId: user.userId, dataset },
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
        '该任务已完成；要再取一轮请新建任务',
      );
    }
    const spec = normalizeSpec(dataset, row.spec);
    if (!spec) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '任务参数已失效，请重建任务',
      );
    }
    // 写哪张表只看任务自己（老任务没记表时回落到设置里的默认表），不再固定用设置那张
    const dataTableId = await this.resolveTargetTable(
      user,
      dataset,
      row.dataTableId,
    );
    // 抢占执行权：同一任务可能被连点两次，条件更新保证只有一个赢家能进 running
    const grabbed = await this.prisma.bigdataQueryTask.updateMany({
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
    const started = await this.prisma.bigdataQueryTask.findUniqueOrThrow({
      where: { id },
    });
    // 后台执行不能继承这次点击的取消信号：用户关掉标签页也要把这一轮取数跑完
    void runInRequestContext(
      () => this.run(user, dataset, started.id, spec, dataTableId),
      { requestId: currentRequest()?.requestId },
    ).catch(() => undefined);
    await this.identity.audit(
      user.userId,
      '大数据查询执行任务',
      `${dataset} #${id} 取${spec.limit}条 结果表#${dataTableId}`,
    );
    return decorateTask(started, await this.tableName(user, dataTableId));
  }

  async removeTask(user: CurrentUser, dataset: BigdataDatasetKey, id: number) {
    const row = await this.prisma.bigdataQueryTask.findFirst({
      where: { id, userId: user.userId, dataset },
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
    await this.prisma.bigdataQueryTask.delete({ where: { id } });
    await this.identity.audit(
      user.userId,
      '大数据查询删任务',
      `${dataset} #${id}`,
    );
    return { id, deleted: true };
  }

  // ---------- 执行流水线（后台） ----------

  private async run(
    user: CurrentUser,
    dataset: BigdataDatasetKey,
    taskId: number,
    spec: BigdataSpec,
    dataTableId: number,
  ) {
    try {
      const definition = BIGDATA_DATASETS[dataset];
      const result = await queryBigdata(dataset, spec.filters, spec.limit);
      await this.prisma.bigdataQueryTask.update({
        where: { id: taskId },
        data: { totalFound: result.rows.length },
      });

      // 与结果表里已收录的源数据ID对照（跨任务去重）
      const existing = await this.prisma.$queryRaw<
        { source_id: string | null }[]
      >(
        Prisma.sql`SELECT ${jsonText('data', 'source_id')} AS source_id FROM data_table_rows WHERE table_id = ${dataTableId}`,
      );
      const seen = new Set(
        existing.map((row) => String(row.source_id || '')).filter(Boolean),
      );

      const batch: Record<string, unknown>[] = [];
      const deliverableRows: Record<string, unknown>[] = [];
      let saved = 0;
      let skipped = 0;
      for (const item of result.rows) {
        const sourceId = text(item.id).trim();
        if (!sourceId || seen.has(sourceId)) {
          skipped += 1;
          continue;
        }
        seen.add(sourceId);
        const row = toTableRow(definition.columns, item, sourceId);
        batch.push(row);
        deliverableRows.push(row);
        if (batch.length >= INSERT_BATCH) {
          await this.dataTable.createRows(user, dataTableId, batch);
          saved += batch.length;
          batch.length = 0;
          await this.prisma.bigdataQueryTask.update({
            where: { id: taskId },
            data: { totalSaved: saved, totalSkipped: skipped },
          });
        }
      }
      if (batch.length) {
        await this.dataTable.createRows(user, dataTableId, batch);
        saved += batch.length;
      }
      await this.prisma.bigdataQueryTask.update({
        where: { id: taskId },
        data: { status: 'success', totalSaved: saved, totalSkipped: skipped },
      });
      await this.identity.audit(
        user.userId,
        '大数据查询任务完成',
        `${dataset} #${taskId} 命中${result.rows.length}条 收录${saved}条 跳过${skipped}条`,
      );
      // 产物归档：命中收录的行导出 CSV，经登记通道存进自有 OSS 并入数字资产（尽力而为）。
      if (this.deliverableSink && deliverableRows.length) {
        await this.deliverableSink(user.userId, {
          bytes: buildDeliverableCsv(
            definition.columns.map((column) => ({ key: column.fieldKey, label: column.name })),
            deliverableRows,
          ),
          filename: `大数据查询-${definition.label || dataset}-任务${taskId}.csv`,
          labels: ['营销工具', '大数据查询'],
          dir: 'marketing/bigdata',
          source: 'bigdata-query',
        }).catch(() => undefined);
      }
    } catch (error) {
      const message = (error as Error)?.message || '执行失败';
      await this.prisma.bigdataQueryTask
        .update({
          where: { id: taskId },
          data: { status: 'failed', error: message.slice(0, 2000) },
        })
        .catch(() => undefined);
    }
  }

  // ---------- 内部 ----------

  private settingRow(user: CurrentUser, dataset: BigdataDatasetKey) {
    return this.prisma.bigdataQuerySetting.findFirst({
      where: { userId: user.userId, dataset },
    });
  }

  /** AI 解析需求前的门槛：该数据集的设置没齐就拒，并说清缺哪一项。 */
  private async requireReady(
    user: CurrentUser,
    dataset: BigdataDatasetKey,
    token?: string,
  ) {
    const settings = await this.getSettings(user, dataset, token);
    const missing: string[] = [];
    if (!settings.dataTableExists) missing.push(`${settings.tableName}结果表`);
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
   * 建任务/开始查询的门槛：只要设置里有默认结果表（任务没单独指定表时的落点）。
   * 文字模型与平台 Key 只在「AI 把需求解析成查询参数」那一步用到，查询与写表整条链路不碰它们——
   * 辅助项没配齐不该拦住取数主链路。
   */
  private async requireTable(user: CurrentUser, dataset: BigdataDatasetKey) {
    const setting = await this.settingRow(user, dataset);
    const table = setting?.dataTableId
      ? await this.prisma.dataTable.findUnique({
          where: { id: setting.dataTableId },
          select: { id: true },
        })
      : null;
    if (!setting || !table) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `请先在「${BIGDATA_DATASETS[dataset].label}」里生成结果表`,
      );
    }
    return setting;
  }

  /**
   * 定下这个任务写哪张表：指定了就用指定的（按列模板与写权限硬校验），
   * 没指定就落到设置里的默认结果表。
   */
  private async resolveTargetTable(
    user: CurrentUser,
    dataset: BigdataDatasetKey,
    value: unknown,
  ) {
    const label = `${BIGDATA_DATASETS[dataset].label}结果表`;
    const id = Math.floor(Number(value));
    if (!Number.isFinite(id) || id <= 0) {
      const setting = await this.requireTable(user, dataset);
      await this.dataTable.assertWritable(
        user,
        setting.dataTableId,
        BIGDATA_DATASETS[dataset].columns.map((column) => column.fieldKey),
        label,
      );
      return setting.dataTableId;
    }
    await this.dataTable.assertWritable(
      user,
      id,
      BIGDATA_DATASETS[dataset].columns.map((column) => column.fieldKey),
      label,
    );
    return id;
  }

  private async tableName(user: CurrentUser, tableId: number) {
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

/** 路径里的数据集标识：不在注册表里一律拒收（前端只可能传这五个键）。 */
export function assertDataset(raw: string): BigdataDatasetKey {
  const key = String(raw || '').trim() as BigdataDatasetKey;
  if (!BIGDATA_DATASETS[key]) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `未知的大数据数据集：${text(raw) || '（空）'}`,
    );
  }
  return key;
}

/** 对话确认后的任务参数：非法值一律返回 null，由调用方拒收。 */
export function normalizeSpec(
  dataset: BigdataDatasetKey,
  value: unknown,
): BigdataSpec | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const rawFilters =
    raw.filters &&
    typeof raw.filters === 'object' &&
    !Array.isArray(raw.filters)
      ? (raw.filters as Record<string, unknown>)
      : {};
  const filters: Record<string, unknown> = {};
  for (const field of BIGDATA_DATASETS[dataset].filters) {
    const picked = pickFilterValue(field, rawFilters[field.key]);
    if (picked !== undefined) filters[field.key] = picked;
  }
  if (!Object.keys(filters).length) return null;
  const limit = Math.floor(Number(raw.limit));
  if (!Number.isFinite(limit) || limit < 1 || limit > BIGDATA_MAX_LIMIT) {
    return null;
  }
  return {
    filters,
    limit,
    scene: text(raw.scene).trim().slice(0, 2000),
  };
}

function pickFilterValue(
  field: BigdataFilterField,
  value: unknown,
): string | number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (field.valueType === 'number') {
    const num = Math.floor(Number(value));
    return Number.isFinite(num) && num >= 0 ? num : undefined;
  }
  const flag = text(value).trim().slice(0, FILTER_VALUE_MAX);
  return flag || undefined;
}

/** 上游行 → 结果表行：列键逐字对齐，数值列拿不到有限数时留空而不是让整批写入失败。 */
function toTableRow(
  columns: { fieldKey: string; fieldType: 'text' | 'number' }[],
  item: Record<string, unknown>,
  sourceId: string,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const column of columns) {
    if (column.fieldKey === 'source_id') {
      row.source_id = sourceId;
      continue;
    }
    const value = item[column.fieldKey];
    if (column.fieldType === 'number') {
      const num = Number(typeof value === 'string' ? value.trim() : value);
      row[column.fieldKey] = Number.isFinite(num) ? num : null;
      continue;
    }
    row[column.fieldKey] = text(value).trim().slice(0, 2000);
  }
  return row;
}

function parseQueryJson(
  dataset: BigdataDatasetKey,
  reply: string,
): BigdataSpec | null {
  const match = /QUERY_JSON\s*:\s*(\{[\s\S]*?\})\s*(?=\n|$)/.exec(
    String(reply || ''),
  );
  if (!match) return null;
  try {
    return normalizeSpec(dataset, JSON.parse(match[1]));
  } catch {
    return null;
  }
}

/** 回给界面的正文去掉 QUERY_JSON 标记行（前端拿 spec 字段即可）。 */
function stripQueryJson(reply: string) {
  return String(reply || '')
    .replace(/QUERY_JSON\s*:\s*\{[\s\S]*?\}\s*(?=\n|$)/, '')
    .trim();
}

function decorateTask(
  row: {
    id: number;
    dataset: string;
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
    dataset: row.dataset,
    spec: normalizeSpec(row.dataset as BigdataDatasetKey, row.spec) || row.spec,
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

function buildIntentSystemPrompt(dataset: BigdataDatasetKey) {
  const definition = BIGDATA_DATASETS[dataset];
  const fields = definition.filters
    .map(
      (field) =>
        `- ${field.key}（${field.label}）${field.hint ? `：${field.hint}` : ''}`,
    )
    .join('\n');
  const languageRule =
    definition.valueLanguage === 'en'
      ? '- 这个数据集里的值以英文存储（采购商名称、行业、国家、城市等），用户用中文描述需求时要先翻成对应的英文写法再填值，比如「美国」写 United States、「厨房用品」写 kitchen；这批数据里的行业是英文短语，翻不准就先追问，或改用更宽的英文词并说明可能命中少，不要直接填中文；'
      : '- 这个数据集里的值以中文存储，省份、城市、行业按库里的中文写法给；';
  return `你是「${definition.label}」大数据查询的需求澄清助手。用户要用大白话描述他想从这批数据里捞什么，你的任务是问清楚，形成一次可执行的上游查询参数。

这个数据集可以筛选的字段（只能用这些键，值按说明给）：
${fields}

需要澄清到位的信息：
1. 筛选条件：至少一项，能从用户的话里直接落到上面的字段；行业 / 类目 / 地区这类词要给出该数据集里的规范写法（例如行业大类要写全称）；
2. 条数：本次要写入结果表的行数，1-${BIGDATA_MAX_LIMIT}；
3. 场景：这批数据拿来做什么（用于回显，不影响查询）。

要求：
${languageRule}- 用中文、口语化，一次最多追问一个缺口，别连着问一串；
- 用户一句话已经说清时，直接复述参数并确认，不要为问而问；
- 用户提了这套字段筛不了的条件（比如要求「有官网且成立满 5 年」），如实说明这一项筛不了，问他要改成哪个可用的条件，不要编造字段；
- 上游是模糊匹配（包含 / 前缀），值给得越具体命中越准；
- 确认后在回复末尾另起一行输出：
QUERY_JSON:{"filters":{"city":"广州"},"limit":50,"scene":"找广州做五金的门店线索"}
- QUERY_JSON 里 filters 的键限上面列出的字段，limit 是整数；没确认齐之前不要输出 QUERY_JSON。`;
}
