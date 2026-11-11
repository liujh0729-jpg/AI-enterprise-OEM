import { isDomainOpened, openedTypes } from "../lib/provider-categories";
import type { EnterpriseMe } from "../lib/session";
import { isPersonalSubject } from "../lib/subject";

export type EnterpriseRoute = {
  path?: string;
  name?: string;
  icon?: string;
  type?: "group";
  hideInMenu?: boolean;
  domain?: string;
  routes?: EnterpriseRoute[];
};

export type AdminGroupKey = "people" | "operation" | "billing" | "capability" | "system";

export type AdminGroup = {
  key: AdminGroupKey;
  name: string;
  icon: string;
};

export type AdminSection = {
  key: string;
  name: string;
  icon: string;
  desc: string;
  /** 侧栏大分类（平台数据总览并入驾驶舱，所有板块都归属分组）。 */
  group: AdminGroupKey;
};

/**
 * 平台管理后台 = 独立平台（`/admin`）：板块是**侧栏菜单项 + 子路由**（不再用页面内页签），
 * 菜单、顶栏标题、页面 hero 文案同源，新增板块只改这一处。
 */
export const ADMIN_PATH_PREFIX = "/admin";

/** 侧栏大分类，顺序即菜单顺序；板块顺序由 `ADMIN_SECTIONS` 内的排列决定。 */
export const ADMIN_GROUPS: AdminGroup[] = [
  { key: "people", name: "用户与服务商", icon: "peoples" },
  { key: "operation", name: "业务运营监管", icon: "audit" },
  { key: "billing", name: "计费与商品", icon: "pay-circle" },
  { key: "capability", name: "能力与安全", icon: "safety" },
  { key: "system", name: "系统与内容", icon: "setting" },
];

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    key: "users",
    name: "注册用户",
    icon: "team",
    desc: "本系统已识别的全部账号：用户名、昵称、邮箱、账号状态。",
    group: "people",
  },
  {
    key: "enterprises",
    name: "企业用户",
    icon: "bank",
    desc: "已通过企业信息认证的用户（企业 / 个体工商户主体）。",
    group: "people",
  },
  {
    key: "provider-applications",
    name: "服务商备案",
    icon: "file-done",
    desc: "服务商备案申请审核：通过后自动获得服务商角色，即可开展对应类目的业务服务。",
    group: "people",
  },
  {
    key: "providers",
    name: "服务商管理",
    icon: "peoples",
    desc: "已通过备案的服务商与其服务类型资质：可逐项停用 / 恢复（通过即代表该类目资源可对外展示；停用则其资源同步下线并拦截该类型新建业务）。",
    group: "people",
  },
  {
    key: "capabilities",
    name: "服务商能力开通",
    icon: "bolt",
    desc: "服务商提交的财税自动化付费开通申请审核；企业维度的开通 / 关闭与企享云账号匹配统一在「财税管理」处理。",
    group: "people",
  },
  {
    key: "flex",
    name: "灵活用工",
    icon: "team",
    desc: "「灵工发薪」板块的平台级启停（默认启用；资源由服务商备案通过即展示，无需资源级平台审核）。",
    group: "operation",
  },
  {
    key: "contracts",
    name: "签约监管",
    icon: "contract",
    desc: "全部签约台账：企业、服务商、类目、期限与状态；平台管理员可解除生效中的签约。",
    group: "operation",
  },
  {
    key: "supply",
    name: "供销网络监管",
    icon: "network",
    desc: "服务站、商品订货与服务预约单的全平台监管总览。",
    group: "operation",
  },
  {
    key: "marketing-livecode",
    name: "活码监管",
    icon: "qrcode",
    desc: "全平台活码清单：归属账号、当前入口域名与累计扫码；发现违规内容可下架，落地页立即显示「链接已停用」。",
    group: "operation",
  },
  {
    key: "community",
    name: "创意社区",
    icon: "audit",
    desc: "社区工作流审核与推荐，推荐后给发布者积分（规则可配）。",
    group: "operation",
  },
  {
    key: "video-templates",
    name: "视频模版社区",
    icon: "play",
    desc: "视频模版社区的平台级开关：是否补充展示 AIworkin 平台模版、手动 / 定时同步策略与最近一次同步结果。",
    group: "operation",
  },
  {
    key: "tax-admin",
    name: "财税管理",
    icon: "audit",
    desc: "企享云报税 API Key 账号池与税号匹配：新增账号、给企业税号匹配账号，并审核服务商提交的付费开通申请。",
    group: "operation",
  },
  {
    key: "geo",
    name: "GEO管理设置",
    icon: "search",
    desc: "监管每周 GEO 自动采集任务量：本周计划 / 实际完成（含周日未跑完顺延次日）与逐项目明细。采集平台 API Key 由每个账号在「营销工具 → GEO-AI引擎优化」里配自己的，后台看不到也不能替别人配置。",
    group: "operation",
  },
  {
    key: "points",
    name: "积分与充值",
    icon: "pay-circle",
    desc: "汇率与充值档位、注册/邀请奖励、赠送限额与风控；模块价目与用量、账户调整与充值订单。",
    group: "billing",
  },
  {
    key: "service-packages",
    name: "服务套餐",
    icon: "gift",
    desc: "官方服务套餐目录与平台整合交付：按业务板块上架套餐（人民币价 + 按汇率换算的积分价），企业积分直购后由平台主持企业与多家优质服务商签约兑现；支持预绑服务商自动发起、逐项匹配、更换主体、部分退款/整单退款；限购按企业，不参与交付周期与到期管理。",
    group: "billing",
  },
  {
    key: "model-plaza",
    name: "模型广场",
    icon: "appstore",
    desc: "模型广场的平台上架目录与上游通道：维护模型名称、厂商、计费单价与可用端点，从上游一键拉取差异并上架；用户侧按量扣分，对外提供 OpenAI 兼容网关。",
    group: "billing",
  },
  {
    key: "entitlements",
    name: "权益配额",
    icon: "credential",
    desc: "套餐目录与配额项：定义每个套餐包含的席位 / 存储 / 调用额度，并给组织分配套餐查看当前权益与已用量。",
    group: "billing",
  },
  {
    key: "features",
    name: "功能治理",
    icon: "safety",
    desc: "功能目录开关（关闭即拦菜单与接口）、Agent 出网黑名单与沙箱硬上限、技能/插件审查台账与人工放行。",
    group: "capability",
  },
  {
    key: "skill-generator",
    name: "生成 Skill",
    icon: "robot",
    desc: "勾选本系统 MCP 业务域与动作，调用模型逐个生成根目录带 SKILL.md 的技能包；下载后可发布到 SkillHub 获取流量。目录随 MCP 接口自动增长。",
    group: "capability",
  },
  {
    key: "publish-review",
    name: "发布审核",
    icon: "safety",
    desc: "配置阿里云内容安全的 AccessKey 与审核场景：发布需求、发布服务必选，社群发帖、发布简历可选；命中违规直接阻断发布并记入审核台账，上游故障降级放行。",
    group: "capability",
  },
  {
    key: "usage",
    name: "使用埋点",
    icon: "chart",
    desc: "产品使用埋点的启停与保留天数、近 N 天事件汇总与明细；关闭后前端停止上报，已有数据按保留策略清理。",
    group: "capability",
  },
  {
    key: "hardware",
    name: "智能硬件",
    icon: "chip",
    desc: "硬件型号目录、开发包版本（SDK / 固件上传、下载量）与型号默认 API / MCP 工具维护；用户接入的设备与自建工具在用户侧「智能硬件」栏目。",
    group: "capability",
  },
  {
    key: "terms",
    name: "条款版本",
    icon: "file-done",
    desc: "服务条款 / 隐私政策等文档的版本发布：可要求修订后重新接受，用户接受行为逐条留痕。",
    group: "system",
  },
  {
    key: "changelog",
    name: "更新日志",
    icon: "horn",
    desc: "产品更新日志：按版本、分类、发布状态维护，已发布条目同步展示在帮助中心。",
    group: "system",
  },
  {
    key: "upgrade",
    name: "平台升级",
    icon: "rocket",
    desc: "从 GitHub Release 拉取或手动上传升级包，先由平台 Agent 分析代码差异与迁移风险，再按建议一键执行；升级前强制备份数据库，支持代码备份、自动回滚与一键还原。",
    group: "system",
  },
  {
    key: "ai-code",
    name: "AI 编程",
    icon: "code",
    desc: "选好模型后用「对话 + 上传参考图 / 文件」让模型改写本系统自身源码：改动先落在暂存区产出可审阅的差异，逐文件采纳后再备份数据库与程序、由平台升级执行器应用、构建、迁移、重启；任何一步都能一键还原。",
    group: "system",
  },
  {
    key: "wechat-mp",
    name: "微信服务号设置",
    icon: "qrcode",
    desc: "配置平台微信服务号的 AppID / AppSecret / Token 与 EncodingAESKey、模板消息映射、自定义菜单、关注提示与关键词回复；用户从右上角二维码入口扫码关注即绑定账号，任务、审批与客服回复可同步推送到微信并在手机 H5 上处理。",
    group: "system",
  },
  {
    key: "settings",
    name: "系统设置",
    icon: "setting",
    desc: "文件存储（OSS）、AIPDD 平台 Key（基础数据）、平台级参数、站点设置与首页设置：各板块以页签切换，保存后前端读取即时生效。首页设置维护官网落地页的文案、图片与板块显隐（顶部只有注册 / 登录，页脚 ICP 读站点设置）。企享云报税 API Key 与税号匹配统一在「财税管理」。",
    group: "system",
  },
];

