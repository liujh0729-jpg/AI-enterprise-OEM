import { z } from "zod";

/**
 * 官网首页（未登录落地页）的内容契约：后端缺省值、管理端编辑、公开读取共用同一份结构。
 * 首页只保留「注册 / 登录」两个入口，不放站内菜单；页脚 ICP 等取自站点设置。
 */

export const homepageStatSchema = z.object({
  value: z.string(),
  label: z.string(),
});

export const homepageSceneSchema = z.object({
  tag: z.string(),
  title: z.string(),
  desc: z.string(),
  image: z.string(),
});

export const homepageServiceSchema = z.object({
  name: z.string(),
  desc: z.string(),
});

export const homepageStepSchema = z.object({
  title: z.string(),
  desc: z.string(),
});

export const homepageFaqSchema = z.object({
  q: z.string(),
  a: z.string(),
});

export const homepageSettingsSchema = z.object({
  hero: z.object({
    badge: z.string(),
    title: z.string(),
    /** 主标题里要高亮的词，需是 title 的子串。 */
    highlight: z.string(),
    subtitle: z.string(),
    primaryLabel: z.string(),
    secondaryLabel: z.string(),
    image: z.string(),
    stats: z.array(homepageStatSchema),
  }),
  scenes: z.object({
    title: z.string(),
    subtitle: z.string(),
    items: z.array(homepageSceneSchema),
  }),
  services: z.object({
    title: z.string(),
    subtitle: z.string(),
    items: z.array(homepageServiceSchema),
  }),
  integration: z.object({
    title: z.string(),
    subtitle: z.string(),
    points: z.array(z.string()),
  }),
  steps: z.object({
    title: z.string(),
    subtitle: z.string(),
    items: z.array(homepageStepSchema),
  }),
  faq: z.object({
    title: z.string(),
    items: z.array(homepageFaqSchema),
  }),
  cta: z.object({
    title: z.string(),
    subtitle: z.string(),
    primaryLabel: z.string(),
    secondaryLabel: z.string(),
  }),
  footer: z.object({
    slogan: z.string(),
    /** 支持 {year} 占位，渲染时替换为当前年份。 */
    copyright: z.string(),
  }),
  sections: z.object({
    scenes: z.boolean(),
    services: z.boolean(),
    integration: z.boolean(),
    steps: z.boolean(),
    faq: z.boolean(),
    cta: z.boolean(),
  }),
});

export type HomepageStat = z.infer<typeof homepageStatSchema>;
export type HomepageScene = z.infer<typeof homepageSceneSchema>;
export type HomepageServiceItem = z.infer<typeof homepageServiceSchema>;
export type HomepageStep = z.infer<typeof homepageStepSchema>;
export type HomepageFaq = z.infer<typeof homepageFaqSchema>;
export type HomepageSettings = z.infer<typeof homepageSettingsSchema>;

/**
 * 内置默认内容：后端未保存过配置时直接返回它，前端首帧也用它兜底，
 * 保证首页在配置接口异常时仍然是完整可用的静态页。
 */
