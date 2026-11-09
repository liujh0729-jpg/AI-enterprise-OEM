import {
  SURVEY_MULTIPLE_JOINER,
  SURVEY_QUESTION_ID_PATTERN,
  SURVEY_TEXT_ANSWER_MAX,
  surveyQuestionSchema,
  surveySettingsSchema,
  type SurveyQuestion,
  type SurveyQuestionInput,
  type SurveyQuestionType,
  type SurveyResultQuestion,
  type SurveySettings,
} from '@enterprise/contracts';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

/** 题目类型 → 多维表格列类型（单选落 select，多选落 text 并用「、」拼）。 */
const FIELD_TYPE: Record<SurveyQuestionType, string> = {
  single: 'select',
  multiple: 'text',
  short_text: 'text',
  long_text: 'text',
  number: 'number',
  date: 'date',
  rating: 'number',
};

const CHOICE_TYPES: SurveyQuestionType[] = ['single', 'multiple'];
const isChoice = (type: SurveyQuestionType) => CHOICE_TYPES.includes(type);

/** 库里的 JSON → 题目：逐条校验，坏数据跳过而不是让整份问卷 500。 */
export function parseQuestions(value: unknown): SurveyQuestion[] {
  if (!Array.isArray(value)) return [];
  const questions: SurveyQuestion[] = [];
  for (const item of value) {
    const parsed = surveyQuestionSchema.safeParse(item);
    if (parsed.success) questions.push(parsed.data);
  }
  return questions;
}

/** 库里的 JSON → 回收设置：缺字段按默认值补齐。 */
export function parseSettings(value: unknown): SurveySettings {
  const parsed = surveySettingsSchema.partial().safeParse(value);
  const merged = {
    ...surveySettingsSchema.parse({}),
    ...(parsed.success ? parsed.data : {}),
  };
  return surveySettingsSchema.parse(merged);
}

/** 新题目的编号从已有最大数字顺延，避免与旧列键撞车。 */
function nextQuestionId(used: Set<string>) {
  let max = 0;
  for (const id of used) max = Math.max(max, Number(id.slice(1)) || 0);
  let next = max + 1;
  while (used.has(`q${next}`)) next += 1;
  return `q${next}`;
}

function cleanOptions(type: SurveyQuestionType, options: string[]) {
  if (!isChoice(type)) return [];
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const option of options) {
    const label = option.trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    cleaned.push(label);
  }
  if (cleaned.length < 2) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '单选 / 多选题至少要有两个不同的选项',
    );
  }
  return cleaned;
}

/**
 * 请求体里的题目 → 可落库的题目：保留已有题目 id（回传的 qN），
 * 新增题目顺延编号；同时把选项去重并按题型裁剪。
 */
export function normalizeQuestions(
  inputs: SurveyQuestionInput[],
): SurveyQuestion[] {
  const used = new Set<string>();
  const questions: SurveyQuestion[] = [];
  for (const input of inputs) {
    let id = input.id?.trim() || '';
    if (id) {
      if (!SURVEY_QUESTION_ID_PATTERN.test(id)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `题目编号「${id}」不合法（应为 q1、q2 …）`,
        );
      }
      if (used.has(id)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `题目编号「${id}」重复`,
        );
      }
    } else {
      id = nextQuestionId(used);
    }
    used.add(id);
    const label = input.label.trim();
    if (!label) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '题目名称不能为空');
    }
    const min = input.type === 'rating' ? input.min : 1;
    const max = input.type === 'rating' ? input.max : 5;
    if (input.type === 'rating' && max <= min) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `评分题「${label}」的最高分要大于最低分`,
      );
    }
    questions.push({
      id,
      label,
      type: input.type,
      required: input.required,
      options: cleanOptions(input.type, input.options),
      min,
      max,
    });
  }
  return questions;
}

/** 题目 → 多维表格列（列键即题目编号，回收后不可改）。 */
export function fieldForQuestion(question: SurveyQuestion) {
  return {
    name: question.label.slice(0, 200),
    fieldKey: question.id,
    fieldType: FIELD_TYPE[question.type],
    required: question.required,
    choices: question.type === 'single' ? question.options : undefined,
  };
}

