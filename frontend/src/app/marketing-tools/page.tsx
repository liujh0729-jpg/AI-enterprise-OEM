"use client";

import {
  ArrowLeftOutlined,
  BarChartOutlined,
  BankOutlined,
  EnvironmentOutlined,
  GiftOutlined,
  LinkOutlined,
  MailOutlined,
  PhoneOutlined,
  QrcodeOutlined,
  RobotOutlined,
  SendOutlined,
  ShoppingOutlined,
  SolutionOutlined,
  StarOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Button, Tag } from "antd";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  BIGDATA_DATASETS,
  BIGDATA_DATASET_KEYS,
  type BigdataDatasetKey,
} from "@enterprise/contracts";
import { PageHero } from "@/components/ui/panel";
import { ToolCard, ToolCardGrid } from "@/components/ui/tool-card";
import { AliyunCallTab } from "./_components/aliyun-call-tab";
import { AliyunMailTab } from "./_components/aliyun-mail-tab";
import { BigdataQueryTab } from "./_components/bigdata-query-tab";
import { ConnectionsTab } from "./_components/connections-tab";
import { DistributionTab } from "./_components/distribution-tab";
import { GeoTab } from "./_components/geo-tab";
import { LeadProspectingTab } from "./_components/lead-prospecting-tab";
import { LivecodeTab } from "./_components/livecode-tab";
import { TpCustomerTab } from "./_components/tp-customer-tab";
import { TpMemberTab } from "./_components/tp-member-tab";
import { TpWeworkTab } from "./_components/tp-wework-tab";

type ToolKey =
  | "overview"
  | "connections"
  | "aliyun-call"
  | "aliyun-mail"
  | "geo"
  | "livecode"
  | "tp-customer"
  | "tp-wework"
  | "tp-member"
  | "leads"
  | "distribution"
  | "salesbuddy"
  | BigdataDatasetKey;

type ToolCard = {
  key: ToolKey;
  name: string;
  icon: ReactNode;
  desc: string;
  /** 外部工具：填了网址就新窗口打开该站，不进本页的工具视图。 */
  href?: string;
};

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
    desc: `自然语言提数据需求，AI 解析成 ${definition.filters.length} 项筛选条件查询${definition.label}，结果按源数据ID 去重逐批写入「${definition.tableName}」多维表格。`,
  };
});

