"use client";

import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Table,
  Tag,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  hrmApi,
  type HrmApplication,
  type HrmCalibration,
  type HrmInterview,
} from "@/api/hrm";
import { Panel } from "@/components/ui/panel";
import {
  INTERVIEW_DIMENSION_LABELS,
  INTERVIEW_DIMENSION_OPTIONS,
  STATUS_COLORS,
  hrmError,
} from "./hrm-common";

const PAGE_SIZE = 20;

type InterviewPage = { list: HrmInterview[]; total: number; page: number; pageSize: number };

/** 面试安排、维度评分与宽严校准。 */
export function HrmInterviewsTab({ reloadKey }: { reloadKey: number }) {
  const { message } = App.useApp();
  const [interviews, setInterviews] = useState<InterviewPage | null>(null);
  const [applications, setApplications] = useState<HrmApplication[]>([]);
  const [calibration, setCalibration] = useState<HrmCalibration | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [rating, setRating] = useState<HrmInterview | null>(null);
  const [scheduleForm] = Form.useForm();
  const [rateForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, appRows, calibrationData] = await Promise.all([
        hrmApi.listInterviews({ query: { page: 1, pageSize: PAGE_SIZE } }),
        hrmApi.listApplications({ query: { page: 1, pageSize: 100 } }),
        hrmApi.calibration(),
      ]);
      setInterviews(rows);
      setApplications(appRows?.list || []);
      setCalibration(calibrationData);
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

  const submitSchedule = async () => {
    const values = await scheduleForm.validateFields();
    setBusy(true);
    try {
      await hrmApi.scheduleInterview({
        body: {
          applicationId: Number(values.applicationId),
          interviewerUserId: values.interviewerUserId.trim(),
          mode: values.mode || "ONSITE",
          scheduledAt: `${values.date}T${values.time || "10:00"}:00`,
          durationMin: Number(values.durationMin) || 60,
        },
      });
      message.success("面试已安排");
      setScheduleOpen(false);
      await load();
    } catch (err) {
      message.error(hrmError(err));
    } finally {
      setBusy(false);
    }
  };

  const submitRating = async () => {
    if (!rating) return;
    const values = await rateForm.validateFields();
    const ratings = INTERVIEW_DIMENSION_OPTIONS.map((item) => ({
      dimension: item.value,
      score: Number(values[`score_${item.value}`]) || 0,
      note: String(values[`note_${item.value}`] || ""),
    })).filter((item) => item.score >= 1);
    if (!ratings.length) {
      message.warning("请至少给一个维度打分");
      return;
    }
    setBusy(true);
    try {
      await hrmApi.rateInterview({
        body: { interviewId: rating.id, ratings },
      });
      message.success("评分已保存");
      setRating(null);
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
        title="面试安排"
        titleExtra={<span className="muted text-12">面试官从本组织成员中选择；结束后按维度打分</span>}
        extra={<Button type="primary" onClick={() => {
          scheduleForm.resetFields();
          setScheduleOpen(true);
        }}>安排面试</Button>}
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={interviews?.list || []}
          locale={{ emptyText: "还没有面试安排" }}
          pagination={false}
          columns={[
            { title: "投递", dataIndex: "applicationId", width: 90, render: (v: number) => `#${v}` },
            { title: "面试官", dataIndex: "interviewerUserId", width: 140 },
            {
              title: "方式",
              dataIndex: "mode",
              width: 90,
              render: (v: string) => ({ ONSITE: "现场", VIDEO: "视频", PHONE: "电话" } as Record<string, string>)[v] || v,
            },
            { title: "时间", dataIndex: "scheduledAt", width: 180 },
            { title: "时长", dataIndex: "durationMin", width: 80, render: (v: number) => `${v} 分钟` },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (v: string) => (
                <Tag color={STATUS_COLORS[v]}>
                  {({ SCHEDULED: "待面试", DONE: "已完成", CANCELED: "已取消" } as Record<string, string>)[v] || v}
                </Tag>
              ),
            },
            {
              title: "操作",
              width: 120,
              render: (_: unknown, row: HrmInterview) => (
                <Button
                  type="link"
                  size="small"
                  disabled={row.status === "CANCELED"}
                  onClick={() => {
                    rateForm.resetFields();
                    setRating(row);
                  }}
                >
                  评分
                </Button>
              ),
            },
          ]}
        />
      </Panel>

      <Panel
        title="面试官宽严校准"
        titleExtra={<span className="muted text-12">{calibration?.note || "按累计评分均值识别偏严 / 偏宽，仅作管理参考"}</span>}
      >
        <Table
          rowKey="raterUserId"
          size="small"
          loading={loading}
          dataSource={calibration?.raters || []}
          locale={{ emptyText: "评分样本不足，暂无校准数据" }}
          pagination={false}
          columns={[
            { title: "面试官", dataIndex: "raterUserId" },
            { title: "已评场次", dataIndex: "ratedCount", width: 110 },
            { title: "平均分", dataIndex: "avgScore", width: 100 },
            {
              title: "偏差",
              dataIndex: "bias",
              width: 100,
              render: (v: string) => (
                <Tag color={({ strict: "blue", lenient: "orange", normal: "green" } as Record<string, string>)[v]}>
                  {({ strict: "偏严", lenient: "偏宽", normal: "正常" } as Record<string, string>)[v] || v || "—"}
                </Tag>
              ),
            },
          ]}
        />
      </Panel>

      <Modal title="安排面试" open={scheduleOpen} onCancel={() => setScheduleOpen(false)} onOk={() => void submitSchedule()} confirmLoading={busy} destroyOnHidden>
        <Form form={scheduleForm} layout="vertical" style={{ marginTop: 12 }}>
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
          <Form.Item label="面试官账号" name="interviewerUserId" rules={[{ required: true, message: "请填写面试官账号 ID" }]}>
            <Input maxLength={64} placeholder="本组织成员账号 ID" />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item label="日期" name="date" rules={[{ required: true, message: "请选择日期" }]}>
              <Input type="date" />
            </Form.Item>
            <Form.Item label="时间" name="time" initialValue="10:00">
              <Input type="time" />
            </Form.Item>
            <Form.Item label="方式" name="mode" initialValue="ONSITE">
              <Select options={[
                { value: "ONSITE", label: "现场" },
                { value: "VIDEO", label: "视频" },
                { value: "PHONE", label: "电话" },
              ]} />
            </Form.Item>
            <Form.Item label="时长（分钟）" name="durationMin" initialValue={60}>
              <InputNumber min={15} max={240} style={{ width: "100%" }} />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        title={`面试评分${rating ? `（投递 #${rating.applicationId}）` : ""}`}
        open={Boolean(rating)}
        onCancel={() => setRating(null)}
        onOk={() => void submitRating()}
        confirmLoading={busy}
        width={720}
        destroyOnHidden
      >
        <Form form={rateForm} layout="vertical" style={{ marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {INTERVIEW_DIMENSION_OPTIONS.map((item) => (
              <div key={item.value}>
                <Form.Item label={`${INTERVIEW_DIMENSION_LABELS[item.value]}（1~5）`} name={`score_${item.value}`}>
                  <InputNumber min={0} max={5} step={0.5} style={{ width: "100%" }} placeholder="不评则留空" />
                </Form.Item>
                <Form.Item name={`note_${item.value}`}>
                  <Input size="small" maxLength={500} placeholder="评语（可选）" />
                </Form.Item>
              </div>
            ))}
          </div>
        </Form>
      </Modal>
    </div>
  );
}
