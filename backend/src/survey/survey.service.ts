import { randomBytes } from 'node:crypto';
import {
  z,
  type Survey,
  type SurveyQuestion,
  type SurveyResults,
  type SurveySettings,
  type SurveyStatus,
  surveyCreateBodySchema,
  surveySettingsSchema,
  surveyUpdateBodySchema,
} from '@enterprise/contracts';
import { Prisma } from '../../generated/prisma';
import type { CurrentUser } from '../auth/current-user';
import { pageOf } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { DataTableService } from '../data-table/data-table.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  aggregateResults,
  fieldForQuestion,
  normalizeAnswers,
  normalizeQuestions,
  parseQuestions,
  parseSettings,
} from './survey.helpers';

type CreateInput = z.infer<typeof surveyCreateBodySchema>;
type UpdateInput = z.infer<typeof surveyUpdateBodySchema>;

type SurveyRow = {
  id: number;
  code: string;
  createdBy: string;
  title: string;
  description: string;
  status: string;
  questions: Prisma.JsonValue;
  settings: Prisma.JsonValue;
  tableId: number;
  responseCount: number;
  publishedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type SurveyInsert = {
  createdBy: string;
  title: string;
  description: string;
  status: string;
  questions: Prisma.InputJsonValue;
  settings: Prisma.InputJsonValue;
  tableId: number;
};

const RESULT_ROW_LIMIT = 50000;
const CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

function newCode() {
  const bytes = randomBytes(12);
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

/**
 * 营销问卷与调研（营销工具）。
 *
 * 设计：题目与分享设置落 `marketing_surveys`；创建问卷时自动建一张多维表格
 * （列键＝题目编号 q1…qN），公开提交的每一份答案写一行进这张表。
 * 这样回收数据天然可排序、筛选、导出，也能继续接飞书同步；
 * 题目在「草稿」阶段可自由改，一旦发布并收到回答就锁定，避免历史行和新题目错位。
 */
export class SurveyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataTables: DataTableService,
    private readonly identity: IdentityService,
  ) {}

  private view(row: SurveyRow): Survey {
    return {
      id: row.id,
      code: row.code,
      title: row.title,
      description: row.description,
      status: row.status as SurveyStatus,
      questions: parseQuestions(row.questions),
      settings: parseSettings(row.settings),
      tableId: row.tableId,
      sharePath: `/survey/${row.code}`,
      responseCount: row.responseCount,
      publishedAt: iso(row.publishedAt),
      closedAt: iso(row.closedAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async owned(user: CurrentUser, id: number) {
    const row = await this.prisma.marketingSurvey.findUnique({ where: { id } });
    if (!row || row.createdBy !== user.userId) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '该问卷不存在');
    }
    return row;
  }

  private async insertRow(input: SurveyInsert) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.marketingSurvey.create({
          data: { ...input, code: newCode() },
        });
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === 2) throw error;
      }
    }
    throw new BusinessException(ErrorCode.INTERNAL_ERROR, '问卷编号生成失败');
  }

  async page(user: CurrentUser, query: Record<string, unknown>) {
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const pageSize = Math.min(
      Math.max(Math.floor(Number(query.pageSize) || 20), 1),
      200,
    );
    const status = typeof query.status === 'string' ? query.status : '';
    const where: Prisma.MarketingSurveyWhereInput = { createdBy: user.userId };
    if (status) where.status = status;
    const [rows, total] = await Promise.all([
      this.prisma.marketingSurvey.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.marketingSurvey.count({ where }),
    ]);
    return pageOf(
      rows.map((row) => this.view(row)),
      total,
      page,
      pageSize,
    );
  }

  async detail(user: CurrentUser, id: number) {
    return this.view(await this.owned(user, id));
  }

  async create(user: CurrentUser, input: CreateInput) {
    const title = input.title.trim();
    const questions = normalizeQuestions(input.questions);
    const settings: SurveySettings = surveySettingsSchema.parse({
      ...parseSettings({}),
      ...(input.settings || {}),
    });
    const table = await this.dataTables.create(user, {
      name: `问卷回收·${title}`.slice(0, 200),
      description: `营销问卷「${title}」的回收数据，每份提交一行。`,
    });
    const tableId = Number(table.id);
    try {
      await this.dataTables.addFields(
        user,
        tableId,
        questions.map(fieldForQuestion),
      );
    } catch (error) {
      await this.dataTables.remove(user, tableId).catch(() => undefined);
      throw error;
    }
    let row: SurveyRow;
    try {
      row = await this.insertRow({
        createdBy: user.userId,
        title,
        description: input.description?.trim() || '',
        status: 'DRAFT',
        questions: questions,
        settings: settings,
        tableId,
      });
    } catch (error) {
      await this.dataTables.remove(user, tableId).catch(() => undefined);
      throw error;
    }
    await this.identity.audit(
      user.userId,
      '营销问卷创建',
      `#${row.id} ${row.title} · 回收表 #${tableId}`,
    );
    return this.view(row);
  }

  async update(user: CurrentUser, id: number, input: UpdateInput) {
    const row = await this.owned(user, id);
    const data: Prisma.MarketingSurveyUpdateInput = {};
    if (input.title !== undefined) data.title = input.title.trim();
    if (input.description !== undefined)
      data.description = input.description.trim();
    if (input.settings !== undefined) {
      data.settings = surveySettingsSchema.parse({
        ...parseSettings(row.settings),
        ...input.settings,
      });
    }
    if (input.questions !== undefined) {
      if (row.status !== 'DRAFT' || row.responseCount > 0) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          row.responseCount > 0
            ? '这份问卷已经收到回答，题目已锁定；如需改题请新建一份问卷'
            : '问卷已发布，请先结束并新建问卷再改题目',
        );
      }
      const previous = parseQuestions(row.questions);
      const next = normalizeQuestions(input.questions);
      await this.syncFields(user, row.tableId, previous, next);
      data.questions = next;
    }
    if (!Object.keys(data).length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有需要保存的修改');
    }
    const updated = await this.prisma.marketingSurvey.update({
      where: { id },
      data,
    });
    await this.identity.audit(
      user.userId,
      '营销问卷保存',
      `#${id} ${updated.title}`,
    );
    return this.view(updated);
  }

  /** 草稿阶段把题目变化同步到回收表：删题删列、改题改列、加题加列（此时表里还没有行）。 */
  private async syncFields(
    user: CurrentUser,
    tableId: number,
    previous: SurveyQuestion[],
    next: SurveyQuestion[],
  ) {
    const fields = await this.prisma.dataTableField.findMany({
      where: { tableId },
    });
    const byKey = new Map(fields.map((field) => [field.fieldKey, field]));
    const nextIds = new Set(next.map((question) => question.id));
    for (const question of previous) {
      if (nextIds.has(question.id)) continue;
      const field = byKey.get(question.id);
      if (field) await this.dataTables.deleteField(user, tableId, field.id);
    }
    for (const question of next) {
      const field = byKey.get(question.id);
      if (!field) continue;
      const definition = fieldForQuestion(question);
      await this.dataTables.updateField(user, tableId, field.id, {
        name: definition.name,
        fieldType: definition.fieldType,
        required: definition.required,
        choices: definition.choices ?? [],
      });
    }
    const added = next.filter((question) => !byKey.has(question.id));
    if (added.length) {
      await this.dataTables.addFields(
        user,
        tableId,
        added.map(fieldForQuestion),
      );
    }
  }

  async publish(user: CurrentUser, id: number) {
    const row = await this.owned(user, id);
    if (row.status === 'PUBLISHED') {
      throw new BusinessException(ErrorCode.CONFLICT, '问卷已经在收集中');
    }
    if (row.status !== 'DRAFT') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '请使用「重新开放」恢复已结束的问卷',
      );
    }
    if (!parseQuestions(row.questions).length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先添加至少一道题目',
      );
    }
    const updated = await this.prisma.marketingSurvey.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: new Date(), closedAt: null },
    });
    await this.identity.audit(
      user.userId,
      '营销问卷发布',
      `#${id} ${updated.title}`,
    );
    return this.view(updated);
  }

  async close(user: CurrentUser, id: number) {
    const row = await this.owned(user, id);
    if (row.status !== 'PUBLISHED') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '只有收集中的问卷可以结束',
      );
    }
    const updated = await this.prisma.marketingSurvey.update({
      where: { id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    await this.identity.audit(
      user.userId,
      '营销问卷结束',
      `#${id} ${updated.title}`,
    );
    return this.view(updated);
  }

  async reopen(user: CurrentUser, id: number) {
    const row = await this.owned(user, id);
    if (row.status !== 'CLOSED') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '只有已结束的问卷可以重新开放',
      );
    }
    const updated = await this.prisma.marketingSurvey.update({
      where: { id },
      data: { status: 'PUBLISHED', closedAt: null },
    });
    await this.identity.audit(
      user.userId,
      '营销问卷重新开放',
      `#${id} ${updated.title}`,
    );
    return this.view(updated);
  }

  /** 删除问卷定义；回收多维表格保留（已有回答是账号的数据资产，不随问卷删除）。 */
  async remove(user: CurrentUser, id: number) {
    const row = await this.owned(user, id);
    await this.prisma.marketingSurvey.delete({ where: { id } });
    await this.identity.audit(
      user.userId,
      '营销问卷删除',
      `#${id} ${row.title} · 回收表 #${row.tableId} 保留`,
    );
    return { removed: true, tableId: row.tableId };
  }

  async results(
    user: CurrentUser,
    id: number,
    query: Record<string, unknown>,
  ): Promise<SurveyResults> {
    const row = await this.owned(user, id);
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const pageSize = Math.min(
      Math.max(Math.floor(Number(query.pageSize) || 20), 1),
      200,
    );
    const [total, stored, rows] = await Promise.all([
      this.prisma.dataTableRow.count({ where: { tableId: row.tableId } }),
      this.prisma.dataTableRow.findMany({
        where: { tableId: row.tableId },
        select: { id: true, createdAt: true, data: true },
        orderBy: { id: 'desc' },
        take: RESULT_ROW_LIMIT,
      }),
      this.prisma.dataTableRow.findMany({
        where: { tableId: row.tableId },
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      total,
      questions: aggregateResults(parseQuestions(row.questions), stored),
      rows: rows.map((item) => ({
        id: item.id,
        createdAt: item.createdAt.toISOString(),
        data:
          item.data &&
          typeof item.data === 'object' &&
          !Array.isArray(item.data)
            ? (item.data as Record<string, unknown>)
            : {},
      })),
      page,
      pageSize,
      tableId: row.tableId,
    };
  }

  /** 公开填写页读取：草稿不对外暴露，已结束仍返回题目供页面展示「已结束」。 */
  async publicView(code: string) {
    const row = await this.prisma.marketingSurvey.findUnique({
      where: { code },
    });
    if (!row || row.status === 'DRAFT') {
      throw new BusinessException(ErrorCode.NOT_FOUND, '问卷不存在或尚未发布');
    }
    const settings = parseSettings(row.settings);
    return {
      code: row.code,
      title: row.title,
      description: row.description,
      status: row.status as 'PUBLISHED' | 'CLOSED',
      questions: parseQuestions(row.questions),
      allowMultiple: settings.allowMultiple,
      thankYouText: settings.thankYouText,
    };
  }

  /** 公开提交：只接受已发布问卷，按题目收口答案后写进回收表。 */
  async submit(
    code: string,
    answers: Record<string, unknown>,
    options: { seenBefore?: boolean } = {},
  ) {
    const row = await this.prisma.marketingSurvey.findUnique({
      where: { code },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '问卷不存在');
    if (row.status !== 'PUBLISHED') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        row.status === 'CLOSED' ? '问卷已结束，不再接收回答' : '问卷尚未发布',
      );
    }
    const settings = parseSettings(row.settings);
    if (!settings.allowMultiple && options.seenBefore) {
      throw new BusinessException(ErrorCode.CONFLICT, '你已经提交过这份问卷');
    }
    const values = normalizeAnswers(parseQuestions(row.questions), answers);
    const created = await this.dataTables.appendSystemRow(
      row.tableId,
      values,
      `survey:${row.code}`,
    );
    await this.prisma.marketingSurvey.update({
      where: { id: row.id },
      data: { responseCount: { increment: 1 } },
    });
    return {
      submitted: true,
      responseId: created.id,
      thankYouText: settings.thankYouText,
    };
  }
}
