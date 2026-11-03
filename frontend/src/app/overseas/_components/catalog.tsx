"use client";
import { useOperationMutation } from "@/query/business";
import { contractsApi } from "@/api/contracts";

import { BankOutlined, EnvironmentOutlined } from "@ant-design/icons";
import { App, Button, Modal, Space } from "antd";
import { useState } from "react";
import { StaffApplyAction } from "@/components/staff-apply-action";
import { Panel } from "@/components/ui/panel";
import {
  LocationFilterBar,
  locationText,
  type LocationValue,
} from "@/components/location-fields";
import {
  SectionCardList,
  SectionMoreButton,
} from "@/components/section-card-list";

import { ConfirmModal, type ConfirmState } from "./confirm-modal";
import {
  OVERSEAS_SERVICES,
  OVERSEAS_SERVICE_MAP,
  providerSignStatus,
  providerSupports,
  type OverseasContractRow,
  type OverseasProvider,
  type ProviderSignStatus,
} from "./common";

/**
 * 跨境出海服务商（demo services.js renderCatalog）：
 * 6 类服务按分类展示已备案服务商卡片（分类独立签约）。
 * 卡片区用全站统一的 SectionCardList：默认最新入驻 3 家 →「查看更多」补齐到 5 家 → 分区标题右上角「更多」进该分类服务商列表页。
 */