export const DEFAULT_HOMEPAGE: HomepageSettings = {
  hero: {
    badge: "AI 原生 · 企业服务操作系统",
    title: "一个平台，办完企业所有事。",
    highlight: "企业所有事",
    subtitle:
      "从营销获客、内容创作到财税、出海、物流、法律、知产与用工，身份资质、签约与办理在同一条流程里完成。一个账号，连接企业全生命周期。",
    primaryLabel: "免费注册",
    secondaryLabel: "登录工作台",
    image: "/home/hero.webp",
    stats: [
      { value: "15+", label: "企业服务板块" },
      { value: "60+", label: "MCP 开放动作" },
      { value: "1 个", label: "账号打通全流程" },
    ],
  },
  scenes: {
    title: "探索企业服务的全部场景",
    subtitle: "一个账号，覆盖从日常经营到全球增长的关键环节。",
    items: [
      {
        tag: "营销获客",
        title: "从内容种草到线索成交",
        desc: "达人探店、直播带货、多平台内容分发与 GEO 优化协同获客，线索自动沉淀进 CRM，跟进与转化全程可追踪。",
        image: "/home/scene-tax.webp",
      },
      {
        tag: "跨境出海",
        title: "从注册到退税的一站式出海",
        desc: "海外公司注册、跨境结算、税务合规、出口资质与海外银行开户，服务商按地域与类目精准承接。",
        image: "/home/scene-global.webp",
      },
      {
        tag: "AI 内容与营销",
        title: "让内容生产与投放跑在一条线上",
        desc: "内容创作、视频模版、多平台分发与 GEO-AI 引擎优化，配合 Agent 完成从灵感到交付的全流程。",
        image: "/home/scene-ai.webp",
      },
    ],
  },
  services: {
    title: "一个账号，连接企业全生命周期",
    subtitle: "十二个业务服务板块，需求发布、服务商匹配、签约与履约全流程在线。",
    items: [
      { name: "营销服务", desc: "达人探店、直播带货、内容营销与 GEO 优化" },
      { name: "供销网络", desc: "订货、预约与服务站协同的供销链路" },
      { name: "财税服务", desc: "记账、申报、开票与账套自动化" },
      { name: "跨境出海", desc: "公司注册、结算、税务合规与银行开户" },
      { name: "灵活用工", desc: "灵工发薪、进件审核与用工合规" },
      { name: "物流服务", desc: "国内干线、跨境物流与签收跟单" },
      { name: "IT服务", desc: "智能硬件接入、系统交付与运维" },
      { name: "知识产权", desc: "商标、专利与版权申请及维权" },
      { name: "法律服务", desc: "合同审查、合规咨询与争议解决" },
      { name: "智库服务", desc: "行业研究、战略咨询与专项报告" },
      { name: "资产交易", desc: "资产发布、看样与交易撮合" },
      { name: "供需市场", desc: "需求与服务的公开撮合大厅" },
    ],
  },
  integration: {
    title: "开放集成，把能力接入你的系统",
    subtitle: "同一套账号与权限，既能给人用，也能给 AI 和系统调用。",
    points: [
      "MCP Server：按业务域开放的 60+ 动作，Agent 可直接发现并调用。",
      "API-MCP-Skill：下载平台生成的技能包，导入支持 Skills 的客户端。",
      "统一 ek_ Key：开放接口、模型广场与 MCP 共用一套鉴权与用量计量。",
    ],
  },
  steps: {
    title: "四步开始",
    subtitle: "注册、完善资料、选择服务，剩下的交给平台协同。",
    items: [
      { title: "创建账号", desc: "注册即进入工作台，浏览全部板块与开放能力。" },
      {
        title: "完善身份与资质",
        desc: "按企业、个体工商户或个人主体提交材料，解锁签约与办理。",
      },
      {
        title: "发布需求或选择服务",
        desc: "在业务板块发布需求，或直接选择备案服务商承接。",
      },
      {
        title: "在一个工作台里协同",
        desc: "签约、履约、票据与消息提醒集中呈现，Agent 随时协助。",
      },
    ],
  },
  faq: {
    title: "常见问题",
    items: [
      {
        q: "注册后可以直接使用全部板块吗？",
        a: "注册后即可进入工作台浏览全部板块。签约、申报、账套与发布需求需要完成企业或个体工商户身份认证；服务商与职员身份按备案审核和绑定规则开通。",
      },
      {
        q: "注册和登录分别去哪里？",
        a: "注册进入账号注册页，登录进入登录页；登录成功后统一回到高管驾驶舱。",
      },
      {
        q: "外报凭据会被明文展示吗？",
        a: "电子税务局与电子口岸凭据密文存储，仅在办理申报、开票等流程内使用，不会在页面明文回显。",
      },
      {
        q: "能给外部系统或 AI 使用吗？",
        a: "可以。通过开放集成里的 API、MCP Server 与 Skill 包，用同一套 ek_ Key 与权限体系接入。",
      },
    ],
  },
  cta: {
    title: "把企业经营放进一个工作台",
    subtitle: "注册即进入工作台；已有账号直接登录。",
    primaryLabel: "免费注册",
    secondaryLabel: "已有账号，去登录",
  },
  footer: {
    slogan: "AI 原生企业服务操作系统",
    copyright: "© {year} 企业服务工作台 · 保留所有权利",
  },
  sections: {
    scenes: true,
    services: true,
    integration: true,
    steps: true,
    faq: true,
    cta: true,
  },
};
