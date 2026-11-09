import { aiChat, parseJsonObject, tryChat } from '../ai/ai-gateway';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { toJsonArray } from '../shared/json-value';
import {
  DataTableService,
  FIELD_TYPES,
  type DataFieldRow,
} from './data-table.service';

/**
 * 多维表格 AI（AI 底座 §五 P1-B）：
 * ① 字段级 AI 列——按提示词 + 取材列，批量为某列生成值并写回（缺 Key 回落规则拼接）；
 * ② 问数/聚合——服务端**先把全表聚合成结构化摘要**再喂模型（省钱、防幻觉），缺 Key 直接回聚合口径；
 * ③ 一句话建表 + AI 生成视图——用户主动发起的「AI 生成」，缺 Key 走 requireModel 给出可执行引导。
 *
 * 三条都经 §4.1 统一网关取模型与记账；写库一律复用 DataTableService.updateRows，
 * 保证权限位、列校验、飞书同步通知与手动录入完全同源。
 */

/** AI 列一次最多处理的行数：整表进一次提示词会爆 token，也把事务拖长。 */
const AI_ROW_LIMIT = 200;
/** 问数扫描的行数上限：超过只聚合前 N 行并如实标注。 */
const ASK_ROW_LIMIT = 5000;
/** 喂给模型的样本行数（聚合口径是全量，样本只用于让模型看懂数据长什么样）。 */
const ASK_SAMPLE = 30;
const CHAT_TIMEOUT_MS = 30000;
const MAX_PLAN_FIELDS = 30;
const FIELD_KEY_PATTERN = /^[a-z0-9_]+$/;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(typeof value === 'string' ? value.trim() : value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return AI_ROW_LIMIT;
  return Math.min(Math.floor(parsed), AI_ROW_LIMIT);
}

