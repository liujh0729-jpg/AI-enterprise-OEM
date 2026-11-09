"use client";

import {
  App,
  Button,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { TableProps } from "antd";
import {
  IM_DIRECTION_LABELS,
  IM_DIRECTIONS,
  IM_MODULE_LABELS,
  IM_MODULES,
  IM_NOTIFY_EVENTS,
  IM_NOTIFY_EVENT_LABELS,
  IM_NOTIFY_TARGETS,
  IM_PROVIDERS,
  type EndpointInput,
  type ImBinding,
  type ImConnector,
  type ImDeptLink,
  type ImEvent,
  type ImMemberLink,
  type ImOverview,
} from "@enterprise/contracts";
import { useCallback, useEffect, useState } from "react";
import { imApi } from "@/api/im";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { joinSiteUrl } from "@/lib/site-url";
import { useSiteBase } from "@/lib/site-brand";

const PROVIDER_OPTIONS = [
  { value: "FEISHU", label: "飞书" },
  { value: "WECOM", label: "企业微信" },
];

type NotifyTarget = (typeof IM_NOTIFY_TARGETS)[number];

const NOTIFY_TARGET_LABELS: Record<NotifyTarget, string> = {
  OFF: "不推送",
  USER: "推给负责人",
  CHAT: "推给群",
};

const NO_CONNECTOR = "先在「连接设置」建一个连接器。";

/** 连接器内的清单：切连接器自动重取，未选连接器时清空。 */
function useConnectorList<T>(
  connectorId: number,
  fetchRows: (id: string) => Promise<T[] | null>,
) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!connectorId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      setRows((await fetchRows(String(connectorId))) || []);
    } finally {
      setLoading(false);
    }
  }, [connectorId, fetchRows]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { rows, setRows, loading, reload };
}

const fetchDepts = (id: string) =>
  imApi.departments({ params: { id } }).then((data) => data || []);
const fetchBindings = (id: string) =>
  imApi.bindings({ params: { id } }).then((data) => data || []);

function useConnectorPicker(connectors: ImConnector[]) {
  const [connectorId, setConnectorId] = useState(0);
  useEffect(() => {
    if (!connectors.length) {
      setConnectorId(0);
      return;
    }
    setConnectorId((prev) =>
      connectors.some((item) => item.id === prev) ? prev : connectors[0].id,
    );
  }, [connectors]);
  const picker = connectors.length > 1 ? (
    <Select
      style={{ width: 280 }}
      value={connectorId || undefined}
      options={connectors.map((item) => ({
        value: item.id,
        label: `${item.providerLabel} · ${item.name}`,
      }))}
      onChange={(value: number) => setConnectorId(value)}
    />
  ) : null;
  return { connectorId, picker };
}

