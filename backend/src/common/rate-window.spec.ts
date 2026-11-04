import { BusinessException } from './business.exception';
import { ErrorCode } from './error-code';
import { RateWindow } from './rate-window';

/**
 * 账号级固定窗口限流：上传解包、连接器探测、验密都靠它兜住连点，
 * 判定只看「窗口内第几次」，所以这里只验配额、过期与回滚三件事。
 */
describe('RateWindow', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('窗口内用满配额后拒绝，并给出调用方指定的文案', () => {
    const window = new RateWindow(2, 60_000);
    expect(window.consume('u1', '稍后再试')).toBe(1);
    expect(window.consume('u1', '稍后再试')).toBe(0);
    expect(() => window.consume('u1', '稍后再试')).toThrow(BusinessException);
    try {
      window.consume('u1', '稍后再试');
    } catch (error) {
      const caught = error as BusinessException;
      expect(caught.errorCode).toBe(ErrorCode.RATE_LIMITED);
      expect(caught.message).toBe('稍后再试');
    }
  });

  it('按账号分开计数，不同账号互不影响', () => {
    const window = new RateWindow(1, 60_000);
    window.consume('u1', '稍后再试');
    expect(window.consume('u2', '稍后再试')).toBe(0);
  });

  it('窗口过期后重新计数', () => {
    const window = new RateWindow(1, 1_000);
    window.consume('u1', '稍后再试');
    jest.advanceTimersByTime(1_001);
    expect(window.consume('u1', '稍后再试')).toBe(0);
  });

  it('refund 退回一次额度：随后校验失败的请求不该占着配额', () => {
    const window = new RateWindow(2, 60_000);
    window.consume('u1', '稍后再试');
    window.consume('u1', '稍后再试');
    expect(() => window.consume('u1', '稍后再试')).toThrow(BusinessException);
    window.refund('u1');
    expect(window.consume('u1', '稍后再试')).toBe(0);
  });
});