export const adminRoute: EnterpriseRoute = {
  path: "/",
  routes: [
    { path: "/dashboard", name: "驾驶舱", icon: "dashboard" },
    ...ADMIN_GROUPS.map((group) => ({
      type: "group" as const,
      name: group.name,
      icon: group.icon,
      routes: ADMIN_SECTIONS.filter((item) => item.group === group.key).map((item) => ({
        path: `${ADMIN_PATH_PREFIX}/${item.key}`,
        name: item.name,
        icon: item.icon,
      })),
    })),
  ],
};

/**
 * 驾驶舱独立置顶，菜单按当前身份筛选。
 * 顺序：工作台 → 业务服务 → 商务人脉（商务社交 / 招聘） → 模型服务（含 AIPDD 算力平台外链） → 管理设置（含平台机制） → 智能硬件。
 */
export const enterpriseRoute: EnterpriseRoute = {
  path: "/",
  routes: [
    { path: "/dashboard", name: "驾驶舱", icon: "dashboard" },
    {
      type: "group",
      name: "工作台",
      icon: "chip",
      routes: [
        { path: "/tasks", name: "我的任务", icon: "tasks" },
        { path: "/agent", name: "Agent", icon: "robot" },
        { path: "/rpa", name: "RPA自动化", icon: "play" },
        { path: "/kb", name: "知识库", icon: "book" },
        { path: "/workbuddy", name: "Workbuddy 企业云", icon: "robot" },
        { path: "/mail", name: "AI邮箱服务", icon: "mail" },
        { path: "/data-table", name: "多维表格", icon: "table" },
        /**
         * 「内容创作」板块：工作台里的可展开子菜单，下挂内容创作类功能入口。
         * 原先平铺的「内容创作」菜单改名为「内容创作小工具」并收进这个板块，
         * 页面地址仍为 /content（契约端点、后端路由与站内跳转链接都不受影响）。
         * 之后新增内容创作方向的功能（选题、排期、发布等）只往这个板块的 routes 里加条目。
         */
        {
          type: "group",
          name: "内容创作",
          icon: "play",
          routes: [
            { path: "/content", name: "内容创作小工具", icon: "play" },
            { path: "/community", name: "创意社区", icon: "apps" },
            { path: "/content/video-templates", name: "视频模版", icon: "play" },
          ],
        },
        { path: "/marketing-tools", name: "营销工具", icon: "horn" },
        { path: "/assets", name: "数字资产管理", icon: "folder" },
        { path: "/crm", name: "CRM", icon: "team" },
        { path: "/bi", name: "BI智能分析", icon: "chart" },
        { path: "/oa", name: "OA", icon: "file-done" },
        { path: "/okr", name: "OKR计划", icon: "target" },
        { path: "/service-desk", name: "AI客服", icon: "peoples" },
        { path: "/hrm", name: "HR工作台", icon: "peoples" },
        { path: "/project", name: "项目管理", icon: "file-done" },
        { path: "/erp", name: "进销存", icon: "shop" },
        { path: "/app-center", name: "应用中心", icon: "appstore" },
        { path: "/question-hall", name: "专题大厅", icon: "peoples" },
      ],
    },
    {
      type: "group",
      name: "业务服务",
      icon: "shop",
      routes: [
        { path: "/marketing", name: "营销服务", icon: "shop", domain: "marketing" },
        { path: "/supply", name: "供销网络", icon: "network", domain: "supply" },
        { path: "/tax", name: "财税服务", icon: "audit", domain: "tax" },
        { path: "/overseas", name: "跨境出海", icon: "global", domain: "overseas" },
        { path: "/flex", name: "灵活用工", icon: "team", domain: "flex" },
        { path: "/logistics", name: "物流服务", icon: "rocket", domain: "logistics" },
        { path: "/smart", name: "IT服务", icon: "chip", domain: "smart" },
        { path: "/ip", name: "知识产权", icon: "safety", domain: "ip" },
        { path: "/legal", name: "法律服务", icon: "bank", domain: "legal" },
        { path: "/think-tank", name: "智库服务", icon: "read", domain: "think-tank" },
        { path: "/asset", name: "资产交易", icon: "asset", domain: "asset" },
        { path: "/market", name: "供需市场", icon: "shop" },
      ],
    },
    /** 商务人脉成组（紧靠业务服务之后、模型服务之前）：商务社交与招聘各自一个入口。 */
    {
      type: "group",
      name: "商务人脉",
      icon: "peoples",
      routes: [
        { path: "/social", name: "商务社交", icon: "peoples" },
        { path: "/hiring", name: "招聘", icon: "team" },
      ],
    },
    {
      type: "group",
      name: "模型服务",
      icon: "api",
      routes: [
        { path: "/developer/keys", name: "API Key 管理", icon: "key" },
        { path: "/model-plaza", name: "模型广场", icon: "appstore" },
        { path: "/model-settings", name: "模型设置", icon: "setting" },
        { path: "/developer/api-mcp-skill", name: "API-MCP-Skill", icon: "book" },
        // AIPDD 算力平台外链固定挂在「模型服务」最后
        { path: "https://app.aipdd.work", name: "AIPDD算力平台", icon: "bolt" },
      ],
    },
    {
      type: "group",
      name: "管理设置",
      icon: "setting",
      routes: [
        { path: "/identity", name: "身份与资质", icon: "idcard" },
        { path: "/staff", name: "职员/代理人管理", icon: "peoples" },
        { path: "/contracts", name: "签约管理", icon: "contract" },
        { path: "/my-packages", name: "我的套餐", icon: "gift" },
        // 账户级自助：积分充值与流水、邀请码与邀请记录，统一挂在「管理设置」下
        { path: "/points", name: "积分中心", icon: "pay-circle" },
        { path: "/invite", name: "我的邀请", icon: "gift" },
        { path: "/developer/mechanisms", name: "平台机制", icon: "api" },
      ],
    },
    /** 智能硬件独立成板块（放在管理设置之后、菜单最末），页面地址不变。 */
    {
      type: "group",
      name: "智能硬件",
      icon: "chip",
      routes: [
        { path: "/hardware", name: "硬件广场", icon: "appstore" },
        { path: "/hardware/devices", name: "添加硬件", icon: "chip" },
        { path: "/hardware/mcp", name: "硬件MCP", icon: "api" },
        { path: "/hardware/api", name: "硬件API", icon: "book" },
      ],
    },
  ],
};

