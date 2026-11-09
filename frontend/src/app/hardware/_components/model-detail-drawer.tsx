"use client";

import { CloudDownloadOutlined, PlusOutlined } from "@ant-design/icons";
import { App, Button, Drawer, Skeleton, Space, Tag } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  HW_DEVICE_STATUS_LABELS,
  HW_KIT_CHANNEL_LABELS,
  type HwDeviceStatus,
  type HwKit,
  type HwModelDetail,
} from "@enterprise/contracts";
import { hardwareApi } from "@/api/hardware";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";

const STATUS_COLOR: Record<HwDeviceStatus, string> = {
  ONLINE: "green",
  OFFLINE: "orange",
  NEVER: "default",
};

function formatSize(bytes: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function specValue(value: unknown) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** 硬件广场·型号详情：规格 + 开发包下载 + 本人已接入设备。 */
export function ModelDetailDrawer({
  code,
  onClose,
}: {
  code: string | null;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [detail, setDetail] = useState<HwModelDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(0);

  const load = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    setError("");
    try {
      const data = await hardwareApi.model({ params: { code } });
      if (!data) throw new Error("型号详情返回为空");
      setDetail(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "型号详情加载失败");
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    setDetail(null);
    void load();
  }, [load]);

  const download = async (kit: HwKit) => {
    setDownloading(kit.id);
    try {
      const result = await hardwareApi.kitDownload({ params: { id: String(kit.id) } });
      if (!result?.url) throw new Error("下载地址为空");
      const anchor = document.createElement("a");
      anchor.href = result.url;
      anchor.download = result.fileName;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.click();
      message.success("已开始下载，可用 SHA-256 校验文件完整性");
      void load();
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "下载失败");
    } finally {
      setDownloading(0);
    }
  };

  const specEntries = Object.entries(detail?.spec ?? {});

  return (
    <Drawer
      open={Boolean(code)}
      onClose={onClose}
      size={680}
      title={detail ? detail.name : "型号详情"}
      destroyOnHidden
    >
      {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
      {error ? <Notice variant="error">{error}</Notice> : null}
      {!loading && !error && detail ? (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <div>
            {detail.coverUrl ? (
              <RawImg
                src={detail.coverUrl}
                alt={detail.name}
                style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 8, marginBottom: 12 }}
              />
            ) : null}
            <Space size={6} wrap>
              <span className="mono text-12 muted">{detail.code}</span>
              {detail.vendor ? <Tag>{detail.vendor}</Tag> : null}
              {detail.chip ? <Tag color="blue">{detail.chip}</Tag> : null}
              {detail.category ? <Tag>{detail.category}</Tag> : null}
              {detail.featured ? <Tag color="gold">推荐</Tag> : null}
            </Space>
            {detail.summary ? (
              <p className="muted" style={{ marginTop: 8 }}>{detail.summary}</p>
            ) : null}
          </div>

          {specEntries.length ? (
            <Panel title="规格">
              <div className="form-2col">
                {specEntries.map(([key, value]) => (
                  <div key={key}>
                    <div className="text-12 muted" style={{ marginBottom: 2 }}>{key}</div>
                    <div className="text-12 mono" style={{ wordBreak: "break-all" }}>{specValue(value)}</div>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          <Panel
            title="开发包"
            titleExtra={<span className="text-12 muted">SDK / 固件，下载量实时计数</span>}
          >
            {detail.kits.length ? (
              <Space orientation="vertical" size={10} style={{ width: "100%" }}>
                {detail.kits.map((kit) => (
                  <div
                    key={kit.id}
                    className="card"
                    style={{ padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <Space size={6} wrap>
                        <span className="mono" style={{ fontWeight: 600 }}>{kit.version}</span>
                        <Tag color={kit.channel === "STABLE" ? "green" : "orange"}>
                          {HW_KIT_CHANNEL_LABELS[kit.channel]}
                        </Tag>
                        <span className="text-12 muted">{formatSize(kit.fileSize)} · 下载 {kit.downloadCount}</span>
                      </Space>
                      {kit.changelog ? (
                        <div className="text-12 muted" style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{kit.changelog}</div>
                      ) : null}
                      {kit.sha256 ? (
                        <div className="text-12 muted mono" style={{ marginTop: 4, wordBreak: "break-all" }}>SHA-256 {kit.sha256}</div>
                      ) : null}
                      {kit.docUrl ? (
                        <a className="text-12" href={kit.docUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 4 }}>
                          接入文档
                        </a>
                      ) : null}
                    </div>
                    <Button
                      type="primary"
                      icon={<CloudDownloadOutlined aria-hidden />}
                      loading={downloading === kit.id}
                      onClick={() => void download(kit)}
                    >
                      下载
                    </Button>
                  </div>
                ))}
              </Space>
            ) : (
              <EmptyState text="该型号暂未上架开发包，请联系管理员。" />
            )}
          </Panel>

          <Panel
            title="我的设备"
            titleExtra={<span className="text-12 muted">本人已接入的该型号设备</span>}
            extra={
              <Link href="/hardware/devices">
                <Button size="small" icon={<PlusOutlined aria-hidden />}>去添加</Button>
              </Link>
            }
          >
            {detail.devices.length ? (
              <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                {detail.devices.map((device) => (
                  <div key={device.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <Space size={8}>
                      <span>{device.name}</span>
                      <Tag color={STATUS_COLOR[device.status]}>{HW_DEVICE_STATUS_LABELS[device.status]}</Tag>
                    </Space>
                    <span className="text-12 muted">
                      {device.lastSeenAt ? `最近心跳 ${new Date(device.lastSeenAt).toLocaleString()}` : "尚未激活"}
                    </span>
                  </div>
                ))}
              </Space>
            ) : (
              <EmptyState text="还没有接入该型号的设备；下载开发包烧录后，到「添加硬件」生成设备令牌。" />
            )}
          </Panel>
        </Space>
      ) : null}
    </Drawer>
  );
}