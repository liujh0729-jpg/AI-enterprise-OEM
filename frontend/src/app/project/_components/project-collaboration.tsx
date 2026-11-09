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
  PARTY_KINDS,
  PARTY_KIND_LABELS,
  PARTY_STATUSES,
  PARTY_STATUS_LABELS,
  PJ_ENGAGEMENT_STATUS_LABELS,
  pjEngagementSchema,
  z,
  type PartyView,
} from "@enterprise/contracts";
import { projectApi } from "@/api/project";
import { partyApi } from "@/api/party";
import { Notice, Panel, PillTabs } from "@/components/ui/panel";
import { Toolbar, day, money, pjError, type PjProject } from "./project-common";

type PjEngagement = z.infer<typeof pjEngagementSchema>;

const KIND_OPTIONS = PARTY_KINDS.map((value) => ({ value, label: PARTY_KIND_LABELS[value] }));
const PARTY_STATUS_OPTIONS = PARTY_STATUSES.map((value) => ({
  value,
  label: PARTY_STATUS_LABELS[value],
}));
const ENGAGEMENT_STATUS_OPTIONS = Object.entries(PJ_ENGAGEMENT_STATUS_LABELS).map(
  ([value, label]) => ({ value, label }),
);
const ENGAGEMENT_STATUS_COLORS: Record<string, string> = {
  DRAFT: "default",
  ACTIVE: "processing",
  ACCEPTING: "gold",
  SETTLED: "green",
  CANCELED: "default",
};

const KIND_PILLS = KIND_OPTIONS.map((item) => ({ key: item.value, label: item.label }));
const PARTY_STATUS_PILLS = PARTY_STATUS_OPTIONS.map((item) => ({
  key: item.value,
  label: item.label,
}));
const ENGAGEMENT_STATUS_PILLS = ENGAGEMENT_STATUS_OPTIONS.map((item) => ({
  key: item.value,
  label: item.label,
}));

type Decision = { row: PjEngagement; action: "start" | "submit" | "accept" | "cancel" };

const DECISION_LABELS: Record<Decision["action"], string> = {
  start: "开始履约",
  submit: "提交验收",
  accept: "验收结算",
  cancel: "取消合作",
};

