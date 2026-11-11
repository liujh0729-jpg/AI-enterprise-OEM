import { cronMatches, dueCronSlots, parseCron, slotKey } from './workflow-cron';

/** 01:00Z ＝ Asia/Shanghai 09:00；2026-11-08 周日、11-09 周一、11-13 周五。 */
const at = (iso: string) => new Date(iso);

function spec(expression: string) {
  const parsed = parseCron(expression);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.spec;
}

describe('cron parse', () => {
  it('rejects expressions that are not five fields', () => {
    expect(parseCron('0 9 * *').ok).toBe(false);
    expect(parseCron('0 9 * * * *').ok).toBe(false);
    expect(parseCron('@daily').ok).toBe(false);
    expect(parseCron('').ok).toBe(false);
  });

  it('rejects out-of-range values and reversed ranges', () => {
    expect(parseCron('60 9 * * *').ok).toBe(false);
    expect(parseCron('0 24 * * *').ok).toBe(false);
    expect(parseCron('0 9 0 * *').ok).toBe(false);
    expect(parseCron('0 9 * 13 *').ok).toBe(false);
    expect(parseCron('0 9 * * 8').ok).toBe(false);
    expect(parseCron('0 9-1 * * *').ok).toBe(false);
  });

  it('rejects malformed steps', () => {
    expect(parseCron('*/0 * * * *').ok).toBe(false);
    expect(parseCron('*/-1 * * * *').ok).toBe(false);
    expect(parseCron('*/x * * * *').ok).toBe(false);
    expect(parseCron('1/2/3 * * * *').ok).toBe(false);
  });

  it('expands wildcard steps and keeps any=false so dom/dow semantics stay correct', () => {
    const parsed = parseCron('*/15 * * * *');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect([...parsed.spec.minute.values]).toEqual([0, 15, 30, 45]);
    expect(parsed.spec.minute.any).toBe(false);
    expect(parsed.spec.dom.any).toBe(true);
  });

  it('treats a bare number with a step as "from that value to the field max"', () => {
    expect([...spec('5/15 * * * *').minute.values]).toEqual([5, 20, 35, 50]);
  });

  it('normalizes sunday 7 to 0', () => {
    expect([...spec('0 9 * * 7').dow.values]).toEqual([0]);
  });

  it('accepts lists and ranges together', () => {
    expect([...spec('0 9,18 * * 1-5').hour.values]).toEqual([9, 18]);
    expect([...spec('0 9 * * 1-5').dow.values]).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('cron match', () => {
  it('matches weekday mornings in Asia/Shanghai regardless of server timezone', () => {
    const weekday = spec('0 9 * * 1-5');
    expect(cronMatches(weekday, at('2026-11-10T01:00:00Z'))).toBe(true);
    expect(cronMatches(weekday, at('2026-11-09T01:00:00Z'))).toBe(true);
    expect(cronMatches(weekday, at('2026-11-08T01:00:00Z'))).toBe(false);
    expect(cronMatches(weekday, at('2026-11-14T01:00:00Z'))).toBe(false);
  });

  it('ignores seconds inside the matched minute', () => {
    const every = spec('* * * * *');
    expect(cronMatches(every, at('2026-11-10T01:00:59Z'))).toBe(true);
  });

  it('does not match a different hour', () => {
    expect(cronMatches(spec('0 9 * * *'), at('2026-11-10T02:00:00Z'))).toBe(
      false,
    );
  });

  it('uses OR when both day-of-month and day-of-week are restricted', () => {
    const either = spec('0 9 13 * 1');
    // 11-13 是周五但命中「13 号」；11-09 是周一但命中「周一」。
    expect(cronMatches(either, at('2026-11-13T01:00:00Z'))).toBe(true);
    expect(cronMatches(either, at('2026-11-09T01:00:00Z'))).toBe(true);
    expect(cronMatches(either, at('2026-11-10T01:00:00Z'))).toBe(false);
  });

  it('uses AND when only one of dom/dow is restricted', () => {
    const mondayOnly = spec('0 9 * * 1');
    expect(cronMatches(mondayOnly, at('2026-11-09T01:00:00Z'))).toBe(true);
    expect(cronMatches(mondayOnly, at('2026-11-13T01:00:00Z'))).toBe(false);
    const thirteenthOnly = spec('0 9 13 * *');
    expect(cronMatches(thirteenthOnly, at('2026-11-13T01:00:00Z'))).toBe(true);
    expect(cronMatches(thirteenthOnly, at('2026-11-09T01:00:00Z'))).toBe(false);
  });

  it('matches a step schedule only on its own minutes', () => {
    const quarter = spec('*/15 * * * *');
    expect(cronMatches(quarter, at('2026-11-10T01:00:00Z'))).toBe(true);
    expect(cronMatches(quarter, at('2026-11-10T01:15:00Z'))).toBe(true);
    expect(cronMatches(quarter, at('2026-11-10T01:07:00Z'))).toBe(false);
  });
});

describe('cron due slots', () => {
  const minuteOf = (iso: string) => Math.floor(at(iso).getTime() / 60_000);

  it('returns the minutes strictly after fromMinute up to toMinute', () => {
    const to = minuteOf('2026-11-10T01:05:00Z');
    const slots = dueCronSlots(spec('* * * * *'), to - 3, to);
    expect(slots).toEqual([
      at('2026-11-10T01:03:00Z').getTime(),
      at('2026-11-10T01:04:00Z').getTime(),
      at('2026-11-10T01:05:00Z').getTime(),
    ]);
  });

  it('caps the catch-up window so a long downtime does not burst', () => {
    const to = minuteOf('2026-11-10T01:00:00Z');
    const slots = dueCronSlots(spec('* * * * *'), to - 600, to, 3);
    expect(slots).toHaveLength(3);
    expect(slots[2]).toBe(at('2026-11-10T01:00:00Z').getTime());
  });

  it('returns nothing when the schedule does not hit the window', () => {
    const to = minuteOf('2026-11-10T03:00:00Z');
    expect(dueCronSlots(spec('0 9 * * *'), to - 5, to)).toEqual([]);
  });

  it('builds a stable idempotency key without milliseconds', () => {
    expect(slotKey(at('2026-11-10T01:00:00Z').getTime())).toBe(
      '2026-11-10T01:00:00Z',
    );
    expect(slotKey(at('2026-11-10T01:00:00.000Z').getTime())).toBe(
      '2026-11-10T01:00:00Z',
    );
  });
});
