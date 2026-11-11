"use client";

import { CheckCircleOutlined, GiftOutlined, ShoppingCartOutlined } from "@ant-design/icons";
import { App, Button, Modal, Spin } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  servicePackagesApi,
  type ServicePackageQuote,
  type ServicePackageRow,
} from "@/api/service-packages";
import { Notice, Panel } from "@/components/ui/panel";
import { FULFILLMENT_STATUS, PLATFORM_DELIVERY_NOTICE, deliveryCodeLabel } from "@/lib/service-packages";
import { money } from "@/lib/money";
import { useSession } from "@/lib/session";
import { useSiteBase } from "@/lib/site-brand";
import { joinSiteUrl } from "@/lib/site-url";
import { useBusinessMutation, useBusinessQuery } from "@/query/business";
import { presentMutationError } from "@/query/errors";

/** 企业信息提交入口：身份与资质页据此自动展开「用户」身份材料。 */
const ENTERPRISE_PROFILE_PATH = "/identity?identity=ENTERPRISE_USER";

function fmtPoints(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}

/** 财税「您的适用档」：企业档案 SMALL_SCALE 是历史口径，展示统一归一到 SMALL。 */
function normalizeTaxpayerType(value: string | undefined) {
  if (!value) return "";
  return value === "SMALL_SCALE" ? "SMALL" : value;
}

type PurchaseResult = {
  orderNo: string;
  pointsAmount: number;
  balance: number;
  fulfillmentStatus: string;
};

/**
 * 各业务板块「官方服务套餐」共享面板（财税板块替换原参考价格面板）。
 * 套餐＝平台整合优质服务商的一揽子交付：卡片展示人民币价 + 官方汇率实时换算的积分价，
 * 企业积分直购后由平台主持企业与服务商签约兑现；无上架套餐时整块不渲染。
 */
