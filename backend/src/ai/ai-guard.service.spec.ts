import { parseGuardSettings, takeRateSlot } from './ai-guard.service';

describe('parseGuardSettings', () => {
  it('没有配置行时用默认值：开启、30/分钟、300/分钟', () => {
    expect(parseGuardSettings([])).toEqual({
      enabled: true,
      userPerMinute: 30,
      orgPerMinute: 300,
      orgOverrides: [],
    });
  });

  it('平台 key 为 0 时关闭，显式 1 时开启', () => {
    expect(
      parseGuardSettings([{ key: 'ai.master.enabled', value: '0' }]).enabled,
    ).toBe(false);
    expect(
      parseGuardSettings([{ key: 'ai.master.enabled', value: '1' }]).enabled,
    ).toBe(true);
  });

  it('限流值非法时回落默认，超上限时夹到边界', () => {
    const settings = parseGuardSettings([
      { key: 'ai.rate.user.perMinute', value: 'abc' },
      { key: 'ai.rate.org.perMinute', value: '999999' },
    ]);
    expect(settings.userPerMinute).toBe(30);
    expect(settings.orgPerMinute).toBe(20000);
  });

  it('组织覆盖按 key 后缀解析，0 表示关闭', () => {
    const settings = parseGuardSettings([
      { key: 'ai.master.org.1001', value: '0' },
      { key: 'ai.master.org.1002', value: '1' },
    ]);
    expect(settings.orgOverrides).toEqual([
      { orgUserId: '1001', enabled: false },
      { orgUserId: '1002', enabled: true },
    ]);
  });
});

describe('takeRateSlot', () => {
  const now = new Date(2026, 10, 7, 10, 0, 0).getTime();

  it('限额内放行，超限拒绝且不扩大窗口', () => {
    const windows = new Map<string, number[]>();
    expect(takeRateSlot(windows, 'u1', 2, now)).toBe(true);
    expect(takeRateSlot(windows, 'u1', 2, now + 1)).toBe(true);
    expect(takeRateSlot(windows, 'u1', 2, now + 2)).toBe(false);
    expect(windows.get('u1')?.length).toBe(2);
  });

  it('60 秒滑动窗口：旧记录过期后重新放行', () => {
    const windows = new Map<string, number[]>();
    takeRateSlot(windows, 'u1', 1, now);
    expect(takeRateSlot(windows, 'u1', 1, now + 59_000)).toBe(false);
    expect(takeRateSlot(windows, 'u1', 1, now + 60_001)).toBe(true);
  });

  it('限额为 0 表示不限，且不写窗口', () => {
    const windows = new Map<string, number[]>();
    for (let i = 0; i < 100; i += 1) {
      expect(takeRateSlot(windows, 'u1', 0, now + i)).toBe(true);
    }
    expect(windows.has('u1')).toBe(false);
  });

  it('不同账号/组织各自独立计数', () => {
    const windows = new Map<string, number[]>();
    expect(takeRateSlot(windows, 'user:a', 1, now)).toBe(true);
    expect(takeRateSlot(windows, 'user:b', 1, now)).toBe(true);
    expect(takeRateSlot(windows, 'org:o1', 1, now)).toBe(true);
    expect(takeRateSlot(windows, 'user:a', 1, now + 1)).toBe(false);
  });
});
