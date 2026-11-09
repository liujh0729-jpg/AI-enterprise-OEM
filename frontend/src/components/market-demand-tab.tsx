"use client";
import {endpoints} from "@enterprise/contracts";

import type { ReactNode } from "react";
import { useState } from "react";

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
import { CategoryField, HubCategoryFilter } from "@/components/category-field";
import {
  ChannelDetails,
} from "@/components/channel-messages-modal";
import {
  demandActionsColumn,
  DemandChannelModal,
  toDateInput,
  useDemandBoard,
} from "@/components/demand-board";
import {
  demandColumns,
  demandDetails,
  type DemandFields,
} from "@/components/demand-columns";
import {
  RegionScopeFilter,
  RegionScopeFields,
  regionFormValues,
} from "@/components/location-fields";
import { EmptyState, Notice, Panel, PillTabs } from "@/components/ui/panel";
import { TablePager, useCursorPages } from "@/components/ui/pager";
import { useSession } from "@/lib/session";

/**
 * 平台直连看板的「需求信息」栏目（财税 / 供销 / 出海）。
 *
 * 与其余七板块的区别（2026-09-26 用户口径：本系统只审「能不能成为服务商」，
 * 需求与服务的发布都是 AIworkin 接口转发，本系统不审核）：
 * - 直连板块（财税 / 供销 / 出海）：列表读**本系统台账**（`market_listing_records`，
 *   即「我发布的」）；发布时同时落本地台账 + 同步 AIworkin 并按挂单号（内容 ID）读回，
 *   因此未绑定 Key 与已绑定 Key 的账号都不会看到通道鉴权失败；
 * - 供需市场（HUB）例外：默认读平台公开池，服务商身份可切「全部需求（公开池）/
 *   我发布的需求（本地台账）」，读取一律走平台通道；
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
  demandNoun,
  allowAnyIdentity = false,
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
  /** 需求的名词文案：默认「{label}需求」，供需市场传「需求」。 */
  demandNoun?: string;
  /** 不按企业身份限制发布入口（供需市场对全部登录用户开放）。 */
  allowAnyIdentity?: boolean;
}) {
  const { me } = useSession();
  const identity = me?.currentIdentity || "ENTERPRISE_USER";
  const isEnterprise = identity === "ENTERPRISE_USER";
  const hub = domain.toUpperCase() === "HUB";
  const noun = demandNoun || `${label}需求`;
  /**
   * 「全部 / 我发布的」筛选：只有供需市场需求栏目需要，且「我发布的需求」只对服务商身份渲染
   * （2026-11-09 用户口径：服务商身份才有「我发布的」，企业身份一律不渲染——单选不出控件，
   * 于是企业身份只看到平台公开池）。
   */
  const showScope = hub && identity === "SERVICE_PROVIDER";

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
    createdTip: hub ? "需求已发布至 AIworkin 供需市场" : `需求已发布至 AIworkin ${label}板块`,
    editPasswordTitle: `修改${noun}（需密码）`,
    removePasswordTitle: `删除${noun}`,
  });
  const { rows, editing, openChannel, openEdit, removeRow, save } = board;
  /** 列表分页：过滤器变化回第一页，翻到未加载页时自动取下一段游标页。 */
  const pager = useCursorPages<MarketDemandRow>({
    rows,
    hasMore: board.hasMore,
    fetchNext: board.loadMore,
    isFetchingNext: board.loadingMore,
    resetKey: `${board.demandScope}|${board.demandRegion.province}|${board.demandRegion.city}|${board.demandCategory}`,
  });
  /** 详情查看：公开池的行不属于当前账号，但可以读平台明细（需求详情接口）。 */
  const [viewing, setViewing] = useState<MarketDemandRow | null>(null);
  const openDetail = (row: MarketDemandRow) => {
    void board
      .loadDetail(row)
      .then(setViewing)
      .catch((error: unknown) =>
        board.message.error(
          error instanceof Error ? error.message : "读取需求详情失败",
        ),
      );
  };

  return (
    <>
      <Notice variant="info">
        {hub
          ? `供需市场是跨板块公开市集：「全部${noun}」读 AIworkin 平台公开池（全平台已发布的需求，读取走平台通道，未绑定 Key 也能浏览）${
              showScope
                ? `；「我发布的${noun}」读本系统台账（发布时落库并记平台内容 ID），仅服务商身份可见`
                : ""
            }。已正式发布到平台的挂单不可在本系统改删，只留「查看」。`
          : `${noun}信息读本系统台账：发布时同时落库到本地并同步到 AIworkin，按二级类目与地域范围推送给同类目服务商，再记回平台挂单号（内容 ID）。已正式发布到平台的挂单不可在本系统改删，只留「查看消息」；平台草稿可回本系统补齐后再次保存发布。`}
        同一需求可由多家服务商各自应答；平台的会话回复只开放给服务商侧，因此这里的「查看消息」用于读取回复方会话。
        {!canSubmit
          ? `你是「个人」主体，这里可浏览${noun}与回复；发布${noun}属办理动作，需在「身份与资质」把主体类型变更为「企业」或「个体工商户」。`
          : null}
      </Notice>

      {board.error&&<Alert type="error" title={board.error.message} />}
      <Panel
        title={`${noun}（平台供需匹配）`}
        titleBadge={`${rows.length} 条`}
        extra={
          (isEnterprise || allowAnyIdentity) && canSubmit ? (
            <Button type="primary" onClick={board.openCreate}>
              ＋ 提交{noun}
            </Button>
          ) : null
        }
      >
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          {showScope ? (
            <PillTabs
              size="small"
              variant="soft"
              items={[
                { key: "all", label: `全部${noun}` },
                { key: "mine", label: `我发布的${noun}` },
              ]}
              value={board.demandScope === "mine" ? "mine" : "all"}
              onChange={(key) =>
                board.setDemandScope(key === "mine" ? "mine" : "")
              }
            />
          ) : null}
          <RegionScopeFilter
            value={board.demandRegion}
            onChange={board.setDemandRegion}
          />
          {hub ? (
            <HubCategoryFilter
              value={board.demandCategory}
              onChange={board.setDemandCategory}
            />
          ) : null}
        </div>
        <div className="table-wrap">
          <Table<MarketDemandRow>
            rowKey="id"
            loading={board.loading || board.loadingMore}
            dataSource={pager.rows}
            pagination={false}
            size="middle"
            scroll={{ x: "max-content" }}
            locale={{
              emptyText: (
                <EmptyState
                  icon={icon}
                  text={`暂无${noun}，点击右上角提交`}
                />
              ),
            }}
            columns={[
              ...demandColumns<MarketDemandRow>((row) => row),
              demandActionsColumn<MarketDemandRow>({
                // 需求方在平台上没有发言接口：只给「查看消息」，不给「回复」
                canReply: () => false,
                // 已正式发布到 AIworkin 的挂单（status=ONLINE）在本系统不可改删：平台 REST 写
                // 对 API Key 一律 401、MCP 也没有改删工具，只留「查看」（2026-11-09 用户裁定）；
                // 平台草稿（无截止时间，尚未发布）仍可回本系统补齐后再次保存发布。
                canManage: (row) => row.mine && row.status !== "ONLINE",
                canView: (row) => row.mine,
                openDetail: hub ? openDetail : undefined,
                conversationCount: (row) => row.conversationCount,
                openChannel,
                openEdit,
                removeRow,
              }),
            ]}
          />
        </div>
        <TablePager
          page={pager.page}
          pageSize={pager.pageSize}
          total={pager.total}
          loaded={pager.loaded}
          hasMore={board.hasMore}
          onChange={pager.setPage}
        />
      </Panel>

      <Modal
        open={board.createOpen}
        title={
          editing
            ? `修改${noun} · ${editing.listingId}`
            : `提交${noun}`
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
          initialValues={{ email_sync: "0" }}
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
        description={`${noun}消息（平台会话）：回复方为承接该需求的服务商，需求方在平台上只读`}
        canReply={() => false}
      />

      <Modal
        open={viewing !== null}
        title={`${noun}详情 · ${viewing?.listingId || ""}`}
        width={720}
        footer={null}
        onCancel={() => setViewing(null)}
      >
        {viewing ? <ChannelDetails items={demandDetails(viewing)} /> : null}
      </Modal>
    </>
  );
}
