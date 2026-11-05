"use client";

import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  message,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  LowCodeApprovalNode,
  LowCodeFlowView,
  LowCodeMemberView,
  LowCodeRoleView,
} from "@enterprise/contracts";
import {
  LOWCODE_ACTIONS,
  LOWCODE_ACTION_LABELS,
  LOWCODE_FIELD_TYPES,
  LOWCODE_FIELD_TYPE_LABELS,
  LOWCODE_PAGE_TYPES,
  LOWCODE_PAGE_TYPE_LABELS,
  LOWCODE_RULE_OPS,
  LOWCODE_RULE_VARS,
} from "@enterprise/contracts";
import { lowcodeApi } from "@/api/lowcode";
import { EmptyState, Notice, TabStrip } from "@/components/ui/panel";
import { errText } from "./row-form";

type Detail = NonNullable<Awaited<ReturnType<typeof lowcodeApi.projectDetail>>>;
type Entity = Detail["entities"][number];
type Page = Detail["pages"][number];

const SETTING_TABS = [
  { key: "project", label: "项目" },
  { key: "pages", label: "页面" },
  { key: "entities", label: "实体" },
  { key: "members", label: "成员" },
  { key: "roles", label: "角色权限" },
  { key: "rules", label: "数据规则" },
  { key: "approval", label: "审批流程" },
  { key: "ai", label: "AI 设置" },
  { key: "assets", label: "附件" },
];

export function SettingsDrawer({
  open,
  projectId,
  detail,
  onClose,
  onReload,
}: {
  open: boolean;
  projectId: number;
  detail: Detail;
  onClose: () => void;
  onReload: () => void;
}) {
  const [tab, setTab] = useState("project");
  return (
    <Drawer open={open} onClose={onClose} size={960} title="应用设置" destroyOnHidden>
      <TabStrip items={SETTING_TABS} value={tab} onChange={setTab} />
      <div style={{ marginTop: 16 }}>
        {tab === "project" ? <ProjectPanel projectId={projectId} detail={detail} onReload={onReload} onClose={onClose} /> : null}
        {tab === "pages" ? <PagesPanel projectId={projectId} detail={detail} onReload={onReload} /> : null}
        {tab === "entities" ? <EntitiesPanel projectId={projectId} detail={detail} onReload={onReload} /> : null}
        {tab === "members" ? <MembersPanel projectId={projectId} detail={detail} onReload={onReload} /> : null}
        {tab === "roles" ? <RolesPanel projectId={projectId} detail={detail} onReload={onReload} /> : null}
        {tab === "rules" ? <RulesPanel projectId={projectId} detail={detail} onReload={onReload} /> : null}
        {tab === "approval" ? <ApprovalPanel projectId={projectId} detail={detail} onReload={onReload} /> : null}
        {tab === "ai" ? <AiPanel projectId={projectId} /> : null}
        {tab === "assets" ? <AssetsPanel projectId={projectId} /> : null}
      </div>
    </Drawer>
  );
}

function Section({
  title,
  extra,
  children,
}: {
  title: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="lowcode-settings-section">
      <div className="lowcode-settings-head">
        <strong>{title}</strong>
        <div>{extra}</div>
      </div>
      {children}
    </div>
  );
}

function ProjectPanel({
  projectId,
  detail,
  onReload,
  onClose,
}: {
  projectId: number;
  detail: Detail;
  onReload: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    form.setFieldsValue({
      name: detail.project.name,
      description: detail.project.description,
      icon: detail.project.icon,
    });
  }, [detail.project, form]);

  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await lowcodeApi.updateProject({
        params: { id: String(projectId) },
        body: {
          name: String(values.name || ""),
          description: String(values.description || ""),
          icon: String(values.icon || ""),
        },
      });
      message.success("已保存");
      onReload();
    } catch (error) {
      if (error && typeof error === "object" && "errorFields" in error) return;
      message.error(errText(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    Modal.confirm({
      title: `删除应用「${detail.project.name}」？`,
      content: "应用内的数据表、字段、页面、审批与成员关系会一并删除，且不可恢复。",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await lowcodeApi.removeProject({ params: { id: String(projectId) } });
          message.success("应用已删除");
          onClose();
          router.push("/app-center");
        } catch (error) {
          message.error(errText(error));
          throw error;
        }
      },
    });
  };

  return (
    <Section title="基本信息">
      <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="归属组织">{detail.project.orgName || "仅本人"}</Descriptions.Item>
        <Descriptions.Item label="类型">{detail.project.typeLabel || detail.project.type}</Descriptions.Item>
        <Descriptions.Item label="我的角色">{detail.myRoleName || "成员"}</Descriptions.Item>
        <Descriptions.Item label="成员">{detail.project.memberCount} 人</Descriptions.Item>
      </Descriptions>
      <Form form={form} layout="vertical" style={{ maxWidth: 560 }}>
        <Form.Item name="name" label="应用名称" rules={[{ required: true, message: "请填写应用名称" }]}>
          <Input maxLength={100} />
        </Form.Item>
        <Form.Item name="description" label="说明">
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
        <Form.Item name="icon" label="图标标识">
          <Input maxLength={64} placeholder="appstore / audit / team / project / database" />
        </Form.Item>
        <Space>
          <Button type="primary" loading={saving} onClick={() => void save()}>
            保存设置
          </Button>
          {detail.project.isOwner ? (
            <Button danger onClick={remove}>
              删除应用
            </Button>
          ) : null}
        </Space>
      </Form>
    </Section>
  );
}

