"use client";

import {
  CheckCircleOutlined,
  ReloadOutlined,
  RobotOutlined,
  SendOutlined,
  SettingOutlined,
  TableOutlined,
  UnorderedListOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  App,
  Avatar,
  Button,
  Input,
  Popconfirm,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
} from "antd";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BIGDATA_DATASETS } from "@enterprise/contracts";
import type { BigdataDatasetKey } from "@enterprise/contracts";
import { Notice, Panel, TabStrip } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import {
  TASK_STATUS_COLOR,
  TASK_STATUS_LABEL,
  bigdataApi,
  filterLabel,
  filterSummary,
  taskSpec,
  type BigdataSettings,
  type BigdataSpec,
  type BigdataTask,
  type ChatMsg,
} from "./bigdata-common";
import { TablePicker, type ResultTableOptions } from "./table-picker";

/**
 * 大数据查询（营销工具里的五个数据集共用一套界面，靠 dataset 参数区分）。
 *
 * 一个工具一个面板，面板内三页签：AI 对话 / 设置 / 任务。
 * 流程：设置里备好默认结果承载表与分析模型（模型 Key 用「API Key 管理」那把 sk-）→
 * 两项齐了才能与 AI 对话，把大白话需求解析成上游筛选条件 / 条数 / 场景 → 选好这一轮写入
 * 哪张结果表（可在候选里换，也可现建一张，不必是默认表）→ 形成查询任务 →
 * 点「开始查询」后台执行，结果按源数据ID 去重后逐批写入该任务指定的结果表。
 */

type UiMessage = { role: "user" | "assistant"; content: string };
type View = "chat" | "settings" | "tasks";

const MISSING_LABEL: Record<string, string> = {
  table: "默认结果多维表格",
  model: "分析模型",
  key: "平台 API Key",
  keyError: "平台 API Key 状态未确认",
};

/** 任务结果表可改的窗口：还没写入前（待执行 / 失败）才允许换目标表。 */
const TABLE_LOCKED = (status: string) =>
  status === "running" || status === "success";

