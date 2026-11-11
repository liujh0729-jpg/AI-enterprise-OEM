"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Descriptions,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Select,
  Space,
  Spin,
  Steps,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from "antd";
import {
  CodeOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FileAddOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  LockOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RocketOutlined,
  SendOutlined,
  StopOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { EmptyState, Notice, Panel, PanelTabs } from "@/components/ui/panel";
import {
  AI_CODE_CONFIRM_TEXT,
  aiCodeApi,
  downloadAiCodePatch,
  streamChat,
  uploadAiCodeFile,
  type AiCodeEdit,
  type AiCodeEditsResult,
  type AiCodeMessage,
  type AiCodeModel,
  type AiCodeOverview,
  type AiCodeSessionDetail,
} from "@/api/ai-code";
import { upgradeApi, type UpgradeJob } from "@/api/upgrade";
import { presentMutationError } from "@/query/errors";
import { fmtTime } from "@/lib/datetime";
import { markdownToHtml } from "@/lib/markdown-html";
import { PermissionNotice, useAdminData } from "./common";

/* ============================================================
   平台管理后台「AI 编程」（后台自助改码）：
   1. 进入需二次输入登录密码（危险告知：建议先线下优化再部署）
   2. 选模型 → 对话 + 上传参考图 / 文件，模型只用 code__ 工具改暂存区
   3. 「变更」页签按文件展示 unified diff，可逐文件采纳 / 弃用
   4. 默认「导出补丁包」线下部署；「备份并执行」为高危选项，需三重闸
   执行复用平台升级执行器（备份 / 维护模式 / 构建 / 迁移 / 重启 / 回滚）
   ============================================================ */

const CHANGE_META: Record<
  AiCodeEdit["changeType"],
  { label: string; color: string; icon: React.ReactNode }
> = {
  added: { label: "新增", color: "green", icon: <FileAddOutlined /> },
  modified: { label: "修改", color: "orange", icon: <FileTextOutlined /> },
  deleted: { label: "删除", color: "red", icon: <DeleteOutlined /> },
};

const EDIT_STATUS_META: Record<
  AiCodeEdit["status"],
  { label: string; color: string }
> = {
  pending: { label: "待审阅", color: "default" },
  approved: { label: "已采纳", color: "green" },
  rejected: { label: "已弃用", color: "default" },
  applied: { label: "已应用", color: "blue" },
};

const JOB_STATUS: Record<string, { label: string; color: string }> = {
  PENDING: { label: "排队中", color: "default" },
  RUNNING: { label: "执行中", color: "processing" },
  SUCCESS: { label: "已完成", color: "green" },
  FAILED: { label: "失败", color: "red" },
  CANCELLED: { label: "已取消", color: "default" },
  INTERRUPTED: { label: "已中断", color: "red" },
  ROLLED_BACK: { label: "已自动回滚", color: "orange" },
};

const STEP_STATUS: Record<
  NonNullable<UpgradeJob["steps"][number]["status"]>,
  "wait" | "process" | "finish" | "error"
> = {
  PENDING: "wait",
  RUNNING: "process",
  SUCCESS: "finish",
  FAILED: "error",
  SKIPPED: "finish",
};

const ACTIVE = ["PENDING", "RUNNING"];

function fmtBytes(bytes: number) {
  if (!bytes) return "0";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function jobStatusTag(status: string) {
  const meta = JOB_STATUS[status] || { label: status, color: "default" };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

/** 顶部红色危险告知条：整页固定，未解锁前只显示它 + 密码输入。 */
function DangerBanner() {
  return (
    <Alert
      type="error"
      showIcon
      icon={<WarningOutlined />}
      title="非常危险：本功能会直接改写本系统正在运行的源码，并触发构建与重启"
      description="强烈建议先在本地 / 线下环境优化并验证后再部署；不要直接在生产上改、直接重启。任何改动都先落在暂存区，只有你确认「备份并执行」后才会真正生效。"
    />
  );
}

/** unified diff 逐行染色渲染。 */
function DiffView({ diff }: { diff: string }) {
  if (!diff) return <span className="muted">（无差异内容）</span>;
  return (
    <pre className="ai-code-diff">
      {diff.split("\n").map((line, index) => {
        const cls = line.startsWith("+")
          ? "add"
          : line.startsWith("-")
            ? "del"
            : line.startsWith("@@")
              ? "hunk"
              : "ctx";
        return (
          <div key={index} className={`ai-code-diff-line ${cls}`}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

/** 参考附件卡片（图片预览 / 文件链接）。 */
function ReferenceChips({
  references,
}: {
  references: AiCodeMessage["references"];
}) {
  if (!references.length) return null;
  return (
    <Space wrap size={6} style={{ marginTop: 8 }}>
      {references.map((ref, index) => {
        const isImage = /\.(png|jpe?g|webp|gif)$/i.test(ref.name);
        return (
          <a
            key={`${index}-${ref.name}`}
            className="ai-code-ref"
            href={ref.url}
            target="_blank"
            rel="noreferrer"
          >
            {isImage ? <FileExcelOutlined /> : <FileTextOutlined />}
            <span>{ref.name}</span>
          </a>
        );
      })}
    </Space>
  );
}

/** 单条消息气泡：用户 / 助手，助手附带工具调用留痕。 */
function MessageBubble({ message }: { message: AiCodeMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`ai-code-msg${isUser ? " mine" : ""}`}>
      <div className={`ai-code-bubble${isUser ? " user" : " agent"}`}>
        {message.content ? (
          isUser ? (
            <div className="ai-code-plain">{message.content}</div>
          ) : (
            <div
              className="ai-code-md"
              dangerouslySetInnerHTML={{ __html: markdownToHtml(message.content) }}
            />
          )
        ) : message.status === "STREAMING" ? (
          <Space size={8}>
            <Spin size="small" />
            <span className="muted">模型思考中…</span>
          </Space>
        ) : (
          <span className="muted">（本轮没有文字输出，只调用了工具）</span>
        )}

        {message.error ? (
          <Alert type="error" showIcon title={message.error} style={{ marginTop: 8 }} />
        ) : null}

        {message.toolCalls.length ? (
          <div className="ai-code-tools">
            {message.toolCalls.map((call, index) => (
              <Tooltip
                key={`${index}-${call.name}`}
                title={<pre className="ai-code-tool-tip">{call.output || "无输出"}</pre>}
                placement="left"
              >
                <Tag color={call.status === "error" ? "red" : "geekblue"}>
                  <CodeOutlined /> {call.name.replace("code__", "")}
                </Tag>
              </Tooltip>
            ))}
          </div>
        ) : null}

        <ReferenceChips references={message.references} />
        <div className="ai-code-msg-time">{message.createdAt ? fmtTime(message.createdAt) : ""}</div>
      </div>
    </div>
  );
}
function UnlockGate({
  overview,
  onUnlocked,
}: {
  overview: AiCodeOverview | null;
  onUnlocked: () => void;
}) {
  const { message } = App.useApp();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!password.trim()) {
      message.warning("请输入当前账号密码");
      return;
    }
    setBusy(true);
    try {
      const result = await aiCodeApi.unlock({ body: { password: password.trim() } });
      if (result?.unlocked) {
        setPassword("");
        message.success(`已解锁，${result.ttlMinutes} 分钟内可对话改码`);
        onUnlocked();
      }
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="进入需要重新验证身份">
      <Space orientation="vertical" size={14} style={{ width: "100%" }}>
        <Notice variant="warn">
          为避免误操作，进入 AI 编程需要再次输入当前登录账号密码。解锁票据短时有效，过期后需重新验证；
          采纳 / 弃用、写文件、导出与在线应用都必须处于解锁状态。
        </Notice>
        <Descriptions
          bordered
          size="small"
          column={{ xs: 1, md: 2 }}
          items={[
            { key: "version", label: "当前版本", children: overview?.workspace.version || "—" },
            {
              key: "root",
              label: "工作区",
              children: <Typography.Text code>{overview?.workspace.root || "—"}</Typography.Text>,
            },
            { key: "mode", label: "部署方式", children: overview?.workspace.deploymentMode || "—" },
            { key: "model", label: "默认模型", children: overview?.model || "未配置" },
          ]}
        />
        <Space>
          <Input.Password
            style={{ width: 280 }}
            value={password}
            placeholder="请输入当前账号密码"
            prefix={<LockOutlined />}
            onChange={(event) => setPassword(event.target.value)}
            onPressEnter={submit}
          />
          <Button type="primary" loading={busy} onClick={submit}>
            解锁进入
          </Button>
        </Space>
      </Space>
    </Panel>
  );
}

export function AiCodeTab() {
  const { message, modal } = App.useApp();
  const overview = useAdminData("admin-ai-code-overview", (signal) =>
    aiCodeApi.overview({}, { signal }),
  );
  const sessions = useAdminData("admin-ai-code-sessions", (signal) =>
    aiCodeApi.sessions({}, { signal }),
  );

  const [tab, setTab] = useState("chat");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AiCodeSessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [models, setModels] = useState<AiCodeModel[]>([]);
  const [draft, setDraft] = useState("");
  const [pendingRefs, setPendingRefs] = useState<
    { name: string; url: string; uid: string }[]
  >([]);
  const [uploading, setUploading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [liveTools, setLiveTools] = useState<{ name: string; status: string }[]>([]);
  const [creating, setCreating] = useState(false);
  const [edits, setEdits] = useState<AiCodeEditsResult | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyText, setApplyText] = useState("");
  const [backupCode, setBackupCode] = useState(true);
  const [autoRollback, setAutoRollback] = useState(true);
  const [conflictStrategy, setConflictStrategy] = useState<"overwrite" | "abort">(
    "overwrite",
  );
  const [applying, setApplying] = useState(false);
  const [runJob, setRunJob] = useState<UpgradeJob | null>(null);
  const [logs, setLogs] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const logRef = useRef<HTMLPreElement | null>(null);
  const finishedRef = useRef<number | null>(null);

  const sessionList = useMemo(() => sessions.data?.list ?? [], [sessions.data]);
  const unlocked = Boolean(overview.data?.unlocked);

  /** 首次进入自动选中最近一个会话。 */
  useEffect(() => {
    if (sessionId || !sessionList.length) return;
    setSessionId(sessionList[0].id);
  }, [sessionList, sessionId]);

  /** 页面打开时恢复正在执行的改码任务。 */
  useEffect(() => {
    if (runJob || !overview.data?.activeJob) return;
    setRunJob(overview.data.activeJob);
    setTab("run");
  }, [overview.data, runJob]);

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const [next, modelList] = await Promise.all([
        aiCodeApi.session({ params: { id } }),
        aiCodeApi.models(),
      ]);
      setDetail(next);
      setModels(modelList?.list ?? []);
    } catch {
      // 未解锁或会话不存在时保持空态
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const loadEdits = useCallback(async (id: number) => {
    try {
      const next = await aiCodeApi.edits({ params: { id } });
      setEdits(next);
    } catch {
      // 未解锁或会话不存在时保持空态
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    void loadDetail(sessionId);
    void loadEdits(sessionId);
  }, [sessionId, loadDetail, loadEdits]);

  const runJobId = runJob?.id;
  const runJobStatus = runJob?.status;
  /** 执行任务轮询：同步步骤与日志，结束后刷新概览与会话。 */
  useEffect(() => {
    if (!runJobId || !runJobStatus || !ACTIVE.includes(runJobStatus)) return;
    const id = runJobId;
    const timer = setInterval(async () => {
      try {
        const [next, tail] = await Promise.all([
          upgradeApi.job({ params: { id } }),
          upgradeApi.logs({ params: { id } }),
        ]);
        if (!next) return;
        setRunJob(next);
        setLogs(tail?.text || "");
        if (!ACTIVE.includes(next.status) && finishedRef.current !== next.id) {
          finishedRef.current = next.id;
          void overview.reload();
          void sessions.reload();
          if (sessionId) void loadEdits(sessionId);
        }
      } catch {
        // 执行期间 API 会短暂重启，下一轮继续
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [runJobId, runJobStatus, overview, sessions, sessionId, loadEdits]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [detail?.messages.length, liveText]);

  /** 停止本轮生成：中断前端流并复位。 */
  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  /** 新建会话并切过去（可指定模型）。 */
  const createSession = async (model = "") => {
    setCreating(true);
    try {
      const created = await aiCodeApi.createSession({ body: { title: "", model } });
      if (!created) return;
      await sessions.reload();
      setSessionId(created.id);
      setDetail(created);
      setTab("chat");
      message.success("已新建改码会话");
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setCreating(false);
    }
  };

  const switchSession = (id: number) => {
    stopStream();
    setLiveText("");
    setLiveTools([]);
    setActivePath(null);
    setSessionId(id);
  };

  const doUpload = async (file: File) => {
    if (!sessionId) {
      message.warning("请先新建或选择一个会话");
      return false;
    }
    setUploading(true);
    try {
      const result = await uploadAiCodeFile(sessionId, file);
      if (result) {
        setPendingRefs((prev) => [
          ...prev,
          { name: result.name, url: result.url, uid: `${Date.now()}-${result.name}` },
        ]);
        message.success(`已上传 ${result.name}`);
      }
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setUploading(false);
    }
    return false;
  };

  /** 发送一轮对话：SSE 逐字回显，工具调用实时标注。 */
  const send = async () => {
    if (!sessionId || streaming) return;
    const content = draft.trim();
    if (!content && !pendingRefs.length) {
      message.warning("请输入内容或上传参考图 / 文件");
      return;
    }
    setStreaming(true);
    setLiveText("");
    setLiveTools([]);
    setDraft("");
    const refs = pendingRefs.map(({ name, url }) => ({ name, url }));
    setPendingRefs([]);
    setDetail((prev) =>
      prev
        ? {
            ...prev,
            messages: [
              ...prev.messages,
              {
                id: -Date.now(),
                sessionId,
                role: "user",
                content,
                model: "",
                references: refs.map((ref) => ({ ...ref, mime: "", bytes: 0 })),
                toolCalls: [],
                status: "DONE" as const,
                error: "",
                createdAt: new Date().toISOString(),
              },
            ],
          }
        : prev,
    );
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChat(
        sessionId,
        { content, references: refs },
        (event) => {
          if (event.type === "delta") setLiveText((prev) => prev + event.text);
          else if (event.type === "tool_start")
            setLiveTools((prev) => [...prev, { name: event.name, status: "running" }]);
          else if (event.type === "tool_end")
            setLiveTools((prev) =>
              prev.map((item, index) =>
                index === prev.length - 1 && item.name === event.name
                  ? { ...item, status: event.ok ? "success" : "error" }
                  : item,
              ),
            );
          else if (event.type === "notice") message.info(event.text);
          else if (event.type === "error") message.error(event.message);
        },
        controller.signal,
      );
      setLiveText("");
      setLiveTools([]);
      await loadDetail(sessionId);
      await loadEdits(sessionId);
      await sessions.reload();
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const approve = async (path: string, status: "approved" | "rejected") => {
    if (!sessionId) return;
    try {
      const next = await aiCodeApi.approve({
        params: { id: sessionId },
        body: { path, status },
      });
      if (next) setEdits(next);
    } catch (error) {
      presentMutationError(error, message.error);
    }
  };

  const revert = async (path: string) => {
    if (!sessionId) return;
    try {
      const next = await aiCodeApi.revert({
        params: { id: sessionId },
        body: { path },
      });
      if (next) {
        setEdits((prev) => (prev ? { ...prev, list: next.list } : prev));
        setActivePath(null);
        await loadEdits(sessionId);
        message.success(path ? "已弃用该文件变更" : "已弃用全部变更");
      }
    } catch (error) {
      presentMutationError(error, message.error);
    }
  };

  const approveAll = async () => {
    const pending = (edits?.list || []).filter((item) => item.status === "pending");
    if (!pending.length) {
      message.info("没有待审阅的变更");
      return;
    }
    try {
      let next: AiCodeEditsResult | null = edits;
      for (const item of pending) {
        next = await aiCodeApi.approve({
          params: { id: sessionId! },
          body: { path: item.path, status: "approved" },
        });
      }
      if (next) setEdits(next);
      message.success(`已采纳 ${pending.length} 个文件`);
    } catch (error) {
      presentMutationError(error, message.error);
    }
  };

  const doExport = async () => {
    if (!sessionId) return;
    setExporting(true);
    try {
      const result = await aiCodeApi.export({ params: { id: sessionId } });
      if (!result) return;
      await downloadAiCodePatch(result.url, result.fileName);
      message.success(`补丁包已下载（${fmtBytes(result.bytes)}），可线下部署`);
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setExporting(false);
    }
  };

  const doApply = async () => {
    if (!sessionId) return;
    if (applyText.trim() !== AI_CODE_CONFIRM_TEXT) {
      message.warning(`请输入「${AI_CODE_CONFIRM_TEXT}」完成确认`);
      return;
    }
    setApplying(true);
    try {
      const job = await aiCodeApi.apply({
        body: {
          sessionId,
          backupDatabase: true,
          backupCode,
          autoRollback,
          conflictStrategy,
          confirmation: applyText.trim(),
        },
      });
      if (!job) return;
      setApplyOpen(false);
      setApplyText("");
      setRunJob(job);
      setTab("run");
      message.success("改码任务已启动，系统已自动进入维护模式并强制备份");
      void overview.reload();
      void loadEdits(sessionId);
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setApplying(false);
    }
  };

  const doCancel = () => {
    if (!runJob) return;
    modal.confirm({
      title: "取消改码任务",
      content:
        "取消会在当前步骤结束后停止执行器。若已进入代码替换或数据库迁移，可能需要在「平台升级 → 备份与还原」手动还原。",
      okText: "确认取消",
      cancelText: "继续执行",
      onOk: async () => {
        try {
          const next = await upgradeApi.cancel({ params: { id: runJob.id } });
          if (next) setRunJob(next);
          message.success("已发送取消指令");
        } catch (error) {
          presentMutationError(error, message.error);
        }
      },
    });
  };

  const data = overview.data;
  const messages = detail?.messages ?? [];
  const list = edits?.list ?? [];
  const activeEdit = list.find((item) => item.path === activePath) || list[0] || null;
  const runActive = Boolean(runJob && ACTIVE.includes(runJob.status));
  const approvedCount = list.filter((item) => item.status === "approved").length;
  const pendingCount = list.filter((item) => item.status === "pending").length;
  const current = detail;
  const risky = edits?.risky;

  if (overview.denied || sessions.denied) {
    return <PermissionNotice denied={overview.denied || sessions.denied} />;
  }

  /** 危险门：未解锁前只显示告知条 + 密码输入。 */
  if (!unlocked) {
    return (
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DangerBanner />
        {data && !data.enabled ? (
          <Notice variant="warn">
            平台未开启 AI 编程（环境变量 AI_CODE_ENABLED 为 false），当前只能查看，不能对话改码。
          </Notice>
        ) : null}
        <UnlockGate overview={data} onUnlocked={() => void overview.reload()} />
      </Space>
    );
  }

  const sessionOptions = sessionList.map((item) => ({
    value: item.id,
    label: `${item.title || `会话 #${item.id}`}${item.pendingCount ? `（待审 ${item.pendingCount}）` : ""}`,
  }));

  return (
    <>
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <DangerBanner />

        {data?.workspace.hostUpgradeRequired ? (
          <Alert
            type="warning"
            showIcon
            title="当前是 Docker 部署，容器内不能替换自身镜像"
            description={
              <Space orientation="vertical" size={6}>
                <span>仍可正常对话改码与导出补丁包；在线应用请在宿主机执行重启命令：</span>
                <Typography.Text code copyable>
                  {data.workspace.hostCommand || ""}
                </Typography.Text>
              </Space>
            }
          />
        ) : null}

        {data && !data.allowApply ? (
          <Notice variant="warn">
            当前只允许「导出补丁包」线下部署；在线应用已被关闭（环境变量 AI_CODE_ALLOW_APPLY 为 false）。
          </Notice>
        ) : null}

        {!data?.tools.available ? (
          <Notice variant="warn">
            服务器缺少备份工具（{data?.tools.dump} / {data?.tools.archive}），在线应用会被拒绝；请先按「平台升级」页的安装指引处理后重启后端。
          </Notice>
        ) : null}

        <Panel
          title="改码会话"
          extra={
            <Space wrap>
              <Select
                style={{ minWidth: 240 }}
                placeholder="选择会话"
                value={sessionId ?? undefined}
                options={sessionOptions}
                onChange={switchSession}
                notFoundContent="还没有会话，点右侧新建"
              />
              <Button
                icon={<FileAddOutlined />}
                loading={creating}
                onClick={() => void createSession()}
              >
                新建会话
              </Button>
              <Tooltip title="重新拉取概览与会话">
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    void overview.reload();
                    void sessions.reload();
                    if (sessionId) {
                      void loadDetail(sessionId);
                      void loadEdits(sessionId);
                    }
                  }}
                />
              </Tooltip>
            </Space>
          }
        >
          <Descriptions
            bordered
            size="small"
            column={{ xs: 1, md: 2, xl: 3 }}
            items={[
              { key: "version", label: "当前版本", children: data?.workspace.version || "—" },
              {
                key: "commit",
                label: "当前提交",
                children: data?.workspace.commit ? data.workspace.commit.slice(0, 12) : "—",
              },
              {
                key: "root",
                label: "工作区",
                children: <Typography.Text code>{data?.workspace.root || "—"}</Typography.Text>,
              },
              { key: "mode", label: "部署方式", children: data?.workspace.deploymentMode || "—" },
              { key: "disk", label: "磁盘可用", children: fmtBytes(data?.diskFreeBytes || 0) },
              {
                key: "limits",
                label: "变更上限",
                children: `${data?.limits.maxFiles || 0} 个文件 / 单文件 ${fmtBytes(data?.limits.maxFileBytes || 0)}`,
              },
            ]}
          />
        </Panel>

        <PanelTabs
          value={tab}
          onChange={setTab}
          items={[
            {
              key: "chat",
              label: "对话改码",
              children: (
                <Space orientation="vertical" size={14} style={{ width: "100%" }}>
                  {!current ? (
                    <EmptyState
                      icon={<CodeOutlined aria-hidden />}
                      text="还没有会话，先新建一个会话再开始对话。"
                      action={
                        <Button
                          type="primary"
                          loading={creating}
                          onClick={() => void createSession()}
                        >
                          新建会话
                        </Button>
                      }
                    />
                  ) : (
                    <>
                      <Space wrap>
                        <span className="muted">模型</span>
                        <Select
                          style={{ minWidth: 260 }}
                          value={current.model || undefined}
                          placeholder="沿用平台默认文本模型"
                          options={models.map((item) => ({
                            value: item.id,
                            label: `${item.label}${item.capabilities.includes("vision") ? "（支持图片）" : ""}`,
                          }))}
                          onChange={(value) => {
                            setDetail((prev) => (prev ? { ...prev, model: value } : prev));
                            void createSession(value);
                          }}
                          notFoundContent="模型广场还没有可用的文本模型"
                        />
                        <span className="muted">
                          切换模型会新建一个会话，避免上下文串味。
                        </span>
                      </Space>

                      <div className="ai-code-scroll">
                        {detailLoading && !messages.length ? (
                          <div style={{ textAlign: "center", padding: 24 }}>
                            <Spin />
                          </div>
                        ) : null}
                        {!messages.length && !detailLoading ? (
                          <EmptyState
                            icon={<CodeOutlined aria-hidden />}
                            text="用一句话说清要改什么（可上传参考图 / 文件），模型会先读代码再改到暂存区。"
                          />
                        ) : null}
                        {messages.map((item) => (
                          <MessageBubble key={item.id} message={item} />
                        ))}
                        {streaming ? (
                          <div className="ai-code-msg">
                            <div className="ai-code-bubble agent">
                              {liveTools.length ? (
                                <Space wrap size={6} style={{ marginBottom: 8 }}>
                                  {liveTools.map((tool, index) => (
                                    <Tag
                                      key={`${index}-${tool.name}`}
                                      color={tool.status === "error" ? "red" : "geekblue"}
                                    >
                                      <CodeOutlined /> {tool.name.replace("code__", "")}
                                      {tool.status === "running" ? " …" : ""}
                                    </Tag>
                                  ))}
                                </Space>
                              ) : null}
                              {liveText ? (
                                <div
                                  className="ai-code-md"
                                  dangerouslySetInnerHTML={{ __html: markdownToHtml(liveText) }}
                                />
                              ) : (
                                <Space size={8}>
                                  <Spin size="small" />
                                  <span className="muted">模型思考中…</span>
                                </Space>
                              )}
                            </div>
                          </div>
                        ) : null}
                        <div ref={chatEndRef} />
                      </div>

                      <div className="ai-code-compose">
                        {pendingRefs.length ? (
                          <Space wrap size={6} style={{ marginBottom: 8 }}>
                            {pendingRefs.map((ref) => (
                              <Tag
                                key={ref.uid}
                                closable
                                onClose={() =>
                                  setPendingRefs((prev) =>
                                    prev.filter((item) => item.uid !== ref.uid),
                                  )
                                }
                              >
                                {ref.name}
                              </Tag>
                            ))}
                          </Space>
                        ) : null}
                        <Input.TextArea
                          value={draft}
                          rows={3}
                          placeholder="例如：把「平台升级」页的备份表格增加「文件大小」列并支持排序（可粘贴参考图，或点下方上传）"
                          onChange={(event) => setDraft(event.target.value)}
                          onPressEnter={(event) => {
                            if (!event.shiftKey) {
                              event.preventDefault();
                              void send();
                            }
                          }}
                        />
                        <Space style={{ marginTop: 8 }} wrap>
                          <Upload
                            showUploadList={false}
                            beforeUpload={doUpload}
                            accept="image/*,.txt,.md,.json,.ts,.tsx,.prisma,.sql,.css"
                          >
                            <Button icon={<FileTextOutlined />} loading={uploading}>
                              上传参考图 / 文件
                            </Button>
                          </Upload>
                          {streaming ? (
                            <Button danger icon={<StopOutlined />} onClick={stopStream}>
                              停止
                            </Button>
                          ) : (
                            <Button
                              type="primary"
                              icon={<SendOutlined />}
                              loading={uploading}
                              onClick={() => void send()}
                            >
                              发送
                            </Button>
                          )}
                          <span className="muted">回车发送，Shift + 回车换行</span>
                        </Space>
                      </div>
                    </>
                  )}
                </Space>
              ),
            },
            {
              key: "changes",
              label: `变更${list.length ? `（${list.length}）` : ""}`,
              children: (
                <Space orientation="vertical" size={14} style={{ width: "100%" }}>
                  {risky?.schema || risky?.migrations || risky?.dependencies ? (
                    <Alert
                      type="warning"
                      showIcon
                      title="本次变更触及高风险面，请重点复核"
                      description={
                        <Space wrap size={6}>
                          {risky?.schema ? <Tag color="red">schema.prisma</Tag> : null}
                          {risky?.migrations ? <Tag color="red">数据库迁移</Tag> : null}
                          {risky?.dependencies ? <Tag color="red">依赖（package.json / lock）</Tag> : null}
                        </Space>
                      }
                    />
                  ) : null}

                  <Space wrap>
                    <Button
                      onClick={() => void approveAll()}
                      disabled={!pendingCount || streaming}
                    >
                      全部采纳（{pendingCount}）
                    </Button>
                    <Popconfirm
                      title="弃用全部变更"
                      description="删除暂存区所有改动，不影响线上源码。"
                      okText="全部弃用"
                      cancelText="取消"
                      onConfirm={() => void revert("")}
                    >
                      <Button danger disabled={!list.length || streaming}>
                        全部弃用
                      </Button>
                    </Popconfirm>
                    <Button
                      type="primary"
                      icon={<DownloadOutlined />}
                      loading={exporting}
                      disabled={!approvedCount}
                      onClick={() => void doExport()}
                    >
                      导出补丁包（{approvedCount}）
                    </Button>
                    <Button
                      danger
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      disabled={!approvedCount || !data?.allowApply || runActive}
                      onClick={() => {
                        setApplyText("");
                        setApplyOpen(true);
                      }}
                    >
                      备份并执行
                    </Button>
                    <span className="muted">
                      默认走「导出补丁包」线下部署；在线应用会强制备份数据库并触发构建 / 重启。
                    </span>
                  </Space>

                  {!list.length ? (
                    <EmptyState
                      icon={<CodeOutlined aria-hidden />}
                      text="还没有暂存变更；对话时模型写的文件会实时出现在这里。"
                    />
                  ) : (
                    <div className="ai-code-changes">
                      <div className="ai-code-files">
                        <Table
                          size="small"
                          rowKey="path"
                          pagination={false}
                          scroll={{ y: 380 }}
                          dataSource={list}
                          onRow={(row) => ({
                            onClick: () => setActivePath(row.path),
                            style: { cursor: "pointer" },
                          })}
                          rowClassName={(row) =>
                            row.path === activeEdit?.path ? "ai-code-row-active" : ""
                          }
                          columns={[
                            {
                              title: "文件",
                              dataIndex: "path",
                              render: (value: string, row: AiCodeEdit) => (
                                <Space size={6}>
                                  <Tag color={CHANGE_META[row.changeType].color}>
                                    {CHANGE_META[row.changeType].icon}
                                    {CHANGE_META[row.changeType].label}
                                  </Tag>
                                  <Typography.Text ellipsis style={{ maxWidth: 220 }}>
                                    {value}
                                  </Typography.Text>
                                </Space>
                              ),
                            },
                            {
                              title: "状态",
                              dataIndex: "status",
                              width: 84,
                              render: (value: AiCodeEdit["status"]) => (
                                <Tag color={EDIT_STATUS_META[value].color}>
                                  {EDIT_STATUS_META[value].label}
                                </Tag>
                              ),
                            },
                            {
                              title: "操作",
                              key: "actions",
                              width: 120,
                              render: (_: unknown, row: AiCodeEdit) => (
                                <Space size={2}>
                                  <Tooltip title="采纳">
                                    <Button
                                      size="small"
                                      type={row.status === "approved" ? "primary" : "text"}
                                      disabled={row.status === "applied"}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void approve(row.path, "approved");
                                      }}
                                    >
                                      采纳
                                    </Button>
                                  </Tooltip>
                                  <Tooltip title="弃用">
                                    <Button
                                      size="small"
                                      type="text"
                                      danger
                                      disabled={row.status === "applied"}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void approve(row.path, "rejected");
                                      }}
                                    >
                                      弃用
                                    </Button>
                                  </Tooltip>
                                </Space>
                              ),
                            },
                          ]}
                        />
                      </div>
                      <div className="ai-code-diff-pane">
                        {activeEdit ? (
                          <>
                            <div className="ai-code-diff-head">
                              <Space size={6} wrap>
                                <Tag color={CHANGE_META[activeEdit.changeType].color}>
                                  {CHANGE_META[activeEdit.changeType].label}
                                </Tag>
                                <Typography.Text strong>{activeEdit.path}</Typography.Text>
                                <span className="muted">{fmtBytes(activeEdit.bytes)}</span>
                              </Space>
                              <Space size={4}>
                                <Button
                                  size="small"
                                  type={activeEdit.status === "approved" ? "primary" : "default"}
                                  disabled={activeEdit.status === "applied"}
                                  onClick={() => void approve(activeEdit.path, "approved")}
                                >
                                  采纳
                                </Button>
                                <Button
                                  size="small"
                                  danger
                                  disabled={activeEdit.status === "applied"}
                                  onClick={() => void revert(activeEdit.path)}
                                >
                                  弃用
                                </Button>
                              </Space>
                            </div>
                            <DiffView diff={activeEdit.diff} />
                          </>
                        ) : (
                          <EmptyState text="选择左侧文件查看差异。" />
                        )}
                      </div>
                    </div>
                  )}
                </Space>
              ),
            },
            {
              key: "run",
              label: runJob ? `执行（#${runJob.id}）` : "执行",
              children: (
                <Space orientation="vertical" size={14} style={{ width: "100%" }}>
                  {!runJob ? (
                    <EmptyState
                      icon={<RocketOutlined aria-hidden />}
                      text="还没有执行中的改码任务；在「变更」页签采纳文件后点「备份并执行」。"
                    />
                  ) : (
                    <>
                      {runJob.error ? (
                        <Alert
                          type="error"
                          showIcon
                          title={runJob.error}
                          description="执行失败已按策略回滚；如需恢复到执行前状态，可到「平台升级 → 备份与还原」选择本次任务的备份。"
                        />
                      ) : null}
                      <Panel title={`任务 #${runJob.id} · AI 编程在线应用`}>
                        <Space orientation="vertical" size={14} style={{ width: "100%" }}>
                          <Space wrap>
                            {jobStatusTag(runJob.status)}
                            <span className="muted">
                              {runJob.fromVersion || "—"} → {runJob.toVersion || "—"}
                            </span>
                            <span className="muted">
                              开始于 {runJob.startedAt ? fmtTime(runJob.startedAt) : "—"}
                            </span>
                          </Space>
                          <Progress
                            percent={runJob.progress}
                            status={
                              runJob.status === "FAILED"
                                ? "exception"
                                : runJob.status === "SUCCESS"
                                  ? "success"
                                  : "active"
                            }
                          />
                          <Steps
                            size="small"
                            orientation="vertical"
                            items={runJob.steps.map((item) => ({
                              title: item.label,
                              status: STEP_STATUS[item.status],
                              content: item.message || undefined,
                            }))}
                          />
                          {runActive ? (
                            <Button danger onClick={doCancel}>
                              取消任务
                            </Button>
                          ) : null}
                        </Space>
                      </Panel>
                      <Panel title="执行日志">
                        <pre
                          ref={logRef}
                          style={{
                            margin: 0,
                            maxHeight: 360,
                            overflow: "auto",
                            padding: 12,
                            borderRadius: 8,
                            background: "rgba(15, 23, 42, 0.92)",
                            color: "#e2e8f0",
                            fontSize: 12,
                            lineHeight: 1.6,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-all",
                          }}
                        >
                          {logs || "执行器启动后日志会出现在这里。"}
                        </pre>
                        <Typography.Paragraph type="secondary" style={{ margin: "8px 0 0" }}>
                          执行期间 API 可能短暂重启，进度与日志会自动继续同步。
                        </Typography.Paragraph>
                      </Panel>
                    </>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Space>

      <Modal
        open={applyOpen}
        title="重复确认：备份并执行改码"
        okText="确认执行"
        cancelText="取消"
        confirmLoading={applying}
        okButtonProps={{ danger: true }}
        destroyOnHidden
        onCancel={() => setApplyOpen(false)}
        onOk={doApply}
        width={640}
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type="error"
            showIcon
            icon={<WarningOutlined />}
            title="执行会重写线上源码并触发构建 / 重启，服务将短暂停止"
            description="数据库备份为强制步骤；任务结束后自动退出维护模式，失败按策略自动回滚。"
          />
          <div>
            <Typography.Text strong>将要落地的文件（{approvedCount} 个）</Typography.Text>
            <ul style={{ margin: "6px 0 0", paddingInlineStart: 18, maxHeight: 160, overflow: "auto" }}>
              {list
                .filter((item) => item.status === "approved")
                .map((item) => (
                  <li key={item.path}>
                    <Tag color={CHANGE_META[item.changeType].color}>
                      {CHANGE_META[item.changeType].label}
                    </Tag>
                    {item.path}
                  </li>
                ))}
            </ul>
          </div>
          <Radio.Group
            value={conflictStrategy}
            onChange={(event) =>
              setConflictStrategy(event.target.value as "overwrite" | "abort")
            }
            options={[
              { value: "overwrite", label: "覆盖：文件已存在则整体覆盖" },
              { value: "abort", label: "中止：遇到冲突文件即停止执行" },
            ]}
          />
          <Space orientation="vertical" size={4}>
            <Checkbox
              checked={backupCode}
              onChange={(event) => setBackupCode(event.target.checked)}
            >
              同时备份代码（推荐；还原时可连代码一起回退）
            </Checkbox>
            <Checkbox
              checked={autoRollback}
              onChange={(event) => setAutoRollback(event.target.checked)}
            >
              构建或迁移失败时自动回滚（推荐）
            </Checkbox>
            <Checkbox checked disabled>
              备份数据库（强制步骤，不可关闭）
            </Checkbox>
          </Space>
          <div>
            请输入 <Typography.Text code>{AI_CODE_CONFIRM_TEXT}</Typography.Text> 完成确认：
          </div>
          <Input
            value={applyText}
            placeholder={AI_CODE_CONFIRM_TEXT}
            onChange={(event) => setApplyText(event.target.value)}
          />
        </Space>
      </Modal>
    </>
  );
}

