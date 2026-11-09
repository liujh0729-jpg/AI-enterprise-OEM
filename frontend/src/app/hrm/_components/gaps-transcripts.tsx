"use client";

import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { AI_TRANSCRIPT_TARGETS, AI_TRANSCRIPT_TARGET_LABELS } from "@enterprise/contracts";
import { hrmApi } from "@/api/hrm";
import { gapsApi, type AiTranscript } from "@/api/gaps";
import { Notice, Panel } from "@/components/ui/panel";
import { gapError, gapStatusTag, zhTime } from "@/app/gaps/_components/gaps-common";

/** B2#16 会话语音转写：音频/视频 URL → 转写 → AI 摘要 → 面试维度评分回写。 */
export function GapsTranscriptsTab() {
  const [rows, setRows] = useState<AiTranscript[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [detail, setDetail] = useState<AiTranscript | null>(null);
  const [interviews, setInterviews] = useState<{ value: number; label: string }[]>([]);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await gapsApi.transcripts({ query: { page, pageSize: 20 } });
      setRows(data?.list || []);
      setTotal(data?.total || 0);
      setError("");
    } catch (err) {
      setError(gapError(err));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void hrmApi
      .listInterviews({ query: { page: 1, pageSize: 100 } })
      .then((data) =>
        setInterviews(
          (data?.list || []).map((row) => ({
            value: row.id,
            label: `面试 #${row.id} · ${row.scheduledAt ? row.scheduledAt.slice(0, 16).replace("T", " ") : ""}`,
          })),
        ),
      )
      .catch(() => setInterviews([]));
  }, []);

  const create = async () => {
    try {
      const values = await form.validateFields();
      const row = await gapsApi.createTranscript({ body: values });
      if (!row) throw new Error("转写任务创建失败，请稍后重试");
      message.success(row.status === "DONE" ? "转写完成" : "转写任务已提交");
      setOpen(false);
      form.resetFields();
      setDetail(row);
      await load();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(gapError(err));
    }
  };

  const summarize = async (row: AiTranscript) => {
    try {
      const updated = await gapsApi.summarizeTranscript({
        params: { id: String(row.id) },
        body: { prompt: "" },
      });
      message.success("AI 摘要已生成");
      setDetail(updated);
      await load();
    } catch (err) {
      message.error(gapError(err));
    }
  };

  const applyInterview = async () => {
    if (!detail) return;
    setApplying(true);
    try {
      const result = await gapsApi.applyInterviewDraft({
        params: { id: String(detail.id) },
        body: { interviewId: detail.targetId, interviewerUserId: "" },
      });
      message.success(`已写入 ${result?.ratings.length ?? 0} 个维度评分`);
    } catch (err) {
      message.error(gapError(err));
    } finally {
      setApplying(false);
    }
  };

  const columns: ColumnsType<AiTranscript> = [
    { title: "标题", dataIndex: "title" },
    { title: "类型", dataIndex: "targetTypeLabel", width: 100 },
    {
      title: "关联对象",
      width: 130,
      render: (_, row) =>
        row.targetType === "INTERVIEW"
          ? interviews.find((item) => item.value === row.targetId)?.label || `面试 #${row.targetId}`
          : row.targetId
            ? `#${row.targetId}`
            : "—",
    },
    {
      title: "时长",
      width: 90,
      render: (_, row) => (row.durationSec ? `${Math.round(row.durationSec / 60)} 分钟` : "—"),
    },
    { title: "状态", width: 90, render: (_, row) => gapStatusTag(row.status) },
    { title: "模型", dataIndex: "model", width: 160, ellipsis: true },
    { title: "创建时间", width: 150, render: (_, row) => zhTime(row.createdAt) },
    {
      title: "操作",
      width: 210,
      render: (_, row) => (
        <>
          <Button size="small" type="link" onClick={() => setDetail(row)}>
            查看
          </Button>
          <Button size="small" type="link" onClick={() => void summarize(row)}>
            AI 摘要
          </Button>
          <Button
            size="small"
            type="link"
            danger
            onClick={async () => {
              try {
                await gapsApi.removeTranscript({
                  params: { id: String(row.id) },
                  body: {},
                });
                message.success("已删除");
                await load();
              } catch (err) {
                message.error(gapError(err));
              }
            }}
          >
            删除
          </Button>
        </>
      ),
    },
  ];

  return (
    <Panel
      title="会话语音转写"
      titleExtra="面试 / 会议 / 客服会话的音视频转文字与 AI 摘要；面试转写可把维度评分直接写回面试评分"
      extra={
        <Button
          type="primary"
          onClick={() => {
            form.resetFields();
            setOpen(true);
          }}
        >
          新建转写
        </Button>
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1100 }}
        pagination={{
          current: page,
          pageSize: 20,
          total,
          showSizeChanger: false,
          onChange: setPage,
        }}
      />

      <Modal
        open={open}
        title="新建语音转写"
        onCancel={() => setOpen(false)}
        onOk={() => void create()}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ targetType: "OTHER", targetId: 0, durationSec: 0, language: "zh" }}
        >
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "请填写标题" }]}>
            <Input maxLength={120} placeholder="如：销售岗二面录音" />
          </Form.Item>
          <Form.Item name="targetType" label="类型">
            <Select
              options={AI_TRANSCRIPT_TARGETS.map((value) => ({
                value,
                label: AI_TRANSCRIPT_TARGET_LABELS[value],
              }))}
            />
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {({ getFieldValue }) =>
              getFieldValue("targetType") === "INTERVIEW" ? (
                <Form.Item name="targetId" label="关联面试" rules={[{ required: true, message: "请选择面试" }]}>
                  <Select showSearch optionFilterProp="label" options={interviews} />
                </Form.Item>
              ) : (
                <Form.Item name="targetId" label="关联对象 ID（可选）">
                  <InputNumber min={0} style={{ width: "100%" }} />
                </Form.Item>
              )
            }
          </Form.Item>
          <Form.Item
            name="mediaUrl"
            label="音视频地址"
            rules={[{ required: true, message: "请填写可访问的音视频 URL" }]}
            extra="支持本站对象存储或可公网访问的音视频链接"
          >
            <Input maxLength={2000} placeholder="https://…/meeting.mp3" />
          </Form.Item>
          <Form.Item name="durationSec" label="时长（秒）">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="language" label="语言">
            <Input maxLength={16} placeholder="zh" />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        open={Boolean(detail)}
        size={640}
        title={detail?.title || "转写详情"}
        onClose={() => setDetail(null)}
        destroyOnHidden
        extra={
          detail ? (
            <Space>
              <Button onClick={() => void summarize(detail)}>AI 摘要</Button>
              {detail.targetType === "INTERVIEW" ? (
                <Button type="primary" loading={applying} onClick={() => void applyInterview()}>
                  写入面试评分
                </Button>
              ) : null}
            </Space>
          ) : null
        }
      >
        {detail ? (
          <>
            <Space wrap style={{ marginBottom: 12 }}>
              {gapStatusTag(detail.status)}
              <Tag>{detail.targetTypeLabel}</Tag>
              <span className="text-12 muted">{zhTime(detail.createdAt)}</span>
            </Space>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>摘要</div>
            <Alert
              type={detail.summary ? "success" : "info"}
              showIcon
              title={detail.summary || "尚未生成摘要，点右上角「AI 摘要」。"}
              style={{ marginBottom: 14 }}
              description={
                detail.insights && Object.keys(detail.insights).length ? (
                  <pre className="text-12" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                    {JSON.stringify(detail.insights, null, 2)}
                  </pre>
                ) : undefined
              }
            />
            <div style={{ fontWeight: 600, marginBottom: 6 }}>转写原文</div>
            <div
              className="text-12"
              style={{
                whiteSpace: "pre-wrap",
                maxHeight: 420,
                overflow: "auto",
                border: "1px solid var(--ant-color-border-secondary, #f0f0f0)",
                borderRadius: 6,
                padding: 12,
              }}
            >
              {detail.transcript || "（无转写文本）"}
            </div>
          </>
        ) : null}
      </Drawer>
    </Panel>
  );
}
