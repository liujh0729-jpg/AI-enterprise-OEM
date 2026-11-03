"use client";

import {
  EnvironmentOutlined,
  LoadingOutlined,
  ShopOutlined,
} from "@ant-design/icons";
import { Button, Modal, Table } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { locationText } from "@/components/location-fields";
import { SectionCardList } from "@/components/section-card-list";
import {
  StaffApplyAction,
  WithdrawApplicationButton,
} from "@/components/staff-apply-action";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { useJoinableProviders } from "@/query/identity";
import { identityApi } from "@/api/identity";
import { categoryLabel, fmtDate, type StaffApplicationRow } from "./common";

/** `GET /enterprise/staff/joinable` 的返回结构与机构行。 */
type JoinablePayload = NonNullable<
  Awaited<ReturnType<typeof identityApi.joinable>>
>;
type JoinableSection = JoinablePayload["sections"][number];
type JoinableProvider = JoinableSection["providers"][number];

/** 卡片与详情弹窗共用的机构信息块（同一份字段口径）。 */
function providerFact(provider: JoinableProvider) {
  return {
    items: (provider.serviceItems || []).map((item) => categoryLabel(item)),
    place: locationText(provider.province, provider.city),
  };
}

/**
 * 职员/代理人（含尚未提交个人资料的个人用户）视角：
 * 按本人申报的服务板块列出可申请的已备案服务商 → 查看详情 →「申请加入」→ 机构审核通过即成为其职员/代理人；
 * 同一账号可申请加入多家服务商，本页同时给出「我的加入申请」与撤回入口。
 * 后端：GET /enterprise/staff/joinable、POST /enterprise/staff/affiliations、
 * GET /enterprise/staff/affiliations/mine、DELETE /enterprise/staff/affiliations/:id。
 */