export function ConnectorPanel({
  connectors,
  reload,
}: {
  connectors: ImConnector[];
  reload: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  // 回调地址的域名：IM 后台只认绝对地址，跟站点域名走
  const siteBase = useSiteBase();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ImConnector | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(0);
  const [testTip, setTestTip] = useState("");

  const openEditor = (row: ImConnector | null) => {
    setEditing(row);
    setDraft({
      provider: row?.provider || "FEISHU",
      name: row?.name || "",
      corpId: row?.corpId || "",
      appId: row?.appId || "",
      appSecret: "",
      agentId: row?.agentId || "",
      contactSecret: "",
      verificationToken: row ? "" : "",
      encryptKey: "",
    });
    setOpen(true);
  };

  const commit = async () => {
    await imApi.saveConnector({
      body: {
        ...(editing ? { id: editing.id } : {}),
        provider: IM_PROVIDERS.find((value) => value === draft.provider) ?? "FEISHU",
        name: draft.name.trim(),
        corpId: draft.corpId.trim(),
        appId: draft.appId.trim(),
        appSecret: draft.appSecret.trim(),
        agentId: draft.agentId.trim(),
        contactSecret: draft.contactSecret.trim(),
        verificationToken: draft.verificationToken.trim(),
        encryptKey: draft.encryptKey.trim(),
      },
    });
    message.success(editing ? "连接器已保存" : "连接器已创建");
    setOpen(false);
    await reload();
  };

  const submit = async () => {
    if (!draft.name.trim()) {
      message.warning("请给连接器起个名字");
      return;
    }
    setSaving(true);
    try {
      if (!editing) {
        await commit();
        return;
      }
      request({
        title: "修改 IM 连接器",
        content: "修改连接器需要输入当前账号密码。",
        okText: "确认修改",
        onOk: commit,
      });
    } catch (caught) {
      message.error((caught as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const test = async (row: ImConnector) => {
    setTesting(row.id);
    setTestTip("");
    try {
      const result = await imApi.testConnector({ params: { id: String(row.id) } });
      if (!result) throw new Error("测试没有返回结果");
      setTestTip(`${row.name}：${result.message}`);
    } catch (caught) {
      setTestTip((caught as Error).message || "测试失败");
    } finally {
      setTesting(0);
    }
  };

  const remove = (row: ImConnector) => {
    request({
      title: "删除 IM 连接器",
      content: `删除「${row.name}」会同时清掉成员映射、同步对象与记录；已推到 IM 的消息不受影响。`,
      okText: "确认删除",
      danger: true,
      onOk: async () => {
        await imApi.deleteConnector({ params: { id: String(row.id) } });
        message.success("连接器已删除");
        await reload();
      },
    });
  };

  const copyPath = async (row: ImConnector) => {
    const url = joinSiteUrl(siteBase, row.webhookPath);
    try {
      await navigator.clipboard.writeText(url);
      message.success("回调地址已复制，填到 IM 后台的事件订阅里");
    } catch {
      message.warning(url);
    }
  };

  return (
    <Panel
      title="连接器"
      titleExtra={
        <span className="text-12 muted">
          一个组织一套凭据；通讯录、审批与任务都共用它
        </span>
      }
      extra={
        <Button type="primary" onClick={() => openEditor(null)}>
          新建连接
        </Button>
      }
    >
      {testTip ? (
        <div style={{ marginBottom: 10 }}>
          <Notice variant={/成功/.test(testTip) ? "success" : "warn"}>
            {testTip}
          </Notice>
        </div>
      ) : null}
      {connectors.length ? (
        <div style={{ display: "grid", gap: 12 }}>
          {connectors.map((row) => (
            <div key={row.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <Tag>{row.providerLabel}</Tag>
                <span style={{ fontWeight: 600 }}>{row.name}</span>
                <Tag color={row.status === "active" ? "green" : "default"}>
                  {row.status === "active" ? "启用" : "停用"}
                </Tag>
                <span className="text-12 muted">
                  {`${row.corpId || "未填企业ID"} · ${row.appId || "未填 App ID"}`}
                </span>
                <Space size={8} style={{ marginLeft: "auto" }} wrap>
                  <Button loading={testing === row.id} onClick={() => void test(row)}>
                    测试连接
                  </Button>
                  <Button onClick={() => void copyPath(row)}>复制回调地址</Button>
                  {row.canManage ? (
                    <>
                      <Button onClick={() => openEditor(row)}>编辑</Button>
                      <Button danger onClick={() => remove(row)}>
                        删除
                      </Button>
                    </>
                  ) : null}
                </Space>
              </div>
              <div className="text-12 muted" style={{ marginTop: 8, wordBreak: "break-all" }}>
                {`回调：${joinSiteUrl(siteBase, row.webhookPath) || row.webhookPath}`}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="还没有 IM 连接器。先在飞书或企业微信后台建自建应用，再把 App ID / Secret 填进来。" />
      )}

      <Modal
        open={open}
        title={editing ? "编辑 IM 连接器" : "新建 IM 连接器"}
        okText="保存设置"
        confirmLoading={saving}
        destroyOnHidden
        width={620}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <div className="text-12 muted">平台</div>
            <Radio.Group
              value={draft.provider}
              disabled={Boolean(editing)}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, provider: event.target.value }))
              }
            >
              {PROVIDER_OPTIONS.map((item) => (
                <Radio key={item.value} value={item.value}>
                  {item.label}
                </Radio>
              ))}
            </Radio.Group>
          </div>
          <Input
            placeholder="连接名称，例如：飞书（总部）"
            value={draft.name || ""}
            onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
          />
          <Input
            placeholder={draft.provider === "WECOM" ? "企业ID corpid（必填）" : "企业标识 tenant_key（可空）"}
            value={draft.corpId || ""}
            onChange={(event) => setDraft((prev) => ({ ...prev, corpId: event.target.value }))}
          />
          <Input
            placeholder="App ID"
            value={draft.appId || ""}
            onChange={(event) => setDraft((prev) => ({ ...prev, appId: event.target.value }))}
          />
          <Input.Password
            placeholder="App Secret（留空＝保留已保存的）"
            value={draft.appSecret || ""}
            onChange={(event) => setDraft((prev) => ({ ...prev, appSecret: event.target.value }))}
          />
          {draft.provider === "WECOM" ? (
            <>
              <Input
                placeholder="应用 AgentId（发消息用）"
                value={draft.agentId || ""}
                onChange={(event) => setDraft((prev) => ({ ...prev, agentId: event.target.value }))}
              />
              <Input.Password
                placeholder="通讯录同步 Secret（留空＝用应用 Secret）"
                value={draft.contactSecret || ""}
                onChange={(event) => setDraft((prev) => ({ ...prev, contactSecret: event.target.value }))}
              />
            </>
          ) : null}
          <Input.Password
            placeholder="事件 Encrypt Key（留空＝保留已保存的）"
            value={draft.encryptKey || ""}
            onChange={(event) => setDraft((prev) => ({ ...prev, encryptKey: event.target.value }))}
          />
          <Input
            placeholder="Verification Token（可空）"
            value={draft.verificationToken || ""}
            onChange={(event) => setDraft((prev) => ({ ...prev, verificationToken: event.target.value }))}
          />
          <div className="text-12 muted">
            保存后复制卡片上的回调地址，填到飞书「事件订阅」或企微「接收事件服务器」里。
          </div>
        </div>
      </Modal>
      {modal}
    </Panel>
  );
}

export function MemberPanel({
  connectors,
  reloadOverview,
}: {
  connectors: ImConnector[];
  reloadOverview: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const { connectorId, picker } = useConnectorPicker(connectors);
  const [linked, setLinked] = useState<ImMemberLink[]>([]);
  const [unlinked, setUnlinked] = useState<ImMemberLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [binding, setBinding] = useState<ImMemberLink | null>(null);
  const [memberUserId, setMemberUserId] = useState("");

  const load = useCallback(async () => {
    if (!connectorId) return;
    setLoading(true);
    try {
      const data = await imApi.members({ params: { id: String(connectorId) } });
      setLinked(data?.linked || []);
      setUnlinked(data?.unlinked || []);
    } catch (caught) {
      message.error((caught as Error).message || "成员映射读取失败");
    } finally {
      setLoading(false);
    }
  }, [connectorId, message]);

  useEffect(() => {
    void load();
  }, [load]);

  const pull = async () => {
    if (!connectorId) return;
    setSyncing(true);
    try {
      const result = await imApi.importMembers({
        params: { id: String(connectorId) },
      });
      if (!result) throw new Error("同步没有返回结果");
      message.success(
        `已拉取 ${result.pulled} 位，匹配 ${result.matched}，未绑定 ${result.unlinked}`,
      );
      await load();
      await reloadOverview();
    } catch (caught) {
      message.error((caught as Error).message || "同步失败");
    } finally {
      setSyncing(false);
    }
  };

  const bind = async () => {
    if (!binding || !memberUserId.trim()) {
      message.warning("请填本地账号 ID");
      return;
    }
    try {
      await imApi.linkMember({
        params: { id: String(connectorId) },
        body: {
          memberUserId: memberUserId.trim(),
          externalUserId: binding.externalUserId,
        },
      });
      message.success("已绑定");
      setBinding(null);
      await load();
      await reloadOverview();
    } catch (caught) {
      message.error((caught as Error).message || "绑定失败");
    }
  };

  const unlink = (row: ImMemberLink) => {
    request({
      title: "解除绑定",
      content: `解除后 ${row.memberName || row.externalUserId} 不再收到 IM 消息；IM 侧账号不动。`,
      okText: "确认解绑",
      danger: true,
      onOk: async () => {
        await imApi.unlinkMember({
          params: { id: String(connectorId) },
          body: { linkId: row.id },
        });
        await load();
        await reloadOverview();
      },
    });
  };

  const invite = (row: ImMemberLink) => {
    if (!memberUserId.trim()) {
      message.warning("先在弹窗里填要邀请的本地账号 ID");
      setBinding(row);
      return;
    }
    request({
      title: "发职员邀请",
      content: `会给账号 ${memberUserId} 发一条职员邀请，对方确认后绑定生效。`,
      okText: "发送邀请",
      onOk: async () => {
        await imApi.inviteUnlinked({
          params: { id: String(connectorId) },
          body: { externalUserId: row.externalUserId, memberUserId: memberUserId.trim() },
        });
        message.success("已发出邀请");
        setBinding(null);
        await load();
      },
    });
  };

  const columns: TableProps<ImMemberLink>["columns"] = [
    {
      title: "IM 成员",
      dataIndex: "nameSnapshot",
      render: (_value, row) => (
        <div>
          <div>{row.nameSnapshot || row.externalUserId}</div>
          <div className="text-12 muted">{row.externalUserId}</div>
        </div>
      ),
    },
    { title: "手机", dataIndex: "mobileSnapshot", width: 150 },
    {
      title: "本系统账号",
      dataIndex: "memberName",
      width: 180,
      render: (_value, row) => row.memberName || row.memberUserId || "未绑定",
    },
    { title: "来源", dataIndex: "source", width: 110 },
    {
      title: "操作",
      width: 140,
      render: (_value, row) =>
        row.status === "LINKED" ? (
          <Button size="small" danger onClick={() => unlink(row)}>
            解绑
          </Button>
        ) : (
          <Space size={4}>
            <Button size="small" onClick={() => setBinding(row)}>
              绑定
            </Button>
            <Button size="small" onClick={() => invite(row)}>
              邀请
            </Button>
          </Space>
        ),
    },
  ];

  return (
    <Panel
      title="成员映射"
      titleExtra={picker}
      extra={
        <Space size={8}>
          <Button loading={loading} onClick={() => void load()}>
            刷新
          </Button>
          <Button type="primary" loading={syncing} onClick={() => void pull()}>
            从 IM 同步
          </Button>
        </Space>
      }
    >
      {!connectorId ? (
        <EmptyState text={NO_CONNECTOR} />
      ) : (
        <div style={{ display: "grid", gap: 20 }}>
          <Notice variant="info">
            通讯录以本系统为准：从 IM 拉成员只用于建立绑定，不会自动建账号；匹配不到的成员可以发职员邀请，对方确认后才成为职员。
          </Notice>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              {`已绑定（${linked.length}）`}
            </div>
            {linked.length ? (
              <div className="table-wrap">
                <Table<ImMemberLink> rowKey="id" size="middle" dataSource={linked} columns={columns} pagination={false} scroll={{ x: "max-content" }} />
              </div>
            ) : (
              <div className="text-12 muted">还没有绑定成员。</div>
            )}
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              {`未绑定 / 待确认（${unlinked.length}）`}
            </div>
            {unlinked.length ? (
              <div className="table-wrap">
                <Table<ImMemberLink> rowKey="id" size="middle" dataSource={unlinked} columns={columns} pagination={false} scroll={{ x: "max-content" }} />
              </div>
            ) : (
              <div className="text-12 muted">没有待处理的成员。</div>
            )}
          </div>
        </div>
      )}

      <Modal
        open={Boolean(binding)}
        title={`绑定成员 · ${binding?.nameSnapshot || binding?.externalUserId || ""}`}
        okText="绑定"
        destroyOnHidden
        onCancel={() => setBinding(null)}
        onOk={() => void bind()}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <Input
            placeholder="本系统账号 ID（u- 开头）"
            value={memberUserId}
            onChange={(event) => setMemberUserId(event.target.value)}
          />
          <div className="text-12 muted">
            绑定只建立映射，不会给该账号发邀请；需要对方成为职员时另点「邀请」。
          </div>
        </div>
      </Modal>
      {modal}
    </Panel>
  );
}

export function DeptPanel({ connectors }: { connectors: ImConnector[] }) {
  const { message } = App.useApp();
  const { connectorId, picker } = useConnectorPicker(connectors);
  const { rows, reload } = useConnectorList(connectorId, fetchDepts);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ department: "", externalDeptId: "", name: "", parentExternalId: "" });

  const save = async () => {
    if (!draft.department.trim() || !draft.externalDeptId.trim()) {
      message.warning("请填本地部门名与 IM 部门ID");
      return;
    }
    try {
      await imApi.saveDeptLink({
        params: { id: String(connectorId) },
        body: { ...draft },
      });
      message.success("部门映射已保存");
      setOpen(false);
      setDraft({ department: "", externalDeptId: "", name: "", parentExternalId: "" });
      await reload();
    } catch (caught) {
      message.error((caught as Error).message || "保存失败");
    }
  };

  return (
    <Panel
      title="部门映射"
      titleExtra={picker}
      extra={
        <Button type="primary" disabled={!connectorId} onClick={() => setOpen(true)}>
          新增映射
        </Button>
      }
    >
      {!connectorId ? (
        <EmptyState text={NO_CONNECTOR} />
      ) : rows.length ? (
        <div className="table-wrap">
          <Table<ImDeptLink>
            rowKey="id"
            size="middle"
            dataSource={rows}
            pagination={false}
            scroll={{ x: "max-content" }}
            columns={[
              { title: "本地部门", dataIndex: "department" },
              { title: "IM 部门名", dataIndex: "name" },
              { title: "IM 部门ID", dataIndex: "externalDeptId" },
              { title: "上级部门ID", dataIndex: "parentExternalId" },
            ]}
          />
        </div>
      ) : (
        <EmptyState text="还没有部门映射。填写本地部门名与 IM 部门ID 即可对应。" />
      )}

      <Modal open={open} title="新增部门映射" okText="保存设置" destroyOnHidden onCancel={() => setOpen(false)} onOk={() => void save()}>
        <div style={{ display: "grid", gap: 10 }}>
          <Input placeholder="本地部门名（org_staff.department）" value={draft.department} onChange={(event) => setDraft((prev) => ({ ...prev, department: event.target.value }))} />
          <Input placeholder="IM 部门ID" value={draft.externalDeptId} onChange={(event) => setDraft((prev) => ({ ...prev, externalDeptId: event.target.value }))} />
          <Input placeholder="IM 部门名（可选）" value={draft.name} onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} />
          <Input placeholder="上级部门ID（可选）" value={draft.parentExternalId} onChange={(event) => setDraft((prev) => ({ ...prev, parentExternalId: event.target.value }))} />
        </div>
      </Modal>
    </Panel>
  );
}

export function ObjectPanel({ connectors }: { connectors: ImConnector[] }) {
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const { connectorId, picker } = useConnectorPicker(connectors);
  const { rows, reload } = useConnectorList(connectorId, fetchBindings);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{
    module: EndpointInput<"Im_saveBinding">["body"]["module"];
    objectKey: string;
    direction: NonNullable<EndpointInput<"Im_saveBinding">["body"]["direction"]>;
    config: string;
    fieldMap: string;
  }>({
    module: "APPROVAL",
    objectKey: "",
    direction: "PUSH",
    config: "{}",
    fieldMap: "{}",
  });
  const [templates, setTemplates] = useState<{ key: string; name: string }[]>([]);
  const [externalTemplateId, setExternalTemplateId] = useState("");
  const [templateKey, setTemplateKey] = useState("");

  useEffect(() => {
    if (!connectorId) return;
    void imApi
      .approvalTemplates({ params: { id: String(connectorId) } })
      .then((data) => setTemplates(data || []))
      .catch(() => setTemplates([]));
  }, [connectorId]);

  const save = async () => {
    try {
      const config = JSON.parse(draft.config || "{}") as Record<string, unknown>;
      const fieldMap = JSON.parse(draft.fieldMap || "{}") as Record<string, string>;
      await imApi.saveBinding({
        params: { id: String(connectorId) },
        body: {
          module: draft.module,
          objectKey: draft.objectKey.trim(),
          direction: draft.direction,
          config,
          fieldMap,
        },
      });
      message.success("同步对象已保存");
      setOpen(false);
      await reload();
    } catch (caught) {
      message.error((caught as Error).message || "保存失败，请检查 JSON");
    }
  };

  const remove = (row: ImBinding) => {
    request({
      title: "删除同步对象",
      content: `删除「${row.objectKey}」的同步配置，不影响已同步的数据。`,
      okText: "确认删除",
      danger: true,
      onOk: async () => {
        await imApi.deleteBinding({
          params: { id: String(connectorId), bindingId: String(row.id) },
        });
        await reload();
      },
    });
  };

  const publishApproval = async () => {
    if (!templateKey) {
      message.warning("请选择 OA 模板");
      return;
    }
    try {
      await imApi.publishApproval({
        params: { id: String(connectorId) },
        body: { templateKey, externalTemplateId: externalTemplateId.trim() },
      });
      message.success("审批模板已绑定");
      await reload();
    } catch (caught) {
      message.error((caught as Error).message || "绑定失败");
    }
  };

  return (
    <Panel
      title="同步对象"
      titleExtra={picker}
      extra={
        <Button type="primary" disabled={!connectorId} onClick={() => setOpen(true)}>
          新增对象
        </Button>
      }
    >
      {!connectorId ? (
        <EmptyState text={NO_CONNECTOR} />
      ) : (
        <div style={{ display: "grid", gap: 20 }}>
          {rows.length ? (
            <div className="table-wrap">
              <Table<ImBinding>
                rowKey="id"
                size="middle"
                dataSource={rows}
                pagination={false}
                scroll={{ x: "max-content" }}
                columns={[
                  { title: "模块", dataIndex: "moduleLabel" },
                  { title: "对象", dataIndex: "objectKey" },
                  { title: "方向", dataIndex: "directionLabel" },
                  {
                    title: "外部配置",
                    dataIndex: "config",
                    render: (value: unknown) => (
                      <Typography.Text ellipsis style={{ maxWidth: 320 }}>
                        {JSON.stringify(value || {})}
                      </Typography.Text>
                    ),
                  },
                  {
                    title: "操作",
                    width: 140,
                    render: (_value, row) => (
                      <Space size={4}>
                        <Button
                          size="small"
                          onClick={async () => {
                            const result = await imApi.bindingTest({
                              params: { id: String(connectorId) },
                              body: { module: IM_MODULES.find((value) => value === row.module) ?? "APPROVAL", config: row.config },
                            });
                            message.info(result?.message || "已测试");
                          }}
                        >
                          测试
                        </Button>
                        <Button size="small" danger onClick={() => remove(row)}>
                          删除
                        </Button>
                      </Space>
                    ),
                  },
                ]}
              />
            </div>
          ) : (
            <EmptyState text="还没有同步对象。审批、下单任务、多维表格都要先在这里绑定。" />
          )}

          <section>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>OA 审批绑定</div>
            <Space size={8} wrap>
              <Select
                style={{ width: 240 }}
                placeholder="选择 OA 模板"
                value={templateKey || undefined}
                options={templates.map((item) => ({ value: item.key, label: item.name }))}
                onChange={(value: string) => setTemplateKey(value)}
              />
              <Input
                style={{ width: 280 }}
                placeholder="外部模板 ID（飞书审批定义 Code / 企微模板 ID）"
                value={externalTemplateId}
                onChange={(event) => setExternalTemplateId(event.target.value)}
              />
              <Button onClick={() => void publishApproval()}>绑定模板</Button>
            </Space>
            <div className="text-12 muted" style={{ marginTop: 6 }}>
              企业微信只能绑定后台已建好的模板；飞书填审批定义 Code。双向镜像的「谁发起谁审批」在提交单据时生效。
            </div>
          </section>
        </div>
      )}

      <Modal open={open} title="新增同步对象" okText="保存设置" destroyOnHidden width={620} onCancel={() => setOpen(false)} onOk={() => void save()}>
        <div style={{ display: "grid", gap: 10 }}>
          <Select
            value={draft.module}
            options={IM_MODULES.map((value) => ({ value, label: IM_MODULE_LABELS[value] }))}
            onChange={(value) => setDraft((prev) => ({ ...prev, module: value }))}
          />
          <Input placeholder="对象键：OA 模板 key / 任务清单 / app_token+table_id" value={draft.objectKey} onChange={(event) => setDraft((prev) => ({ ...prev, objectKey: event.target.value }))} />
          <Select
            value={draft.direction}
            options={IM_DIRECTIONS.map((value) => ({ value, label: IM_DIRECTION_LABELS[value] }))}
            onChange={(value) => setDraft((prev) => ({ ...prev, direction: value }))}
          />
          <Input.TextArea rows={4} placeholder='外部配置 JSON，例如 {"externalTemplateId":"xxx"}' value={draft.config} onChange={(event) => setDraft((prev) => ({ ...prev, config: event.target.value }))} />
          <Input.TextArea rows={3} placeholder='字段映射 JSON，例如 {"name":"名称"}' value={draft.fieldMap} onChange={(event) => setDraft((prev) => ({ ...prev, fieldMap: event.target.value }))} />
        </div>
      </Modal>
      {modal}
    </Panel>
  );
}

export function NotifyPanel({ connectors }: { connectors: ImConnector[] }) {
  const { message } = App.useApp();
  const { connectorId, picker } = useConnectorPicker(connectors);
  const [rules, setRules] = useState<Record<string, { target: NotifyTarget; chatId: string }>>({});
  const [saving, setSaving] = useState(false);
  const [testChat, setTestChat] = useState("");
  const [testMember, setTestMember] = useState("");

  const load = useCallback(async () => {
    if (!connectorId) return;
    const data = await imApi.notifyRules({ params: { id: String(connectorId) } });
    const map: Record<string, { target: NotifyTarget; chatId: string }> = {};
    for (const item of data?.rules || []) {
      if (item.event) {
        map[item.event] = {
          target: IM_NOTIFY_TARGETS.find((value) => value === item.target) ?? "OFF",
          chatId: item.chatId,
        };
      }
    }
    setRules(map);
  }, [connectorId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await imApi.saveNotifyRules({
        params: { id: String(connectorId) },
        body: {
          rules: IM_NOTIFY_EVENTS.map((event) => ({
            event,
            target: rules[event]?.target || "OFF",
            chatId: rules[event]?.chatId || "",
          })),
        },
      });
      message.success("通知规则已保存");
    } catch (caught) {
      message.error((caught as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    try {
      const result = await imApi.testNotify({
        params: { id: String(connectorId) },
        body: {
          target: testChat.trim() ? "CHAT" : "USER",
          chatId: testChat.trim(),
          memberUserId: testMember.trim(),
        },
      });
      message.success(result?.message || "测试消息已发送");
    } catch (caught) {
      message.error((caught as Error).message || "发送失败");
    }
  };

  return (
    <Panel
      title="通知规则"
      titleExtra={picker}
      extra={
        <Button type="primary" loading={saving} disabled={!connectorId} onClick={() => void save()}>
          保存设置
        </Button>
      }
    >
      {!connectorId ? (
        <EmptyState text={NO_CONNECTOR} />
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          <Notice variant="info">
            推送到 IM 只发标题、关键数字与回跳链接；卡片按钮只做跳转，不做审批回调。
          </Notice>
          <div style={{ display: "grid", gap: 8 }}>
            {IM_NOTIFY_EVENTS.map((event) => {
              const rule = rules[event] || { target: "OFF", chatId: "" };
              return (
                <div key={event} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ width: 160 }}>{IM_NOTIFY_EVENT_LABELS[event]}</span>
                  <Select
                    style={{ width: 160 }}
                    value={rule.target}
                    options={IM_NOTIFY_TARGETS.map((value) => ({ value, label: NOTIFY_TARGET_LABELS[value] }))}
                    onChange={(value) =>
                      setRules((prev) => ({ ...prev, [event]: { ...rule, target: value } }))
                    }
                  />
                  {rule.target === "CHAT" ? (
                    <Input
                      style={{ width: 260 }}
                      placeholder="群 ID / chat_id"
                      value={rule.chatId}
                      onChange={(input) =>
                        setRules((prev) => ({
                          ...prev,
                          [event]: { ...rule, chatId: input.target.value },
                        }))
                      }
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
          <section>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>发一条测试消息</div>
            <Space size={8} wrap>
              <Input style={{ width: 220 }} placeholder="群 ID（留空＝发给下面的成员）" value={testChat} onChange={(event) => setTestChat(event.target.value)} />
              <Input style={{ width: 220 }} placeholder="成员本地账号 ID" value={testMember} onChange={(event) => setTestMember(event.target.value)} />
              <Button onClick={() => void test()}>发送测试</Button>
            </Space>
          </section>
        </div>
      )}
    </Panel>
  );
}

export function LogPanel({ connectors }: { connectors: ImConnector[] }) {
  const { message } = App.useApp();
  const { connectorId, picker } = useConnectorPicker(connectors);
  const [rows, setRows] = useState<ImEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (nextPage = page) => {
      if (!connectorId) return;
      setLoading(true);
      try {
        const data = await imApi.syncLogs({
          params: { id: String(connectorId) },
          query: { page: nextPage, pageSize: 20 },
        });
        setRows(data?.list || []);
        setTotal(data?.total || 0);
      } catch (caught) {
        message.error((caught as Error).message || "同步记录读取失败");
      } finally {
        setLoading(false);
      }
    },
    [connectorId, page, message],
  );

  useEffect(() => {
    void load(1);
    setPage(1);
  }, [connectorId, load]);

  return (
    <Panel
      title="同步记录"
      titleExtra={picker}
      extra={
        <Button loading={loading} disabled={!connectorId} onClick={() => void load()}>
          刷新
        </Button>
      }
    >
      {!connectorId ? (
        <EmptyState text={NO_CONNECTOR} />
      ) : rows.length ? (
        <div className="table-wrap">
          <Table<ImEvent>
            rowKey="id"
            size="middle"
            loading={loading}
            dataSource={rows}
            scroll={{ x: "max-content" }}
            pagination={{
              current: page,
              pageSize: 20,
              total,
              showSizeChanger: false,
              onChange: (next) => {
                setPage(next);
                void load(next);
              },
            }}
            columns={[
              { title: "时间", dataIndex: "createdAt", width: 180 },
              { title: "方向", dataIndex: "direction", width: 80 },
              { title: "类型", dataIndex: "kind", width: 90 },
              { title: "对象", dataIndex: "objectType", width: 120 },
              {
                title: "状态",
                dataIndex: "status",
                width: 100,
                render: (value: string) => (
                  <Tag color={value === "DONE" ? "green" : value === "FAILED" ? "red" : "default"}>
                    {value}
                  </Tag>
                ),
              },
              { title: "错误", dataIndex: "error", ellipsis: true },
              {
                title: "操作",
                width: 90,
                render: (_value, row) =>
                  row.status === "FAILED" ? (
                    <Button
                      size="small"
                      onClick={async () => {
                        await imApi.retryEvent({
                          params: { id: String(connectorId), eventId: row.eventId },
                        });
                        message.success("已重试");
                        await load();
                      }}
                    >
                      重试
                    </Button>
                  ) : null,
              },
            ]}
          />
        </div>
      ) : (
        <EmptyState text="还没有同步记录。" />
      )}
    </Panel>
  );
}

export function ImOverviewCards({ overview }: { overview: ImOverview | null }) {
  if (!overview) return null;
  const items = [
    { label: "连接器", value: overview.connectors },
    { label: "已绑定成员", value: overview.linkedMembers },
    { label: "待处理成员", value: overview.pendingMembers },
    { label: "失败事件", value: overview.failedEvents },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
      {items.map((item) => (
        <div key={item.label} className="card" style={{ padding: 14 }}>
          <div className="text-12 muted">{item.label}</div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}