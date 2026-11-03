"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { flexApi } from "@/api/flex";

import {
  BarChartOutlined,
  DollarOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
} from "antd";
import { useState } from "react";
import {
  ContactEditModal,
  type ContactEditTarget,
} from "@/components/contact-edit-modal";
import { StatusBadge } from "@/components/status-badge";
import { ColumnSwitch, EmptyState, Notice, Panel } from "@/components/ui/panel";
import { useFlexPayrolls, useFlexPayrollStats } from "@/query/workspaces";

import { canWorkOn } from "@/lib/can-work-on";
import { contactOf } from "@/lib/contacts";
import {
  contractLabel,
  fmtTime,
  maskBank,
  maskId,
  money,
  type FlexContract,
  type FlexPayroll,
  type FlexPayrollEmployee,
} from "./common";

function employeeColumns(masked: boolean) {
  return [
    {
      title: "员工姓名",
      dataIndex: "name",
      render: (value: string) => (
        <span style={{ fontWeight: 600 }}>{value || "—"}</span>
      ),
    },
    {
      title: "身份证号",
      dataIndex: "id_no",
      render: (value: string) => (
        <span className="mono text-12">
          {masked ? maskId(value) : value || "—"}
        </span>
      ),
    },
    {
      title: "开户行",
      dataIndex: "bank_name",
      render: (value: string) => value || "—",
    },
    {
      title: "银行卡号",
      dataIndex: "bank_account",
      render: (value: string) => (
        <span className="mono text-12">
          {masked ? maskBank(value) : value || "—"}
        </span>
      ),
    },
    {
      title: "发薪金额",
      dataIndex: "amount",
      render: (value: number | string) => (
        <span className="mono">¥{money(value)}</span>
      ),
    },
  ];
}

type PayrollFormValues = {
  contract_id?: number;
  period?: string;
  note?: string;
  employees?: FlexPayrollEmployee[];
};

