"use client";

import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  HistoryOutlined,
  KeyOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Drawer,
  Input,
  Modal,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  HW_DEVICE_STATUS_LABELS,
  HW_DEVICE_TOKEN_HEADER,
  HW_OFFLINE_AFTER_SECONDS,
  type HwDevice,
  type HwDeviceStatus,
  type HwModel,
} from "@enterprise/contracts";
import { hardwareApi } from "@/api/hardware";
import Link from "next/link";
import {
  EmptyState,
  Notice,
  PageHero,
  Panel,
  StatCard,
  StatGrid,
} from "@/components/ui/panel";
import { DeviceEventsDrawer } from "../_components/device-events-drawer";

const STATUS_COLOR: Record<HwDeviceStatus, string> = {
  ONLINE: "green",
  OFFLINE: "orange",
  NEVER: "default",
};

type CreateDraft = { modelId: number; name: string; serialNo: string };
const EMPTY_CREATE: CreateDraft = { modelId: 0, name: "", serialNo: "" };

type EditDraft = { id: number; name: string; serialNo: string; enabled: boolean };

type TokenInfo = { device: HwDevice; token: string; mode: "created" | "reset" };

function heartbeatExample(token: string) {
  return `curl -X POST "$ENTERPRISE_API_BASE/api/public/hardware/heartbeat" \\
  -H "${HW_DEVICE_TOKEN_HEADER}: ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"firmwareVersion":"1.0.0","meta":{"baseUrl":"http://<设备局域网IP>:8080"}}'`;
}

const codeBlockStyle = {
  margin: "8px 0 0",
  padding: "12px 14px",
  fontSize: 12,
  lineHeight: 1.7,
  color: "var(--text-2)",
  background: "var(--bg-muted)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  overflowX: "auto",
} as const;

