"use client";
import {endpoints} from "@enterprise/contracts";

import type { ReactNode } from "react";

import { BulbOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Table,
} from "antd";
import { CategoryField } from "@/components/category-field";
import {
  demandActionsColumn,
  DemandChannelModal,
  toDateInput,
  useDemandBoard,
} from "@/components/demand-board";
import {
  demandColumns,
  type DemandFields,
} from "@/components/demand-columns";
import {
  RegionScopeFilter,
  RegionScopeFields,
  regionFormValues,
} from "@/components/location-fields";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { useSession } from "@/lib/session";

/**
 * 平台直连看板的「需求信息」栏目（财税 / 供销 / 出海）。
 *
 * 与其余七板块的区别（2026-09-26 用户口径：本系统只审「能不能成为服务商」，
 * 需求与服务的发布、回复都是 AIworkin 接口转发，本身不审核、不落库）：
 * - 数据源是平台挂单：列表＝我发布的 ∪ 该一级类目的公开池，行的主键是平台挂单 UUID；
 * - 改删与查看消息只对自有行开放（平台按属主校验，收件箱也不给非自有单的会话正文）；
 * - **需求方在平台上没有发言接口**（平台的会话回复只开放给服务商侧），
 *   因此本栏目的「查看消息」弹窗是只读的，不提供回复入口。
 */
export type MarketDemandRow = DemandFields & {
  /** AIworkin 挂单 UUID */
  id: string;
  listingId: string;
  /** 平台行的标题与创建时间总是有值（列表与弹窗明细都要显示） */
  title: string;
  createdAt: string;
  /** 是否本账号发布的单：改删与查看消息据此判定 */
  mine: boolean;
  status: string;
  subCategoryId: string;
  regionMode: string;
  province: string;
  city: string;
  longitude: number | null;
  latitude: number | null;
  radiusKm: number | null;
  conversationCount: number|null;
};