export function ServicePackagesPanel({
  serviceType,
  taxpayerType,
  title = "官方服务套餐",
  badge = PLATFORM_DELIVERY_NOTICE,
}: {
  serviceType: string;
  /** 仅财税板块：按企业纳税人档标记「您的适用档」。 */
  taxpayerType?: string;
  title?: string;
  badge?: string;
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const { me } = useSession();
  const siteBase = useSiteBase();
  const profileUrl = joinSiteUrl(siteBase, ENTERPRISE_PROFILE_PATH);
  const isEnterprise = (me?.roles || []).includes("ENTERPRISE_USER");
  // 购买需以已认证企业主体签约；没有企业档案（或档案未生效）时直接给出补录入口。
  const enterpriseReady = Boolean(
    isEnterprise && me?.enterprise && me.enterprise.status === "APPROVED",
  );

  const query = useBusinessQuery(
    "service-packages",
    "list",
    { serviceType },
    (signal) => servicePackagesApi.list(serviceType, { signal }),
  );
  const rows = query.data?.list ?? [];
  const rate = query.data?.rate ?? 10;

  const [active, setActive] = useState<ServicePackageRow | null>(null);
  const [quote, setQuote] = useState<ServicePackageQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [result, setResult] = useState<PurchaseResult | null>(null);

  const purchase = useBusinessMutation(
    (packageId: number) => servicePackagesApi.purchase(packageId),
    ["service-packages", "points", "contracts"],
  );

  const openBuy = async (row: ServicePackageRow) => {
    setActive(row);
    setResult(null);
    setQuote(null);
    setQuoting(true);
    try {
      setQuote(await servicePackagesApi.quote(row.id));
    } catch (error) {
      presentMutationError(error, (text) => message.error(text));
      setActive(null);
    } finally {
      setQuoting(false);
    }
  };

  const confirmBuy = async () => {
    if (!active) return;
    try {
      const created = await purchase.mutateAsync(active.id);
      setResult(created);
      message.success("购买成功，平台将主持服务商签约并跟踪交付");
    } catch {
      /* Mutation Hook 统一显示操作错误。 */
    }
  };

  // 官方未上架套餐（或加载中/失败）：整块不渲染，板块保持原样。
  if (query.isPending || query.isError || !rows.length) return null;

  const mineType = normalizeTaxpayerType(taxpayerType);

  return (
    <>
      <Panel
        title={
          <>
            <GiftOutlined aria-hidden /> {title}
          </>
        }
        titleBadge={badge}
      >
        {me && !enterpriseReady ? (
          <div style={{ marginBottom: 12 }}>
            <Notice variant="warn">
              采购官方服务套餐需先以已认证的企业主体完成签约。请前往{" "}
              <Link href={ENTERPRISE_PROFILE_PATH} style={{ fontWeight: 600, textDecoration: "underline" }}>
                「身份与资质」完善企业信息
              </Link>
              （企业名称、统一社会信用代码、纳税人类型等，提交后即生效），完成后回到本页即可用积分购买。
              <span className="text-12 muted" style={{ marginLeft: 6 }}>
                链接：<span className="mono">{profileUrl}</span>
              </span>
            </Notice>
          </div>
        ) : null}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: 16,
          }}
        >
          {rows.map((row) => {
            const matchedTaxpayer = Boolean(
              mineType && row.taxpayerType && row.taxpayerType === mineType,
            );
            return (
              <div key={row.id} className="panel" style={{ margin: 0 }}>
                <div className="panel-body">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{row.name}</span>
                    {matchedTaxpayer ? (
                      <span className="badge badge-green">您的适用档</span>
                    ) : null}
                    {row.purchased ? <span className="badge badge-blue">已购买</span> : null}
                    {row.perEnterpriseLimit > 0 ? (
                      <span className="badge badge-gray">每企业限购 {row.perEnterpriseLimit}</span>
                    ) : null}
                  </div>
                  {row.description ? (
                    <div className="text-12 muted" style={{ marginTop: 4 }}>
                      {row.description}
                    </div>
                  ) : null}
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                    <span>
                      <span style={{ fontSize: 14 }}>¥</span>
                      <span style={{ fontSize: 24, fontWeight: 700 }}>{money(row.price)}</span>
                      <span className="text-12">/{row.unit}</span>
                    </span>
                    <span className="badge badge-orange">{fmtPoints(row.pointsPrice)} 积分</span>
                    <span className="text-12 muted">官方汇率 1 元 = {rate} 积分</span>
                  </div>

                  {row.features.length ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                      {row.features.map((item) => (
                        <span key={item} className="badge badge-gray">
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {row.deliveryItems.length ? (
                    <>
                      <div className="text-12 muted" style={{ marginTop: 12 }}>
                        交付项（由平台整合服务商承办）
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                        {row.deliveryItems.map((item) => (
                          <span key={item.code} className="badge badge-sky">
                            {item.label || deliveryCodeLabel(item.code)}
                            {item.providerOrg ? ` · ${item.providerOrg}` : ""}
                          </span>
                        ))}
                      </div>
                      {row.deliveryItems.some((item) => item.providerOrg) ? (
                        <div className="text-12 muted" style={{ marginTop: 4 }}>
                          预绑服务商仅为平台推荐，签约仍须服务商确认后生效。
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  {row.deliveryDesc ? (
                    <div className="text-12 muted" style={{ marginTop: 8 }}>
                      {row.deliveryDesc}
                    </div>
                  ) : null}

                  <div className="text-12" style={{ marginTop: 10, color: "#1a7f37" }}>
                    <CheckCircleOutlined aria-hidden /> {PLATFORM_DELIVERY_NOTICE}
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                    {row.purchased ? (
                      <Button onClick={() => router.push("/my-packages")}>
                        已购买 · 查看交付
                      </Button>
                    ) : null}
                    {enterpriseReady ? (
                      <Button
                        type="primary"
                        icon={<ShoppingCartOutlined aria-hidden />}
                        onClick={() => void openBuy(row)}
                      >
                        积分购买
                      </Button>
                    ) : me ? (
                      <Button
                        type="primary"
                        ghost
                        onClick={() => router.push(ENTERPRISE_PROFILE_PATH)}
                      >
                        先去完善信息，再发起签约
                      </Button>
                    ) : (
                      <span className="text-12 muted">企业账号可用积分购买</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Modal
        title={result ? "购买成功" : `积分购买 · ${active?.name || ""}`}
        open={Boolean(active)}
        onCancel={() => setActive(null)}
        width={560}
        destroyOnHidden
        footer={
          result
            ? [
                <Button
                  key="view"
                  type="primary"
                  onClick={() => {
                    setActive(null);
                    router.push("/my-packages");
                  }}
                >
                  查看我的套餐
                </Button>,
                <Button key="close" onClick={() => setActive(null)}>
                  关闭
                </Button>,
              ]
            : [
                <Button key="cancel" onClick={() => setActive(null)}>
                  取消
                </Button>,
                quote && !quote.hasEnterprise ? (
                  <Button
                    key="profile"
                    type="primary"
                    onClick={() => {
                      setActive(null);
                      router.push(ENTERPRISE_PROFILE_PATH);
                    }}
                  >
                    先去完善信息，再发起签约
                  </Button>
                ) : (
                  <Button
                    key="ok"
                    type="primary"
                    loading={purchase.isPending}
                    disabled={!quote?.sufficient || quote?.limitReached}
                    onClick={() => void confirmBuy()}
                  >
                    确认支付
                  </Button>
                ),
              ]
        }
      >
        {result ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <CheckCircleOutlined style={{ fontSize: 42, color: "#1a7f37" }} aria-hidden />
            <div>
              订单号 <span className="mono">{result.orderNo}</span>
            </div>
            <div className="text-12 muted">
              已扣 {fmtPoints(result.pointsAmount)} 积分，当前余额 {fmtPoints(result.balance)}；
              交付状态：{FULFILLMENT_STATUS[result.fulfillmentStatus]?.label || result.fulfillmentStatus}
            </div>
            <div className="text-12 muted">
              平台将主持企业与优质服务商签约，签约须服务商确认后生效；可在「我的套餐」查看进度。
            </div>
          </div>
        ) : quoting || !quote ? (
          <div style={{ padding: "28px 0", textAlign: "center" }}>
            <Spin />
            <div className="text-12 muted" style={{ marginTop: 10 }}>
              正在按官方汇率实时报价…
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div>
              <span style={{ fontWeight: 600 }}>{quote.name}</span>
              <span className="text-12 muted">
                {" "}· ¥{money(quote.price)} / {active?.unit || "年"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 22, fontWeight: 700 }}>{fmtPoints(quote.pointsPrice)}</span>
              <span className="text-12 muted">积分（按当前官方汇率 1 元 = {quote.rate} 积分实时换算）</span>
            </div>
            <div className="text-12 muted">
              当前可用余额 {fmtPoints(quote.balance)} 积分
            </div>
            {quote.perEnterpriseLimit > 0 ? (
              <div className="text-12 muted">
                当前企业已购 {quote.bought} / {quote.perEnterpriseLimit} 份
              </div>
            ) : null}
            {quote.limitReached ? (
              <div className="text-12" style={{ color: "#b42318" }}>
                当前企业已达该套餐限购数量，不能再次购买。
              </div>
            ) : !quote.sufficient ? (
              <div className="text-12" style={{ color: "#b42318" }}>
                积分余额不足，请先到「积分中心」充值或赚取积分。{" "}
                <Link href="/points">去积分中心</Link>
              </div>
            ) : null}
            {!quote.hasEnterprise ? (
              <Notice variant="warn">
                采购套餐需先提交企业信息并完成认证。请前往{" "}
                <Link href={ENTERPRISE_PROFILE_PATH} style={{ fontWeight: 600, textDecoration: "underline" }}>
                  「身份与资质」完善企业信息
                </Link>
                （企业名称、统一社会信用代码、纳税人类型等），完成后回到本页即可购买。
                <span className="text-12 muted" style={{ marginLeft: 6 }}>
                  链接：<span className="mono">{profileUrl}</span>
                </span>
              </Notice>
            ) : null}
            {quote.deliveryDesc ? (
              <div className="text-12 muted">{quote.deliveryDesc}</div>
            ) : null}
            <div className="text-12" style={{ color: "#1a7f37" }}>
              <CheckCircleOutlined aria-hidden /> {PLATFORM_DELIVERY_NOTICE}；签约须服务商确认后生效，购买后可在「我的套餐」跟踪交付进度。
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
