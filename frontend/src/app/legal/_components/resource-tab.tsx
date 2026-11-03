"use client";
import {lawyerViewSchema} from "@enterprise/contracts";
import { useOperationMutation } from '@/query/business';
import { presentMutationError } from '@/query/errors';
import { identityApi } from '@/api/identity';

import { AuditOutlined, BankOutlined, UserAddOutlined } from "@ant-design/icons";
import { App, Button, Descriptions, Form, Input, Modal, Select } from "antd";
import { useRef, useState } from "react";
import { LocationFields } from "@/components/location-fields";
import {
  ResourceLibraryPanel,
  type ResourceLibrarySpec,
} from "@/components/resource-library";

import { useSession } from "@/lib/session";
import {
  LEGAL_AREAS,
  asList,
  caseText,
  type LawyerResource,
  type LegalAffiliation,
} from "./common";

const ENDPOINT = "/enterprise/legal/lawyers";
const SERVICE_TYPE = "LEGAL_SERVICE";

type PanelActions = { reload: () => Promise<void>; closeDetail: () => void };

/**
 * 律师资源库（kind=LAWYER）/ 律所资源库（kind=LAW_FIRM）。
 * 面板本体与知产资源库共用 @/components/resource-library（两页归一化相似度 76%）；
 * 本文件只保留法律板块的文案、登记字段、所属服务商判定与「申请挂靠」（挂靠为法律独有）。
 * 筛选＝省、市 + 关键词（2026-09-25 口径，与名录同参数）。
 */
