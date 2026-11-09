"use client";

import {
  Button,
  DatePicker,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { useCallback, useEffect, useState } from "react";
import {
  CHANGELOG_CATEGORY_LABELS,
  ENTITLEMENT_AUDIENCES,
  ENTITLEMENT_AUDIENCE_LABELS,
  TERMS_CATEGORIES,
  TERMS_CATEGORY_LABELS,
} from "@enterprise/contracts";
import { gapsApi } from "@/api/gaps";
import type {
  ChangelogEntry,
  EntitlementPlan,
  OrgEntitlement,
  TermsDocument,
  UsageEvent,
  UsageSettings,
  UsageSummary,
} from "@/api/gaps";
import { Notice, Panel } from "@/components/ui/panel";
import { gapError, gapStatusTag, zhTime } from "@/app/gaps/_components/gaps-common";

const USAGE_EVENT_LABELS: Record<string, string> = {
  page_view: "页面浏览",
  feature_click: "功能点击",
  action_submit: "动作提交",
};

/* ------------------------------------------------------------------ B1#2 */

/** 权益配额目录：平台维护套餐与逐功能配额；可查看任意组织的当前套餐并手工指定。 */
export function GapsEntitlementsTab() {
  const [plans, setPlans] = useState<EntitlementPlan[]>([]);
  const [orgPlan, setOrgPlan] = useState<OrgEntitlement | null>(null);
  const [orgUserId, setOrgUserId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [assignForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPlans((await gapsApi.plans()) ?? []);
      setError("");
    } catch (err) {
      setError(gapError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOrg = useCallback(async (target: string) => {
    try {
      setOrgPlan(await gapsApi.orgPlan({ query: target ? { orgUserId: target } : {} }));
    } catch (err) {
      setOrgPlan(null);
      message.error(gapError(err));
    }
  }, []);

  useEffect(() => {
    void load();
    void loadOrg("");
  }, [load, loadOrg]);

  const openEditor = (row?: EntitlementPlan) => {
    form.resetFields();
    if (row) {
      form.setFieldsValue({
        id: row.id,
        code: row.code,
        name: row.name,
        audience: row.audience,
        description: row.description,
        priceMonthly: row.priceMonthly,
        status: row.status,
        quotas: row.quotas,
      });
    } else {
      form.setFieldsValue({ audience: "ENTERPRISE", status: "ACTIVE", priceMonthly: 0, quotas: [] });
    }
    setOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      if (values.id) delete values.code;
      await gapsApi.savePlan({ body: values });
      message.success("套餐已保存");
      setOpen(false);
      await load();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(gapError(err));
    }
  };

  const assign = async () => {
    try {
      const values = await assignForm.validateFields();
      const result = await gapsApi.assignEntitlement({
        body: {
          orgUserId: values.orgUserId,
          planCode: values.planCode,
          expiresAt: values.expiresAt ? (values.expiresAt as Dayjs).toISOString() : "",
        },
      });
      setOrgPlan(result);
      setOrgUserId(values.orgUserId);
      message.success("已指定套餐");
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(gapError(err));
    }
  };

  const columns: ColumnsType<EntitlementPlan> = [
    { title: "套餐编码", dataIndex: "code", width: 150 },
    { title: "名称", dataIndex: "name" },
    { title: "适用", dataIndex: "audienceLabel", width: 110 },
    {
      title: "月费",
      width: 110,
      render: (_, row) => `¥${Number(row.priceMonthly || 0).toFixed(2)}`,
    },
    {
      title: "配额项",
      width: 90,
      render: (_, row) => `${row.quotas.length} 项`,
    },
    { title: "状态", width: 80, render: (_, row) => gapStatusTag(row.status) },
    { title: "更新时间", width: 150, render: (_, row) => zhTime(row.updatedAt) },
    {
      title: "操作",
      width: 130,
      render: (_, row) => (
        <>
          <Button size="small" type="link" onClick={() => openEditor(row)}>
            编辑
          </Button>
          <Button
            size="small"
            type="link"
            danger
            onClick={async () => {
              try {
                await gapsApi.removePlan({ body: { id: row.id } });
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
    <>
      <Panel
        title="权益配额目录"
        titleExtra="套餐按主体类型提供功能配额；组织当前套餐优先取手工指定，否则取同类最低价启用套餐"
        extra={
          <Button type="primary" onClick={() => openEditor()}>
            新建套餐
          </Button>
        }
      >
        {error ? <Notice variant="error">{error}</Notice> : null}
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={plans}
          scroll={{ x: 960 }}
          pagination={false}
        />
      </Panel>

      <Panel title="组织当前权益" titleExtra="输入组织账号 ID 查询；可手工指定套餐与到期时间">
        <Space wrap style={{ marginBottom: 12 }}>
          <Input
            value={orgUserId}
            onChange={(event) => setOrgUserId(event.target.value)}
            placeholder="组织账号 ID（留空为当前组织）"
            style={{ width: 280 }}
          />
          <Button onClick={() => void loadOrg(orgUserId.trim())}>查询</Button>
        </Space>
        {orgPlan ? (
          <>
            <Descriptions
              size="small"
              bordered
              column={3}
              items={[
                { key: "1", label: "组织", children: `${orgPlan.orgType} / ${orgPlan.orgUserId}` },
                { key: "2", label: "套餐", children: `${orgPlan.planName}（${orgPlan.planCode}）` },
                { key: "3", label: "来源", children: orgPlan.source },
                { key: "4", label: "状态", children: gapStatusTag(orgPlan.status) },
                { key: "5", label: "生效", children: zhTime(orgPlan.startedAt) },
                { key: "6", label: "到期", children: orgPlan.expiresAt ? zhTime(orgPlan.expiresAt) : "长期" },
              ]}
            />
            <Table
              style={{ marginTop: 12 }}
              rowKey="featureCode"
              size="small"
              dataSource={orgPlan.quotas}
              pagination={false}
              columns={[
                { title: "功能", dataIndex: "featureCode" },
                {
                  title: "权限",
                  width: 90,
                  render: (_, row) =>
                    row.access === "allowed" ? <Tag color="green">可用</Tag> : <Tag>不可用</Tag>,
                },
                {
                  title: "额度",
                  width: 120,
                  render: (_, row) =>
                    row.limitCount < 0 ? "不限" : `${row.usedCount} / ${row.limitCount} ${row.unit}`,
                },
                { title: "周期", dataIndex: "period", width: 90 },
                { title: "说明", dataIndex: "note", ellipsis: true },
              ]}
            />
          </>
        ) : null}
        <Form form={assignForm} layout="inline" style={{ marginTop: 14 }} onFinish={() => void assign()}>
          <Form.Item name="orgUserId" label="组织账号" rules={[{ required: true, message: "请填写组织账号" }]}>
            <Input style={{ width: 220 }} defaultValue={orgUserId} />
          </Form.Item>
          <Form.Item name="planCode" label="套餐" rules={[{ required: true, message: "请选择套餐" }]}>
            <Select
              style={{ width: 200 }}
              options={plans
                .filter((item) => item.status === "ACTIVE")
                .map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))}
            />
          </Form.Item>
          <Form.Item name="expiresAt" label="到期">
            <DatePicker showTime />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            指定套餐
          </Button>
        </Form>
      </Panel>

      <Modal
        open={open}
        title={form.getFieldValue("id") ? "编辑套餐" : "新建套餐"}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        width={900}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="code" label="套餐编码" rules={[{ required: true, message: "请填写编码" }]} style={{ width: 200 }}>
              <Input maxLength={32} placeholder="ENTERPRISE_BASIC" />
            </Form.Item>
            <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写名称" }]} style={{ width: 260 }}>
              <Input maxLength={64} />
            </Form.Item>
            <Form.Item name="audience" label="适用" style={{ width: 130 }}>
              <Select
                options={ENTITLEMENT_AUDIENCES.map((value) => ({
                  value,
                  label: ENTITLEMENT_AUDIENCE_LABELS[value],
                }))}
              />
            </Form.Item>
            <Form.Item name="priceMonthly" label="月费" style={{ width: 130 }}>
              <InputNumber min={0} style={{ width: "100%" }} prefix="¥" />
            </Form.Item>
            <Form.Item name="status" label="状态" style={{ width: 110 }}>
              <Select
                options={[
                  { value: "ACTIVE", label: "启用" },
                  { value: "ARCHIVED", label: "归档" },
                ]}
              />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
          <Form.List name="quotas">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ display: "flex", marginBottom: 6 }} wrap>
                    <Form.Item
                      name={[field.name, "featureCode"]}
                      rules={[{ required: true, message: "功能编码" }]}
                      style={{ width: 210, marginBottom: 0 }}
                    >
                      <Input placeholder="功能编码" maxLength={64} />
                    </Form.Item>
                    <Form.Item name={[field.name, "access"]} style={{ width: 100, marginBottom: 0 }}>
                      <Select
                        options={[
                          { value: "allowed", label: "可用" },
                          { value: "denied", label: "不可用" },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, "limitCount"]} style={{ width: 120, marginBottom: 0 }}>
                      <InputNumber min={-1} style={{ width: "100%" }} placeholder="-1 不限" />
                    </Form.Item>
                    <Form.Item name={[field.name, "unit"]} style={{ width: 90, marginBottom: 0 }}>
                      <Input placeholder="单位" maxLength={16} />
                    </Form.Item>
                    <Form.Item name={[field.name, "note"]} style={{ width: 220, marginBottom: 0 }}>
                      <Input placeholder="说明" maxLength={200} />
                    </Form.Item>
                    <Button type="link" danger onClick={() => remove(field.name)}>
                      移除
                    </Button>
                  </Space>
                ))}
                <Button type="dashed" block onClick={() => add({ access: "allowed", limitCount: -1 })}>
                  添加配额项
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </>
  );
}

/* ----------------------------------------------------------------- B3#30 */

/** 使用埋点：开关与留存期、事件流水与按事件汇总。 */
export function GapsUsageTab() {
  const [settings, setSettings] = useState<UsageSettings | null>(null);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [event, setEvent] = useState("");
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingData, summaryData, eventData] = await Promise.all([
        gapsApi.usageSettings(),
        gapsApi.usageSummary({ query: { days } }),
        gapsApi.usageEvents({ query: { page, pageSize: 20, event: event || undefined } }),
      ]);
      setSettings(settingData);
      form.setFieldsValue(settingData);
      setSummary(summaryData);
      setEvents(eventData?.list || []);
      setTotal(eventData?.total || 0);
      setError("");
    } catch (err) {
      setError(gapError(err));
    } finally {
      setLoading(false);
    }
  }, [days, page, event, form]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    try {
      const values = await form.validateFields();
      const saved = await gapsApi.saveUsageSettings({ body: values });
      setSettings(saved);
      message.success("埋点设置已保存");
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(gapError(err));
    }
  };

  return (
    <>
      <Panel title="使用埋点设置" titleExtra="关闭后前端不再上报；按留存天数定期清理历史事件">
        <Form form={form} layout="inline" onFinish={() => void save()}>
          <Form.Item name="enabled" label="启用埋点" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="retentionDays" label="留存天数">
            <InputNumber min={7} max={730} />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            保存设置
          </Button>
          {settings ? (
            <span className="text-12 muted" style={{ marginLeft: 12 }}>
              当前：{settings.enabled ? "已启用" : "已关闭"}，留存 {settings.retentionDays} 天
            </span>
          ) : null}
        </Form>
      </Panel>

      <Panel
        title="使用情况"
        titleExtra="按事件统计次数与去重用户数；明细可过滤事件名"
        extra={
          <Space>
            <Select
              style={{ width: 120 }}
              value={days}
              onChange={setDays}
              options={[
                { value: 7, label: "近 7 天" },
                { value: 30, label: "近 30 天" },
                { value: 90, label: "近 90 天" },
              ]}
            />
            <Input.Search
              allowClear
              placeholder="事件名"
              style={{ width: 180 }}
              onSearch={(value) => {
                setEvent(value);
                setPage(1);
              }}
            />
          </Space>
        }
      >
        {error ? <Notice variant="error">{error}</Notice> : null}
        <Table
          rowKey="event"
          size="small"
          loading={loading}
          dataSource={summary?.rows || []}
          pagination={false}
          columns={[
            {
              title: "事件",
              render: (_, row) => USAGE_EVENT_LABELS[row.event] || row.event,
            },
            { title: "次数", dataIndex: "count", width: 120 },
            { title: "去重用户", dataIndex: "users", width: 120 },
          ]}
        />
        <div className="text-12 muted" style={{ margin: "10px 0 6px" }}>
          近 {days} 天共 {summary?.total ?? 0} 次
        </div>
        <Table
          rowKey="id"
          size="small"
          dataSource={events}
          scroll={{ x: 900 }}
          pagination={{
            current: page,
            pageSize: 20,
            total,
            showSizeChanger: false,
            onChange: setPage,
          }}
          columns={[
            { title: "时间", width: 150, render: (_, row) => zhTime(row.createdAt) },
            { title: "事件", width: 150, render: (_, row) => USAGE_EVENT_LABELS[row.event] || row.event },
            { title: "用户", dataIndex: "userId", width: 160, ellipsis: true },
            { title: "组织", width: 180, render: (_, row) => `${row.orgType} / ${row.orgUserId}` },
            { title: "页面", dataIndex: "route", ellipsis: true },
            { title: "对象", width: 160, render: (_, row) => `${row.targetType || "—"} ${row.targetId || ""}` },
          ]}
        />
      </Panel>
    </>
  );
}

