import { assertChannelOff } from "./regression-guard.mjs";
import { createSuite } from "./harness.mjs";

const suite = createSuite({ okLabel: "OK" });
const BASE = suite.base;
const { users, api, log, assert } = suite;
// 通道隔离护栏：本地回归不许打在会真写 AIworkin 正式平台的实例上
await assertChannelOff(BASE);

(async () => {
  console.log("1. login / me");
  const health = await api("GET", "/health");
  assert(health.data?.code === 0, "health");
  const me = await api("GET", "/enterprise/me", null, "demo_enterprise");
  assert(me.data?.code === 0 && me.data.data.userId === users.demo_enterprise.userId, "enterprise me");
  const admin = await api("GET", "/enterprise/me", null, "admin");
  assert(admin.data?.data?.roles?.includes("PLATFORM_ADMIN"), "admin role");

  console.log("2. enterprise submit");
  // 前置状态先查清：档案已同步（APPROVED）时再提交必然 409——据此断言唯一期望值
  const preMe = await api("GET", "/enterprise/me", null, "demo_user");
  const preApproved = preMe.data?.data?.enterprise?.status === "APPROVED";
  const fresh = await api("POST", "/enterprise/identity/enterprise", {
    name: "E2E贸易",
    uscc: `9131E2E${Date.now()}`,
    // 所在省、市为提交必填（条目 69）；缺它会被必填校验先拦下，测不到本条要测的重复提交口径
    province: "浙江省",
    city: "杭州市",
  }, "demo_user");
  assert(
    fresh.data?.code === (preApproved ? 409 : 0),
    preApproved ? "enterprise resubmit rejected (already synced)" : "enterprise submitted",
    fresh.data?.message,
  );

  console.log("3. provider apply + admin audit");
  const preTypes = new Set(
    (preMe.data?.data?.providerApps || [])
      .filter((item) => ["PENDING", "APPROVED"].includes(item.status))
      .map((item) => item.providerType),
  );
  const apply = await api("POST", "/enterprise/identity/provider-application", {
    provider_types: ["TAX_FINANCE"],
    org_name: "E2E服务商",
    uscc: "91310000E2E000001",
    contact_name: "王五",
    contact_phone: "13800009999",
    contact_email: "e2e@demo.local",
    intro: "e2e intro",
    province: "浙江省",
    city: "杭州市",
  }, "demo_user");
  assert(
    apply.data?.code === (preTypes.has("TAX_FINANCE") ? 409 : 0),
    preTypes.has("TAX_FINANCE")
      ? "provider apply rejected (already submitted)"
      : "provider applied",
    apply.data?.message,
  );
  if (apply.data?.data?.id) {
    const audit = await api("POST", `/enterprise/admin/provider-applications/${apply.data.data.id}/audit`, {
      action: "APPROVE",
    }, "admin");
    assert(audit.data?.data?.status === "APPROVED", "admin approve");
  } else {
    const pending = await api("GET", "/enterprise/admin/provider-applications?status=PENDING", null, "admin");
    const row = (pending.data?.data || []).find((item) => item.orgName === "E2E服务商");
    if (row) {
      const audit = await api("POST", `/enterprise/admin/provider-applications/${row.id}/audit`, {
        action: "APPROVE",
      }, "admin");
      assert(audit.data?.data?.status === "APPROVED", "admin approve (existing)");
    } else {
      // 没有待审记录只应有两种解释：已审通过 / 已审驳回——都必须真查一次状态
      const all = await api("GET", "/enterprise/admin/provider-applications", null, "admin");
      const row = (all.data?.data || []).find((item) => item.orgName === "E2E服务商");
      assert(
        row?.status === "APPROVED",
        "admin approve (existing already approved)",
        row ? `E2E服务商 status=${row.status}` : "E2E服务商 备案记录缺失",
      );
    }
  }

  console.log("4. contracts");
  const list = await api("GET", "/enterprise/contracts/options", null, "demo_enterprise");
  const mineRows = list.data?.data || [];
  assert(Array.isArray(list.data?.data), "contract list");
  const taxRows = mineRows.filter(
    (item) => item.serviceType === "TAX_FINANCE" && ["PENDING", "ACTIVE"].includes(item.status),
  );
  const taxDup = taxRows.some((item) => item.providerUserId === users.demo_tax2.userId);
  const created = await api("POST", "/enterprise/contracts", {
    providerUserId: users.demo_tax2.userId,
    service_type: "TAX_FINANCE",
  }, "demo_enterprise");
  if (taxDup) {
    // 同服务商同分类重复发起：冲突提示应指向「已与该服务商存在签约」
    assert(
      created.data?.code === 409 && /已与该服务商存在/.test(created.data?.message || ""),
      "same provider duplicate contract blocked",
      created.data?.message,
    );
  } else if (taxRows.length) {
    // 财税独占：该分类已被其他服务商占用，第二条必须 409
    assert(
      created.data?.code === 409 && /解约后才能再次发起/.test(created.data?.message || ""),
      "exclusive tax category blocks a second provider",
      created.data?.message,
    );
  } else {
    assert(created.data?.code === 0 && !!created.data?.data?.id, "contract created", created.data?.message);
  }
  if (!taxDup && !taxRows.length && created.data?.data?.id) {
    // 只有本次真建出来的待确认签约才由发起方服务商确认（别人的 / 历史的不碰）
    const confirm = await api(
      "POST",
      `/enterprise/contracts/${created.data.data.id}/confirm`,
      {},
      "demo_tax2",
    );
    assert(confirm.data?.code === 0, "provider confirms own contract", confirm.data?.message);
  }

  console.log("5. tax");
  // 承办职员（中瑞财税 × 杭州智造 = demo_staff2）推进 AI 汇总 → 7 项核对 → 外报回填 → 扣款
  const ADVISOR = "demo_staff2";
  const decl = await api("POST", "/enterprise/tax/declarations", {
    tax_type: "vat_general",
    period: "2026-Q3",
    form_data: { output_tax: 1000, input_tax: 200 },
  }, "demo_provider");
  assert(decl.data?.code === 0, "create decl", decl.data?.message);
  if (decl.data?.data?.id) {
    await api("POST", `/enterprise/tax/declarations/${decl.data.data.id}/run-ai`, {}, ADVISOR);
    const qc = await api("POST", `/enterprise/tax/declarations/${decl.data.data.id}/qc`, {
      action: "PASS",
      confirms: ["纳税人信息", "所属期", "销售额/收入", "税额计算", "减免优惠", "附件齐全", "签署确认"],
    }, ADVISOR);
    assert(qc.data?.code === 0, "tax qc by advisor", qc.data?.message);
    const submissionId = qc.data?.data?.external_submission_id;
    assert(!!submissionId, "tax qc generates external submission", qc.data?.message);
    const invisible = submissionId
      ? await api("GET", `/enterprise/external/submissions/${submissionId}`, null, "demo_provider")
      : null;
    if (submissionId) {
      assert(
        invisible.status === 403,
        "external submission hidden from non-assigned provider",
        invisible.data?.message,
      );
      const submitted = await api("POST", `/enterprise/external/submissions/${submissionId}/submit`, {
        acceptNo: "3301E2E2026Q3",
      }, ADVISOR);
      assert(submitted.data?.code === 0, "external submit", submitted.data?.message);
      const receipt = await api("POST", `/enterprise/external/submissions/${submissionId}/receipt`, {
        receiptNo: "E2E-RECEIPT-0001",
      }, ADVISOR);
      assert(receipt.data?.code === 0, "external receipt", receipt.data?.message);
      const pay = await api("POST", `/enterprise/tax/declarations/${decl.data.data.id}/pay`, {}, ADVISOR);
      assert(pay.data?.data?.status === "PAID", "tax pay", pay.data?.message);
    }

    // 申报单按单号直达：列表仍按承办人口径（该单已指派周凯，服务商账号列表里没有），
    // 但该单所属服务商账号可只读打开——「申报计划 → 查看申报单」不再误报「缺少申报单号」
    const providerDecls = await api("GET", "/enterprise/tax/declarations", null, "demo_provider");
    assert(
      !(providerDecls.data?.data || []).some((item) => item.id === decl.data.data.id),
      "declaration list stays 承办人-scoped (assigned provider account excluded)",
    );
    const declById = await api("GET", `/enterprise/tax/declarations/${decl.data.data.id}`, null, "demo_provider");
    assert(
      declById.data?.code === 0 && declById.data.data.id === decl.data.data.id,
      "provider opens own declaration by id (read-only)",
      declById.data?.message,
    );
    const declWrite = await api("POST", `/enterprise/tax/declarations/${decl.data.data.id}/contacts`, {
      contact_phone: "13000000000",
    }, "demo_provider");
    assert(
      declWrite.status === 403 && declWrite.data?.code === 20002,
      "provider cannot write declaration assigned to staff",
      declWrite.data?.message,
    );
    const declOutsider = await api("GET", `/enterprise/tax/declarations/${decl.data.data.id}`, null, "demo_tax2");
    assert(
      declOutsider.status === 403 && declOutsider.data?.code === 20002,
      "unrelated provider cannot read declaration",
      declOutsider.data?.message,
    );
  }

  console.log("6. overseas");
  const claim = await api("POST", "/enterprise/overseas", {
    service_type: "EXPORT_REFUND",
    title: "出口退税 e2e",
  }, "demo_enterprise");
  assert(claim.data?.code === 0, "overseas create", claim.data?.message);

  console.log("7. logistics");
  const order = await api("POST", "/enterprise/logistics", { title: "e2e 物流" }, "demo_enterprise");
  assert(order.data?.code === 0, "logistics create");
  if (order.data?.data?.status === "OPEN") {
    const accept = await api("POST", `/enterprise/logistics/${order.data.data.id}/accept`, {}, "demo_logistics2");
    assert(accept.data?.data?.status === "PENDING", "logistics accept");
  }

  console.log("8. tax consult / account set");
  const consult = await api("POST", "/enterprise/tax/consultations", { question: "怎么报税" }, "demo_enterprise");
  assert(consult.data?.code === 0, "consultation");

  console.log("9. legal");
  const legal = await api("POST", "/enterprise/legal/requests", { title: "合同审查" }, "demo_enterprise");
  assert(legal.data?.code === 0, "legal request", legal.data?.message);
  if (legal.data?.data?.id) {
    const pub = await api("POST", `/enterprise/legal/requests/${legal.data.data.id}/publish`, {}, "demo_enterprise");
    // 本套件通道恒关（assertChannelOff）：发布按本地留痕收口 SKIPPED，
    // tip 必须为空串 —— 规则 73 起界面不再展示通道状态类文案，接口也不得回流该文案
    assert(
      pub.data?.code === 0 &&
        pub.data?.data?.aiworkin_sync_status === "SKIPPED" &&
        pub.data?.data?.aiworkinPublished === 0 &&
        pub.data?.data?.tip === "",
      "legal publish falls back to local-only when channel is off",
      JSON.stringify(pub.data?.data ?? pub.data?.message),
    );
  }

  console.log("10. ip");
  const ip = await api("POST", "/enterprise/ip/requests", { title: "商标注册" }, "demo_enterprise");
  assert(ip.data?.code === 0, "ip request", ip.data?.message);

  console.log("11. flex");
  const wo = await api("POST", "/enterprise/flex/work-orders", {
    title: "电商大促临时打包工",
    work_type: "PARTTIME",
    description: "双十一大促期间仓库打包分拣，需连续到岗 15 天",
    tags: "大促,临时用工",
    expected_result: "完成大促期仓库打包分拣任务",
    must_conditions: "有仓库理货经验",
    expect_start: "2026-11-01",
    deadline: "2026-11-15",
    region_scope: "杭州",
    budget: "260 元/天",
    contact_name: "张老师",
    contact_phone: "13800000000",
    contact_wechat: "zhang-laoshi",
    contact_email: "zhang@example.com",
    email_sync: "1",
  }, "demo_enterprise");
  assert(wo.data?.code === 0, "flex work order", wo.data?.message);
  if (wo.data?.data?.id) {
    const list = await api("GET", "/enterprise/flex/work-orders", null, "demo_enterprise");
    const row = (list.data?.data || []).find((item) => item.id === wo.data.data.id);
    assert(
      row?.description === "双十一大促期间仓库打包分拣，需连续到岗 15 天" &&
        row?.regionScope === "杭州" &&
        row?.contactEmail === "zhang@example.com" &&
        row?.emailSync === 1,
      "flex work order demand fields round-trip",
      row ? JSON.stringify({ regionScope: row.regionScope, emailSync: row.emailSync }) : "row not found",
    );
  }
  const material = await api("POST", "/enterprise/flex/onboardings/attachments", {
    files: [{
      name: "营业执照-正本.png",
      size: 89,
      contentType: "image/png",
      contentBase64: "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=",
    }],
  }, "demo_enterprise");
  const materialFile = material.data?.data?.files?.[0];
  const ossUnconfigured = /文件存储未配置凭据/.test(material.data?.message || "");
  if (ossUnconfigured) {
    console.log("SKIP flex onboarding material upload to OSS — 未配置 OSS 凭据");
  } else {
    assert(
      material.data?.code === 0 && !!materialFile?.url?.startsWith("https://"),
      "flex onboarding material upload to OSS",
      materialFile ? `${materialFile.name} ${materialFile.url}` : material.data?.message,
    );
  }
  const materialDenied = await api("POST", "/enterprise/flex/onboardings/attachments", {
    files: [{ name: "x.png", contentType: "image/png", contentBase64: "aGk=" }],
  }, "demo_agent");
  assert(
    materialDenied.data?.code === 20002,
    "flex onboarding material upload restricted to enterprise",
    materialDenied.data?.message,
  );
  const materialEmpty = await api("POST", "/enterprise/flex/onboardings/attachments", {
    files: [],
  }, "demo_enterprise");
  assert(materialEmpty.data?.code === 400, "flex onboarding material requires files", materialEmpty.data?.message);
  // 同一企业同一服务商已有待审进件时创建必然 409——先查前置状态再断言
  const preContracts = await api("GET", "/enterprise/contracts/options", null, "demo_enterprise");
  const flexProviderId = (preContracts.data?.data || []).find(
    (item) => item.serviceType === "FLEX_WORK" && item.status === "ACTIVE",
  )?.providerUserId;
  const preOnboardings = await api("GET", "/enterprise/flex/onboardings", null, "demo_enterprise");
  const prePendingOnboarding = (preOnboardings.data?.data || []).some(
    (item) => item.status === "SUBMITTED" && item.providerUserId === flexProviderId,
  );
  const onboard = await api("POST", "/enterprise/flex/onboardings", {
    form: { company: "杭州智造", scene: "制造业用工场景说明超过三十个字用于校验" },
    attachments: [{
      key: "license",
      name: "营业执照照片",
      requirement: "营业执照照片清晰完整、在有效期内",
      ready: true,
      files: materialFile ? [materialFile] : [],
    }],
  }, "demo_enterprise");
  assert(
    onboard.data?.code === (prePendingOnboarding ? 409 : 0),
    prePendingOnboarding ? "flex onboarding rejected (pending review)" : "flex onboarding created",
    onboard.data?.message,
  );
  let onboardingId = onboard.data?.data?.id || 0;
  if (onboardingId && materialFile) {
    const list = await api("GET", "/enterprise/flex/onboardings", null, "demo_enterprise");
    const row = (list.data?.data || []).find((item) => item.id === onboardingId);
    const saved = (row?.attachments || []).find((item) => item.key === "license");
    assert(
      saved?.ready === true && saved?.files?.[0]?.url === materialFile.url,
      "flex onboarding attachments persist uploaded files",
      saved ? `${saved.files?.length} file(s)` : "license item missing",
    );
  } else if (ossUnconfigured) {
    console.log("SKIP flex onboarding attachments persist uploaded files — 未配置 OSS 凭据");
  } else {
    assert(
      false,
      "flex onboarding attachments persist uploaded files",
      materialFile ? "新建进件未返回 id，无法校验归档" : "材料上传失败，无法校验归档",
    );
  }
  if (!onboardingId) {
    const list = await api("GET", "/enterprise/flex/onboardings", null, "demo_agent");
    onboardingId =
      ((list.data?.data || []).find((item) => item.status === "SUBMITTED") || {}).id || 0;
  }
  if (onboardingId) {
    const audit = await api("POST", `/enterprise/flex/onboardings/${onboardingId}/audit`, {
      action: "APPROVE",
      note: "资料齐全，审核通过",
    }, "demo_agent");
    assert(audit.data?.data?.status === "APPROVED", "flex onboarding audit", audit.data?.message);
  } else {
    assert(false, "flex onboarding audit", "没有待审核进件（新建进件未成功且无历史待审）");
  }

  console.log("12. openapi");
  const key = await api("POST", "/enterprise/api-keys", {}, "demo_enterprise");
  assert(!!key.data?.data?.plainKey, "api key created");
  const open = await fetch(`${BASE}/api/v1/users/me`, {
    headers: { "X-Api-Key": key.data.data.plainKey },
  }).then((res) => res.json());
  assert(open.code === 0, "openapi me by key");

  console.log("13. admin stats");
  const stats = await api("GET", "/enterprise/admin/stats", null, "admin");
  assert(stats.data?.code === 0, "admin stats");

  console.log("14. tax trial record");
  const trial = await api("POST", "/enterprise/tax/trial", {
    tax_type: "vat_small",
    form: { taxable_sales: 100000 },
  }, "demo_enterprise");
  // 小规模增值税＝销售额 × 1%（backend/src/tax/tax-forms.ts），100000 → 1000
  assert(
    trial.data?.data?.tax_amount === 1000,
    "trial calc",
    `tax_amount=${trial.data?.data?.tax_amount} (${trial.data?.message})`,
  );

  console.log("15-16. directories");
  const taxProviders = await api("GET", "/enterprise/tax/providers", null, "demo_enterprise");
  assert(Array.isArray(taxProviders.data?.data), "tax providers");
  const catalog = await api("GET", "/enterprise/overseas/catalog", null, "demo_enterprise");
  assert(Array.isArray(catalog.data?.data), "overseas catalog");

  console.log("17. lawyers");
  const lawyers = await api("GET", "/enterprise/legal/lawyers", null, "demo_enterprise");
  assert(Array.isArray(lawyers.data?.data), "lawyers");

  console.log("18. flex providers + payroll（灵工发薪板块开关，默认启用）");
  const flex = await api("GET", "/enterprise/flex/providers", null, "demo_enterprise");
  assert(Array.isArray(flex.data?.data), "flex providers");
  const payrollBody = {
    period: "2026-09",
    employees: [{ name: "张三", id_no: "330101199001011111", amount: 3000 }],
  };
  // 前置状态由脚本显式设成「停用」再断言：停用态下接口必须拒绝
  const off = await api("POST", "/enterprise/admin/flex-payroll", { enabled: false }, "admin");
  assert(off.data?.data?.enabled === false, "flex payroll switch off");
  const blocked = await api("POST", "/enterprise/flex/payrolls", payrollBody, "demo_enterprise");
  assert(blocked.data?.code === 20002, "payroll create rejected while disabled", blocked.data?.message);
  const blockedList = await api("GET", "/enterprise/flex/payrolls", null, "demo_enterprise");
  assert(blockedList.data?.code === 20002, "payroll list rejected while disabled", blockedList.data?.message);
  // 平台管理员启用后，企业才能新建发薪
  const on = await api("POST", "/enterprise/admin/flex-payroll", { enabled: true }, "admin");
  assert(on.data?.data?.enabled === true, "flex payroll switch on");
  const pay = await api("POST", "/enterprise/flex/payrolls", payrollBody, "demo_enterprise");
  assert(pay.data?.code === 0, "payroll", pay.data?.message);
  // 跑完回归仓库默认态（默认启用），不留副作用
  const reset = await api("POST", "/enterprise/admin/flex-payroll", { enabled: true }, "admin");
  assert(reset.data?.data?.enabled === true, "flex payroll switch restored to default");

  console.log("19. contacts required");
  // 细项已勾全，让唯一失败点落在「联系人/邮箱缺失」上（校验顺序：联系方式先于细项）
  const bad = await api("POST", "/enterprise/identity/provider-application", {
    provider_types: ["LOGISTICS"],
    service_items: { LOGISTICS: ["DOMESTIC_LAND", "CROSS_BORDER_FORWARDER"] },
    org_name: "缺邮箱",
    uscc: "91310000BAD000001",
  }, "demo_user");
  assert(
    bad.data?.code === 400 && String(bad.data?.message || "").includes("必填"),
    "email required",
    bad.data?.message,
  );

  console.log("20. exclusive category");
  const taxOccupied = (list.data?.data || []).some(
    (item) =>
      item.serviceType === "TAX_FINANCE" &&
      ["PENDING", "ACTIVE"].includes(item.status) &&
      item.providerUserId !== users.demo_tax3.userId,
  );
  const dup = await api("POST", "/enterprise/contracts", {
    providerUserId: users.demo_tax3.userId,
    service_type: "TAX_FINANCE",
  }, "demo_enterprise");
  if (taxOccupied) {
    assert(dup.data?.code === 409, "exclusive tax category blocks a second provider", dup.data?.message);
  } else {
    assert(dup.data?.code === 0, "no occupying tax contract → second provider allowed", dup.data?.message);
  }

  console.log("21. logistics conversations（规则 67：查看消息＝回复方会话清单）");
  const orders = await api("GET", "/enterprise/logistics", null, "demo_enterprise");
  assert(orders.data?.code === 0, "logistics list", orders.data?.message);
  const first = (orders.data?.data || [])[0];
  assert(!!first?.id, "logistics has a demand to read conversations from");
  const msgs = await api("GET", `/enterprise/logistics/${first.id}/messages`, null, "demo_enterprise");
  assert(msgs.data?.code === 0, "logistics conversations", msgs.data?.message);
  const conversations = msgs.data?.data?.conversations;
  assert(Array.isArray(conversations), "logistics conversations is an array");
  assert(
    conversations.every((c) => Array.isArray(c.messages) && !!c.id && !!c.name),
    "each logistics conversation carries id/name/messages",
    JSON.stringify(conversations.map((c) => ({ id: c?.id, name: c?.name, n: (c?.messages || []).length }))),
  );
  assert(
    ["AIWORKIN", "LOCAL"].includes(msgs.data?.data?.source),
    "logistics conversations source",
    String(msgs.data?.data?.source),
  );
  // 本地台账切分时需求方本人会话必在（source=LOCAL）；平台侧会话由接口决定条数，只要求清单是数组
  if (msgs.data?.data?.source === "LOCAL") {
    assert(
      conversations.some((c) => c.id === "local-lead"),
      "local conversations include the requester's own thread",
      conversations.map((c) => c.id).join(","),
    );
  }

  console.log("22. staff bind search");
  const search = await api("GET", "/enterprise/staff/search?q=吴桐", null, "demo_provider");
  assert(search.data?.code === 0, "staff search");

  console.log("23. marketing");
  const mkt = await api("POST", "/enterprise/marketing", { title: "探店 e2e", order_type: "VISIT" }, "demo_enterprise");
  assert(mkt.data?.code === 0, "marketing create");

  console.log("24. oss settings");
  const settings = await api("GET", "/enterprise/admin/settings", null, "admin");
  assert(settings.data?.code === 0, "settings");

  console.log("25. designate staff");
  const contracts = (list.data?.data || []).filter((item) => item.serviceType === "TAX_FINANCE" && item.status === "ACTIVE");
  const staffName = contracts[0]?.business_staff?.[0]?.name;
  if (contracts[0] && staffName) {
    // 只能指定服务商「职员/代理人管理」里已绑定生效的职员（按类目角色过滤），不读备案名录
    const des = await api("POST", `/enterprise/contracts/${contracts[0].id}/designate-staff`, {
      staff_name: staffName,
    }, "demo_provider");
    assert(des.data?.code === 0 && des.data?.data?.designated_staff?.name === staffName, "designate staff");
  } else {
    // 跳过只允许有一种解释：没有「生效中财税签约 + 已绑定对接人」可指派
    assert(
      contracts.every((item) => !(item.business_staff || []).length),
      "designate staff",
      contracts.length
        ? "有生效财税签约且对接人名单非空，却未执行指定"
        : "无生效财税签约，无法校验指定业务人员",
    );
  }

  console.log("26. personal micro");
  const myApps = await api("GET", "/enterprise/identity/provider-application", null, "demo_user");
  // 前置状态必须先读成功，否则「未提交 → 期望 0」会掩盖真实的读接口故障
  assert(myApps.data?.code === 0, "personal provider applications readable", myApps.data?.message);
  const microSubmitted = (myApps.data?.data?.items || []).some(
    (item) => item.providerType === "MICRO" && ["PENDING", "APPROVED"].includes(item.status),
  );
  const personal = await api("POST", "/enterprise/identity/provider-application", {
    provider_types: ["MICRO"],
    service_items: { MICRO: ["DOMESTIC_LAND", "CROSS_BORDER_FORWARDER"] },
    subject_type: "PERSONAL",
    org_name: "个人小微",
    id_card: "33010619900101123X",
    contact_name: "陈飞",
    contact_phone: "13800000003",
    contact_email: "fe@demo.local",
    intro: "个人主体小微",
    province: "浙江省",
    city: "杭州市",
  }, "demo_user");
  assert(
    microSubmitted ? personal.data?.code === 409 : personal.data?.code === 0,
    microSubmitted ? "personal micro re-submit blocked" : "personal micro submitted",
    personal.data?.message,
  );

  console.log("27. account set + plans");
  const set = await api("POST", "/enterprise/tax/account-sets", { name: "E2E 申报账套" }, "demo_provider");
  assert(set.data?.code === 0, "account set", set.data?.message);
  const plans = await api("POST", "/enterprise/tax/plans/generate", {}, "demo_provider");
  assert(plans.data?.code === 0, "plans generated", plans.data?.message);
  const planList = await api("GET", "/enterprise/tax/plans", null, "demo_provider");
  assert(Array.isArray(planList.data?.data?.list) && typeof planList.data?.data?.total === "number", "plan list pagination");

  console.log("28. supply network");
  const stationList = await api("GET", "/enterprise/supply/stations", null, "demo_supply");
  let station = (stationList.data?.data || []).find((item) => item.status === "ACTIVE");
  if (!station) {
    const made = await api("POST", "/enterprise/supply/stations", {
      name: "E2E 供销服务站",
      region: "浙江 杭州",
      address: "杭州市余杭区 e2e 路 1 号",
      contact_name: "吴桐",
      contact_phone: "13800001111",
    }, "demo_supply");
    station = made.data?.data;
  }
  assert(!!station?.id, "supply station ready", station?.name);

  const productList = await api("GET", "/enterprise/supply/products?all=1", null, "demo_supply");
  let product = (productList.data?.data || []).find(
    (item) => item.status === "ONLINE" && (item.skus || []).length,
  );
  if (!product) {
    const made = await api("POST", "/enterprise/supply/products", {
      name: "E2E 供销商品",
      category: "农资",
      unit: "袋",
      station_ids: [station.id],
      status: "ONLINE",
    }, "demo_supply");
    product = made.data?.data;
    if (product?.id) {
      const sku = await api("POST", `/enterprise/supply/products/${product.id}/skus`, {
        spec_name: "E2E 规格 25kg",
        supply_price: 100,
        unit: "袋",
        scene: "e2e 场景",
      }, "demo_supply");
      product.skus = sku.data?.data ? [sku.data.data] : [];
    }
  }
  const sku = (product?.skus || [])[0];
  assert(!!sku?.id && Number(sku.supplyPrice) > 0, "product price is spec-based", `sku=${sku?.specName} ¥${sku?.supplyPrice}`);

  // 联系方式（需求 §三）：下单带企业联系人，报价带服务商联系人，便于双方商务磋商
  const noContactOrder = await api("POST", "/enterprise/supply/orders", {
    station_id: station.id,
    expected_date: "2026-11-30",
    items: [{ product_id: product.id, sku_id: sku.id, quantity: 1 }],
  }, "demo_enterprise");
  assert(
    noContactOrder.data?.code === 400 && /联系人/.test(noContactOrder.data?.message || ""),
    "order without contact rejected",
    noContactOrder.data?.message,
  );

  const orderRes = await api("POST", "/enterprise/supply/orders", {
    station_id: station.id,
    expected_date: "2026-11-30",
    remark: "e2e 订货",
    contact_name: "张老师",
    contact_phone: "13800000000",
    items: [{ product_id: product.id, sku_id: sku.id, quantity: 3 }],
  }, "demo_enterprise");
  assert(
    orderRes.data?.code === 0 && orderRes.data?.data?.status === "SUBMITTED",
    "supply order submitted",
    orderRes.data?.message,
  );
  const orderId = orderRes.data?.data?.id;

  const noSpec = await api("POST", "/enterprise/supply/orders", {
    station_id: station.id,
    expected_date: "2026-11-30",
    contact_name: "张老师",
    contact_phone: "13800000000",
    items: [{ product_id: product.id, quantity: 1 }],
  }, "demo_enterprise");
  assert(
    noSpec.data?.code === 400 && /规格/.test(noSpec.data?.message || ""),
    "order without spec rejected",
    noSpec.data?.message,
  );

  const noContactQuote = await api("POST", `/enterprise/supply/orders/${orderId}/quote`, {
    promised_ship_date: "2026-11-20",
    other_fees: [{ name: "运费", amount: 50 }],
  }, "demo_supply");
  assert(
    noContactQuote.data?.code === 400 && /联系人/.test(noContactQuote.data?.message || ""),
    "quote without provider contact rejected",
    noContactQuote.data?.message,
  );

  const quote = await api("POST", `/enterprise/supply/orders/${orderId}/quote`, {
    promised_ship_date: "2026-11-20",
    quote_note: "价格含税，运费另计",
    provider_contact_name: "李经理",
    provider_contact_phone: "13900000000",
    other_fees: [{ name: "运费", amount: 50, note: "按实际车次" }],
  }, "demo_supply");
  assert(
    quote.data?.data?.status === "QUOTED" && Number(quote.data?.data?.total_amount) === Number(sku.supplyPrice) * 3 + 50,
    "order quoted with free-text fee",
    quote.data?.message,
  );
  const orderList = await api("GET", "/enterprise/supply/orders", null, "demo_enterprise");
  const orderRow = (orderList.data?.data || []).find((item) => item.id === orderId);
  assert(
    orderRow?.contactName === "张老师" &&
      orderRow?.contactPhone === "13800000000" &&
      orderRow?.providerContactName === "李经理" &&
      orderRow?.providerContactPhone === "13900000000",
    "order list exposes both sides' contacts",
    `c=${orderRow?.contactName}/${orderRow?.contactPhone} p=${orderRow?.providerContactName}/${orderRow?.providerContactPhone}`,
  );
  const foreign = await api("POST", `/enterprise/supply/orders/${orderId}/quote`, {}, "demo_tax2");
  assert(
    foreign.data?.code === 20002,
    "quote denied for unrelated provider",
    foreign.data?.message,
  );
  const orderConfirmed = await api("POST", `/enterprise/supply/orders/${orderId}/confirm`, {
    note: "e2e 确认报价",
  }, "demo_enterprise");
  assert(orderConfirmed.data?.data?.status === "ACTIVE", "order confirmed", orderConfirmed.data?.message);
  const orderLogs = await api("GET", `/enterprise/supply/orders/${orderId}/logs`, null, "demo_enterprise");
  // 下单 SUBMIT + 报价 QUOTE + 确认 CONFIRM ＝恰好 3 条（被拒的无联系人报价不留痕）
  assert(
    (orderLogs.data?.data || []).length === 3,
    "order logs recorded",
    `logs=${(orderLogs.data?.data || []).length}:${(orderLogs.data?.data || []).map((l) => l.action).join(",")}`,
  );

  const serviceList = await api("GET", "/enterprise/supply/services?all=1", null, "demo_supply");
  let service = (serviceList.data?.data || []).find((item) => item.status === "ONLINE");
  if (!service) {
    // 没有在线服务就现场建一个：预约流程必须每次真跑，不允许「无服务」静默跳过
    const madeService = await api("POST", "/enterprise/supply/services", {
      name: "E2E 农机服务",
      station_id: station.id,
      price_unit: "次",
      base_price: 1200,
      status: "ONLINE",
    }, "demo_supply");
    service = madeService.data?.data;
    assert(!!service?.id, "supply service ready", madeService.data?.message);
  }
  if (service) {
    const noContactBooking = await api("POST", "/enterprise/supply/bookings", {
      service_id: service.id,
      plan_date: "2026-11-25",
      site_address: "杭州市余杭区 e2e 田块",
    }, "demo_enterprise");
    assert(
      noContactBooking.data?.code === 400 && /联系人/.test(noContactBooking.data?.message || ""),
      "booking without contact rejected",
      noContactBooking.data?.message,
    );

    const booking = await api("POST", "/enterprise/supply/bookings", {
      service_id: service.id,
      plan_date: "2026-11-25",
      site_address: "杭州市余杭区 e2e 田块",
      scale: "120 亩",
      remark: "e2e 预约",
      contact_name: "张老师",
      contact_phone: "13800000000",
    }, "demo_enterprise");
    assert(booking.data?.code === 0, "supply booking created", booking.data?.message);
    const bookingId = booking.data?.data?.id;
    const bookingQuote = await api("POST", `/enterprise/supply/bookings/${bookingId}/quote`, {
      base_amount: 1200,
      quote_note: "含农机调度",
      provider_contact_name: "李经理",
      provider_contact_phone: "13900000000",
      other_fees: [{ name: "差旅费", amount: 200 }],
    }, "demo_supply");
    assert(
      bookingQuote.data?.data?.status === "QUOTED" && Number(bookingQuote.data?.data?.total_amount) === 1400,
      "booking quoted with free-text fee",
      bookingQuote.data?.message,
    );
    const bookingList = await api("GET", "/enterprise/supply/bookings", null, "demo_enterprise");
    const bookingRow = (bookingList.data?.data || []).find((item) => item.id === bookingId);
    assert(
      bookingRow?.contactName === "张老师" &&
        bookingRow?.providerContactName === "李经理" &&
        bookingRow?.providerContactPhone === "13900000000",
      "booking list exposes both sides' contacts",
      `c=${bookingRow?.contactName} p=${bookingRow?.providerContactName}/${bookingRow?.providerContactPhone}`,
    );
    const bookingConfirmed = await api("POST", `/enterprise/supply/bookings/${bookingId}/confirm`, {}, "demo_enterprise");
    assert(bookingConfirmed.data?.data?.status === "ACTIVE", "booking confirmed", bookingConfirmed.data?.message);
  } else {
    assert(false, "booking flow", "在线服务创建/查询失败，预约流程未执行");
  }

  console.log("29. supply admin overview + removed routes");
  const overview = await api("GET", "/enterprise/supply/admin/overview", null, "admin");
  assert(
    overview.data?.code === 0 &&
      Array.isArray(overview.data?.data?.station_stats) &&
      typeof overview.data?.data?.totals?.orders === "number",
    "admin supply overview",
    overview.data?.message,
  );
  const overviewDenied = await api("GET", "/enterprise/supply/admin/overview", null, "demo_enterprise");
  assert(
    overviewDenied.data?.code === 20002,
    "admin supply overview denied",
    overviewDenied.data?.message,
  );
  // 「供销网络总览」的服务商数＝有服务站的服务商去重数（口径 2026-09-24 用户裁定）
  const overviewTotals = overview.data?.data?.totals;
  const overviewStations = overview.data?.data?.station_stats ?? [];
  const distinctStationProviders = new Set(
    overviewStations.map((row) => row.provider_user_id),
  ).size;
  assert(
    overviewTotals?.providers === distinctStationProviders &&
      overviewTotals?.stations === overviewStations.length,
    "admin supply overview counts providers with stations",
    `providers=${overviewTotals?.providers} stations=${overviewTotals?.stations} distinct=${distinctStationProviders} rows=${overviewStations.length}`,
  );
  // 「服务商统计」栏目：一行一个服务商，站点数与站点清单对齐、∑站点数 = totals.stations
  const overviewProviderStats = overview.data?.data?.provider_stats ?? [];
  assert(
    overviewProviderStats.length === distinctStationProviders &&
      overviewProviderStats.every(
        (row) =>
          row.station_count ===
          overviewStations.filter(
            (station) => station.provider_user_id === row.provider_user_id,
          ).length,
      ) &&
      overviewProviderStats.reduce((acc, row) => acc + row.station_count, 0) ===
        overviewTotals?.stations,
    "admin supply overview exposes per-provider stats",
    `rows=${overviewProviderStats.length} distinct=${distinctStationProviders} sumStations=${overviewProviderStats.reduce((acc, row) => acc + row.station_count, 0)}`,
  );
  const feeItems = await api("GET", "/enterprise/supply/fee-items", null, "demo_supply");
  assert(feeItems.status === 404, "fee-items route removed", `status=${feeItems.status}`);

  console.log("30. 用户主体类型（企业 / 个体工商户 / 个人）");
  // 个体工商户：缺统一社会信用代码需被拦下（认证材料随主体类型改变）
  const noUscc = await api("POST", "/enterprise/identity/enterprise", {
    subject_type: "INDIVIDUAL",
    name: "个体户缺代码",
    province: "浙江省",
    city: "杭州市",
  }, "demo_personal");
  assert(
    noUscc.data?.code === 400 && /个体工商户/.test(noUscc.data?.message || ""),
    "individual requires uscc",
    noUscc.data?.message,
  );
  // 个人：缺身份证号需被拦下
  const noId = await api("POST", "/enterprise/identity/enterprise", {
    subject_type: "PERSONAL",
    name: "陈个人",
    province: "浙江省",
    city: "杭州市",
  }, "demo_personal");
  assert(
    noId.data?.code === 400 && /身份证/.test(noId.data?.message || ""),
    "personal requires id card",
    noId.data?.message,
  );
  const pPreMe = await api("GET", "/enterprise/me", null, "demo_personal");
  const pPreApproved = pPreMe.data?.data?.enterprise?.status === "APPROVED";
  const personalSubmit = await api("POST", "/enterprise/identity/enterprise", {
    subject_type: "PERSONAL",
    name: "陈个人",
    id_card: "33010619900101123X",
    province: "浙江省",
    city: "杭州市",
  }, "demo_personal");
  assert(
    personalSubmit.data?.code === (pPreApproved ? 409 : 0),
    pPreApproved ? "personal resubmit rejected (already synced)" : "personal submitted",
    personalSubmit.data?.message,
  );
  const iPreMe = await api("GET", "/enterprise/me", null, "demo_individual");
  const iPreApproved = iPreMe.data?.data?.enterprise?.status === "APPROVED";
  const individual = await api("POST", "/enterprise/identity/enterprise", {
    subject_type: "INDIVIDUAL",
    name: "陈记早点铺",
    uscc: "92330106E2E000002",
    province: "浙江省",
    city: "杭州市",
  }, "demo_individual");
  assert(
    individual.data?.code === (iPreApproved ? 409 : 0),
    iPreApproved ? "individual resubmit rejected (already synced)" : "individual submitted with uscc",
    individual.data?.message,
  );
  const ime = await api("GET", "/enterprise/me", null, "demo_individual");
  const iProfile = ime.data?.data?.enterprise || {};
  assert(
    iProfile.subjectType === "INDIVIDUAL" &&
      iProfile.uscc === "92330106E2E000002" &&
      iProfile.idCard === "",
    "individual profile is 字号 + uscc",
    JSON.stringify({ subjectType: iProfile.subjectType, uscc: iProfile.uscc }),
  );
  const iTax = await api("GET", "/enterprise/tax/declarations", null, "demo_individual");
  assert(
    iTax.data?.code === 0 && Array.isArray(iTax.data?.data),
    "individual allowed tax",
    iTax.data?.message,
  );
  const iOverseas = await api("GET", "/enterprise/overseas/catalog", null, "demo_individual");
  assert(
    iOverseas.data?.code === 0,
    "individual allowed overseas",
    iOverseas.data?.message,
  );
  const pme = await api("GET", "/enterprise/me", null, "demo_personal");
  const pProfile = pme.data?.data?.enterprise || {};
  assert(
    pProfile.subjectType === "PERSONAL" &&
      pProfile.uscc === "" &&
      pProfile.taxpayerType === "" &&
      /^\d{17}[\dX]$/.test(String(pProfile.idCard || "")),
    "personal profile is name + id card only",
    JSON.stringify({
      subjectType: pProfile.subjectType,
      uscc: pProfile.uscc,
      taxpayerType: pProfile.taxpayerType,
    }),
  );
  const pTax = await api("GET", "/enterprise/tax/declarations", null, "demo_personal");
  assert(
    pTax.data?.code === 20002,
    "personal blocked from tax",
    pTax.data?.message,
  );
  const pOverseas = await api("GET", "/enterprise/overseas", null, "demo_personal");
  assert(
    pOverseas.data?.code === 20002,
    "personal blocked from overseas",
    pOverseas.data?.message,
  );
  const pTaxContract = await api("POST", "/enterprise/contracts", {
    providerUserId: users.demo_tax4.userId,
    service_type: "TAX_FINANCE",
  }, "demo_personal");
  assert(
    pTaxContract.data?.code === 20002,
    "personal blocked from tax contract",
    pTaxContract.data?.message,
  );
  const pOverseasContract = await api("POST", "/enterprise/contracts", {
    providerUserId: users.demo_overseas3.userId,
    service_type: "SETTLEMENT",
  }, "demo_personal");
  assert(
    pOverseasContract.data?.code === 20002,
    "personal blocked from overseas contract",
    pOverseasContract.data?.message,
  );
  // 除财税/出海外的类目仍开放
  const pContracts = await api("GET", "/enterprise/contracts/options", null, "demo_personal");
  const pSupplyDup = (pContracts.data?.data || []).some(
    (item) =>
      item.providerUserId === users.demo_supply.userId &&
      item.serviceType === "SUPPLY_NETWORK" &&
      ["PENDING", "ACTIVE"].includes(item.status),
  );
  const pSupply = await api("POST", "/enterprise/contracts", {
    providerUserId: users.demo_supply.userId,
    service_type: "SUPPLY_NETWORK",
  }, "demo_personal");
  assert(
    pSupply.data?.code === (pSupplyDup ? 409 : 0),
    pSupplyDup
      ? "personal supply contract rejected (already exists)"
      : "personal still allowed other categories",
    pSupply.data?.message,
  );
  const pLogistics = await api("POST", "/enterprise/logistics", {
    title: "个人用户物流 e2e",
  }, "demo_personal");
  assert(
    pLogistics.data?.code === 0,
    "personal still allowed logistics",
    pLogistics.data?.message,
  );

  console.log("31. 各环节联系方式（系统自动带出 + 临时换人可改）");
  // 签约：双方联系方式按对应人档案带出
  const cList = await api("GET", "/enterprise/contracts/options", null, "demo_enterprise");
  const cRow = (cList.data?.data || []).find(
    (item) => item.serviceType === "LEGAL_SERVICE",
  );
  assert(
    !!cRow?.contactName && !!cRow?.contactPhone && !!cRow?.providerContactName,
    "contract carries both sides' contacts",
    `${cRow?.contractNo} 企业=${cRow?.contactName}/${cRow?.contactPhone} 服务商=${cRow?.providerContactName}/${cRow?.providerContactPhone}`,
  );

  // 法律需求：企业侧自动带出 + 临时换人改联系人
  const lReq = await api("POST", "/enterprise/legal/requests", {
    title: "e2e 联系方式带出",
    category: "CONSULT",
  }, "demo_enterprise");
  const lRow = lReq.data?.data || {};
  assert(
    !!lRow.contact_name && !!lRow.contact_phone,
    "legal request auto-fills enterprise contact",
    `企业=${lRow.contact_name}/${lRow.contact_phone} 执行=${lRow.provider_contact_name}/${lRow.provider_contact_phone}`,
  );
  const lEdit = await api("PATCH", `/enterprise/legal/requests/${lRow.id}`, {
    contact_name: "临时对接人张工",
    contact_phone: "13500001111",
  }, "demo_enterprise");
  assert(
    lEdit.data?.data?.contact_name === "临时对接人张工" &&
      lEdit.data?.data?.contact_phone === "13500001111",
    "legal request contact editable (temp handover)",
    JSON.stringify(lEdit.data?.data || lEdit.data?.message),
  );
  const lList = await api("GET", "/enterprise/legal/requests", null, "demo_enterprise");
  const lKept = (lList.data?.data || []).find((item) => item.id === lRow.id);
  assert(
    lKept?.contactName === "临时对接人张工" && lKept?.contactPhone === "13500001111",
    "edited contact persisted",
    `${lKept?.contactName}/${lKept?.contactPhone}`,
  );

  // 知产咨询：企业侧自动带出
  const ipReq = await api("POST", "/enterprise/ip/consultations", {
    title: "e2e 联系方式带出",
  }, "demo_enterprise");
  const ipRow = ipReq.data?.data || {};
  assert(
    !!ipRow.contact_name && !!ipRow.provider_contact_name,
    "ip request carries both sides' contacts",
    `企业=${ipRow.contact_name}/${ipRow.contact_phone} 执行=${ipRow.provider_contact_name}/${ipRow.provider_contact_phone}`,
  );

  // 物流：创建带出企业侧；接收后按接收人带出执行侧；推进时可临时换人
  const loReq = await api("POST", "/enterprise/logistics", {
    title: "e2e 联系方式带出",
  }, "demo_enterprise");
  const loId = loReq.data?.data?.id;
  const loList1 = await api("GET", "/enterprise/logistics", null, "demo_enterprise");
  const loNew = (loList1.data?.data || []).find((item) => item.id === loId);
  assert(
    !!loNew?.contactName && !!loNew?.contactPhone,
    "logistics order auto-fills shipper contact",
    `企业=${loNew?.contactName}/${loNew?.contactPhone}`,
  );
  if (loId) {
    await api("POST", `/enterprise/logistics/${loId}/accept`, {}, "demo_logistics");
    const loList2 = await api("GET", "/enterprise/logistics", null, "demo_logistics");
    const loAcc = (loList2.data?.data || []).find((item) => item.id === loId);
    assert(
      !!loAcc?.providerContactName,
      "logistics executor contact filled on accept",
      `执行=${loAcc?.providerContactName}/${loAcc?.providerContactPhone} 承办=${loAcc?.staffUserId}`,
    );
    const loAdv = await api("POST", `/enterprise/logistics/${loId}/advance`, {
      action: "PICKUP",
      text: "e2e 已揽收",
      provider_contact_name: "临时司机李师傅",
      provider_contact_phone: "13600002222",
    }, "demo_logistics");
    assert(
      loAdv.data?.data?.provider_contact_name === "临时司机李师傅" &&
        loAdv.data?.data?.provider_contact_phone === "13600002222" &&
        loAdv.data?.data?.contact_name === loAcc?.contactName,
      "logistics executor contact editable on advance (enterprise side kept)",
      JSON.stringify(loAdv.data?.data || loAdv.data?.message),
    );
  }

  // 营销：企业侧自动带出
  const mkReq = await api("POST", "/enterprise/marketing", {
    title: "e2e 联系方式带出",
    order_type: "VISIT",
  }, "demo_enterprise");
  const mkId = mkReq.data?.data?.id;
  const mkList = await api("GET", "/enterprise/marketing", null, "demo_enterprise");
  const mkRow = (mkList.data?.data || []).find((item) => item.id === mkId);
  assert(
    !!mkRow?.contactName && !!mkRow?.contactPhone,
    "marketing order auto-fills enterprise contact",
    `企业=${mkRow?.contactName}/${mkRow?.contactPhone}`,
  );

  // 开票：企业申请人 + 财税承办人
  const meForInv = await api("GET", "/enterprise/me", null, "demo_enterprise");
  const invEp = meForInv.data?.data?.enterprise || {};
  const invReq = await api("POST", "/enterprise/invoice-requests", {
    enterpriseId: invEp.id,
    buyerName: invEp.name,
    items: [{ goodsName: "服务费", quantity: 1, price: 100 }],
  }, "demo_enterprise");
  const invRow = invReq.data?.data || {};
  assert(
    !!invRow.contactName && !!invRow.providerContactName,
    "invoice request carries applicant + tax staff contacts",
    `企业=${invRow.contactName}/${invRow.contactPhone} 执行=${invRow.providerContactName}/${invRow.providerContactPhone}`,
  );

  // 财税申报单：企业侧 + 承办人 + 临时换人改联系方式
  const taxDecl = await api("POST", "/enterprise/tax/declarations", {
    tax_type: "vat_general",
    period: "2026-Q4",
    form_data: { output_tax: 1000, input_tax: 200 },
  }, "demo_provider");
  const taxId = taxDecl.data?.data?.id;
  const taxList = await api("GET", "/enterprise/tax/declarations", null, "demo_enterprise");
  const taxRow = (taxList.data?.data || []).find((item) => item.id === taxId);
  assert(
    !!taxRow?.contactName && !!taxRow?.providerContactName,
    "tax declaration carries both sides' contacts",
    `企业=${taxRow?.contactName}/${taxRow?.contactPhone} 执行=${taxRow?.providerContactName}/${taxRow?.providerContactPhone}`,
  );
  // 由该申报单的承办职员（或企业当事人）临时换人改联系方式
  const taxActor =
    Object.keys(users).find(
      (name) => users[name].userId === taxRow?.staffUserId,
    ) || "demo_enterprise";
  const taxEdit = await api("POST", `/enterprise/tax/declarations/${taxId}/contacts`, {
    provider_contact_name: "临时报税员王会",
    provider_contact_phone: "13700003333",
  }, taxActor);
  assert(
    taxEdit.data?.data?.provider_contact_name === "临时报税员王会" &&
      taxEdit.data?.data?.provider_contact_phone === "13700003333" &&
      taxEdit.data?.data?.contact_name === taxRow?.contactName,
    "tax declaration contact editable (temp handover, enterprise side kept)",
    `${taxActor} ${JSON.stringify(taxEdit.data?.data || taxEdit.data?.message)}`,
  );

  // 开票申请：临时换人改承办人联系方式
  const invEdit = await api("POST", `/enterprise/invoice-requests/${invRow.id}/contacts`, {
    contact_name: "临时申请人李会计",
    contact_phone: "13700004444",
  }, "demo_enterprise");
  assert(
    invEdit.data?.data?.contact_name === "临时申请人李会计" &&
      invEdit.data?.data?.provider_contact_name === invRow.providerContactName,
    "invoice request contact editable (temp handover)",
    JSON.stringify(invEdit.data?.data || invEdit.data?.message),
  );

  // 签约：临时换人改企业侧联系方式（服务商侧保持不变）
  if (cRow?.id) {
    const cEdit = await api("POST", `/enterprise/contracts/${cRow.id}/contacts`, {
      contact_name: "临时签约对接人赵经理",
      contact_phone: "13700005555",
    }, "demo_enterprise");
    assert(
      cEdit.data?.data?.contact_name === "临时签约对接人赵经理" &&
        cEdit.data?.data?.contact_phone === "13700005555" &&
        cEdit.data?.data?.provider_contact_name === cRow?.providerContactName,
      "contract contact editable (temp handover, provider side kept)",
      JSON.stringify(cEdit.data?.data || cEdit.data?.message),
    );
  }

  // 联系方式归属：企业只能改企业自己的，服务商/承办职员只能改自己（执行）那一侧
  if (taxActor && taxActor !== "demo_enterprise") {
    const crossProvider = await api("POST", `/enterprise/tax/declarations/${taxId}/contacts`, {
      contact_name: "越界改企业侧",
      contact_phone: "13700006666",
    }, taxActor);
    assert(
      crossProvider.data?.code === 400 && /执行侧/.test(crossProvider.data?.message || ""),
      "executor side cannot edit enterprise contact",
      `${taxActor} ${JSON.stringify(crossProvider.data?.message || crossProvider.data)}`,
    );
  }
  const crossEnterprise = await api("POST", `/enterprise/tax/declarations/${taxId}/contacts`, {
    provider_contact_name: "越界改执行侧",
    provider_contact_phone: "13700007777",
  }, "demo_enterprise");
  assert(
    crossEnterprise.data?.code === 400 && /企业侧/.test(crossEnterprise.data?.message || ""),
    "enterprise cannot edit executor contact",
    JSON.stringify(crossEnterprise.data?.message || crossEnterprise.data),
  );
  const adminContacts = await api("POST", `/enterprise/tax/declarations/${taxId}/contacts`, {
    contact_name: "管理员代改企业侧",
    contact_phone: "13700008888",
    provider_contact_name: "管理员代改执行侧",
    provider_contact_phone: "13700009999",
  }, "admin");
  assert(
    adminContacts.data?.code === 0,
    "platform admin can edit both sides",
    JSON.stringify(adminContacts.data?.data || adminContacts.data?.message),
  );

  console.log("32. 资产交易双身份（企业 / 服务商均可发起与承接，承接前置＝已发布资产服务）");
  // 前置：清掉上次运行留下的 e2e 资产服务，使「未发布服务不能承接」这一负例确定成立
  const assetSvcPre = await api("GET", "/enterprise/services?domain=ASSET", null, "demo_user");
  for (const item of (assetSvcPre.data?.data || []).filter((row) =>
    String(row.title || "").startsWith("e2e 资产服务"),
  )) {
    await api("DELETE", `/enterprise/services/${item.id}`, null, "demo_user");
  }
  const assetSvcEmpty = await api("GET", "/enterprise/services?domain=ASSET", null, "demo_user");
  assert(
    (assetSvcEmpty.data?.data || []).length === 0,
    "broker has no asset service yet (precondition)",
    `剩 ${(assetSvcEmpty.data?.data || []).length} 条`,
  );

  // 企业身份发起资产需求：不需服务商备案
  const assetReq = await api("POST", "/enterprise/asset", {
    title: "e2e 企业身份资产需求",
    description: "企业身份直接发布，无需服务商备案",
  }, "demo_enterprise");
  const assetId = assetReq.data?.data?.id;
  assert(
    assetReq.data?.code === 0 && !!assetId,
    "enterprise account posts asset demand (no provider filing)",
    JSON.stringify(assetReq.data?.message || assetReq.data?.data),
  );

  // 未发布服务：回复公开池需求被拒（不接单）
  const noSvcReply = await api("POST", `/enterprise/asset/${assetId}/messages`, {
    text: "未发布服务，不应接单",
  }, "demo_user");
  const afterNoSvc = await api("GET", "/enterprise/asset", null, "demo_enterprise");
  const noSvcRow = (afterNoSvc.data?.data || []).find((item) => item.id === assetId);
  assert(
    noSvcReply.data?.code === 20002 &&
      /数据仅对承办人与企业当事人可见/.test(noSvcReply.data?.message || "") &&
      noSvcRow?.status === "OPEN" &&
      !noSvcRow?.providerUserId,
    "unpublished broker is rejected on reply (demand stays OPEN)",
    JSON.stringify(noSvcReply.data?.message || noSvcReply.data),
  );

  // 企业身份发布「资产交易」服务（本地 AIworkin 未启用，发布态停在草稿也算已发布记录）
  const svcCreate = await api("POST", "/enterprise/services", {
    domain: "ASSET",
    title: "e2e 资产服务",
    description: "e2e 承接前置：企业身份发布资产居间服务",
    money_mode: "NEGOTIABLE",
    price_description: "面议，按成交价 1% 计居间服务费",
    service_area_mode: "NATIONWIDE",
    publish_action: "PUBLISH",
  }, "demo_user");
  assert(
    svcCreate.data?.code === 0 && !!svcCreate.data?.data?.service_no,
    "enterprise account publishes asset service",
    JSON.stringify(svcCreate.data?.message || svcCreate.data?.data),
  );

  // 已发布服务：回复即接单，承接方＝企业账号本人
  const claimReply = await api("POST", `/enterprise/asset/${assetId}/messages`, {
    text: "已发布资产服务，回复即接单",
  }, "demo_user");
  const claimedList = await api("GET", "/enterprise/asset", null, "demo_enterprise");
  const claimRow = (claimedList.data?.data || []).find((item) => item.id === assetId);
  const brokerMe = await api("GET", "/enterprise/me", null, "demo_user");
  assert(
    claimReply.data?.code === 0 &&
      claimRow?.status === "PENDING" &&
      claimRow?.providerUserId === users.demo_user.userId &&
      claimRow?.brokerName === brokerMe.data?.data?.displayName,
    "published enterprise broker claims on reply",
    `status=${claimRow?.status} broker=${claimRow?.brokerName} 期望=${brokerMe.data?.data?.displayName}`,
  );
  const ackMsg = (claimRow?.messages || []).find(
    (item) => String(item.name) === "系统" && /承接方/.test(String(item.text || "")),
  );
  assert(!!ackMsg, "claim system message uses neutral wording", ackMsg?.text);

  // 「接收需求」按钮入口：企业身份同样可直接承接
  const assetReq2 = await api("POST", "/enterprise/asset", {
    title: "e2e 企业身份资产需求2",
  }, "demo_enterprise");
  const acceptByEnterprise = await api(
    "POST",
    `/enterprise/asset/${assetReq2.data?.data?.id}/accept`,
    {},
    "demo_user",
  );
  assert(
    acceptByEnterprise.data?.code === 0 &&
      acceptByEnterprise.data?.data?.status === "PENDING" &&
      acceptByEnterprise.data?.data?.provider_id === users.demo_user.userId,
    "enterprise broker accepts demand via accept endpoint",
    JSON.stringify(acceptByEnterprise.data?.message || acceptByEnterprise.data?.data),
  );

  // 服务商身份同口径：备案不再单独门控，未发布资产服务一律不能承接
  // 负例取一条资产服务都没有的服务商账号（demo_provider 为财税类目备案）
  const svcOtherPre = await api("GET", "/enterprise/services?domain=ASSET", null, "demo_provider");
  for (const item of (svcOtherPre.data?.data || []).filter((row) =>
    String(row.title || "").startsWith("e2e 资产服务"),
  )) {
    await api("DELETE", `/enterprise/services/${item.id}`, null, "demo_provider");
  }
  const svcOtherEmpty = await api("GET", "/enterprise/services?domain=ASSET", null, "demo_provider");
  assert(
    (svcOtherEmpty.data?.data || []).length === 0,
    "negative-case provider has no asset service yet (precondition)",
    `剩 ${(svcOtherEmpty.data?.data || []).length} 条`,
  );
  const assetReq3 = await api("POST", "/enterprise/asset", {
    title: "e2e 服务商承接前置",
  }, "demo_enterprise");
  const assetReq3Id = assetReq3.data?.data?.id;
  const unlistedBlocked = await api(
    "POST",
    `/enterprise/asset/${assetReq3Id}/accept`,
    {},
    "demo_provider",
  );
  assert(
    unlistedBlocked.data?.code === 20003 &&
      /承接资产需求前请先/.test(unlistedBlocked.data?.message || ""),
    "provider without published asset service cannot accept (filing is not the gate)",
    JSON.stringify(unlistedBlocked.data?.message || unlistedBlocked.data),
  );

  // demo_asset（资产交易备案服务商）保留其演示发布记录，无则补发一条
  const svcByProviderPre = await api("GET", "/enterprise/services?domain=ASSET", null, "demo_asset");
  for (const item of (svcByProviderPre.data?.data || []).filter((row) =>
    String(row.title || "").startsWith("e2e 资产服务"),
  )) {
    await api("DELETE", `/enterprise/services/${item.id}`, null, "demo_asset");
  }
  let svcByProvider = await api("GET", "/enterprise/services?domain=ASSET", null, "demo_asset");
  if ((svcByProvider.data?.data || []).length === 0) {
    svcByProvider = await api("POST", "/enterprise/services", {
      domain: "ASSET",
      title: "e2e 资产服务（服务商）",
      description: "e2e 承接前置：服务商发布资产居间服务",
      money_mode: "NEGOTIABLE",
      price_description: "面议，按成交价 1.5% 计居间服务费",
      service_area_mode: "NATIONWIDE",
      publish_action: "PUBLISH",
    }, "demo_asset");
  }
  const svcByProviderList = await api("GET", "/enterprise/services?domain=ASSET", null, "demo_asset");
  assert(
    (svcByProviderList.data?.data || []).length > 0,
    "asset-filed provider has a published asset service (precondition)",
    `剩 ${(svcByProviderList.data?.data || []).length} 条`,
  );
  const acceptByProvider = await api(
    "POST",
    `/enterprise/asset/${assetReq3Id}/accept`,
    {},
    "demo_asset",
  );
  assert(
    acceptByProvider.data?.code === 0 &&
      acceptByProvider.data?.data?.status === "PENDING" &&
      acceptByProvider.data?.data?.provider_id === users.demo_asset.userId,
    "asset-filed provider with published asset service accepts demand",
    JSON.stringify(acceptByProvider.data?.message || acceptByProvider.data?.data),
  );

  console.log("33. GEO 采集平台 Key（每个账号配自己的，后台不代配）");
  // 后台的全局配置入口已下线：管理员也只是一名普通账号，只能配自己的
  const geoAdminLegacy = await api("GET", "/enterprise/admin/geo-settings", null, "admin");
  assert(
    geoAdminLegacy.status === 404,
    "admin global geo-settings endpoint is gone",
    `${geoAdminLegacy.status} ${geoAdminLegacy.data?.message || ""}`,
  );

  const geoList = await api("GET", "/enterprise/geo/settings", null, "admin");
  const geoProviders = geoList.data?.data?.providers || [];
  assert(
    geoList.data?.code === 0 && geoProviders.length === 12,
    "geo settings lists 12 collection platforms per account",
    JSON.stringify(geoList.data?.message || geoProviders.map((row) => row.code)),
  );
  assert(
    geoProviders.every(
      (row) =>
        row.code &&
        row.platform &&
        (row.source === "db" || row.source === "none") &&
        row.defaultBaseUrl,
    ),
    "geo platform rows carry platform / key source / default address",
    JSON.stringify(geoProviders[0] || {}),
  );
  assert(
    !JSON.stringify(geoList.data || {}).includes("keyCipher"),
    "geo settings never returns key material",
  );

  // 普通账号同样能打开自己的 Key 配置（不再要求平台管理员）
  const geoOwn = await api("GET", "/enterprise/geo/settings", null, "demo_enterprise");
  assert(
    geoOwn.data?.code === 0 && (geoOwn.data?.data?.providers || []).length === 12,
    "any account can manage its own geo keys",
    `${geoOwn.status} ${geoOwn.data?.message || ""}`,
  );

  const geoUnknown = await api("PUT", "/enterprise/geo/settings/unknown", {
    apiKey: "x",
  }, "demo_enterprise");
  assert(
    geoUnknown.data?.code === 404,
    "unknown geo platform rejected",
    JSON.stringify(geoUnknown.data?.message || geoUnknown.data),
  );

  // 先清空本账号的 kimi / deepseek，保证前置状态确定
  await api("DELETE", "/enterprise/geo/settings/kimi", null, "demo_enterprise");
  await api("DELETE", "/enterprise/geo/settings/deepseek", null, "demo_enterprise");

  // 账号自己保存 → 来源切到 db、密钥不回显；只改模型 → 保留原 Key
  const kimiSave = await api("PUT", "/enterprise/geo/settings/kimi", {
    apiKey: "e2e-geo-key-not-real",
    model: "moonshot-v1-8k",
  }, "demo_enterprise");
  const kimiRow = (kimiSave.data?.data?.providers || []).find((row) => row.code === "kimi");
  assert(
    kimiSave.data?.code === 0 && kimiRow?.source === "db" && kimiRow?.model === "moonshot-v1-8k",
    "geo key saved by the account itself",
    JSON.stringify(kimiRow || kimiSave.data?.message),
  );
  assert(
    !JSON.stringify(kimiSave.data || {}).includes("e2e-geo-key-not-real"),
    "saved geo key is not echoed back",
  );
  const kimiKeep = await api("PUT", "/enterprise/geo/settings/kimi", {
    model: "moonshot-v1-32k",
  }, "demo_enterprise");
  const kimiKept = (kimiKeep.data?.data?.providers || []).find((row) => row.code === "kimi");
  assert(
    kimiKept?.source === "db" && kimiKept?.model === "moonshot-v1-32k",
    "empty apiKey keeps the saved key while changing model",
    JSON.stringify(kimiKept || kimiKeep.data?.message),
  );

  // 配好 Key + 模型 → 只有本人前台可用；其它账号（含管理员）看不到也借不到
  const geoMetaSaved = await api("GET", "/enterprise/geo/meta", null, "demo_enterprise");
  assert(
    geoMetaSaved.data?.code === 0 &&
      (geoMetaSaved.data?.data?.availablePlatforms || []).includes("Kimi"),
    "account's own configured platform becomes usable in its frontend",
    JSON.stringify(geoMetaSaved.data?.data?.availablePlatforms || []),
  );
  const geoMetaAdmin = await api("GET", "/enterprise/geo/meta", null, "admin");
  assert(
    geoMetaAdmin.data?.code === 0 &&
      !(geoMetaAdmin.data?.data?.availablePlatforms || []).includes("Kimi"),
    "another account (including admin) cannot use someone else's geo key",
    JSON.stringify(geoMetaAdmin.data?.data?.availablePlatforms || []),
  );

  // 连通测试的确定性守卫：有 Key 但没模型时给出可执行提示（不外呼）
  await api("PUT", "/enterprise/geo/settings/deepseek", {
    apiKey: "e2e-geo-key-no-model",
    model: "",
  }, "demo_enterprise");
  const geoNoModel = await api("POST", "/enterprise/geo/settings/deepseek/test", {}, "demo_enterprise");
  assert(
    geoNoModel.data?.code === 400 && /未填写模型/.test(geoNoModel.data?.message || ""),
    "connectivity test requires a model",
    JSON.stringify(geoNoModel.data?.message || geoNoModel.data),
  );

  // 清除：本账号整行去掉，该平台随即不可用（没有 .env 回落）
  await api("DELETE", "/enterprise/geo/settings/kimi", null, "demo_enterprise");
  await api("DELETE", "/enterprise/geo/settings/deepseek", null, "demo_enterprise");
  const geoAfterClear = await api("GET", "/enterprise/geo/settings", null, "demo_enterprise");
  const clearedRows = (geoAfterClear.data?.data?.providers || []).filter((row) =>
    ["kimi", "deepseek"].includes(row.code),
  );
  assert(
    clearedRows.length === 2 &&
      clearedRows.every((row) => row.source === "none" && row.model === "" && row.baseUrl === ""),
    "cleared geo platform rows have no key, model or address override",
    JSON.stringify(clearedRows),
  );
  const geoMetaCleared = await api("GET", "/enterprise/geo/meta", null, "demo_enterprise");
  assert(
    geoMetaCleared.data?.code === 0 &&
      (geoMetaCleared.data?.data?.platforms || []).length === 12 &&
      !(geoMetaCleared.data?.data?.availablePlatforms || []).includes("Kimi") &&
      !(geoMetaCleared.data?.data?.availablePlatforms || []).includes("DeepSeek"),
    "cleared platforms stay listed but are unusable in the frontend",
    JSON.stringify(geoMetaCleared.data?.data?.availablePlatforms || []),
  );

  const { passed, failed } = suite.counts();
  console.log(`通过 ${passed} 项 · 失败 ${failed} 项`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
