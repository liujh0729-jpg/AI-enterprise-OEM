/**
 * 专题大厅：接口层实测。
 *
 * 口径：
 * - 打临时实例（regression-instance.mjs --port=1695），不碰 1690 日常实例。
 * - 三个账号：A=发布者（demo_enterprise）、B=公开问题参与者（demo_user）、C=企业外成员（demo_individual）。
 * - 只造带 STAMP 后缀的问题；收尾用 Prisma 按本题 id 硬删（问题/楼层/结案记录），
 *   数字分身走接口删除。绝不动其他数据。
 * - 结案依赖模型：断言「结案后状态一定变成已结案」这条确定性口径；
 *   总结是否生成按实际结果打印，生成了再断言正文非空（不写双选放水）。
 *
 * 用法：
 *   node scripts/regression-instance.mjs --port=1695 -- node scripts/verify-question-hall.mjs
 */
import { createSuite, createPrisma } from "./harness.mjs";

const suite = createSuite({
  base: process.env.BASE_URL || "http://127.0.0.1:1695",
});
const { call, assert } = suite;

const A = "demo_enterprise";
const B = "demo_user";
const C = "demo_individual";
const BASE = "/enterprise/question-hall";
const PERSONAS = "/enterprise/content/agent/personas";
const STAMP = Date.now();
const ENTERPRISE_TITLE = `验证·企业内问题-${STAMP}`;
const PUBLIC_TITLE = `验证·公开问题-${STAMP}`;
const PERSONA_NAME = `验证大厅分身-${STAMP}`;

const createdQuestions = [];
let personaId = 0;

console.log(`目标实例：${suite.base}`);
console.log(`发布者：${A} / 参与者：${B} / 企业外：${C}`);

const detailOf = (id, who) =>
  call("GET", `${BASE}/questions/${id}`, who);