/* ----------------------------------------------------------------- B3#26 */

/** 条款版本：平台维护服务协议 / 隐私政策等版本与生效时间，变更即要求重新接受。 */
export function GapsTermsTab() {
  const [rows, setRows] = useState<TermsDocument[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(
        (await gapsApi.termsDocuments({ query: { status: status || undefined } })) ?? [],
      );
      setError("");
    } catch (err) {
      setError(gapError(err));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const openEditor = (row?: TermsDocument) => {
    form.resetFields();
    if (row) {
      form.setFieldsValue({
        id: row.id,
        code: row.code,
        version: row.version,
        title: row.title,
        category: row.category,
        content: row.content,
        requireReaccept: row.requireReaccept,
        effectiveAt: row.effectiveAt ? dayjs(row.effectiveAt) : null,
        status: row.status,
      });
    } else {
      form.setFieldsValue({ category: "SERVICE", requireReaccept: true, status: "DRAFT" });
    }
    setOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      await gapsApi.saveTermsDocument({
        body: {
          ...values,
          effectiveAt: values.effectiveAt ? (values.effectiveAt as Dayjs).toISOString() : "",
        },
      });
      message.success("条款已保存");
      setOpen(false);
      await load();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(gapError(err));
    }
  };

  const columns: ColumnsType<TermsDocument> = [
    { title: "标题", dataIndex: "title" },
    { title: "编码", dataIndex: "code", width: 150 },
    { title: "版本", dataIndex: "version", width: 90 },
    { title: "分类", dataIndex: "categoryLabel", width: 110 },
    { title: "状态", width: 80, render: (_, row) => gapStatusTag(row.status) },
    {
      title: "接受情况",
      width: 130,
      render: (_, row) => `${row.acceptedCount} 人${row.myAccepted ? "（我已接受）" : ""}`,
    },
    { title: "生效时间", width: 150, render: (_, row) => (row.effectiveAt ? zhTime(row.effectiveAt) : "—") },
    {
      title: "操作",
      width: 140,
      render: (_, row) => (
        <>
          <Button size="small" type="link" onClick={() => openEditor(row)}>
            编辑
          </Button>
          <Button
            size="small"
            type="link"
            danger
            onClick={async () => {
              try {
                await gapsApi.removeTermsDocument({ body: { id: row.id } });
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
      title="条款版本与接受留痕"
      titleExtra="新版本生效后未接受的用户会被全站弹窗拦截；接受记录含 IP 与时间，可追溯到具体版本"
      extra={
        <Space>
          <Select
            allowClear
            placeholder="按状态筛选"
            style={{ width: 140 }}
            value={status || undefined}
            onChange={(value) => setStatus(value || "")}
            options={[
              { value: "DRAFT", label: "草稿" },
              { value: "ACTIVE", label: "生效" },
              { value: "ARCHIVED", label: "归档" },
            ]}
          />
          <Button type="primary" onClick={() => openEditor()}>
            新建条款
          </Button>
        </Space>
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1060 }}
        pagination={false}
      />

      <Modal
        open={open}
        title={form.getFieldValue("id") ? "编辑条款" : "新建条款"}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        width={860}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="code" label="编码" rules={[{ required: true, message: "请填写编码" }]} style={{ width: 180 }}>
              <Input maxLength={32} placeholder="service_terms" />
            </Form.Item>
            <Form.Item name="version" label="版本" rules={[{ required: true, message: "请填写版本" }]} style={{ width: 130 }}>
              <Input maxLength={24} placeholder="2026.11" />
            </Form.Item>
            <Form.Item name="category" label="分类" style={{ width: 140 }}>
              <Select
                options={TERMS_CATEGORIES.map((value) => ({
                  value,
                  label: TERMS_CATEGORY_LABELS[value],
                }))}
              />
            </Form.Item>
            <Form.Item name="status" label="状态" style={{ width: 110 }}>
              <Select
                options={[
                  { value: "DRAFT", label: "草稿" },
                  { value: "ACTIVE", label: "生效" },
                  { value: "ARCHIVED", label: "归档" },
                ]}
              />
            </Form.Item>
            <Form.Item name="requireReaccept" label="要求重新接受" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "请填写标题" }]}>
            <Input maxLength={160} />
          </Form.Item>
          <Form.Item name="effectiveAt" label="生效时间">
            <DatePicker showTime />
          </Form.Item>
          <Form.Item name="content" label="正文" rules={[{ required: true, message: "请填写正文" }]}>
            <Input.TextArea rows={12} maxLength={200000} />
          </Form.Item>
        </Form>
      </Modal>
    </Panel>
  );
}

/* ----------------------------------------------------------------- B3#28 */

/** 产品更新日志：后台维护版本条目，帮助中心公开展示已发布条目。 */
export function GapsChangelogTab() {
  const [rows, setRows] = useState<ChangelogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await gapsApi.changelogEntries({
        query: { page, pageSize: 20, status: status || undefined },
      });
      setRows(data?.list || []);
      setTotal(data?.total || 0);
      setError("");
    } catch (err) {
      setError(gapError(err));
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const openEditor = (row?: ChangelogEntry) => {
    form.resetFields();
    if (row) {
      form.setFieldsValue({
        id: row.id,
        version: row.version,
        title: row.title,
        summary: row.summary,
        body: row.body,
        category: row.category,
        releasedAt: row.releasedAt ? dayjs(row.releasedAt) : null,
        status: row.status,
      });
    } else {
      form.setFieldsValue({ category: "PRODUCT", status: "PUBLISHED" });
    }
    setOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      await gapsApi.saveChangelog({
        body: {
          ...values,
          releasedAt: values.releasedAt ? (values.releasedAt as Dayjs).toISOString() : "",
        },
      });
      message.success("更新日志已保存");
      setOpen(false);
      await load();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(gapError(err));
    }
  };

  const columns: ColumnsType<ChangelogEntry> = [
    { title: "版本", dataIndex: "version", width: 100 },
    { title: "标题", dataIndex: "title" },
    { title: "分类", dataIndex: "categoryLabel", width: 110 },
    { title: "状态", width: 80, render: (_, row) => gapStatusTag(row.status) },
    { title: "发布时间", width: 150, render: (_, row) => (row.releasedAt ? zhTime(row.releasedAt) : "—") },
    { title: "创建时间", width: 150, render: (_, row) => zhTime(row.createdAt) },
    {
      title: "操作",
      width: 140,
      render: (_, row) => (
        <>
          <Button size="small" type="link" onClick={() => openEditor(row)}>
            编辑
          </Button>
          <Button
            size="small"
            type="link"
            danger
            onClick={async () => {
              try {
                await gapsApi.removeChangelog({ body: { id: row.id } });
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
      title="产品更新日志"
      titleExtra="已发布条目在帮助中心公开可见；草稿仅在后台保留"
      extra={
        <Space>
          <Select
            allowClear
            placeholder="按状态筛选"
            style={{ width: 140 }}
            value={status || undefined}
            onChange={(value) => {
              setStatus(value || "");
              setPage(1);
            }}
            options={[
              { value: "DRAFT", label: "草稿" },
              { value: "PUBLISHED", label: "已发布" },
            ]}
          />
          <Button type="primary" onClick={() => openEditor()}>
            新建条目
          </Button>
        </Space>
      }
    >
      {error ? <Notice variant="error">{error}</Notice> : null}
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 980 }}
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
        title={form.getFieldValue("id") ? "编辑更新日志" : "新建更新日志"}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        width={760}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Space style={{ display: "flex" }} wrap>
            <Form.Item name="version" label="版本" rules={[{ required: true, message: "请填写版本" }]} style={{ width: 150 }}>
              <Input maxLength={32} placeholder="v1.20.0" />
            </Form.Item>
            <Form.Item name="category" label="分类" style={{ width: 150 }}>
              <Select
                options={Object.entries(CHANGELOG_CATEGORY_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </Form.Item>
            <Form.Item name="status" label="状态" style={{ width: 120 }}>
              <Select
                options={[
                  { value: "DRAFT", label: "草稿" },
                  { value: "PUBLISHED", label: "已发布" },
                ]}
              />
            </Form.Item>
            <Form.Item name="releasedAt" label="发布时间">
              <DatePicker showTime />
            </Form.Item>
          </Space>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "请填写标题" }]}>
            <Input maxLength={160} />
          </Form.Item>
          <Form.Item name="summary" label="摘要">
            <Input.TextArea rows={3} maxLength={5000} />
          </Form.Item>
          <Form.Item name="body" label="正文">
            <Input.TextArea rows={10} maxLength={100000} />
          </Form.Item>
        </Form>
      </Modal>
    </Panel>
  );
}
