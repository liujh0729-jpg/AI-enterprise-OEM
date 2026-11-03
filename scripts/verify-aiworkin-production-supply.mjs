/**
 * 「服务发布」真实调用 **AIworkin 正式平台**（https://api.aiworkin.com）的端到端验证（2026-09-25 用户裁定目标环境＝正式平台）。
 *
 * 默认打 **1694** 临时实例（`node scripts/regression-instance.mjs --live-platform -- node scripts/verify-aiworkin-production-supply.mjs`），
 * 不打 1690，避免把日常回归也推到正式平台。BASE_URL / PLATFORM_URL / PLATFORM_USER_ID 均可覆盖。
 *
 * 断言全部给**唯一期望值**（见 [[feedback-test-honesty]]）：
 * - 发布必须 `SYNCED` 且拿到平台真实单号（UUID），不接受 SKIPPED / FAILED；
 * - 平台侧读回必须与本系统报文一致（标题、direction=SUPPLY、二级类目、服务范围），
 *   且省市只能出现在 `serviceArea` 里（平台契约**拒收**顶层 province/city）；
 * - 本地演示账号（`u-enterprise`，非 UUID）在正式平台上的结果如实断言为 `FAILED` + 本地台账兜底；
 * - 收尾：平台单软删为 `DELETED`、本地行删除，ASSET 列表回到基线家数。
 */
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scriptJwtSecret } from "./jwt-secret.mjs";
import { assertChannelOn } from "./regression-guard.mjs";

const require = createRequire(new URL("../backend/package.json", import.meta.url));
const jwt = require("jsonwebtoken");

const BASE = process.env.BASE_URL || "http://127.0.0.1:1694";
const PLATFORM = (process.env.PLATFORM_URL || "https://api.aiworkin.com").replace(/\/$/, "");
const SECRET = scriptJwtSecret();
const ISSUER = process.env.JWT_ISSUER || "aipdd-java-core";
// 通道隔离护栏：本套件真实调用 AIworkin 正式平台，必须打在通道打开的实例上
await assertChannelOn(BASE);

/** 正式平台上真实存在、且已具备发布 SUPPLY 资格（已核验企业档案）的账号。 */
const PLATFORM_USER_ID = process.env.PLATFORM_USER_ID || "00000000-0000-0000-0000-000000000001";
const PLATFORM_USERNAME = process.env.PLATFORM_USERNAME || "admin";
/** 资产交易·房产销售/租赁：本系统镜像的二级类目，平台侧无需资质即可发布。 */
const ASSET_SUBCATEGORY = process.env.ASSET_SUBCATEGORY_ID || "e22bc3d3-96a5-4a4a-20f5-4b8d2eb753f3";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let passed = 0;
let failed = 0;
const log = (name, ok, extra = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
  ok ? passed++ : failed++;
};
const assert = (cond, name, extra) => log(name, !!cond, extra || "");

function token(userId, username, role = "user") {
  return jwt.sign(
    { userId, username, role, type: "access" },
    SECRET,
    { algorithm: "HS256", issuer: ISSUER, expiresIn: "15m" },
  );
}
const platformToken = token(PLATFORM_USER_ID, PLATFORM_USERNAME, "super");
const demoToken = token("u-enterprise", "demo_enterprise", "user");

async function call(url, method, body, bearer) {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 保留原文给断言用 */
  }
  return { status: res.status, json, text };
}
const api = (method, path, body, bearer) => call(BASE + path, method, body, bearer);
const remote = (method, path, body, bearer) => call(PLATFORM + path, method, body, bearer);

const draftBody = (title) => ({
  domain: "ASSET",
  sub_category_id: ASSET_SUBCATEGORY,
  title,
  description: `本条由 verify-aiworkin-production-supply.mjs 于 ${new Date().toISOString()} 创建，用于验证「服务发布」真实写入 AIworkin 正式平台，验证后立即删除。`,
  tags: "验证, 正式平台, 房产",
  money_mode: "NEGOTIABLE",
  service_area_mode: "NATIONWIDE",
  price_description: "按标的计费，面议",
  response_time: "1 个工作日",
  province: "浙江省",
  city: "杭州市",
  publish_action: "DRAFT",
});

async function assetRows(bearer) {
  const { json } = await api("GET", "/enterprise/services?domain=ASSET", undefined, bearer);
  return Array.isArray(json?.data) ? json.data : [];
}

/**
 * 平台属主侧服务清单（条数 + 单号）。上游偶发 5xx 时会重试；**仍读不到就抛错**，
 * 不许把「读取失败」静默折成 -1 再去和收尾读数比——那会把平台抖动显示成
 * 「-1 → 8」这种看不懂的失败（同类坑在 verify-market-board-direct 踩到过）。
 */
async function ownedSupply() {
  let last = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await remote(
      "GET",
      "/market/listings/mine?direction=SUPPLY&page=1&pageSize=50",
      undefined,
      platformToken,
    );
    const total = res.json?.data?.total;
    if (res.status === 200 && res.json?.code === 0 && typeof total === "number") {
      return { total, ids: (res.json.data.list || []).map((item) => item.id) };
    }
    last = `HTTP ${res.status}｜${res.text?.slice(0, 140)}`;
  }
  throw new Error(`平台属主侧服务清单读取失败：${last}`);
}

