"use client";

import {
  DownloadOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SettingOutlined,
  StopOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Collapse,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Steps,
  Switch,
  Tag,
  TimePicker,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { Notice, Panel, PillTabs } from "@/components/ui/panel";
import {
  acqApi,
  controlAcq,
  onAcqEvent,
  pingExtension,
  renewAcqToken,
  reportAcqTerminalReceipt,
  startAcqTask,
  type AcqMeta,
  type AcqPlaybook,
  type AcqSettings,
  type AcqState,
  type AcqTaskType,
  onBrowserReceipt,
} from "./acquisition-common";
import { AcquisitionLeadsView } from "./acquisition-leads-view";
import { AcquisitionOutreachView } from "./acquisition-outreach-view";
import { AcquisitionProfilesView } from "./acquisition-profiles-view";
import { AcquisitionPlaybooksView } from "./acquisition-playbooks-view";
import { AcquisitionFollowUpsView } from "./acquisition-followups-view";
import { AcquisitionInsightsView } from "./acquisition-insights-view";

/**
 * AI 获客（营销工具）：线索雷达 → 触达编排 → 客户档案 → 销售剧本 → 跟进 → 质检/看板。
 * 采集与触达不在服务器跑：页面签发 5 分钟令牌，AIPDD Enterprise 插件在用户本机已登录的
 * 平台页串行执行；令牌过期由本页自动续期，不重启任务、不丢已采结果。
 */

const PHASE_LABELS: Record<string, string> = {
  idle: "未连接",
  running: "执行中",
  paused: "已暂停",
  "waiting-token": "等待续期",
  stopped: "已停止",
};
const PHASE_COLORS: Record<string, string> = {
  idle: "default",
  running: "processing",
  paused: "warning",
  "waiting-token": "warning",
  stopped: "default",
};

type ViewKey =
  | "leads"
  | "outreach"
  | "profiles"
  | "playbooks"
  | "follow-ups"
  | "insights"
  | "settings";

const VIEWS = [
  { key: "leads", label: "线索雷达" },
  { key: "outreach", label: "触达" },
  { key: "profiles", label: "客户档案" },
  { key: "playbooks", label: "销售剧本" },
  { key: "follow-ups", label: "跟进" },
  { key: "insights", label: "质检与看板" },
  { key: "settings", label: "设置" },
];

export function AcquisitionTab() {
  const { message } = App.useApp();
  const [view, setView] = useState<ViewKey>("leads");
  const [meta, setMeta] = useState<AcqMeta | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [state, setState] = useState<AcqState | null>(null);
  const [starting, setStarting] = useState<AcqTaskType | "">("");
  const [controlling, setControlling] = useState<"pause" | "stop" | "">("");
  /** 插件回传增量结果后自增，列表视图据此刷新。 */
  const [tick, setTick] = useState(0);
  const renewingRef = useRef(false);

  const [settings, setSettings] = useState<AcqSettings | null>(null);
  const [playbooks, setPlaybooks] = useState<AcqPlaybook[]>([]);

  const reloadPlaybooks = useCallback(async () => {
    try {
      const result = await acqApi.playbooks({ query: { page: 1, pageSize: 200 } });
      setPlaybooks(result?.list ?? []);
    } catch {
      // 设置页/触达下拉的剧本清单，失败不打断主流程
    }
  }, []);

  const detect = useCallback(async () => {
    const pong = await pingExtension();
    setVersion(pong?.version ?? null);
  }, []);

  useEffect(() => {
    acqApi
      .meta()
      .then(setMeta)
      .catch(() => message.error("获客元信息读取失败"));
    acqApi
      .settings()
      .then(setSettings)
      .catch(() => message.error("获客设置读取失败"));
    void reloadPlaybooks();
    void detect();
  }, [message, detect, reloadPlaybooks]);

  /** 令牌过期时由页面重新签发：只续期，不重启任务。 */
  const renew = useCallback(async (taskType: string) => {
    if (renewingRef.current) return;
    renewingRef.current = true;
    try {
      const type: AcqTaskType = taskType === "outreach" ? "outreach" : "collect";
      const issued = await acqApi.pluginToken({
        body: { type, pluginVersion: version || undefined },
      });
      if (!issued) {
        message.error("令牌签发失败：接口未返回令牌");
        return;
      }
      const ack = await renewAcqToken(issued.token);
      if (!ack.ok) message.error(ack.errorMsg || "令牌续期失败，请重新启动任务");
    } catch (error) {
      message.error((error as Error).message || "令牌续期失败");
    } finally {
      renewingRef.current = false;
    }
  }, [message, version]);

  useEffect(() => {
    return onAcqEvent((event) => {
      if (event.type === "acq-state") {
        setState(event.state);
        if (event.state.needToken) void renew(event.state.taskType);
        return;
      }
      setTick((value) => value + 1);
      if (event.type === "harvest" && event.done) {
        message.success(
          `采集批次结束：本批新增线索 ${event.newLeads} 条${event.stopReason ? `（${event.stopReason}）` : ""}`,
        );
      }
      if (event.type === "outreach-result") {
        if (event.status === "SENT") message.success("触达任务已回执成功");
        else if (event.error) message.warning(event.error);
      }
      if (event.type === "acq-unknown") {
        message.warning("插件回执上报失败：该条结果未知，系统不会自动重试，请人工核对平台侧");
      }
    });
  }, [message, renew]);

  // 统一回执（§10.7）：插件终态同时回一条标准信封，页面把它挂到服务端浏览器任务队列上，
  // 任务状态不再只存在于插件本地；业务结果仍走 harvest / outreach-result 旧事件落库。
  useEffect(() => {
    return onBrowserReceipt((receipt) => {
      if (receipt.capability !== "acquisition") return;
      void reportAcqTerminalReceipt(receipt);
    });
  }, []);

  const start = async (type: AcqTaskType) => {
    if (!version) {
      message.warning("未检测到 AIPDD Enterprise 插件：请先按下方说明安装，并刷新本页");
      return;
    }
    setStarting(type);
    try {
      const issued = await acqApi.pluginToken({
        body: { type, pluginVersion: version || undefined },
      });
      if (!issued) {
        message.error("令牌签发失败：接口未返回令牌");
        return;
      }
      const ack = await startAcqTask(type, issued.token);
      if (!ack.ok) {
        message.error(
          ack.errorMsg ||
            "插件拒绝接单：请确认插件已安装并启用，然后刷新本页重试",
        );
        return;
      }
      if (ack.state) setState(ack.state);
      message.success(
        type === "collect"
          ? "采集循环已启动：插件会按监控源排队领取任务，逐页采集并回写线索"
          : "触达循环已启动：插件会领取已审核的触达任务，按随机间隔串行执行",
      );
    } catch (error) {
      message.error((error as Error).message || "启动失败");
    } finally {
      setStarting("");
    }
  };

  const control = async (action: "pause" | "stop") => {
    setControlling(action);
    try {
      const ack = await controlAcq(action);
      if (!ack.ok) {
        message.error(ack.errorMsg || "控制指令执行失败");
        return;
      }
      if (ack.state) setState(ack.state);
      message.success(action === "stop" ? "已停止领取新任务" : "已切换暂停/继续");
    } catch (error) {
      message.error((error as Error).message || "控制指令执行失败");
    } finally {
      setControlling("");
    }
  };

  const phase = state?.phase || "idle";
  const busy = ["running", "paused", "waiting-token"].includes(phase);
  const extension = meta?.extension;

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Panel
        title={
          <>
            <ThunderboltOutlined aria-hidden /> 浏览器插件连接
          </>
        }
        titleExtra="采集与触达都在你自己的浏览器里执行：插件复用各平台已登录会话，账号凭据不出本机"
        extra={
          <Space wrap>
            <Tag color={version ? "success" : "warning"}>
              {version ? `插件 v${version}` : "未检测到插件"}
            </Tag>
            <Button
              size="small"
              icon={<ReloadOutlined aria-hidden />}
              onClick={() => void detect()}
            >
              重新检测
            </Button>
            {extension ? (
              <Button
                size="small"
                icon={<DownloadOutlined aria-hidden />}
                href={extension.downloadPath}
                target="_blank"
                rel="noreferrer"
              >
                下载插件
              </Button>
            ) : null}
          </Space>
        }
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Space wrap>
            <Button
              type="primary"
              icon={<PlayCircleOutlined aria-hidden />}
              loading={starting === "collect"}
              disabled={busy}
              onClick={() => void start("collect")}
            >
              启动采集
            </Button>
            <Button
              type="primary"
              icon={<PlayCircleOutlined aria-hidden />}
              loading={starting === "outreach"}
              disabled={busy}
              onClick={() => void start("outreach")}
            >
              启动触达
            </Button>
            <Button
              icon={<PauseCircleOutlined aria-hidden />}
              loading={controlling === "pause"}
              disabled={!busy}
              onClick={() => void control("pause")}
            >
              {phase === "paused" ? "继续" : "暂停"}
            </Button>
            <Button
              danger
              icon={<StopOutlined aria-hidden />}
              loading={controlling === "stop"}
              disabled={!busy && phase !== "stopped"}
              onClick={() => void control("stop")}
            >
              停止
            </Button>
          </Space>
          <Space wrap size={12}>
            <Tag color={PHASE_COLORS[phase] || "default"}>
              {PHASE_LABELS[phase] || phase}
            </Tag>
            {state?.taskType ? (
              <span className="text-12 muted">
                当前任务：{state.taskType === "outreach" ? "触达" : "采集"}
              </span>
            ) : null}
            {state ? (
              <span className="text-12 muted">
                已完成 {state.done} / 共 {state.total} 个任务 · 新增线索{" "}
                {state.newLeads}
              </span>
            ) : null}
          </Space>
          {state?.message ? (
            <Notice variant={phase === "stopped" ? "warn" : "info"}>
              {state.message}
            </Notice>
          ) : null}
          <Collapse
            size="small"
            items={[
              {
                key: "install",
                label: "首次使用：安装插件并信任本站（3 分钟）",
                children: (
                  <Steps
                    orientation="vertical"
                    size="small"
                    current={version ? 4 : 0}
                    status={version ? "finish" : "process"}
                    items={[
                      {
                        title: "下载并解压",
                        content:
                          "点右上角「下载插件」获取 zip，解压到任意固定文件夹；Windows 的「全部解压缩」会得到与压缩包同名的文件夹，里面直接就是 manifest.json。",
                      },
                      {
                        title: "打开扩展管理",
                        content:
                          "地址栏输入 chrome://extensions/，打开右上角「开发者模式」。",
                      },
                      {
                        title: "加载已解压的扩展程序",
                        content:
                          "选择第 1 步解压出的那个文件夹（不用再往里钻一层）。",
                      },
                      {
                        title: "登录各平台",
                        content:
                          "在同一个浏览器里登录要采集/触达的平台（小红书、抖音、知乎、微博、B站、视频号、公众号等）。",
                      },
                      {
                        title: "登录本系统并启动",
                        content:
                          "点工具栏插件图标从右侧拉出侧边栏，在右上角「⋯」里填本系统地址与账号密码登录；回到本页点「启动采集」或「启动触达」。",
                      },
                    ]}
                  />
                ),
              },
            ]}
          />
          <Notice variant="info">
            采集按监控源的日限额与随机间隔串行执行；触达只处理已审核任务并受频控/冷却/黑名单约束。
            令牌 5 分钟有效，过期时本页自动续期；插件回执失败按「结果未知」处理，不自动重试。
          </Notice>
        </Space>
      </Panel>

      <PillTabs
        items={VIEWS}
        value={view}
        onChange={(key) => setView(key as ViewKey)}
      />

      {view === "leads" ? <AcquisitionLeadsView tick={tick} meta={meta} onChanged={() => setTick((v) => v + 1)} /> : null}
      {view === "outreach" ? <AcquisitionOutreachView tick={tick} playbooks={playbooks} /> : null}
      {view === "profiles" ? <AcquisitionProfilesView tick={tick} playbooks={playbooks} /> : null}
      {view === "playbooks" ? <AcquisitionPlaybooksView meta={meta} onChanged={() => void reloadPlaybooks()} /> : null}
      {view === "follow-ups" ? <AcquisitionFollowUpsView tick={tick} /> : null}
      {view === "insights" ? <AcquisitionInsightsView tick={tick} /> : null}
      {view === "settings" ? (
        <AcquisitionSettingsPanel
          settings={settings}
          playbooks={playbooks}
          onSaved={setSettings}
        />
      ) : null}
    </Space>
  );
}