export function JoinPanel({
  myApplications,
  loading,
  onDone,
}: {
  myApplications: StaffApplicationRow[];
  loading: boolean;
  onDone: () => Promise<void>;
}) {
  const router = useRouter();
  const joinable = useJoinableProviders(true);
  const payload = joinable.data as JoinablePayload | null | undefined;
  const sections = payload?.sections || [];
  const hasProfile = payload?.hasProfile !== false;
  const listLoading = joinable.isPending;
  const listError = joinable.error?.message ?? "";
  const [detail, setDetail] = useState<{
    provider: JoinableProvider;
    code: string;
    label: string;
  } | null>(null);

  const cardOf = (section: JoinableSection, provider: JoinableProvider) => {
    const fact = providerFact(provider);
    return (
      <div
        key={`${section.code}:${provider.providerUserId}`}
        className="panel"
        style={{ margin: 0 }}
      >
        <div className="panel-body">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="stat-ico">
              {(provider.orgName || "?").slice(0, 1)}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{provider.orgName || "—"}</div>
              <div className="text-12 muted">
                {provider.qualification || "已备案服务商"}
              </div>
              <div className="text-12 muted" style={{ marginTop: 2 }}>
                <EnvironmentOutlined aria-hidden />{" "}
                {fact.place || "所在地待补充"}
              </div>
            </div>
          </div>
          <div className="text-12 muted" style={{ margin: "10px 0" }}>
            {provider.intro
              ? `${provider.intro.slice(0, 64)}${provider.intro.length > 64 ? "…" : ""}`
              : "—"}
          </div>
          {fact.items.length ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginBottom: 10,
              }}
            >
              {fact.items.slice(0, 4).map((item) => (
                <span key={item} className="badge badge-gray">
                  {item}
                </span>
              ))}
              {fact.items.length > 4 ? (
                <span className="text-12 muted">+{fact.items.length - 4}</span>
              ) : null}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              onClick={() =>
                setDetail({
                  provider,
                  code: section.code,
                  label: section.label,
                })
              }
            >
              查看详情
            </Button>
            <StaffApplyAction
              providerUserId={provider.providerUserId}
              providerName={provider.orgName || provider.providerUserId}
              category={section.code}
              categoryLabel={section.label}
              onChanged={onDone}
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {!hasProfile ? (
        <Notice variant="warn">
          机构审核「申请加入」时看的是你在「身份与资质」提交的个人资料（真实姓名 /
          手机号 / 服务类目 / 个人简介）。先提交资料，申请才会被受理。
          <Button
            style={{ marginLeft: 10 }}
            onClick={() => router.push("/identity?identity=PROVIDER_STAFF")}
          >
            去提交资料
          </Button>
        </Notice>
      ) : null}

      {listError ? <Notice variant="error">{listError}</Notice> : null}

      {listLoading ? (
        <Panel title="申请加入服务商">
          <EmptyState
            icon={<LoadingOutlined aria-hidden spin />}
            text="正在加载可申请加入的服务商…"
          />
        </Panel>
      ) : sections.length ? (
        sections.map((section) => (
          <Panel
            key={section.code}
            title={section.label}
            titleBadge={`本类可申请的服务商共 ${section.providerCount} 家`}
          >
            <SectionCardList
              items={section.providers}
              newestAtOf={() => undefined}
              renderCard={(provider) => cardOf(section, provider)}
            />
          </Panel>
        ))
      ) : (
        <Panel
          title="申请加入服务商"
          titleBadge="按你申报的服务板块匹配已备案服务商"
        >
          <EmptyState
            icon={<ShopOutlined aria-hidden />}
            text="暂无可申请加入的服务商：你在「身份与资质」申报的服务板块，目前没有已通过平台备案的机构开放加入"
          />
        </Panel>
      )}

      <Panel
        title="我的加入申请"
        titleBadge="待审批的申请可撤回；驳回或撤回后可重新申请；一家机构同一类目只留一条"
      >
        <div className="table-wrap">
          <Table<StaffApplicationRow>
            rowKey="id"
            loading={loading}
            dataSource={myApplications}
            pagination={false}
            size="middle"
            locale={{
              emptyText: (
                <EmptyState
                  icon={<ShopOutlined aria-hidden />}
                  text="暂无加入申请：在上方服务商卡片或「服务商详情」里点「申请加入」"
                />
              ),
            }}
            columns={[
              {
                title: "机构",
                width: 220,
                render: (_, row) => (
                  <span style={{ fontWeight: 600 }}>
                    {row.provider_name || row.providerUserId}
                  </span>
                ),
              },
              {
                title: "服务类目",
                width: 150,
                render: (_, row) => (
                  <span className="badge badge-sky">
                    {row.category_label || categoryLabel(row.category)}
                  </span>
                ),
              },
              {
                title: "申请说明",
                ellipsis: true,
                render: (_, row) => (
                  <span className="text-12 muted">{row.note || "—"}</span>
                ),
              },
              {
                title: "状态",
                width: 110,
                render: (_, row) => (
                  <StatusBadge domain="affiliation" status={row.status} />
                ),
              },
              {
                title: "申请时间",
                width: 130,
                render: (_, row) => (
                  <span className="text-12 muted">{fmtDate(row.createdAt)}</span>
                ),
              },
              {
                title: "操作",
                width: 130,
                render: (_, row) =>
                  row.status === "PENDING" ? (
                    <WithdrawApplicationButton
                      applicationId={row.id}
                      providerName={row.provider_name || row.providerUserId}
                      categoryLabel={
                        row.category_label || categoryLabel(row.category)
                      }
                      onDone={onDone}
                    />
                  ) : (
                    <span className="text-12 muted">{row.audit_note || "—"}</span>
                  ),
              },
            ]}
          />
        </div>
      </Panel>

      <Modal
        open={Boolean(detail)}
        title={`服务商详情 · ${detail?.provider.orgName || ""}`}
        width={620}
        onCancel={() => setDetail(null)}
        footer={
          detail ? (
            <>
              <StaffApplyAction
                providerUserId={detail.provider.providerUserId}
                providerName={detail.provider.orgName || detail.code}
                category={detail.code}
                categoryLabel={detail.label}
                onChanged={onDone}
              />
              <Button onClick={() => setDetail(null)}>关闭</Button>
            </>
          ) : null
        }
      >
        {detail ? (
          <>
            <div className="form-2col">
              <div>
                <div className="text-12 muted">机构名称</div>
                <div>{detail.provider.orgName || "—"}</div>
              </div>
              <div>
                <div className="text-12 muted">账号昵称</div>
                <div>{detail.provider.nickname || "—"}</div>
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
                  ) || "—"}
                </div>
              </div>
            </div>
            <div className="text-12 muted" style={{ marginTop: 12 }}>
              机构简介：{detail.provider.intro || "—"}
            </div>
            <div className="text-12 muted" style={{ margin: "14px 0 8px" }}>
              备案服务项
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {providerFact(detail.provider).items.map((item) => (
                <span key={item} className="badge badge-gray">
                  {item}
                </span>
              ))}
              {!providerFact(detail.provider).items.length ? (
                <span className="text-12 muted">—</span>
              ) : null}
            </div>
            <p className="text-12 muted" style={{ marginTop: 12 }}>
              {`申请加入「${detail.label}」后，由该机构在「职员/代理人管理」审核，通过后你即成为其职员/代理人（可同时加入多家机构）。`}
            </p>
          </>
        ) : null}
      </Modal>
    </>
  );
}
