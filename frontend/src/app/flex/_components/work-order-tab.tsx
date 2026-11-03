"use client";
import { flexWorkOrderViewSchema } from '@enterprise/contracts';

import { AimOutlined } from "@ant-design/icons";
import { Button, DatePicker, Form, Input, Modal, Select, Table } from "antd";
import { type ReactNode } from "react";
import { CategoryField } from "@/components/category-field";
import {
  DemandChannelModal,
  demandActionsColumn,
  toDateInput,
  useDemandBoard,
} from "@/components/demand-board";
import {
  demandColumns,
  demandPagination,
  type DemandFields,
} from "@/components/demand-columns";
import {
  RegionScopeFilter,
  RegionScopeFields,
  regionFormValues,
} from "@/components/location-fields";
import { EmptyState, Panel } from "@/components/ui/panel";
import { canWorkOn } from "@/lib/can-work-on";
import {
  WORK_TYPE_OPTIONS,
  workTypeLabel,
  type FlexContract,
  type FlexWorkOrder,
} from "./common";

/** 本地台账列 → AIworkin 需求字段（§7.3 口径，与物流/营销/法律/知产同一套表头）。 */
const toDemand = (row: FlexWorkOrder): DemandFields => ({
  orderNo: row.orderNo,
  listingId: row.platformListingId,
  createdAt: row.createdAt,
  category1: row.category1 || "灵活用工服务",
  category2: row.category2,
  title: row.title,
  description: row.description,
  tags: row.tags,
  budget: row.budget,
  expectedOutcome: row.expectedResult,
  mustHaves: row.mustConditions,
  startAt: row.expectStart,
  deadline: row.deadline,
  regionScope: row.regionScope,
  contactName: row.contactName,
  contactPhone: row.contactPhone,
  contactWechat: row.contactWechat,
  contactEmail: row.contactEmail,
  providerContactName: row.providerContactName,
  providerContactPhone: row.providerContactPhone,
  emailSync: row.emailSync,
});

const formValues = (row: FlexWorkOrder) => ({
  title: row.title,
  sub_category_id: row.subCategoryId || "",
  work_type: row.workType,
  description: row.description,
  tags: row.tags,
  budget: row.budget,
  expected_result: row.expectedResult,
  must_conditions: row.mustConditions,
  // 编辑态日期用文本回填（避免引入 dayjs 依赖），提交时按 YYYY-MM-DD 透传
  expect_start: row.expectStart || "",
  deadline: row.deadline || "",
  ...regionFormValues(row),
  contact_name: row.contactName,
  contact_phone: row.contactPhone,
  contact_wechat: row.contactWechat,
  contact_email: row.contactEmail,
  email_sync: Number(row.emailSync || 0) ? "1" : "0",
});

/** 用工需求报文：文本逐项去空白、日期归一 YYYY-MM-DD、`email_sync` 存 "0"/"1"。 */
const buildBody = (values: Record<string, unknown>) => ({
  title: String(values.title || "").trim(),
  sub_category_id: values.sub_category_id,
  work_type: values.work_type || "FULLTIME",
  description: String(values.description || "").trim(),
  tags: String(values.tags || "").trim(),
  budget: String(values.budget || "").trim(),
  expected_result: String(values.expected_result || "").trim(),
  must_conditions: String(values.must_conditions || "").trim(),
  expect_start: toDateInput(values.expect_start),
  deadline: toDateInput(values.deadline),
  region_mode: String(values.region_mode || "NONE"),
  province: String(values.province || "").trim(),
  city: String(values.city || "").trim(),
  longitude: String(values.longitude || "").trim(),
  latitude: String(values.latitude || "").trim(),
  radius_km: String(values.radius_km || "").trim(),
  contact_name: String(values.contact_name || "").trim(),
  contact_phone: String(values.contact_phone || "").trim(),
  contact_wechat: String(values.contact_wechat || "").trim(),
  contact_email: String(values.contact_email || "").trim(),
  email_sync: String(values.email_sync || "0"),
});