async function main() {
  console.log(`本系统：${BASE}\n正式平台：${PLATFORM}\n平台账号：${PLATFORM_USER_ID}\n`);

  // 1) 通道确实指向正式平台
  const status = await api("GET", "/enterprise/aiworkin/status", undefined, platformToken);
  assert(status.json?.data?.enabled === true, "通道已启用（AIWORKIN_ENABLED=true）", JSON.stringify(status.json?.data));
  assert(status.json?.data?.baseUrl === PLATFORM, "通道指向正式平台", status.json?.data?.baseUrl);

  // 2) 平台侧类目仍然可用（镜像 ID 必须命中，否则发布必失败）
  const categories = await remote("GET", "/market/categories");
  const leaf = (categories.json?.data || [])
    .flatMap((one) => one.children || [])
    .find((one) => one.id === ASSET_SUBCATEGORY);
  assert(!!leaf && leaf.enabled === true, "正式平台存在本系统镜像的资产细项类目", leaf ? `${leaf.key}/${leaf.nameZh}` : "未命中");
  if (!leaf) throw new Error("镜像类目在正式平台不存在，停止写入");

  const baseline = await assetRows(platformToken);
  const platformBaseline = await ownedSupply();

  // 3) 发布＝真实写正式平台（DRAFT，不进公开匹配）
  const title = `正式平台联通验证·房产租售（可删）${Date.now()}`;
  const created = await api("POST", "/enterprise/services", draftBody(title), platformToken);
  const row = created.json?.data || {};
  assert(created.json?.code === 0, "本系统发布接口返回成功", created.text.slice(0, 200));
  assert(row.aiworkin_sync_status === "SYNCED", "留痕＝SYNCED（真实调用，不是 SKIPPED/FAILED）", `${row.aiworkin_sync_status}｜${row.tip || ""}`);
  assert(UUID_PATTERN.test(String(row.platform_listing_id || "")), "平台回写真实单号", row.platform_listing_id);
  assert(row.status === "DRAFT", "本系统状态＝草稿（未进平台公开匹配）", row.status);
  const listingId = row.platform_listing_id;

  // 4) 平台侧读回，报文与本系统一致
  const mine = await remote("GET", `/market/listings/mine/${listingId}`, undefined, platformToken);
  const onPlatform = mine.json?.data || {};
  assert(mine.json?.code === 0, "正式平台可读回该单", mine.text.slice(0, 200));
  assert(onPlatform.title === title, "平台标题与提交一致", onPlatform.title);
  assert(onPlatform.direction === "SUPPLY", "平台 direction=SUPPLY", onPlatform.direction);
  assert(onPlatform.subcategoryId === ASSET_SUBCATEGORY, "平台二级类目与提交一致", onPlatform.subcategoryId);
  assert(onPlatform.status === "DRAFT", "平台状态＝DRAFT", onPlatform.status);
  assert(onPlatform.serviceArea?.mode === "NATIONWIDE", "平台服务范围＝serviceArea.mode", JSON.stringify(onPlatform.serviceArea));
  assert(
    onPlatform.province === undefined || onPlatform.province === null,
    "平台顶层不承载省市（契约拒收顶层 province/city）",
    `顶层 province=${JSON.stringify(onPlatform.province)}`,
  );

  // 5) 本系统的平台读代理同样命中（「我的服务」链路）
  const proxied = await api("GET", `/enterprise/aiworkin/demands/${listingId}`, undefined, platformToken);
  assert(proxied.json?.data?.id === listingId, "本系统代理读回平台单", proxied.json?.data?.id || proxied.text.slice(0, 160));

  // 6) 本地演示账号（非 UUID userId）在正式平台上的真实结果
  const demoTitle = `本地演示账号联通探针（可删）${Date.now()}`;
  const demoCreate = await api("POST", "/enterprise/services", draftBody(demoTitle), demoToken);
  const demoRow = demoCreate.json?.data || {};
  assert(demoRow.aiworkin_sync_status === "FAILED", "非 UUID 账号→留痕 FAILED（如实记录平台拒绝）", `${demoRow.aiworkin_sync_status}｜${(demoRow.tip || "").slice(0, 160)}`);
  assert(!!demoRow.id, "FAILED 仍落本地台账（非严格模式兜底）", demoRow.service_no);
  const demoCleaned = await api("DELETE", `/enterprise/services/${demoRow.id}`, undefined, demoToken);
  assert(demoCleaned.json?.code === 0, "探针本地行已删除", demoCleaned.text.slice(0, 120));

  // 7) 自清：平台软删（对所有人不可见）+ 本地删除 + 列表回基线
  const remoteDelete = await remote("DELETE", `/market/listings/${listingId}`, undefined, platformToken);
  assert(remoteDelete.json?.code === 0, "正式平台删除接口返回成功", remoteDelete.text.slice(0, 160));
  const afterDelete = await remote("GET", `/market/listings/mine/${listingId}`, undefined, platformToken);
  assert(afterDelete.status === 404 && afterDelete.json?.code === 404, "平台单删除后属主侧 404（DELETED 不再可见）", `HTTP ${afterDelete.status}`);
  const publicAfterDelete = await remote("GET", `/market/listings/${listingId}`, undefined, platformToken);
  assert(publicAfterDelete.status === 404, "平台单删除后公开侧 404", `HTTP ${publicAfterDelete.status}`);
  const platformAfter = await ownedSupply();
  assert(
    platformAfter.total === platformBaseline.total &&
      !platformAfter.ids.some((id) => id === listingId),
    "正式平台该账号服务数回到基线（本次验证未留数据）",
    `${platformBaseline.total} → ${platformAfter.total}`,
  );
  const localDelete = await api("DELETE", `/enterprise/services/${row.id}`, undefined, platformToken);
  assert(localDelete.json?.code === 0, "本系统行已删除", localDelete.text.slice(0, 120));
  const after = await assetRows(platformToken);
  assert(after.length === baseline.length, "ASSET 服务列表回到基线", `${baseline.length} → ${after.length}`);

  console.log(`\n${passed} 项通过 / ${failed} 项失败`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error("验证中止：", error?.message || error);
  process.exitCode = 1;
});
