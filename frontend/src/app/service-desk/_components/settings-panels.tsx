"use client";

import {
  Button,
  Descriptions,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import { useEffect, useState } from "react";
import type {
  ServiceDeskSettings,
  ServiceDeskSite,
  ServiceDeskStats,
} from "@enterprise/contracts";
import { serviceDeskApi } from "@/api/collab";
import { Panel } from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";
import { useSiteBase } from "@/lib/site-brand";

/** 表单口径＝接待设置去掉只读的中文标签列；保存接口按同一形状收字段。 */
type SettingsForm = Omit<ServiceDeskSettings, "aiModeLabel">;

export function SettingsPanel() {
  const [form, setForm] = useState<Partial<SettingsForm>>({});
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void serviceDeskApi
      .settings()
      .then((data) => {
        setForm(data || {});
        setLoaded(true);
      })
      .catch((error) => message.error((error as Error).message || "加载失败"));
  }, []);

  const save = async () => {
    try {
      setSaving(true);
      const payload: Partial<SettingsForm> = {
        businessHours: form.businessHours || {},
        welcomeText: String(form.welcomeText || ""),
        queueText: String(form.queueText || ""),
        offlineText: String(form.offlineText || ""),
        autoAssign: Boolean(form.autoAssign),
        maxConcurrent: Number(form.maxConcurrent || 5),
        ratingEnabled: Boolean(form.ratingEnabled),
        aiMode: String(form.aiMode || "CANNED"),
        aiChannelId: Number(form.aiChannelId || 0),
        aiModel: String(form.aiModel || ""),
        aiHandoffKeywords: Array.isArray(form.aiHandoffKeywords)
          ? form.aiHandoffKeywords
          : String(form.aiHandoffKeywords || "")
              .split(/[,，\s]+/)
              .filter(Boolean),
        libraryIds: Array.isArray(form.libraryIds) ? form.libraryIds : [],
        requireContact: Boolean(form.requireContact),
        retentionDays: Number(form.retentionDays || 180),
      };
      const data = await serviceDeskApi.saveSettings({ body: payload });
      setForm(data || {});
      message.success("设置已保存");
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <div className="muted">加载中…</div>;

  return (
    <Panel title="接待设置">
      <div className="sd-form">
      <div className="sd-form-grid">
        <label>
          欢迎语
          <Input.TextArea
            rows={2}
            value={form.welcomeText}
            onChange={(event) => setForm({ ...form, welcomeText: event.target.value })}
          />
        </label>
        <label>
          排队提示
          <Input.TextArea
            rows={2}
            value={form.queueText}
            onChange={(event) => setForm({ ...form, queueText: event.target.value })}
          />
        </label>
        <label>
          离线留言提示
          <Input.TextArea
            rows={2}
            value={form.offlineText}
            onChange={(event) => setForm({ ...form, offlineText: event.target.value })}
          />
        </label>
        <label>
          同时接待上限（默认 5）
          <InputNumber
            min={1}
            max={50}
            value={form.maxConcurrent ?? 5}
            onChange={(value) => setForm({ ...form, maxConcurrent: value ?? undefined })}
          />
        </label>
        <label className="sd-switch-row">
          <span>自动分配（在线客服里选最少的）</span>
          <Switch
            checked={Boolean(form.autoAssign)}
            onChange={(value) => setForm({ ...form, autoAssign: value })}
          />
        </label>
        <label className="sd-switch-row">
          <span>结束后邀请评分</span>
          <Switch
            checked={Boolean(form.ratingEnabled)}
            onChange={(value) => setForm({ ...form, ratingEnabled: value })}
          />
        </label>
        <label className="sd-switch-row">
          <span>咨询前必须留下联系方式</span>
          <Switch
            checked={Boolean(form.requireContact)}
            onChange={(value) => setForm({ ...form, requireContact: value })}
          />
        </label>
        <label>
          会话保留天数
          <InputNumber
            min={7}
            max={3650}
            value={form.retentionDays ?? 180}
            onChange={(value) => setForm({ ...form, retentionDays: value ?? undefined })}
          />
        </label>
        <label>
          资料库 ID（逗号分隔，供 AI 引用）
          <Input
            value={
              Array.isArray(form.libraryIds)
                ? form.libraryIds.join(",")
                : String(form.libraryIds || "")
            }
            onChange={(event) =>
              setForm({
                ...form,
                libraryIds: event.target.value
                  .split(/[,，\s]+/)
                  .map((item) => Number(item))
                  .filter((item) => Number.isFinite(item) && item > 0),
              })
            }
            placeholder="例如 3,5"
          />
        </label>
      </div>

      <h4 className="sd-form-title">AI 助手</h4>
      <Radio.Group
        value={String(form.aiMode || "CANNED")}
        onChange={(event) => setForm({ ...form, aiMode: event.target.value })}
      >
        <Space orientation="vertical">
          <Radio value="OFF">关闭（纯人工）</Radio>
          <Radio value="CANNED">固定文案：只按欢迎语与固定问答回复，不调用模型</Radio>
          <Radio value="SUGGEST">手动建议：客服点「AI 建议」生成草稿，不会自动发送</Radio>
          <Radio value="AUTO">自动回复：AI 先接待，命中关键词或不确定时转人工</Radio>
          <Radio value="BOT">自动回复：纯AI接待，不转人工</Radio>
        </Space>
      </Radio.Group>
      <div className="sd-form-grid" style={{ marginTop: 12 }}>
        <label>
          转人工关键词（逗号分隔）
          <Input
            value={
              Array.isArray(form.aiHandoffKeywords)
                ? form.aiHandoffKeywords.join(",")
                : String(form.aiHandoffKeywords || "")
            }
            onChange={(event) =>
              setForm({
                ...form,
                aiHandoffKeywords: event.target.value
                  .split(/[,，\s]+/)
                  .filter(Boolean),
              })
            }
            placeholder="退款,投诉,人工"
          />
        </label>
        <label>
          AI 模型（留空＝用「模型设置」的文本默认）
          <Input
            value={String(form.aiModel || "")}
            onChange={(event) => setForm({ ...form, aiModel: event.target.value })}
            placeholder="例如 qwen3.8-max"
          />
        </label>
      </div>

      <div className="sd-form-actions">
        <Button type="primary" loading={saving} onClick={() => void save()}>
          保存设置
        </Button>
      </div>
      </div>
    </Panel>
  );
}

export function KnowledgePanel() {
  const [canned, setCanned] = useState<
    { id: number; scope: string; title: string; content: string; category: string }[]
  >([]);
  const [faqs, setFaqs] = useState<
    { id: number; question: string; keywords: string; answer: string; enabled: boolean }[]
  >([]);
  const [cannedOpen, setCannedOpen] = useState(false);
  const [faqOpen, setFaqOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const load = async () => {
    try {
      const [a, b] = await Promise.all([serviceDeskApi.canned(), serviceDeskApi.faqs()]);
      setCanned(a || []);
      setFaqs(b || []);
    } catch (error) {
      message.error((error as Error).message || "加载失败");
    }
  };

  useEffect(() => {
    void load();
     
  }, []);

  return (
    <div className="sd-two-col">
      <Panel
        title="常用语"
        extra={
          <Button
            onClick={() => {
              setDraft({ title: "", content: "" });
              setCannedOpen(true);
            }}
          >
            新建
          </Button>
        }
      >
        <Table
          rowKey="id"
          dataSource={canned}
          pagination={false}
          columns={[
            { title: "标题", dataIndex: "title", width: 160 },
            { title: "内容", dataIndex: "content", ellipsis: true },
            {
              title: "操作",
              width: 80,
              render: (_: unknown, row: { id: number }) => (
                <Button
                  type="link"
                  danger
                  onClick={async () => {
                    await serviceDeskApi.removeCanned({ params: { id: String(row.id) } });
                    void load();
                  }}
                >
                  删除
                </Button>
              ),
            },
          ]}
        />
      </Panel>
      <Panel
        title="固定问答（AI 与固定文案共用）"
        extra={
          <Button
            onClick={() => {
              setDraft({ question: "", keywords: "", answer: "" });
              setFaqOpen(true);
            }}
          >
            新建
          </Button>
        }
      >
        <Table
          rowKey="id"
          dataSource={faqs}
          pagination={false}
          columns={[
            { title: "问题", dataIndex: "question", width: 180 },
            { title: "关键词", dataIndex: "keywords", width: 140 },
            { title: "答案", dataIndex: "answer", ellipsis: true },
            {
              title: "操作",
              width: 80,
              render: (_: unknown, row: { id: number }) => (
                <Button
                  type="link"
                  danger
                  onClick={async () => {
                    await serviceDeskApi.removeFaq({ params: { id: String(row.id) } });
                    void load();
                  }}
                >
                  删除
                </Button>
              ),
            },
          ]}
        />
      </Panel>
      <Modal
        open={cannedOpen}
        title="新建常用语"
        onCancel={() => setCannedOpen(false)}
        onOk={async () => {
          if (!draft.title?.trim() || !draft.content?.trim()) {
            message.warning("标题与内容都要填写");
            return;
          }
          await serviceDeskApi.saveCanned({
            body: {
              scope: "shared",
              title: draft.title || "",
              content: draft.content || "",
              category: "",
              sort: 0,
            },
          });
          setCannedOpen(false);
          void load();
        }}
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Input
            placeholder="标题"
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
          <Input.TextArea
            rows={4}
            placeholder="回复内容"
            value={draft.content}
            onChange={(event) => setDraft({ ...draft, content: event.target.value })}
          />
        </Space>
      </Modal>
      <Modal
        open={faqOpen}
        title="新建固定问答"
        onCancel={() => setFaqOpen(false)}
        onOk={async () => {
          if (!draft.question?.trim() || !draft.answer?.trim()) {
            message.warning("问题与答案都要填写");
            return;
          }
          await serviceDeskApi.saveFaq({
            body: {
              question: draft.question || "",
              keywords: draft.keywords || "",
              answer: draft.answer || "",
              enabled: true,
            },
          });
          setFaqOpen(false);
          void load();
        }}
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Input
            placeholder="问题"
            value={draft.question}
            onChange={(event) => setDraft({ ...draft, question: event.target.value })}
          />
          <Input
            placeholder="关键词（逗号分隔）"
            value={draft.keywords}
            onChange={(event) => setDraft({ ...draft, keywords: event.target.value })}
          />
          <Input.TextArea
            rows={4}
            placeholder="答案"
            value={draft.answer}
            onChange={(event) => setDraft({ ...draft, answer: event.target.value })}
          />
        </Space>
      </Modal>
    </div>
  );
}

const ICON_TYPES = /\.(png|jpe?g|webp|gif)$/i;

const readBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(String(reader.result || "").replace(/^data:[^,]+,/, ""));
    reader.onerror = () => reject(new Error("读取图标失败"));
    reader.readAsDataURL(file);
  });

