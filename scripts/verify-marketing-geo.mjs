// 营销五板块（服务商 / 达人建联 / GEO 分析 / GEO 独立站 / 需求信息）接口冒烟：
// 达人建联 AIworkin 代理层、GEO 分析模块、MARKETING 服务商类型与资源库。
// 目标实例由 BASE_URL 指定（缺省＝隔离实例默认端口 1693）。
import { assertChannelOff } from "./regression-guard.mjs";
import { createSuite } from "./harness.mjs";

const suite = createSuite();
const BASE = suite.base;
const { users, token, api, log, assert } = suite;
// 通道隔离护栏：本地回归不许打在会真写 AIworkin 正式平台的实例上
await assertChannelOff(BASE);

const ok = (payload) => payload?.data?.code === 0;

(async () => {
  console.log(`BASE=${BASE}\n`);

  console.log("1. 营销服务商（MARKETING 类目 + 服务商资源库）");
  const providers = await api(
    "GET",
    "/enterprise/contracts/providers?serviceType=MARKETING",
    null,
    "demo_enterprise",
  );
  assert(
    ok(providers) && Array.isArray(providers.data.data),
    "GET providers?serviceType=MARKETING",
    `count=${providers.data?.data?.length}`,
  );
  const logisticsProviders = await api(
    "GET",
    "/enterprise/contracts/providers?serviceType=LOGISTICS",
    null,
    "demo_enterprise",
  );
  assert(
    ok(logisticsProviders) && logisticsProviders.data.data.length > 0,
    "GET providers?serviceType=LOGISTICS",
    `count=${logisticsProviders.data?.data?.length}`,
  );
  const assetProviders = await api(
    "GET",
    "/enterprise/contracts/providers?serviceType=ASSET_TRADE",
    null,
    "demo_enterprise",
  );
  assert(
    ok(assetProviders) && Array.isArray(assetProviders.data.data),
    "GET providers?serviceType=ASSET_TRADE",
    `count=${assetProviders.data?.data?.length}`,
  );
  // 资产交易不走签约：后端应拒绝以 ASSET_TRADE 发起签约
  const assetContract = await api(
    "POST",
    "/enterprise/contracts",
    { provider_id: "u-demo-asset", service_type: "ASSET_TRADE" },
    "demo_enterprise",
  );
  assert(
    assetContract.data?.code !== 0,
    "POST contracts service_type=ASSET_TRADE 应被拒",
    assetContract.data?.message,
  );

  console.log("\n2. 达人建联（通道关闭时明确失败）");
  // 本套件强制关闭 AIworkin；接口必须报错，不能回退演示资源、字典或收藏。
  for (const path of [
    "/enterprise/connections/resources?category=marketing&page=1&pageSize=9",
    "/enterprise/connections/resources?category=community&categoryKey=travel",
    "/enterprise/connections/resources/locations",
    "/enterprise/connections/dictionaries/market_categories/items",
    "/enterprise/connections/favorites/marketing",
    "/enterprise/connections/resources/talent/unit-resource/contact",
  ]) {
    const response = await api("GET", path, null, "demo_enterprise");
    assert(
      response.status === 503 && response.data?.code === 24001 && response.data?.data == null,
      `通道关闭：GET ${path} 明确失败且不返回演示数据`,
      response.data?.message,
    );
  }
  const anon = await api("GET", "/enterprise/connections/resources");
  assert(anon.status === 401 || anon.data?.code === 401, "未登录访问被拒 401");

  console.log("\n3. GEO 分析（项目 → 问题库 → 批次 → 观测 → 报告 → 选题）");
  const meta = await api("GET", "/enterprise/geo/meta", null, "demo_enterprise");
  assert(
    ok(meta) && (meta.data.data.platforms || []).length === 12,
    "GET geo/meta 十二平台",
    (meta.data?.data?.platforms || []).join("/"),
  );
  // 可用口径：availablePlatforms ⊆ platforms，且＝本账号自己在「营销工具」配好 Key + 模型的平台（无 .env 回落、不共享他人）
  const metaRows = await api("GET", "/enterprise/geo/settings", null, "demo_enterprise");
  const expectedUsable = (metaRows.data?.data?.providers || [])
    .filter((row) => row.source === "db" && row.model)
    .map((row) => row.platform);
  assert(
    ok(meta) &&
      Array.isArray(meta.data.data.availablePlatforms) &&
      meta.data.data.availablePlatforms.every((item) =>
        (meta.data.data.platforms || []).includes(item),
      ) &&
      JSON.stringify([...meta.data.data.availablePlatforms].sort()) ===
        JSON.stringify([...expectedUsable].sort()),
    "GET geo/meta availablePlatforms＝本账号自己配置的平台",
    `meta=${(meta.data?.data?.availablePlatforms || []).join("/")} account=${expectedUsable.join("/")}`,
  );
  const created = await api(
    "POST",
    "/enterprise/geo/projects",
    {
      brand: "冒烟品牌",
      brand_aliases: "冒烟,冒烟科技",
      industry: "本地生活服务",
      competitors: "蓝橙营销",
      platforms: ["DeepSeek", "豆包"],
      note: "冒烟脚本创建",
    },
    "demo_enterprise",
  );
  assert(ok(created) && created.data.data.id > 0, "POST geo/projects 新建项目");
  const projectId = created.data?.data?.id;

  const projectList = await api(
    "GET",
    "/enterprise/geo/projects",
    null,
    "demo_enterprise",
  );
  assert(
    ok(projectList) &&
      projectList.data.data.some((item) => item.id === projectId),
    "GET geo/projects 列表包含新项目",
  );

  const question = await api(
    "POST",
    `/enterprise/geo/projects/${projectId}/questions`,
    {
      text: "本地生活达人探店哪家靠谱？",
      type: "决策词",
      priority: "P0",
      scenario: "用户选型",
      expected_answer_form: "清单/FAQ",
    },
    "demo_enterprise",
  );
  assert(ok(question) && question.data.data.id > 0, "POST questions 新增问题");
  const questionId = question.data?.data?.id;

  const batch = await api(
    "POST",
    `/enterprise/geo/projects/${projectId}/batches`,
    {
      period_label: "2026-09 第 1 期",
      channel: "A",
      data_nature: "simulated",
      platforms: ["DeepSeek", "豆包"],
      note: "冒烟脚本创建",
    },
    "demo_enterprise",
  );
  assert(ok(batch) && batch.data.data.id > 0, "POST batches 新建采集批次");
  const batchId = batch.data?.data?.id;

  const obs1 = await api(
    "POST",
    `/enterprise/geo/batches/${batchId}/observations`,
    {
      question_id: questionId,
      platform: "DeepSeek",
      brand_mentioned: 1,
      rank_position: 2,
      sentiment: "正面",
      citation_genre: "报告",
      citation_domains: "example.com",
      model_version: "deepseek-chat",
      answer_excerpt: "冒烟样本",
    },
    "demo_enterprise",
  );
  assert(ok(obs1), "POST observations 逐条录入（点名+上榜）");
  const obs2 = await api(
    "POST",
    `/enterprise/geo/batches/${batchId}/observations`,
    {
      question_id: questionId,
      platform: "豆包",
      brand_mentioned: 0,
      citation_genre: "无",
      model_version: "doubao-pro",
      answer_excerpt: "冒烟样本",
    },
    "demo_enterprise",
  );
  assert(ok(obs2), "POST observations 逐条录入（未点名）");

  const obsList = await api(
    "GET",
    `/enterprise/geo/batches/${batchId}/observations`,
    null,
    "demo_enterprise",
  );
  assert(
    ok(obsList) && obsList.data.data.length === 2,
    "GET observations",
    `rows=${obsList.data?.data?.length}`,
  );

  const report = await api(
    "GET",
    `/enterprise/geo/projects/${projectId}/report?batchId=${batchId}`,
    null,
    "demo_enterprise",
  );
  const metrics = report.data?.data?.metrics;
  // 口径断言：2 条样本 / 1 条点名 / 1 条上榜 → 提及率 0.5、上榜率 0.5、平均排名 2
  assert(
    ok(report) &&
      metrics.total === 2 &&
      metrics.mentioned === 1 &&
      metrics.listed === 1 &&
      metrics.mentionRate === 0.5 &&
      metrics.listRate === 0.5 &&
      metrics.avgRank === 2,
    "GET report 指标口径（提及率/上榜率/平均排名）",
    `total=${metrics?.total} mentioned=${metrics?.mentioned} listed=${metrics?.listed} mentionRate=${metrics?.mentionRate} listRate=${metrics?.listRate} avgRank=${metrics?.avgRank}`,
  );
  // 引用质量：报告=100、无=30 → (100+30)/2 = 65
  assert(
    metrics?.citationQuality === 65,
    "GET report 引用质量（报告 100 / 无 30）",
    `citationQuality=${metrics?.citationQuality}`,
  );
  assert(
    Array.isArray(report.data?.data?.actions) &&
      report.data.data.actions.length > 0 &&
      Array.isArray(report.data?.data?.platforms),
    "GET report 含下一步动作与分平台摘要",
  );

  const topic = await api(
    "POST",
    `/enterprise/geo/projects/${projectId}/topics`,
    {
      title: "本地生活达人探店避坑清单",
      gap_type: "引用真空点",
      question_id: questionId,
      platform_count: 3,
      gap_score: 6,
      citable_score: 7,
      business_score: 8,
      supply_score: 5,
      style_bonus: 1,
      status: "CANDIDATE",
      note: "冒烟脚本创建",
    },
    "demo_enterprise",
  );
  // 缺口 6→6+2（≥3 平台）=8；可引 7+1=8；总分 = 8*0.3+8*0.3+8*0.25+5*0.15 = 7.55 → 保留 1 位 7.6
  assert(
    ok(topic) && topic.data.data.totalScore === 7.6,
    "POST topics 四维加权与 3 平台加 2 分",
    `totalScore=${topic.data?.data?.totalScore}`,
  );
  const topicId = topic.data?.data?.id;
  const topicList = await api(
    "GET",
    `/enterprise/geo/projects/${projectId}/topics`,
    null,
    "demo_enterprise",
  );
  assert(
    ok(topicList) && topicList.data.data.some((item) => item.id === topicId),
    "GET topics 列表",
  );

  console.log("\n3b. GEO 缺口口径 / 默认批次 / 平台摘要 / 重复拦截");
  assert(
    ok(meta) && (meta.data.data.gapTypes || []).includes("名次缺口"),
    "GET geo/meta 缺口类型含「名次缺口」",
    (meta.data?.data?.gapTypes || []).join("/"),
  );
  const gapProject = await api(
    "POST",
    "/enterprise/geo/projects",
    {
      brand: "缺口口径冒烟",
      competitors: "冒烟竞品A",
      platforms: ["DeepSeek"],
      note: "冒烟脚本创建（缺口口径）",
    },
    "demo_enterprise",
  );
  const gpId = gapProject.data?.data?.id;
  assert(ok(gapProject) && gpId > 0, "POST geo/projects 缺口口径项目");

  const mkQuestion = async (text, type) =>
    api(
      "POST",
      `/enterprise/geo/projects/${gpId}/questions`,
      { text, type, priority: "P1" },
      "demo_enterprise",
    );
  const q1 = await mkQuestion("冒烟品类词问题（竞品覆盖）", "品类词");
  const q2 = await mkQuestion("冒烟决策词问题（弱覆盖）", "决策词");
  const q3 = await mkQuestion("冒烟品类词问题（名次缺口）", "品类词");
  const q1Id = q1.data?.data?.id;
  const q2Id = q2.data?.data?.id;
  const q3Id = q3.data?.data?.id;
  assert(
    ok(q1) && ok(q2) && ok(q3),
    "POST questions ×3（竞品覆盖 / 弱覆盖 / 名次缺口）",
  );

  const gapBatch = await api(
    "POST",
    `/enterprise/geo/projects/${gpId}/batches`,
    {
      period_label: "口径期-1",
      channel: "A",
      data_nature: "real",
      platforms: ["DeepSeek"],
      note: "冒烟脚本创建",
    },
    "demo_enterprise",
  );
  const gbId = gapBatch.data?.data?.id;
  assert(ok(gapBatch) && gbId > 0, "POST batches 缺口口径批次");

  const mkObs = (body) =>
    api(
      "POST",
      `/enterprise/geo/batches/${gbId}/observations`,
      body,
      "demo_enterprise",
    );
  const gObs1 = await mkObs({
    question_id: q1Id,
    platform: "DeepSeek",
    brand_mentioned: 0,
    answer_excerpt: "建议选 冒烟竞品A，服务稳定",
  });
  const gObs2 = await mkObs({
    question_id: q2Id,
    platform: "DeepSeek",
    brand_mentioned: 1,
    sentiment: "中性",
    citation_genre: "无",
    answer_excerpt: "缺口口径冒烟 可以看看",
  });
  // 平台不在批次配置内：仍可录入，但分平台摘要要能补上（合计＝总数）
  const gObs3 = await mkObs({
    question_id: q2Id,
    platform: "豆包",
    brand_mentioned: 1,
    sentiment: "中性",
    citation_genre: "无",
    answer_excerpt: "缺口口径冒烟 可以看看",
  });
  const gObs4 = await mkObs({
    question_id: q3Id,
    platform: "DeepSeek",
    brand_mentioned: 1,
    rank_position: 5,
    sentiment: "中性",
    citation_genre: "报告",
    answer_excerpt: "第 5 位是 缺口口径冒烟",
  });
  assert(ok(gObs1) && ok(gObs2) && ok(gObs3) && ok(gObs4), "POST observations ×4");

  const dup = await mkObs({
    question_id: q1Id,
    platform: "DeepSeek",
    brand_mentioned: 0,
    answer_excerpt: "重复录入",
  });
  assert(
    dup.data?.code !== 0 && /已录过观测/.test(dup.data?.message || ""),
    "同一「问题 × 平台」重复录入被拦截",
    dup.data?.message,
  );

  const gapReport = await api(
    "GET",
    `/enterprise/geo/projects/${gpId}/report`,
    null,
    "demo_enterprise",
  );
  const gm = gapReport.data?.data?.metrics;
  const gd = gapReport.data?.data;
  assert(
    ok(gapReport) &&
      gm?.total === 4 &&
      gm?.mentioned === 3 &&
      gm?.listed === 1 &&
      gm?.avgRank === 5,
    "GET report 缺口口径指标（4 样本 / 3 点名 / 1 上榜 / 平均 5）",
    `total=${gm?.total} mentioned=${gm?.mentioned} listed=${gm?.listed} avgRank=${gm?.avgRank}`,
  );
  assert(
    Array.isArray(gd?.project?.brandAliasList),
    "GET report 带回 brandAliasList（报告页不再白屏）",
  );
  assert(
    (gd?.platforms || []).length === 2 &&
      (gd?.platforms || []).reduce((sum, row) => sum + row.total, 0) === gm?.total,
    "分平台摘要＝批次平台 ∪ 实际出现平台，合计＝总数",
    (gd?.platforms || [])
      .map((row) => `${row.platform}:${row.total}`)
      .join(" "),
  );
  assert(
    (gd?.batches || []).every((row) => typeof row.observationCount === "number"),
    "report.batches 带回 observationCount",
  );
  const gapTypes = Object.fromEntries(
    (gd?.gaps || []).map((row) => [row.questionId, row.gapType]),
  );
  assert(
    gapTypes[q1Id] === "竞品覆盖点" &&
      gapTypes[q2Id] === "弱覆盖点" &&
      gapTypes[q3Id] === "名次缺口",
    "缺口判定：竞品覆盖点 / 弱覆盖点 / 名次缺口",
    JSON.stringify(gapTypes),
  );

  // 空批次不能把报告清零：默认应仍报「最新有观测的批次」
  const emptyBatch = await api(
    "POST",
    `/enterprise/geo/projects/${gpId}/batches`,
    { period_label: "口径期-2（空）", channel: "A", data_nature: "real" },
    "demo_enterprise",
  );
  const emptyBatchId = emptyBatch.data?.data?.id;
  const afterEmpty = await api(
    "GET",
    `/enterprise/geo/projects/${gpId}/report`,
    null,
    "demo_enterprise",
  );
  assert(
    ok(emptyBatch) &&
      afterEmpty.data?.data?.current?.id === gbId &&
      afterEmpty.data?.data?.metrics?.total === 4,
    "新建空批次后默认仍报有观测的批次",
    `current=${afterEmpty.data?.data?.current?.id} total=${afterEmpty.data?.data?.metrics?.total}`,
  );
  const explicitEmpty = await api(
    "GET",
    `/enterprise/geo/projects/${gpId}/report?batchId=${emptyBatchId}`,
    null,
    "demo_enterprise",
  );
  assert(
    explicitEmpty.data?.data?.current?.id === emptyBatchId &&
      explicitEmpty.data?.data?.metrics?.total === 0,
    "显式选择空批次时报告如实返回 0 样本",
  );

  // 淘汰的问题不再参与缺口（历史观测仍计入指标）
  await api(
    "PATCH",
    `/enterprise/geo/questions/${q2Id}`,
    { project_id: gpId, status: "RETIRED" },
    "demo_enterprise",
  );
  const retiredReport = await api(
    "GET",
    `/enterprise/geo/projects/${gpId}/report`,
    null,
    "demo_enterprise",
  );
  assert(
    ok(retiredReport) &&
      (retiredReport.data?.data?.gaps || []).every(
        (row) => row.questionId !== q2Id,
      ) &&
      retiredReport.data?.data?.metrics?.total === 4,
    "已淘汰问题不再进缺口清单，历史观测仍计入指标",
  );

  const gapCleanup = await api(
    "DELETE",
    `/enterprise/geo/projects/${gpId}`,
    null,
    "demo_enterprise",
  );
  assert(ok(gapCleanup), "DELETE geo/projects 清理缺口口径冒烟数据");

  console.log("\n4. GEO 越权与清理");
  const otherUser = await api(
    "GET",
    `/enterprise/geo/projects/${projectId}/report`,
    null,
    "demo_provider",
  );
  assert(
    otherUser.data?.code !== 0,
    "非当事人读取他方 GEO 项目被拒",
    otherUser.data?.message,
  );
  const deleted = await api(
    "DELETE",
    `/enterprise/geo/projects/${projectId}`,
    null,
    "demo_enterprise",
  );
  assert(ok(deleted), "DELETE geo/projects 清理冒烟数据");

  const { passed, failed } = suite.counts();
  console.log(`\n通过 ${passed} / 失败 ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error("脚本异常：", error);
  process.exit(1);
});
