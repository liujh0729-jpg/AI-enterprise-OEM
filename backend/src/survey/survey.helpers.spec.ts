import { BusinessException } from '../common/business.exception';
import {
  aggregateResults,
  fieldForQuestion,
  normalizeAnswers,
  normalizeQuestions,
  parseQuestions,
  parseSettings,
} from './survey.helpers';
import type { SurveyQuestionInput } from '@enterprise/contracts';

const input = (
  overrides: Partial<SurveyQuestionInput> = {},
): SurveyQuestionInput => ({
  label: '满意度',
  type: 'single',
  required: false,
  options: ['满意', '一般'],
  min: 1,
  max: 5,
  ...overrides,
});

describe('survey helpers', () => {
  it('新增题目顺延 q1、q2，已有 id 保持不变', () => {
    const questions = normalizeQuestions([
      input({ id: 'q3', label: '旧题' }),
      input({ label: '新题', type: 'short_text', options: [] }),
      input({ label: '第二道新题', type: 'rating', min: 1, max: 10 }),
    ]);
    expect(questions.map((question) => question.id)).toEqual([
      'q3',
      'q4',
      'q5',
    ]);
  });

  it('单选题至少两个不同选项，重复项自动去重', () => {
    const [question] = normalizeQuestions([
      input({ options: ['A', 'A', 'B', ' B '] }),
    ]);
    expect(question.options).toEqual(['A', 'B']);
    expect(() => normalizeQuestions([input({ options: ['A'] })])).toThrow(
      BusinessException,
    );
  });

  it('评分题最高分必须大于最低分', () => {
    expect(() =>
      normalizeQuestions([input({ type: 'rating', min: 5, max: 5 })]),
    ).toThrow(/最高分/);
  });

  it('题目 → 回收表列：单选落 select，多选/填空落文本，评分落数字', () => {
    const [single, multiple, rating, text] = normalizeQuestions([
      input({ id: 'q1' }),
      input({ id: 'q2', type: 'multiple' }),
      input({ id: 'q3', type: 'rating' }),
      input({ id: 'q4', type: 'long_text', options: [] }),
    ]);
    expect(fieldForQuestion(single)).toMatchObject({
      fieldKey: 'q1',
      fieldType: 'select',
      choices: ['满意', '一般'],
    });
    expect(fieldForQuestion(multiple).fieldType).toBe('text');
    expect(fieldForQuestion(rating).fieldType).toBe('number');
    expect(fieldForQuestion(text)).toMatchObject({
      fieldType: 'text',
      choices: undefined,
    });
  });

  it('答案按题型收口：单选取候选、多选合并、评分限范围', () => {
    const questions = normalizeQuestions([
      input({ id: 'q1', required: true }),
      input({ id: 'q2', type: 'multiple' }),
      input({ id: 'q3', type: 'rating', min: 2, max: 5 }),
      input({ id: 'q4', type: 'date' }),
    ]);
    expect(
      normalizeAnswers(questions, {
        q1: '满意',
        q2: ['一般', '满意'],
        q3: 4,
        q4: '2026-11-07',
      }),
    ).toEqual({ q1: '满意', q2: '一般、满意', q3: 4, q4: '2026-11-07' });
    expect(() => normalizeAnswers(questions, {})).toThrow(/必填/);
    expect(() => normalizeAnswers(questions, { q1: '不满意' })).toThrow(/选项/);
    expect(() => normalizeAnswers(questions, { q1: '满意', q3: 5.5 })).toThrow(
      /整数/,
    );
    expect(() =>
      normalizeAnswers(questions, { q1: '满意', q4: 'not-a-date' }),
    ).toThrow(/日期/);
  });

  it('聚合统计：选项票数 / 数字均值 / 文本样本', () => {
    const questions = normalizeQuestions([
      input({ id: 'q1' }),
      input({ id: 'q2', type: 'multiple' }),
      input({ id: 'q3', type: 'number' }),
      input({ id: 'q4', type: 'short_text', options: [] }),
    ]);
    const rows = [
      {
        id: 1,
        createdAt: new Date(),
        data: { q1: '满意', q2: '满意、一般', q3: 4, q4: '不错' },
      },
      {
        id: 2,
        createdAt: new Date(),
        data: { q1: '一般', q2: '一般', q3: 2, q4: '还行' },
      },
      { id: 3, createdAt: new Date(), data: { q1: '满意' } },
    ];
    const [single, multiple, number, text] = aggregateResults(questions, rows);
    expect(single.answered).toBe(3);
    expect(single.skipped).toBe(0);
    expect(single.options).toEqual([
      { label: '满意', count: 2, percent: 66.7 },
      { label: '一般', count: 1, percent: 33.3 },
    ]);
    expect(multiple.options).toEqual([
      { label: '满意', count: 1, percent: 50 },
      { label: '一般', count: 2, percent: 100 },
    ]);
    expect(number).toMatchObject({ average: 3, min: 2, max: 4 });
    expect(text.samples).toEqual(['还行', '不错']);
  });

  it('库里的坏数据按跳过处理，设置缺字段补默认值', () => {
    expect(parseQuestions([{ id: 'bad' }, null])).toEqual([]);
    expect(parseSettings({ allowMultiple: false })).toEqual({
      allowMultiple: false,
      thankYouText: '感谢你的参与，问卷已提交。',
    });
  });
});
