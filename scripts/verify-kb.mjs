/**
 * 知识库底座（方案 §10 L1）后端全链路验证：
 * - 空间可见性（PRIVATE 外人 404 / 会话绑定切库）与维护规范版本化；
 * - 源投料 hash 去重 → Ingest 规则式编译 SUMMARY 页（未配 Key 的确定性回落）；
 * - 页写入联动图谱（wikilink→实体/边）与检索（关键词+本地向量混合召回）；
 * - 人在环 PENDING_REVIEW 放行/驳回、Ask 引用与 saveAsPage 沉淀、Lint/图谱洞察；
 * - 消费者 WRITE 绑定即账号写权限、记忆提炼（冲突事件进待审）、召回回流、时间线/统计；
 * - 删页后检索不再命中。账号与空间自建自删，kb_* 表按涉及空间清理，不留副作用。
 * 鉴权走本站自签 SSO 会话（createLocalSessionSuite），目标实例由 BASE_URL 指定。
 */
import { createLocalSessionSuite } from "./harness.mjs";

const suite = await createLocalSessionSuite();
const { api, log, assert, prisma } = suite;

const owner = "verify-kb-owner";
const peer = "verify-kb-peer";
let ownerId = "";
let peerId = "";

async function ensureAccount(username) {
  const existing = await prisma.account.findFirst({ where: { username } });
  if (existing) return existing;
  return prisma.account.create({ data: { username, role: "USER" } });
}

const DOC = [
  "产品发布会议纪要：2026 年第三季度发布会定于九月举行，由产品经理林微负责整体协调。",
  "本次会议确认了发布会的三个核心模块：智能知识库、人才评估引擎与营销技能库。",
  "智能知识库将作为一体化平台的事实底座，林微强调所有结论必须可溯源到原始会议纪要。",
  "市场部门要求发布会材料在七月前定稿；张伟负责对接外部渠道与物料印制。",
  "财务审核预算：本次发布会预算总额五十万元，由财务部在六月完成审批流程。",
].join("\n\n");

