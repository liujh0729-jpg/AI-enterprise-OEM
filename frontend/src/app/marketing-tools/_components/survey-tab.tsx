"use client";

import {
  BarChartOutlined,
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  PlusOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  TableOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import QRCode from "qrcode";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SURVEY_QUESTION_TYPE_LABELS,
  SURVEY_QUESTION_TYPES,
  SURVEY_STATUS_LABELS,
  SURVEY_STATUSES,
  type SurveyQuestion,
  type SurveyQuestionType,
  type SurveySettings,
  type SurveyStatus,
} from "@enterprise/contracts";
import { Notice, Panel, TabStrip } from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";
import { fmtTime } from "@/lib/datetime";
import { surveyApi, type Survey, type SurveyResults } from "@/api/survey";
import { aiApi, type AiSurveyReport } from "@/api/ai";
import { AiList, AiResultModal } from "@/components/ai-result";

/**
 * 营销问卷与调研（营销工具）：设计题目 → 发布分享 → 回答逐份写入
 * 问卷自动创建的多维表格。题目在草稿阶段可改；发布并收到回答后锁定，
 * 想改结构就新建一份，历史回收数据不受影响。
 */

const STATUS_COLOR: Record<SurveyStatus, string> = {
  DRAFT: "default",
  PUBLISHED: "processing",
  CLOSED: "success",
};

type DraftQuestion = {
  key: string;
  /** 已有题目才有 qN；新题目保存时由后端顺延分配。 */
  id?: string;
  label: string;
  type: SurveyQuestionType;
  required: boolean;
  options: string[];
  min: number;
  max: number;
};

type DraftSurvey = {
  title: string;
  description: string;
  allowMultiple: boolean;
  thankYouText: string;
  questions: DraftQuestion[];
};

const isChoice = (type: SurveyQuestionType) =>
  type === "single" || type === "multiple";

let localSeq = 0;
const localKey = () => `new-${++localSeq}`;

function emptyQuestion(): DraftQuestion {
  return {
    key: localKey(),
    label: "",
    type: "single",
    required: false,
    options: ["选项1", "选项2"],
    min: 1,
    max: 5,
  };
}

function toDraft(survey: Survey): DraftSurvey {
  return {
    title: survey.title,
    description: survey.description,
    allowMultiple: survey.settings.allowMultiple,
    thankYouText: survey.settings.thankYouText,
    questions: survey.questions.map((question) => ({
      key: `q-${question.id}`,
      id: question.id,
      label: question.label,
      type: question.type,
      required: question.required,
      options: [...question.options],
      min: question.min,
      max: question.max,
    })),
  };
}

const newDraft = (): DraftSurvey => ({
  title: "",
  description: "",
  allowMultiple: true,
  thankYouText: "感谢你的参与，问卷已提交。",
  questions: [emptyQuestion()],
});

function answerText(question: SurveyQuestion, value: unknown) {
  if (value === undefined || value === null || value === "") return "-";
  if (Array.isArray(value)) return value.join("、");
  if (question.type === "date" && typeof value === "string") {
    const time = new Date(value);
    if (!Number.isNaN(time.getTime())) return time.toLocaleDateString("zh-CN");
  }
  return String(value);
}

