"use client";

import { BankOutlined, ToolOutlined, UserOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Notice, PageHero, Panel } from "@/components/ui/panel";
import { PAGE_META } from "@/config/routes";
import { BUSINESS_IDENTITIES, identityLabel } from "@/lib/identity";
import { useSession } from "@/lib/session";
import { isPersonalSubject, subjectLabel } from "@/lib/subject";
import { EnterpriseForm } from "./_components/enterprise-form";
import { ExternalCredentialPanel } from "./_components/external-credential-panel";
import { ProviderApplicationPanel } from "./_components/provider-application-panel";
import { StaffProfileForm } from "./_components/staff-profile-form";

const IDENTITY_ICON: Record<string, ReactNode> = {
  ENTERPRISE_USER: <BankOutlined aria-hidden />,
  SERVICE_PROVIDER: <ToolOutlined aria-hidden />,
  PROVIDER_STAFF: <UserOutlined aria-hidden />,
};

/** 服务商 / 职员身份的固定材料文案（用户身份按主体类型取，见 USER_SUBJECT_MATERIAL）。 */
const IDENTITY_MATERIAL: Record<
  string,
  { material: string; value: string }
> = {
  SERVICE_PROVIDER: {
    material: "服务商备案（服务类型 / 主体类型 / 所在省市 / 资质）",
    value: "平台审核通过后可被用户签约、承接工单、指定业务人员",
  },
  PROVIDER_STAFF: {
    material: "个人资料（真实姓名 / 手机号 / 所在省市 / 服务类目 / 资质证书 / 简介）",
    value: "被服务商绑定或挂靠通过后成为职员/代理人，可承办工单",
  },
};

/** 用户主体类型 → 认证材料（认证资质随主体类型改变）。 */
const USER_SUBJECT_MATERIAL: Record<
  string,
  { material: string; value: string }
> = {
  COMPANY: {
    material: "企业信息（企业名称 / 统一社会信用代码 / 纳税人类型等）",
    value: "提交即生效，可发起签约、发布需求、提交报税资料、查看账套",
  },
  INDIVIDUAL: {
    material:
      "个体工商户信息（个体工商户名称（字号） / 统一社会信用代码 / 经营者等）",
    value: "提交即生效，可发起签约、发布需求、提交报税资料、查看账套",
  },
  PERSONAL: {
    material: "个人实名信息（姓名 / 身份证号）",
    value: "提交即生效，可发起签约与发布需求（个人主体可浏览全部板块，签约 / 申报 / 账套 / 发布需求需企业或个体工商户主体）",
  },
};

/** 材料文案：用户身份按主体类型取，其余身份取固定文案。 */
function materialOf(identity: string, subjectType?: unknown) {
  if (identity === "ENTERPRISE_USER") {
    return (
      USER_SUBJECT_MATERIAL[String(subjectType || "COMPANY").toUpperCase()] ||
      USER_SUBJECT_MATERIAL.COMPANY
    );
  }
  return IDENTITY_MATERIAL[identity];
}


/** 材料提交入口顺序（与顶栏切换器一致）。 */
const IDENTITY_ORDER = BUSINESS_IDENTITIES;

export default function IdentityPage() {
  return <Suspense fallback={<Panel title="身份与资质">正在读取身份信息…</Panel>}><IdentityContent /></Suspense>;
}

