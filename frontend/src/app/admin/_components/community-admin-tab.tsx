"use client";

import { App, Button, Form, Image, Input, InputNumber, Modal, Progress, Space, Table, Tag } from "antd";
import type { TableProps } from "antd";
import { useCallback, useEffect, useState } from "react";
import { communityAdminApi } from "@/api/community";
import {
  COMMUNITY_STATUSES,
  COMMUNITY_STATUS_LABELS,
  type CommunityAwardSettings,
  type CommunitySlot,
  type CommunityWorkflowCard,
} from "@enterprise/contracts";
import { EmptyState, Notice, Panel, PillTabs, StatCard, StatGrid } from "@/components/ui/panel";

/** 审核队列里的一行：卡片字段 + 作者账号、槽位与提交时间（契约在 CommunityAdmin_pending 里 extend 出来）。 */
type AuditRow = CommunityWorkflowCard & {
  ownerUserId: string;
  slots: CommunitySlot[];
  submittedAt: string;
};

/** 队列页签：与契约 COMMUNITY_STATUSES 同源，默认看待审。 */
type AuditStatus = (typeof COMMUNITY_STATUSES)[number];

type Stats = {
  pending: number;
  approved: number;
  recommended: number;
  rejected: number;
  removed: number;
  official: number;
  user: number;
  runsToday: number;
  rewardPointsToday: number;
  keyBoundUsers: number;
};

/** 迁移预览：验 Key 通过后上游给出的可迁移量。 */
type ImportPreview = {
  verified: boolean;
  workflows: number;
  jobs: number;
  media: number;
};

/** 迁移任务进度（进程内任务，进程重启后回到 idle）。 */
type ImportStatus = {
  taskId: string;
  state: "idle" | "running" | "done" | "failed";
  total: number;
  done: number;
  importedWorkflows: number;
  importedMedia: number;
  skipped: number;
  failed: number;
  message: string;
  startedAt: string;
  finishedAt: string;
};

const PAGE_SIZE = 20;

const STATUS_COLOR: Record<string, string> = {
  PENDING: "gold",
  APPROVED: "blue",
  RECOMMENDED: "green",
  REJECTED: "red",
  REMOVED: "default",
};

const ACTION_LABELS: Record<string, string> = {
  approve: "通过",
  reject: "驳回",
  recommend: "推荐进市场",
  remove: "下架",
};

/**
 * 平台后台「创意社区」：审核队列 + 推荐发奖 + 积分规则。
 *
 * 推荐是唯一会给账号加分的动作，所以必须先把状态收成 APPROVED 才允许点；
 * 发奖本身在后端按流水做终身幂等，这里重复点不会重复得分。
 */