export default function HardwareDevicesPage() {
  const { message, modal } = App.useApp();
  const [devices, setDevices] = useState<HwDevice[]>([]);
  const [counts, setCounts] = useState({ online: 0, offline: 0, never: 0 });
  const [models, setModels] = useState<HwModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [modelFilter, setModelFilter] = useState("ALL");

  const [createModal, setCreateModal] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(EMPTY_CREATE);
  const [creating, setCreating] = useState(false);

  const [editModal, setEditModal] = useState(false);
  const [editDraft, setEditDraft] = useState<EditDraft>({ id: 0, name: "", serialNo: "", enabled: true });
  const [saving, setSaving] = useState(false);

  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [eventsDevice, setEventsDevice] = useState<HwDevice | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const loadDevices = useCallback(async () => {
    const data = await hardwareApi.devices({ query: {} });
    setDevices(data?.devices ?? []);
    setCounts({ online: data?.online ?? 0, offline: data?.offline ?? 0, never: data?.never ?? 0 });
  }, []);

  const loadModels = useCallback(async () => {
    const data = await hardwareApi.models({ query: {} });
    setModels(data?.models ?? []);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadDevices(), loadModels()]);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "设备加载失败";
      setError(text);
      message.error(text);
    } finally {
      setLoading(false);
    }
  }, [loadDevices, loadModels, message]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const modelOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const device of devices) seen.set(device.modelId, device.modelName);
    return Array.from(seen.entries()).map(([id, name]) => ({ value: String(id), label: name }));
  }, [devices]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return devices.filter((device) => {
      if (modelFilter !== "ALL" && String(device.modelId) !== modelFilter) return false;
      if (!kw) return true;
      return [device.name, device.serialNo, device.modelName, device.modelCode, device.tokenPrefix]
        .join(" ")
        .toLowerCase()
        .includes(kw);
    });
  }, [devices, keyword, modelFilter]);

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success("已复制");
    } catch {
      message.warning("请手动复制");
    }
  };

  const createDevice = async () => {
    if (!createDraft.modelId) {
      message.warning("请选择硬件型号");
      return;
    }
    if (!createDraft.name.trim()) {
      message.warning("请填写设备名称");
      return;
    }
    setCreating(true);
    try {
      const result = await hardwareApi.deviceCreate({
        body: {
          modelId: createDraft.modelId,
          name: createDraft.name.trim(),
          serialNo: createDraft.serialNo.trim(),
        },
      });
      if (!result) throw new Error("创建返回为空");
      setCreateModal(false);
      setTokenInfo({ device: result.device, token: result.token, mode: "created" });
      await loadDevices();
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const resetToken = (row: HwDevice) => {
    modal.confirm({
      title: "重置设备令牌",
      okText: "确认重置",
      cancelText: "取消",
      okButtonProps: { danger: true },
      content: `重置后「${row.name}」的旧令牌立即失效，设备需用新令牌重新接入。确定重置吗？`,
      onOk: async () => {
        try {
          const result = await hardwareApi.deviceResetToken({ params: { id: String(row.id) } });
          if (!result) throw new Error("重置返回为空");
          setTokenInfo({ device: result.device, token: result.token, mode: "reset" });
          await loadDevices();
        } catch (cause) {
          message.error(cause instanceof Error ? cause.message : "重置失败");
        }
      },
    });
  };

  const saveEdit = async () => {
    if (!editDraft.name.trim()) {
      message.warning("请填写设备名称");
      return;
    }
    setSaving(true);
    try {
      await hardwareApi.deviceUpdate({
        params: { id: String(editDraft.id) },
        body: {
          name: editDraft.name.trim(),
          serialNo: editDraft.serialNo.trim(),
          enabled: editDraft.enabled,
        },
      });
      message.success("设备已保存");
      setEditModal(false);
      await loadDevices();
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (row: HwDevice, enabled: boolean) => {
    try {
      await hardwareApi.deviceUpdate({ params: { id: String(row.id) }, body: { enabled } });
      setDevices((prev) => prev.map((item) => (item.id === row.id ? { ...item, enabled } : item)));
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "操作失败");
    }
  };

  const removeDevice = async (row: HwDevice) => {
    try {
      await hardwareApi.deviceRemove({ params: { id: String(row.id) } });
      message.success("设备已删除");
      await loadDevices();
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "删除失败");
    }
  };

  const columns: ColumnsType<HwDevice> = [
    {
      title: "设备",
      dataIndex: "name",
      render: (value: string, row) => (
        <Space orientation="vertical" size={0}>
          <span style={{ fontWeight: 600 }}>{value}</span>
          {row.serialNo ? <span className="text-12 muted mono">{row.serialNo}</span> : null}
        </Space>
      ),
    },
    {
      title: "型号",
      dataIndex: "modelName",
      width: 160,
      render: (value: string, row) => (
        <Space orientation="vertical" size={0}>
          <span>{value}</span>
          <span className="text-12 muted mono">{row.modelCode}</span>
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 150,
      render: (value: HwDeviceStatus, row) => (
        <Space orientation="vertical" size={2}>
          <Tag color={STATUS_COLOR[value]}>{HW_DEVICE_STATUS_LABELS[value]}</Tag>
          <span className="text-12 muted">
            {row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleString() : "尚未激活"}
          </span>
        </Space>
      ),
    },
    {
      title: "令牌前缀",
      dataIndex: "tokenPrefix",
      width: 130,
      render: (value: string) => <span className="mono text-12">{value}…</span>,
    },
    {
      title: "固件",
      dataIndex: "firmwareVersion",
      width: 100,
      render: (value: string) => <span className="mono text-12">{value || "—"}</span>,
    },
    {
      title: "启用",
      dataIndex: "enabled",
      width: 80,
      render: (value: boolean, row) => (
        <Switch size="small" checked={value} onChange={(next) => void toggleEnabled(row, next)} />
      ),
    },
    {
      title: "操作",
      width: 200,
      render: (_: unknown, row) => (
        <Space size={4}>
          <Button
            size="small"
            icon={<EditOutlined aria-hidden />}
            onClick={() => {
              setEditDraft({ id: row.id, name: row.name, serialNo: row.serialNo, enabled: row.enabled });
              setEditModal(true);
            }}
          />
          <Button size="small" icon={<KeyOutlined aria-hidden />} onClick={() => resetToken(row)} title="重置令牌" />
          <Button size="small" icon={<HistoryOutlined aria-hidden />} onClick={() => setEventsDevice(row)} title="事件流水" />
          <Popconfirm
            title={`删除设备「${row.name}」？其事件流水一并清除`}
            onConfirm={() => void removeDevice(row)}
          >
            <Button size="small" danger icon={<DeleteOutlined aria-hidden />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHero
        title="添加硬件"
        titleExtra={
          <Button size="small" type="link" icon={<QuestionCircleOutlined aria-hidden />} onClick={() => setGuideOpen(true)}>
            接入说明
          </Button>
        }
        desc="管理本人接入的设备：新增设备生成专属令牌（hw_ 前缀，仅本人可见可用），烧录固件后上报心跳即可在线。令牌只走设备通道，不能调用任何业务接口。"
      />

      <StatGrid>
        <StatCard label="设备总数" value={devices.length} hint="本人接入的全部设备" />
        <StatCard label="在线" value={counts.online} hint={`${HW_OFFLINE_AFTER_SECONDS} 秒内有心跳`} />
        <StatCard label="离线" value={counts.offline} hint="心跳超时" />
        <StatCard label="未激活" value={counts.never} hint="尚未上报心跳" />
      </StatGrid>

      <Panel
        title="我的设备"
        extra={
          <Space wrap>
            <Input.Search
              allowClear
              placeholder="搜索设备 / 序列号 / 型号"
              style={{ width: 220 }}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <Select
              style={{ width: 180 }}
              value={modelFilter}
              onChange={setModelFilter}
              options={[{ value: "ALL", label: "全部型号" }, ...modelOptions]}
            />
            <Button
              type="primary"
              icon={<PlusOutlined aria-hidden />}
              onClick={() => {
                setCreateDraft({ ...EMPTY_CREATE, modelId: models[0]?.id ?? 0 });
                setCreateModal(true);
              }}
            >
              新增设备
            </Button>
          </Space>
        }
      >
        {error ? <Notice variant="error">{error}</Notice> : null}
        {loading ? <Skeleton active paragraph={{ rows: 5 }} /> : null}
        {!loading && !filtered.length ? (
          <EmptyState
            text={devices.length ? "没有符合条件的设备，换个关键词或型号试试。" : "还没有接入设备；先到「硬件广场」下载开发包，再点「新增设备」生成令牌。"}
            action={
              devices.length ? undefined : <Link href="/hardware">去硬件广场</Link>
            }
          />
        ) : null}
        {!loading && filtered.length ? (
          <Table
            style={{ marginTop: 12 }}
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={filtered}
            columns={columns}
            scroll={{ x: 1080 }}
          />
        ) : null}
      </Panel>

      <Modal
        open={createModal}
        title="新增设备"
        onCancel={() => setCreateModal(false)}
        onOk={() => void createDevice()}
        confirmLoading={creating}
        okText="生成令牌"
        width={560}
        destroyOnHidden
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>硬件型号</div>
            <Select
              style={{ width: "100%" }}
              value={createDraft.modelId || undefined}
              placeholder="选择已上架的型号"
              onChange={(value) => setCreateDraft((prev) => ({ ...prev, modelId: value }))}
              options={models.map((item) => ({ value: item.id, label: `${item.name}（${item.code}）` }))}
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>设备名称</div>
            <Input
              value={createDraft.name}
              maxLength={80}
              placeholder="如：客厅网关-01"
              onChange={(event) => setCreateDraft((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>序列号（可选）</div>
            <Input
              className="mono"
              value={createDraft.serialNo}
              maxLength={80}
              placeholder="设备出厂 SN / MAC"
              onChange={(event) => setCreateDraft((prev) => ({ ...prev, serialNo: event.target.value }))}
            />
          </div>
          <Notice variant="info">
            生成后会显示一次明文令牌（hw_ 前缀），请立即复制保存到固件配置；列表里只保留前 8 位用于识别。
          </Notice>
        </Space>
      </Modal>

      <Modal
        open={editModal}
        title="编辑设备"
        onCancel={() => setEditModal(false)}
        onOk={() => void saveEdit()}
        confirmLoading={saving}
        okText="保存"
        width={520}
        destroyOnHidden
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>设备名称</div>
            <Input
              value={editDraft.name}
              maxLength={80}
              onChange={(event) => setEditDraft((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>序列号</div>
            <Input
              className="mono"
              value={editDraft.serialNo}
              maxLength={80}
              onChange={(event) => setEditDraft((prev) => ({ ...prev, serialNo: event.target.value }))}
            />
          </div>
          <Space>
            <Switch
              checked={editDraft.enabled}
              onChange={(value) => setEditDraft((prev) => ({ ...prev, enabled: value }))}
            />
            <span>启用（停用后设备心跳与指令将被拒绝）</span>
          </Space>
        </Space>
      </Modal>

      <Modal
        open={Boolean(tokenInfo)}
        title={tokenInfo?.mode === "reset" ? "令牌已重置" : "设备令牌已生成"}
        width={640}
        onCancel={() => setTokenInfo(null)}
        footer={[
          <Button key="copy" type="primary" icon={<CopyOutlined aria-hidden />} onClick={() => void copyText(tokenInfo?.token ?? "")}>
            复制令牌
          </Button>,
          <Button key="close" onClick={() => setTokenInfo(null)}>
            我已保存，关闭
          </Button>,
        ]}
      >
        <div
          style={{
            background: "var(--bg-muted)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "12px 14px",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
            {tokenInfo?.device.name} 的明文令牌（仅展示这一次，请妥善保存）
          </div>
          <div className="mono" style={{ fontSize: 13, marginTop: 6, wordBreak: "break-all" }}>
            {tokenInfo?.token ?? ""}
          </div>
        </div>
        <div className="text-12" style={{ marginTop: 8 }}>
          心跳接入示例（将 ENTERPRISE_API_BASE 设为后端公开地址，meta.baseUrl 设为设备自身可被平台访问的 HTTP 地址）：
        </div>
        <pre className="mono" style={codeBlockStyle}>
          {heartbeatExample(tokenInfo?.token ?? "hw_...")}
        </pre>
        <Notice variant="warn">
          旧令牌{tokenInfo?.mode === "reset" ? "已立即失效" : "不会再次显示"}。设备通道只认请求头 {HW_DEVICE_TOKEN_HEADER}，不能调用业务接口。
        </Notice>
      </Modal>

      <Drawer
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        size={640}
        title="设备接入说明"
        destroyOnHidden
      >
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Notice variant="info">
            设备令牌以 hw_ 开头，仅本人可见可用，只走设备通道（心跳 / 指令 / 回执），不能调用任何业务接口。明文只在生成或重置时显示一次。
          </Notice>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>接入流程</div>
            <ol className="text-12" style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
              <li>到「硬件广场」下载对应型号的开发包（SDK / 固件）并烧录。</li>
              <li>在本页「新增设备」选择型号、填名称，生成专属令牌并复制保存。</li>
              <li>在固件里配置令牌与后端公开地址，周期性上报心跳（默认 30~60 秒）。</li>
              <li>心跳会把平台待办指令带回设备；设备执行后调用回执接口写结果。</li>
            </ol>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>设备通道端点（请求头 {HW_DEVICE_TOKEN_HEADER}: hw_...）</div>
            <div className="text-12 mono" style={{ lineHeight: 2 }}>
              <div>POST /api/public/hardware/heartbeat — 心跳，刷新在线状态并返回待办指令</div>
              <div>GET&nbsp; /api/public/hardware/commands — 主动拉取待办指令</div>
              <div>POST /api/public/hardware/result — 设备回执（按 commandCode 匹配）</div>
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>心跳示例</div>
            <pre className="mono" style={codeBlockStyle}>{heartbeatExample("hw_...")}</pre>
          </div>
          <Notice variant="info">
            在线判定：超过 {HW_OFFLINE_AFTER_SECONDS} 秒无心跳即判离线。设备直连（HTTP）工具需要设备在心跳 meta.baseUrl 上报一个平台可访问的地址；指令下发（DEVICE）工具则由设备拉取指令并回执。
          </Notice>
        </Space>
      </Drawer>

      <DeviceEventsDrawer device={eventsDevice} onClose={() => setEventsDevice(null)} />
    </>
  );
}