import {
  ATTENTION_SOURCES,
  attentionFromSources,
} from '../../frontend/src/lib/attention';

describe('dashboard attention from task center', () => {
  it('keeps the authored order and drops sources without pending tasks', () => {
    const rows = attentionFromSources([
      { key: 'workflow', count: 2 },
      { key: 'desk', count: 1 },
      { key: 'crm', count: 0 },
    ]);

    expect(rows.map((row) => row.key)).toEqual(['desk', 'workflow']);
    expect(rows[1]).toMatchObject({
      label: '工作流待办',
      count: 2,
      to: '/tasks',
    });
  });

  it('ignores unknown sources so the dashboard never shows an entry-less count', () => {
    const rows = attentionFromSources([{ key: 'unknown-source', count: 9 }]);
    expect(rows).toEqual([]);
  });

  it('has one unique entry per task source key', () => {
    const keys = ATTENTION_SOURCES.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([
      'desk',
      'oa',
      'crm',
      'okr',
      'pj',
      'workflow',
      'contract',
      'platform',
    ]);
  });
});
