"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { contractsApi } from "@/api/contracts";

import { BankOutlined, FileProtectOutlined } from "@ant-design/icons";
import { App, Button, Modal, Pagination, Space } from "antd";
import { useState } from "react";
import { demandPagination } from "@/components/demand-columns";
import { StaffApplyAction } from "@/components/staff-apply-action";
import { EmptyState, Panel } from "@/components/ui/panel";

import { TAX_SERVICES, type ContractRow, type TaxProviderApp } from "./common";

/** 签约状态：已签约 / 分类已签（财税一类目一机构）/ 待确认 / 可签约；个人主体只可浏览，不可发起签约。 */
export function signBadge(
  provider: TaxProviderApp,
  contracts: ContractRow[],
  canSign = true,
) {
  // 已解约（TERMINATED）不算签约关系，可重新发起
  const mine = contracts.find(
    (item) =>
      item.providerUserId === provider.userId && item.status !== "TERMINATED",
  );
  if (mine?.status === "ACTIVE") return { cls: "badge-green", label: "已签约" };
  // 一个企业只能与一家财税服务商签约：他方已签则本分类锁定
  if (contracts.some((item) => item.status === "ACTIVE")) {
    return { cls: "badge-gray", label: "分类已签" };
  }
  if (mine) return { cls: "badge-orange", label: "待确认" };
  if (!canSign) {
    return { cls: "badge-gray", label: "个人主体不可签约" };
  }
  return { cls: "badge-gray", label: "可签约" };
}

/** 我的财税服务商签约（按当前企业过滤）。 */
export function myTaxContracts(contracts: ContractRow[], enterpriseId: number) {
  return contracts.filter(
    (item) =>
      item.serviceType === "TAX_FINANCE" &&
      Number(item.enterpriseId) === enterpriseId,
  );
}

/** 纳税人性质归一（历史数据 SMALL 归一到 SMALL_SCALE）。 */
function normalizeType(taxpayerType: string) {
  return taxpayerType === "SMALL_SCALE" || taxpayerType === "SMALL"
    ? "SMALL"
    : "GENERAL";
}

/** 取消签约：一律先弹窗二次确认（解约后财税权限立即停止）。 */
function useCancelContract() {
  const terminateMutation = useOperationMutation(contractsApi.terminate, ["*"]);
  const { modal, message } = App.useApp();
  return (row: ContractRow, orgName: string) => {
    modal.confirm({
      title: "取消签约",
      okText: "确认取消签约",
      cancelText: "再想想",
      okButtonProps: { danger: true },
      content: (
        <div>
          取消与「{orgName}」的
          <b>企业财税服务</b>
          签约后，
          <b>财税服务权限将立即停止</b>
          （提交报税材料、申报、开票申请等）；该分类取消签约后可再次发起，也可改签其他财税服务商。确定取消签约吗？
        </div>
      ),
      onOk: async () => {
        await terminateMutation.mutateAsync({ params: { id: String(row.id) } });
        message.success("签约已取消，可重新发起或改签其他财税服务商");
      },
    });
  };
}

