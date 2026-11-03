"use client";

import { App, Button, Input, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { useEffect, useState } from "react";
import type { OkrScoreView } from "@enterprise/contracts";
import { okrApi } from "@/api/okr";
import { Panel, StatCard, StatGrid } from "@/components/ui/panel";
import { fmtDateTime } from "@/lib/datetime";
import {
  ProgressBar,
  Toolbar,
  cycleName,
  okrError,
  type OkrContextData,
} from "./okr-common";

type StatsData = NonNullable<Awaited<ReturnType<typeof okrApi.stats>>>;
type ScoresData = Awaited<ReturnType<typeof okrApi.scores>>;

export function OkrStatsTab({ ctx }: { ctx: OkrContextData }) {
  const { message } = App.useApp();
  const canManage = ctx.isOwner || ctx.isManager;
  const cycleId = ctx.cycle?.id || 0;

  const [stats, setStats] = useState<StatsData | null>(null);
  const [scores, setScores] = useState<ScoresData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const [scoreOpen, setScoreOpen] = useState(false);
  const [scoreTarget, setScoreTarget] = useState<string>("");
  const [scoreValues, setScoreValues] = useState<Record<string, number>>({});
  const [scoreComment, setScoreComment] = useState("");
  const [scoreBusy, setScoreBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const query = { cycleId: cycleId || undefined };
      const [statsData, scoreData] = await Promise.all([
        okrApi.stats({ query }),
        okrApi.scores({ query: { cycleId: cycleId || undefined, scope: "ALL" } }),
      ]);
      setStats(statsData);
      setScores(scoreData);
      setError("");
    } catch (err) {
      setError(okrError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleId]);

  const download = async () => {
    setExporting(true);
    try {
      const result = await okrApi.exportData({
        query: { cycleId: cycleId || undefined },
      });
      if (!result) throw new Error("导出失败");
      const blob = new Blob([result.content], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      message.success(`已导出 ${result.rows} 行`);
    } catch (err) {
      message.error(okrError(err));
    } finally {
      setExporting(false);
    }
  };

  const openScore = (memberUserId: string) => {
    const existing = scores?.items.find(
      (item) => item.memberUserId === memberUserId,
    );
    const next: Record<string, number> = {};
    for (const dim of scores?.dimensions || []) {
      next[dim.key] =
        existing?.scores.find((item) => item.key === dim.key)?.score ?? 3;
    }
    setScoreTarget(memberUserId);
    setScoreValues(next);
    setScoreComment(existing?.comment || "");
    setScoreOpen(true);
  };

  const saveScore = async (submit: boolean) => {
    if (!scores || !scoreTarget) return;
    const items = scores.dimensions.map((dim) => ({
      key: dim.key,
      label: dim.label,
      score: Math.round(scoreValues[dim.key] || 0),
      weight: dim.weight,
    }));
    if (items.some((item) => !Number.isInteger(item.score) || item.score < 1 || item.score > 5)) {
      message.warning("每项评分请填写 1~5 的整数");
      return;
    }
    setScoreBusy(true);
    try {
      await okrApi.saveScore({
        body: {
          cycleId: scores.cycleId,
          memberUserId: scoreTarget,
          scores: items,
          comment: scoreComment,
          submit,
        },
      });
      message.success(submit ? "评分已提交" : "评分草稿已保存");
      setScoreOpen(false);
      await load();
    } catch (err) {
      message.error(okrError(err));
    } finally {
      setScoreBusy(false);
    }
  };

  const withdrawScore = async (row: OkrScoreView) => {
    try {
      await okrApi.withdrawScore({ params: { id: String(row.id) } });
      message.success("已撤回为草稿，可重新打分");
      await load();
    } catch (err) {
      message.error(okrError(err));
    }
  };

  const cycleReady =
    ctx.cycle?.status === "REVIEW" || ctx.cycle?.status === "CLOSED";
  const targetName =
    scores?.candidates.find((item) => item.memberUserId === scoreTarget)?.name ||
    scoreTarget;

  return (
    <>
      <Panel
        title="周期总览"
        titleExtra={
          <span className="muted text-12">{cycleName(ctx.cycle)}</span>
        }
        extra={
          canManage ? (
            <Button loading={exporting} onClick={() => void download()}>
              导出 CSV
            </Button>
          ) : null
        }
      >
        {error ? (
          <div className="muted" style={{ marginBottom: 8 }}>
            {error}
            <Button type="link" size="small" onClick={() => void load()}>
              重试
            </Button>
          </div>
        ) : null}
        <StatGrid>
          <StatCard label="整体完成度" value={`${Math.round(stats?.completion || 0)}%`} hint="按 KR 进度加权" />
          <StatCard label="目标数" value={stats?.objectiveCount ?? 0} />
          <StatCard label="关键结果数" value={stats?.krCount ?? 0} />
          <StatCard
            label="已评分成员"
            value={scores?.averages.filter((item) => item.reviewers > 0).length ?? 0}
            hint="本周期至少收到一条评分"
          />
        </StatGrid>
      </Panel>

      <Panel title="成员排行">
        <Table
          size="small"
          rowKey="memberUserId"
          loading={loading}
          pagination={false}
          dataSource={stats?.memberRanking || []}
          locale={{ emptyText: "本周期还没有目标或汇报" }}
          columns={[
            {
              title: "成员",
              dataIndex: "memberName",
              render: (value: string, row: StatsData["memberRanking"][number]) => (
                <div>
                  <div>{value || "账号所有者"}</div>
                  {row.department ? (
                    <div className="muted text-12">{row.department}</div>
                  ) : null}
                </div>
              ),
            },
            { title: "目标", dataIndex: "objectives", width: 80 },
            {
              title: "进度",
              dataIndex: "progress",
              width: 200,
              render: (value: number) => <ProgressBar value={value} />,
            },
            { title: "汇报", dataIndex: "reports", width: 80 },
            {
              title: "平均评分",
              dataIndex: "avgScore",
              width: 100,
              render: (value: number) => (value > 0 ? `${value.toFixed(1)} 分` : "—"),
            },
          ]}
        />
      </Panel>

      <Panel title="KR 进展趋势" titleExtra={<span className="muted text-12">按进展记录逐日归集</span>}>
        {stats?.krTrend.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {stats.krTrend.map((item) => (
              <div key={item.date} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span className="muted text-12" style={{ width: 90 }}>
                  {item.date}
                </span>
                <div style={{ flex: 1, maxWidth: 320 }}>
                  <ProgressBar value={item.progress} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">本周期还没有进展记录</div>
        )}
      </Panel>

      <Panel title="复盘摘要">
        {stats?.summary.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {stats.summary.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        ) : (
          <div className="muted">本周期还没有可汇总的数据</div>
        )}
      </Panel>

      <Panel
        title="周期评分"
        titleExtra={
          <span className="muted text-12">
            {cycleReady
              ? "周期进入复盘或关闭后可评分；每项 1~5 分，按设置里的维度权重合计"
              : "周期进入「复盘」或「关闭」后才能打分"}
          </span>
        }
        extra={
          canManage ? (
            <Toolbar>
              <Select
                style={{ minWidth: 200 }}
                placeholder="选择被评人"
                disabled={!cycleReady || !scores?.candidates.length}
                value={undefined}
                onChange={(value: string) => openScore(value)}
                options={(scores?.candidates || []).map((item) => ({
                  value: item.memberUserId,
                  label: `${item.name || item.memberUserId}${
                    item.department ? ` · ${item.department}` : ""
                  }`,
                }))}
              />
            </Toolbar>
          ) : null
        }
      >
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          pagination={false}
          dataSource={scores?.items || []}
          locale={{ emptyText: "还没有评分记录" }}
          columns={[
            { title: "被评人", dataIndex: "memberName", render: (v: string) => v || "账号所有者" },
            { title: "评分人", dataIndex: "reviewerName", render: (v: string) => v || "—" },
            {
              title: "维度分",
              render: (_: unknown, row: OkrScoreView) => (
                <Space size={4} wrap>
                  {row.scores.map((item) => (
                    <Tag key={item.key}>{`${item.label || item.key} ${item.score}`}</Tag>
                  ))}
                </Space>
              ),
            },
            { title: "合计", dataIndex: "total", width: 80 },
            {
              title: "状态",
              dataIndex: "status",
              width: 90,
              render: (value: string) => (
                <Tag color={value === "SUBMITTED" ? "green" : "gold"}>
                  {value === "SUBMITTED" ? "已提交" : "草稿"}
                </Tag>
              ),
            },
            {
              title: "提交时间",
              dataIndex: "submittedAt",
              width: 160,
              render: (value: string) => (value ? fmtDateTime(value) : "—"),
            },
            {
              title: "操作",
              width: 150,
              render: (_: unknown, row: OkrScoreView) => (
                <Space size={4}>
                  {row.status === "DRAFT" && canManage ? (
                    <Button type="link" size="small" onClick={() => openScore(row.memberUserId)}>
                      编辑
                    </Button>
                  ) : null}
                  {row.status === "SUBMITTED" && ctx.isOwner ? (
                    <Button type="link" size="small" onClick={() => void withdrawScore(row)}>
                      撤回重打
                    </Button>
                  ) : null}
                </Space>
              ),
            },
          ]}
        />

        {scores?.averages.length ? (
          <div style={{ marginTop: 12 }}>
            <div className="muted text-12" style={{ marginBottom: 6 }}>
              平均分（只统计已提交）
            </div>
            <Table
              size="small"
              rowKey="memberUserId"
              pagination={false}
              dataSource={scores.averages}
              columns={[
                { title: "成员", dataIndex: "memberName", render: (v: string) => v || "账号所有者" },
                {
                  title: "平均分",
                  dataIndex: "average",
                  width: 100,
                  render: (value: number) => (value > 0 ? `${value.toFixed(1)} 分` : "—"),
                },
                { title: "评分人数", dataIndex: "reviewers", width: 100 },
              ]}
            />
          </div>
        ) : null}
      </Panel>

      <Modal
        title={`评分 · ${targetName}`}
        open={scoreOpen}
        onCancel={() => setScoreOpen(false)}
        width={560}
        destroyOnClose
        footer={
          <Space>
            <Button onClick={() => setScoreOpen(false)}>取消</Button>
            <Button loading={scoreBusy} onClick={() => void saveScore(false)}>
              保存草稿
            </Button>
            <Button type="primary" loading={scoreBusy} onClick={() => void saveScore(true)}>
              提交评分
            </Button>
          </Space>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(scores?.dimensions || []).map((dim) => (
            <div key={dim.key} style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ flex: 1 }}>
                {dim.label || dim.key}
                <span className="muted text-12">{` · 权重 ${dim.weight}`}</span>
              </span>
              <InputNumber
                min={1}
                max={5}
                precision={0}
                value={scoreValues[dim.key] ?? 3}
                onChange={(value) =>
                  setScoreValues((prev) => ({ ...prev, [dim.key]: Number(value) || 0 }))
                }
              />
            </div>
          ))}
          <Input.TextArea
            rows={3}
            maxLength={500}
            showCount
            value={scoreComment}
            placeholder="评语（可选）"
            onChange={(event) => setScoreComment(event.target.value)}
          />
        </div>
      </Modal>
    </>
  );
}
