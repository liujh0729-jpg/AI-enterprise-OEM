"use client";

import { useCallback, useEffect, useState } from "react";
import {
  App,
  Button,
  Input,
  InputNumber,
  Modal,
  Radio,
  Space,
  Table,
} from "antd";
import {
  QrcodeOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import QRCode from "qrcode";
import {
  EmptyState,
  Notice,
  PageHero,
  Panel,
  PanelTabs,
  StatCard,
  StatGrid,
} from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";
import {
  pointsApi,
  type AiUsageModuleRow,
  type PointTxRow,
  type RechargeOrderRow,
  type UserPointsSettings,
} from "@/api/points";
import {
  aiModuleLabel,
  billingSubjectLabel,
  fmtTokens,
} from "@/lib/ai-usage";
import { useBusinessQuery } from "@/query/business";
import { useI18n } from "@/lib/i18n/i18n";
import { CardOrdersPanel } from "./_components/card-orders";
import { GapsPromoPanel } from "./_components/gaps-promo";

/* ============================================================
   用户「积分中心」（/points）：双币余额（本站积分 + AWcoin 只读）/
   微信充值（Native 扫码 / H5）/ 账号间赠送 / 流水 / 充值订单。
   ============================================================ */

const TX_TYPE_LABEL: Record<string, string> = {
  RECHARGE: "充值",
  RECHARGE_BONUS: "充值赠送",
  EARN: "赚取",
  SPEND: "消费",
  TRANSFER_IN: "收到赠送",
  TRANSFER_OUT: "赠送转出",
  REFUND: "退款",
  ADMIN_ADJUST: "管理员调整",
};

const TX_SCENE_LABEL: Record<string, string> = {
  register: "注册奖励",
  invite: "邀请奖励",
  asset_storage: "数字资产存储",
  bi: "BI 查询",
  oa: "OA 提交",
  ai_customer: "AI 客服",
  crm: "CRM 席位",
  gift: "积分赠送",
  admin: "管理员调整",
  recharge_bonus: "充值赠送",
  service_package: "购买套餐",
  service_package_refund: "套餐退款",
  service_package_rollback: "套餐建单回滚",
};

const ORDER_STATUS: Record<string, { label: string; cls: string }> = {
  CREATED: { label: "待支付", cls: "badge-sky" },
  PAID: { label: "已支付", cls: "badge-green" },
  CLOSED: { label: "已关闭", cls: "badge-gray" },
  FAILED: { label: "失败", cls: "badge-red" },
};

function fmtPoints(value: number | null | undefined) {
  if (value === null || value === undefined) return "0";
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}

function fmtYuan(cents: number | null | undefined) {
  return `¥${((Number(cents) || 0) / 100).toFixed(2)}`;
}

function orderBadge(status: string) {
  const meta = ORDER_STATUS[status] || { label: status || "—", cls: "badge-gray" };
  return <span className={`badge ${meta.cls}`}>{meta.label}</span>;
}

type PayOrder = {
  orderNo: string;
  amountCents: number;
  pointsAmount: number;
  bonusPointsAmount: number;
  channel: string;
  codeUrl: string;
  h5Url: string;
  qr: string;
  status: string;
};

export default function PointsPage() {
  const { t } = useI18n();
  const { message } = App.useApp();
  const summaryQuery = useBusinessQuery("points", "summary", {}, (signal) =>
    pointsApi.summary({ signal }),
  );
  const settingsQuery = useBusinessQuery("points", "settings", {}, (signal) =>
    pointsApi.settings({ signal }),
  );
  const summary = summaryQuery.data ?? null;
  const settings = settingsQuery.data ?? null;
  const reloadSummary = useCallback(async () => {
    await summaryQuery.refetch();
  }, [summaryQuery]);

  const [ordersNonce, setOrdersNonce] = useState(0);
  const [txNonce, setTxNonce] = useState(0);
  const [payOrder, setPayOrder] = useState<PayOrder | null>(null);
  const [serviceTab, setServiceTab] = useState("recharge");

  const payOrderNo = payOrder?.orderNo ?? "";
  const payOrderStatus = payOrder?.status ?? "";

  // 轮询支付结果（每 3 秒，最多 5 分钟）：回调丢失时后端会主动查单兜底
  useEffect(() => {
    if (!payOrderNo || payOrderStatus !== "CREATED") return;
    let cancelled = false;
    let tries = 0;
    const timer = setInterval(async () => {
      if (cancelled) return;
      tries += 1;
      try {
        const result = await pointsApi.rechargeQuery(payOrderNo);
        if (cancelled) return;
        if (result.status !== "CREATED") {
          setPayOrder((prev) => (prev ? { ...prev, status: result.status } : prev));
          if (result.status === "PAID") {
            message.success(
              `充值成功，到账 ${fmtPoints(result.pointsAmount)} 积分${
                result.bonusPointsAmount > 0
                  ? `（含赠送 ${fmtPoints(result.bonusPointsAmount)}）`
                  : ""
              }`,
            );
            await reloadSummary();
            setOrdersNonce((value) => value + 1);
            setTxNonce((value) => value + 1);
          }
        }
      } catch {
        // 查询失败继续轮询
      }
      if (tries >= 100) clearInterval(timer);
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [payOrderNo, payOrderStatus, message, reloadSummary]);

  const arrears = summary?.points.status === "ARREARS";
  const awcoinValue = summary?.awcoin.value;
  /** 上游拿不到余额（未绑定 / 接口无返回）时整块不渲染，不显示「—」占位。 */
  const awcoinVisible = awcoinValue !== null && awcoinValue !== undefined;

  return (
    <>
      <PageHero
        title="积分中心"
        desc="本站积分与 AWcoin 双币展示：积分可充值、可赠送，用于数字资产存储与 CRM / BI / OA / AI 客服等模块消费；AWcoin 只读展示、永不互兑。"
      />

      <Panel title="我的积分">
        <StatGrid>
          <StatCard
            label={t("可用余额")}
            value={fmtPoints(summary?.points.balance)}
            hint={arrears ? t("欠费冻结") : summary?.points.status || "—"}
            icon={<WalletOutlined aria-hidden />}
          />
          <StatCard
            label={t("累计充值")}
            value={fmtPoints(summary?.points.totalRecharge)}
            hint={`1 元 = ${settings ? settings.rate : "—"} 积分`}
          />
          <StatCard
            label={t("累计赚取")}
            value={fmtPoints(summary?.points.totalEarn)}
            hint="注册 / 邀请 / 充值赠送"
          />
          <StatCard
            label={t("累计消费")}
            value={fmtPoints(summary?.points.totalSpend)}
            hint="存储 / CRM / BI / OA / AI 客服"
          />
          {awcoinVisible ? (
            <StatCard
              label={t("AWcoin 余额")}
              value={fmtPoints(awcoinValue)}
              hint={`来源：${summary?.awcoin.source || "—"}`}
            />
          ) : null}
        </StatGrid>

        {arrears ? (
          <Notice variant="error">
            账户已进入欠费宽限：新增功能暂受限（资产只读、不会删除任何数据），充值到账后立即恢复。
            {summary?.points.arrearsSince
              ? ` 欠费自 ${summary.points.arrearsSince.slice(0, 10)} 起。`
              : ""}
          </Notice>
        ) : null}
      </Panel>

      <Panel title="积分服务">
        <PanelTabs
          value={serviceTab}
          onChange={setServiceTab}
          items={[
            {
              key: "recharge",
              label: t("充值"),
              children: (
                <RechargePanel
                  settings={settings}
                  settingsLoading={settingsQuery.isPending}
                  reloadSummary={reloadSummary}
                  onOrder={setPayOrder}
                />
              ),
            },
            {
              key: "transfer",
              label: t("积分赠送"),
              children: (
                <TransferPanel
                  settings={settings}
                  reloadSummary={reloadSummary}
                  onDone={() => setTxNonce((value) => value + 1)}
                />
              ),
            },
            {
              key: "transactions",
              label: t("流水"),
              children: <TransactionsPanel nonce={txNonce} />,
            },
            {
              key: "ai-usage",
              label: t("AI 用量"),
              children: <AiUsagePanel />,
            },
            {
              key: "orders",
              label: t("充值订单"),
              children: <OrdersPanel nonce={ordersNonce} />,
            },
            {
              key: "promo",
              label: t("兑换码"),
              children: <GapsPromoPanel />,
            },
            {
              key: "cards",
              label: t("兑换订单"),
              children: (
                <CardOrdersPanel
                  onChanged={() => {
                    setTxNonce((value) => value + 1);
                    void reloadSummary();
                  }}
                />
              ),
            },
          ]}
        />
      </Panel>

      <Modal
        title={t("生成支付订单")}
        open={Boolean(payOrder)}
        onCancel={() => setPayOrder(null)}
        footer={<Button onClick={() => setPayOrder(null)}>关闭</Button>}
        width={420}
        centered
      >
        {payOrder ? (
          <div style={{ textAlign: "center" }}>
            <div className="text-12 muted">{t("订单号")}：{payOrder.orderNo}</div>
            <div style={{ margin: "6px 0 14px", fontSize: 20, fontWeight: 700 }}>
              {fmtYuan(payOrder.amountCents)}
              <span className="text-12 muted" style={{ marginLeft: 8 }}>
                {t("到账积分")} {fmtPoints(payOrder.pointsAmount)}
                {payOrder.bonusPointsAmount > 0
                  ? ` + ${fmtPoints(payOrder.bonusPointsAmount)}`
                  : ""}
              </span>
            </div>

            {payOrder.status === "PAID" ? (
              <Notice variant="success">支付成功，积分已到账。</Notice>
            ) : payOrder.status === "CLOSED" || payOrder.status === "FAILED" ? (
              <Notice variant="error">订单已关闭（超时未支付或支付失败），请重新下单。</Notice>
            ) : payOrder.channel === "H5" && payOrder.h5Url ? (
              <Space orientation="vertical" size={12}>
                <div className="text-12 muted">{t("请使用微信扫码完成支付")}</div>
                <Button
                  type="primary"
                  href={payOrder.h5Url}
                  target="_blank"
                  icon={<QrcodeOutlined aria-hidden />}
                >
                  打开微信 H5 支付
                </Button>
                <div className="text-12 muted">{t("支付成功后积分自动到账")}</div>
              </Space>
            ) : payOrder.qr ? (
              <Space orientation="vertical" size={10}>
                <RawImg src={payOrder.qr} alt="微信支付二维码" width={260} height={260} />
                <div className="text-12 muted">{t("请使用微信扫码完成支付")}</div>
                <div className="text-12 muted">{t("支付成功后积分自动到账")}（正在自动查询…）</div>
              </Space>
            ) : (
              <Notice variant="warn">未获取到支付二维码，请关闭后重试。</Notice>
            )}
          </div>
        ) : null}
      </Modal>
    </>
  );
}

/* ---------------------------------------------------------------- 充值 */

function RechargePanel({
  settings,
  settingsLoading,
  reloadSummary,
  onOrder,
}: {
  settings: UserPointsSettings | null;
  settingsLoading: boolean;
  reloadSummary: () => Promise<void>;
  onOrder: (order: PayOrder) => void;
}) {
  const { t } = useI18n();
  const { message } = App.useApp();
  const [tierIndex, setTierIndex] = useState<number | null>(null);
  const [customYuan, setCustomYuan] = useState<number | null>(null);
  const [channel, setChannel] = useState<"NATIVE" | "H5">("NATIVE");
  const [busy, setBusy] = useState(false);

  const tiers = settings?.rechargeTiers ?? [];
  const minCents = settings?.rechargeMinCents ?? 100;
  /** 当前待支付金额：自定义金额优先，否则取所选档位；后端按金额匹配赠送档位，这里同口径预告到账。 */
  const selectedCents =
    customYuan !== null && customYuan > 0
      ? Math.round(customYuan * 100)
      : tierIndex !== null
        ? (tiers[tierIndex]?.cents ?? null)
        : null;
  const matchedTier =
    selectedCents !== null ? tiers.find((tier) => tier.cents === selectedCents) : undefined;
  const basePoints = selectedCents
    ? Number(((selectedCents / 100) * (settings?.rate ?? 0)).toFixed(4))
    : 0;
  const bonusPoints = matchedTier
    ? Number(((basePoints * matchedTier.bonusPercent) / 100).toFixed(4))
    : 0;

  const submit = async () => {
    if (!settings?.wechatConfigured) {
      message.error("管理员尚未完成微信支付配置，暂时无法充值");
      return;
    }
    const amountCents =
      customYuan !== null && customYuan > 0
        ? Math.round(customYuan * 100)
        : tierIndex !== null
          ? tiers[tierIndex]?.cents
          : undefined;
    if (!amountCents) {
      message.error("请选择充值档位或填写自定义金额");
      return;
    }
    if (amountCents < minCents) {
      message.error(`最低充值金额为 ${fmtYuan(minCents)}`);
      return;
    }
    try {
      setBusy(true);
      const order = await pointsApi.rechargeCreate({
        amountCents: tierIndex === null ? amountCents : undefined,
        tierIndex: tierIndex === null ? undefined : tierIndex,
        channel,
      });
      const qr = order.codeUrl ? await QRCode.toDataURL(order.codeUrl, { width: 320, margin: 1 }) : "";
      onOrder({
        orderNo: order.orderNo,
        amountCents: order.amountCents,
        pointsAmount: order.pointsAmount,
        bonusPointsAmount: order.bonusPointsAmount,
        channel: order.channel,
        codeUrl: order.codeUrl || "",
        h5Url: order.h5Url || "",
        qr,
        status: "CREATED",
      });
      await reloadSummary();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "下单失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  if (!settingsLoading && !settings) {
    return <Notice variant="error">充值参数加载失败，请刷新页面重试。</Notice>;
  }

  return (
    <div>
      {!settings?.wechatConfigured ? (
        <Notice variant="warn">
          管理员尚未配齐微信支付商户参数（AppID / 商户号 / APIv3 密钥 / 证书 / 私钥），暂时无法充值；
          可先通过「积分赠送」从其他账号获得积分。
        </Notice>
      ) : null}

      <div className="points-block">
        <div className="points-block-title">{t("选择充值档位")}</div>
        <div className="points-tier-grid">
          {tiers.map((tier, index) => {
            const active = tierIndex === index && customYuan === null;
            return (
              <button
                key={index}
                type="button"
                aria-pressed={active}
                className={active ? "points-tier active" : "points-tier"}
                onClick={() => {
                  setTierIndex(index);
                  setCustomYuan(null);
                }}
              >
                <span className="points-tier-amount">{fmtYuan(tier.cents)}</span>
                <span className="points-tier-points">
                  {fmtPoints((tier.cents / 100) * (settings?.rate ?? 0))} 积分
                </span>
                {tier.bonusPercent > 0 ? (
                  <span className="points-tier-bonus">赠送 {tier.bonusPercent}%</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="points-pay-grid">
        <div className="points-field">
          <div className="points-field-label">{t("自定义金额")}</div>
          <InputNumber
            min={minCents / 100}
            step={1}
            prefix="¥"
            style={{ width: "100%" }}
            placeholder={`最低 ${fmtYuan(minCents)}`}
            value={customYuan ?? undefined}
            onChange={(value) => {
              setCustomYuan(typeof value === "number" ? value : null);
              if (typeof value === "number" && value > 0) setTierIndex(null);
            }}
          />
        </div>
        <div className="points-field">
          <div className="points-field-label">{t("支付方式")}</div>
          <Radio.Group
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
            options={[
              { value: "NATIVE", label: t("微信扫码支付") },
              { value: "H5", label: t("微信 H5 支付") },
            ]}
          />
        </div>
      </div>

      <div className="points-pay-actions">
        <div className="points-rate-note">
          汇率 1 元 = {settings?.rate ?? "—"} 积分，以订单创建时为准（永不追溯已充积分）。
          {selectedCents
            ? ` 本次应付 ${fmtYuan(selectedCents)}，到账 ${fmtPoints(basePoints + bonusPoints)} 积分${
                bonusPoints > 0 ? `（含赠送 ${fmtPoints(bonusPoints)}）` : ""
              }。`
            : null}
        </div>
        <Button type="primary" loading={busy} onClick={() => void submit()}>
          {t("生成支付订单")}
        </Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 赠送 */

function TransferPanel({
  settings,
  reloadSummary,
  onDone,
}: {
  settings: UserPointsSettings | null;
  reloadSummary: () => Promise<void>;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const { message } = App.useApp();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [preview, setPreview] = useState<{
    displayName: string;
    userId: string;
    feePercent: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const verify = async () => {
    if (!to.trim()) {
      message.error("请输入对方邀请码或用户名");
      return;
    }
    try {
      const result = await pointsApi.transferPreview({ to: to.trim() });
      setPreview(result);
      message.success(`已找到接收方：${result.displayName}`);
    } catch (error) {
      setPreview(null);
      message.error(error instanceof Error ? error.message : "验证失败");
    }
  };

  const submit = async () => {
    if (!to.trim() || !(Number(amount) > 0)) {
      message.error("请填写接收方与赠送数量");
      return;
    }
    try {
      setBusy(true);
      const result = await pointsApi.transfer({ to: to.trim(), amount: Number(amount) });
      message.success(
        `已赠送给 ${result.toUsername}：${fmtPoints(result.sent)} 积分${
          result.fee > 0 ? `（对方实收 ${fmtPoints(result.received)}，手续费 ${fmtPoints(result.fee)}）` : ""
        }`,
      );
      setTo("");
      setAmount(null);
      setPreview(null);
      await reloadSummary();
      onDone();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "赠送失败");
    } finally {
      setBusy(false);
    }
  };

  if (!settings?.transferEnabled) {
    return (
      <Notice variant="info">
        积分赠送功能已关闭（平台管理员可在后台开启）。你仍可通过邀请好友赚取积分。
      </Notice>
    );
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <Notice variant="info">
        单次不低于 {fmtPoints(settings.transferMin)} 积分
        {settings.transferFeePercent > 0
          ? `，手续费率 ${settings.transferFeePercent}%（从赠送额中扣除）`
          : "，当前免手续费"}
        ；每日笔数与额度上限由平台管理员配置。积分转出后不可撤销。
      </Notice>
      <div className="points-form">
        <div className="points-field">
          <div className="points-field-label">
            {t("接收方")}（{t("邀请码或用户名")}）
          </div>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPreview(null);
              }}
              placeholder={t("邀请码或用户名")}
              maxLength={64}
            />
            <Button onClick={() => void verify()}>{t("验证接收方")}</Button>
          </Space.Compact>
          {preview ? (
            <div className="text-12" style={{ marginTop: 6, color: "#1a7f37" }}>
              接收方：{preview.displayName}
              {preview.feePercent > 0 ? `（手续费率 ${preview.feePercent}%）` : ""}
            </div>
          ) : null}
        </div>
        <div className="points-field">
          <div className="points-field-label">{t("赠送数量")}</div>
          <InputNumber
            min={settings.transferMin}
            step={1}
            style={{ width: "100%" }}
            value={amount ?? undefined}
            onChange={(value) => setAmount(typeof value === "number" ? value : null)}
            suffix="积分"
          />
        </div>
        <Button type="primary" loading={busy} onClick={() => void submit()} style={{ width: 160 }}>
          {t("确认赠送")}
        </Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 流水 */

function TransactionsPanel({ nonce }: { nonce: number }) {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PointTxRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await pointsApi.transactions({ page, size: 10 });
      setRows(data.list);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load, nonce]);

  return (
    <>
      {error ? <Notice variant="error">{error}</Notice> : null}
      <div className="table-wrap">
        <Table<PointTxRow>
          rowKey="id"
          loading={loading}
          dataSource={rows}
          size="middle"
          pagination={{
            current: page,
            pageSize: 10,
            total,
            showSizeChanger: false,
            onChange: setPage,
          }}
          locale={{ emptyText: <EmptyState text={t("暂无流水")} /> }}
          columns={[
            {
              title: "时间",
              width: 160,
              render: (_, row) => (
                <span className="text-12 muted">
                  {row.createdAt ? row.createdAt.replace("T", " ").slice(0, 16) : "—"}
                </span>
              ),
            },
            { title: "类型", width: 110, render: (_, row) => TX_TYPE_LABEL[row.type] || row.type },
            {
              title: "场景",
              width: 130,
              render: (_, row) => TX_SCENE_LABEL[row.scene] || row.scene || "—",
            },
            {
              title: "积分",
              width: 110,
              render: (_, row) => (
                <span style={{ color: row.amount >= 0 ? "#1a7f37" : "#c62828", fontWeight: 600 }}>
                  {row.amount > 0 ? "+" : ""}
                  {fmtPoints(row.amount)}
                </span>
              ),
            },
            { title: "余额", width: 100, render: (_, row) => fmtPoints(row.balanceAmount) },
            { title: t("说明"), render: (_, row) => <span className="text-12">{row.remark || "—"}</span> },
          ]}
        />
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- AI 用量 */

/**
 * 本人各板块的 AI 用量（AI 底座方案 §4.4）：与后台用量页读同一张用量事实，
 * 「未扣分」的行是免费额内或该科目还没配价目——用看得见花了多少代替事前拦截。
 */
function AiUsagePanel() {
  const { t } = useI18n();
  const { data, isPending } = useBusinessQuery(
    "points",
    "ai-usage",
    {},
    (signal) => pointsApi.aiUsage({}, { signal }),
  );
  const totals = data?.totals;

  return (
    <>
      <div className="text-12 muted" style={{ marginBottom: 10 }}>
        {`近 30 天：${fmtPoints(totals?.calls ?? 0)} 次 AI 调用，输入 ${fmtTokens(
          totals?.tokenInAmount ?? 0,
        )} / 输出 ${fmtTokens(totals?.tokenOutAmount ?? 0)} token，消耗 ${fmtPoints(
          totals?.pointsAmount ?? 0,
        )} 积分；AI 洞察产出 ${fmtPoints(totals?.insightCount ?? 0)} 条。`}
      </div>
      <div className="table-wrap">
        <Table<AiUsageModuleRow>
          rowKey={(row) => `${row.module}·${row.code}`}
          loading={isPending}
          dataSource={data?.modules ?? []}
          size="middle"
          pagination={false}
          locale={{ emptyText: <EmptyState text={t("暂无 AI 用量记录")} /> }}
          columns={[
            { title: "板块", width: 150, render: (_, row) => aiModuleLabel(row.module) },
            { title: "科目", width: 170, render: (_, row) => billingSubjectLabel(row.code) },
            { title: "调用次数", width: 110, render: (_, row) => fmtPoints(row.calls) },
            {
              title: "输入 token",
              width: 130,
              render: (_, row) => fmtTokens(row.tokenInAmount),
            },
            {
              title: "输出 token",
              width: 130,
              render: (_, row) => fmtTokens(row.tokenOutAmount),
            },
            { title: "消耗积分", width: 120, render: (_, row) => fmtPoints(row.pointsAmount) },
          ]}
        />
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- 充值订单 */

function OrdersPanel({ nonce }: { nonce: number }) {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<RechargeOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await pointsApi.rechargeOrders({ page, size: 10 });
      setRows(
        data.list.map((row) => ({
          ...row,
          userId: "",
          username: "",
          transactionId: "",
        })),
      );
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load, nonce]);

  return (
    <>
      {error ? <Notice variant="error">{error}</Notice> : null}
      <div className="table-wrap">
        <Table<RechargeOrderRow>
          rowKey="orderNo"
          loading={loading}
          dataSource={rows}
          size="middle"
          pagination={{
            current: page,
            pageSize: 10,
            total,
            showSizeChanger: false,
            onChange: setPage,
          }}
          locale={{ emptyText: <EmptyState text={t("暂无充值订单")} /> }}
          columns={[
            {
              title: t("订单号"),
              width: 200,
              render: (_, row) => <span className="mono text-12">{row.orderNo}</span>,
            },
            { title: "金额", width: 100, render: (_, row) => fmtYuan(row.amountCents) },
            {
              title: t("到账积分"),
              width: 140,
              render: (_, row) => (
                <span>
                  {fmtPoints(row.pointsAmount)}
                  {row.bonusPointsAmount > 0 ? (
                    <span className="text-12" style={{ color: "#1a7f37" }}>
                      {" "}
                      +{fmtPoints(row.bonusPointsAmount)}
                    </span>
                  ) : null}
                </span>
              ),
            },
            { title: t("状态"), width: 100, render: (_, row) => orderBadge(row.status) },
            {
              title: "创建时间",
              width: 160,
              render: (_, row) => (
                <span className="text-12 muted">
                  {row.createdAt ? row.createdAt.replace("T", " ").slice(0, 16) : "—"}
                </span>
              ),
            },
            {
              title: "支付时间",
              width: 160,
              render: (_, row) => (
                <span className="text-12 muted">
                  {row.paidAt ? row.paidAt.replace("T", " ").slice(0, 16) : "—"}
                </span>
              ),
            },
          ]}
        />
      </div>
    </>
  );
}