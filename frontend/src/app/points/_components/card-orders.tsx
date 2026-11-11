"use client";

import { useCallback, useEffect, useState } from "react";
import {
  App,
  Button,
  Drawer,
  Modal,
  Progress,
  Radio,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import { QrcodeOutlined } from "@ant-design/icons";
import QRCode from "qrcode";
import { CARD_ORDER_KIND_LABELS } from "@enterprise/contracts";
import { EmptyState, Notice } from "@/components/ui/panel";
import { HelpTopicButton } from "@/components/ui/help-topic-button";
import { RawImg } from "@/components/ui/raw-img";
import { cardApi, type CardOrder, type CardUsageRow } from "@/api/gaps";
import { useBusinessQuery } from "@/query/business";
import { zhTime } from "@/app/gaps/_components/gaps-common";

/* ============================================================
   积分中心「兑换订单」：三类订单一屏（日卡购买 / 日卡兑换 / 积分兑换），
   每行带额度进度条 + 剩余量 + 剩余时长 + 状态，明细抽屉对得上每次扣量。
   顶部的「用积分兑换」「购买」是本页唯一的下单入口，不再另开菜单。
   ============================================================ */

type OrderKindFilter = "ALL" | "CARD_CASH" | "CARD_CODE" | "CARD_POINTS";
type CashTicket = {
  orderNo: string;
  amountCents: number;
  channel: string;
  codeUrl: string;
  h5Url: string;
  qr: string;
  status: string;
  name: string;
};

const ORDER_BADGE: Record<string, string> = {
  CREATED: "badge-sky",
  PAID: "badge-green",
  ISSUED: "badge-green",
  CLOSED: "badge-gray",
  FAILED: "badge-red",
  REFUNDED: "badge-gray",
};

const CARD_BADGE: Record<string, string> = {
  ACTIVE: "badge-green",
  EXHAUSTED: "badge-gray",
  EXPIRED: "badge-gray",
  REVOKED: "badge-red",
};

function fmtYuan(cents: number | null | undefined) {
  return `¥${((Number(cents) || 0) / 100).toFixed(2)}`;
}

function fmtPoints(value: number | null | undefined) {
  return Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}

/** 剩余时长按「天 + 小时」口语化，日卡只剩几小时时改说小时。 */
function fmtDuration(seconds: number) {
  if (!(seconds > 0)) return "已到期";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分`;
}

export function CardOrdersPanel({ onChanged }: { onChanged?: () => void }) {
  const { message, modal } = App.useApp();
  const [kind, setKind] = useState<OrderKindFilter>("ALL");
  const [page, setPage] = useState(1);
  const [nonce, setNonce] = useState(0);
  const [usageOrder, setUsageOrder] = useState<CardOrder | null>(null);
  const [usagePage, setUsagePage] = useState(1);
  const [cashTicket, setCashTicket] = useState<CashTicket | null>(null);
  const [buyingCode, setBuyingCode] = useState("");
  const [channel, setChannel] = useState<"NATIVE" | "H5">("NATIVE");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const ordersQuery = useBusinessQuery(
    "points",
    "card-orders",
    { kind, page, nonce },
    (signal) =>
      cardApi.orders(
        { query: { page, pageSize: 10, ...(kind === "ALL" ? {} : { kind }) } },
        { signal },
      ),
  );
  const specsQuery = useBusinessQuery(
    "points",
    "card-templates",
    { nonce },
    (signal) => cardApi.templates({}, { signal }),
  );
  const usageQuery = useBusinessQuery(
    "points",
    "card-order-usage",
    { orderNo: usageOrder?.orderNo || "", usagePage },
    (signal) =>
      cardApi.orderUsage(
        {
          params: { orderNo: usageOrder?.orderNo || "" },
          query: { page: usagePage, pageSize: 20 },
        },
        { signal },
      ),
    "all",
    Boolean(usageOrder),
  );

  const specs = specsQuery.data ?? [];
  // 兑换码发的卡也在同一张订单列表里，所以「可兑换的规格」只用来起单，不承担展示义务
  const buyable = specs.filter(
    (spec) => spec.status === "ACTIVE" && (spec.pointsPrice > 0 || spec.cashCents > 0),
  );

  const exchanged = async () => {
    const spec = buyable.find((item) => item.code === buyingCode);
    if (!spec) {
      message.error("请选择要兑换的卡规格");
      return;
    }
    if (!(spec.pointsPrice > 0)) {
      message.error(`${spec.name} 不支持积分兑换，可直接购买`);
      return;
    }
    modal.confirm({
      title: `用积分兑换 ${spec.name}？`,
      content: `扣 ${fmtPoints(spec.pointsPrice)} 积分，激活后 ${spec.validDays} 天内有效（${spec.modelName}·${spec.quotaLabel}）。额度只对该模型生效，到期未用完不结转。`,
      okText: "确认兑换",
      onOk: async () => {
        try {
          const result = await cardApi.exchangeByPoints({
            body: { templateCode: spec.code },
          });
          if (!result) throw new Error("兑换返回为空");
          message.success(
            `兑换成功：${result.card.name} 已激活，余额 ${fmtPoints(result.balance)}`,
          );
          setBuyingCode("");
          onChanged?.();
          reload();
        } catch (error) {
          message.error(error instanceof Error ? error.message : "兑换失败");
          throw error;
        }
      },
    });
  };

  const buy = async () => {
    const spec = buyable.find((item) => item.code === buyingCode);
    if (!spec) {
      message.error("请选择要购买的卡规格");
      return;
    }
    if (!(spec.cashCents > 0)) {
      message.error(`${spec.name} 未设置现金价，暂不支持购买`);
      return;
    }
    try {
      setBusy(true);
      const order = await cardApi.createCashOrder({
        body: { templateCode: spec.code, channel },
      });
      if (!order) throw new Error("下单返回为空");
      setCashTicket({
        orderNo: order.orderNo,
        amountCents: order.amountCents,
        channel: order.channel,
        codeUrl: order.codeUrl || "",
        h5Url: order.h5Url || "",
        qr: order.codeUrl
          ? await QRCode.toDataURL(order.codeUrl, { width: 320, margin: 1 })
          : "",
        status: "CREATED",
        name: spec.name,
      });
      reload();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "下单失败");
    } finally {
      setBusy(false);
    }
  };

  // 支付轮询：回调丢失时后端 queryOrder 会向微信查单兜底，这里只负责把状态推到界面
  const ticketNo = cashTicket?.orderNo ?? "";
  const ticketStatus = cashTicket?.status ?? "";
  useEffect(() => {
    if (!ticketNo || ticketStatus !== "CREATED") return;
    let cancelled = false;
    let tries = 0;
    const timer = setInterval(async () => {
      if (cancelled) return;
      tries += 1;
      try {
        const result = await cardApi.queryOrder({ params: { orderNo: ticketNo } });
        if (cancelled || !result) return;
        if (result.status !== "CREATED") {
          setCashTicket((prev) => (prev ? { ...prev, status: result.status } : prev));
          if (result.status === "ISSUED") {
            message.success(`支付成功，${result.card?.name || "时长卡"} 已激活`);
            onChanged?.();
            reload();
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
  }, [ticketNo, ticketStatus, message, reload, onChanged]);

  const columns = [
    {
      title: "订单号",
      width: 190,
      render: (_: unknown, row: CardOrder) => (
        <span className="mono text-12">{row.orderNo}</span>
      ),
    },
    {
      title: "类型",
      width: 100,
      render: (_: unknown, row: CardOrder) => (
        <Tag color={row.kind === "CARD_CASH" ? "gold" : row.kind === "CARD_CODE" ? "purple" : "blue"}>
          {row.kindLabel || CARD_ORDER_KIND_LABELS[row.kind] || row.kind}
        </Tag>
      ),
    },
    {
      title: "卡 / 模型",
      width: 220,
      render: (_: unknown, row: CardOrder) => (
        <div>
          <div>{row.name}</div>
          <div className="text-12 muted">
            {row.card ? `${row.card.modelName}（${row.card.modelKey}）` : "—"}
          </div>
        </div>
      ),
    },
    {
      title: "额度",
      width: 130,
      render: (_: unknown, row: CardOrder) => (
        <span className="text-12">{row.quotaLabel}</span>
      ),
    },
    {
      title: "消耗进度",
      width: 210,
      render: (_: unknown, row: CardOrder) =>
        row.card ? (
          <div>
            <Progress
              percent={row.card.usedPercent}
              size="small"
              status={row.card.status === "ACTIVE" ? "normal" : "exception"}
            />
            <div className="text-12 muted">
              已用 {row.card.usedLabel}｜剩 {formatRemaining(row)}
            </div>
          </div>
        ) : (
          <span className="text-12 muted">未发卡</span>
        ),
    },
    {
      title: "剩余时长",
      width: 120,
      render: (_: unknown, row: CardOrder) =>
        row.card ? (
          <span className="text-12">
            {fmtDuration(row.card.secondsLeft)}
            <div className="text-12 muted">到 {zhTime(row.card.expiresAt)}</div>
          </span>
        ) : (
          <span className="text-12 muted">—</span>
        ),
    },
    {
      title: "对价",
      width: 120,
      render: (_: unknown, row: CardOrder) => (
        <span className="text-12">
          {row.amountCents > 0
            ? fmtYuan(row.amountCents)
            : row.pointsAmount > 0
              ? `${fmtPoints(row.pointsAmount)} 积分`
              : row.promoCode
                ? row.promoCode
                : "—"}
        </span>
      ),
    },
    {
      title: "状态",
      width: 110,
      render: (_: unknown, row: CardOrder) => (
        <div>
          <span className={`badge ${ORDER_BADGE[row.status] || "badge-gray"}`}>
            {row.statusLabel}
          </span>
          {row.card ? (
            <div style={{ marginTop: 4 }}>
              <span className={`badge ${CARD_BADGE[row.card.status] || "badge-gray"}`}>
                {row.card.statusLabel}
              </span>
            </div>
          ) : null}
          {row.failReason ? (
            <div className="text-12 muted">{row.failReason}</div>
          ) : null}
        </div>
      ),
    },
    {
      title: "时间",
      width: 150,
      render: (_: unknown, row: CardOrder) => (
        <span className="text-12 muted">
          {row.issuedAt ? zhTime(row.issuedAt) : zhTime(row.createdAt)}
        </span>
      ),
    },
    {
      title: "操作",
      width: 80,
      render: (_: unknown, row: CardOrder) =>
        row.card ? (
          <Button
            size="small"
            type="link"
            onClick={() => {
              setUsagePage(1);
              setUsageOrder(row);
            }}
          >
            明细
          </Button>
        ) : null,
    },
  ];

  return (
    <div>
      <div className="points-tab-head">
        <div>
          <div className="points-block-title">兑换订单</div>
          <div className="points-tab-desc">
            日卡购买、兑换码发卡、积分兑换三类订单都在这里；进度、剩余量与剩余时长跟着卡实时走。
          </div>
        </div>
        <Space wrap>
          <HelpTopicButton topic="in-card-codes" />
          <Select
            value={buyingCode || undefined}
            onChange={setBuyingCode}
            style={{ width: 320 }}
            placeholder={specsQuery.isPending ? "规格加载中…" : "选择时长卡规格"}
            loading={specsQuery.isPending}
            options={buyable.map((spec) => ({
              value: spec.code,
              label: `${spec.name}｜${spec.modelName}｜${spec.quotaLabel}｜${spec.validDays} 天${
                spec.pointsPrice > 0 ? `｜${fmtPoints(spec.pointsPrice)} 积分` : ""
              }${spec.cashCents > 0 ? `｜${fmtYuan(spec.cashCents)}` : ""}`,
            }))}
          />
          {(buyable.find((spec) => spec.code === buyingCode)?.cashCents ?? 0) > 0 ? (
            <Radio.Group
              value={channel}
              onChange={(event) => setChannel(event.target.value)}
              options={[
                { value: "NATIVE", label: "微信扫码" },
                { value: "H5", label: "微信 H5" },
              ]}
            />
          ) : null}
          <Button
            disabled={!((buyable.find((spec) => spec.code === buyingCode)?.pointsPrice ?? 0) > 0)}
            onClick={() => void exchanged()}
          >
            用积分兑换
          </Button>
          <Button
            type="primary"
            loading={busy}
            disabled={!((buyable.find((spec) => spec.code === buyingCode)?.cashCents ?? 0) > 0)}
            onClick={() => void buy()}
          >
            购买
          </Button>
        </Space>
      </div>

      {ordersQuery.error ? (
        <Notice variant="error">{ordersQuery.error.message}</Notice>
      ) : null}
      {!specsQuery.isPending && !buyable.length ? (
        <Notice variant="warn">
          平台还没有可兑换的时长卡规格；管理员在「平台管理 → 积分与计费 → 时长卡规格」建好规格后，
          这里即可用积分兑换或直接购买。
        </Notice>
      ) : null}

      <div className="points-inline-form">
        <Segmented
          value={kind}
          onChange={(value) => {
            setKind(value as OrderKindFilter);
            setPage(1);
          }}
          options={[
            { value: "ALL", label: "全部" },
            { value: "CARD_CASH", label: "日卡购买" },
            { value: "CARD_CODE", label: "日卡兑换" },
            { value: "CARD_POINTS", label: "积分兑换" },
          ]}
        />
      </div>

      <div className="table-wrap">
        <Table<CardOrder>
          rowKey="orderNo"
          size="middle"
          loading={ordersQuery.isPending}
          columns={columns}
          dataSource={ordersQuery.data?.list ?? []}
          scroll={{ x: 1500 }}
          pagination={{
            current: page,
            pageSize: 10,
            total: ordersQuery.data?.total ?? 0,
            showSizeChanger: false,
            onChange: setPage,
          }}
          locale={{
            emptyText: (
              <EmptyState
                text={
                  kind === "ALL"
                    ? "还没有兑换订单：上面选个规格用积分兑换，或用兑换码兑换即可看到进度"
                    : "该类型下暂无订单"
                }
              />
            ),
          }}
        />
      </div>

      <Modal
        title="微信支付购买时长卡"
        open={Boolean(cashTicket)}
        onCancel={() => setCashTicket(null)}
        footer={<Button onClick={() => setCashTicket(null)}>关闭</Button>}
        width={420}
        centered
      >
        {cashTicket ? (
          <div style={{ textAlign: "center" }}>
            <div className="text-12 muted">
              {cashTicket.name}｜订单号 {cashTicket.orderNo}
            </div>
            <div style={{ margin: "6px 0 14px", fontSize: 20, fontWeight: 700 }}>
              {fmtYuan(cashTicket.amountCents)}
            </div>
            {cashTicket.status === "ISSUED" ? (
              <Notice variant="success">支付成功，时长卡已激活。</Notice>
            ) : cashTicket.status === "CLOSED" || cashTicket.status === "FAILED" ? (
              <Notice variant="error">订单已关闭（超时未支付或支付失败），请重新下单。</Notice>
            ) : cashTicket.channel === "H5" && cashTicket.h5Url ? (
              <Space orientation="vertical" size={12}>
                <Button
                  type="primary"
                  href={cashTicket.h5Url}
                  target="_blank"
                  icon={<QrcodeOutlined aria-hidden />}
                >
                  打开微信 H5 支付
                </Button>
                <div className="text-12 muted">支付成功后卡自动激活（正在自动查询…）</div>
              </Space>
            ) : cashTicket.qr ? (
              <Space orientation="vertical" size={10}>
                <RawImg src={cashTicket.qr} alt="微信支付二维码" width={260} height={260} />
                <div className="text-12 muted">请使用微信扫码完成支付</div>
                <div className="text-12 muted">支付成功后卡自动激活（正在自动查询…）</div>
              </Space>
            ) : (
              <Notice variant="warn">未获取到支付二维码，请关闭后重试。</Notice>
            )}
          </div>
        ) : null}
      </Modal>

      <Drawer
        open={Boolean(usageOrder)}
        title={usageOrder ? `${usageOrder.name} 消耗明细` : "消耗明细"}
        size={720}
        onClose={() => setUsageOrder(null)}
        destroyOnHidden
      >
        {usageOrder?.card ? (
          <div style={{ marginBottom: 12 }}>
            <Progress percent={usageOrder.card.usedPercent} size="small" />
            <div className="text-12 muted">
              已用 {usageOrder.card.usedLabel}｜剩 {formatRemaining(usageOrder)}｜
              剩余时长 {fmtDuration(usageOrder.card.secondsLeft)}
            </div>
          </div>
        ) : null}
        <div className="text-12 muted" style={{ marginBottom: 8 }}>
          扣量明细与账单一致：卡全额覆盖的调用不产生积分流水，卡不够时能扣多少扣多少、差额转积分。
        </div>
        <Table<CardUsageRow>
          rowKey="id"
          size="small"
          loading={usageQuery.isPending}
          dataSource={usageQuery.data?.list ?? []}
          pagination={{
            current: usagePage,
            pageSize: 20,
            total: usageQuery.data?.total ?? 0,
            showSizeChanger: false,
            onChange: setUsagePage,
          }}
          locale={{ emptyText: <EmptyState text="这张卡还没有扣量记录" /> }}
          columns={[
            {
              title: "时间",
              width: 140,
              render: (_, row) => (
                <span className="text-12 muted">{zhTime(row.createdAt)}</span>
              ),
            },
            {
              title: "模型",
              render: (_, row) => (
                <div>
                  <div>{row.displayName}</div>
                  <div className="text-12 muted">{row.modelKey}</div>
                </div>
              ),
            },
            {
              title: "来源",
              width: 80,
              render: (_, row) => (
                <span className="text-12">{row.source === "API" ? "API" : "站内"}</span>
              ),
            },
            {
              title: "卡扣量",
              width: 120,
              render: (_, row) => <span className="text-12">{row.deductLabel}</span>,
            },
            {
              title: "补扣积分",
              width: 100,
              render: (_, row) => (
                <span className="text-12">
                  {row.pointsCost > 0 ? fmtPoints(row.pointsCost) : "—"}
                </span>
              ),
            },
            {
              title: "说明",
              render: (_, row) => (
                <span className="text-12 muted">{row.message || "—"}</span>
              ),
            },
          ]}
        />
      </Drawer>
    </div>
  );
}

/** 订单行上的「剩余量」：token 卡沿用规格里的万 token 读法，其余按原单位。 */
function formatRemaining(row: CardOrder) {
  const card = row.card;
  if (!card) return "—";
  const value = card.quotaRemaining;
  if (card.billingUnit === "token") {
    return value >= 10000
      ? `${(value / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 万 tokens`
      : `${value.toLocaleString("zh-CN", { maximumFractionDigits: 0 })} tokens`;
  }
  return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 0 })} ${card.billingUnitLabel}`;
}
