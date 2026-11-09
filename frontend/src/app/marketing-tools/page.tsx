"use client";

import {
  AimOutlined,
  ArrowLeftOutlined,
  BarChartOutlined,
  BankOutlined,
  EnvironmentOutlined,
  FormOutlined,
  GiftOutlined,
  LinkOutlined,
  MailOutlined,
  PhoneOutlined,
  QrcodeOutlined,
  RiseOutlined,
  RobotOutlined,
  SendOutlined,
  ShoppingOutlined,
  SolutionOutlined,
  StarOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Button, Tag } from "antd";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  BIGDATA_DATASETS,
  BIGDATA_DATASET_KEYS,
  type BigdataDatasetKey,
} from "@enterprise/contracts";
import { PageHero, Panel } from "@/components/ui/panel";
import { ToolCard, ToolCardGrid } from "@/components/ui/tool-card";
import { AcquisitionTab } from "./_components/acquisition-tab";
import { ScrmTab } from "./_components/scrm-tab";
import { AliyunCallTab } from "./_components/aliyun-call-tab";
import { AliyunMailTab } from "./_components/aliyun-mail-tab";
import { BigdataQueryTab } from "./_components/bigdata-query-tab";
import { ConnectionsTab } from "./_components/connections-tab";
import { DistributionTab } from "./_components/distribution-tab";
import { SurveyTab } from "./_components/survey-tab";
import { GeoTab } from "./_components/geo-tab";
import { SeoTab } from "./_components/seo-tab";
import { LeadProspectingTab } from "./_components/lead-prospecting-tab";
import { LivecodeTab } from "./_components/livecode-tab";
import { MktSkillsTab } from "./_components/mkt-skills-tab";
import { TpCustomerTab } from "./_components/tp-customer-tab";
import { TpMemberTab } from "./_components/tp-member-tab";
import { TpWeworkTab } from "./_components/tp-wework-tab";

type ToolKey =
  | "overview"
  | "acquisition"
  | "scrm"
  | "connections"
  | "aliyun-call"
  | "aliyun-mail"
  | "geo"
  | "seo"
  | "livecode"
  | "tp-customer"
  | "tp-wework"
  | "tp-member"
  | "leads"
  | "distribution"
  | "survey"
  | "mkt-skills"
  | "salesbuddy"
  | BigdataDatasetKey;

type ToolCard = {
  key: ToolKey;
  name: string;
  icon: ReactNode;
  desc: string;
  /** 卡片所属分组：总览按业务动线分区，避免工具多到一屏找不到入口。 */
  group: ToolGroupKey;
  /** 外部工具：填了网址就新窗口打开该站，不进本页的工具视图。 */
  href?: string;
};

type ToolGroupKey = "acquisition" | "content" | "data" | "touch";

const TOOL_GROUPS: { key: ToolGroupKey; label: string; desc: string }[] = [
  { key: "acquisition", label: "获客与转化", desc: "找线索、加客户、把咨询变成商机" },
  { key: "content", label: "内容与搜索增长", desc: "写作、分发、SEO / GEO 与营销技能" },
  { key: "data", label: "数据与线索挖掘", desc: "按条件批量取数，结果沉淀到多维表格" },
  { key: "touch", label: "触达与客户运营", desc: "外呼、邮件、企点客户运营" },
];

/** AI 销售管理（SalesBuddy）：外部站点，点卡片直接跳转。 */
const SALESBUDDY_URL = "https://www.salesbuddy.top/";

/** 五个大数据集卡的图标（数据集本身的名字、列模板、示例都在契约注册表里）。 */
const BIGDATA_ICONS: Record<BigdataDatasetKey, ReactNode> = {
  enterprise: <BankOutlined aria-hidden />,
  buyer: <ShoppingOutlined aria-hidden />,
  person: <SolutionOutlined aria-hidden />,
  kol: <StarOutlined aria-hidden />,
  poi: <EnvironmentOutlined aria-hidden />,
};

/**
 * 五个独立的大数据营销工具：注册表顺序即卡片顺序，
 * 每个数据集有自己的设置、对话、任务列表与结果多维表格。
 */
