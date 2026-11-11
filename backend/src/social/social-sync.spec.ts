import { normalizeIdempotencyKey } from './social-sync.service';

describe('normalizeIdempotencyKey', () => {
  it('短于 16 字符时补齐到 16', () => {
    const key = normalizeIdempotencyKey('sns-fr-1');
    expect(key).toHaveLength(16);
    expect(key.startsWith('sns-fr-1')).toBe(true);
  });

  it('超过 100 字符时截断到 100', () => {
    expect(normalizeIdempotencyKey('x'.repeat(180))).toHaveLength(100);
  });

  it('同一输入稳定，不同输入不同', () => {
    const raw = 'sns-mail-42-hello';
    expect(normalizeIdempotencyKey(raw)).toBe(normalizeIdempotencyKey(raw));
    expect(normalizeIdempotencyKey(raw)).not.toBe(
      normalizeIdempotencyKey('sns-mail-42-world'),
    );
  });
});