/** 用工需求页签（🎯 用工需求）：企业以 §7.3 统一字段发布 → 服务商在需求消息通道内回复。 */
export function WorkOrderTab({
  contracts,
  isEnterprise,
  isAdmin,
  isProvider,
  meUserId,
  staffOf,
  switcher,
}: {
  contracts: FlexContract[];
  isEnterprise: boolean;
  isAdmin: boolean;
  isProvider: boolean;
  meUserId: string;
  staffOf: { providerUserId?: string; status?: string }[];
  /** 「用工需求」栏目内的子视图切换器（用工需求 / 用工进件）。 */
  switcher?: ReactNode;
}) {
  const board = useDemandBoard<FlexWorkOrder>({
    rowSchema:flexWorkOrderViewSchema,
    endpoint: "/enterprise/flex/work-orders",
    rowId: (row) => row.id,
    rowNo: (row) => row.orderNo,
    rowTitle: (row) => `${row.orderNo} · ${row.title}`,
    toDemand,
    formValues,
    buildBody,
    createdTip: "用工需求已发布，直达承办代理人",
    savedTip: "用工需求已更新",
    editPasswordTitle: "修改用工需求（需密码）",
    removePasswordTitle: "删除用工需求",
  });
  const { rows, loading, demandRegion, setDemandRegion, editing } = board;

  /** 用工需求直达签约代理人：无生效签约时不放开发起（业务前置，非改删判权）。 */
  const hasContract = contracts.some(
    (item) => item.status === "ACTIVE" && item.serviceType === "FLEX_WORK",
  );

  const openCreate = () => {
    if (!hasContract) {
      board.message.warning(
        "暂无生效签约，请先在「代理人资源库」选择该代理人合作并待代理人确认",
      );
      return;
    }
    board.openCreate();
  };

  /** 交付动作权限（对齐后端 identity.canWorkOn：承办服务商账号或承办职员）。 */
  const canWork = (row: FlexWorkOrder) =>
    canWorkOn({ userId: meUserId, staffOf }, row, isAdmin);
  /** 与后端 requireOwner 同口径：只有创建人或平台管理员能改删；可改状态由接口判定。 */
  const canManage = (row: FlexWorkOrder) =>
    Boolean(isAdmin || (meUserId && row.createdBy === meUserId));

  return (
    <>
      <Panel
        title="用工需求（企业发布 · 服务商在需求消息中回复）"
        titleBadge={`${rows.length} 条`}
        extra={
          isEnterprise ? (
            <Button type="primary" onClick={openCreate}>
              ＋ 发布用工需求
            </Button>
          ) : null
        }
      >
        {switcher}
        <div style={{ marginBottom: 12 }}>
          <RegionScopeFilter
            value={demandRegion}
            onChange={setDemandRegion}
          />
        </div>
        <div className="table-wrap">
          <Table<FlexWorkOrder>
            rowKey="id"
            loading={loading}
            dataSource={rows}
            pagination={demandPagination}
            size="middle"
            scroll={{ x: "max-content" }}
            locale={{
              emptyText: (
                <EmptyState
                  icon={<AimOutlined aria-hidden />}
                  text={
                    isProvider
                      ? "暂无用工需求，签约企业发布的用工需求将在此接单办理"
                      : "暂无用工需求，点击右上角发布您的第一条用工需求"
                  }
                />
              ),
            }}
            columns={[
              ...demandColumns<FlexWorkOrder>(toDemand),
              demandActionsColumn<FlexWorkOrder>({
                canReply: () => false,
                canManage: canManage,
                conversationCount: (row) => row.conversationCount,
                openChannel: board.openChannel,
                openEdit: board.openEdit,
                removeRow: board.removeRow,
              }),
            ]}
          />
        </div>
      </Panel>

      <Modal
        open={board.createOpen}
        title={
          editing
            ? `修改用工需求 · ${editing.orderNo}`
            : "发布用工需求（需求直达签约代理人承办）"
        }
        width={720}
        confirmLoading={board.submitting}
        okText={editing ? "保存修改（需密码）" : "发布需求"}
        onCancel={board.closeCreate}
        onOk={() => void board.save()}
      >
        <Form
          form={board.form}
          layout="vertical"
          initialValues={{ work_type: "FULLTIME", email_sync: "0" }}
        >
          <Form.Item
            name="title"
            label="需求标题"
            rules={[{ required: true, message: "请填写需求标题" }]}
          >
            <Input placeholder="例如：电商大促临时客服 20 人" />
          </Form.Item>
          <CategoryField domain="FLEX" />
          <Form.Item
            name="work_type"
            label="用工形式"
            rules={[{ required: true, message: "请选择用工形式" }]}
          >
            <Select options={WORK_TYPE_OPTIONS} placeholder="请选择用工形式" />
          </Form.Item>
          <Form.Item name="description" label="详细说明">
            <Input.TextArea
              rows={3}
              placeholder="用工场景、到岗要求、作息与结算说明等"
            />
          </Form.Item>
          <div className="form-2col">
            <Form.Item name="tags" label="标签">
              <Input placeholder="逗号分隔，例如：两班倒,包吃住" />
            </Form.Item>
            <Form.Item name="budget" label="预算">
              <Input placeholder="例如：面议 / 260 元/天" />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="expected_result" label="期望结果">
              <Input placeholder="例如：10 日内到岗 20 人" />
            </Form.Item>
            <Form.Item name="must_conditions" label="必须满足条件">
              <Input placeholder="例如：持健康证" />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="expect_start" label="期望开始时间">
              {editing ? (
                <Input placeholder="YYYY-MM-DD，如 2026-10-10" />
              ) : (
                <DatePicker style={{ width: "100%" }} />
              )}
            </Form.Item>
            <Form.Item name="deadline" label="截止时间">
              {editing ? (
                <Input placeholder="YYYY-MM-DD，如 2026-10-15" />
              ) : (
                <DatePicker style={{ width: "100%" }} />
              )}
            </Form.Item>
          </div>
          <RegionScopeFields />
          <div className="form-2col">
            <Form.Item name="contact_name" label="联系人">
              <Input />
            </Form.Item>
            <Form.Item name="contact_phone" label="手机">
              <Input />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="contact_wechat" label="微信">
              <Input />
            </Form.Item>
            <Form.Item name="contact_email" label="邮箱">
              <Input />
            </Form.Item>
          </div>
          <Form.Item
            name="email_sync"
            label="请把对方回复的内容同步发送到我的邮箱"
          >
            <Select
              options={[
                { value: "0", label: "不发送" },
                { value: "1", label: "发送" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <DemandChannelModal
        board={board}
        description="需求消息通道：企业发布用工需求 → 服务商直接回复方案即接收对接（无需先点接收）→ 双方往来沟通。"
        extraDetails={(row) => [
          { label: "用工形式", value: workTypeLabel(row.workType) },
        ]}
        replyLabel={(row) => (canWork(row) ? "回复企业" : "回复服务商")}
      />

      {board.passwordModal}
    </>
  );
}