const BIGDATA_TOOLS: ToolCard[] = BIGDATA_DATASET_KEYS.map((dataset) => {
  const definition = BIGDATA_DATASETS[dataset];
  return {
    key: dataset,
    name: definition.label,
    icon: BIGDATA_ICONS[dataset],
    group: "data",
    desc: `自然语言提数据需求，AI 解析成 ${definition.filters.length} 项筛选条件查询${definition.label}，结果按源数据ID 去重逐批写入「${definition.tableName}」多维表格。`,
  };
});

/** 自建工具卡片的展示顺序。 */
const TOOLS: ToolCard[] = [
  {
    key: "acquisition",
    name: "AI 获客",
    icon: <AimOutlined aria-hidden />,
    group: "acquisition",
    desc: "线索雷达 → 触达编排 → 客户档案 → 销售剧本 → 跟进计划 → 接待质检与获客看板；采集与私信/评论触达由 AIPDD Enterprise 插件在你已登录的平台页执行，服务端统一做评分、频控、内容安全、回执与用量计费。",
  },
  {
    key: "scrm",
    name: "企微 SCRM",
    icon: <RobotOutlined aria-hidden />,
    group: "acquisition",
    desc: "以企业微信为客户唯一同步源：客户与客户群、活码与欢迎语、自动打标、群发（人工确认不可关闭）、在职/离职继承、SOP、员工侧边栏 H5、敏感词与 AI 质检；启用后企点侧客户导入自动暂停，避免双写。",
  },
  {
    key: "connections",
    name: "达人建联",
    icon: <LinkOutlined aria-hidden />,
    group: "acquisition",
    desc: "调用 AIworkin 建联接口，按类目 / 平台 / 粉丝数筛选达人 · 社群 · 个人 · 企业并查看联系方式。",
  },
  {
    key: "aliyun-call",
    name: "阿里云智能外呼",
    icon: <PhoneOutlined aria-hidden />,
    group: "touch",
    desc: "选多维表格、映射列后把名单导入阿里云智能外呼；支持新建任务组或往已有任务组追加号码，并附完整操作指引。",
  },
  {
    key: "aliyun-mail",
    name: "阿里云邮件推送",
    icon: <MailOutlined aria-hidden />,
    group: "touch",
    desc: "选多维表格、映射邮箱列与模板变量后同步到阿里云收件人列表；可新建列表或追加，模板、域名与群发仍在阿里云控制台完成。",
  },
  {
    key: "geo",
    name: "GEO-AI引擎优化",
    icon: <BarChartOutlined aria-hidden />,
    group: "content",
    desc: "可见度报告、监控问题库、采集批次与选题池，可开启每周自动采集；另含发稿平台推荐（按语言、付费/免费筛选）与 GEO 建站入口。",
  },
  {
    key: "seo",
    name: "SEO 优化",
    icon: <RiseOutlined aria-hidden />,
    group: "content",
    desc: "传统搜索引擎侧工作台：站点体检、关键词研究与聚类、排名跟踪、竞品洞察、外链分析与建设、本地 SEO 网格、程序化页面、结构化数据与收录提交、SEO 报告。三层数据源——自有抓取免费、DataForSEO 你自带 Key 你付费、系统 AI 计积分；无 Key 不造假数据。",
  },
  {
    key: "mkt-skills",
    name: "营销技能库",
    icon: <ThunderboltOutlined aria-hidden />,
    group: "content",
    desc: "内置内容 / 社媒 / 邮件 / SEO / 广告 / 调研 / 销售 七类营销技能与品牌上下文：填参数即可运行，缺模型 Key 时规则式产出；结果沉淀为内容资产，支持渠道连接、能力调用与定时任务。",
  },
  {
    key: "distribution",
    name: "多平台内容分发",
    icon: <SendOutlined aria-hidden />,
    group: "content",
    desc: "一条内容同发 13 家图文/文章渠道：配套 AIPDD 浏览器插件在你已登录的浏览器里自动填充发布，逐平台结果回写台账，页内附插件下载安装说明。",
  },
  {
    key: "survey",
    name: "问卷设计与调研",
    icon: <FormOutlined aria-hidden />,
    group: "acquisition",
    desc: "逐题设计问卷（单选 / 多选 / 填空 / 数字 / 日期 / 评分），发布后生成免登录填写链接与二维码；每份回答自动写进问卷专属的多维表格，可筛选、导出并继续接飞书同步。",
  },
  {
    key: "livecode",
    name: "活码引流",
    icon: <QrcodeOutlined aria-hidden />,
    group: "acquisition",
    desc: "一个固定入口、多个子码：图片 / 链接 / 文本按随机、顺序或权重分发，支持按天与累计限额、同访客粘性、渠道统计；短链用你自己的域名（CDN 回源或官网脚本），域名池失效自动切换。",
  },
  {
    key: "tp-customer",
    name: "腾讯企点·客户数据",
    icon: <TeamOutlined aria-hidden />,
    group: "touch",
    desc: "自带企点凭据（企业ID / secretId / secretKey / 空间ID），做客户批量写入与查询、标签、分群导出、融合分析看板取数，并可按映射把企点客户写进本系统 CRM。",
  },
  {
    key: "tp-wework",
    name: "腾讯企点·企微运营",
    icon: <RobotOutlined aria-hidden />,
    group: "touch",
    desc: "企微官方活码、群发任务、跟进任务与会话质检；活码用于加好友 / 进群，与自建的「活码引流」（客户域名 + 短链）并存。",
  },
  {
    key: "tp-member",
    name: "腾讯企点·会员与触达",
    icon: <GiftOutlined aria-hidden />,
    group: "touch",
    desc: "会员与积分、券模板与发券、短信邮件模板与短链、群发任务，以及 RTA 人群上传（需先在企点绑定广告主）。",
  },
  {
    key: "leads",
    name: "Google 潜客线索挖掘",
    icon: <TeamOutlined aria-hidden />,
    group: "data",
    desc: "自带 Serper Key，与 AI 对话明确关键词 / 场景 / 国家 / 数量，后台搜索并提炼潜客线索，逐批写入多维表格。",
  },
  ...BIGDATA_TOOLS,
  {
    key: "salesbuddy",
    name: "AI销售管理-SalesBuddy",
    icon: <RobotOutlined aria-hidden />,
    group: "acquisition",
    desc: "AI 销售管理工具，点击直接新窗口打开 SalesBuddy 网站，账号、数据与用法在该网站完成。",
    href: SALESBUDDY_URL,
  },
];

