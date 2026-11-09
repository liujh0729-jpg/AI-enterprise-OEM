"use client";

import { App, Button, Form, Input, Select, Space, Table, Tag } from "antd";
import { useState } from "react";
import { SEO_SCHEMA_TYPES } from "@enterprise/contracts";
import { Notice, Panel, PillTabs } from "@/components/ui/panel";
import { fmtDateTime } from "@/lib/datetime";
import { downloadText } from "@/lib/download";
import {
  useSeoActions,
  useSeoBaiduCredential,
  useSeoBaiduHistory,
  useSeoIndexnowHistory,
} from "@/query/seo";
import { presentMutationError } from "@/query/errors";
import { schemaTypeLabel, splitLines, type SeoProject } from "./seo-common";

/** 结构化数据与收录：JSON-LD 生成/校验 + IndexNow（ Bing 等）/ 百度主动提交。 */
export function SeoSchemaView({ project }: { project: SeoProject }) {
  const [tab, setTab] = useState("schema");
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <PillTabs items={[{ key: "schema", label: "结构化数据" }, { key: "indexing", label: "收录提交" }]} value={tab} onChange={setTab} variant="soft" />
      {tab === "schema" ? <SchemaPanel project={project} /> : <IndexingPanel project={project} />}
    </div>
  );
}

const FIELD_PRESETS: Record<string, { name: string; label: string; textarea?: boolean; placeholder?: string }[]> = {
  ARTICLE: [
    { name: "headline", label: "标题 headline" },
    { name: "author", label: "作者 author" },
    { name: "datePublished", label: "发布日期 datePublished", placeholder: "2026-01-01" },
    { name: "description", label: "描述 description", textarea: true },
    { name: "image", label: "配图 URL image" },
  ],
  PRODUCT: [
    { name: "name", label: "产品名 name" },
    { name: "description", label: "描述 description", textarea: true },
    { name: "brand", label: "品牌 brand" },
    { name: "price", label: "价格 price" },
    { name: "priceCurrency", label: "币种 priceCurrency", placeholder: "USD / CNY" },
    { name: "availability", label: "库存 availability", placeholder: "InStock / OutOfStock" },
  ],
  FAQ: [{ name: "questions", label: "问答（每行「问题|答案」）", textarea: true, placeholder: "如何下单|在商品页点立即购买\n支持哪些支付|微信 / 支付宝" }],
  ORGANIZATION: [
    { name: "name", label: "组织名 name" },
    { name: "url", label: "官网 url" },
    { name: "logo", label: "Logo URL" },
    { name: "description", label: "描述 description", textarea: true },
  ],
  BREADCRUMB: [{ name: "items", label: "面包屑（每行「名称|URL」，至少两级）", textarea: true, placeholder: "首页|https://example.com/\n产品|https://example.com/products/" }],
};