export function SitesPanel() {
  const [rows, setRows] = useState<ServiceDeskSite[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceDeskSite | null>(null);
  const [name, setName] = useState("");
  const [origins, setOrigins] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  // 嵌入脚本的域名：客户官网引用必须用绝对地址，跟站点域名走
  const origin = useSiteBase();

  const load = async () => {
    try {
      setRows((await serviceDeskApi.sites()) || []);
    } catch (error) {
      message.error((error as Error).message || "加载失败");
    }
  };

  useEffect(() => {
    void load();
     
  }, []);

  const openEditor = (site: ServiceDeskSite | null) => {
    setEditing(site);
    setName(site?.name || "");
    setOrigins((site?.allowedOrigins || []).join("、"));
    setIconUrl(
      typeof site?.appearance?.avatar === "string" ? site.appearance.avatar : "",
    );
    setOpen(true);
  };

  const uploadIcon = async (file: File) => {
    if (!ICON_TYPES.test(file.name)) {
      message.warning("图标仅支持 PNG / JPG / WEBP / GIF");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      message.warning("图标不能超过 2MB");
      return;
    }
    setUploading(true);
    try {
      const result = await serviceDeskApi.uploadIcon({
        body: {
          name: file.name,
          contentType: file.type || "application/octet-stream",
          contentBase64: await readBase64(file),
        },
      });
      if (result?.url) setIconUrl(result.url);
    } catch (error) {
      message.error((error as Error).message || "图标上传失败");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!name.trim()) {
      message.warning("请填写站点名称");
      return;
    }
    const current = (editing?.appearance || {}) as Record<string, unknown>;
    await serviceDeskApi.saveSite({
      body: {
        ...(editing ? { id: editing.id } : {}),
        name: name.trim(),
        allowedOrigins: origins
          .split(/[,，、\s]+/)
          .map((item) => item.trim())
          .filter(Boolean),
        appearance: {
          title: typeof current.title === "string" ? current.title : undefined,
          color: typeof current.color === "string" ? current.color : undefined,
          welcome:
            typeof current.welcome === "string" ? current.welcome : undefined,
          locale: typeof current.locale === "string" ? current.locale : undefined,
          ...(iconUrl ? { avatar: iconUrl } : {}),
        },
      },
    });
    setOpen(false);
    void load();
  };

  return (
    <>
      <Panel
        title="站点与接入"
        extra={
          <Button
            type="primary"
            onClick={() => openEditor(null)}
          >
            新建站点
          </Button>
        }
      >
        {rows.length ? (
          rows.map((site) => (
            <div className="sd-site-card" key={site.id}>
          <div className="sd-site-head">
            <span className="sd-site-icon">
              {typeof site.appearance?.avatar === "string" && site.appearance.avatar ? (
                <RawImg src={site.appearance.avatar} alt="" />
              ) : (
                "默认"
              )}
            </span>
            <strong>{site.name}</strong>
            <Tag>{site.enabled ? "启用" : "停用"}</Tag>
            <span className="muted">站点标识：{site.siteKey}</span>
            <Space>
              <Button onClick={() => openEditor(site)}>编辑</Button>
              <Button
                onClick={async () => {
                  const next = await serviceDeskApi.rotateSiteKey({
                    params: { id: String(site.id) },
                  });
                  message.success(`新的站点标识：${next?.siteKey || ""}`);
                  void load();
                }}
              >
                重置接入码
              </Button>
              <Button
                danger
                onClick={async () => {
                  await serviceDeskApi.removeSite({ params: { id: String(site.id) } });
                  void load();
                }}
              >
                删除
              </Button>
            </Space>
          </div>
          <Typography.Paragraph copyable className="sd-code">
            {`<script src="${origin}/api/public/service-desk/embed.js" data-site-key="${site.siteKey}" async></script>`}
          </Typography.Paragraph>
          <div className="muted">
            允许的来源域名：{site.allowedOrigins.length ? site.allowedOrigins.join("、") : "不限"}
          </div>
        </div>
          ))
        ) : (
          <div className="sd-empty">还没有站点，点「新建站点」生成接入代码</div>
        )}
      </Panel>
      <Modal
        open={open}
        title={editing ? "编辑站点" : "新建站点"}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Input
            placeholder="站点名称，例如：官网中文站"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            placeholder="允许的来源域名（可选，逗号或顿号分隔）"
            value={origins}
            onChange={(event) => setOrigins(event.target.value)}
          />
          <div className="sd-icon-row">
            <span className="sd-site-icon">
              {iconUrl ? <RawImg src={iconUrl} alt="" /> : "默认"}
            </span>
            <Upload
              accept="image/png,image/jpeg,image/webp,image/gif"
              showUploadList={false}
              beforeUpload={(file) => {
                void uploadIcon(file);
                return false;
              }}
            >
              <Button loading={uploading}>上传客服图标</Button>
            </Upload>
            {iconUrl ? (
              <Button onClick={() => setIconUrl("")}>恢复默认图标</Button>
            ) : null}
          </div>
          <div className="muted">
            不传图标时使用系统默认客服图标；支持 PNG / JPG / WEBP / GIF，不超过 2MB，建议方形。
          </div>
        </Space>
      </Modal>
    </>
  );
}

export function StatsPanel() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<ServiceDeskStats | null>(null);

  useEffect(() => {
    void serviceDeskApi
      .stats({ query: { days } })
      .then((value) => setData(value))
      .catch((error) => message.error((error as Error).message || "加载失败"));
  }, [days]);

  if (!data) return <div className="muted">加载中…</div>;
  return (
    <Panel
      title="统计"
      extra={
        <Select
          value={days}
          style={{ width: 140 }}
          onChange={setDays}
          options={[
            { value: 7, label: "近 7 天" },
            { value: 30, label: "近 30 天" },
            { value: 90, label: "近 90 天" },
          ]}
        />
      }
    >
      <Descriptions
        bordered
        column={4}
        items={[
          { key: "1", label: "会话数", children: data.conversations },
          { key: "2", label: "已结束", children: data.closed },
          { key: "3", label: "待接入", children: data.waiting },
          {
            key: "4",
            label: "平均首响",
            children: `${data.avgFirstResponseSeconds} 秒`,
          },
          {
            key: "5",
            label: "平均会话时长",
            children: `${Math.round(data.avgDurationSeconds / 60)} 分钟`,
          },
          { key: "6", label: "满意度", children: data.avgRating || "—" },
          { key: "7", label: "AI 回复数", children: data.aiReplies },
          { key: "8", label: "AI 独立解决", children: data.aiAutoResolved },
        ]}
      />
      <div className="sd-two-col" style={{ marginTop: 16 }}>
        <Table
          rowKey="date"
          title={() => "按天"}
          pagination={false}
          dataSource={data.perDay}
          columns={[
            { title: "日期", dataIndex: "date" },
            { title: "会话", dataIndex: "conversations" },
            { title: "AI 回复", dataIndex: "aiReplies" },
          ]}
        />
        <Table
          rowKey="userId"
          title={() => "按客服"}
          pagination={false}
          dataSource={data.perAgent}
          columns={[
            { title: "客服", dataIndex: "name" },
            { title: "接待", dataIndex: "handled" },
            { title: "评分", dataIndex: "rating" },
          ]}
        />
      </div>
    </Panel>
  );
}