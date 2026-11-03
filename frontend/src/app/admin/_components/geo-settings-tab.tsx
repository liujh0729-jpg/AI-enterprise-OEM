"use client";
import { BarChartOutlined } from "@ant-design/icons";
import { Button, Space, Table } from "antd";
import { Notice, Panel, StatCard, StatGrid } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import { useAdminGeoCollectionStats } from "@/query/admin";
import {
  collectStatusBadge,
  collectStatusLabel,
  formatWindow,
  type GeoCollectStats,
} from "@/app/marketing-tools/_components/geo-common";

/**
 * GEO管理设置（平台管理后台）：只监管每周采集任务量（自动采集管线本周计划量与实际完成量，含逐项目明细）。
 * 采集平台的 API Key 由每个账号在「营销工具 → GEO-AI引擎优化」里配自己的，后台看不到、也不能替别人配置。
 * 后端：GET /enterprise/admin/geo-collection/stats。
 */
export function GeoSettingsTab() {
  return <GeoCollectRunsView />;
}

/**
 * 每周采集任务量（本周）：自动采集管线本周「计划完成 / 实际完成」与逐项目明细。
 * GET /enterprise/admin/geo-collection/stats：本周（周日起算）已排期任务的汇总；
 * 采集中每 30 秒自动刷新进度。
 */
function GeoCollectRunsView() {
  const query = useAdminGeoCollectionStats();
  const data = query.data;
  const loading = query.isFetching;
  const reload = query.refetch;
  const runs = data?.runs ?? [];
  const totals = data?.totals;
  const rate =
    totals && totals.planned > 0
      ? `${Math.round((totals.done / totals.planned) * 100)}%`
      : "—";

  const running = runs.some((row) => row.status === "RUNNING");

  return (
    <Panel
      title={`每周采集任务量 · ${data?.weekLabel || "本周"}`}
      titleBadge={
        <span className="badge badge-blue">
          {`窗口 ${formatWindow(data?.windowStart, data?.windowEnd)}${data?.inWindow ? "（进行中）" : ""}`}
        </span>
      }
      extra={
        <Space size={8}>
          <span className="text-12 muted">
            {running
              ? "有任务正在采集，每 30 秒自动刷新"
              : "每周日 02:00–06:00 启动，未完成顺延至次日同窗口"}
          </span>
          <Button loading={loading} onClick={() => void reload()}>
            刷新
          </Button>
        </Space>
      }
    >
      {query.error ? (
        <Notice variant="error">{query.error.message}</Notice>
      ) : null}
      <Notice variant="info">
        用户在「营销工具 → <BarChartOutlined aria-hidden /> GEO-AI引擎优化 →
        采集批次」开启自动采集后，系统每周日 02:00–06:00 按「启用中的监控问题 ×
        可用平台」逐条向 AI 平台提问并自动记录观测（真实数据）；
        本周日没跑完的顺延到次日同一窗口（周一至周六
        02:00–06:00），周六仍未跑完则本期收口、下期重排。 单条最多重试 3
        次；平台缺 Key / 缺模型的不进本期计划（见明细「说明」列）。
      </Notice>

      <StatGrid>
        <StatCard
          label="本周项目"
          value={`${totals?.projects ?? 0} 个`}
          hint="本期已排期的自动采集项目"
        />
        <StatCard
          label="本周计划"
          value={`${totals?.planned ?? 0} 条`}
          hint="问题 × 平台 观测条数"
        />
        <StatCard
          label="实际完成"
          value={`${totals?.done ?? 0} 条`}
          hint={`完成度 ${rate}`}
        />
        <StatCard
          label="失败"
          value={`${totals?.failed ?? 0} 条`}
          hint="单条重试 3 次仍失败"
        />
        <StatCard
          label="待采集"
          value={`${totals?.pending ?? 0} 条`}
          hint="顺延到下一窗口继续"
        />
      </StatGrid>

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <Table<GeoCollectStats["runs"][number]>
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={runs}
          pagination={false}
          scroll={{ x: "max-content" }}
          locale={{
            emptyText: (
              <div className="text-12 muted" style={{ padding: "18px 0" }}>
                本周尚无采集任务：需要用户先开启自动采集，且项目要有启用中的监控问题与可用平台。
              </div>
            ),
          }}
          columns={[
            {
              title: "品牌项目",
              width: 220,
              render: (_, row) => (
                <div>
                  <div style={{ fontWeight: 600 }}>{row.brand}</div>
                  <div className="text-12 muted" style={{ marginTop: 4 }}>
                    {row.industry || "未填行业"}
                  </div>
                </div>
              ),
            },
            {
              title: "自动采集",
              width: 100,
              render: (_, row) => (
                <span
                  className={`badge ${row.enabled ? "badge-green" : "badge-gray"}`}
                >
                  {row.enabled ? "已开启" : "已关闭"}
                </span>
              ),
            },
            { title: "期次", dataIndex: "periodLabel", width: 110 },
            {
              title: "状态",
              dataIndex: "status",
              width: 130,
              render: (value: string, row) => (
                <div>
                  <span className={`badge ${collectStatusBadge(value)}`}>
                    {collectStatusLabel(value)}
                  </span>
                  {row.deferred ? (
                    <div className="text-12 muted" style={{ marginTop: 4 }}>
                      顺延下一窗口
                    </div>
                  ) : null}
                </div>
              ),
            },
            { title: "计划", dataIndex: "planned", width: 80 },
            { title: "已完成", dataIndex: "done", width: 90 },
            { title: "失败", dataIndex: "failed", width: 80 },
            { title: "待采集", dataIndex: "pending", width: 90 },
            {
              title: "执行窗口",
              width: 200,
              render: (_, row) => (
                <div className="text-12">
                  <div>{formatWindow(row.windowStart, row.windowEnd)}</div>
                  <div className="muted" style={{ marginTop: 4 }}>
                    {row.startedAt
                      ? `开始 ${fmtTime(row.startedAt)}`
                      : "尚未开始"}
                    {row.finishedAt ? ` · 结束 ${fmtTime(row.finishedAt)}` : ""}
                  </div>
                </div>
              ),
            },
            {
              title: "观测批次",
              width: 110,
              render: (_, row) =>
                row.batchId ? (
                  <span className="mono text-12">#{row.batchId}</span>
                ) : (
                  <span className="text-12 muted">未生成</span>
                ),
            },
            {
              title: "说明",
              dataIndex: "lastError",
              width: 260,
              render: (value: string) => (
                <span className="text-12 muted">{value || "—"}</span>
              ),
            },
          ]}
        />
      </div>
    </Panel>
  );
}
