"use client";

import {
  ReloadOutlined,
  SwapOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Form,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import type { Key } from "react";
import { useCallback, useEffect, useState } from "react";
import { SCRM_TRANSFER_KINDS, SCRM_TRANSFER_TYPES } from "@enterprise/contracts";
import { Notice, Panel } from "@/components/ui/panel";
import {
  TRANSFER_KIND_LABELS,
  TRANSFER_STATUS_COLOR,
  TRANSFER_STATUS_LABELS,
  TRANSFER_TYPE_LABELS,
  fmtDateTime,
  loadScrmStaff,
  scrmApi,
  type ScrmTransfer,
  type ScrmUnassigned,
} from "./scrm-common";

/**
 * 分配与继承：由企业管理员发起并指定接收人（部门负责人只给建议值，不自动执行）。
 * 客户转接需客户 24 小时内不拒绝；客户群换群主立即生效。回执失败原样展示，不重复提交。
 */

export function ScrmTransfersView({ tick }: { tick: number }) {
  const { message } = App.useApp();
  const [unassigned, setUnassigned] = useState<ScrmUnassigned[]>([]);
  const [unassignedLoading, setUnassignedLoading] = useState(false);
  const [selected, setSelected] = useState<Key[]>([]);
  const [transfers, setTransfers] = useState<ScrmTransfer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [type, setType] = useState<(typeof SCRM_TRANSFER_TYPES)[number] | "">("");
  const [loading, setLoading] = useState(true);
  const [staffOptions, setStaffOptions] = useState<{ value: string; label: string }[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(0);

  const reloadUnassigned = useCallback(async () => {
    setUnassignedLoading(true);
    try {
      setUnassigned((await scrmApi.unassigned()) ?? []);
    } catch (error) {
      message.error((error as Error).message || "未分配列表读取失败");
    } finally {
      setUnassignedLoading(false);
    }
  }, [message]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await scrmApi.transfers({
        query: { page, pageSize, ...(type ? { type } : {}) },
      });
      setTransfers(result?.list ?? []);
      setTotal(result?.total ?? 0);
    } catch (error) {
      message.error((error as Error).message || "转接记录读取失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, type, message]);

  useEffect(() => {
    void reload();
  }, [reload, tick]);

  useEffect(() => {
    void reloadUnassigned();
    void loadScrmStaff().then(setStaffOptions);
  }, [reloadUnassigned]);

  const refresh = async (row: ScrmTransfer) => {
    setBusy(row.id);
    try {
      const next = await scrmApi.refreshTransfer({ body: { id: row.id } });
      message.success(
        next?.status === "DONE"
          ? "转接已完成"
          : next?.status === "FAILED"
            ? next.failReason || "转接失败"
            : "状态已刷新",
      );
      void reload();
    } catch (error) {
      message.error((error as Error).message || "刷新失败");
    } finally {
      setBusy(0);
    }
  };

  const rowsById = new Map(unassigned.map((row) => [`${row.kind}:${row.id}`, row]));
  const selectedTargets = selected
    .map((key) => rowsById.get(String(key)))
    .filter((row): row is ScrmUnassigned => Boolean(row));

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Panel
        title={
          <>
            <UserSwitchOutlined aria-hidden /> 待分配客户与客户群
          </>
        }
        titleExtra="离职成员待分配 + 本地无有效跟进人的对象；由企业管理员指定接收人"
        extra={
          <Space wrap>
            <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void reloadUnassigned()} loading={unassignedLoading}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<SwapOutlined aria-hidden />}
              disabled={!selectedTargets.length}
              onClick={() => setCreateOpen(true)}
            >
              发起转接
            </Button>
          </Space>
        }
      >
        <Table<ScrmUnassigned>
          rowKey={(row) => `${row.kind}:${row.id}`}
          size="small"
          loading={unassignedLoading}
          dataSource={unassigned}
          scroll={{ x: 860 }}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (keys) => setSelected(keys),
            getCheckboxProps: (row) => ({ disabled: !row.id }),
          }}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          columns={[
            {
              title: "对象",
              dataIndex: "name",
              render: (value: string, row) => (
                <Space orientation="vertical" size={0}>
                  <Space size={6}>
                    <Tag>{TRANSFER_KIND_LABELS[row.kind] ?? row.kind}</Tag>
                    <span>{value}</span>
                  </Space>
                  <span className="text-12 muted">{row.externalId}</span>
                </Space>
              ),
            },
            {
              title: "原归属",
              dataIndex: "ownerStaffName",
              width: 170,
              render: (value: string) => value || <span className="text-12 muted">无</span>,
            },
            {
              title: "原因",
              dataIndex: "reason",
              width: 180,
              render: (value: string) => <Tag color="warning">{value}</Tag>,
            },
            {
              title: "最近活跃",
              dataIndex: "lastActiveAt",
              width: 170,
              render: (value: string) => (value ? fmtDateTime(value) : "-"),
            },
          ]}
          locale={{ emptyText: "没有待分配对象：客户与客户群都有有效跟进人" }}
        />
        <Notice variant="info">
          企微侧已标记离职但本地还没有客户镜像的记录（编号为 0）不可勾选：先做一次同步，或在客户档案里确认对象。
        </Notice>
      </Panel>

      <Panel
        title="转接与继承记录"
        titleExtra="提交后按企微回执更新；失败原因原样展示，系统不自动重复提交"
        extra={
          <Space wrap>
            <Select
              allowClear
              placeholder="类型"
              style={{ width: 140 }}
              value={type || undefined}
              options={Object.entries(TRANSFER_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
              onChange={(value) => {
                setPage(1);
                setType(SCRM_TRANSFER_TYPES.find((item) => item === value) ?? "");
              }}
            />
            <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void reload()} loading={loading}>
              刷新
            </Button>
          </Space>
        }
      >
        <Table<ScrmTransfer>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={transfers}
          scroll={{ x: 1000 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            onChange: (nextPage, nextSize) => {
              setPage(nextPage);
              setPageSize(nextSize);
            },
          }}
          columns={[
            {
              title: "对象",
              dataIndex: "targetName",
              render: (value: string, row) => (
                <Space orientation="vertical" size={0}>
                  <span>{value || "-"}</span>
                  <span className="text-12 muted">
                    {TRANSFER_TYPE_LABELS[row.type] ?? row.type} ·{" "}
                    {TRANSFER_KIND_LABELS[row.kind] ?? row.kind}
                  </span>
                </Space>
              ),
            },
            {
              title: "原归属 → 接收人",
              width: 230,
              render: (_: unknown, row) => (
                <span className="text-12">
                  {row.fromStaffName || row.fromStaffId || "-"} → {row.toStaffName || row.toStaffId}
                </span>
              ),
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 110,
              render: (value: string) => (
                <Tag color={TRANSFER_STATUS_COLOR[value] || "default"}>
                  {TRANSFER_STATUS_LABELS[value] ?? value}
                </Tag>
              ),
            },
            {
              title: "失败原因",
              dataIndex: "failReason",
              render: (value: string) => value || "-",
            },
            { title: "创建时间", dataIndex: "createdAt", width: 170, render: fmtDateTime },
            {
              title: "操作",
              width: 110,
              render: (_: unknown, row) => (
                <Button
                  size="small"
                  loading={busy === row.id}
                  disabled={row.status === "DONE" || row.status === "FAILED"}
                  onClick={() => void refresh(row)}
                >
                  刷新状态
                </Button>
              ),
            },
          ]}
          locale={{ emptyText: "还没有转接记录" }}
        />
      </Panel>

      <CreateTransferModal
        open={createOpen}
        targets={selectedTargets}
        staffOptions={staffOptions}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          setSelected([]);
          void reload();
          void reloadUnassigned();
        }}
      />
    </Space>
  );
}

