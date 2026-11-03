"use client";
import { marketingViewSchema } from '@enterprise/contracts';

import {
  NotificationOutlined,
  TagOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { DatePicker, Form, Input, Select } from "antd";
import { useState } from "react";
import { CategoryField } from "@/components/category-field";
import { useDemandBoard } from "@/components/demand-board";
import { type DemandFields } from "@/components/demand-columns";
import { DemandPage } from "@/components/demand-page";
import {
  RegionScopeFields,
  regionFormValues,
} from "@/components/location-fields";
import { ProviderDirectoryTab } from "@/components/provider-directory-tab";
import {
  ServicePublishTab,
  serviceMarketTab,
} from "@/components/service-publish-tab";
import {
  type HeroTab,
} from "@/components/ui/panel";
import { canWorkOn } from "@/lib/can-work-on";
import { MARKETING_SUB_ITEMS } from "@/lib/provider-categories";
import { useSession } from "@/lib/session";

type MarketingRow=import('@enterprise/contracts').MarketingRow;

/** 本地台账列 → AIworkin 需求字段（§7.3 口径），使列表表头与提交表单逐项一致。 */
const toDemand = (row: MarketingRow): DemandFields => ({
  orderNo: row.orderNo,
  listingId: row.platformListingId,
  createdAt: row.createdAt,
  category1: row.category1,
  category2: row.category2,
  title: row.title,
  description: row.description,
  tags: row.tags,
  budget: row.budget,
  expectedOutcome: row.expectedResult,
  mustHaves: row.mustConditions,
  startAt: row.expectStart,
  deadline: row.deadline,
  regionScope: row.regionScope,
  contactName: row.contactName,
  contactPhone: row.contactPhone,
  contactWechat: row.contactWechat,
  contactEmail: row.contactEmail,
  providerContactName: row.providerContactName,
  providerContactPhone: row.providerContactPhone,
  emailSync: row.emailSync,
});

export default function MarketingPage() {
  const { me } = useSession();

  const roles = me?.roles || [];
  const isEnterprise = roles.includes("ENTERPRISE_USER");
  const isProvider =
    roles.includes("SERVICE_PROVIDER") || (me?.staffOf || []).length > 0;
  const isAdmin = roles.includes("PLATFORM_ADMIN");
  /** 回复公开池需求是机构级动作（后端 requireRoles SERVICE_PROVIDER）：仅服务商账号本人可见 */
  const canAcceptDemand = roles.includes("SERVICE_PROVIDER");
  const [tab, setTab] = useState("requests");
  const tabs: HeroTab[] = [
    { key: "requests", label: <><UnorderedListOutlined aria-hidden /> 需求信息</> },
    // 资源库页签恒排末尾（全站口径）：达人建联 / GEO-AI引擎优化（含 GEO 建站）/ 潜客挖掘已迁至「工作台 → 营销工具」
    { key: "providers", label: <><TagOutlined aria-hidden /> 营销服务商</> },
    serviceMarketTab("营销服务市集"),
  ];

  const board = useDemandBoard<MarketingRow>({
    autoLoad: tab === "requests",
    rowSchema:marketingViewSchema,
    endpoint: "/enterprise/marketing",
    // 服务商侧取「按机构可见」的需求集合：后端按 as=provider 收窄
    listParams: isProvider ? { as: "provider" } : undefined,
    rowId: (row) => row.id,
    rowNo: (row) => row.orderNo,
    rowTitle: (row) => row.title,
    toDemand,
    formValues: (row) => ({
      title: row.title,
      sub_category_id: row.subCategoryId || "",
      description: row.description || "",
      tags: row.tags || "",
      budget: row.budget || "",
      expected_result: row.expectedResult || "",
      must_conditions: row.mustConditions || "",
      // 编辑态日期用文本回填（避免引入 dayjs 依赖），提交时按 YYYY-MM-DD 透传
      expect_start: row.expectStart || "",
      deadline: row.deadline || "",
      ...regionFormValues(row),
      contact_name: row.contactName || "",
      contact_phone: row.contactPhone || "",
      contact_wechat: row.contactWechat || "",
      contact_email: row.contactEmail || "",
    }),
    createdTip: "营销需求已发布，可在需求消息中跟进服务商接收对接",
    editPasswordTitle: "修改营销需求（需密码）",
    removePasswordTitle: "删除营销需求",
  });

  /**
   * 服务商侧是否给出「回复」入口：只看身份，不看本地 `status` / 承接人 ——
   * 同一条需求可由多家服务商各自回复，能否回复由接口判定。
   */
  const canReply = !isAdmin && canAcceptDemand;

  /** 承办方判定（对齐后端 identity.canWorkOn）：已指派承办职员时由其作业，服务商账号不代替。 */
  const canViewMessages = (row: MarketingRow) =>
    isAdmin ||
    row.createdBy === (me?.userId || "") ||
    canWorkOn(me, row, isAdmin) ||
    canReply;

  /** 与后端 requireOwner 同口径：只有创建人或平台管理员能改删；可改状态由接口判定。 */
  const canManage = (row: MarketingRow) =>
    Boolean(isAdmin || (me?.userId && row.createdBy === me.userId));

  return (
    <DemandPage<MarketingRow>
      hero={{
        title: "营销服务",
        desc: `营销服务两个板块：营销服务商（平台备案服务商名录 → 企业按六大营销细项分别发起签约）· 需求信息（${
          isEnterprise
            ? "提交营销需求后，服务商在消息通道直接回复即接收对接"
            : "服务商直接回复企业需求即接收对接，无需先点接收"
        }）。达人建联、GEO-AI引擎优化（含发稿平台推荐与 GEO 建站入口）、Google 潜客线索挖掘三个工具已迁至「工作台 → 营销工具」。`,
      }}
      tabs={tabs}
      activeTab={tab}
      onTabChange={setTab}
      board={board}
      toDemand={toDemand}
      serviceTab={<ServicePublishTab domain="MARKETING" pool />}
      providersTab={
        <ProviderDirectoryTab
          serviceType="MARKETING"
          title="营销服务商（平台备案服务商名录）"
          badge="已通过平台备案审核的营销服务商；按六大营销细项分区展示，企业对单个细项分别发起签约、服务商确认后生效"
          subItems={MARKETING_SUB_ITEMS}
          locationFilter
          selfHint="您当前以服务商身份查看：名录展示同类目的其他已备案服务商，您自己的机构无需向自己发起签约。"
        />
      }
      demand={{
        panelTitle: "营销需求（达人探店 / 直播带货 · 需求信息通道）",
        createLabel: "提交营销需求",
        emptyIcon: <NotificationOutlined aria-hidden />,
        emptyText: isEnterprise
          ? "暂无营销需求，提交达人探店/直播带货需求，服务商直接回复即接收对接"
          : "暂无营销需求，等待企业提交营销需求",
        canPost: isEnterprise,
        canReply: () => canReply,
        canView: canViewMessages,
        canManage,
        editTitle: (row) => `修改营销需求 · ${row.orderNo}`,
        formWidth: 760,
        channelDescription:
          "需求消息通道：客户发起需求 → 服务商直接回复方案与报价即接收对接（无需先点接收）→ 双方往来沟通。",
      }}
      formBody={(editing) => (
        <>
          <Form.Item
            name="title"
            label="需求标题 *"
            rules={[{ required: true, message: "请填写需求标题" }]}
          >
            <Input placeholder="如：新店开业达人探店种草视频" />
          </Form.Item>
          <div className="form-2col">
            <CategoryField domain="MARKETING" />
          </div>
          <Form.Item name="description" label="详细说明">
            <Input.TextArea
              rows={2}
              placeholder="门店位置、产品卖点、目标人群、期望平台（如抖音/小红书）、内容要求等"
            />
          </Form.Item>
          <div className="form-2col">
            <Form.Item name="tags" label="标签">
              <Input placeholder="如：本地生活、3C 品类、急需（逗号分隔）" />
            </Form.Item>
            <Form.Item name="budget" label="预算">
              <Input placeholder="如：8000-12000 元 / 面议" />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="expected_result" label="期望结果">
              <Input placeholder="如：单条视频 50 万曝光、到店核销 200 单" />
            </Form.Item>
            <Form.Item name="must_conditions" label="必须满足条件">
              <Input placeholder="如：本地生活类达人（粉丝 10 万+）、可到店实拍" />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="expect_start" label="期望开始时间">
              {editing ? (
                <Input placeholder="YYYY-MM-DD，如 2026-10-20" />
              ) : (
                <DatePicker
                  style={{ width: "100%" }}
                  placeholder="如：2026-10-20"
                />
              )}
            </Form.Item>
            <Form.Item name="deadline" label="截止时间">
              {editing ? (
                <Input placeholder="YYYY-MM-DD，如 2026-10-18" />
              ) : (
                <DatePicker
                  style={{ width: "100%" }}
                  placeholder="如：2026-10-18"
                />
              )}
            </Form.Item>
          </div>
          <RegionScopeFields />
          <div className="form-2col">
            <Form.Item name="contact_name" label="联系人">
              <Input placeholder="联系人" />
            </Form.Item>
            <Form.Item name="contact_phone" label="手机">
              <Input placeholder="手机" />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="contact_wechat" label="微信">
              <Input placeholder="微信（选填）" />
            </Form.Item>
            <Form.Item name="contact_email" label="邮箱">
              <Input placeholder="邮箱（选填）" />
            </Form.Item>
          </div>
          <Form.Item
            name="email_sync"
            label="请把对方回复的内容同步发送到我的邮箱"
          >
            <Select
              options={[
                { value: "0", label: "不发送" },
                { value: "1", label: "发送" },
              ]}
            />
          </Form.Item>
        </>
      )}
    />
  );
}
