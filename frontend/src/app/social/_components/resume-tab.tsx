"use client";

import { DeleteOutlined, PlusOutlined, PrinterOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Spin } from "antd";
import { useEffect, useState } from "react";
import { EmptyState, Panel } from "@/components/ui/panel";
import { socialApi, type ResumeData } from "@/api/social";
import { useBusinessQuery, useOperationMutation } from "@/query/business";
import { useSession } from "@/lib/session";
import {
  RESUME_KIND_OPTIONS as KIND_OPTIONS,
  RESUME_KIND_LABELS as KIND_LABELS,
  fmtYears,
} from "./social-ui";

type ResumeItemForm = {
  kind: string;
  title: string;
  subtitle?: string;
  startYear?: number;
  endYear?: number;
  description?: string;
};

/** 简历：主信息分组表单 + 经历条目时间轴（弹窗添加）。 */
export function ResumeTab() {
  const { message } = App.useApp();
  const { me } = useSession();
  const [form] = Form.useForm<ResumeData["resume"]>();
  const [itemForm] = Form.useForm<ResumeItemForm>();
  const [addOpen, setAddOpen] = useState(false);
  const { data, isLoading } = useBusinessQuery("social", "resume", {}, (signal) => socialApi.getResume({ signal }));

  const save = useOperationMutation(
    (input: { body: Partial<ResumeData["resume"]> }) => socialApi.saveResume(input.body),
    ["social"],
  );
  const addItem = useOperationMutation(
    (input: { body: ResumeItemForm }) => socialApi.addResumeItem(input.body),
    ["social"],
  );
  const delItem = useOperationMutation((input: { id: number }) => socialApi.deleteResumeItem(input.id), ["social"]);

  useEffect(() => {
    if (data) form.setFieldsValue(data.resume as never);
  }, [data, form]);

  const onSave = async (values: ResumeData["resume"]) => {
    await save.mutateAsync({ body: values });
    message.success("简历已保存");
  };

  const onAddItem = async () => {
    let values: ResumeItemForm;
    try {
      values = await itemForm.validateFields();
    } catch {
      return;
    }
    if (!values.title?.trim()) return message.warning("标题必填");
    await addItem.mutateAsync({ body: { ...values, title: values.title.trim() } });
    itemForm.resetFields();
    setAddOpen(false);
    message.success("条目已添加");
  };

  if (isLoading || !data)
    return (
      <Panel title="我的简历">
        <Spin />
      </Panel>
    );

  return (
    <div className="sns-wrap">
      {/* 经历条目为主栏、简历主信息为右侧窄栏（对齐 SNS 的内容 + rail 版式） */}
      <div className="sns-side-layout">
        <Panel
          title="经历条目"
          titleBadge={<span className="sns-muted">{data.items.length} 条</span>}
          extra={
            <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
              添加条目
            </Button>
          }
        >
          {data.items.length === 0 ? (
            <EmptyState text="还没有条目，添加一段工作 / 教育 / 项目经历吧。" />
          ) : (
            <div className="sns-timeline">
              {data.items.map((it) => (
                <div key={it.id} className="sns-timeline-item">
                  <div className="sns-timeline-head">
                    <span className="sns-flag sns-flag-tag">{KIND_LABELS[it.kind] || it.kind}</span>
                    <span className="sns-timeline-title">{it.title}</span>
                    {it.subtitle ? <span className="sns-timeline-sub">{it.subtitle}</span> : null}
                    {it.startYear ? <span className="sns-timeline-years">{fmtYears(it.startYear, it.endYear)}</span> : null}
                    <span style={{ marginLeft: "auto" }}>
                      <Popconfirm
                        title="删除该条目？"
                        okText="删除"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => delItem.mutateAsync({ id: it.id }).then(() => message.success("已删除"))}
                      >
                        <Button danger type="text" size="small" icon={<DeleteOutlined />}>
                          删除
                        </Button>
                      </Popconfirm>
                    </span>
                  </div>
                  {it.description ? <div className="sns-timeline-desc">{it.description}</div> : null}
                  {it.url ? (
                    <a href={it.url} target="_blank" rel="noreferrer" className="sns-muted">
                      {it.url}
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Panel>

        <div className="sns-side-col">
          <Panel
            title="简历主信息"
            titleBadge={<span className="sns-muted">求职名片，随时更新</span>}
            extra={
              me?.userId ? (
                /* 投递入口在私信里（投递后卡片就落在对话里）；这里只开打印版自校。 */
                <Button
                  size="small"
                  icon={<PrinterOutlined />}
                  onClick={() => window.open(`/resume/${me.userId}`, "_blank", "noopener")}
                >
                  打印版
                </Button>
              ) : null
            }
          >
            <Form form={form} layout="vertical" onFinish={onSave} requiredMark={false}>
              <div className="sns-form-grid">
                <Form.Item name="headline" label="一句话标题">
                  <Input maxLength={120} placeholder="如：10 年经验的全栈工程师" />
                </Form.Item>
                <Form.Item name="location" label="所在地">
                  <Input maxLength={64} placeholder="如：上海" />
                </Form.Item>
                <Form.Item name="summary" label="个人总结" className="sns-form-full">
                  <Input.TextArea rows={3} maxLength={2000} showCount placeholder="擅长什么、做过什么、想做什么" />
                </Form.Item>
                <Form.Item name="objectiveRole" label="期望职位">
                  <Input maxLength={120} placeholder="如：技术合伙人 / 前端负责人" />
                </Form.Item>
                <Form.Item name="objectiveCity" label="期望城市">
                  <Input maxLength={64} />
                </Form.Item>
                <Form.Item name="additional" label="补充说明" className="sns-form-full">
                  <Input.TextArea rows={2} maxLength={2000} placeholder="到岗时间、期望薪资、其他说明" />
                </Form.Item>
              </div>
              <Button block type="primary" htmlType="submit" loading={save.isPending}>
                保存简历
              </Button>
            </Form>
          </Panel>
        </div>
      </div>

      <Modal
        title="添加经历条目"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={onAddItem}
        okText="添加"
        confirmLoading={addItem.isPending}
        destroyOnHidden
      >
        <Form form={itemForm} layout="vertical" requiredMark={false} style={{ paddingTop: 4 }}>
          <div className="sns-form-grid">
            <Form.Item name="kind" label="类型" initialValue="WORK">
              <Select options={KIND_OPTIONS} />
            </Form.Item>
            <Form.Item name="title" label="标题" rules={[{ required: true, message: "请填写标题" }]}>
              <Input maxLength={120} placeholder="如：某科技公司 / 前端负责人" />
            </Form.Item>
            <Form.Item name="subtitle" label="副标题">
              <Input maxLength={120} placeholder="公司 / 学校 / 项目角色" />
            </Form.Item>
            <Form.Item label="起止年份">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <Form.Item name="startYear" noStyle>
                  <InputNumber min={1950} max={2100} placeholder="起始年" style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item name="endYear" noStyle>
                  <InputNumber min={1950} max={2100} placeholder="结束年" style={{ width: "100%" }} />
                </Form.Item>
              </div>
            </Form.Item>
            <Form.Item name="description" label="描述" className="sns-form-full">
              <Input.TextArea rows={3} maxLength={2000} placeholder="做了什么、取得了什么结果" />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}