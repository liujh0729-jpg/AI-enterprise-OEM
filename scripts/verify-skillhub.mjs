/**
 * 技能中心（SkillHub）：接口层实测。
 *
 * 口径：
 * - 打临时实例（regression-instance.mjs --port=1695），不碰 1690 日常实例。
 * - 只读上游 api.skillhub.cn 的公开目录；安装会往本账号技能表写一行，收尾按 id 删掉。
 * - 下载走前端同款原始路由 `/api/backend/enterprise/skillhub/skills/{slug}/download`，
 *   断言返回的确是 zip（PK 头 + application/zip）。
 * - 首页推荐关键词固定 AIPDD（2026-11-01 拍板）。上游只认单数 `keyword`：写成 `keywords`
 *   会被忽略、把 21 万条全库当推荐结果返回，所以除了「有结果」还必须断言「关键词真过滤了」。
 *
 * 用法：
 *   node scripts/regression-instance.mjs --port=1695 -- node scripts/verify-skillhub.mjs
 */
import { createSuite } from "./harness.mjs";

const suite = createSuite({
  base: process.env.BASE_URL || "http://127.0.0.1:1695",
});
const { call, assert, token } = suite;

const ACCOUNT = "demo_agent";
const SKILLS = "/enterprise/content/agent/skills";
const LIST = "/enterprise/skillhub/skills";

const RECOMMEND_KEYWORD = "AIPDD";
const RECOMMEND_SIZE = 16;
/** 安装目标与「缺 SKILL.md」的对照包都取 AIPDD 推荐页里的已知包；上游换包时这两条会失败，提示重新核对。 */
const INSTALL_TARGET = "aipdd-find-skills";
const NO_SKILLMD_TARGET = "aipdd-cut-video";

console.log(`目标实例：${suite.base}`);
console.log(`测试主体：${ACCOUNT}`);

const createdIds = [];

