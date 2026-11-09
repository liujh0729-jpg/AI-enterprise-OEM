"use client";

import {
  EditOutlined,
  EyeOutlined,
  FileTextOutlined,
  HistoryOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Collapse,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { Notice, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import {
  acqApi,
  playbookStatusLabel,
  type AcqMeta,
  type AcqPlaybook,
  type AcqPlaybookVersion,
} from "./acquisition-common";
import {
  ACQ_PLAYBOOK_STATUSES,
  type EndpointInput,
} from "@enterprise/contracts";

/**
 * 销售剧本：人设、边界、转人工、开场白、异议处理与知识绑定。
 * 发布时落版本快照，接待/触达按当前发布版本拼提示词；预览不发送任何消息。
 */

const STATUS_OPTIONS = ["DRAFT", "PUBLISHED", "ARCHIVED"].map((value) => ({
  value,
  label: playbookStatusLabel(value),
}));
const STATUS_COLOR: Record<string, string> = {
  DRAFT: "default",
  PUBLISHED: "success",
  ARCHIVED: "warning",
};

const BOUNDARY_FIELDS: { name: string; label: string; hint: string }[] = [
  { name: "noPricePromise", label: "不承诺价格", hint: "禁止给出未经批准的价格、折扣或最低价" },
  { name: "noTimelinePromise", label: "不承诺时间", hint: "禁止承诺交付/上线/回复的具体时间" },
  { name: "noCompensationPromise", label: "不承诺补偿", hint: "禁止承诺退款、赔偿、赠送等补偿" },
  { name: "noCustomPromise", label: "不承诺定制", hint: "禁止承诺定制开发、专属功能" },
  { name: "noFabricatedCases", label: "不编造案例", hint: "禁止编造客户案例、数据或资质" },
];

type PlaybookStatus = NonNullable<
  EndpointInput<"Acquisition_savePlaybook">["body"]["status"]
>;

type PlaybookFormValues = {
  name: string;
  goal: string;
  status: PlaybookStatus;
  persona: {
    alias: string;
    personality: string;
    canDo: string[];
    cannotDo: string[];
    tone: string;
    format: string;
    maxLinks: number;
  };
  boundaries: {
    noPricePromise: boolean;
    noTimelinePromise: boolean;
    noCompensationPromise: boolean;
    noCustomPromise: boolean;
    noFabricatedCases: boolean;
    extra: string[];
  };
  escalation: { triggers: string[]; handoffText: string; agentUserIds: string[] };
  openers: { scene: string; text: string }[];
  objections: {
    topic: string;
    acknowledge: string;
    conclusion: string;
    evidence: string;
    nextStep: string;
  }[];
  kbIds: number[];
  faqIds: number[];
};

const EMPTY_PLAYBOOK: PlaybookFormValues = {
  name: "",
  goal: "",
  status: "DRAFT",
  persona: {
    alias: "",
    personality: "",
    canDo: [],
    cannotDo: [],
    tone: "",
    format: "",
    maxLinks: 1,
  },
  boundaries: {
    noPricePromise: true,
    noTimelinePromise: true,
    noCompensationPromise: true,
    noCustomPromise: true,
    noFabricatedCases: true,
    extra: [],
  },
  escalation: {
    triggers: ["退款", "投诉", "合同条款"],
    handoffText: "这个问题我帮您转接人工同事确认。",
    agentUserIds: [],
  },
  openers: [],
  objections: [],
  kbIds: [],
  faqIds: [],
};

export function AcquisitionPlaybooksView({
  meta,
  onChanged,
}: {
  meta: AcqMeta | null;
  onChanged?: () => void;
}) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<AcqPlaybook[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("");
  const [keyword, setKeyword] = useState("");

  const [editing, setEditing] = useState<AcqPlaybook | 0 | null>(null);
  const [form] = Form.useForm<PlaybookFormValues>();
  const [saving, setSaving] = useState(false);

  const [versionsTarget, setVersionsTarget] = useState<AcqPlaybook | null>(null);
  const [versions, setVersions] = useState<AcqPlaybookVersion[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null);

  const [previewTarget, setPreviewTarget] = useState<AcqPlaybook | null>(null);
  const [previewMessage, setPreviewMessage] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<{
    reply: string;
    mode: string;
    version: number;
    prompt: string;
    sections: { name: string; text: string }[];
  } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await acqApi.playbooks({
        query: {
          page,
          pageSize,
          ...(filterStatus ? { status: filterStatus } : {}),
          ...(keyword.trim() ? { q: keyword.trim() } : {}),
        },
      });
      setRows(result?.list ?? []);
      setTotal(result?.total ?? 0);
    } catch (error) {
      message.error((error as Error).message || "销售剧本读取失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filterStatus, keyword, message]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openEditor = (row: AcqPlaybook | null) => {
    setEditing(row ?? 0);
    if (row) {
      form.setFieldsValue({
        name: row.name,
        goal: row.goal,
        status: ACQ_PLAYBOOK_STATUSES.find((v) => v === row.status) ?? "DRAFT",
        persona: row.persona,
        boundaries: row.boundaries,
        escalation: row.escalation,
        openers: row.openers,
        objections: row.objections,
        kbIds: row.kbIds,
        faqIds: row.faqIds,
      });
    } else {
      form.resetFields();
      form.setFieldsValue(EMPTY_PLAYBOOK);
    }
  };

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await acqApi.savePlaybook({
        body: {
          ...(typeof editing === "number" && editing > 0 ? { id: editing } : {}),
          name: values.name,
          goal: values.goal ?? "",
          persona: values.persona ?? EMPTY_PLAYBOOK.persona,
          boundaries: values.boundaries ?? EMPTY_PLAYBOOK.boundaries,
          escalation: values.escalation ?? EMPTY_PLAYBOOK.escalation,
          openers: values.openers ?? [],
          objections: values.objections ?? [],
          kbIds: values.kbIds ?? [],
          faqIds: values.faqIds ?? [],
          status: values.status || "DRAFT",
        },
      });
      message.success(editing ? "销售剧本已更新" : "销售剧本已创建");
      setEditing(null);
      void reload();
      onChanged?.();
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const publish = async (row: AcqPlaybook) => {
    try {
      await acqApi.publishPlaybook({ params: { id: row.id }, body: {} });
      message.success(`已发布 v${row.currentVersion + 1}：接待与触达立即按新版本执行`);
      void reload();
      onChanged?.();
    } catch (error) {
      message.error((error as Error).message || "发布失败");
    }
  };

  const openVersions = async (row: AcqPlaybook) => {
    setVersionsTarget(row);
    setVersionsOpen(true);
    try {
      const result = await acqApi.playbookVersions({
        params: { id: row.id },
        query: { page: 1, pageSize: 50 },
      });
      setVersions(result?.list ?? []);
    } catch (error) {
      message.error((error as Error).message || "版本历史读取失败");
    }
  };

  const openPreview = (row: AcqPlaybook) => {
    setPreviewTarget(row);
    setPreviewMessage("");
    setPreviewResult(null);
  };

  const runPreview = async () => {
    if (!previewTarget) return;
    setPreviewing(true);
    try {
      const result = await acqApi.playbookPreview({
        params: { id: previewTarget.id },
        body: { customerMessage: previewMessage.trim() },
      });
      setPreviewResult(result);
    } catch (error) {
      message.error((error as Error).message || "预览失败");
    } finally {
      setPreviewing(false);
    }
  };

  const columns = [
    {
      title: "剧本",
      dataIndex: "name",
      render: (value: string, row: AcqPlaybook) => (
        <Space orientation="vertical" size={0}>
          <span>{value}</span>
          <span className="text-12 muted">{row.goal || "未填写目标"}</span>
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (value: string) => (
        <Tag color={STATUS_COLOR[value] || "default"}>{playbookStatusLabel(value)}</Tag>
      ),
    },
    {
      title: "版本",
      dataIndex: "currentVersion",
      width: 70,
      render: (value: number) => `v${value}`,
    },
    {
      title: "内容",
      width: 180,
      render: (_: unknown, row: AcqPlaybook) => (
        <span className="text-12">
          开场 {row.openers.length} · 异议 {row.objections.length} · 知识 {row.kbIds.length} · FAQ{" "}
          {row.faqIds.length}
        </span>
      ),
    },
    {
      title: "更新",
      dataIndex: "updatedAt",
      width: 160,
      render: (value: string) => fmtTime(value),
    },
    {
      title: "操作",
      width: 330,
      render: (_: unknown, row: AcqPlaybook) => (
        <Space size={4} wrap>
          <Button size="small" icon={<EditOutlined aria-hidden />} onClick={() => openEditor(row)}>
            编辑
          </Button>
          <Popconfirm
            title={`发布 v${row.currentVersion + 1}？`}
            description="发布后接待与触达立即按新版本执行；旧版本会保留快照。"
            onConfirm={() => void publish(row)}
          >
            <Button size="small" icon={<RocketOutlined aria-hidden />}>
              发布
            </Button>
          </Popconfirm>
          <Button size="small" icon={<HistoryOutlined aria-hidden />} onClick={() => void openVersions(row)}>
            版本
          </Button>
          <Button size="small" icon={<EyeOutlined aria-hidden />} onClick={() => openPreview(row)}>
            预览
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Panel
        title="销售剧本"
        titleExtra="人设 / 边界 / 转人工 / 开场白 / 异议处理 / 知识绑定；发布生成版本快照"
        extra={
          <Space wrap>
            <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void reload()} loading={loading}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined aria-hidden />} onClick={() => openEditor(null)}>
              新建剧本
            </Button>
          </Space>
        }
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 130 }}
            value={filterStatus || undefined}
            options={STATUS_OPTIONS}
            onChange={(value) => {
              setPage(1);
              setFilterStatus(value ?? "");
            }}
          />
          <Input.Search
            allowClear
            placeholder="按名称 / 目标搜索"
            style={{ width: 240 }}
            onSearch={(value) => {
              setPage(1);
              setKeyword(value);
            }}
          />
        </Space>
        <Table<AcqPlaybook>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          columns={columns}
          scroll={{ x: 980 }}
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
          locale={{ emptyText: "还没有销售剧本：新建后先保存为草稿，确认再发布" }}
        />
      </Panel>

      <Drawer
        title={typeof editing === "object" && editing !== null ? "编辑销售剧本" : "新建销售剧本"}
        open={editing !== null}
        size={760}
        onClose={() => setEditing(null)}
        extra={
          <Space>
            <Button onClick={() => setEditing(null)}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void save()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" initialValues={EMPTY_PLAYBOOK}>
          <div className="form-2col">
            <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写剧本名称" }]}>
              <Input maxLength={80} placeholder="如：小红书装修线索私信剧本" />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select options={STATUS_OPTIONS} />
            </Form.Item>
          </div>
          <Form.Item name="goal" label="目标">
            <Input maxLength={120} placeholder="如：把咨询者推进到留电话/加企微" />
          </Form.Item>

          <Panel title="人设">
            <div className="form-2col">
              <Form.Item name={["persona", "alias"]} label="称呼">
                <Input maxLength={60} placeholder="如：小北顾问" />
              </Form.Item>
              <Form.Item name={["persona", "tone"]} label="语气">
                <Input maxLength={200} placeholder="如：专业、克制、像真人" />
              </Form.Item>
              <Form.Item name={["persona", "format"]} label="格式">
                <Input maxLength={200} placeholder="如：短句，不超过 3 行" />
              </Form.Item>
              <Form.Item name={["persona", "maxLinks"]} label="最多链接数">
                <InputNumber min={0} max={5} style={{ width: "100%" }} />
              </Form.Item>
            </div>
            <Form.Item name={["persona", "personality"]} label="性格描述">
              <Input.TextArea rows={2} maxLength={500} />
            </Form.Item>
            <Form.Item name={["persona", "canDo"]} label="可以做">
              <Select mode="tags" placeholder="输入后回车" />
            </Form.Item>
            <Form.Item name={["persona", "cannotDo"]} label="不可以做">
              <Select mode="tags" placeholder="输入后回车" />
            </Form.Item>
          </Panel>

          <Panel title="边界（硬约束）">
            <div className="form-2col">
              {BOUNDARY_FIELDS.map((field) => (
                <Form.Item
                  key={field.name}
                  name={["boundaries", field.name]}
                  label={field.label}
                  valuePropName="checked"
                  tooltip={field.hint}
                >
                  <Switch />
                </Form.Item>
              ))}
            </div>
            <Form.Item name={["boundaries", "extra"]} label="额外禁止事项">
              <Select mode="tags" placeholder="输入后回车" />
            </Form.Item>
          </Panel>

          <Panel title="转人工">
            <Form.Item name={["escalation", "triggers"]} label="触发词">
              <Select mode="tags" placeholder="输入后回车" />
            </Form.Item>
            <Form.Item name={["escalation", "handoffText"]} label="转接话术">
              <Input maxLength={300} />
            </Form.Item>
            <Form.Item name={["escalation", "agentUserIds"]} label="转接坐席用户 ID">
              <Select mode="tags" placeholder="输入后回车；留空走服务台分组" />
            </Form.Item>
          </Panel>

          <Panel title="开场白">
            <Form.List name="openers">
              {(fields, { add, remove }) => (
                <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                  {fields.map((field) => (
                    <Space key={field.key} align="start" style={{ width: "100%" }}>
                      <Form.Item name={[field.name, "scene"]} style={{ margin: 0, width: 160 }}>
                        <Input placeholder="场景" maxLength={60} />
                      </Form.Item>
                      <Form.Item name={[field.name, "text"]} style={{ margin: 0, flex: 1 }}>
                        <Input placeholder="开场白" maxLength={500} />
                      </Form.Item>
                      <Button danger onClick={() => remove(field.name)}>
                        删除
                      </Button>
                    </Space>
                  ))}
                  <Button type="dashed" onClick={() => add({ scene: "", text: "" })}>
                    添加开场白
                  </Button>
                </Space>
              )}
            </Form.List>
          </Panel>

          <Panel title="异议处理">
            <Form.List name="objections">
              {(fields, { add, remove }) => (
                <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                  {fields.map((field) => (
                    <div key={field.key} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
                      <div className="form-2col">
                        <Form.Item name={[field.name, "topic"]} label="异议主题">
                          <Input maxLength={60} placeholder="如：价格太贵" />
                        </Form.Item>
                        <Form.Item name={[field.name, "acknowledge"]} label="共情/认可">
                          <Input maxLength={300} />
                        </Form.Item>
                        <Form.Item name={[field.name, "conclusion"]} label="结论">
                          <Input maxLength={300} />
                        </Form.Item>
                        <Form.Item name={[field.name, "evidence"]} label="证据">
                          <Input maxLength={300} />
                        </Form.Item>
                      </div>
                      <Form.Item name={[field.name, "nextStep"]} label="下一步">
                        <Input maxLength={300} />
                      </Form.Item>
                      <Button danger onClick={() => remove(field.name)}>
                        删除这条异议
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="dashed"
                    onClick={() =>
                      add({
                        topic: "",
                        acknowledge: "",
                        conclusion: "",
                        evidence: "",
                        nextStep: "",
                      })
                    }
                  >
                    添加异议
                  </Button>
                </Space>
              )}
            </Form.List>
          </Panel>

          <Panel title="知识绑定">
            <Form.Item name="kbIds" label="知识库文档">
              <Select
                mode="multiple"
                placeholder="选择接待要引用的知识库文档"
                options={(meta?.kbOptions ?? []).map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
              />
            </Form.Item>
            <Form.Item name="faqIds" label="服务台 FAQ">
              <Select
                mode="multiple"
                placeholder="选择常用问答"
                options={(meta?.faqOptions ?? []).map((item) => ({
                  value: item.id,
                  label: item.question,
                }))}
              />
            </Form.Item>
          </Panel>
        </Form>
      </Drawer>

      <Drawer
        title={versionsTarget ? `版本历史 · ${versionsTarget.name}` : "版本历史"}
        open={versionsOpen}
        size={620}
        onClose={() => setVersionsOpen(false)}
      >
        <Table<AcqPlaybookVersion>
          rowKey="id"
          size="small"
          dataSource={versions}
          pagination={false}
          columns={[
            { title: "版本", dataIndex: "version", width: 80, render: (value: number) => `v${value}` },
            {
              title: "发布时间",
              dataIndex: "publishedAt",
              width: 170,
              render: (value: string) => (value ? fmtTime(value) : "-"),
            },
            { title: "发布人", dataIndex: "createdBy", width: 120 },
            {
              title: "快照",
              render: (_: unknown, row) => (
                <Button size="small" icon={<FileTextOutlined aria-hidden />} onClick={() => setSnapshot(row.snapshot)}>
                  查看
                </Button>
              ),
            },
          ]}
          locale={{ emptyText: "还没有发布版本" }}
        />
      </Drawer>

      <Modal
        title="版本快照"
        open={!!snapshot}
        width={720}
        footer={null}
        onCancel={() => setSnapshot(null)}
      >
        <pre
          className="mono text-12"
          style={{ maxHeight: 480, overflow: "auto", whiteSpace: "pre-wrap" }}
        >
          {snapshot ? JSON.stringify(snapshot, null, 2) : ""}
        </pre>
      </Modal>

      <Modal
        title={previewTarget ? `预览 · ${previewTarget.name}` : "预览"}
        open={!!previewTarget}
        width={760}
        confirmLoading={previewing}
        okText="生成预览"
        onOk={() => void runPreview()}
        onCancel={() => setPreviewTarget(null)}
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Notice variant="info">
            预览只拼提示词并生成一条回复，不发送、不扣触达额度；用于检查人设、边界与知识引用。
          </Notice>
          <Input.TextArea
            rows={3}
            value={previewMessage}
            onChange={(event) => setPreviewMessage(event.target.value)}
            placeholder="模拟客户说一句话，如：你们这个多少钱？能不能便宜点？"
            maxLength={2000}
          />
          {previewResult ? (
            <>
              <Descriptions
                size="small"
                column={2}
                items={[
                  {
                    key: "mode",
                    label: "生成方式",
                    children: previewResult.mode === "llm" ? "AI" : "规则降级",
                  },
                  { key: "version", label: "版本", children: `v${previewResult.version}` },
                ]}
              />
              <Panel title="回复">
                <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
                  {previewResult.reply || "（空）"}
                </Typography.Paragraph>
              </Panel>
              <Collapse
                items={[
                  {
                    key: "sections",
                    label: "提示词分段",
                    children: (
                      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                        {previewResult.sections.map((section) => (
                          <div key={section.name}>
                            <strong>{section.name}</strong>
                            <div className="text-12" style={{ whiteSpace: "pre-wrap" }}>
                              {section.text}
                            </div>
                          </div>
                        ))}
                      </Space>
                    ),
                  },
                  {
                    key: "prompt",
                    label: "完整提示词",
                    children: (
                      <pre className="mono text-12" style={{ whiteSpace: "pre-wrap" }}>
                        {previewResult.prompt}
                      </pre>
                    ),
                  },
                ]}
              />
            </>
          ) : null}
        </Space>
      </Modal>
    </Space>
  );
}
