"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  App,
  Alert,
  Button,
  Checkbox,
  Descriptions,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Space,
  Steps,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from "antd";
import type { UploadFile } from "antd";
import {
  CloudDownloadOutlined,
  InboxOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import Link from "next/link";
import { EmptyState, Notice, Panel, PanelTabs } from "@/components/ui/panel";
import {
  upgradeApi,
  uploadUpgradePackage,
  type UpgradeAnalysis,
  type UpgradeBackup,
  type UpgradeCheckResult,
  type UpgradeJob,
  type UpgradeOverview,
  type UpgradePackage,
} from "@/api/upgrade";
import { presentMutationError } from "@/query/errors";
import { fmtTime } from "@/lib/datetime";
import { PermissionNotice, useAdminData } from "./common";

/* ============================================================
   平台管理后台「平台升级」：
   1. 从 GitHub Release 拉取 / 手动上传升级包到 update 目录
   2. 平台 Agent 分析当前版本与升级包差异并给出建议
   3. 按建议一键执行（强制备份数据库、默认备份代码与自动回滚）
   4. 备份台账与一键还原（整库 + 代码，或仅数据库）
   ============================================================ */

const RISK_META: Record<
  UpgradeAnalysis["risk"],
  { label: string; color: string }
> = {
  low: { label: "低风险", color: "green" },
  medium: { label: "中风险", color: "orange" },
  high: { label: "高风险", color: "red" },
  blocked: { label: "暂不可升级", color: "magenta" },
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

const PACKAGE_SOURCE_LABEL: Record<string, string> = {
  GITHUB_RELEASE: "GitHub Release",
  GITHUB_SOURCE: "GitHub 源码包",
  UPLOAD: "手动上传",
};

const PACKAGE_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  DOWNLOADING: { label: "下载中", color: "processing" },
  VERIFIED: { label: "待解压", color: "default" },
  EXTRACTED: { label: "可用", color: "green" },
  INVALID: { label: "不可用", color: "red" },
};

const DEPLOYMENT_LABEL: Record<string, string> = {
  dev: "开发模式（scripts/dev.mjs）",
  pm2: "PM2",
  systemd: "systemd",
  command: "自定义命令",
  docker: "Docker 容器",
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

function riskTag(risk: UpgradeAnalysis["risk"]) {
  const meta = RISK_META[risk] || RISK_META.medium;
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function statusTag(status: string) {
  const meta = JOB_STATUS[status] || { label: status, color: "default" };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function adviceList(items: string[], empty = "—") {
  if (!items.length) return <span className="muted">{empty}</span>;
  return (
    <ul style={{ margin: 0, paddingInlineStart: 18 }}>
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </ul>
  );
}

type ToolInstallHint = {
  label?: string;
  code?: string;
  text?: string;
  href?: string;
};

/** 后端运行在目标服务器上，用归档工具路径判断操作系统，给出对应的安装命令。 */
function toolInstallHints(
  tools: UpgradeOverview["tools"],
  windows: boolean,
): { missing: string; hints: ToolInstallHint[] }[] {
  const groups: { missing: string; hints: ToolInstallHint[] }[] = [];
  if (!tools.dumpAvailable) {
    if (tools.dialect === "postgresql") {
      groups.push({
        missing: "PostgreSQL 客户端 pg_dump / pg_restore",
        hints: windows
          ? [
              {
                label: "Windows 安装包",
                text: "https://www.postgresql.org/download/windows/",
                href: "https://www.postgresql.org/download/windows/",
              },
              {
                text: "安装时勾选 Command Line Tools，并把安装目录下的 bin 加入系统 PATH（例如 C:\\Program Files\\PostgreSQL\\17\\bin）",
              },
            ]
          : [
              {
                label: "Ubuntu / Debian",
                code: "sudo apt-get install -y postgresql-client",
              },
              { label: "RHEL / Rocky", code: "sudo dnf install -y postgresql" },
            ],
      });
    } else {
      groups.push({
        missing: "MySQL 客户端 mysqldump / mysql",
        hints: windows
          ? [
              {
                label: "Windows 安装包",
                text: "https://dev.mysql.com/downloads/mysql/",
                href: "https://dev.mysql.com/downloads/mysql/",
              },
              {
                text: "使用 MySQL Installer 勾选 Client 组件安装，并把安装目录下的 bin 加入系统 PATH",
              },
            ]
          : [
              {
                label: "Ubuntu / Debian",
                code: "sudo apt-get install -y mysql-client",
              },
              { label: "RHEL / Rocky", code: "sudo dnf install -y mysql" },
            ],
      });
    }
  }
  if (!tools.archiveAvailable) {
    groups.push({
      missing: "tar 打包工具",
      hints: windows
        ? [
            {
              text: `系统自带 ${tools.archive}；若缺失，可在「设置 → 应用 → 可选功能」中安装 tar，然后重启后端`,
            },
          ]
        : [
            { label: "Ubuntu / Debian", code: "sudo apt-get install -y tar" },
            { label: "RHEL / Rocky", code: "sudo dnf install -y tar" },
          ],
    });
  }
  return groups;
}

function ToolSetupGuide({ tools }: { tools: UpgradeOverview["tools"] }) {
  const windows =
    /^[A-Za-z]:[\\/]/.test(tools.archive) || tools.archive.startsWith("\\\\");
  const groups = toolInstallHints(tools, windows);
  if (!groups.length) return null;
  return (
    <Alert
      type="warning"
      showIcon
      title="备份工具未就绪，暂不能执行升级或还原"
      description={
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <span>
            升级包的下载、上传与 Agent 分析不受影响；执行升级或还原前请在服务器安装以下工具：
          </span>
          {groups.map((group) => (
            <div key={group.missing}>
              <Typography.Text strong>缺少 {group.missing}</Typography.Text>
              <ul style={{ margin: "4px 0 0", paddingInlineStart: 18 }}>
                {group.hints.map((hint) => (
                  <li key={hint.code || hint.text || hint.label}>
                    {hint.label ? <span>{hint.label}：</span> : null}
                    {hint.code ? (
                      <Typography.Text code copyable>
                        {hint.code}
                      </Typography.Text>
                    ) : null}
                    {hint.href ? (
                      <Typography.Link
                        href={hint.href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {hint.text}
                      </Typography.Link>
                    ) : null}
                    {!hint.code && !hint.href && hint.text ? (
                      <span>{hint.text}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <span className="muted">
            当前服务器为 {windows ? "Windows" : "Linux"}。安装完成后请重启后端，重新进入本页会自动重新检测。
          </span>
        </Space>
      }
    />
  );
}

export function UpgradeTab() {
  const { message, modal } = App.useApp();
  const overview = useAdminData(
    "admin-platform-upgrade-overview",
    (signal) => upgradeApi.overview({}, { signal }),
  );
  const packages = useAdminData(
    "admin-platform-upgrade-packages",
    (signal) => upgradeApi.packages({}, { signal }),
  );
  const backups = useAdminData("admin-platform-upgrade-backups", (signal) =>
    upgradeApi.backups({}, { signal }),
  );

  const [tab, setTab] = useState("wizard");
  const [wizardStep, setWizardStep] = useState(0);
  const [sourceMode, setSourceMode] = useState("release");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [check, setCheck] = useState<UpgradeCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState<"release" | "source" | "">("");
  const [uploadFile, setUploadFile] = useState<UploadFile | null>(null);
  const [uploadVersion, setUploadVersion] = useState("");
  const [uploading, setUploading] = useState(false);
  const [analysisJob, setAnalysisJob] = useState<UpgradeJob | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [runJob, setRunJob] = useState<UpgradeJob | null>(null);
  const [logs, setLogs] = useState("");
  const [executing, setExecuting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [backupCode, setBackupCode] = useState(true);
  const [autoRollback, setAutoRollback] = useState(true);
  const [conflictStrategy, setConflictStrategy] = useState<"overwrite" | "abort">(
    "overwrite",
  );
  const [restoreTarget, setRestoreTarget] = useState<UpgradeBackup | null>(null);
  const [restoreMode, setRestoreMode] = useState<"FULL" | "DATABASE">("FULL");
  const [restoreText, setRestoreText] = useState("");
  const [restoring, setRestoring] = useState(false);
  const logRef = useRef<HTMLPreElement | null>(null);
  const finishedRef = useRef<number | null>(null);
  const wizardTopRef = useRef<HTMLDivElement | null>(null);
  const skipScrollRef = useRef(true);

  /** 切换步骤后回到向导顶部，避免停留在上一步页尾看不到新步骤内容。 */
  useEffect(() => {
    if (skipScrollRef.current) {
      skipScrollRef.current = false;
      return;
    }
    wizardTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [wizardStep]);

  const list = useMemo(() => packages.data?.list ?? [], [packages.data]);
  const selected = useMemo(
    () => list.find((item) => item.id === selectedId) || null,
    [list, selectedId],
  );

  /** 首次进入（以及列表变化后）自动选中最近一个可用升级包。 */
  useEffect(() => {
    if (selectedId || !list.length) return;
    const usable = list.find((item) => item.extracted && item.status === "EXTRACTED");
    if (usable) setSelectedId(usable.id);
  }, [list, selectedId]);

  /** 页面打开时恢复正在执行的任务，避免升级期间刷新后丢失进度。 */
  useEffect(() => {
    if (runJob || !overview.data?.activeJob) return;
    setRunJob(overview.data.activeJob);
    setWizardStep(3);
  }, [overview.data, runJob]);

  const reloadViews = useCallback(() => {
    void overview.reload();
    void packages.reload();
    void backups.reload();
  }, [overview, packages, backups]);
  // 轮询 effect 只跟随任务状态，刷新函数放 ref，避免每次渲染重启定时器。
  const reloadRef = useRef(reloadViews);
  useEffect(() => {
    reloadRef.current = reloadViews;
  }, [reloadViews]);

  const analysisJobId = analysisJob?.id;
  const analysisJobStatus = analysisJob?.status;

  /** 分析任务轮询：完成后自动刷新升级包台账。 */
  useEffect(() => {
    if (!analysisJobId || !analysisJobStatus || !ACTIVE.includes(analysisJobStatus)) return;
    const id = analysisJobId;
    const timer = setInterval(async () => {
      try {
        const next = await upgradeApi.job({ params: { id } });
        if (!next) return;
        setAnalysisJob(next);
        if (!ACTIVE.includes(next.status)) {
          setAnalyzing(false);
          reloadRef.current();
        }
      } catch {
        // 网络抖动下一轮继续
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [analysisJobId, analysisJobStatus]);

  const runJobId = runJob?.id;
  const runJobStatus = runJob?.status;

  /** 执行任务轮询：同步步骤与日志，结束后刷新概览/备份。 */
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
          reloadRef.current();
        }
      } catch {
        // 执行期间 API 会短暂重启，下一轮继续
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [runJobId, runJobStatus]);

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const doCheck = async () => {
    setChecking(true);
    try {
      const result = await upgradeApi.check();
      if (result) setCheck(result);
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setChecking(false);
    }
  };

  const doDownload = async (mode: "release" | "source") => {
    if (!check) return;
    setDownloading(mode);
    try {
      const created = await upgradeApi.download(
        { body: { mode, tag: check.tag } },
        { timeoutMs: 15 * 60_000 },
      );
      if (!created) {
        message.warning("下载完成但未返回升级包信息，请刷新后重试");
        return;
      }
      message.success(`升级包 ${created.version} 已下载并校验完成`);
      await packages.reload();
      setSelectedId(created.id);
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setDownloading("");
    }
  };

  const doUpload = async () => {
    const file = uploadFile?.originFileObj;
    if (!file) {
      message.warning("请先选择 zip 升级包");
      return;
    }
    setUploading(true);
    try {
      const created = await uploadUpgradePackage(file, uploadVersion);
      if (!created) {
        message.warning("上传完成但未返回升级包信息，请刷新后重试");
        return;
      }
      message.success(`升级包 ${created.version} 已上传并校验完成`);
      setUploadFile(null);
      setUploadVersion("");
      await packages.reload();
      setSelectedId(created.id);
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setUploading(false);
    }
  };

  const doRemovePackage = async (item: UpgradePackage) => {
    try {
      await upgradeApi.removePackage({ params: { id: item.id } });
      message.success("升级包已删除");
      if (selectedId === item.id) setSelectedId(null);
      await packages.reload();
    } catch (error) {
      presentMutationError(error, message.error);
    }
  };

  const doAnalyze = async () => {
    if (!selected) return;
    setAnalyzing(true);
    setLogs("");
    try {
      const job = await upgradeApi.analyze({ body: { packageId: selected.id } });
      if (!job) {
        setAnalyzing(false);
        message.warning("分析任务创建失败，请重试");
        return;
      }
      setAnalysisJob(job);
    } catch (error) {
      setAnalyzing(false);
      presentMutationError(error, message.error);
    }
  };

  const doExecute = async () => {
    if (!selected || !analysisJob) return;
    if (!confirmText.trim()) {
      message.warning("请输入目标版本号完成重复确认");
      return;
    }
    setExecuting(true);
    try {
      const job = await upgradeApi.execute({
        body: {
          packageId: selected.id,
          backupDatabase: true,
          backupCode,
          autoRollback,
          conflictStrategy,
          confirmation: confirmText.trim(),
        },
      });
      if (!job) {
        message.warning("升级任务创建失败，请重试");
        return;
      }
      setConfirmOpen(false);
      setConfirmText("");
      setRunJob(job);
      setWizardStep(3);
      message.success("升级任务已启动，系统已自动进入维护模式");
      reloadViews();
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setExecuting(false);
    }
  };

  const doCancel = () => {
    if (!runJob) return;
    modal.confirm({
      title: "取消升级任务",
      content:
        "取消会在当前步骤结束后停止执行器。若已进入代码替换或数据库迁移，可能需要在「备份与还原」里手动还原。",
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

  const doRestore = async () => {
    if (!restoreTarget) return;
    const expected = restoreMode === "FULL" ? "RESTORE" : "RESTORE-DB";
    if (restoreText.trim().toUpperCase() !== expected) {
      message.warning(`请输入 ${expected} 完成重复确认`);
      return;
    }
    setRestoring(true);
    try {
      const job = await upgradeApi.restore({
        body: {
          backupId: restoreTarget.id,
          mode: restoreMode,
          confirmation: restoreText.trim(),
        },
      });
      if (!job) {
        message.warning("还原任务创建失败，请重试");
        return;
      }
      setRestoreTarget(null);
      setRestoreText("");
      setRunJob(job);
      setTab("wizard");
      setWizardStep(3);
      message.success("还原任务已启动，系统已自动进入维护模式");
      reloadViews();
    } catch (error) {
      presentMutationError(error, message.error);
    } finally {
      setRestoring(false);
    }
  };

  const doRemoveBackup = async (row: UpgradeBackup) => {
    try {
      await upgradeApi.removeBackup({ params: { id: row.id } });
      message.success("备份已删除");
      await backups.reload();
    } catch (error) {
      presentMutationError(error, message.error);
    }
  };

  const data = overview.data;
  const analysis = analysisJob?.analysis || null;
  const deployment = data?.deployment;
  const dockerBlocked = Boolean(deployment?.hostUpgradeRequired);
  const analysisRunning = Boolean(
    analysisJob && ACTIVE.includes(analysisJob.status),
  );
  const targetVersion = selected?.version || analysisJob?.toVersion || "";
  const runActive = Boolean(runJob && ACTIVE.includes(runJob.status));
  const tools = data?.tools;
  const toolsReady = Boolean(tools?.available);

  /* ---------------- 第 1 步：升级包 ---------------- */

  const packageColumns = [
    {
      title: "版本",
      dataIndex: "version",
      render: (_: string, row: UpgradePackage) => (
        <Space size={6}>
          <Typography.Text strong>{row.version || "未知"}</Typography.Text>
          {row.tag ? <Tag>{row.tag}</Tag> : null}
        </Space>
      ),
    },
    {
      title: "来源",
      dataIndex: "source",
      render: (value: string) => PACKAGE_SOURCE_LABEL[value] || value,
    },
    {
      title: "大小",
      dataIndex: "bytes",
      render: (value: number) => fmtBytes(value),
    },
    {
      title: "状态",
      dataIndex: "status",
      render: (value: string, row: UpgradePackage) => {
        const meta = PACKAGE_STATUS_LABEL[value] || {
          label: value,
          color: "default",
        };
        const tag = <Tag color={meta.color}>{meta.label}</Tag>;
        return row.invalidReason ? (
          <Tooltip title={row.invalidReason}>{tag}</Tooltip>
        ) : (
          tag
        );
      },
    },
    {
      title: "下载时间",
      dataIndex: "createdAt",
      render: (value: string) => (value ? fmtTime(value) : "—"),
    },
    {
      title: "操作",
      key: "actions",
      width: 150,
      render: (_: unknown, row: UpgradePackage) => (
        <Space size={4}>
          <Button
            size="small"
            type={selectedId === row.id ? "primary" : "default"}
            disabled={!row.extracted}
            onClick={() => setSelectedId(row.id)}
          >
            {selectedId === row.id ? "已选择" : "选用"}
          </Button>
          <Popconfirm
            title="删除升级包"
            description="只会删除 update 目录中的包与解压副本，不影响已安装版本。"
            okText="删除"
            cancelText="取消"
            onConfirm={() => doRemovePackage(row)}
          >
            <Button size="small" danger type="text">
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const stepOne = (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Descriptions
        bordered
        size="small"
        column={{ xs: 1, md: 2, xl: 3 }}
        items={[
          {
            key: "version",
            label: "当前版本",
            children: data?.currentVersion || "—",
          },
          {
            key: "commit",
            label: "当前提交",
            children: data?.currentCommit ? data.currentCommit.slice(0, 12) : "—",
          },
          {
            key: "mode",
            label: "部署方式",
            children: deployment
              ? DEPLOYMENT_LABEL[deployment.mode] || deployment.mode
              : "—",
          },
          {
            key: "dir",
            label: "update 目录",
            children: deployment?.updateDir || "—",
          },
          {
            key: "disk",
            label: "磁盘可用",
            children: fmtBytes(data?.diskFreeBytes || 0),
          },
          {
            key: "tools",
            label: "备份工具",
            children: data?.tools?.available ? (
              <Tag color="green">
                {data.tools.dump} + {data.tools.archive}
              </Tag>
            ) : (
              <Space size={6} wrap>
                <Tag color="red">
                  缺少{" "}
                  {[
                    !data?.tools?.dumpAvailable ? data?.tools?.dump : "",
                    !data?.tools?.archiveAvailable ? data?.tools?.archive : "",
                  ]
                    .filter(Boolean)
                    .join(" / ") || "数据库客户端工具"}
                </Tag>
                <Typography.Text type="secondary">
                  安装方法见下方提示
                </Typography.Text>
              </Space>
            ),
          },
          {
            key: "model",
            label: "分析模型",
            children: data?.analysisModel ? (
              <Tag color="blue">{data.analysisModel}</Tag>
            ) : (
              <Space size={6}>
                <Tag color="orange">未配置</Tag>
                <Link href="/model-settings">立即配置模型</Link>
              </Space>
            ),
          },
          {
            key: "backups",
            label: "已有备份",
            children: `${data?.backupCount || 0} 份`,
          },
        ]}
      />

      {tools && !toolsReady ? <ToolSetupGuide tools={tools} /> : null}

      {data?.maintenance ? (
        <Alert
          type="warning"
          showIcon
          title="维护模式进行中"
          description="平台正在执行升级或还原任务，写请求暂不可用；完成后会自动恢复。"
        />
      ) : null}

      {dockerBlocked ? (
        <Alert
          type="error"
          showIcon
          title="当前是 Docker 部署，不能由容器内自动替换自身"
          description={
            <Space orientation="vertical" size={6}>
              <span>
                升级包仍可下载与分析；执行时请复制下面的命令到宿主机运行：
              </span>
              <Typography.Text code copyable>
                {deployment?.hostCommand || ""}
              </Typography.Text>
            </Space>
          }
        />
      ) : (
        <Alert
          type="info"
          showIcon
          title="执行升级会短暂停止服务"
          description="任务启动后自动进入维护模式；强制备份数据库，按需备份代码，构建成功后再迁移并重启，健康检查失败会自动回滚。"
        />
      )}

      <Panel title="获取升级包">
        <PanelTabs
          value={sourceMode}
          onChange={setSourceMode}
          items={[
            {
              key: "release",
              label: "方式一：GitHub 拉取",
              children: (
                <Space
                  orientation="vertical"
                  size={12}
                  style={{ width: "100%" }}
                >
                  <Space wrap>
                    <Button
                      icon={<CloudDownloadOutlined />}
                      loading={checking}
                      onClick={doCheck}
                    >
                      检查最新版本
                    </Button>
                    {check ? (
                      <>
                        <Button
                          type="primary"
                          icon={<CloudDownloadOutlined />}
                          loading={downloading === "release"}
                          onClick={() => doDownload("release")}
                        >
                          下载 Release 包
                        </Button>
                        <Button
                          loading={downloading === "source"}
                          onClick={() => doDownload("source")}
                        >
                          下载源码包
                        </Button>
                      </>
                    ) : null}
                  </Space>
                  {check ? (
                    <Notice variant="info">
                      <div>
                        <strong>{check.name}</strong>（{check.tag}） · 发布于{" "}
                        {check.publishedAt ? fmtTime(check.publishedAt) : "未知"}{" "}
                        · 目标版本 {check.version}
                      </div>
                      {check.releaseNotes ? (
                        <Typography.Paragraph
                          ellipsis={{ rows: 4, expandable: true, symbol: "展开" }}
                          style={{ margin: "8px 0 0" }}
                        >
                          {check.releaseNotes}
                        </Typography.Paragraph>
                      ) : null}
                    </Notice>
                  ) : null}
                </Space>
              ),
            },
            {
              key: "upload",
              label: "方式二：手动上传",
              children: (
                <Space
                  orientation="vertical"
                  size={12}
                  style={{ width: "100%" }}
                >
                  <Upload.Dragger
                    accept=".zip"
                    maxCount={1}
                    fileList={uploadFile ? [uploadFile] : []}
                    beforeUpload={(file) => {
                      setUploadFile({
                        uid: file.uid,
                        name: file.name,
                        size: file.size,
                        status: "done",
                        originFileObj: file,
                      } as UploadFile);
                      return false;
                    }}
                    onRemove={() => {
                      setUploadFile(null);
                      return true;
                    }}
                  >
                    <p className="ant-upload-drag-icon">
                      <InboxOutlined />
                    </p>
                    <p className="ant-upload-text">
                      点击或拖拽 zip 升级包到这里
                    </p>
                    <p className="ant-upload-hint">
                      包内需含 package.json、pnpm-workspace.yaml、backend 与
                      frontend 工程
                    </p>
                  </Upload.Dragger>
                  <Space wrap>
                    <Input
                      style={{ width: 220 }}
                      placeholder="版本号（可选，如 1.5.0）"
                      value={uploadVersion}
                      onChange={(event) => setUploadVersion(event.target.value)}
                    />
                    <Button
                      type="primary"
                      icon={<UploadOutlined />}
                      loading={uploading}
                      disabled={!uploadFile}
                      onClick={doUpload}
                    >
                      上传并校验
                    </Button>
                  </Space>
                </Space>
              ),
            },
          ]}
        />
      </Panel>

      <Panel title="已下载的升级包">
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={list}
          columns={packageColumns}
          locale={{ emptyText: "还没有升级包，请先下载或上传" }}
        />
      </Panel>

      <Space orientation="vertical" size={6}>
        <Space wrap>
          <Button
            type="primary"
            disabled={!selected?.extracted}
            onClick={() => setWizardStep(1)}
          >
            下一步：智能分析
          </Button>
          {selected ? (
            <span className="muted">
              已选择 {selected.version || selected.tag || `#${selected.id}`}
              ，下一步会对比当前代码并给出升级建议
            </span>
          ) : (
            <span className="muted">
              请先在上方下载或上传升级包，并在表格中点击「选用」
            </span>
          )}
        </Space>
        {!toolsReady ? (
          <span className="muted">
            备份工具未就绪不影响下载与分析；执行升级前请按上方指引完成安装。
          </span>
        ) : null}
      </Space>
    </Space>
  );

  /* ---------------- 第 2 步：智能分析 ---------------- */

  const analysisSteps = analysisJob?.steps || [];

  const stepTwo = (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      {!selected ? (
        <EmptyState
          icon={<InboxOutlined aria-hidden />}
          text="还没有选择升级包，请先完成第一步。"
          action={<Button onClick={() => setWizardStep(0)}>返回选择升级包</Button>}
        />
      ) : (
        <>
          <Descriptions
            bordered
            size="small"
            column={{ xs: 1, md: 3 }}
            items={[
              {
                key: "from",
                label: "当前版本",
                children: data?.currentVersion || "—",
              },
              { key: "to", label: "目标版本", children: selected.version },
              {
                key: "source",
                label: "包来源",
                children: PACKAGE_SOURCE_LABEL[selected.source] || selected.source,
              },
            ]}
          />

          {analysisJob ? (
            <Panel title={`分析任务 #${analysisJob.id}`}>
              <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                <Space wrap>
                  {statusTag(analysisJob.status)}
                  <Progress
                    percent={analysisJob.progress}
                    size="small"
                    style={{ width: 220 }}
                  />
                  <span className="muted">
                    分析模型：{data?.analysisModel || "未配置"}
                  </span>
                </Space>
                <Steps
                  size="small"
                  orientation="horizontal"
                  items={analysisSteps.map((item) => ({
                    title: item.label,
                    status: STEP_STATUS[item.status],
                    content: item.message || undefined,
                  }))}
                />
                {analysisJob.error ? (
                  <Alert type="error" showIcon title={analysisJob.error} />
                ) : null}
                {analysisRunning ? (
                  <span className="muted">正在分析，请稍候…</span>
                ) : null}
              </Space>
            </Panel>
          ) : null}

          {!analysisRunning ? (
            <Space>
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={analyzing}
                onClick={doAnalyze}
              >
                {analysis ? "重新分析" : "开始 Agent 分析"}
              </Button>
              {!data?.analysisModel ? (
                <span className="muted">
                  未配置分析模型时会使用规则分析；
                  <Link href="/model-settings">立即配置模型</Link>
                </span>
              ) : null}
            </Space>
          ) : null}

          {analysis ? (
            <Panel title="升级建议">
              <Space orientation="vertical" size={14} style={{ width: "100%" }}>
                <Space wrap>
                  {riskTag(analysis.risk)}
                  <Tag color={analysis.source === "agent" ? "blue" : "default"}>
                    {analysis.source === "agent" ? "Agent 分析" : "规则分析"}
                  </Tag>
                  {analysis.model ? <Tag>{analysis.model}</Tag> : null}
                  {analysis.downtime ? (
                    <span className="muted">预计影响：{analysis.downtime}</span>
                  ) : null}
                </Space>

                {analysis.notice ? (
                  <Notice variant="warn">{analysis.notice}</Notice>
                ) : null}

                <Typography.Paragraph style={{ margin: 0 }}>
                  {analysis.summary}
                </Typography.Paragraph>

                {analysis.blockers.length ? (
                  <Alert
                    type="error"
                    showIcon
                    title="升级阻断项（处理后再执行）"
                    description={adviceList(analysis.blockers)}
                  />
                ) : null}

                {analysis.conflicts.length ? (
                  <Alert
                    type="warning"
                    showIcon
                    title="本地改动与升级包有重叠"
                    description={
                      <Space orientation="vertical" size={4}>
                        {adviceList(analysis.conflicts.slice(0, 30))}
                        {analysis.conflicts.length > 30 ? (
                          <span className="muted">
                            仅展示前 30 个，共 {analysis.conflicts.length} 个冲突文件
                          </span>
                        ) : null}
                        <span>
                          下一步可选择「发现冲突就停止」先人工合并，或「覆盖」直接使用升级包版本。
                        </span>
                      </Space>
                    }
                  />
                ) : null}

                {analysis.migrations.length ? (
                  <div>
                    <Typography.Text strong>数据库迁移</Typography.Text>
                    <Table
                      size="small"
                      style={{ marginTop: 8 }}
                      rowKey="name"
                      pagination={false}
                      dataSource={analysis.migrations}
                      columns={[
                        { title: "迁移", dataIndex: "name" },
                        {
                          title: "风险",
                          dataIndex: "risk",
                          width: 100,
                          render: (value: UpgradeAnalysis["risk"]) =>
                            riskTag(value),
                        },
                        { title: "说明", dataIndex: "note" },
                      ]}
                    />
                  </div>
                ) : null}

                {analysis.dependencies.length ? (
                  <div>
                    <Typography.Text strong>依赖变化</Typography.Text>
                    <Table
                      size="small"
                      style={{ marginTop: 8 }}
                      rowKey="name"
                      pagination={false}
                      dataSource={analysis.dependencies}
                      columns={[
                        { title: "依赖", dataIndex: "name" },
                        { title: "当前", dataIndex: "from", render: (v: string) => v || "—" },
                        { title: "升级包", dataIndex: "to", render: (v: string) => v || "—" },
                        { title: "变化", dataIndex: "change", width: 100 },
                      ]}
                    />
                  </div>
                ) : null}

                {analysis.envChanges.added.length ||
                analysis.envChanges.removed.length ||
                analysis.envChanges.changed.length ? (
                  <div>
                    <Typography.Text strong>环境变量变化</Typography.Text>
                    <div style={{ marginTop: 8 }}>
                      <Space wrap size={6}>
                        {analysis.envChanges.added.map((key) => (
                          <Tag key={`a-${key}`} color="green">
                            新增 {key}
                          </Tag>
                        ))}
                        {analysis.envChanges.removed.map((key) => (
                          <Tag key={`r-${key}`} color="red">
                            移除 {key}
                          </Tag>
                        ))}
                        {analysis.envChanges.changed.map((key) => (
                          <Tag key={`c-${key}`} color="orange">
                            变更 {key}
                          </Tag>
                        ))}
                      </Space>
                    </div>
                    <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                      执行器不会覆盖 .env 文件，新增变量请在升级完成后按 .env.example 补齐。
                    </Typography.Paragraph>
                  </div>
                ) : null}

                <Descriptions
                  bordered
                  size="small"
                  column={1}
                  items={[
                    {
                      key: "strategy",
                      label: "执行策略",
                      children: adviceList(analysis.strategy),
                    },
                    {
                      key: "pre",
                      label: "升级前检查",
                      children: adviceList(analysis.preChecks),
                    },
                    {
                      key: "post",
                      label: "升级后确认",
                      children: adviceList(analysis.postChecks),
                    },
                    {
                      key: "rollback",
                      label: "回滚方案",
                      children: adviceList(analysis.rollback),
                    },
                  ]}
                />
              </Space>
            </Panel>
          ) : null}

          {analysis?.risk === "blocked" ? (
            <Alert
              type="warning"
              showIcon
              title="下一步已锁定，请先处理上方阻断项"
              description={
                <Space orientation="vertical" size={6}>
                  <span>
                    目标版本需要高于当前版本；如果当前已是最新版本则无需升级。其他阻断项按建议处理后重新分析即可解锁。
                  </span>
                  <Button size="small" onClick={() => setWizardStep(0)}>
                    返回第一步：更换升级包
                  </Button>
                </Space>
              }
            />
          ) : null}

          <Space orientation="vertical" size={6}>
            <Space>
              <Button onClick={() => setWizardStep(0)}>上一步</Button>
              <Button
                type="primary"
                disabled={
                  !analysis || analysis.risk === "blocked" || analysisRunning
                }
                onClick={() => setWizardStep(2)}
              >
                下一步：按建议执行
              </Button>
            </Space>
            {analysis && analysis.risk !== "blocked" && !analysisRunning ? (
              <span className="muted">
                下一步可调整备份与冲突策略，并完成版本号重复确认后执行。
              </span>
            ) : null}
          </Space>
        </>
      )}
    </Space>
  );

  /* ---------------- 第 3 步：执行确认 ---------------- */

  const stepThree = (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      {!selected || !analysis ? (
        <EmptyState
          icon={<RocketOutlined aria-hidden />}
          text="请先完成升级包选择与智能分析。"
          action={
            <Button onClick={() => setWizardStep(analysis ? 0 : 1)}>
              返回上一步
            </Button>
          }
        />
      ) : (
        <>
          <Alert
            type={analysis.risk === "high" ? "warning" : "info"}
            showIcon
            title={`即将从 ${data?.currentVersion || "当前版本"} 升级到 ${selected.version}`}
            description={
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                <li>任务启动后自动进入维护模式，服务会短暂停止。</li>
                <li>
                  强制备份数据库；代码备份与自动回滚默认勾选，备份存放在 update 目录，不自动清理。
                </li>
                <li>
                  安装依赖 → 构建 → 数据库迁移 → 启动 → 健康检查；健康检查失败会尝试自动回滚。
                </li>
              </ul>
            }
          />

          {tools && !toolsReady ? <ToolSetupGuide tools={tools} /> : null}

          <Panel title="执行选项">
            <Space orientation="vertical" size={12}>
              <Checkbox checked disabled>
                备份数据库（强制）
              </Checkbox>
              <Checkbox
                checked={backupCode}
                onChange={(event) => setBackupCode(event.target.checked)}
              >
                备份当前代码（可一键还原整站）
              </Checkbox>
              <Checkbox
                checked={autoRollback}
                onChange={(event) => setAutoRollback(event.target.checked)}
              >
                失败时自动回滚（需要同时备份数据库与代码）
              </Checkbox>
              <div>
                <Typography.Text strong>本地改动与升级包冲突时</Typography.Text>
                <Radio.Group
                  style={{ display: "block", marginTop: 8 }}
                  value={conflictStrategy}
                  onChange={(event) =>
                    setConflictStrategy(event.target.value as "overwrite" | "abort")
                  }
                  options={[
                    {
                      value: "overwrite",
                      label: "覆盖：直接使用升级包中的文件（推荐，备份可回退）",
                    },
                    {
                      value: "abort",
                      label: "发现冲突就停止：先人工合并后再升级",
                    },
                  ]}
                />
              </div>
            </Space>
          </Panel>

          <Space>
            <Button onClick={() => setWizardStep(1)}>上一步</Button>
            <Button
              type="primary"
              danger
              icon={<RocketOutlined />}
              disabled={dockerBlocked || !toolsReady}
              onClick={() => setConfirmOpen(true)}
            >
              按建议执行升级
            </Button>
            {!toolsReady ? (
              <span className="muted">
                备份工具未就绪：请按上方指引安装后重启后端
              </span>
            ) : dockerBlocked ? (
              <span className="muted">Docker 部署请在宿主机执行升级</span>
            ) : null}
          </Space>
        </>
      )}
    </Space>
  );

  /* ---------------- 第 4 步：执行进度 ---------------- */

  const stepFour = (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      {!runJob ? (
        <EmptyState
          icon={<RocketOutlined aria-hidden />}
          text="当前没有正在执行的升级或还原任务。"
          action={<Button onClick={() => setWizardStep(0)}>开始新的升级</Button>}
        />
      ) : (
        <>
          {runJob.status === "SUCCESS" ? (
            <Alert
              type="success"
              showIcon
              title="任务已完成，服务已恢复"
              description={
                <Space orientation="vertical" size={6}>
                  <span>
                    建议按分析中的「升级后确认」逐项检查；本次备份保留在「备份与还原」，确认运行正常后可手动清理。
                  </span>
                  <Button size="small" onClick={() => setTab("backups")}>
                    查看备份
                  </Button>
                </Space>
              }
            />
          ) : null}
          {runJob.status === "ROLLED_BACK" ? (
            <Alert
              type="warning"
              showIcon
              title="任务失败，已自动回滚到升级前版本"
              description={
                <Space orientation="vertical" size={6}>
                  <span>
                    请根据下方日志排查失败原因；确认数据无误后可以重新发起升级。若回滚不完整，可在「备份与还原」手动恢复。
                  </span>
                  <Button size="small" onClick={() => setTab("backups")}>
                    去备份与还原
                  </Button>
                </Space>
              }
            />
          ) : null}
          <Panel title={`任务 #${runJob.id} · ${runJob.type === "RESTORE" ? "一键还原" : "平台升级"}`}>
            <Space orientation="vertical" size={14} style={{ width: "100%" }}>
              <Space wrap>
                {statusTag(runJob.status)}
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
              {runJob.error ? (
                <Alert
                  type="error"
                  showIcon
                  title={runJob.error}
                  description={
                    <Space>
                      <span>可到「备份与还原」选择这次任务的备份恢复。</span>
                      <Button size="small" onClick={() => setTab("backups")}>
                        去备份与还原
                      </Button>
                    </Space>
                  }
                />
              ) : null}
              <Space>
                {runActive ? (
                  <Button danger onClick={doCancel}>
                    取消任务
                  </Button>
                ) : (
                  <Button onClick={() => setWizardStep(0)}>开始新的升级</Button>
                )}
              </Space>
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
  );

  /* ---------------- 备份与还原 ---------------- */

  const backupRows = backups.data?.list ?? [];
  const backupColumns = [
    {
      title: "任务",
      dataIndex: "jobId",
      width: 90,
      render: (value: number) => `#${value}`,
    },
    {
      title: "类型",
      dataIndex: "kind",
      width: 90,
      render: (value: string) =>
        value === "CODE" ? (
          <Tag color="geekblue">代码</Tag>
        ) : (
          <Tag color="green">数据库</Tag>
        ),
    },
    { title: "版本", dataIndex: "version" },
    {
      title: "方言",
      dataIndex: "dialect",
      width: 100,
      render: (value: string) => value || "—",
    },
    {
      title: "大小",
      dataIndex: "bytes",
      width: 100,
      render: (value: number) => fmtBytes(value),
    },
    {
      title: "校验",
      dataIndex: "verified",
      width: 80,
      render: (value: boolean) =>
        value ? <Tag color="green">已校验</Tag> : <Tag>未校验</Tag>,
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      render: (value: string) => (value ? fmtTime(value) : "—"),
    },
    {
      title: "操作",
      key: "actions",
      width: 160,
      render: (_: unknown, row: UpgradeBackup) => (
        <Space size={4}>
          <Button
            size="small"
            onClick={() => {
              setRestoreTarget(row);
              setRestoreMode("FULL");
              setRestoreText("");
            }}
          >
            还原
          </Button>
          <Popconfirm
            title="删除备份"
            description="删除后无法用于还原，且不可恢复。"
            okText="删除"
            cancelText="取消"
            onConfirm={() => doRemoveBackup(row)}
          >
            <Button size="small" danger type="text">
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const stepItems = [
    { title: "升级包" },
    { title: "智能分析" },
    { title: "执行确认" },
    { title: "执行进度" },
  ];

  return (
    <>
      <PermissionNotice denied={overview.denied || packages.denied || backups.denied} />

      <PanelTabs
        value={tab}
        onChange={setTab}
        items={[
          {
            key: "wizard",
            label: "升级向导",
            children: (
              <div ref={wizardTopRef}>
                <Space orientation="vertical" size={16} style={{ width: "100%" }}>
                  <Notice variant="info">
                  <Space wrap size={8}>
                    <SafetyCertificateOutlined />
                    <span>
                      升级前会强制备份数据库，备份保留在 update 目录不自动清理；任何一步失败都可以在「备份与还原」一键回退。
                    </span>
                  </Space>
                </Notice>
                <Steps
                  current={wizardStep}
                  items={stepItems}
                  onChange={(index) => {
                    if (index > wizardStep) return;
                    if (index === 3 && !runJob) return;
                    setWizardStep(index);
                  }}
                />
                {wizardStep === 0 ? stepOne : null}
                {wizardStep === 1 ? stepTwo : null}
                {wizardStep === 2 ? stepThree : null}
                  {wizardStep === 3 ? stepFour : null}
                </Space>
              </div>
            ),
          },
          {
            key: "backups",
            label: `备份与还原${backupRows.length ? `（${backupRows.length}）` : ""}`,
            children: (
              <Space orientation="vertical" size={16} style={{ width: "100%" }}>
                <Notice variant="warn">
                  完整还原会同时回滚代码与数据库，并重装依赖、重新构建后重启；仅还原数据库只回滚数据。两者都会先进入维护模式。
                </Notice>
                {tools && !toolsReady ? <ToolSetupGuide tools={tools} /> : null}
                <Panel
                  title={`备份台账（共 ${fmtBytes(backups.data?.totalBytes || 0)}）`}
                >
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={{ pageSize: 10, hideOnSinglePage: true }}
                    dataSource={backupRows}
                    columns={backupColumns}
                    locale={{
                      emptyText: "还没有备份；首次执行升级时会自动生成。",
                    }}
                  />
                </Panel>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={confirmOpen}
        title="重复确认：执行平台升级"
        okText="确认执行"
        cancelText="取消"
        confirmLoading={executing}
        okButtonProps={{ danger: true }}
        destroyOnHidden
        onCancel={() => setConfirmOpen(false)}
        onOk={doExecute}
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type="warning"
            showIcon
            title="执行期间服务会短暂停止，并自动进入维护模式。"
            description="数据库备份为强制步骤；任务结束后自动退出维护模式。"
          />
          <div>
            请输入目标版本号 <Typography.Text code>{targetVersion}</Typography.Text>{" "}
            完成确认：
          </div>
          <Input
            value={confirmText}
            placeholder={targetVersion}
            onChange={(event) => setConfirmText(event.target.value)}
          />
        </Space>
      </Modal>

      <Modal
        open={Boolean(restoreTarget)}
        title="一键还原"
        okText="确认还原"
        cancelText="取消"
        confirmLoading={restoring}
        okButtonProps={{ danger: true }}
        destroyOnHidden
        onCancel={() => setRestoreTarget(null)}
        onOk={doRestore}
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type="error"
            showIcon
            title="还原会覆盖当前数据与代码，请确认已选对备份。"
            description="还原前会校验备份文件大小与 SHA-256；完整还原会同时回滚代码与数据库。"
          />
          <div>
            <Typography.Text strong>备份来源</Typography.Text>
            <div className="muted">
              任务 #{restoreTarget?.jobId} · {restoreTarget?.version} ·{" "}
              {restoreTarget?.kind === "CODE" ? "代码备份" : "数据库备份"} ·{" "}
              {fmtBytes(restoreTarget?.bytes || 0)}
            </div>
          </div>
          <Radio.Group
            value={restoreMode}
            onChange={(event) => {
              setRestoreMode(event.target.value as "FULL" | "DATABASE");
              setRestoreText("");
            }}
            options={[
              { value: "FULL", label: "完整还原（代码 + 数据库）" },
              { value: "DATABASE", label: "仅还原数据库" },
            ]}
          />
          <div>
            请输入{" "}
            <Typography.Text code>
              {restoreMode === "FULL" ? "RESTORE" : "RESTORE-DB"}
            </Typography.Text>{" "}
            完成确认：
          </div>
          <Input
            value={restoreText}
            placeholder={restoreMode === "FULL" ? "RESTORE" : "RESTORE-DB"}
            onChange={(event) => setRestoreText(event.target.value)}
          />
        </Space>
      </Modal>
    </>
  );
}
