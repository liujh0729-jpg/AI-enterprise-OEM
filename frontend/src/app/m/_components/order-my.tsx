"use client";

import { Alert, App, Button, Spin } from "antd";
import { useEffect, useMemo, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { useMobileOrders, useSupplyOrderNote } from "@/query/workspaces";
import { contactText } from "@/lib/contacts";
import { useSession } from "@/lib/session";
import {
  SUPPLY_NOTE_TEXT as NOTE_TEXT,
  feeText,
  fmtTime,
  money,
  orderItemText,
  providerLabel,
  staffLabel,
  stockText,
  type SupplyNoteAction as NoteAction,
  type SupplyOrder,
} from "@/app/supply/_components/common";

const QUOTED_STATUSES = ["QUOTED", "ACTIVE", "RETURNED", "VETOED", "CANCELLED"];

const FILTERS: { value: string; label: string }[] = [
  { value: "", label: "全部" },
  { value: "SUBMITTED", label: "待报价" },
  { value: "QUOTED", label: "待确认" },
  { value: "ACTIVE", label: "已生效" },
];

/** H5「我的订货单」：列表 + 详情 + 确认报价 / 驳回 / 否决。 */
export function MobileOrderMine({
  refreshToken = 0,
  onGoCreate,
}: {
  refreshToken?: number;
  onGoCreate?: () => void;
}) {
  const { message } = App.useApp();
  const { me } = useSession();
  const [page,setPage] = useState(1);
  const [filter,setFilter] = useState("");
  const ordersQuery = useMobileOrders(page,filter);
  const orders = useMemo(() => ordersQuery.data?.orders ?? [], [ordersQuery.data]);
  const contracts = ordersQuery.data?.contracts ?? [];
  const loading = ordersQuery.isPending;
  const refreshing = ordersQuery.isFetching;
  const noteMutation = useSupplyOrderNote();
  const [detail, setDetail] = useState<SupplyOrder | null>(null);
  const [noteAction, setNoteAction] = useState<{
    action: NoteAction;
    row: SupplyOrder;
  } | null>(null);
  const [noteText, setNoteText] = useState("");
  const busy = noteMutation.isPending;

  const {refetch} = ordersQuery;
  useEffect(() => {
    if (refreshToken > 0) void refetch();
  }, [refetch, refreshToken]);

  const providerText = (userId: string) =>
    providerLabel(contracts, userId, me?.userId || "", me?.displayName || "");

  const counts:Record<string,number> = {"":ordersQuery.data?.stats?.total ?? 0,...ordersQuery.data?.stats?.byStatus};
  const visible = orders;

  const openNote = (action: NoteAction, row: SupplyOrder) => {
    setNoteAction({ action, row });
    setNoteText("");
  };

  const closeNote = () => {
    setNoteAction(null);
    setNoteText("");
  };

  const submitNote = async () => {
    if (!noteAction) return;
    const { action, row } = noteAction;
    const config = NOTE_TEXT[action];
    if (config.requireNote && !noteText.trim()) {
      message.warning(`请填写${config.label}`);
      return;
    }
    try {
      await noteMutation.mutateAsync({id:row.id, action, note:noteText});
      message.success(config.success);
      closeNote();
      setDetail(null);
    } catch {
      // 操作错误由统一 Mutation Hook 呈现。
    }
  };

  if (loading) {
    return (
      <div className="m-loading">
        <Spin />
      </div>
    );
  }

  if (ordersQuery.isError) return <Alert type="error" message={ordersQuery.error.message} action={<Button onClick={() => void refetch()}>重试</Button>} />;

  return (
    <div className="m-view">
      <div className="m-toolbar">
        <div className="m-chips">
          {FILTERS.map((item) => (
            <button
              type="button"
              key={item.value || "all"}
              className={`m-chip ${filter === item.value ? "is-active" : ""}`}
              onClick={() => {setFilter(item.value);setPage(1);}}
            >
              {item.label}
              {counts[item.value] ? ` ${counts[item.value]}` : ""}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="m-refresh"
          onClick={() => void refetch()}
        >
          {refreshing ? "刷新中" : "刷新"}
        </button>
      </div>

      <div className="m-toolbar"><Button disabled={page<=1} onClick={() => setPage(value => value-1)}>上一页</Button><span>第 {page} 页 · 共 {ordersQuery.data?.total ?? 0} 条</span><Button disabled={page*20 >= (ordersQuery.data?.total ?? 0)} onClick={() => setPage(value => value+1)}>下一页</Button></div>
      {visible.length ? (
        visible.map((row) => (
          <button
            type="button"
            className="m-order"
            key={row.id}
            onClick={() => setDetail(row)}
          >
            <div className="m-order-top">
              <span className="m-order-no">{row.orderNo}</span>
              <StatusBadge domain="supply" status={row.status} />
            </div>
            <div className="m-order-body">{orderItemText(row.items)}</div>
            <div className="m-order-meta">
              <span>{providerText(row.providerUserId)}</span>
              <span>{row.stationName || "—"}</span>
              <span>期望到货 {row.expectedDate || "—"}</span>
            </div>
            <div className="m-order-foot">
              {row.status === "DRAFT" || row.status === "SUBMITTED" ? (
                <span className="m-order-amount muted">待报价</span>
              ) : (
                <span className="m-order-amount">
                  ¥{money(row.totalAmount)}
                </span>
              )}
              <span className="m-order-time">{fmtTime(row.createdAt)}</span>
            </div>
          </button>
        ))
      ) : (
        <div className="m-empty-inline">
          <div className="m-empty-title">
            {filter ? "该状态下暂无订货单" : "还没有订货单"}
          </div>
          <p className="m-empty-text">
            在「下单」页选择服务站与商品规格提交，服务商报价后在这里确认。
          </p>
          {onGoCreate ? (
            <div className="m-inline-actions">
              <Button type="primary" onClick={onGoCreate}>
                去下单
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {detail ? (
        <div className="m-sheet-mask" onClick={() => setDetail(null)}>
          <div className="m-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="m-sheet-head">
              <span>订货单详情</span>
              <button
                type="button"
                className="m-sheet-close"
                onClick={() => setDetail(null)}
              >
                ✕
              </button>
            </div>
            <div className="m-sheet-body">
              <div className="m-detail-head">
                <span className="m-order-no">{detail.orderNo}</span>
                <StatusBadge domain="supply" status={detail.status} />
              </div>

              <div className="m-kv">
                <span>服务站</span>
                <b>{detail.stationName || "—"}</b>
              </div>
              <div className="m-kv">
                <span>服务商</span>
                <b>{providerText(detail.providerUserId)}</b>
              </div>
              <div className="m-kv">
                <span>承办职员</span>
                <b>
                  {detail.staffName ||
                    staffLabel(
                      detail.staffUserId,
                      me?.userId || "",
                      me?.displayName || "",
                    )}
                </b>
              </div>
              <div className="m-kv">
                <span>期望到货</span>
                <b>{detail.expectedDate || "—"}</b>
              </div>
              <div className="m-kv">
                <span>订货联系人</span>
                <b>{contactText(detail.contactName, detail.contactPhone)}</b>
              </div>
              <div className="m-kv">
                <span>提交时间</span>
                <b>{fmtTime(detail.createdAt)}</b>
              </div>
              {detail.revision > 1 ? (
                <div className="m-kv">
                  <span>磋商轮次</span>
                  <b>第 {detail.revision} 版</b>
                </div>
              ) : null}

              <div className="m-block-title">订货明细</div>
              {(detail.items || []).map((item) => (
                <div className="m-line" key={item.id}>
                  <div className="m-line-main">
                    <div className="m-line-name">{item.productName}</div>
                    <div className="m-line-meta">
                      {item.specName ? `${item.specName} · ` : ""}
                      {item.quantity}
                      {item.unit || ""} · ¥{money(item.price)}
                    </div>
                    <div className="m-line-meta">{stockText(item)}</div>
                  </div>
                  <div className="m-line-amount">¥{money(item.amount)}</div>
                </div>
              ))}
              {detail.remark ? (
                <div className="m-note">订货备注：{detail.remark}</div>
              ) : null}

              {QUOTED_STATUSES.includes(detail.status) ? (
                <>
                  <div className="m-block-title">报价信息</div>
                  <div className="m-kv">
                    <span>承诺发货</span>
                    <b>{detail.promisedShipDate || "—"}</b>
                  </div>
                  <div className="m-kv">
                    <span>服务商联系人</span>
                    <b>
                      {contactText(
                        detail.providerContactName,
                        detail.providerContactPhone,
                      )}
                    </b>
                  </div>
                  <div className="m-kv">
                    <span>商品合计</span>
                    <b>¥{money(detail.productAmount)}</b>
                  </div>
                  {Array.isArray(detail.otherFees) &&
                  detail.otherFees.length ? (
                    <div className="m-kv">
                      <span>其他费用</span>
                      <b>{feeText(detail.otherFees)}</b>
                    </div>
                  ) : null}
                  <div className="m-summary">
                    <span>报价总额</span>
                    <strong>¥{money(detail.totalAmount)}</strong>
                  </div>
                  {detail.quoteNote ? (
                    <div className="m-note">服务商备注：{detail.quoteNote}</div>
                  ) : null}
                  {detail.confirmNote ? (
                    <div className="m-note">企业确认备注：{detail.confirmNote}</div>
                  ) : null}
                  {detail.status === "RETURNED" ? (
                    <div className="m-hint">已驳回，等待服务商重新报价。</div>
                  ) : null}
                </>
              ) : null}
            </div>

            <div className="m-sheet-foot">
              {detail.status === "QUOTED" ? (
                <>
                  <Button danger onClick={() => openNote("return", detail)}>
                    驳回
                  </Button>
                  <Button type="primary" onClick={() => openNote("confirm", detail)}>
                    确认报价
                  </Button>
                </>
              ) : null}
              {["DRAFT", "SUBMITTED", "QUOTED", "RETURNED"].includes(
                detail.status,
              ) ? (
                <Button danger onClick={() => openNote("veto", detail)}>
                  否决
                </Button>
              ) : null}
              {!["DRAFT", "SUBMITTED", "QUOTED", "RETURNED"].includes(
                detail.status,
              ) ? (
                <Button onClick={() => setDetail(null)}>关闭</Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {noteAction ? (
        <div className="m-sheet-mask m-sheet-mask-top" onClick={closeNote}>
          <div className="m-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="m-sheet-head">
              <span>{NOTE_TEXT[noteAction.action].title}</span>
              <button type="button" className="m-sheet-close" onClick={closeNote}>
                ✕
              </button>
            </div>
            <div className="m-sheet-body">
              <div className="m-hint">
                {NOTE_TEXT[noteAction.action].tip}
              </div>
              <label className="m-field">
                <span className="m-field-label">
                  {NOTE_TEXT[noteAction.action].label}
                  {NOTE_TEXT[noteAction.action].requireNote ? "（必填）" : "（选填）"}
                </span>
                <textarea
                  className="m-textarea"
                  rows={3}
                  placeholder="填写原因或说明，供服务商与留痕记录查看"
                  value={noteText}
                  onChange={(event) => setNoteText(event.target.value)}
                />
              </label>
            </div>
            <div className="m-sheet-foot">
              <Button onClick={closeNote}>取消</Button>
              <Button
                type="primary"
                danger={NOTE_TEXT[noteAction.action].danger}
                loading={busy}
                onClick={() => void submitNote()}
              >
                {NOTE_TEXT[noteAction.action].okText}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
