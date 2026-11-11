"use client";

import {
  App,
  Button,
  Input,
  Modal,
  Space,
  Spin,
  Tag,
  Timeline,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { oaApi } from "@/api/oa";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import type {
  OaApplication,
  OaAttachment,
  OaLinkTarget,
  OaRecord,
} from "@enterprise/contracts";
import { AttachmentField, OaFormView } from "./form-renderer";
import {
  ApplicationStatusTag,
  AttachmentList,
  LinkStatusTag,
  MemberSelect,
  fmtDateTime,
  LinkTargetLabel,
  memberNameOf,
  money,
  oaDetailPath,
  oaError,
  type OaMember,
  type OaOrgQuery,
} from "./oa-common";

/**
 * 审批动作全部走同一个弹窗：只有「要不要填成员」「意见是否必填」两处不同，
 * 分五个组件写会把同一套提交/失败/刷新逻辑抄五遍。
 */
type ActionKind =
  | "APPROVE"
  | "REJECT"
  | "RETURN"
  | "TRANSFER"
  | "ADD_SIGN"
  | "WITHDRAW";

const ACTION_META: Record<
  ActionKind,
  { label: string; okText: string; needComment: boolean; pick: "none" | "one" | "many"; danger?: boolean }
> = {
  APPROVE: { label: "同意", okText: "确认同意", needComment: false, pick: "none" },
  REJECT: { label: "驳回", okText: "确认驳回", needComment: true, pick: "none", danger: true },
  RETURN: { label: "退回", okText: "确认退回", needComment: true, pick: "none", danger: true },
  TRANSFER: {
    label: "转交",
    okText: "确认转交",
    needComment: false,
    pick: "one",
  },
  ADD_SIGN: {
    label: "加签",
    okText: "确认加签",
    needComment: false,
    pick: "many",
  },
  WITHDRAW: {
    label: "撤销",
    okText: "确认撤销",
    needComment: false,
    pick: "none",
    danger: true,
  },
};

const ACTION_HINT: Record<ActionKind, string> = {
  APPROVE: "同意后进入下一节点；最后一个节点通过即审批完成。",
  REJECT: "驳回后单据终止，不能恢复；意见会通知申请人。",
  RETURN: "退回给申请人，申请人改完可重新提交。",
  TRANSFER: "转交后本节点由对方处理，自己不再审批。",
  ADD_SIGN: "加签在本节点前插入所选成员，全部通过后才继续。",
  WITHDRAW: "撤回到「已撤销」，需要重新发起。",
};

async function runAction(
  kind: ActionKind,
  taskId: number,
  applicationId: number,
  comment: string,
  userIds: string[],
) {
  switch (kind) {
    case "APPROVE":
      return oaApi.approve({ params: { id: String(taskId) }, body: { comment } });
    case "REJECT":
      return oaApi.reject({ params: { id: String(taskId) }, body: { comment } });
    case "RETURN":
      return oaApi.return({ params: { id: String(taskId) }, body: { comment } });
    case "TRANSFER":
      return oaApi.transfer({
        params: { id: String(taskId) },
        body: { targetUserId: userIds[0] || "", comment },
      });
    case "ADD_SIGN":
      return oaApi.addSign({
        params: { id: String(taskId) },
        body: { userIds, comment },
      });
    case "WITHDRAW":
      return oaApi.withdraw({
        params: { id: String(applicationId) },
        body: { comment },
      });
  }
}

/** 单据详情：只读表单 + 关联对象 + 联动回执 + 流程时间线 + 操作记录 + 评论 + 审批动作。 */
export function ApplicationDetail({
  id,
  org,
  members,
  targets,
  isAdmin,
  onBack,
  onChanged,
  onEdit,
  onDeleted,
}: {
  id: number;
  org: OaOrgQuery;
  members: OaMember[];
  targets: OaLinkTarget[];
  isAdmin: boolean;
  onBack: () => void;
  /** 列表侧统计条/页签计数随单据状态变化刷新。 */
  onChanged: () => void;
  onEdit: (app: OaApplication) => void;
  onDeleted: () => void;
}) {
  const { message, modal } = App.useApp();
  const [app, setApp] = useState<OaApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [action, setAction] = useState<ActionKind | null>(null);
  const [comment, setComment] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [noteFiles, setNoteFiles] = useState<OaAttachment[]>([]);
  const [preReviewBusy, setPreReviewBusy] = useState(false);
  const [preReviewTried, setPreReviewTried] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await oaApi.applicationDetail({
        params: { id: String(id) },
        query: org,
      });
      setApp(data || null);
      setError("");
    } catch (err) {
      setError(oaError(err));
      setApp(null);
    } finally {
      setLoading(false);
    }
  }, [id, org]);

  useEffect(() => {
    void load();
    setPreReviewTried(false);
  }, [load]);

  const runPreReview = useCallback(async () => {
    if (!app) return;
    setPreReviewBusy(true);
    try {
      const result = await oaApi.preReview({
        params: { id: String(app.id) },
        body: {},
      });
      if (result) {
        setApp((prev) => (prev ? { ...prev, myPreReview: result } : prev));
        if (result.status === "FAILED") {
          message.warning(result.error || "AI 预审失败，可直接审批");
        }
      }
    } catch (err) {
      message.error(oaError(err));
    } finally {
      setPreReviewBusy(false);
    }
  }, [app, message]);

  // 轮到本人审批且节点启用 AI 预审时，打开详情自动跑一次；失败不重试、不挡审批。
  useEffect(() => {
    if (!app || !app.myTaskId) return;
    const step = app.flow.find((item) =>
      item.approvers.some((person) => person.status === "PENDING"),
    );
    if (!step?.aiPreReviewEnabled) return;
    if (app.myPreReview.status !== "NONE") return;
    if (preReviewTried) return;
    setPreReviewTried(true);
    void runPreReview();
  }, [app, preReviewTried, runPreReview]);

  const apply = (next: OaApplication | null) => {
    if (!next) return;
    setApp(next);
    onChanged();
  };

  const submitAction = async () => {
    if (!action || !app) return;
    const meta = ACTION_META[action];
    if (meta.needComment && !comment.trim()) {
      message.warning(`请填写${meta.label}意见`);
      return;
    }
    if (meta.pick === "one" && !picked.length) {
      message.warning("请选择转交给谁");
      return;
    }
    if (meta.pick === "many" && !picked.length) {
      message.warning("请选择加签成员");
      return;
    }
    setBusy(true);
    try {
      const next = await runAction(action, app.myTaskId, app.id, comment.trim(), picked);
      message.success(`${meta.label}已提交`);
      setAction(null);
      setComment("");
      setPicked([]);
      apply(next);
      await load();
    } catch (err) {
      message.error(oaError(err));
    } finally {
      setBusy(false);
    }
  };

  const sendNote = async () => {
    if (!app) return;
    if (!note.trim()) {
      message.warning("请填写评论内容");
      return;
    }
    setBusy(true);
    try {
      const records = await oaApi.comment({
        params: { id: String(app.id) },
        body: { comment: note.trim(), attachments: noteFiles },
      });
      setNote("");
      setNoteFiles([]);
      setApp((prev) => (prev ? { ...prev, records: records || prev.records } : prev));
      message.success("评论已发布");
    } catch (err) {
      message.error(oaError(err));
    } finally {
      setBusy(false);
    }
  };

  const removeDraft = () => {
    if (!app) return;
    modal.confirm({
      title: `删除草稿 ${app.number}？`,
      content: "删除后单据与操作记录一并清除，不可恢复。",
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await oaApi.deleteDraft({ params: { id: String(app.id) } });
          message.success("草稿已删除");
          onDeleted();
        } catch (err) {
          message.error(oaError(err));
        }
      },
    });
  };

  const retryLink = async (linkId: number) => {
    if (!app) return;
    setBusy(true);
    try {
      const links = await oaApi.retryLink({
        params: { id: String(app.id), linkId: String(linkId) },
        body: {},
      });
      setApp((prev) => (prev ? { ...prev, links: links || prev.links } : prev));
      message.success("联动已重试");
    } catch (err) {
      message.error(oaError(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <Spin />
      </div>
    );
  }
  if (!app) {
    return (
      <Panel title="单据详情">
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Button onClick={onBack}>返回列表</Button>
          {error ? <Notice variant="error">{error}</Notice> : <EmptyState text="单据不存在或不在当前组织" />}
        </Space>
      </Panel>
    );
  }

  const canAct = app.canApprove && app.myTaskId > 0;
  const activeStep = app.flow.find((step) =>
    step.approvers.some((person) => person.status === "PENDING"),
  );
  const preReviewEnabled = Boolean(activeStep?.aiPreReviewEnabled);
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Panel
        title={`${app.number} · ${app.title}`}
        titleExtra={<ApplicationStatusTag status={app.status} label={app.statusLabel} />}
        extra={
          <Space wrap>
            <Button onClick={onBack}>返回列表</Button>
            {app.canEdit ? <Button onClick={() => onEdit(app)}>编辑草稿</Button> : null}
            {app.canDelete ? (
              <Button danger onClick={removeDraft}>
                删除草稿
              </Button>
            ) : null}
            {app.canWithdraw ? <Button onClick={() => setAction("WITHDRAW")}>撤销</Button> : null}
            {canAct ? (
              <>
                <Button type="primary" onClick={() => setAction("APPROVE")}>
                  同意
                </Button>
                <Button danger onClick={() => setAction("REJECT")}>
                  驳回
                </Button>
                <Button onClick={() => setAction("RETURN")}>退回</Button>
                <Button onClick={() => setAction("TRANSFER")}>转交</Button>
                <Button onClick={() => setAction("ADD_SIGN")}>加签</Button>
              </>
            ) : null}
          </Space>
        }
      >
        <div className="form-2col">
          <div>
            <div className="field-label">申请模板</div>
            <div>{app.templateName}</div>
          </div>
          <div>
            <div className="field-label">申请人</div>
            <div>
              {app.applicantName}
              {app.department ? ` · ${app.department}` : ""}
            </div>
          </div>
          <div>
            <div className="field-label">单据金额</div>
            <div>{app.amount ? `￥${money(app.amount)}` : "—"}</div>
          </div>
          <div>
            <div className="field-label">提交时间</div>
            <div>{app.submittedAt ? fmtDateTime(app.submittedAt) : "未提交"}</div>
          </div>
          <div>
            <div className="field-label">完成时间</div>
            <div>{app.finishedAt ? fmtDateTime(app.finishedAt) : "—"}</div>
          </div>
          <div>
            <div className="field-label">抄送</div>
            <div>
              {app.cc.length
                ? app.cc.map((item) => item.userName || item.userId).join("、")
                : "无"}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="申请内容">
        <OaFormView fields={app.fields} formData={app.formData} members={members} />
      </Panel>

      <Panel
        title="附件"
        titleExtra={
          <span className="text-12 muted">由发起人上传，文件本体在数字资产里</span>
        }
      >
        {app.attachments.length ? (
          <AttachmentList items={app.attachments} />
        ) : (
          <div className="text-12 muted">没有附件</div>
        )}
      </Panel>

      {canAct && preReviewEnabled ? (
        <Panel
          title="AI 预审"
          titleExtra={
            <span className="text-12 muted">
              {activeStep?.aiPreReviewPersona
                ? `数字分身：${activeStep.aiPreReviewPersona}`
                : "按节点配置的审核原则生成"}
            </span>
          }
          extra={
            <Button loading={preReviewBusy} onClick={() => void runPreReview()}>
              重新预审
            </Button>
          }
        >
          {preReviewBusy ? (
            <Spin />
          ) : app.myPreReview.status === "DONE" ? (
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>
              {app.myPreReview.content}
              <div className="text-12 muted" style={{ marginTop: 8 }}>
                由 AI 生成，仅作参考；同意 / 驳回仍由你本人决定
              </div>
            </div>
          ) : app.myPreReview.status === "FAILED" ? (
            <Notice variant="warn">
              {app.myPreReview.error || "AI 预审失败，可直接审批"}
            </Notice>
          ) : (
            <div className="text-12 muted">尚未预审，点右上角「重新预审」</div>
          )}
        </Panel>
      ) : null}

      <Panel title="关联业务对象">
        {app.targets.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {app.targets.map((item) => {
              const path = oaDetailPath(targets, item.targetType, item.id);
              return (
                <div
                  key={`${item.targetType}-${item.id}`}
                  style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
                >
                  <Tag>
                    <LinkTargetLabel targetType={item.targetType} />
                  </Tag>
                  <span>{item.title}</span>
                  {item.subtitle ? <span className="muted text-12">{item.subtitle}</span> : null}
                  {item.amount ? (
                    <span className="muted text-12">￥{money(item.amount)}</span>
                  ) : null}
                  {path ? (
                    <Button type="link" onClick={() => window.open(path, "_blank", "noopener,noreferrer")}>
                      查看
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState text="该单据没有关联业务对象" />
        )}
        {app.links.length ? (
          <div style={{ marginTop: 12 }}>
            <div className="field-label">联动回执</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {app.links.map((link) => (
                <div
                  key={link.id}
                  style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
                >
                  <Tag>{link.actionLabel || link.action}</Tag>
                  <span>
                    {link.targetLabel || link.targetType} · {link.targetTitle || link.targetId}
                  </span>
                  <LinkStatusTag status={link.status} label={link.statusLabel} />
                  {link.error ? (
                    <span className="text-12" style={{ color: "var(--danger)" }}>
                      {link.error}
                    </span>
                  ) : null}
                  {link.executedAt ? (
                    <span className="muted text-12">{fmtDateTime(link.executedAt)}</span>
                  ) : null}
                  {isAdmin && link.status === "FAILED" ? (
                    <Button type="link" loading={busy} onClick={() => void retryLink(link.id)}>
                      重试
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Panel>

      <Panel title="审批流程">
        {app.flow.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {app.flow.map((step) => (
              <div key={`${step.index}-${step.name}`}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Tag>{step.index + 1}</Tag>
                  <strong>{step.name}</strong>
                  <Tag>{step.statusLabel || step.status}</Tag>
                  <span className="muted text-12">{step.modeLabel || step.mode}</span>
                </div>
                {step.approvers.length ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                    {step.approvers.map((person, personIndex) => (
                      <span
                        key={`${person.userId}-${personIndex}`}
                        className="muted text-12"
                        style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
                      >
                        <span>{person.name || person.userId}</span>
                        <Tag>{person.statusLabel || person.status}</Tag>
                        {person.actedAt ? (
                          <span>{fmtDateTime(person.actedAt)}</span>
                        ) : null}
                        {person.comment ? <span>「{person.comment}」</span> : null}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="muted text-12">未解析到审批人</div>
                )}
                {step.ccNames.length ? (
                  <div className="muted text-12">节点抄送：{step.ccNames.join("、")}</div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="该单据没有审批节点" />
        )}
      </Panel>

      <Panel title="操作记录">
        {app.records.length ? (
          <Timeline
            items={app.records.map((record: OaRecord) => ({
              color:
                record.action === "REJECT"
                  ? "red"
                  : record.action === "APPROVE"
                    ? "green"
                    : record.action === "COMMENT"
                      ? "blue"
                      : "gray",
              content: (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <strong>{record.actionLabel || record.action}</strong>
                    <span>{record.operatorName || memberNameOf(members, record.operatorId)}</span>
                    <span className="muted text-12">{fmtDateTime(record.createdAt)}</span>
                  </div>
                  {record.comment ? <div>{record.comment}</div> : null}
                  {record.attachments.length ? (
                    <AttachmentList items={record.attachments} />
                  ) : null}
                </div>
              ),
            }))}
          />
        ) : (
          <EmptyState text="还没有操作记录" />
        )}
      </Panel>

      <Panel title="评论">
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <Input.TextArea
            rows={3}
            maxLength={1000}
            showCount
            value={note}
            placeholder="补充说明，申请人和审批人都能看到"
            onChange={(event) => setNote(event.target.value)}
          />
          <AttachmentField value={noteFiles} onChange={(next) => setNoteFiles(next)} />
          <div>
            <Button type="primary" loading={busy} onClick={() => void sendNote()}>
              发表评论
            </Button>
          </div>
        </Space>
      </Panel>

      <Modal
        open={!!action}
        title={action ? `${ACTION_META[action].label}` : ""}
        okText={action ? ACTION_META[action].okText : "确定"}
        okButtonProps={{ danger: action ? !!ACTION_META[action].danger : false, loading: busy }}
        onCancel={() => {
          setAction(null);
          setComment("");
          setPicked([]);
        }}
        onOk={() => void submitAction()}
      >
        {action ? (
          <Space orientation="vertical" size={10} style={{ width: "100%" }}>
            <div className="muted text-12">{ACTION_HINT[action]}</div>
            {ACTION_META[action].pick !== "none" ? (
              <div>
                <div className="field-label">
                  {ACTION_META[action].pick === "one" ? "转交给" : "加签给（最多 10 人）"}
                </div>
                <MemberSelect
                  members={members}
                  mode={ACTION_META[action].pick === "many" ? "multiple" : undefined}
                  value={
                    ACTION_META[action].pick === "one" ? picked[0] : picked
                  }
                  onChange={(next) =>
                    setPicked(Array.isArray(next) ? next.slice(0, 10) : [next as string])
                  }
                  placeholder={
                    ACTION_META[action].pick === "one" ? "选择承接人" : "选择加签成员"
                  }
                  style={{ width: "100%" }}
                />
              </div>
            ) : null}
            <div>
              <div className="field-label">
                意见{ACTION_META[action].needComment ? "（必填）" : "（可留空）"}
              </div>
              <Input.TextArea
                rows={3}
                maxLength={500}
                showCount
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
            </div>
          </Space>
        ) : null}
      </Modal>
    </Space>
  );
}