/**
 * 平台管理员侧栏隐藏的「模型服务」与「智能硬件」入口：API Key 管理（含 AIPDD API Key 绑定）与模型设置都是
 * 「当前账号」的自助配置，挂在平台后台里容易被误读成平台级设置（平台级配置统一在「系统设置」的
 * 企享云 / OSS / AIPDD 平台 Key 与站点设置页签里）。管理员要用这两页请切到企业 / 个人身份，
 * 只隐藏菜单入口，直接访问链接不受影响。
 * 智能硬件板块（广场 / 添加硬件 / 硬件MCP / 硬件API）同属账号视角，管理员侧一并隐藏，
 * 平台级硬件维护在 /admin 的「智能硬件」板块。
 */
const ADMIN_HIDDEN_INTEGRATION_PATHS = [
  "/developer/keys",
  "/model-plaza",
  "/model-settings",
  "/hardware",
  "/hardware/devices",
  "/hardware/mcp",
  "/hardware/api",
];

/**
 * 站点级菜单显隐：递归剔除被隐藏的菜单项（路径即菜单里的 path，外链为完整 URL）。
 * 只过滤菜单项，不动分组本身——子项全被隐藏的分组留空，交给下游按「空组不留菜单」剔除。
 */
function applyHiddenMenuPaths(
  routes: EnterpriseRoute[],
  hidden: Set<string>,
): EnterpriseRoute[] {
  return routes
    .filter((route) => !(route.path && hidden.has(route.path)))
    .map((route) =>
      route.routes ? { ...route, routes: applyHiddenMenuPaths(route.routes, hidden) } : route,
    );
}

