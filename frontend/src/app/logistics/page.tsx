"use client";
import { logisticsViewSchema } from '@enterprise/contracts';

import { InboxOutlined, TagOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { DatePicker, Form, Input, Select } from "antd";
import { useState } from "react";
import { CategoryField } from "@/components/category-field";
import { toDateInput, useDemandBoard } from "@/components/demand-board";
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
import { type HeroTab } from "@/components/ui/panel";
import { isProviderAccount } from "@/lib/can-work-on";
import { LOGISTICS_SUB_ITEMS } from "@/lib/provider-categories";
import { useSession } from "@/lib/session";

type LogisticsRow=import('@enterprise/contracts').LogisticsRow;

/**
 * 本地台账列 → AIworkin 需求字段（§7.3 口径）。
 * 注意：`origin` 存的是表单的「地域范围」（create 里 region_scope 落此列），
 * demo 时代的「路线」列（origin → destination）与表单字段对不上，已按接口口径归位。
 */
const toDemand = (row: LogisticsRow): DemandFields => ({
  orderNo: row.orderNo,
  listingId: row.platformListingId,
  createdAt: row.createdAt,
  category1: row.category1,
  category2: row.category2,
  title: row.title,
  description: row.remark,
  tags: row.tags,
  budget: row.budgetType,
  expectedOutcome: row.expectedResult,
  mustHaves: row.mustConditions,
  startAt: row.expectedDate,
  deadline: row.deadline,
  regionScope: row.origin,
  contactName: row.contactName,
  contactPhone: row.contactPhone,
  contactWechat: row.contactWechat,
  contactEmail: row.contactEmail,
  providerContactName: row.providerContactName,
  providerContactPhone: row.providerContactPhone,
  emailSync: row.emailSync,
});

const formValues = (row: LogisticsRow) => ({
  title: row.title,
  sub_category_id: row.subCategoryId || "",
  description: row.remark || "",
  tags: row.tags || "",
  budget: row.budgetType || "",
  expected_result: row.expectedResult || "",
  must_conditions: row.mustConditions || "",
  // 编辑态日期用文本回填（避免引入 dayjs 依赖），提交时按 YYYY-MM-DD 透传
  expect_start: row.expectedDate || "",
  deadline: row.deadline || "",
  ...regionFormValues(row),
  contact_name: row.contactName || "",
  contact_phone: row.contactPhone || "",
  contact_wechat: row.contactWechat || "",
  contact_email: row.contactEmail || "",
});

const buildBody = (values: Record<string, unknown>) => ({
  ...values,
  expect_start: toDateInput(values.expect_start),
  deadline: toDateInput(values.deadline),
  email_sync: values.email_sync || "0",
});

export default function LogisticsPage() {
  const { me } = useSession();
  // 身份决定「该做什么、能做什么」：企业发需求，物流服务商在需求消息中回复，管理员监管
  const identity = me?.currentIdentity || "ENTERPRISE_USER";
  const isAdmin = Boolean(me?.identities?.includes("PLATFORM_ADMIN"));
  const isEnterprise =
    identity === "ENTERPRISE_USER" || (!isAdmin && identity !== "SERVICE_PROVIDER" && identity !== "PROVIDER_STAFF");
  /** 回复公开池工单是机构级动作（后端 requireRoles SERVICE_PROVIDER）：仅服务商账号本人可见 */
  const canAcceptOrder = isProviderAccount(me);
  const [tab, setTab] = useState("requests");
  const tabs: HeroTab[] = [
    { key: "requests", label: <><UnorderedListOutlined aria-hidden /> 需求信息</> },
    { key: "providers", label: <><TagOutlined aria-hidden /> 物流服务商</> },
    // 「物流服务市集」＝原「服务发布」栏目（2026-10-28 口径：市集就是服务发布）；
    // 资源库/名录页签之后，全站同位置。「发布服务」按钮仍按备案类目门控（组件内判定）。
    serviceMarketTab("物流服务市集"),
  ];
  const myUserId = me?.userId || "";

  const board = useDemandBoard<LogisticsRow>({
    rowSchema:logisticsViewSchema,
    endpoint: "/enterprise/logistics",
    rowId: (row) => row.id,
    rowNo: (row) => row.orderNo,
    rowTitle: (row) => row.title,
    toDemand,
    formValues,
    buildBody,
    createdTip: "需求已提交",
    editPasswordTitle: "修改物流需求（需密码）",
    removePasswordTitle: "删除物流需求",
  });

  /** 与后端 requireOwner 同口径：只有创建人或平台管理员能改删；可改状态由接口判定。 */
  const canManage = (row: LogisticsRow) =>
    Boolean(isAdmin || (myUserId && row.createdBy === myUserId));

  /**
   * 服务商侧是否给出「回复」入口：只看身份，不看本地 `status` / 承接人 ——
   * 同一条需求可由多家服务商各自回复，能否回复由接口判定。
   */
  const canReply = !isAdmin && canAcceptOrder;

  return (
    <DemandPage<LogisticsRow>
      hero={{
        title: "物流服务",
        desc: "物流服务商（平台备案服务商名录，按「境内陆运 / 跨境货代 / 仓储」分区 → 企业按细项发起签约，同一细项不限服务商）· 需求信息（境内陆运 / 跨境货代需求消息通道：企业提交需求，已签约服务商自动直派，未签约进入公开需求池，服务商直接回复即接单）。",
      }}
      tabs={tabs}
      activeTab={tab}
      onTabChange={setTab}
      board={board}
      toDemand={toDemand}
      serviceTab={<ServicePublishTab domain="LOGISTICS" pool />}
      providersTab={
        <ProviderDirectoryTab
          serviceType="LOGISTICS"
          title="物流服务商（平台备案服务商名录）"
          badge="已通过平台备案审核的物流服务商；按「境内陆运 / 跨境货代 / 仓储」分区展示，企业对单个细项分别发起签约、服务商确认后生效，由该服务商承接该类物流业务"
          subItems={LOGISTICS_SUB_ITEMS}
          locationFilter
          selfHint="您当前以服务商身份查看：名录展示同类目的其他已备案服务商，您自己的机构无需向自己发起签约。"
        />
      }
      demand={{
        panelTitle: "物流需求（境内陆运 / 跨境货代 · 需求信息通道）",
        createLabel: "提交物流需求",
        emptyIcon: <InboxOutlined aria-hidden />,
        emptyText: "暂无物流需求，点击右上角提交",
        canPost: isEnterprise,
        canReply: () => canReply,
        canManage,
        editTitle: (row) => `修改物流需求 · ${row.orderNo}`,
        channelDescription:
          "企业需求 + 服务商报价议价 + 系统动态（公开池需求：服务商直接回复即接单）",
      }}
      formBody={(editing) => (
        <>
          <Form.Item
            name="title"
            label="需求标题"
            rules={[{ required: true, message: "请填写需求标题" }]}
          >
            <Input placeholder="例如：上海到宁波样品运输" />
          </Form.Item>
          <div className="form-2col">
            <CategoryField domain="LOGISTICS" />
          </div>
          <Form.Item name="description" label="详细说明">
            <Input.TextArea rows={3} placeholder="货物、时效、特殊要求等" />
          </Form.Item>
          <div className="form-2col">
            <Form.Item name="tags" label="标签">
              <Input placeholder="逗号分隔，例如：冷链,加急" />
            </Form.Item>
            <Form.Item name="budget" label="预算">
              <Input placeholder="例如：面议 / ¥18,000" />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="expected_result" label="期望结果">
              <Input placeholder="例如：3 日内送达" />
            </Form.Item>
            <Form.Item name="must_conditions" label="必须满足条件">
              <Input placeholder="例如：全程温控" />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="expect_start" label="期望开始时间">
              {editing ? (
                <Input placeholder="YYYY-MM-DD，如 2026-10-10" />
              ) : (
                <DatePicker style={{ width: "100%" }} />
              )}
            </Form.Item>
            <Form.Item name="deadline" label="截止时间">
              {editing ? (
                <Input placeholder="YYYY-MM-DD，如 2026-10-15" />
              ) : (
                <DatePicker style={{ width: "100%" }} />
              )}
            </Form.Item>
          </div>
          <RegionScopeFields />
          <div className="form-2col">
            <Form.Item name="contact_name" label="联系人">
              <Input />
            </Form.Item>
            <Form.Item name="contact_phone" label="手机">
              <Input />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="contact_wechat" label="微信">
              <Input />
            </Form.Item>
            <Form.Item name="contact_email" label="邮箱">
              <Input />
            </Form.Item>
          </div>
          <Form.Item name="email_sync" label="请把对方回复的内容同步发送到我的邮箱">
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