export function CommunityAdminTab() {
  const { message } = App.useApp();
  const [status, setStatus] = useState<AuditStatus>("PENDING");
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [settings, setSettings] = useState<CommunityAwardSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [busyCode, setBusyCode] = useState("");
  const [importKey, setImportKey] = useState("");
  const [importLimit, setImportLimit] = useState(20);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [task, setTask] = useState<ImportStatus | null>(null);
  const taskState = task?.state;
  const [form] = Form.useForm();

  const loadStats = useCallback(() => {
    communityAdminApi
      .stats()
      .then((data) => setStats(data as Stats | null))
      .catch(() => setStats(null));
  }, []);

  const loadSettings = useCallback(() => {
    communityAdminApi
      .settings()
      .then((data) => {
        if (!data) return;
        setSettings(data);
        form.setFieldsValue(data);
      })
      .catch(() => setSettings(null));
  }, [form]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await communityAdminApi.pending({
        query: {
          page,
          pageSize: PAGE_SIZE,
          status,
          keyword: keyword.trim() || undefined,
        },
      });
      setRows(data?.list || []);
      setTotal(data?.total || 0);
    } catch (caught) {
      message.error((caught as Error).message || "审核队列读取失败");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, status, keyword, message]);

  useEffect(() => {
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status]);

  useEffect(() => {
    loadStats();
    loadSettings();
  }, [loadStats, loadSettings]);

  // 迁移任务轮询：只在 running 时开表；结束后刷新队列与统计
  useEffect(() => {
    if (taskState !== "running") return;
    const timer = setInterval(async () => {
      try {
        const data = await communityAdminApi.importStatus();
        if (!data) return;
        setTask(data as ImportStatus);
        if (data.state !== "running") {
          void loadRows();
          loadStats();
        }
      } catch {
        // 轮询失败静默：下一轮再试，避免把网络抖动弹成错误
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [taskState, loadRows, loadStats]);

  const decide = (row: AuditRow, action: "approve" | "reject" | "recommend" | "remove") => {
    if (action === "reject") {
      let note = "";
      Modal.confirm({
        title: "驳回这份工作流",
        content: (
          <div>
            <div className="text-12 muted" style={{ marginBottom: 8 }}>
              驳回理由会原样显示给作者，写清楚要改哪里（节点不受支持、含凭据字段、参数没开放…）。
            </div>
            <Input.TextArea
              rows={3}
              maxLength={500}
              onChange={(event) => {
                note = event.target.value;
              }}
            />
          </div>
        ),
        okText: "驳回",
        okButtonProps: { danger: true },
        onOk: async () => {
          if (!note.trim()) {
            message.warning("驳回必须填写理由");
            throw new Error("缺少驳回理由");
          }
          await runDecide(row, action, note.trim());
        },
      });
      return;
    }
    Modal.confirm({
      title: ACTION_LABELS[action],
      content:
        action === "recommend"
          ? "推荐进市场后会按后台规则给发布者发放积分奖励（同一份工作流只发一次）。"
          : action === "approve"
            ? "通过后社区里就能看到并可运行这份工作流。"
            : "下架后社区不再显示，作者可以改好再重新提交审核。",
      okText: ACTION_LABELS[action],
      okButtonProps: { danger: action === "remove" },
      onOk: () => runDecide(row, action, ""),
    });
  };

  const runDecide = async (
    row: AuditRow,
    action: "approve" | "reject" | "recommend" | "remove",
    note: string,
  ) => {
    setBusyCode(row.code);
    try {
      const data = await communityAdminApi.decide({
        params: { code: row.code },
        body: { action, note },
      });
      if (!data) throw new Error("操作失败");
      message.success(
        data.rewarded
          ? `已${ACTION_LABELS[action]}，并奖励发布者 ${data.rewardPoints} 积分`
          : `已${ACTION_LABELS[action]}`,
      );
      void loadRows();
      loadStats();
    } catch (caught) {
      message.error((caught as Error).message || "操作失败");
    } finally {
      setBusyCode("");
    }
  };

  const saveSettings = async () => {
    const values = await form.validateFields();
    setSavingSettings(true);
    try {
      const data = await communityAdminApi.saveSettings({
        body: {
          approveReward: Number(values.approveReward || 0),
          recommendReward: Number(values.recommendReward || 0),
          perUserDailyCap: Number(values.perUserDailyCap || 0),
          siteDailyCap: Number(values.siteDailyCap || 0),
        },
      });
      if (data) {
        setSettings(data);
        form.setFieldsValue(data);
        message.success("积分规则已保存");
        loadStats();
      }
    } catch (caught) {
      message.error((caught as Error).message || "保存失败");
    } finally {
      setSavingSettings(false);
    }
  };

  /** 先验证：Key 真打一次上游，并清点可迁移的工作流与历史任务。 */
  const verifyImport = async () => {
    const apiKey = importKey.trim();
    if (!apiKey) {
      message.warning("请先粘贴 Comfy Cloud API Key");
      return;
    }
    setPreviewing(true);
    setPreview(null);
    try {
      const data = await communityAdminApi.importPreview({ body: { apiKey } });
      if (!data) throw new Error("验证没有返回结果");
      setPreview(data as ImportPreview);
      message.success(
        `Key 验证通过：可迁移工作流 ${data.workflows} 份、历史任务 ${data.jobs} 个`,
      );
    } catch (caught) {
      message.error((caught as Error).message || "验证失败");
    } finally {
      setPreviewing(false);
    }
  };

  /** 只有验证通过才允许点迁移；后端会再验一次 Key 与存储渠道。 */
  const startImport = async () => {
    if (!preview?.verified) {
      message.warning("请先点「验证并预览」，确认 Key 可用再迁移");
      return;
    }
    setImporting(true);
    try {
      const data = await communityAdminApi.importStart({
        body: {
          apiKey: importKey.trim(),
          includeWorkflows: true,
          includeJobs: true,
          limit: importLimit,
        },
      });
      if (!data) throw new Error("迁移没有返回任务");
      setTask({
        taskId: data.taskId,
        state: "running",
        total: data.total,
        done: 0,
        importedWorkflows: 0,
        importedMedia: 0,
        skipped: 0,
        failed: 0,
        message: "正在迁移，请保持页面打开…",
        startedAt: new Date().toISOString(),
        finishedAt: "",
      });
      message.success(`迁移已开始：共 ${data.total} 个条目`);
    } catch (caught) {
      message.error((caught as Error).message || "迁移启动失败");
    } finally {
      setImporting(false);
    }
  };

  const columns: TableProps<AuditRow>["columns"] = [
    {
      title: "工作流",
      dataIndex: "title",
      render: (_value, row) => (
        <Space align="start" size={10}>
          {row.covers.length ? (
            <Image
              src={row.covers[0]}
              alt={row.title}
              width={72}
              height={48}
              style={{ objectFit: "cover", borderRadius: 6 }}
            />
          ) : null}
          <div style={{ minWidth: 0 }}>
            <div>{row.title}</div>
            <div className="text-12 muted">
              {row.source === "OFFICIAL" ? "官方模板" : row.ownerName || row.ownerUserId}
              {" · "}
              {row.categoryLabel}
              {row.groupLabel ? ` / ${row.groupLabel}` : ""}
              {" · "}
              {row.format === "api" ? "可直接运行" : "仅浏览"}
            </div>
          </div>
        </Space>
      ),
    },
    {
      title: "开放参数",
      dataIndex: "slots",
      width: 180,
      render: (value: AuditRow["slots"]) =>
        value.length ? (
          <Space size={4} wrap>
            {value.slice(0, 4).map((slot) => (
              <Tag key={slot.key}>{slot.label || slot.key}</Tag>
            ))}
            {value.length > 4 ? <span className="text-12 muted">+{value.length - 4}</span> : null}
          </Space>
        ) : (
          <span className="text-12 muted">未开放</span>
        ),
    },
    {
      title: "热度",
      dataIndex: "runCount",
      width: 130,
      render: (_value, row) => (
        <span className="text-12">
          {row.runCount} 跑 · {row.likeCount} 赞 · {row.viewCount} 看
        </span>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 110,
      render: (value: string) => (
        <Tag color={STATUS_COLOR[value] || "default"}>
          {COMMUNITY_STATUS_LABELS[value] || value}
        </Tag>
      ),
    },
    {
      title: "操作",
      width: 260,
      render: (_value, row) => (
        <Space size={6} wrap>
          {row.status === "PENDING" ? (
            <Button
              type="primary"
              size="small"
              loading={busyCode === row.code}
              onClick={() => decide(row, "approve")}
            >
              通过
            </Button>
          ) : null}
          {row.status === "PENDING" || row.status === "APPROVED" ? (
            <Button size="small" danger loading={busyCode === row.code} onClick={() => decide(row, "reject")}>
              驳回
            </Button>
          ) : null}
          {row.status === "APPROVED" ? (
            <Button size="small" loading={busyCode === row.code} onClick={() => decide(row, "recommend")}>
              推荐
            </Button>
          ) : null}
          {row.status === "RECOMMENDED" || row.status === "APPROVED" ? (
            <Button size="small" danger loading={busyCode === row.code} onClick={() => decide(row, "remove")}>
              下架
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <>
      <Panel title="社区概况">
        <StatGrid>
          <StatCard label="待审核" value={stats?.pending ?? "-"} />
          <StatCard label="已通过" value={stats?.approved ?? "-"} />
          <StatCard label="已推荐" value={stats?.recommended ?? "-"} />
          <StatCard label="已驳回" value={stats?.rejected ?? "-"} />
          <StatCard label="已下架" value={stats?.removed ?? "-"} />
          <StatCard label="官方条目" value={stats?.official ?? "-"} />
          <StatCard label="用户条目" value={stats?.user ?? "-"} />
          <StatCard label="今日运行次数" value={stats?.runsToday ?? "-"} />
          <StatCard label="今日发放奖励" value={stats?.rewardPointsToday ?? "-"} hint="积分" />
          <StatCard label="已连 Key 人数" value={stats?.keyBoundUsers ?? "-"} />
        </StatGrid>
      </Panel>

      <Panel title="迁移 Comfy Cloud 工作流">
        <Notice variant="info">
          粘贴 Comfy Cloud API Key，先「验证并预览」再「同步迁移」：已保存的工作流 JSON、历史任务里的图片与视频
          都会转存进后台设定好的存储渠道（系统配置 → OSS），作者统一挂在当前管理员账号名下；
          同一份内容重复迁移会自动跳过。
        </Notice>
        <div style={{ marginTop: 12, maxWidth: 460 }}>
          <div className="text-12 muted" style={{ marginBottom: 6 }}>
            Comfy Cloud API Key
          </div>
          <Input.Password
            value={importKey}
            autoComplete="off"
            placeholder="在 platform.comfy.org → API Keys 生成后粘贴到这里"
            onChange={(event) => {
              setImportKey(event.target.value);
              // Key 一改，之前的验证结果就不能再用来启动迁移
              setPreview(null);
            }}
          />
          <div className="text-12 muted" style={{ margin: "12px 0 6px" }}>
            最多迁移多少个历史任务（按创建时间倒序）
          </div>
          <InputNumber
            min={1}
            max={100}
            precision={0}
            style={{ width: "100%" }}
            value={importLimit}
            onChange={(value) => setImportLimit(Number(value) || 20)}
          />
          <Space style={{ marginTop: 12 }}>
            <Button loading={previewing} onClick={() => void verifyImport()}>
              验证并预览
            </Button>
            <Button
              type="primary"
              disabled={!preview?.verified}
              loading={importing}
              onClick={() => void startImport()}
            >
              同步迁移
            </Button>
          </Space>
        </div>
        {preview ? (
          <StatGrid>
            <StatCard label="已保存工作流" value={preview.workflows} hint="份" />
            <StatCard label="历史任务" value={preview.jobs} hint="个" />
            <StatCard label="预期媒体" value={preview.media} hint="个" />
          </StatGrid>
        ) : null}
        {task ? (
          <div style={{ marginTop: 12, maxWidth: 640 }}>
            <Progress
              percent={task.total ? Math.round((task.done / task.total) * 100) : 0}
              status={
                task.state === "failed"
                  ? "exception"
                  : task.state === "done"
                    ? "success"
                    : "active"
              }
            />
            <div className="text-12 muted">
              {task.message}
              {task.state === "running" ? `（${task.done}/${task.total}）` : null}
              {task.importedMedia ? ` · 已入库媒体 ${task.importedMedia} 个` : null}
            </div>
          </div>
        ) : null}
      </Panel>

      <Panel
        title="审核队列"
        titleExtra={
          <Input
            style={{ width: 220 }}
            allowClear
            placeholder="搜索标题或简介，回车查询"
            maxLength={120}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={() => {
              setPage(1);
              void loadRows();
            }}
          />
        }
        extra={
          <PillTabs
            size="small"
            variant="soft"
            items={COMMUNITY_STATUSES.map((item) => ({
              key: item,
              label: COMMUNITY_STATUS_LABELS[item] || item,
            }))}
            value={status}
            onChange={(key) => {
              setStatus(key as AuditStatus);
              setPage(1);
            }}
          />
        }
      >
        <div className="table-wrap">
          <Table<AuditRow>
            rowKey="code"
            size="middle"
            loading={loading}
            dataSource={rows}
            columns={columns}
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total,
              showSizeChanger: false,
              onChange: setPage,
            }}
            locale={{ emptyText: <EmptyState text="这个队列里暂时没有内容。" /> }}
          />
        </div>
      </Panel>

      <Panel title="积分规则">
        <Notice variant="info">
          规则落在积分设置表里，随时可改：审核通过是小额鼓励（默认 0＝不发），推荐进市场才是主推奖。
          两个帽子按自然日统计，同一份工作流的同一种奖励按积分流水终身幂等，只发一次。
        </Notice>
        <Form form={form} layout="vertical" style={{ marginTop: 12, maxWidth: 460 }}>
          <Form.Item name="approveReward" label="审核通过赠分（0＝不发）">
            <InputNumber min={0} max={10000} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="recommendReward" label="推荐进市场奖励（0＝不发）">
            <InputNumber min={0} max={100000} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="perUserDailyCap" label="单人单日奖励上限（0＝不限）">
            <InputNumber min={0} max={1000000} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="siteDailyCap" label="全站单日发放预算（0＝不限）">
            <InputNumber min={0} max={10000000} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Button type="primary" loading={savingSettings} onClick={() => void saveSettings()}>
            保存规则
          </Button>
        </Form>
        {settings ? null : (
          <div className="text-12 muted" style={{ marginTop: 8 }}>
            规则读取失败：确认当前账号是平台管理员后刷新本页。
          </div>
        )}
      </Panel>
    </>
  );
}