/**
 * 只用当前身份组织菜单；具备其他身份不会混入其管理入口。
 * 平台管理员侧栏只拼「平台管理」后台板块与工具菜单，不含「管理设置」分组（身份与资质 / 积分中心 / 我的邀请 / 平台机制属个人账户视角），
 * 也不含「模型服务」「智能硬件」里的账户级自助入口（见 ADMIN_HIDDEN_INTEGRATION_PATHS）。
 * `hiddenMenuPaths` 来自后台「站点设置 → 用户侧菜单显隐」，覆盖前台侧栏每一条菜单（含驾驶舱入口与「AIPDD算力平台」外链），
 * 对管理员与普通用户一致生效：只控制菜单显示，直接访问链接不受影响，某分组内全部隐藏后该分组自动消失。
 */
export function navigationFor(
  me: EnterpriseMe | null,
  hiddenMenuPaths: string[] = [],
): EnterpriseRoute {
  if (!me) return { path: "/", routes: [] };
  const identity = me.currentIdentity;
  // 先做站点级显隐（对所有身份一致），再交给身份分支组织菜单。
  // 历史配置把驾驶舱入口写作「/」，首页独立后驾驶舱移到「/dashboard」，旧开关继续生效。
  const hidden = new Set(hiddenMenuPaths);
  if (hidden.has("/")) hidden.add("/dashboard");
  const routes = applyHiddenMenuPaths(enterpriseRoute.routes!, hidden);
  const management = routes.find((route) => route.name === "管理设置")!;
  const tools = routes
    .filter((route) => route.name === "模型服务" || route.name === "智能硬件")
    .filter((route) => route.type !== "group" || Boolean(route.routes?.length));
  if (identity === "PLATFORM_ADMIN" && me.identities.includes("PLATFORM_ADMIN")) {
    // 平台管理员侧栏不带「管理设置」组：该组是个人账户视角的入口，管理员的账户级操作都在 /admin 内完成。
    // 「模型服务」「智能硬件」里的 Key 绑定、模型配置与硬件接入同属账号级自助，管理员侧一并摘掉，避免与平台级配置混淆。
    const adminHiddenIntegration = new Set(ADMIN_HIDDEN_INTEGRATION_PATHS);
    const adminTools = tools
      .map((route) =>
        route.name === "模型服务" || route.name === "智能硬件"
          ? {
              ...route,
              routes: applyHiddenMenuPaths(route.routes!, adminHiddenIntegration),
            }
          : route,
      )
      // 站点级显隐 + 管理员隐藏项叠加后可能整组为空，空组不留菜单
      .filter((route) => route.type !== "group" || Boolean(route.routes?.length));
    return {
      ...adminRoute,
      routes: [...adminRoute.routes!, ...adminTools],
    };
  }

  const opened = openedTypes(me, identity);
  const personal = !me.identities.includes("PLATFORM_ADMIN") && identity === "ENTERPRISE_USER" && isPersonalSubject(me.enterprise?.subjectType);
  return {
    ...enterpriseRoute,
    routes: routes
      .map((route) => {
        if (route.name === "业务服务") {
          return {
            ...route,
            // 个人主体也进财税/出海：只锁办理动作（签约/申报/账套/发布需求），浏览与服务商名录照常
            routes: route.routes!.filter((child) => isDomainOpened(opened, child.domain)),
          };
        }
        if (route === management) {
          // 职员/代理人与个人用户也进本页，但看的是「申请加入服务商」视角
          const joinView = identity === "PROVIDER_STAFF" || personal;
          return {
            ...route,
            routes: route.routes!.filter((child) =>
              child.path !== "/staff" ||
              identity === "SERVICE_PROVIDER" ||
              joinView,
            ).map((child) =>
              child.path === "/staff" && joinView
                ? { ...child, name: "申请加入服务商" }
                : child,
            ),
          };
        }
        return route;
      })
      .filter((route) => route.type !== "group" || Boolean(route.routes?.length)),
  };
}