export function SurveyTab() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<Survey[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState<"" | SurveyStatus>("");
  const [loading, setLoading] = useState(true);

  const [designerOpen, setDesignerOpen] = useState(false);
  const [editing, setEditing] = useState<Survey | null>(null);
  const [draft, setDraft] = useState<DraftSurvey>(newDraft);
  const [saving, setSaving] = useState(false);

  const [shareOf, setShareOf] = useState<Survey | null>(null);
  const [qr, setQr] = useState("");

  const [resultsOf, setResultsOf] = useState<Survey | null>(null);
  const [results, setResults] = useState<SurveyResults | null>(null);
  const [resultsPage, setResultsPage] = useState(1);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [aiReport, setAiReport] = useState<AiSurveyReport | null>(null);
  const [aiReportOpen, setAiReportOpen] = useState(false);
  const [aiReportLoading, setAiReportLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await surveyApi.page({
        query: {
          page,
          pageSize,
          ...(status ? { status } : {}),
        },
      });
      setRows(result?.list ?? []);
      setTotal(result?.total ?? 0);
    } catch (error) {
      message.error((error as Error).message || "问卷列表读取失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, message]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const shareUrl = useMemo(() => {
    if (!shareOf) return "";
    return `${window.location.origin}${shareOf.sharePath}`;
  }, [shareOf]);

  useEffect(() => {
    if (!shareOf) {
      setQr("");
      return;
    }
    void QRCode.toDataURL(shareUrl, { width: 320, margin: 1 })
      .then(setQr)
      .catch(() => setQr(""));
  }, [shareOf, shareUrl]);

  const openCreate = () => {
    setEditing(null);
    setDraft(newDraft());
    setDesignerOpen(true);
  };

  const openDesign = (survey: Survey) => {
    setEditing(survey);
    setDraft(toDraft(survey));
    setDesignerOpen(true);
  };

  const locked = Boolean(
    editing && (editing.status !== "DRAFT" || editing.responseCount > 0),
  );

  const patchQuestion = (key: string, patch: Partial<DraftQuestion>) => {
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question) =>
        question.key === key ? { ...question, ...patch } : question,
      ),
    }));
  };

  const save = async () => {
    const title = draft.title.trim();
    if (!title) {
      message.error("请填写问卷标题");
      return;
    }
    if (!draft.questions.length) {
      message.error("请至少添加一道题目");
      return;
    }
    const questions = draft.questions.map((question) => ({
      ...(question.id ? { id: question.id } : {}),
      label: question.label.trim(),
      type: question.type,
      required: question.required,
      options: isChoice(question.type)
        ? question.options.map((item) => item.trim()).filter(Boolean)
        : [],
      min: question.min,
      max: question.max,
    }));
    if (questions.some((question) => !question.label)) {
      message.error("题目标题不能为空");
      return;
    }
    const settings: Partial<SurveySettings> = {
      allowMultiple: draft.allowMultiple,
      thankYouText: draft.thankYouText.trim(),
    };
    setSaving(true);
    try {
      if (editing) {
        await surveyApi.update({
          params: { id: String(editing.id) },
          body: {
            title,
            description: draft.description.trim(),
            settings,
            ...(locked ? {} : { questions }),
          },
        });
      } else {
        await surveyApi.create({
          body: {
            title,
            description: draft.description.trim(),
            questions,
            settings,
          },
        });
      }
      message.success(editing ? "问卷已保存" : "问卷已创建，题目已同步到回收多维表格");
      setDesignerOpen(false);
      await reload();
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (survey: Survey) => {
    try {
      if (survey.status === "DRAFT") {
        await surveyApi.publish({ params: { id: String(survey.id) } });
        message.success("问卷已发布，分享链接现在可以填写");
      } else if (survey.status === "PUBLISHED") {
        await surveyApi.close({ params: { id: String(survey.id) } });
        message.success("问卷已结束，不再接收新回答");
      } else {
        await surveyApi.reopen({ params: { id: String(survey.id) } });
        message.success("问卷已重新开放");
      }
      await reload();
    } catch (error) {
      message.error((error as Error).message || "状态更新失败");
    }
  };

  const remove = async (survey: Survey) => {
    try {
      await surveyApi.remove({ params: { id: String(survey.id) } });
      message.success(`问卷已删除；回收数据仍保留在多维表格 #${survey.tableId}`);
      await reload();
    } catch (error) {
      message.error((error as Error).message || "删除失败");
    }
  };

  const loadResults = useCallback(
    async (survey: Survey, pageNo: number) => {
      setResultsLoading(true);
      try {
        const result = await surveyApi.results({
          params: { id: String(survey.id) },
          query: { page: pageNo, pageSize: 10 },
        });
        setResults(result);
      } catch (error) {
        message.error((error as Error).message || "回收数据读取失败");
      } finally {
        setResultsLoading(false);
      }
    },
    [message],
  );

  useEffect(() => {
    if (!resultsOf) {
      setResults(null);
      return;
    }
    setResultsPage(1);
    void loadResults(resultsOf, 1);
  }, [resultsOf, loadResults]);

  const runAiReport = async () => {
    if (!resultsOf) return;
    setAiReportOpen(true);
    setAiReportLoading(true);
    setAiReport(null);
    try {
      setAiReport(
        await aiApi.surveyReport({ body: { surveyId: resultsOf.id } }),
      );
    } catch (error) {
      message.error((error as Error).message || "AI 分析失败");
      setAiReportOpen(false);
    } finally {
      setAiReportLoading(false);
    }
  };

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      message.success("分享链接已复制");
    } catch {
      message.error("复制失败，请手动选中链接复制");
    }
  };

  const columns = [
    {
      title: "问卷",
      dataIndex: "title",
      render: (_: unknown, record: Survey) => (
        <div>
          <div style={{ fontWeight: 600 }}>{record.title}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {record.description || "未填写说明"}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (value: SurveyStatus) => (
        <Tag color={STATUS_COLOR[value]}>{SURVEY_STATUS_LABELS[value]}</Tag>
      ),
    },
    {
      title: "题目",
      dataIndex: "questions",
      width: 80,
      render: (_: unknown, record: Survey) => `${record.questions.length} 题`,
    },
    {
      title: "已回收",
      dataIndex: "responseCount",
      width: 110,
      render: (value: number, record: Survey) => (
        <Button
          type="link"
          size="small"
          style={{ paddingInline: 0 }}
          onClick={() => setResultsOf(record)}
        >
          {value} 份
        </Button>
      ),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      width: 170,
      render: (value: string) => fmtTime(value),
    },
    {
      title: "操作",
      key: "actions",
      width: 330,
      render: (_: unknown, record: Survey) => (
        <Space size={4} wrap>
          <Button
            size="small"
            type="link"
            icon={<EditOutlined />}
            onClick={() => openDesign(record)}
          >
            设计
          </Button>
          <Button
            size="small"
            type="link"
            icon={<LinkOutlined />}
            disabled={record.status === "DRAFT"}
            onClick={() => setShareOf(record)}
          >
            分享
          </Button>
          <Button size="small" type="link" onClick={() => void changeStatus(record)}>
            {record.status === "DRAFT"
              ? "发布"
              : record.status === "PUBLISHED"
                ? "结束"
                : "重新开放"}
          </Button>
          <Button
            size="small"
            type="link"
            icon={<BarChartOutlined />}
            onClick={() => setResultsOf(record)}
          >
            数据
          </Button>
          <Popconfirm
            title="删除这份问卷？"
            description={`回收数据保留在多维表格 #${record.tableId}，问卷定义删除后不可恢复。`}
            onConfirm={() => void remove(record)}
          >
            <Button size="small" type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Panel
      title="营销问卷与调研"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void reload()}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建问卷
          </Button>
        </Space>
      }
    >
      <Notice>
        每题对应回收多维表格的一列（列键 q1、q2 …）：单选题落「单选」列，多选题与填空题落文本列，数字 / 评分落数字列。
        发布后分享链接免登录即可填写；问卷题目在收到回答后锁定，回收数据可在多维表格里筛选、导出，也能继续接飞书同步。
      </Notice>

      <div style={{ margin: "12px 0" }}>
        <TabStrip
          items={[
            { key: "", label: "全部" },
            ...SURVEY_STATUSES.map((item) => ({
              key: item,
              label: SURVEY_STATUS_LABELS[item],
            })),
          ]}
          value={status}
          onChange={(key) => {
            setPage(1);
            setStatus(key as "" | SurveyStatus);
          }}
        />
      </div>

      <Table<Survey>
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={columns}
        locale={{ emptyText: <Empty description="还没有问卷，点右上角新建" /> }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (nextPage, nextSize) => {
            setPage(nextPage);
            setPageSize(nextSize);
          },
        }}
      />

      <Drawer
        title={editing ? `设计问卷 · ${editing.title}` : "新建问卷"}
        size={820}
        open={designerOpen}
        onClose={() => setDesignerOpen(false)}
        destroyOnHidden
        extra={
          <Space>
            <Button onClick={() => setDesignerOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void save()}>
              {editing ? "保存" : "创建问卷"}
            </Button>
          </Space>
        }
      >
        {locked ? (
          <Notice variant="warn">
            这份问卷已经发布或收到回答，题目已锁定；标题、说明和回收设置仍可修改。需要改题请新建一份问卷，历史回收数据会保留在原多维表格。
          </Notice>
        ) : null}
        <Space orientation="vertical" size={16} style={{ width: "100%", marginTop: locked ? 12 : 0 }}>
          <div>
            <div className="data-table-form-label">问卷标题</div>
            <Input
              value={draft.title}
              maxLength={120}
              placeholder="例如：2026 年客户满意度调研"
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
            />
          </div>
          <div>
            <div className="data-table-form-label">问卷说明</div>
            <Input.TextArea
              value={draft.description}
              rows={2}
              maxLength={500}
              showCount
              placeholder="告诉填写人这份问卷的用途、预计耗时等"
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
            />
          </div>
          <Space size={24} wrap>
            <Space>
              <span>允许同一浏览器重复填写</span>
              <Switch
                checked={draft.allowMultiple}
                onChange={(checked) =>
                  setDraft((current) => ({ ...current, allowMultiple: checked }))
                }
              />
            </Space>
          </Space>
          <div>
            <div className="data-table-form-label">提交成功提示</div>
            <Input
              value={draft.thankYouText}
              maxLength={500}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  thankYouText: event.target.value,
                }))
              }
            />
          </div>

          <div>
            <div className="data-table-form-label" style={{ marginBottom: 8 }}>
              题目（{draft.questions.length}）
            </div>
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              {draft.questions.map((question, index) => (
                <Card
                  key={question.key}
                  size="small"
                  title={`第 ${index + 1} 题`}
                  extra={
                    !locked ? (
                      <Button
                        type="link"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            questions: current.questions.filter(
                              (item) => item.key !== question.key,
                            ),
                          }))
                        }
                      >
                        删除
                      </Button>
                    ) : null
                  }
                >
                  <Space orientation="vertical" size={10} style={{ width: "100%" }}>
                    <Input
                      value={question.label}
                      maxLength={200}
                      disabled={locked}
                      placeholder="题目内容"
                      onChange={(event) =>
                        patchQuestion(question.key, { label: event.target.value })
                      }
                    />
                    <Space size={16} wrap>
                      <Select
                        value={question.type}
                        disabled={locked}
                        style={{ width: 150 }}
                        options={SURVEY_QUESTION_TYPES.map((type) => ({
                          value: type,
                          label: SURVEY_QUESTION_TYPE_LABELS[type],
                        }))}
                        onChange={(type: SurveyQuestionType) =>
                          patchQuestion(question.key, {
                            type,
                            options:
                              isChoice(type) && question.options.length < 2
                                ? ["选项1", "选项2"]
                                : question.options,
                          })
                        }
                      />
                      <Space>
                        <span>必答</span>
                        <Switch
                          checked={question.required}
                          disabled={locked}
                          onChange={(checked) =>
                            patchQuestion(question.key, { required: checked })
                          }
                        />
                      </Space>
                      {question.type === "rating" ? (
                        <Space>
                          <span>评分范围</span>
                          <InputNumber
                            min={1}
                            max={10}
                            value={question.min}
                            disabled={locked}
                            onChange={(value) =>
                              patchQuestion(question.key, { min: Number(value) || 1 })
                            }
                          />
                          <span>–</span>
                          <InputNumber
                            min={1}
                            max={10}
                            value={question.max}
                            disabled={locked}
                            onChange={(value) =>
                              patchQuestion(question.key, { max: Number(value) || 5 })
                            }
                          />
                        </Space>
                      ) : null}
                    </Space>
                    {isChoice(question.type) ? (
                      <Space orientation="vertical" size={6} style={{ width: "100%" }}>
                        {question.options.map((option, optionIndex) => (
                          <Space key={`${question.key}-${optionIndex}`} style={{ width: "100%" }}>
                            <span style={{ width: 44, color: "#8c8c8c" }}>
                              {question.type === "single" ? "○" : "□"}
                            </span>
                            <Input
                              value={option}
                              maxLength={100}
                              disabled={locked}
                              onChange={(event) =>
                                patchQuestion(question.key, {
                                  options: question.options.map((item, idx) =>
                                    idx === optionIndex ? event.target.value : item,
                                  ),
                                })
                              }
                              style={{ width: 480 }}
                            />
                            {!locked && question.options.length > 2 ? (
                              <Button
                                type="link"
                                danger
                                size="small"
                                icon={<DeleteOutlined />}
                                onClick={() =>
                                  patchQuestion(question.key, {
                                    options: question.options.filter(
                                      (_, idx) => idx !== optionIndex,
                                    ),
                                  })
                                }
                              />
                            ) : null}
                          </Space>
                        ))}
                        {!locked && question.options.length < 30 ? (
                          <Button
                            type="dashed"
                            size="small"
                            icon={<PlusOutlined />}
                            onClick={() =>
                              patchQuestion(question.key, {
                                options: [
                                  ...question.options,
                                  `选项${question.options.length + 1}`,
                                ],
                              })
                            }
                          >
                            添加选项
                          </Button>
                        ) : null}
                      </Space>
                    ) : null}
                  </Space>
                </Card>
              ))}
            </Space>
            {!locked ? (
              <Button
                type="dashed"
                block
                icon={<PlusOutlined />}
                style={{ marginTop: 12 }}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    questions: [...current.questions, emptyQuestion()],
                  }))
                }
              >
                添加题目
              </Button>
            ) : null}
          </div>
        </Space>
      </Drawer>

      <Modal
        title="分享问卷"
        open={Boolean(shareOf)}
        onCancel={() => setShareOf(null)}
        footer={null}
        destroyOnHidden
      >
        {shareOf ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Notice>
              {shareOf.status === "PUBLISHED"
                ? "把链接或二维码发给填写人，提交后答案会自动写进回收多维表格。"
                : "问卷已结束，链接仍可打开，但页面会提示不再接收回答。"}
            </Notice>
            <Space.Compact style={{ width: "100%" }}>
              <Input readOnly value={shareUrl} />
              <Button onClick={() => void copyShare()}>复制</Button>
            </Space.Compact>
            <div style={{ textAlign: "center" }}>
              {qr ? (
                <RawImg src={qr} alt="问卷二维码" width={220} height={220} />
              ) : (
                <Spin />
              )}
            </div>
            <Space>
              <Button icon={<QrcodeOutlined />} onClick={() => void copyShare()}>
                复制链接
              </Button>
              <Link href={shareOf.sharePath} target="_blank">
                <Button type="primary" icon={<LinkOutlined />}>
                  打开填写页
                </Button>
              </Link>
            </Space>
          </Space>
        ) : null}
      </Modal>

      <AiResultModal
        open={aiReportOpen}
        title={`AI 问卷洞察 · ${resultsOf?.title || ""}`}
        loading={aiReportLoading}
        mode={aiReport?.mode}
        model={aiReport?.model}
        onClose={() => setAiReportOpen(false)}
        width={720}
      >
        {aiReport ? (
          <>
            <Typography.Text type="secondary">
              已分析 {aiReport.responses} 份回答
            </Typography.Text>
            <div>{aiReport.summary}</div>
            <AiList title="关键发现" items={aiReport.findings} />
            {aiReport.clusters.length ? (
              <div>
                <strong>观点聚类</strong>
                {aiReport.clusters.map((cluster) => (
                  <div key={cluster.label} style={{ marginTop: 6 }}>
                    <Tag>{`${cluster.label} · ${cluster.count} 条`}</Tag>
                    <span className="muted text-12">
                      {cluster.examples.join("；")}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            <AiList title="建议" items={aiReport.suggestions} />
          </>
        ) : null}
      </AiResultModal>

      <Drawer
        title={resultsOf ? `回收数据 · ${resultsOf.title}` : "回收数据"}
        size={880}
        open={Boolean(resultsOf)}
        onClose={() => setResultsOf(null)}
        destroyOnHidden
        extra={
          resultsOf ? (
            <Space>
              <Button onClick={() => void runAiReport()}>AI 分析问卷</Button>
              <Link href={`/data-table?table=${resultsOf.tableId}`} target="_blank">
                <Button icon={<TableOutlined />}>打开回收多维表格</Button>
              </Link>
            </Space>
          ) : null
        }
      >
        {resultsLoading && !results ? (
          <Spin />
        ) : results ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              已回收 {results.total} 份
            </Typography.Title>
            {results.questions.map((question, index) => (
              <Card key={question.id} size="small" title={`${index + 1}. ${question.label}`}>
                <Typography.Text type="secondary">
                  已答 {question.answered} · 未答 {question.skipped}
                </Typography.Text>
                {question.options ? (
                  <Space orientation="vertical" size={6} style={{ width: "100%", marginTop: 10 }}>
                    {question.options.map((option) => (
                      <div key={option.label}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span>{option.label}</span>
                          <span>
                            {option.count} 票 · {option.percent}%
                          </span>
                        </div>
                        <Progress
                          percent={option.percent}
                          showInfo={false}
                          strokeColor="#1677ff"
                        />
                      </div>
                    ))}
                  </Space>
                ) : question.average !== undefined ? (
                  <div style={{ marginTop: 10 }}>
                    平均 {question.average ?? "-"} 分（最低 {question.min ?? "-"} / 最高{" "}
                    {question.max ?? "-"}）
                  </div>
                ) : (
                  <div style={{ marginTop: 10 }}>
                    {question.samples?.length ? (
                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {question.samples.map((sample, sampleIndex) => (
                          <li key={`${question.id}-${sampleIndex}`}>{sample}</li>
                        ))}
                      </ul>
                    ) : (
                      <Typography.Text type="secondary">暂无文字回答</Typography.Text>
                    )}
                  </div>
                )}
              </Card>
            ))}

            <div>
              <Typography.Title level={5}>最近回答</Typography.Title>
              <Table
                rowKey="id"
                size="small"
                dataSource={results.rows}
                pagination={{
                  current: resultsPage,
                  pageSize: 10,
                  total: results.total,
                  onChange: (nextPage) => {
                    setResultsPage(nextPage);
                    if (resultsOf) void loadResults(resultsOf, nextPage);
                  },
                }}
                columns={[
                  {
                    title: "提交时间",
                    dataIndex: "createdAt",
                    width: 170,
                    render: (value: string) => fmtTime(value),
                  },
                  ...(resultsOf?.questions ?? []).map((question) => ({
                    title: question.label,
                    key: question.id,
                    ellipsis: true,
                    render: (_: unknown, row: SurveyResults["rows"][number]) =>
                      answerText(question, row.data[question.id]),
                  })),
                ]}
              />
            </div>
            <Typography.Text type="secondary">
              文字回答与逐行明细可到多维表格里筛选、导出；这里展示最近 10 条回答。
            </Typography.Text>
          </Space>
        ) : null}
      </Drawer>
    </Panel>
  );
}
