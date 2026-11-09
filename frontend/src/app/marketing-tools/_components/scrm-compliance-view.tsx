"use client";

import {
  AlertOutlined,
  CheckCircleOutlined,
  ExperimentOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { SCRM_SENSITIVE_ACTIONS, SCRM_SENSITIVE_DIRECTIONS } from "@enterprise/contracts";
import { Notice, Panel } from "@/components/ui/panel";
import {
  SENSITIVE_ACTION_COLOR,
  SENSITIVE_ACTION_LABELS,
  SENSITIVE_DIRECTION_LABELS,
  fmtDateTime,
  scrmApi,
  sensitiveDirectionLabel,
  type ScrmContact,
  type ScrmQcResult,
  type ScrmSensitiveHit,
  type ScrmSensitiveWord,
} from "./scrm-common";

/**
 * 合规质检：敏感词按方向区分——出站可拦截/替换，入站与群聊只告警留痕。
 * AI 质检有模型走模型、无模型走可解释规则，两种模式返回同一套四维评分。
 */

const DIRECTION_OPTIONS = Object.entries(SENSITIVE_DIRECTION_LABELS).map(
  ([value, label]) => ({ value, label }),
);
const ACTION_OPTIONS = Object.entries(SENSITIVE_ACTION_LABELS).map(([value, label]) => ({
  value,
  label,
}));

type CheckResult = {
  blocked: boolean;
  replaced: string;
  hits: { word: string; action: string; group: string }[];
};

export function ScrmComplianceView({ tick }: { tick: number }) {
  const { message } = App.useApp();
  const [words, setWords] = useState<ScrmSensitiveWord[]>([]);
  const [wordLoading, setWordLoading] = useState(true);
  const [hits, setHits] = useState<ScrmSensitiveHit[]>([]);
  const [hitTotal, setHitTotal] = useState(0);
  const [hitPage, setHitPage] = useState(1);
  const [hitPageSize, setHitPageSize] = useState(10);
  const [hitDirection, setHitDirection] = useState<
    (typeof SCRM_SENSITIVE_DIRECTIONS)[number] | ""
  >("");
  const [hitLoading, setHitLoading] = useState(false);
  const [wordOpen, setWordOpen] = useState(false);
  const [editing, setEditing] = useState<ScrmSensitiveWord | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [qcResult, setQcResult] = useState<ScrmQcResult | null>(null);
  const [qcLoading, setQcLoading] = useState(false);
  const [contacts, setContacts] = useState<ScrmContact[]>([]);
  const [contactKeyword, setContactKeyword] = useState("");
  const [checkForm] = Form.useForm();
  const [qcForm] = Form.useForm();

  const reloadWords = useCallback(async () => {
    setWordLoading(true);
    try {
      setWords((await scrmApi.sensitiveWords()) ?? []);
    } catch (error) {
      message.error((error as Error).message || "敏感词读取失败");
    } finally {
      setWordLoading(false);
    }
  }, [message]);

  const reloadHits = useCallback(async () => {
    setHitLoading(true);
    try {
      const result = await scrmApi.sensitiveHits({
        query: {
          page: hitPage,
          pageSize: hitPageSize,
          ...(hitDirection ? { direction: hitDirection } : {}),
        },
      });
      setHits(result?.list ?? []);
      setHitTotal(result?.total ?? 0);
    } catch (error) {
      message.error((error as Error).message || "命中记录读取失败");
    } finally {
      setHitLoading(false);
    }
  }, [hitPage, hitPageSize, hitDirection, message]);

  useEffect(() => {
    void reloadWords();
    void reloadHits();
  }, [reloadWords, reloadHits, tick]);

  const searchContacts = useCallback(async (keyword: string) => {
    try {
      const result = await scrmApi.contacts({
        query: { page: 1, pageSize: 50, ...(keyword ? { keyword } : {}) },
      });
      setContacts(result?.list ?? []);
    } catch {
      setContacts([]);
    }
  }, []);

  const removeWord = async (row: ScrmSensitiveWord) => {
    try {
      await scrmApi.removeSensitiveWord({ body: { id: row.id } });
      message.success("敏感词已删除");
      void reloadWords();
    } catch (error) {
      message.error((error as Error).message || "删除失败");
    }
  };

  const toggleWord = async (row: ScrmSensitiveWord, enabled: boolean) => {
    try {
      await scrmApi.saveSensitiveWord({
        body: {
          id: row.id,
          group: row.group,
          word: row.word,
          action: SCRM_SENSITIVE_ACTIONS.find((item) => item === row.action) ?? "BLOCK",
          direction: SCRM_SENSITIVE_DIRECTIONS.find((item) => item === row.direction) ?? "OUTBOUND",
          replacement: row.replacement,
          enabled,
        },
      });
      void reloadWords();
    } catch (error) {
      message.error((error as Error).message || "状态更新失败");
    }
  };

  const runCheck = async () => {
    const values = await checkForm.validateFields();
    setChecking(true);
    try {
      const result = await scrmApi.checkText({
        body: { text: values.text, direction: values.direction },
      });
      setCheckResult(result);
    } catch (error) {
      message.error((error as Error).message || "试检失败");
    } finally {
      setChecking(false);
    }
  };

  const runQc = async () => {
    const values = await qcForm.validateFields();
    if (!values.contactId && !String(values.text || "").trim()) {
      message.warning("请选择客户或粘贴要质检的会话内容");
      return;
    }
    setQcLoading(true);
    try {
      const result = await scrmApi.qc({
        body: {
          contactId: values.contactId || undefined,
          text: values.text || "",
        },
      });
      setQcResult(result);
    } catch (error) {
      message.error((error as Error).message || "质检失败");
    } finally {
      setQcLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setWordOpen(true);
  };

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Panel
        title={
          <>
            <SafetyCertificateOutlined aria-hidden /> 敏感词
          </>
        }
        titleExtra="出站：拦截/改写后发送；入站与群聊：只告警留痕，不影响客户消息"
        extra={
          <Button type="primary" icon={<PlusOutlined aria-hidden />} onClick={openCreate}>
            新增敏感词
          </Button>
        }
      >
        <Table<ScrmSensitiveWord>
          rowKey="id"
          size="small"
          loading={wordLoading}
          dataSource={words}
          pagination={false}
          scroll={{ x: 860 }}
          columns={[
            {
              title: "分组",
              dataIndex: "group",
              width: 120,
              render: (value: string) => value || "-",
            },
            { title: "敏感词", dataIndex: "word", width: 160 },
            {
              title: "生效方向",
              dataIndex: "direction",
              width: 150,
              render: (value: string) => <Tag>{sensitiveDirectionLabel(value)}</Tag>,
            },
            {
              title: "命中动作",
              dataIndex: "action",
              width: 120,
              render: (value: string) => (
                <Tag color={SENSITIVE_ACTION_COLOR[value] ?? "default"}>
                  {SENSITIVE_ACTION_LABELS[value] ?? value}
                </Tag>
              ),
            },
            {
              title: "替换文本",
              dataIndex: "replacement",
              render: (value: string, row) =>
                row.action === "REPLACE" ? value || "-" : <span className="muted">不适用</span>,
            },
            {
              title: "启用",
              dataIndex: "enabled",
              width: 80,
              render: (value: boolean, row) => (
                <Switch
                  size="small"
                  checked={value}
                  onChange={(checked) => void toggleWord(row, checked)}
                />
              ),
            },
            {
              title: "创建时间",
              dataIndex: "createdAt",
              width: 170,
              render: fmtDateTime,
            },
            {
              title: "操作",
              width: 120,
              render: (_: unknown, row) => (
                <Space size={4}>
                  <Button
                    size="small"
                    onClick={() => {
                      setEditing(row);
                      setWordOpen(true);
                    }}
                  >
                    编辑
                  </Button>
                  <Popconfirm title="删除这条敏感词？" onConfirm={() => void removeWord(row)}>
                    <Button size="small" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
          locale={{ emptyText: "还没有敏感词：先加一批出站必拦词，再按需补充告警词" }}
        />
      </Panel>

      <Panel
        title={
          <>
            <ExperimentOutlined aria-hidden /> 内容试检
          </>
        }
        titleExtra="只返回命中结论，不写命中台账；台账只记真实消息"
      >
        <Form
          form={checkForm}
          layout="vertical"
          initialValues={{ text: "", direction: "OUTBOUND" }}
        >
          <Form.Item
            name="text"
            label="待检文本"
            rules={[{ required: true, message: "请粘贴要检查的文本" }]}
          >
            <Input.TextArea rows={3} maxLength={4000} showCount placeholder="粘贴一条准备发送的消息" />
          </Form.Item>
          <Space wrap>
            <Form.Item name="direction" label="检查方向" style={{ marginBottom: 0 }}>
              <Select style={{ width: 180 }} options={DIRECTION_OPTIONS} />
            </Form.Item>
            <Button type="primary" loading={checking} onClick={() => void runCheck()}>
              开始试检
            </Button>
          </Space>
        </Form>
        {checkResult ? (
          <div style={{ marginTop: 12 }}>
            {checkResult.hits.length ? (
              <Space wrap size={4}>
                <Typography.Text>命中：</Typography.Text>
                {checkResult.hits.map((hit) => (
                  <Tag key={`${hit.word}-${hit.action}`} color={SENSITIVE_ACTION_COLOR[hit.action]}>
                    {hit.word} · {SENSITIVE_ACTION_LABELS[hit.action] ?? hit.action}
                  </Tag>
                ))}
              </Space>
            ) : (
              <Typography.Text type="success">
                <CheckCircleOutlined aria-hidden /> 未命中敏感词
              </Typography.Text>
            )}
            {checkResult.blocked ? (
              <Notice variant="warn">
                按当前规则，这条内容会被拦截，无法发送。可调整措辞后重新试检。
              </Notice>
            ) : null}
            {!checkResult.blocked && checkResult.replaced && checkResult.replaced !== checkForm.getFieldValue("text") ? (
              <Notice variant="info">替换后文本：{checkResult.replaced}</Notice>
            ) : null}
          </div>
        ) : null}
      </Panel>

      <Panel
        title={
          <>
            <AlertOutlined aria-hidden /> 命中台账
          </>
        }
        titleExtra="按真实消息记录；入站命中同样留痕，但不会阻断客户"
        extra={
          <Select
            style={{ width: 170 }}
            allowClear
            placeholder="全部方向"
            value={hitDirection || undefined}
            onChange={(value) => {
              setHitDirection(SCRM_SENSITIVE_DIRECTIONS.find((item) => item === value) ?? "");
              setHitPage(1);
            }}
            options={DIRECTION_OPTIONS}
          />
        }
      >
        <Table<ScrmSensitiveHit>
          rowKey="id"
          size="small"
          loading={hitLoading}
          dataSource={hits}
          scroll={{ x: 860 }}
          pagination={{
            current: hitPage,
            pageSize: hitPageSize,
            total: hitTotal,
            showSizeChanger: true,
            onChange: (page, size) => {
              setHitPage(page);
              setHitPageSize(size);
            },
          }}
          columns={[
            { title: "敏感词", dataIndex: "word", width: 140 },
            {
              title: "方向",
              dataIndex: "direction",
              width: 130,
              render: (value: string) => <Tag>{sensitiveDirectionLabel(value)}</Tag>,
            },
            { title: "分组", dataIndex: "group", width: 110, render: (value: string) => value || "-" },
            {
              title: "客户",
              dataIndex: "contactName",
              width: 140,
              render: (value: string, row) => value || (row.contactId ? `#${row.contactId}` : "-"),
            },
            {
              title: "命中内容",
              dataIndex: "text",
              render: (value: string) => (
                <Typography.Text ellipsis style={{ maxWidth: 320 }}>
                  {value || "-"}
                </Typography.Text>
              ),
            },
            { title: "时间", dataIndex: "createdAt", width: 170, render: fmtDateTime },
          ]}
          locale={{ emptyText: "暂无命中记录" }}
        />
      </Panel>

      <Panel
        title="客户质检"
        titleExtra="四维各 25 分：资料完整 / 互动深度 / 风险合规 / 跟进及时；有模型走模型，无模型走规则"
      >
        <Form form={qcForm} layout="vertical">
          <Space wrap align="start" size={16}>
            <Form.Item name="contactId" label="选择客户" style={{ marginBottom: 0 }}>
              <Select
                allowClear
                showSearch
                style={{ width: 280 }}
                placeholder="输入姓名搜索客户"
                filterOption={false}
                onSearch={(value) => {
                  setContactKeyword(value);
                  void searchContacts(value);
                }}
                onOpenChange={(open) => {
                  if (open && !contacts.length) void searchContacts(contactKeyword);
                }}
                options={contacts.map((row) => ({
                  value: row.id,
                  label: row.name || row.remark || row.externalUserId,
                }))}
              />
            </Form.Item>
            <Button
              type="primary"
              loading={qcLoading}
              onClick={() => void runQc()}
              style={{ marginTop: 4 }}
            >
              开始质检
            </Button>
          </Space>
          <Form.Item
            name="text"
            label="补充会话或跟进内容"
            tooltip="不选客户时也可直接粘贴一段会话做质检"
            style={{ marginTop: 12, marginBottom: 0 }}
          >
            <Input.TextArea rows={4} maxLength={20000} showCount placeholder="粘贴最近的关键对话或跟进记录" />
          </Form.Item>
        </Form>
        <Notice variant="info">
          质检样本 = 客户时间线 + 你粘贴的内容。企微官方会话存档需单独部署，本期未接入，因此结论不等同全量合规审计。
        </Notice>
        {qcResult ? (
          <div style={{ marginTop: 16 }}>
            <Space align="center" size={16} wrap>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {qcResult.score} 分
              </Typography.Title>
              <Tag>{qcResult.source === "LLM" ? "模型质检" : "规则质检"}</Tag>
            </Space>
            <div style={{ marginTop: 12 }}>
              {qcResult.dimensions.map((dimension) => (
                <div key={dimension.key} style={{ marginBottom: 8 }}>
                  <Typography.Text>
                    {dimension.label} {dimension.score} / 25
                  </Typography.Text>
                  <Progress
                    percent={Math.round((dimension.score / 25) * 100)}
                    size="small"
                    showInfo={false}
                  />
                </div>
              ))}
            </div>
            {qcResult.highlights.length ? (
              <Notice variant="success">
                亮点：{qcResult.highlights.join("；")}
              </Notice>
            ) : null}
            {qcResult.suggestions.length ? (
              <Notice variant="info">
                建议：{qcResult.suggestions.join("；")}
              </Notice>
            ) : null}
          </div>
        ) : null}
      </Panel>

      <WordModal
        open={wordOpen}
        row={editing}
        onClose={() => setWordOpen(false)}
        onSaved={() => {
          setWordOpen(false);
          void reloadWords();
        }}
      />
    </Space>
  );
}

function WordModal({
  open,
  row,
  onClose,
  onSaved,
}: {
  open: boolean;
  row: ScrmSensitiveWord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const action = Form.useWatch("action", form);
  const direction = Form.useWatch("direction", form);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(
      row
        ? {
            group: row.group,
            word: row.word,
            action: row.action,
            direction: row.direction,
            replacement: row.replacement,
            enabled: row.enabled,
          }
        : {
            group: "",
            word: "",
            action: "BLOCK",
            direction: "OUTBOUND",
            replacement: "",
            enabled: true,
          },
    );
  }, [open, row, form]);

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await scrmApi.saveSensitiveWord({
        body: {
          id: row?.id ?? 0,
          group: values.group ?? "",
          word: values.word,
          // 入站与群聊固定只告警，避免表单里残留的拦截动作造成误解
          action: values.direction === "OUTBOUND" ? values.action : "ALERT",
          direction: values.direction,
          replacement: values.replacement ?? "",
          enabled: values.enabled,
        },
      });
      message.success("敏感词已保存");
      onSaved();
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={row ? "编辑敏感词" : "新增敏感词"}
      open={open}
      confirmLoading={saving}
      okText="保存"
      onOk={() => void submit()}
      onCancel={onClose}
      width={520}
    >
      <Form form={form} layout="vertical">
        <div className="form-2col">
          <Form.Item name="word" label="敏感词" rules={[{ required: true, message: "请填写敏感词" }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="group" label="分组" tooltip="按业务归类，便于批量筛查">
            <Input maxLength={40} placeholder="如 承诺用语 / 竞品名称" />
          </Form.Item>
          <Form.Item name="direction" label="生效方向" rules={[{ required: true }]}>
            <Select options={DIRECTION_OPTIONS} />
          </Form.Item>
          <Form.Item name="action" label="命中动作" rules={[{ required: true }]}>
            <Select options={ACTION_OPTIONS} disabled={direction !== "OUTBOUND"} />
          </Form.Item>
        </div>
        {direction !== "OUTBOUND" ? (
          <Notice variant="info">入站与群聊只告警留痕，命中动作固定为「只告警」。</Notice>
        ) : null}
        {action === "REPLACE" ? (
          <Form.Item
            name="replacement"
            label="替换为"
            rules={[{ required: true, message: "替换动作必须填写替换后的文本" }]}
          >
            <Input maxLength={100} placeholder="如 我们将" />
          </Form.Item>
        ) : null}
        <Form.Item name="enabled" label="启用" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