export const PAGE_META: Record<
  string,
  { title: string; description: string }
> = {
  "/": { title: "官网首页", description: "企业服务操作系统：一个账号连接企业全生命周期。" },
  "/dashboard": { title: "驾驶舱", description: "身份与资质、我的待办与业务台账。" },
  "/help": {
    title: "帮助中心",
    description:
      "按章节了解系统怎么用的知识库：快速开始、工作台工具、内容与营销、多平台分发、业务服务与管理设置；同一份知识以 MCP 只读工具开放，可直接问 Agent 获得官方用法。",
  },
  "/data-table": {
    title: "多维表格",
    description:
      "按账号归属的自建结构化数据表：自定义列（八种类型）、逐条录入行数据，并可经 API Key 机器通道读写。",
  },
  "/rpa": {
    title: "RPA自动化",
    description:
      "按账号归属的云端 RPA：RPA 任务（建任务即绑定脚本＋账号＋运行参数）、RPA 账号（口令密文保存）、RPA 脚本（Automa JSON / JS / Python，可由 AIPDD 文字模型按需求生成），本地比特浏览器凭 API Key 认领执行并回传结果；另有「本地 Chrome 插件（浏览器代理）」执行端——插件登录本系统后本机浏览器成为在线设备，Agent 可在你已登录的站点自主多步执行。",
  },
  "/workbuddy": {
    title: "Workbuddy 企业云",
    description:
      "按用户归属的腾讯云 Workbuddy 企业云：计划任务（口水话经 AI 澄清成任务书、拆条派发、同步 Agent 消息）、Agent（创建 / 版本 / 会话）、Workbuddy Enterprise 账号（用户自己的 SecretId / SecretKey 密文保存，可配多把并行）、AI 调用账号（第三方平台口令 / API Key / Cookie 加密保存，按 Workbuddy Enterprise 账号绑定授权，经机器通道按绑定取用）。",
  },
  "/app-center": {
    title: "应用中心",
    description:
      "内建应用与应用市场合并后的统一入口：首页按关键词搜索我构建的、本企业构建的和应用市场的应用；另有企业创建、我创建的、我加入的与应用市场四个页签。内建应用按组织归属，实体落多维表格、成员按角色权限读写；应用市场是外部公开目录的只读展示，本站不存应用、不代上架也不代评价。",
  },
  "/crm": {
    title: "CRM",
    description:
      "账号级客户关系管理：线索、客户、商机、销售合同、回款、订单、审批与报表。成员与权限复用本账号「职员与代理人」，企业身份与服务商身份共用同一套人。",
  },
  "/bi": {
    title: "BI智能分析",
    description:
      "账号级 BI：内置 CRM 策展数据集与外部 PostgreSQL/MySQL 只读数据源，支持智能问数、图表与仪表板。成员与权限复用本账号「职员与代理人」。",
  },
  "/oa": {
    title: "OA",
    description:
      "按组织归属的表单申请与多级审批：请假、报销、付款、采购、用章；成员来自组织「职员与代理人」，可关联 CRM 等业务数据，审批结果回写。",
  },
  "/question-hall": {
    title: "专题大厅",
    description:
      "发布企业内或公开的专题讨论：企业内由本组织与签约/承办伙伴的职员参与，公开对所有登录账号开放；发起人可结案（AI 总结全部发言与回复的回复）、重新结案、关闭或删除，发言可选本人或数字分身署名。",
  },
  "/kb": {
    title: "知识库",
    description:
      "公共知识库与知识图谱底座：资料投进知识空间后编译为可溯源的 wiki 页面，[[链接]] 自动长出图谱，混合检索与带引用问答随写随可用；支持消费者绑定、Agent 操作记忆提炼与上下文回流，未配置大模型时全链路走规则式回落。",
  },
  "/social": {
    title: "商务社交",
    description:
      "本地闭环的商务社交板块：结识同行人（好友/拉黑）、发布动态（公开/仅好友）、小组讨论（对标豆瓣：发现/加入小组、分类发帖、可逐条匿名、楼层回复与推荐、组长/管理员置顶加精与入组审批）、站内私信往来、维护与主页分叉的职场简历。全部在你的账号下读写，不受上游影响，账号被封禁时自动拦截。",
  },
  "/hiring": {
    title: "招聘",
    description:
      "本地闭环的招聘专区（移植 SNS 招聘专区）：发布全职/兼职/实习等岗位，进招聘广场信息流供全站浏览与站内私信对接。本地发布免费、无需绑定 APIKey；已绑定 AIPDD APIKey 时可将岗位同步为 AIworkin 的用工需求（类目固定取平台「灵活用工」子树）并镜像上游状态。另有「AI 简历代投」（求职者视角）：维护求职画像与简历、按岗位打分匹配、生成优化简历；投递先落为待确认，必须本人在界面确认后发出，并跟踪面试 / Offer 漏斗。",
  },
  "/invite": {
    title: "我的邀请",
    description:
      "每位用户都有一把专属邀请码：好友注册时填写（非必填）即建立邀请关系；这里展示你的邀请码与注册链接、自己是被谁邀请注册的，以及已成功邀请的人数。",
  },
  "/points": {
    title: "积分中心",
    description:
      "本站积分与 AWcoin 双币展示：积分可微信充值、可赠送给其他账号，用于数字资产存储与 CRM / BI / OA / AI 客服等模块消费；流水与充值订单一屏可查。AWcoin 只读展示，永不互兑。",
  },
  "/okr": {
    title: "OKR计划",
    description:
      "按组织归属的目标管理：年度/季度/月度周期、公司到个人的目标树、周/日计划、日报周报与周期复盘评分。成员与管理者的岗位能力取自组织「职员与代理人」。",
  },
  "/mail": {
    title: "AI邮箱服务",
    description:
      "按登录账号添加多个邮箱（POP3 / IMAP），实时读取收件箱与草稿箱，邮件正文、附件一律不落库；可配置场景话术，回复方式选「只写草稿」或「写草稿并自动回复」，Agent 定时任务通过邮件工具按话术草拟回复。邮箱列表显示今天已发送/已出草稿与本月累计处理量。",
  },
  "/tasks": {
    title: "我的任务",
    description:
      "统一任务中心：把各业务模块（审批 / 汇报 / 任务 / 事务 / 审核）需要你处理的待办聚成一屏，点「去处理」跳到源模块办理，明细仍在各模块闭环；本人可关闭 / 重开，由工作流派发的节点关闭后会唤醒流程继续执行。",
  },
  "/workflow": {
    title: "工作流",
    description:
      "可视化编排自动化流程：拖拽节点连线成 DAG（触发器 → 动作 → 分支 / 循环 / 等待 / 子流程），可手动 / 定时 / Webhook 触发，运行过程流式查看步骤与产物，也可发布为 Agent 技能或 MCP 工具供调用。",
  },
  "/agent": {
    title: "Agent",
    description:
      "与模型对话直接产出图片/视频：生成结果自动存进本账号的 AIPDD 数字资产；「记忆」页签里既有 Agent 长期记忆，也有你在全站做过的操作留痕。模型与 Key 在「模型服务 → 模型设置」里配置。",
  },
  "/marketing-tools": {
    title: "营销工具",
    description:
      "十九个营销工具，首屏每个工具一张卡片、点卡片进入使用：达人建联（按类目 / 平台 / 粉丝数筛选达人并查看联系方式）、阿里云智能外呼（把多维表格名单映射导入阿里云智能外呼任务组）、阿里云邮件推送（把多维表格的联系人同步到阿里云收件人列表）、GEO-AI引擎优化（品牌在 AI 问答中的可见度报告与选题池，另含按语言与付费/免费筛选的发稿平台推荐与 GEO 建站入口，新窗口打开 AIworkin GEO 独立站看板）、SEO 优化（传统搜索引擎侧工作台：站点体检、关键词研究与聚类、排名跟踪、竞品洞察、外链分析与建设、本地 SEO 网格、程序化页面、结构化数据与收录提交、SEO 报告；三层数据源——自有抓取免费、DataForSEO 你自带 Key 你付费、系统 AI 计积分，无 Key 不造假数据）、营销技能库（内容 / 社媒 / 邮件 / SEO / 广告 / 调研 / 销售七类技能与品牌上下文，填参数即可运行，结果沉淀为内容资产，支持渠道连接与定时任务）、多平台内容分发、问卷设计与调研、活码引流、腾讯企点三件套、Google 潜客线索挖掘、企业数据 / 全球贸易大数据 / 全球商务人士大数据 / 全球达人大数据 / 全球POI大数据（各自独立：自然语言提数据需求，AI 解析后查询并逐批写入各自的多维表格）、AI销售管理-SalesBuddy（外部网站，点卡片新窗口打开 salesbuddy.top）。",
  },
  "/contracts": {
    title: "签约管理",
    description: "签约概览与全部签约（企业发起、服务商确认）。",
  },
  "/my-packages": {
    title: "我的套餐",
    description:
      "已购官方服务套餐与逐项交付进度：套餐由平台整合优质服务商完成交付，平台主持企业与服务商签约，签约须服务商确认后生效，进度实时读取签约状态。",
  },
  "/tax": {
    title: "财税服务",
    description: "报税工作台、申报计划与账套管理。",
  },
  "/supply": {
    title: "供销网络",
    description:
      "B2B 供需协同供应网络：服务站、商品订货与线下服务预约（报价由服务商或其指派职员完成）。",
  },
  "/overseas": {
    title: "跨境出海",
    description: "跨境出海服务商与出海服务工具。",
  },
  "/flex": {
    title: "灵活用工服务",
    description: "资源库、用工需求（含用工进件）与灵工发薪。",
  },
  "/marketing": {
    title: "营销服务",
    description: "达人探店 / 直播带货 · 需求消息通道。",
  },
  "/logistics": {
    title: "物流服务",
    description: "境内陆运 / 跨境货代 · 需求消息通道。",
  },
  "/smart": {
    title: "IT服务",
    description: "AI实施 / 软件开发 / 算力 / 硬件 / 数据 · 需求消息通道。",
  },
  "/ip": {
    title: "知识产权服务",
    description: "机构 / 代理人资源库、需求消息与咨询维权。",
  },
  "/legal": {
    title: "法律服务",
    description: "律师 / 律所资源库与需求消息。",
  },
  "/think-tank": {
    title: "智库服务",
    description: "机构 / 专家资源库与需求消息。",
  },
  "/asset": {
    title: "资产交易",
    description: "资产租售与居间服务 · 需求消息通道。",
  },
  "/market": {
    title: "供需市场",
    description:
      "跨板块的公开供需市场：需求与服务各一个页签，默认读 AIworkin 平台公开池（发布同步平台挂单并落本地台账、记回内容 ID）；服务商身份可切「我发布的」读本系统台账。",
  },
  "/identity": {
    title: "身份与资质",
    description: "用户信息提交即生效；服务商备案需审核；职员需绑定或挂靠。",
  },
  "/staff": {
    title: "职员/代理人管理",
    description: "团队概览、挂靠审批与在职职员。",
  },
  "/project": {
    title: "项目管理",
    description:
      "项目、任务与工时闭环：项目主档、成员与里程碑、迭代与任务依赖、工时流水与周表审批；成员复用组织「职员/代理人」，AI 只做任务拆解建议与项目健康度评估，写入由人确认。",
  },
  "/erp": {
    title: "进销存",
    description:
      "中小企业进销存：商品与变体、分类与仓库、库存流水与调拨、采购单与入库、应收应付与收付款、报销、税率与价格策略；附带 AI 库存/采购/应收/现金流洞察，缺模型 Key 时规则式产出。",
  },
  "/developer/mechanisms": {
    title: "平台机制",
    description:
      "事件 Outbox 与 Webhook 订阅、CSV 导入与按模块导出、报表目录与规则引擎、公开分享、OIDC 身份源、附件共享策略，以及飞书 / 企微通讯录、考勤与消息同步。",
  },
  "/service-desk": {
    title: "AI客服",
    description:
      "账号级客服：一个账号可挂多个官网站点，访客从官网客服窗口进来，由本组织职员/代理人真人接待；AI 按设置做固定文案、回复建议或自动应答，自动模式可随时转人工，纯AI接待模式不转人工。",
  },
  "/notifications": {
    title: "系统消息",
    description:
      "全站需要你知道或处理的事件：客服、需求与商机、身份与签约、财税与申报、自动化与集成、账号与平台。",
  },
  "/developer/keys": {
    title: "API Key 管理",
    description:
      "两套 Key 分别管理：本系统 ek_ Key 用于调用开放接口（/api/v1），生成 / 重置 / 吊销都在本页；AIPDD API Key（sk-）在同一页绑定，开通同步发布到 AIworkin、服务商数据同步、建联资源等上游能力——没有账号时按页内三步引导：去 www.aipdd.work 注册（填推荐码赠算力）→ 创建 Key → 回来绑定，Key 加密保存永不回显。所在省 / 市等基础数据由平台统一 Key 提供（平台管理后台 → 系统设置 → AIPDD 平台 Key），不绑定也能填表单。",
  },
  "/content": {
    title: "内容创作小工具",
    description:
      "一屏工具卡片：文案、图片、视频、配音配乐、去水印与超分，末尾是「视频创作工具」（AIPDD Drama Agent，点卡片先看简介与网关配置——支持直接粘贴 AIPDD / AIworkin 的 API Key，那一页再去它的 GitHub Releases 下载）。生成结果自动存进本账号的 AIPDD 数字资产；模型与 Key 在「模型服务 → 模型设置」里配置。",
  },
  "/community": {
    title: "创意社区",
    description:
      "官方 Comfy Cloud 的工作流市场：按分类挑现成的图像 / 视频 / 音频 / 3D / 文本工作流，填参数即可在站内直接运行，跑的是你自己绑定的 Comfy Cloud API Key 与订阅积分（本站不代付算力，免费套餐不含 API 访问）；产物会自动转存进本站对象存储并登记进数字资产。也可以把工作流发布上来，审核通过并被推荐进市场后获得积分奖励。",
  },
  "/content/video-templates": {
    title: "视频模版社区",
    description:
      "视频模版市场：按使用量 / 最新 / 最多收藏排序与关键词查找；发布样片、参考图与提示词即可上架，查看配方可设积分（被查看即给发布者积分）。点「使用模版生成」把提示词与参考图带到生成器，选择自己的视频模型直接出片，成片自动登记进数字资产。",
  },
  "/assets": {
    title: "数字资产管理",
    description:
      "与 AIPDD 数字资产完全同步：按文件 / 图片 / 视频 / 音频查询、打标签，也可以直接上传资产（上传即登记到平台，本地不存副本）。",
  },
    "/model-plaza": {
    title: "模型广场",
    description:
      "平台统一上架的可用模型目录：按输入/输出分别标价（图像/语音按次），支持在线试用、查看我的调用用量与成本，并给出 OpenAI 兼容接入地址与 API Key 管理入口。",
  },
  "/model-settings": {
    title: "模型设置",
    description:
      "Agent 与内容创作共用的模型配置：AIPDD 内置渠道直接用「API Key 管理」里的 sk- Key，也可接入其他 OpenAI 兼容网关与火山 AI MediaKit，并为每种类型选定默认模型。",
  },
  "/developer/api-mcp-skill": {
    title: "API-MCP-Skill",
    description:
      "模型服务的统一入口：Skill 页签列出平台管理员生成的技能包，点开即可下载；MCP Server 页签给出接入地址、鉴权与工具清单；API 页签是本系统对外接口、渠道与错误码总览。",
  },
  "/admin": {
    title: "平台管理后台",
    description: "服务商备案与资质管理、签约监管、服务商能力开通及系统设置。",
  },
  // 各板块标题 / 说明与侧栏菜单同源（ADMIN_SECTIONS），顶栏与页面 hero 直接取这里。
  ...Object.fromEntries(
    ADMIN_SECTIONS.map((item) => [
      `${ADMIN_PATH_PREFIX}/${item.key}`,
      { title: item.name, description: item.desc },
    ]),
  ),
};
