import {
  BOARD_TAB_BOARDS,
  BOARD_TAB_ROLES,
  normalizeBoardTabs,
} from './site-settings.service';

/**
 * 板块页签显隐是管理员在后台填的配置（系统边界输入）：
 * 只允许 `<已知板块>:<已知角色>`，其余脏值必须丢弃，免得前端拿到无法识别的 token。
 */
describe('normalizeBoardTabs', () => {
  it('保留合法的板块:角色 token', () => {
    expect(normalizeBoardTabs(['market:demand', 'supply:services'])).toEqual([
      'market:demand',
      'supply:services',
    ]);
  });

  it('非数组一律当空', () => {
    expect(normalizeBoardTabs(undefined)).toEqual([]);
    expect(normalizeBoardTabs(null)).toEqual([]);
    expect(normalizeBoardTabs('market:demand')).toEqual([]);
    expect(normalizeBoardTabs({ 0: 'market:demand' })).toEqual([]);
  });

  it('丢弃未知板块、未知角色、缺段或多段的值', () => {
    expect(
      normalizeBoardTabs([
        'unknown:demand',
        'market:unknown',
        'market',
        'market:demand:extra',
        '',
        ':demand',
        'market:',
      ]),
    ).toEqual([]);
  });

  it('丢弃非字符串项并去重', () => {
    expect(
      normalizeBoardTabs([
        'market:demand',
        'market:demand',
        1,
        null,
        'tax:services',
      ]),
    ).toEqual(['market:demand', 'tax:services']);
  });

  it('去掉首尾空白后再判定合法性', () => {
    expect(normalizeBoardTabs(['  market:demand  '])).toEqual([
      'market:demand',
    ]);
  });

  it('限量不超过「板块数 × 角色数」，且全量合法值可完整通过', () => {
    const all = BOARD_TAB_BOARDS.flatMap((board) =>
      BOARD_TAB_ROLES.map((role) => `${board}:${role}`),
    );
    const limit = BOARD_TAB_BOARDS.length * BOARD_TAB_ROLES.length;
    const duplicated = [...all, all[0]];
    expect(normalizeBoardTabs(all)).toHaveLength(limit);
    expect(normalizeBoardTabs(duplicated)).toHaveLength(limit);
  });
});
