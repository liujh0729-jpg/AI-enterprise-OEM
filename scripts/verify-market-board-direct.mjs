/**
 * 「平台直连看板」实测（财税 TAX / 供销 SUPPLY / 出海 OVERSEAS 的「需求信息」与「服务发布」）。
 *
 * 这几块按 2026-09-26 用户口径实现：**只调用 AIworkin 接口，本系统不审核发布内容的资质、
 * 也不落一行数据**；本系统只审「能不能成为服务商」。本套件因此验三件事：
 *   1) 门控在平台调用**之前**生效（板块 / 主体 / 身份 / 备案，逐条断言唯一期望值）；
 *   2) 门控放行后才走到报文构造与平台调用（报文校验错误来自本系统，平台的拒绝以平台原话回传），
 *      失败不在本地留下任何行；
 *   3) 读回＝平台真数据：列表按本板块二级类目收窄、省市筛选与平台口径一致、
 *      改 / 删 / 看消息都命中平台的属主侧。
 *
 * 出海只开了「需求信息」栏目（服务发布界面未开），因此它的服务发布只验门控与本地拒收；
 * 出海挂在平台专属一级类目「跨境出海服务公司」下，与财税/供销各自成板、互不串门。
 *
 * 两种实例都跑，靠 `/health/version` 的 `aiworkin_enabled` 自动选分支：
 *   node scripts/regression-instance.mjs -- node scripts/verify-market-board-direct.mjs
 *       # 通道关闭：门控 + 「不可用而不是回退演示数据」（规则 73）
 *   node scripts/regression-instance.mjs --live-platform -- node scripts/verify-market-board-direct.mjs
 *       # 通道打开：全量，含正式平台真读真写
 *
 * 通道打开时会在正式平台**真建 3 条 DRAFT 挂单**（不进公开匹配）用于读回对账，
 * 结束（含异常）一律软删并把该账号在平台的挂单数还原到基线；本地表不落任何行。
 */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { scriptJwtSecret } from "./jwt-secret.mjs";
import { assertChannelOff, assertChannelOn } from "./regression-guard.mjs";
import { createPrisma, seedUsers, tokenSigner, httpJson } from "./harness.mjs";

const require = createRequire(new URL("../backend/package.json", import.meta.url));
const jwt = require("jsonwebtoken");
const catalog = require("../backend/dist/aiworkin/category-catalog.js");

const BASE = process.env.BASE_URL || "http://127.0.0.1:1693";
const PLATFORM = (
  process.env.AIWORKIN_BASE_URL || "https://api.aiworkin.com"
).replace(/\/$/, "");
const ISSUER = process.env.JWT_ISSUER || "aipdd-java-core";
/** 正式平台上真实存在的账号（本地种子账号一律 u-*，平台侧不存在，读属主数据会 5xx）。 */
const PLATFORM_USER_ID =
  process.env.PLATFORM_USER_ID || "00000000-0000-0000-0000-000000000001";

const users = seedUsers();
const sign = tokenSigner(users);
const platformToken = jwt.sign(
  { userId: PLATFORM_USER_ID, username: "admin", role: "super", type: "access" },
  scriptJwtSecret(),
  { algorithm: "HS256", issuer: ISSUER, expiresIn: "30m" },
);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAX = catalog.moduleCategory("TAX");
const SUPPLY = catalog.moduleCategory("SUPPLY");
const OVERSEAS = catalog.moduleCategory("OVERSEAS");
const LEAF_IDS = new Set([
  ...TAX.children.map((item) => item.id),
  ...SUPPLY.children.map((item) => item.id),
  ...OVERSEAS.children.map((item) => item.id),
]);
/** 出海需求用首个细项（无平台资质要求；「报关」细项在平台侧要 CUSTOMS_DECLARATION_REGISTRATION）。 */
const OVERSEAS_LEAF = OVERSEAS.children[0];
const stamp = Date.now();

let passed = 0;
const failures = [];
const log = (name, ok, extra = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (ok) passed += 1;
  else failures.push(`${name}${extra ? ` — ${extra}` : ""}`);
};
/** 错误响应只接受「期望的 code + 期望的原话」，不接受「大概是个错误」。 */
const assertError = (res, name, code, message) =>
  log(
    name,
    res.data?.code === code && res.data?.message === message,
    `期望 ${code}「${message}」，实得 ${res.data?.code}「${res.data?.message}」（HTTP ${res.status}）`,
  );
const assertOk = (res, name, extra) =>
  log(name, res.data?.code === 0, extra ?? `${res.data?.code}｜${res.data?.message}`);
