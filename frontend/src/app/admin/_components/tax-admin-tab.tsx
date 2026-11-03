"use client";

import { adminApi } from "@/api/admin";
import type { OpenedCapability } from "@/api/capability-admin";
import {
  type QxyAccountDraft,
  type QxyAccountView,
} from "@/api/qxy-accounts";
import { KeyOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import type { TableProps } from "antd";
import { useState } from "react";
import { EmptyState, Notice, Panel, PillTabs } from "@/components/ui/panel";
import { useOperationMutation } from "@/query/business";
import {
  useBindQxyTaxNo,
  useOpenedCapabilities,
  useQxyAccounts,
  useRemoveQxyAccount,
  useSaveQxyAccount,
  useUnbindQxyTaxNo,
} from "@/query/tax-admin";
import { fmtTime } from "@/lib/datetime";
import { PermissionNotice, useAdminData } from "./common";

type CapabilityRequest = import("@enterprise/contracts").CapabilityRequest;

type AccountForm = {
  label: string;
  appkey?: string;
  secret?: string;
  expiresAt?: string;
  taxNos?: string[];
};

const TAX_NO_PATTERN = /^[0-9A-Z]{15,20}$/;

/**
 * 平台「财税管理」：企享云报税 API Key 账号池与税号匹配（零 Prisma 迁移，存 system_settings）。
 * 流程：服务商在「财税服务 · 财税自动化」按服务企业提交付费开通申请 → 申请进入本页
 * → 平台给该企业税号匹配一个企享云账号（绑税号）并审核开通 → 业务调用按税号取账号凭据。
 */
export function TaxAdminTab() {
  const { message, modal } = App.useApp();
  const accountsQuery = useQxyAccounts();
  const payload = accountsQuery.data;
  const accounts = payload?.accounts ?? [];
  const maxTaxNos = payload?.maxTaxNos ?? 5;
  const expiringDays = payload?.expiringDays ?? 10;

  const [requestPage, setRequestPage] = useState(1);
  const requestsQuery = useAdminData(
    "capability-requests",
    (signal) =>
      adminApi.requestPage(
        { query: { page: requestPage, pageSize: 20 } },
        { signal },
      ),
    { page: requestPage },
  );
  const requests = requestsQuery.data?.list ?? [];
  const attachMutation = useOperationMutation(adminApi.setCapability, ["*"]);

  const [busy, setBusy] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<QxyAccountView | null>(null);
  const [form] = Form.useForm<AccountForm>();
  const saveMutation = useSaveQxyAccount();
  const removeMutation = useRemoveQxyAccount();
  const bindMutation = useBindQxyTaxNo();
  const unbindMutation = useUnbindQxyTaxNo();
  const [addingId, setAddingId] = useState("");
  const [taxNoDraft, setTaxNoDraft] = useState("");
  /** 三个板块用页签分开：待匹配申请 / 已开通 / 账号池。 */
  const [tab, setTab] = useState<"requests" | "opened" | "accounts">(
    "requests",
  );
  const [openedPage, setOpenedPage] = useState(1);
  const openedQuery = useOpenedCapabilities(openedPage);

  /** 下拉里带上账号有效期：匹配时能直接看到该 API Key 能用到哪天。 */
  const accountOptions = accounts.map((item) => ({
    value: item.id,
    label: (
      <span>
        {item.label}（已绑 {item.taxNos.length}/{maxTaxNos}）
        {item.expiresAt ? (
          <span className={item.expiring ? "text-danger" : "text-12 muted"}>
            {" "}· 有效期至 {item.expiresAt}
            {item.daysLeft !== null
              ? item.daysLeft < 0
                ? `（已过期 ${Math.abs(item.daysLeft)} 天）`
                : `（剩 ${item.daysLeft} 天）`
              : ""}
          </span>
        ) : (
          <span className="text-12 muted"> · 未设置有效期</span>
        )}
      </span>
    ),
    disabled: item.taxNos.length >= maxTaxNos,
  }));

  /** 审核通过：先按企业税号绑定账号（后端原子写入），再置能力为 OPEN。 */
  const approveRequest = async (row: CapabilityRequest, qxyAccountId: string) => {
    setBusy(`${row.enterpriseId}-${row.code}`);
    try {
      await attachMutation.mutateAsync({
        params: { id: String(row.enterpriseId), code: row.code },
        body: {
          action: "open",
          note: qxyAccountId ? "平台匹配企享云账号并开通" : "平台审核通过",
          qxyAccountId: qxyAccountId || undefined,
        },
      });
      message.success(
        qxyAccountId
          ? `已匹配账号并开通「${row.enterpriseName}」的${row.label}`
          : `已开通「${row.enterpriseName}」的${row.label}`,
      );
      void requestsQuery.reload();
    } finally {
      setBusy("");
    }
  };

  /** 关闭已开通能力（迁自原「企业能力开通」矩阵）：关闭后服务商可重新提交申请。 */
  const confirmClose = (row: OpenedCapability) => {
    modal.confirm({
      title: `关闭「${row.enterpriseName}」的${row.label}`,
      okText: "确认关闭",
      okButtonProps: { danger: true },
      cancelText: "取消",
      content:
        "关闭后该企业财务人员的对应按钮将回退为「申请付费开通」，需重新提交申请（含开通时间）并由平台审核。",
      onOk: async () => {
        setBusy(`${row.enterpriseId}-${row.code}`);
        try {
          await attachMutation.mutateAsync({
            params: { id: String(row.enterpriseId), code: row.code },
            body: { action: "close" },
          });
          message.success("已关闭该能力");
          void openedQuery.refetch();
        } finally {
          setBusy("");
        }
      },
    });
  };

  const requestColumns: TableProps<CapabilityRequest>["columns"] = [
    {
      title: "企业",
      dataIndex: "enterpriseName",
      render: (value: string) => value || "—",
    },
    {
      title: "税号",
      dataIndex: "taxNo",
      width: 200,
      render: (value?: string) =>
        value ? (
          <span className="mono">{value}</span>
        ) : (
          <Tag color="red">缺少税号</Tag>
        ),
    },
    { title: "申请能力", dataIndex: "label", width: 200 },
    {
      title: "开通时间",
      dataIndex: "opensAt",
      width: 130,
      render: (value?: string) =>
        value ? (
          <span className="mono text-12">{value}</span>
        ) : (
          <span className="text-danger">未填写</span>
        ),
    },
    {
      title: "提交人",
      dataIndex: "requestedByName",
      width: 140,
      render: (value: string) => value || "—",
    },
    {
      title: "企享云账号",
      width: 280,
      render: (_, row) => {
        if (row.qxyAccountName)
          return <Tag color="green">{row.qxyAccountName}</Tag>;
        return (
          <Select
            size="small"
            style={{ width: 300 }}
            placeholder={accounts.length ? "选择要匹配的账号" : "请先在下方新增账号"}
            value={picked[String(row.id)]}
            options={accountOptions}
            optionRender={(option) => option.data.label}
            onChange={(value: string) =>
              setPicked((prev) => ({ ...prev, [String(row.id)]: value }))
            }
            disabled={!accounts.length}
          />
        );
      },
    },
    {
      title: "操作",
      width: 150,
      render: (_, row) => {
        const matched = Boolean(row.qxyAccountName);
        const selected = matched ? "" : picked[String(row.id)] || "";
        return (
          <Button
            type="primary"
            disabled={!matched && (!selected || !row.taxNo)}
            loading={busy === `${row.enterpriseId}-${row.code}`}
            onClick={() => void approveRequest(row, selected)}
          >
            {matched ? "审核开通" : "匹配并开通"}
          </Button>
        );
      },
    },
  ];

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setFormOpen(true);
  };

  const openEdit = (account: QxyAccountView) => {
    setEditing(account);
    form.setFieldsValue({
      label: account.label,
      appkey: "",
      secret: "",
      expiresAt: account.expiresAt,
      taxNos: account.taxNos,
    });
    setFormOpen(true);
  };

  const submitAccount = async () => {
    try {
      const values = await form.validateFields();
      const body: QxyAccountDraft = {
        id: editing?.id,
        label: values.label.trim(),
        appkey: values.appkey?.trim() || undefined,
        secret: values.secret?.trim() || undefined,
        expiresAt: values.expiresAt?.trim() || "",
        taxNos: values.taxNos || [],
      };
      await saveMutation.mutateAsync(body);
      message.success(editing ? "账号已更新" : "账号已新增");
      setFormOpen(false);
    } catch (error) {
      if (error instanceof Error)
        message.error(error.message || "保存失败，请检查填写内容");
    }
  };

  const confirmRemove = (account: QxyAccountView) => {
    modal.confirm({
      title: `删除账号「${account.label}」`,
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      content: `删除后其绑定的 ${account.taxNos.length} 个税号一并解除，相关企业需重新匹配账号才能继续调用企享云。`,
      onOk: async () => {
        await removeMutation.mutateAsync(account.id);
        message.success("账号已删除");
      },
    });
  };

  const addTaxNo = async (account: QxyAccountView) => {
    const taxNo = taxNoDraft.trim().toUpperCase();
    if (!TAX_NO_PATTERN.test(taxNo)) {
      message.error("请填写 15-20 位统一社会信用代码（税号）");
      return;
    }
    await bindMutation.mutateAsync({ id: account.id, taxNo });
    message.success("税号已匹配");
    setAddingId("");
    setTaxNoDraft("");
  };

  const removeTaxNo = (account: QxyAccountView, taxNo: string) => {
    modal.confirm({
      title: `解除税号 ${taxNo}`,
      okText: "确认解除",
      cancelText: "取消",
      content: `解除后该税号的企业将无法调用企享云报税 / 开票，直到重新匹配账号。`,
      onOk: async () => {
        await unbindMutation.mutateAsync({ id: account.id, taxNo });
        message.success("税号已解除");
      },
    });
  };

  const accountColumns: TableProps<QxyAccountView>["columns"] = [
    {
      title: "账号名称",
      dataIndex: "label",
      width: 200,
      render: (value: string, row) => (
        <Space size={6} wrap>
          <KeyOutlined aria-hidden />
          <span>{value}</span>
          {row.expiring ? <Tag color="red">即将到期</Tag> : null}
        </Space>
      ),
    },
    {
      title: "AppKey（掩码）",
      dataIndex: "appkeyMasked",
      width: 180,
      render: (value: string) => <span className="mono">{value}</span>,
    },
    {
      title: `已匹配税号（最多 ${maxTaxNos} 个）`,
      dataIndex: "taxNos",
      render: (taxNos: string[], row) => (
        <Space size={[4, 6]} wrap>
          {taxNos.map((taxNo) => (
            <Tag
              key={taxNo}
              closable
              onClose={(event) => {
                event.preventDefault();
                removeTaxNo(row, taxNo);
              }}
            >
              <span className="mono">{taxNo}</span>
            </Tag>
          ))}
          {addingId === row.id ? (
            <Space size={4}>
              <Input
                size="small"
                style={{ width: 220 }}
                autoFocus
                placeholder="15-20 位统一社会信用代码"
                value={taxNoDraft}
                onChange={(event) => setTaxNoDraft(event.target.value)}
                onPressEnter={() => void addTaxNo(row)}
              />
              <Button
                size="small"
                type="primary"
                loading={bindMutation.isPending}
                onClick={() => void addTaxNo(row)}
              >
                绑定
              </Button>
              <Button size="small" onClick={() => setAddingId("")}>
                取消
              </Button>
            </Space>
          ) : (
            <Button
              size="small"
              disabled={taxNos.length >= maxTaxNos}
              onClick={() => {
                setAddingId(row.id);
                setTaxNoDraft("");
              }}
            >
              + 绑定税号
            </Button>
          )}
        </Space>
      ),
    },
    {
      title: "到期时间",
      dataIndex: "expiresAt",
      width: 170,
      render: (value: string, row) => {
        if (!value) return <span className="muted">未设置</span>;
        return (
          <Space size={6}>
            <span className={row.expiring ? "text-danger" : undefined}>
              {value}
            </span>
            {row.daysLeft !== null ? (
              <span className="text-12 muted">
                {row.daysLeft < 0
                  ? `已过期 ${Math.abs(row.daysLeft)} 天`
                  : `剩 ${row.daysLeft} 天`}
              </span>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      width: 170,
      render: (value: string) => fmtTime(value),
    },
    {
      title: "操作",
      width: 150,
      render: (_, row) => (
        <Space size={6}>
          <Button size="small" onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Button size="small" danger onClick={() => confirmRemove(row)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const openedColumns: TableProps<OpenedCapability>["columns"] = [
    {
      title: "企业",
      dataIndex: "enterpriseName",
      render: (value: string) => value || "—",
    },
    {
      title: "税号",
      dataIndex: "taxNo",
      width: 200,
      render: (value?: string) =>
        value ? (
          <span className="mono">{value}</span>
        ) : (
          <span className="muted">未登记</span>
        ),
    },
    { title: "已开通能力", dataIndex: "label", width: 200 },
    {
      title: "企享云账号",
      dataIndex: "qxyAccountName",
      width: 180,
      render: (value?: string) =>
        value ? (
          <Tag color="green">{value}</Tag>
        ) : (
          <span className="text-danger">未匹配</span>
        ),
    },
    {
      title: "开通时间",
      dataIndex: "opensAt",
      width: 130,
      render: (value: string) => (
        <span className="mono text-12">{value || "—"}</span>
      ),
    },
    {
      title: "审核通过",
      dataIndex: "openedAt",
      width: 170,
      render: (value: string) => fmtTime(value),
    },
    {
      title: "开通人",
      dataIndex: "openedByName",
      width: 140,
      render: (value: string) => value || "—",
    },
    {
      title: "操作",
      width: 100,
      render: (_, row) => (
        <Button
          size="small"
          danger
          loading={busy === `${row.enterpriseId}-${row.code}`}
          onClick={() => confirmClose(row)}
        >
          关闭
        </Button>
      ),
    },
  ];

  return (
    <>
      <PermissionNotice
        denied={requestsQuery.denied || (accountsQuery.error?.message ?? "")}
      />

      <Notice variant="info">
        服务商在「财税服务 · 财税自动化」提交付费开通申请（需填开通时间）后，申请进入「待匹配申请」：
        平台先到「账号池」录入企享云报税 API Key（AppKey / Secret），再给申请企业的税号匹配账号并
        <b>审核开通</b>；开通后企业即可使用自动申报 / 自动开票，并在「已开通」里留档。
        每个账号最多绑定 {maxTaxNos} 个税号；到期前 {expiringDays} 天标红提醒（不拦截调用）。
      </Notice>

      <PillTabs
        items={[
          {
            key: "requests",
            label: "待匹配申请",
            count: requestsQuery.data?.total,
          },
          { key: "opened", label: "已开通", count: openedQuery.data?.total },
          { key: "accounts", label: "账号池", count: accounts.length },
        ]}
        value={tab}
        onChange={(key) => setTab(key as "requests" | "opened" | "accounts")}
        style={{ marginBottom: 12 }}
      />

      {tab === "requests" ? (
        <Panel
          title="服务商提交的付费开通申请"
          titleBadge={
            requestsQuery.data ? `${requestsQuery.data.total} 条` : undefined
          }
          extra={
            <Button
              icon={<ReloadOutlined aria-hidden />}
              onClick={() => void requestsQuery.reload()}
            >
              刷新
            </Button>
          }
        >
          <div className="table-wrap">
            <Table<CapabilityRequest>
              rowKey="id"
              pagination={{
                current: requestPage,
                pageSize: 20,
                total: requestsQuery.data?.total ?? 0,
                onChange: setRequestPage,
                showSizeChanger: false,
              }}
              loading={requestsQuery.loading}
              size="middle"
              dataSource={requests}
              columns={requestColumns}
              locale={{
                emptyText: (
                  <EmptyState
                    icon={<KeyOutlined aria-hidden />}
                    text="暂无待审核申请：服务商提交付费开通申请后会出现在这里。"
                  />
                ),
              }}
            />
          </div>
        </Panel>
      ) : null}

      {tab === "opened" ? (
        <Panel
          title="已开通的自动化能力"
          titleBadge={
            openedQuery.data ? `${openedQuery.data.total} 条` : undefined
          }
          extra={
            <Button
              icon={<ReloadOutlined aria-hidden />}
              onClick={() => void openedQuery.refetch()}
            >
              刷新
            </Button>
          }
        >
          {openedQuery.isPending ? (
            <div className="text-12 muted">正在加载已开通能力…</div>
          ) : openedQuery.isError ? (
            <Notice variant="error">
              {openedQuery.error?.message}{" "}
              <Button onClick={() => void openedQuery.refetch()}>
                重新加载
              </Button>
            </Notice>
          ) : (
            <div className="table-wrap">
              <Table<OpenedCapability>
                rowKey="id"
                pagination={{
                  current: openedPage,
                  pageSize: 20,
                  total: openedQuery.data?.total ?? 0,
                  onChange: setOpenedPage,
                  showSizeChanger: false,
                }}
                loading={openedQuery.isFetching}
                size="middle"
                scroll={{ x: "max-content" }}
                dataSource={openedQuery.data?.list ?? []}
                columns={openedColumns}
                locale={{
                  emptyText: (
                    <EmptyState
                      icon={<KeyOutlined aria-hidden />}
                      text="暂无已开通的自动化能力：在「待匹配申请」匹配账号并开通后，这里会列出企业与开通时间。"
                    />
                  ),
                }}
              />
            </div>
          )}
        </Panel>
      ) : null}

      {tab === "accounts" ? (
        <Panel
          title="企享云报税账号池"
          titleBadge={
            <span className="text-12 muted">
              共 {accounts.length} 个账号 · 每账号最多 {maxTaxNos} 个税号
              {payload?.legacyConfigured
                ? " · 已保留历史单凭据作未匹配税号的兜底"
                : ""}
            </span>
          }
          extra={
            <Space size={6}>
              <Button
                icon={<ReloadOutlined aria-hidden />}
                onClick={() => void accountsQuery.refetch()}
              >
                刷新
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined aria-hidden />}
                onClick={openCreate}
              >
                新增账号
              </Button>
            </Space>
          }
        >
          {accountsQuery.isPending ? (
            <div className="text-12 muted">正在加载账号池…</div>
          ) : accountsQuery.isError ? (
            <Notice variant="error">
              {accountsQuery.error?.message}{" "}
              <Button onClick={() => void accountsQuery.refetch()}>
                重新加载
              </Button>
            </Notice>
          ) : (
            <div className="table-wrap">
              <Table<QxyAccountView>
                rowKey="id"
                pagination={false}
                size="middle"
                scroll={{ x: "max-content" }}
                dataSource={accounts}
                columns={accountColumns}
                rowClassName={(row) => (row.expiring ? "table-row-danger" : "")}
                locale={{
                  emptyText: (
                    <EmptyState
                      icon={<KeyOutlined aria-hidden />}
                      text="尚未添加企享云账号：点右上「新增账号」录入 AppKey / Secret，再给企业税号匹配。"
                    />
                  ),
                }}
              />
            </div>
          )}
        </Panel>
      ) : null}

      <Modal
        open={formOpen}
        title={editing ? `编辑账号「${editing.label}」` : "新增企享云报税账号"}
        okText="保存"
        cancelText="取消"
        confirmLoading={saveMutation.isPending}
        onOk={() => void submitAccount()}
        onCancel={() => setFormOpen(false)}
        destroyOnHidden
      >
        <Form<AccountForm> form={form} layout="vertical" autoComplete="off">
          <Form.Item
            name="label"
            label="账号名称"
            rules={[
              { required: true, whitespace: true, message: "请填写账号名称" },
              { max: 60 },
            ]}
          >
            <Input placeholder="如：企享云主账号 / 备用账号" maxLength={60} />
          </Form.Item>
          <Form.Item
            name="appkey"
            label="AppKey"
            rules={
              editing
                ? [{ max: 4096 }]
                : [
                    {
                      required: true,
                      whitespace: true,
                      message: "请填写 AppKey",
                    },
                    { max: 4096 },
                  ]
            }
          >
            <Input.Password
              autoComplete="new-password"
              maxLength={4096}
              placeholder={editing ? "留空沿用原 AppKey" : "企享云 AppKey"}
            />
          </Form.Item>
          <Form.Item
            name="secret"
            label="Secret"
            rules={
              editing
                ? [{ max: 4096 }]
                : [
                    { required: true, whitespace: true, message: "请填写 Secret" },
                    { max: 4096 },
                  ]
            }
          >
            <Input.Password
              autoComplete="new-password"
              maxLength={4096}
              placeholder={editing ? "留空沿用原 Secret" : "企享云 Secret（AppKey.Secret 取点号后段）"}
            />
          </Form.Item>
          <Form.Item name="expiresAt" label="到期时间（选填）">
            <Input placeholder="YYYY-MM-DD，到期前 10 天标红提醒，不拦截调用" />
          </Form.Item>
          <Form.Item
            name="taxNos"
            label={`已匹配税号（最多 ${maxTaxNos} 个）`}
            extra="填企业统一社会信用代码（税号）；一个税号只能绑定一个账号。"
          >
            <Select
              mode="tags"
              maxCount={maxTaxNos}
              placeholder="输入税号后回车，可录入多个"
              tokenSeparators={[",", "，", " ", ";"]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}