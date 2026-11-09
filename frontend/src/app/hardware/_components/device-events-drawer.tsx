"use client";

import { App, Drawer, Skeleton, Space, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  HW_DEVICE_EVENT_KINDS,
  HW_DEVICE_EVENT_KIND_LABELS,
  type HwDevice,
  type HwDeviceEvent,
  type HwDeviceEventKind,
} from "@enterprise/contracts";
import { hardwareApi } from "@/api/hardware";
import { EmptyState, Notice, PillTabs } from "@/components/ui/panel";

const KIND_COLOR: Record<HwDeviceEventKind, string> = {
  HEARTBEAT: "blue",
  COMMAND: "purple",
  RESULT: "green",
  STATUS: "orange",
};

/** 设备事件流水：心跳 / 指令下发 / 设备回执 / 状态变更，最近 100 条。 */
export function DeviceEventsDrawer({
  device,
  onClose,
}: {
  device: HwDevice | null;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [events, setEvents] = useState<HwDeviceEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [kind, setKind] = useState("ALL");

  const load = useCallback(async () => {
    if (!device) return;
    setLoading(true);
    setError("");
    try {
      const data = await hardwareApi.deviceEvents({
        params: { id: String(device.id) },
        query: { kind: kind === "ALL" ? "" : kind },
      });
      setEvents(data?.events ?? []);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "事件流水加载失败";
      setError(text);
      message.error(text);
    } finally {
      setLoading(false);
    }
  }, [device, kind, message]);

  useEffect(() => {
    setEvents([]);
    setKind("ALL");
  }, [device]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Drawer
      open={Boolean(device)}
      onClose={onClose}
      size={680}
      title={device ? `事件流水 · ${device.name}` : "事件流水"}
      destroyOnHidden
    >
      <PillTabs
        value={kind}
        onChange={setKind}
        variant="soft"
        style={{ marginBottom: 12 }}
        items={[
          { key: "ALL", label: "全部" },
          ...HW_DEVICE_EVENT_KINDS.map((item) => ({
            key: item,
            label: HW_DEVICE_EVENT_KIND_LABELS[item],
          })),
        ]}
      />
      {error ? <Notice variant="error">{error}</Notice> : null}
      {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
      {!loading && !error && !events.length ? (
        <EmptyState text="暂无事件；设备烧录固件并上报心跳后，这里会留痕。" />
      ) : null}
      {!loading && !error && events.length ? (
        <Space orientation="vertical" size={10} style={{ width: "100%" }}>
          {events.map((event) => (
            <div key={event.id} className="card" style={{ padding: 12 }}>
              <Space size={6} wrap>
                <Tag color={KIND_COLOR[event.kind]}>{HW_DEVICE_EVENT_KIND_LABELS[event.kind]}</Tag>
                <Tag>{event.direction === "IN" ? "上行" : "下行"}</Tag>
                {event.commandCode ? <span className="mono text-12">{event.commandCode}</span> : null}
                <Tag color={event.ok ? "green" : "red"}>{event.ok ? "成功" : "失败"}</Tag>
                {event.latencyMs ? <span className="text-12 muted">{event.latencyMs} ms</span> : null}
              </Space>
              {event.message ? (
                <div className="text-12" style={{ marginTop: 6 }}>{event.message}</div>
              ) : null}
              <div className="text-12 muted" style={{ marginTop: 6 }}>
                {new Date(event.createdAt).toLocaleString()}
              </div>
              {Object.keys(event.payload ?? {}).length ? (
                <pre
                  className="mono"
                  style={{
                    margin: "8px 0 0",
                    padding: "8px 10px",
                    fontSize: 11,
                    lineHeight: 1.6,
                    maxHeight: 160,
                    overflow: "auto",
                    color: "var(--text-2)",
                    background: "var(--bg-muted)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                  }}
                >
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              ) : null}
            </div>
          ))}
        </Space>
      ) : null}
    </Drawer>
  );
}