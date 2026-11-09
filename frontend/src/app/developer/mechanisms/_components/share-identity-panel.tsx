"use client";

import { CopyOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { mechanismsApi } from "@/api/mechanisms";
import { Notice, Panel, PillTabs } from "@/components/ui/panel";
import { fmtDate } from "@/lib/datetime";
import {
  SHARE_KIND_LABELS,
  mechError,
  type AssetSharePolicy,
  type OidcProvider,
  type Share,
} from "./mechanisms-common";

const SHARE_KIND_OPTIONS = Object.entries(SHARE_KIND_LABELS).map(([value, label]) => ({
  value,
  label,
}));

function shareUrl(row: Share) {
  if (!row.url) return "";
  if (/^https?:\/\//.test(row.url)) return row.url;
  if (typeof window === "undefined") return row.url;
  return `${window.location.origin}${row.url}`;
}

export function ShareIdentityPanel() {
  const { message } = App.useApp();
  const [tab, setTab] = useState("shares");

  const [shares, setShares] = useState<Share[]>([]);
  const [shareForm] = Form.useForm();
  const [shareOpen, setShareOpen] = useState(false);

  const [providers, setProviders] = useState<OidcProvider[]>([]);
  const [oidcForm] = Form.useForm();
  const [oidcOpen, setOidcOpen] = useState(false);
  const [oidcEditing, setOidcEditing] = useState<OidcProvider | null>(null);

  const [policy, setPolicy] = useState<AssetSharePolicy | null>(null);
  const [policyForm] = Form.useForm();
  const [policySaving, setPolicySaving] = useState(false);

  const loadShares = useCallback(async () => {
    const data = await mechanismsApi.shares({ query: { page: 1, pageSize: 50 } });
    setShares(data?.list || []);
  }, []);

  const loadProviders = useCallback(async () => {
    setProviders((await mechanismsApi.oidcProviders()) || []);
  }, []);

  const loadPolicy = useCallback(async () => {
    const data = await mechanismsApi.assetSharePolicy();
    setPolicy(data);
    if (data) {
      policyForm.setFieldsValue({
        name: data.name,
        defaultExpiresDays: data.defaultExpiresDays,
        maxExpiresDays: data.maxExpiresDays,
        requirePassword: data.requirePassword,
        allowPublic: data.allowPublic,
        allowedKinds: data.allowedKinds,
      });
    }
  }, [policyForm]);

  useEffect(() => {
    void loadShares().catch((err) => message.error(mechError(err)));
    void loadProviders().catch((err) => message.error(mechError(err)));
    void loadPolicy().catch((err) => message.error(mechError(err)));
  }, [loadShares, loadProviders, loadPolicy, message]);

  // ---------- 分享 ----------
  const openShare = () => {
    shareForm.setFieldsValue({
      kind: "REPORT",
      targetId: "",
      title: "",
      password: "",
      expiresDays: 7,
    });
    setShareOpen(true);
  };

  const submitShare = async () => {
    const values = await shareForm.validateFields();
    try {
      await mechanismsApi.createShare({
        body: {
          kind: values.kind,
          targetId: values.targetId,
          title: values.title,
          projection: {},
          password: values.password || "",
          expiresDays: values.expiresDays ?? 7,
        },
      });
      message.success("分享链接已创建");
      setShareOpen(false);
      await loadShares();
    } catch (err) {
      message.error(mechError(err));
    }
  };

  const toggleShare = async (row: Share, enabled: boolean) => {
    try {
      await mechanismsApi.updateShare({ body: { id: row.id, enabled } });
      await loadShares();
    } catch (err) {
      message.error(mechError(err));
    }
  };

  const removeShare = async (row: Share) => {
    try {
      await mechanismsApi.removeShare({ body: { id: row.id } });
      message.success("已删除");
      await loadShares();
    } catch (err) {
      message.error(mechError(err));
    }
  };

  const copyShare = async (row: Share) => {
    try {
      await navigator.clipboard.writeText(shareUrl(row));
      message.success("链接已复制");
    } catch {
      message.error("复制失败，请手动选择链接");
    }
  };

  // ---------- OIDC ----------
  const openProvider = (row: OidcProvider | null) => {
    setOidcEditing(row);
    oidcForm.setFieldsValue(
      row
        ? {
            code: row.code,
            name: row.name,
            issuer: row.issuer,
            clientId: row.clientId,
            clientSecret: "",
            scopes: row.scopes,
            enabled: row.enabled,
            autoProvision: row.autoProvision,
            defaultRole: row.defaultRole,
          }
        : {
            code: "",
            name: "",
            issuer: "",
            clientId: "",
            clientSecret: "",
            scopes: "openid profile email",
            enabled: true,
            autoProvision: false,
            defaultRole: "user",
          },
    );
    setOidcOpen(true);
  };

  const submitProvider = async () => {
    const values = await oidcForm.validateFields();
    try {
      await mechanismsApi.saveOidcProvider({
        body: { ...(oidcEditing ? { id: oidcEditing.id } : {}), ...values },
      });
      message.success("身份源已保存");
      setOidcOpen(false);
      await loadProviders();
    } catch (err) {
      message.error(mechError(err));
    }
  };

  const testProvider = async (row: OidcProvider) => {
    try {
      const result = await mechanismsApi.testOidcProvider({ body: { id: row.id } });
      if (result?.ok) message.success(`发现端点可用：${result.authorizationEndpoint || result.message}`);
      else message.error(result?.message || "发现端点失败");
    } catch (err) {
      message.error(mechError(err));
    }
  };

  const removeProvider = async (row: OidcProvider) => {
    try {
      await mechanismsApi.removeOidcProvider({ body: { id: row.id } });
      message.success("已删除");
      await loadProviders();
    } catch (err) {
      message.error(mechError(err));
    }
  };

  // ---------- 附件共享策略 ----------
  const submitPolicy = async () => {
    const values = await policyForm.validateFields();
    setPolicySaving(true);
    try {
      const data = await mechanismsApi.saveAssetSharePolicy({ body: values });
      setPolicy(data);
      message.success("附件共享策略已保存");
    } catch (err) {
      message.error(mechError(err));
    } finally {
      setPolicySaving(false);
    }
  };

  const shareColumns: ColumnsType<Share> = [
    {
      title: "分享",
      dataIndex: "title",
      render: (_value, row) => (
        <div>
          <div>{row.title}</div>
          <div className="muted text-12">
            {SHARE_KIND_LABELS[row.kind] || row.kind} · 目标 {row.targetId}
          </div>
        </div>
      ),
    },
    {
      title: "链接",
      dataIndex: "url",
      render: (_value, row) => (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span className="text-12" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {shareUrl(row)}
          </span>
          <Button size="small" icon={<CopyOutlined aria-hidden />} onClick={() => void copyShare(row)} />
        </div>
      ),
    },
    {
      title: "访问",
      dataIndex: "viewCount",
      width: 100,
      render: (value: number, row) => (
        <div>
          <div>{value} 次</div>
          {row.hasPassword ? <Tag>有密码</Tag> : null}
        </div>
      ),
    },
    {
      title: "过期",
      dataIndex: "expiresAt",
      width: 120,
      render: (value: string) => (value ? fmtDate(value) : "长期"),
    },
    {
      title: "启用",
      dataIndex: "enabled",
      width: 80,
      render: (value: boolean, row) => <Switch size="small" checked={value} onChange={(next) => void toggleShare(row, next)} />,
    },
    {
      title: "操作",
      width: 80,
      render: (_value, row) => (
        <Button size="small" danger icon={<DeleteOutlined aria-hidden />} onClick={() => void removeShare(row)} />
      ),
    },
  ];

  const providerColumns: ColumnsType<OidcProvider> = [
    {
      title: "身份源",
      dataIndex: "name",
      render: (_value, row) => (
        <div>
          <div>{row.name}</div>
          <div className="muted text-12">{row.code} · {row.issuer}</div>
        </div>
      ),
    },
    { title: "Client ID", dataIndex: "clientId", render: (value: string) => <span className="text-12">{value}</span> },
    {
      title: "自动开户",
      dataIndex: "autoProvision",
      width: 100,
      render: (value: boolean, row) => (value ? <Tag color="blue">自动开户 · {row.defaultRole}</Tag> : <Tag>手动</Tag>),
    },
    {
      title: "状态",
      dataIndex: "enabled",
      width: 90,
      render: (value: boolean) => (value ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    {
      title: "回调地址",
      dataIndex: "redirectUri",
      render: (value: string) => <span className="text-12">{value || "—"}</span>,
    },
    {
      title: "操作",
      width: 200,
      render: (_value, row) => (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Button size="small" onClick={() => openProvider(row)}>编辑</Button>
          <Button size="small" onClick={() => void testProvider(row)}>测试发现</Button>
          <Button size="small" danger icon={<DeleteOutlined aria-hidden />} onClick={() => void removeProvider(row)} />
        </div>
      ),
    },
  ];

  return (
    <Panel
      title="公开分享与身份源"
      extra={
        <PillTabs
          items={[
            { key: "shares", label: "公开分享" },
            { key: "oidc", label: "身份源 OIDC" },
            { key: "policy", label: "附件共享策略" },
          ]}
          value={tab}
          onChange={setTab}
        />
      }
    >
      {tab === "shares" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <Button type="primary" icon={<PlusOutlined aria-hidden />} onClick={openShare}>
              新建分享
            </Button>
            <span className="muted text-12">对外公开报表 / 项目 / 看板 / 文档的只读链接，可设密码与有效期，随时停用。</span>
          </div>
          <Table rowKey="id" size="small" columns={shareColumns} dataSource={shares} pagination={false} locale={{ emptyText: "还没有公开分享" }} />
        </div>
      ) : null}

      {tab === "oidc" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button type="primary" icon={<PlusOutlined aria-hidden />} onClick={() => openProvider(null)}>
              接入身份源
            </Button>
            <span className="muted text-12">支持标准 OIDC：填写 Issuer / Client 应用信息，开启自动开户后首次登录即创建账号。</span>
          </div>
          <Table rowKey="id" size="small" columns={providerColumns} dataSource={providers} pagination={false} locale={{ emptyText: "还没有接入身份源" }} />
        </div>
      ) : null}

      {tab === "policy" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Notice variant="info">
            该策略约束附件对外分享：默认有效期、最长有效期、是否必须设密码、是否允许公开链接，以及允许分享的对象类型。
          </Notice>
          <Form form={policyForm} layout="vertical" style={{ maxWidth: 560 }}>
            <Form.Item name="name" label="策略名称" rules={[{ required: true, message: "请填写策略名称" }]}>
              <Input />
            </Form.Item>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Form.Item name="defaultExpiresDays" label="默认有效期（天）">
                <InputNumber min={1} max={365} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item name="maxExpiresDays" label="最长有效期（天）">
                <InputNumber min={1} max={365} style={{ width: "100%" }} />
              </Form.Item>
            </div>
            <div style={{ display: "flex", gap: 24 }}>
              <Form.Item name="requirePassword" label="必须设密码" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="allowPublic" label="允许公开链接" valuePropName="checked">
                <Switch />
              </Form.Item>
            </div>
            <Form.Item name="allowedKinds" label="允许分享的对象类型">
              <Select mode="tags" placeholder="如 image / video / document，留空表示不限制" tokenSeparators={[",", "，"]} />
            </Form.Item>
            <Button type="primary" loading={policySaving} onClick={() => void submitPolicy()}>
              保存策略
            </Button>
            {policy ? (
              <span className="muted text-12" style={{ marginLeft: 8 }}>
                最近更新：{policy.updatedAt ? fmtDate(policy.updatedAt) : "—"}
              </span>
            ) : null}
          </Form>
        </div>
      ) : null}

      <Modal open={shareOpen} title="新建公开分享" onCancel={() => setShareOpen(false)} onOk={() => void submitShare()} okText="创建">
        <Form form={shareForm} layout="vertical">
          <Form.Item name="kind" label="分享类型" rules={[{ required: true, message: "请选择类型" }]}>
            <Select options={SHARE_KIND_OPTIONS} />
          </Form.Item>
          <Form.Item name="targetId" label="对象编号" rules={[{ required: true, message: "请填写对象编号" }]}>
            <Input placeholder="报表编码 / 项目编号 / 看板编号 / 文档 ID" />
          </Form.Item>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "请填写标题" }]}>
            <Input placeholder="访客看到的标题" />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item name="password" label="访问密码">
              <Input.Password placeholder="选填" />
            </Form.Item>
            <Form.Item name="expiresDays" label="有效期（天，0 为长期）">
              <InputNumber min={0} max={365} style={{ width: "100%" }} />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        open={oidcOpen}
        title={oidcEditing ? "编辑身份源" : "接入身份源"}
        width={640}
        onCancel={() => setOidcOpen(false)}
        onOk={() => void submitProvider()}
        okText="保存"
      >
        <Form form={oidcForm} layout="vertical">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item
              name="code"
              label="标识"
              rules={[
                { required: true, message: "请填写标识" },
                { pattern: /^[a-z0-9-]+$/, message: "仅小写字母、数字与短横线" },
              ]}
            >
              <Input placeholder="如 okta / feishu-oidc" />
            </Form.Item>
            <Form.Item name="name" label="名称" rules={[{ required: true, message: "请填写名称" }]}>
              <Input placeholder="如 企业 Okta" />
            </Form.Item>
          </div>
          <Form.Item name="issuer" label="Issuer" rules={[{ required: true, message: "请填写 Issuer" }, { type: "url", message: "请填写完整地址" }]}>
            <Input placeholder="https://example.okta.com" />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item name="clientId" label="Client ID" rules={[{ required: true, message: "请填写 Client ID" }]}>
              <Input />
            </Form.Item>
            <Form.Item name="clientSecret" label="Client Secret" extra={oidcEditing ? "留空表示不修改" : undefined}>
              <Input.Password />
            </Form.Item>
          </div>
          <Form.Item name="scopes" label="Scopes">
            <Input placeholder="openid profile email" />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Form.Item name="defaultRole" label="默认角色">
              <Input placeholder="user" />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="autoProvision" label="自动开户" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </Panel>
  );
}
