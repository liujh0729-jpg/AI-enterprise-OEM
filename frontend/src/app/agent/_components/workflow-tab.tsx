"use client";

import {
  ApartmentOutlined,
  BranchesOutlined,
  BuildOutlined,
  DeleteOutlined,
  EditOutlined,
  FileAddOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  ConfigProvider,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tooltip,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import type { WorkflowGraph, WorkflowOrg, WorkflowRow } from "@enterprise/contracts";
import { WORKFLOW_SCOPE_LABELS } from "@enterprise/contracts";
import type { WorkflowScope } from "@enterprise/contracts";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import {
  EmptyState,
  Notice,
  Panel,
  PillTabs,
  StatCard,
  StatGrid,
  TabStrip,
} from "@/components/ui/panel";
import type { PillTab } from "@/components/ui/panel";
import { workflowApi } from "@/api/workflow";
import { resolveStatus } from "@/lib/status";
import { useBusinessMutation, useBusinessQuery } from "@/query/business";
import { WorkflowEditor } from "@/app/workflow/_components/workflow-editor";
import { WorkflowRunsBody } from "@/app/workflow/_components/workflow-runs";
import { WORKFLOW_TEMPLATES } from "@/app/workflow/workflow-templates";

/**
 * 共享分组按主体拆：工作流的数据域跟着主体走，A 公司的流程不能和 B 公司的混在一个清单里。
 * 页签 key = `org:<主体>` / `provider:<主体>`，一个主体一页，由用户点选。
 */
function groupKey(orgType: string, orgUserId: string) {
  return `${orgType === "PROVIDER" ? "provider" : "org"}:${orgUserId}`;
}

function splitGroup(key: string): {
  group: "mine" | "org" | "provider";
  orgUserId: string;
} {
  const at = key.indexOf(":");
  if (at < 0) return { group: "mine", orgUserId: "" };
  return {
    group: key.slice(0, at) === "provider" ? "provider" : "org",
    orgUserId: key.slice(at + 1),
  };
}

function scopeLabel(orgType: string) {
  return orgType === "PROVIDER" ? "服务商共享" : "公司共享";
}

/** 新建弹窗的可见性下拉复合值：`PRIVATE` 或 `ORG:<主体>` / `PROVIDER:<主体>`。 */
function visibilityValue(orgType: string, orgUserId: string) {
  return `${orgType === "PROVIDER" ? "PROVIDER" : "ORG"}:${orgUserId}`;
}

function splitVisibility(value: string): {
  scope: WorkflowScope;
  orgUserId: string;
} {
  const provider = value.startsWith("PROVIDER:");
  const org = value.startsWith("ORG:");
  return {
    scope: provider ? "PROVIDER" : org ? "ORG" : "PRIVATE",
    orgUserId:
      provider || org ? value.slice(value.indexOf(":") + 1) : "",
  };
}

/** 主体名可能很长：单行截断 + 悬停看全名，不撑高页签/卡片。 */
function orgText(name: string, suffix: string) {
  const text = `${name} · ${suffix}`;
  return (
    <span
      title={text}
      style={{
        display: "block",
        maxWidth: 240,
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {text}
    </span>
  );
}

function zhTime(value: string) {
  return value ? value.replace("T", " ").slice(0, 16) : "—";
}

type CreateForm = {
  name: string;
  description?: string;
  visibility: string;
  /** 模板 key：blank＝空白工作流，其余对应内置配方。 */
  template: string;
};

type CreateBody = {
  name: string;
  description?: string;
  scope: WorkflowScope;
  orgUserId?: string;
  graph?: WorkflowGraph;
};

/**
 * Agent「工作流」页签：DAG 编排的清单与入口（原先独立的「工作流」菜单收进这里）。
 * 面板 extra 放「工作流清单 / 运行记录」页签条与「新建工作流」；正文放主体筛选与表格；画布在抽屉里。
 * 工作流发布后可被 Agent / MCP 按 `wf__编号` 调用，故与「MCP连接器」相邻。
 */
export function AgentWorkflowTab() {
  const { message } = App.useApp();
  const { request: requestPassword, modal: passwordModal } = usePasswordConfirm();
  const [form] = Form.useForm<CreateForm>();
  const [initial, setInitial] = useState<CreateForm>({
    name: "",
    description: "",
    visibility: "PRIVATE",
    template: "blank",
  });
  const [view, setView] = useState<"workflows" | "runs">("workflows");
  const [paging, setPaging] = useState({ page: 1, pageSize: 20 });
  const [group, setGroup] = useState("mine");
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  // 弹窗销毁重建：靠 key 让 Form 每次打开都回到初始值，避免在未挂载时调用 form 方法触发告警
  const [formKey, setFormKey] = useState(0);
  const [editorId, setEditorId] = useState<number | null>(null);
  const [editorReadOnly, setEditorReadOnly] = useState(false);
  const [templateKey, setTemplateKey] = useState("blank");
  const selectedTemplate = WORKFLOW_TEMPLATES.find((t) => t.key === templateKey);

  const selected = splitGroup(group);
  const query = {
    page: paging.page,
    pageSize: paging.pageSize,
    group: selected.group,
    ...(selected.orgUserId ? { orgUserId: selected.orgUserId } : {}),
    ...(status ? { status } : {}),
    ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
  };

  const listQuery = useBusinessQuery("workflows", "list", query, (signal) =>
    workflowApi.list({ query }, { signal }),
  );
  const rows: WorkflowRow[] = listQuery.data?.list || [];
  const counts = listQuery.data?.counts || {};
  const total = listQuery.data?.total || 0;
  const orgs: WorkflowOrg[] = listQuery.data?.orgs || [];
  const enterpriseOrgs = orgs.filter((org) => org.orgType !== "PROVIDER");
  const providerOrgs = orgs.filter((org) => org.orgType === "PROVIDER");

  const tabs: PillTab[] = [
    { key: "mine", label: "我的", count: counts.mine },
    ...orgs.map((org) => {
      const key = groupKey(org.orgType, org.orgUserId);
      return {
        key,
        label: orgText(org.name, scopeLabel(org.orgType)),
        count: counts[key],
      };
    }),
  ];
  // 切页签会换 queryKey，新结果回来前 orgs 是空的：此时不能判定页签失效，否则会被弹回「我的」。
  const orgsReady = listQuery.data !== undefined;
  const activeKey =
    orgsReady && !tabs.some((tab) => tab.key === group) ? "mine" : group;
  const active = splitGroup(activeKey);
  const orgKeys = orgs
    .map((org) => groupKey(org.orgType, org.orgUserId))
    .join("|");

  // 主体关系变了（离职 / 切换身份）后旧页签不再存在：回到「我的」，不留一个空高亮。
  useEffect(() => {
    if (!orgsReady) return;
    if (group !== "mine" && !orgKeys.split("|").includes(group)) setGroup("mine");
  }, [group, orgKeys, orgsReady]);

  const sumCounts = (list: WorkflowOrg[]) =>
    list.reduce(
      (sum, org) => sum + (counts[groupKey(org.orgType, org.orgUserId)] ?? 0),
      0,
    );
  const orgNameOf = (row: WorkflowRow) =>
    orgs.find(
      (org) => org.orgType === row.orgType && org.orgUserId === row.orgUserId,
    )?.name || "";

  const createMutation = useBusinessMutation(
    (body: CreateBody) => workflowApi.create({ body }),
    ["workflows"],
  );
  const removeMutation = useBusinessMutation(
    (input: { params: { id: string } }) => workflowApi.remove(input),
    ["workflows"],
  );
  const duplicateMutation = useBusinessMutation(
    (input: { params: { id: string } }) => workflowApi.duplicate(input),
    ["workflows"],
  );

  const resetPage = () => setPaging((prev) => ({ ...prev, page: 1 }));

  const openCreate = () => {
    // 从哪个主体的页签进来就默认共享到哪个主体；「我的」页签默认私有。
    setInitial({
      name: "",
      description: "",
      visibility:
        active.group === "mine"
          ? "PRIVATE"
          : visibilityValue(
              active.group === "provider" ? "PROVIDER" : "ENTERPRISE",
              active.orgUserId,
            ),
      template: "blank",
    });
    setTemplateKey("blank");
    setFormKey((key) => key + 1);
    setCreateOpen(true);
  };

  // 选模板即回填名称/说明；选「空白」清空，让用户自己写。
  const chooseTemplate = (key: string) => {
    setTemplateKey(key);
    const template = WORKFLOW_TEMPLATES.find((t) => t.key === key);
    form.setFieldsValue({
      name: template?.name ?? "",
      description: template?.description ?? "",
    });
  };

  const submitCreate = async () => {
    const values = await form.validateFields();
    const target = splitVisibility(values.visibility || "PRIVATE");
    const template = WORKFLOW_TEMPLATES.find((t) => t.key === values.template);
    setCreating(true);
    try {
      const created = await createMutation.mutateAsync({
        name: values.name.trim(),
        ...(values.description?.trim() ? { description: values.description.trim() } : {}),
        scope: target.scope,
        ...(target.orgUserId ? { orgUserId: target.orgUserId } : {}),
        ...(template ? { graph: template.graph } : {}),
      });
      if (!created) {
        message.error("创建工作流失败：未返回工作流");
        return;
      }
      setCreateOpen(false);
      message.success("已创建工作流，进入画布继续编排");
      setEditorReadOnly(false);
      setEditorId(created.id);
      await listQuery.refetch();
    } finally {
      setCreating(false);
    }
  };

  const openEditor = (row: WorkflowRow) => {
    setEditorReadOnly(!row.editable);
    setEditorId(row.id);
  };

  const duplicate = (row: WorkflowRow) => {
    duplicateMutation.mutate(
      { params: { id: String(row.id) } },
      { onSuccess: () => message.success("已复制为私有草稿") },
    );
  };

  const remove = (row: WorkflowRow) => {
    requestPassword({
      title: "删除工作流",
      okText: "确认删除",
      danger: true,
      content: `「${row.name}」删除后不可恢复；已发布的版本快照与历史运行记录会一并失效。`,
      onOk: async () => {
        await removeMutation.mutateAsync({ params: { id: String(row.id) } });
        message.success("工作流已删除");
      },
    });
  };

  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      {view === "workflows" ? (
        <>
          <StatGrid>
            <StatCard
              label="我的"
              value={counts.mine ?? "—"}
              hint="我创建、可编辑"
              icon={<UserOutlined aria-hidden />}
            />
            <StatCard
              label="公司共享"
              value={enterpriseOrgs.length ? sumCounts(enterpriseOrgs) : "—"}
              hint={
                enterpriseOrgs.length === 1
                  ? orgText(enterpriseOrgs[0].name, "可查看 / 运行")
                  : `${enterpriseOrgs.length} 个公司主体合计`
              }
              icon={<BuildOutlined aria-hidden />}
            />
            <StatCard
              label="服务商共享"
              value={providerOrgs.length ? sumCounts(providerOrgs) : "—"}
              hint={
                providerOrgs.length === 1
                  ? orgText(providerOrgs[0].name, "机构内共享")
                  : providerOrgs.length
                    ? `${providerOrgs.length} 个服务商主体合计`
                    : "未挂靠服务商机构"
              }
              icon={<TeamOutlined aria-hidden />}
            />
            <StatCard
              label="当前筛选"
              value={total}
              hint="命中条数"
              icon={<ApartmentOutlined aria-hidden />}
            />
          </StatGrid>

          <Notice variant="info">
            编排在画布里完成：左侧节点目录拖入 → 连线成 DAG → 右侧配置参数 → 自动排版 → 保存。
            发布后可在 Agent / MCP 中按 <code>wf__编号</code> 调用；共享按主体分开（一个公司 / 一个服务商一个数据域，不混在一起），共享工作流可查看与运行，编辑权归创建人。
          </Notice>
        </>
      ) : null}

      <Panel
        title="工作流"
        extra={
          <>
            <TabStrip
              items={[
                { key: "workflows", label: "工作流清单" },
                { key: "runs", label: "运行记录" },
              ]}
              value={view}
              onChange={(key) => setView(key as "workflows" | "runs")}
            />
            {view === "workflows" ? (
              <Button type="primary" icon={<FileAddOutlined />} onClick={openCreate}>
                新建工作流
              </Button>
            ) : null}
          </>
        }
      >
        {view === "runs" ? (
          <WorkflowRunsBody />
        ) : (
          <div className="table-wrap">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              <PillTabs
                items={tabs}
                value={activeKey}
                variant="soft"
                size="small"
                onChange={(key) => {
                  resetPage();
                  setGroup(key);
                }}
              />
              <div
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <Select
                  value={status}
                  style={{ width: 130 }}
                  onChange={(value) => {
                    resetPage();
                    setStatus(value);
                  }}
                  options={[
                    { value: "", label: "全部状态" },
                    { value: "DRAFT", label: "草稿" },
                    { value: "PUBLISHED", label: "已发布" },
                    { value: "ARCHIVED", label: "已归档" },
                  ]}
                />
                <Input.Search
                  allowClear
                  style={{ width: 220 }}
                  placeholder="搜索名称 / 说明"
                  onSearch={(value) => {
                    resetPage();
                    setKeyword(value);
                  }}
                />
              </div>
            </div>
            {listQuery.error && (
              <Notice variant="error">
                工作流加载失败：{listQuery.error.message}
              </Notice>
            )}
            <Table<WorkflowRow>
              rowKey="id"
              loading={listQuery.isPending}
              dataSource={rows}
              pagination={{
                current: paging.page,
                pageSize: paging.pageSize,
                total,
                onChange: (page, pageSize) => setPaging({ page, pageSize }),
              }}
              size="middle"
              locale={{
                emptyText: (
                  <EmptyState
                    icon={<BranchesOutlined aria-hidden />}
                    text={
                      activeKey === "mine"
                        ? "还没有工作流：点右上角「新建工作流」，从节点目录搭第一条自动化流程"
                        : "该主体下暂无共享工作流"
                    }
                  />
                ),
              }}
              columns={[
                {
                  title: "工作流",
                  dataIndex: "name",
                  render: (_: unknown, row: WorkflowRow) => (
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        <a onClick={() => openEditor(row)}>{row.name}</a>
                      </div>
                      {row.description ? (
                        <div className="text-12 muted" style={{ marginTop: 2 }}>
                          {row.description}
                        </div>
                      ) : null}
                    </div>
                  ),
                },
                {
                  title: "可见性",
                  dataIndex: "scopeLabel",
                  width: 180,
                  render: (_: unknown, row: WorkflowRow) => {
                    const orgName = row.scope === "PRIVATE" ? "" : orgNameOf(row);
                    return (
                      <div>
                        <span
                          className={`badge badge-${row.scope === "PRIVATE" ? "gray" : row.scope === "ORG" ? "sky" : "violet"}`}
                        >
                          {row.scopeLabel || WORKFLOW_SCOPE_LABELS[row.scope] || row.scope}
                        </span>
                        {orgName ? (
                          <div
                            className="text-12 muted"
                            title={orgName}
                            style={{
                              marginTop: 2,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {orgName}
                          </div>
                        ) : null}
                      </div>
                    );
                  },
                },
                {
                  title: "状态",
                  dataIndex: "statusLabel",
                  width: 100,
                  render: (_: unknown, row: WorkflowRow) => (
                    <span
                      className={`badge badge-${resolveStatus("workflow", row.status).variant}`}
                    >
                      {row.statusLabel || resolveStatus("workflow", row.status).label}
                    </span>
                  ),
                },
                {
                  title: "版本",
                  width: 120,
                  render: (_: unknown, row: WorkflowRow) => (
                    <div>
                      <div className="text-12">v{row.version}</div>
                      <div className="text-12 muted">
                        {row.publishedVersion
                          ? `已发布 v${row.publishedVersion}`
                          : "未发布"}
                      </div>
                    </div>
                  ),
                },
                {
                  title: "更新时间",
                  dataIndex: "updatedAt",
                  width: 150,
                  render: (value: string) => <span className="text-12">{zhTime(value)}</span>,
                },
                {
                  title: "操作",
                  width: 210,
                  render: (_: unknown, row: WorkflowRow) => (
                    <Space size={6} wrap>
                      {row.editable ? (
                        <Button
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => openEditor(row)}
                        >
                          编辑
                        </Button>
                      ) : (
                        <Button size="small" onClick={() => openEditor(row)}>
                          查看
                        </Button>
                      )}
                      <Button size="small" onClick={() => duplicate(row)}>
                        复制
                      </Button>
                      {row.editable ? (
                        <Tooltip title="删除后不可恢复">
                          <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => remove(row)}
                          />
                        </Tooltip>
                      ) : null}
                    </Space>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Panel>

      <Modal
        title="新建工作流"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void submitCreate()}
        confirmLoading={creating}
        okText="创建并编排"
        destroyOnHidden
      >
        <Form
          key={formKey}
          form={form}
          layout="vertical"
          initialValues={initial}
          style={{ marginTop: 12 }}
        >
          <Form.Item
            name="template"
            label="从模板开始"
            extra="选模板会预填名称与说明并带入流程图；选「空白」从零编排。"
          >
            <Select
              onChange={chooseTemplate}
              options={[
                { value: "blank", label: "空白工作流" },
                ...WORKFLOW_TEMPLATES.map((t) => ({
                  value: t.key,
                  label: t.name,
                })),
              ]}
            />
          </Form.Item>
          {selectedTemplate ? (
            <Form.Item label="试跑示例入参">
              <Typography.Paragraph
                copyable={{ text: JSON.stringify(selectedTemplate.sampleInput, null, 2) }}
                style={{ marginBottom: 0 }}
              >
                <code style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {JSON.stringify(selectedTemplate.sampleInput, null, 2)}
                </code>
              </Typography.Paragraph>
              <div className="text-12 muted" style={{ marginTop: 4 }}>
                创建后进入画布，把这段粘进 Playground 的入参即可看到有意义的产出（留空也能跑通，收件人默认是发起人本人）。
              </div>
            </Form.Item>
          ) : null}
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: "请填写工作流名称" }]}
          >
            <Input maxLength={120} placeholder="如：新线索自动建档并派单" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea
              rows={3}
              maxLength={500}
              showCount
              placeholder="写清触发条件与要达成的结果，便于同事复用"
            />
          </Form.Item>
          <Form.Item
            name="visibility"
            label="可见性"
            rules={[{ required: true, message: "请选择可见性" }]}
          >
            <Select
              options={[
                { value: "PRIVATE", label: WORKFLOW_SCOPE_LABELS.PRIVATE },
                ...orgs.map((org) => ({
                  value: visibilityValue(org.orgType, org.orgUserId),
                  label: `${org.name} · ${scopeLabel(org.orgType)}`,
                })),
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <WorkflowEditor
        id={editorId}
        readOnly={editorReadOnly}
        onClose={() => setEditorId(null)}
        onSaved={() => void listQuery.refetch()}
      />

      {passwordModal}
    </ConfigProvider>
  );
}
