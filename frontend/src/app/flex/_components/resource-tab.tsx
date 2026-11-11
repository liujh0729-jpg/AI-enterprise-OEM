"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { identityApi } from "@/api/identity";
import { flexApi } from "@/api/flex";
import { contractsApi } from "@/api/contracts";

import { BankOutlined, UserOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Tag,
} from "antd";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import {
  LocationFields,
  LocationFilterBar,
  locationText,
} from "@/components/location-fields";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { ServicePackagesPanel } from "@/components/service-packages";
import { AddAgentModal } from "@/components/add-agent-modal";
import { useFlexResources } from "@/query/workspaces";
import { useSession } from "@/lib/session";
import {
  PROVIDER_FIELDS,
  caseText,
  fmtTime,
  type FlexContract,
  type FlexProvider,
} from "./common";

type FilterState = {
  province: string;
  city: string;
  keyword: string;
};

const EMPTY_FILTER: FilterState = { province: "", city: "", keyword: "" };

/**
 * 资源库页签（🏢 灵活用工资源库 / 👤 代理人资源库）—— 按身份给不同动作：
 * - 用户：浏览资源并**直接与代理人/机构发起签约**（与代理人签约＝与其小微服务商签约并指派其承办）
 * - 服务商：**＋ 添加代理人**（发起添加申请 → 代理人本人确认后生效；弹窗共用
 *   @/components/add-agent-modal，与知识产权代理人资源库同一实现）
 * - 职员/代理人：看到可挂靠的服务商（机构）并**发起挂靠/合作申请**，由服务商确认
 * - 平台管理员：资源登记由平台统筹（机构由平台维护，登记即对外展示）
 */
