import { endpoints } from '@enterprise/contracts';
import {
  readOutcome,
  resolveWriteIntent,
  sanitizeParams,
} from './agent-intent';

describe('智能体记忆意图解析', () => {
  it('把契约里每个写端点都解析回它自己的 operationId（无碰撞、无遗漏）', () => {
    const failures: string[] = [];
    for (const [operationId, definition] of Object.entries(endpoints)) {
      const method = String(definition.method).toLowerCase();
      if (method === 'get') continue;
      const path = String(definition.path);
      if (path.includes('/enterprise/agent')) continue;
      const resolved = resolveWriteIntent(method, path);
      if (resolved?.operationId !== operationId)
        failures.push(
          `${method.toUpperCase()} ${path} -> ${resolved?.operationId}`,
        );
    }
    expect(failures).toEqual([]);
  });

  it('挂载前缀与去前缀两种入站路径解析出同一个动作', () => {
    const bare = resolveWriteIntent('post', '/enterprise/data-tables');
    const mounted = resolveWriteIntent(
      'post',
      '/api/backend/enterprise/data-tables',
    );
    expect(bare?.operationId).toBeTruthy();
    expect(mounted?.operationId).toBe(bare?.operationId);
  });

  it('静态段优先于 :参数段，且参数值取到最后一个路径参数', () => {
    const withId = resolveWriteIntent('delete', '/enterprise/data-tables/42');
    expect(withId?.operationId).toBe('DataTable_remove');
    expect(withId?.pathParams).toEqual({ id: '42' });
    expect(withId?.domain).toBe('data-tables');
    expect(withId?.targetType).toBe('data-tables');
  });

  it('机器通道与读请求不进意图索引', () => {
    expect(
      resolveWriteIntent('get', '/enterprise/data-tables'),
    ).toBeUndefined();
    expect(
      resolveWriteIntent('post', '/api/backend/enterprise/agent/memory/clear'),
    ).toBeUndefined();
  });

  it('参数摘要脱敏凭据、截断长文本、数组只留条数与样本', () => {
    const params = sanitizeParams({
      password: 'P@ssw0rd!',
      accessKeySecret: 'sk-123456',
      name: '阿里巴巴（中国）网络技术有限公司',
      remark: 'x'.repeat(300),
      rows: Array.from({ length: 5 }, (_, index) => ({ index })),
      empty: null,
    });
    expect(params.password).toBe('[已脱敏]');
    expect(params.accessKeySecret).toBe('[已脱敏]');
    expect(params.name).toBe('阿里巴巴（中国）网络技术有限公司');
    expect(String(params.remark).length).toBe(120);
    expect(params.rows).toEqual({
      count: 5,
      sample: [{ index: 0 }, { index: 1 }],
    });
    expect(params).not.toHaveProperty('empty');
  });

  it('结果判定只认本站信封：code 0 成功，403 已拦截，其余失败', () => {
    expect(readOutcome(200, { code: 0, message: 'ok', data: null })).toEqual({
      outcome: 'ok',
      errorCode: '',
      errorMessage: '',
    });
    expect(
      readOutcome(403, { code: 403, message: '没有权限', data: null }),
    ).toEqual({
      outcome: 'blocked',
      errorCode: '403',
      errorMessage: '没有权限',
    });
    expect(
      readOutcome(400, { code: 40001, message: '名单已存在', data: null }),
    ).toEqual({
      outcome: 'failed',
      errorCode: '40001',
      errorMessage: '名单已存在',
    });
  });
});
