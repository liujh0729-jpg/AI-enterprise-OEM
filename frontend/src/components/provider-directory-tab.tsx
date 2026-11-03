"use client";

import { EnvironmentOutlined, LoadingOutlined, TagOutlined } from "@ant-design/icons";
import { App, Button, Modal, Pagination } from "antd";
import { useState, type ReactNode } from "react";
import { demandPagination } from "@/components/demand-columns";
import {
  LocationFilterBar,
  locationText,
  type LocationValue,
} from "@/components/location-fields";
import {
  SectionCardList,
  SectionMoreButton,
  newestFirst,
} from "@/components/section-card-list";
import { StaffApplyAction } from "@/components/staff-apply-action";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { useProviderDirectory, useRequestContract } from "@/query/contracts";
import type { DirectoryProvider } from "@enterprise/contracts";
export type { DirectoryProvider } from "@enterprise/contracts";
import { SUBITEM_LABELS } from "@/lib/provider-categories";
import { useSession } from "@/lib/session";

/** 细项分区定义（营销与跨境出海同构：一个细项一个分区、一份独立签约）。 */
export type DirectorySubItem = {
  type: string;
  name: string;
  icon: ReactNode;
  desc: string;
};

/** 细项 code → 中文（未登记 code 时原样显示，便于发现数据问题）。 */
function itemLabel(item: string) {
  return SUBITEM_LABELS[item] || item;
}

/**
 * 服务商资源库页签（营销/物流/资产共用）：已通过平台备案审核的服务商名录，
 * 浏览 → 详情 → 发起签约（签约生效后由该服务商承办对应业务）。
 * 传入 `subItems` 时按细项分区展示（每个细项一份独立签约，未申请该细项的服务商不出现在该分区）。
 */