function SchemaPanel({ project }: { project: SeoProject }) {
  const { message } = App.useApp();
  const actions = useSeoActions();
  const [type, setType] = useState<string>("ARTICLE");
  const [form] = Form.useForm();
  const [result, setResult] = useState<{ jsonLd: string; valid: boolean; issues: string[]; mode: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [validateRaw, setValidateRaw] = useState("");

  const generate = async () => {
    try {
      const values = await form.validateFields();
      setBusy("gen");
      const fields: Record<string, string> = {};
      for (const preset of FIELD_PRESETS[type] ?? []) {
        const v = values[preset.name];
        if (typeof v === "string" && v.trim()) fields[preset.name] = v.trim();
      }
      const r = await actions.generateSchema.mutateAsync({ body: { projectId: project.id, type: type as (typeof SEO_SCHEMA_TYPES)[number], pageUrl: values.pageUrl ?? "", fields } });
      setResult(r ?? null);
      if (r && !r.valid) message.warning("已生成，但校验有问题项，请按提示补全");
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally { setBusy(""); }
  };

  const validate = async () => {
    if (!validateRaw.trim()) { message.warning("请粘贴 JSON-LD"); return; }
    setBusy("val");
    try {
      const r = await actions.validateSchema.mutateAsync({ body: { jsonLd: validateRaw, pageUrl: "" } });
      setResult(r ?? null);
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally { setBusy(""); }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel title="生成 JSON-LD">
        <Notice variant="info">确定性生成结构化数据，不编造字段；可选 AI 仅补全空白的描述/标题（计积分，无 Key 时规则降级）。生成后把 JSON-LD 贴进页面 &lt;head&gt; 的 &lt;script type=&quot;application/ld+json&quot;&gt;。</Notice>
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <div className="form-2col">
            <Form.Item label="类型"><Select value={type} onChange={(v) => { setType(v); setResult(null); form.resetFields(); }} options={SEO_SCHEMA_TYPES.map((t) => ({ value: t, label: schemaTypeLabel(t) }))} /></Form.Item>
            <Form.Item name="pageUrl" label="页面 URL（可选）"><Input placeholder={`https://${project.domain}/page`} /></Form.Item>
          </div>
          {(FIELD_PRESETS[type] ?? []).map((preset) => (
            <Form.Item key={preset.name} name={preset.name} label={preset.label}>
              {preset.textarea ? <Input.TextArea rows={3} placeholder={preset.placeholder} /> : <Input placeholder={preset.placeholder} />}
            </Form.Item>
          ))}
          <Button type="primary" loading={busy === "gen"} onClick={() => void generate()}>生成</Button>
        </Form>
      </Panel>

      <Panel title="校验已有 JSON-LD">
        <Input.TextArea rows={5} placeholder='粘贴 JSON-LD，如 {"@context":"https://schema.org","@type":"Article",...}' value={validateRaw} onChange={(e) => setValidateRaw(e.target.value)} />
        <Button style={{ marginTop: 10 }} loading={busy === "val"} onClick={() => void validate()}>校验</Button>
      </Panel>

      {result ? (
        <Panel title="结果" titleExtra={<Tag color={result.valid ? "green" : "red"}>{result.valid ? "校验通过" : "有问题项"}</Tag>}>
          {result.issues.length ? <Notice variant="warn"><ul style={{ margin: 0, paddingLeft: 18 }}>{result.issues.map((s, i) => <li key={i}>{s}</li>)}</ul></Notice> : null}
          <Input.TextArea rows={10} value={result.jsonLd} readOnly style={{ marginTop: 12, fontFamily: "monospace" }} />
          <Space style={{ marginTop: 10 }}>
            <Button onClick={() => { void navigator.clipboard.writeText(result.jsonLd).then(() => message.success("已复制 JSON-LD")); }}>复制</Button>
            <Button
              onClick={() => {
                try {
                  downloadText(`jsonld-${type.toLowerCase()}-${project.id}.json`, JSON.stringify(JSON.parse(result.jsonLd), null, 2), "application/ld+json;charset=utf-8");
                  message.success("已导出 .json");
                } catch {
                  message.error("JSON-LD 不是合法 JSON，无法导出");
                }
              }}
            >
              导出 .json
            </Button>
            <span className="text-12 muted">{result.mode === "llm" ? "AI 补全" : "规则生成"}</span>
          </Space>
        </Panel>
      ) : null}
    </div>
  );
}

function IndexingPanel({ project }: { project: SeoProject }) {
  const { message } = App.useApp();
  const actions = useSeoActions();
  const indexnowHistory = useSeoIndexnowHistory(project.id);
  const baiduCredential = useSeoBaiduCredential(project.id);
  const baiduHistory = useSeoBaiduHistory(project.id);
  const [key, setKey] = useState<{ keyValue: string; verifiedAt: string | null; keyFileUrl: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [indexUrls, setIndexUrls] = useState("");
  const [baiduUrls, setBaiduUrls] = useState("");
  const [baiduForm] = Form.useForm();

  const run = async (k: string, fn: () => Promise<unknown>) => {
    setBusy(k);
    try { await fn(); } catch (error) { if (error instanceof Error) presentMutationError(error, (t) => message.error(t)); } finally { setBusy(""); }
  };

  const setup = () => void run("setup", async () => { const r = await actions.setupIndexnow.mutateAsync({ body: { projectId: project.id } }); setKey(r ?? null); message.success("已生成 IndexNow key，请把 key 文件部署到站点根目录后点「验证」"); });
  const verify = () => void run("verify", async () => { const r = await actions.verifyIndexnow.mutateAsync({ body: { projectId: project.id } }); setKey(r ?? null); if (r?.verifiedAt) message.success("验证通过，可提交 URL"); else message.warning("未验证：请确认 key 文件已部署且内容一致"); });
  const submitIndex = () => {
    const urls = splitLines(indexUrls);
    if (!urls.length) { message.warning("请填至少一个 URL"); return; }
    void run("submitIndex", async () => { await actions.submitIndexnow.mutateAsync({ body: { projectId: project.id, urls } }); message.success("已提交 IndexNow（成功提交不等于已收录）"); setIndexUrls(""); void indexnowHistory.refetch(); });
  };

  const saveBaidu = async () => {
    try {
      const values = await baiduForm.validateFields();
      setBusy("baiduSave");
      await actions.saveBaiduCredential.mutateAsync({ body: { projectId: project.id, site: values.site, token: values.token ?? "" } });
      message.success("百度凭据已保存（保存前已用一条 URL 探测验证）");
      baiduForm.setFieldsValue({ token: "" });
      void baiduCredential.refetch();
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally { setBusy(""); }
  };
  const submitBaidu = () => {
    const urls = splitLines(baiduUrls);
    if (!urls.length) { message.warning("请填至少一个 URL"); return; }
    void run("submitBaidu", async () => { const r = await actions.submitBaidu.mutateAsync({ body: { projectId: project.id, urls } }); message.success(`百度返回成功 ${r?.success ?? 0} 条（成功提交不等于已收录）`); setBaiduUrls(""); void baiduHistory.refetch(); });
  };

  const credential = baiduCredential.data;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel title="IndexNow（Bing / Yandex 等参与方）">
        <Notice variant="warn">诚实口径：Google 与百度不参与 IndexNow；提交成功只代表搜索引擎收到通知，不等于已收录。key 文件需部署在你自有域名根目录。</Notice>
        <Space wrap style={{ margin: "12px 0" }}>
          <Button loading={busy === "setup"} onClick={setup}>生成 key</Button>
          <Button loading={busy === "verify"} disabled={!key} onClick={verify}>验证 key 文件</Button>
          {key?.verifiedAt ? <Tag color="green">已验证 {fmtDateTime(key.verifiedAt)}</Tag> : key ? <Tag>未验证</Tag> : null}
        </Space>
        {key ? (
          <div className="text-12" style={{ display: "grid", gap: 4, marginBottom: 12 }}>
            <div>key：<span className="mono">{key.keyValue}</span></div>
            <div>需部署的文件地址：<span className="mono">{key.keyFileUrl}</span>（文件内容即 key 本身）</div>
          </div>
        ) : null}
        <Input.TextArea rows={3} placeholder="每行一个同域名 URL（最多 1000）" value={indexUrls} onChange={(e) => setIndexUrls(e.target.value)} />
        <Button type="primary" style={{ marginTop: 10 }} loading={busy === "submitIndex"} disabled={!key?.verifiedAt} onClick={submitIndex}>提交 URL</Button>
        <Table
          rowKey="id"
          size="small"
          style={{ marginTop: 12 }}
          dataSource={indexnowHistory.data ?? []}
          pagination={{ pageSize: 5, showSizeChanger: false }}
          columns={[
            { title: "URL 数", width: 80, render: (_: unknown, r: { urls: string[] }) => r.urls.length },
            { title: "响应码", dataIndex: "responseCode", width: 90 },
            { title: "提交人", dataIndex: "submittedBy", width: 120 },
            { title: "时间", dataIndex: "createdAt", width: 160, render: fmtDateTime },
          ]}
          locale={{ emptyText: "暂无提交记录" }}
        />
      </Panel>

      <Panel title="百度主动提交（站长平台）" titleExtra={credential?.configured ? <Tag color="green">已配置</Tag> : <Tag>未配置</Tag>}>
        <Notice variant="warn">百度推送接口仅支持 HTTP（官方域名 data.zz.baidu.com）；保存前会用一条 URL 探测验证凭据与站点归属。成功提交不等于已收录。</Notice>
        <Form form={baiduForm} layout="vertical" style={{ marginTop: 12 }} initialValues={{ site: credential?.site || `https://${project.domain}/` }}>
          <div className="form-2col">
            <Form.Item name="site" label="站点 site *" rules={[{ required: true, message: "请填写站点" }]}><Input placeholder="https://example.com/" /></Form.Item>
            <Form.Item name="token" label="推送 token" rules={[{ required: !credential?.configured, message: "请填写 token" }]}><Input.Password placeholder={credential?.configured ? "已配置（留空则不修改）" : "百度站长平台 → 普通收录 → 推送 token"} autoComplete="new-password" /></Form.Item>
          </div>
          <Button loading={busy === "baiduSave"} onClick={() => void saveBaidu()}>保存凭据（先探测）</Button>
        </Form>
        <Input.TextArea rows={3} style={{ marginTop: 12 }} placeholder="每行一个同站点 URL（最多 2000）" value={baiduUrls} onChange={(e) => setBaiduUrls(e.target.value)} />
        <Button type="primary" style={{ marginTop: 10 }} loading={busy === "submitBaidu"} disabled={!credential?.configured} onClick={submitBaidu}>提交 URL</Button>
        <Table
          rowKey="id"
          size="small"
          style={{ marginTop: 12 }}
          dataSource={baiduHistory.data ?? []}
          pagination={{ pageSize: 5, showSizeChanger: false }}
          columns={[
            { title: "成功", dataIndex: "success", width: 80 },
            { title: "剩余配额", dataIndex: "remain", width: 100, render: (v: number | null) => (v === null ? "—" : v) },
            { title: "无效 URL", width: 90, render: (_: unknown, r: { notValid: string[] }) => r.notValid.length },
            { title: "提交人", dataIndex: "submittedBy", width: 120 },
            { title: "时间", dataIndex: "createdAt", width: 160, render: fmtDateTime },
          ]}
          locale={{ emptyText: "暂无提交记录" }}
        />
      </Panel>
    </div>
  );
}