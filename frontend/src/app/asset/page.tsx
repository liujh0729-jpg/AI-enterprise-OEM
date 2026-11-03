"use client";
import { assetViewSchema } from "@enterprise/contracts";

import {
  HomeOutlined,
  TagOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { Alert, Button, DatePicker, Form, Input, Select } from "antd";
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
import { ServicePublishTab, serviceMarketTab } from "@/components/service-publish-tab";
import { type HeroTab } from "@/components/ui/panel";
import { servicesApi } from "@/api/services";
import { useBusinessQuery } from "@/query/business";
import { isProviderAccount } from "@/lib/can-work-on";
import { ASSET_SUB_ITEMS } from "@/lib/provider-categories";
import { useSession } from "@/lib/session";

type AssetRow = import("@enterprise/contracts").AssetRow;

const ASSET_TYPE_LABEL = "资产租售与居间服务";

/** 本地台账列 → AIworkin 需求字段（§7.3 口径，与物流/营销/法律/知产同一套表头）。 */
const toDemand = (row: AssetRow): DemandFields => ({
  orderNo: row.requestNo,
  listingId: row.platformListingId,
  createdAt: row.createdAt,
  category1: row.category1 || ASSET_TYPE_LABEL,
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

const formValues = (row: AssetRow) => ({
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
});

/** 资产交易：企业与服务商身份均可发布资产需求；发布「资产交易」服务后即可居间承接（约看勘查 → 成交）。 */
export default function AssetPage() {
  const { me } = useSession();

  const identity = me?.currentIdentity || "ENTERPRISE_USER";
  const isAdmin = Boolean(me?.identities?.includes("PLATFORM_ADMIN"));
  const isProviderSide =
    identity === "SERVICE_PROVIDER" || identity === "PROVIDER_STAFF";
  /** 发起资产需求：企业与服务商身份都可（与后端 requireRoles 同口径） */
  const isEnterpriseAccount = (me?.roles || []).includes("ENTERPRISE_USER");
  const canPost = !isAdmin && (isProviderAccount(me) || isEnterpriseAccount);
  const [tab, setTab] = useState("requests");
  const tabs: HeroTab[] = [
    {
      key: "requests",
      label: (
        <>
          <UnorderedListOutlined aria-hidden /> 需求信息
        </>
      ),
    },
    // 资产交易市集＝服务发布（用户裁定：市集就是服务发布）；资质门控的唯一例外，
    // 企业与服务商身份均可在此发布「资产交易」服务（§6.9 双身份）。
    serviceMarketTab("资产交易市集"),
    // 资源库页签恒排末尾（全站口径）：没有代理人库时，服务商库放最后
    {
      key: "providers",
      label: (
        <>
          <TagOutlined aria-hidden /> 资产服务商
        </>
      ),
    },
  ];
  const myUserId = me?.userId || "";

  /** 本人是否已发布「资产交易」服务（承接前置，草稿亦算） */
  const eligibilityQuery = useBusinessQuery(
    "asset",
    "broker-eligibility",
    {},
    (signal) => servicesApi.list({ query: { domain: "ASSET" } }, { signal }),
    "all",
    !isAdmin && tab === "requests",
  );
  const hasAssetService = !!eligibilityQuery.data?.length;

  const board = useDemandBoard<AssetRow>({
    rowSchema: assetViewSchema,
    endpoint: "/enterprise/asset",
    rowId: (row) => row.id,
    rowNo: (row) => row.requestNo,
    rowTitle: (row) => row.title,
    toDemand,
    formValues,
    createdTip: "需求已提交",
    editPasswordTitle: "修改资产需求（需密码）",
    removePasswordTitle: "删除资产需求",
    autoLoad: tab === "requests",
  });

  const canBroker = !isAdmin && hasAssetService;

  /** 与后端 requireOwner 同口径：只有创建人或平台管理员能改删；可改状态由接口判定。 */
  const canManage = (row: AssetRow) =>
    Boolean(isAdmin || (myUserId && row.createdBy === myUserId));

  /**
   * 承接方一侧给「回复」入口（自己发布的需求仍是「查看消息」）：
   * 只看身份，不看本地 `status` / 承接人 —— 同一条需求可由多家服务商各自回复，能否回复由接口判定。
   */
  const canReply = (row: AssetRow) => canBroker && !canManage(row);

  const heroDesc = isAdmin
    ? "平台监管全量资产交易需求与流转记录：企业与服务商身份均可发布资产需求，发布「资产交易」服务后即可居间承接（约看勘查 → 成交）。"
    : canBroker
      ? "你已发布「资产交易」服务：公开需求池无需点接收，在「需求消息」中直接回复即接单；对本人承办的单据执行约看勘查、成交确认、异常上报。"
      : identity === "PROVIDER_STAFF"
        ? "只读查看本人承办的资产需求与对接记录；承接资格（发布「资产交易」服务）由服务商账号本人办理。"
        : isProviderSide
          ? "承接资产需求前应先发布服务 —— 请在「资产交易市集」页签发布一条「资产交易」类目服务，发布后即可在公开池回复接单。"
          : "企业与服务商身份均可发布资产需求（房产销售/租赁、保险、投资理财、不良资产、汽车交易）；可在「资产服务商」名录按细项签约服务商，或发布「资产交易」服务后承接公开池需求（回复即接单），承接后约看勘查、撮合成交。";

  return (
    <>
      {eligibilityQuery.isError ? (
        <Alert
          type="error"
          message={`承接资格查询失败：${eligibilityQuery.error.message}`}
          action={
            <Button onClick={() => void eligibilityQuery.refetch()}>重试</Button>
          }
        />
      ) : null}
      <DemandPage<AssetRow>
        hero={{
          title: "资产交易",
          desc: `${ASSET_TYPE_LABEL} · 资产服务商（平台备案服务商名录，按 5 个资产细项分区 → 企业按细项发起签约）＋ 需求信息通道：${heroDesc}`,
        }}
        tabs={tabs}
        activeTab={tab}
        onTabChange={setTab}
        board={board}
        toDemand={toDemand}
        serviceTab={<ServicePublishTab domain="ASSET" />}
        providersTab={
          <ProviderDirectoryTab
            serviceType="ASSET_TRADE"
            title="资产服务商（平台备案服务商名录）"
            badge="已通过平台备案审核的资产交易服务商；按 5 个资产细项分区展示，企业对单个细项分别发起签约、服务商确认后生效"
            subItems={ASSET_SUB_ITEMS}
            locationFilter
            signHint="资产交易也可经「发布服务 / 承接需求」合作"
            selfHint="您当前以服务商身份查看：名录展示同类目的其他已备案服务商，您自己的机构无需向自己发起签约。"
          />
        }
        demand={{
          panelTitle: `资产交易（${ASSET_TYPE_LABEL} · 需求信息通道）`,
          createLabel: "提交资产需求",
          emptyIcon: <HomeOutlined aria-hidden />,
          emptyText: "暂无资产需求；企业与服务商身份均可发布资产需求",
          canPost,
          canReply,
          canManage,
          editTitle: (row) => `修改资产需求 · ${row.requestNo}`,
          channelDescription:
            "资产发布 + 居间承接对接 + 系统动态（公开池需求：已发布服务的承接方直接回复即接单）",
        }}
        formBody={(editing) => (
          <>
            <Form.Item
              name="title"
              label="需求标题"
              rules={[{ required: true, message: "请填写需求标题" }]}
            >
              <Input placeholder="例如：宁波鄞州 120㎡ 写字楼出租（近地铁）" />
            </Form.Item>
            <CategoryField domain="ASSET" showCredentialHint />
            <Form.Item name="description" label="详细说明">
              <Input.TextArea
                rows={3}
                placeholder="标的物情况、面积/金额、权属与交易条件、期望撮合方式等"
              />
            </Form.Item>
            <div className="form-2col">
              <Form.Item name="tags" label="标签">
                <Input placeholder="逗号分隔，例如：写字楼,近地铁,可短租" />
              </Form.Item>
              <Form.Item name="budget" label="预算 / 报价">
                <Input placeholder="例如：面议 / ¥3.5 元/㎡/天" />
              </Form.Item>
            </div>
            <div className="form-2col">
              <Form.Item name="expected_result" label="期望结果">
                <Input placeholder="例如：30 日内完成带看并签约" />
              </Form.Item>
              <Form.Item name="must_conditions" label="必须满足条件">
                <Input placeholder="例如：产权清晰、可注册公司" />
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
            <RegionScopeFields label="标的地域" />
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
    </>
  );
}
