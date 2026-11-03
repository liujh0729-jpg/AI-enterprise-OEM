"use client";
import {thinkTankExpertViewSchema} from "@enterprise/contracts";
import { useOperationMutation } from '@/query/business';
import { presentMutationError } from '@/query/errors';
import { identityApi } from '@/api/identity';

import { TeamOutlined, UserAddOutlined, UserOutlined } from "@ant-design/icons";
import { App, Button, Descriptions, Form, Input, Modal, Select } from "antd";
import { useRef, useState } from "react";
import { LocationFields } from "@/components/location-fields";
import {
  ResourceLibraryPanel,
  type ResourceLibrarySpec,
} from "@/components/resource-library";

import { useSession } from "@/lib/session";
import {
  THINK_TANK_AREAS,
  asList,
  caseText,
  type ThinkTankExpert,
  type ThinkTankAffiliation,
} from "./common";

const ENDPOINT = "/enterprise/think-tank/experts";
const SERVICE_TYPE = "THINK_TANK_SERVICE";

type PanelActions = { reload: () => Promise<void>; closeDetail: () => void };

/**
 * 机构资源库（kind=ORGANIZATION）/ 专家资源库（kind=EXPERT）。
 * 面板本体与法律资源库共用 @/components/resource-library；
 * 本文件只保留智库板块的文案、登记字段、所属服务商判定与「申请挂靠」。
 * 筛选＝省、市 + 关键词。
 */