export function ResourceTab({ kind }: { kind: "LAWYER" | "LAW_FIRM" }) {
  const identity_applyMutation=useOperationMutation(identityApi.apply,['*']);

  const { message } = App.useApp();
  const { me } = useSession();
  const isFirm = kind === "LAW_FIRM";
  const roles = me?.roles || [];
  const isStaffIdentity = (me?.currentIdentity || "") === "PROVIDER_STAFF";

  const [affiliate, setAffiliate] = useState<LawyerResource | null>(null);
  const [affiliateNote, setAffiliateNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const actionsRef = useRef<PanelActions | null>(null);

  const startAffiliate = (row: LawyerResource) => {
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
        `挂靠申请已提交（${status === "APPROVED" ? "已通过" : "待审批"}），可在「职员/代理人管理」或律所侧跟进`,
      );
      setAffiliate(null);
      actionsRef.current?.closeDetail();
      await actionsRef.current?.reload();
    } finally {
      setSubmitting(false);
    }

 } catch (error) { if(error instanceof Error)presentMutationError(error,text=>message.error(text)); }
};

  const spec: ResourceLibrarySpec<LawyerResource> = {
    rowSchema:lawyerViewSchema,
    endpoint: ENDPOINT,
    serviceType: SERVICE_TYPE,
    tabs: [
      {
        kind: "LAWYER",
        entity: "律师",
        panelTitle: "律师资源库",
        badge: (
          <span className="text-12 muted">
            公开律师由挂靠产生：律师登录后选择「职员/代理人」身份，在「律所资源库」向律所申请挂靠，律所审核通过后即成为公开律师；企业可「与律师签约」＝与律师所在律所签约并将业务指派该律师（按省、市与关键词查询）
          </span>
        ),
        keywordPlaceholder: "律师 / 关键词",
        emptyIcon: <AuditOutlined aria-hidden />,
        emptyText:
          "暂无律师资源，公开律师由挂靠产生：律师登录后选择「职员/代理人」身份，在「律所资源库」向律所申请挂靠，律所审核通过后即成为公开律师",
        subtitleOf: (row) => row.organization || "执业律师",
        nameLabel: "姓名/名称",
        typeLabel: "执业律师",
        registerTitle: "登记律所资源",
        detailFootnote:
          "该律师为律所在职职员（公开律师）。企业可「与律师签约」＝与该律师所在律所签约，并将业务指派给该律师承办（可随时更换；可同时与多家律所/律师签约）。",
      },
      {
        kind: "LAW_FIRM",
        entity: "律所",
        panelTitle: "律所资源库",
        badge: (
          <span className="text-12 muted">
            律所资源由服务商登记（服务商备案通过即对外展示）；职员/代理人身份可「申请挂靠」→ 律所审核通过即成为该律所公开律师
          </span>
        ),
        keywordPlaceholder: "律所 / 关键词",
        emptyIcon: <BankOutlined aria-hidden />,
        emptyText: "暂无律所资源，律所资源由服务商登记，备案通过后即对外展示",
        subtitleOf: () => "律所",
        nameLabel: "姓名/名称",
        typeLabel: "律师事务所",
        registerTitle: "登记律所资源",
        registerFootnote:
          "律师资源不再支持直接登记：律师登录后选择「职员/代理人」身份，在「律所资源库」向律所申请挂靠，律所审核通过后即成为公开律师。",
        detailFootnote:
          "企业可选择该律所发起法律服务签约；律师（职员/代理人身份）可申请挂靠，律所审核通过后即成为该律所公开律师（同一服务类目仅可与一家机构签约合作）。",
      },
    ],
    providerUserIdOf: (row) => row.providerUserId,
    tagLabel: "擅长领域",
    tagsOf: (row) => asList(row.areas),
    casesText: (row) => caseText(row.cases),
    licenseLabel: "执业证号",
    agentNoun: "律师",
    orgNoun: "律所",
    serviceLabel: "法律服务",
    demandNoun: "法律",
    // 本人已提交的挂靠申请（法律独有）：卡片/详情上的「已挂靠 / 挂靠待审批」
    extraRequests: [
      {
        key: "affiliations",
        url: "/enterprise/staff/affiliations/mine",
        label: "本人挂靠关系",
      },
    ],
    /** 对齐 demo canRegister：律所页签 · 服务商账号本人（后端 requireRoles SERVICE_PROVIDER）· 已存在生效签约的客户。 */
    renderRegisterControl: (openRegister, loaded) =>
      isFirm &&
      roles.includes("SERVICE_PROVIDER") &&
      loaded.contracts.some((item) => item.status === "ACTIVE") ? (
        <Button type="primary" onClick={openRegister}>
          ＋ 登记律所资源
        </Button>
      ) : null,
    renderForm: () => (
      <>
        <Form.Item
          name="name"
          label="律所名称 *"
          rules={[{ required: true, message: "律所名称必填" }]}
        >
          <Input placeholder="如：浙江XX律师事务所" />
        </Form.Item>
        <Form.Item name="areas" label="擅长领域">
          <Select
            mode="multiple"
            placeholder="可多选"
            options={LEGAL_AREAS.map((area) => ({ value: area, label: area }))}
          />
        </Form.Item>
        <LocationFields extra="资源库按省、市筛选，登记时必选" />
        <Form.Item name="licenseNo" label="执业证号">
          <Input placeholder="执业许可证编号" />
        </Form.Item>
        <Form.Item name="intro" label="简介">
          <Input.TextArea rows={3} placeholder="律所规模、擅长方向、服务说明等" />
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
    /** 与后端 requireResource 同口径：登记人 / 资源所属服务商 / 平台管理员可改删。 */
    canManageOf: (row, isAdmin, userId) =>
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
      if (!isStaffIdentity || !isFirm) return [];
      const affiliations = (ctx.extra.affiliations || []) as LegalAffiliation[];
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
            已挂靠该律所
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
            { key: "firm", label: "挂靠律所", children: affiliate?.name || "—" },
            { key: "category", label: "服务类目", children: "法律服务" },
            { key: "role", label: "申请角色", children: "法律顾问" },
          ]}
        />
        <div style={{ marginTop: 12 }}>
          <div className="text-12 muted" style={{ marginBottom: 4 }}>
            申请说明（选填）
          </div>
          <Input.TextArea
            rows={3}
            value={affiliateNote}
            placeholder="执业方向、从业经历、可承接的法律服务等"
            onChange={(event) => setAffiliateNote(event.target.value)}
          />
        </div>
        <p className="text-12 muted" style={{ marginTop: 8, marginBottom: 0 }}>
          提交后等待该律所审批；审批通过即成为其职员/代理人并自动成为「律师资源库」中的公开律师。同一服务类目下仅可与一家服务商机构签约合作（一类目一机构）。
        </p>
      </Modal>
    </>
  );
}