async function rawDownload(slug) {
  const response = await fetch(
    `${suite.base}/api/backend/enterprise/skillhub/skills/${encodeURIComponent(slug)}/download`,
    { headers: { Authorization: `Bearer ${token(ACCOUNT)}` } },
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { response, bytes };
}

try {
  // 1. 首页推荐：AIPDD 关键词 16 条，且每条都是 AIPDD 的技能
  const recommended = await call(
    "GET",
    `${LIST}?keyword=${encodeURIComponent(RECOMMEND_KEYWORD)}&pageSize=${RECOMMEND_SIZE}&page=1`,
    ACCOUNT,
  );
  assert(recommended.code === 0, "推荐列表接口通", `code=${recommended.code}`);
  const recList = recommended.data?.list || [];
  assert(
    recList.length > 0 && recList.length <= RECOMMEND_SIZE,
    `推荐本页 ${RECOMMEND_SIZE} 条内`,
    `${recList.length} 条`,
  );
  const offTopic = recList.filter(
    (item) => !/aipdd/i.test(`${item.slug} ${item.name} ${item.namespaceHandle}`),
  );
  assert(
    offTopic.length === 0,
    "推荐全部命中 AIPDD（关键词未被忽略）",
    offTopic.map((item) => item.slug).join(","),
  );
  const recTotal = Number(recommended.data?.total);
  assert(recTotal > 0 && recTotal < 5000, "推荐命中总数在千级内", `total=${recTotal}`);
  const recItem = recList[0];
  assert(recItem?.slug && recItem?.name, "推荐项带 slug 与名称");
  assert(Boolean(recItem?.categoryLabel), "推荐项带中文分类");
  console.log(
    `推荐 ${recList.length} 条 / 命中 ${recTotal}；首条 ${recItem?.slug} / ${recItem?.name} / ${recItem?.categoryLabel}`,
  );

  // 2. 关键词确实生效：不存在的关键词必须 0 条（退回 `keywords` 这种被忽略的写法会返回全库）
  const junk = await call(
    "GET",
    `${LIST}?keyword=${encodeURIComponent("zzz-不存在的技能-qqqq")}&pageSize=16&page=1`,
    ACCOUNT,
  );
  assert(junk.code === 0, "无效关键词接口通", `code=${junk.code}`);
  assert(
    (junk.data?.list || []).length === 0 && Number(junk.data?.total) === 0,
    "无效关键词零结果（过滤真实生效）",
    `${junk.data?.list?.length} 条 / total ${junk.data?.total}`,
  );

  // 2b. 空关键词由服务端拒绝：直连上游会拿到整库（21 万条），前端也没有「浏览全部」入口
  const emptyKeyword = await call("GET", `${LIST}?keyword=&pageSize=16&page=1`, ACCOUNT);
  assert(
    emptyKeyword.code === 400 && emptyKeyword.status === 400,
    "空关键词由服务端拒绝（不退回首屏全库）",
    `${emptyKeyword.status}/${emptyKeyword.code}/${emptyKeyword.message}`,
  );
  const noKeyword = await call("GET", `${LIST}?pageSize=16&page=1`, ACCOUNT);
  assert(
    noKeyword.code === 400 && noKeyword.status === 400,
    "缺 keyword 参数同样拒绝",
    `${noKeyword.status}/${noKeyword.code}/${noKeyword.message}`,
  );

  // 3. 中文关键词搜索 + 翻页
  const keyword = encodeURIComponent("搜索");
  const searched = await call("GET", `${LIST}?keyword=${keyword}&pageSize=20&page=1`, ACCOUNT);
  assert(searched.code === 0, "中文关键词搜索接口通", `code=${searched.code}`);
  const searchList = searched.data?.list || [];
  const searchTotal = Number(searched.data?.total);
  assert(searchList.length > 0, "「搜索」有命中", `${searchList.length} 条`);
  assert(searchList.length <= 20, "搜索不超 pageSize", `${searchList.length} 条`);
  assert(searchTotal >= searchList.length, "搜索 total 不小于本页条数", `total=${searchTotal}`);
  console.log(`关键词搜索「搜索」${searchList.length} 条 / total ${searchTotal}`);
  if (searchTotal > searchList.length) {
    const page2 = await call("GET", `${LIST}?keyword=${keyword}&pageSize=20&page=2`, ACCOUNT);
    assert(page2.code === 0, "翻页接口通", `code=${page2.code}`);
    const page2List = page2.data?.list || [];
    assert(page2List.length > 0, "第二页拿到数据", `${page2List.length} 条`);
    assert(page2List[0]?.slug !== searchList[0]?.slug, "第二页与第一页不重复");
    console.log(`第二页 ${page2List.length} 条`);
  } else {
    console.log("total 未超过本页，跳过翻页");
  }

  // 4. 详情 + 下载 + 安装固定打 AIPDD 推荐页里的已知包
  assert(
    recList.some((item) => item.slug === INSTALL_TARGET),
    `推荐页含安装目标 ${INSTALL_TARGET}`,
  );
  assert(
    recList.some((item) => item.slug === NO_SKILLMD_TARGET),
    `推荐页含对照包 ${NO_SKILLMD_TARGET}`,
  );

  const detail = await call("GET", `${LIST}/${encodeURIComponent(INSTALL_TARGET)}`, ACCOUNT);
  assert(detail.code === 0, "详情接口通", `code=${detail.code}`);
  assert(detail.data?.slug === INSTALL_TARGET, "详情 slug 与请求一致");
  assert(Boolean(detail.data?.name), "详情带名称");
  assert(Array.isArray(detail.data?.versions), "详情带版本列表");
  console.log(
    `详情 ${detail.data?.name} ${detail.data?.version} 版本 ${(detail.data?.versions || []).length} 安全项 ${(detail.data?.security || []).length}`,
  );

  // 5. 下载：必须是 zip
  const { response, bytes } = await rawDownload(INSTALL_TARGET);
  assert(response.status === 200, "下载 HTTP 200", `${response.status}`);
  assert(
    String(response.headers.get("content-type") || "").includes("application/zip"),
    "下载 content-type 是 zip",
    `${response.headers.get("content-type")}`,
  );
  assert(bytes.length > 0, "下载内容非空", `${bytes.length} 字节`);
  assert(bytes[0] === 0x50 && bytes[1] === 0x4b, "下载内容带 PK 头");
  console.log(`下载 ${bytes.length} 字节，PK 头正常`);

  // 6. 下载并安装 → 进入本账号技能且启用
  const installed = await call(
    "POST",
    `/enterprise/skillhub/skills/${encodeURIComponent(INSTALL_TARGET)}/install`,
    ACCOUNT,
  );
  assert(installed.code === 0, "下载并安装成功", `${installed.code} ${installed.message || ""}`);
  assert(installed.data?.enabled === true, "安装响应带 enabled");
  const installedId = installed.data?.id;
  assert(installedId, "安装响应带技能 id");
  if (installedId) createdIds.push(installedId);
  console.log(
    `安装成功 id=${installedId} 名称=${installed.data?.name} 附件=${installed.data?.fileCount}`,
  );

  const mine = await call("GET", SKILLS, ACCOUNT);
  assert(mine.code === 0, "我的技能列表接口通", `code=${mine.code}`);
  const row = (mine.data || []).find((item) => item.id === installedId);
  assert(Boolean(row), "安装后的技能出现在「我的技能」");
  assert(row?.enabled === true, "「我的技能」里该技能启用中");
  console.log(`我的技能已包含 ${row?.name}（启用中）`);

  // 7. 上游包里缺根目录 SKILL.md 的：必须装失败并把原因给到界面，且不留下行
  const rejected = await call(
    "POST",
    `/enterprise/skillhub/skills/${encodeURIComponent(NO_SKILLMD_TARGET)}/install`,
    ACCOUNT,
  );
  if (rejected.data?.id) createdIds.push(rejected.data.id);
  assert(rejected.code !== 0, "缺 SKILL.md 的包安装被拒", `${rejected.code} ${rejected.status}`);
  assert(
    /SKILL\.md/.test(rejected.message || ""),
    "拒绝原因点名 SKILL.md",
    rejected.message,
  );
  const afterRejected = await call("GET", SKILLS, ACCOUNT);
  assert(
    (afterRejected.data || []).length === (mine.data || []).length,
    "安装失败不落库",
    `${(mine.data || []).length} → ${(afterRejected.data || []).length}`,
  );

  // 8. 清理
  const removed = await call("DELETE", `${SKILLS}/${installedId}`, ACCOUNT);
  assert(removed.code === 0, "清理本次安装的技能", `code=${removed.code}`);
  createdIds.length = 0;

  const after = await call("GET", SKILLS, ACCOUNT);
  assert(
    (after.data || []).every((item) => item.id !== installedId),
    "清理后我的技能不再含该条",
  );

  console.log("\n技能中心接口实测：全部通过");
} finally {
  for (const id of createdIds) {
    await call("DELETE", `${SKILLS}/${id}`, ACCOUNT).catch(() => undefined);
  }
}

const counts = suite.counts();
if (counts.failed) {
  console.error(
    `\n失败 ${counts.failed} 项：\n${counts.failures.map((f) => `- ${f}`).join("\n")}`,
  );
  process.exitCode = 1;
}
console.log(suite.summary());
