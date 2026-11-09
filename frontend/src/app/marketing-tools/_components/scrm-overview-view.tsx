"use client";

import {
  ApiOutlined,
  CloudSyncOutlined,
  CopyOutlined,
  ExportOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { SCRM_SYNC_SCOPES } from "@enterprise/contracts";
import { Notice, Panel, StatCard, StatGrid } from "@/components/ui/panel";
import {
  MATERIAL_TYPE_LABELS,
  fmtDateTime,
  scrmApi,
  type ScrmMaterial,
  type ScrmSettings,
  type ScrmStatsOverview,
  type ScrmStatsStaff,
  type ScrmStatsTrend,
} from "./scrm-common";

/**
 * SCRM 概览：企微接入（凭据/回调/探针）、数据同步、统计趋势与员工榜、素材库、侧边栏预览。
 * 原生 SCRM 是唯一客户同步源——启用后企点侧的客户导入会自动暂停，避免双写。
 */
export function ScrmOverviewView({ onChanged }: { onChanged: () => void }) {
  const { message } = App.useApp();
  const [settings, setSettings] = useState<ScrmSettings | null>(null);
  const [syncScope, setSyncScope] = useState<(typeof SCRM_SYNC_SCOPES)[number]>("ALL");
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [overview, setOverview] = useState<ScrmStatsOverview | null>(null);
  const [trend, setTrend] = useState<ScrmStatsTrend | null>(null);
  const [staff, setStaff] = useState<ScrmStatsStaff["rows"]>([]);
  const [days, setDays] = useState(30);
  const [materials, setMaterials] = useState<ScrmMaterial[]>([]);
  const [materialOpen, setMaterialOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<ScrmMaterial | null>(null);

  const reload = useCallback(async () => {
    try {
      const [settingsValue, overviewValue, trendValue, staffValue, materialValue] =
        await Promise.all([
          scrmApi.settings(),
          scrmApi.overview().catch(() => null),
          scrmApi.statsTrend({ query: { days } }).catch(() => null),
          scrmApi.statsStaff({ query: { days } }).catch(() => null),
          scrmApi.materials().catch(() => []),
        ]);
      setSettings(settingsValue);
      setOverview(overviewValue);
      setTrend(trendValue);
      setStaff(staffValue?.rows ?? []);
      setMaterials(materialValue ?? []);
    } catch (error) {
      message.error((error as Error).message || "SCRM 概览读取失败");
    }
  }, [days, message]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveSettings = async (values: Record<string, unknown>) => {
    try {
      const next = await scrmApi.saveSettings({
        body: {
          corpId: String(values.corpId || "").trim(),
          corpName: String(values.corpName || ""),
          agentId: String(values.agentId || ""),
          contactSecret: String(values.contactSecret || "") || undefined,
          appSecret: String(values.appSecret || "") || undefined,
          callbackToken: String(values.callbackToken || "") || undefined,
          aesKey: String(values.aesKey || "") || undefined,
          enabled: Boolean(values.enabled),
        },
      });
      setSettings(next);
      message.success("企微接入设置已保存");
      onChanged();
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const result = await scrmApi.testConnection();
      message[result?.ok ? "success" : "warning"](
        result?.message || (result?.ok ? "连接正常" : "连接失败"),
      );
    } catch (error) {
      message.error((error as Error).message || "连接测试失败");
    } finally {
      setTesting(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await scrmApi.sync({ body: { scope: syncScope } });
      message.success(
        result?.message ||
          `同步完成：客户 ${result?.contacts ?? 0}、标签 ${result?.tags ?? 0}、客户群 ${result?.chats ?? 0}`,
      );
      await reload();
      onChanged();
    } catch (error) {
      message.error((error as Error).message || "同步失败");
    } finally {
      setSyncing(false);
    }
  };

  const exportStats = async () => {
    try {
      const job = await scrmApi.exportStats({ body: { days } });
      message.success(`导出任务已创建（#${job?.jobId}，${job?.status}），可到机制中心下载`);
    } catch (error) {
      message.error((error as Error).message || "导出失败");
    }
  };

  /** 登录态预览员工侧边栏：先签发 2 小时票据，再用 H5 打开（与企微工作台同一条通道）。 */
  const previewSidebar = async () => {
    try {
      const ticket = await scrmApi.sidebarTicket({ body: {} });
      if (!ticket?.ticket) {
        message.error("侧边栏票据签发失败");
        return;
      }
      window.open(
        `/embed/wecom-scrm?ticket=${encodeURIComponent(ticket.ticket)}`,
        "_blank",
        "noopener,noreferrer",
      );
    } catch (error) {
      message.error((error as Error).message || "侧边栏票据签发失败");
    }
  };

  const removeMaterial = async (row: ScrmMaterial) => {
    try {
      await scrmApi.removeMaterial({ body: { id: row.id } });
      message.success("素材已删除");
      void reload();
    } catch (error) {
      message.error((error as Error).message || "删除失败");
    }
  };

  const trendRows = (trend?.points ?? []).map((point) => {
    const mass = trend?.mass.find((item) => item.day === point.day);
    return { ...point, sent: mass?.sent ?? 0, delivered: mass?.delivered ?? 0 };
  });

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <StatGrid>
        <StatCard label="客户总数" value={overview?.contacts ?? 0} hint={`今日新增 ${overview?.todayAdded ?? 0}`} />
        <StatCard label="已流失" value={overview?.lost ?? 0} hint="可重新加回或标记放弃" />
        <StatCard label="客户群" value={overview?.chats ?? 0} hint={`群成员 ${overview?.chatMembers ?? 0}`} />
        <StatCard
          label="今日群发"
          value={overview?.todayMassSent ?? 0}
          hint={`已送达 ${overview?.todayMassDelivered ?? 0}`}
        />
        <StatCard label="活跃员工" value={overview?.activeStaff ?? 0} hint="近 30 天有客户/群/待办动作" />
      </StatGrid>

      <ScrmSettingsPanel settings={settings} testing={testing} onSave={saveSettings} onTest={test} />

      <Panel
        title={
          <>
            <CloudSyncOutlined aria-hidden /> 数据同步
          </>
        }
        titleExtra="客户、标签、客户群都从企微拉取并镜像到本地；重复同步幂等"
        extra={
          <Button icon={<LinkOutlined aria-hidden />} onClick={() => void previewSidebar()}>
            预览员工侧边栏
          </Button>
        }
      >
        <Space wrap>
          <Select
            style={{ width: 160 }}
            value={syncScope}
            onChange={setSyncScope}
            options={[
              { value: "ALL", label: "全部（客户 + 标签 + 群）" },
              { value: "CONTACTS", label: "仅客户" },
              { value: "TAGS", label: "仅标签" },
              { value: "CHATS", label: "仅客户群" },
            ]}
          />
          <Button type="primary" loading={syncing} onClick={() => void sync()}>
            立即同步
          </Button>
          <span className="text-12 muted">
            上次同步：{settings?.lastSyncAt ? fmtDateTime(settings.lastSyncAt) : "从未同步"}
            {settings?.lastSyncResult ? ` · ${settings.lastSyncResult}` : ""}
          </span>
        </Space>
        <Notice variant="info">
          同步是拉取不是推送：企微侧删除的客户会标记为「已流失」，不会物理删除本地记录与聊天关联。
          离职继承与在职继承在「分配与继承」里由企业管理员发起。
        </Notice>
      </Panel>

      <Panel
        title="客户增长与群发"
        titleExtra="数据来自每日快照；群发按回执统计送达"
        extra={
          <Space wrap>
            <Select
              style={{ width: 110 }}
              value={days}
              onChange={setDays}
              options={[7, 30, 90, 180].map((value) => ({ value, label: `近 ${value} 天` }))}
            />
            <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void reload()}>
              刷新
            </Button>
            <Button icon={<ExportOutlined aria-hidden />} onClick={() => void exportStats()}>
              导出 CSV
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="day"
          size="small"
          dataSource={trendRows}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          scroll={{ x: 620 }}
          columns={[
            { title: "日期", dataIndex: "day", width: 120 },
            { title: "新增", dataIndex: "added", width: 90 },
            { title: "流失", dataIndex: "lost", width: 90 },
            { title: "净增", dataIndex: "net", width: 90 },
            { title: "群发提交", dataIndex: "sent", width: 110 },
            { title: "群发送达", dataIndex: "delivered", width: 110 },
          ]}
          locale={{ emptyText: "暂无快照：先做一次同步或等次日凌晨生成" }}
        />
        <Table
          style={{ marginTop: 16 }}
          rowKey="staffUserId"
          size="small"
          dataSource={staff}
          pagination={false}
          scroll={{ x: 620 }}
          columns={[
            { title: "员工", dataIndex: "name", render: (value: string, row) => value || row.staffUserId },
            { title: "负责客户", dataIndex: "contacts", width: 110 },
            { title: "负责客户群", dataIndex: "chats", width: 120 },
            { title: "群发送达", dataIndex: "massSent", width: 110 },
            { title: "SOP 完成", dataIndex: "sopDone", width: 110 },
            { title: "SOP 完成率", dataIndex: "sopRate", width: 120, render: (value: number) => `${value}%` },
          ]}
          locale={{ emptyText: "暂无员工数据" }}
        />
      </Panel>

      <Panel
        title="素材库"
        titleExtra="群发、欢迎语、SOP 与员工侧边栏共用；图片/文件只存数字资产引用"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden />}
            onClick={() => {
              setEditingMaterial(null);
              setMaterialOpen(true);
            }}
          >
            新增素材
          </Button>
        }
      >
        <Table<ScrmMaterial>
          rowKey="id"
          size="small"
          dataSource={materials}
          pagination={false}
          scroll={{ x: 760 }}
          columns={[
            {
              title: "类型",
              dataIndex: "type",
              width: 90,
              render: (value: string) => <Tag>{MATERIAL_TYPE_LABELS[value] ?? value}</Tag>,
            },
            { title: "标题", dataIndex: "title" },
            {
              title: "内容 / 引用",
              dataIndex: "content",
              render: (value: string, row) => (
                <Typography.Text ellipsis style={{ maxWidth: 360 }}>
                  {value || row.link || (row.assetId ? `数字资产 #${row.assetId}` : "-")}
                </Typography.Text>
              ),
            },
            { title: "创建时间", dataIndex: "createdAt", width: 170, render: fmtDateTime },
            {
              title: "操作",
              width: 120,
              render: (_: unknown, row) => (
                <Space size={4}>
                  <Button
                    size="small"
                    onClick={() => {
                      setEditingMaterial(row);
                      setMaterialOpen(true);
                    }}
                  >
                    编辑
                  </Button>
                  <Popconfirm title="删除这条素材？" onConfirm={() => void removeMaterial(row)}>
                    <Button size="small" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
          locale={{ emptyText: "还没有素材：SOP 推素材、欢迎语附件、侧边栏快捷发送都从这里取" }}
        />
      </Panel>

      <MaterialModal
        open={materialOpen}
        row={editingMaterial}
        onClose={() => setMaterialOpen(false)}
        onSaved={() => {
          setMaterialOpen(false);
          void reload();
        }}
      />
    </Space>
  );
}

function ScrmSettingsPanel({
  settings,
  testing,
  onSave,
  onTest,
}: {
  settings: ScrmSettings | null;
  testing: boolean;
  onSave: (values: Record<string, unknown>) => Promise<void>;
  onTest: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    form.setFieldsValue({
      corpId: settings.corpId,
      corpName: settings.corpName,
      agentId: settings.agentId,
      enabled: settings.enabled,
    });
  }, [settings, form]);

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await onSave(values);
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    if (!settings?.callbackUrl) return;
    try {
      await navigator.clipboard.writeText(settings.callbackUrl);
      message.success("回调地址已复制");
    } catch {
      message.warning("浏览器不允许复制，请手动选中复制");
    }
  };

  return (
    <Panel
      title={
        <>
          <ApiOutlined aria-hidden /> 企业微信接入
        </>
      }
      titleExtra="原生 SCRM 是唯一客户同步源；启用后企点侧客户导入自动暂停"
      extra={
        <Space wrap>
          <Tag color={settings?.configured ? (settings.enabled ? "success" : "warning") : "default"}>
            {settings?.configured ? (settings.enabled ? "已接入" : "已停用") : "未接入"}
          </Tag>
          <Button loading={testing} onClick={() => void onTest()}>
            测试连接
          </Button>
          <Button type="primary" icon={<SaveOutlined aria-hidden />} loading={saving} onClick={() => void save()}>
            保存
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" disabled={!settings}>
        <div className="form-2col">
          <Form.Item name="corpId" label="企业 CorpID" rules={[{ required: true, message: "请填写 CorpID" }]}>
            <Input placeholder="ww 或 wx 开头的企业 ID" maxLength={64} />
          </Form.Item>
          <Form.Item name="corpName" label="企业名称">
            <Input placeholder="仅用于界面展示" maxLength={120} />
          </Form.Item>
          <Form.Item name="agentId" label="自建应用 AgentId" tooltip="侧边栏与部分接口需要；回调 URL 校验不依赖它">
            <Input placeholder="如 1000002" maxLength={32} />
          </Form.Item>
          <Form.Item name="enabled" label="启用 SCRM" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            name="contactSecret"
            label="外部联系人 Secret"
            tooltip="已配置时留空表示不修改；不会回显明文"
          >
            <Input.Password placeholder={settings?.hasContactSecret ? "已配置（留空不改）" : "粘贴 Secret"} maxLength={300} />
          </Form.Item>
          <Form.Item name="appSecret" label="自建应用 Secret" tooltip="已配置时留空表示不修改">
            <Input.Password placeholder={settings?.hasAppSecret ? "已配置（留空不改）" : "粘贴 Secret"} maxLength={300} />
          </Form.Item>
          <Form.Item name="callbackToken" label="回调 Token" tooltip="企微后台「接收消息服务器配置」里的 Token">
            <Input.Password placeholder={settings?.hasCallback ? "已配置（留空不改）" : "粘贴 Token"} maxLength={200} />
          </Form.Item>
          <Form.Item name="aesKey" label="回调 EncodingAESKey" tooltip="安全模式必填；43 位">
            <Input.Password placeholder={settings?.hasCallback ? "已配置（留空不改）" : "粘贴 EncodingAESKey"} maxLength={200} />
          </Form.Item>
        </div>
        <Form.Item label="回调 URL">
          <Space.Compact style={{ width: "100%" }}>
            <Input value={settings?.callbackUrl || "保存后生成"} readOnly />
            <Button icon={<CopyOutlined aria-hidden />} onClick={() => void copy()} disabled={!settings?.callbackUrl}>
              复制
            </Button>
          </Space.Compact>
        </Form.Item>
        <Notice variant="info">
          把上面的回调 URL 填到企微后台「客户联系 → 接收事件服务器」，并勾选「客户联系」相关事件；
          保存凭据后点「测试连接」验证 Secret 与权限。企点·客户数据模块的客户导入在启用本模块后会被拒绝写入，
          两端不再同时做客户主数据。
        </Notice>
        {settings?.status && settings.status !== "UNCONFIGURED" ? (
          <Typography.Text type="secondary" className="text-12">
            当前状态：{settings.status} · 同步源：{settings.syncSource} · 企点客户导入：
            {settings.qidianPaused ? "已暂停" : "未暂停"}
          </Typography.Text>
        ) : null}
      </Form>
    </Panel>
  );
}

function MaterialModal({
  open,
  row,
  onClose,
  onSaved,
}: {
  open: boolean;
  row: ScrmMaterial | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const type = Form.useWatch("type", form);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(
      row
        ? { ...row }
        : { type: "TEXT", title: "", content: "", assetId: 0, link: "" },
    );
  }, [open, row, form]);

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await scrmApi.saveMaterial({
        body: {
          id: row?.id ?? 0,
          type: values.type,
          title: values.title,
          content: values.content ?? "",
          assetId: Number(values.assetId ?? 0),
          link: values.link ?? "",
          miniProgram: values.miniProgram ?? {},
        },
      });
      message.success("素材已保存");
      onSaved();
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={row ? "编辑素材" : "新增素材"}
      open={open}
      confirmLoading={saving}
      okText="保存"
      onOk={() => void submit()}
      onCancel={onClose}
      width={560}
    >
      <Form form={form} layout="vertical">
        <div className="form-2col">
          <Form.Item name="type" label="素材类型" rules={[{ required: true }]}>
            <Select
              options={Object.entries(MATERIAL_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "请填写标题" }]}>
            <Input maxLength={80} />
          </Form.Item>
        </div>
        {type === "IMAGE" || type === "FILE" ? (
          <Form.Item name="assetId" label="数字资产 ID" tooltip="从「数字资产」上传后复制 ID；侧边栏按资产出下载/预览">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        ) : null}
        {type === "LINK" ? (
          <Form.Item name="link" label="链接地址" rules={[{ required: true, message: "请填写链接" }]}>
            <Input placeholder="https://" maxLength={500} />
          </Form.Item>
        ) : null}
        <Form.Item name="content" label="文本内容" tooltip="链接素材可填摘要；文本素材正文上限 2000 字">
          <Input.TextArea rows={4} maxLength={2000} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}