function PagesPanel({ projectId, detail, onReload }: { projectId: number; detail: Detail; onReload: () => void }) {
  const [editing, setEditing] = useState<Page | null>(null);
  const [creating, setCreating] = useState(false);

  const move = async (index: number, dir: -1 | 1) => {
    const ids = detail.pages.map((page) => page.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await lowcodeApi.reorderPages({ params: { id: String(projectId) }, body: { ids } });
      onReload();
    } catch (error) {
      message.error(errText(error));
    }
  };

  return (
    <Section
      title="页面"
      extra={
        <Button type="primary" onClick={() => setCreating(true)}>
          新建页面
        </Button>
      }
    >
      <Table<Page>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={detail.pages}
        locale={{ emptyText: <EmptyState text="还没有页面。" /> }}
        columns={[
          { title: "名称", dataIndex: "name" },
          { title: "类型", dataIndex: "typeLabel", render: (value: string, row) => value || LOWCODE_PAGE_TYPE_LABELS[row.type] || row.type },
          { title: "实体", key: "entity", render: (_: unknown, row) => detail.entities.find((entity) => entity.id === row.entityId)?.name || "—" },
          { title: "可见", dataIndex: "visible", render: (value: boolean) => (value ? "是" : "否") },
          {
            title: "操作",
            key: "actions",
            render: (_: unknown, row: Page, index: number) => (
              <Space size={2}>
                <Button type="link" size="small" onClick={() => setEditing(row)}>
                  编辑
                </Button>
                <Button type="link" size="small" disabled={index === 0} onClick={() => void move(index, -1)}>
                  上移
                </Button>
                <Button type="link" size="small" disabled={index === detail.pages.length - 1} onClick={() => void move(index, 1)}>
                  下移
                </Button>
                <Button
                  type="link"
                  size="small"
                  danger
                  onClick={() =>
                    Modal.confirm({
                      title: `删除页面「${row.name}」？`,
                      okText: "删除",
                      okButtonProps: { danger: true },
                      cancelText: "取消",
                      onOk: async () => {
                        try {
                          await lowcodeApi.removePage({ params: { id: String(projectId), pageId: String(row.id) } });
                          message.success("已删除");
                          onReload();
                        } catch (error) {
                          message.error(errText(error));
                          throw error;
                        }
                      },
                    })
                  }
                >
                  删除
                </Button>
              </Space>
            ),
          },
        ]}
      />
      {editing || creating ? (
        <PageModal
          projectId={projectId}
          entities={detail.entities}
          page={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={onReload}
        />
      ) : null}
    </Section>
  );
}

function PageModal({
  projectId,
  entities,
  page,
  onClose,
  onSaved,
}: {
  projectId: number;
  entities: Entity[];
  page: Page | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    form.setFieldsValue({
      name: page?.name || "",
      type: page?.type || "LIST",
      entityId: page?.entityId || 0,
      visible: page?.visible ?? true,
      config: page ? JSON.stringify(page.config || {}, null, 2) : "{}",
    });
  }, [page, form]);

  const save = async () => {
    try {
      const values = await form.validateFields();
      let config: Record<string, unknown> = {};
      const raw = String(values.config || "").trim();
      if (raw) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            config = parsed as Record<string, unknown>;
          } else {
            throw new Error("配置必须是 JSON 对象");
          }
        } catch {
          throw new Error("页面配置不是合法的 JSON 对象");
        }
      }
      setSaving(true);
      await lowcodeApi.savePage({
        params: { id: String(projectId) },
        body: {
          id: page?.id || 0,
          parentId: page?.parentId || 0,
          type: values.type,
          name: String(values.name || ""),
          entityId: Number(values.entityId) || 0,
          config,
          sort: page?.sort,
          visible: Boolean(values.visible),
        },
      });
      message.success("已保存");
      onSaved();
      onClose();
    } catch (error) {
      if (error && typeof error === "object" && "errorFields" in error) return;
      message.error(errText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title={page ? "编辑页面" : "新建页面"} width={640} confirmLoading={saving} onCancel={onClose} onOk={() => void save()} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="页面名称" rules={[{ required: true, message: "请填写页面名称" }]}>
          <Input maxLength={50} />
        </Form.Item>
        <Form.Item name="type" label="页面类型" rules={[{ required: true }]}>
          <Select
            options={LOWCODE_PAGE_TYPES.map((type) => ({
              value: type,
              label: LOWCODE_PAGE_TYPE_LABELS[type] || type,
            }))}
          />
        </Form.Item>
        <Form.Item name="entityId" label="绑定实体" extra="审批待办、数据看板、自由画布可以不绑定实体。">
          <Select
            options={[{ value: 0, label: "不绑定" }, ...entities.map((entity) => ({ value: entity.id, label: entity.name }))]}
          />
        </Form.Item>
        <Form.Item name="visible" label="成员可见" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item
          name="config"
          label="页面配置（JSON）"
          extra='列表页示例：{"columns":["title","status"]}；看板页：{"groupField":"status"}；自由画布请用工作台里的画布编辑器。'
        >
          <Input.TextArea rows={5} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function EntitiesPanel({ projectId, detail, onReload }: { projectId: number; detail: Detail; onReload: () => void }) {
  const [editing, setEditing] = useState<Entity | null>(null);
  const [creating, setCreating] = useState(false);
  const [fieldEntity, setFieldEntity] = useState<Entity | null>(null);

  return (
    <Section
      title="实体"
      extra={
        <Button type="primary" onClick={() => setCreating(true)}>
          新建实体
        </Button>
      }
    >
      <Table<Entity>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={detail.entities}
        locale={{ emptyText: <EmptyState text="还没有实体，先建一张数据表。" /> }}
        columns={[
          { title: "实体", dataIndex: "name" },
          {
            title: "字段",
            key: "fields",
            render: (_: unknown, row) => (
              <Space size={4} wrap>
                {row.fields.map((field) => (
                  <Tag key={field.fieldKey}>{field.name}</Tag>
                ))}
                {!row.fields.length ? <span className="muted">无字段</span> : null}
              </Space>
            ),
          },
          { title: "数据行", dataIndex: "rowCount", render: (value: number) => value || 0 },
          {
            title: "操作",
            key: "actions",
            width: 220,
            render: (_: unknown, row) => (
              <Space size={2}>
                <Button type="link" size="small" onClick={() => setEditing(row)}>
                  编辑
                </Button>
                <Button type="link" size="small" onClick={() => setFieldEntity(row)}>
                  字段
                </Button>
                <Button
                  type="link"
                  size="small"
                  danger
                  onClick={() =>
                    Modal.confirm({
                      title: `删除实体「${row.name}」？`,
                      content: "实体自建的数据表会一并删除；绑定的外部数据表只解绑。",
                      okText: "删除",
                      okButtonProps: { danger: true },
                      cancelText: "取消",
                      onOk: async () => {
                        try {
                          await lowcodeApi.removeEntity({ params: { id: String(projectId), entityId: String(row.id) } });
                          message.success("已删除");
                          onReload();
                        } catch (error) {
                          message.error(errText(error));
                          throw error;
                        }
                      },
                    })
                  }
                >
                  删除
                </Button>
              </Space>
            ),
          },
        ]}
      />
      {editing || creating ? (
        <EntityModal
          projectId={projectId}
          entity={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={onReload}
        />
      ) : null}
      {fieldEntity ? (
        <FieldsModal
          projectId={projectId}
          entity={fieldEntity}
          onClose={() => setFieldEntity(null)}
          onSaved={onReload}
        />
      ) : null}
    </Section>
  );
}

function EntityModal({
  projectId,
  entity,
  onClose,
  onSaved,
}: {
  projectId: number;
  entity: Entity | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [tables, setTables] = useState<{ id: number; name: string; fieldCount: number; rowCount: number }[]>([]);
  const [bindMode, setBindMode] = useState(false);

  useEffect(() => {
    form.setFieldsValue({ name: entity?.name || "", icon: entity?.icon || "table", dataTableId: 0, newTableName: "" });
    setBindMode(false);
    if (!entity) {
      void lowcodeApi
        .availableTables({ params: { id: String(projectId) } })
        .then((rows) => setTables(rows || []))
        .catch(() => setTables([]));
    }
  }, [entity, form, projectId]);

  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await lowcodeApi.saveEntity({
        params: { id: String(projectId) },
        body: {
          id: entity?.id || 0,
          name: String(values.name || ""),
          icon: String(values.icon || "table"),
          dataTableId: entity ? 0 : Number(values.dataTableId) || 0,
          newTableName: entity ? "" : String(values.newTableName || ""),
        },
      });
      message.success("已保存");
      onSaved();
      onClose();
    } catch (error) {
      if (error && typeof error === "object" && "errorFields" in error) return;
      message.error(errText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title={entity ? "编辑实体" : "新建实体"} width={620} confirmLoading={saving} onCancel={onClose} onOk={() => void save()} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="实体名称" rules={[{ required: true, message: "请填写实体名称" }]}>
          <Input maxLength={50} placeholder="例如：请购单" />
        </Form.Item>
        <Form.Item name="icon" label="图标标识">
          <Input maxLength={64} placeholder="table" />
        </Form.Item>
        {!entity ? (
          <>
            <Form.Item label="数据表">
              <Space>
                <Button type={bindMode ? "default" : "primary"} onClick={() => setBindMode(false)}>
                  新建数据表
                </Button>
                <Button type={bindMode ? "primary" : "default"} onClick={() => setBindMode(true)}>
                  绑定已有数据表
                </Button>
              </Space>
            </Form.Item>
            {bindMode ? (
              <Form.Item name="dataTableId" label="选择数据表" extra="只能绑定本项目创建或项目归属人自己的多维表格。">
                <Select
                  options={[
                    { value: 0, label: "不绑定" },
                    ...tables.map((table) => ({
                      value: table.id,
                      label: `${table.name}（${table.fieldCount} 列 / ${table.rowCount} 行）`,
                    })),
                  ]}
                />
              </Form.Item>
            ) : (
              <Form.Item name="newTableName" label="数据表名称" extra="留空则按「应用名 · 实体名」生成。">
                <Input maxLength={60} placeholder="例如：行政请购明细" />
              </Form.Item>
            )}
          </>
        ) : (
          <Notice variant="info">实体绑定在多维表格 #{entity.dataTableId} 上，列结构在「字段」里维护。</Notice>
        )}
      </Form>
    </Modal>
  );
}

function FieldsModal({
  projectId,
  entity,
  onClose,
  onSaved,
}: {
  projectId: number;
  entity: Entity;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fields, setFields] = useState(entity.fields);
  const [editing, setEditing] = useState<Entity["fields"][number] | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = () => {
    void lowcodeApi
      .entityFields({ params: { id: String(projectId), entityId: String(entity.id) } })
      .then((rows) => setFields(rows as Entity["fields"]))
      .catch((error: unknown) => message.error(errText(error)));
    onSaved();
  };

  return (
    <Modal open title={`${entity.name} · 字段`} width={760} footer={null} onCancel={onClose} destroyOnHidden>
      <div className="lowcode-toolbar" style={{ marginBottom: 10 }}>
        <Button type="primary" onClick={() => setCreating(true)}>
          添加字段
        </Button>
      </div>
      <Table<Entity["fields"][number]>
        rowKey="fieldKey"
        size="small"
        pagination={false}
        dataSource={fields}
        locale={{ emptyText: <EmptyState text="还没有字段。" /> }}
        columns={[
          { title: "字段", dataIndex: "name" },
          { title: "键", dataIndex: "fieldKey" },
          { title: "类型", dataIndex: "fieldType", render: (value: string) => LOWCODE_FIELD_TYPE_LABELS[value] || value },
          {
            title: "选项",
            key: "choices",
            render: (_: unknown, row) => {
              const choices = row.options?.choices;
              return Array.isArray(choices) && choices.length ? choices.map((item) => <Tag key={String(item)}>{String(item)}</Tag>) : "—";
            },
          },
          { title: "必填", dataIndex: "required", render: (value: boolean) => (value ? "是" : "否") },
          {
            title: "操作",
            key: "actions",
            render: (_: unknown, row) => (
              <Space size={2}>
                <Button type="link" size="small" onClick={() => setEditing(row)}>
                  编辑
                </Button>
                <Button
                  type="link"
                  size="small"
                  danger
                  onClick={() =>
                    Modal.confirm({
                      title: `删除字段「${row.name}」？`,
                      content: "已存数据里该列的值会一起删除。",
                      okText: "删除",
                      okButtonProps: { danger: true },
                      cancelText: "取消",
                      onOk: async () => {
                        try {
                          await lowcodeApi.removeEntityField({
                            params: { id: String(projectId), entityId: String(entity.id), fieldKey: row.fieldKey },
                          });
                          message.success("已删除");
                          reload();
                        } catch (error) {
                          message.error(errText(error));
                          throw error;
                        }
                      },
                    })
                  }
                >
                  删除
                </Button>
              </Space>
            ),
          },
        ]}
      />
      {editing || creating ? (
        <FieldModal
          projectId={projectId}
          entityId={entity.id}
          field={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={reload}
        />
      ) : null}
    </Modal>
  );
}

function FieldModal({
  projectId,
  entityId,
  field,
  onClose,
  onSaved,
}: {
  projectId: number;
  entityId: number;
  field: Entity["fields"][number] | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const choices = field?.options?.choices;
    form.setFieldsValue({
      name: field?.name || "",
      fieldType: field?.fieldType || "text",
      required: field?.required ?? false,
      choices: Array.isArray(choices) ? choices.join("，") : "",
    });
  }, [field, form]);

  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const choices = values.fieldType === "select"
        ? String(values.choices || "")
            .split(/[，,]/)
            .map((item) => item.trim())
            .filter(Boolean)
        : [];
      await lowcodeApi.saveEntityField({
        params: { id: String(projectId), entityId: String(entityId) },
        body: {
          fieldKey: field?.fieldKey || "",
          name: String(values.name || ""),
          fieldType: values.fieldType,
          required: Boolean(values.required),
          options: { choices },
        },
      });
      message.success("已保存");
      onSaved();
      onClose();
    } catch (error) {
      if (error && typeof error === "object" && "errorFields" in error) return;
      message.error(errText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title={field ? "编辑字段" : "添加字段"} width={560} confirmLoading={saving} onCancel={onClose} onOk={() => void save()} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="字段名称" rules={[{ required: true, message: "请填写字段名称" }]}>
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item name="fieldType" label="字段类型" rules={[{ required: true }]}>
          <Select options={LOWCODE_FIELD_TYPES.map((type) => ({ value: type, label: LOWCODE_FIELD_TYPE_LABELS[type] || type }))} />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(prev, next) => prev.fieldType !== next.fieldType}>
          {({ getFieldValue }) =>
            getFieldValue("fieldType") === "select" ? (
              <Form.Item name="choices" label="可选项" extra="用逗号分隔，例如：待处理，进行中，已完成">
                <Input.TextArea rows={2} />
              </Form.Item>
            ) : null
          }
        </Form.Item>
        <Form.Item name="required" label="必填" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function MembersPanel({ projectId, detail, onReload }: { projectId: number; detail: Detail; onReload: () => void }) {
  const [rows, setRows] = useState<LowCodeMemberView[]>(detail.members);
  const [candidates, setCandidates] = useState<{ userId: string; name: string; department: string; title: string; source: string }[]>([]);
  const [roles, setRoles] = useState<LowCodeRoleView[]>(detail.roles);
  const [selected, setSelected] = useState<string[]>([]);
  const [roleId, setRoleId] = useState(0);
  const [adding, setAdding] = useState(false);

  const load = () => {
    void lowcodeApi
      .members({ params: { id: String(projectId) } })
      .then((data) => {
        if (!data) return;
        setRows(data.rows as LowCodeMemberView[]);
        setCandidates(data.candidates as typeof candidates);
        setRoles(data.roles as LowCodeRoleView[]);
      })
      .catch((error: unknown) => message.error(errText(error)));
  };

  useEffect(load, [projectId]);

  const add = async () => {
    if (!selected.length) {
      message.warning("请选择成员");
      return;
    }
    setAdding(true);
    try {
      const result = await lowcodeApi.addMembers({
        params: { id: String(projectId) },
        body: { userIds: selected, roleId },
      });
      if (!result) throw new Error("添加失败");
      message.success(`已添加 ${result.added} 人${result.skipped ? `，跳过 ${result.skipped} 人` : ""}`);
      setSelected([]);
      load();
      onReload();
    } catch (error) {
      message.error(errText(error));
    } finally {
      setAdding(false);
    }
  };

  const changeRole = async (row: LowCodeMemberView, nextRoleId: number) => {
    try {
      await lowcodeApi.updateMember({
        params: { id: String(projectId), memberId: String(row.id) },
        body: { roleId: nextRoleId },
      });
      message.success("角色已更新");
      load();
      onReload();
    } catch (error) {
      message.error(errText(error));
    }
  };

  const roleOptions = roles.map((role) => ({ value: role.id, label: role.name }));

  return (
    <Section
      title="成员"
      extra={
        <span className="muted text-12">
          成员取自{detail.project.orgType ? "本组织在职员工" : "平台账号目录"}，权限按角色生效。
        </span>
      }
    >
      <div className="lowcode-toolbar" style={{ marginBottom: 10 }}>
        <Select
          mode="multiple"
          style={{ minWidth: 320 }}
          placeholder="选择要添加的成员"
          value={selected}
          onChange={setSelected}
          optionFilterProp="label"
          options={candidates.map((item) => ({
            value: item.userId,
            label: `${item.name || item.userId}${item.department ? ` · ${item.department}` : ""}`,
          }))}
        />
        <Select style={{ width: 160 }} value={roleId} options={[{ value: 0, label: "默认成员" }, ...roleOptions]} onChange={setRoleId} />
        <Button type="primary" loading={adding} onClick={() => void add()}>
          添加成员
        </Button>
      </div>
      <Table<LowCodeMemberView>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={rows}
        locale={{ emptyText: <EmptyState text="还没有成员。" /> }}
        columns={[
          { title: "成员", key: "name", render: (_: unknown, row) => row.memberName || row.memberUserId },
          { title: "部门", dataIndex: "department", render: (value: string) => value || "—" },
          { title: "职务", dataIndex: "title", render: (value: string) => value || "—" },
          {
            title: "角色",
            key: "role",
            render: (_: unknown, row) => (
              <Select
                size="small"
                style={{ width: 130 }}
                value={row.roleId || 0}
                options={[{ value: 0, label: "默认成员" }, ...roleOptions]}
                onChange={(value) => void changeRole(row, value)}
              />
            ),
          },
          {
            title: "操作",
            key: "actions",
            render: (_: unknown, row) => (
              <Button
                type="link"
                size="small"
                danger
                onClick={() =>
                  Modal.confirm({
                    title: `移除成员「${row.memberName || row.memberUserId}」？`,
                    okText: "移除",
                    okButtonProps: { danger: true },
                    cancelText: "取消",
                    onOk: async () => {
                      try {
                        await lowcodeApi.removeMember({ params: { id: String(projectId), memberId: String(row.id) } });
                        message.success("已移除");
                        load();
                        onReload();
                      } catch (error) {
                        message.error(errText(error));
                        throw error;
                      }
                    },
                  })
                }
              >
                移除
              </Button>
            ),
          },
        ]}
      />
    </Section>
  );
}

function RolesPanel({ projectId, detail, onReload }: { projectId: number; detail: Detail; onReload: () => void }) {
  const [roles, setRoles] = useState<LowCodeRoleView[]>(detail.roles);
  const [editing, setEditing] = useState<LowCodeRoleView | null>(null);
  const [creating, setCreating] = useState(false);
  const [permissionRole, setPermissionRole] = useState<LowCodeRoleView | null>(null);

  const load = () => {
    void lowcodeApi
      .roles({ params: { id: String(projectId) } })
      .then((rows) => setRoles(rows as LowCodeRoleView[]))
      .catch((error: unknown) => message.error(errText(error)));
  };

  return (
    <Section
      title="角色与权限"
      extra={
        <Button type="primary" onClick={() => setCreating(true)}>
          新建角色
        </Button>
      }
    >
      <Table<LowCodeRoleView>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={roles}
        columns={[
          { title: "角色", dataIndex: "name" },
          { title: "标识", dataIndex: "key" },
          { title: "成员", dataIndex: "memberCount" },
          { title: "说明", dataIndex: "description", render: (value: string) => value || "—" },
          {
            title: "操作",
            key: "actions",
            render: (_: unknown, row) => (
              <Space size={2}>
                <Button type="link" size="small" onClick={() => setPermissionRole(row)}>
                  配置权限
                </Button>
                <Button type="link" size="small" onClick={() => setEditing(row)}>
                  编辑
                </Button>
                {!row.builtin ? (
                  <Button
                    type="link"
                    size="small"
                    danger
                    onClick={() =>
                      Modal.confirm({
                        title: `删除角色「${row.name}」？`,
                        content: "该角色下的成员会回落到默认成员。",
                        okText: "删除",
                        okButtonProps: { danger: true },
                        cancelText: "取消",
                        onOk: async () => {
                          try {
                            await lowcodeApi.removeRole({ params: { id: String(projectId), roleId: String(row.id) } });
                            message.success("已删除");
                            load();
                            onReload();
                          } catch (error) {
                            message.error(errText(error));
                            throw error;
                          }
                        },
                      })
                    }
                  >
                    删除
                  </Button>
                ) : null}
              </Space>
            ),
          },
        ]}
      />
      {editing || creating ? (
        <RoleModal
          projectId={projectId}
          role={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            load();
            onReload();
          }}
        />
      ) : null}
      {permissionRole ? (
        <PermissionModal
          projectId={projectId}
          detail={detail}
          role={permissionRole}
          onClose={() => setPermissionRole(null)}
        />
      ) : null}
    </Section>
  );
}

function RoleModal({
  projectId,
  role,
  onClose,
  onSaved,
}: {
  projectId: number;
  role: LowCodeRoleView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    form.setFieldsValue({ key: role?.key || "", name: role?.name || "", description: role?.description || "" });
  }, [role, form]);

  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await lowcodeApi.saveRole({
        params: { id: String(projectId) },
        body: {
          id: role?.id || 0,
          key: role?.builtin ? "" : String(values.key || ""),
          name: String(values.name || ""),
          description: String(values.description || ""),
        },
      });
      message.success("已保存");
      onSaved();
      onClose();
    } catch (error) {
      if (error && typeof error === "object" && "errorFields" in error) return;
      message.error(errText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title={role ? "编辑角色" : "新建角色"} width={520} confirmLoading={saving} onCancel={onClose} onOk={() => void save()} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="角色名称" rules={[{ required: true, message: "请填写角色名称" }]}>
          <Input maxLength={50} />
        </Form.Item>
        {!role?.builtin ? (
          <Form.Item name="key" label="角色标识" extra="英文大写，例如 AUDITOR；留空自动生成。">
            <Input maxLength={32} />
          </Form.Item>
        ) : null}
        <Form.Item name="description" label="说明">
          <Input.TextArea rows={2} maxLength={200} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

type Matrix = {
  entity: Record<number, string[]>;
  page: Record<number, string[]>;
  field: Record<string, "hidden" | "readonly">;
};

function PermissionModal({
  projectId,
  detail,
  role,
  onClose,
}: {
  projectId: number;
  detail: Detail;
  role: LowCodeRoleView;
  onClose: () => void;
}) {
  const [matrix, setMatrix] = useState<Matrix>({ entity: {}, page: {}, field: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    void lowcodeApi
      .rolePermissions({ params: { id: String(projectId), roleId: String(role.id) } })
      .then((data) => {
        if (!data) return;
        const next: Matrix = { entity: {}, page: {}, field: {} };
        for (const row of data.permissions || []) {
          const type = String(row.resourceType || "");
          const resourceId = String(row.resourceId || "");
          const actions = Array.isArray(row.actions) ? row.actions.map((item) => String(item)) : [];
          if (type === "ENTITY" && resourceId) {
            next.entity[Number(resourceId)] = actions;
          } else if (type === "PAGE" && resourceId) {
            next.page[Number(resourceId)] = actions;
          } else if (type === "FIELD" && resourceId.includes(":")) {
            const state = actions.includes("hidden") ? "hidden" : actions.includes("readonly") ? "readonly" : undefined;
            if (state) next.field[resourceId] = state;
          }
        }
        setMatrix(next);
      })
      .catch((error: unknown) => message.error(errText(error)))
      .finally(() => setLoading(false));
  }, [projectId, role.id]);

  const toggle = (kind: "entity" | "page", id: number, action: string) => {
    setMatrix((current) => {
      const group = current[kind];
      const list = group[id] || [];
      const next = list.includes(action) ? list.filter((item) => item !== action) : [...list, action];
      return { ...current, [kind]: { ...group, [id]: next } };
    });
  };

  const setFieldState = (key: string, state: "hidden" | "readonly" | "") => {
    setMatrix((current) => {
      const next = { ...current.field };
      if (state) next[key] = state;
      else delete next[key];
      return { ...current, field: next };
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const permissions: { resourceType: "PAGE" | "ENTITY" | "FIELD"; resourceId: string; actions: string[] }[] = [];
      for (const [id, actions] of Object.entries(matrix.entity)) {
        if (actions.length) permissions.push({ resourceType: "ENTITY", resourceId: id, actions });
      }
      for (const [id, actions] of Object.entries(matrix.page)) {
        if (actions.length) permissions.push({ resourceType: "PAGE", resourceId: id, actions });
      }
      for (const [key, state] of Object.entries(matrix.field)) {
        permissions.push({ resourceType: "FIELD", resourceId: key, actions: [state] });
      }
      await lowcodeApi.saveRolePermissions({
        params: { id: String(projectId), roleId: String(role.id) },
        body: { permissions },
      });
      message.success("权限已保存");
      onClose();
    } catch (error) {
      message.error(errText(error));
    } finally {
      setSaving(false);
    }
  };

  const roleName = role.name;
  return (
    <Modal
      open
      title={`配置权限 · ${roleName}`}
      width={920}
      confirmLoading={saving}
      onCancel={onClose}
      onOk={() => void save()}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="所有者与管理员始终拥有全部权限；这里配置的是该角色在数据与页面上的可见范围。"
      />
      {loading ? (
        <EmptyState text="正在加载权限…" />
      ) : (
        <div className="lowcode-permission-grid">
          <Section title="数据实体">
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail.entities}
              locale={{ emptyText: <EmptyState text="暂无实体" /> }}
              columns={[
                { title: "实体", dataIndex: "name" },
                {
                  title: "动作",
                  key: "actions",
                  render: (_: unknown, row: Entity) => (
                    <Space size={4} wrap>
                      {LOWCODE_ACTIONS.filter((action) => action !== "design").map((action) => {
                        const active = (matrix.entity[row.id] || []).includes(action);
                        return (
                          <Tag
                            key={action}
                            color={active ? "blue" : undefined}
                            style={{ cursor: "pointer" }}
                            onClick={() => toggle("entity", row.id, action)}
                          >
                            {LOWCODE_ACTION_LABELS[action] || action}
                          </Tag>
                        );
                      })}
                    </Space>
                  ),
                },
              ]}
            />
          </Section>
          <Section title="页面可见">
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={detail.pages}
              locale={{ emptyText: <EmptyState text="暂无页面" /> }}
              columns={[
                { title: "页面", dataIndex: "name" },
                {
                  title: "可见",
                  key: "read",
                  render: (_: unknown, row: Page) => {
                    const active = (matrix.page[row.id] || []).includes("read");
                    return (
                      <Tag color={active ? "blue" : undefined} style={{ cursor: "pointer" }} onClick={() => toggle("page", row.id, "read")}>
                        {active ? "可见" : "不可见"}
                      </Tag>
                    );
                  },
                },
              ]}
            />
          </Section>
          <Section title="字段限制">
            {detail.entities.map((entity) => (
              <div key={entity.id} className="lowcode-field-rules">
                <strong>{entity.name}</strong>
                <div>
                  {entity.fields.map((field) => {
                    const key = `${entity.id}:${field.fieldKey}`;
                    const state = matrix.field[key] || "";
                    return (
                      <Select
                        key={key}
                        size="small"
                        style={{ width: 190, margin: "4px 6px 0 0" }}
                        value={state}
                        onChange={(value) => setFieldState(key, value)}
                        options={[
                          { value: "", label: `${field.name}：可读写` },
                          { value: "readonly", label: `${field.name}：只读` },
                          { value: "hidden", label: `${field.name}：隐藏` },
                        ]}
                      />
                    );
                  })}
                  {!entity.fields.length ? <span className="muted">无字段</span> : null}
                </div>
              </div>
            ))}
          </Section>
        </div>
      )}
    </Modal>
  );
}

function RulesPanel({ projectId, detail, onReload }: { projectId: number; detail: Detail; onReload: () => void }) {
  const [rules, setRules] = useState<{ id: number; entityId: number; roleId: number; field: string; op: string; value: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<(typeof rules)[number] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    void lowcodeApi
      .dataRules({ params: { id: String(projectId) } })
      .then((rows) => setRules(rows as typeof rules))
      .catch((error: unknown) => message.error(errText(error)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [projectId]);

  return (
    <Section
      title="数据规则"
      extra={
        <Button type="primary" onClick={() => setCreating(true)}>
          新建规则
        </Button>
      }
    >
      <Notice variant="info">
        {"行级规则：条件全部命中的行才对该角色可见。值可以使用 #{me} / #{myDept} / #{myOrg}，按当前登录人实时解析。"}
      </Notice>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        pagination={false}
        dataSource={rules}
        locale={{ emptyText: <EmptyState text="还没有数据规则。" /> }}
        columns={[
          {
            title: "实体",
            key: "entity",
            render: (_: unknown, row: (typeof rules)[number]) =>
              row.entityId ? detail.entities.find((entity) => entity.id === row.entityId)?.name || `#${row.entityId}` : "全项目",
          },
          {
            title: "角色",
            key: "role",
            render: (_: unknown, row: (typeof rules)[number]) =>
              row.roleId ? detail.roles.find((role) => role.id === row.roleId)?.name || `#${row.roleId}` : "全部角色",
          },
          { title: "字段", dataIndex: "field" },
          { title: "条件", dataIndex: "op" },
          { title: "值", dataIndex: "value", render: (value: string) => value || "—" },
          {
            title: "操作",
            key: "actions",
            render: (_: unknown, row: (typeof rules)[number]) => (
              <Space size={2}>
                <Button type="link" size="small" onClick={() => setEditing(row)}>
                  编辑
                </Button>
                <Button
                  type="link"
                  size="small"
                  danger
                  onClick={() =>
                    Modal.confirm({
                      title: "删除这条数据规则？",
                      okText: "删除",
                      okButtonProps: { danger: true },
                      cancelText: "取消",
                      onOk: async () => {
                        try {
                          await lowcodeApi.removeDataRule({ params: { id: String(projectId), ruleId: String(row.id) } });
                          message.success("已删除");
                          load();
                          onReload();
                        } catch (error) {
                          message.error(errText(error));
                          throw error;
                        }
                      },
                    })
                  }
                >
                  删除
                </Button>
              </Space>
            ),
          },
        ]}
      />
      {editing || creating ? (
        <RuleModal
          projectId={projectId}
          detail={detail}
          rule={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            load();
            onReload();
          }}
        />
      ) : null}
    </Section>
  );
}

function RuleModal({
  projectId,
  detail,
  rule,
  onClose,
  onSaved,
}: {
  projectId: number;
  detail: Detail;
  rule: { id: number; entityId: number; roleId: number; field: string; op: string; value: string } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    form.setFieldsValue({
      entityId: rule?.entityId || 0,
      roleId: rule?.roleId || 0,
      field: rule?.field || "createdBy",
      op: rule?.op || "=",
      value: rule?.value || "#{me}",
    });
  }, [rule, form]);

  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await lowcodeApi.saveDataRule({
        params: { id: String(projectId) },
        body: {
          id: rule?.id || 0,
          entityId: Number(values.entityId) || 0,
          roleId: Number(values.roleId) || 0,
          field: String(values.field || ""),
          op: values.op,
          value: String(values.value || ""),
        },
      });
      message.success("已保存");
      onSaved();
      onClose();
    } catch (error) {
      if (error && typeof error === "object" && "errorFields" in error) return;
      message.error(errText(error));
    } finally {
      setSaving(false);
    }
  };

  const fieldOptions = useMemo(() => {
    const special = [
      { value: "createdBy", label: "创建人（createdBy）" },
    ];
    const entityId = Number(form.getFieldValue("entityId")) || 0;
    const entity = detail.entities.find((item) => item.id === entityId);
    return [
      ...special,
      ...(entity?.fields || []).map((field) => ({ value: field.fieldKey, label: field.name })),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.entities]);

  return (
    <Modal open title={rule ? "编辑数据规则" : "新建数据规则"} width={560} confirmLoading={saving} onCancel={onClose} onOk={() => void save()} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item name="entityId" label="实体">
          <Select options={[{ value: 0, label: "全项目" }, ...detail.entities.map((entity) => ({ value: entity.id, label: entity.name }))]} />
        </Form.Item>
        <Form.Item name="roleId" label="角色">
          <Select
            options={[
              { value: 0, label: "全部非管理角色" },
              ...detail.roles.filter((role) => !["OWNER", "ADMIN"].includes(role.key)).map((role) => ({ value: role.id, label: role.name })),
            ]}
          />
        </Form.Item>
        <Form.Item noStyle shouldUpdate>
          {() => (
            <Form.Item name="field" label="字段" rules={[{ required: true, message: "请填写字段" }]}>
              <Select showSearch options={fieldOptions} />
            </Form.Item>
          )}
        </Form.Item>
        <Form.Item name="op" label="条件" rules={[{ required: true }]}>
          <Select options={LOWCODE_RULE_OPS.map((op) => ({ value: op, label: op }))} />
        </Form.Item>
        <Form.Item name="value" label="值" extra={`可用变量：${LOWCODE_RULE_VARS.join("、")}`}>
          <Input />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function ApprovalPanel({ projectId, detail, onReload }: { projectId: number; detail: Detail; onReload: () => void }) {
  const [flows, setFlows] = useState<LowCodeFlowView[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<LowCodeFlowView | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    void lowcodeApi
      .approvalFlows({ params: { id: String(projectId) } })
      .then((rows) => setFlows(rows as LowCodeFlowView[]))
      .catch((error: unknown) => message.error(errText(error)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [projectId]);

  return (
    <Section
      title="审批流程"
      extra={
        <Button type="primary" disabled={!detail.entities.length} onClick={() => setCreating(true)}>
          新建流程
        </Button>
      }
    >
      <Table<LowCodeFlowView>
        rowKey="id"
        size="small"
        loading={loading}
        pagination={false}
        dataSource={flows}
        locale={{ emptyText: <EmptyState text="还没有审批流程。" /> }}
        columns={[
          { title: "流程", dataIndex: "name" },
          {
            title: "实体",
            key: "entity",
            render: (_: unknown, row) => detail.entities.find((entity) => entity.id === row.entityId)?.name || `#${row.entityId}`,
          },
          {
            title: "节点",
            key: "nodes",
            render: (_: unknown, row) => (
              <Space size={4} wrap>
                {(row.nodes || []).map((node, index) => (
                  <Tag key={index}>{node.name || node.assigneeType}</Tag>
                ))}
              </Space>
            ),
          },
          { title: "状态", dataIndex: "status", render: (value: string) => <Tag color={value === "ACTIVE" ? "green" : "default"}>{value === "ACTIVE" ? "启用" : "停用"}</Tag> },
          { title: "版本", dataIndex: "version" },
          {
            title: "操作",
            key: "actions",
            render: (_: unknown, row) => (
              <Space size={2}>
                <Button type="link" size="small" onClick={() => setEditing(row)}>
                  编辑
                </Button>
                <Button
                  type="link"
                  size="small"
                  danger
                  onClick={() =>
                    Modal.confirm({
                      title: `删除流程「${row.name}」？`,
                      okText: "删除",
                      okButtonProps: { danger: true },
                      cancelText: "取消",
                      onOk: async () => {
                        try {
                          await lowcodeApi.removeApprovalFlow({ params: { id: String(projectId), flowId: String(row.id) } });
                          message.success("已删除");
                          load();
                          onReload();
                        } catch (error) {
                          message.error(errText(error));
                          throw error;
                        }
                      },
                    })
                  }
                >
                  删除
                </Button>
              </Space>
            ),
          },
        ]}
      />
      {editing || creating ? (
        <FlowModal
          projectId={projectId}
          detail={detail}
          flow={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            load();
            onReload();
          }}
        />
      ) : null}
    </Section>
  );
}

function FlowModal({
  projectId,
  detail,
  flow,
  onClose,
  onSaved,
}: {
  projectId: number;
  detail: Detail;
  flow: LowCodeFlowView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm();
  const [nodes, setNodes] = useState<LowCodeApprovalNode[]>(
    flow?.nodes?.length ? flow.nodes : [{ type: "APPROVE", name: "审批", assigneeType: "MANAGER", userIds: [], mode: "ANY" }],
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    form.setFieldsValue({
      name: flow?.name || "审批流程",
      entityId: flow?.entityId || detail.entities[0]?.id || 0,
      status: flow?.status || "ACTIVE",
    });
  }, [flow, form, detail.entities]);

  const updateNode = (index: number, patch: Partial<LowCodeApprovalNode>) => {
    setNodes((current) => current.map((node, i) => (i === index ? { ...node, ...patch } : node)));
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      if (!nodes.length) throw new Error("至少需要一个审批节点");
      setSaving(true);
      await lowcodeApi.saveApprovalFlow({
        params: { id: String(projectId) },
        body: {
          id: flow?.id || 0,
          entityId: Number(values.entityId),
          name: String(values.name || ""),
          status: values.status,
          nodes,
        },
      });
      message.success("已保存");
      onSaved();
      onClose();
    } catch (error) {
      if (error && typeof error === "object" && "errorFields" in error) return;
      message.error(errText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title={flow ? "编辑审批流程" : "新建审批流程"} width={760} confirmLoading={saving} onCancel={onClose} onOk={() => void save()} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="流程名称" rules={[{ required: true, message: "请填写流程名称" }]}>
          <Input maxLength={50} />
        </Form.Item>
        <Form.Item name="entityId" label="适用实体" rules={[{ required: true }]}>
          <Select options={detail.entities.map((entity) => ({ value: entity.id, label: entity.name }))} />
        </Form.Item>
        <Form.Item name="status" label="状态">
          <Select options={[{ value: "ACTIVE", label: "启用" }, { value: "DISABLED", label: "停用" }]} />
        </Form.Item>
        <div className="lowcode-flow-nodes">
          <div className="lowcode-settings-head">
            <strong>审批节点</strong>
            <Button
              onClick={() =>
                setNodes((current) => [
                  ...current,
                  { type: "APPROVE", name: `审批节点 ${current.length + 1}`, assigneeType: "MANAGER", userIds: [], mode: "ANY" },
                ])
              }
            >
              添加节点
            </Button>
          </div>
          {nodes.map((node, index) => (
            <div className="lowcode-flow-node" key={index}>
              <Input
                style={{ width: 180 }}
                value={node.name}
                onChange={(event) => updateNode(index, { name: event.target.value })}
                placeholder="节点名称"
              />
              <Select
                style={{ width: 140 }}
                value={node.assigneeType}
                onChange={(value) => updateNode(index, { assigneeType: value, userIds: [] })}
                options={[
                  { value: "USER", label: "指定成员" },
                  { value: "MANAGER", label: "直属主管" },
                  { value: "DEPT_LEADER", label: "部门负责人" },
                ]}
              />
              {node.assigneeType === "USER" ? (
                <Select
                  mode="multiple"
                  style={{ minWidth: 220 }}
                  placeholder="选择审批人"
                  value={node.userIds}
                  onChange={(value) => updateNode(index, { userIds: value })}
                  optionFilterProp="label"
                  options={detail.members.map((member) => ({
                    value: member.memberUserId,
                    label: member.memberName || member.memberUserId,
                  }))}
                />
              ) : null}
              <Select
                style={{ width: 110 }}
                value={node.mode}
                onChange={(value) => updateNode(index, { mode: value })}
                options={[{ value: "ANY", label: "任一人" }, { value: "ALL", label: "会签" }]}
              />
              <Button danger disabled={nodes.length <= 1} onClick={() => setNodes((current) => current.filter((_, i) => i !== index))}>
                删除
              </Button>
            </div>
          ))}
        </div>
      </Form>
    </Modal>
  );
}

function AiPanel({ projectId }: { projectId: number }) {
  const [settings, setSettings] = useState<{
    channelId: number;
    model: string;
    channels: { id: number; name: string; provider: string; enabled: boolean }[];
    models: string[];
    configured: boolean;
    message: string;
  } | null>(null);
  const [channelId, setChannelId] = useState(0);
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    void lowcodeApi
      .aiSettings({ params: { id: String(projectId) } })
      .then((data) => {
        if (!data) return;
        setSettings(data as typeof settings);
        setChannelId(data.channelId || 0);
        setModel(data.model || "");
        setModels(data.models || []);
      })
      .catch((error: unknown) => message.error(errText(error)))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    if (!channelId) {
      setModels([]);
      return;
    }
    void lowcodeApi
      .aiModels({ params: { id: String(projectId) }, query: { channelId } })
      .then((list) => setModels(list || []))
      .catch(() => setModels([]));
  }, [projectId, channelId]);

  const save = async () => {
    setSaving(true);
    try {
      await lowcodeApi.saveAiSettings({
        params: { id: String(projectId) },
        body: { channelId, model },
      });
      message.success("AI 设置已保存");
    } catch (error) {
      message.error(errText(error));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <EmptyState text="正在加载 AI 设置…" />;
  const channels = settings?.channels || [];

  return (
    <Section title="AI 设置">
      {!channels.length ? (
        <Notice variant="warn">
          还没有可用的模型渠道。请先到「模型设置」里配置渠道，再回来选择本应用使用的模型。
        </Notice>
      ) : (
        <>
          <Form layout="vertical" style={{ maxWidth: 560 }}>
            <Form.Item label="模型渠道">
              <Select
                value={channelId || undefined}
                placeholder="选择渠道"
                options={channels.map((channel) => ({ value: channel.id, label: `${channel.name}（${channel.provider}）` }))}
                onChange={(value) => {
                  setChannelId(value);
                  setModel("");
                }}
              />
            </Form.Item>
            <Form.Item label="模型">
              <Select
                value={model || undefined}
                placeholder={channelId ? "选择模型" : "先选择渠道"}
                disabled={!channelId}
                options={models.map((item) => ({ value: item, label: item }))}
                onChange={setModel}
              />
            </Form.Item>
            <Button type="primary" loading={saving} onClick={() => void save()}>
              保存设置
            </Button>
          </Form>
          {settings?.message ? <Notice variant="info">{settings.message}</Notice> : null}
        </>
      )}
    </Section>
  );
}

function AssetsPanel({ projectId }: { projectId: number }) {
  const [assets, setAssets] = useState<{ id: string | number; name: string; url: string; type: string; size: number; createdAt: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNo, setPageNo] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setLoading(true);
    void lowcodeApi
      .assets({
        params: { id: String(projectId) },
        query: { page: pageNo, pageSize: 10, keyword: keyword || undefined },
      })
      .then((data) => {
        if (!data) return;
        setAssets(data.list as typeof assets);
        setTotal(data.total);
      })
      .catch((error: unknown) => message.error(errText(error)))
      .finally(() => setLoading(false));
  }, [projectId, pageNo, keyword, reloadKey]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || "");
          resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      await lowcodeApi.uploadAsset({
        params: { id: String(projectId) },
        body: { name: file.name, contentType: file.type, contentBase64: base64, fieldKey: "" },
      });
      message.success("已上传到数字资产");
      setReloadKey((key) => key + 1);
    } catch (error) {
      message.error(errText(error));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Section
      title="附件（数字资产）"
      extra={
        <label className="ant-btn ant-btn-primary" style={{ cursor: "pointer", opacity: uploading ? 0.7 : 1 }}>
          <input
            type="file"
            style={{ display: "none" }}
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }}
          />
          {uploading ? "上传中…" : "上传文件"}
        </label>
      }
    >
      <div className="lowcode-toolbar" style={{ marginBottom: 10 }}>
        <Input.Search allowClear placeholder="搜索附件" style={{ width: 240 }} onSearch={(value) => { setKeyword(value); setPageNo(1); }} />
      </div>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={assets}
        pagination={{ current: pageNo, pageSize: 10, total, showSizeChanger: false, onChange: setPageNo }}
        locale={{ emptyText: <EmptyState text="还没有上传附件。" /> }}
        columns={[
          { title: "名称", dataIndex: "name", render: (value: string, row: (typeof assets)[number]) => (
            <a href={row.url || undefined} target="_blank" rel="noreferrer">
              {value || `#${row.id}`}
            </a>
          ) },
          { title: "类型", dataIndex: "type" },
          { title: "大小", dataIndex: "size", render: (value: number) => `${Math.max(1, Math.round((value || 0) / 1024))} KB` },
          { title: "上传时间", dataIndex: "createdAt" },
        ]}
      />
    </Section>
  );
}
