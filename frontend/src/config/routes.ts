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

export type AdminSection = {
  key: string;
  name: string;
  icon: string;
  desc: string;
};

/**
 * 平台管理后台 = 独立平台（`/admin`）：板块是**侧栏菜单项 + 子路由**（不再用页面内页签），
 * 菜单、顶栏标题、页面 hero 文案同源，新增板块只改这一处。
 */
export const ADMIN_PATH_PREFIX = "/admin";

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    key: "overview",
    name: "总览",
    icon: "dashboard",
    desc: "平台数据总览、待办审核与服务商服务类型分布。",
  },
  {
    key: "users",
    name: "注册用户",
    icon: "team",
    desc: "本系统已识别的全部账号：用户名、昵称、邮箱、账号状态。",
  },
  {
    key: "enterprises",
    name: "企业用户",
    icon: "bank",
    desc: "已通过企业信息认证的用户（企业 / 个体工商户主体）。",
  },
  {
    key: "provider-applications",
    name: "服务商备案",
    icon: "file-done",
    desc: "服务商备案申请审核：通过后自动获得服务商角色，即可开展对应类目的业务服务。",
  },
  {
    key: "providers",
    name: "服务商管理",
    icon: "peoples",
    desc: "已通过备案的服务商与其服务类型资质：可逐项停用 / 恢复（通过即代表该类目资源可对外展示；停用则其资源同步下线并拦截该类型新建业务）。",
  },
  {
    key: "flex",
    name: "灵活用工",
    icon: "team",
    desc: "「灵工发薪」板块的平台级启停（默认启用；资源由服务商备案通过即展示，无需资源级平台审核）。",
  },
  {
    key: "contracts",
    name: "签约监管",
    icon: "contract",
    desc: "全部签约台账：企业、服务商、类目、期限与状态；平台管理员可解除生效中的签约。",
  },
  {
    key: "supply",
    name: "供销网络监管",
    icon: "network",
    desc: "服务站、商品订货与服务预约单的全平台监管总览。",
  },
  {
    key: "capabilities",
    name: "服务商能力开通",
    icon: "bolt",
    desc: "服务商提交的财税自动化付费开通申请审核；企业维度的开通 / 关闭与企享云账号匹配统一在「财税管理」处理。",
  },
  {
    key: "tax-admin",
    name: "财税管理",
    icon: "audit",
    desc: "企享云报税 API Key 账号池与税号匹配：新增账号、给企业税号匹配账号，并审核服务商提交的付费开通申请。",
  },
  {
    key: "geo",
    name: "GEO管理设置",
    icon: "search",
    desc: "监管每周 GEO 自动采集任务量：本周计划 / 实际完成（含周日未跑完顺延次日）与逐项目明细。采集平台 API Key 由每个账号在「营销工具 → GEO-AI引擎优化」里配自己的，后台看不到也不能替别人配置。",
  },
  {
    key: "marketing-livecode",
    name: "活码监管",
    icon: "qrcode",
    desc: "全平台活码清单：归属账号、当前入口域名与累计扫码；发现违规内容可下架，落地页立即显示「链接已停用」。",
  },
  {
    key: "community",
    name: "创意社区",
    icon: "audit",
    desc: "社区工作流审核与推荐，推荐后给发布者积分（规则可配）。",
  },
  {
    key: "points",
    name: "积分与充值",
    icon: "pay-circle",
    desc: "汇率与充值档位、注册/邀请奖励、赠送限额与风控；模块价目与用量、账户调整与充值订单。",
  },
  {
    key: "provider-display",
    name: "服务商展示与同步",
    icon: "shop",
    desc: "数据源在 AIworkin、展示权在本系统：同步策略（手动 / 定时）、立即同步、逐项展示开关与排序权重。",
  },
  {
    key: "settings",
    name: "系统设置",
    icon: "setting",
    desc: "文件存储（OSS）、AIPDD 平台 Key（基础数据）、平台级参数与站点设置：各板块以页签切换，站点设置保存后前端读取即时生效。企享云报税 API Key 与税号匹配统一在「财税管理」。",
  },
];