/**
 * 上游故障的统一口径（F3 之后）：message 一律规范成「AIworkin 能力暂不可用」，
 * 原始状态码与上游原话收在 `data` 里——`data` 有内容即证明这次请求真到了平台
 * （本地「通道未启用」分支不带 data，两者可区分）。上游具体状态码是它自己的抖动
 * （实测同一账号给过 503「服务器内部错误」和 525「AIworkin 返回 HTTP 525」），
 * 所以这里只钉住「5xx」这个本系统的映射前提，不去钉上游每次给哪个号。
 */
const assertUpstreamFailure = (res, name) =>
  log(
    name,
    res.data?.code === 24001 &&
      res.data?.message === "AIworkin 能力暂不可用" &&
      Number(res.data?.data?.upstreamStatus) >= 500 &&
      typeof res.data?.data?.upstreamMessage === "string",
    `${res.data?.code}｜${res.data?.message}｜${JSON.stringify(res.data?.data)}（HTTP ${res.status}）`,
  );

const api = (method, path, bearer, body) =>
  httpJson({ url: `${BASE}${path}`, method, body, bearer });
const remote = (method, path, bearer, body) =>
  httpJson({
    url: `${PLATFORM}${path}`,
    method,
    body,
    bearer,
    // 平台写操作强制要幂等号（缺了 400「该操作需要有效的 Idempotency-Key」），取值是
    // `[A-Za-z0-9_-]{16,100}`——带 `/` 的自定义串会被拒，UUID 是合法形态之一
    ...(method === "POST" ? { headers: { "Idempotency-Key": randomUUID() } } : {}),
  });
const rowsOf = (res) => (Array.isArray(res.data?.data) ? res.data.data : []);
/** 中文省市走查询串要编码，脚本里两处筛选用同一个助手，别手工拼。 */
const regionQuery = (province, city) =>
  `?province=${encodeURIComponent(province)}${city ? `&city=${encodeURIComponent(city)}` : ""}`;

const prisma = createPrisma();
/** 平台直连唯一可能被写到的本地服务台账：必须一行都不进。 */
const localServiceRows = () => prisma.providerServiceListing.count();
/**
 * 平台属主侧挂单数。上游偶发 5xx（实测 503/525）时会重试；**仍读不到就抛错**，
 * 不许把「读取失败」静默折成 -1 再去参与基线比较——那会把平台抖动显示成
 * 「基线 -1 → 8」这种看不懂的失败（实测踩到过）。
 */
const ownedTotal = async (direction) => {
  let last = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await remote(
      "GET",
      `/market/listings/mine?direction=${direction}&page=1&pageSize=1`,
      platformToken,
    );
    const total = res.data?.data?.total;
    if (res.status === 200 && res.data?.code === 0 && typeof total === "number") {
      return total;
    }
    last = `HTTP ${res.status}｜${JSON.stringify(res.data)?.slice(0, 140)}`;
  }
  throw new Error(`平台属主侧挂单数读取失败（${direction}）：${last}`);
};

const DEMAND_BODY = {
  title: `直连实测·财税需求（可删）${stamp}`,
  description: "验证需求报文转发；本系统不落库。",
  sub_category_id: TAX.children[0].id,
  region_mode: "REGION",
  province: "浙江省",
  city: "杭州市",
  budget: "1 万以内",
  publish_action: "DRAFT",
};
const SERVICE_BODY = {
  title: `直连实测·供销服务（可删）${stamp}`,
  description: "验证服务报文转发；本系统不落库。",
  sub_category_id: SUPPLY.children[0].id,
  money_mode: "NEGOTIABLE",
  price_description: "面议",
  service_area_mode: "REGION",
  province: "浙江省",
  city: "杭州市",
  publish_action: "DRAFT",
};

/** 平台侧真挂单（DRAFT，不进公开匹配），只用于读回对账，收尾必删。 */
async function seedOnPlatform(label, body) {
  const res = await remote("POST", "/market/listings", platformToken, {
    publishAction: "DRAFT",
    ...body,
  });
  const id = res.data?.data?.listing?.id;
  log(
    `${label}：平台侧建单成功（DRAFT）`,
    res.data?.code === 0 && UUID_PATTERN.test(String(id || "")),
    `HTTP ${res.status}｜${res.data?.message}｜${id || "无单号"}`,
  );
  return id;
}

