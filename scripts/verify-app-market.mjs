/**
 * 应用市场（外部公开应用目录的只读镜像）后端口径验证：
 * 列表分页 / 名称搜索 / 分类筛选 / 详情 / 评价 / 404 / 缓存命中 / 无写入口 /
 * 主页地址协议白名单 / MCP 域排除。
 *
 * 目标实例由 BASE_URL 指定（缺省＝隔离实例默认端口 1693，见 regression-instance.mjs）。
 * 本脚本只读：不写本站库、不写上游目录，也不依赖任何本地表。
 * 上游目录现网条目数会变，因此只断言「本页条数 ≤ pageSize」「详情与列表同源」等
 * 稳定口径；唯一期望值不放水。
 */
import { createSuite } from "./harness.mjs";

const suite = createSuite();
const { api, assert } = suite;
const USER = "demo_user";

const { mcpOperations } = await import("../packages/contracts/dist/mcp.js");

/** 未登录也要拦住：应用市场跟 `/enterprise/*` 一样走统一鉴权。 */
const anonymous = await api("GET", "/enterprise/apps");
assert(anonymous.status === 401, "未登录访问应用市场被拒（401）", `实际 ${anonymous.status}`);

const page1 = await api("GET", "/enterprise/apps?page=1&pageSize=12", null, USER);
const body1 = page1.data?.data;
assert(page1.status === 200 && page1.data?.code === 0, "列表接口返回成功", `HTTP ${page1.status} / code ${page1.data?.code}`);
assert(Number(body1?.page) === 1 && Number(body1?.pageSize) === 12, "列表回显页码与每页条数", `page=${body1?.page} pageSize=${body1?.pageSize}`);
assert(Array.isArray(body1?.list), "列表 list 是数组");
assert(Number(body1?.total) >= body1?.list?.length, "total 不小于本页条数", `total=${body1?.total} list=${body1?.list?.length}`);
assert(
  (body1?.list || []).every((item) => item.clientId && typeof item.name === "string" && Array.isArray(item.scopes)),
  "每个条目都有 clientId / name / scopes",
);
assert(
  (body1?.list || []).every((item) => !item.homepageUrl || /^https?:\/\//.test(item.homepageUrl)),
  "主页地址只允许 http(s)（协议白名单生效）",
);
// 打不开的应用（没有 http(s) 首页地址）不进列表：卡片点了也没地方去
assert(
  (body1?.list || []).every((item) => /^https?:\/\//.test(item.homepageUrl || "")),
  "列表只保留有 http(s) 首页地址的应用",
);
assert(Number(body1?.total) >= 1, "目录里至少有 1 款可打开的应用", `total=${body1?.total}`);
assert(
  (body1?.list || []).length === Math.min(12, Number(body1?.total)),
  "列表条数＝min(pageSize, total)（按过滤后集合分页）",
  `list=${body1?.list?.length} total=${body1?.total}`,
);

// 分页：按过滤后集合本地分页，换 pageSize 不改总数，首页仍是同一款
const firstId = body1.list?.[0]?.clientId;
const onePerPage = await api("GET", "/enterprise/apps?page=1&pageSize=1", null, USER);
assert(
  Number(onePerPage.data?.data?.total) === Number(body1?.total),
  "改 pageSize 不改变总数",
  `${onePerPage.data?.data?.total} vs ${body1?.total}`,
);
assert(
  onePerPage.data?.data?.list?.length === Math.min(1, Number(body1?.total)),
  "pageSize=1 时首页条数＝min(1, total)",
  `实际 ${onePerPage.data?.data?.list?.length}`,
);
assert(
  onePerPage.data?.data?.list?.[0]?.clientId === firstId,
  "pageSize=1 的首页就是列表第一款",
  `${onePerPage.data?.data?.list?.[0]?.clientId} vs ${firstId}`,
);

// 越界页：空列表但总数不变
const lastPage = await api("GET", "/enterprise/apps?page=9999&pageSize=12", null, USER);
assert(
  lastPage.status === 200 && lastPage.data?.data?.list?.length === 0,
  "超出末页返回空列表",
  `HTTP ${lastPage.status} / ${lastPage.data?.data?.list?.length}`,
);
assert(
  Number(lastPage.data?.data?.total) === Number(body1?.total),
  "越界页仍回报同一总数",
  `${lastPage.data?.data?.total} vs ${body1?.total}`,
);

// 名称搜索：用列表里第一款的名字搜，结果必须包含它
const firstName = body1.list?.[0]?.name;
if (firstName) {
  const searched = await api(
    "GET",
    `/enterprise/apps?q=${encodeURIComponent(firstName)}&page=1&pageSize=12`,
    null,
    USER,
  );
  assert(
    searched.data?.data?.list?.some((item) => item.clientId === firstId),
    "按名称搜索能找回该应用",
    `q=${firstName}`,
  );
}

// 分类筛选：不存在的分类必须回空（上游没有该分类）
const noCategory = await api(
  "GET",
  "/enterprise/apps?category=__no_such_category__&page=1&pageSize=12",
  null,
  USER,
);
assert(
  noCategory.status === 200 && noCategory.data?.data?.total === 0 && noCategory.data?.data?.list?.length === 0,
  "不存在的分类返回零条",
  `total=${noCategory.data?.data?.total}`,
);

// 详情：与列表同源；并发/连续两次取同一款，报文一致（缓存命中）
assert(Boolean(firstId), "第一款应用有 clientId，可继续验详情");
const detailA = await api("GET", `/enterprise/apps/${encodeURIComponent(firstId)}`, null, USER);
const detailB = await api("GET", `/enterprise/apps/${encodeURIComponent(firstId)}`, null, USER);
assert(detailA.status === 200 && detailA.data?.code === 0, "详情接口返回成功", `HTTP ${detailA.status}`);
assert(detailA.data?.data?.clientId === firstId, "详情 clientId 与列表一致");
assert(
  detailA.data?.data?.name === body1.list?.[0]?.name,
  "详情名称与列表一致",
  `${detailA.data?.data?.name} vs ${body1.list?.[0]?.name}`,
);
assert(
  JSON.stringify(detailA.data) === JSON.stringify(detailB.data),
  "连续两次详情报文一致（缓存命中）",
);
assert(
  detailA.data?.data?.publishedAt === null || typeof detailA.data?.data?.publishedAt === "string",
  "上架时间字段为 string 或 null",
);

// 评价：结构稳定（现网评价数为 0 也成立）
const reviews = await api(
  "GET",
  `/enterprise/apps/${encodeURIComponent(firstId)}/reviews?page=1&pageSize=10`,
  null,
  USER,
);
assert(reviews.status === 200 && reviews.data?.code === 0, "评价接口返回成功", `HTTP ${reviews.status}`);
assert(Array.isArray(reviews.data?.data?.list), "评价 list 是数组");
assert(
  typeof reviews.data?.data?.avgRating === "number" &&
    reviews.data.data.avgRating >= 0 &&
    reviews.data.data.avgRating <= 5,
  "平均分在 0–5 之间",
  `avgRating=${reviews.data?.data?.avgRating}`,
);
assert(typeof reviews.data?.data?.reviewCount === "number", "评价总数是数字");

// 404：上游明确说不存在 → 本站 404 + 中文文案（不是 503）
const missing = await api("GET", "/enterprise/apps/__not_exist__", null, USER);
assert(missing.status === 404 && missing.data?.code === 404, "不存在的应用回 404", `HTTP ${missing.status} / code ${missing.data?.code}`);
assert(missing.data?.message === "应用不存在", "404 文案为「应用不存在」", missing.data?.message);

// 只读：没有上架/编辑/评价等写入口
const writeAttempt = await api("POST", "/enterprise/apps", {}, USER);
assert(
  writeAttempt.status === 404,
  "应用市场不提供写入口（POST 未被注册）",
  `HTTP ${writeAttempt.status}`,
);

// MCP：应用市场域不进 list_operations
const ops = mcpOperations();
assert(
  ops.every((op) => !op.path.includes("/apps")),
  "应用市场三个端点不出现在 MCP 能力清单",
  ops.filter((op) => op.path.includes("/apps")).map((op) => op.operationId).join(","),
);

console.log(suite.summary());
if (suite.counts().failed) {
  for (const failure of suite.counts().failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}