try {
  const health = await api("GET", "/health");
  assert(health.data?.code === 0, "health");

  const ownerRow = await ensureAccount(owner);
  const peerRow = await ensureAccount(peer);
  ownerId = String(ownerRow.id);
  peerId = String(peerRow.id);

  // ---------- 空间与可见性 ----------
  const created = await api("POST", "/enterprise/kb/spaces/create", {
    name: "验证知识库",
    description: "verify-kb 专用空间",
    scopeType: "PERSONAL",
    orgType: undefined,
    orgUserId: "",
    visibility: "PRIVATE",
  }, owner);
  assert(created.data?.code === 0 && created.data?.data?.id > 0, "建个人空间", JSON.stringify(created.data));
  const spaceId = created.data?.data?.id;

  const mySpaces = await api("GET", "/enterprise/kb/spaces", null, owner);
  assert((mySpaces.data?.data || []).some((s) => s.id === spaceId), "owner 空间列表可见自建空间");
  const peerSpaces = await api("GET", "/enterprise/kb/spaces", null, peer);
  assert(!(peerSpaces.data?.data || []).some((s) => s.id === spaceId), "外人看不到 PRIVATE 空间");
  const peerGet = await api("GET", `/enterprise/kb/spaces/${spaceId}`, null, peer);
  assert(peerGet.data?.code !== 0, "外人读空间详情被拒（不泄露存在性）", `code=${peerGet.data?.code}`);

  const selected = await api("POST", "/enterprise/kb/space/select", { spaceId }, owner);
  assert(selected.data?.code === 0 && selected.data?.data?.id === spaceId, "会话绑定当前知识空间");
  const current = await api("GET", "/enterprise/kb/current", null, owner);
  assert(current.data?.data?.id === spaceId, "current 返回绑定空间");

  // ---------- 维护规范版本化 ----------
  const schemaGet = await api("GET", `/enterprise/kb/schema?spaceId=${spaceId}`, null, owner);
  assert(schemaGet.data?.code === 0 && Array.isArray(schemaGet.data?.data?.pageTypes), "默认维护规范可读");
  const promptV1 = "规范 v1：摘要页必须引用源编号。";
  const schemaSave = await api("POST", "/enterprise/kb/schema/save", { spaceId, workflowPrompt: promptV1 }, owner);
  assert(schemaSave.data?.code === 0 && schemaSave.data?.data?.version === 1, "保存规范 v1", JSON.stringify(schemaSave.data?.data));
  const schemaSave2 = await api("POST", "/enterprise/kb/schema/save", { spaceId, workflowPrompt: "规范 v2" }, owner);
  assert(schemaSave2.data?.data?.version === 2, "规范版本自增到 v2");

  // ---------- 源投料与去重 ----------
  const added = await api("POST", "/enterprise/kb/sources/add", {
    spaceId, kind: "meeting", title: "Q3 发布会纪要", text: DOC, assetId: 0,
  }, owner);
  assert(added.data?.code === 0 && added.data?.data?.status === "PENDING", "投料成功 PENDING", JSON.stringify(added.data));
  const sourceId = added.data?.data?.id;
  const dup = await api("POST", "/enterprise/kb/sources/add", {
    spaceId, kind: "meeting", title: "Q3 发布会纪要", text: DOC, assetId: 0,
  }, owner);
  assert(dup.data?.data?.id === sourceId, "同内容 hash 去重复用既有行");

  // ---------- Ingest 规则式编译 ----------
  const ingested = await api("POST", "/enterprise/kb/ingest", { spaceId, sourceId }, owner);
  assert(
    ingested.data?.code === 0 && ingested.data?.data?.status === "DONE",
    "摄取作业 DONE（未配 Key 走规则式）",
    JSON.stringify(ingested.data),
  );
  const summaryPageId = (ingested.data?.data?.pagesAffected || [])[0];
  assert(Number.isInteger(summaryPageId) && summaryPageId > 0, "摄取产出 SUMMARY 页");
  const srcAfter = await api("GET", `/enterprise/kb/sources?spaceId=${spaceId}&page=1&pageSize=20`, null, owner);
  assert((srcAfter.data?.data?.list || []).find((s) => s.id === sourceId)?.status === "INGESTED", "源状态 INGESTED");
  const jobs = await api("GET", `/enterprise/kb/ingest-jobs?spaceId=${spaceId}&page=1&pageSize=20`, null, owner);
  assert((jobs.data?.data?.list || []).some((j) => j.id === ingested.data?.data?.id), "摄取作业台账可查");

  const detail = await api("GET", `/enterprise/kb/pages/${summaryPageId}`, null, owner);
  assert(
    detail.data?.code === 0 && detail.data?.data?.type === "SUMMARY" && detail.data?.data?.status === "PUBLISHED",
    "SUMMARY 页已发布",
  );
  assert((detail.data?.data?.sources || []).some((s) => s.id === sourceId), "摘要页带源溯源");

  // ---------- 写页联动图谱与检索 ----------
  const mainSlug = "fabuhui-2026q3";
  const mainWrite = await api("POST", "/enterprise/kb/pages/write", {
    spaceId,
    slug: mainSlug,
    type: "CONCEPT",
    title: "发布会 2026Q3",
    body: "本页汇总发布会要点。负责人见 [[林微]]，预算口径见 [[预算审批]]。",
    frontmatter: { tags: ["meeting"] },
    sourceIds: [sourceId],
  }, owner);
  assert(mainWrite.data?.code === 0 && mainWrite.data?.data?.slug === mainSlug, "写主概念页（含 wikilink）");
  const mainPageId = mainWrite.data?.data?.id;
  assert(
    (mainWrite.data?.data?.outLinks || []).length === 0,
    "首轮出链为空（目标实体尚无页）",
  );

  await api("POST", "/enterprise/kb/pages/write", {
    spaceId, slug: "linwei", type: "ENTITY", title: "林微",
    body: "产品经理，负责 [[发布会 2026Q3]] 的整体协调。", frontmatter: { entityType: "PERSON" }, sourceIds: [],
  }, owner);
  const rewrite = await api("POST", "/enterprise/kb/pages/write", {
    spaceId,
    slug: mainSlug,
    type: "CONCEPT",
    title: "发布会 2026Q3",
    body: "本页汇总发布会要点。负责人见 [[林微]]，预算口径见 [[预算审批]]。",
    frontmatter: { tags: ["meeting"] },
    sourceIds: [sourceId],
  }, owner);
  assert(rewrite.data?.data?.version >= 2, "slug 幂等 upsert 版本自增");
  assert(
    (rewrite.data?.data?.outLinks || []).some((l) => l.slug === "linwei"),
    "目标建页后出链自动接通",
    JSON.stringify(rewrite.data?.data?.outLinks),
  );
  const linweiDetail = await api(
    "GET",
    `/enterprise/kb/pages?spaceId=${spaceId}&q=linwei`,
    null,
    owner,
  );
  const linweiId = (linweiDetail.data?.data?.list || [])[0]?.id;
  const linweiFull = await api("GET", `/enterprise/kb/pages/${linweiId}`, null, owner);
  assert((linweiFull.data?.data?.inLinks || []).some((l) => l.slug === mainSlug), "入链反向可见");

  const search = await api("GET", `/enterprise/kb/search?spaceId=${spaceId}&q=${encodeURIComponent("发布会 林微")}&topK=8`, null, owner);
  assert(search.data?.code === 0 && (search.data?.data?.hits || []).length > 0, "混合检索有命中", JSON.stringify(search.data?.data || {}).slice(0, 200));
  const hitIds = (search.data?.data?.hits || []).map((h) => h.pageId);
  assert(hitIds.includes(mainPageId) || hitIds.includes(summaryPageId), "命中含主概念页或摘要页");
  assert((search.data?.data?.modes || []).includes("keyword"), "召回口径含 keyword（本地向量随写随建）");
  const topHit = (search.data?.data?.hits || [])[0];
  assert(topHit && topHit.score > 0 && Array.isArray(topHit.sourceIds), "命中行带融合分与引用源");

  // ---------- 人在环评审 ----------
  const pendingWrite = await api("POST", "/enterprise/kb/pages/write", {
    spaceId, slug: "caogao-pending", type: "SYNTHESIS", title: "待审沉淀页",
    body: "由 Agent 渠道写入的结论，见 [[林微]]。", frontmatter: {}, status: "PENDING_REVIEW", sourceIds: [],
  }, owner);
  assert(pendingWrite.data?.data?.status === "PENDING_REVIEW", "显式送审进 PENDING_REVIEW");
  const approved = await api("POST", "/enterprise/kb/pages/review", { id: pendingWrite.data?.data?.id, decision: "publish", note: "核验通过" }, owner);
  assert(approved.data?.code === 0 && approved.data?.data?.status === "PUBLISHED", "放行后 PUBLISHED");
  const rejected = await api("POST", "/enterprise/kb/pages/review", { id: pendingWrite.data?.data?.id, decision: "reject", note: "重复" }, owner);
  assert(rejected.data?.code !== 0, "已发布页不再可审（状态机收口）");
  const pend2 = await api("POST", "/enterprise/kb/pages/write", {
    spaceId, slug: "caogao-reject", type: "CONCEPT", title: "待驳回页", body: "内容存疑", frontmatter: {}, status: "PENDING_REVIEW", sourceIds: [],
  }, owner);
  const rejectedRow = await api("POST", "/enterprise/kb/pages/review", { id: pend2.data?.data?.id, decision: "reject", note: "口径不清" }, owner);
  assert(rejectedRow.data?.code === 0 && rejectedRow.data?.data?.status === "DRAFT", "驳回回落 DRAFT");

  // ---------- 问答与沉淀 ----------
  const asked = await api("POST", "/enterprise/kb/ask", {
    spaceId, question: "发布会由谁负责协调？", topK: 4, saveAsPage: true,
  }, owner);
  assert(asked.data?.code === 0 && String(asked.data?.data?.answer || "").length > 10, "Ask 有答案", JSON.stringify(asked.data).slice(0, 200));
  assert((asked.data?.data?.citations || []).length > 0, "Ask 带编号引用");
  assert(["llm", "extractive"].includes(asked.data?.data?.mode), "Ask 模式如实报告");
  const savedPageId = asked.data?.data?.savedPageId;
  if (savedPageId) {
    const saved = await api("GET", `/enterprise/kb/pages/${savedPageId}`, null, owner);
    assert(saved.data?.data?.status === "PENDING_REVIEW", "好答案沉淀默认待审（复利走人在环）");
  } else {
    assert(asked.data?.data?.mode !== "llm", "无 Key 环境抽中式答案也应能沉淀", JSON.stringify(asked.data).slice(0, 300));
  }

  // ---------- 图谱与巡检 ----------
  const graph = await api("GET", `/enterprise/kb/graph?spaceId=${spaceId}&depth=1`, null, owner);
  assert(
    graph.data?.code === 0 && (graph.data?.data?.nodes || []).length > 0 && (graph.data?.data?.edges || []).length > 0,
    "子图节点与边随写长出",
  );
  const insights = await api("GET", `/enterprise/kb/graph-insights?spaceId=${spaceId}`, null, owner);
  assert(insights.data?.data?.stats?.entities > 0 && insights.data?.data?.stats?.pages > 0, "洞察统计非空");
  assert(Array.isArray(insights.data?.data?.missingRefs), "缺失引用清单（预算审批未建页在列）");
  assert(
    (insights.data?.data?.missingRefs || []).some((m) => m.wikilink === "预算审批"),
    "未建页的 wikilink 被识别为缺失交叉引用",
    JSON.stringify((insights.data?.data?.missingRefs || []).slice(0, 3)),
  );
  const linted = await api("POST", "/enterprise/kb/lint", { spaceId }, owner);
  assert(linted.data?.code === 0 && linted.data?.data?.status === "DONE", "巡检落台账 DONE");
  const lintRuns = await api("GET", `/enterprise/kb/lint-runs?spaceId=${spaceId}&page=1&pageSize=10`, null, owner);
  assert((lintRuns.data?.data?.list || []).some((r) => r.id === linted.data?.data?.id), "巡检台账可分页查");

  // ---------- 消费者绑定即写权限 ----------
  const peerWriteBefore = await api("POST", "/enterprise/kb/pages/write", {
    spaceId, slug: "peer-no", type: "CONCEPT", title: "外人写页", body: "x", frontmatter: {}, sourceIds: [],
  }, peer);
  assert(peerWriteBefore.data?.code !== 0, "外人写 PRIVATE 空间被拒");
  const bound = await api("POST", "/enterprise/kb/consumers/bind", {
    spaceId, consumerType: "AGENT", consumerId: peerId, role: "WRITE", priority: 5,
  }, owner);
  assert(bound.data?.code === 0 && bound.data?.data?.role === "WRITE", "绑定 WRITE 消费者（consumerId=账号）");
  const peerReadAfterBind = await api("POST", "/enterprise/kb/pages/write", {
    spaceId, slug: "peer-write", type: "CONCEPT", title: "消费者写页", body: "由绑定账号写入", frontmatter: {}, sourceIds: [],
  }, peer);
  assert(peerReadAfterBind.data?.code === 0, "WRITE 消费者账号可写（多消费者模型）");
  await api("POST", "/enterprise/kb/consumers/delete", { id: bound.data?.data?.id }, owner);
  const peerWriteAfterUnbind = await api("POST", "/enterprise/kb/pages/write", {
    spaceId, slug: "peer-write", type: "CONCEPT", title: "消费者写页", body: "解绑后再写", frontmatter: {}, sourceIds: [],
  }, peer);
  assert(peerWriteAfterUnbind.data?.code !== 0, "解绑后写权限立即回收");

  // ---------- 记忆提炼与召回 ----------
  await prisma.agentMemoryEvent.createMany({
    data: [
      { userId: ownerId, domain: "verifykb", action: "Verifykb_createThing", targetType: "thing", targetId: "t1", targetLabel: "验证对象一" },
      { userId: ownerId, domain: "verifykb", action: "Verifykb_deleteThing", targetType: "thing", targetId: "t1", targetLabel: "验证对象一" },
      { userId: ownerId, domain: "verifykb", action: "Verifykb_updateThing", targetType: "thing", targetId: "t2", targetLabel: "验证对象二" },
    ],
  });
  const consolidated = await api("POST", "/enterprise/kb/consolidate", { spaceId, limit: 100 }, owner);
  assert(consolidated.data?.code === 0 && consolidated.data?.data?.eventsScanned >= 3, "提炼扫到验证事件", JSON.stringify(consolidated.data));
  assert((consolidated.data?.data?.pagesWritten || []).length >= 1, "每个业务域聚合出一张记忆页");
  const memPage = await api("GET", `/enterprise/kb/pages?spaceId=${spaceId}&q=memory-verifykb`, null, owner);
  const memRow = (memPage.data?.data?.list || [])[0];
  assert(memRow?.slug === "memory-verifykb", "记忆页 slug 确定可查");
  assert(memRow?.status === "PENDING_REVIEW", "同对象创建+删除冲突 → 记忆页进待审（人在环）");

  const recalled = await api("POST", "/enterprise/kb/recall", { query: "发布会 林微 协调", topK: 3, maxChars: 600 }, owner);
  assert(recalled.data?.code === 0 && recalled.data?.data?.boundSpaceId === spaceId, "召回走会话绑定空间");
  assert((recalled.data?.data?.snippets || []).length > 0, "回流片段非空（PUBLISHED 页）");
  const snippetTotal = (recalled.data?.data?.snippets || []).reduce((sum, s) => sum + s.text.length, 0);
  assert(snippetTotal <= 600, "回流按 maxChars 预算裁剪", `total=${snippetTotal}`);

  const foreignConsolidate = await api("POST", "/enterprise/kb/consolidate", { userId: ownerId, limit: 10 }, peer);
  assert(foreignConsolidate.data?.code !== 0, "非管理员不得提炼他人记忆");

  // ---------- 统计、时间线与删页 ----------
  const indexStats = await api("GET", `/enterprise/kb/index?spaceId=${spaceId}`, null, owner);
  assert(indexStats.data?.code === 0 && indexStats.data?.data?.pageCount > 0 && indexStats.data?.data?.chunkCount > 0, "索引统计非空");
  const logs = await api("GET", `/enterprise/kb/logs?spaceId=${spaceId}&page=1&pageSize=100`, null, owner);
  const kinds = new Set((logs.data?.data?.list || []).map((l) => l.kind));
  assert(
    ["WRITE", "INGEST", "REVIEW", "QUERY", "LINT", "BIND", "CONSOLIDATE"].every((k) => kinds.has(k)),
    "时间线覆盖七类操作",
    [...kinds].join(","),
  );

  const del = await api("POST", "/enterprise/kb/pages/delete", { id: mainPageId }, owner);
  assert(del.data?.code === 0 && del.data?.data?.deleted === 1, "删页成功");
  const searchAfterDel = await api("GET", `/enterprise/kb/search?spaceId=${spaceId}&q=${encodeURIComponent("预算口径见")}`, null, owner);
  assert(
    !(searchAfterDel.data?.data?.hits || []).some((h) => h.pageId === mainPageId),
    "删页后检索不再命中（chunk 同步清理）",
  );
  const peerSearch = await api("GET", `/enterprise/kb/search?spaceId=${spaceId}&q=发布会`, null, peer);
  assert(peerSearch.data?.code !== 0, "外人检索 PRIVATE 空间被拒");
} finally {
  const spaces = await prisma.kbSpace.findMany({ where: { ownerUserId: { in: [ownerId, peerId] } }, select: { id: true } });
  const spaceIds = spaces.map((s) => s.id);
  if (spaceIds.length) {
    // kb_page_sources 无空间列也无关系字段：先收集页 id 再按 pageId 清理
    const pageIds = (await prisma.kbPage.findMany({ where: { spaceId: { in: spaceIds } }, select: { id: true } })).map((p) => p.id);
    await Promise.all([
      prisma.kbChunk.deleteMany({ where: { spaceId: { in: spaceIds } } }),
      pageIds.length
        ? prisma.kbPageSource.deleteMany({ where: { pageId: { in: pageIds } } })
        : Promise.resolve(),
      prisma.kbPage.deleteMany({ where: { spaceId: { in: spaceIds } } }),
      prisma.kbSource.deleteMany({ where: { spaceId: { in: spaceIds } } }),
      prisma.kbRelation.deleteMany({ where: { spaceId: { in: spaceIds } } }),
      prisma.kbEntity.deleteMany({ where: { spaceId: { in: spaceIds } } }),
      prisma.kbIndex.deleteMany({ where: { spaceId: { in: spaceIds } } }),
      prisma.kbLog.deleteMany({ where: { spaceId: { in: spaceIds } } }),
      prisma.kbConsumer.deleteMany({ where: { spaceId: { in: spaceIds } } }),
      prisma.kbIngestJob.deleteMany({ where: { spaceId: { in: spaceIds } } }),
      prisma.kbLintRun.deleteMany({ where: { spaceId: { in: spaceIds } } }),
      prisma.kbSchema.deleteMany({ where: { spaceId: { in: spaceIds } } }),
    ]);
  }
  await prisma.kbSpaceBinding.deleteMany({ where: { userId: { in: [ownerId, peerId] } } });
  await prisma.kbSpace.deleteMany({ where: { id: { in: spaceIds } } });
  await prisma.agentMemoryEvent.deleteMany({ where: { userId: { in: [ownerId, peerId] }, domain: "verifykb" } });
  await prisma.account.deleteMany({ where: { username: { in: [owner, peer] } } });
  const leftSpace = await prisma.kbSpace.count({ where: { id: { in: spaceIds } } });
  const leftPage = spaceIds.length
    ? await prisma.kbPage.count({ where: { spaceId: { in: spaceIds } } })
    : 0;
  log("清理：验证空间与页已归零", leftSpace === 0 && leftPage === 0, `space=${leftSpace} page=${leftPage}`);
  await prisma.$disconnect();
}

const { passed, failed } = suite.counts();
console.log(`\n${passed} passed / ${failed} failed`);
process.exit(failed ? 1 : 0);
