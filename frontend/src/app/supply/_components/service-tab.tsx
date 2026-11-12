"use client";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { supplyApi } from "@/api/supply";

import { ToolOutlined } from "@ant-design/icons";
import Link from "next/link";
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
} from "antd";
import { useState } from "react";
import type { ReactNode } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";

import type { SupplyIdentity } from "../page";
import {
  money,
  providerLabel,
  type SupplyContract,
  type SupplyService,
  type SupplyStation,
} from "./common";

const LISTING_OPTIONS = [
  { value: "ONLINE", label: "在售（上架）" },
  { value: "OFFLINE", label: "已下架" },
];

/**
 * 服务项目页签（线下服务：必须归属某个服务站，按次/平米/工日等报价）：
 * - 服务商账号：新增/修改/删除服务项目（线上作业台账在本地，营销内容供 AIworkin 独立站）；
 * - 用户：只读浏览已签约服务商的服务（预约在「服务预约」页签）。
 */
export function ServiceTab({
  rows,
  stations,
  contracts,
  loading,
  identity,
  panelTitle,
  switcher,
}: {
  rows: SupplyService[];
  stations: SupplyStation[];
  contracts: SupplyContract[];
  loading: boolean;
  reload: () => Promise<void> | void;
  identity: SupplyIdentity;
  /** 企业侧「服务采购」栏目内的目录标题。 */
  panelTitle?: string;
  /** 企业侧「服务采购」栏目内的子视图切换器（可约服务项目 / 我的服务预约单）。 */
  switcher?: ReactNode;
}) {
  const supply_createServiceMutation = useOperationMutation(
    supplyApi.createService,
    ["supply", "dashboard"],
  );
  const supply_updateServiceMutation = useOperationMutation(
    supplyApi.updateService,
    ["supply", "dashboard"],
  );
  const supply_removeServiceMutation = useOperationMutation(
    supplyApi.removeService,
    ["supply", "dashboard"],
  );

  const { message } = App.useApp();
  const { request: requestPassword, modal: passwordModal } =
    usePasswordConfirm();
  const canManage = identity.isProvider || identity.isAdmin;
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SupplyService | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<SupplyService | null>(null);

  const myStations = identity.isAdmin
    ? stations
    : stations.filter((item) => item.providerUserId === identity.meUserId);

  const providerText = (userId: string) =>
    providerLabel(contracts, userId, identity.meUserId, identity.selfName);

  const stationText = (row: SupplyService) =>
    row.stationName ||
    stations.find((item) => item.id === row.stationId)?.name ||
    `站点 #${row.stationId}`;

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      price_unit: "次",
      status: "ONLINE",
      featured: false,
      station_id: myStations[0]?.id,
    });
    setOpen(true);
  };

  const openEdit = (row: SupplyService) => {
    setEditing(row);
    form.setFieldsValue({
      name: row.name,
      station_id: row.stationId,
      price_unit: row.priceUnit || "次",
      base_price: Number(row.basePrice || 0),
      intro: row.intro,
      scene: row.scene,
      status: row.status || "ONLINE",
      marketing_title: row.marketingTitle,
      marketing_summary: row.marketingSummary,
      marketing_content: row.marketingContent,
      cover_url: row.coverUrl,
      featured: Boolean(row.featured),
    });
    setOpen(true);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      const body = {
        name: String(values.name || "").trim(),
        station_id: Number(values.station_id || 0),
        price_unit: values.price_unit || "次",
        base_price: Number(values.base_price || 0),
        intro: values.intro || "",
        scene: values.scene || "",
        status: values.status || "ONLINE",
        marketing_title: values.marketing_title || "",
        marketing_summary: values.marketing_summary || "",
        marketing_content: values.marketing_content || "",
        cover_url: values.cover_url || "",
        featured: Boolean(values.featured),
      };
      if (!editing) {
        setBusy(true);
        try {
          await supply_createServiceMutation.mutateAsync({ body: body });

          message.success("服务项目已创建");
          setOpen(false);
        } finally {
          setBusy(false);
        }
        return;
      }
      const target = editing;
      requestPassword({
        title: "修改服务项目（需密码）",
        content: `确认修改「${target.name}」？报价与上下架变更会同步独立站展示状态。`,
        okText: "保存修改",
        onOk: async () => {
          await supply_updateServiceMutation.mutateAsync({
            params: { id: String(target.id) },
            body: body,
          });

          message.success("服务项目已更新");
          setOpen(false);
        },
      });
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const removeService = (row: SupplyService) => {
    requestPassword({
      title: "删除服务项目",
      danger: true,
      okText: "确认删除",
      content: `确认删除「${row.name}」？已有预约单的服务不可删除，可改为「下架」。`,
      onOk: async () => {
        await supply_removeServiceMutation.mutateAsync({
          params: { id: String(row.id) },
        });

        message.success("服务项目已删除");
        setDetail(null);
      },
    });
  };

  return (
    <Panel
      title={panelTitle || "服务项目（线下服务）"}
      extra={
        canManage ? (
          <Button type="primary" onClick={openCreate}>
            ＋ 新增服务项目
          </Button>
        ) : null
      }
    >
      {switcher}
      <div className="text-12 muted" style={{ marginBottom: 10 }}>
        服务项目必须归属一个服务站（按站点独立对外）；
        {identity.isEnterprise
          ? "企业在「服务采购」栏目选择服务项目并提交预约单，"
          : "企业按服务项目发起预约单，"}
        报价由服务商账号或其承办职员完成。
      </div>
      <div className="table-wrap">
        <Table<SupplyService>
          rowKey="id"
          loading={loading}
          dataSource={rows}
          pagination={false}
          size="middle"
          locale={{
            emptyText: (
              <EmptyState
                icon={<ToolOutlined aria-hidden />}
                text={
                  identity.isEnterprise
                    ? "暂无服务项目。签约服务商上架线下服务项目后，可在此发起预约单。"
                    : "暂无服务项目。服务商可在本页签新增；企业签约后于「服务采购」提交预约单。"
                }
              />
            ),
          }}
          columns={[
            {
              title: "服务名称",
              dataIndex: "name",
              width: 200,
              render: (value: string) => (
                <span style={{ fontWeight: 600 }}>{value}</span>
              ),
            },
            {
              title: "所属服务商",
              width: 170,
              render: (_, row) => (
                <span className="text-12">
                  {providerText(row.providerUserId)}
                </span>
              ),
            },
            {
              title: "所属服务站",
              width: 150,
              render: (_, row) => (
                <span className="text-12">{stationText(row)}</span>
              ),
            },
            {
              title: "报价",
              width: 130,
              render: (_, row) => (
                <span className="text-12">
                  ¥{money(row.basePrice)} / {row.priceUnit || "次"}
                </span>
              ),
            },
            {
              title: "履约场景",
              dataIndex: "scene",
              ellipsis: true,
              render: (value: string) => value || "—",
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
              title: "首页推荐",
              width: 110,
              render: (_, row) =>
                row.featured ? (
                  <span className="badge badge-orange">首页推荐</span>
                ) : (
                  "—"
                ),
            },
            {
              title: "操作",
              width: 190,
              render: (_, row) => (
                <Space size={6} wrap>
                  <Button onClick={() => setDetail(row)}>详情</Button>
                  {canManage ? (
                    <Button onClick={() => openEdit(row)}>编辑</Button>
                  ) : null}
                  {canManage ? (
                    <Button danger onClick={() => removeService(row)}>
                      删除
                    </Button>
                  ) : null}
                </Space>
              ),
            },
          ]}
        />
      </div>

      <Modal
        open={open}
        title={editing ? `修改服务项目 · ${editing.name}` : "新增服务项目"}
        width={720}
        okText={editing ? "保存修改（需密码）" : "创建服务项目"}
        cancelText="取消"
        confirmLoading={busy}
        forceRender
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
      >
        <Form form={form} layout="vertical">
        <Notice>
          服务项目＝线下履约能力（如土地平整、植保飞防）；线上交易台账本地自持，
          营销标题/摘要/正文用于 AIworkin GEO 独立站展示，一期本地留痕。
        </Notice>
        <div className="form-2col">
          <Form.Item
            name="name"
            label="服务名称 *"
            rules={[{ required: true, message: "服务名称必填" }]}
          >
            <Input placeholder="如：植保无人机飞防作业" />
          </Form.Item>
          <Form.Item
            name="station_id"
            label="所属服务站 *"
            rules={[{ required: true, message: "请选择所属服务站" }]}
            extra={
              !myStations.length ? (
                <Link href="/supply?tab=stations">去创建服务站</Link>
              ) : null
            }
          >
            <Select
              placeholder={
                myStations.length
                  ? "选择所属服务站"
                  : "请先在「服务站」页签创建站点"
              }
              options={myStations.map((item) => ({
                value: item.id,
                label: `${item.name}${item.region ? `（${item.region}）` : ""}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="price_unit" label="报价单位">
            <Input placeholder="如：次 / 亩 / 工日" />
          </Form.Item>
          <Form.Item name="base_price" label="基础报价（元）">
            <Input type="number" placeholder="按报价单位计价" />
          </Form.Item>
        </div>
        <Form.Item name="scene" label="履约场景">
          <Input placeholder="如：大田作物生长期飞防、果园植保" />
        </Form.Item>
        <Form.Item name="intro" label="服务介绍">
          <Input.TextArea
            rows={3}
            placeholder="服务内容、作业标准、交付周期等"
          />
        </Form.Item>
        <div className="form-2col">
          <Form.Item name="status" label="状态">
            <Select options={LISTING_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="featured"
            label="独立站首页推荐"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </div>
        <Form.Item
          name="marketing_title"
          label="AIworkin 营销标题（独立站展示）"
        >
          <Input placeholder="如：植保无人机飞防 · 萧山站直派" />
        </Form.Item>
        <Form.Item name="marketing_summary" label="服务摘要">
          <Input placeholder="一句话卖点，用于独立站列表页" />
        </Form.Item>
        <Form.Item name="marketing_content" label="详细正文">
          <Input.TextArea
            rows={3}
            placeholder="作业流程、保障承诺、案例等公域展示内容"
          />
        </Form.Item>
        <Form.Item name="cover_url" label="封面展示图 URL">
          <Input placeholder="留空表示暂不上传封面" />
        </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(detail)}
        title={`服务详情 · ${detail?.name || ""}`}
        width={640}
        onCancel={() => setDetail(null)}
        footer={<Button onClick={() => setDetail(null)}>关闭</Button>}
      >
        <div className="text-12 muted" style={{ lineHeight: 1.9 }}>
          <div>所属服务商：{providerText(detail?.providerUserId || "")}</div>
          <div>所属服务站：{detail ? stationText(detail) : "—"}</div>
          <div>
            报价：¥{money(detail?.basePrice)} / {detail?.priceUnit || "次"}
          </div>
          <div>履约场景：{detail?.scene || "—"}</div>
          <div>服务介绍：{detail?.intro || "—"}</div>
          <div>营销标题：{detail?.marketingTitle || "—"}</div>
          <div>服务摘要：{detail?.marketingSummary || "—"}</div>
          <div>详细正文：{detail?.marketingContent || "—"}</div>
          <div>独立站推荐：{detail?.featured ? "是" : "否"}</div>
        </div>
      </Modal>

      {passwordModal}
    </Panel>
  );
}
