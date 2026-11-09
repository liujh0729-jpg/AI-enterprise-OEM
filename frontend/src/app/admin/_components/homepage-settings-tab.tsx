"use client";

import { App, Button, Collapse, Form, Input, Switch } from "antd";
import { useEffect } from "react";
import type { HomepageSettings } from "@enterprise/contracts";
import { homepageApi } from "@/api/homepage";
import { Notice, Panel } from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { PermissionNotice, useAdminData } from "./common";

type Draft = HomepageSettings & { integrationPointsText: string };

/** 图片地址 + 缩略预览：默认图片放在站点 /home/*.webp，也可换成 OSS 地址。 */
function ImageUrlField({
  value,
  onChange,
  alt,
}: {
  value?: string;
  onChange?: (value: string) => void;
  alt?: string;
}) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <Input
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder="/home/hero.webp"
        maxLength={512}
        allowClear
      />
      {value ? (
        <RawImg
          src={value}
          alt={alt || "图片预览"}
          style={{
            width: 240,
            maxWidth: "100%",
            height: 120,
            objectFit: "cover",
            borderRadius: 8,
            border: "1px solid #eee",
          }}
        />
      ) : null}
    </div>
  );
}

const rowStyle = {
  display: "grid",
  gap: 8,
  padding: 12,
  border: "1px solid #f0f0f0",
  borderRadius: 8,
  marginBottom: 10,
};

const rowHeadStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

/**
 * 首页设置（系统设置最后一个页签）：官网落地页的文案、图片与板块显隐。
 * 首页是未登录可访问的静态页，顶部只有注册 / 登录两个入口；页脚 ICP / 站点名读站点设置。
 */