export const adminRoute: EnterpriseRoute = {
  path: "/",
  routes: [
    { path: "/", name: "高管驾驶舱", icon: "dashboard" },
    {
      type: "group",
      name: "平台管理",
      icon: "setting",
      routes: ADMIN_SECTIONS.map((item) => ({
        path: `${ADMIN_PATH_PREFIX}/${item.key}`,
        name: item.name,
        icon: item.icon,
      })),
    },
  ],
};

/**
 * 高管驾驶舱独立置顶，菜单按当前身份筛选。
 * 顺序：工作台 → 业务服务 → 商务人脉（商务社交 / 招聘） → 管理设置 → 开放集成 → AI增值服务。
 */
export const enterpriseRoute: EnterpriseRoute = {
  path: "/",
  routes: [
    { path: "/", name: "高管驾驶舱", icon: "dashboard" },
    {
      type: "group",
      name: "工作台",
      icon: "chip",
      routes: [
        { path: "/agent", name: "Agent", icon: "robot" },
        { path: "/workbuddy", name: "Workbuddy 企业云", icon: "robot" },
        { path: "/data-table", name: "多维表格", icon: "table" },
        { path: "/rpa", name: "RPA自动化", icon: "play" },
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
          ],
        },
        { path: "/marketing-tools", name: "营销工具", icon: "horn" },
        { path: "/assets", name: "数字资产管理", icon: "folder" },
        { path: "/mail", name: "AI邮箱服务", icon: "mail" },
        { path: "/crm", name: "CRM", icon: "team" },
        { path: "/bi", name: "BI智能分析", icon: "chart" },
        { path: "/oa", name: "OA", icon: "file-done" },
        { path: "/okr", name: "OKR计划", icon: "target" },
        { path: "/service-desk", name: "AI客服", icon: "peoples" },
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
      ],
    },
    /** 商务人脉成组（紧靠业务服务之后、管理设置之前）：商务社交与招聘各自一个入口。 */
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
      name: "管理设置",
      icon: "setting",
      routes: [
        { path: "/identity", name: "身份与资质", icon: "idcard" },
        { path: "/staff", name: "职员/代理人管理", icon: "peoples" },
        { path: "/contracts", name: "签约管理", icon: "contract" },
        // 账户级自助：积分充值与流水、邀请码与邀请记录，统一挂在「管理设置」下
        { path: "/points", name: "积分中心", icon: "pay-circle" },
        { path: "/invite", name: "我的邀请", icon: "gift" },
      ],
    },
    {
      type: "group",
      name: "开放集成",
      icon: "api",
      routes: [
        { path: "/developer/keys", name: "API Key 管理", icon: "key" },
        { path: "/model-settings", name: "模型设置", icon: "setting" },
        { path: "/developer/docs", name: "API 文档", icon: "book" },
        { path: "/developer/mcp", name: "MCP Server", icon: "api" },
      ],
    },
    {
      type: "group",
      name: "AI增值服务",
      icon: "chip",
      routes: [
        { path: "https://app.aipdd.work", name: "算力服务", icon: "bolt" },
        {
          path: "https://www.aiworkin.com",
          name: "A2A供需平台",
          icon: "link",
        },
      ],
    },
  ],
};

/**
 * 平台管理员侧栏隐藏的「开放集成」入口：API Key 管理（含 AIPDD API Key 绑定）与模型设置都是
 * 「当前账号」的自助配置，挂在平台后台里容易被误读成平台级设置（平台级配置统一在「系统设置」的
 * 企享云 / OSS / AIPDD 平台 Key 与站点设置页签里）。管理员要用这两页请切到企业 / 个人身份，
 * 只隐藏菜单入口，直接访问链接不受影响。
 */
const ADMIN_HIDDEN_INTEGRATION_PATHS = ["/developer/keys", "/model-settings"];