export function OverseasCatalog({
  providers,
  contracts,
  isEnterprise,
  canSign = true,
}: {
  providers: OverseasProvider[];
  contracts: OverseasContractRow[];
  isEnterprise: boolean;
  /** 个人主体只可浏览名录与申请加入，签约动作锁住。 */
  canSign?: boolean;
  reload: () => Promise<void>;
}) {
  const contracts_createMutation = useOperationMutation(contractsApi.create, [
    "*",
  ]);

  const { message } = App.useApp();
  const [detail, setDetail] = useState<{
    svc: (typeof OVERSEAS_SERVICES)[number];
    provider: OverseasProvider;
  } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [loc, setLoc] = useState<LocationValue>({ province: "", city: "" });
  // 所在省、市精确匹配（未填省市的服务商行不匹配任何筛选值）
  const located = providers.filter(
    (item) =>
      (!loc.province || item.province === loc.province) &&
      (!loc.city || item.city === loc.city),
  );

  /** 个人主体：「可签约」口径改为不可签约（签约按钮不渲染），其余状态照旧。 */
  const signOf = (sign: ProviderSignStatus) =>
    canSign || sign.label !== "可签约"
      ? sign
      : { ...sign, label: "个人主体不可签约" };
  const detailStatus = detail
    ? signOf(providerSignStatus(detail.provider, detail.svc.type, contracts))
    : null;
  const detailItems = detail ? detail.provider.items || [] : [];
  // 对接人 = 指派服务本企业的那个人（签约未指派时显示「等待指派」）
  const detailStaff = detail
    ? contracts.find(
        (item) =>
          item.serviceType === detail.svc.type &&
          item.providerUserId === detail.provider.userId &&
          item.status !== "TERMINATED",
      )?.designatedStaff || null
    : null;

  /**
   * 单张出海服务商卡片（分区内与「更多」列表页各按同一口径展示）。
   * 分区内展示规则（默认 3 家 → 查看更多补齐到 5 家）由 SectionCardList 统一承担，
   * 该分类的完整清单在独立页面 `/providers/<code>`（2026-09-25 用户指令：更多＝进新页面，不弹层）。
   */
  const cardOf = (
    svc: (typeof OVERSEAS_SERVICES)[number],
    provider: OverseasProvider,
  ) => {
    const sign = signOf(providerSignStatus(provider, svc.type, contracts));
    const intro = provider.intro || "";
    return (
      <div
        key={`${svc.type}-${provider.id}`}
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
              <div style={{ fontWeight: 600 }}>{provider.orgName || "—"}</div>
              <div className="text-12 muted">
                {provider.qualification || "已备案出海服务商"}
              </div>
              <div className="text-12 muted">
                <EnvironmentOutlined aria-hidden />{" "}
                {locationText(provider.province, provider.city) ||
                  "所在地待补充"}
              </div>
            </div>
            <span className={`badge ${sign.variant}`}>{sign.label}</span>
          </div>
          <div className="text-12 muted" style={{ margin: "10px 0" }}>
            {intro
              ? `${intro.slice(0, 64)}${intro.length > 64 ? "…" : ""}`
              : "—"}
          </div>
          {sign.locked ? (
            <div className="text-12 muted">
              该服务分类已签约「{sign.lockedProviderName}」，解约后才能再次发起
            </div>
          ) : null}
          <Space size={8} wrap style={{ marginTop: 12 }}>
            <Button onClick={() => setDetail({ svc, provider })}>
              查看详情
            </Button>
            <StaffApplyAction
              providerUserId={provider.userId}
              providerName={provider.orgName || provider.userId}
              category={svc.type}
              categoryLabel={svc.name}
            />
            {canSign && sign.status === "NONE" && !sign.locked ? (
              <Button
                type="primary"
                onClick={() =>
                  setConfirm({
                    title: "发起签约",
                    okText: "确认发起",
                    body: `确认向「${provider.orgName}」发起「${svc.name}」服务签约？每个服务分类仅可签约一家服务商；发起后等待服务商确认，确认后签约生效。`,
                    onOk: async () => {
                      await contracts_createMutation.mutateAsync({
                        body: {
                          provider_id: provider.userId,
                          service_type: svc.type,
                          note: `${svc.name}服务合作（跨境出海服务商发起）`,
                        },
                      });

                      message.success(
                        "签约申请已发起，请等待服务商确认（可在「签约管理」跟踪进度）",
                      );

                      setConfirm(null);
                    },
                  })
                }
              >
                发起签约
              </Button>
            ) : null}
            {(provider.business_staff || []).length ? (
              <span className="text-12 muted">
                对接人 {(provider.business_staff || []).length} 位
              </span>
            ) : null}
          </Space>
        </div>
      </div>
    );
  };

  return (
    <>
      {isEnterprise ? (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: 12,
          }}
        >
          <LocationFilterBar value={loc} onChange={setLoc} />
        </div>
      ) : null}
      {OVERSEAS_SERVICES.map((svc) => {
        const list = located.filter((item) => providerSupports(item, svc.type));
        return (
          <Panel
            key={svc.type}
            title={
              <>
                {svc.icon} {svc.name}
              </>
            }
            titleBadge={svc.desc}
            extra={isEnterprise ? <SectionMoreButton type={svc.type} /> : null}
          >
            {isEnterprise ? (
              <SectionCardList
                items={list}
                newestAtOf={(provider) => provider.auditedAt ?? undefined}
                emptyIcon={<BankOutlined aria-hidden />}
                emptyText={
                  loc.province || loc.city
                    ? `「${locationText(loc.province, loc.city)}」暂无该服务出海服务商，清空省市筛选可查看全部`
                    : "暂无可办理该服务的出海服务商，服务商通过出海备案审核并覆盖该服务细项后在此展示"
                }
                renderCard={(provider) => cardOf(svc, provider)}
              />
            ) : (
              <p className="text-12 muted" style={{ margin: 0 }}>
                企业提交服务申请后，具备出海服务资质的签约服务商可受理办理
              </p>
            )}
          </Panel>
        );
      })}

      <Modal
        open={Boolean(detail)}
        title={`出海服务商详情 · ${detail?.provider.orgName || ""}`}
        width={680}
        onCancel={() => setDetail(null)}
        footer={[
          detail ? (
            <StaffApplyAction
              key="apply"
              providerUserId={detail.provider.userId}
              providerName={detail.provider.orgName || detail.provider.userId}
              category={detail.svc.type}
              categoryLabel={detail.svc.name}
            />
          ) : null,
          detail &&
          canSign &&
          detailStatus?.status === "NONE" &&
          !detailStatus.locked ? (
            <Button
              key="sign"
              type="primary"
              onClick={() => {
                const target = detail;
                setDetail(null);
                setConfirm({
                  title: "发起签约",
                  okText: "确认发起",
                  body: `确认向「${target?.provider.orgName}」发起「${target?.svc.name}」服务签约？每个服务分类仅可签约一家服务商；发起后等待服务商确认，确认后签约生效。`,
                  onOk: async () => {
                    await contracts_createMutation.mutateAsync({
                      body: {
                        provider_id: target?.provider.userId,
                        service_type: target?.svc.type,
                        note: `${target?.svc.name}服务合作（跨境出海服务商发起）`,
                      },
                    });

                    message.success(
                      "签约申请已发起，请等待服务商确认（可在「签约管理」跟踪进度）",
                    );

                    setConfirm(null);
                  },
                });
              }}
            >
              发起签约
            </Button>
          ) : null,
          <Button key="close" onClick={() => setDetail(null)}>
            关闭
          </Button>,
        ]}
      >
        {detail ? (
          <>
            <div className="form-2col">
              <div>
                <div className="text-12 muted">机构名称</div>
                <div>{detail.provider.orgName || "—"}</div>
              </div>
              <div>
                <div className="text-12 muted">统一社会信用代码</div>
                <div>{detail.provider.uscc || "—"}</div>
              </div>
              <div>
                <div className="text-12 muted">服务资质</div>
                <div>{detail.provider.qualification || "—"}</div>
              </div>
              <div>
                <div className="text-12 muted">所在省市</div>
                <div>
                  {locationText(
                    detail.provider.province,
                    detail.provider.city,
                  ) || "所在地待补充"}
                </div>
              </div>
              <div>
                <div className="text-12 muted">联系人</div>
                <div>{detail.provider.contactName || "—"}</div>
              </div>
              <div>
                <div className="text-12 muted">联系电话</div>
                <div>{detail.provider.contactPhone || "—"}</div>
              </div>
              <div>
                <div className="text-12 muted">联系邮箱</div>
                <div>{detail.provider.contactEmail || "—"}</div>
              </div>
            </div>
            <div className="text-12 muted" style={{ marginTop: 10 }}>
              机构简介：{detail.provider.intro || "—"}
            </div>
            <div className="text-12 muted" style={{ margin: "14px 0 8px" }}>
              可办理的出海服务
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {detailItems.map((type) => (
                <span key={type} className="badge badge-gray">
                  {OVERSEAS_SERVICE_MAP[type]?.icon || ""}{" "}
                  {OVERSEAS_SERVICE_MAP[type]?.name || type}
                </span>
              ))}
            </div>
            <div className="text-12 muted" style={{ margin: "14px 0 6px" }}>
              签约状态
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                className={`badge ${detailStatus?.variant || "badge-gray"}`}
              >
                {detailStatus?.label || "可签约"}
              </span>
              <span className="text-12 muted">
                {!canSign
                  ? "签约需以「企业」或「个体工商户」主体办理"
                  : detailStatus?.status === "ACTIVE"
                    ? "已签约生效"
                    : detailStatus?.status === "PENDING"
                      ? "签约待服务商确认"
                      : "未签约"}
              </span>
            </div>
            {detailStatus?.locked ? (
              <div className="text-12" style={{ marginTop: 6 }}>
                每个服务分类仅可签约一家服务商：该分类已签约「
                {detailStatus.lockedProviderName}」，解约后才能再次发起
              </div>
            ) : null}
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
              服务商确认后生效；签约生效后提交的出海服务申请将由该服务商受理，解除签约请在「签约管理」操作。
            </p>
          </>
        ) : null}
      </Modal>

      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
