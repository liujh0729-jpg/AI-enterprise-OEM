// M3 冒烟用 mock 上游：记录并回显收到的 Authorization 头，用于验证「凭证解析器」
// 是否把用户绑定的 AIPDD Key 原文注入到 AIWORKIN_BASE_URL 指向的上游调用中。
import http from 'node:http';

const port = Number(process.env.MOCK_UPSTREAM_PORT || 1700);
const bearerOf = (req: http.IncomingMessage) =>
  String(req.headers.authorization || '');

const json = (
  res: http.ServerResponse,
  code: number,
  data: unknown,
) => {
  const body = JSON.stringify({ code: 0, message: 'ok', data });
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body);
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  const auth = bearerOf(req);
  console.log(`[mock-upstream] ${req.method} ${url.pathname} auth=${auth}`);

  // GET /market/listings/mine → 我的挂单分页（回显 auth 到第一条目）
  if (req.method === 'GET' && url.pathname === '/market/listings/mine') {
    return json(res, 200, {
      list: [{ id: 'mock-mine-1', title: `auth:${auth}` }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  }
  // POST /market/listings → 发布需求，返回 listing.id 且把 auth 塞进 title 供断言
  if (req.method === 'POST' && url.pathname === '/market/listings') {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      return json(res, 200, {
        listing: { id: 'mock-publish-1', title: `auth:${auth}` },
        initialMatchRunId: null,
      });
    });
    return;
  }
  // 兜底：任何路径都回一个带 auth 的通用分页，避免 500
  return json(res, 200, {
    list: [],
    total: 0,
    page: 1,
    pageSize: 20,
    auth,
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-upstream] listening on http://127.0.0.1:${port}`);
});
