"use client";

import { App, Button, Form, Input, InputNumber, Modal, Select, Space } from "antd";
import { MinusCircleOutlined, PlusOutlined, SettingOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { SEO_KEY_PAGE_ROLES, SEO_KEY_PAGE_ROLE_LABELS } from "@enterprise/contracts";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { ColumnSwitch, EmptyState, Notice, Panel } from "@/components/ui/panel";
import { useSeoActions, useSeoProjects } from "@/query/seo";
import { presentMutationError } from "@/query/errors";
import { domainOf, splitLines, type SeoProject } from "./seo-common";
import { SeoSettingsDrawer } from "./seo-settings-drawer";
import { SeoOverviewView } from "./seo-overview-view";
import { SeoAuditView } from "./seo-audit-view";
import { SeoKeywordsView } from "./seo-keywords-view";
import { SeoRankView } from "./seo-rank-view";
import { SeoCompetitorsView } from "./seo-competitors-view";
import { SeoBacklinksView } from "./seo-backlinks-view";
import { SeoLocalView } from "./seo-local-view";
import { SeoProgrammaticView } from "./seo-programmatic-view";
import { SeoSchemaView } from "./seo-schema-view";
import { SeoReportsView } from "./seo-reports-view";

const VIEWS = [
  { value: "overview", label: "概览" },
  { value: "audit", label: "站点体检" },
  { value: "keywords", label: "关键词" },
  { value: "rank", label: "排名跟踪" },
  { value: "competitors", label: "竞品洞察" },
  { value: "backlinks", label: "外链" },
  { value: "local", label: "本地 SEO" },
  { value: "programmatic", label: "程序化页面" },
  { value: "schema", label: "结构化与收录" },
  { value: "reports", label: "SEO 报告" },
];

const EMPTY_PROJECT = {
  domain: "",
  brandName: "",
  locationCode: 2840,
  languageCode: "en",
  competitors: "",
  keyPages: [] as { url: string; role: string }[],
  note: "",
};

/** SEO 优化工作台：项目 → 十个视图；三层数据源（自有抓取免费 / DataForSEO 自带 Key / 系统 LLM 计积分）。 */
export function SeoTab() {
  const { message } = App.useApp();
  const actions = useSeoActions();
  const { request, modal } = usePasswordConfirm();
  const projectsQuery = useSeoProjects();
  const projects = projectsQuery.data ?? [];
  const [projectId, setProjectId] = useState<number | null>(null);
  const [view, setView] = useState("overview");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SeoProject | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    if (!projectsQuery.data) return;
    const list = projectsQuery.data;
    setProjectId((current) => (current && list.some((p) => p.id === current) ? current : list[0]?.id ?? null));
  }, [projectsQuery.data]);

  const current = projects.find((p) => p.id === projectId) ?? null;

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue(EMPTY_PROJECT);
    setFormOpen(true);
  };
  const openEdit = () => {
    if (!current) return;
    setEditing(current);
    form.setFieldsValue({
      domain: current.domain,
      brandName: current.brandName,
      locationCode: current.locationCode,
      languageCode: current.languageCode,
      competitors: current.competitors.join(","),
      keyPages: current.keyPages,
      note: current.note,
    });
    setFormOpen(true);
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      const body = {
        domain: domainOf(values.domain),
        brandName: values.brandName ?? "",
        locationCode: values.locationCode ?? 2840,
        languageCode: values.languageCode ?? "en",
        competitors: splitLines(values.competitors ?? "").map(domainOf).slice(0, 20),
        keyPages: (values.keyPages ?? []).filter((p: { url: string }) => p?.url?.trim()).map((p: { url: string; role: string }) => ({ url: p.url.trim(), role: p.role || "OTHER" })),
        note: values.note ?? "",
        ...(editing ? { id: editing.id } : {}),
      };
      setSaving(true);
      if (editing) {
        const target = editing;
        setFormOpen(false);
        request({
          title: "修改 SEO 项目（需密码）",
          content: `确认修改项目「${target.domain}」？`,
          okText: "保存修改",
          onOk: async () => { await actions.updateProject.mutateAsync({ body }); message.success("已保存修改"); setEditing(null); },
        });
      } else {
        const p = await actions.createProject.mutateAsync({ body });
        message.success("SEO 项目已创建");
        setFormOpen(false);
        if (p?.id) setProjectId(p.id);
      }
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally {
      setSaving(false);
    }
  };

  const removeProject = () => {
    if (!current) return;
    request({
      title: "删除 SEO 项目",
      danger: true,
      okText: "确认删除",
      content: `确认删除项目「${current.domain}」？其体检、关键词、排名、竞品、外链、本地、程序化页面与报告一并删除，不可恢复。`,
      onOk: async () => { await actions.removeProject.mutateAsync({ body: { id: current.id } }); message.success("项目已删除"); setProjectId(null); },
    });
  };

  return (
    <Panel
      title="SEO 优化"
      extra={
        <Space wrap style={{ margin: 0 }}>
          <Select
            value={projectId ?? undefined}
            placeholder="选择站点项目"
            style={{ minWidth: 220 }}
            loading={projectsQuery.isPending}
            options={projects.map((p) => ({ value: p.id, label: `${p.domain}${p.brandName ? `（${p.brandName}）` : ""}` }))}
            onChange={setProjectId}
          />
          <Button type="primary" onClick={openCreate}>＋ 新建项目</Button>
          {current ? <><Button onClick={openEdit}>项目设置</Button><Button danger onClick={removeProject}>删除项目</Button></> : null}
          <Button icon={<SettingOutlined aria-hidden />} onClick={() => setSettingsOpen(true)}>数据源设置</Button>
        </Space>
      }
    >
      {projectsQuery.isError ? <Notice variant="warn">{projectsQuery.error?.message}</Notice> : null}
      <ColumnSwitch value={view} onChange={setView} options={VIEWS} />
      {!current ? (
        <EmptyState text="尚未创建 SEO 项目：新建项目（填站点域名）后，即可做站点体检、关键词研究、排名跟踪等；实测数据源在右上角「数据源设置」里配你自己的 Key" />
      ) : (
        <>
          {view === "overview" ? <SeoOverviewView projectId={current.id} onNavigate={setView} /> : null}
          {view === "audit" ? <SeoAuditView project={current} /> : null}
          {view === "keywords" ? <SeoKeywordsView project={current} /> : null}
          {view === "rank" ? <SeoRankView project={current} /> : null}
          {view === "competitors" ? <SeoCompetitorsView project={current} /> : null}
          {view === "backlinks" ? <SeoBacklinksView project={current} /> : null}
          {view === "local" ? <SeoLocalView project={current} /> : null}
          {view === "programmatic" ? <SeoProgrammaticView project={current} /> : null}
          {view === "schema" ? <SeoSchemaView project={current} /> : null}
          {view === "reports" ? <SeoReportsView project={current} /> : null}
        </>
      )}

      <Modal open={formOpen} title={editing ? "修改 SEO 项目（需密码）" : "新建 SEO 项目"} width={680} okText={editing ? "保存修改" : "创建项目"} confirmLoading={saving} onCancel={() => { setFormOpen(false); setEditing(null); }} onOk={() => void save()}>
        <Form form={form} layout="vertical" initialValues={EMPTY_PROJECT}>
          <div className="form-2col">
            <Form.Item name="domain" label="站点域名 *" rules={[{ required: true, message: "请填写站点域名" }]}><Input placeholder="example.com" /></Form.Item>
            <Form.Item name="brandName" label="品牌名"><Input placeholder="如：星链传媒" /></Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="locationCode" label="默认地区码（DataForSEO）"><InputNumber style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="languageCode" label="默认语言码"><Input placeholder="en / zh-CN" /></Form.Item>
          </div>
          <Form.Item name="competitors" label="竞品域名（逗号分隔，最多 20）"><Input placeholder="competitor1.com,competitor2.com" /></Form.Item>
          <Form.Item label="关键页面（逐条添加，最多 50）">
            <Form.List name="keyPages">
              {(fields, { add, remove }) => (
                <div style={{ display: "grid", gap: 8 }}>
                  {fields.map((field) => (
                    <Space key={field.key} align="baseline" style={{ display: "flex" }}>
                      <Form.Item {...field} name={[field.name, "url"]} style={{ marginBottom: 0, flex: 1 }} rules={[{ required: true, message: "填 URL" }]}>
                        <Input placeholder="https://example.com/page" style={{ width: 320 }} />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, "role"]} style={{ marginBottom: 0 }} initialValue="CONTENT">
                        <Select style={{ width: 110 }} options={SEO_KEY_PAGE_ROLES.map((r) => ({ value: r, label: SEO_KEY_PAGE_ROLE_LABELS[r] }))} />
                      </Form.Item>
                      <MinusCircleOutlined onClick={() => remove(field.name)} aria-hidden />
                    </Space>
                  ))}
                  <Button type="dashed" onClick={() => add({ url: "", role: "CONTENT" })} icon={<PlusOutlined aria-hidden />} block>添加关键页面</Button>
                </div>
              )}
            </Form.List>
          </Form.Item>
          <Form.Item name="note" label="备注"><Input.TextArea rows={2} placeholder="站点范围、目标市场等" /></Form.Item>
        </Form>
      </Modal>
      <SeoSettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {modal}
    </Panel>
  );
}