export function ResourceTab({
  recordType,
  contracts,
}: {
  recordType: "ORG" | "AGENT";
  /** 企业侧签约台账（由页面统一加载；签约后调用 reload 刷新） */
  contracts: FlexContract[];
  reload: () => Promise<void> | void;
}) {
  const identity_applyMutation = useOperationMutation(identityApi.apply, ["*"]);
  const identity_cancelAffiliationMutation = useOperationMutation(
    identityApi.cancelAffiliation,
    ["*"],
  );
  const flex_updateProviderMutation = useOperationMutation(
    flexApi.updateProvider,
    ["flex", "dashboard"],
  );
  const flex_removeProviderMutation = useOperationMutation(
    flexApi.removeProvider,
    ["flex", "dashboard"],
  );
  const contracts_createMutation = useOperationMutation(contractsApi.create, [
    "*",
  ]);
  const contracts_agentMutation = useOperationMutation(contractsApi.agent, [
    "*",
  ]);

  const { message, modal } = App.useApp();
  const { me } = useSession();
  const router = useRouter();
  const { request: requestPassword, modal: passwordModal } =
    usePasswordConfirm();
  const isAgent = recordType === "AGENT";
  const isAdmin = (me?.roles || []).includes("PLATFORM_ADMIN");
  /** 签约由用户（企业/个体工商户/个人）发起，后端 requireRoles ENTERPRISE_USER */
  const isEnterprise = (me?.roles || []).includes("ENTERPRISE_USER");
  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTER);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTER);
  const resourcesQuery = useFlexResources(recordType, applied);
  const rows = resourcesQuery.data?.rows ?? [];
  const affiliations = resourcesQuery.data?.affiliations ?? [];
  const loading = resourcesQuery.isPending;
  const load = async () => {
    await resourcesQuery.refetch();
  };
  const [detail, setDetail] = useState<FlexProvider | null>(null);
  // 服务商添加代理人（发起申请 → 代理人确认）：弹窗共用 @/components/add-agent-modal
  const [inviteOpen, setInviteOpen] = useState(false);
  // 编辑资源（与后端 requireProvider 同口径：登记服务商 / 平台管理员）
  const [editing, setEditing] = useState<FlexProvider | null>(null);
  const [editForm] = Form.useForm();
  const isProviderIdentity = (me?.currentIdentity || "") === "SERVICE_PROVIDER";
  /** 职员/代理人身份：可在资源库挑选灵活用工服务商（机构/代理人）申请挂靠 */
  const isStaffIdentity = (me?.currentIdentity || "") === "PROVIDER_STAFF";

  const applyAffiliation = async (row: FlexProvider) => {
    try {
      if (!row.providerUserId) {
        message.warning("该记录未绑定服务商账号，无法挂靠");
        return;
      }
      await identity_applyMutation.mutateAsync({
        body: {
          providerUserId: row.providerUserId,
          category: "FLEX_WORK",
        },
      });

      message.success("已提交挂靠申请，待服务商确认后生效");
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const withdrawAffiliation = (row: FlexProvider) => {
    const affiliation = affiliationOf(row);
    if (!affiliation) return;
    modal.confirm({
      title: "撤回挂靠申请",
      okText: "确认撤回",
      cancelText: "取消",
      okButtonProps: { danger: true },
      content: `撤回对「${row.name}」的挂靠申请？撤回后可重新申请。`,
      onOk: async () => {
        await identity_cancelAffiliationMutation.mutateAsync({
          params: { id: String(affiliation.id) },
        });

        message.success("已撤回挂靠申请");
      },
    });
  };

  const asTextList = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.map((item) => String(item));
    if (typeof value === "string" && value.trim()) {
      return value
        .split(/[,，、;；]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  };

  /** 与后端 requireProvider 同口径：登记服务商 / 平台管理员可改删。 */
  const canManage = (row: FlexProvider) =>
    Boolean(isAdmin || (me?.userId && row.providerUserId === me.userId));

  const openEdit = (row: FlexProvider) => {
    setEditing(row);
    editForm.setFieldsValue({
      name: row.name,
      kind: row.kind || "COMPANY",
      organization: row.organization || "",
      province: row.province || undefined,
      city: row.city || undefined,
      fields: asTextList(row.fields),
      licenseNo: row.licenseNo || "",
      intro: row.intro || "",
    });
  };

  const saveResource = async () => {
    if (!editing) return;
    const values = await editForm.validateFields();
    if (!String(values.name || "").trim()) {
      message.warning("名称必填");
      return;
    }
    const body = {
      name: values.name,
      kind: values.kind || "COMPANY",
      organization: values.organization || "",
      province: values.province || "",
      city: values.city || "",
      fields: values.fields || [],
      licenseNo: values.licenseNo || "",
      intro: values.intro || "",
    };
    requestPassword({
      title: "修改资源（需密码）",
      content: `确认修改「${editing.name}」？`,
      okText: "保存修改",
      onOk: async () => {
        await flex_updateProviderMutation.mutateAsync({
          params: { id: String(editing.id) },
          body: body,
        });

        message.success("已保存修改");
        setEditing(null);
      },
    });
  };

  const removeResource = (row: FlexProvider) => {
    requestPassword({
      title: "删除资源",
      danger: true,
      okText: "确认删除",
      content: `确认删除「${row.name}」？已被签约、进件或发薪单引用的资源不可删除；请先处理相关签约与业务单据。`,
      onOk: async () => {
        await flex_removeProviderMutation.mutateAsync({
          params: { id: String(row.id) },
        });

        message.success("已删除");
        setDetail(null);
      },
    });
  };

  const affiliationOf = (row: FlexProvider) =>
    affiliations.find((item) => item.providerUserId === row.providerUserId) ||
    null;

  /* ---------------- 签约 / 指派（对齐 demo flex.js signOrgProvider / signFlexAgent） ---------------- */

  const flexContracts = contracts.filter(
    (item) =>
      item.serviceType === "FLEX_WORK" &&
      ["PENDING", "ACTIVE"].includes(item.status),
  );

  const contractOf = (row: FlexProvider) =>
    row.providerUserId
      ? flexContracts.find(
          (item) => item.providerUserId === row.providerUserId,
        ) || null
      : null;

  /** 资源对外名称：机构卡用所属机构，代理人卡即本人（小微服务商） */
  const providerName = (row: FlexProvider) =>
    row.organization || row.name || "服务商";

  const contractBadge = (contract: FlexContract) => (
    <span
      key="status"
      className={`badge badge-${contract.status === "ACTIVE" ? "green" : "orange"}`}
    >
      {contract.status === "ACTIVE" ? "已签约" : "签约待确认"}
    </span>
  );

  /** 企业 · 与机构签约：生效后可提交用工进件与用工需求。 */
  const signProvider = (row: FlexProvider) => {
    modal.confirm({
      title: "选择该机构合作",
      okText: "确认发起",
      cancelText: "取消",
      content: (
        <>
          确认向「{providerName(row)}」发起灵活用工服务签约？
          <br />
          发起后等待服务商确认，确认后签约生效；生效后可提交用工进件（企业风控表）与用工需求。
        </>
      ),
      onOk: async () => {
        await contracts_createMutation.mutateAsync({
          body: {
            providerUserId: row.providerUserId,
            service_type: "FLEX_WORK",
            note: `灵活用工服务合作（灵活用工资源库发起 · ${row.name}）`,
          },
        });

        message.success(
          "签约申请已发起，请等待服务商确认（可在「签约管理」跟踪进度）",
        );
      },
    });
  };

  /** 企业 · 与代理人签约：＝与其灵活用工服务商签约并指派该代理人承办。 */
  const signFlexAgent = (row: FlexProvider) => {
    modal.confirm({
      title: "与代理人签约",
      okText: "确认签约",
      cancelText: "取消",
      content: (
        <>
          确认与代理人「{row.name}」签约？
          <br />
          与代理人签约即与灵活用工服务商「{providerName(row)}
          」建立灵活用工服务签约，
          并同时把业务指派给该代理人承办（用工进件与用工需求直达该代理人）。
          <br />
          已与该服务商有签约时自动复用，仅更新承办代理人。
        </>
      ),
      onOk: async () => {
        const payload = await contracts_createMutation.mutateAsync({
          body: {
            providerUserId: row.providerUserId,
            service_type: "FLEX_WORK",
            agent_id: row.id,
            note: `与代理人签约（${row.name}）`,
          },
        });

        const reused = Boolean(payload?.reused);
        message.success(
          reused
            ? `已与该服务商有签约，业务现指派给代理人「${row.name}」承办`
            : `签约申请已发起（指派代理人「${row.name}」），服务商确认后生效`,
        );
      },
    });
  };

  /** 企业 · 已签约时更换承办代理人。 */
  const designateAgent = (contract: FlexContract, row: FlexProvider) => {
    modal.confirm({
      title: "指派该代理人",
      okText: "确认指派",
      cancelText: "取消",
      content: (
        <>
          确认将该服务的承办代理人更换为「{row.name}」？
          <br />
          更换后该签约的用工进件与用工需求将对接该代理人承办，可随时更换。
        </>
      ),
      onOk: async () => {
        await contracts_agentMutation.mutateAsync({
          params: { id: String(contract.id) },
          body: { agent_id: row.id },
        });

        message.success(`已指派承办代理人「${row.name}」`);
      },
    });
  };

  /** 卡片操作区（对齐 demo flex orgCard / providerCard：签约状态按身份渲染）。 */
  const cardActions = (row: FlexProvider) => {
    const items: ReactNode[] = [];
    const contract = contractOf(row);
    if (row.providerUserId && isEnterprise) {
      if (!isAgent) {
        items.push(
          contract ? (
            contractBadge(contract)
          ) : (
            <Button key="sign" type="primary" onClick={() => signProvider(row)}>
              发起签约
            </Button>
          ),
        );
      } else if (!contract) {
        items.push(
          <Button key="sign" type="primary" onClick={() => signFlexAgent(row)}>
            与代理人签约
          </Button>,
        );
      } else if (contract.status === "PENDING") {
        items.push(contractBadge(contract));
      } else if (Number(contract.designatedAgentId || 0) === row.id) {
        items.push(
          <span key="mine" className="badge badge-green">
            您的承办代理人
          </span>,
        );
      } else {
        items.push(
          <Button
            key="designate"
            type="primary"
            onClick={() => designateAgent(contract, row)}
          >
            指派该代理人
          </Button>,
        );
      }
    } else if (row.providerUserId && contract) {
      items.push(contractBadge(contract));
    } else if (!row.providerUserId && !isAgent) {
      items.push(
        <span key="platform" className="badge badge-gray">
          平台统筹
        </span>,
      );
    }
    if (isStaffIdentity && row.providerUserId) {
      const affiliation = affiliationOf(row);
      if (affiliation) {
        items.push(
          <StatusBadge
            key="affiliation"
            domain="affiliation"
            status={affiliation.status}
          />,
        );
      }
      if (!affiliation) {
        items.push(
          <Button
            key="apply"
            type="primary"
            onClick={() => void applyAffiliation(row)}
          >
            申请挂靠
          </Button>,
        );
      } else if (affiliation.status === "PENDING") {
        items.push(
          <Button
            key="withdraw"
            danger
            onClick={() => withdrawAffiliation(row)}
          >
            撤回申请
          </Button>,
        );
      }
    }
    if (canManage(row)) {
      items.push(
        <Button key="edit" onClick={() => openEdit(row)}>
          编辑
        </Button>,
        <Button key="remove" danger onClick={() => removeResource(row)}>
          删除
        </Button>,
      );
    }
    return items;
  };

  /** 详情弹窗动作区（对齐 demo showOrgProvider / showProvider 底部：签约 + 前往签约管理）。 */
  const detailFooterActions = (row: FlexProvider) => {
    const items: ReactNode[] = [];
    const contract = contractOf(row);
    if (row.providerUserId && isEnterprise) {
      if (!isAgent) {
        if (!contract) {
          items.push(
            <Button key="sign" type="primary" onClick={() => signProvider(row)}>
              发起签约
            </Button>,
          );
        }
      } else if (!contract) {
        items.push(
          <Button key="sign" type="primary" onClick={() => signFlexAgent(row)}>
            与代理人签约
          </Button>,
        );
      } else if (
        contract.status === "ACTIVE" &&
        Number(contract.designatedAgentId || 0) !== row.id
      ) {
        items.push(
          <Button
            key="designate"
            type="primary"
            onClick={() => designateAgent(contract, row)}
          >
            指派该代理人
          </Button>,
        );
      }
    }
    if (contract) {
      items.push(
        <Button
          key="manage"
          onClick={() => {
            setDetail(null);
            router.push("/contracts");
          }}
        >
          前往签约管理
        </Button>,
      );
    }
    return items;
  };

  return (
    <>
      <Panel
      title={isAgent ? "灵活用工代理人资源库" : "灵活用工资源库（服务商机构）"}
      titleBadge={
        <span className="text-12 muted">
          {isAgent
            ? "代理人即小微服务商（已备案灵活用工服务资质），按省、市与关键词查询；「与代理人签约」＝与灵活用工服务商签约并将业务指派该代理人承办（进件与用工需求直达该代理人）"
            : "服务商机构：企业可查看详情并选择机构发起签约（生效后可提交进件与用工需求）；职员/代理人身份可「申请挂靠」成为该机构职员/代理人（同一服务类目仅可与一家机构签约合作）"}
        </span>
      }
    >
      <Space wrap size={8} style={{ marginBottom: 14 }}>
        <LocationFilterBar
          value={draft}
          onChange={(next) => setDraft({ ...draft, ...next })}
        />
        <Input
          style={{ width: 180 }}
          placeholder={isAgent ? "代理人姓名 / 关键词" : "机构名称 / 关键词"}
          value={draft.keyword}
          onChange={(event) =>
            setDraft({ ...draft, keyword: event.target.value })
          }
        />
        <Button
          onClick={() => {
            setApplied(draft);
          }}
        >
          筛选
        </Button>
        <Button
          onClick={() => {
            setDraft(EMPTY_FILTER);
            setApplied(EMPTY_FILTER);
          }}
        >
          重置
        </Button>
        {isProviderIdentity && isAgent ? (
          <Button type="primary" onClick={() => setInviteOpen(true)}>
            ＋ 添加代理人
          </Button>
        ) : null}
      </Space>

      <AddAgentModal
        open={inviteOpen}
        category="FLEX_WORK"
        agentNoun="代理人"
        extraHint="一类目一机构：该账号在灵活用工类目下已有绑定或待处理申请时会被拦截。"
        onClose={() => setInviteOpen(false)}
      />

      {loading ? (
        <Notice variant="info">数据加载中…</Notice>
      ) : resourcesQuery.isError ? (
        <Notice variant="error">
          {resourcesQuery.error.message}{" "}
          <Button onClick={() => void load()}>重试</Button>
        </Notice>
      ) : rows.length ? (
        <Row gutter={[14, 14]}>
          {rows.map((row) => {
            const fields = asTextList(row.fields);
            const intro = String(row.intro || "");
            return (
              <Col key={row.id} xs={24} md={12} xl={8}>
                <Card size="small" styles={{ body: { padding: 14 } }}>
                  <div style={{ display: "flex", gap: 10 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        background: "#eef2ff",
                        color: "#3b5bdb",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 600,
                        flex: "0 0 auto",
                      }}
                    >
                      {(row.name || "?").slice(0, 1)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{row.name || "—"}</div>
                      <div className="text-12 muted">
                        {row.organization ||
                          (isAgent ? "代理人 · 小微服务商" : "服务商机构")}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      margin: "10px 0",
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    {fields.length ? (
                      fields.map((field) => <Tag key={field}>{field}</Tag>)
                    ) : (
                      <span className="text-12 muted">暂无服务领域标注</span>
                    )}
                  </div>
                  <div className="text-12 muted">
                    {intro.length > 60
                      ? `${intro.slice(0, 60)}…`
                      : intro || "—"}
                  </div>
                  <div
                    style={{
                      marginTop: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <Button onClick={() => setDetail(row)}>查看详情</Button>
                    {cardActions(row)}
                    <span
                      className="text-12 muted"
                      style={{ marginLeft: "auto" }}
                    >
                      所在地：
                      {locationText(row.province, row.city) || "所在地待补充"}
                    </span>
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      ) : (
        <EmptyState
          icon={
            isAgent ? (
              <UserOutlined aria-hidden />
            ) : (
              <BankOutlined aria-hidden />
            )
          }
          text={
            isAgent
              ? "暂无代理人资源，代理人（小微服务商）由平台或服务商登记，备案通过后即对外展示"
              : "暂无服务商机构资源，灵活用工服务商机构由平台统筹维护，登记即对外展示"
          }
        />
      )}

      <Modal
        open={Boolean(detail)}
        title={`${isAgent ? "代理人" : "服务商机构"}详情 · ${detail?.name || ""}`}
        width={620}
        onCancel={() => setDetail(null)}
        footer={
          detail ? (
            <Space wrap size={8}>
              {detailFooterActions(detail)}
              {canManage(detail) ? (
                <Button onClick={() => openEdit(detail)}>编辑</Button>
              ) : null}
              {canManage(detail) ? (
                <Button danger onClick={() => removeResource(detail)}>
                  删除
                </Button>
              ) : null}
              <Button onClick={() => setDetail(null)}>关闭</Button>
            </Space>
          ) : null
        }
      >
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="名称">
            {detail?.name || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="所属机构">
            {detail?.organization || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="所在地">
            {locationText(detail?.province, detail?.city) || "所在地待补充"}
          </Descriptions.Item>
          <Descriptions.Item label="记录类型">
            {detail?.recordType === "AGENT"
              ? "代理人 · 小微服务商"
              : "服务商机构"}
          </Descriptions.Item>
          <Descriptions.Item label="合作服务商">
            {detail?.providerUserId
              ? `${providerName(detail)}（${
                  contractOf(detail)
                    ? contractOf(detail)?.status === "ACTIVE"
                      ? "已签约"
                      : "签约待确认"
                    : "可签约"
                }）`
              : "平台统筹资源（暂不可直接签约）"}
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <StatusBadge domain="affiliation" status={detail?.status} />
          </Descriptions.Item>
          <Descriptions.Item label="审核意见">
            {detail?.auditNote || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="登记时间">
            {fmtTime(detail?.createdAt)}
          </Descriptions.Item>
          <Descriptions.Item label="简介">
            {detail?.intro || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="服务案例">
            {caseText(detail?.cases) || "—"}
          </Descriptions.Item>
        </Descriptions>
      </Modal>

      <Modal
        open={Boolean(editing)}
        title={`修改资源（需密码）· ${editing?.name || ""}`}
        width={600}
        onCancel={() => setEditing(null)}
        footer={
          <Space size={8}>
            <Button onClick={() => setEditing(null)}>取消</Button>
            <Button type="primary" onClick={() => void saveResource()}>
              保存修改
            </Button>
          </Space>
        }
      >
        <Form form={editForm} layout="vertical">
          <Form.Item label="记录类型">
            <Input
              value={editing?.recordType === "AGENT" ? "代理人" : "服务商机构"}
              disabled
            />
          </Form.Item>
          <Form.Item
            name="name"
            label={isAgent ? "代理人姓名 *" : "机构名称 *"}
            rules={[{ required: true, message: "名称必填" }]}
          >
            <Input
              placeholder={isAgent ? "如：张伟" : "如：XX人力资源有限公司"}
            />
          </Form.Item>
          <Form.Item name="kind" label="类型">
            <Select
              options={[
                { value: "COMPANY", label: "企业" },
                { value: "INDIVIDUAL", label: "个人" },
              ]}
            />
          </Form.Item>
          <Form.Item name="organization" label="所属机构">
            <Input placeholder="如：XX人力资源有限公司" />
          </Form.Item>
          <LocationFields extra="资源库按省、市筛选，登记时必选" />
          <Form.Item name="fields" label="服务领域">
            <Select
              mode="multiple"
              placeholder="可多选"
              options={PROVIDER_FIELDS.map((field) => ({
                value: field,
                label: field,
              }))}
            />
          </Form.Item>
          <Form.Item name="licenseNo" label="资质编号">
            <Input placeholder="营业执照号 / 人力资源服务许可证号" />
          </Form.Item>
          <Form.Item name="intro" label="简介">
            <Input.TextArea
              rows={3}
              placeholder="服务能力、擅长行业、成功案例等"
            />
          </Form.Item>
        </Form>
      </Modal>

      {passwordModal}
      </Panel>

      {!isAgent ? <ServicePackagesPanel serviceType="FLEX_WORK" /> : null}
    </>
  );
}
