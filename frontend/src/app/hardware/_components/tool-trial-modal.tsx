"use client";

import { ExperimentOutlined } from "@ant-design/icons";
import { App, Button, Input, Modal, Select, Space, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  HW_DEVICE_STATUS_LABELS,
  type HwDevice,
  type HwTool,
  type HwToolCallResult,
} from "@enterprise/contracts";
import { hardwareApi } from "@/api/hardware";
import { Notice } from "@/components/ui/panel";

/** 硬件工具站内试调：选本人该型号设备 + 填参数，当场触发一次（source=trial，不受未授权层拦）。 */
export function ToolTrialModal({
  tool,
  onClose,
}: {
  tool: HwTool | null;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [devices, setDevices] = useState<HwDevice[]>([]);
  const [deviceId, setDeviceId] = useState<number | undefined>(undefined);
  const [argsText, setArgsText] = useState("{}");
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<HwToolCallResult | null>(null);
  const [error, setError] = useState("");

  const loadDevices = useCallback(async () => {
    if (!tool) return;
    setLoadingDevices(true);
    try {
      const data = await hardwareApi.devices({ query: { modelId: String(tool.modelId) } });
      const list = data?.devices ?? [];
      setDevices(list);
      setDeviceId(list.find((item) => item.status === "ONLINE")?.id ?? list[0]?.id);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "设备加载失败");
    } finally {
      setLoadingDevices(false);
    }
  }, [tool, message]);

  useEffect(() => {
    setResult(null);
    setError("");
    setArgsText("{}");
    setDeviceId(undefined);
    void loadDevices();
  }, [loadDevices]);

  const run = async () => {
    if (!tool) return;
    if (!deviceId) {
      message.warning("请先选择一台该型号的设备");
      return;
    }
    let args: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(argsText || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("必须是对象");
      args = parsed as Record<string, unknown>;
    } catch {
      message.warning("参数 JSON 格式不正确，应是一个对象");
      return;
    }
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const data = await hardwareApi.toolTrial({
        params: { id: String(tool.id) },
        body: { deviceId, args },
      });
      if (!data) throw new Error("试调返回为空");
      setResult(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "试调失败");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      open={Boolean(tool)}
      title={tool ? `试调工具 · ${tool.name}` : "试调工具"}
      width={640}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>关闭</Button>,
        <Button key="run" type="primary" icon={<ExperimentOutlined aria-hidden />} loading={running} onClick={() => void run()}>
          调用一次
        </Button>,
      ]}
      destroyOnHidden
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        {tool ? (
          <Space size={6} wrap>
            <span className="mono text-12">{tool.toolName}</span>
            <Tag>{tool.transport === "HTTP" ? "设备直连" : "指令下发"}</Tag>
            {tool.write ? <Tag color="orange">写动作</Tag> : <Tag color="green">只读</Tag>}
          </Space>
        ) : null}
        <div>
          <div className="text-12 muted" style={{ marginBottom: 4 }}>目标设备（本人该型号设备）</div>
          <Select
            style={{ width: "100%" }}
            loading={loadingDevices}
            value={deviceId}
            placeholder={devices.length ? "选择设备" : "该型号还没有接入设备"}
            onChange={setDeviceId}
            options={devices.map((item) => ({
              value: item.id,
              label: `${item.name}（${HW_DEVICE_STATUS_LABELS[item.status]}）`,
            }))}
          />
        </div>
        <div>
          <div className="text-12 muted" style={{ marginBottom: 4 }}>参数（JSON 对象，对应工具的 params Schema）</div>
          <Input.TextArea
            rows={5}
            className="mono"
            value={argsText}
            onChange={(event) => setArgsText(event.target.value)}
          />
        </div>
        {error ? <Notice variant="error">{error}</Notice> : null}
        {result ? (
          <div
            style={{
              background: "var(--bg-muted)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "12px 14px",
            }}
          >
            <Space size={8} wrap>
              <Tag color={result.ok ? "green" : "red"}>{result.ok ? "成功" : "失败"}</Tag>
              {result.status ? <span className="text-12 muted">HTTP {result.status}</span> : null}
              <span className="text-12 muted">{result.latencyMs} ms</span>
              {result.reason ? <span className="mono text-12">{result.reason}</span> : null}
            </Space>
            {result.message ? <div className="text-12" style={{ marginTop: 6 }}>{result.message}</div> : null}
            {result.response !== null && result.response !== undefined ? (
              <pre
                className="mono"
                style={{
                  margin: "8px 0 0",
                  padding: "8px 10px",
                  fontSize: 11,
                  lineHeight: 1.6,
                  maxHeight: 220,
                  overflow: "auto",
                  color: "var(--text-2)",
                  background: "var(--bg-body, #fff)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                }}
              >
                {JSON.stringify(result.response, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}
        <Notice variant="info">
          试调由本人当场触发，会真实下发到设备并留一条事件流水；设备离线时会被拒绝。写动作的「未授权 / 无人值守只出草案」约束作用于 MCP / 对外 API / 站内 Agent，不影响本人试调。
        </Notice>
      </Space>
    </Modal>
  );
}