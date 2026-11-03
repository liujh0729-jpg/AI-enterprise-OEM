"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { supplyApi } from "@/api/supply";

import { ShopOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Modal, Select, Space, Table } from "antd";
import { useState } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, Panel } from "@/components/ui/panel";

import type { SupplyIdentity } from "../page";
import {
  providerLabel,
  type SupplyContract,
  type SupplyProduct,
  type SupplyService,
  type SupplyStation,
} from "./common";

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "启用" },
  { value: "FROZEN", label: "停用" },
];

/**
 * 服务站页签：服务商创建/维护旗下实体站点（商品与服务项目的挂载点，
 * 单据按站点归属）；需求方（企业）只读查看签约服务商的站点。
 */
export function StationTab({
  rows,
  products,
  services,
  contracts,
  loading,
  identity,
}: {
  rows: SupplyStation[];
  products: SupplyProduct[];
  services: SupplyService[];
  contracts: SupplyContract[];
  loading: boolean;
  reload: () => Promise<void> | void;
  identity: SupplyIdentity;
}) {
  const supply_createStationMutation = useOperationMutation(
    supplyApi.createStation,
    ["supply", "dashboard"],
  );
  const supply_updateStationMutation = useOperationMutation(
    supplyApi.updateStation,
    ["supply", "dashboard"],
  );
  const supply_removeStationMutation = useOperationMutation(
    supplyApi.removeStation,
    ["supply", "dashboard"],
  );

  const { message } = App.useApp();
  const { request: requestPassword, modal: passwordModal } =
    usePasswordConfirm();
  const [form] = Form.useForm();
  const [editing, setEditing] = useState<SupplyStation | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const canManage = identity.isProvider || identity.isAdmin;

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  };

  const openEdit = (row: SupplyStation) => {
    setEditing(row);
    form.setFieldsValue({
      name: row.name,
      region: row.region,
      address: row.address,
      contact_name: row.contactName,
      contact_phone: row.contactPhone,
      status: row.status || "ACTIVE",
      remark: row.remark,
    });
    setOpen(true);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      const body = {
        name: String(values.name || "").trim(),
        region: values.region || "",
        address: values.address || "",
        contact_name: values.contact_name || "",
        contact_phone: values.contact_phone || "",
        status: values.status || "ACTIVE",
        remark: values.remark || "",
      };
      if (!editing) {
        setBusy(true);
        try {
          await supply_createStationMutation.mutateAsync({ body: body });

          message.success("服务站已创建，可在站点下上架商品与服务项目");
          setOpen(false);
        } finally {
          setBusy(false);
        }
        return;
      }
      const target = editing;
      requestPassword({
        title: "修改服务站（需密码）",
        content: `确认修改「${target.name}」？停用后该站点不可下新单，已生效单据不受影响。`,
        okText: "保存修改",
        onOk: async () => {
          await supply_updateStationMutation.mutateAsync({
            params: { id: String(target.id) },
            body: body,
          });

          message.success("服务站已更新");
          setOpen(false);
        },
      });
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const removeStation = (row: SupplyStation) => {
    requestPassword({
      title: "删除服务站",
      danger: true,
      okText: "确认删除",
      content: `确认删除「${row.name}」？站点下仍有商品/服务项目或单据时不可删除，可改为「停用」。`,
      onOk: async () => {
        await supply_removeStationMutation.mutateAsync({
          params: { id: String(row.id) },
        });

        message.success("服务站已删除");
      },
    });
  };

  const productCount = (stationId: number) =>
    products.filter((item) =>
      (item.stations || []).some((link) => link.stationId === stationId),
    ).length;
  const serviceCount = (stationId: number) =>
    services.filter((item) => item.stationId === stationId).length;

  return (
    <Panel
      title="线下服务站（商品与服务的经营单元）"
      titleBadge={`${rows.length} 个站点`}
      extra={
        canManage ? (
          <Button type="primary" onClick={openCreate}>
            ＋ 新增服务站
          </Button>
        ) : null
      }
    >
      <div className="text-12 muted" style={{ marginBottom: 10 }}>
        所有商品与服务项目都必须绑定服务站，订单自动归属对应站点。
        {identity.isEnterprise
          ? "企业只能看到已与自己签约「供销服务」的服务商站点。"
          : "服务商可维护多个站点，商品支持按站点独立上下架。"}
      </div>
      <div className="table-wrap">
        <Table<SupplyStation>
          rowKey="id"
          loading={loading}
          pagination={false}
          size="middle"
          dataSource={rows}
          locale={{
            emptyText: (
              <EmptyState
                icon={<ShopOutlined aria-hidden />}
                text="暂无服务站。服务站由服务商创建，商品与服务项目都挂在站点下。"
              />
            ),
          }}
          columns={[
            {
              title: "服务站名称",
              dataIndex: "name",
              width: 200,
              render: (value: string) => (
                <span style={{ fontWeight: 600 }}>{value || "—"}</span>
              ),
            },
            {
              title: "所属服务商",
              dataIndex: "providerUserId",
              width: 170,
              render: (value: string) =>
                providerLabel(
                  contracts,
                  value,
                  identity.meUserId,
                  identity.selfName,
                ),
            },
            {
              title: "地区",
              dataIndex: "region",
              width: 130,
              render: (value: string) => value || "—",
            },
            {
              title: "地址",
              dataIndex: "address",
              ellipsis: true,
              render: (value: string) => value || "—",
            },
            {
              title: "联系人",
              dataIndex: "contactName",
              width: 100,
              render: (value: string) => value || "—",
            },
            {
              title: "联系电话",
              dataIndex: "contactPhone",
              width: 130,
              render: (value: string) => value || "—",
            },
            {
              title: "在架商品",
              width: 90,
              render: (_, row) => (
                <span className="text-12">{productCount(row.id)}</span>
              ),
            },
            {
              title: "在架服务",
              width: 90,
              render: (_, row) => (
                <span className="text-12">{serviceCount(row.id)}</span>
              ),
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 90,
              render: (value: string) => (
                <StatusBadge domain="supplyListing" status={value} />
              ),
            },
            {
              title: "备注",
              dataIndex: "remark",
              ellipsis: true,
              render: (value: string) => value || "—",
            },
            {
              title: "操作",
              width: 130,
              render: (_, row) =>
                canManage ? (
                  <Space size={6}>
                    <Button onClick={() => openEdit(row)}>编辑</Button>
                    <Button danger onClick={() => removeStation(row)}>
                      删除
                    </Button>
                  </Space>
                ) : (
                  <span className="text-12 muted">—</span>
                ),
            },
          ]}
        />
      </div>

      <Modal
        open={open}
        title={editing ? `修改服务站 · ${editing.name}` : "新增服务站"}
        width={620}
        okText={editing ? "保存修改（需密码）" : "创建服务站"}
        cancelText="取消"
        confirmLoading={busy}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
      >
        <Form form={form} layout="vertical">
          <div className="form-2col">
            <Form.Item
              name="name"
              label="服务站名称"
              rules={[{ required: true, message: "服务站名称必填" }]}
            >
              <Input placeholder="如：华东供销·萧山服务站" />
            </Form.Item>
            <Form.Item name="region" label="所在地区">
              <Input placeholder="如：浙江 杭州" />
            </Form.Item>
            <Form.Item name="contact_name" label="联系人">
              <Input placeholder="如：周海" />
            </Form.Item>
            <Form.Item name="contact_phone" label="联系电话">
              <Input placeholder="手机号 / 座机" />
            </Form.Item>
          </div>
          <Form.Item name="address" label="详细地址">
            <Input placeholder="固定经营地址（用于就近供货与服务履约）" />
          </Form.Item>
          <div className="form-2col">
            <Form.Item name="status" label="状态">
              <Select options={STATUS_OPTIONS} />
            </Form.Item>
            <Form.Item name="remark" label="备注">
              <Input placeholder="如：粮食烘干代储与港口集散" />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      {passwordModal}
    </Panel>
  );
}
