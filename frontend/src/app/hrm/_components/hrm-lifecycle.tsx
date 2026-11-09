"use client";

import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  hrmApi,
  type HrmApplication,
  type HrmOffer,
  type HrmReview,
  type HrmRubric,
} from "@/api/hrm";
import { Panel } from "@/components/ui/panel";
import {
  OFFER_STATUS_LABELS,
  REVIEW_KIND_LABELS,
  STATUS_COLORS,
  formatMoney,
  hrmError,
  shortDate,
} from "./hrm-common";

const PAGE_SIZE = 20;
const REVIEW_KINDS = [
  { value: "PROBATION", label: "转正" },
  { value: "YEAR", label: "年度" },
  { value: "QUARTER", label: "季度" },
];

type OfferPage = { list: HrmOffer[]; total: number; page: number; pageSize: number };
type ReviewPage = { list: HrmReview[]; total: number; page: number; pageSize: number };

/** Offer 与盘点：Offer 接受后建成员档案；述职九宫格；rubric 版本化维护。 */
export function HrmLifecycleTab({ reloadKey }: { reloadKey: number }) {
  const { message } = App.useApp();
  const [offers, setOffers] = useState<OfferPage | null>(null);
  const [reviews, setReviews] = useState<ReviewPage | null>(null);
  const [applications, setApplications] = useState<HrmApplication[]>([]);
  const [rubric, setRubric] = useState<HrmRubric | null>(null);
  const [rubricDraft, setRubricDraft] = useState<HrmRubric | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [accepting, setAccepting] = useState<HrmOffer | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [offerForm] = Form.useForm();
  const [acceptForm] = Form.useForm();
  const [reviewForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [offerRows, reviewRows, appRows, rubricRow] = await Promise.all([
        hrmApi.listOffers({ query: { page: 1, pageSize: PAGE_SIZE } }),
        hrmApi.listReviews({ query: { page: 1, pageSize: PAGE_SIZE } }),
        hrmApi.listApplications({ query: { page: 1, pageSize: 100 } }),
        hrmApi.getRubric({ query: {} }),
      ]);
      setOffers(offerRows);
      setReviews(reviewRows);
      setApplications(appRows?.list || []);
      setRubric(rubricRow);
      setRubricDraft(rubricRow ? { ...rubricRow, weights: { ...rubricRow.weights } } : null);
      setError("");
    } catch (err) {
      setError(hrmError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const submitOffer = async () => {
    const values = await offerForm.validateFields();
    setBusy(true);
    try {
      await hrmApi.createOffer({
        body: {
          applicationId: Number(values.applicationId),
          salaryMonthly: Number(values.salaryMonthly) || 0,
          startAt: values.startAt,
          note: values.note || "",
        },
      });
      message.success("Offer 已发出");
      setOfferOpen(false);
      await load();
    } catch (err) {
      message.error(hrmError(err));
    } finally {
      setBusy(false);
    }
  };

  const decideOffer = async (row: HrmOffer, decision: "accept" | "decline") => {
    if (decision === "accept") {
      acceptForm.resetFields();
      setAccepting(row);
      return;
    }
    setBusy(true);
    try {
      await hrmApi.decideOffer({ body: { id: row.id, decision, memberUserId: "" } });
      message.success("Offer 已拒绝");
      await load();
    } catch (err) {
      message.error(hrmError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitAccept = async () => {
    if (!accepting) return;
    const values = await acceptForm.validateFields();
    setBusy(true);
    try {
      await hrmApi.decideOffer({
        body: {
          id: accepting.id,
          decision: "accept",
          memberUserId: values.memberUserId.trim(),
        },
      });
      message.success("已接受 Offer，成员档案已建立");
      setAccepting(null);
      await load();
    } catch (err) {
      message.error(hrmError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitReview = async () => {
    const values = await reviewForm.validateFields();
    setBusy(true);
    try {
      await hrmApi.upsertReview({
        body: {
          staffUserId: values.staffUserId.trim(),
          period: values.period,
          kind: values.kind || "YEAR",
          performanceScore: Number(values.performanceScore) || 1,
          potentialScore: Number(values.potentialScore) || 1,
          summary: values.summary || "",
          status: values.status || "DRAFT",
        },
      });
      message.success("盘点已保存");
      setReviewOpen(false);
      await load();
    } catch (err) {
      message.error(hrmError(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleRubricActive = async () => {
    if (!rubricDraft) return;
    const total = Object.values(rubricDraft.weights).reduce(
      (sum, value) => sum + Number(value || 0),
      0,
    );
    if (Math.abs(total - 1) > 0.001) {
      message.warning(`维度权重合计需为 100%（当前 ${Math.round(total * 100)}%）`);
      return;
    }
    setBusy(true);
    try {
      await hrmApi.saveRubric({
        body: {
          code: rubricDraft.code,
          dimensions: rubricDraft.dimensions,
          weights: rubricDraft.weights,
          thresholds: rubricDraft.thresholds,
          tierLexicon: rubricDraft.tierLexicon,
          promptDigest: rubricDraft.promptDigest,
        },
      });
      message.success("已保存为新版本 rubric");
      await load();
    } catch (err) {
      message.error(hrmError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error ? <div style={{ color: "#cf1322" }}>{error}</div> : null}

      <Panel
        title="Offer 发放"
        titleExtra={<span className="muted text-12">接受后自动建立成员档案（试用期），并写入组织成员</span>}
        extra={<Button type="primary" onClick={() => {
          offerForm.resetFields();
          setOfferOpen(true);
        }}>发放 Offer</Button>}
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={offers?.list || []}
          locale={{ emptyText: "还没有 Offer" }}
          pagination={false}
          columns={[
            { title: "投递", dataIndex: "applicationId", width: 90, render: (v: number) => `#${v}` },
            { title: "候选人", dataIndex: "candidateId", width: 100, render: (v: number) => `#${v}` },
            { title: "月薪", dataIndex: "salaryMonthly", width: 120, render: (v: string) => formatMoney(v) },
            { title: "入职日期", dataIndex: "startAt", width: 120, render: (v: string) => shortDate(v) },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (v: string) => <Tag color={STATUS_COLORS[v]}>{OFFER_STATUS_LABELS[v] || v}</Tag>,
            },
            {
              title: "操作",
              width: 200,
              render: (_: unknown, row: HrmOffer) =>
                row.status === "PENDING" ? (
                  <Space size={4}>
                    <Button type="link" size="small" onClick={() => void decideOffer(row, "accept")}>接受</Button>
                    <Button type="link" size="small" danger onClick={() => void decideOffer(row, "decline")}>拒绝</Button>
                  </Space>
                ) : (
                  <span className="muted text-12">{row.memberUserId ? `成员 ${row.memberUserId}` : "—"}</span>
                ),
            },
          ]}
        />
      </Panel>

      <Panel
        title="述职与转正盘点"
        titleExtra={<span className="muted text-12">绩效 × 潜力 → 九宫格位置（1~9）由服务端换算</span>}
        extra={<Button type="primary" onClick={() => {
          reviewForm.resetFields();
          setReviewOpen(true);
        }}>新增盘点</Button>}
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={reviews?.list || []}
          locale={{ emptyText: "还没有盘点记录" }}
          pagination={false}
          columns={[
            { title: "成员", dataIndex: "staffUserId", width: 140 },
            { title: "周期", dataIndex: "period", width: 120 },
            {
              title: "类型",
              dataIndex: "kind",
              width: 90,
              render: (v: string) => REVIEW_KIND_LABELS[v] || v,
            },
            { title: "绩效", dataIndex: "performanceScore", width: 80 },
            { title: "潜力", dataIndex: "potentialScore", width: 80 },
            { title: "九宫格", dataIndex: "gridCell", width: 90, render: (v: number) => (v ? `${v}` : "—") },
            {
              title: "状态",
              dataIndex: "status",
              width: 90,
              render: (v: string) => <Tag color={v === "DONE" ? "green" : "gold"}>{v === "DONE" ? "已完成" : "草稿"}</Tag>,
            },
            { title: "评语", dataIndex: "summary", render: (v: string) => v || "—" },
          ]}
        />
      </Panel>

      <Panel
        title={`人岗匹配 rubric${rubric ? ` v${rubric.version}` : ""}`}
        titleExtra={<span className="muted text-12">雇主侧招聘与候选人侧代投共用同一模板；保存即生成新版本</span>}
        extra={<Button loading={busy} disabled={!rubricDraft} onClick={() => void toggleRubricActive()}>保存为新版本</Button>}
      >
        {rubricDraft ? (
          <>
            <Table
              rowKey="key"
              size="small"
              pagination={false}
              dataSource={rubricDraft.dimensions}
              columns={[
                { title: "维度", dataIndex: "label", width: 160 },
                { title: "说明", dataIndex: "description", render: (v: string) => v || "—" },
                {
                  title: "权重（%）",
                  width: 140,
                  render: (_: unknown, row: { key: string }) => (
                    <InputNumber
                      size="small"
                      min={0}
                      max={100}
                      precision={0}
                      value={Math.round((rubricDraft.weights[row.key] || 0) * 100)}
                      onChange={(next) =>
                        setRubricDraft({
                          ...rubricDraft,
                          weights: {
                            ...rubricDraft.weights,
                            [row.key]: (Number(next) || 0) / 100,
                          },
                        })
                      }
                    />
                  ),
                },
              ]}
            />
            <Space size={8} wrap style={{ margin: "12px 0" }}>
              {rubricDraft.tierLexicon.map((item) => (
                <Tag key={item}>{item}</Tag>
              ))}
            </Space>
            <div className="muted text-12" style={{ marginBottom: 4 }}>评分提示词摘要</div>
            <Input.TextArea
              value={rubricDraft.promptDigest}
              rows={6}
              onChange={(event) =>
                setRubricDraft({ ...rubricDraft, promptDigest: event.target.value })
              }
            />
          </>
        ) : (
          <div className="muted">正在加载 rubric…</div>
        )}
      </Panel>

      <Modal title="发放 Offer" open={offerOpen} onCancel={() => setOfferOpen(false)} onOk={() => void submitOffer()} confirmLoading={busy} destroyOnHidden>
        <Form form={offerForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item label="投递" name="applicationId" rules={[{ required: true, message: "请选择投递" }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={applications.map((row) => ({
                value: row.id,
                label: `投递 #${row.id}（职位 #${row.jobId}）`,
              }))}
            />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item label="月薪（元）" name="salaryMonthly" rules={[{ required: true, message: "请填写月薪" }]}>
              <InputNumber min={0} max={1000000} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="入职日期" name="startAt" rules={[{ required: true, message: "请选择入职日期" }]}>
              <Input type="date" />
            </Form.Item>
          </div>
          <Form.Item label="备注" name="note"><Input.TextArea rows={3} maxLength={500} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="接受 Offer" open={Boolean(accepting)} onCancel={() => setAccepting(null)} onOk={() => void submitAccept()} confirmLoading={busy} destroyOnHidden>
        <Form form={acceptForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item label="入职成员账号" name="memberUserId" rules={[{ required: true, message: "请填写成员账号 ID" }]}>
            <Input maxLength={64} placeholder="登录用户名对应的账号 ID" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="新增盘点" open={reviewOpen} onCancel={() => setReviewOpen(false)} onOk={() => void submitReview()} confirmLoading={busy} destroyOnHidden>
        <Form form={reviewForm} layout="vertical" style={{ marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item label="成员账号" name="staffUserId" rules={[{ required: true, message: "请填写成员账号 ID" }]}>
              <Input maxLength={64} />
            </Form.Item>
            <Form.Item label="周期" name="period" rules={[{ required: true, message: "请填写周期" }]}>
              <Input maxLength={32} placeholder="如 2026Q4" />
            </Form.Item>
            <Form.Item label="类型" name="kind" initialValue="YEAR">
              <Select options={REVIEW_KINDS} />
            </Form.Item>
            <Form.Item label="状态" name="status" initialValue="DRAFT">
              <Select options={[
                { value: "DRAFT", label: "草稿" },
                { value: "DONE", label: "已完成" },
              ]} />
            </Form.Item>
            <Form.Item label="绩效（1~5）" name="performanceScore" initialValue={3}>
              <InputNumber min={1} max={5} step={0.5} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="潜力（1~5）" name="potentialScore" initialValue={3}>
              <InputNumber min={1} max={5} step={0.5} style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <Form.Item label="评语" name="summary"><Input.TextArea rows={4} maxLength={5000} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