export function BigdataQueryTab({
  dataset,
}: {
  dataset: BigdataDatasetKey;
}) {
  const { message } = App.useApp();
  const definition = BIGDATA_DATASETS[dataset];
  const api = bigdataApi(dataset);

  const [view, setView] = useState<View>("chat");
  const [settings, setSettings] = useState<BigdataSettings | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelsError, setModelsError] = useState("");
  /** 设置页签的草稿：改完要点「保存设置」才写进账号设置（与 RPA 设置页签同一口径）。 */
  const [draftTableId, setDraftTableId] = useState(0);
  const [draftModel, setDraftModel] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  const [tableOptions, setTableOptions] = useState<ResultTableOptions | null>(
    null,
  );
  /** 候选表是不是还在读：读失败时选择器要说「读取失败」，不能一直停在「读取中…」。 */
  const [tableOptionsLoading, setTableOptionsLoading] = useState(true);
  /** 本轮需求要写入的结果表，0＝用设置里的默认表。 */
  const [targetTableId, setTargetTableId] = useState(0);

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatting, setChatting] = useState(false);
  /** 这一轮对话的失败原因：单独显示，不能混进聊天记录（否则会当成 AI 的回答回传给模型）。 */
  const [chatError, setChatError] = useState("");
  const [spec, setSpec] = useState<BigdataSpec | null>(null);
  const [creatingTask, setCreatingTask] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [tasks, setTasks] = useState<BigdataTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState("");
  const [savingTableTaskId, setSavingTableTaskId] = useState(0);

  const reloadSettings = useCallback(async () => {
    const result = await api.settings();
    setSettings(result.data);
    if (result.message) message.error(result.message);
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, message]);

  const reloadTasks = useCallback(async () => {
    const result = await api.tasks();
    if (result.data) {
      setTasks(result.data.list);
      setTasksError("");
    } else {
      // 保留上一次读到的列表，只把「没读取成功」摆出来
      setTasksError(result.message || "任务列表读取失败");
    }
    setTasksLoading(false);
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset]);

  const reloadTableOptions = useCallback(async () => {
    setTableOptionsLoading(true);
    const result = await api.tableOptions();
    setTableOptions(result.data);
    setTableOptionsLoading(false);
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset]);

  useEffect(() => {
    void reloadSettings();
    void reloadTasks();
    void reloadTableOptions();
    void (async () => {
      const [chat, modelResult] = await Promise.all([
        api.messages(),
        api.models(),
      ]);
      if (chat.data) {
        setMessages(
          chat.data
            .filter((item) => item.role === "user" || item.role === "assistant")
            .map((item) => ({
              role: item.role as "user" | "assistant",
              content: item.content,
            })),
        );
      }
      setModels(modelResult.data?.models || []);
      setModelsError(modelResult.message);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadSettings, reloadTasks, reloadTableOptions]);

  // 设置读回来后同步草稿：切数据集、保存成功或读取失败回滚时都回到服务端真实值
  useEffect(() => {
    setDraftTableId(settings?.dataTableId || 0);
    setDraftModel(settings?.model || "");
  }, [settings]);

  // 有任务在跑时每 5 秒刷新一次进度（后台写表是增量更新的）
  useEffect(() => {
    if (!tasks.some((task) => task.status === "running")) return;
    const timer = window.setInterval(() => void reloadTasks(), 5000);
    return () => window.clearInterval(timer);
  }, [tasks, reloadTasks]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, chatting]);

  const missing = ((): string[] => {
    if (!settings) return [];
    const list: string[] = [];
    if (!settings.dataTableExists) list.push(MISSING_LABEL.table);
    if (!settings.model) list.push(MISSING_LABEL.model);
    if (!settings.keyConfigured) {
      list.push(
        settings.keyStatusError ? MISSING_LABEL.keyError : MISSING_LABEL.key,
      );
    }
    return list;
  })();
  const ready = Boolean(settings?.ready);

  /** 提交设置页签的草稿：只发改动过的项（空改动后端拒「没有需要保存的设置」）。 */
  const saveDraftSettings = async () => {
    const payload: Record<string, unknown> = {};
    if (draftTableId !== (settings?.dataTableId || 0)) {
      payload.dataTableId = draftTableId;
    }
    if (draftModel !== (settings?.model || "")) payload.model = draftModel;
    if (!Object.keys(payload).length) {
      message.warning("设置没有改动");
      return;
    }
    setSavingSettings(true);
    try {
      setSettings(await api.saveSettings(payload));
      await reloadTableOptions();
      message.success("设置已保存");
    } catch (error) {
      message.error((error as Error).message);
      await reloadSettings();
    } finally {
      setSavingSettings(false);
    }
  };

  /** 新建一张具名结果表；setDefault 才顶掉设置里的默认表。返回新表 ID 供选择器选中。 */
  const createNamedTable = async (name: string, setDefault: boolean) => {
    const result = await api.createTable({ name, setDefault });
    await Promise.all([reloadSettings(), reloadTableOptions()]);
    message.success(
      `结果表「${result.name}」已生成（${result.fields.length} 列）${
        setDefault ? "，并设为默认结果表" : ""
      }`,
    );
    return result.dataTableId;
  };

  const send = async () => {
    const text = input.trim();
    if (!text || chatting) return;
    setInput("");
    setChatError("");
    const history: ChatMsg[] = [...messages, { role: "user", content: text }];
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setChatting(true);
    try {
      const result = await api.chat({ messages: history });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.reply },
      ]);
      setSpec(result.done && result.spec ? result.spec : null);
    } catch (error) {
      // 失败原因只挂在气泡区下方：写进 messages 会在下一次发送时
      // 被当成 AI 的回答回传给模型，把对话带偏。
      setChatError((error as Error).message || "对话失败");
    } finally {
      setChatting(false);
    }
  };

  const createTask = async () => {
    if (!spec) return;
    setCreatingTask(true);
    try {
      const task = await api.createTask({
        spec,
        dataTableId: targetTableId || undefined,
        rawIntent: messages
          .filter((item) => item.role === "user")
          .map((item) => item.content)
          .join("\n")
          .slice(0, 4000),
      });
      setSpec(null);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `查询任务 #${task.id} 已创建（${filterSummary(dataset, spec.filters)}，目标 ${spec.limit} 条，写入结果表「${task.dataTableName}」）。在「任务」页签点「开始查询」执行。`,
        },
      ]);
      await Promise.all([reloadTasks(), reloadTableOptions()]);
      message.success(`查询任务 #${task.id} 已创建`);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setCreatingTask(false);
    }
  };

  const startTask = async (id: number) => {
    try {
      await api.startTask(id);
      message.success(`任务 #${id} 已开始执行，稍后自动刷新进度`);
      await reloadTasks();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const changeTaskTable = async (id: number, dataTableId: number) => {
    setSavingTableTaskId(id);
    try {
      const task = await api.updateTaskTable(id, dataTableId);
      setTasks((prev) => prev.map((item) => (item.id === id ? task : item)));
      await reloadTableOptions();
      message.success(`任务 #${id} 的结果表已改为「${task.dataTableName}」`);
    } catch (error) {
      message.error((error as Error).message);
      await reloadTasks();
    } finally {
      setSavingTableTaskId(0);
    }
  };

  const removeTask = async (id: number) => {
    try {
      await api.removeTask(id);
      message.success(`任务 #${id} 已删除`);
      await reloadTasks();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const dataTableId = settings?.dataTableId || 0;
  /** 设置页签有没有未保存的改动（按钮只在有改动时可点）。 */
  const settingsDirty =
    draftTableId !== dataTableId || draftModel !== (settings?.model || "");
  /** 「查看」链接跟着草稿走，让用户看清自己正准备写入哪张表。 */
  const shownTableId = draftTableId || dataTableId;
  const shownTableName =
    tableOptions?.tables.find((item) => item.id === shownTableId)?.name ??
    settings?.dataTableActualName ??
    "";

  return (
    <Panel
      title={`${definition.label}（大数据查询）`}
      extra={
        <>
          {/* 页签条与全站一致：贴面板标题行的右端，不贴着标题 */}
          <TabStrip
            items={[
              {
                key: "chat",
                label: (
                  <>
                    <RobotOutlined aria-hidden /> AI 对话
                  </>
                ),
              },
              {
                key: "settings",
                label: (
                  <>
                    <SettingOutlined aria-hidden /> 设置
                  </>
                ),
              },
              {
                key: "tasks",
                label: (
                  <>
                    <UnorderedListOutlined aria-hidden />
                    {tasks.length ? ` 任务（${tasks.length}）` : " 任务"}
                  </>
                ),
              },
            ]}
            value={view}
            onChange={(value) => setView(value as View)}
          />
          {ready ? (
            <Tag color="green" icon={<CheckCircleOutlined aria-hidden />}>
              已就绪
            </Tag>
          ) : null}
        </>
      }
    >
      {!ready ? (
        <Notice variant="warn">
          {`待完成：${missing.join("、") || "设置未确认"}`}
          ，设置齐了才能与 AI 对话提交自然语言。
          <Button
            type="link"
            icon={<SettingOutlined aria-hidden />}
            onClick={() => setView("settings")}
          >
            去设置
          </Button>
        </Notice>
      ) : null}

      {view === "settings" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* 1) 默认结果承载表：选一张写得进去的表，或按模板新建一张（自己填名字） */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              1. 默认结果表（多维表格，新任务默认写入这里，共{" "}
              {definition.columns.length} 列）
            </div>
            <Space orientation="vertical" size={8} style={{ width: "100%" }}>
              <Space wrap>
                <TablePicker
                  options={tableOptions}
                  loading={tableOptionsLoading}
                  value={draftTableId}
                  onChange={setDraftTableId}
                  onCreate={async (name) => {
                    try {
                      // 建表本身是立即动作，但只填进草稿；点「保存设置」才把它设为默认结果表
                      const id = await createNamedTable(name, false);
                      setDraftTableId(id);
                    } catch (error) {
                      message.error((error as Error).message);
                    }
                    return null;
                  }}
                  label="结果表"
                  templateName={definition.tableName}
                  createHint="按模板新建一张结果表（填名字），保存后设为默认结果表"
                />
                {shownTableId ? (
                  <Link href={`/data-table?table=${shownTableId}`}>
                    <TableOutlined aria-hidden /> 查看「{shownTableName}」
                    {shownTableId === dataTableId && settings?.columnCount
                      ? `（${settings.columnCount} 列）`
                      : ""}
                  </Link>
                ) : null}
              </Space>
              <div className="text-12 muted">
                {`下拉只列当前账号写得进去的表（已带齐模板要求的 ${
                  tableOptions?.requiredColumns.length ?? 0
                } 列）；新任务默认写这张表，任务执行前还能按任务单独改选。`}
              </div>
            </Space>
          </div>

          {/* 2) 分析模型 */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              2. 分析模型（调用「API Key 管理」里的平台 API Key）
            </div>
            <Space
              orientation="vertical"
              size={6}
              style={{ width: "100%", maxWidth: 520 }}
            >
              <Select
                style={{ width: 320 }}
                placeholder={modelsError ? "模型列表读取失败" : "选择模型"}
                value={draftModel || undefined}
                options={models.map((item) => ({ value: item, label: item }))}
                onChange={(value) => setDraftModel(String(value))}
                disabled={!settings}
                notFoundContent={
                  modelsError ? "没有可用的 sk- Key 或读取失败" : "暂无"
                }
              />
              <div className="text-12 muted">
                平台 API Key：
                {settings?.keyConfigured ? (
                  <span>
                    已配置 <code>{settings.keyMasked}</code>，可在{" "}
                    <Link href="/developer/keys">API Key 管理</Link>{" "}
                    查看或更换。
                  </span>
                ) : settings?.keyStatusError ? (
                  <span>
                    状态没读取成功（{settings.keyStatusError}），可稍后重试，或在{" "}
                    <Link href="/developer/keys">API Key 管理</Link> 核对。
                  </span>
                ) : (
                  <span>
                    未配置，请先到{" "}
                    <Link href="/developer/keys">API Key 管理</Link>{" "}
                    生成一把 sk- 开头的 Key。
                  </span>
                )}
              </div>
              {modelsError ? (
                <Notice variant="warn">
                  {`模型列表没读取成功：${modelsError}`}
                </Notice>
              ) : null}
            </Space>
          </div>

          {/* 3) 提交：上面两项只是草稿，点这里才落进该数据集的设置 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 10,
            }}
          >
            <span className="text-12 muted">
              {settingsDirty
                ? "有未保存的改动，新任务仍按已保存的设置走"
                : "改完点这里「保存设置」才生效"}
            </span>
            <Button
              type="primary"
              disabled={!settingsDirty}
              loading={savingSettings}
              onClick={() => void saveDraftSettings()}
            >
              保存设置
            </Button>
          </div>
        </div>
      ) : null}

      {view === "chat" ? (
        <>
          <div style={{ marginTop: 12 }}>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>
              这个数据集支持筛选的条件（AI 只会用这些，其余说法会归到最接近的一项）：
            </div>
            <Space size={6} wrap>
              {definition.filters.map((field) => (
                <Tooltip key={field.key} title={field.hint || field.label}>
                  <Tag>{field.label}</Tag>
                </Tooltip>
              ))}
            </Space>
            {definition.valueLanguage === "en" ? (
              <div className="text-12 muted" style={{ marginTop: 8 }}>
                这批数据里的行业、国家、城市等存的是英文，AI
                会先把中文需求翻成英文写法再去查。
              </div>
            ) : null}
          </div>
          <div
            ref={scrollRef}
            style={{
              maxHeight: 420,
              overflowY: "auto",
              padding: "16px 12px",
              marginTop: 12,
              background: "var(--bg-muted)",
              borderRadius: 8,
            }}
          >
            {messages.length === 0 && !chatting ? (
              <div
                className="muted"
                style={{ textAlign: "center", padding: "24px 0", fontSize: 13 }}
              >
                用大白话说要什么数据，{definition.example}
                AI 会追问筛选条件、条数与场景，确认后即可生成查询任务。
              </div>
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {messages.map((msg, index) => (
                <MessageBubble key={index} msg={msg} />
              ))}
              {chatting ? (
                <div
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <Avatar
                    size={32}
                    icon={<RobotOutlined />}
                    style={{ background: "var(--primary)", flexShrink: 0 }}
                  />
                  <span className="muted" style={{ fontSize: 13 }}>
                    <Spin size="small" /> AI 思考中…
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          {chatError ? (
            <Notice variant="warn">
              {`这轮对话没成功：${chatError}。上一条需求没有被 AI 处理，重新描述一次即可（已生成的任务不受影响）。`}
            </Notice>
          ) : null}

          {spec ? (
            <div
              style={{
                marginTop: 12,
                padding: "12px 16px",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--card)",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                <CheckCircleOutlined
                  aria-hidden
                  style={{ color: "var(--success)" }}
                />{" "}
                需求已明确，选择结果表后生成查询任务
              </div>
              <Space size={6} wrap style={{ marginBottom: 10 }}>
                {Object.entries(spec.filters).map(([key, value]) => (
                  <Tag key={key} color="blue">{`${filterLabel(dataset, key)}：${String(value ?? "")}`}</Tag>
                ))}
                <Tag color="purple">{`目标 ${spec.limit} 条`}</Tag>
              </Space>
              {spec.scene ? (
                <div className="text-12 muted" style={{ marginBottom: 10 }}>
                  场景：{spec.scene}
                </div>
              ) : null}
              <div style={{ marginBottom: 12 }}>
                <div className="text-12 muted" style={{ marginBottom: 6 }}>
                  查询结果写入哪张结果表：
                </div>
                <TablePicker
                  options={tableOptions}
                  loading={tableOptionsLoading}
                  value={targetTableId}
                  onChange={setTargetTableId}
                  onCreate={async (name, setDefault) => {
                    try {
                      return await createNamedTable(name, setDefault);
                    } catch (error) {
                      message.error((error as Error).message);
                      return null;
                    }
                  }}
                  label="结果表"
                  templateName={definition.tableName}
                />
              </div>
              <Button
                type="primary"
                loading={creatingTask}
                onClick={() => void createTask()}
              >
                生成查询任务
              </Button>
            </div>
          ) : null}

          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-end",
              marginTop: 12,
            }}
          >
            <Input.TextArea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={
                ready
                  ? `描述要查的${definition.label}，回车发送（Shift+Enter 换行）`
                  : "先完成设置后才能提交自然语言"
              }
              autoSize={{ minRows: 2, maxRows: 4 }}
              disabled={!ready || chatting}
              onPressEnter={(event) => {
                if (!event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <Tooltip title="发送">
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={() => void send()}
                loading={chatting}
                disabled={!ready || !input.trim()}
              />
            </Tooltip>
            {messages.length ? (
              <Tooltip title="清空当前对话，AI 只参考最近 20 条上下文">
                <Button
                  onClick={() => {
                    setMessages([]);
                    setSpec(null);
                  }}
                >
                  重新聊
                </Button>
              </Tooltip>
            ) : null}
          </div>
        </>
      ) : null}

      {view === "tasks" ? (
        <>
          {tasksError ? (
            <Notice variant="warn">
              {`任务列表没读取成功：${tasksError}。下面显示的是上一次读到的内容，可点「刷新」重试。`}
            </Notice>
          ) : null}
          <div style={{ marginBottom: 12 }}>
            <Button
              icon={<ReloadOutlined aria-hidden />}
              onClick={() => {
                void reloadTasks();
                void reloadTableOptions();
              }}
            >
              刷新
            </Button>
          </div>
          <Table<BigdataTask>
            rowKey="id"
            size="small"
            loading={tasksLoading}
            dataSource={tasks}
            pagination={false}
            columns={[
              { title: "编号", dataIndex: "id", width: 70 },
              {
                title: "筛选条件",
                width: 220,
                render: (_, task) => {
                  const specRow = taskSpec(task);
                  return specRow
                    ? filterSummary(dataset, specRow.filters)
                    : "—";
                },
              },
              {
                title: "目标条数",
                width: 90,
                render: (_, task) => taskSpec(task)?.limit ?? "—",
              },
              {
                title: "结果表",
                width: 240,
                render: (_, task) =>
                  TABLE_LOCKED(task.status) ? (
                    <span style={{ fontSize: 13 }}>
                      {task.dataTableName || `多维表格 #${task.dataTableId}`}
                    </span>
                  ) : (
                    <TablePicker
                      options={tableOptions}
                      loading={tableOptionsLoading}
                      value={task.dataTableId}
                      size="small"
                      width={200}
                      disabled={savingTableTaskId === task.id}
                      onChange={(next) => void changeTaskTable(task.id, next)}
                      label="结果表"
                      templateName={definition.tableName}
                    />
                  ),
              },
              {
                title: "状态",
                width: 90,
                render: (_, task) => {
                  const tag = (
                    <Tag color={TASK_STATUS_COLOR[task.status] || "default"}>
                      {TASK_STATUS_LABEL[task.status] || task.status}
                    </Tag>
                  );
                  return task.status === "failed" && task.error ? (
                    <Tooltip title={task.error}>{tag}</Tooltip>
                  ) : (
                    tag
                  );
                },
              },
              {
                title: "取到 / 已存 / 跳过",
                width: 140,
                render: (_, task) => {
                  const counts = `${task.totalFound} / ${task.totalSaved} / ${task.totalSkipped}`;
                  if (task.status !== "success" || task.totalFound > 0) {
                    return counts;
                  }
                  return (
                    <Tooltip title="上游一条都没命中：条件太窄，或关键词写法与库里不一致。换个更宽的说法再生成一次任务。">
                      <Tag color="orange">{counts}</Tag>
                    </Tooltip>
                  );
                },
              },
              {
                title: "创建时间",
                width: 150,
                render: (_, task) => fmtTime(task.createdAt),
              },
              {
                title: "操作",
                width: 300,
                render: (_, task) => (
                  <Space size={6}>
                    <Tooltip
                      title={
                        task.status === "failed"
                          ? "重试执行"
                          : `开始查询并写入${
                              task.dataTableName
                                ? `「${task.dataTableName}」`
                                : "结果表"
                            }`
                      }
                    >
                      <Button
                        type="primary"
                        ghost
                        disabled={
                          task.status === "running" || task.status === "success"
                        }
                        onClick={() => void startTask(task.id)}
                      >
                        {task.status === "failed" ? "重试" : "开始查询"}
                      </Button>
                    </Tooltip>
                    {task.dataTableId ? (
                      <Link href={`/data-table?table=${task.dataTableId}`}>
                        <Button
                          icon={<TableOutlined aria-hidden />}
                        >
                          查看结果
                        </Button>
                      </Link>
                    ) : null}
                    <Popconfirm
                      title={`删除任务 #${task.id}？`}
                      onConfirm={() => void removeTask(task.id)}
                    >
                      <Button
                        danger
                        disabled={task.status === "running"}
                      >
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
          <div className="text-12 muted" style={{ marginTop: 8 }}>
            {`执行在后台进行：按筛选条件查询${definition.label} → 与该任务结果表已有数据按源数据ID
            对照去重（含历史任务已收录的）→ 逐批写入该任务选定的结果表。待执行 / 失败的任务可以换结果表；执行中与已完成的不变更，要存到别的表请新建任务。`}
          </div>
        </>
      ) : null}
    </Panel>
  );
}

function MessageBubble({ msg }: { msg: UiMessage }) {
  const isUser = msg.role === "user";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        gap: 8,
      }}
    >
      {!isUser ? (
        <Avatar
          size={32}
          icon={<RobotOutlined />}
          style={{ background: "var(--primary)", flexShrink: 0 }}
        />
      ) : null}
      <div
        style={{
          maxWidth: "calc(100% - 48px)",
          padding: "10px 14px",
          borderRadius: isUser ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
          background: isUser ? "var(--primary)" : "var(--card)",
          color: isUser ? "#fff" : "var(--text-1)",
          whiteSpace: "pre-wrap",
          fontSize: 13,
          lineHeight: 1.6,
          border: isUser ? "none" : "1px solid var(--border)",
        }}
      >
        {msg.content}
      </div>
      {isUser ? (
        <Avatar
          size={32}
          icon={<UserOutlined />}
          style={{ background: "var(--success)", flexShrink: 0 }}
        />
      ) : null}
    </div>
  );
}