export function ProviderDirectoryTab({
  serviceType,
  title,
  badge,
  signable = true,
  signHint,
  selfHint,
  subItems,
  exclusive = false,
  locationFilter = false,
}: {
  serviceType: string;
  title: string;
  badge: string;
  /** 该类目是否走签约（四个板块自 2026-09-24 起一律按细项签约，默认 true）。 */
  signable?: boolean;
  signHint?: string;
  /** 服务商本人视角的说明（本人无需签约）。 */
  selfHint?: string;
  /** 细项分区：传入即按细项分区（营销 / 物流 / 资产），不传＝单列表。 */
  subItems?: DirectorySubItem[];
  /**
   * 该分类「一个企业只能签一家」＝出海 / 营销 / 资产细项（物流服务不限家数）。
   * 为 true 时，本企业在该分类已有生效签约（哪怕对象是别家）即显示「分类已签」并隐藏发起入口。
   */
  exclusive?: boolean;
  /** 名录列表页：显示省市筛选条（企业按省、市找服务商）。 */
  locationFilter?: boolean;
}) {
  const { message } = App.useApp();
  const { me } = useSession();
  const roles = me?.roles || [];
  const isEnterprise = roles.includes("ENTERPRISE_USER");
  const isSelf = me?.identities?.includes("SERVICE_PROVIDER") || false;
  // 筛选条＝用户找服务商的入口：当前身份是服务商侧（机构账号 / 职员·代理人）时不渲染（只看同类目同行）。
  const showLocationFilter =
    locationFilter &&
    me?.currentIdentity !== "SERVICE_PROVIDER" &&
    me?.currentIdentity !== "PROVIDER_STAFF";
  const sections = subItems?.length ? subItems : null;

  const [detail, setDetail] = useState<{
    provider: DirectoryProvider;
    type: string;
    name: string;
  } | null>(null);
  const [signing, setSigning] = useState<{
    provider: DirectoryProvider;
    type: string;
    name: string;
  } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(demandPagination.pageSize ?? 10);
  const [loc, setLoc] = useState<LocationValue>({ province: "", city: "" });

  /** 该页签要取的名录分类：细项分区按 6 个细项各取一次，单列表按类目取一次。 */
  const scopedTypes = sections
    ? sections.map((item) => item.type)
    : [serviceType];
  const directoryQuery = useProviderDirectory(scopedTypes, loc.province, loc.city);
  const groups = directoryQuery.data?.groups ?? {};
  const wanted = new Set(scopedTypes);
  const contracts = (directoryQuery.data?.contracts ?? []).filter(item => wanted.has(item.serviceType) && item.status !== "TERMINATED");
  const loading = directoryQuery.isPending;
  const requestContract = useRequestContract();

  const contractOf = (providerUserId: string, type: string) =>
    contracts.find(
      (item) => item.providerUserId === providerUserId && item.serviceType === type,
    );

  /** 独占分类已被「别家」签走（仅企业视角有意义：签约台账是本企业自己的）。 */
  const lockedByOther = (providerUserId: string, type: string) =>
    exclusive && isEnterprise
      ? contracts.find(
          (item) =>
            item.serviceType === type &&
            item.status === "ACTIVE" &&
            item.providerUserId !== providerUserId,
        ) || null
      : null;

  const statusBadge = (providerUserId: string, type: string) => {
    const row = contractOf(providerUserId, type);
    if (row?.status === "ACTIVE") return { cls: "badge-green", label: "已签约" };
    if (row) return { cls: "badge-orange", label: "待确认" };
    if (!signable) return null;
    if (lockedByOther(providerUserId, type))
      return { cls: "badge-gray", label: "分类已签" };
    return { cls: "badge-gray", label: "可签约" };
  };

  const askSign = (provider: DirectoryProvider, type: string, name: string) =>
    setSigning({ provider, type, name });

  /** 单张服务商卡片（分区内、列表页与单列表三处共用同一份实现）。 */
  const cardOf = (
    provider: DirectoryProvider,
    type: string,
    name: string,
  ) => {
    const badgeState = statusBadge(provider.providerUserId, type);
    const locked = lockedByOther(provider.providerUserId, type);
    const intro = provider.intro || "";
    const items = (provider.serviceItemsArr?.length
      ? provider.serviceItemsArr
      : (provider.serviceItems || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
    ).map(itemLabel);
    return (
      <div
        key={`${provider.providerUserId}:${provider.providerType}:${type}`}
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
                {provider.qualification || "已备案服务商"}
              </div>
              <div className="text-12 muted" style={{ marginTop: 2 }}>
                <EnvironmentOutlined aria-hidden /> {locationText(provider.province, provider.city) || "所在地待补充"}
              </div>
            </div>
            {badgeState ? (
              <span className={`badge ${badgeState.cls}`}>
                {badgeState.label}
              </span>
            ) : null}
          </div>
          <div className="text-12 muted" style={{ margin: "10px 0" }}>
            {intro
              ? `${intro.slice(0, 64)}${intro.length > 64 ? "…" : ""}`
              : "—"}
          </div>
          {items.length ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginBottom: 10,
              }}
            >
              {items.slice(0, 4).map((item) => (
                <span key={item} className="badge badge-gray">
                  {item}
                </span>
              ))}
              {items.length > 4 ? (
                <span className="text-12 muted">+{items.length - 4}</span>
              ) : null}
            </div>
          ) : null}
          {locked ? (
            <div className="text-12 muted" style={{ marginTop: -4 }}>
              该服务分类已签约「
              {locked.providerOrg || locked.provider_name || "其他服务商"}
              」，解约后才能再次发起
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button onClick={() => setDetail({ provider, type, name })}>
              查看详情
            </Button>
            <StaffApplyAction
              providerUserId={provider.providerUserId}
              providerName={provider.orgName || provider.providerUserId}
              category={type}
              categoryLabel={name}
            />
            {signable &&
            isEnterprise &&
            !contractOf(provider.providerUserId, type) &&
            !locked ? (
              <Button type="primary" onClick={() => askSign(provider, type, name)}>
                发起签约
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  /** 未分区的名录页（物流 / 资产）仍是单列表 + 分页，卡片同上。 */
  const cardsOf = (type: string, name: string, list: DirectoryProvider[]) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
        gap: 16,
      }}
    >
      {list.map((provider) => cardOf(provider, type, name))}
    </div>
  );

  const providers = newestFirst(groups[serviceType] || [], (item) => item.auditedAt ?? undefined);
  const maxPage = Math.max(1, Math.ceil(providers.length / pageSize));
  const current = Math.min(page, maxPage);
  const pageItems = providers.slice((current - 1) * pageSize, current * pageSize);

  const canSign = signable && isEnterprise;
  /** 名录当前只剩一家机构（同一机构跨多个细项只算一家）：不再展示列表卡片，直接展示详情。 */
  const listedProviders = sections
    ? scopedTypes.flatMap((type) => groups[type] || [])
    : providers;
  const soleProvider =
    listedProviders.length > 0 &&
    new Set(listedProviders.map((item) => item.providerUserId)).size === 1
      ? listedProviders[0]
      : null;

  const emptyText = (name: string) =>
    `暂无${name}服务商，服务商通过「${title.replace(/（.*$/, "")}」备案审核并勾选该细项后在此展示`;

  /** 「只有一家服务商」内嵌视图的动作按钮：与 Modal footer 同口径（申请加入＋发起签约）；分区模式下每个覆盖细项各一份签约。 */
  const renderSoleActions = (
    provider: DirectoryProvider,
    types: string[],
  ) => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
      <StaffApplyAction
        providerUserId={provider.providerUserId}
        providerName={provider.orgName || provider.providerUserId}
        category={types[0] || serviceType}
        categoryLabel={
          sections?.find((svc) => svc.type === types[0])?.name ||
          title.replace(/（.*$/, "")
        }
      />
      {types
        .filter(
          (type) =>
            canSign &&
            !contractOf(provider.providerUserId, type) &&
            !lockedByOther(provider.providerUserId, type),
        )
        .map((type) => (
          <Button
            key={type}
            type="primary"
            onClick={() =>
              askSign(
                provider,
                type,
                sections?.find((svc) => svc.type === type)?.name ||
                  title.replace(/（.*$/, ""),
              )
            }
          >
            发起签约{sections && types.length > 1 ? `（${sections.find((svc) => svc.type === type)?.name || ""}）` : ""}
          </Button>
        ))}
    </div>
  );

  /** 详情主体：Modal 弹窗与「只有一家服务商」内嵌展示共用同一份实现。 */
  const renderDetailBody = (
    provider: DirectoryProvider,
    type: string,
    name: string,
  ) => {
    const bodyBadge = statusBadge(provider.providerUserId, type);
    const bodyLocked = lockedByOther(provider.providerUserId, type);
    const bodyItems = (provider.serviceItemsArr?.length
      ? provider.serviceItemsArr
      : (provider.serviceItems || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
    ).map(itemLabel);
    return (
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
            <div className="text-12 muted">所在省市</div>
            <div>
              {locationText(provider.province, provider.city) || "—"}
            </div>
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
          <div>
            <div className="text-12 muted">备案通过时间</div>
            <div>
              {provider.auditedAt ? provider.auditedAt.slice(0, 10) : "—"}
            </div>
          </div>
          <div>
            <div className="text-12 muted">签约状态</div>
            <div>
              {bodyBadge ? (
                <span className={`badge ${bodyBadge.cls}`}>
                  {bodyBadge.label}
                </span>
              ) : (
                <span className="text-12 muted">
                  不适用（该分类不通过签约合作）
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="text-12 muted" style={{ marginTop: 12 }}>
          机构简介：{provider.intro || "—"}
        </div>
        <div className="text-12 muted" style={{ margin: "14px 0 8px" }}>
          备案服务项
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {bodyItems.map((item) => (
            <span key={item} className="badge badge-gray">
              {item}
            </span>
          ))}
          {!bodyItems.length ? (
            <span className="text-12 muted">—</span>
          ) : null}
        </div>
        <div className="text-12 muted" style={{ margin: "14px 0 6px" }}>
          业务对接人
          {sections
            ? "（指派服务本企业的该细项业务人员）"
            : "（该服务商员工，机构级合作不绑定执行人）"}
        </div>
        {provider.businessStaff?.length ? (
          <div className="text-12">
            {provider.businessStaff
              .map((staff) =>
                [staff.name, staff.title].filter(Boolean).join("（"),
              )
              .join(" · ")}
          </div>
        ) : (
          <div className="text-12 muted">
            {sections
              ? "等待指派"
              : "机构级签约，对接由服务商在承接后安排"}
          </div>
        )}
        {bodyLocked ? (
          <div className="text-12" style={{ marginTop: 6 }}>
            该分类每家企业仅可签约一家服务商：已签约「
            {bodyLocked.providerOrg ||
              bodyLocked.provider_name ||
              "其他服务商"}
            」，解约后才能再次发起
          </div>
        ) : null}
        <p className="text-12 muted" style={{ marginTop: 10 }}>
          {signable
            ? `签约流程：企业发起 → 服务商确认后生效，生效后即可委托该服务商承接「${name}」业务。`
            : signHint ||
              "该分类经「发布服务 / 承接需求」合作，不通过签约绑定服务商。"}
        </p>
      </>
    );
  };

  /** 只有一家服务商时的内嵌详情面板（替代列表卡片，动作按钮与弹窗同口径）。 */
  const renderSolePanel = () => {
    if (!soleProvider) return null;
    // 分区模式：该机构跨了哪几个细项就以哪几个细项为签约对象（首个作主展示）；单列表模式按类目。
    const coveredTypes = sections
      ? scopedTypes.filter((type) =>
          (groups[type] || []).some(
            (item) => item.providerUserId === soleProvider.providerUserId,
          ),
        )
      : [serviceType];
    const type = coveredTypes[0] || soleProvider.providerType || serviceType;
    const name =
      sections?.find((svc) => svc.type === type)?.name ||
      title.replace(/（.*$/, "");
    return (
      <Panel
        title={<>{title} · 唯一服务商</>}
        titleBadge={badge}
        extra={
          showLocationFilter ? (
            <LocationFilterBar
              value={loc}
              onChange={(next) => {
                setLoc(next);
                setPage(1);
              }}
            />
          ) : null
        }
      >
        {isSelf && selfHint ? (
          <p className="text-12 muted" style={{ marginTop: 0 }}>
            {selfHint}
          </p>
        ) : null}
        {renderDetailBody(soleProvider, type, name)}
        {renderSoleActions(soleProvider, coveredTypes)}
      </Panel>
    );
  };

  return (
    <>
      {directoryQuery.isError ? <Notice variant="warn">{directoryQuery.error.message} <Button onClick={() => {void directoryQuery.refetch();}}>重试</Button></Notice> : null}
      {soleProvider ? (
        renderSolePanel()
      ) : sections ? (
        <>
          {loading ? (
            <EmptyState icon={<LoadingOutlined aria-hidden />} text="正在加载服务商名录…" />
          ) : (
            sections.map((svc) => (
              <Panel
                key={svc.type}
                title={<>{svc.icon} {svc.name}</>}
                titleBadge={svc.desc}
                extra={<SectionMoreButton type={svc.type} />}
              >
                {isSelf && selfHint ? (
                  <p className="text-12 muted" style={{ marginTop: 0 }}>
                    {selfHint}
                  </p>
                ) : null}
                <SectionCardList
                  items={groups[svc.type] || []}
                  newestAtOf={(provider) => provider.auditedAt ?? undefined}
                  emptyText={
                    loc.province || loc.city
                      ? `「${locationText(loc.province, loc.city)}」暂无${svc.name}服务商，清空省市筛选可查看全部`
                      : emptyText(svc.name)
                  }
                  renderCard={(provider) => cardOf(provider, svc.type, svc.name)}
                />
              </Panel>
            ))
          )}
        </>
      ) : (
        <Panel
          title={title}
          titleBadge={badge}
          extra={
            <>
              {showLocationFilter ? (
                <LocationFilterBar
                  value={loc}
                  onChange={(next) => {
                    setLoc(next);
                    setPage(1);
                  }}
                />
              ) : null}
              {isEnterprise && !signable && signHint ? (
                <span className="text-12 muted">{signHint}</span>
              ) : null}
            </>
          }
        >
          {isSelf && selfHint ? (
            <p className="text-12 muted" style={{ marginTop: 0 }}>
              {selfHint}
            </p>
          ) : null}
          {loading ? (
            <EmptyState icon={<LoadingOutlined aria-hidden />} text="正在加载服务商名录…" />
          ) : providers.length ? (
            <>
              {cardsOf(serviceType, title.replace(/（.*$/, ""), pageItems)}
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
              icon={<TagOutlined aria-hidden />}
              text={
                loc.province || loc.city
                  ? `「${locationText(loc.province, loc.city)}」暂无${title.replace(/（.*$/, "")}，清空省市筛选可查看全部`
                  : `暂无${title.replace(/（.*$/, "")}，服务商通过对应分类备案审核后在此展示`
              }
            />
          )}
        </Panel>
      )}

      <Modal
        open={Boolean(detail)}
        title={`服务商详情 · ${detail?.provider.orgName || ""}`}
        width={680}
        onCancel={() => setDetail(null)}
        footer={[
          detail ? (
            <StaffApplyAction
              key="apply"
              providerUserId={detail.provider.providerUserId}
              providerName={detail.provider.orgName || detail.type}
              category={detail.type}
              categoryLabel={detail.name}
            />
          ) : null,
          canSign &&
          detail &&
          !contractOf(detail.provider.providerUserId, detail.type) &&
          !lockedByOther(detail.provider.providerUserId, detail.type) ? (
            <Button
              key="sign"
              type="primary"
              onClick={() => {
                const target = detail;
                setDetail(null);
                askSign(target.provider, target.type, target.name);
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
        {detail ? renderDetailBody(detail.provider, detail.type, detail.name) : null}
      </Modal>

      <Modal
        open={Boolean(signing)}
        title="发起签约"
        width={520}
        okText="确认发起"
        cancelText="取消"
        confirmLoading={requestContract.isPending}
        onCancel={() => setSigning(null)}
        onOk={async () => {
          if (!signing) return;
          try {
            await requestContract.mutateAsync({
              provider_id: signing.provider.providerUserId,
              service_type: signing.type,
              note: `${signing.name}合作（服务商资源库发起）`,
            });
            message.success("签约申请已发起，请等待服务商确认（可在「签约管理」跟踪进度）");
            setSigning(null);
          } catch { /* Mutation Hook 统一显示操作错误。 */ }

        }}
      >
        <div className="text-12 muted">
          确认向「{signing?.provider.orgName}」发起「{signing?.name}
          」签约？发起后等待服务商确认，确认后签约生效，该服务商即可承办该业务。
        </div>
      </Modal>
    </>
  );
}