/** 自建工具卡片的展示顺序。 */
const TOOLS: ToolCard[] = [
  {
    key: "connections",
    name: "达人建联",
    icon: <LinkOutlined aria-hidden />,
    desc: "调用 AIworkin 建联接口，按类目 / 平台 / 粉丝数筛选达人 · 社群 · 个人 · 企业并查看联系方式。",
  },
  {
    key: "aliyun-call",
    name: "阿里云智能外呼",
    icon: <PhoneOutlined aria-hidden />,
    desc: "选多维表格、映射列后把名单导入阿里云智能外呼；支持新建任务组或往已有任务组追加号码，并附完整操作指引。",
  },
  {
    key: "aliyun-mail",
    name: "阿里云邮件推送",
    icon: <MailOutlined aria-hidden />,
    desc: "选多维表格、映射邮箱列与模板变量后同步到阿里云收件人列表；可新建列表或追加，模板、域名与群发仍在阿里云控制台完成。",
  },
  {
    key: "geo",
    name: "GEO-AI引擎优化",
    icon: <BarChartOutlined aria-hidden />,
    desc: "可见度报告、监控问题库、采集批次与选题池，可开启每周自动采集；另含发稿平台推荐（按语言、付费/免费筛选）与 GEO 建站入口。",
  },
  {
    key: "distribution",
    name: "多平台内容分发",
    icon: <SendOutlined aria-hidden />,
    desc: "一条内容同发 13 家图文/文章渠道：配套 AIPDD 浏览器插件在你已登录的浏览器里自动填充发布，逐平台结果回写台账，页内附插件下载安装说明。",
  },
  {
    key: "livecode",
    name: "活码引流",
    icon: <QrcodeOutlined aria-hidden />,
    desc: "一个固定入口、多个子码：图片 / 链接 / 文本按随机、顺序或权重分发，支持按天与累计限额、同访客粘性、渠道统计；短链用你自己的域名（CDN 回源或官网脚本），域名池失效自动切换。",
  },
  {
    key: "tp-customer",
    name: "腾讯企点·客户数据",
    icon: <TeamOutlined aria-hidden />,
    desc: "自带企点凭据（企业ID / secretId / secretKey / 空间ID），做客户批量写入与查询、标签、分群导出、融合分析看板取数，并可按映射把企点客户写进本系统 CRM。",
  },
  {
    key: "tp-wework",
    name: "腾讯企点·企微运营",
    icon: <RobotOutlined aria-hidden />,
    desc: "企微官方活码、群发任务、跟进任务与会话质检；活码用于加好友 / 进群，与自建的「活码引流」（客户域名 + 短链）并存。",
  },
  {
    key: "tp-member",
    name: "腾讯企点·会员与触达",
    icon: <GiftOutlined aria-hidden />,
    desc: "会员与积分、券模板与发券、短信邮件模板与短链、群发任务，以及 RTA 人群上传（需先在企点绑定广告主）。",
  },
  {
    key: "leads",
    name: "Google 潜客线索挖掘",
    icon: <TeamOutlined aria-hidden />,
    desc: "自带 Serper Key，与 AI 对话明确关键词 / 场景 / 国家 / 数量，后台搜索并提炼潜客线索，逐批写入多维表格。",
  },
  ...BIGDATA_TOOLS,
  {
    key: "salesbuddy",
    name: "AI销售管理-SalesBuddy",
    icon: <RobotOutlined aria-hidden />,
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

  return (
    <>
      <PageHero
        title="营销工具"
        desc={`营销获客与内容自动化工具箱，${TOOLS.length} 个工具可单独使用：达人建联（按类目 / 平台 / 粉丝数筛选达人并查看联系方式）· 阿里云智能外呼（选多维表格、映射列后把名单导入阿里云智能外呼，可新建任务组或往已有任务组追加号码）· 阿里云邮件推送（选多维表格、映射邮箱列与模板变量后同步到阿里云收件人列表，模板、域名与群发仍在阿里云控制台完成）· GEO-AI引擎优化（品牌在 AI 问答中的可见度报告与选题池，另含按语言与付费/免费筛选的发稿平台推荐与 GEO 建站入口，新窗口打开 AIworkin GEO 独立站看板）· 多平台内容分发（一条内容同发 13 家图文/文章渠道，配套 AIPDD Enterprise 浏览器插件在已登录的浏览器里自动填充发布，逐平台结果回写台账）· 活码引流（固定入口 + 多个子码按随机/顺序/权重分发，支持限额、同访客粘性与渠道统计，短链用你自己的域名）· 腾讯企点·客户数据 / 企微运营 / 会员与触达（自带企点凭据，客户与分群、企微活码与群发、会员积分与短信邮件触达，客户可写进本系统 CRM；Customer AI 与社媒聆听等只在控制台）· Google 潜客线索挖掘（与 AI 对话明确挖掘条件，线索逐批写入多维表格）· ${BIGDATA_TOOLS.map((tool) => tool.name).join(" / ")}（自然语言提数据需求，AI 解析后查询并写入各自的多维表格）· AI销售管理-SalesBuddy（AI 销售管理，点击直接新窗口打开 salesbuddy.top 网站）。潜客线索与大数据查询任务只按登录账号归属，且按数据集彼此独立；GEO 项目按创建账号与所属企业可见；阿里云外呼与邮件推送的 Key 也按登录账号各自配置。`}
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
        <ToolCardGrid>
          {TOOLS.map((tool) => (
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
      ) : (
        <>
          {tab === "connections" ? (
            <ConnectionsTab />
          ) : tab === "aliyun-call" ? (
            <AliyunCallTab />
          ) : tab === "aliyun-mail" ? (
            <AliyunMailTab />
          ) : tab === "geo" ? (
            <GeoTab />
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
          ) : tab === "distribution" ? (
            <DistributionTab />
          ) : isBigdataTool(tab) ? (
            // key＝数据集：切换工具时整块重挂，设置 / 对话 / 任务状态不跨数据集残留
            <BigdataQueryTab key={tab} dataset={tab} />
          ) : null}
        </>
      )}
    </>
  );
}