/**
 * 只用当前身份组织菜单；具备其他身份不会混入其管理入口。
 * 平台管理员侧栏只拼「平台管理」后台板块与工具菜单，不含「管理设置」分组（身份与资质 / 积分中心 / 我的邀请属个人账户视角），
 * 也不含「开放集成」里的账户级自助入口（见 ADMIN_HIDDEN_INTEGRATION_PATHS）。
 * 三个站点级显隐参数均来自后台「站点设置」，只控制菜单显示，直接访问链接不受影响：
 * - `hiddenBusinessPaths`：隐藏的业务服务菜单路径，全部隐藏后该分组自动消失；
 * - `hiddenIntegrationPaths`：隐藏的「开放集成」菜单路径（如 /developer/docs、/developer/mcp）；
 * - `hideAiServices`：「AI增值服务」分组整组隐藏。
 */
export function navigationFor(
  me: EnterpriseMe | null,
  hiddenBusinessPaths: string[] = [],
  hiddenIntegrationPaths: string[] = [],
  hideAiServices = false,
): EnterpriseRoute {
  if (!me) return { path: "/", routes: [] };
  const identity = me.currentIdentity;
  const hiddenBusiness = new Set(hiddenBusinessPaths);
  const hiddenIntegration = new Set(hiddenIntegrationPaths);
  // 先做站点级显隐（对管理员与普通用户一致生效），再交给身份分支组织菜单。
  const routes = enterpriseRoute.routes!
    .filter((route) => !(hideAiServices && route.name === "AI增值服务"))
    .map((route) =>
      route.name === "开放集成"
        ? {
            ...route,
            routes: route.routes!.filter(
              (child) => !hiddenIntegration.has(child.path || ""),
            ),
          }
        : route,
    );
  const management = routes.find((route) => route.name === "管理设置")!;
  const tools = routes
    .filter((route) => route.name === "AI增值服务" || route.name === "开放集成")
    .filter((route) => route.type !== "group" || Boolean(route.routes?.length));
  if (identity === "PLATFORM_ADMIN" && me.identities.includes("PLATFORM_ADMIN")) {
    // 平台管理员侧栏不带「管理设置」组：该组是个人账户视角的入口，管理员的账户级操作都在 /admin 内完成。
    // 「开放集成」里的 Key 绑定与模型配置同属账号级自助，管理员侧一并摘掉，避免与平台级配置混淆。
    const adminHiddenIntegration = new Set(ADMIN_HIDDEN_INTEGRATION_PATHS);
    const adminTools = tools
      .map((route) =>
        route.name === "开放集成"
          ? {
              ...route,
              routes: route.routes!.filter(
                (child) => !adminHiddenIntegration.has(child.path || ""),
              ),
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
            routes: route.routes!.filter(
              (child) =>
                isDomainOpened(opened, child.domain) &&
                !hiddenBusiness.has(child.path || ""),
            ),
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
  "/": { title: "高管驾驶舱", description: "身份与资质、我的待办与业务台账。" },
  "/data-table": {
    title: "多维表格",
    description:
      "按账号归属的自建结构化数据表：自定义列（八种类型）、逐条录入行数据，并可经 API Key 机器通道读写。",
  },
  "/rpa": {
    title: "RPA自动化",
    description:
      "按账号归属的云端 RPA：RPA 任务（建任务即绑定脚本＋账号＋运行参数）、RPA 账号（口令密文保存）、RPA 脚本（Automa JSON / JS / Python，可由 AIPDD 文字模型按需求生成），本地比特浏览器凭 API Key 认领执行并回传结果。",
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
  "/social": {
    title: "商务社交",
    description:
      "本地闭环的商务社交板块：结识同行人（好友/拉黑）、发布动态（公开/仅好友）、小组讨论（对标豆瓣：发现/加入小组、分类发帖、可逐条匿名、楼层回复与推荐、组长/管理员置顶加精与入组审批）、站内私信往来、维护与主页分叉的职场简历。全部在你的账号下读写，不受上游影响，账号被封禁时自动拦截。",
  },
  "/hiring": {
    title: "招聘",
    description:
      "本地闭环的招聘专区（移植 SNS 招聘专区）：发布全职/兼职/实习等岗位，进招聘广场信息流供全站浏览与站内私信对接，本系统不做简历投递。本地发布免费、无需绑定 APIKey；已绑定 AIPDD APIKey 时可将岗位同步为 AIworkin 的用工需求（类目固定取平台「灵活用工」子树）并镜像上游状态。",
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
  "/agent": {
    title: "Agent",
    description:
      "与模型对话直接产出图片/视频：生成结果自动存进本账号的 AIPDD 数字资产；「记忆」页签里既有 Agent 长期记忆，也有你在全站做过的操作留痕。模型与 Key 在「开放集成 → 模型设置」里配置。",
  },
  "/marketing-tools": {
    title: "营销工具",
    description:
      "十一个营销工具，首屏每个工具一张卡片、点卡片进入使用：达人建联（按类目 / 平台 / 粉丝数筛选达人并查看联系方式）、阿里云智能外呼（把多维表格名单映射导入阿里云智能外呼任务组）、阿里云邮件推送（把多维表格的联系人同步到阿里云收件人列表）、GEO-AI引擎优化（品牌在 AI 问答中的可见度报告与选题池，另含按语言与付费/免费筛选的发稿平台推荐与 GEO 建站入口，新窗口打开 AIworkin GEO 独立站看板）、Google 潜客线索挖掘（与 AI 对话明确挖掘条件，线索逐批写入多维表格）、企业数据 / 全球贸易大数据 / 全球商务人士大数据 / 全球达人大数据 / 全球POI大数据（各自独立：自然语言提数据需求，AI 解析后查询并逐批写入各自的多维表格）、AI销售管理-SalesBuddy（外部网站，点卡片新窗口打开 salesbuddy.top）。",
  },
  "/contracts": {
    title: "签约管理",
    description: "签约概览与全部签约（企业发起、服务商确认）。",
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
  "/identity": {
    title: "身份与资质",
    description: "用户信息提交即生效；服务商备案需审核；职员需绑定或挂靠。",
  },
  "/staff": {
    title: "职员/代理人管理",
    description: "团队概览、挂靠审批与在职职员。",
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
      "一屏工具卡片：文案、图片、视频、配音配乐、去水印与超分，末尾是「视频创作工具」（AIPDD Drama Agent，点卡片先看简介与网关配置——支持直接粘贴 AIPDD / AIworkin 的 API Key，那一页再去它的 GitHub Releases 下载）。生成结果自动存进本账号的 AIPDD 数字资产；模型与 Key 在「开放集成 → 模型设置」里配置。",
  },
  "/community": {
    title: "创意社区",
    description:
      "官方 Comfy Cloud 的工作流市场：按分类挑现成的图像 / 视频 / 音频 / 3D / 文本工作流，填参数即可在站内直接运行，跑的是你自己绑定的 Comfy Cloud API Key 与订阅积分（本站不代付算力，免费套餐不含 API 访问）；产物会自动转存进本站对象存储并登记进数字资产。也可以把工作流发布上来，审核通过并被推荐进市场后获得积分奖励。",
  },
  "/assets": {
    title: "数字资产管理",
    description:
      "与 AIPDD 数字资产完全同步：按文件 / 图片 / 视频 / 音频查询、打标签，也可以直接上传资产（上传即登记到平台，本地不存副本）。",
  },
    "/model-settings": {
    title: "模型设置",
    description:
      "Agent 与内容创作共用的模型配置：AIPDD 内置渠道直接用「API Key 管理」里的 sk- Key，也可接入其他 OpenAI 兼容网关与火山 AI MediaKit，并为每种类型选定默认模型。",
  },
  "/developer/docs": {
    title: "API 文档",
    description:
      "本系统实际对外提供的接口清单：由契约层派生，与 MCP 服务端 list_operations、OpenAPI 文档同源。",
  },
  "/developer/mcp": {
    title: "MCP Server",
    description:
      "本系统对外发布的 MCP 服务端：Codex、Claude Desktop、Cursor、自研脚本和 Workbuddy 用同一把 API Key 连进来，用户只给指令，服务端先分析本账号的智能体记忆再按授权自动执行本站动作。",
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
