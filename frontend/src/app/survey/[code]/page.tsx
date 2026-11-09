"use client";

import { CheckCircleOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Input,
  InputNumber,
  Radio,
  Rate,
  Result,
  Space,
  Spin,
  Typography,
} from "antd";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  SURVEY_QUESTION_TYPE_LABELS,
  type SurveyPublicView,
} from "@enterprise/contracts";
import { fetchPublicSurvey, submitPublicSurvey } from "@/api/survey";
import { PRODUCT_NAME } from "@/lib/brand";

/**
 * 公开问卷填写页（免登录）：链接形如 /survey/:code。
 * 只读问卷视图与提交接口都在 /api/public/survey 下，不经过业务登录态；
 * 答案由后端按题目校验后写入发起人的多维表格。
 */

const submittedKey = (code: string) => `survey-submitted:${code}`;

const isEmptyAnswer = (value: unknown) =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && !value.trim()) ||
  (Array.isArray(value) && !value.length);

export default function PublicSurveyPage() {
  const params = useParams<{ code: string }>();
  const code = params?.code || "";
  const [view, setView] = useState<SurveyPublicView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState("");
  const [formError, setFormError] = useState("");

  const answeredCount = useMemo(
    () => Object.values(answers).filter((value) => !isEmptyAnswer(value)).length,
    [answers],
  );

  useEffect(() => {
    if (!code) return;
    setLoading(true);
    void fetchPublicSurvey(code)
      .then((data) => {
        setView(data);
        if (
          !data.allowMultiple &&
          window.localStorage.getItem(submittedKey(code))
        ) {
          setDone(data.thankYouText);
        }
      })
      .catch((err: unknown) => setError((err as Error).message || "问卷加载失败"))
      .finally(() => setLoading(false));
  }, [code]);

  const setAnswer = (id: string, value: unknown) => {
    setAnswers((current) => {
      const next = { ...current };
      if (isEmptyAnswer(value)) delete next[id];
      else next[id] = value;
      return next;
    });
    setFormError("");
  };

  const submit = async () => {
    if (!view) return;
    for (const question of view.questions) {
      const value = answers[question.id];
      if (question.required && isEmptyAnswer(value)) {
        setFormError(`请回答必填题「${question.label}」`);
        return;
      }
      if (!isEmptyAnswer(value) && question.type === "rating") {
        const score = Number(value);
        if (score < question.min || score > question.max) {
          setFormError(
            `「${question.label}」请选择 ${question.min}–${question.max} 分`,
          );
          return;
        }
      }
    }
    setSubmitting(true);
    setFormError("");
    try {
      const data = await submitPublicSurvey(code, answers);
      window.localStorage.setItem(submittedKey(code), "1");
      setDone(data.thankYouText || view.thankYouText);
    } catch (err) {
      setFormError((err as Error).message || "提交失败，请稍后再试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#eef3f9", padding: "32px 16px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <Typography.Text strong style={{ fontSize: 16 }}>
            {PRODUCT_NAME} · 问卷调研
          </Typography.Text>
          {view && view.status === "PUBLISHED" ? (
            <Typography.Text type="secondary">
              已填 {answeredCount} / {view.questions.length} 题
            </Typography.Text>
          ) : null}
        </div>

        {loading ? (
          <Card>
            <div style={{ textAlign: "center", padding: "60px 0" }}>
              <Spin tip="正在加载问卷…" />
            </div>
          </Card>
        ) : error ? (
          <Card>
            <Result status="404" title="问卷不存在" subTitle={error} />
          </Card>
        ) : done ? (
          <Card>
            <Result
              status="success"
              icon={<CheckCircleOutlined style={{ color: "#52c41a" }} />}
              title="提交成功"
              subTitle={done}
            />
          </Card>
        ) : view ? (
          <Card>
            <Typography.Title level={2} style={{ marginTop: 0 }}>
              {view.title}
            </Typography.Title>
            {view.description ? (
              <Typography.Paragraph type="secondary">
                {view.description}
              </Typography.Paragraph>
            ) : null}
            {view.status === "CLOSED" ? (
              <Alert
                type="warning"
                showIcon
                title="问卷已结束"
                description="这份问卷已经结束，不再接收新的回答。"
                style={{ marginBottom: 20 }}
              />
            ) : null}

            <Space orientation="vertical" size={20} style={{ width: "100%" }}>
              {view.questions.map((question, index) => (
                <div key={question.id}>
                  <div style={{ marginBottom: 8 }}>
                    <Typography.Text strong>
                      {index + 1}. {question.label}
                    </Typography.Text>
                    {question.required ? (
                      <Typography.Text type="danger" style={{ marginLeft: 4 }}>
                        *
                      </Typography.Text>
                    ) : null}
                    <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                      {SURVEY_QUESTION_TYPE_LABELS[question.type]}
                    </Typography.Text>
                  </div>
                  {question.type === "single" ? (
                    <Radio.Group
                      disabled={view.status === "CLOSED"}
                      value={answers[question.id]}
                      onChange={(event) => setAnswer(question.id, event.target.value)}
                    >
                      <Space orientation="vertical">
                        {question.options.map((option) => (
                          <Radio key={option} value={option}>
                            {option}
                          </Radio>
                        ))}
                      </Space>
                    </Radio.Group>
                  ) : question.type === "multiple" ? (
                    <Checkbox.Group
                      disabled={view.status === "CLOSED"}
                      value={
                        Array.isArray(answers[question.id])
                          ? (answers[question.id] as string[])
                          : []
                      }
                      onChange={(values) => setAnswer(question.id, values)}
                    >
                      <Space orientation="vertical">
                        {question.options.map((option) => (
                          <Checkbox key={option} value={option}>
                            {option}
                          </Checkbox>
                        ))}
                      </Space>
                    </Checkbox.Group>
                  ) : question.type === "long_text" ? (
                    <Input.TextArea
                      rows={4}
                      maxLength={2000}
                      showCount
                      disabled={view.status === "CLOSED"}
                      value={String(answers[question.id] || "")}
                      onChange={(event) => setAnswer(question.id, event.target.value)}
                    />
                  ) : question.type === "short_text" ? (
                    <Input
                      maxLength={200}
                      disabled={view.status === "CLOSED"}
                      value={String(answers[question.id] || "")}
                      onChange={(event) => setAnswer(question.id, event.target.value)}
                    />
                  ) : question.type === "number" ? (
                    <InputNumber
                      style={{ width: "100%" }}
                      disabled={view.status === "CLOSED"}
                      value={
                        typeof answers[question.id] === "number"
                          ? (answers[question.id] as number)
                          : undefined
                      }
                      onChange={(value) => setAnswer(question.id, value)}
                    />
                  ) : question.type === "date" ? (
                    <DatePicker
                      style={{ width: "100%" }}
                      disabled={view.status === "CLOSED"}
                      onChange={(date) =>
                        setAnswer(
                          question.id,
                          date ? date.format("YYYY-MM-DD") : undefined,
                        )
                      }
                    />
                  ) : (
                    <div>
                      <Rate
                        count={question.max}
                        disabled={view.status === "CLOSED"}
                        value={Number(answers[question.id]) || 0}
                        onChange={(value) => setAnswer(question.id, value)}
                      />
                      <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                        {question.min}–{question.max} 分
                      </Typography.Text>
                    </div>
                  )}
                </div>
              ))}
            </Space>

            {formError ? (
              <Alert
                type="error"
                showIcon
                title={formError}
                style={{ marginTop: 20 }}
              />
            ) : null}

            {view.status === "PUBLISHED" ? (
              <Button
                type="primary"
                size="large"
                block
                loading={submitting}
                style={{ marginTop: 24 }}
                onClick={() => void submit()}
              >
                提交问卷
              </Button>
            ) : null}

            <Typography.Paragraph
              type="secondary"
              style={{ marginTop: 20, marginBottom: 0, fontSize: 12 }}
            >
              你的回答仅用于本次调研。提交后数据会写入发起人的多维表格，不会公开展示。
            </Typography.Paragraph>
          </Card>
        ) : null}

        <div style={{ textAlign: "center", marginTop: 16 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            由 {PRODUCT_NAME} 提供问卷调研
          </Typography.Text>
        </div>
      </div>
    </div>
  );
}
