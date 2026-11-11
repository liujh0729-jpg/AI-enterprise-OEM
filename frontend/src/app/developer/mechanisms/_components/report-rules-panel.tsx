"use client";

import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import {
  RULE_OPERATORS,
  WEBHOOK_EVENTS,
} from "@enterprise/contracts";
import { mechanismsApi } from "@/api/mechanisms";
import { Notice, Panel, PillTabs } from "@/components/ui/panel";
import { fmtDateTime } from "@/lib/datetime";
import {
  RULE_ACTION_LABELS,
  RULE_OPERATOR_LABELS,
  eventLabel,
  mechError,
  type ReportCatalog,
  type Rule,
} from "./mechanisms-common";

const RULE_EVENT_OPTIONS = WEBHOOK_EVENTS.map((event) => ({
  value: event,
  label: eventLabel(event),
}));

function conditionText(rule: Rule) {
  return rule.conditions
    .map((item) => `${item.field} ${RULE_OPERATOR_LABELS[item.op] || item.op} ${
      Array.isArray(item.value) ? item.value.join("/") : String(item.value)
    }`)
    .join("；");
}

function actionText(rule: Rule) {
  if (!rule.actions.length) return "—";
  return rule.actions
    .map((item) => `${RULE_ACTION_LABELS[item.type] || item.type}${item.target ? ` → ${item.target}` : ""}`)
    .join("；");
}

