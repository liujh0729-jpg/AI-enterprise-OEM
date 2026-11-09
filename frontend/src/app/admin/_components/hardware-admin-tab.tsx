"use client";

import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Skeleton,
  Space,
  Switch,
  Table,
  Tag,
  Upload,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import {
  HW_KIT_CHANNELS,
  HW_KIT_CHANNEL_LABELS,
  type HwKit,
  type HwKitChannel,
  type HwKitFile,
  type HwModel,
} from "@enterprise/contracts";
import { hardwareAdminApi, uploadHardwareKit } from "@/api/hardware";
import {
  EmptyState,
  Notice,
  Panel,
  PanelTabs,
  StatCard,
  StatGrid,
} from "@/components/ui/panel";
import { HardwareAdminTools } from "./hardware-admin-tools";

type Tab = "models" | "kits" | "tools";

type ModelDraft = {
  id: number;
  code: string;
  name: string;
  vendor: string;
  chip: string;
  category: string;
  summary: string;
  coverUrl: string;
  specText: string;
  featured: boolean;
  enabled: boolean;
  sortOrder: number;
};

const EMPTY_MODEL: ModelDraft = {
  id: 0,
  code: "",
  name: "",
  vendor: "",
  chip: "",
  category: "",
  summary: "",
  coverUrl: "",
  specText: "{}",
  featured: false,
  enabled: true,
  sortOrder: 0,
};

type KitDraft = {
  id: number;
  modelId: number;
  version: string;
  channel: HwKitChannel;
  changelog: string;
  docUrl: string;
  minFirmware: string;
  enabled: boolean;
  fileName: string;
  fileSize: number;
  sha256: string;
};

const EMPTY_KIT: KitDraft = {
  id: 0,
  modelId: 0,
  version: "",
  channel: "STABLE",
  changelog: "",
  docUrl: "",
  minFirmware: "",
  enabled: true,
  fileName: "",
  fileSize: 0,
  sha256: "",
};