/** 灵工发薪页签（💰 灵工发薪）：发薪台账 + 发薪审核子页签。 */
export function PayrollTab({
  contracts,
  isEnterprise,
  isProvider,
  meUserId,
  staffOf,
  reload: reloadOptions,
}: {
  contracts: FlexContract[];
  isEnterprise: boolean;
  isProvider: boolean;
  meUserId: string;
  staffOf?: { providerUserId?: string; status?: string }[];
  reload: () => Promise<void>;
}) {
  const flex_auditPayrollMutation = useOperationMutation(flexApi.auditPayroll, [
    "flex",
    "dashboard",
  ]);
  const flex_createPayrollMutation = useOperationMutation(
    flexApi.createPayroll,
    ["flex", "dashboard"],
  );

  const { message } = App.useApp();
  const [sub, setSub] = useState("all");
  const [form] = Form.useForm<PayrollFormValues>();
  const [page, setPage] = useState(1);
  const listQuery = useFlexPayrolls(page, sub === "audit" ? "PENDING" : "");
  const statsQuery = useFlexPayrollStats();
  const rows = listQuery.data?.list ?? [];
  const loading = listQuery.isPending;
  const reload = async () => {
    await Promise.all([
      listQuery.refetch(),
      statsQuery.refetch(),
      reloadOptions(),
    ]);
  };
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [detail, setDetail] = useState<{
    row: FlexPayroll;
    audit: boolean;
  } | null>(null);
  const [contactTarget, setContactTarget] = useState<ContactEditTarget | null>(
    null,
  );
  const [auditNote, setAuditNote] = useState("");
  const [auditing, setAuditing] = useState(false);
  // 发薪员工逐条添加：一次只填一位，保存后进入下方列表，可单条编辑 / 删除
  const [draftEmployees, setDraftEmployees] = useState<
    (FlexPayrollEmployee & { key: string })[]
  >([]);
  const [empOpen, setEmpOpen] = useState(false);
  const [empEditingKey, setEmpEditingKey] = useState<string | null>(null);
  const [empForm] = Form.useForm();

  const openEmployee = (row?: FlexPayrollEmployee & { key: string }) => {
    setEmpEditingKey(row?.key ?? null);
    empForm.resetFields();
    if (row) empForm.setFieldsValue(row);
    setEmpOpen(true);
  };

  const saveEmployee = async () => {
    const values = (await empForm.validateFields()) as FlexPayrollEmployee;
    const entry = {
      key:
        empEditingKey ||
        `emp-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name: String(values.name || "").trim(),
      id_no: String(values.id_no || "").trim(),
      bank_name: String(values.bank_name || "").trim(),
      bank_account: String(values.bank_account || "").trim(),
      amount: Number(values.amount || 0),
    };
    if (
      draftEmployees.some(
        (item) =>
          item.key !== entry.key && item.id_no && item.id_no === entry.id_no,
      )
    ) {
      message.error("同一发薪单内身份证号不可重复");
      return;
    }
    setDraftEmployees((list) =>
      empEditingKey
        ? list.map((item) => (item.key === empEditingKey ? entry : item))
        : [...list, entry],
    );
    setEmpOpen(false);
  };

  const usableContracts = contracts.filter(
    (item) => item.status === "ACTIVE" && item.serviceType === "FLEX_WORK",
  );
  const pendingCount = statsQuery.data?.byStatus.PENDING ?? "—";
  const visible = rows;
  // 发薪审核是服务商侧工作面（承办代理人审核），用户身份只有一个子视图，不再渲染只有一个选项的切换器
  const subOptions = isProvider
    ? [
        {
          value: "all",
          label: (
            <>
              <BarChartOutlined aria-hidden /> 发薪台账
            </>
          ),
        },
        {
          value: "audit",
          label: (
            <>
              <SafetyCertificateOutlined aria-hidden />
              {` 发薪审核（${pendingCount}）`}
            </>
          ),
        },
      ]
    : [];

  const enterpriseName = (row: FlexPayroll) =>
    contracts.find((item) => item.id === row.contractId)?.enterpriseName || "—";
  const canAudit = (row: FlexPayroll) =>
    row.status === "PENDING" && canWorkOn({ userId: meUserId, staffOf }, row);

  const openAudit = (action: "APPROVE" | "REJECT") => {
    if (!detail) return;
    if (action === "REJECT" && !auditNote.trim()) {
      message.warning("驳回时请填写驳回原因");
      return;
    }
    setAuditing(true);
    void (async () => {
      try {
        try {
          await flex_auditPayrollMutation.mutateAsync({
            params: { id: String(detail.row.id) },
            body: { action, note: auditNote.trim() },
          });

          message.success(
            action === "APPROVE" ? "审核通过，已进入发薪台账" : "已驳回",
          );
          setDetail(null);
          setAuditNote("");
        } finally {
          setAuditing(false);
        }
      } catch (error) {
        if (error instanceof Error)
          presentMutationError(error, (text) => message.error(text));
      }
    })();
  };

  return (
    <>
      <Panel
        title={sub === "audit" ? "灵工发薪审核" : "灵工发薪台账"}
        titleBadge={`${visible.length} 条`}
        extra={
          isEnterprise && sub === "all" ? (
            <Button
              type="primary"
              onClick={() => {
                if (!usableContracts.length) {
                  message.warning(
                    "暂无生效签约，请先在「代理人资源库」选择该代理人合作并待代理人确认",
                  );
                  return;
                }
                setCreateOpen(true);
              }}
            >
              ＋ 新建发薪
            </Button>
          ) : null
        }
      >
        {subOptions.length > 1 ? (
          <ColumnSwitch
            value={sub}
            onChange={(value) => {
              setSub(value);
              setPage(1);
            }}
            options={subOptions}
          />
        ) : null}

        {listQuery.isError || statsQuery.isError ? (
          <Notice variant="error">
            {listQuery.error?.message || statsQuery.error?.message}{" "}
            <Button onClick={() => void reload()}>重试</Button>
          </Notice>
        ) : null}
        <div className="table-wrap">
          <Table<FlexPayroll>
            rowKey="id"
            loading={loading}
            dataSource={visible}
            pagination={{
              current: page,
              pageSize: 20,
              total: listQuery.data?.total ?? 0,
              showSizeChanger: false,
              onChange: setPage,
            }}
            size="middle"
            locale={{
              emptyText: (
                <EmptyState
                  icon={
                    sub === "audit" ? (
                      <SafetyCertificateOutlined aria-hidden />
                    ) : (
                      <DollarOutlined aria-hidden />
                    )
                  }
                  text={
                    sub === "audit"
                      ? "暂无待审核发薪单，签约企业提交的发薪单将在此待审核"
                      : "暂无发薪记录，点击右上角新建您的第一笔发薪"
                  }
                />
              ),
            }}
            expandable={{
              expandedRowRender: (row) => (
                <div className="table-wrap">
                  <Table<FlexPayrollEmployee>
                    rowKey={(item) =>
                      `${item.name || ""}-${item.bank_account || ""}`
                    }
                    size="small"
                    pagination={false}
                    dataSource={row.employees || []}
                    columns={employeeColumns(true)}
                  />
                </div>
              ),
            }}
            columns={[
              {
                title: "发薪单号",
                dataIndex: "payrollNo",
                width: 150,
                render: (value: string) => (
                  <span className="mono text-12">{value}</span>
                ),
              },
              {
                title: "发薪周期",
                dataIndex: "period",
                width: 110,
                render: (value: string) => (
                  <span style={{ fontWeight: 600 }}>{value || "—"}</span>
                ),
              },
              {
                title: "企业",
                width: 180,
                render: (_, row) => enterpriseName(row),
              },
              {
                title: "承办代理人",
                dataIndex: "agentName",
                width: 130,
                render: (value: string) => (
                  <span className="text-12">{value || "—"}</span>
                ),
              },
              {
                title: "人数",
                width: 80,
                render: (_, row) => `${(row.employees || []).length} 人`,
              },
              {
                title: "发薪总额",
                dataIndex: "totalAmount",
                width: 130,
                render: (value: string) => (
                  <span className="mono" style={{ fontWeight: 600 }}>
                    ¥{money(value)}
                  </span>
                ),
              },
              {
                title: "状态",
                width: 100,
                render: (_, row) => (
                  <StatusBadge domain="payroll" status={row.status} />
                ),
              },
              {
                title: "审核意见",
                dataIndex: "rejectNote",
                width: 180,
                render: (value: string) => (
                  <span className="text-12">{value || "—"}</span>
                ),
              },
              {
                title: "联系方式（企业侧 / 执行侧）",
                width: 220,
                render: (_, row) => {
                  const ent = contactOf(row, "contact");
                  const prov = contactOf(row, "provider_contact");
                  return (
                    <span className="text-12">
                      {[ent.name, ent.phone].filter(Boolean).join(" · ") || "—"}
                      {" / "}
                      {[prov.name, prov.phone].filter(Boolean).join(" · ") ||
                        "—"}
                    </span>
                  );
                },
              },
              {
                title: "提交时间",
                dataIndex: "createdAt",
                width: 150,
                render: (value: string) => (
                  <span className="text-12">{fmtTime(value)}</span>
                ),
              },
              {
                title: "操作",
                width: 200,
                render: (_, row) => (
                  <Space size={6} wrap>
                    <Button
                      onClick={() => {
                        setAuditNote("");
                        setDetail({ row, audit: false });
                      }}
                    >
                      详情
                    </Button>
                    {isEnterprise ||
                    canWorkOn({ userId: meUserId, staffOf }, row) ? (
                      <Button
                        onClick={() => {
                          const ent = contactOf(row, "contact");
                          const prov = contactOf(row, "provider_contact");
                          setContactTarget({
                            resource: "flexPayroll",
                            id: row.id,
                            no: row.payrollNo,
                            contactName: ent.name,
                            contactPhone: ent.phone,
                            providerContactName: prov.name,
                            providerContactPhone: prov.phone,
                            partyLabel: "企业侧",
                            providerLabel: "承办代理人",
                          });
                        }}
                      >
                        改联系方式
                      </Button>
                    ) : null}
                    {canAudit(row) ? (
                      <Button
                        type="primary"
                        onClick={() => {
                          setAuditNote("");
                          setDetail({ row, audit: true });
                        }}
                      >
                        审核
                      </Button>
                    ) : null}
                  </Space>
                ),
              },
            ]}
          />
        </div>
      </Panel>

      <Modal
        open={createOpen}
        title="新建灵工发薪（员工银行卡信息 → 代理人审核）"
        width={860}
        confirmLoading={submitting}
        okText="提交发薪"
        onCancel={() => setCreateOpen(false)}
        onOk={async () => {
          try {
            const values = await form.validateFields();
            const employees = draftEmployees.map((item) => ({
              name: item.name || "",
              id_no: item.id_no || "",
              bank_name: item.bank_name || "",
              bank_account: item.bank_account || "",
              amount: Number(item.amount || 0),
            }));
            if (!employees.length) {
              message.warning("请至少添加一名发薪员工");
              return;
            }
            setSubmitting(true);
            try {
              await flex_createPayrollMutation.mutateAsync({
                body: {
                  contract_id: values.contract_id,
                  period: values.period,
                  employees,
                  note: values.note || "",
                },
              });

              message.success("发薪单已提交，等待签约代理人审核");
              setCreateOpen(false);
              form.resetFields();
              setDraftEmployees([]);
            } finally {
              setSubmitting(false);
            }
          } catch (error) {
            if (error instanceof Error)
              presentMutationError(error, (text) => message.error(text));
          }
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="contract_id"
            label="签约代理人 *"
            rules={[{ required: true, message: "请选择签约代理人" }]}
          >
            <Select
              placeholder="请选择签约代理人"
              options={usableContracts.map((contract) => ({
                value: contract.id,
                label: contractLabel(contract),
              }))}
            />
          </Form.Item>
          <div className="form-2col">
            <Form.Item
              name="period"
              label="发薪周期 *"
              rules={[{ required: true, message: "请填写发薪周期" }]}
            >
              <Input placeholder="如：2026-09" />
            </Form.Item>
            <Form.Item name="note" label="备注">
              <Input placeholder="如：九月委托代发（装配产线临时工）" />
            </Form.Item>
          </div>

          <div style={{ fontWeight: 600, margin: "12px 0 6px" }}>
            ▍发薪员工明细
          </div>
          <div className="table-wrap">
            <Table<FlexPayrollEmployee & { key: string }>
              rowKey="key"
              size="small"
              pagination={false}
              dataSource={draftEmployees}
              locale={{
                emptyText: (
                  <EmptyState
                    icon={<UserOutlined aria-hidden />}
                    text="尚未添加员工。点下方「＋ 添加员工」一位一位添加。"
                  />
                ),
              }}
              columns={[
                { title: "员工姓名", dataIndex: "name" },
                {
                  title: "身份证号",
                  dataIndex: "id_no",
                  render: (value: string) => (
                    <span className="mono text-12">{value || "—"}</span>
                  ),
                },
                { title: "开户行", dataIndex: "bank_name" },
                {
                  title: "银行卡号",
                  dataIndex: "bank_account",
                  render: (value: string) => (
                    <span className="mono text-12">{value || "—"}</span>
                  ),
                },
                {
                  title: "发薪金额",
                  dataIndex: "amount",
                  render: (value: number) => (
                    <span className="mono">{money(value)}</span>
                  ),
                },
                {
                  title: "操作",
                  width: 130,
                  render: (
                    _: unknown,
                    row: FlexPayrollEmployee & { key: string },
                  ) => (
                    <Space size={6}>
                      <Button onClick={() => openEmployee(row)}>编辑</Button>
                      <Button
                        danger
                        onClick={() =>
                          setDraftEmployees((list) =>
                            list.filter((item) => item.key !== row.key),
                          )
                        }
                      >
                        删除
                      </Button>
                    </Space>
                  ),
                },
              ]}
            />
          </div>
          <Button style={{ marginTop: 8 }} onClick={() => openEmployee()}>
            ＋ 添加员工
          </Button>
          <div className="text-12 muted" style={{ marginTop: 6 }}>
            一次只添加一位员工，保存后可继续添加下一位；同一发薪单内身份证号不可重复。
          </div>
        </Form>
      </Modal>

      <Modal
        open={empOpen}
        title={empEditingKey ? "发薪员工明细 · 编辑" : "发薪员工明细 · 新增"}
        okText={empEditingKey ? "保存" : "添加"}
        cancelText="取消"
        onCancel={() => setEmpOpen(false)}
        onOk={saveEmployee}
      >
        <Form form={empForm} layout="vertical">
          <div className="form-2col">
            <Form.Item
              name="name"
              label="员工姓名"
              rules={[{ required: true, message: "请填写员工姓名" }]}
            >
              <Input placeholder="员工姓名" />
            </Form.Item>
            <Form.Item
              name="id_no"
              label="身份证号"
              rules={[{ required: true, message: "请填写身份证号" }]}
            >
              <Input placeholder="15 / 18 位" />
            </Form.Item>
            <Form.Item name="bank_name" label="开户行">
              <Input placeholder="如：中国工商银行杭州分行" />
            </Form.Item>
            <Form.Item name="bank_account" label="银行卡号">
              <Input placeholder="6-19 位数字" />
            </Form.Item>
            <Form.Item
              name="amount"
              label="发薪金额（元）"
              rules={[{ required: true, message: "请填写发薪金额" }]}
            >
              <InputNumber
                min={0}
                style={{ width: "100%" }}
                placeholder="0.00"
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        open={Boolean(detail)}
        title={`灵工发薪单 · ${detail?.row.payrollNo || ""}${
          detail?.audit ? "（审核）" : ""
        }`}
        width={860}
        onCancel={() => setDetail(null)}
        footer={
          detail && canAudit(detail.row)
            ? [
                <Button
                  key="reject"
                  danger
                  loading={auditing}
                  onClick={() => openAudit("REJECT")}
                >
                  驳回
                </Button>,
                <Button
                  key="approve"
                  type="primary"
                  loading={auditing}
                  onClick={() => openAudit("APPROVE")}
                >
                  审核通过
                </Button>,
              ]
            : null
        }
      >
        <Descriptions column={2} size="small" bordered>
          <Descriptions.Item label="发薪单号">
            <span className="mono">{detail?.row.payrollNo || "—"}</span>
          </Descriptions.Item>
          <Descriptions.Item label="发薪周期">
            {detail?.row.period || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="企业">
            {detail ? enterpriseName(detail.row) : "—"}
          </Descriptions.Item>
          <Descriptions.Item label="承办代理人">
            {detail?.row.agentName || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="发薪人数">
            {`${(detail?.row.employees || []).length} 人`}
          </Descriptions.Item>
          <Descriptions.Item label="发薪总额">
            <span className="mono">¥{money(detail?.row.totalAmount)}</span>
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <StatusBadge domain="payroll" status={detail?.row.status} />
          </Descriptions.Item>
          <Descriptions.Item label="提交人">
            {`${detail ? enterpriseName(detail.row) : "—"} · ${fmtTime(
              detail?.row.createdAt,
            )}`}
          </Descriptions.Item>
        </Descriptions>

        <div style={{ fontWeight: 600, margin: "14px 0 6px" }}>
          ▍发薪员工明细
        </div>
        <div className="table-wrap">
          <Table<FlexPayrollEmployee>
            rowKey={(item) => `${item.name || ""}-${item.bank_account || ""}`}
            size="small"
            pagination={false}
            dataSource={detail?.row.employees || []}
            columns={employeeColumns(false)}
          />
        </div>

        <div style={{ fontWeight: 600, margin: "14px 0 6px" }}>备注</div>
        <div style={{ whiteSpace: "pre-wrap" }}>{detail?.row.note || "—"}</div>

        <div style={{ fontWeight: 600, margin: "14px 0 6px" }}>审核记录</div>
        <div>
          {detail?.row.rejectNote
            ? `${detail.row.rejectNote}（${fmtTime(detail?.row.auditedAt || "")}）`
            : detail?.row.status === "PENDING"
              ? "尚未审核"
              : "已审核"}
        </div>

        {detail && canAudit(detail.row) ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 6 }}>审核意见（驳回必填）</div>
            <Input
              value={auditNote}
              placeholder="通过可不填；驳回请填写原因（如身份信息与系统记录不一致）"
              onChange={(event) => setAuditNote(event.target.value)}
            />
          </div>
        ) : null}
      </Modal>

      <ContactEditModal
        target={contactTarget}
        onClose={() => setContactTarget(null)}
      />
    </>
  );
}