try {
  // ---------- 1) 未登录 ----------
  const anon = await fetch(`${suite.base}${BASE}/questions`);
  assert(anon.status === 401, "未登录读问题列表 → 401", `status=${anon.status}`);

  // ---------- 2) 发布企业内问题 ----------
  const config = await call("GET", `${BASE}/config`, A);
  assert(
    config.code === 0 && Array.isArray(config.data?.personas),
    "专题大厅选项可读（分身清单 + 组织名）",
    `code=${config.code}`,
  );

  const enterpriseAsk = await call("POST", `${BASE}/questions`, A, {
    title: ENTERPRISE_TITLE,
    body: "这是验证用的企业内问题正文。",
    scope: "ENTERPRISE",
  });
  assert(
    enterpriseAsk.code === 0 &&
      enterpriseAsk.data?.scope === "ENTERPRISE" &&
      enterpriseAsk.data?.status === "OPEN",
    "发布企业内问题成功（进行中）",
    `code=${enterpriseAsk.code} message=${enterpriseAsk.message}`,
  );
  const enterpriseId = enterpriseAsk.data?.id || 0;
  createdQuestions.push(enterpriseId);

  // ---------- 3) 企业内：组织外成员看不到 ----------
  const outsiderDetail = await detailOf(enterpriseId, C);
  assert(
    outsiderDetail.code !== 0,
    "组织外成员读不到企业内问题",
    `code=${outsiderDetail.code} message=${outsiderDetail.message}`,
  );
  const outsiderList = await call(
    "GET",
    `${BASE}/questions?page=1&pageSize=50&keyword=${encodeURIComponent(ENTERPRISE_TITLE)}`,
    C,
  );
  assert(
    outsiderList.code === 0 &&
      !(outsiderList.data?.list || []).some((item) => item.id === enterpriseId),
    "组织外成员的列表里没有这条企业内问题",
  );
  const authorDetail = await detailOf(enterpriseId, A);
  assert(
    authorDetail.code === 0 && authorDetail.data?.question?.id === enterpriseId,
    "发布者自己能读到企业内问题",
  );

  // ---------- 4) 公开问题：任何登录账号可见可发言 ----------
  const publicAsk = await call("POST", `${BASE}/questions`, A, {
    title: PUBLIC_TITLE,
    body: "这是验证用的公开问题正文。",
    scope: "PUBLIC",
  });
  assert(publicAsk.code === 0, "发布公开问题成功", `code=${publicAsk.code}`);
  const publicId = publicAsk.data?.id || 0;
  createdQuestions.push(publicId);

  const cDetail = await detailOf(publicId, C);
  assert(
    cDetail.code === 0 && cDetail.data?.question?.canReply === true,
    "公开问题对企业外成员可见且可发言",
    `code=${cDetail.code}`,
  );

  const reply1 = await call("POST", `${BASE}/questions/${publicId}/replies`, C, {
    content: "我是企业外成员，公开问题可以参与。",
  });
  assert(reply1.code === 0, "企业外成员在公开问题下发首条发言", `code=${reply1.code}`);
  const firstReply = reply1.data?.messages?.find((item) => item.parentId === 0);
  assert(Boolean(firstReply?.id), "首条发言是一层回复（parentId=0）");

  // ---------- 5) 两层楼层：发布者回复「回复」 ----------
  const reply2 = await call("POST", `${BASE}/questions/${publicId}/replies`, A, {
    content: "这是对上面那条发言的回复。",
    parentId: firstReply?.id,
  });
  const nested = reply2.data?.messages?.find(
    (item) => item.parentId === firstReply?.id,
  );
  assert(
    reply2.code === 0 && nested?.body === "这是对上面那条发言的回复。",
    "回复的回复挂在顶层楼层下（只有两层）",
    `code=${reply2.code}`,
  );
  assert(
    reply2.data?.question?.replyCount === 2,
    "楼层数与回复数一致",
    `replyCount=${reply2.data?.question?.replyCount}`,
  );

  // ---------- 6) 分身署名 ----------
  const persona = await call("POST", PERSONAS, A, {
    name: PERSONA_NAME,
    style: "efficient",
    persona: "",
  });
  assert(persona.code === 0, "新建验证分身成功", `code=${persona.code}`);
  personaId = persona.data?.id || 0;
  const reply3 = await call("POST", `${BASE}/questions/${publicId}/replies`, A, {
    content: "这条用数字分身署名。",
    personaId,
  });
  const avatarReply = reply3.data?.messages?.find(
    (item) => item.personaId === personaId,
  );
  assert(
    avatarReply?.authorKind === "AVATAR" &&
      String(avatarReply?.authorLabel || "").includes(PERSONA_NAME),
    "分身发言署名「昵称 · 分身名」，作者类型为数字分身",
    `authorKind=${avatarReply?.authorKind} authorLabel=${avatarReply?.authorLabel}`,
  );

  // ---------- 7) 非发布者不能结案 / 关闭 / 删除 ----------
  const outsiderResolve = await call(
    "POST",
    `${BASE}/questions/${publicId}/resolve`,
    C,
  );
  assert(
    outsiderResolve.code !== 0,
    "非发布者不能结案",
    `code=${outsiderResolve.code} message=${outsiderResolve.message}`,
  );
  const outsiderClose = await call("POST", `${BASE}/questions/${publicId}/close`, C);
  assert(outsiderClose.code !== 0, "非发布者不能关闭问题", `code=${outsiderClose.code}`);
  const outsiderDelete = await call("DELETE", `${BASE}/questions/${publicId}`, C);
  assert(outsiderDelete.code !== 0, "非发布者不能删除问题", `code=${outsiderDelete.code}`);

  // ---------- 8) 结案：状态一定变；总结按实际结果断言 ----------
  const resolved = await call("POST", `${BASE}/questions/${publicId}/resolve`, A);
  const afterResolve = await detailOf(publicId, A);
  assert(
    afterResolve.data?.question?.status === "RESOLVED",
    "结案后状态变为已结案（即使 AI 总结失败也不回退）",
    `status=${afterResolve.data?.question?.status}`,
  );
  if (resolved.code === 0) {
    const summary = resolved.data?.summaries?.[0];
    assert(
      Boolean(summary?.content) && summary?.seq === 1,
      "结案生成了第 1 份 AI 总结",
      `seq=${summary?.seq} chars=${summary?.content?.length || 0}`,
    );
    assert(
      summary?.messageCount === 3,
      "总结覆盖了全部楼层",
      `messageCount=${summary?.messageCount}`,
    );
  } else {
    console.log(
      `（AI 总结未生成：${resolved.message}；按口径已结案，可稍后重新结案）`,
    );
  }

  // ---------- 9) 结案后仍可发言；关闭后不可 ----------
  const afterResolveReply = await call(
    "POST",
    `${BASE}/questions/${publicId}/replies`,
    B,
    { content: "结案后还能继续发言。" },
  );
  assert(
    afterResolveReply.code === 0,
    "结案后仍然可以继续发言",
    `code=${afterResolveReply.code} message=${afterResolveReply.message}`,
  );

  const closed = await call("POST", `${BASE}/questions/${publicId}/close`, A);
  assert(
    closed.code === 0 && closed.data?.status === "CLOSED",
    "发布者关闭问题成功（已关闭）",
    `code=${closed.code} status=${closed.data?.status}`,
  );

  const closedList = await call(
    "GET",
    `${BASE}/questions?page=1&pageSize=50&keyword=${encodeURIComponent(PUBLIC_TITLE)}`,
    B,
  );
  assert(
    closedList.code === 0 &&
      !(closedList.data?.list || []).some((item) => item.id === publicId),
    "关闭的问题不出现在大厅列表",
  );
  const closedDetail = await detailOf(publicId, B);
  assert(
    closedDetail.code === 0 && closedDetail.data?.question?.canReply === false,
    "关闭后详情仍可看，但不能再发言",
    `canReply=${closedDetail.data?.question?.canReply}`,
  );
  const replyWhenClosed = await call(
    "POST",
    `${BASE}/questions/${publicId}/replies`,
    B,
    { content: "关闭后这条应该被拒。" },
  );
  assert(
    replyWhenClosed.code !== 0 && /关闭/.test(replyWhenClosed.message || ""),
    "关闭后发发言被拒",
    `code=${replyWhenClosed.code} message=${replyWhenClosed.message}`,
  );

  // ---------- 10) 重新开放 ----------
  const reopened = await call("POST", `${BASE}/questions/${publicId}/reopen`, A);
  assert(
    reopened.code === 0 && reopened.data?.status !== "CLOSED",
    "发布者可以重新开放已关闭的问题",
    `status=${reopened.data?.status}`,
  );

  // ---------- 11) 楼层删除：作者删自己的；发布者删任意 ----------
  const second = await call("POST", `${BASE}/questions/${publicId}/replies`, C, {
    content: "这条由作者自己删除。",
  });
  const ownReply = (second.data?.messages || []).find(
    (item) => item.body === "这条由作者自己删除。",
  );
  assert(Boolean(ownReply?.id), "作者自己的发言可以删");
  const ownDelete = await call("DELETE", `${BASE}/replies/${ownReply?.id}`, C);
  assert(ownDelete.code === 0, "作者删除自己的发言成功", `code=${ownDelete.code}`);

  const third = await call("POST", `${BASE}/questions/${publicId}/replies`, C, {
    content: "这条由发布者删除。",
  });
  const otherReply = (third.data?.messages || []).find(
    (item) => item.body === "这条由发布者删除。",
  );
  const posterDelete = await call("DELETE", `${BASE}/replies/${otherReply?.id}`, A);
  assert(
    posterDelete.code === 0,
    "发布者可以删除别人的发言",
    `code=${posterDelete.code}`,
  );

  // ---------- 12) 通知 ----------
  const notices = await call("GET", "/enterprise/notifications?page=1&pageSize=20&category=question", C);
  assert(
    notices.code === 0 && (notices.data?.list || []).length > 0,
    "被回复的人收到「专题大厅」系统消息",
    `count=${notices.data?.list?.length || 0}`,
  );

  // ---------- 13) 删除问题 ----------
  const removed = await call("DELETE", `${BASE}/questions/${publicId}`, A);
  assert(removed.code === 0, "发布者删除问题成功", `code=${removed.code}`);
  const afterDelete = await detailOf(publicId, A);
  assert(afterDelete.code !== 0, "删除后问题不再可见", `code=${afterDelete.code}`);
} finally {
  if (personaId) {
    await call("DELETE", `${PERSONAS}/${personaId}`, A).catch(() => undefined);
  }
  if (createdQuestions.length) {
    try {
      const prisma = createPrisma();
      const ids = createdQuestions.filter(Boolean);
      await prisma.questionHallMessage.deleteMany({
        where: { questionId: { in: ids } },
      });
      await prisma.questionHallSummary.deleteMany({
        where: { questionId: { in: ids } },
      });
      await prisma.questionHallQuestion.deleteMany({ where: { id: { in: ids } } });
      await prisma.$disconnect();
    } catch (error) {
      console.log(`（收尾硬删失败：${error?.message || error}）`);
    }
  }
}

// ---------- 收尾：验证数据已清理 ----------
const leftover = await call(
  "GET",
  `${BASE}/questions?page=1&pageSize=50&keyword=${encodeURIComponent("验证·")}`,
  A,
);
assert(
  leftover.code === 0 &&
    !(leftover.data?.list || []).some(
      (item) => item.title === ENTERPRISE_TITLE || item.title === PUBLIC_TITLE,
    ),
  "本次验证的问题已清理",
);

const { passed, failed } = suite.counts();
console.log(`\n${suite.summary()}`);
if (failed) process.exitCode = 1;
else console.log(`共 ${passed} 项断言全部通过`);