"use client";

import { ArrowLeftOutlined } from "@ant-design/icons";
import { Alert, App, Button, Drawer, Form, Input, Space, Spin, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import { oaApi } from "@/api/oa";
import { aiApi } from "@/api/ai";
import {
  type OaApplication,
  type OaAttachment,
  type OaField,
  type OaLinkSearchItem,
  type OaLinkTarget,
  type OaTemplate,
  type OaTemplateSummary,
} from "@enterprise/contracts";
import { EmptyState, Panel } from "@/components/ui/panel";
import { ToolCard, ToolCardGrid } from "@/components/ui/tool-card";
import {
  MemberSelect,
  oaError,
  type OaMember,
  type OaOrgQuery,
} from "./oa-common";
import { LinkPicker, draftLinkOf } from "./link-picker";
import { FlowPreview } from "./flow-editor";
import {
  AttachmentField,
  OaFieldItems,
  oaAmountLabel,
  oaFormDataOf,
  oaInitialValues,
  oaMissingRequired,
} from "./form-renderer";

/**
 * 新建/编辑申请：选模板（整卡可点）→ 填表单 → 挂关联对象 → 看流程预览 → 存草稿或提交。
 * 草稿与提交是两次请求：先落草稿拿单号，再提交，失败时草稿仍在，不会丢填写内容。
 */
export function NewApplicationDrawer({
  open,
  org,
  members,
  targets,
  templates,
  application,
  presetTemplateId,
  presetLinks,
  presetTitle,
  onClose,
  onSaved,
}: {
  open: boolean;
  org: OaOrgQuery;
  members: OaMember[];
  targets: OaLinkTarget[];
  templates: OaTemplateSummary[];
  /** 传入＝编辑这张单据的草稿/退回件；为空＝新建。 */
  application: OaApplication | null;
  /** 业务侧「发起 OA 审批」深链带进来的模板、关联对象与标题。 */
  presetTemplateId?: number;
  presetLinks?: OaLinkSearchItem[];
  presetTitle?: string;
  onClose: () => void;
  onSaved: (app: OaApplication, submitted: boolean) => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [template, setTemplate] = useState<OaTemplate | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [ccUserIds, setCcUserIds] = useState<string[]>([]);
  const [links, setLinks] = useState<OaLinkSearchItem[]>([]);
  const [attachments, setAttachments] = useState<OaAttachment[]>([]);
  const [draftText, setDraftText] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState<{
    templateName: string;
    reason: string;
    missing: string[];
    mode: string;
  } | null>(null);

  /** 深链带进来的金额预填主金额（与 oaAmountOf 同序：第一个金额字段）。 */
  const prefillAmount = useCallback((fields: OaField[], values: Record<string, unknown>) => {
    if (application) return;
    const amount = presetLinks?.[0]?.amount || 0;
    const key = fields.find((item) => item.type === "amount")?.key;
    if (!(amount > 0) || !key || values[key] !== undefined) return;
    form.setFieldValue(key, amount);
  }, [application, presetLinks, form]);

  const loadTemplate = useCallback(async (id: number) => {
    setLoading(true);
    try {
      const data = await oaApi.templateDetail({
        params: { id: String(id) },
        query: org,
      });
      setTemplate(data || null);
      if (data) {
        const values = oaInitialValues(data.fields, application?.formData);
        form.setFieldsValue(values);
        prefillAmount(data.fields, values);
      }
    } catch (error) {
      message.error(oaError(error));
      setTemplate(null);
    } finally {
      setLoading(false);
    }
  }, [org, application, form, message, prefillAmount]);

  useEffect(() => {
    if (!open) return;
    setDraftText("");
    setDraftNote(null);
    if (application) {
      setTitle(application.title);
      setCcUserIds(application.cc.map((item) => item.userId));
      setLinks(application.targets);
      setAttachments(application.attachments || []);
      void loadTemplate(application.templateId);
      return;
    }
    setTitle(presetTitle || "");
    setCcUserIds([]);
    setLinks(presetLinks || []);
    setAttachments([]);
    if (presetTemplateId) void loadTemplate(presetTemplateId);
    else setTemplate(null);
  }, [open, application, presetTemplateId, presetTitle, presetLinks, loadTemplate]);

  const backToTemplates = () => {
    setTemplate(null);
    form.resetFields();
    setDraftNote(null);
  };

  /** AI 起草：把一句话映射到模板并预填字段，只出草稿，用户核对后再存/交。 */
  const aiDraft = async () => {
    const text = draftText.trim();
    if (!text) {
      message.warning("先用一句话描述你要申请的事项");
      return;
    }
    setDrafting(true);
    try {
      const draft = await aiApi.oaDraftApplication({
        body: { text, ...org },
      });
      if (!draft) throw new Error("AI 起草没有返回结果");
      const data = await oaApi.templateDetail({
        params: { id: String(draft.templateId) },
        query: org,
      });
      if (!data) throw new Error("匹配到的模板已不存在");
      setTemplate(data);
      form.setFieldsValue(oaInitialValues(data.fields, draft.formData));
      setTitle(draft.title);
      setDraftNote({
        templateName: draft.templateName,
        reason: draft.reason,
        missing: draft.missing,
        mode: draft.mode,
      });
    } catch (error) {
      message.error(oaError(error));
    } finally {
      setDrafting(false);
    }
  };

  const persist = async (submitted: boolean) => {
    if (!template) {
      message.warning("先选择申请模板");
      return;
    }
    const fields = template.fields;
    const values = form.getFieldsValue(true) as Record<string, unknown>;
    const formData = oaFormDataOf(fields, values);
    if (submitted) {
      try {
        await form.validateFields();
      } catch {
        message.warning("请先补全必填项");
        return;
      }
      const missing = oaMissingRequired(fields, formData);
      if (missing.length) {
        message.warning(`请填写必填字段：${missing.join("、")}`);
        return;
      }
    }
    setSaving(true);
    try {
      const saved = await oaApi.saveDraft({
        body: {
          ...org,
          id: application?.id || 0,
          templateId: template.id,
          title,
          formData,
          ccUserIds,
          attachments,
          linkTargets: links.map((item) => draftLinkOf(item)),
        },
      });
      if (!saved) throw new Error("草稿保存没有返回结果");
      if (!submitted) {
        message.success("草稿已保存");
        onSaved(saved, false);
        return;
      }
      const done = await oaApi.submit({
        params: { id: String(saved.id) },
        body: {},
      });
      message.success("已提交审批");
      onSaved(done || saved, true);
    } catch (error) {
      message.error(oaError(error));
    } finally {
      setSaving(false);
    }
  };

  const enabled = templates.filter((item) => item.enabled);
  const fields = template?.fields || [];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={760}
      title={application ? `编辑草稿 ${application.number}` : "新建申请"}
      destroyOnHidden
      styles={{ body: { background: "var(--bg, #f7f8fa)" } }}
      footer={
        template ? (
          <Space style={{ width: "100%", justifyContent: "flex-end" }}>
            <Button icon={<ArrowLeftOutlined aria-hidden />} onClick={backToTemplates}>
              重选模板
            </Button>
            <Button loading={saving} onClick={() => void persist(false)}>
              存草稿
            </Button>
            <Button type="primary" loading={saving} onClick={() => void persist(true)}>
              提交审批
            </Button>
          </Space>
        ) : (
          <Space style={{ width: "100%", justifyContent: "flex-end" }}>
            <Button onClick={onClose}>取消</Button>
          </Space>
        )
      }
    >
      {loading ? (
        <div style={{ padding: 40, textAlign: "center" }}>
          <Spin />
        </div>
      ) : !template ? (
        <Panel title="选择申请模板">
          {enabled.length ? (
            <>
              <div style={{ marginBottom: 12 }}>
                <Input.TextArea
                  value={draftText}
                  rows={2}
                  maxLength={2000}
                  placeholder="用一句话描述你要申请的事项，例如：3 月 5 日到 6 日请两天年假回老家"
                  onChange={(event) => setDraftText(event.target.value)}
                />
                <div style={{ marginTop: 8, textAlign: "right" }}>
                  <Button
                    type="primary"
                    loading={drafting}
                    onClick={() => void aiDraft()}
                  >
                    AI 起草
                  </Button>
                </div>
              </div>
              <ToolCardGrid>
                {enabled.map((item) => (
                  <ToolCard
                    key={item.id}
                    title={item.name}
                    tag={<Tag>{item.categoryLabel}</Tag>}
                    description={item.description || "按模板配置的表单与流程发起。"}
                    meta={`${item.nodeCount} 个审批节点 · 单号前缀 ${item.numberPrefix}`}
                    onClick={() => void loadTemplate(item.id)}
                  />
                ))}
              </ToolCardGrid>
            </>
          ) : (
            <EmptyState text="该组织还没有启用的申请模板，请先在「模板与流程」里配置" />
          )}
        </Panel>
      ) : (
        <Form form={form} component={false}>
          <Space orientation="vertical" size={12} style={{ width: "100%" }}>
            {draftNote ? (
              <Alert
                type="info"
                showIcon
                closable
                onClose={() => setDraftNote(null)}
                message={`AI 已按「${draftNote.templateName}」起草${
                  draftNote.mode === "llm" ? "" : "（未配置文本模型，按关键词匹配）"
                }`}
                description={[
                  draftNote.reason,
                  draftNote.missing.length
                    ? `还需补全：${draftNote.missing.join("、")}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
            ) : null}
            <Panel title="基本信息">
              <div className="form-2col">
                <div style={{ gridColumn: "1 / -1" }}>
                  <div className="field-label">申请标题</div>
                  <Input
                    value={title}
                    maxLength={200}
                    placeholder={template.name}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </div>
                <div>
                  <div className="field-label">模板</div>
                  <span className="muted text-12">
                    {template.name} · 第 {template.version} 版
                  </span>
                </div>
                <div>
                  <div className="field-label">抄送</div>
                  <MemberSelect
                    members={members}
                    mode="multiple"
                    value={ccUserIds}
                    onChange={(next) => setCcUserIds(next as string[])}
                    placeholder="抄送给组织成员"
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
            </Panel>
            <Panel title="申请内容">
              <OaFieldItems
                fields={fields}
                members={members}
                targets={targets}
                org={org}
              />
            </Panel>
            <Panel title="关联业务对象">
              <LinkPicker
                targets={targets}
                org={org}
                value={links}
                onChange={(next) => setLinks(next)}
              />
            </Panel>
            <Panel
              title="附件"
              titleExtra={
                <span className="text-12 muted">
                  上传后直接登记到数字资产，随单据给审批人查看
                </span>
              }
            >
              <AttachmentField
                value={attachments}
                onChange={(next) => setAttachments(next)}
                disabled={saving}
              />
            </Panel>
            <Panel title="流程预览">
              <Form.Item noStyle shouldUpdate>
                {(instance) => {
                  const formData = oaFormDataOf(
                    fields,
                    instance.getFieldsValue(true) as Record<string, unknown>,
                  );
                  return (
                    <>
                      <div className="field-label">
                        单据金额：{oaAmountLabel(formData, fields)}
                      </div>
                      <FlowPreview
                        nodes={template.flow}
                        fields={fields}
                        members={members}
                        formData={formData}
                      />
                    </>
                  );
                }}
              </Form.Item>
            </Panel>
          </Space>
        </Form>
      )}
    </Drawer>
  );
}
