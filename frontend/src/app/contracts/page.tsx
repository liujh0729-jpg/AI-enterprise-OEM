"use client";

import {
  CheckCircleOutlined,
  InboxOutlined,
  ClockCircleOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { App, Button, Form, Input, Modal, Space, Table } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  DesignateStaffModal,
  type BusinessStaffOption,
} from "./_components/contract-dialogs";
import {
  ContactEditModal,
  type ContactEditTarget,
} from "@/components/contact-edit-modal";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { StatusBadge } from "@/components/status-badge";
import {
  EmptyState,
  Notice,
  PageHero,
  Panel,
  StatCard,
  StatGrid,
} from "@/components/ui/panel";
import { PAGE_META } from "@/config/routes";
import { OaLaunchButton } from "@/app/oa/_components/oa-launch-button";
import { useContractActions } from "@/query/contract-actions";
import { contractsApi } from "@/api/contracts";
import { useBusinessQuery } from "@/query/business";
import { identityLabel } from "@/lib/identity";
import { contactOf, contactText } from "@/lib/contacts";
import {
  ASSET_TYPES,
  LOGISTICS_TYPES,
  MARKETING_TYPES,
  SMART_TYPES,
  SUBITEM_LABELS,
} from "@/lib/provider-categories";
import { useSession } from "@/lib/session";

type DesignatedStaff = { name?: string; title?: string };
type DesignatedAgent = { id: number; name: string; org: string };

type ContractRow = {
  id: number;
  contractNo: string;
  providerUserId: string;
  providerOrg: string;
  provider_name?: string;
  enterpriseId: number;
  enterpriseName: string;
  serviceType: string;
  status: string;
  startDate: string;
  endDate?: string;
  note: string;
  /** 签约联系方式：系统按双方对应人档案自动带出，临时换人可改 */
  contactName?: string | null;
  contactPhone?: string | null;
  providerContactName?: string | null;
  providerContactPhone?: string | null;
  business_staff?: BusinessStaffOption[];
  designated_staff?: DesignatedStaff;
  designated_agent?: DesignatedAgent | null;
};

const CATEGORY_LABELS: Record<string, string> = {
  TAX_FINANCE: "企业财税服务",
  LOGISTICS: "物流服务",
  LEGAL_SERVICE: "法律服务",
  IP_SERVICE: "知识产权服务",
  FLEX_WORK: "灵活用工服务",
  SUPPLY_NETWORK: "供销服务",
  MARKETING: "营销服务",
  SMART_SERVICE: "IT服务",
  // 细项（出海 6 / 营销 6 / 物流 3 / IT服务 5 / 资产交易 5）与备案表单同源
  ...SUBITEM_LABELS,
};

/**
 * 支持「指定业务人员」的服务分类（财税与细项签约：出海 / 营销 / 物流 / 资产交易）——
 * 细项签约生效后由服务商为该细项指派业务人员。
 */
const DESIGNATABLE_CATEGORIES = [
  "EXPORT_REFUND",
  "COMPANY_REG",
  "SETTLEMENT",
  "TAX_COMPLIANCE",
  "QUALIFICATION",
  "BANK_ACCOUNT",
  ...MARKETING_TYPES,
  ...LOGISTICS_TYPES,
  ...SMART_TYPES,
  ...ASSET_TYPES,
];

function isDesignatable(serviceType: string) {
  return (
    serviceType === "TAX_FINANCE" ||
    DESIGNATABLE_CATEGORIES.includes(serviceType)
  );
}

function categoryLabel(serviceType: string) {
  return CATEGORY_LABELS[serviceType] || serviceType || "—";
}

function CategoryBadge({ value }: { value: string }) {
  return <span className="badge badge-sky">{categoryLabel(value)}</span>;
}

function fmtDate(value?: string) {
  return value ? String(value).slice(0, 10) : "—";
}