/** 全表聚合：数字列算合计/均值/极值，其余列给取值分布 top5，日期列给区间。 */
function aggregateRows(
  fields: DataFieldRow[],
  rows: { data: unknown }[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { rows: rows.length };
  for (const field of fields) {
    const values = rows
      .map((row) => asObject(row.data)[field.fieldKey])
      .filter((value) => value !== null && value !== undefined && value !== '');
    const entry: Record<string, unknown> = {
      filled: values.length,
      type: field.fieldType,
    };
    if (field.fieldType === 'number') {
      const numbers = values
        .map(num)
        .filter((item): item is number => item !== null);
      if (numbers.length) {
        const sum = numbers.reduce((acc, item) => acc + item, 0);
        entry.sum = Number(sum.toFixed(4));
        entry.avg = Number((sum / numbers.length).toFixed(4));
        entry.min = Math.min(...numbers);
        entry.max = Math.max(...numbers);
      }
    } else if (field.fieldType === 'boolean') {
      entry.true = values.filter(
        (value) => value === true || text(value) === 'true',
      ).length;
      entry.false = values.length - Number(entry.true);
    } else if (field.fieldType === 'date') {
      const times = values
        .map((value) => new Date(text(value)).getTime())
        .filter((time) => !Number.isNaN(time));
      if (times.length) {
        entry.min = new Date(Math.min(...times)).toISOString().slice(0, 10);
        entry.max = new Date(Math.max(...times)).toISOString().slice(0, 10);
      }
    } else {
      const counts = new Map<string, number>();
      for (const value of values) {
        const key = text(value).trim().slice(0, 40);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      entry.top = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([value, count]) => ({ value, count }));
      entry.distinct = counts.size;
    }
    out[field.fieldKey] = entry;
  }
  return out;
}

/** 缺 Key / 不用模型时的问数兜底：把聚合口径讲成人话，结论仍可用。 */
function aggregateNarrative(
  total: number,
  aggregates: Record<string, unknown>,
  fields: DataFieldRow[],
  truncated: boolean,
): string {
  const lines: string[] = [
    `本表共 ${total} 行${truncated ? `（本次仅聚合前 ${ASK_ROW_LIMIT} 行）` : ''}。`,
    '当前没有可用的文字模型，以下是服务端直接算出的聚合口径（未调用模型）：',
  ];
  // 聚合结果是 JSON 列（Record<string, unknown>），进模板前先按类型收口，避免把 undefined 拼进话术。
  const count = (value: unknown): string => {
    const parsed = num(value);
    return parsed === null ? '—' : String(parsed);
  };
  const label = (value: unknown): string => text(value) || '—';
  for (const field of fields) {
    const entry = asObject(aggregates[field.fieldKey]);
    if (!entry || !entry.filled) continue;
    if (field.fieldType === 'number') {
      lines.push(
        `· ${field.name}：合计 ${count(entry.sum)}，均值 ${count(entry.avg)}，最小 ${count(entry.min)}，最大 ${count(entry.max)}`,
      );
    } else if (field.fieldType === 'boolean') {
      lines.push(
        `· ${field.name}：是 ${count(entry.true)} / 否 ${count(entry.false)}`,
      );
    } else if (field.fieldType === 'date') {
      lines.push(
        `· ${field.name}：从 ${label(entry.min)} 到 ${label(entry.max)}`,
      );
    } else {
      const top =
        (entry.top as { value: string; count: number }[] | undefined) ?? [];
      lines.push(
        `· ${field.name}：${top.map((item) => `${item.value}(${item.count})`).join('、') || '无'}（去重 ${count(entry.distinct)} 种）`,
      );
    }
  }
  return lines.join('\n');
}

export class DataTableAiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tables: DataTableService,
    private readonly identity: IdentityService,
  ) {}

  private chatMeta(operation: string) {
    return { module: 'data-table', operation } as const;
  }

  // ---------- ① AI 列：批量填列 ----------

  async fillColumn(
    user: CurrentUser,
    tableId: number,
    body: Record<string, unknown>,
  ) {
    await this.tables.authorize(user, tableId, 'update');
    const fields = await this.tables.fieldsOf(tableId);
    if (!fields.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '该表还没有列');
    }
    const fieldKey = text(body.field_key || body.fieldKey).trim();
    const target = fields.find((field) => field.fieldKey === fieldKey);
    if (!target) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `列键「${fieldKey}」不属于该表`,
      );
    }
    const prompt = text(body.prompt).trim().slice(0, 500);
    const asked = (
      toJsonArray(body.source_keys ?? body.sourceKeys) as unknown[]
    )
      .map((key) => text(key).trim())
      .filter(Boolean);
    const sourceKeys = (
      asked.length ? asked : fields.map((field) => field.fieldKey)
    ).filter((key) => key !== fieldKey);
    const unknown = sourceKeys.filter(
      (key) => !fields.some((field) => field.fieldKey === key),
    );
    if (unknown.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `取材列不存在：${unknown.join('、')}`,
      );
    }
    if (!sourceKeys.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '至少要有一列作为取材来源',
      );
    }
    const sources = fields.filter((field) =>
      sourceKeys.includes(field.fieldKey),
    );
    const rows = await this.prisma.dataTableRow.findMany({
      where: { tableId },
      orderBy: { id: 'asc' },
      take: clampLimit(body.limit),
    });
    if (!rows.length) {
      return {
        fieldKey,
        updated: 0,
        skipped: 0,
        model: '',
        mode: 'rule' as const,
      };
    }
    const samples = rows.map((row) => {
      const data = asObject(row.data);
      const picked: Record<string, unknown> = { id: row.id };
      for (const field of sources)
        picked[field.fieldKey] = data[field.fieldKey] ?? '';
      return picked;
    });

    let mode: 'llm' | 'rule' = 'rule';
    let model = '';
    const values = new Map<number, unknown>();
    const out = await tryChat(this.prisma, {
      userId: user.userId,
      messages: [
        {
          role: 'system',
          content: [
            '你是企业数据表的内容生成助手。',
            '按「要求」为每一行生成目标列的值，只输出一个 JSON 对象：{"values":{"行id":"值"}}。',
            '不要输出解释、Markdown 或代码块围栏；数据里没有依据的行直接省略，不要编造。',
            `目标列类型是 ${target.fieldType}，值必须符合该类型${
              choicesOf(target).length
                ? `，且只能取这些候选之一：${choicesOf(target).join(' / ')}`
                : ''
            }。`,
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `目标列：${target.name}`,
            `取材列：${JSON.stringify(
              sources.map((field) => ({
                key: field.fieldKey,
                name: field.name,
              })),
            )}`,
            prompt
              ? `要求：${prompt}`
              : '要求：根据取材列的值，生成简洁、可直接使用的内容。',
            `数据：${JSON.stringify(samples)}`,
          ].join('\n'),
        },
      ],
      maxTokens: 2000,
      timeoutMs: CHAT_TIMEOUT_MS,
      purpose: 'batch',
      ...this.chatMeta('ai_fill_column'),
    });
    if (out) {
      const parsed = parseJsonObject(out.reply);
      const map = parsed?.values;
      if (map && typeof map === 'object' && !Array.isArray(map)) {
        for (const sample of samples) {
          const value = (map as Record<string, unknown>)[String(sample.id)];
          if (value !== undefined && value !== null && value !== '') {
            values.set(Number(sample.id), value);
          }
        }
        if (values.size) {
          mode = 'llm';
          model = out.model;
        }
      }
    }
    if (mode === 'rule') {
      // 缺 Key / 模型没给出可用值时：把取材列拼接成文本落进目标列，功能不空转。
      for (const sample of samples) {
        const parts = sources
          .map((field) => text(sample[field.fieldKey]).trim())
          .filter(Boolean);
        if (parts.length) values.set(Number(sample.id), parts.join(' · '));
      }
    }

    const updates: { id: number; data: Record<string, unknown> }[] = [];
    let skipped = 0;
    for (const row of rows) {
      const produced = values.get(row.id);
      if (produced === undefined) {
        skipped += 1;
        continue;
      }
      const merged = { ...asObject(row.data), [target.fieldKey]: produced };
      try {
        // 与手动录入同一份 coerce：模型给出越界单选值 / 非法数字的整行跳过，不写脏数据。
        this.tables.normalizeRow(fields, merged);
      } catch {
        skipped += 1;
        continue;
      }
      updates.push({ id: row.id, data: merged });
    }
    const { updated } = await this.tables.updateRows(user, tableId, updates);
    await this.identity.audit(
      user.userId,
      '多维表格 AI 填列',
      `#${tableId} ${target.name} · ${updated} 行（${mode === 'llm' ? model : '规则拼接'}）`,
    );
    return { fieldKey: target.fieldKey, updated, skipped, model, mode };
  }

  // ---------- ② 问数 / 聚合 ----------

  async ask(user: CurrentUser, tableId: number, body: Record<string, unknown>) {
    await this.tables.authorize(user, tableId, 'read');
    const question = text(body.question).trim().slice(0, 1000);
    if (!question) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请输入要问的问题');
    }
    const fields = await this.tables.fieldsOf(tableId);
    const columns = fields.map((field) => ({
      key: field.fieldKey,
      name: field.name,
      type: field.fieldType,
    }));
    const total = await this.prisma.dataTableRow.count({ where: { tableId } });
    const rows = await this.prisma.dataTableRow.findMany({
      where: { tableId },
      orderBy: { id: 'desc' },
      take: ASK_ROW_LIMIT,
    });
    const aggregates = aggregateRows(fields, rows);
    const sample = rows.slice(0, ASK_SAMPLE).map((row) => {
      const data = asObject(row.data);
      const picked: Record<string, unknown> = {};
      for (const column of columns) picked[column.key] = data[column.key] ?? '';
      return picked;
    });
    if (!rows.length) {
      return {
        answer: '该表还没有数据。',
        mode: 'aggregate' as const,
        model: '',
        columns,
        aggregates,
        rows: [],
        total: 0,
        sampleSize: 0,
      };
    }
    const out = await tryChat(this.prisma, {
      userId: user.userId,
      messages: [
        {
          role: 'system',
          content: [
            '你是企业数据表的分析助手。',
            '只能依据给定的聚合口径与样本数据回答，不要臆测；数据不足就直说缺什么。',
            '结论先行、用简体中文、必要时给数字；不要输出 SQL，也不要编造数据里没有的行。',
            `本次提供了全表聚合（共 ${total} 行）与前 ${sample.length} 行样本，如结论依赖全量请以聚合为准。`,
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `列：${JSON.stringify(columns)}`,
            `全表聚合：${JSON.stringify(aggregates)}`,
            `样本数据：${JSON.stringify(sample)}`,
            `问题：${question}`,
          ].join('\n'),
        },
      ],
      maxTokens: 1500,
      timeoutMs: CHAT_TIMEOUT_MS,
      ...this.chatMeta('ai_ask'),
    });
    const answer = out
      ? text(out.reply).trim()
      : aggregateNarrative(total, aggregates, fields, total > rows.length);
    await this.identity.audit(
      user.userId,
      '多维表格 AI 问数',
      `#${tableId} ${out ? out.model : '聚合口径'}：${question.slice(0, 40)}`,
    );
    return {
      answer,
      mode: out ? ('llm' as const) : ('aggregate' as const),
      model: out?.model ?? '',
      columns,
      aggregates,
      rows: sample,
      total,
      sampleSize: sample.length,
    };
  }

  // ---------- ③ 一句话建表 ----------

  async planTable(user: CurrentUser, body: Record<string, unknown>) {
    const request = text(body.text).trim().slice(0, 1000);
    if (!request) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请用一句话描述要建的表',
      );
    }
    // 用户主动发起的「AI 生成」：缺 Key 直接给可执行引导，不静默糊一张空表。
    const out = await aiChat(this.prisma, {
      userId: user.userId,
      messages: [
        {
          role: 'system',
          content: [
            '你是企业数据表的建模助手。',
            '只输出一个 JSON 对象：{"name":"表名","description":"用途","fields":[{"name":"列名","field_key":"english_key","field_type":"text|number|boolean|date|url|email|json|select","choices":["候选"],"required":true}]}。',
            '不要输出解释、Markdown 或代码块围栏；field_key 只能用小写字母、数字、下划线。',
            'select 列必须给 choices；除非用户明确要求，否则 required 一律 false；列数控制在 3~12 列。',
          ].join('\n'),
        },
        { role: 'user', content: `要建的表：${request}` },
      ],
      maxTokens: 1600,
      timeoutMs: CHAT_TIMEOUT_MS,
      ...this.chatMeta('ai_plan_table'),
    });
    const plan = normalizePlan(parseJsonObject(out.reply), request);
    if (!plan) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '没读懂要建的表结构，请把用途和要记的字段说得再具体一点',
      );
    }
    await this.identity.audit(
      user.userId,
      '多维表格 AI 建表',
      `${out.model}：${plan.name}（${plan.fields.length} 列）`,
    );
    return { ...plan, model: out.model, mode: 'llm' as const };
  }

  // ---------- ④ AI 生成视图 ----------

  async planView(
    user: CurrentUser,
    tableId: number,
    body: Record<string, unknown>,
  ) {
    await this.tables.authorize(user, tableId, 'read');
    const request = text(body.text).trim().slice(0, 500);
    if (!request) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请用一句话描述想要的视图',
      );
    }
    const fields = await this.tables.fieldsOf(tableId);
    if (!fields.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '该表还没有列');
    }
    const out = await aiChat(this.prisma, {
      userId: user.userId,
      messages: [
        {
          role: 'system',
          content: [
            '你是企业数据表的视图设计助手。',
            '只输出一个 JSON 对象：{"name":"视图名","type":"GRID|KANBAN|DASHBOARD","config":{...}}。',
            'KANBAN 的 config 用 {"groupBy":"列键"}；DASHBOARD 用 {"metrics":[{"key":"列键","agg":"sum|avg|count|min|max"}]}。',
            'groupBy 只能取单选列或文本列的列键，metrics 的 key 只能取数字列；不要编造不存在的列键。',
            '不要输出解释、Markdown 或代码块围栏。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `列：${JSON.stringify(
              fields.map((field) => ({
                key: field.fieldKey,
                name: field.name,
                type: field.fieldType,
              })),
            )}`,
            `要求：${request}`,
          ].join('\n'),
        },
      ],
      maxTokens: 800,
      timeoutMs: CHAT_TIMEOUT_MS,
      ...this.chatMeta('ai_plan_view'),
    });
    const view = normalizeView(parseJsonObject(out.reply), fields, request);
    if (!view) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '模型没有给出可用的视图配置，请换个说法再试',
      );
    }
    await this.identity.audit(
      user.userId,
      '多维表格 AI 视图',
      `#${tableId} ${view.name}（${view.type}）`,
    );
    return { ...view, model: out.model };
  }
}