export function HomepageSettingsTab() {
  const { message } = App.useApp();
  const [form] = Form.useForm<Draft>();
  const { data, denied, loading, reload } = useAdminData("homepage", (signal) =>
    homepageApi.adminGet({ signal }),
  );
  const save = useOperationMutation(
    (body: HomepageSettings) => homepageApi.adminSave(body),
    ["homepage", "*"],
  );

  useEffect(() => {
    if (!data) return;
    form.setFieldsValue({
      ...data,
      integrationPointsText: data.integration.points.join("\n"),
    });
  }, [data, form]);

  const onSubmit = async (values: Draft) => {
    const body: HomepageSettings = {
      hero: { ...values.hero, stats: values.hero?.stats ?? [] },
      scenes: values.scenes,
      services: values.services,
      integration: {
        title: values.integration.title,
        subtitle: values.integration.subtitle,
        points: String(values.integrationPointsText || "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      },
      steps: values.steps,
      faq: values.faq,
      cta: values.cta,
      footer: values.footer,
      sections: values.sections,
    };
    try {
      await save.mutateAsync(body);
      message.success("首页设置已保存，前台即时生效");
      await reload();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  return (
    <>
      <PermissionNotice denied={denied} />
      <Panel
        title="首页设置"
        titleBadge={<span className="text-12 muted">官网落地页文案 / 图片 / 板块显隐</span>}
        extra={
          <Button href="/" target="_blank">
            预览首页
          </Button>
        }
      >
        <Notice variant="info">
          首页是未登录访客看到的静态落地页：顶部只有「登录 / 注册」两个入口，不放站内菜单；页脚 ICP、站点名与 Logo
          读取「站点设置」。这里修改的文案与图片保存后立即生效；列表类板块留空会回落到内置默认内容。
        </Notice>
        <Form
          form={form}
          layout="vertical"
          disabled={loading}
          onFinish={onSubmit}
          style={{ marginTop: 12, maxWidth: 860 }}
        >
          <Collapse
            defaultActiveKey={["hero"]}
            items={[
              {
                key: "hero",
                forceRender: true,
                label: "首屏 Hero",
                children: (
                  <>
                    <Form.Item name={["hero", "badge"]} label="顶部徽标文案">
                      <Input maxLength={80} />
                    </Form.Item>
                    <Form.Item
                      name={["hero", "title"]}
                      label="主标题"
                      extra="建议一句话讲清价值，过长会在手机上换行过多。"
                    >
                      <Input maxLength={80} />
                    </Form.Item>
                    <Form.Item
                      name={["hero", "highlight"]}
                      label="主标题高亮词"
                      extra="需是主标题中的一段文字；没有出现在主标题里时整句普通展示。"
                    >
                      <Input maxLength={40} />
                    </Form.Item>
                    <Form.Item name={["hero", "subtitle"]} label="副标题">
                      <Input.TextArea rows={3} maxLength={300} showCount />
                    </Form.Item>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                      <Form.Item name={["hero", "primaryLabel"]} label="主按钮文案（固定去注册）">
                        <Input maxLength={16} />
                      </Form.Item>
                      <Form.Item name={["hero", "secondaryLabel"]} label="次按钮文案（固定去登录）">
                        <Input maxLength={16} />
                      </Form.Item>
                    </div>
                    <Form.Item name={["hero", "image"]} label="首屏背景图">
                      <ImageUrlField alt="首屏背景" />
                    </Form.Item>
                    <Form.List name={["hero", "stats"]}>
                      {(fields, { add, remove }) => (
                        <div style={{ marginBottom: 12 }}>
                          <div style={rowHeadStyle}>
                            <strong>首屏数据（建议 2–4 项）</strong>
                            <Button size="small" onClick={() => add({ value: "", label: "" })}>
                              添加数据
                            </Button>
                          </div>
                          {fields.map((field) => (
                            <div key={field.key} style={rowStyle}>
                              <div style={{ display: "grid", gridTemplateColumns: "180px 1fr auto", gap: 8 }}>
                                <Form.Item name={[field.name, "value"]} noStyle>
                                  <Input placeholder="15+" maxLength={20} />
                                </Form.Item>
                                <Form.Item name={[field.name, "label"]} noStyle>
                                  <Input placeholder="企业服务板块" maxLength={30} />
                                </Form.Item>
                                <Button danger size="small" onClick={() => remove(field.name)}>
                                  删除
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Form.List>
                  </>
                ),
              },
              {
                key: "scenes",
                forceRender: true,
                label: "场景轮播",
                children: (
                  <>
                    <Form.Item name={["scenes", "title"]} label="板块标题">
                      <Input maxLength={80} />
                    </Form.Item>
                    <Form.Item name={["scenes", "subtitle"]} label="板块说明">
                      <Input maxLength={160} />
                    </Form.Item>
                    <Form.List name={["scenes", "items"]}>
                      {(fields, { add, remove }) => (
                        <div>
                          <div style={rowHeadStyle}>
                            <strong>场景卡片</strong>
                            <Button
                              size="small"
                              onClick={() =>
                                add({
                                  tag: "",
                                  title: "",
                                  desc: "",
                                  image: "/home/scene-tax.webp",
                                })
                              }
                            >
                              添加场景
                            </Button>
                          </div>
                          {fields.map((field) => (
                            <div key={field.key} style={rowStyle}>
                              <div style={{ display: "grid", gridTemplateColumns: "160px 1fr auto", gap: 8 }}>
                                <Form.Item name={[field.name, "tag"]} noStyle>
                                  <Input placeholder="标签，如 智能财税" maxLength={24} />
                                </Form.Item>
                                <Form.Item name={[field.name, "title"]} noStyle>
                                  <Input placeholder="场景标题" maxLength={60} />
                                </Form.Item>
                                <Button danger size="small" onClick={() => remove(field.name)}>
                                  删除
                                </Button>
                              </div>
                              <Form.Item name={[field.name, "desc"]} noStyle>
                                <Input.TextArea placeholder="场景说明" rows={2} maxLength={200} />
                              </Form.Item>
                              <Form.Item name={[field.name, "image"]} noStyle>
                                <ImageUrlField alt="场景图" />
                              </Form.Item>
                            </div>
                          ))}
                        </div>
                      )}
                    </Form.List>
                  </>
                ),
              },
              {
                key: "services",
                forceRender: true,
                label: "业务板块",
                children: (
                  <>
                    <Form.Item name={["services", "title"]} label="板块标题">
                      <Input maxLength={80} />
                    </Form.Item>
                    <Form.Item name={["services", "subtitle"]} label="板块说明">
                      <Input maxLength={160} />
                    </Form.Item>
                    <Form.List name={["services", "items"]}>
                      {(fields, { add, remove }) => (
                        <div>
                          <div style={rowHeadStyle}>
                            <strong>业务条目</strong>
                            <Button size="small" onClick={() => add({ name: "", desc: "" })}>
                              添加业务
                            </Button>
                          </div>
                          {fields.map((field) => (
                            <div key={field.key} style={rowStyle}>
                              <div style={{ display: "grid", gridTemplateColumns: "200px 1fr auto", gap: 8 }}>
                                <Form.Item name={[field.name, "name"]} noStyle>
                                  <Input placeholder="板块名称" maxLength={30} />
                                </Form.Item>
                                <Form.Item name={[field.name, "desc"]} noStyle>
                                  <Input placeholder="一句话说明" maxLength={80} />
                                </Form.Item>
                                <Button danger size="small" onClick={() => remove(field.name)}>
                                  删除
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Form.List>
                  </>
                ),
              },
              {
                key: "integration",
                forceRender: true,
                label: "开放集成",
                children: (
                  <>
                    <Form.Item name={["integration", "title"]} label="板块标题">
                      <Input maxLength={80} />
                    </Form.Item>
                    <Form.Item name={["integration", "subtitle"]} label="板块说明">
                      <Input maxLength={160} />
                    </Form.Item>
                    <Form.Item
                      name="integrationPointsText"
                      label="开放能力要点（每行一条）"
                      extra="右侧代码示例为固定展示，不需要填写。"
                    >
                      <Input.TextArea rows={4} maxLength={600} />
                    </Form.Item>
                  </>
                ),
              },
              {
                key: "steps",
                forceRender: true,
                label: "使用步骤",
                children: (
                  <>
                    <Form.Item name={["steps", "title"]} label="板块标题">
                      <Input maxLength={80} />
                    </Form.Item>
                    <Form.Item name={["steps", "subtitle"]} label="板块说明">
                      <Input maxLength={160} />
                    </Form.Item>
                    <Form.List name={["steps", "items"]}>
                      {(fields, { add, remove }) => (
                        <div>
                          <div style={rowHeadStyle}>
                            <strong>步骤</strong>
                            <Button size="small" onClick={() => add({ title: "", desc: "" })}>
                              添加步骤
                            </Button>
                          </div>
                          {fields.map((field) => (
                            <div key={field.key} style={rowStyle}>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 8 }}>
                                <Form.Item name={[field.name, "title"]} noStyle>
                                  <Input placeholder="步骤标题" maxLength={40} />
                                </Form.Item>
                                <Form.Item name={[field.name, "desc"]} noStyle>
                                  <Input placeholder="步骤说明" maxLength={160} />
                                </Form.Item>
                                <Button danger size="small" onClick={() => remove(field.name)}>
                                  删除
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Form.List>
                  </>
                ),
              },
              {
                key: "faq",
                forceRender: true,
                label: "常见问题",
                children: (
                  <>
                    <Form.Item name={["faq", "title"]} label="板块标题">
                      <Input maxLength={80} />
                    </Form.Item>
                    <Form.List name={["faq", "items"]}>
                      {(fields, { add, remove }) => (
                        <div>
                          <div style={rowHeadStyle}>
                            <strong>问答</strong>
                            <Button size="small" onClick={() => add({ q: "", a: "" })}>
                              添加问答
                            </Button>
                          </div>
                          {fields.map((field) => (
                            <div key={field.key} style={rowStyle}>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                                <Form.Item name={[field.name, "q"]} noStyle>
                                  <Input placeholder="问题" maxLength={120} />
                                </Form.Item>
                                <Button danger size="small" onClick={() => remove(field.name)}>
                                  删除
                                </Button>
                              </div>
                              <Form.Item name={[field.name, "a"]} noStyle>
                                <Input.TextArea placeholder="回答" rows={2} maxLength={600} />
                              </Form.Item>
                            </div>
                          ))}
                        </div>
                      )}
                    </Form.List>
                  </>
                ),
              },
              {
                key: "cta",
                forceRender: true,
                label: "底部行动区与页脚",
                children: (
                  <>
                    <Form.Item name={["cta", "title"]} label="行动区标题">
                      <Input maxLength={80} />
                    </Form.Item>
                    <Form.Item name={["cta", "subtitle"]} label="行动区说明">
                      <Input maxLength={160} />
                    </Form.Item>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                      <Form.Item name={["cta", "primaryLabel"]} label="注册按钮文案">
                        <Input maxLength={16} />
                      </Form.Item>
                      <Form.Item name={["cta", "secondaryLabel"]} label="登录按钮文案">
                        <Input maxLength={16} />
                      </Form.Item>
                    </div>
                    <Form.Item name={["footer", "slogan"]} label="页脚标语">
                      <Input maxLength={120} />
                    </Form.Item>
                    <Form.Item
                      name={["footer", "copyright"]}
                      label="版权文案"
                      extra="支持 {year} 占位，会自动替换为当前年份。"
                    >
                      <Input maxLength={160} />
                    </Form.Item>
                  </>
                ),
              },
              {
                key: "sections",
                forceRender: true,
                label: "板块显隐",
                children: (
                  <div style={{ display: "grid", gap: 10 }}>
                    <Form.Item name={["sections", "scenes"]} label="场景轮播" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                    <Form.Item name={["sections", "services"]} label="业务板块" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                    <Form.Item name={["sections", "integration"]} label="开放集成" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                    <Form.Item name={["sections", "steps"]} label="使用步骤" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                    <Form.Item name={["sections", "faq"]} label="常见问题" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                    <Form.Item name={["sections", "cta"]} label="底部行动区" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </div>
                ),
              },
            ]}
          />

          <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
            <Button type="primary" htmlType="submit" loading={save.isPending}>
              保存首页设置
            </Button>
            <Button onClick={() => reload()}>重新载入</Button>
          </div>
        </Form>
      </Panel>
    </>
  );
}
