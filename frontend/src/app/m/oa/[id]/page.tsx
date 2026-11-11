"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { App, Button, Input, Spin, Tag } from "antd";
import type { OaApplication } from "@enterprise/contracts";
import { oaApi } from "@/api/oa";
import { MobileAuthGate, MobileShell, fmtMobileTime } from "../../_components/mobile-common";

const STATUS_COLOR: Record<string, string> = {
  DRAFT: "default",
  APPROVING: "processing",
  RETURNED: "orange",
  APPROVED: "green",
  REJECTED: "red",
  WITHDRAWN: "default",
};

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.map((item) => renderValue(item)).join("、");
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** OA 审批详情（`/m/oa/[id]`）：查看单据并直接同意 / 驳回当前环节。 */
export default function MobileOaPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const { message } = App.useApp();
  const [detail, setDetail] = useState<OaApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [acting, setActing] = useState<"approve" | "reject" | "">("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await oaApi.applicationDetail({ params: { id } });
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "审批单加载失败");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) void load();
  }, [id, load]);

  const act = async (kind: "approve" | "reject") => {
    if (!detail?.myTaskId) return;
    if (kind === "reject" && !comment.trim()) {
      message.warning("驳回时请填写意见");
      return;
    }
    setActing(kind);
    try {
      const next =
        kind === "approve"
          ? await oaApi.approve({
              params: { id: String(detail.myTaskId) },
              body: { comment: comment.trim() },
            })
          : await oaApi.reject({
              params: { id: String(detail.myTaskId) },
              body: { comment: comment.trim() },
            });
      if (next) setDetail(next);
      setComment("");
      message.success(kind === "approve" ? "已同意" : "已驳回");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "操作失败，请稍后重试");
    } finally {
      setActing("");
    }
  };

  const canAct = Boolean(detail?.canApprove && detail?.myTaskId);

  return (
    <MobileShell
      title="审批详情"
      sub={detail?.templateName || "OA 审批"}
      backHref="/m/inbox"
    >
      <MobileAuthGate>
        {loading ? (
          <div className="m-loading">
            <Spin />
          </div>
        ) : error ? (
          <div className="m-empty">
            <div className="m-empty-title">加载失败</div>
            <p className="m-empty-text">{error}</p>
            <Button href="/m/inbox">返回消息中心</Button>
          </div>
        ) : !detail ? (
          <div className="m-empty">
            <div className="m-empty-title">审批单不存在</div>
            <p className="m-empty-text">该单据可能已被撤回，或当前账号无权查看。</p>
            <Button href="/m/inbox">返回消息中心</Button>
          </div>
        ) : (
          <div className="m-view">
            <div className="m-card">
              <div className="m-card-title">
                <span>{detail.title}</span>
                <Tag color={STATUS_COLOR[detail.status]}>{detail.statusLabel}</Tag>
              </div>
              <div className="m-kv">
                <span>单号</span>
                <b className="mono">{detail.number || `#${detail.id}`}</b>
              </div>
              <div className="m-kv">
                <span>发起人</span>
                <b>{detail.applicantName || detail.applicantId}</b>
              </div>
              <div className="m-kv">
                <span>部门</span>
                <b>{detail.department || "—"}</b>
              </div>
              <div className="m-kv">
                <span>金额</span>
                <b>{detail.amount ? `¥ ${detail.amount.toFixed(2)}` : "—"}</b>
              </div>
              <div className="m-kv">
                <span>当前节点</span>
                <b>{detail.currentNodeName || "—"}</b>
              </div>
              <div className="m-kv">
                <span>提交时间</span>
                <b>{detail.submittedAt ? fmtMobileTime(detail.submittedAt) : "—"}</b>
              </div>
            </div>

            <div className="m-card">
              <div className="m-card-title">申请内容</div>
              {detail.fields.length ? (
                detail.fields.map((field) => (
                  <div className="m-kv" key={field.key}>
                    <span>{field.label}</span>
                    <b style={{ textAlign: "right", whiteSpace: "pre-wrap" }}>
                      {renderValue(detail.formData[field.key])}
                    </b>
                  </div>
                ))
              ) : Object.keys(detail.formData).length ? (
                Object.entries(detail.formData).map(([key, value]) => (
                  <div className="m-kv" key={key}>
                    <span>{key}</span>
                    <b style={{ textAlign: "right", whiteSpace: "pre-wrap" }}>{renderValue(value)}</b>
                  </div>
                ))
              ) : (
                <p className="m-hint" style={{ marginTop: 0 }}>
                  该单据没有可展示的表单字段。
                </p>
              )}
            </div>

            {canAct ? (
              <div className="m-card">
                <div className="m-card-title">审批意见</div>
                <Input.TextArea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="同意可不填；驳回必须填写意见"
                  style={{ fontSize: 16 }}
                />
                <div className="m-inline-actions" style={{ justifyContent: "flex-start", marginTop: 10 }}>
                  <Button
                    type="primary"
                    loading={acting === "approve"}
                    disabled={Boolean(acting) && acting !== "approve"}
                    onClick={() => void act("approve")}
                  >
                    同意
                  </Button>
                  <Button
                    danger
                    loading={acting === "reject"}
                    disabled={Boolean(acting) && acting !== "reject"}
                    onClick={() => void act("reject")}
                  >
                    驳回
                  </Button>
                </div>
                <p className="m-hint">
                  手机端仅支持同意 / 驳回；退回、转交、加签请到电脑端「OA 审批」处理。
                </p>
              </div>
            ) : (
              <div className="m-card">
                <div className="m-card-title">处理状态</div>
                <p className="m-hint" style={{ marginTop: 0 }}>
                  {detail.canApprove
                    ? "当前没有待你处理的审批环节。"
                    : "你不是当前环节的审批人，可查看单据进度。"}
                </p>
                <Button href={`/oa?application=${detail.id}`}>在电脑端查看</Button>
              </div>
            )}
          </div>
        )}
      </MobileAuthGate>
    </MobileShell>
  );
}