/** 条件输入框的文本转成契约值：数字按数字、true/false 按布尔、in 按逗号数组。 */
function parseConditionValue(op: string, raw: string) {
  if (op === "in") {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw.trim() !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

export function ReportRulesPanel() {
  const { message } = App.useApp();
  const [tab, setTab] = useState("reports");

  const [reports, setReports] = useState<ReportCatalog[]>([]);
  const [reportForm] = Form.useForm();
  const [reportOpen, setReportOpen] = useState(false);
  const [reportEditing, setReportEditing] = useState<ReportCatalog | null>(null);

  const [rules, setRules] = useState<Rule[]>([]);
  const [ruleForm] = Form.useForm();
  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleEditing, setRuleEditing] = useState<Rule | null>(null);
  const [testForm] = Form.useForm();
  const [testRuleRow, setTestRuleRow] = useState<Rule | null>(null);
  const [testResult, setTestResult] = useState<{
    matched: boolean;
    details: { field: string; op: string; actual: string; pass: boolean }[];
  } | null>(null);

  const loadReports = useCallback(async () => {
    setReports((await mechanismsApi.reports({ query: {} })) || []);
  }, []);

  const loadRules = useCallback(async () => {
    const data = await mechanismsApi.rules({ query: { page: 1, pageSize: 50 } });
    setRules(data?.list || []);
  }, []);

  useEffect(() => {
    void loadReports().catch((err) => message.error(mechError(err)));
    void loadRules().catch((err) => message.error(mechError(err)));
  }, [loadReports, loadRules, message]);

  // ---------- 报表目录 ----------
  const openReport = (row: ReportCatalog | null) => {
    setReportEditing(row);
    reportForm.setFieldsValue(
      row
        ? {
            code: row.code,
            name: row.name,
            module: row.module,
            description: row.description,
            path: row.path,
            icon: row.icon,
            showInMenu: row.showInMenu,
            sortOrder: row.sortOrder,
            enabled: row.enabled,
            planCode: row.planCode,
          }
        : {
            code: "",
            name: "",
            module: "",
            description: "",
            path: "",
            icon: "chart",
            showInMenu: true,
            sortOrder: 0,
            enabled: true,
            planCode: "",
          },
    );
    setReportOpen(true);
  };

  const submitReport = async () => {
    const values = await reportForm.validateFields();
    try {
      await mechanismsApi.saveReport({
        body: { ...(reportEditing ? { id: reportEditing.id } : {}), ...values },
      });
      message.success("报表目录已保存");
      setReportOpen(false);
      await loadReports();
    } catch (err) {
      message.error(mechError(err));
    }
  };

  const removeReport = async (row: ReportCatalog) => {
    try {
      await mechanismsApi.removeReport({ body: { id: row.id } });
      message.success("已删除");
      await loadReports();
    } catch (err) {
      message.error(mechError(err));
    }
  };

  // ---------- 规则引擎 ----------
  const openRule = (row: Rule | null) => {
    setRuleEditing(row);
    ruleForm.setFieldsValue(
      row
        ? {
            code: row.code,
            name: row.name,
            description: row.description,
            event: row.event,
            enabled: row.enabled,
            conditions: row.conditions.map((item) => ({
              field: item.field,
              op: item.op,
              value: Array.isArray(item.value) ? item.value.join(",") : String(item.value),
            })),
            actions: row.actions.map((item) => ({ type: item.type, target: item.target })),
          }
        : {
            code: "",
            name: "",
            description: "",
            event: "task.created",
            enabled: true,
            conditions: [{ field: "", op: "eq", value: "" }],
            actions: [],
          },
    );
    setRuleOpen(true);
  };

  const submitRule = async () => {
    const values = await ruleForm.validateFields();
    try {
      await mechanismsApi.saveRule({
        body: {
          ...(ruleEditing ? { id: ruleEditing.id } : {}),
          code: values.code,
          name: values.name,
          description: values.description || "",
          event: values.event,
          enabled: Boolean(values.enabled),
          conditions: (values.conditions || []).map((item: { field: string; op: string; value: string }) => ({
            field: item.field,
            op: item.op,
            value: parseConditionValue(item.op, String(item.value ?? "")),
          })),
          actions: (values.actions || []).map((item: { type: string; target?: string }) => ({
            type: item.type,
            target: item.target || "",
            payload: {},
          })),
        },
      });
      message.success("规则已保存");
      setRuleOpen(false);
      await loadRules();
    } catch (err) {
      message.error(mechError(err));
    }
  };

  const removeRule = async (row: Rule) => {
    try {
      await mechanismsApi.removeRule({ body: { id: row.id } });
      message.success("已删除");
      await loadRules();
    } catch (err) {
      message.error(mechError(err));
    }
  };

  const openTest = (row: Rule) => {
    setTestRuleRow(row);
    setTestResult(null);
    testForm.setFieldsValue({ context: '{\n  "status": "DONE",\n  "amount": 100\n}' });
  };

  const submitTest = async () => {
    if (!testRuleRow) return;
    try {
      const values = await testForm.validateFields();
      const context = JSON.parse(values.context || "{}") as Record<string, unknown>;
      const result = await mechanismsApi.testRule({
        body: { conditions: testRuleRow.conditions, context },
      });
      setTestResult(result);
    } catch (err) {
      message.error(err instanceof SyntaxError ? "上下文不是合法 JSON" : mechError(err));
    }
  };

  const reportColumns: ColumnsType<ReportCatalog> = [
    {
      title: "报表",
      dataIndex: "name",
      render: (_value, row) => (
        <div>
          <div>{row.name}</div>
          <div className="muted text-12">{row.code} · {row.module}</div>
        </div>
      ),
    },
    { title: "路径", dataIndex: "path", render: (value: string) => value || "—" },
    {
      title: "菜单",
      dataIndex: "showInMenu",
      width: 90,
      render: (value: boolean) => (value ? <Tag color="blue">展示</Tag> : <Tag>隐藏</Tag>),
    },
    {
      title: "状态",
      dataIndex: "enabled",
      width: 90,
      render: (value: boolean) => (value ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    { title: "套餐", dataIndex: "planCode", width: 100, render: (value: string) => value || "全部" },
    { title: "排序", dataIndex: "sortOrder", width: 70 },
    {
      title: "操作",
      width: 140,
      render: (_value, row) => (
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="small" onClick={() => openReport(row)}>编辑</Button>
          <Button size="small" danger icon={<DeleteOutlined aria-hidden />} onClick={() => void removeReport(row)} />
        </div>
      ),
    },
  ];

  const ruleColumns: ColumnsType<Rule> = [
    {
      title: "规则",
      dataIndex: "name",
      render: (_value, row) => (
        <div>
          <div>{row.name}</div>
          <div className="muted text-12">{row.code} · {eventLabel(row.event)}</div>
        </div>
      ),
    },
    { title: "条件", dataIndex: "conditions", render: (_value, row) => conditionText(row) },
    { title: "动作", dataIndex: "actions", render: (_value, row) => actionText(row) },
    {
      title: "状态",
      dataIndex: "enabled",
      width: 90,
      render: (value: boolean) => (value ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    {
      title: "最近触发",
      dataIndex: "lastTriggeredAt",
      width: 160,
      render: (value: string) => (value ? fmtDateTime(value) : "尚未触发"),
    },
    {
      title: "操作",
      width: 200,
      render: (_value, row) => (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Button size="small" onClick={() => openRule(row)}>编辑</Button>
          <Button size="small" onClick={() => openTest(row)}>测试</Button>
          <Button size="small" danger icon={<DeleteOutlined aria-hidden />} onClick={() => void removeRule(row)} />
        </div>
      ),
    },
  ];

  return (
    <Panel
      title="报表目录与规则引擎"
      extra={
        <PillTabs
          items={[
            { key: "reports", label: "报表目录" },
            { key: "rules", label: "规则引擎" },
          ]}
          value={tab}
          onChange={setTab}
        />
      }
    >
      {tab === "reports" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <Button type="primary" icon={<PlusOutlined aria-hidden />} onClick={() => openReport(null)}>
              新建报表
            </Button>
            <span className="muted text-12">
              报表目录决定 BI 报表墙里展示哪些报表、是否进菜单、按套餐开放；平台管理员可维护。
            </span>
          </div>
          <Table rowKey="id" size="small" columns={reportColumns} dataSource={reports} pagination={false} locale={{ emptyText: "还没有报表目录" }} />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button type="primary" icon={<PlusOutlined aria-hidden />} onClick={() => openRule(null)}>
              新建规则
            </Button>
            <span className="muted text-12">
              事件到达时按条件匹配，命中后执行动作（调 Webhook / 发通知 / 记洞察 / 建任务）。
            </span>
          </div>
          <Table rowKey="id" size="small" columns={ruleColumns} dataSource={rules} pagination={false} locale={{ emptyText: "还没有规则" }} />
        </div>
      )}

      <Modal
        open={reportOpen}
        title={reportEditing ? "编辑报表" : "新建报表"}
        onCancel={() => setReportOpen(false)}
        onOk={() => void submitReport()}
        okText="保存"
      >
        <Form form={reportForm} layout="vertical">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item name="code" label="编码" rules={[{ required: true, message: "请填写编码" }]}>
              <Input placeholder="如 sales_funnel" />
            </Form.Item>
            <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写名称" }]}>
              <Input placeholder="如 销售漏斗" />
            </Form.Item>
            <Form.Item name="module" label="所属模块" rules={[{ required: true, message: "请填写模块" }]}>
              <Input placeholder="如 crm / erp / bi" />
            </Form.Item>
            <Form.Item name="path" label="跳转路径">
              <Input placeholder="如 /bi?report=sales_funnel" />
            </Form.Item>
            <Form.Item name="icon" label="图标">
              <Input placeholder="chart" />
            </Form.Item>
            <Form.Item name="sortOrder" label="排序">
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="planCode" label="套餐限制">
              <Input placeholder="留空表示全部套餐可见" />
            </Form.Item>
          </div>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} />
          </Form.Item>
          <div style={{ display: "flex", gap: 24 }}>
            <Form.Item name="showInMenu" label="进菜单" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        open={ruleOpen}
        title={ruleEditing ? "编辑规则" : "新建规则"}
        width={720}
        onCancel={() => setRuleOpen(false)}
        onOk={() => void submitRule()}
        okText="保存"
      >
        <Form form={ruleForm} layout="vertical">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item name="code" label="编码" rules={[{ required: true, message: "请填写编码" }]}>
              <Input placeholder="如 low_stock_alert" />
            </Form.Item>
            <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写名称" }]}>
              <Input placeholder="如 库存低于阈值提醒" />
            </Form.Item>
          </div>
          <Form.Item name="event" label="触发事件" rules={[{ required: true, message: "请选择事件" }]}>
            <Select options={RULE_EVENT_OPTIONS} />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>

          <strong>条件（全部满足）</strong>
          <Form.List name="conditions">
            {(fields, { add, remove }) => (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {fields.map((field) => (
                  <div key={field.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Form.Item name={[field.name, "field"]} rules={[{ required: true, message: "字段" }]} style={{ margin: 0, flex: 1 }}>
                      <Input placeholder="字段，如 amount" />
                    </Form.Item>
                    <Form.Item name={[field.name, "op"]} style={{ margin: 0, width: 120 }}>
                      <Select
                        options={RULE_OPERATORS.map((op) => ({
                          value: op,
                          label: RULE_OPERATOR_LABELS[op] || op,
                        }))}
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, "value"]} style={{ margin: 0, flex: 1 }}>
                      <Input placeholder="值（in 用逗号分隔）" />
                    </Form.Item>
                    <Button size="small" danger icon={<DeleteOutlined aria-hidden />} onClick={() => remove(field.name)} />
                  </div>
                ))}
                <Button size="small" icon={<PlusOutlined aria-hidden />} onClick={() => add({ field: "", op: "eq", value: "" })}>
                  添加条件
                </Button>
              </div>
            )}
          </Form.List>

          <strong style={{ display: "block", marginTop: 16 }}>动作</strong>
          <Form.List name="actions">
            {(fields, { add, remove }) => (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {fields.map((field) => (
                  <div key={field.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Form.Item name={[field.name, "type"]} style={{ margin: 0, width: 140 }}>
                      <Select
                        options={Object.entries(RULE_ACTION_LABELS).map(([value, label]) => ({
                          value,
                          label,
                        }))}
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, "target"]} style={{ margin: 0, flex: 1 }}>
                      <Input placeholder="目标（Webhook / 接收人 / 工作流编号或业务标识 / 承办人，组织队列填 ORG:账号）" />
                    </Form.Item>
                    <Button size="small" danger icon={<DeleteOutlined aria-hidden />} onClick={() => remove(field.name)} />
                  </div>
                ))}
                <Button size="small" icon={<PlusOutlined aria-hidden />} onClick={() => add({ type: "notify", target: "" })}>
                  添加动作
                </Button>
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Modal
        open={Boolean(testRuleRow)}
        title={`测试规则 · ${testRuleRow?.name || ""}`}
        width={640}
        onCancel={() => setTestRuleRow(null)}
        footer={[
          <Button key="close" onClick={() => setTestRuleRow(null)}>关闭</Button>,
          <Button key="run" type="primary" onClick={() => void submitTest()}>运行测试</Button>,
        ]}
      >
        <Form form={testForm} layout="vertical">
          <Form.Item name="context" label="事件上下文（JSON）">
            <Input.TextArea rows={6} />
          </Form.Item>
        </Form>
        {testResult ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Notice variant={testResult.matched ? "success" : "warn"}>
              {testResult.matched ? "条件命中：规则会执行动作" : "条件未命中"}
            </Notice>
            {testResult.details.map((item, index) => (
              <div key={`${item.field}-${index}`} style={{ display: "flex", gap: 8 }}>
                <Tag color={item.pass ? "green" : "red"}>{item.pass ? "通过" : "不通过"}</Tag>
                <span className="text-12">
                  {item.field} {RULE_OPERATOR_LABELS[item.op] || item.op}（实际值：{item.actual}）
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </Modal>
    </Panel>
  );
}
