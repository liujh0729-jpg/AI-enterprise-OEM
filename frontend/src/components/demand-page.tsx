"use client";

import { Alert, Button, ConfigProvider, Form, Modal, Table } from "antd";
import type { ReactNode } from "react";
import {
  DemandChannelModal,
  demandActionsColumn,
  type DemandBoard,
} from "@/components/demand-board";
import {
  demandColumns,
  type DemandFields,
} from "@/components/demand-columns";
import { RegionScopeFilter } from "@/components/location-fields";
import { EmptyState, PageHero, Panel, type HeroTab } from "@/components/ui/panel";

/** 页壳对行的最低要求：表格主键 + 回复方家数（「查看消息（n）」）。 */
export type DemandPageRow = {
  id: number | string;
  conversationCount?: number;
};

/** 需求信息面板的板块口径（文案与判权全部由页面给出）。 */
export type DemandPageConfig<TRow extends DemandPageRow> = {
  panelTitle: string;
  /** 提交按钮与弹窗标题文案：按钮自动加「＋ 」前缀 */
  createLabel: string;
  emptyIcon: ReactNode;
  emptyText: string;
  /** 是否给「＋ 提交…需求」入口（企业 / 双身份 / 服务商各自口径由页面判定） */
  canPost: boolean;
  /** 服务商侧「回复」入口（资产按行判定：承接方≠发布方） */
  canReply: (row: TRow) => boolean;
  /** 不传＝所有行都给消息入口（营销按承办方收窄） */
  canView?: (row: TRow) => boolean;
  canManage: (row: TRow) => boolean;
  /** 修改弹窗标题（各板块单据号列名不同） */
  editTitle: (row: TRow) => string;
  /** 新增/修改表单宽度：营销 760，其余 720 */
  formWidth?: number;
  channelDescription: string;
};

export type DemandPageProps<TRow extends DemandPageRow> = {
  hero: { title: string; desc: ReactNode };
  tabs: HeroTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  board: DemandBoard<TRow>;
  toDemand: (row: TRow) => DemandFields;
  demand: DemandPageConfig<TRow>;
  /** 需求信息页签 key（默认 requests） */
  demandTabKey?: string;
  serviceTab?: ReactNode;
  providersTab?: ReactNode;
  /** 新增/修改表单正文（各板块字段与占位文案不同） */
  formBody: (editing: TRow | null) => ReactNode;
};

/**
 * 需求页页壳（物流服务 / IT服务 / 资产交易 / 营销服务共用）：
 * 页头 + 页签路由 + 需求信息面板（地域筛选 + 统一表头 + 操作列）+ 新增/修改弹窗 + 需求消息弹窗。
 * 行类型、表头映射、文案与表单字段由页面传入 —— 页壳内不含模块专有名词。
 */
export function DemandPage<TRow extends DemandPageRow>({
  hero,
  tabs,
  activeTab,
  onTabChange,
  board,
  toDemand,
  demand,
  demandTabKey = "requests",
  serviceTab,
  providersTab,
  formBody,
}: DemandPageProps<TRow>) {
  return (
    // 按钮文案与 demo 逐字一致：关闭 antd 对 2 个汉字按钮自动插入空格的行为
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title={hero.title}
        desc={hero.desc}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={onTabChange}
      />

      {activeTab === "services" && serviceTab != null ? (
        serviceTab
      ) : activeTab === "providers" && providersTab != null ? (
        providersTab
      ) : activeTab === demandTabKey ? (
        <>
          {board.error&&<Alert type="error" title={board.error.message} />}
          <Panel
            title={demand.panelTitle}
            titleBadge={`已加载 ${board.rows.length} 条`}
            extra={
              demand.canPost ? (
                <Button type="primary" onClick={board.openCreate}>
                  ＋ {demand.createLabel}
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
              <Table<TRow>
                rowKey="id"
                loading={board.loading}
                dataSource={board.rows}
                pagination={false}
                size="middle"
                scroll={{ x: "max-content" }}
                locale={{
                  emptyText: (
                    <EmptyState
                      icon={demand.emptyIcon}
                      text={demand.emptyText}
                    />
                  ),
                }}
                columns={[
                  ...demandColumns<TRow>(toDemand),
                  demandActionsColumn<TRow>({
                    canReply: demand.canReply,
                    canView: demand.canView,
                    canManage: demand.canManage,
                    conversationCount: (row) => row.conversationCount,
                    openChannel: board.openChannel,
                    openEdit: board.openEdit,
                    removeRow: board.removeRow,
                  }),
                ]}
              />
            </div>
            {board.hasMore ? <Button loading={board.loadingMore} onClick={() => {void board.loadMore();}}>加载更多</Button> : null}
          </Panel>

          <Modal
            open={board.createOpen}
            title={
              board.editing
                ? demand.editTitle(board.editing)
                : demand.createLabel
            }
            width={demand.formWidth ?? 720}
            confirmLoading={board.submitting}
            onCancel={board.closeCreate}
            okText={board.editing ? "保存修改" : "发布需求"}
            onOk={() => void board.save()}
          >
            <Form
              form={board.form}
              layout="vertical"
              initialValues={{ email_sync: "0" }}
            >
              {formBody(board.editing)}
            </Form>
          </Modal>

          <DemandChannelModal
            board={board}
            description={demand.channelDescription}
          />
        </>
      ) : null}

      {board.passwordModal}
    </ConfigProvider>
  );
}
