import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { ContentModelSettingService } from '../content/model-setting.service';
import { geoChatMulti } from '../geo/geo-llm.client';
import { PrismaService } from '../prisma/prisma.service';
import { LowCodeAccessService } from './lowcode.access.service';
import {
  type LowCodeProjectRow,
  fieldRuleState,
  hasEntityAction,
  ownerUser,
  rowAllowed,
} from './lowcode.shared';

const FILL_TIMEOUT_MS = 60_000;
const ASK_TIMEOUT_MS = 90_000;
const ASK_SAMPLE = 200;

type Field = {
  id: number;
  tableId: number;
  name: string;
  fieldKey: string;
  fieldType: string;
  options: unknown;
  required: boolean;
};

/**
 * 内建应用的三个 AI 能力：表单填充、受限问数、配置读取。
 *
 * 底座＝本项目的模型设置（渠道 + 模型）：项目里存了 `aiChannelId / aiModel` 就用它，
 * 否则落到调用者自己「模型设置」里的默认文本模型；调用者没配过则再落回项目所有者。
 * 问数只喂给模型当前角色可见的列与行，答案之外的回执也按同一口径裁剪。
 */
export class LowCodeAiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: LowCodeAccessService,
    private readonly modelSettings: ContentModelSettingService,
  ) {}

  private async entityOf(projectId: number, raw: unknown) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '实体编号无效');
    }
    const entity = await this.prisma.lowCodeEntity.findFirst({
      where: { id, projectId },
    });
    if (!entity) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '实体不存在');
    }
    return entity;
  }

  private async fieldsOf(tableId: number): Promise<Field[]> {
    return await this.prisma.dataTableField.findMany({
      where: { tableId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  private settingsOf(project: LowCodeProjectRow) {
    const settings = (project.settings || {}) as Record<string, unknown>;
    return {
      channelId: Number(settings.aiChannelId) || 0,
      model: text(settings.aiModel),
    };
  }

  /** 拿「渠道 + Key + 模型」：项目级覆盖优先，其次当前账号，最后项目所有者。 */
  private async target(
    user: CurrentUser,
    project: LowCodeProjectRow,
    token: string,
  ) {
    const { channelId, model } = this.settingsOf(project);
    const override = model ? { channelId, model } : undefined;
    try {
      return await this.modelSettings.resolveTarget(
        user,
        'text',
        token,
        override,
      );
    } catch (error) {
      if (user.userId === project.ownerUserId) throw error;
      return this.modelSettings.resolveTarget(
        ownerUser(project),
        'text',
        token,
        override,
      );
    }
  }

  private async chat(
    user: CurrentUser,
    project: LowCodeProjectRow,
    token: string,
    system: string,
    prompt: string,
    maxTokens: number,
    timeoutMs: number,
  ) {
    const target = await this.target(user, project, token);
    const result = await geoChatMulti({
      baseUrl: target.baseUrl,
      apiKey: target.apiKey,
      model: target.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      maxTokens,
      timeoutMs,
      userId: user.userId,
      purpose: 'chat',
    });
    return { reply: result.reply, model: target.model };
  }

  async aiFill(
    user: CurrentUser,
    raw: unknown,
    token: string,
    body: { entityId: number; text: string },
  ) {
    const access = await this.access.resolve(user, raw);
    const project = access.project;
    const entity = await this.entityOf(project.id, body.entityId);
    if (!hasEntityAction(access, entity.id, 'create')) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '当前角色不能在该实体新增数据',
      );
    }
    const fields = (await this.fieldsOf(entity.dataTableId)).filter(
      (field) => fieldRuleState(access, entity.id, field.fieldKey) !== 'hidden',
    );
    if (!fields.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '该实体还没有列');
    }
    const spec = fields.map((field) => {
      const choices = choicesOf(field);
      return {
        key: field.fieldKey,
        name: field.name,
        type: field.fieldType,
        required: field.required,
        ...(choices.length ? { choices } : {}),
      };
    });
    const system = [
      '你是企业内建应用的表单填写助手。',
      '只输出一个 JSON 对象，键必须是给定字段的 key，不要输出解释、Markdown 或代码块围栏。',
      '不确定或原文没有的字段不要编造，直接省略。',
      '单选字段的值必须来自 choices；日期用 YYYY-MM-DD；数字只用数字。',
    ].join('\n');
    const prompt = [
      `实体：${entity.name}`,
      `字段：${JSON.stringify(spec)}`,
      `用户描述：${body.text}`,
    ].join('\n');
    const { reply, model } = await this.chat(
      user,
      project,
      token,
      system,
      prompt,
      1200,
      FILL_TIMEOUT_MS,
    );
    const parsed = parseJsonObject(reply);
    const values: Record<string, unknown> = {};
    const skipped: string[] = [];
    for (const field of fields) {
      const raw = parsed?.[field.fieldKey];
      const coerced = coerceFieldValue(field, raw);
      if (coerced === undefined) {
        if (raw !== undefined) skipped.push(field.fieldKey);
        continue;
      }
      values[field.fieldKey] = coerced;
    }
    return { values, skipped, model };
  }

  async aiAsk(
    user: CurrentUser,
    raw: unknown,
    token: string,
    body: { entityId: number; question: string },
  ) {
    const access = await this.access.resolve(user, raw);
    const project = access.project;
    const entity = await this.entityOf(project.id, body.entityId);
    if (!hasEntityAction(access, entity.id, 'read')) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '当前角色看不到该实体的数据',
      );
    }
    const fields = await this.fieldsOf(entity.dataTableId);
    const visible = fields.filter(
      (field) => fieldRuleState(access, entity.id, field.fieldKey) !== 'hidden',
    );
    const columns = visible.map((field) => ({
      key: field.fieldKey,
      name: field.name,
      type: field.fieldType,
    }));
    const rows = await this.prisma.dataTableRow.findMany({
      where: { tableId: entity.dataTableId },
      orderBy: { id: 'desc' },
      take: ASK_SAMPLE * 2,
    });
    const allowed = rows.filter((row) =>
      rowAllowed(access, entity.id, {
        data: row.data,
        createdBy: row.createdBy,
      }),
    );
    const sample = allowed.slice(0, ASK_SAMPLE).map((row) => {
      const data =
        row.data && typeof row.data === 'object' && !Array.isArray(row.data)
          ? (row.data as Record<string, unknown>)
          : {};
      const picked: Record<string, unknown> = {};
      for (const column of columns) picked[column.key] = data[column.key] ?? '';
      return picked;
    });
    const truncated = allowed.length > sample.length;
    if (!sample.length) {
      return {
        answer: '该实体当前没有你可以查看的数据。',
        columns,
        rows: [],
        total: 0,
        truncated: false,
      };
    }
    const system = [
      '你是企业内建应用的数据分析助手。',
      '只能依据给定的数据回答，不要臆测；数据不足就直说，并说明缺什么。',
      '用简体中文、结论先行，必要时给数字；不要输出 SQL，也不要编造数据里没有的行。',
      `本次提供的是样本数据（${sample.length} 行${truncated ? '，非全量' : ''}），如结论依赖全量请说明。`,
    ].join('\n');
    const prompt = [
      `实体：${entity.name}`,
      `列：${JSON.stringify(columns)}`,
      `数据：${JSON.stringify(sample)}`,
      `问题：${body.question}`,
    ].join('\n');
    const { reply } = await this.chat(
      user,
      project,
      token,
      system,
      prompt,
      1600,
      ASK_TIMEOUT_MS,
    );
    return {
      answer: reply,
      columns,
      rows: sample.slice(0, 50),
      total: allowed.length,
      truncated,
    };
  }

  async aiSettings(user: CurrentUser, raw: unknown, token: string) {
    const access = await this.access.resolve(user, raw);
    const project = access.project;
    const { channelId, model } = this.settingsOf(project);
    const settings = await this.modelSettings.settings(user, token);
    let models: string[] = [];
    if (model) {
      models = [model];
    } else {
      try {
        const target = await this.modelSettings.resolveTarget(
          user,
          'text',
          token,
        );
        models = [target.model];
      } catch {
        models = [];
      }
    }
    return {
      channelId,
      model,
      ownerUserId: project.ownerUserId,
      channels: settings.channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        provider: channel.provider,
        enabled: channel.enabled,
      })),
      models,
      configured: Boolean(model),
      message: model
        ? `本项目统一使用「${model}」`
        : '未设置项目默认模型：按调用者自己「模型设置」里的默认文本模型运行',
    };
  }

  async aiSaveSettings(
    user: CurrentUser,
    raw: unknown,
    body: { channelId: number; model: string },
  ) {
    const access = await this.access.requireManage(user, raw);
    const project = access.project;
    const current = (project.settings || {}) as Record<string, unknown>;
    const model = text(body.model).trim().slice(0, 128);
    const channelId = model ? Number(body.channelId) || 0 : 0;
    await this.prisma.lowCodeProject.update({
      where: { id: project.id },
      data: {
        settings: {
          ...current,
          aiChannelId: channelId,
          aiModel: model,
        },
      },
    });
    return this.aiSettings(user, raw, '');
  }

  async aiChannels(user: CurrentUser, raw: unknown, token: string) {
    await this.access.resolve(user, raw);
    const settings = await this.modelSettings.settings(user, token);
    return settings.channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      provider: channel.provider,
      enabled: channel.enabled,
    }));
  }

  async aiModels(
    user: CurrentUser,
    raw: unknown,
    token: string,
    query: { channelId: number },
  ) {
    await this.access.resolve(user, raw);
    const result = await this.modelSettings.models(
      user,
      Number(query.channelId) || 0,
      token,
    );
    return result.models.map((model) => model.id);
  }
}