const isBigdataTool = (key: ToolKey): key is BigdataDatasetKey =>
  key in BIGDATA_DATASETS;

/**
 * 营销工具（「工作台」栏目）：从「业务服务 → 营销服务」剥离出来的工具，
 * 加上五个独立的大数据查询工具。首屏每个工具一张卡片，点卡片进入该工具使用。
 */
export default function MarketingToolsPage() {
  const [tab, setTab] = useState<ToolKey>("overview");

  // 功能目录里的「企业微信 SCRM」用 ?tab=wecom-scrm 直达该卡片，避免落到总览再找一遍。
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested === "wecom-scrm") setTab("scrm");
  }, []);

  return (
    <>
      <PageHero
        title="营销工具"
        desc={`营销获客与内容自动化工具箱，${TOOLS.length} 个工具可单独使用：AI 获客（线索雷达 → 触达编排 → 客户档案 → 销售剧本 → 跟进计划 → 接待质检与获客看板，采集与私信/评论触达由 AIPDD Enterprise 插件在已登录的平台页执行）· 企微 SCRM（原生企微客户同步：客户与客户群、活码与欢迎语、自动打标、群发人工确认、在职/离职继承、SOP、员工侧边栏 H5、敏感词与 AI 质检；启用后企点客户导入自动暂停）· 达人建联（按类目 / 平台 / 粉丝数筛选达人并查看联系方式）· 阿里云智能外呼（选多维表格、映射列后把名单导入阿里云智能外呼，可新建任务组或往已有任务组追加号码）· 阿里云邮件推送（选多维表格、映射邮箱列与模板变量后同步到阿里云收件人列表，模板、域名与群发仍在阿里云控制台完成）· GEO-AI引擎优化（品牌在 AI 问答中的可见度报告与选题池，另含按语言与付费/免费筛选的发稿平台推荐与 GEO 建站入口，新窗口打开 AIworkin GEO 独立站看板）· SEO 优化（传统搜索引擎侧工作台：站点体检、关键词研究与聚类、排名跟踪、竞品洞察、外链分析与建设、本地 SEO 网格、程序化页面、结构化数据与收录提交、SEO 报告；三层数据源——自有抓取免费、DataForSEO 你自带 Key 你付费、系统 AI 计积分，无 Key 不造假数据）· 多平台内容分发（一条内容同发 13 家图文/文章渠道，配套 AIPDD Enterprise 浏览器插件在已登录的浏览器里自动填充发布，逐平台结果回写台账）· 问卷设计与调研（逐题设计、发布分享链接与二维码，回答自动写进问卷专属多维表格）· 活码引流（固定入口 + 多个子码按随机/顺序/权重分发，支持限额、同访客粘性与渠道统计，短链用你自己的域名）· 腾讯企点·客户数据 / 企微运营 / 会员与触达（自带企点凭据，客户与分群、企微活码与群发、会员积分与短信邮件触达，客户可写进本系统 CRM；Customer AI 与社媒聆听等只在控制台）· Google 潜客线索挖掘（与 AI 对话明确挖掘条件，线索逐批写入多维表格）· ${BIGDATA_TOOLS.map((tool) => tool.name).join(" / ")}（自然语言提数据需求，AI 解析后查询并写入各自的多维表格）· AI销售管理-SalesBuddy（AI 销售管理，点击直接新窗口打开 salesbuddy.top 网站）。潜客线索与大数据查询任务只按登录账号归属，且按数据集彼此独立；GEO 项目按创建账号与所属企业可见；阿里云外呼与邮件推送的 Key 也按登录账号各自配置。`}
        extra={
          tab !== "overview" ? (
            <Button
              icon={<ArrowLeftOutlined aria-hidden />}
              onClick={() => setTab("overview")}
            >
              返回工具总览
            </Button>
          ) : null
        }
      />

      {tab === "overview" ? (
        <div style={{ display: "grid", gap: 20 }}>
          {TOOL_GROUPS.map((group) => {
            const rows = TOOLS.filter((tool) => tool.group === group.key);
            if (!rows.length) return null;
            return (
              <Panel
                key={group.key}
                title={group.label}
                titleExtra={<span className="muted text-12">{group.desc}</span>}
                extra={<span className="muted text-12">{rows.length} 个工具</span>}
              >
                <ToolCardGrid>
                  {rows.map((tool) => (
                    <ToolCard
                      key={tool.key}
                      icon={tool.icon}
                      title={tool.name}
                      tag={tool.href ? <Tag>外部网站</Tag> : null}
                      description={tool.desc}
                      onClick={() =>
                        tool.href
                          ? window.open(tool.href, "_blank", "noopener,noreferrer")
                          : setTab(tool.key)
                      }
                    />
                  ))}
                </ToolCardGrid>
              </Panel>
            );
          })}
        </div>
      ) : (
        <>
          {tab === "acquisition" ? (
            <AcquisitionTab />
          ) : tab === "scrm" ? (
            <ScrmTab />
          ) : tab === "connections" ? (
            <ConnectionsTab />
          ) : tab === "aliyun-call" ? (
            <AliyunCallTab />
          ) : tab === "aliyun-mail" ? (
            <AliyunMailTab />
          ) : tab === "geo" ? (
            <GeoTab />
          ) : tab === "seo" ? (
            <SeoTab />
          ) : tab === "tp-customer" ? (
            <TpCustomerTab />
          ) : tab === "tp-wework" ? (
            <TpWeworkTab />
          ) : tab === "tp-member" ? (
            <TpMemberTab />
          ) : tab === "livecode" ? (
            <LivecodeTab />
          ) : tab === "leads" ? (
            <LeadProspectingTab />
          ) : tab === "mkt-skills" ? (
            <MktSkillsTab />
          ) : tab === "distribution" ? (
            <DistributionTab />
          ) : tab === "survey" ? (
            <SurveyTab />
          ) : isBigdataTool(tab) ? (
            // key＝数据集：切换工具时整块重挂，设置 / 对话 / 任务状态不跨数据集残留
            <BigdataQueryTab key={tab} dataset={tab} />
          ) : null}
        </>
      )}
    </>
  );
}