function CreateTransferModal({
  open,
  targets,
  staffOptions,
  onClose,
  onCreated,
}: {
  open: boolean;
  targets: ScrmUnassigned[];
  staffOptions: { value: string; label: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({
      type: targets.every((row) => row.reason === "离职成员待分配") ? "RESIGN" : "ACTIVE",
      toStaffId: undefined,
    });
  }, [open, targets, form]);

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const result = await scrmApi.createTransfer({
        body: {
          type: values.type,
          toStaffId: values.toStaffId,
          targets: targets.map((row) => ({
            kind: SCRM_TRANSFER_KINDS.find((item) => item === row.kind) ?? "CONTACT",
            id: row.id,
          })),
        },
      });
      message.success(result?.message || `已提交 ${result?.created ?? 0} 条转接`);
      onCreated();
    } catch (error) {
      message.error((error as Error).message || "发起转接失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`发起转接（${targets.length} 个对象）`}
      open={open}
      confirmLoading={saving}
      okText="提交"
      onOk={() => void submit()}
      onCancel={onClose}
      width={620}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="type" label="转接类型" rules={[{ required: true }]}>
          <Select
            options={[
              { value: "ACTIVE", label: "在职继承：客户仍在原员工名下" },
              { value: "RESIGN", label: "离职继承：原员工已离职" },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="toStaffId"
          label="接收人"
          rules={[{ required: true, message: "请选择接收人" }]}
          tooltip="接收人必须已完成企微成员映射"
        >
          <Select showSearch optionFilterProp="label" options={staffOptions} />
        </Form.Item>
        <Notice variant="warn">
          客户转接需要客户在 24 小时内不拒绝；客户群换群主立即生效。
          离职继承由企业管理员发起并指定接收人，部门负责人不代为决定。
        </Notice>
      </Form>
    </Modal>
  );
}
