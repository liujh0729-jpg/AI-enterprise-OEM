"use client";

import {
  Button,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import {
  PJ_COST_KINDS,
  PJ_COST_KIND_LABELS,
  PJ_COST_SOURCE_LABELS,
  pjCostItemSchema,
  pjCostRateSchema,
  pjCostSummarySchema,
  z,
} from "@enterprise/contracts";
import { projectApi } from "@/api/project";
import { partyApi } from "@/api/party";
import { Notice, Panel, PillTabs, StatCard, StatGrid } from "@/components/ui/panel";
import {
  Toolbar,
  day,
  money,
  pjError,
  type PjProject,
} from "./project-common";

type PjCostItem = z.infer<typeof pjCostItemSchema>;
type PjCostRate = z.infer<typeof pjCostRateSchema>;
type PjCostSummary = z.infer<typeof pjCostSummarySchema>;

const KIND_OPTIONS = PJ_COST_KINDS.map((value) => ({
  value,
  label: PJ_COST_KIND_LABELS[value],
}));

const PRINCIPAL_OPTIONS = [
  { value: "STAFF", label: "内部员工" },
  { value: "ASSIGNMENT", label: "任务承接" },
  { value: "PARTY", label: "外部合作方" },
];

const KIND_PILLS = KIND_OPTIONS.map((item) => ({ key: item.value, label: item.label }));
const PRINCIPAL_PILLS = PRINCIPAL_OPTIONS.map((item) => ({ key: item.value, label: item.label }));

export function PjCostTab({ staff }: { staff: { value: string; label: string }[] }) {
  const [projects, setProjects] = useState<PjProject[]>([]);
  const [projectId, setProjectId] = useState(0);
  const [summary, setSummary] = useState<PjCostSummary | null>(null);
  const [items, setItems] = useState<PjCostItem[]>([]);
  const [itemTotal, setItemTotal] = useState(0);
  const [itemPage, setItemPage] = useState(1);
  const [kind, setKind] = useState("");
  const [rates, setRates] = useState<PjCostRate[]>([]);
  const [rateTotal, setRateTotal] = useState(0);
  const [ratePage, setRatePage] = useState(1);
  const [rateQ, setRateQ] = useState("");
  const [principalType, setPrincipalType] = useState("");
  const [parties, setParties] = useState<{ value: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [itemEditing, setItemEditing] = useState<Record<string, unknown> | null>(null);
  const [itemForm] = Form.useForm();
  const [rateEditing, setRateEditing] = useState<Record<string, unknown> | null>(null);
  const [rateForm] = Form.useForm();
  const [ratePrincipalType, setRatePrincipalType] = useState("STAFF");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void projectApi
      .projects({ query: { page: 1, pageSize: 100 } })
      .then((data) => {
        const rows = data?.list || [];
        setProjects(rows);
        if (rows.length) setProjectId((current) => current || rows[0].id);
      })
      .catch(() => setProjects([]));
    void partyApi
      .list({ query: { page: 1, pageSize: 200, status: "ACTIVE" } })
      .then((data) =>
        setParties(
          (data?.list || []).map((row) => ({
            value: String(row.id),
            label: `${row.name} · ${row.kindLabel}`,
          })),
        ),
      )
      .catch(() => setParties([]));
  }, []);

  const loadSummary = useCallback(async () => {
    if (!projectId) {
      setSummary(null);
      return;
    }
    try {
      const data = await projectApi.projectCost({ params: { id: projectId } });
      setSummary(data);
      setError("");
    } catch (err) {
      setError(pjError(err));
    }
  }, [projectId]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await projectApi.costItems({
        query: { page: itemPage, pageSize: 20, projectId: projectId || undefined, kind: kind || undefined },
      });
      setItems(data?.list || []);
      setItemTotal(data?.total || 0);
      setError("");
    } catch (err) {
      setError(pjError(err));
    } finally {
      setLoading(false);
    }
  }, [itemPage, projectId, kind]);

  const loadRates = useCallback(async () => {
    try {
      const data = await projectApi.costRates({
        query: {
          page: ratePage,
          pageSize: 20,
          principalType: principalType || undefined,
          q: rateQ || undefined,
        },
      });
      setRates(data?.list || []);
      setRateTotal(data?.total || 0);
      setError("");
    } catch (err) {
      setError(pjError(err));
    }
  }, [ratePage, principalType, rateQ]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    void loadRates();
  }, [loadRates]);

  const openItem = (row?: PjCostItem) => {
    const initial = row
      ? {
          ...row,
          qty: Number(row.qty),
          unitCost: Number(row.unitCost),
        }
      : {
          projectId,
          kind: "MATERIAL",
          qty: 1,
          unitCost: 0,
          currency: summary?.currency || "CNY",
          occurredAt: new Date().toISOString().slice(0, 10),
        };
    setItemEditing(initial);
    itemForm.setFieldsValue(initial);
  };

  const submitItem = async () => {
    try {
      const values = await itemForm.validateFields();
      setSaving(true);
      await projectApi.saveCostItem({
        body: {
          id: itemEditing?.id ? Number(itemEditing.id) : undefined,
          projectId: values.projectId,
          kind: values.kind || "OTHER",
          title: values.title || "",
          qty: Number(values.qty || 0),
          unit: values.unit || "",
          unitCost: Number(values.unitCost || 0),
          currency: values.currency || "CNY",
          occurredAt: values.occurredAt || "",
          note: values.note || "",
        },
      });
      message.success("已保存");
      setItemEditing(null);
      await Promise.all([loadItems(), loadSummary()]);
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(pjError(err));
    } finally {
      setSaving(false);
    }
  };

  const removeItem = async (row: PjCostItem) => {
    try {
      await projectApi.removeCostItem({ body: { id: row.id } });
      message.success("已删除");
      await Promise.all([loadItems(), loadSummary()]);
    } catch (err) {
      message.error(pjError(err));
    }
  };

  const openRate = (row?: PjCostRate) => {
    const initial = row
      ? {
          ...row,
          hourlyRate: Number(row.hourlyRate),
          dailyRate: Number(row.dailyRate),
        }
      : {
          principalType: "STAFF",
          currency: "CNY",
          hourlyRate: 0,
          dailyRate: 0,
          effectiveFrom: new Date().toISOString().slice(0, 10),
        };
    setRatePrincipalType(String(initial.principalType || "STAFF"));
    setRateEditing(initial);
    rateForm.setFieldsValue(initial);
  };

  const submitRate = async () => {
    try {
      const values = await rateForm.validateFields();
      setSaving(true);
      await projectApi.saveCostRate({
        body: {
          id: rateEditing?.id ? Number(rateEditing.id) : undefined,
          principalType: values.principalType || "STAFF",
          principalId: String(values.principalId || ""),
          role: values.role || "",
          hourlyRate: Number(values.hourlyRate || 0),
          dailyRate: Number(values.dailyRate || 0),
          currency: values.currency || "CNY",
          effectiveFrom: values.effectiveFrom || "",
          effectiveTo: values.effectiveTo || "",
        },
      });
      message.success("已保存");
      setRateEditing(null);
      await Promise.all([loadRates(), loadSummary()]);
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(pjError(err));
    } finally {
      setSaving(false);
    }
  };

  const removeRate = async (row: PjCostRate) => {
    try {
      await projectApi.removeCostRate({ body: { id: row.id } });
      message.success("已删除");
      await Promise.all([loadRates(), loadSummary()]);
    } catch (err) {
      message.error(pjError(err));
    }
  };

  const principalOptions = ratePrincipalType === "PARTY" ? parties : staff;

  const itemColumns: ColumnsType<PjCostItem> = [
    { title: "项目", dataIndex: "projectName", width: 160 },
    { title: "类型", dataIndex: "kind", width: 90, render: (v: string) => <Tag>{PJ_COST_KIND_LABELS[v] || v}</Tag> },
    { title: "事项", dataIndex: "title", render: (v: string) => v || "—" },
    {
      title: "数量",
      key: "qty",
      width: 120,
      render: (_: unknown, row) => `${Number(row.qty)} ${row.unit || ""}`,
    },
    { title: "单价", dataIndex: "unitCost", width: 120, render: (v: string, row) => money(v, row.currency) },
    { title: "金额", dataIndex: "amount", width: 130, render: (v: string, row) => money(v, row.currency) },
    {
      title: "来源",
      dataIndex: "sourceType",
      width: 110,
      render: (v: string) => <Tag color={v === "MANUAL" ? "default" : "blue"}>{PJ_COST_SOURCE_LABELS[v] || v}</Tag>,
    },
    { title: "发生日期", dataIndex: "occurredAt", width: 110, render: (v: string) => day(v) },
    {
      title: "操作",
      key: "actions",
      width: 120,
      render: (_: unknown, row) =>
        row.sourceType === "MANUAL" ? (
          <>
            <Button type="link" size="small" onClick={() => openItem(row)}>
              编辑
            </Button>
            <Button type="link" size="small" danger onClick={() => void removeItem(row)}>
              删除
            </Button>
          </>
        ) : (
          <span className="muted text-12">系统生成</span>
        ),
    },
  ];

  const rateColumns: ColumnsType<PjCostRate> = [
    { title: "适用方", dataIndex: "principalName", render: (v: string) => v || "—" },
    { title: "角色", dataIndex: "role", width: 120, render: (v: string) => v || "—" },
    { title: "时薪", dataIndex: "hourlyRate", width: 110, render: (v: string, row) => money(v, row.currency) },
    { title: "日薪", dataIndex: "dailyRate", width: 110, render: (v: string, row) => money(v, row.currency) },
    { title: "生效起", dataIndex: "effectiveFrom", width: 110, render: (v: string) => day(v) },
    { title: "生效止", dataIndex: "effectiveTo", width: 110, render: (v: string) => (v ? day(v) : "长期") },
    {
      title: "操作",
      key: "actions",
      width: 120,
      render: (_: unknown, row) => (
        <>
          <Button type="link" size="small" onClick={() => openRate(row)}>
            编辑
          </Button>
          <Button type="link" size="small" danger onClick={() => void removeRate(row)}>
            删除
          </Button>
        </>
      ),
    },
  ];

  return (
    <>
      <Panel
        title="项目成本"
        extra={
          <Select
            showSearch
            optionFilterProp="label"
            style={{ width: 240 }}
            value={projectId || undefined}
            placeholder="选择项目"
            onChange={(value) => {
              setProjectId(Number(value));
              setItemPage(1);
            }}
            options={projects.map((row) => ({ value: row.id, label: row.name }))}
          />
        }
      >
        {error ? <Notice variant="error">{error}</Notice> : null}
        {summary ? (
          <>
            <StatGrid>
              <StatCard label="预算金额" value={money(summary.budgetAmount, summary.currency)} />
              <StatCard label="已发生成本" value={money(summary.costTotal, summary.currency)} />
              <StatCard
                label="预算占用"
                value={`${summary.budgetUtilizationPct}%`}
                hint={`预算工时 ${Number(summary.budgetHours).toFixed(1)}h`}
              />
              <StatCard
                label="人力成本"
                value={money(summary.laborAmount, summary.currency)}
                hint={`已审批工时 ${summary.timeLogHours}h`}
              />
              <StatCard
                label="外部支出"
                value={money(summary.externalAmount, summary.currency)}
                hint={`${summary.engagementCount} 项外部合作 · ${summary.settledEngagementCount} 项已结算`}
              />
              <StatCard
                label="未配费率工时"
                value={summary.missingRateMinutes ? `${(summary.missingRateMinutes / 60).toFixed(1)}h` : "无"}
                hint={summary.missingRateMinutes ? "请补充对应人员的成本费率" : "人力成本已全部计入"}
              />
            </StatGrid>
            <div className="muted text-12" style={{ marginTop: 8 }}>
              人力成本 = 已审批工时 × 当期费率；物料/设备/外部支出按明细汇总。
            </div>
          </>
        ) : (
          <div className="muted">请选择项目查看成本汇总</div>
        )}
      </Panel>

      <Panel
        title="成本明细"
        extra={
          <Button type="primary" disabled={!projectId} onClick={() => openItem()}>
            登记成本
          </Button>
        }
      >
        <Toolbar hint={`共 ${itemTotal} 条`}>
          <PillTabs
            items={[{ key: "", label: "全部" }, ...KIND_PILLS]}
            value={kind}
            onChange={(key) => {
              setKind(key);
              setItemPage(1);
            }}
            size="small"
            variant="soft"
          />
        </Toolbar>
        <Table<PjCostItem>
          rowKey="id"
          size="middle"
          loading={loading}
          columns={itemColumns}
          dataSource={items}
          scroll={{ x: "max-content" }}
          pagination={{
            current: itemPage,
            pageSize: 20,
            total: itemTotal,
            showSizeChanger: false,
            onChange: setItemPage,
          }}
          locale={{ emptyText: "暂无成本明细" }}
        />
      </Panel>

      <Panel
        title="成本费率"
        titleExtra={<span className="muted text-12">按生效日期匹配工时，用于计算人力成本</span>}
        extra={
          <Button onClick={() => openRate()}>
            新增费率
          </Button>
        }
      >
        <Toolbar hint={`共 ${rateTotal} 条`}>
          <Input.Search
            allowClear
            placeholder="搜索适用方"
            style={{ width: 200 }}
            value={rateQ}
            onChange={(event) => {
              setRateQ(event.target.value);
              setRatePage(1);
            }}
          />
          <PillTabs
            items={[{ key: "", label: "全部" }, ...PRINCIPAL_PILLS]}
            value={principalType}
            onChange={(key) => {
              setPrincipalType(key);
              setRatePage(1);
            }}
            size="small"
            variant="soft"
          />
        </Toolbar>
        <Table<PjCostRate>
          rowKey="id"
          size="middle"
          columns={rateColumns}
          dataSource={rates}
          scroll={{ x: "max-content" }}
          pagination={{
            current: ratePage,
            pageSize: 20,
            total: rateTotal,
            showSizeChanger: false,
            onChange: setRatePage,
          }}
          locale={{ emptyText: "暂无费率" }}
        />
      </Panel>

      <Modal
        open={Boolean(itemEditing)}
        title={itemEditing?.id ? "编辑成本" : "登记成本"}
        onCancel={() => setItemEditing(null)}
        onOk={() => void submitItem()}
        confirmLoading={saving}
        width={640}
        destroyOnHidden
      >
        <Form form={itemForm} layout="vertical">
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item name="projectId" label="所属项目" rules={[{ required: true, message: "请选择项目" }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={projects.map((row) => ({ value: row.id, label: row.name }))}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="kind" label="成本类型" rules={[{ required: true, message: "请选择类型" }]}>
                <Select options={KIND_OPTIONS.filter((item) => item.value !== "LABOR")} />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name="title" label="事项" rules={[{ required: true, message: "请填写事项" }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="qty" label="数量">
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="unit" label="单位">
                <Input placeholder="件 / 人天" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="unitCost" label="单价">
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="occurredAt" label="发生日期">
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="note" label="备注">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        open={Boolean(rateEditing)}
        title={rateEditing?.id ? "编辑成本费率" : "新增成本费率"}
        onCancel={() => setRateEditing(null)}
        onOk={() => void submitRate()}
        confirmLoading={saving}
        width={640}
        destroyOnHidden
      >
        <Form form={rateForm} layout="vertical">
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="principalType" label="适用方类型">
                <Select
                  options={PRINCIPAL_OPTIONS}
                  onChange={(value) => {
                    setRatePrincipalType(String(value));
                    rateForm.setFieldValue("principalId", undefined);
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item
                name="principalId"
                label="适用方"
                rules={[{ required: true, message: "请选择适用方" }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={principalOptions}
                  placeholder={ratePrincipalType === "PARTY" ? "选择合作方" : "选择员工"}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="role" label="角色">
                <Input placeholder="如 设计师 / 开发工程师" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="currency" label="币种">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="hourlyRate" label="时薪">
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="dailyRate" label="日薪（时薪为空时按日折算）">
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="effectiveFrom" label="生效起">
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="effectiveTo" label="生效止（留空为长期）">
                <Input type="date" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </>
  );
}
