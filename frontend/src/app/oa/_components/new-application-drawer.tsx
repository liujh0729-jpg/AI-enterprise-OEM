"use client";

import { ArrowLeftOutlined } from "@ant-design/icons";
import { App, Button, Drawer, Form, Input, Space, Spin, Tag } from "antd";
import { useEffect, useState } from "react";
import { oaApi } from "@/api/oa";
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

  /** 深链带进来的金额预填主金额（与 oaAmountOf 同序：第一个金额字段）。 */
  const prefillAmount = (fields: OaField[], values: Record<string, unknown>) => {
    if (application) return;
    const amount = presetLinks?.[0]?.amount || 0;
    const key = fields.find((item) => item.type === "amount")?.key;
    if (!(amount > 0) || !key || values[key] !== undefined) return;
    form.setFieldValue(key, amount);
  };

  const loadTemplate = async (id: number) => {
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
  };

  useEffect(() => {
    if (!open) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在抽屉打开/切换单据时初始化
  }, [open, application?.id, presetTemplateId]);

  const backToTemplates = () => {
    setTemplate(null);
    form.resetFields();
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
          ) : (
            <EmptyState text="该组织还没有启用的申请模板，请先在「模板与流程」里配置" />
          )}
        </Panel>
      ) : (
        <Form form={form} component={false}>
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
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