function IdentityContent() {
  const searchParams = useSearchParams();
  const { me, refresh } = useSession();
  const [tick, setTick] = useState(0);
  /** 手动选中的身份；未手动选择时跟随当前身份。 */
  const [picked, setPicked] = useState<string | null>(null);

  const reload = useCallback(() => {
    setTick((value) => value + 1);
    void refresh();
  }, [refresh]);

  // 顶栏切换器点选未开通身份 → 带 ?identity=XXX 跳来本页，直接打开对应材料
  useEffect(() => {
    const wanted = searchParams.get("identity");
    if (wanted && (IDENTITY_ORDER as readonly string[]).includes(wanted)) {
      setPicked(wanted);
    } else {
      setPicked(null);
    }
  }, [searchParams]);

  const current = me?.currentIdentity || "";
  const isAdmin = Boolean(me?.identities.includes("PLATFORM_ADMIN"));
  const qualified = me?.qualified || {ENTERPRISE_USER:false,SERVICE_PROVIDER:false,PROVIDER_STAFF:false};
  const enterprise = me?.enterprise as { status?: string; subjectType?: string } | null;
  const subjectType = String(enterprise?.subjectType || "COMPANY").toUpperCase();
  const personal = isPersonalSubject(subjectType);
  const active =
    picked ||
    ((IDENTITY_ORDER as readonly string[]).includes(current)
      ? current
      : "ENTERPRISE_USER");

  const statusOf = (identity: string) => {
    if (identity === "ENTERPRISE_USER") {
      const ep = me?.enterprise as { status?: string } | null;
      return !ep
        ? "待填写用户信息"
        : ep.status === "APPROVED"
          ? "资质已生效"
          : "档案处理中";
    }
    if (identity === "SERVICE_PROVIDER") {
      const app = (me?.providerApps || [])[0] as { status?: string } | undefined;
      return !app
        ? "待提交备案申请"
        : app.status === "APPROVED"
          ? "资质已生效"
          : app.status === "PENDING"
            ? "备案审核中"
            : "备案未通过 · 可重新申请";
    }
    if (identity === "PROVIDER_STAFF") {
      if (!me?.staffProfile) return "待提交个人资料";
      const binds = (me?.staffOf || []).length;
      return binds ? `已被 ${binds} 家服务商绑定` : "资料已提交 · 可申请挂靠";
    }
    return "监管身份";
  };

  /** 状态徽章配色：已具备=绿、处理中=橙、未提交=灰、未通过=红。 */
  const statusTone = (identity: string) => {
    if (identity === "ENTERPRISE_USER") {
      const ep = me?.enterprise as { status?: string } | null;
      if (!ep) return "gray";
      return ep.status === "APPROVED" ? "green" : "orange";
    }
    if (identity === "SERVICE_PROVIDER") {
      const app = (me?.providerApps || [])[0] as { status?: string } | undefined;
      if (!app) return "gray";
      return app.status === "APPROVED"
        ? "green"
        : app.status === "PENDING"
          ? "orange"
          : "red";
    }
    if (identity === "PROVIDER_STAFF") {
      if (!me?.staffProfile) return "gray";
      return (me?.staffOf || []).length ? "green" : "orange";
    }
    return "gray";
  };

  return (
    <>
      <PageHero
        title="身份与资质"
        desc={PAGE_META["/identity"]?.description}
      />

      <Panel
        title="我的身份（点击卡片提交对应材料）"
        extra={
          <Button onClick={reload}>
            刷新身份状态
          </Button>
        }
      >
        <div className="identity-picker">
          {IDENTITY_ORDER.map((identity) => {
            const on = identity === active;
            const held = Boolean(qualified[identity]);
            return (
              <button
                key={identity}
                type="button"
                className={`identity-pick${on ? " identity-pick-active" : ""}`}
                onClick={() => setPicked(identity)}
              >
                <span className="identity-pick-head">
                  <span className="identity-pick-ico">
                    {IDENTITY_ICON[identity]}
                  </span>
                  <span className="identity-pick-name">
                    {identityLabel(identity, subjectType)}
                  </span>
                  <span className={`badge badge-${statusTone(identity)}`}>
                    {statusOf(identity)}
                  </span>
                  {identity === "ENTERPRISE_USER" && enterprise ? (
                    <span className="badge badge-gray">
                      {subjectLabel(subjectType)}
                    </span>
                  ) : null}
                  {identity === current ? (
                    <span className="badge badge-sky">当前身份</span>
                  ) : null}
                </span>
                <span className="identity-pick-meta">
                  需提交：{materialOf(identity, subjectType).material}
                </span>
                <span className="identity-pick-meta">
                  作用：{materialOf(identity, subjectType).value}
                </span>
                <span className="identity-pick-cta">
                  {held ? "查看 / 修改材料 →" : "去提交材料 →"}
                </span>
              </button>
            );
          })}
        </div>
      </Panel>

      {isAdmin ? (
        <Notice variant="info">
          平台管理员可在顶栏直接切换用户、服务商和职员 / 代理人，切换后保留平台管理权限。
          下方展示本人实际提交的材料和资质状态；具体业务仍按企业资料、签约和外部能力开通情况校验。
        </Notice>
      ) : null}

      {active === "ENTERPRISE_USER" ? (
        <>
          <Notice variant="info">
            {isAdmin ? "平台管理员可直接切换到用户身份。办理本人业务所需的主体资料可在下方维护。" : <>
            用户身份需要提交：{materialOf("ENTERPRISE_USER", subjectType).material}
            （主体类型三选一：企业 / 个体工商户 / 个人）。
            {qualified.ENTERPRISE_USER
              ? `当前已具备该身份资质（主体类型「${subjectLabel(subjectType)}」），可在顶栏切换到用户。`
              : "提交后立即具备该身份，可在顶栏切换到用户。"}
            {personal
              ? "个人用户可正常进入「财税服务」与「跨境出海」浏览服务商名录、查看需求信息并申请加入服务商；「签约 / 申报 / 账套 / 发布需求」四类办理需以「企业」或「个体工商户」主体，变更主体类型后重新提交认证即可办理。"
              : ""}
            </>}
          </Notice>
          <Panel title="用户信息（用户身份资质 · 提交即生效）">
            <EnterpriseForm key={`enterprise-${tick}`} onSaved={reload} />
          </Panel>
          {personal ? null : (
            <Panel title="外报凭据（电子税务局 / 电子口岸 · 密文存储）">
              <ExternalCredentialPanel key={`cred-${tick}`} />
            </Panel>
          )}
        </>
      ) : null}

      {active === "SERVICE_PROVIDER" ? (
        <>
          <Notice variant="info">
            {isAdmin ? "平台管理员可直接切换到服务商身份。下方保留本人服务商备案的提交与维护入口。" : <>
            服务商身份需要提交：{IDENTITY_MATERIAL.SERVICE_PROVIDER.material}。
            {qualified.SERVICE_PROVIDER
              ? "当前已具备该身份资质，可在顶栏切换到服务商。"
              : "提交后由平台管理员审核，通过后即可在顶栏切换到服务商。"}
            </>}
          </Notice>
          <Panel title="服务商备案申请">
            <ProviderApplicationPanel key={`provider-${tick}`} onSaved={reload} />
          </Panel>
        </>
      ) : null}

      {active === "PROVIDER_STAFF" ? (
        <>
          <Notice variant="info">
            {isAdmin ? "平台管理员可直接切换到职员 / 代理人身份。下方保留本人个人资料的提交与维护入口。" : <>
            职员 / 代理人身份需要提交：{IDENTITY_MATERIAL.PROVIDER_STAFF.material}。
            {qualified.PROVIDER_STAFF
              ? "当前已成为服务商职员/代理人，可承办工单。"
              : "资料提交后，需由服务商邀请绑定（或申请挂靠）通过，才能切换到该身份。"}
            </>}
          </Notice>
          <Panel title="个人资料（职员/代理人身份资质）">
            <StaffProfileForm key={`staff-${tick}`} onSaved={reload} />
          </Panel>
        </>
      ) : null}
    </>
  );
}
