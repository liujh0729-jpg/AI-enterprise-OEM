"use client";

import {
  ClockCircleOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import type {
  ContentAgentConnector,
  ContentAgentExpert,
  ContentAgentSchedule,
  ContentAgentSchedulePreset,
  ContentAgentScheduleRun,
  ContentAgentPersona,
  ContentAgentPlugin,
  ContentAgentSkill,
  ContentAgentReference,
  ContentLibraryItem,
} from "@enterprise/contracts";
import { CONTENT_AGENT_SCHEDULE_PRESETS } from "@enterprise/contracts";
import {
  App,
  Button,
  Checkbox,
  Drawer,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useRef, useState } from "react";
import { contentApi } from "@/api/content";
import { ScheduleFields } from "@/components/schedule-fields";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { InstructionComposer } from "./instruction-composer";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import {
  EMPTY_SCHEDULE,
  nextRunText,
  scheduleBody,
  scheduleDraftFrom,
  scheduleError,
  scheduleText,
  type ScheduleDraft,
} from "@/lib/schedule";

/**
 * Agent 定时任务：到点把任务自带的指令当成一轮对话交给 Agent 跑，结果落进专属会话。
 * 排期字段、控件与 RPA 任务 / Workbuddy 计划同一套口径（lib/schedule.ts）。
 * 常用任务卡片只做预填，落库仍是普通定时任务。
 */

const PRESET_BY_ID = new Map(
  CONTENT_AGENT_SCHEDULE_PRESETS.map((preset) => [preset.id, preset] as const),
);

const RUN_STATUS_LABEL: Record<string, string> = {
  running: "执行中",
  succeeded: "成功",
  failed: "失败",
};

const RUN_STATUS_COLOR: Record<string, string> = {
  running: "processing",
  succeeded: "success",
  failed: "error",
};

type Editor = {
  open: boolean;
  /** null＝新建 */
  id: number | null;
  preset: string;
  title: string;
  instruction: string;
  schedule: ScheduleDraft;
  channelId: number;
  model: string;
  /** 随任务固定引用的专家（0＝不绑定） */
  expertId: number;
  /** 随任务固定的数字分身（0＝自动：每轮按语义自选） */
  personaId: number;
  /** 引用的技能；空数组＝全部启用中的技能 */
  skillIds: number[];
  /** 引用的插件；空数组＝全部启用中的插件 */
  pluginIds: number[];
  /** 引用的资料库条目；空数组＝整库检索 */
  libraryIds: number[];
  /** 引用的 MCP 连接器；空数组＝全部启用中的连接器（0＝本站 MCP Server） */
  connectorIds: number[];
  /** 无人值守是否允许执行写动作；默认关，放开要验登录密码 */
  allowWrite: boolean;
  /** 库里已有的开关值：只有「从关到开」才触发验密 */
  originAllowWrite: boolean;
  /** 任务固定的参考文件（图片 / 视频 / 音频） */
  references: ContentAgentReference[];
};

const EMPTY_EDITOR: Editor = {
  open: false,
  id: null,
  preset: "",
  title: "",
  instruction: "",
  schedule: { ...EMPTY_SCHEDULE, scheduleType: "recurring", time: "09:00" },
  channelId: 0,
  model: "",
  expertId: 0,
  personaId: 0,
  skillIds: [],
  pluginIds: [],
  libraryIds: [],
  connectorIds: [],
  allowWrite: false,
  originAllowWrite: false,
  references: [],
};

/** 预设模板 → 表单草稿：排期配置原样带进控件，用户可再改。 */
function draftFromPreset(preset: ContentAgentSchedulePreset): ScheduleDraft {
  const config = preset.scheduleConfig || {};
  return {
    ...EMPTY_SCHEDULE,
    scheduleType: preset.scheduleType,
    freq: String(config.freq || "daily"),
    interval: Number(config.interval) === 10 ? 10 : 30,
    time: String(config.time || ""),
    weekdays: Array.isArray(config.weekdays) ? config.weekdays : [],
    day: config.day === undefined ? "" : String(config.day),
  };
}

/** 任务列第二行：这次执行固定引用什么（专家 / 技能 / 插件 / 资料 / 连接器 / 邮箱）。 */
function refText(row: ContentAgentSchedule) {
  return [
    row.expertName ? `专家：${row.expertName}` : "未绑定专家",
    row.personaName ? `分身：${row.personaName}` : "分身：自动",
    row.skillIds.length ? `技能 ${row.skillIds.length} 项` : "技能：全部启用",
    row.pluginIds.length ? `插件 ${row.pluginIds.length} 个` : "插件：全部启用",
    row.libraryIds.length ? `资料 ${row.libraryIds.length} 项` : "资料：整库检索",
    row.connectorIds.length
      ? `连接器 ${row.connectorIds.length} 个`
      : "连接器：全部启用",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function AgentSchedulesTab({
  onOpenConversation,
}: {
  /** 执行记录里「查看会话」：把结果会话交给对话页签打开。 */
  onOpenConversation: (conversationId: number) => void;
}) {
  const { message } = App.useApp();
  const { request: confirmPassword, modal: passwordModal } =
    usePasswordConfirm();
  const [rows, setRows] = useState<ContentAgentSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [runningId, setRunningId] = useState<number | null>(null);

  const [channels, setChannels] = useState<{ value: number; label: string }[]>(
    [],
  );
  const [slot, setSlot] = useState({ channelId: 0, model: "" });
  const [editor, setEditor] = useState<Editor>(EMPTY_EDITOR);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [saving, setSaving] = useState(false);
  const modelsSeqRef = useRef(0);

  // 弹窗里可引用的专家 / 技能 / 插件 / 资料：第一次打开弹窗时取一次，取不到只影响这几项
  const [skills, setSkills] = useState<ContentAgentSkill[]>([]);
  const [plugins, setPlugins] = useState<ContentAgentPlugin[]>([]);
  const [experts, setExperts] = useState<ContentAgentExpert[]>([]);
  const [library, setLibrary] = useState<ContentLibraryItem[]>([]);
  const [connectors, setConnectors] = useState<ContentAgentConnector[]>([]);
  const [personas, setPersonas] = useState<ContentAgentPersona[]>([]);
  const [auxLoading, setAuxLoading] = useState(false);
  const [auxError, setAuxError] = useState("");
  const auxLoadedRef = useRef(false);

  const [runsFor, setRunsFor] = useState<ContentAgentSchedule | null>(null);
  const [runs, setRuns] = useState<ContentAgentScheduleRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await contentApi.schedules();
      setRows(list || []);
      setError("");
    } catch (caught) {
      setError((caught as Error).message || "定时任务清单读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 渠道清单与「模型设置 → 文本」槽位：读不到只影响弹窗默认值，不挡清单
  useEffect(() => {
    void (async () => {
      try {
        const settings = await contentApi.settings();
        if (!settings) return;
        setChannels(
          settings.channels.map((item) => ({
            value: item.id,
            label: item.id === 0 ? `${item.name}（内置）` : item.name,
          })),
        );
        const textSlot = settings.slots.find((item) => item.mediaType === "text");
        setSlot({
          channelId: textSlot?.channelId ?? 0,
          model: textSlot?.model || "",
        });
      } catch {
        // 读不到渠道时弹窗仍可保存，模型沿用清单里的值
      }
    })();
  }, []);

  /** 弹窗里的专家 / 技能 / 插件 / 资料清单：与对话页签「+」里的是同一批数据。 */
  const loadAux = useCallback(async () => {
    setAuxLoading(true);
    try {
      const [
        skillRows,
        pluginRows,
        expertRows,
        libraryRows,
        connectorRows,
        personaRows,
      ] = await Promise.all([
        contentApi.skills(),
        contentApi.plugins(),
        contentApi.experts(),
        contentApi.library(),
        contentApi.connectors(),
        contentApi.personas(),
      ]);
      setSkills(skillRows || []);
      setPlugins(pluginRows || []);
      setExperts(expertRows || []);
      setLibrary(libraryRows || []);
      setConnectors(connectorRows || []);
      setPersonas(personaRows || []);
      setAuxError("");
      auxLoadedRef.current = true;
    } catch (caught) {
      setAuxError((caught as Error).message || "专家、技能、插件与资料清单读取失败");
    } finally {
      setAuxLoading(false);
    }
  }, []);

  /**
   * 按渠道取文本模型清单：只取清单、不替用户选模型（先选渠道、再选模型）。
   * preferred 不在清单里也保留（已存任务的自订模型名不能被改掉）。
   */
  const loadModels = useCallback(
    async (channelId: number, preferred: string) => {
      // 连续换渠道时只认最后一次请求，先发的慢响应不能覆盖后选的渠道
      const seq = ++modelsSeqRef.current;
      setModelsLoading(true);
      setModelsError("");
      try {
        const result = await contentApi.models({ query: { channelId } });
        if (seq !== modelsSeqRef.current) return;
        setModelOptions(
          (result?.models || [])
            .filter((item) => item.kind === "text")
            .map((item) => item.id),
        );
      } catch (caught) {
        if (seq !== modelsSeqRef.current) return;
        setModelOptions([]);
        setModelsError((caught as Error).message || "模型清单读取失败");
      } finally {
        if (seq === modelsSeqRef.current) {
          setEditor((prev) =>
            prev.open ? { ...prev, model: preferred } : prev,
          );
          setModelsLoading(false);
        }
      }
    },
    [],
  );

  const openCreate = (preset?: ContentAgentSchedulePreset) => {
    const base: Editor = {
      ...EMPTY_EDITOR,
      open: true,
      preset: preset?.id || "",
      title: preset?.title || "",
      instruction: preset?.instruction || "",
      schedule: preset ? draftFromPreset(preset) : EMPTY_EDITOR.schedule,
      channelId: slot.channelId,
      model: slot.model,
      // 模板自带的连接器（如邮件模板固定引用本站 MCP Server）
      connectorIds: preset?.connectorIds || [],
    };
    setEditor(base);
    if (!auxLoadedRef.current && !auxLoading) void loadAux();
    void loadModels(slot.channelId, slot.model);
  };

  const openEdit = (row: ContentAgentSchedule) => {
    setEditor({
      open: true,
      id: row.id,
      preset: row.preset,
      title: row.title,
      instruction: row.instruction,
      schedule: scheduleDraftFrom(row),
      channelId: row.channelId,
      model: row.model,
      expertId: row.expertId,
      personaId: row.personaId,
      skillIds: row.skillIds,
      pluginIds: row.pluginIds,
      libraryIds: row.libraryIds,
      connectorIds: row.connectorIds,
      allowWrite: row.allowWrite,
      originAllowWrite: row.allowWrite,
      references: row.references,
    });
    if (!auxLoadedRef.current && !auxLoading) void loadAux();
    void loadModels(row.channelId, row.model);
  };

  const patchEditor = (next: Partial<Editor>) =>
    setEditor((prev) => ({ ...prev, ...next }));
  const patchSchedule = (next: Partial<ScheduleDraft>) =>
    setEditor((prev) => ({
      ...prev,
      schedule: { ...prev.schedule, ...next },
    }));

  const channelOptions = (() => {
    const list = channels.length ? [...channels] : [{ value: 0, label: "AIPDD 内置" }];
    if (!list.some((item) => item.value === editor.channelId)) {
      list.unshift({
        value: editor.channelId,
        label:
          editor.channelId === 0 ? "AIPDD 内置" : `渠道 #${editor.channelId}`,
      });
    }
    return list;
  })();

  const modelSelectOptions = (
    modelOptions.includes(editor.model) || !editor.model
      ? modelOptions
      : [editor.model, ...modelOptions]
  ).map((id) => ({ value: id, label: id }));

  /** 落库：新建与编辑走同一份表单；验密通过的那次把密码一起带上（服务端只拿来核对，不入库）。 */
  const persist = async (body: Record<string, unknown>) => {
    setSaving(true);
    try {
      if (editor.id) {
        await contentApi.updateSchedule({
          params: { id: String(editor.id) },
          body,
        });
        message.success("定时任务已更新");
      } else {
        await contentApi.saveSchedule({
          body: { ...body, preset: editor.preset },
        });
        message.success("定时任务已创建，到点自动执行");
      }
      setEditor(EMPTY_EDITOR);
      await load();
    } catch (caught) {
      message.error((caught as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    const title = editor.title.trim();
    if (!title) {
      message.error("请给定时任务起个名字");
      return;
    }
    if (!editor.instruction.trim()) {
      message.error("要写清每次执行时让 Agent 做什么");
      return;
    }
    const scheduleProblem = scheduleError(editor.schedule);
    if (scheduleProblem) {
      message.error(scheduleProblem);
      return;
    }
    // 先渠道后模型：换了渠道就必须在这个渠道里挑一个，不能留空等模型设置的默认值
    if (!editor.model.trim() && editor.channelId !== slot.channelId) {
      message.error("先选渠道，再给这个渠道选一个模型");
      return;
    }
    const body: Record<string, unknown> = {
      title,
      instruction: editor.instruction.trim(),
      ...scheduleBody(editor.schedule),
      channelId: editor.channelId,
      model: editor.model.trim(),
      expertId: editor.expertId,
      personaId: editor.personaId,
      skillIds: editor.skillIds,
      pluginIds: editor.pluginIds,
      libraryIds: editor.libraryIds,
      connectorIds: editor.connectorIds,
      mailboxIds: [],
      allowWrite: editor.allowWrite,
      references: editor.references,
    };
    // 无人值守写动作等于让机器半夜替自己改数据：从关到开要验本站登录密码，服务端再判一次
    if (editor.allowWrite && !editor.originAllowWrite) {
      confirmPassword({
        title: "允许自动执行写动作",
        content:
          "勾选后这个定时任务到点会真的替你改数据、发消息，不再逐次确认；不勾选时任务只读取与出草案。要放开请输入本站登录密码（签约、报税提交、开票、外呼导入永远不放开）。",
        okText: "验证并保存",
        onOk: (password) => persist({ ...body, password }),
      });
      return;
    }
    await persist(body);
  };

  const toggleStatus = async (row: ContentAgentSchedule) => {
    const next = row.status === "paused" ? "enabled" : "paused";
    try {
      await contentApi.updateSchedule({
        params: { id: String(row.id) },
        body: { status: next },
      });
      message.success(next === "paused" ? "已暂停，到点不再执行" : "已启用");
      await load();
    } catch (caught) {
      message.error((caught as Error).message || "状态修改失败");
    }
  };

  const remove = async (row: ContentAgentSchedule) => {
    try {
      await contentApi.removeSchedule({ params: { id: String(row.id) } });
      message.success("已删除");
      if (runsFor?.id === row.id) setRunsFor(null);
      await load();
    } catch (caught) {
      message.error((caught as Error).message || "删除失败");
    }
  };

  const loadRuns = useCallback(async (scheduleId: number) => {
    setRunsLoading(true);
    try {
      const list = await contentApi.scheduleRuns({
        params: { id: String(scheduleId) },
      });
      setRuns(list || []);
      setRunsError("");
    } catch (caught) {
      setRunsError((caught as Error).message || "执行记录读取失败");
    } finally {
      setRunsLoading(false);
    }
  }, []);

  const openRuns = (row: ContentAgentSchedule) => {
    setRunsFor(row);
    setRuns([]);
    void loadRuns(row.id);
  };

  const runNow = async (row: ContentAgentSchedule) => {
    setRunningId(row.id);
    try {
      const run = await contentApi.runScheduleNow(
        { params: { id: String(row.id) } },
        { timeoutMs: 180000 },
      );
      if (run?.status === "succeeded") {
        message.success("执行完成，可在「执行记录」里打开这轮对话看产出");
      } else {
        message.error(run?.error || "执行失败，请到「执行记录」查看原因");
      }
      await load();
      if (runsFor?.id === row.id) await loadRuns(row.id);
    } catch (caught) {
      message.error((caught as Error).message || "执行失败");
      await load();
    } finally {
      setRunningId(null);
    }
  };

  /** 用内置 AIPDD 渠道的任务：到点执行没有登录态，只会失败，提前指出来。 */
  const builtinChannelCount = rows.filter(
    (row) => row.status === "enabled" && row.channelId === 0,
  ).length;

  const columns: ColumnsType<ContentAgentSchedule> = [
    {
      title: "任务",
      key: "title",
      width: 260,
      render: (_, row) => (
        <div>
          <Space size={4} wrap>
            <b>{row.title}</b>
            {row.preset && PRESET_BY_ID.has(row.preset) ? (
              <Tag color="blue">{PRESET_BY_ID.get(row.preset)?.title}</Tag>
            ) : null}
            {row.status === "paused" ? <Tag>已暂停</Tag> : null}
            {row.allowWrite ? (
              <Tooltip title="这个任务到点可以自己改数据、发消息（已验密放开）">
                <Tag color="orange">自动写动作</Tag>
              </Tooltip>
            ) : null}
          </Space>
          <div className="text-12 muted" style={{ marginTop: 2 }}>
            {refText(row)}
          </div>
        </div>
      ),
    },
    {
      title: "排期",
      key: "schedule",
      width: 200,
      render: (_, row) => scheduleText(row),
    },
    {
      title: "下次执行",
      key: "nextRun",
      width: 150,
      render: (_, row) =>
        row.status === "paused" ? "已暂停" : nextRunText(row),
    },
    {
      title: "模型选择",
      key: "model",
      width: 220,
      render: (_, row) => (
        <div>
          <div style={{ wordBreak: "break-all" }}>
            {row.model || "模型设置默认"}
          </div>
          <div className="text-12 muted">
            {channels.find((item) => item.value === row.channelId)?.label ||
              (row.channelId === 0 ? "AIPDD 内置" : `渠道 #${row.channelId}`)}
          </div>
        </div>
      ),
    },
    {
      title: "最近执行",
      key: "lastRun",
      width: 180,
      render: (_, row) => {
        if (!row.lastRunAt) return <span className="muted">还没执行过</span>;
        return (
          <div>
            <div>{fmtTime(row.lastRunAt)}</div>
            {row.lastStatus === "succeeded" ? (
              <Tag color="success">成功</Tag>
            ) : (
              <Tooltip title={row.lastError}>
                <Tag color="error">失败</Tag>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    {
      title: "执行次数",
      dataIndex: "runCount",
      key: "runCount",
      width: 90,
    },
    {
      title: "操作",
      key: "actions",
      width: 320,
      render: (_, row) => (
        <Space size={4} wrap>
          <Button
            type="primary"
            loading={runningId === row.id}
            onClick={() => void runNow(row)}
          >
            立即执行
          </Button>
          <Button onClick={() => openRuns(row)}>执行记录</Button>
          <Button onClick={() => openEdit(row)}>编辑</Button>
          <Button onClick={() => void toggleStatus(row)}>
            {row.status === "paused" ? "启用" : "暂停"}
          </Button>
          <Popconfirm
            title="删除这个定时任务？"
            description="执行记录会一并删除；已经产出的会话与内容保留。"
            okText="删除"
            cancelText="取消"
            onConfirm={() => void remove(row)}
          >
            <Button danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const runColumns: ColumnsType<ContentAgentScheduleRun> = [
    {
      title: "开始时间",
      dataIndex: "startedAt",
      key: "startedAt",
      width: 150,
      render: (value: string) => fmtTime(value),
    },
    {
      title: "触发",
      dataIndex: "trigger",
      key: "trigger",
      width: 80,
      render: (value: string) => (value === "manual" ? "手动" : "定时"),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (value: string) => (
        <Tag color={RUN_STATUS_COLOR[value] || "default"}>
          {RUN_STATUS_LABEL[value] || value}
        </Tag>
      ),
    },
    {
      title: "结果",
      key: "result",
      width: 300,
      render: (_, row) => {
        const text = row.summary || row.error;
        if (!text) return <span className="muted">—</span>;
        return (
          <Tooltip title={text}>
            <div
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: row.error ? "var(--danger)" : undefined,
              }}
            >
              {text}
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: "操作",
      key: "actions",
      width: 110,
      render: (_, row) =>
        row.conversationId > 0 ? (
          <Button onClick={() => onOpenConversation(row.conversationId)}>
            查看会话
          </Button>
        ) : (
          <span className="muted">—</span>
        ),
    },
  ];

  return (
    <>
      <div className="tool-group" style={{ marginBottom: 16 }}>
        {CONTENT_AGENT_SCHEDULE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="tool-card"
            onClick={() => openCreate(preset)}
          >
            <span className="tool-name">{preset.title}</span>
            <span className="tool-hint">{preset.description}</span>
            <span className="text-12 muted">要先接：{preset.requires}</span>
          </button>
        ))}
      </div>

      <Panel
        title="定时任务"
        titleExtra={
          <span className="text-12 muted">
            到点把指令当成一轮对话交给 Agent 执行，结果落进这条任务专属的会话
          </span>
        }
        extra={
          <Button icon={<PlusOutlined aria-hidden />} onClick={() => openCreate()}>
            新建定时任务
          </Button>
        }
      >
        {error ? <Notice variant="error">{error}</Notice> : null}
        {builtinChannelCount ? (
          <Notice variant="warn">
            {`有 ${builtinChannelCount} 条任务用的是内置 AIPDD 渠道：到点执行没有登录态，取不到账号 Key，会自动失败（原因记在执行记录里）。请编辑这些任务，改选一个自定义渠道并固定模型；「立即执行」不受影响。`}
          </Notice>
        ) : null}
        {!loading && !rows.length ? (
          <EmptyState
            icon={<ClockCircleOutlined style={{ fontSize: 40 }} aria-hidden />}
            text="还没有定时任务：点上面四张常用任务卡片，或「新建定时任务」自己写指令与排期"
          />
        ) : (
          <Table<ContentAgentSchedule>
            size="small"
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={rows}
            pagination={false}
            scroll={{ x: "max-content" }}
          />
        )}
      </Panel>

      <Modal
        open={editor.open}
        title={editor.id ? "编辑定时任务" : "新建定时任务"}
        width={760}
        okText={editor.id ? "保存修改" : "创建定时任务"}
        cancelText="取消"
        confirmLoading={saving}
        onOk={() => void submit()}
        onCancel={() => {
          if (!saving) setEditor(EMPTY_EDITOR);
        }}
        destroyOnHidden
      >
        <div className="data-table-form">
          <label
            className="data-table-form-item"
            style={{ gridColumn: "1 / -1" }}
          >
            <span className="data-table-form-label">
              任务名称<b style={{ color: "var(--danger)" }}> *</b>
            </span>
            <Input
              value={editor.title}
              maxLength={80}
              placeholder="例如：每日行业要闻简报"
              onChange={(event) => patchEditor({ title: event.target.value })}
            />
          </label>
          <InstructionComposer
            value={editor.instruction}
            onChange={(value) => patchEditor({ instruction: value })}
            skillIds={editor.skillIds}
            onSkillIds={(ids) => patchEditor({ skillIds: ids })}
            pluginIds={editor.pluginIds}
            onPluginIds={(ids) => patchEditor({ pluginIds: ids })}
            expertId={editor.expertId}
            onExpertId={(id) => patchEditor({ expertId: id })}
            connectorIds={editor.connectorIds}
            onConnectorIds={(ids) => patchEditor({ connectorIds: ids })}
            references={editor.references}
            onReferences={(items) => patchEditor({ references: items })}
            skills={skills}
            plugins={plugins}
            experts={experts}
            connectors={connectors}
            loading={auxLoading}
            error={auxError}
          />
          <ScheduleFields
            draft={editor.schedule}
            onChange={patchSchedule}
            allowOnce={false}
            allowMinuteInterval
          />
          <label className="data-table-form-item">
            <span className="data-table-form-label">数字分身</span>
            <Select
              value={editor.personaId}
              options={[
                { value: 0, label: "自动（按每轮语义自选）" },
                ...personas.map((item) => ({
                  value: item.id,
                  label: item.name,
                })),
              ]}
              onChange={(value) => patchEditor({ personaId: value })}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">执行渠道</span>
            <Select
              value={editor.channelId}
              options={channelOptions}
              placeholder="先选渠道"
              onChange={(value) => {
                patchEditor({ channelId: value, model: "" });
                void loadModels(value, "");
              }}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">模型选择</span>
            <Select
              showSearch
              loading={modelsLoading}
              disabled={modelsLoading || !modelSelectOptions.length}
              value={editor.model || undefined}
              options={modelSelectOptions}
              placeholder={
                modelsLoading
                  ? "正在读取模型…"
                  : modelsError
                    ? "模型清单读取失败"
                    : !modelSelectOptions.length
                      ? "该渠道没有文本模型"
                      : editor.channelId === slot.channelId
                        ? "留空＝模型设置里的文本模型"
                        : "选这个渠道里的一个模型"
              }
              onChange={(value) => patchEditor({ model: value || "" })}
            />
          </label>
          <label className="data-table-form-item">
            <span className="data-table-form-label">引用资料</span>
            <Select
              mode="multiple"
              allowClear
              loading={auxLoading}
              value={editor.libraryIds}
              maxTagCount="responsive"
              options={library.map((item) => ({
                value: item.id,
                label: item.name,
                disabled: item.status !== "ready",
              }))}
              placeholder="不选＝整库检索"
              onChange={(value: number[]) =>
                patchEditor({ libraryIds: value })
              }
            />
            <span className="text-12 muted">
              勾选后每次执行只在这些资料里检索；不选＝整库检索。
            </span>
          </label>
          <label
            className="data-table-form-item"
            style={{ gridColumn: "1 / -1" }}
          >
            <span className="data-table-form-label">无人值守权限</span>
            <Checkbox
              checked={editor.allowWrite}
              onChange={(event) =>
                patchEditor({ allowWrite: event.target.checked })
              }
            >
              允许自动执行写动作
            </Checkbox>
            <span className="text-12 muted">
              {editor.allowWrite && editor.originAllowWrite
                ? "这个任务已经放开自动写动作；取消勾选即可收回，不需要密码。"
                : "默认关闭：到点只读取数据、生成草案，要改数据或发消息得你在对话里确认。勾选后本任务可以不问就执行修改类动作，保存时要验证本站登录密码。"}
            </span>
          </label>
        </div>
        {modelsError ? (
          <div className="text-12 muted" style={{ marginTop: 6 }}>
            {modelsError}
          </div>
        ) : null}
        {auxError ? (
          <div className="text-12 muted" style={{ marginTop: 6 }}>
            {`专家、技能、资料与连接器清单读取失败：${auxError}`}
          </div>
        ) : null}
        {editor.channelId === 0 ? (
          <div style={{ marginTop: 10 }}>
            <Notice variant="warn">
              定时到点执行时没有登录态：内置 AIPDD 渠道要凭登录态取账号
              Key，自动执行会失败并记下原因。要无人值守，请选一个自定义渠道并固定模型；「立即执行」会用当前登录态，不受影响。
            </Notice>
          </div>
        ) : null}
      </Modal>

      <Drawer
        open={Boolean(runsFor)}
        title={runsFor ? `执行记录 · ${runsFor.title}` : "执行记录"}
        size={760}
        onClose={() => setRunsFor(null)}
      >
        {runsError ? <Notice variant="error">{runsError}</Notice> : null}
        {!runsLoading && !runs.length ? (
          <EmptyState text="还没有执行记录：到点执行或点「立即执行」后会在这里留痕" />
        ) : (
          <Table<ContentAgentScheduleRun>
            size="small"
            rowKey="id"
            loading={runsLoading}
            columns={runColumns}
            dataSource={runs}
            pagination={false}
            scroll={{ x: "max-content" }}
          />
        )}
      </Drawer>

      {passwordModal}
    </>
  );
}
