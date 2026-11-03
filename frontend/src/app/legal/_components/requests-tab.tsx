"use client";
import { legalRequestViewSchema } from '@enterprise/contracts';

import { BulbOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { Button, Checkbox, DatePicker, Form, Input, Modal, Table } from "antd";
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
import { EmptyState, Panel } from "@/components/ui/panel";
import {
  RegionScopeFilter,
  RegionScopeFields,
  regionFormValues,
} from "@/components/location-fields";
import { canWorkOn } from "@/lib/can-work-on";
import { useSession } from "@/lib/session";
import { fieldOf, type LegalRequestRow } from "./common";

/**
 * 本地 `fields` JSON 列 → AIworkin 需求字段（§7.3 口径），
 * 使列表表头与「发起需求」表单逐项一致；接口接通后改由 listMine 透传填充。
 */
const toDemand = (row: LegalRequestRow): DemandFields => ({
  orderNo: row.requestNo,
  listingId: row.platformListingId,
  createdAt: row.createdAt,
  category1: row.category1 || "法律服务",
  category2: row.category2,
  title: row.title,
  description: fieldOf(row, "description"),
  tags: fieldOf(row, "tags"),
  budget: fieldOf(row, "budget"),
  expectedOutcome: fieldOf(row, "expected_result"),
  mustHaves: fieldOf(row, "must_conditions"),
  startAt: fieldOf(row, "expect_start"),
  deadline: fieldOf(row, "deadline"),
  regionScope: fieldOf(row, "region_scope"),
  contactName: row.contactName || fieldOf(row, "contact_name"),
  contactPhone: row.contactPhone || fieldOf(row, "contact_phone"),
  contactWechat: fieldOf(row, "contact_wechat"),
  contactEmail: fieldOf(row, "contact_email"),
  emailSync: fieldOf(row, "email_sync"),
});

const formValues = (row: LegalRequestRow) => ({
  sub_category_id: row.subCategoryId || "",
  title: row.title,
  description: fieldOf(row, "description"),
  tags: fieldOf(row, "tags"),
  budget: fieldOf(row, "budget"),
  expected_result: fieldOf(row, "expected_result"),
  must_conditions: fieldOf(row, "must_conditions"),
  // 编辑态日期用文本回填（避免引入 dayjs 依赖），提交时按 YYYY-MM-DD 透传
  expect_start: fieldOf(row, "expect_start"),
  deadline: fieldOf(row, "deadline"),
  ...regionFormValues(row),
  contact_name: fieldOf(row, "contact_name"),
  contact_phone: fieldOf(row, "contact_phone"),
  contact_wechat: fieldOf(row, "contact_wechat"),
  contact_email: fieldOf(row, "contact_email"),
  email_sync: Number(fieldOf(row, "email_sync") || 0) === 1,
});

/** 法律需求的报文：文本逐项去空白、日期归一 YYYY-MM-DD、`email_sync` 存 0/1。 */
const buildBody = (values: Record<string, unknown>) => ({
  sub_category_id: values.sub_category_id,
  title: String(values.title || "").trim(),
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
  email_sync: values.email_sync ? 1 : 0,
});

/** 需求消息（法律服务）：15 项统一字段发起 → 服务商在需求消息通道内回复。 */
export function RequestsTab() {
  const { me } = useSession();

  const roles = me?.roles || [];
  const isEnterprise = roles.includes("ENTERPRISE_USER");
  const isProvider =
    roles.includes("SERVICE_PROVIDER") || (me?.staffOf || []).length > 0;
  const isAdmin = roles.includes("PLATFORM_ADMIN");

  const board = useDemandBoard<LegalRequestRow>({
    rowSchema:legalRequestViewSchema,
    endpoint: "/enterprise/legal/requests",
    rowId: (row) => row.id,
    rowNo: (row) => row.requestNo,
    rowTitle: (row) => row.title,
    toDemand,
    formValues,
    buildBody,
    // 需求明细整体存 `fields` JSON 列，只有标题与二级类目是独立列
    patchBody: (body) => ({
      title: body.title,
      sub_category_id: body.sub_category_id,
      fields: body,
    }),
    createdTip: "法律需求已提交，服务商将在需求消息中回复",
    openChannelOnCreate: true,
    editPasswordTitle: "修改需求（需密码）",
    removePasswordTitle: "删除需求",
  });
  const { rows, loading, demandRegion, setDemandRegion, editing } = board;

  const enterprise = (me?.enterprise || null) as Record<string, unknown> | null;
  const enterpriseId = Number(enterprise?.id || 0);

  /** 与后端 requireOwner 同口径：只有创建人或平台管理员能改删；可改状态由接口判定。 */
  const canManageRequest = (row: LegalRequestRow) =>
    Boolean(isAdmin || (me?.userId && row.createdBy === me.userId));

  /** 承办方判定（对齐后端 identity.canWorkOn）：已指派承办职员时由其作业，服务商账号不代替。 */
  const canWorkOnRow = (row: LegalRequestRow) => canWorkOn(me, row, isAdmin);

  /** 发言侧：承办方或企业当事人才能在通道内回复，其余只读。 */
  const mySide = (row: LegalRequestRow) =>
    !isAdmin && canWorkOnRow(row)
      ? "PROVIDER"
      : enterpriseId && enterpriseId === row.enterpriseId
        ? "ENTERPRISE"
        : "";

  return (
    <>
      <Panel
        title="需求消息"
        extra={
          isEnterprise ? (
            <Button type="primary" onClick={board.openCreate}>
              ＋ 发起法律需求
            </Button>
          ) : null
        }
      >
        <p className="text-12 muted" style={{ marginTop: 0, marginBottom: 12 }}>
          法律咨询、合同审查、法律意见、纠纷应对和出海合规等需求，需先完善主体档案并完成法律服务签约。
          需求由签约服务商的承办人员处理，双方可在需求消息中沟通方案与报价；平台发布结果以同步状态为准。
        </p>
        <div style={{ marginBottom: 12 }}>
          <RegionScopeFilter value={demandRegion} onChange={setDemandRegion} />
        </div>
        <div className="table-wrap">
          <Table<LegalRequestRow>
            rowKey="id"
            loading={loading}
            dataSource={rows}
            pagination={demandPagination}
            size="middle"
            scroll={{ x: "max-content" }}
            locale={{
              emptyText: (
                <EmptyState
                  icon={<UnorderedListOutlined aria-hidden />}
                  text={
                    isProvider
                      ? "暂无法律需求，等待签约企业发起法律需求"
                      : "暂无法律需求，点击右上角发起你的第一个法律需求"
                  }
                />
              ),
            }}
            columns={[
              ...demandColumns<LegalRequestRow>(toDemand),
              demandActionsColumn<LegalRequestRow>({
                // 法律/知产的入口文案对双方都是「查看消息」，服务商在通道里直接回复
                canReply: () => false,
                canManage: canManageRequest,
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
            ? `修改法律需求 · ${editing.requestNo}`
            : "发起法律需求（企业发起 → 服务商办理）"
        }
        width={640}
        confirmLoading={board.submitting}
        onCancel={board.closeCreate}
        okText={editing ? "保存修改" : "提交需求"}
        cancelText="取消"
        onOk={() => void board.save()}
      >
        <p className="text-12 muted" style={{ marginTop: 0, marginBottom: 10 }}>
          <BulbOutlined aria-hidden /> 发起需求前需完善主体档案，并具备生效中的法律服务签约。
          承办人员按签约和企业分配关系确定，平台发布结果可在同步状态中查看。
        </p>
        <Form
          form={board.form}
          layout="vertical"
          initialValues={{ email_sync: false }}
        >
          <Form.Item
            name="title"
            label="需求标题 *"
            rules={[{ required: true, message: "需求标题必填" }]}
          >
            <Input placeholder="如：审查对美客户销售代理协议" />
          </Form.Item>
          <CategoryField domain="LEGAL" showCredentialHint />
          <Form.Item name="description" label="详细说明">
            <Input.TextArea
              rows={2}
              placeholder="需求背景、希望解决的问题、期望交付物等"
            />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Input placeholder="如：涉外、急件、需双语（逗号分隔）" />
          </Form.Item>
          <Form.Item name="budget" label="预算">
            <Input placeholder="如：面议 / 5000-10000 元" />
          </Form.Item>
          <Form.Item name="expected_result" label="期望结果">
            <Input placeholder="如：5 个工作日内出具审查意见书" />
          </Form.Item>
          <Form.Item name="must_conditions" label="必须满足条件">
            <Input.TextArea
              rows={2}
              placeholder="如：具备涉外合同审查经验、可出具中英双语意见"
            />
          </Form.Item>
          <div className="form-2col">
            <Form.Item name="expect_start" label="期望开始时间">
              {editing ? (
                <Input placeholder="YYYY-MM-DD，如 2026-10-10" />
              ) : (
                <DatePicker
                  style={{ width: "100%" }}
                  placeholder="如：2026-10-10"
                />
              )}
            </Form.Item>
            <Form.Item name="deadline" label="截止时间">
              {editing ? (
                <Input placeholder="YYYY-MM-DD，如 2026-10-15" />
              ) : (
                <DatePicker
                  style={{ width: "100%" }}
                  placeholder="如：2026-10-15"
                />
              )}
            </Form.Item>
          </div>
          <RegionScopeFields />
          <div className="form-2col">
            <Form.Item name="contact_name" label="联系人">
              <Input placeholder="联系人" />
            </Form.Item>
            <Form.Item name="contact_phone" label="手机">
              <Input placeholder="手机" />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="contact_wechat" label="微信">
              <Input placeholder="微信（选填）" />
            </Form.Item>
            <Form.Item name="contact_email" label="邮箱">
              <Input placeholder="邮箱（选填）" />
            </Form.Item>
          </div>
          <Form.Item name="email_sync" valuePropName="checked">
            <Checkbox>请把对方回复的内容同步发送到我的邮箱</Checkbox>
          </Form.Item>
        </Form>
        <p className="text-12 muted" style={{ marginBottom: 0 }}>
          <BulbOutlined aria-hidden /> 可先发起需求，在需求消息中补充材料说明与交付方式。
        </p>
      </Modal>

      <DemandChannelModal
        board={board}
        description="需求消息通道：企业发起需求 → 服务商直接回复方案即接收对接（无需先点接收）→ 双方往来沟通。"
        canReply={(row) => Boolean(mySide(row))}
      />

      {board.passwordModal}
    </>
  );
}
