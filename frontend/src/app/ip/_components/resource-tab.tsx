"use client";
import {ipAgencyViewSchema} from "@enterprise/contracts";

import { TagOutlined, UserOutlined } from "@ant-design/icons";
import { Button, Form, Input, Select } from "antd";
import { useState } from "react";
import { AddAgentModal } from "@/components/add-agent-modal";
import { LocationFields } from "@/components/location-fields";
import {
  ResourceLibraryPanel,
  type ResourceLibrarySpec,
} from "@/components/resource-library";
import { ServicePackagesPanel } from "@/components/service-packages";
import { isProviderAccount } from "@/lib/can-work-on";
import { useSession } from "@/lib/session";
import { IP_FIELDS, asList, caseText, type IpAgency } from "./common";

const ENDPOINT = "/enterprise/ip/agencies";
const SERVICE_TYPE = "IP_SERVICE";

/**
 * 机构资源库（kind=AGENCY）/ 代理人资源库（kind=AGENT）。
 * 面板本体与法律资源库共用 @/components/resource-library（两页归一化相似度 76%）；
 * 本文件只保留知产板块的文案、登记字段与「备案类目已开通」门控。
 * 代理人不做「自由登记」：与灵活用工同口径，服务商只能「＋ 添加代理人」发起申请、
 * 由对方本人在「我的服务商」确认后建立合作（弹窗共用 @/components/add-agent-modal）。
 * 代理人签约/指派使用 IpAgency.ownerUserId 作为合作服务商（服务商账号）。
 * 筛选＝省、市 + 关键词（2026-09-25 口径，与名录同参数）。
 */
export function ResourceTab({ kind }: { kind: "AGENCY" | "AGENT" }) {
  const { me } = useSession();
  const isAgent = kind === "AGENT";
  const [inviteOpen, setInviteOpen] = useState(false);
  const hasIpQual = (
    (me?.providerApps || []) as { providerType?: string; status?: string }[]
  ).some(
    (item) => item.providerType === SERVICE_TYPE && item.status === "APPROVED",
  );

  const spec: ResourceLibrarySpec<IpAgency> = {
    rowSchema:ipAgencyViewSchema,
    endpoint: ENDPOINT,
    serviceType: SERVICE_TYPE,
    tabs: [
      {
        kind: "AGENT",
        entity: "代理人",
        panelTitle: "知识产权代理人资源库",
        badge: (
          <span className="text-12 muted">
            代理人不单独登记：与灵活用工同口径，由服务商「＋
            添加代理人」发起申请、对方本人确认后与本机构建立合作；企业可「与代理人签约」＝与代理人所属知产服务商签约并将业务指派该代理人
          </span>
        ),
        keywordPlaceholder: "代理人 / 关键词",
        emptyIcon: <UserOutlined aria-hidden />,
        emptyText:
          "暂无代理人资源，代理人由所属知产服务商维护，备案通过后对外展示",
        subtitleOf: (row) =>
          `代理人${row.organization ? ` · ${row.organization}` : ""}`,
        nameLabel: "名称",
        typeLabel: "代理人",
        registerTitle: "登记代理人资源",
      },
      {
        kind: "AGENCY",
        entity: "机构",
        panelTitle: "知识产权机构资源库",
        badge: (
          <span className="text-12 muted">
            仅展示机构：按省、市与关键词查询
          </span>
        ),
        keywordPlaceholder: "机构 / 关键词",
        emptyIcon: <TagOutlined aria-hidden />,
        emptyText:
          "暂无机构资源，机构/代理人信息由平台或服务商维护，审核通过后对外展示",
        subtitleOf: () => "机构",
        nameLabel: "名称",
        typeLabel: "机构",
        registerTitle: "登记机构资源",
      },
    ],
    /** 资源的合作服务商账号：平台统筹资源（ownerType 非服务商）不可签约。 */
    providerUserIdOf: (row) =>
      row.ownerType === "PROVIDER" ? row.ownerUserId : "",
    tagLabel: "服务领域",
    tagsOf: (row) => asList(row.fields),
    casesText: (row) => caseText(row.cases),
    licenseLabel: "资质编号",
    agentNoun: "代理人",
    orgNoun: "服务商",
    serviceLabel: "知识产权服务",
    demandNoun: "知产",
    /** 登记机构需服务商账号本人且「知识产权服务」类目备案通过；代理人只走「添加代理人」申请。 */
    renderRegisterControl: (openRegister) =>
      isProviderAccount(me) ? (
        hasIpQual ? (
          isAgent ? (
            <Button type="primary" onClick={() => setInviteOpen(true)}>
              ＋ 添加代理人
            </Button>
          ) : (
            <Button type="primary" onClick={openRegister}>
              ＋ 登记机构
            </Button>
          )
        ) : (
          <span className="text-12 muted">
            登记资源需先开通「知识产权服务」资质（驾驶舱-服务商备案）
          </span>
        )
      ) : null,
    renderForm: (_, editing) => (
      <>
        {editing ? (
          <Form.Item name="kind" label="类型">
            <Select
              disabled
              options={[
                { value: "AGENCY", label: "机构" },
                { value: "AGENT", label: "代理人" },
              ]}
            />
          </Form.Item>
        ) : null}
        <Form.Item
          name="name"
          label="名称 *"
          rules={[{ required: true, message: "名称必填" }]}
        >
          <Input
            placeholder={
              isAgent ? "如：李XX（执业代理人）" : "如：杭州XX知识产权机构有限公司"
            }
          />
        </Form.Item>
        <Form.Item name="organization" label="所在机构（代理人必填）">
          <Input placeholder="机构全称" />
        </Form.Item>
        <Form.Item name="fields" label="服务领域">
          <Select
            mode="multiple"
            placeholder="可多选"
            options={IP_FIELDS.map((field) => ({ value: field, label: field }))}
          />
        </Form.Item>
        <LocationFields extra="资源库按省、市筛选，登记时必选" />
        <Form.Item name="licenseNo" label="资质编号">
          <Input placeholder="如：机构代码 / 代理人资格证号" />
        </Form.Item>
        <Form.Item name="intro" label="简介">
          <Input.TextArea
            rows={3}
            placeholder="服务能力、擅长领域、成功案例等"
          />
        </Form.Item>
      </>
    ),
    fillEditForm: (form, row) =>
      form.setFieldsValue({
        kind: row.kind,
        organization: row.organization || "",
        fields: asList(row.fields),
      }),
    extraBody: (values, editing, tab) => ({
      // 登记只产出机构（tab.kind＝AGENCY）；代理人行由所属服务商维护，不再由服务商自由登记
      kind: editing ? editing.kind : tab.kind,
      organization: values.organization || "",
      fields: values.fields || "",
      qualification: values.qualification || "",
    }),
  };

  return (
    <>
      <ResourceLibraryPanel kind={kind} spec={spec} />
      {kind === "AGENCY" ? (
        <ServicePackagesPanel serviceType={SERVICE_TYPE} />
      ) : null}
      <AddAgentModal
        open={inviteOpen}
        category={SERVICE_TYPE}
        agentNoun="代理人"
        extraHint="一类目一机构：该账号在知识产权类目下已有绑定或待处理申请时会被拦截。"
        onClose={() => setInviteOpen(false)}
      />
    </>
  );
}