/** 组织级获客设置：限额、活跃时段、AI 模型与默认剧本；插件开关不在这里（插件由上方连接面板控制）。 */
function AcquisitionSettingsPanel({
  settings,
  playbooks,
  onSaved,
}: {
  settings: AcqSettings | null;
  playbooks: AcqPlaybook[];
  onSaved: (next: AcqSettings) => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    form.setFieldsValue({
      ...settings,
      // 0 表示未指定剧本；Select 里用 0 会显示成裸值，回填时转成空。
      defaultPlaybookId: settings.defaultPlaybookId || undefined,
      // TimePicker 只吃 dayjs；设置接口给的是 "HH:mm" 字符串，这里转一次再回填。
      activeHoursStart: dayjs(`2000-01-01T${settings.activeHoursStart}:00`),
      activeHoursEnd: dayjs(`2000-01-01T${settings.activeHoursEnd}:00`),
    });
  }, [settings, form]);

  const asHhmm = (value: unknown, fallback: string) =>
    value && typeof value === "object" && "format" in value
      ? (value as dayjs.Dayjs).format("HH:mm")
      : String(value || fallback).slice(0, 5);

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const next = await acqApi.saveSettings({
        body: {
          enabled: Boolean(values.enabled),
          collectEnabled: Boolean(values.collectEnabled),
          qcEnabled: Boolean(values.qcEnabled),
          outreachAutoSend: Boolean(values.outreachAutoSend),
          humanConfirm: Boolean(values.humanConfirm),
          dailyComments: Number(values.dailyComments ?? 0),
          dailyDm: Number(values.dailyDm ?? 0),
          cooldownDays: Number(values.cooldownDays ?? 0),
          intervalMinSeconds: Number(values.intervalMinSeconds ?? 20),
          intervalMaxSeconds: Number(values.intervalMaxSeconds ?? 60),
          activeHoursStart: asHhmm(values.activeHoursStart, "09:00"),
          activeHoursEnd: asHhmm(values.activeHoursEnd, "21:00"),
          evidenceRetentionDays: Number(values.evidenceRetentionDays ?? 180),
          followUpMaxRounds: Number(values.followUpMaxRounds ?? 2),
          defaultPlaybookId: Number(values.defaultPlaybookId ?? 0),
          aiModel: String(values.aiModel ?? ""),
          aiChannelId: Number(values.aiChannelId ?? 0),
        },
      });
      if (!next) {
        message.error("保存失败：接口未返回设置");
        return;
      }
      onSaved(next);
      message.success("获客设置已保存");
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title={
        <>
          <SettingOutlined aria-hidden /> 获客设置
        </>
      }
      titleExtra="限额与频控同时约束插件执行；改动保存后对新领取的任务生效"
      extra={
        <Button type="primary" loading={saving} onClick={() => void save()}>
          保存设置
        </Button>
      }
    >
      <Form form={form} layout="vertical" disabled={!settings}>
        <Space wrap size={[24, 8]} style={{ marginBottom: 16 }}>
          <Form.Item name="enabled" label="启用获客" valuePropName="checked" tooltip="关闭后插件领取不到任何采集/触达任务">
            <Switch />
          </Form.Item>
          <Form.Item name="collectEnabled" label="允许采集" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="qcEnabled" label="启用质检" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="outreachAutoSend" label="触达自动发送" valuePropName="checked" tooltip="关闭时插件只填好私信/评论，等人工确认后发送">
            <Switch />
          </Form.Item>
          <Form.Item name="humanConfirm" label="人工确认" valuePropName="checked" tooltip="所有私信类动作必须人工在平台页确认">
            <Switch />
          </Form.Item>
        </Space>

        <div className="form-2col">
          <Form.Item name="dailyComments" label="每日评论上限" tooltip="单账号每天评论回复的最大条数">
            <InputNumber min={0} max={500} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="dailyDm" label="每日私信上限" tooltip="单账号每天私信的最大条数">
            <InputNumber min={0} max={500} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="cooldownDays" label="同线索冷却天数" tooltip="同一线索在冷却期内不再重复触达">
            <InputNumber min={0} max={90} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="intervalMinSeconds" label="最小操作间隔（秒）">
            <InputNumber min={5} max={600} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="intervalMaxSeconds"
            label="最大操作间隔（秒）"
            dependencies={["intervalMinSeconds"]}
            rules={[
              ({ getFieldValue }) => ({
                validator: (_rule, value) =>
                  Number(value) >= Number(getFieldValue("intervalMinSeconds") ?? 0)
                    ? Promise.resolve()
                    : Promise.reject(new Error("最大间隔不能小于最小间隔")),
              }),
            ]}
          >
            <InputNumber min={5} max={900} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="activeHoursStart" label="活跃时段开始">
            <TimePicker format="HH:mm" minuteStep={15} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="activeHoursEnd" label="活跃时段结束">
            <TimePicker format="HH:mm" minuteStep={15} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="evidenceRetentionDays" label="证据保留天数">
            <InputNumber min={7} max={730} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="followUpMaxRounds" label="跟进最大轮次">
            <InputNumber min={1} max={5} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="defaultPlaybookId" label="默认销售剧本">
            <Select
              allowClear
              options={playbooks.map((item) => ({
                value: item.id,
                label: `${item.name}（${item.status === "PUBLISHED" ? "已发布" : "草稿"}）`,
              }))}
            />
          </Form.Item>
          <Form.Item name="aiModel" label="AI 模型" tooltip="留空走系统默认模型；填写后质检与剧本预览优先用它">
            <Input placeholder="如 gpt-4o-mini" />
          </Form.Item>
          <Form.Item name="aiChannelId" label="AI 渠道 ID" tooltip="0 表示走系统默认渠道">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </div>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          说明：AI 接待、质检与触达草稿都走统一 AI 网关；未配置模型 Key 时规则降级，不产生不实内容。
          插件版本与下载地址随系统发布更新，连接状态见页面顶部。
        </Typography.Paragraph>
      </Form>
    </Panel>
  );
}