function choicesOf(field: DataFieldRow): string[] {
  const options = asObject(field.options);
  const choices = options.choices;
  if (Array.isArray(choices))
    return choices.map((item) => text(item)).filter(Boolean);
  return [];
}

/** 把模型给的建表草稿收成可提交的形状：列键合法且唯一、列类型在表内、select 必带候选。 */
function normalizePlan(
  parsed: Record<string, unknown> | null,
  fallbackName: string,
): { name: string; description: string; fields: PlanField[] } | null {
  if (!parsed) return null;
  const rawFields = Array.isArray(parsed.fields) ? parsed.fields : [];
  const used = new Set<string>();
  const fields: PlanField[] = [];
  for (const raw of rawFields.slice(0, MAX_PLAN_FIELDS)) {
    const field = asObject(raw);
    const name = text(field.name).trim().slice(0, 200);
    if (!name) continue;
    let key = text(field.field_key || field.fieldKey)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 64);
    if (!key || !FIELD_KEY_PATTERN.test(key)) {
      key = `field_${fields.length + 1}`;
    }
    while (used.has(key)) key = `${key.slice(0, 60)}_${fields.length + 1}`;
    used.add(key);
    const type = text(field.field_type || field.fieldType)
      .trim()
      .toLowerCase();
    const fieldType = (FIELD_TYPES as readonly string[]).includes(type)
      ? type
      : 'text';
    const choices = (field.choices as unknown[] | undefined)?.map
      ? (field.choices as unknown[])
          .map((item) => text(item).trim())
          .filter(Boolean)
      : [];
    const ai = asObject(field.ai);
    const aiPrompt = text(ai.prompt).trim().slice(0, 500);
    const aiSources = (
      toJsonArray(ai.source_keys ?? ai.sourceKeys) as unknown[]
    )
      .map((item) => text(item).trim())
      .filter(Boolean);
    fields.push({
      name,
      field_key: key,
      field_type:
        fieldType === 'select' && !choices.length ? 'text' : fieldType,
      choices: fieldType === 'select' ? choices : [],
      required: field.required === true,
      ai: aiPrompt ? { prompt: aiPrompt, source_keys: aiSources } : null,
    });
  }
  if (!fields.length) return null;
  return {
    name: text(parsed.name).trim().slice(0, 200) || fallbackName.slice(0, 200),
    description: text(parsed.description).trim().slice(0, 500),
    fields,
  };
}