export function PjCollabTab() {
  const [view, setView] = useState("engagements");
  const [projects, setProjects] = useState<PjProject[]>([]);
  const [parties, setParties] = useState<PartyView[]>([]);
  const [error, setError] = useState("");

  const [engagements, setEngagements] = useState<PjEngagement[]>([]);
  const [engagementTotal, setEngagementTotal] = useState(0);
  const [engagementPage, setEngagementPage] = useState(1);
  const [engagementProject, setEngagementProject] = useState(0);
  const [engagementStatus, setEngagementStatus] = useState("");
  const [engagementLoading, setEngagementLoading] = useState(false);
  const [engagementEditing, setEngagementEditing] = useState<Record<string, unknown> | null>(null);
  const [engagementForm] = Form.useForm();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [decisionForm] = Form.useForm();

  const [partyRows, setPartyRows] = useState<PartyView[]>([]);
  const [partyTotal, setPartyTotal] = useState(0);
  const [partyPage, setPartyPage] = useState(1);
  const [partyKind, setPartyKind] = useState("");
  const [partyStatus, setPartyStatus] = useState("");
  const [partyQ, setPartyQ] = useState("");
  const [partyLoading, setPartyLoading] = useState(false);
  const [partyEditing, setPartyEditing] = useState<Record<string, unknown> | null>(null);
  const [partyForm] = Form.useForm();

  const [saving, setSaving] = useState(false);

  const loadBase = useCallback(async () => {
    try {
      const [projectData, partyData] = await Promise.all([
        projectApi.projects({ query: { page: 1, pageSize: 100 } }),
        partyApi.list({ query: { page: 1, pageSize: 200, status: "ACTIVE" } }),
      ]);
      setProjects(projectData?.list || []);
      setParties(partyData?.list || []);
    } catch (err) {
      setError(pjError(err));
    }
  }, []);

  const loadEngagements = useCallback(async () => {
    setEngagementLoading(true);
    try {
      const data = await projectApi.engagements({
        query: {
          page: engagementPage,
          pageSize: 20,
          projectId: engagementProject || undefined,
          status: engagementStatus || undefined,
        },
      });
      setEngagements(data?.list || []);
      setEngagementTotal(data?.total || 0);
      setError("");
    } catch (err) {
      setError(pjError(err));
    } finally {
      setEngagementLoading(false);
    }
  }, [engagementPage, engagementProject, engagementStatus]);

  const loadParties = useCallback(async () => {
    setPartyLoading(true);
    try {
      const data = await partyApi.list({
        query: {
          page: partyPage,
          pageSize: 20,
          kind: partyKind || undefined,
          status: partyStatus || undefined,
          q: partyQ || undefined,
        },
      });
      setPartyRows(data?.list || []);
      setPartyTotal(data?.total || 0);
      setError("");
    } catch (err) {
      setError(pjError(err));
    } finally {
      setPartyLoading(false);
    }
  }, [partyPage, partyKind, partyStatus, partyQ]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    void loadEngagements();
  }, [loadEngagements]);

  useEffect(() => {
    void loadParties();
  }, [loadParties]);

  const openEngagement = (row?: PjEngagement) => {
    const initial = row
      ? { ...row, amount: Number(row.amount) }
      : {
          projectId: engagementProject || projects[0]?.id,
          amount: 0,
          currency: "CNY",
          startDate: new Date().toISOString().slice(0, 10),
        };
    setEngagementEditing(initial);
    engagementForm.setFieldsValue(initial);
  };

  const submitEngagement = async () => {
    try {
      const values = await engagementForm.validateFields();
      setSaving(true);
      await projectApi.saveEngagement({
        body: {
          id: engagementEditing?.id ? Number(engagementEditing.id) : undefined,
          projectId: values.projectId,
          partyId: values.partyId,
          scope: values.scope || "",
          contractId: Number(engagementEditing?.contractId || 0),
          amount: Number(values.amount || 0),
          currency: values.currency || "CNY",
          paymentTerms: values.paymentTerms || "",
          acceptance: (engagementEditing?.acceptance as Record<string, unknown>) || {},
          startDate: values.startDate || "",
          endDate: values.endDate || "",
        },
      });
      message.success("已保存");
      setEngagementEditing(null);
      await loadEngagements();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(pjError(err));
    } finally {
      setSaving(false);
    }
  };

  const removeEngagement = async (row: PjEngagement) => {
    try {
      await projectApi.removeEngagement({ body: { id: row.id } });
      message.success("已删除");
      await loadEngagements();
    } catch (err) {
      message.error(pjError(err));
    }
  };

  const submitDecision = async () => {
    if (!decision) return;
    try {
      const values = await decisionForm.validateFields();
      setSaving(true);
      await projectApi.decideEngagement({
        params: { id: decision.row.id },
        body: { decision: decision.action, note: values.note || "" },
      });
      message.success("已更新");
      setDecision(null);
      decisionForm.resetFields();
      await loadEngagements();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(pjError(err));
    } finally {
      setSaving(false);
    }
  };

  const openParty = (row?: PartyView) => {
    const initial = row
      ? { ...row }
      : { kind: "VENDOR", status: "ACTIVE", rating: 0, roles: [], capabilities: [] };
    setPartyEditing(initial as Record<string, unknown>);
    partyForm.setFieldsValue(initial);
  };

  const submitParty = async () => {
    try {
      const values = await partyForm.validateFields();
      setSaving(true);
      const saved = await partyApi.save({
        body: {
          id: partyEditing?.id ? Number(partyEditing.id) : undefined,
          kind: values.kind || "VENDOR",
          name: values.name,
          contactName: values.contactName || "",
          phone: values.phone || "",
          email: values.email || "",
          taxNo: values.taxNo || "",
          address: values.address || "",
          roles: values.roles || [],
          capabilities: values.capabilities || [],
          rateCard: {},
          availability: {},
          compliance: {},
          rating: Number(values.rating || 0),
          status: values.status || "ACTIVE",
          source: String(partyEditing?.source || "MANUAL"),
          note: values.note || "",
        },
      });
      message.success(saved ? "已保存" : "已提交");
      setPartyEditing(null);
      await Promise.all([loadParties(), loadBase()]);
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(pjError(err));
    } finally {
      setSaving(false);
    }
  };

  const removeParty = async (row: PartyView) => {
    try {
      await partyApi.remove({ params: { id: String(row.id) } });
      message.success("已删除");
      await Promise.all([loadParties(), loadBase()]);
    } catch (err) {
      message.error(pjError(err));
    }
  };

  const engagementColumns: ColumnsType<PjEngagement> = [
    { title: "合作方", dataIndex: "partyName", width: 160 },
    {
      title: "类型",
      dataIndex: "partyKindLabel",
      width: 90,
      render: (v: string) => <Tag>{v || "—"}</Tag>,
    },
    { title: "项目", dataIndex: "projectName", width: 150 },
    { title: "合作范围", dataIndex: "scope", render: (v: string) => v || "—" },
    { title: "金额", dataIndex: "amount", width: 130, render: (v: string, row) => money(v, row.currency) },
    { title: "付款条款", dataIndex: "paymentTerms", width: 140, render: (v: string) => v || "—" },
    { title: "起止", key: "range", width: 190, render: (_: unknown, row) => `${day(row.startDate)} ~ ${day(row.endDate)}` },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (v: string) => <Tag color={ENGAGEMENT_STATUS_COLORS[v] || "default"}>{PJ_ENGAGEMENT_STATUS_LABELS[v] || v}</Tag>,
    },
    {
      title: "操作",
      key: "actions",
      width: 240,
      render: (_: unknown, row) => (
        <>
          {row.status === "DRAFT" ? (
            <Button type="link" size="small" onClick={() => setDecision({ row, action: "start" })}>
              开始
            </Button>
          ) : null}
          {row.status === "ACTIVE" ? (
            <Button type="link" size="small" onClick={() => setDecision({ row, action: "submit" })}>
              提交验收
            </Button>
          ) : null}
          {row.status === "ACCEPTING" ? (
            <Button type="link" size="small" onClick={() => setDecision({ row, action: "accept" })}>
              验收结算
            </Button>
          ) : null}
          {row.status !== "SETTLED" && row.status !== "CANCELED" ? (
            <Button type="link" size="small" danger onClick={() => setDecision({ row, action: "cancel" })}>
              取消
            </Button>
          ) : null}
          {row.status !== "SETTLED" && row.status !== "CANCELED" ? (
            <Button type="link" size="small" onClick={() => openEngagement(row)}>
              编辑
            </Button>
          ) : null}
          {row.status !== "SETTLED" ? (
            <Button type="link" size="small" danger onClick={() => void removeEngagement(row)}>
              删除
            </Button>
          ) : null}
        </>
      ),
    },
  ];

  const partyColumns: ColumnsType<PartyView> = [
    { title: "名称", dataIndex: "name" },
    {
      title: "类型",
      dataIndex: "kind",
      width: 100,
      render: (v: string) => <Tag>{PARTY_KIND_LABELS[v] || v}</Tag>,
    },
    { title: "联系人", dataIndex: "contactName", width: 110, render: (v: string) => v || "—" },
    { title: "电话", dataIndex: "phone", width: 130, render: (v: string) => v || "—" },
    { title: "能力标签", dataIndex: "capabilities", width: 200, render: (v: string[]) => (v.length ? v.join("、") : "—") },
    { title: "评分", dataIndex: "rating", width: 80, render: (v: number) => (v ? `${v} / 5` : "—") },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (v: string) => (
        <Tag color={v === "ACTIVE" ? "green" : v === "BLACKLISTED" ? "red" : "default"}>
          {PARTY_STATUS_LABELS[v] || v}
        </Tag>
      ),
    },
    { title: "来源", dataIndex: "sourceLabel", width: 110 },
    {
      title: "操作",
      key: "actions",
      width: 120,
      render: (_: unknown, row) => (
        <>
          <Button type="link" size="small" onClick={() => openParty(row)}>
            编辑
          </Button>
          <Button type="link" size="small" danger onClick={() => void removeParty(row)}>
            删除
          </Button>
        </>
      ),
    },
  ];

  return (
    <>
      <Panel
        title="外部协作"
        titleExtra={<span className="muted text-12">供应商、OPC、个人与合作伙伴统一建档，合作单驱动外部成本</span>}
        extra={
          view === "engagements" ? (
            <Button type="primary" onClick={() => openEngagement()}>
              新建合作
            </Button>
          ) : (
            <Button type="primary" onClick={() => openParty()}>
              新建合作方
            </Button>
          )
        }
      >
        <Toolbar hint={view === "engagements" ? `共 ${engagementTotal} 项合作` : `共 ${partyTotal} 个合作方`}>
          <PillTabs
            items={[
              { key: "engagements", label: "合作项目" },
              { key: "parties", label: "合作方目录" },
            ]}
            value={view}
            onChange={setView}
            size="small"
            variant="soft"
          />
          {view === "engagements" ? (
            <>
              <Select
                allowClear
                placeholder="全部项目"
                style={{ width: 200 }}
                value={engagementProject || undefined}
                onChange={(value) => {
                  setEngagementProject(Number(value || 0));
                  setEngagementPage(1);
                }}
                options={projects.map((row) => ({ value: row.id, label: row.name }))}
              />
              <PillTabs
                items={[{ key: "", label: "全部" }, ...ENGAGEMENT_STATUS_PILLS]}
                value={engagementStatus}
                onChange={(key) => {
                  setEngagementStatus(key);
                  setEngagementPage(1);
                }}
                size="small"
                variant="soft"
              />
            </>
          ) : (
            <>
              <Input.Search
                allowClear
                placeholder="搜索名称/联系人"
                style={{ width: 200 }}
                value={partyQ}
                onChange={(event) => {
                  setPartyQ(event.target.value);
                  setPartyPage(1);
                }}
              />
              <PillTabs
                items={[{ key: "", label: "全部类型" }, ...KIND_PILLS]}
                value={partyKind}
                onChange={(key) => {
                  setPartyKind(key);
                  setPartyPage(1);
                }}
                size="small"
                variant="soft"
              />
              <PillTabs
                items={[{ key: "", label: "全部状态" }, ...PARTY_STATUS_PILLS]}
                value={partyStatus}
                onChange={(key) => {
                  setPartyStatus(key);
                  setPartyPage(1);
                }}
                size="small"
                variant="soft"
              />
            </>
          )}
        </Toolbar>

        {error ? <Notice variant="error">{error}</Notice> : null}

        {view === "engagements" ? (
          <Table<PjEngagement>
            rowKey="id"
            size="middle"
            loading={engagementLoading}
            columns={engagementColumns}
            dataSource={engagements}
            scroll={{ x: "max-content" }}
            pagination={{
              current: engagementPage,
              pageSize: 20,
              total: engagementTotal,
              showSizeChanger: false,
              onChange: setEngagementPage,
            }}
            locale={{ emptyText: "暂无外部合作" }}
          />
        ) : (
          <Table<PartyView>
            rowKey="id"
            size="middle"
            loading={partyLoading}
            columns={partyColumns}
            dataSource={partyRows}
            scroll={{ x: "max-content" }}
            pagination={{
              current: partyPage,
              pageSize: 20,
              total: partyTotal,
              showSizeChanger: false,
              onChange: setPartyPage,
            }}
            locale={{ emptyText: "暂无合作方" }}
          />
        )}
      </Panel>

      <Modal
        open={Boolean(engagementEditing)}
        title={engagementEditing?.id ? "编辑合作" : "新建合作"}
        onCancel={() => setEngagementEditing(null)}
        onOk={() => void submitEngagement()}
        confirmLoading={saving}
        width={680}
        destroyOnHidden
      >
        <Form form={engagementForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="projectId" label="所属项目" rules={[{ required: true, message: "请选择项目" }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={projects.map((row) => ({ value: row.id, label: row.name }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="partyId" label="合作方" rules={[{ required: true, message: "请选择合作方" }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={parties.map((row) => ({
                    value: row.id,
                    label: `${row.name} · ${row.kindLabel}`,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="scope" label="合作范围">
                <Input.TextArea rows={2} placeholder="交付内容、验收边界与责任划分" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="amount" label="合作金额">
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="currency" label="币种">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="paymentTerms" label="付款条款">
                <Input placeholder="如 验收后 30 天付款" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="startDate" label="开始日期">
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="endDate" label="结束日期">
                <Input type="date" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        open={Boolean(decision)}
        title={decision ? `${DECISION_LABELS[decision.action]} · ${decision.row.partyName}` : ""}
        onCancel={() => {
          decisionForm.resetFields();
          setDecision(null);
        }}
        onOk={() => void submitDecision()}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={decisionForm} layout="vertical">
          <Form.Item name="note" label="说明">
            <Input.TextArea rows={3} placeholder="验收结论、结算说明或取消原因" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(partyEditing)}
        title={partyEditing?.id ? "编辑合作方" : "新建合作方"}
        onCancel={() => setPartyEditing(null)}
        onOk={() => void submitParty()}
        confirmLoading={saving}
        width={680}
        destroyOnHidden
      >
        <Form form={partyForm} layout="vertical">
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="kind" label="类型">
                <Select options={KIND_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写名称" }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="contactName" label="联系人">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="phone" label="电话">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="email" label="邮箱">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="taxNo" label="税号">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="address" label="地址">
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="roles" label="角色标签">
                <Select mode="tags" placeholder="如 设计 / 开发 / 投放，回车添加" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="capabilities" label="能力标签">
                <Select mode="tags" placeholder="如 独立站 / 短视频 / 私域运营，回车添加" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="rating" label="评分（0-5）">
                <InputNumber style={{ width: "100%" }} min={0} max={5} step={0.5} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="status" label="状态">
                <Select options={PARTY_STATUS_OPTIONS} />
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
    </>
  );
}