export function ResourceTab({ kind }: { kind: "EXPERT" | "ORGANIZATION" }) {
  const identity_applyMutation=useOperationMutation(identityApi.apply,['*']);

  const { message } = App.useApp();
  const { me } = useSession();
  const isOrg = kind === "ORGANIZATION";
  const roles = me?.roles || [];
  const isStaffIdentity = (me?.currentIdentity || "") === "PROVIDER_STAFF";

  const [affiliate, setAffiliate] = useState<ThinkTankExpert | null>(null);
  const [affiliateNote, setAffiliateNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const actionsRef = useRef<PanelActions | null>(null);

  const startAffiliate = (row: ThinkTankExpert) => {
    if (!me?.staffProfile) {
      message.warning(
        "请先选择「职员/代理人」身份并在高管驾驶舱提交个人资料，再申请挂靠",
      );
      return;
    }
    setAffiliateNote("");
    setAffiliate(row);
  };

  const submitAffiliate = async () => {
 try {

    if (!affiliate) return;
    setSubmitting(true);
    try {
      const payload = await identity_applyMutation.mutateAsync({body:{
        providerUserId: affiliate.providerUserId,
        category: SERVICE_TYPE,
      }});

      const status = (payload)?.status;
      message.success(
        `挂靠申请已提交（${status === "APPROVED" ? "已通过" : "待审批"}），可在「职员/代理人管理」或机构侧跟进`,
      );
      setAffiliate(null);
      actionsRef.current?.closeDetail();
      await actionsRef.current?.reload();
    } finally {
      setSubmitting(false);
    }

 } catch (error) { if(error instanceof Error)presentMutationError(error,text=>message.error(text)); }
};

  const spec: ResourceLibrarySpec<ThinkTankExpert> = {
    rowSchema:thinkTankExpertViewSchema,
    endpoint: ENDPOINT,
    serviceType: SERVICE_TYPE,
    tabs: [
      {
        kind: "EXPERT",
        entity: "专家",
        panelTitle: "专家资源库",
        badge: (
          <span className="text-12 muted">
            公开专家由挂靠产生：专家登录后选择「职员/代理人」身份，在「机构资源库」向机构申请挂靠，机构审核通过后即成为公开专家；企业可「与专家签约」＝与专家所在机构签约并将业务指派该专家（按省、市与关键词查询）
          </span>
        ),
        keywordPlaceholder: "专家 / 关键词",
        emptyIcon: <UserOutlined aria-hidden />,
        emptyText:
          "暂无专家资源，公开专家由挂靠产生：专家登录后选择「职员/代理人」身份，在「机构资源库」向机构申请挂靠，机构审核通过后即成为公开专家",
        subtitleOf: (row) => row.organization || "智库专家",
        nameLabel: "姓名/名称",
        typeLabel: "智库专家",
        registerTitle: "登记机构资源",
        detailFootnote:
          "该专家为机构在职职员（公开专家）。企业可「与专家签约」＝与该专家所在机构签约，并将业务指派给该专家承办（可随时更换；可同时与多家机构/专家签约）。",
      },
      {
        kind: "ORGANIZATION",
        entity: "机构",
        panelTitle: "机构资源库",
        badge: (
          <span className="text-12 muted">
            机构资源由服务商登记（服务商备案通过即对外展示）；职员/代理人身份可「申请挂靠」→ 机构审核通过即成为该机构公开专家
          </span>
        ),
        keywordPlaceholder: "机构 / 关键词",
        emptyIcon: <TeamOutlined aria-hidden />,
        emptyText: "暂无机构资源，机构资源由服务商登记，备案通过后即对外展示",
        subtitleOf: () => "智库机构",
        nameLabel: "姓名/名称",
        typeLabel: "智库机构",
        registerTitle: "登记机构资源",
        registerFootnote:
          "专家资源不再支持直接登记：专家登录后选择「职员/代理人」身份，在「机构资源库」向机构申请挂靠，机构审核通过后即成为公开专家。",
        detailFootnote:
          "企业可选择该机构发起智库服务签约；专家（职员/代理人身份）可申请挂靠，机构审核通过后即成为该机构公开专家（同一服务类目仅可与一家机构签约合作）。",
      },
    ],
    providerUserIdOf: (row) => row.providerUserId,
    tagLabel: "擅长领域",
    tagsOf: (row) => asList(row.areas),
    casesText: (row) => caseText(row.cases),
    licenseLabel: "执业证号",
    agentNoun: "专家",
    orgNoun: "机构",
    serviceLabel: "智库服务",
    demandNoun: "智库",
    // 本人已提交的挂靠申请（智库独有）：卡片/详情上的「已挂靠 / 挂靠待审批」
    extraRequests: [
      {
        key: "affiliations",
        url: "/enterprise/staff/affiliations/mine",
        label: "本人挂靠关系",
      },
    ],
    /** 对齐 demo canRegister：机构页签 · 服务商账号本人（后端 requireRoles SERVICE_PROVIDER）· 已存在生效签约的客户。 */
    renderRegisterControl: (openRegister, loaded) =>
      isOrg &&
      roles.includes("SERVICE_PROVIDER") &&
      loaded.contracts.some((item) => item.status === "ACTIVE") ? (
        <Button type="primary" onClick={openRegister}>
          ＋ 登记机构资源
        </Button>
      ) : null,
    renderForm: () => (
      <>
        <Form.Item
          name="name"
          label="机构名称 *"
          rules={[{ required: true, message: "机构名称必填" }]}
        >
          <Input placeholder="如：XX管理咨询有限公司" />
        </Form.Item>
        <Form.Item name="areas" label="擅长领域">
          <Select
            mode="multiple"
            placeholder="可多选"
            options={THINK_TANK_AREAS.map((area) => ({ value: area, label: area }))}
          />
        </Form.Item>
        <LocationFields extra="资源库按省、市筛选，登记时必选" />
        <Form.Item name="licenseNo" label="执业证号">
          <Input placeholder="执业许可证编号" />
        </Form.Item>
        <Form.Item name="intro" label="简介">
          <Input.TextArea rows={3} placeholder="机构规模、擅长方向、服务说明等" />
        </Form.Item>
      </>
    ),
    fillEditForm: (form, row) =>
      form.setFieldsValue({
        areas: asList(row.areas),
        qualification: row.qualification || "",
      }),
    extraBody: (values, editing) => ({
      organization: editing ? editing.organization || values.name : values.name,
      areas: values.areas || "",
      qualification: values.qualification || "",
    }),
    /** 与后端 requireOrganization 同口径：仅机构资源可改删；专家行由挂靠派生，只读。 */
    canManageOf: (row, isAdmin, userId) =>
      row.kind === "ORGANIZATION" &&
      Boolean(
        isAdmin ||
          (userId && row.ownerUserId === userId) ||
          (userId && row.providerUserId === userId),
      ),
    detailTopRows: (row) => [
      {
        key: "staff",
        label: "绑定账号",
        children: row.staffUserId
          ? `${row.staffName || row.staffUserId}${
              row.staffUsername
                ? `（${row.staffUsername} · 服务商职员）`
                : "（服务商职员）"
            }`
          : "—",
      },
    ],
    extraActions: (row, ctx, where) => {
      if (!isStaffIdentity || !isOrg) return [];
      const affiliations = (ctx.extra.affiliations || []) as ThinkTankAffiliation[];
      const affiliation =
        affiliations.find(
          (item) =>
            item.providerUserId === ctx.providerUserId &&
            item.category === SERVICE_TYPE,
        ) || null;
      const bound = (me?.staffOf || []).some(
        (item) =>
          String((item as { providerUserId?: string }).providerUserId || "") ===
          ctx.providerUserId,
      );
      if (where === "card") {
        if (bound || affiliation?.status === "APPROVED") {
          return [
            <span key="bound" className="badge badge-green">
              已挂靠
            </span>,
          ];
        }
        if (affiliation?.status === "PENDING") {
          return [
            <span key="applying" className="badge badge-orange">
              挂靠待审批
            </span>,
          ];
        }
        return [
          <Button key="apply" type="primary" onClick={() => startAffiliate(row)}>
            申请挂靠
          </Button>,
        ];
      }
      if (bound) {
        return [
          <span key="bound" className="badge badge-green">
            已挂靠该机构
          </span>,
        ];
      }
      return [
        <Button key="apply" type="primary" onClick={() => startAffiliate(row)}>
          <UserAddOutlined aria-hidden /> 申请挂靠
        </Button>,
      ];
    },
    onReady: (actions) => {
      actionsRef.current = actions;
    },
  };

  return (
    <>
      <ResourceLibraryPanel kind={kind} spec={spec} />
      <Modal
        open={Boolean(affiliate)}
        title={`申请挂靠 · ${affiliate?.name || ""}`}
        width={560}
        confirmLoading={submitting}
        onCancel={() => setAffiliate(null)}
        okText="提交申请"
        cancelText="取消"
        onOk={() => void submitAffiliate()}
      >
        <Descriptions
          column={1}
          size="small"
          bordered
          items={[
            { key: "firm", label: "挂靠机构", children: affiliate?.name || "—" },
            { key: "category", label: "服务类目", children: "智库服务" },
            { key: "role", label: "申请角色", children: "智库顾问" },
          ]}
        />
        <div style={{ marginTop: 12 }}>
          <div className="text-12 muted" style={{ marginBottom: 4 }}>
            申请说明（选填）
          </div>
          <Input.TextArea
            rows={3}
            value={affiliateNote}
            placeholder="执业方向、从业经历、可承接的智库服务等"
            onChange={(event) => setAffiliateNote(event.target.value)}
          />
        </div>
        <p className="text-12 muted" style={{ marginTop: 8, marginBottom: 0 }}>
          提交后等待该机构审批；审批通过即成为其职员/代理人并自动成为「专家资源库」中的公开专家。同一服务类目下仅可与一家服务商机构签约合作（一类目一机构）。
        </p>
      </Modal>
    </>
  );
}