type PlanField = {
  name: string;
  field_key: string;
  field_type: string;
  choices: string[];
  required: boolean;
  ai: { prompt: string; source_keys: string[] } | null;
};

/** 视图草稿归一：列键必须真实存在，不合法就换成本表可用的默认值，实在没有就返回 null。 */
function normalizeView(
  parsed: Record<string, unknown> | null,
  fields: DataFieldRow[],
  fallbackName: string,
): {
  name: string;
  type: 'GRID' | 'KANBAN' | 'DASHBOARD';
  config: Record<string, unknown>;
} | null {
  if (!parsed) return null;
  const rawType = text(parsed.type).trim().toUpperCase();
  const config = asObject(parsed.config);
  const groupable = fields.filter(
    (field) => field.fieldType === 'select' || field.fieldType === 'text',
  );
  const numeric = fields.filter((field) => field.fieldType === 'number');
  const type: 'GRID' | 'KANBAN' | 'DASHBOARD' =
    rawType === 'KANBAN' || rawType === 'DASHBOARD' ? rawType : 'GRID';
  let nextConfig: Record<string, unknown> = {};
  if (type === 'KANBAN') {
    const groupBy = text(config.groupBy).trim();
    const key = groupable.some((field) => field.fieldKey === groupBy)
      ? groupBy
      : groupable[0]?.fieldKey;
    if (!key) return null;
    nextConfig = { groupBy: key };
  } else if (type === 'DASHBOARD') {
    const raw = Array.isArray(config.metrics) ? config.metrics : [];
    const metrics = raw
      .map((item) => asObject(item))
      .map((item) => ({
        key: text(item.key).trim(),
        agg: text(item.agg).trim().toLowerCase() || 'sum',
      }))
      .filter((item) => numeric.some((field) => field.fieldKey === item.key))
      .slice(0, 6);
    if (!metrics.length) return null;
    nextConfig = { metrics };
  } else {
    nextConfig = {};
  }
  return {
    name: text(parsed.name).trim().slice(0, 200) || fallbackName.slice(0, 200),
    type,
    config: nextConfig,
  };
}
