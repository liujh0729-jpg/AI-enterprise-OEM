import {
  normalizeDomain,
  siteOrigin,
  sameSite,
  paramsHash,
  medianPosition,
  gridPoints,
  nextRunDate,
  dfsUnitPrice,
} from './seo-shared';

describe('normalizeDomain / siteOrigin', () => {
  it('去协议/端口/路径/www 并小写', () => {
    expect(normalizeDomain('https://www.Example.com:8443/path?q=1')).toBe(
      'example.com',
    );
    expect(normalizeDomain('Example.COM')).toBe('example.com');
    expect(siteOrigin('https://example.com/')).toBe('https://example.com');
  });

  it('空值与非法格式直接拒绝', () => {
    expect(() => normalizeDomain('')).toThrow();
    expect(() => normalizeDomain('not a domain')).toThrow();
  });
});

describe('sameSite', () => {
  it('www 视为同域', () => {
    expect(sameSite('https://www.example.com/a', 'example.com')).toBe(true);
  });
  it('默认严格：子域不算同域', () => {
    expect(sameSite('https://blog.example.com/a', 'example.com')).toBe(false);
    expect(sameSite('https://example.com/a', 'example.com', true)).toBe(true);
    expect(sameSite('https://blog.example.com/a', 'example.com', true)).toBe(
      true,
    );
  });
  it('站外与非法 URL 判否', () => {
    expect(sameSite('https://other.com/a', 'example.com', true)).toBe(false);
    expect(sameSite('not a url', 'example.com')).toBe(false);
  });
});

describe('paramsHash（研究日志缓存指纹）', () => {
  it('键序无关：同参数命中同一指纹', () => {
    expect(paramsHash({ a: 1, b: 'x' })).toBe(paramsHash({ b: 'x', a: 1 }));
  });
  it('嵌套对象同样键序无关', () => {
    expect(paramsHash({ o: { x: 1, y: 2 }, arr: [1, 2] })).toBe(
      paramsHash({ arr: [1, 2], o: { y: 2, x: 1 } }),
    );
  });
  it('不同参数指纹不同', () => {
    expect(paramsHash({ a: 1 })).not.toBe(paramsHash({ a: 2 }));
  });
});

describe('medianPosition（多次读取取信）', () => {
  it('全部未命中返回 null', () => {
    expect(medianPosition([null, null])).toBeNull();
    expect(medianPosition([])).toBeNull();
    expect(medianPosition([0, -1])).toBeNull();
  });
  it('奇数取中位数', () => {
    expect(medianPosition([3, 1, 2])).toBe(2);
    expect(medianPosition([null, 5, null])).toBe(5);
  });
  it('偶数取中间两数平均（四舍五入）', () => {
    expect(medianPosition([1, 2])).toBe(2);
    expect(medianPosition([4, 1, 3, 2])).toBe(3);
  });
});

describe('gridPoints（本地 SEO 网格）', () => {
  const center = { centerLat: 31.23, centerLng: 121.47, radiusKm: 5 };
  it('3×3 铺 9 点、5×5 铺 25 点', () => {
    expect(gridPoints({ ...center, gridSize: 3 })).toHaveLength(9);
    expect(gridPoints({ ...center, gridSize: 5 })).toHaveLength(25);
  });
  it('非法 gridSize 退回 3×3', () => {
    expect(gridPoints({ ...center, gridSize: 7 })).toHaveLength(9);
  });
  it('中心格点坐标等于中心点', () => {
    const points = gridPoints({ ...center, gridSize: 3 });
    const middle = points.find((p) => p.row === 1 && p.col === 1);
    expect(middle?.lat).toBeCloseTo(31.23, 5);
    expect(middle?.lng).toBeCloseTo(121.47, 5);
  });
  it('格点坐标互不相同', () => {
    const points = gridPoints({ ...center, gridSize: 5 });
    const keys = new Set(points.map((p) => `${p.lat},${p.lng}`));
    expect(keys.size).toBe(25);
  });
});

describe('nextRunDate', () => {
  const from = new Date('2026-01-01T00:00:00Z');
  it('按频率推下次运行日', () => {
    expect(nextRunDate('DAILY', from).toISOString()).toBe(
      '2026-01-02T00:00:00.000Z',
    );
    expect(nextRunDate('WEEKLY', from).toISOString()).toBe(
      '2026-01-08T00:00:00.000Z',
    );
    expect(nextRunDate('MONTHLY', from).toISOString()).toBe(
      '2026-01-31T00:00:00.000Z',
    );
  });
  it('未知频率退回每周', () => {
    expect(nextRunDate('BOGUS', from).toISOString()).toBe(
      '2026-01-08T00:00:00.000Z',
    );
  });
});

describe('dfsUnitPrice（成本预估）', () => {
  const original = process.env.SEO_DFS_UNIT_USD;
  afterEach(() => {
    if (original === undefined) delete process.env.SEO_DFS_UNIT_USD;
    else process.env.SEO_DFS_UNIT_USD = original;
  });
  it('按端点给参考单价', () => {
    delete process.env.SEO_DFS_UNIT_USD;
    expect(dfsUnitPrice('serp')).toBe(0.002);
    expect(dfsUnitPrice('keywords')).toBe(0.05);
    expect(dfsUnitPrice('backlinks')).toBe(0.02);
    expect(dfsUnitPrice('unknown')).toBe(0.002);
  });
  it('可用环境变量覆盖', () => {
    process.env.SEO_DFS_UNIT_USD = '0.01';
    expect(dfsUnitPrice('serp')).toBe(0.01);
  });
});