/** 财税服务商详情弹窗（首页「我的财税服务商」与资源库共用）。 */
export function TaxProviderDetailModal({
  provider,
  contracts,
  taxpayerType,
  canSign = true,
  onClose,
  onSign,
  onCancelSign,
}: {
  provider: TaxProviderApp | null;
  contracts: ContractRow[];
  taxpayerType: string;
  /** 个人主体只可浏览名录与申请加入，签约动作锁住。 */
  canSign?: boolean;
  onClose: () => void;
  onSign: (provider: TaxProviderApp) => void;
  onCancelSign?: (row: ContractRow, orgName: string) => void;
}) {
  const mineType = normalizeType(taxpayerType);
  const detailBadge = provider
    ? signBadge(provider, contracts, canSign)
    : null;
  // 已解约的签约不算数：仍可再次发起签约
  const detailContract = provider
    ? contracts.find(
        (item) =>
          item.providerUserId === provider.userId &&
          item.status !== "TERMINATED",
      )
    : undefined;
  const canCancelSign =
    Boolean(detailContract && detailContract.status === "ACTIVE") &&
    Boolean(onCancelSign);
  // 对接人 = 指派服务本企业的那个人（签约未指派时显示「等待指派」）
  const detailStaff = detailContract?.designatedStaff || null;

  return (
    <Modal
      open={Boolean(provider)}
      title={`财税服务商详情 · ${provider?.orgName || ""}`}
      width={680}
      onCancel={onClose}
      footer={[
        provider ? (
          <StaffApplyAction
            key="apply"
            providerUserId={provider.userId}
            providerName={provider.orgName || provider.userId}
            category="TAX_FINANCE"
            categoryLabel="企业财税"
          />
        ) : null,
        provider && canSign && !detailContract && detailBadge?.label === "可签约" ? (
          <Button
            key="sign"
            type="primary"
            onClick={() => {
              if (provider) onSign(provider);
            }}
          >
            发起签约
          </Button>
        ) : null,
        canCancelSign && detailContract ? (
          <Button
            key="cancel"
            danger
            onClick={() =>
              onCancelSign?.(detailContract, provider?.orgName || "")
            }
          >
            取消签约
          </Button>
        ) : null,
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
      ]}
    >
      {provider ? (
        <>
          <div className="form-2col">
            <div>
              <div className="text-12 muted">机构名称</div>
              <div>{provider.orgName || "—"}</div>
            </div>
            <div>
              <div className="text-12 muted">统一社会信用代码</div>
              <div>{provider.uscc || "—"}</div>
            </div>
            <div>
              <div className="text-12 muted">服务资质</div>
              <div>{provider.qualification || "—"}</div>
            </div>
            <div>
              <div className="text-12 muted">联系人</div>
              <div>{provider.contactName || "—"}</div>
            </div>
            <div>
              <div className="text-12 muted">联系电话</div>
              <div>{provider.contactPhone || "—"}</div>
            </div>
            <div>
              <div className="text-12 muted">联系邮箱</div>
              <div>{provider.contactEmail || "—"}</div>
            </div>
          </div>
          <div className="text-12 muted" style={{ marginTop: 10 }}>
            机构简介：{provider.intro || "—"}
          </div>
          <div className="text-12 muted" style={{ margin: "14px 0 8px" }}>
            服务内容（13 项财税服务）
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {TAX_SERVICES.map((item) => (
              <span key={item} className="badge badge-gray">
                {item}
              </span>
            ))}
          </div>
          <div className="text-12 muted" style={{ margin: "14px 0 6px" }}>
            参考价格
          </div>
          <div className="text-12">
            小规模纳税人 ¥360/年 · 一般纳税人 ¥990/年（您适用：
            {mineType === "SMALL" ? "小规模 ¥360/年" : "一般纳税人 ¥990/年"}）
          </div>
          <div className="text-12 muted" style={{ margin: "14px 0 6px" }}>
            签约状态
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className={`badge ${detailBadge?.cls || "badge-gray"}`}>
              {detailBadge?.label || "可签约"}
            </span>
            <span className="text-12 muted">
              {!canSign
                ? "签约需以「企业」或「个体工商户」主体办理"
                : !detailContract
                ? "未签约"
                : detailContract.status === "ACTIVE"
                  ? `已签约生效（${detailContract.contractNo}）`
                  : `签约待服务商确认（${detailContract.contractNo}）`}
            </span>
          </div>
          <div className="text-12 muted" style={{ margin: "14px 0 6px" }}>
            对接人（指派服务本企业的业务人员）
          </div>
          {detailStaff?.name ? (
            <div className="text-12">
              {detailStaff.name}
              {detailStaff.title ? `（${detailStaff.title}）` : ""} ·{" "}
              {detailStaff.phone || "—"}
              {detailStaff.email ? ` · ${detailStaff.email}` : ""}
            </div>
          ) : (
            <div className="text-12 muted">等待指派</div>
          )}
          <p className="text-12 muted" style={{ marginTop: 10 }}>
            签约流程：企业发起 →
            服务商确认后生效；签约生效后即可委托申报、记账等服务。已生效的签约可在此「取消签约」（需二次确认），也可到「签约管理」处理。
          </p>
          {!canSign ? (
            <p className="text-12 muted" style={{ marginTop: 6, marginBottom: 0 }}>
              你是「个人」主体，这里可浏览机构资质并「申请加入服务商」；签约、报税申报、账套、发布财税需求需先在「<a href="/identity">身份与资质</a>」把主体类型变更为「个体工商户」或「企业」。
            </p>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}

/**
 * 企业首页（财税工具页签）：**只显示已签约的财税服务商**
 * —— 未签约给出去资源库的入口，资源库列表见「🏦 财税服务商」页签。
 */
export function MyTaxProviderPanel({
  providers,
  contracts,
  enterpriseId,
  taxpayerType,
  canSign = true,
  onGoProviders,
}: {
  providers: TaxProviderApp[];
  contracts: ContractRow[];
  enterpriseId: number;
  taxpayerType: string;
  /** 个人主体只可浏览名录与申请加入，签约动作锁住。 */
  canSign?: boolean;
  onGoProviders: () => void;
  reload: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<TaxProviderApp | null>(null);
  const cancelContract = useCancelContract();
  const mine = myTaxContracts(contracts, enterpriseId);
  const active = mine.find((item) => item.status === "ACTIVE");
  const pending = mine.find((item) => item.status === "PENDING");
  const row = active || pending;
  const provider = row
    ? providers.find((item) => item.userId === row.providerUserId)
    : undefined;
  const orgName =
    provider?.orgName || row?.providerOrg || row?.provider_name || "—";
  const staff = active?.designatedStaff || null;
  const staffName = staff?.name || "";
  const staffPhone = staff?.phone || active?.providerContactPhone || "";

  if (!row) {
    return (
      <Panel
        title={
          <>
            <BankOutlined aria-hidden /> 我的财税服务商
          </>
        }
        titleBadge="一个企业只能与一家财税服务商签约；服务商资源库见「财税服务商」页签"
      >
        <EmptyState
          icon={<FileProtectOutlined aria-hidden />}
          text="尚未与财税服务商签约"
        />
        <div className="text-12 muted" style={{ marginTop: 8 }}>
          {canSign
            ? "请先在「财税服务商」资源库选择服务商发起签约，签约生效后即可提交报税材料。"
            : "你是「个人」主体，可在这里浏览财税服务商名录并「申请加入服务商」；签约与报税办理需以「企业」或「个体工商户」主体，可在「身份与资质」变更主体类型后重新提交认证。"}
        </div>
        <div style={{ marginTop: 12 }}>
          <Button type="primary" onClick={onGoProviders}>
            前往财税服务商资源库
          </Button>
        </div>
      </Panel>
    );
  }

  return (
    <>
      <Panel
        title={
          <>
            <BankOutlined aria-hidden /> 我的财税服务商
          </>
        }
        titleBadge={
          active
            ? "已签约生效，报税材料由该服务商承办"
            : "签约待服务商确认，确认后生效"
        }
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="stat-ico">{(orgName || "?").slice(0, 1)}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{orgName}</div>
            <div className="text-12 muted">
              {provider?.qualification || "已备案财税服务商"}
            </div>
          </div>
          <span className={`badge ${active ? "badge-green" : "badge-orange"}`}>
            {active ? "已签约" : "待确认"}
          </span>
        </div>
        <div className="form-2col" style={{ marginTop: 12 }}>
          <div>
            <div className="text-12 muted">签约编号</div>
            <div>{row.contractNo || "—"}</div>
          </div>
          <div>
            <div className="text-12 muted">统一社会信用代码</div>
            <div>{provider?.uscc || "—"}</div>
          </div>
          <div>
            <div className="text-12 muted">承办对接人（财务专员）</div>
            <div>{staffName || "等待指派"}</div>
          </div>
          <div>
            <div className="text-12 muted">联系电话</div>
            <div>{staffPhone || provider?.contactPhone || "—"}</div>
          </div>
        </div>
        <Space size={8} style={{ marginTop: 12 }} wrap>
          {provider ? (
            <Button onClick={() => setDetail(provider)}>查看服务商详情</Button>
          ) : null}
          {active ? (
            <Button danger onClick={() => cancelContract(active, orgName)}>
              取消签约
            </Button>
          ) : null}
          <Button href="/contracts">前往签约管理</Button>
          <span className="text-12 muted">
            {active
              ? "取消签约需二次确认，解约后方可与其他财税服务商签约"
              : "待服务商确认期间可在「签约管理」撤销该签约"}
          </span>
        </Space>
      </Panel>

      <TaxProviderDetailModal
        provider={detail}
        contracts={mine}
        taxpayerType={taxpayerType}
        canSign={canSign}
        onClose={() => setDetail(null)}
        onSign={() => setDetail(null)}
        onCancelSign={cancelContract}
      />
    </>
  );
}

/**
 * 「🏦 财税服务商」页签：已备案财税服务商资源库（浏览 → 详情 → 发起签约）。
 * 财税一类目一机构：已签约后其余服务商显示「分类已签」。
 */
export function TaxProvidersTab({
  providers,
  contracts,
  enterpriseId,
  taxpayerType,
  canSign = true,
}: {
  providers: TaxProviderApp[];
  contracts: ContractRow[];
  enterpriseId: number;
  taxpayerType: string;
  /** 个人主体只可浏览名录与申请加入，签约动作锁住。 */
  canSign?: boolean;
  reload: () => Promise<void>;
}) {
  const contracts_createMutation = useOperationMutation(contractsApi.create, [
    "*",
  ]);

  const { message } = App.useApp();
  const [detail, setDetail] = useState<TaxProviderApp | null>(null);
  const [signing, setSigning] = useState<TaxProviderApp | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const cancelContract = useCancelContract();
  const mine = myTaxContracts(contracts, enterpriseId);
  // 资源库分页：与各板块需求列表同口径（10 条/页，可切换页大小）
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(demandPagination.pageSize ?? 10);
  const maxPage = Math.max(1, Math.ceil(providers.length / pageSize));
  const current = Math.min(page, maxPage);
  const pageItems = providers.slice(
    (current - 1) * pageSize,
    current * pageSize,
  );

  return (
    <>
      <Panel
        title={
          <>
            <BankOutlined aria-hidden /> 财税服务商（资源库）
          </>
        }
        titleBadge={
          canSign
            ? "均为已通过平台备案审核的财税服务商，进入详情可查看资质并发起签约"
            : "均为已通过平台备案审核的财税服务商，进入详情可查看资质并申请加入服务商；签约需以企业或个体工商户主体办理"
        }
      >
        {providers.length ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                gap: 16,
              }}
            >
              {pageItems.map((provider) => {
                const badge = signBadge(provider, mine, canSign);
                const intro = provider.intro || "";
                return (
                  <div
                    key={provider.id}
                    className="panel"
                    style={{ margin: 0 }}
                  >
                    <div className="panel-body">
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <span className="stat-ico">
                          {(provider.orgName || "?").slice(0, 1)}
                        </span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 600 }}>
                            {provider.orgName || "—"}
                          </div>
                          <div className="text-12 muted">
                            {provider.qualification || "已备案财税服务商"}
                          </div>
                        </div>
                        <span className={`badge ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </div>
                      <div
                        className="text-12 muted"
                        style={{ margin: "10px 0" }}
                      >
                        {intro
                          ? `${intro.slice(0, 64)}${intro.length > 64 ? "…" : ""}`
                          : "—"}
                      </div>
                      <Space size={8} wrap>
                        <Button onClick={() => setDetail(provider)}>
                          查看详情
                        </Button>
                        <StaffApplyAction
                          providerUserId={provider.userId}
                          providerName={provider.orgName || provider.userId}
                          category="TAX_FINANCE"
                          categoryLabel="企业财税"
                        />
                        <span className="text-12 muted">
                          参考价格 ¥360/年起
                        </span>
                      </Space>
                    </div>
                  </div>
                );
              })}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: 14,
              }}
            >
              <Pagination
                {...demandPagination}
                current={current}
                pageSize={pageSize}
                total={providers.length}
                onChange={(nextPage, nextSize) => {
                  setPage(nextPage);
                  setPageSize(nextSize);
                }}
              />
            </div>
          </>
        ) : (
          <EmptyState
            icon={<BankOutlined aria-hidden />}
            text="暂无财税服务商，服务商通过平台备案审核后在此展示"
          />
        )}
      </Panel>

      <TaxProviderDetailModal
        provider={detail}
        contracts={mine}
        taxpayerType={taxpayerType}
        canSign={canSign}
        onClose={() => setDetail(null)}
        onSign={(target) => {
          setDetail(null);
          setSigning(target);
        }}
        onCancelSign={cancelContract}
      />

      <Modal
        open={Boolean(signing)}
        title="发起签约"
        width={520}
        okText="确认发起"
        cancelText="取消"
        confirmLoading={submitting}
        onCancel={() => setSigning(null)}
        onOk={async () => {
          try {
            if (!signing) return;
            setSubmitting(true);
            try {
              await contracts_createMutation.mutateAsync({
                body: {
                  provider_id: signing.userId,
                  service_type: "TAX_FINANCE",
                  note: "企业财税服务合作（服务商资源库发起）",
                },
              });

              message.success(
                "签约申请已发起，请等待服务商确认（可在「签约管理」跟踪进度）",
              );
              setSigning(null);
            } finally {
              setSubmitting(false);
            }
          } catch (error) {
            if (error instanceof Error)
              presentMutationError(error, (text) => message.error(text));
          }
        }}
      >
        <div className="text-12 muted">
          确认向「{signing?.orgName}
          」发起财税服务签约？发起后等待服务商确认，确认后签约生效；参考价格最终以签约约定为准。
        </div>
      </Modal>
    </>
  );
}