function choicesOf(field: Field) {
  const options = (field.options || {}) as Record<string, unknown>;
  return Array.isArray(options.choices)
    ? (options.choices as unknown[]).map((item) => text(item)).filter(Boolean)
    : [];
}

function parseJsonObject(reply: string): Record<string, unknown> | null {
  const trimmed = text(reply)
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** 按列类型收敛模型给出的值；不合法的值返 undefined（调用方记进 skipped）。 */
function coerceFieldValue(field: Field, value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  switch (field.fieldType) {
    case 'number': {
      const num = Number(typeof value === 'string' ? value.trim() : value);
      return Number.isFinite(num) ? num : undefined;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      const flag = text(value).trim().toLowerCase();
      if (['true', '1', 'yes', '是'].includes(flag)) return true;
      if (['false', '0', 'no', '否'].includes(flag)) return false;
      return undefined;
    }
    case 'select': {
      const picked = text(value).trim();
      const choices = choicesOf(field);
      if (choices.length && !choices.includes(picked)) return undefined;
      return picked;
    }
    case 'date': {
      const raw = text(value).trim();
      const date = new Date(raw);
      return Number.isNaN(date.getTime()) ? undefined : raw;
    }
    case 'json':
      return value;
    default: {
      const raw = text(value).trim();
      return raw || undefined;
    }
  }
}