export default function ContractsPage() {
  const actions = useContractActions();
  const { message, modal } = App.useApp();
  const router = useRouter();
  const { me } = useSession();
  const { request: requestPassword, modal: passwordModal } =
    usePasswordConfirm();
  const meta = PAGE_META["/contracts"];
  const [paging, setPaging] = useState({ page: 1, pageSize: 20 });
  const contractQuery = useBusinessQuery(
    "contracts",
    "list",
    paging,
    (signal) => contractsApi.list({ query: paging }, { signal }),
  );
  const statsQuery = useBusinessQuery("contracts", "stats", {}, (signal) =>
    contractsApi.stats({}, { signal }),
  );
  const rows: ContractRow[] = contractQuery.data?.list || [];
  const loading = contractQuery.isPending;
  const [designateTarget, setDesignateTarget] = useState<ContractRow | null>(
    null,
  );
  const [termsTarget, setTermsTarget] = useState<ContractRow | null>(null);
  const [termsForm] = Form.useForm();
  /** 签约联系方式（系统自动带出，临时换人可改） */
  const [contactTarget, setContactTarget] = useState<ContactEditTarget | null>(
    null,
  );

  const roles = me?.roles || [];
  const isProvider = roles.includes("SERVICE_PROVIDER");
  const isAdmin = roles.includes("PLATFORM_ADMIN");
  const isProOwner = isProvider && me?.currentIdentity === "SERVICE_PROVIDER";
  const isEnterpriseIdentity =
    (me?.currentIdentity || "") === "ENTERPRISE_USER";
  const [startOpen, setStartOpen] = useState(false);
  const myUserId = me?.userId || "";
  const myEnterpriseId = (me?.enterprise as { id?: number } | null)?.id || 0;

  const confirmContract = (row: ContractRow) => {
    modal.confirm({
      title: "确认签约",
      okText: "确认签约",
      cancelText: "取消",
      content: `确认接受「${row.enterpriseName}」的服务签约？确认后正式建立服务关系，即可承接该企业的业务。`,
      onOk: async () => {
        await actions.confirm.mutateAsync({
          params: { id: String(row.id) },
          body: {},
        });

        message.success("签约已生效");
      },
    });
  };

  const terminateContract = (row: ContractRow) => {
    modal.confirm({
      title: row.status === "ACTIVE" ? "解除签约" : "撤销签约",
      okText: "确认解除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      content: (
        <div>
          解除与「{row.providerOrg || row.provider_name || "—"} /{" "}
          {row.enterpriseName}」的
          <b>{categoryLabel(row.serviceType)}</b>
          签约后，
          <b>所有服务权限将立即停止</b>
          （申报、出海服务、物流等）；该服务分类解约后可再次发起签约。确定解除吗？
        </div>
      ),
      onOk: async () => {
        await actions.terminate.mutateAsync({ params: { id: String(row.id) } });

        message.success("签约已解除");
      },
    });
  };

  /** 条款可改：仅签约发起企业（或平台管理员）、且仅「待确认」；生效后只能解约重签。 */
  const canEditTerms = (row: ContractRow) =>
    row.status === "PENDING" &&
    (isAdmin || (myEnterpriseId > 0 && row.enterpriseId === myEnterpriseId));

  /** 可删除：非生效中，且为签约发起企业或平台管理员。 */
  const canRemoveContract = (row: ContractRow) =>
    row.status !== "ACTIVE" &&
    (isAdmin || (myEnterpriseId > 0 && row.enterpriseId === myEnterpriseId));

  const openTerms = (row: ContractRow) => {
    setTermsTarget(row);
    termsForm.setFieldsValue({
      start_date: row.startDate || "",
      end_date: row.endDate || "",
      note: row.note || "",
    });
  };

  /** 改联系方式：签约双方任一方或平台管理员（仅改本单联系信息，不动条款）。 */
  const canTouchContacts = (row: ContractRow) =>
    isAdmin ||
    (myEnterpriseId > 0 && row.enterpriseId === myEnterpriseId) ||
    row.providerUserId === myUserId ||
    (me?.staffOf || []).some(
      (bind) =>
        (bind as { providerUserId?: string }).providerUserId ===
        row.providerUserId,
    );

  const openContacts = (row: ContractRow) => {
    const ent = contactOf(row, "contact");
    const prov = contactOf(row, "provider_contact");
    setContactTarget({
      resource: "contracts",
      id: row.id,
      no: row.contractNo,
      contactName: ent.name,
      contactPhone: ent.phone,
      providerContactName: prov.name,
      providerContactPhone: prov.phone,
      partyLabel: "企业侧（签约联系人）",
      providerLabel: "服务商（签约联系人）",
    });
  };

  const saveTerms = () => {
    if (!termsTarget) return;
    void termsForm
      .validateFields()
      .then((values) => {
        const body = {
          start_date: String(values.start_date || "").trim(),
          end_date: String(values.end_date || "").trim(),
          note: String(values.note || "").trim(),
        };
        const target = termsTarget;
        requestPassword({
          title: "修改签约条款（需密码）",
          content: `确认修改「${target.contractNo}」的服务期限与备注？生效后的签约条款不可修改，只能解约重签。`,
          okText: "保存修改",
          onOk: async () => {
            await actions.updateTerms.mutateAsync({
              params: { id: String(target.id) },
              body: body,
            });

            message.success("签约条款已更新");
            setTermsTarget(null);
          },
        });
      })
      .catch(() => undefined);
  };

  const removeContract = (row: ContractRow) => {
    requestPassword({
      title: "删除签约",
      danger: true,
      okText: "确认删除",
      content: `确定删除「${row.contractNo}」这条签约记录？生效中的签约须先解约；已产生业务单据的签约不可删除（保留作业与申报依据）。`,
      onOk: async () => {
        await actions.remove.mutateAsync({ params: { id: String(row.id) } });

        message.success("签约已删除");
      },
    });
  };

  const openDesignate = (row: ContractRow) => {
    if (!(row.business_staff || []).length) {
      modal.info({
        title: "暂无业务人员",
        okText: "知道了",
        content:
          "该服务商还没有可指派的职员：请先在「职员 / 代理人管理」中发起添加，对方确认后即出现在这里，再为该签约指定对接人。",
      });
      return;
    }
    setDesignateTarget(row);
  };

  /** 对接人指定状态小字（财税/出海：服务商指定业务人员；法律/知产/灵活用工：企业指定承办律师/代理人）。 */
  const designatedCell = (row: ContractRow) => {
    if (row.status !== "ACTIVE") return null;
    if (isDesignatable(row.serviceType)) {
      const designated = row.designated_staff || {};
      if (designated.name) {
        return (
          <div className="text-12 muted">
            {`业务人员：${designated.name}${designated.title ? "·" + designated.title : ""}`}
          </div>
        );
      }
      return (
        <div className="text-12 muted">
          {(row.business_staff || []).length
            ? "待指定业务人员"
            : "该服务商暂无职员（先在「职员 / 代理人管理」添加）"}
        </div>
      );
    }
    if (
      ["LEGAL_SERVICE", "IP_SERVICE", "FLEX_WORK"].includes(row.serviceType)
    ) {
      const agent = row.designated_agent;
      if (agent) {
        const label =
          row.serviceType === "LEGAL_SERVICE" ? "承办律师" : "承办代理人";
        return (
          <div className="text-12 muted">
            {`${label}：${agent.name}${agent.org ? "（" + agent.org + "）" : ""}`}
          </div>
        );
      }
      return (
        <div className="text-12 muted">
          {row.serviceType === "LEGAL_SERVICE"
            ? "待指派承办律师"
            : "待指派承办代理人"}
        </div>
      );
    }
    return null;
  };

  const buildOps = (row: ContractRow) => {
    const ops = [];
    const isMine = isProvider && row.providerUserId === myUserId;
    if (isProvider && row.status === "PENDING" && isMine) {
      ops.push(
        <Button
          key="confirm"
          type="primary"
          onClick={() => confirmContract(row)}
        >
          确认签约
        </Button>,
      );
      ops.push(
        <Button key="reject" danger onClick={() => terminateContract(row)}>
          拒绝
        </Button>,
      );
    }
    if (
      ["ACTIVE", "PENDING"].includes(row.status) &&
      (isMine || (myEnterpriseId > 0 && row.enterpriseId === myEnterpriseId))
    ) {
      ops.push(
        <Button key="terminate" onClick={() => terminateContract(row)}>
          {row.status === "ACTIVE" ? "解约" : "撤销"}
        </Button>,
      );
    }
    if (row.status === "ACTIVE" && isMine && isDesignatable(row.serviceType)) {
      ops.push(
        <Button key="designate" onClick={() => openDesignate(row)}>
          {row.designated_staff?.name ? "更换业务人员" : "指定业务人员"}
        </Button>,
      );
    }
    if (canEditTerms(row)) {
      ops.push(
        <Button key="terms" onClick={() => openTerms(row)}>
          修改条款
        </Button>,
      );
    }
    if (canTouchContacts(row)) {
      ops.push(
        <Button key="contacts" onClick={() => openContacts(row)}>
          改联系方式
        </Button>,
      );
    }
    if (canRemoveContract(row)) {
      ops.push(
        <Button key="remove" danger onClick={() => removeContract(row)}>
          删除
        </Button>,
      );
    }
    if (isAdmin) {
      ops.push(
        <span key="admin" className="text-12 muted">
          平台监管
        </span>,
      );
    }
    return ops.length
      ? ops
      : [
          <span key="none" className="text-12 muted">
            —
          </span>,
        ];
  };

  const active = statsQuery.data?.active ?? "—";
  const pending = statsQuery.data?.pending ?? "—";

  return (
    <>
      <PageHero
        title="签约管理"
        desc={meta.description}
        extra={
          isEnterpriseIdentity ? (
            <Button type="primary" onClick={() => setStartOpen(true)}>
              ＋ 发起签约
            </Button>
          ) : null
        }
      />

      <Notice variant="info">
        当前身份：
        {identityLabel(me?.currentIdentity, me?.enterprise?.subjectType)}。
        {isAdmin
          ? "当前账号保留平台管理权限，可查看平台范围的签约与状态流转。"
          : isEnterpriseIdentity
            ? "从资源库或服务目录选择服务商发起签约，待服务商确认后生效；生效后可撤销或解约。"
            : isProOwner
              ? "企业发起后由你确认或拒绝；生效后指定业务人员或承办人，并把企业分配给主办职员承办。"
              : "仅可查看本人承办企业的签约，签约确认与分配由服务商账号操作。"}
      </Notice>

      <Modal
        open={startOpen}
        title="发起签约 · 选择服务商类别"
        footer={<Button onClick={() => setStartOpen(false)}>关闭</Button>}
        onCancel={() => setStartOpen(false)}
      >
        <div className="text-12 muted" style={{ marginBottom: 10 }}>
          签约由企业发起：按类目进入对应资源库/服务目录，选择服务商后点「发起签约」。
          财税、出海类目可在「财税服务 · 财税服务商」页签与「跨境出海 ·
          跨境出海服务商」发起。
        </div>
        <Space wrap>
          <Button onClick={() => router.push("/tax?view=providers")}>
            财税服务商资源库
          </Button>
          <Button onClick={() => router.push("/overseas")}>
            跨境出海服务商
          </Button>
          <Button onClick={() => router.push("/legal")}>
            律师 / 律所资源库
          </Button>
          <Button onClick={() => router.push("/ip")}>
            机构 / 代理人资源库
          </Button>
          <Button onClick={() => router.push("/flex")}>
            灵活用工代理人资源库
          </Button>
          <Button onClick={() => router.push("/supply")}>
            供销网络服务商目录
          </Button>
        </Space>
      </Modal>

      <Panel title="签约概览">
        <StatGrid>
          <StatCard
            label="签约总数"
            value={statsQuery.data?.total ?? "—"}
            icon={<UnorderedListOutlined aria-hidden />}
          />
          <StatCard
            label="生效中"
            value={active}
            icon={<CheckCircleOutlined aria-hidden />}
          />
          <StatCard
            label="待确认"
            value={pending}
            icon={<ClockCircleOutlined aria-hidden />}
          />
        </StatGrid>
      </Panel>

      <Panel
        title={
          isAdmin
            ? "全部签约（平台范围）"
            : isEnterpriseIdentity
              ? "我的签约（我发起的）"
              : isProOwner
                ? "待我确认 / 我服务的签约"
                : "我承办企业的签约"
        }
        extra={
          <span className="text-12 muted">
            {isProvider
              ? "企业发起签约 → 你确认后生效；未签约或已解约时无法提供服务"
              : "每个服务分类仅可签约一家服务商（跨境出海服务商 6 个细分类分别签约）；请在对应服务资源库/跨境出海服务商发起签约。法律服务可在「律师资源库」与律师一键签约＝与律所签约并指派该律师，知识产权服务可在「代理人资源库」与代理人一键签约＝与知产服务商签约并指派该代理人"}
          </span>
        }
      >
        <div className="table-wrap">
          {contractQuery.error && (
            <Notice variant="error">
              签约加载失败：{contractQuery.error.message}
            </Notice>
          )}
          {statsQuery.error && (
            <Notice variant="error">
              签约统计暂不可用：{statsQuery.error.message}
            </Notice>
          )}
          <Table<ContractRow>
            rowKey="id"
            loading={loading}
            dataSource={rows}
            pagination={{
              current: paging.page,
              pageSize: paging.pageSize,
              total: contractQuery.data?.total || 0,
              onChange: (page, pageSize) => setPaging({ page, pageSize }),
            }}
            size="middle"
            locale={{
              emptyText: (
                <EmptyState
                  icon={<InboxOutlined aria-hidden />}
                  text="暂无签约记录"
                />
              ),
            }}
            columns={[
              {
                title: "合同编号",
                dataIndex: "contractNo",
                width: 160,
                render: (value: string) => (
                  <span className="mono text-12">{value}</span>
                ),
              },
              {
                title: "服务分类",
                dataIndex: "serviceType",
                width: 150,
                render: (value: string) => <CategoryBadge value={value} />,
              },
              {
                title: "服务商",
                dataIndex: "providerOrg",
                width: 240,
                render: (value: string, row: ContractRow) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {value || row.provider_name || "—"}
                    </div>
                    {designatedCell(row)}
                  </div>
                ),
              },
              {
                title: "服务企业",
                dataIndex: "enterpriseName",
                width: 200,
              },
              {
                title: "签约联系方式（企业侧 / 服务商侧）",
                width: 230,
                render: (_: unknown, row: ContractRow) => (
                  <div className="text-12">
                    <div>
                      企业侧：
                      {contactText(row.contactName, row.contactPhone, "待带出")}
                    </div>
                    <div className="muted">
                      服务商侧：
                      {contactText(
                        row.providerContactName,
                        row.providerContactPhone,
                        "待带出",
                      )}
                    </div>
                  </div>
                ),
              },
              {
                title: "状态",
                dataIndex: "status",
                width: 100,
                render: (value: string) => (
                  <StatusBadge domain="contract" status={value} />
                ),
              },
              {
                title: "生效日期",
                dataIndex: "startDate",
                width: 120,
                render: (value: string, row: ContractRow) => (
                  <div>
                    <div>{fmtDate(value)}</div>
                    {row.endDate ? (
                      <div className="text-12 muted">{`至 ${fmtDate(row.endDate)}`}</div>
                    ) : null}
                  </div>
                ),
              },
              {
                title: "备注",
                dataIndex: "note",
                width: 180,
                render: (value: string) => (
                  <span className="text-12 muted">{value || "—"}</span>
                ),
              },
              {
                title: "操作",
                width: 360,
                render: (_: unknown, row: ContractRow) => (
                  <Space size={6} wrap>
                    {buildOps(row)}
                    <OaLaunchButton target="CONTRACT" targetId={row.id} />
                  </Space>
                ),
              },
            ]}
          />
        </div>
      </Panel>

      <DesignateStaffModal
        open={Boolean(designateTarget)}
        contractId={designateTarget?.id || 0}
        categoryLabel={categoryLabel(designateTarget?.serviceType || "")}
        staff={designateTarget?.business_staff || []}
        current={designateTarget?.designated_staff?.name || ""}
        onCancel={() => setDesignateTarget(null)}
        onDone={() => {
          setDesignateTarget(null);
        }}
      />

      <Modal
        open={Boolean(termsTarget)}
        title={`修改签约条款 · ${termsTarget?.contractNo || ""}`}
        width={560}
        onCancel={() => setTermsTarget(null)}
        okText="保存修改（需密码）"
        onOk={saveTerms}
      >
        <div className="text-12 muted" style={{ marginBottom: 12 }}>
          {`服务商：${termsTarget?.providerOrg || termsTarget?.provider_name || "—"} · 服务企业：${termsTarget?.enterpriseName || "—"} · ${categoryLabel(termsTarget?.serviceType || "")}`}
        </div>
        <Form form={termsForm} layout="vertical">
          <div className="form-2col">
            <Form.Item
              name="start_date"
              label="服务起始日期"
              extra="格式 YYYY-MM-DD，留空表示不限"
            >
              <Input placeholder="如：2026-10-01" />
            </Form.Item>
            <Form.Item
              name="end_date"
              label="服务结束日期"
              extra="格式 YYYY-MM-DD，留空表示不限"
            >
              <Input placeholder="如：2027-09-30" />
            </Form.Item>
          </div>
          <Form.Item name="note" label="备注">
            <Input.TextArea
              rows={3}
              maxLength={500}
              placeholder="服务范围、约定事项等"
            />
          </Form.Item>
        </Form>
      </Modal>

      <ContactEditModal
        target={contactTarget}
        onClose={() => setContactTarget(null)}
      />

      {passwordModal}
    </>
  );
}