function formatSize(bytes: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function HardwareAdminTab() {
  const { message } = App.useApp();
  const [tab, setTab] = useState<Tab>("models");

  const [models, setModels] = useState<HwModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelModal, setModelModal] = useState(false);
  const [modelDraft, setModelDraft] = useState<ModelDraft>(EMPTY_MODEL);
  const [modelSaving, setModelSaving] = useState(false);

  const [kits, setKits] = useState<HwKit[]>([]);
  const [kitsLoading, setKitsLoading] = useState(false);
  const [kitModelFilter, setKitModelFilter] = useState("ALL");
  const [kitModal, setKitModal] = useState(false);
  const [kitDraft, setKitDraft] = useState<KitDraft>(EMPTY_KIT);
  const [kitFile, setKitFile] = useState<HwKitFile | null>(null);
  const [kitUploading, setKitUploading] = useState(false);
  const [kitSaving, setKitSaving] = useState(false);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const data = await hardwareAdminApi.modelList();
      setModels(data?.models ?? []);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "型号加载失败");
    } finally {
      setModelsLoading(false);
    }
  }, [message]);

  const loadKits = useCallback(async () => {
    setKitsLoading(true);
    try {
      const data = await hardwareAdminApi.kitList({
        query: { modelId: kitModelFilter === "ALL" ? "" : kitModelFilter },
      });
      setKits(data?.kits ?? []);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "开发包加载失败");
    } finally {
      setKitsLoading(false);
    }
  }, [kitModelFilter, message]);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  useEffect(() => {
    if (tab === "kits") void loadKits();
  }, [tab, loadKits]);

  const modelOptions = models.map((item) => ({
    value: item.id,
    label: `${item.name}（${item.code}）`,
  }));
  const modelName = (id: number) => {
    const target = models.find((item) => item.id === id);
    return target ? `${target.name}（${target.code}）` : `#${id}`;
  };

  const saveModel = async () => {
    if (!modelDraft.code.trim() || !modelDraft.name.trim()) {
      message.warning("请填写型号编码与名称");
      return;
    }
    let spec: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(modelDraft.specText || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("必须是对象");
      }
      spec = parsed as Record<string, unknown>;
    } catch {
      message.warning("规格 JSON 格式不正确，应是一个对象，如 {\"cpu\":\"...\"}");
      return;
    }
    const body = {
      code: modelDraft.code.trim(),
      name: modelDraft.name.trim(),
      vendor: modelDraft.vendor.trim(),
      chip: modelDraft.chip.trim(),
      category: modelDraft.category.trim(),
      summary: modelDraft.summary.trim(),
      coverUrl: modelDraft.coverUrl.trim(),
      spec,
      featured: modelDraft.featured,
      enabled: modelDraft.enabled,
      sortOrder: modelDraft.sortOrder,
    };
    setModelSaving(true);
    try {
      if (modelDraft.id) {
        await hardwareAdminApi.modelUpdate({ params: { id: String(modelDraft.id) }, body });
      } else {
        await hardwareAdminApi.modelSave({ body });
      }
      message.success("型号已保存");
      setModelModal(false);
      await loadModels();
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setModelSaving(false);
    }
  };

  const toggleModel = async (row: HwModel, enabled: boolean) => {
    try {
      await hardwareAdminApi.modelUpdate({ params: { id: String(row.id) }, body: { enabled } });
      setModels((prev) => prev.map((item) => (item.id === row.id ? { ...item, enabled } : item)));
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "操作失败");
    }
  };

  const removeModel = async (row: HwModel) => {
    try {
      await hardwareAdminApi.modelRemove({ params: { id: String(row.id) } });
      message.success("型号已删除");
      await Promise.all([loadModels(), loadKits()]);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "删除失败");
    }
  };

  const doUploadKit = async (file: File) => {
    setKitUploading(true);
    try {
      const meta = await uploadHardwareKit(file);
      setKitFile(meta);
      message.success("文件已上传到对象存储，保存后入库");
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "上传失败");
    } finally {
      setKitUploading(false);
    }
  };

  const saveKit = async () => {
    if (!kitDraft.modelId) {
      message.warning("请选择所属型号");
      return;
    }
    if (!kitDraft.version.trim()) {
      message.warning("请填写版本号");
      return;
    }
    if (!kitDraft.id && !kitFile) {
      message.warning("请先上传开发包文件");
      return;
    }
    const filePart = kitFile
      ? {
          fileName: kitFile.fileName,
          fileSize: kitFile.fileSize,
          ossKey: kitFile.ossKey,
          sha256: kitFile.sha256,
        }
      : undefined;
    setKitSaving(true);
    try {
      if (kitDraft.id) {
        await hardwareAdminApi.kitUpdate({
          params: { id: String(kitDraft.id) },
          body: {
            version: kitDraft.version.trim(),
            channel: kitDraft.channel,
            changelog: kitDraft.changelog.trim(),
            docUrl: kitDraft.docUrl.trim(),
            minFirmware: kitDraft.minFirmware.trim(),
            enabled: kitDraft.enabled,
            ...(filePart ?? {}),
          },
        });
      } else {
        if (!filePart) return;
        await hardwareAdminApi.kitSave({
          body: {
            modelId: kitDraft.modelId,
            version: kitDraft.version.trim(),
            channel: kitDraft.channel,
            changelog: kitDraft.changelog.trim(),
            docUrl: kitDraft.docUrl.trim(),
            minFirmware: kitDraft.minFirmware.trim(),
            enabled: kitDraft.enabled,
            ...filePart,
          },
        });
      }
      message.success("开发包已保存");
      setKitModal(false);
      await loadKits();
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setKitSaving(false);
    }
  };

  const toggleKit = async (row: HwKit, enabled: boolean) => {
    try {
      await hardwareAdminApi.kitUpdate({ params: { id: String(row.id) }, body: { enabled } });
      setKits((prev) => prev.map((item) => (item.id === row.id ? { ...item, enabled } : item)));
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "操作失败");
    }
  };

  const removeKit = async (row: HwKit) => {
    try {
      await hardwareAdminApi.kitRemove({ params: { id: String(row.id) } });
      message.success("开发包已删除");
      await loadKits();
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "删除失败");
    }
  };

  const modelColumns: ColumnsType<HwModel> = [
    {
      title: "型号",
      dataIndex: "name",
      render: (value: string, row) => (
        <Space orientation="vertical" size={0}>
          <span>{value}</span>
          <span className="text-12 muted mono">{row.code}</span>
        </Space>
      ),
    },
    { title: "厂商", dataIndex: "vendor", width: 120 },
    { title: "芯片", dataIndex: "chip", width: 130 },
    { title: "分类", dataIndex: "category", width: 100 },
    {
      title: "推荐",
      dataIndex: "featured",
      width: 80,
      render: (value: boolean) => (value ? <Tag color="gold">推荐</Tag> : <span className="text-12 muted">—</span>),
    },
    { title: "开发包", dataIndex: "kitCount", width: 90 },
    { title: "设备", dataIndex: "deviceCount", width: 90 },
    { title: "排序", dataIndex: "sortOrder", width: 80 },
    {
      title: "上架",
      dataIndex: "enabled",
      width: 90,
      render: (value: boolean, row) => (
        <Switch size="small" checked={value} onChange={(next) => void toggleModel(row, next)} />
      ),
    },
    {
      title: "操作",
      width: 120,
      render: (_: unknown, row) => (
        <Space size={4}>
          <Button
            size="small"
            icon={<EditOutlined aria-hidden />}
            onClick={() => {
              setModelDraft({
                id: row.id,
                code: row.code,
                name: row.name,
                vendor: row.vendor,
                chip: row.chip,
                category: row.category,
                summary: row.summary,
                coverUrl: row.coverUrl,
                specText: JSON.stringify(row.spec ?? {}, null, 2),
                featured: row.featured,
                enabled: row.enabled,
                sortOrder: row.sortOrder,
              });
              setModelModal(true);
            }}
          />
          <Popconfirm
            title={`删除型号「${row.name}」？其开发包与默认工具一并移除`}
            onConfirm={() => void removeModel(row)}
          >
            <Button size="small" danger icon={<DeleteOutlined aria-hidden />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const kitColumns: ColumnsType<HwKit> = [
    { title: "型号", dataIndex: "modelId", render: (value: number) => modelName(value) },
    { title: "版本", dataIndex: "version", width: 120, render: (value: string) => <span className="mono">{value}</span> },
    {
      title: "通道",
      dataIndex: "channel",
      width: 100,
      render: (value: HwKitChannel) => (
        <Tag color={value === "STABLE" ? "green" : "orange"}>{HW_KIT_CHANNEL_LABELS[value]}</Tag>
      ),
    },
    {
      title: "文件",
      dataIndex: "fileName",
      render: (value: string, row) => (
        <Space orientation="vertical" size={0}>
          <span className="text-12 mono">{value || "—"}</span>
          <span className="text-12 muted">{formatSize(row.fileSize)}</span>
        </Space>
      ),
    },
    { title: "下载量", dataIndex: "downloadCount", width: 90 },
    {
      title: "上架",
      dataIndex: "enabled",
      width: 90,
      render: (value: boolean, row) => (
        <Switch size="small" checked={value} onChange={(next) => void toggleKit(row, next)} />
      ),
    },
    {
      title: "操作",
      width: 120,
      render: (_: unknown, row) => (
        <Space size={4}>
          <Button
            size="small"
            icon={<EditOutlined aria-hidden />}
            onClick={() => {
              setKitDraft({
                id: row.id,
                modelId: row.modelId,
                version: row.version,
                channel: row.channel,
                changelog: row.changelog,
                docUrl: row.docUrl,
                minFirmware: row.minFirmware,
                enabled: row.enabled,
                fileName: row.fileName,
                fileSize: row.fileSize,
                sha256: row.sha256,
              });
              setKitFile(null);
              setKitModal(true);
            }}
          />
          <Popconfirm title={`删除开发包「${row.version}」？`} onConfirm={() => void removeKit(row)}>
            <Button size="small" danger icon={<DeleteOutlined aria-hidden />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const enabledKits = kits.filter((item) => item.enabled).length;

  return (
    <>
      <StatGrid>
        <StatCard label="硬件型号" value={models.length} hint={`上架 ${models.filter((m) => m.enabled).length} 个`} />
        <StatCard label="开发包版本" value={kits.length} hint={`当前筛选 ${enabledKits} 个已上架`} />
        <StatCard
          label="累计下载"
          value={kits.reduce((sum, item) => sum + item.downloadCount, 0)}
          hint="当前筛选范围内开发包下载量合计"
        />
      </StatGrid>

      <Panel title="智能硬件维护">
        <PanelTabs
          value={tab}
          onChange={(key) => setTab(key as Tab)}
          items={[
            {
              key: "models",
              label: "硬件型号",
              children: (
                <Panel
                  title="型号目录"
                  titleExtra={
                    <span className="text-12 muted">型号编码进 MCP 工具名（hw__型号__工具），只能用小写字母、数字与连字符</span>
                  }
                  extra={
                    <Button
                      type="primary"
                      icon={<PlusOutlined aria-hidden />}
                      onClick={() => {
                        setModelDraft({ ...EMPTY_MODEL });
                        setModelModal(true);
                      }}
                    >
                      新增型号
                    </Button>
                  }
                >
                  {modelsLoading ? <Skeleton active paragraph={{ rows: 4 }} /> : null}
                  {!modelsLoading && !models.length ? (
                    <EmptyState text="还没有硬件型号；先新增 ESP32 / Jetson Orin Nano 等型号，再上传开发包。" />
                  ) : null}
                  {!modelsLoading && models.length ? (
                    <Table
                      style={{ marginTop: 12 }}
                      size="small"
                      rowKey="id"
                      pagination={false}
                      dataSource={models}
                      columns={modelColumns}
                      scroll={{ x: 1080 }}
                    />
                  ) : null}
                </Panel>
              ),
            },
            {
              key: "kits",
              label: "开发包",
              children: (
                <Panel
                  title="开发包版本"
                  titleExtra={<span className="text-12 muted">SDK / 固件二进制直传本站 OSS，下载时计数；SHA-256 供用户校验</span>}
                  extra={
                    <Space wrap>
                      <Select
                        style={{ width: 220 }}
                        value={kitModelFilter}
                        onChange={setKitModelFilter}
                        options={[{ value: "ALL", label: "全部型号" }, ...modelOptions.map((o) => ({ value: String(o.value), label: o.label }))]}
                      />
                      <Button
                        type="primary"
                        icon={<PlusOutlined aria-hidden />}
                        onClick={() => {
                          setKitDraft({ ...EMPTY_KIT, modelId: models[0]?.id ?? 0 });
                          setKitFile(null);
                          setKitModal(true);
                        }}
                      >
                        上传开发包
                      </Button>
                    </Space>
                  }
                >
                  {kitsLoading ? <Skeleton active paragraph={{ rows: 4 }} /> : null}
                  {!kitsLoading && !kits.length ? (
                    <EmptyState text="该型号还没有开发包；点「上传开发包」选择文件并填版本号。" />
                  ) : null}
                  {!kitsLoading && kits.length ? (
                    <Table
                      style={{ marginTop: 12 }}
                      size="small"
                      rowKey="id"
                      pagination={false}
                      dataSource={kits}
                      columns={kitColumns}
                      scroll={{ x: 980 }}
                    />
                  ) : null}
                </Panel>
              ),
            },
            {
              key: "tools",
              label: "默认工具",
              children: <HardwareAdminTools models={models} />,
            },
          ]}
        />
      </Panel>

      <Modal
        open={modelModal}
        title={modelDraft.id ? "编辑型号" : "新增型号"}
        onCancel={() => setModelModal(false)}
        onOk={() => void saveModel()}
        confirmLoading={modelSaving}
        okText="保存"
        width={680}
        destroyOnHidden
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <div className="form-2col">
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>型号编码</div>
              <Input
                className="mono"
                value={modelDraft.code}
                maxLength={48}
                placeholder="esp32 / jetson-orin-nano"
                onChange={(event) => setModelDraft((prev) => ({ ...prev, code: event.target.value }))}
              />
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>型号名称</div>
              <Input
                value={modelDraft.name}
                maxLength={80}
                placeholder="ESP32 开发板"
                onChange={(event) => setModelDraft((prev) => ({ ...prev, name: event.target.value }))}
              />
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>厂商</div>
              <Input
                value={modelDraft.vendor}
                maxLength={60}
                placeholder="乐鑫 / NVIDIA"
                onChange={(event) => setModelDraft((prev) => ({ ...prev, vendor: event.target.value }))}
              />
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>芯片</div>
              <Input
                value={modelDraft.chip}
                maxLength={60}
                placeholder="ESP32-S3 / Orin Nano"
                onChange={(event) => setModelDraft((prev) => ({ ...prev, chip: event.target.value }))}
              />
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>分类</div>
              <Input
                value={modelDraft.category}
                maxLength={40}
                placeholder="开发板 / 边缘计算"
                onChange={(event) => setModelDraft((prev) => ({ ...prev, category: event.target.value }))}
              />
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>排序（越小越靠前）</div>
              <InputNumber
                style={{ width: "100%" }}
                value={modelDraft.sortOrder}
                onChange={(value) => setModelDraft((prev) => ({ ...prev, sortOrder: Number(value ?? 0) }))}
              />
            </div>
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>封面图 URL</div>
            <Input
              className="mono"
              value={modelDraft.coverUrl}
              maxLength={500}
              placeholder="https://..."
              onChange={(event) => setModelDraft((prev) => ({ ...prev, coverUrl: event.target.value }))}
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>简介</div>
            <Input.TextArea
              rows={2}
              maxLength={500}
              value={modelDraft.summary}
              onChange={(event) => setModelDraft((prev) => ({ ...prev, summary: event.target.value }))}
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>规格（JSON 对象：能力 / 接口 / 尺寸等）</div>
            <Input.TextArea
              rows={4}
              className="mono"
              value={modelDraft.specText}
              placeholder='{"cpu":"双核 240MHz","flash":"8MB","interfaces":["WiFi","BLE","USB-C"]}'
              onChange={(event) => setModelDraft((prev) => ({ ...prev, specText: event.target.value }))}
            />
          </div>
          <Space size={24}>
            <Space>
              <Switch
                checked={modelDraft.featured}
                onChange={(value) => setModelDraft((prev) => ({ ...prev, featured: value }))}
              />
              <span>首页推荐</span>
            </Space>
            <Space>
              <Switch
                checked={modelDraft.enabled}
                onChange={(value) => setModelDraft((prev) => ({ ...prev, enabled: value }))}
              />
              <span>上架（用户侧可见）</span>
            </Space>
          </Space>
        </Space>
      </Modal>

      <Modal
        open={kitModal}
        title={kitDraft.id ? "编辑开发包" : "上传开发包"}
        onCancel={() => setKitModal(false)}
        onOk={() => void saveKit()}
        confirmLoading={kitSaving}
        okText="保存"
        width={640}
        destroyOnHidden
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <div className="form-2col">
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>所属型号</div>
              <Select
                style={{ width: "100%" }}
                value={kitDraft.modelId || undefined}
                disabled={Boolean(kitDraft.id)}
                placeholder="选择型号"
                onChange={(value) => setKitDraft((prev) => ({ ...prev, modelId: value }))}
                options={modelOptions}
              />
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>版本号</div>
              <Input
                className="mono"
                value={kitDraft.version}
                maxLength={40}
                placeholder="1.0.0"
                onChange={(event) => setKitDraft((prev) => ({ ...prev, version: event.target.value }))}
              />
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>通道</div>
              <Select
                style={{ width: "100%" }}
                value={kitDraft.channel}
                onChange={(value) => setKitDraft((prev) => ({ ...prev, channel: value }))}
                options={HW_KIT_CHANNELS.map((item) => ({ value: item, label: HW_KIT_CHANNEL_LABELS[item] }))}
              />
            </div>
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>最低固件版本</div>
              <Input
                className="mono"
                value={kitDraft.minFirmware}
                maxLength={40}
                placeholder="可选"
                onChange={(event) => setKitDraft((prev) => ({ ...prev, minFirmware: event.target.value }))}
              />
            </div>
          </div>

          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              开发包文件{kitDraft.id ? "（不选＝沿用已上传的文件）" : "（SDK / 固件，≤200MB）"}
            </div>
            <Upload
              showUploadList={false}
              disabled={kitUploading}
              beforeUpload={(file) => {
                void doUploadKit(file as File);
                return false;
              }}
            >
              <Button icon={<UploadOutlined aria-hidden />} loading={kitUploading}>
                {kitFile || kitDraft.fileName ? "重新选择文件" : "选择文件"}
              </Button>
            </Upload>
            {kitFile || kitDraft.fileName ? (
              <div className="text-12 muted" style={{ marginTop: 6 }}>
                <span className="mono">{kitFile ? kitFile.fileName : kitDraft.fileName}</span>
                {" · "}
                {formatSize(kitFile ? kitFile.fileSize : kitDraft.fileSize)}
                {kitFile ? ` · SHA-256 ${kitFile.sha256.slice(0, 16)}…` : kitDraft.sha256 ? ` · SHA-256 ${kitDraft.sha256.slice(0, 16)}…` : ""}
              </div>
            ) : null}
          </div>

          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>文档链接</div>
            <Input
              className="mono"
              value={kitDraft.docUrl}
              maxLength={500}
              placeholder="https://...（接入指南 / API 文档）"
              onChange={(event) => setKitDraft((prev) => ({ ...prev, docUrl: event.target.value }))}
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>更新说明</div>
            <Input.TextArea
              rows={3}
              maxLength={1000}
              value={kitDraft.changelog}
              onChange={(event) => setKitDraft((prev) => ({ ...prev, changelog: event.target.value }))}
            />
          </div>
          <Space>
            <Switch
              checked={kitDraft.enabled}
              onChange={(value) => setKitDraft((prev) => ({ ...prev, enabled: value }))}
            />
            <span>上架（用户可下载）</span>
          </Space>
          <Notice variant="info">
            文件先直传对象存储并计算 SHA-256，点「保存」后才带版本号入库；同一型号下版本号不可重复。
          </Notice>
        </Space>
      </Modal>
    </>
  );
}