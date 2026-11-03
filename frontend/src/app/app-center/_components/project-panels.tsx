"use client";

import {
  AppstoreOutlined,
  AuditOutlined,
  DatabaseOutlined,
  ProjectOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import {
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Spin,
  Tag,
  message,
} from "antd";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  LOWCODE_PROJECT_TYPE_LABELS,
  type LowCodeProjectView,
} from "@enterprise/contracts";
import { lowcodeApi } from "@/api/lowcode";
import { EmptyState } from "@/components/ui/panel";

export const TEMPLATE_ICONS: Record<string, ReactNode> = {
  appstore: <AppstoreOutlined />,
  audit: <AuditOutlined />,
  team: <TeamOutlined />,
  project: <ProjectOutlined />,
  database: <DatabaseOutlined />,
};

type TemplateOption = {
  key: string;
  type: string;
  name: string;
  description: string;
  icon: string;
};

type OrgOption = {
  orgType: string;
  orgUserId: string;
  name: string;
  role: string;
};

function errText(error: unknown) {
  return (error as Error)?.message || "操作失败";
}

export function ProjectGrid({
  projects,
  loading,
  error,
  emptyText,
  onRetry,
}: {
  projects: LowCodeProjectView[];
  loading: boolean;
  error?: string;
  /** 传空字符串＝这一组没有结果时只回一行提示，不铺整块空状态。 */
  emptyText?: string;
  onRetry?: () => void;
}) {
  const router = useRouter();
  return (
    <Spin spinning={loading}>
      {error ? (
        <div style={{ marginBottom: 12 }}>
          <Tag color="red">加载失败</Tag>
          {error}
          {onRetry ? (
            <Button type="link" onClick={onRetry}>
              重试
            </Button>
          ) : null}
        </div>
      ) : null}
      {!loading && !projects.length ? (
        emptyText ? (
          <EmptyState text={emptyText} />
        ) : (
          <div className="text-12 muted">暂无匹配的应用</div>
        )
      ) : (
        <div className="lowcode-card-grid">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className="lowcode-card"
              onClick={() => router.push(`/lowcode/p/${project.id}`)}
            >
              <span className="lowcode-card-head">
                <span className="lowcode-card-icon">
                  {TEMPLATE_ICONS[project.icon] || <AppstoreOutlined />}
                </span>
                <strong className="lowcode-card-name">{project.name}</strong>
                <Tag>
                  {project.typeLabel ||
                    LOWCODE_PROJECT_TYPE_LABELS[project.type] ||
                    project.type}
                </Tag>
              </span>
              <span className="lowcode-card-desc">
                {project.description || "暂无说明"}
              </span>
              <span className="lowcode-card-meta">
                <span>{project.orgName || "仅本人"}</span>
                <span>创建人 {project.ownerName || project.ownerUserId}</span>
                <span>{project.myRoleName || "成员"}</span>
              </span>
              <span className="lowcode-card-stats">
                <span>成员 {project.memberCount}</span>
                <span>实体 {project.entityCount}</span>
                <span>页面 {project.pageCount}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Spin>
  );
}

export function CreateProjectButton({ label = "新建应用" }: { label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [organizations, setOrganizations] = useState<OrgOption[]>([]);
  const [form] = Form.useForm();

  useEffect(() => {
    if (!open || templates.length) return;
    void lowcodeApi
      .templates()
      .then((data) => {
        setTemplates((data?.templates || []) as TemplateOption[]);
        setOrganizations((data?.organizations || []) as OrgOption[]);
      })
      .catch(() => undefined);
  }, [open, templates.length]);

  const orgOptions = useMemo(
    () => [
      { value: "", label: "仅本人（个人应用）" },
      ...organizations.map((item) => ({
        value: `${item.orgType}|${item.orgUserId}`,
        label: `${item.name}（${item.role}）`,
      })),
    ],
    [organizations],
  );

  const create = async () => {
    try {
      const values = await form.validateFields();
      setCreating(true);
      const [orgType, orgUserId] = String(values.org || "").split("|");
      const project = await lowcodeApi.createProject({
        body: {
          name: String(values.name || ""),
          templateKey: String(values.templateKey || "BLANK"),
          description: String(values.description || ""),
          orgType: orgType || "",
          orgUserId: orgUserId || "",
          icon: "",
        },
      });
      if (!project) throw new Error("创建失败");
      message.success("应用已创建");
      setOpen(false);
      form.resetFields();
      router.push(`/lowcode/p/${project.id}`);
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(errText(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Button type="primary" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal
        open={open}
        title="新建应用"
        width={760}
        confirmLoading={creating}
        onCancel={() => setOpen(false)}
        onOk={() => void create()}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ templateKey: "BLANK", org: "" }}
        >
          <Form.Item
            name="name"
            label="应用名称"
            rules={[{ required: true, message: "请填写应用名称" }]}
          >
            <Input maxLength={100} placeholder="例如：行政请购审批" />
          </Form.Item>
          <Form.Item name="templateKey" label="选择模板">
            <TemplatePicker templates={templates} />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea
              rows={2}
              maxLength={500}
              placeholder="这个应用解决什么问题"
            />
          </Form.Item>
          <Form.Item
            name="org"
            label="组织归属"
            extra={
              organizations.length
                ? "归属组织后，成员从该组织的在职员工里选；选「仅本人」则只有你本人可见。"
                : "当前账号还没有可用的企业 / 服务商组织，应用将仅在本人范围内使用。"
            }
          >
            {organizations.length ? (
              <Select options={orgOptions} />
            ) : (
              <Input disabled value="仅本人（未认证组织）" />
            )}
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function TemplatePicker({
  templates,
  value,
  onChange,
}: {
  templates: TemplateOption[];
  value?: string;
  onChange?: (value: string) => void;
}) {
  const [inner, setInner] = useState(value || "BLANK");
  const current = value ?? inner;
  const pick = (key: string) => {
    onChange?.(key);
    if (value === undefined) setInner(key);
  };
  if (!templates.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="模板加载中" />;
  }
  return (
    <div className="lowcode-template-grid">
      {templates.map((item) => (
        <button
          key={item.key}
          type="button"
          className={
            current === item.key ? "lowcode-template active" : "lowcode-template"
          }
          onClick={() => pick(item.key)}
        >
          <span className="lowcode-card-icon">
            {TEMPLATE_ICONS[item.icon] || <AppstoreOutlined />}
          </span>
          <strong>{item.name}</strong>
          <span className="muted">{item.description}</span>
        </button>
      ))}
    </div>
  );
}