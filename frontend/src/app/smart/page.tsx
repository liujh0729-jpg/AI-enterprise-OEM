"use client";
import { smartViewSchema } from '@enterprise/contracts';

import { RobotOutlined, TagOutlined, UnorderedListOutlined } from "@ant-design/icons";
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
import { type HeroTab } from "@/components/ui/panel";
import { isProviderAccount } from "@/lib/can-work-on";
import {
  SMART_SUB_ITEMS,
  SUBITEM_LABELS,
} from "@/lib/provider-categories";
import { useSession } from "@/lib/session";

type SmartRow=import('@enterprise/contracts').SmartRow;

/**
 * IT服务需求列 → AIworkin 需求字段（§7.3 口径，与物流服务同一套列组件）。
 * 细项（AI实施 / 软件开发 / 算力 / 硬件 / 数据）另出一列，见表格「服务细项」。
 */
const toDemand = (row: SmartRow): DemandFields => ({
  orderNo: row.orderNo,
  listingId: row.platformListingId,
  createdAt: row.createdAt,
  category1: row.category1,
  category2: row.category2,
  subItem: SUBITEM_LABELS[row.serviceItem] || "",
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

const formValues = (row: SmartRow) => ({
  title: row.title,
  service_item: row.serviceItem || "",
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
});

export default function SmartServicePage() {
  const { me } = useSession();
  // 身份决定「该做什么、能做什么」：企业发需求，IT服务商作业，管理员监管
  const identity = me?.currentIdentity || "ENTERPRISE_USER";
  const isAdmin = Boolean(me?.identities?.includes("PLATFORM_ADMIN"));
  const isEnterprise =
    identity === "ENTERPRISE_USER" || (!isAdmin && identity !== "SERVICE_PROVIDER" && identity !== "PROVIDER_STAFF");
  /** 回复公开池工单是机构级动作（后端 requireRoles SERVICE_PROVIDER）：仅服务商账号本人可见 */
  const canAcceptOrder = isProviderAccount(me);
  const [tab, setTab] = useState("requests");
  const tabs: HeroTab[] = [
    { key: "requests", label: <><UnorderedListOutlined aria-hidden /> 需求信息</> },
    // 资源库页签恒排末尾（全站口径）：没有代理人库时，服务商库放最后
    { key: "providers", label: <><TagOutlined aria-hidden /> IT服务商</> },
    serviceMarketTab("IT服务市集"),
  ];
  const myUserId = me?.userId || "";

  const board = useDemandBoard<SmartRow>({
    rowSchema:smartViewSchema,
    endpoint: "/enterprise/smart",
    rowId: (row) => row.id,
    rowNo: (row) => row.orderNo,
    rowTitle: (row) => row.title,
    toDemand,
    formValues,
    createdTip: "需求已提交",
    editPasswordTitle: "修改IT服务需求（需密码）",
    removePasswordTitle: "删除IT服务需求",
  });

  /** 与后端 requireOwner 同口径：只有创建人或平台管理员能改删；可改状态由接口判定。 */
  const canManage = (row: SmartRow) =>
    Boolean(isAdmin || (myUserId && row.createdBy === myUserId));

  /**
   * 服务商侧是否给出「回复」入口：只看身份，不看本地 `status` / 承接人 ——
   * 同一条需求可由多家服务商各自回复，能否回复由接口判定。
   */
  const canReply = !isAdmin && canAcceptOrder;

  return (
    <DemandPage<SmartRow>
      hero={{
        title: "IT服务",
        desc: "IT服务商（平台备案服务商名录，按「AI实施 / 软件开发 / 算力服务 / 硬件服务 / 数据服务」分区 → 企业按细项发起签约，同一细项不限服务商）· 需求信息（IT服务需求消息通道：企业提交需求，已签约服务商自动直派，未签约进入公开需求池，服务商直接回复即接单）。",
      }}
      tabs={tabs}
      activeTab={tab}
      onTabChange={setTab}
      board={board}
      toDemand={toDemand}
      serviceTab={<ServicePublishTab domain="SMART" pool />}
      providersTab={
        <ProviderDirectoryTab
          serviceType="SMART_SERVICE"
          title="IT服务商（平台备案服务商名录）"
          badge="已通过平台备案审核的IT服务服务商；按「AI实施 / 软件开发 / 算力服务 / 硬件服务 / 数据服务」分区展示，企业对单个细项分别发起签约、服务商确认后生效，由该服务商承接该类IT服务业务"
          subItems={SMART_SUB_ITEMS}
          selfHint="您当前以服务商身份查看：名录展示同类目的其他已备案服务商，您自己的机构无需向自己发起签约。"
        />
      }
      demand={{
        panelTitle: "IT服务需求（AI实施 / 软件开发 / 算力 / 硬件 / 数据 · 需求信息通道）",
        createLabel: "提交IT服务需求",
        emptyIcon: <RobotOutlined aria-hidden />,
        emptyText: "暂无IT服务需求，点击右上角提交",
        canPost: isEnterprise,
        canReply: () => canReply,
        canManage,
        editTitle: (row) => `修改IT服务需求 · ${row.orderNo}`,
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
            <Input placeholder="例如：车间质检图像识别模型落地" />
          </Form.Item>
          <Form.Item
            name="service_item"
            label="服务细项"
            rules={[{ required: true, message: "请选择服务细项" }]}
            extra="细项决定直派给哪家已签约的IT服务商；未签约则进入公开需求池。"
          >
            <Select
              placeholder="请选择服务细项"
              options={SMART_SUB_ITEMS.map((item) => ({
                value: item.type,
                label: <>{item.icon} {item.name}</>,
              }))}
            />
          </Form.Item>
          <div className="form-2col">
            <CategoryField domain="SMART" />
          </div>
          <Form.Item name="description" label="详细说明">
            <Input.TextArea rows={3} placeholder="现状、目标、技术约束、交付要求等" />
          </Form.Item>
          <div className="form-2col">
            <Form.Item name="tags" label="标签">
              <Input placeholder="逗号分隔，例如：大模型,私有化部署" />
            </Form.Item>
            <Form.Item name="budget" label="预算">
              <Input placeholder="例如：面议 / ¥180,000" />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="expected_result" label="期望结果">
              <Input placeholder="例如：识别准确率 ≥ 98%" />
            </Form.Item>
            <Form.Item name="must_conditions" label="必须满足条件">
              <Input placeholder="例如：数据不出内网" />
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