function emptyAnswer(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && !value.trim()) ||
    (Array.isArray(value) && !value.length)
  );
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function choiceAnswer(question: SurveyQuestion, value: unknown): string {
  const options = new Set(question.options);
  if (question.type === 'single') {
    const picked = asText(value);
    if (!options.has(picked)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `「${question.label}」请从选项中选择`,
      );
    }
    return picked;
  }
  const raw = Array.isArray(value)
    ? value.map((item) => asText(item)).filter(Boolean)
    : asText(value)
        .split(/[、,，]/)
        .map((item) => item.trim())
        .filter(Boolean);
  const picked: string[] = [];
  for (const item of raw) {
    if (!options.has(item)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `「${question.label}」的选项「${item}」不在候选里`,
      );
    }
    if (!picked.includes(item)) picked.push(item);
  }
  if (!picked.length) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `「${question.label}」至少选择一项`,
    );
  }
  return picked.join(SURVEY_MULTIPLE_JOINER);
}

/**
 * 公开提交的答案 → 回收表行数据（列键 → 值）。
 * 题型在这里收口：单选只认候选、多选按「、」合并、数字/评分限范围、文本限长。
 */
export function normalizeAnswers(
  questions: SurveyQuestion[],
  answers: Record<string, unknown>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const question of questions) {
    const value = answers[question.id];
    if (emptyAnswer(value)) {
      if (question.required) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `请回答必填题「${question.label}」`,
        );
      }
      continue;
    }
    if (isChoice(question.type)) {
      values[question.id] = choiceAnswer(question, value);
      continue;
    }
    if (question.type === 'number' || question.type === 'rating') {
      const num = Number(typeof value === 'string' ? value.trim() : value);
      if (!Number.isFinite(num)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `「${question.label}」请填写数字`,
        );
      }
      if (question.type === 'rating') {
        if (
          !Number.isInteger(num) ||
          num < question.min ||
          num > question.max
        ) {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            `「${question.label}」请选择 ${question.min}–${question.max} 分的整数`,
          );
        }
      }
      values[question.id] = num;
      continue;
    }
    if (question.type === 'date') {
      const raw = asText(value);
      const parsed = new Date(raw);
      if (!raw || Number.isNaN(parsed.getTime())) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `「${question.label}」请填写合法日期`,
        );
      }
      values[question.id] = raw;
      continue;
    }
    const raw = asText(value);
    if (raw.length > SURVEY_TEXT_ANSWER_MAX) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `「${question.label}」的回答太长（最多 ${SURVEY_TEXT_ANSWER_MAX} 字）`,
      );
    }
    values[question.id] = raw;
  }
  return values;
}

type StoredRow = { id: number; createdAt: Date; data: unknown };

const round1 = (value: number) => Math.round(value * 10) / 10;

/** 回收行 → 逐题统计（后端只读聚合，前端不再二次算百分比）。 */
export function aggregateResults(
  questions: SurveyQuestion[],
  rows: StoredRow[],
): SurveyResultQuestion[] {
  const total = rows.length;
  return questions.map((question) => {
    const values = rows
      .map((row) =>
        row.data && typeof row.data === 'object' && !Array.isArray(row.data)
          ? (row.data as Record<string, unknown>)[question.id]
          : undefined,
      )
      .filter((value) => !emptyAnswer(value));
    const answered = values.length;
    const base = {
      id: question.id,
      label: question.label,
      type: question.type,
      answered,
      skipped: total - answered,
    };
    if (isChoice(question.type)) {
      const counts = new Map<string, number>(
        question.options.map((option) => [option, 0]),
      );
      for (const value of values) {
        const picked =
          question.type === 'multiple'
            ? asText(value).split(SURVEY_MULTIPLE_JOINER)
            : [asText(value)];
        for (const item of picked) {
          if (!item) continue;
          counts.set(item, (counts.get(item) || 0) + 1);
        }
      }
      return {
        ...base,
        options: [...counts.entries()].map(([label, count]) => ({
          label,
          count,
          percent: answered ? round1((count / answered) * 100) : 0,
        })),
      };
    }
    if (question.type === 'number' || question.type === 'rating') {
      const numbers = values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value));
      if (!numbers.length)
        return { ...base, average: null, min: null, max: null };
      return {
        ...base,
        average: round1(
          numbers.reduce((sum, value) => sum + value, 0) / numbers.length,
        ),
        min: Math.min(...numbers),
        max: Math.max(...numbers),
      };
    }
    return {
      ...base,
      samples: values
        .map((value) => asText(value))
        .filter(Boolean)
        .slice(-5)
        .reverse(),
    };
  });
}
