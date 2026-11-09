"use client";

import { useCallback, useEffect, useState } from "react";
import { App, Button, InputNumber, Space, Spin, Tag } from "antd";
import { CloudDownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import { Notice, Panel } from "@/components/ui/panel";
import { storageApi, type StorageMigrationResult, type StorageOverview } from "@/api/storage";
import { fmtTime } from "@/lib/datetime";

function fmtMb(mb: number) {
  if (!mb) return "0 MB";
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(2)} MB`;
}

/**
 * 存储台账与存量迁移（积分/OSS 方案 §2）：新写入全部走本站 OSS；
 * 历史 AIPDD 托管资产按批迁移，失败项保留原状，从头重跑即可再试。
 */
export function StorageLedgerPanel() {
  const { message } = App.useApp();
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [limit, setLimit] = useState(20);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<StorageMigrationResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOverview(await storageApi.overview());
      setError("");
    } catch (caught) {
      setError((caught as Error).message || "存储台账读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const migrate = async (cursor = 0) => {
    setRunning(true);
    try {
      const result = await storageApi.migrate({ body: { limit, cursor } });
      setLastRun(result);
      if (result) {
        message.success(
          `本批 ${result.processed} 条：成功 ${result.migrated}，失败 ${result.failed}，剩余 ${result.remaining}`,
        );
      }
      await load();
    } catch (caught) {
      message.error((caught as Error).message || "迁移失败");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Panel
      title="存储台账与存量迁移"
      titleBadge={<span className="text-12 muted">本站 OSS 唯一底座</span>}
      extra={
        <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void load()} loading={loading}>
          刷新
        </Button>
      }
    >
      <Notice variant="info">
        数字资产、AI 产物与附件字节统一存本站 OSS；历史 AIPDD 托管资产可在下方按批迁回。
        外联流量本期只观测不计费，存储按台账占用每日快照出账。
      </Notice>
      {loading && !overview ? (
        <Spin style={{ marginTop: 16 }} />
      ) : error ? (
        <Notice variant="error">{error}</Notice>
      ) : overview ? (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 12,
              margin: "16px 0",
            }}
          >
            {[
              ["资产总数", `${overview.totalAssets} 条`],
              ["本站 OSS", `${overview.localAssets} 条`],
              ["待迁移（AIPDD）", `${overview.legacyAssets} 条`],
              ["累计迁移", `${overview.migratedAssets} 条`],
              ["台账占用", fmtMb(overview.storageMb)],
              [
                "最近快照",
                overview.lastSnapshot
                  ? `${fmtTime(overview.lastSnapshot.at)} · ${fmtMb(
                      overview.lastSnapshot.bytes / 1024 / 1024,
                    )}`
                  : "尚未出账",
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{
                  border: "1px solid var(--line, #f0f0f0)",
                  borderRadius: 10,
                  padding: "10px 12px",
                }}
              >
                <div className="text-12 muted">{label}</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div>
              </div>
            ))}
          </div>

          <div className="text-12 muted" style={{ marginBottom: 10 }}>
            存储计费：
            {overview.pricing
              ? overview.pricing.enabled
                ? `${overview.pricing.unitPriceAmount} 积分 / ${overview.pricing.unit || "gb_day"}`
                : "已停用（模块免费）"
              : "未配置价目"}
          </div>

          <Space wrap>
            <span className="text-12 muted">每批条数</span>
            <InputNumber
              min={1}
              max={100}
              value={limit}
              onChange={(value) => setLimit(Number(value) || 20)}
              style={{ width: 100 }}
            />
            <Button
              type="primary"
              icon={<CloudDownloadOutlined aria-hidden />}
              loading={running}
              disabled={!overview.legacyAssets}
              onClick={() => void migrate(0)}
            >
              迁移一批
            </Button>
            <Button
              loading={running}
              disabled={!lastRun || !lastRun.failed}
              onClick={() => void migrate(0)}
            >
              从头重试失败项
            </Button>
          </Space>

          {lastRun ? (
            <div style={{ marginTop: 14 }}>
              <div className="text-12 muted">
                本批结果：成功 {lastRun.migrated} · 失败 {lastRun.failed} · 游标{" "}
                {lastRun.nextCursor} · 剩余 {lastRun.remaining}
              </div>
              {lastRun.results.length ? (
                <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                  {lastRun.results.map((item) => (
                    <div key={`${item.id}-${item.name}`} className="text-12">
                      <Tag color={item.status === "migrated" ? "green" : "red"}>
                        {item.status === "migrated" ? "成功" : "失败"}
                      </Tag>
                      <span className="mono">#{item.id}</span> {item.name || "未命名"}
                      {item.reason ? <span className="muted"> · {item.reason}</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </Panel>
  );
}
