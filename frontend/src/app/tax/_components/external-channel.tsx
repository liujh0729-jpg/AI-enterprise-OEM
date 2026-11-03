"use client";

import { TruckOutlined } from "@ant-design/icons";
import { App, Button, Input, Space, Timeline } from "antd";
import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Notice, Panel } from "@/components/ui/panel";
import { useExternalDeclaration, useExternalAction } from "@/query/tax";
import { presentMutationError } from "@/query/errors";
import { fmtTime } from "./common";

export type ExternalSubmission = NonNullable<
  import("@enterprise/contracts").EndpointResponse<"External_byRef">["data"]
>[number];

/**
 * 申报单详情「外报通道」（阶段 1：人工通道）：
 * 报文预览/下载 → 人工报送作业指引 → 回填受理号 → 回填回执 → 人工确认扣款，全程留痕。
 */
export function ExternalChannelPanel({
  declId,
  declStatus,
  canWork,
}: {
  declId: number;
  declStatus: string;
  canWork: boolean;
  reload: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const externalQuery = useExternalDeclaration(declId);
  const rows = externalQuery.data?.rows ?? [];
  const preview = externalQuery.data?.preview;
  const load = async () => {
    await externalQuery.refetch();
  };
  const [acceptNo, setAcceptNo] = useState("");
  const [receiptNo, setReceiptNo] = useState("");
  const [rawBody, setRawBody] = useState("");
  const [payNote, setPayNote] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState("");
  const actionMutation = useExternalAction();

  const run = async (
    key:
      "create" | "retry" | "cancel" | "submit" | "receipt" | "pay" | "reject",
    id: number,
    body: Record<string, string>,
    okText: string,
  ) => {
    setBusy(key);
    try {
      await actionMutation.mutateAsync({ action: key, id, body });
      message.success(okText);

      return true;
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
      return false;
    } finally {
      setBusy("");
    }
  };

  const downloadPayload = (
    payload: Record<string, unknown>,
    hash: string,
    name: string,
  ) => {
    const content = JSON.stringify(payload, null, 2);
    const url = URL.createObjectURL(
      new Blob([content], { type: "application/json;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name || "tax-declaration"}-${hash.slice(0, 12)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const row = rows[0];

  if (!row) {
    if (externalQuery.isPending)
      return <Notice variant="info">外报记录加载中…</Notice>;
    if (externalQuery.isError)
      return (
        <Notice variant="error">
          {externalQuery.error.message}{" "}
          <Button onClick={() => void load()}>重试</Button>
        </Notice>
      );

    return (
      <Panel
        title={
          <>
            <TruckOutlined aria-hidden /> 外报通道
          </>
        }
        titleBadge={<span className="badge badge-gray">尚未生成外报任务</span>}
        extra={
          <Space size={6} wrap>
            {preview ? (
              <Button
                onClick={() =>
                  downloadPayload(
                    preview.payload,
                    preview.payloadHash,
                    preview.refNo,
                  )
                }
              >
                下载报文
              </Button>
            ) : null}
            {canWork ? (
              <Button
                type="primary"
                disabled={declStatus !== "FILED"}
                loading={busy === "create"}
                onClick={() =>
                  void run("create", declId, {}, "已生成外报任务与作业指引")
                }
              >
                生成外报任务
              </Button>
            ) : null}
          </Space>
        }
      >
        {preview ? (
          <>
            <div className="ext-meta">
              <span>
                外报目标 <b>{preview.targetSystem}</b>
              </span>
              <span>
                税种 <b>{preview.taxTypeLabel}</b>
              </span>
              <span>
                属期 <b>{preview.period || "—"}</b>
              </span>
              <span>
                报文指纹{" "}
                <b className="mono">{preview.payloadHash.slice(0, 16)}</b>
              </span>
            </div>
            <Notice variant="info">
              <div style={{ fontWeight: 600 }}>
                报文已按申报表生成（未报送）
              </div>
              <div className="text-12" style={{ marginTop: 4 }}>
                财务专员「确认并审核」通过后自动建单，或在下方手动生成。
                同一申报单的报文指纹稳定可复现，报送前可下载归档。
              </div>
            </Notice>
            <pre className="ext-payload" style={{ marginTop: 12 }}>
              {JSON.stringify(preview.payload, null, 2)}
            </pre>
          </>
        ) : (
          <div className="text-12 muted">
            报文预览不可用（该申报单暂不可访问）。
          </div>
        )}
      </Panel>
    );
  }

  const guide = row.guide || {};
  const canAct = Boolean(row.canAct);

  return (
    <Panel
      title={
        <>
          <TruckOutlined aria-hidden /> 外报通道
        </>
      }
      titleBadge={<StatusBadge domain="external" status={row.status} />}
      extra={
        <Space size={6} wrap>
          <Button
            onClick={() =>
              downloadPayload(row.payload, row.payloadHash, row.refNo)
            }
          >
            下载报文
          </Button>
          {row.status === "REJECTED" || row.status === "CANCELLED" ? (
            <Button
              disabled={!canAct}
              loading={busy === "retry"}
              onClick={() =>
                void run("retry", row.id, {}, "已重新排队（复用原报文）")
              }
            >
              重试
            </Button>
          ) : null}
          {row.status === "QUEUED" ? (
            <Button
              danger
              disabled={!canAct}
              loading={busy === "cancel"}
              onClick={() => void run("cancel", row.id, {}, "外报任务已作废")}
            >
              作废
            </Button>
          ) : null}
        </Space>
      }
    >
      <div className="ext-meta">
        <span>
          通道{" "}
          <b>{row.channelCode === "MANUAL" ? "人工通道" : row.channelCode}</b>
        </span>
        <span>
          外报目标 <b>{row.targetSystem || guide.system || "—"}</b>
        </span>
        <span>
          税种 <b>{row.taxTypeLabel || row.taxType}</b>
        </span>
        <span>
          属期 <b>{row.period || "—"}</b>
        </span>
        <span>
          报文指纹 <b className="mono">{row.payloadHash.slice(0, 16)}</b>
        </span>
        <span>
          受理号 <b className="mono">{row.acceptNo || "—"}</b>
        </span>
        <span>
          回执号 <b className="mono">{row.receiptNo || "—"}</b>
        </span>
        <span>
          报送次数 <b>{row.attempts}</b>
        </span>
      </div>

      {row.status === "REJECTED" ? (
        <Notice variant="error">
          <div style={{ fontWeight: 600 }}>
            官方退回（{row.errorCode || "—"}）
          </div>
          <div className="text-12" style={{ marginTop: 4 }}>
            {row.errorMsg || "未填写退回原因"}
          </div>
        </Notice>
      ) : null}

      <div style={{ fontWeight: 600, margin: "4px 0 8px" }}>
        人工报送作业指引（{guide.system || row.targetSystem}）
      </div>
      <ol className="ext-steps">
        {(guide.steps || []).map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
      {guide.notice ? (
        <div className="text-12 muted" style={{ marginTop: 8 }}>
          注意：{guide.notice}
        </div>
      ) : null}
      <div className="text-12 muted" style={{ marginTop: 6 }}>
        经办凭据：{guide.credential || "企业 CA/UKey 或电子税务局子账号"}
        （凭据仅企业本人可在「外报凭据」维护，界面不回显明文）
      </div>

      {canAct ? (
        <div style={{ marginTop: 16 }}>
          <div className="ext-fields">
            {row.status === "QUEUED" || row.status === "SUBMITTING" ? (
              <div>
                <div className="text-12 muted" style={{ marginBottom: 4 }}>
                  官方受理号（报送后回填）
                </div>
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    value={acceptNo}
                    placeholder="如 11010020260921000888"
                    onChange={(event) => setAcceptNo(event.target.value)}
                  />
                  <Button
                    type="primary"
                    loading={busy === "submit"}
                    onClick={() =>
                      void run("submit", row.id, { acceptNo }, "已回填受理号")
                    }
                  >
                    回填受理号
                  </Button>
                </Space.Compact>
              </div>
            ) : null}

            {row.status === "ACCEPTED" ? (
              <div>
                <div className="text-12 muted" style={{ marginBottom: 4 }}>
                  官方回执号 / 申报成功凭证号
                </div>
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    value={receiptNo}
                    placeholder="如 20260921-RCPT-0001"
                    onChange={(event) => setReceiptNo(event.target.value)}
                  />
                  <Button
                    type="primary"
                    loading={busy === "receipt"}
                    onClick={() =>
                      void run(
                        "receipt",
                        row.id,
                        { receiptNo, rawBody },
                        "已回填回执",
                      )
                    }
                  >
                    回填回执
                  </Button>
                </Space.Compact>
              </div>
            ) : null}

            {row.status === "RECEIPT" ? (
              <div>
                <div className="text-12 muted" style={{ marginBottom: 4 }}>
                  扣款结果（资金类操作人工确认后回填）
                </div>
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    value={payNote}
                    placeholder="如 银行已扣款 4000.00 元"
                    onChange={(event) => setPayNote(event.target.value)}
                  />
                  <Button
                    type="primary"
                    loading={busy === "pay"}
                    onClick={() =>
                      void run(
                        "pay",
                        row.id,
                        { note: payNote },
                        "已登记扣款，申报单完税",
                      )
                    }
                  >
                    确认扣款
                  </Button>
                </Space.Compact>
              </div>
            ) : null}
          </div>

          {row.status === "ACCEPTED" ? (
            <div style={{ marginTop: 12 }}>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                回执原文（可选，留痕不可篡改）
              </div>
              <Input.TextArea
                rows={2}
                value={rawBody}
                placeholder="粘贴官方回执报文原文"
                onChange={(event) => setRawBody(event.target.value)}
              />
            </div>
          ) : null}

          {!["PAID", "CANCELLED"].includes(row.status) ? (
            <div style={{ marginTop: 12 }}>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                官方退回登记（失败不自动重试，由人工处理）
              </div>
              <Space.Compact style={{ width: "100%" }}>
                <Input
                  style={{ maxWidth: 200 }}
                  value={errorCode}
                  placeholder="失败码（如 EXTERNAL_0007）"
                  onChange={(event) => setErrorCode(event.target.value)}
                />
                <Input
                  value={errorMsg}
                  placeholder="退回原因"
                  onChange={(event) => setErrorMsg(event.target.value)}
                />
                <Button
                  danger
                  loading={busy === "reject"}
                  onClick={() =>
                    void run(
                      "reject",
                      row.id,
                      { errorCode, errorMsg, rawBody },
                      "已登记官方退回",
                    )
                  }
                >
                  登记退回
                </Button>
              </Space.Compact>
            </div>
          ) : null}
        </div>
      ) : (
        <Notice variant="info">
          外报回填由承办职员或签约服务商操作；企业侧只读（可见报送进度与回执）。
        </Notice>
      )}

      <div style={{ marginTop: 8, fontWeight: 600 }}>报送状态时间线</div>
      <Timeline
        style={{ marginTop: 12 }}
        items={(row.timeline || []).map((entry) => ({
          content: (
            <div>
              <div style={{ fontSize: 13 }}>
                {entry.from ? `${entry.from} → ` : ""}
                {entry.to || entry.action} · {entry.text}
              </div>
              <div className="text-12 muted">{fmtTime(entry.at)}</div>
            </div>
          ),
        }))}
      />

      <details style={{ marginTop: 6 }}>
        <summary className="text-12 muted" style={{ cursor: "pointer" }}>
          查看报送报文（{row.refNo} · {row.payloadHash.slice(0, 16)}）
        </summary>
        <pre className="ext-payload" style={{ marginTop: 10 }}>
          {JSON.stringify(row.payload, null, 2)}
        </pre>
      </details>
    </Panel>
  );
}