async function main() {
  const version = await api("GET", "/health/version");
  const channelOn = version.data?.data?.aiworkin_enabled === true;
  console.log(
    `本系统：${BASE}\n实例通道：${channelOn ? `打开 → ${PLATFORM}` : "关闭（本地口径）"}\n` +
      `财税 mirror：${TAX.parentKey}（${TAX.parentName}，${TAX.children.length} 个二级类目）\n` +
      `供销 mirror：${SUPPLY.parentKey}（${SUPPLY.parentName}，${SUPPLY.children.length} 个二级类目）\n` +
      `出海 mirror：${OVERSEAS.parentKey}（${OVERSEAS.parentName}，${OVERSEAS.children.length} 个二级类目）\n`,
  );
  if (channelOn) await assertChannelOn(BASE);
  else await assertChannelOff(BASE);

  // —— 1. 板块门控：平台直连只放行财税、供销与出海，其余板块仍是本地台账 ——
  assertError(
    await api("GET", "/enterprise/market/LEGAL/demands", sign("demo_enterprise")),
    "非直连板块被拒（法律）",
    400,
    "板块不合法：LEGAL（平台直连只开放 TAX / SUPPLY / OVERSEAS）",
  );
  assertError(
    await api("GET", "/enterprise/market/SMART/services", sign("demo_provider")),
    "非直连板块被拒（IT服务）",
    400,
    "板块不合法：SMART（平台直连只开放 TAX / SUPPLY / OVERSEAS）",
  );
  // 板块进白名单的同时，本地台账路由必须同步拒收：否则「服务发布」会同时存在两条写路径，
  // 本地那条写进去的行任何看板都读不到（出海的发布界面未开，这条只有接口层能验）。
  assertError(
    await api("POST", "/enterprise/services", sign("demo_all"), {
      domain: "OVERSEAS",
    }),
    "出海进白名单后本地服务台账拒收（不双开一条发布路径）",
    400,
    "跨境出海的服务发布走平台直连接口，本系统不写本地台账",
  );
  // 看板读接口要打到平台真数据，必须用「账号在平台存在」的 token：平台的属主接口只认 UUID，
  // 本地演示账号的 u-* 编号在平台查不到（平台自己回 5xx），所以直连模式下取数一律用平台账号 token。
  const readToken = channelOn ? platformToken : sign("demo_enterprise");
  const lowercase = await api(
    "GET",
    "/enterprise/market/tax/demands",
    readToken,
  );
  if (channelOn) {
    assertOk(
      lowercase,
      "板块键大小写不敏感（tax 与小写同样放行，往下读到平台数据）",
    );
  } else {
    assertError(
      lowercase,
      "板块键大小写不敏感（tax 与小写同样放行，往下走到通道判定）",
      24001,
      "AIworkin 能力暂不可用",
    );
  }

  // —— 2. 主体门控：个人用户不开放财税，个体工商户照常 ——
  assertError(
    await api("GET", "/enterprise/market/TAX/demands", sign("demo_personal")),
    "个人用户读财税需求看板被拒",
    20002,
    "财税服务不面向个人用户开放：请以「企业」或「个体工商户」主体办理",
  );
  assertError(
    await api(
      "POST",
      "/enterprise/market/TAX/demands",
      sign("demo_personal"),
      DEMAND_BODY,
    ),
    "个人用户提交财税需求被拒（同一判据）",
    20002,
    "财税服务不面向个人用户开放：请以「企业」或「个体工商户」主体办理",
  );
  // 出海与财税同为「个人用户不开放」的板块（`@SubjectService('跨境出海')` 同一口径）
  assertError(
    await api(
      "GET",
      "/enterprise/market/OVERSEAS/demands",
      sign("demo_personal"),
    ),
    "个人用户读出海需求看板被拒（与财税同一主体门控）",
    20002,
    "跨境出海不面向个人用户开放：请以「企业」或「个体工商户」主体办理",
  );
  // 供销不受「个人用户不开放财税」那条主体门控：同一个账号在供销这边不会拿到 20002，
  // 而是继续往下走——通道关闭拿「能力暂不可用」，通道打开则由平台自己回话（u-* 在平台不存在）。
  const personalSupply = await api(
    "GET",
    "/enterprise/market/SUPPLY/demands",
    sign("demo_personal"),
  );
  log(
    `供销不受财税主体门控（个人用户往下走到${channelOn ? "平台" : "通道判定"}，不是 20002）`,
    personalSupply.data?.code === 24001,
    `${personalSupply.data?.code}｜${personalSupply.data?.message}（HTTP ${personalSupply.status}）`,
  );

  // —— 3. 通道关闭：明确不可用，且不回退本地演示数据（规则 73） ——
  // —— 3. 五张看板取数：通道打开读到平台真数据，通道关闭明确不可用（规则 73） ——
  for (const [path, label] of [
    ["TAX/demands", "财税需求看板"],
    ["TAX/services", "财税服务看板"],
    ["SUPPLY/demands", "供销需求看板"],
    ["SUPPLY/services", "供销服务看板"],
    ["OVERSEAS/demands", "出海需求看板"],
  ]) {
    const res = await api("GET", `/enterprise/market/${path}`, readToken);
    if (channelOn) {
      assertOk(res, `${label}：通道打开→读平台真数据`);
    } else {
      assertError(res, `${label}：通道关闭→明确不可用`, 24001, "AIworkin 能力暂不可用");
      log(
        `${label}：通道关闭→不给出演示数据`,
        res.data?.data == null,
        JSON.stringify(res.data?.data),
      );
    }
  }

  if (!channelOn) {
    // 写入路径同样不许回退：通道关闭时「保存草稿/发布」只能报不可用，本地一张表都不落（规则 73 + 零落库）
    const beforeWrite = await localServiceRows();
    assertError(
      await api(
        "POST",
        "/enterprise/market/TAX/demands",
        sign("demo_enterprise"),
        DEMAND_BODY,
      ),
      "财税需求提交：通道关闭→明确不可用",
      24001,
      "AIworkin 能力暂不可用",
    );
    assertError(
      await api(
        "POST",
        "/enterprise/market/SUPPLY/services",
        sign("demo_supply"),
        SERVICE_BODY,
      ),
      "供销服务发布：通道关闭→明确不可用",
      24001,
      "AIworkin 能力暂不可用",
    );
    assertError(
      await api(
        "POST",
        "/enterprise/market/OVERSEAS/demands",
        sign("demo_enterprise"),
        { ...DEMAND_BODY, sub_category_id: OVERSEAS_LEAF.id },
      ),
      "出海需求提交：通道关闭→明确不可用",
      24001,
      "AIworkin 能力暂不可用",
    );
    const afterWrite = await localServiceRows();
    log(
      "通道关闭的写在本地零留痕（没有本地需求表，服务台账行数也不变）",
      afterWrite === beforeWrite,
      `${beforeWrite} → ${afterWrite}`,
    );
    console.log(
      "\n通道关闭，以下「服务发布门控 / 属主校验 / 平台真数据」需要平台直连实例：\n" +
        "  node scripts/regression-instance.mjs --live-platform -- node scripts/verify-market-board-direct.mjs",
    );
    return finish();
  }

  // —— 4. 通道与平台指向 ——
  const status = (await api("GET", "/enterprise/aiworkin/status", platformToken))
    .data;
  log(
    "通道确实指向正式平台",
    status?.data?.enabled === true && status?.data?.baseUrl === PLATFORM,
    JSON.stringify(status?.data),
  );
  const mirrorCheck = (
    await remote("GET", "/market/categories", platformToken)
  ).data?.data;
  for (const module of [TAX, SUPPLY, OVERSEAS]) {
    const parent = (mirrorCheck || []).find((item) => item.key === module.parentKey);
    const missing = module.children.filter(
      (leaf) => !(parent?.children || []).some((item) => item.id === leaf.id),
    );
    log(
      `正式平台存在「${module.parentName}」的本系统镜像二级类目`,
      parent?.id === module.parentId && missing.length === 0,
      missing.length ? `缺 ${missing.map((x) => x.key).join(",")}` : parent?.id,
    );
  }

  // —— 5. 服务发布门控：服务商身份 + 该类目备案通过（不复制平台的资质审核） ——
  assertError(
    await api(
      "POST",
      "/enterprise/market/TAX/services",
      sign("demo_enterprise"),
      SERVICE_BODY,
    ),
    "用户身份发布财税服务被拒（身份门控）",
    20002,
    "企业财税服务的「服务发布」只对服务商身份开放：请先在右上角切换到「服务商」身份",
  );
  assertError(
    await api(
      "POST",
      "/enterprise/market/TAX/services",
      sign("demo_supply"),
      SERVICE_BODY,
    ),
    "供销服务商发布财税服务被拒（备案门控）",
    403,
    "未通过企业财税服务备案审核，无法在该板块发布服务",
  );
  assertError(
    await api(
      "POST",
      "/enterprise/market/TAX/services",
      sign("demo_logistics"),
      SERVICE_BODY,
    ),
    "物流服务商发布财税服务被拒（备案门控）",
    403,
    "未通过企业财税服务备案审核，无法在该板块发布服务",
  );
  assertError(
    await api("POST", "/enterprise/market/SUPPLY/services", sign("demo_provider"), SERVICE_BODY),
    "财税服务商发布供销服务被拒（备案门控）",
    403,
    "未通过供销服务备案审核，无法在该板块发布服务",
  );
  // 出海：身份门控 + 备案门控（文案取整块业务名「跨境出海服务」，不是细项名「出口退税」）
  assertError(
    await api(
      "POST",
      "/enterprise/market/OVERSEAS/services",
      sign("demo_enterprise"),
      SERVICE_BODY,
    ),
    "用户身份发布出海服务被拒（身份门控）",
    20002,
    "跨境出海服务的「服务发布」只对服务商身份开放：请先在右上角切换到「服务商」身份",
  );
  assertError(
    await api(
      "POST",
      "/enterprise/market/OVERSEAS/services",
      sign("demo_supply"),
      SERVICE_BODY,
    ),
    "供销服务商发布出海服务被拒（备案门控）",
    403,
    "未通过跨境出海服务备案审核，无法在该板块发布服务",
  );
  assertError(
    await api(
      "POST",
      "/enterprise/market/OVERSEAS/services",
      sign("demo_provider"),
      { ...SERVICE_BODY, sub_category_id: OVERSEAS_LEAF.id, money_mode: "HOURLY" },
    ),
    "出海服务商过门控后进入报文构造（计价方式非法→报文校验，没碰平台）",
    400,
    "请选择计价方式（固定价格 / 起价 / 区间 / 面议）",
  );
  // 门控放行后才走到报文构造：报文校验错误＝「门控已过、且还没碰平台」的证据
  assertError(
    await api(
      "POST",
      "/enterprise/market/TAX/services",
      sign("demo_provider"),
      { ...SERVICE_BODY, money_mode: "HOURLY" },
    ),
    "财税服务商过门控后进入报文构造（计价方式非法→报文校验）",
    400,
    "请选择计价方式（固定价格 / 起价 / 区间 / 面议）",
  );
  assertError(
    await api(
      "POST",
      "/enterprise/market/TAX/services",
      sign("demo_provider"),
      {
        ...SERVICE_BODY,
        sub_category_id: TAX.children[0].id,
        service_area_mode: "RADIUS",
        longitude: 120.15,
        latitude: 30.27,
      },
    ),
    "直连看板与七板块共用同一套地域解析层（RADIUS 缺半径→报文校验，没碰平台）",
    400,
    "经纬度范围需要填写大于 0 的半径（公里）",
  );
  assertError(
    await api(
      "POST",
      "/enterprise/market/SUPPLY/services",
      sign("demo_supply"),
      { ...SERVICE_BODY, service_area_mode: "PROVINCE_CITY" },
    ),
    "供销服务商过门控后进入报文构造（地域方式非法→报文校验）",
    400,
    "地域范围只支持 NONE 不限制 / REGION 指定地区 / RADIUS 经纬度坐标",
  );
  assertError(
    await api(
      "POST",
      "/enterprise/market/SUPPLY/services",
      sign("demo_supply"),
      { ...SERVICE_BODY, sub_category_id: TAX.children[0].id },
    ),
    "二级类目不属于本板块时被拒（类目不串门）",
    400,
    `二级类目不属于「${SUPPLY.parentName}」，请重新选择`,
  );
  assertError(
    await api(
      "POST",
      "/enterprise/market/TAX/demands",
      platformToken,
      DEMAND_BODY,
    ),
    "平台账号在本系统无企业档案→需求提交被身份门控挡住（门控先于平台调用）",
    20002,
    "需要身份 ENTERPRISE_USER",
  );

  // —— 6. 本地账号：门控放行后确实调用平台，平台按其账号规则回话，本地零留痕 ——
  const localBefore = await localServiceRows();
  const demandAttempt = await api(
    "POST",
    "/enterprise/market/TAX/demands",
    sign("demo_enterprise"),
    DEMAND_BODY,
  );
  assertUpstreamFailure(
    demandAttempt,
    "本地演示账号（u-*）提交财税需求→平台真回话（账号在平台不存在，故障原话收在 data）",
  );
  const serviceAttempt = await api(
    "POST",
    "/enterprise/market/TAX/services",
    sign("demo_provider"),
    // 报文要过本系统的类目校验才走到平台：这里用财税板块自己的二级类目
    { ...SERVICE_BODY, sub_category_id: TAX.children[0].id },
  );
  assertUpstreamFailure(
    serviceAttempt,
    "本地演示账号（u-*）发布财税服务→同样真调用平台，不以本地台账兜底",
  );
  assertUpstreamFailure(
    await api("GET", "/enterprise/market/TAX/demands", sign("demo_enterprise")),
    "本地演示账号读看板也是平台口径（不切回演示数据）",
  );
  const localAfterAttempt = await localServiceRows();
  log(
    "失败的写在本地零留痕（provider_service_listing 行数不变）",
    localAfterAttempt === localBefore,
    `${localBefore} → ${localAfterAttempt}`,
  );

  // —— 7. 属主与单号格式：改 / 删 / 看消息都以平台属主为判据 ——
  assertError(
    await api(
      "GET",
      "/enterprise/market/TAX/demands/not-a-listing-id/messages",
      platformToken,
    ),
    "畸形挂单编号在本地挡住（不再把平台的 5xx 搬上界面）",
    400,
    "挂单编号格式不合法",
  );
  assertError(
    await api(
      "DELETE",
      `/enterprise/market/TAX/demands/${randomUUID()}`,
      platformToken,
    ),
    "不是自己发布的单→属主侧 404（改删前置）",
    404,
    "该挂单不存在，或不属于当前账号",
  );
  const noReply = await api(
    "POST",
    `/enterprise/market/TAX/demands/${randomUUID()}/messages`,
    platformToken,
    { content: "需求方在平台上发言" },
  );
  log(
    "需求方在平台上没有发言接口：看板不提供回复路由（功能缺口，见对接说明）",
    noReply.status === 404 &&
      noReply.data?.code === 404 &&
      String(noReply.data?.message).startsWith("Cannot POST"),
    `${noReply.data?.code}｜${noReply.data?.message}（HTTP ${noReply.status}）`,
  );

  // —— 8. 平台真数据：读回 / 筛选 / 改 / 删（正式平台，DRAFT，收尾必删） ——
  const baselineDemand = await ownedTotal("DEMAND");
  const baselineSupply = await ownedTotal("SUPPLY");
  const localBaseline = localBefore;
  let demandId = await seedOnPlatform("财税需求", {
    direction: "DEMAND",
    title: `直连实测·财税需求（可删）${stamp}`,
    description: "由 verify-market-board-direct.mjs 创建，验证平台直连看板的读回与筛选，用完即删。",
    subcategoryId: TAX.children[0].id,
    moneyMode: "NEGOTIABLE",
    currency: "AWCOIN",
    contactName: "实测联系人",
    contactPhone: "13800001111",
    a2aConfig: { geoMatchMode: "REGION", province: "浙江省", city: "杭州市" },
    attributes: { board: "TAX" },
  });
  const serviceId = await seedOnPlatform("供销服务", {
    direction: "SUPPLY",
    title: `直连实测·供销服务（可删）${stamp}`,
    description: "由 verify-market-board-direct.mjs 创建，验证服务发布看板的读回，用完即删。",
    subcategoryId: SUPPLY.children[0].id,
    moneyMode: "NEGOTIABLE",
    currency: "AWCOIN",
    priceDescription: "面议",
    contactName: "实测服务商",
    contactPhone: "13800002222",
    serviceArea: { mode: "REGION", province: "浙江省", city: "杭州市" },
    attributes: { board: "SUPPLY" },
  });
  const overseasDemandId = await seedOnPlatform("出海需求", {
    direction: "DEMAND",
    title: `直连实测·出海需求（可删）${stamp}`,
    description: "由 verify-market-board-direct.mjs 创建，验证出海板块的读回与板块隔离，用完即删。",
    subcategoryId: OVERSEAS_LEAF.id,
    moneyMode: "NEGOTIABLE",
    currency: "AWCOIN",
    contactName: "实测出海联系人",
    contactPhone: "13800003333",
    a2aConfig: { geoMatchMode: "REGION", province: "浙江省", city: "杭州市" },
    attributes: { board: "OVERSEAS" },
  });

  try {
    const taxDemands = rowsOf(
      await api("GET", "/enterprise/market/TAX/demands", platformToken),
    );
    const ownRow = taxDemands.find((item) => item.id === demandId);
    log(
      "财税看板列出刚挂到平台的需求（数据来自平台，本地没有这张表）",
      !!ownRow,
      `本板块 ${taxDemands.length} 行 / 该账号在平台共 ${baselineDemand + 2} 条需求（含出海那条）`,
    );
    log(
      "看板只收本板块二级类目（该账号其它类目的挂单不进这张表）",
      taxDemands.length === 1 &&
        taxDemands.every((item) =>
          TAX.children.some((leaf) => leaf.id === item.subCategoryId),
        ),
      JSON.stringify(taxDemands.map((item) => item.subCategoryId)),
    );
    if (ownRow) {
      log(
        "行上的中文类目取自本系统镜像（不是平台回传的 key）",
        ownRow.category1 === TAX.parentName &&
          ownRow.category2 === TAX.children[0].name,
        `${ownRow.category1}/${ownRow.category2}`,
      );
      log(
        "自有行 mine=true（改删与看消息只对自有行开放）",
        ownRow.mine === true,
        String(ownRow.mine),
      );
      log(
        "单号＝平台挂单 UUID（本系统不自造编号）",
        ownRow.listingId === demandId && UUID_PATTERN.test(ownRow.id),
        ownRow.id,
      );
      log(
        "属主详情补出明文联系方式（平台列表行是脱敏的）",
        ownRow.contactName === "实测联系人" &&
          ownRow.contactPhone === "13800001111",
        `${ownRow.contactName}/${ownRow.contactPhone}`,
      );
      log(
        "省市取自平台 a2aConfig（顶层 province/city 平台不承载）",
        ownRow.regionMode === "REGION" &&
          ownRow.province === "浙江省" &&
          ownRow.city === "杭州市",
        `${ownRow.regionMode} ${ownRow.province}${ownRow.city}`,
      );
      log(
        "状态直接取平台状态（本系统没有自己的状态机）",
        ownRow.status === "DRAFT",
        ownRow.status,
      );
      log(
        "「查看消息（n）」的 n 来自平台会话（本地不存消息）",
        Number(ownRow.conversationCount) === 0,
        String(ownRow.conversationCount),
      );
    }

    const matched = rowsOf(
      await api(
        "GET",
        `/enterprise/market/TAX/demands${regionQuery("浙江省", "杭州市")}`,
        platformToken,
      ),
    );
    const otherProvince = rowsOf(
      await api(
        "GET",
        `/enterprise/market/TAX/demands${regionQuery("广东省")}`,
        platformToken,
      ),
    );
    log("省市筛选命中本单", matched.some((item) => item.id === demandId), `${matched.length} 行`);
    log("换省即不命中（筛选真在过滤）", otherProvince.length === 0, `${otherProvince.length} 行`);

    const pool =
      (
        await remote(
          "GET",
          `/market/listings?direction=DEMAND&category=${TAX.parentKey}&page=1&pageSize=100`,
          platformToken,
        )
      ).data?.data?.list || [];
    log(
      "公开池对账：平台按一级类目给出的挂单都在看板里，且本次草稿没进公开池",
      pool.every((item) => taxDemands.some((row) => row.id === item.id)) &&
        !pool.some((item) => item.id === demandId),
      `平台公开池 ${pool.length} 行 / 看板 ${taxDemands.length} 行`,
    );

    const supplyServices = rowsOf(
      await api("GET", "/enterprise/market/SUPPLY/services", platformToken),
    );
    const ownService = supplyServices.find((item) => item.id === serviceId);
    log(
      "供销服务看板只列我已发布的服务（公开池不进这张表）",
      !!ownService && supplyServices.every((item) => item.mine === true),
      `${supplyServices.length} 行`,
    );
    log(
      "服务行的计价 / 报价 / 服务范围按平台报文还原",
      ownService?.moneyMode === "NEGOTIABLE" &&
        ownService?.priceDescription === "面议" &&
        ownService?.serviceAreaMode === "REGION",
      JSON.stringify({
        moneyMode: ownService?.moneyMode,
        priceDescription: ownService?.priceDescription,
        serviceAreaMode: ownService?.serviceAreaMode,
      }),
    );
    const supplyDemands = rowsOf(
      await api("GET", "/enterprise/market/SUPPLY/demands", platformToken),
    );
    log(
      "供销需求看板走平台（该账号在批发类目下没有需求→空表，不是报错也不是演示数据）",
      supplyDemands.length === 0,
      `${supplyDemands.length} 行`,
    );
    const overseasDemands = rowsOf(
      await api("GET", "/enterprise/market/OVERSEAS/demands", platformToken),
    );
    const ownOverseas = overseasDemands.find((item) => item.id === overseasDemandId);
    log(
      "出海看板只收本板块一级类目下的需求（财税/供销那两单都不进来）",
      overseasDemands.length === 1 && !!ownOverseas,
      `${overseasDemands.length} 行 / 该账号在平台共 ${baselineDemand + 2} 条需求`,
    );
    if (ownOverseas) {
      log(
        "出海行的一级类目取「跨境出海服务公司」镜像（平台专属一级类目，与其它板块不同枝）",
        ownOverseas.category1 === OVERSEAS.parentName &&
          ownOverseas.category2 === OVERSEAS_LEAF.name,
        `${ownOverseas.category1}/${ownOverseas.category2}`,
      );
      log(
        "出海行自有 mine=true、单号＝平台 UUID、状态取平台 DRAFT",
        ownOverseas.mine === true &&
          ownOverseas.listingId === overseasDemandId &&
          UUID_PATTERN.test(ownOverseas.id) &&
          ownOverseas.status === "DRAFT",
        `${ownOverseas.mine}｜${ownOverseas.status}｜${ownOverseas.id}`,
      );
      log(
        "出海行的省、市取自平台 a2aConfig（顶层 province/city 平台不承载）",
        ownOverseas.regionMode === "REGION" &&
          ownOverseas.province === "浙江省" &&
          ownOverseas.city === "杭州市",
        `${ownOverseas.regionMode} ${ownOverseas.province}${ownOverseas.city}`,
      );
    }
    const allBoardRows = [
      ...taxDemands,
      ...supplyServices,
      ...supplyDemands,
      ...overseasDemands,
    ];
    log(
      "三个板块的类目互不串门（各板只收各自的二级类目）",
      allBoardRows.every((item) => LEAF_IDS.has(item.subCategoryId)) &&
        !taxDemands.some((item) => item.id === overseasDemandId) &&
        !overseasDemands.some((item) => item.id === demandId),
      JSON.stringify(allBoardRows.map((item) => item.subCategoryId)),
    );

    const messages = (
      await api(
        "GET",
        `/enterprise/market/TAX/demands/${demandId}/messages`,
        platformToken,
      )
    ).data;
    log(
      "查看消息＝读平台会话（属主侧，本系统不存消息）",
      messages?.code === 0 &&
        messages?.data?.listingId === demandId &&
        Array.isArray(messages?.data?.conversations),
      JSON.stringify(messages?.data ?? `${messages?.code}｜${messages?.message}`).slice(0, 160),
    );

    const patched = (
      await api(
        "PATCH",
        `/enterprise/market/TAX/demands/${demandId}`,
        platformToken,
        {
          ...DEMAND_BODY,
          title: `直连实测·财税需求已改（可删）${stamp}`,
          description: "验证 PATCH 是否真转发到平台。",
        },
      )
    ).data;
    const onPlatform =
      (await remote("GET", `/market/listings/mine/${demandId}`, platformToken))
        .data?.data || {};
    log(
      "修改转发到平台（以平台读回为准）",
      patched?.code === 0 &&
        onPlatform.title === `直连实测·财税需求已改（可删）${stamp}`,
      onPlatform.title,
    );
    log(
      "publishAction DRAFT→DRAFT（改单不会把草稿误发布到公开匹配）",
      onPlatform.status === "DRAFT",
      onPlatform.status,
    );

    const removed = (
      await api("DELETE", `/enterprise/market/TAX/demands/${demandId}`, platformToken)
    ).data;
    const afterDelete = await remote(
      "GET",
      `/market/listings/mine/${demandId}`,
      platformToken,
    );
    log(
      "删除转发到平台（属主侧随即 404）",
      removed?.code === 0 &&
        removed?.data?.deleted === true &&
        afterDelete.status === 404,
      `${removed?.code}｜${removed?.data?.deleted}｜平台读回 HTTP ${afterDelete.status}`,
    );
    demandId = null;
  } finally {
    if (demandId) await remote("DELETE", `/market/listings/${demandId}`, platformToken);
    if (serviceId) await remote("DELETE", `/market/listings/${serviceId}`, platformToken);
    if (overseasDemandId)
      await remote("DELETE", `/market/listings/${overseasDemandId}`, platformToken);
  }

  const afterDemand = await ownedTotal("DEMAND");
  const afterSupply = await ownedTotal("SUPPLY");
  log(
    "平台侧挂单数回到基线（本次实测未在平台留数据）",
    afterDemand === baselineDemand && afterSupply === baselineSupply,
    `需求 ${baselineDemand}→${afterDemand}｜服务 ${baselineSupply}→${afterSupply}`,
  );
  const taxAfter = rowsOf(
    await api("GET", "/enterprise/market/TAX/demands", platformToken),
  );
  const overseasAfter = rowsOf(
    await api("GET", "/enterprise/market/OVERSEAS/demands", platformToken),
  );
  log(
    "看板随平台清空（本地没有任何残留行可清）",
    taxAfter.length === 0 && overseasAfter.length === 0,
    `财税 ${taxAfter.length} 行｜出海 ${overseasAfter.length} 行`,
  );
  const localAfter = await localServiceRows();
  log(
    "零落库实证：本地服务台账行数不变",
    localAfter === localBaseline,
    `${localBaseline} → ${localAfter}`,
  );

  return finish();
}

function finish() {
  console.log(`\n${passed} 项通过 / ${failures.length} 项失败`);
  for (const item of failures) console.log(`  · ${item}`);
  return failures.length;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exitCode = code ? 1 : 0;
  })
  .catch(async (error) => {
    console.error("验证中止：", error?.message || error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
