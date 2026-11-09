import {
  parseCsv,
  parseGscCsv,
  aggregateBy,
  analyzeGsc,
  type GscRow,
} from './seo-gsc';

describe('parseCsv', () => {
  it('支持双引号包裹、引号内逗号与 "" 转义', () => {
    const rows = parseCsv('a,"b,c","say ""hi"""\n1,2,3');
    expect(rows).toEqual([
      ['a', 'b,c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });

  it('剥离 BOM、兼容 CRLF、丢弃全空行', () => {
    const rows = parseCsv('\ufeffquery,clicks\r\nfoo,1\r\n\r\nbar,2\r\n');
    expect(rows).toEqual([
      ['query', 'clicks'],
      ['foo', '1'],
      ['bar', '2'],
    ]);
  });

  it('引号内换行保留为字段内容', () => {
    const rows = parseCsv('a,"line1\nline2"\nb,c');
    expect(rows[0]).toEqual(['a', 'line1\nline2']);
  });
});

describe('parseGscCsv', () => {
  it('识别英文表头并解析指标', () => {
    const csv =
      'Query,Page,Clicks,Impressions,CTR,Position\nseo tool,https://example.com/a,10,100,10%,5.2\n';
    const { rows } = parseGscCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      query: 'seo tool',
      page: 'https://example.com/a',
      clicks: 10,
      impressions: 100,
      ctr: 10,
      position: 5.2,
    });
  });

  it('识别中文表头别名，缺 CTR 时按点击/曝光推算', () => {
    const csv =
      '关键词,网页,点击量,曝光量,平均排名\n工具,https://example.com/b,5,200,8\n';
    const { rows } = parseGscCsv(csv);
    expect(rows[0].query).toBe('工具');
    expect(rows[0].ctr).toBe(2.5);
    expect(rows[0].position).toBe(8);
  });

  it('无法识别任何指标列时返回空（不猜列序）', () => {
    expect(parseGscCsv('foo,bar\n1,2').rows).toEqual([]);
    expect(parseGscCsv('only one line').rows).toEqual([]);
  });

  it('汇总日期区间', () => {
    const csv =
      'Date,Query,Clicks,Impressions,Position\n2026-01-02,a,1,10,3\n2026-01-01,b,2,20,4\n';
    expect(parseGscCsv(csv).dateRange).toBe('2026-01-01 ~ 2026-01-02');
  });
});

describe('aggregateBy', () => {
  it('点击/曝光求和，排名按曝光加权', () => {
    const rows: GscRow[] = [
      {
        query: 'a',
        page: 'p1',
        clicks: 1,
        impressions: 100,
        ctr: 1,
        position: 10,
      },
      {
        query: 'a',
        page: 'p2',
        clicks: 3,
        impressions: 300,
        ctr: 1,
        position: 20,
      },
    ];
    const [agg] = aggregateBy(rows, 'query');
    expect(agg.clicks).toBe(4);
    expect(agg.impressions).toBe(400);
    expect(agg.position).toBe(17.5);
    expect(agg.ctr).toBe(1);
  });
});

describe('analyzeGsc striking distance', () => {
  const row = (position: number, impressions: number, query = 'q'): GscRow => ({
    query,
    page: 'https://example.com/',
    clicks: 1,
    impressions,
    ctr: 1,
    position,
  });

  it('只取平均排名 5–20 且有曝光的词，按曝光降序', () => {
    const rows = [
      row(4.9, 1000, 'too-high'),
      row(5, 50, 'edge-low'),
      row(20, 80, 'edge-high'),
      row(20.1, 999, 'too-low'),
      row(12, 200, 'middle'),
      row(8, 0, 'no-impressions'),
    ];
    const analysis = analyzeGsc(rows);
    expect(analysis.strikingDistance.map((r) => r.query)).toEqual([
      'middle',
      'edge-high',
      'edge-low',
    ]);
  });

  it('汇总点击/曝光与加权平均排名', () => {
    const analysis = analyzeGsc([row(10, 100), row(20, 300)]);
    expect(analysis.totalClicks).toBe(2);
    expect(analysis.totalImpressions).toBe(400);
    expect(analysis.avgPosition).toBe(17.5);
    expect(analysis.avgCtr).toBe(0.5);
  });

  it('空数据不产生 NaN', () => {
    const analysis = analyzeGsc([]);
    expect(analysis.avgPosition).toBe(0);
    expect(analysis.avgCtr).toBe(0);
    expect(analysis.strikingDistance).toEqual([]);
  });
});
