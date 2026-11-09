/**
 * Search Console CSV 解析与效果分析（纯函数，便于单测）。
 * 口径：CTR 与平均排名都用「百分比 / 位次」原值； striking distance = 平均排名 5–20
 * （再往前一步就能进首页的词，优先做内容补强）。
 */

export type GscRow = {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type GscAnalysis = {
  totalClicks: number;
  totalImpressions: number;
  avgCtr: number;
  avgPosition: number;
  strikingDistance: GscRow[];
  topQueries: GscRow[];
  topPages: GscRow[];
};

const HEADERS: Record<keyof GscRow | 'date', string[]> = {
  query: [
    'query',
    'queries',
    'top queries',
    'search query',
    '查询',
    '搜索查询',
    '关键字',
    '关键词',
  ],
  page: ['page', 'pages', 'top pages', 'url', '页面', '网页', '网址'],
  clicks: ['clicks', '点击次数', '点击量', '点击'],
  impressions: ['impressions', '曝光次数', '展示次数', '曝光量', '曝光'],
  ctr: ['ctr', '点击率'],
  position: [
    'position',
    'avg position',
    'average position',
    '平均排名',
    '排名',
    '位置',
  ],
  date: ['date', '日期', 'day'],
};

/** 逐字符 CSV 解析：支持双引号包裹、引号内逗号与换行、"" 转义、BOM、CRLF。 */
export function parseCsv(raw: string): string[][] {
  const source = String(raw || '').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows.map((cells) => cells.map((cell) => cell.trim()));
}

const numeric = (value: string): number => {
  const clean = String(value || '').replace(/[%,\s]/g, '');
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * GSC 导出解析：表头别名识别（中英文），缺列按 0 处理。
 * 无法识别任何指标列时返回空数组，由调用方给出明确报错，不猜测列序。
 */
export function parseGscCsv(raw: string): {
  rows: GscRow[];
  dateRange: string;
} {
  const table = parseCsv(raw);
  if (table.length < 2) return { rows: [], dateRange: '' };
  const header = table[0].map((cell) =>
    cell.toLowerCase().replace(/^"|"$/g, ''),
  );
  const columnOf = (key: keyof GscRow | 'date') =>
    header.findIndex((cell) => HEADERS[key].includes(cell));
  const columns = {
    query: columnOf('query'),
    page: columnOf('page'),
    clicks: columnOf('clicks'),
    impressions: columnOf('impressions'),
    ctr: columnOf('ctr'),
    position: columnOf('position'),
    date: columnOf('date'),
  };
  if (columns.clicks < 0 && columns.impressions < 0 && columns.position < 0)
    return { rows: [], dateRange: '' };
  const cell = (row: string[], index: number) =>
    index >= 0 ? row[index] || '' : '';
  const rows: GscRow[] = [];
  const dates: string[] = [];
  for (const line of table.slice(1)) {
    const query = cell(line, columns.query);
    const page = cell(line, columns.page);
    if (!query && !page) continue;
    const impressions = Math.round(numeric(cell(line, columns.impressions)));
    const clicks = Math.round(numeric(cell(line, columns.clicks)));
    const ctrRaw = cell(line, columns.ctr);
    const ctr = ctrRaw
      ? numeric(ctrRaw)
      : impressions
        ? Math.round((clicks / impressions) * 10000) / 100
        : 0;
    rows.push({
      query: query.slice(0, 500),
      page: page.slice(0, 500),
      clicks,
      impressions,
      ctr,
      position: Math.round(numeric(cell(line, columns.position)) * 100) / 100,
    });
    const date = cell(line, columns.date);
    if (date) dates.push(date);
    if (rows.length >= 5000) break;
  }
  dates.sort();
  const dateRange = dates.length
    ? `${dates[0]} ~ ${dates[dates.length - 1]}`.slice(0, 60)
    : '';
  return { rows, dateRange };
}

const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** 按 query 或 page 聚合：点击/曝光求和，排名与 CTR 按曝光加权。 */
export function aggregateBy(rows: GscRow[], key: 'query' | 'page'): GscRow[] {
  type Bucket = GscRow & { weight: number };
  const buckets = new Map<string, Bucket>();
  for (const row of rows) {
    const name = row[key];
    if (!name) continue;
    const bucket: Bucket = buckets.get(name) || {
      query: '',
      page: '',
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: 0,
      weight: 0,
    };
    bucket[key] = name;
    bucket.clicks += row.clicks;
    bucket.impressions += row.impressions;
    const weight = row.impressions || 1;
    bucket.position += row.position * weight;
    bucket.weight += weight;
    buckets.set(name, bucket);
  }
  return [...buckets.values()]
    .map((bucket) => ({
      query: bucket.query,
      page: bucket.page,
      clicks: bucket.clicks,
      impressions: bucket.impressions,
      ctr: bucket.impressions
        ? round((bucket.clicks / bucket.impressions) * 100)
        : 0,
      position: bucket.weight ? round(bucket.position / bucket.weight) : 0,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}

export function analyzeGsc(rows: GscRow[]): GscAnalysis {
  const totalClicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const totalImpressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const weight = rows.reduce((sum, row) => sum + (row.impressions || 1), 0);
  const avgPosition = weight
    ? round(
        rows.reduce(
          (sum, row) => sum + row.position * (row.impressions || 1),
          0,
        ) / weight,
      )
    : 0;
  return {
    totalClicks,
    totalImpressions,
    avgCtr: totalImpressions
      ? round((totalClicks / totalImpressions) * 100)
      : 0,
    avgPosition,
    strikingDistance: rows
      .filter(
        (row) => row.position >= 5 && row.position <= 20 && row.impressions > 0,
      )
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 50),
    topQueries: aggregateBy(rows, 'query').slice(0, 20),
    topPages: aggregateBy(rows, 'page').slice(0, 20),
  };
}