export function MarketDemandTab({
  domain,
  label,
  icon,
  titlePlaceholder,
  descPlaceholder,
  canSubmit = true,
}: {
  /** 平台直连板块键（TAX / SUPPLY），决定接口与类目树 */
  domain: string;
  /** 板块中文名（文案里的板块名，如「财税服务」「供销网络」） */
  label: string;
  icon: ReactNode;
  titlePlaceholder: string;
  descPlaceholder: string;
  /** 个人主体在财税/出海板块不能发布需求（后端同一口径锁住），供销不受限。 */
  canSubmit?: boolean;
}) {
  const { me } = useSession();
  const identity = me?.currentIdentity || "ENTERPRISE_USER";
  const isEnterprise = identity === "ENTERPRISE_USER";

  const board = useDemandBoard<MarketDemandRow>({
    rowSchema:endpoints.MarketBoard_demandDetail.response.shape.data.unwrap(),
    endpoint: `/enterprise/market/${domain}/demands`,
    rowId: (row) => row.id,
    rowNo: (row) => row.listingId,
    rowTitle: (row) => row.title,
    toDemand: (row) => row,
    formValues: (row) => ({
      title: row.title,
      sub_category_id: row.subCategoryId || "",
      description: row.description || "",
      tags: row.tags || "",
      budget: row.budget || "",
      expected_result: row.expectedOutcome || "",
      must_conditions: row.mustHaves || "",
      // 编辑态日期用文本回填（避免引入 dayjs 依赖），提交时按 YYYY-MM-DD 透传
      expect_start: row.startAt || "",
      deadline: row.deadline || "",
      ...regionFormValues(row),
      contact_name: row.contactName || "",
      contact_phone: row.contactPhone || "",
      contact_wechat: row.contactWechat || "",
      contact_email: row.contactEmail || "",
      email_sync: row.emailSync === 1 || row.emailSync === "1" ? "1" : "0",
    }),
    buildBody: (values) => ({
      ...values,
      expect_start: toDateInput(values.expect_start),
      deadline: toDateInput(values.deadline),
      email_sync: values.email_sync || "0",
    }),
    createdTip: `需求已发布至 AIworkin ${label}板块`,
    editPasswordTitle: `修改${label}需求（需密码）`,
    removePasswordTitle: `删除${label}需求`,
  });
  const { rows, editing, openChannel, openEdit, removeRow, save } = board;

  return (
    <>
      <Notice variant="info">
        {label}需求直接走 AIworkin
        平台的供需匹配：填写后由平台按二级类目与地域范围推送给同类目服务商， 本系统不另存需求台账。同一需求可由多家服务商各自应答；
        平台的会话回复只开放给服务商侧，因此这里的「查看消息」用于读取回复方会话。
        {!canSubmit
          ? `你是「个人」主体，这里可浏览${label}需求与回复；发布${label}需求属办理动作，需在「身份与资质」把主体类型变更为「企业」或「个体工商户」。`
          : null}
      </Notice>

      {board.error&&<Alert type="error" title={board.error.message} />}
      <Panel
        title={`${label}需求（平台供需匹配）`}
        titleBadge={`${rows.length} 条`}
        extra={
          isEnterprise && canSubmit ? (
            <Button type="primary" onClick={board.openCreate}>
              ＋ 提交{label}需求
            </Button>
          ) : null
        }
      >
        <div style={{ marginBottom: 12 }}>
          <RegionScopeFilter
            value={board.demandRegion}
            onChange={board.setDemandRegion}
          />
        </div>
        <div className="table-wrap">
          <Table<MarketDemandRow>
            rowKey="id"
            loading={board.loading}
            dataSource={rows}
            pagination={false}
            size="middle"
            scroll={{ x: "max-content" }}
            locale={{
              emptyText: (
                <EmptyState
                  icon={icon}
                  text={`暂无${label}需求，点击右上角提交`}
                />
              ),
            }}
            columns={[
              ...demandColumns<MarketDemandRow>((row) => row),
              demandActionsColumn<MarketDemandRow>({
                // 需求方在平台上没有发言接口：只给「查看消息」，不给「回复」
                canReply: () => false,
                canManage: (row) => row.mine,
                canView: (row) => row.mine,
                conversationCount: (row) => row.conversationCount,
                openChannel,
                openEdit,
                removeRow,
              }),
            ]}
          />
        </div>
        {board.hasMore&&<Button loading={board.loadingMore} onClick={()=>void board.loadMore()}>继续加载</Button>}
      </Panel>

      <Modal
        open={board.createOpen}
        title={
          editing
            ? `修改${label}需求 · ${editing.listingId}`
            : `提交${label}需求`
        }
        width={720}
        confirmLoading={board.submitting}
        onCancel={board.closeCreate}
        okText={editing ? "保存修改" : "发布需求"}
        onOk={() => void save()}
      >
        <Form
          form={board.form}
          layout="vertical"
          initialValues={{ region_mode: "NONE", email_sync: "0" }}
        >
          <Form.Item
            name="title"
            label="需求标题"
            rules={[{ required: true, message: "请填写需求标题" }]}
          >
            <Input placeholder={titlePlaceholder} />
          </Form.Item>
          <div className="form-2col">
            <CategoryField domain={domain} />
          </div>
          <Form.Item name="description" label="详细说明">
            <Input.TextArea rows={3} placeholder={descPlaceholder} />
          </Form.Item>
          <div className="form-2col">
            <Form.Item name="tags" label="标签">
              <Input placeholder="逗号分隔，例如：一般纳税人,按月申报" />
            </Form.Item>
            <Form.Item name="budget" label="预算">
              <Input placeholder="例如：面议 / ¥3,600/年" />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="expected_result" label="期望结果">
              <Input placeholder="例如：完成 2026 年 Q3 全税种申报" />
            </Form.Item>
            <Form.Item name="must_conditions" label="必须满足条件">
              <Input placeholder="例如：需持代理记账许可" />
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
              <Input placeholder="留空按本人档案自动带出" />
            </Form.Item>
            <Form.Item name="contact_phone" label="手机">
              <Input placeholder="留空按本人档案自动带出" />
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
          <Form.Item name="email_sync" label="请把对方回复的内容同步发送到我的邮箱">
            <Select
              options={[
                { value: "0", label: "不发送" },
                { value: "1", label: "发送" },
              ]}
            />
          </Form.Item>
        </Form>
        <p className="text-12 muted" style={{ marginBottom: 0 }}>
          <BulbOutlined aria-hidden /> 平台口径：填了截止时间即正式发布并进入匹配；只填标题与说明则存为平台草稿，
          补齐截止时间后再次保存即发布。预算按原文随需求带给平台参考，平台侧按「面议」撮合。
        </p>
      </Modal>

      <DemandChannelModal
        board={board}
        description={`${label}需求消息（平台会话）：回复方为承接该需求的服务商，需求方在平台上只读`}
        canReply={() => false}
      />
    </>
  );
}
