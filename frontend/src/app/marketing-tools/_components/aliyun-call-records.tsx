"use client";

import {
  DesktopOutlined,
  ExportOutlined,
  EyeOutlined,
  ReloadOutlined,
  RedoOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Descriptions,
  Modal,
  Popconfirm,
  Progress,
  Space,
  Table,
  Tag,
  Tooltip,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, Notice } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import {
  CONSOLE_URL,
  IMPORT_STATUS_COLOR,
  IMPORT_STATUS_LABEL,
  JOB_STATUS_COLOR,
  JOB_STATUS_LABEL,
  ROW_STATUS_COLOR,
  ROW_STATUS_LABEL,
  aliyunCallApi,
  type AliyunImport,
  type AliyunImportDetail,
} from "./aliyun-call-common";

const PAGE_SIZE = 20;
const ROW_PAGE_SIZE = 50;

const modeLabel = (mode: string) =>
  mode === "append" ? "追加已有任务组" : "新建任务组";

const jobStatusLabel = (status: string) =>
  JOB_STATUS_LABEL[status] || status || "—";

/**
 * 任务与进度：本账号的导入批次列表 + 单个批次的行级结果。
 * 任务组状态只做按需刷新（后端 60s 内不重复请求阿里云），提交中每 2s 自动读批次进度。
 */
export function AliyunCallRecords({
  focusImportId,
  onFocusHandled,
}: {
  /** 刚导入完成时由父层传入，打开该批次详情后回调清零。 */
  focusImportId: number | null;
  onFocusHandled: () => void;
}) {
  const { message } = App.useApp();
  const [page, setPage] = useState(1);
  const [list, setList] = useState<AliyunImport[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [busyId, setBusyId] = useState(0);

  const [detail, setDetail] = useState<AliyunImportDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void aliyunCallApi.imports(page, PAGE_SIZE).then((result) => {
      if (!alive) return;
      if (result.data) {
        setList(result.data.list);
        setTotal(result.data.total);
        setError("");
      } else {
        // 保留上一次读到的列表，只把「没读取成功」摆出来
        setError(result.message || "批次列表读取失败");
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [page, tick]);

  const openDetail = useCallback(
    async (id: number, rowPage = 1) => {
      setDetailOpen(true);
      setDetailLoading(true);
      try {
        const data = await aliyunCallApi.importDetail(
          id,
          rowPage,
          ROW_PAGE_SIZE,
        );
        setDetail(data);
      } catch (err) {
        setDetail(null);
        message.error((err as Error).message || "批次详情读取失败");
      } finally {
        setDetailLoading(false);
      }
    },
    [message],
  );

  const pollId = detail?.id || 0;
  const pollRunning =
    detail?.status === "queued" || detail?.status === "running";
  const pollRowPage = detail?.rowPage || 1;
  const pollRowPageSize = detail?.rowPageSize || ROW_PAGE_SIZE;

  useEffect(() => {
    if (!detailOpen || !pollId || !pollRunning) return;
    const timer = window.setInterval(() => {
      void aliyunCallApi
        .importDetail(pollId, pollRowPage, pollRowPageSize)
        .then((next) => setDetail(next))
        .catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [detailOpen, pollId, pollRunning, pollRowPage, pollRowPageSize]);

  useEffect(() => {
    if (!focusImportId) return;
    void openDetail(focusImportId);
    setTick((value) => value + 1);
    onFocusHandled();
  }, [focusImportId, onFocusHandled, openDetail]);

  const mergeDetail = (next: AliyunImport) => {
    setDetail((prev) => (prev && prev.id === next.id ? { ...prev, ...next } : prev));
  };

  const refreshStatus = async (row: AliyunImport) => {
    setBusyId(row.id);
    try {
      const next = await aliyunCallApi.refreshImport(row.id);
      setList((prev) =>
        prev.map((item) => (item.id === next.id ? next : item)),
      );
      mergeDetail(next);
      message.success(
        `任务组状态：${jobStatusLabel(next.jobGroupStatus || "")}`,
      );
    } catch (err) {
      message.error((err as Error).message || "刷新状态失败");
    } finally {
      setBusyId(0);
    }
  };

  const retry = async (row: AliyunImport) => {
    setBusyId(row.id);
    try {
      const next = await aliyunCallApi.retryImport(row.id);
      setList((prev) =>
        prev.map((item) => (item.id === next.id ? next : item)),
      );
      mergeDetail(next);
      message.success("已开始重试失败行，进度见该批次明细");
    } catch (err) {
      message.error((err as Error).message || "重试失败");
    } finally {
      setBusyId(0);
    }
  };

  const columns = [
    {
      title: "批次",
      dataIndex: "id",
      key: "id",
      width: 80,
      render: (value: number) => `#${value}`,
    },
    {
      title: "名单来源",
      dataIndex: "tableName",
      key: "tableName",
      ellipsis: true,
    },
    {
      title: "方式",
      dataIndex: "mode",
      key: "mode",
      width: 140,
      render: (value: string) => modeLabel(value),
    },
    {
      title: "任务组",
      key: "jobGroup",
      ellipsis: true,
      render: (_: unknown, row: AliyunImport) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {row.jobGroupName || row.jobGroupId || "—"}
          </div>
          {row.jobGroupId ? (
            <div className="text-12 muted">{row.jobGroupId}</div>
          ) : null}
        </div>
      ),
    },
    {
      title: "批次状态",
      dataIndex: "status",
      key: "status",
      width: 110,
      render: (value: string) => (
        <Tag color={IMPORT_STATUS_COLOR[value] || "default"}>
          {IMPORT_STATUS_LABEL[value] || value}
        </Tag>
      ),
    },
    {
      title: "提交结果",
      key: "counts",
      width: 190,
      render: (_: unknown, row: AliyunImport) => (
        <span className="text-12">
          {`已提交 ${row.sentRows} · 跳过 ${row.skippedRows}`}
          {row.failedRows ? (
            <span style={{ color: "var(--danger)" }}>
              {` · 失败 ${row.failedRows}`}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      title: "任务组状态",
      dataIndex: "jobGroupStatus",
      key: "jobGroupStatus",
      width: 120,
      render: (value: string) =>
        value ? (
          <Tag color={JOB_STATUS_COLOR[value] || "default"}>
            {jobStatusLabel(value)}
          </Tag>
        ) : (
          <span className="muted">未同步</span>
        ),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 170,
      render: (value: string) => fmtTime(value),
    },
    {
      title: "操作",
      key: "actions",
      width: 280,
      render: (_: unknown, row: AliyunImport) => {
        const running = row.status === "queued" || row.status === "running";
        const canRetry =
          !running &&
          row.failedRows > 0 &&
          (row.status === "failed" || row.status === "partial");
        return (
          <Space size={4} wrap>
            <Button
              icon={<EyeOutlined aria-hidden />}
              onClick={() => void openDetail(row.id)}
            >
              明细
            </Button>
            <Tooltip
              title={
                row.jobGroupId
                  ? "向阿里云读取任务组当前状态（60 秒内不重复请求）"
                  : "该批次还没有任务组，无法刷新"
              }
            >
              <Button
                icon={<ReloadOutlined aria-hidden />}
                disabled={!row.jobGroupId}
                loading={busyId === row.id}
                onClick={() => void refreshStatus(row)}
              >
                刷新
              </Button>
            </Tooltip>
            {canRetry ? (
              <Popconfirm
                title="只重试失败行"
                description="这些号码会给原任务组再次发起外呼，可能产生通话费用。确定重试？"
                okText="重试"
                cancelText="取消"
                onConfirm={() => void retry(row)}
              >
                <Button
                  danger
                  icon={<RedoOutlined aria-hidden />}
                  loading={busyId === row.id}
                >
                  重试失败行
                </Button>
              </Popconfirm>
            ) : null}
          </Space>
        );
      },
    },
  ];

  const rowColumns = [
    {
      title: "源表行号",
      dataIndex: "sourceRowId",
      key: "sourceRowId",
      width: 100,
    },
    { title: "姓名", dataIndex: "name", key: "name", ellipsis: true },
    {
      title: "被叫号码",
      dataIndex: "phoneMasked",
      key: "phoneMasked",
      width: 150,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 110,
      render: (value: string) => (
        <Tag color={ROW_STATUS_COLOR[value] || "default"}>
          {ROW_STATUS_LABEL[value] || value}
        </Tag>
      ),
    },
    {
      title: "阿里云任务 ID",
      dataIndex: "jobId",
      key: "jobId",
      width: 200,
      ellipsis: true,
      render: (value: string) => value || "—",
    },
    {
      title: "失败原因",
      dataIndex: "errorMessage",
      key: "errorMessage",
      ellipsis: true,
      render: (value: string) => value || "—",
    },
  ];

  const submittableRows = detail
    ? Math.max(detail.totalRows - detail.skippedRows, 0)
    : 0;
  const submitPercent =
    detail && submittableRows > 0
      ? Math.min(100, Math.round((detail.sentRows / submittableRows) * 100))
      : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span className="text-12 muted">
          {`共 ${total} 个导入批次；批次只属于当前登录账号。任务组状态按需刷新。`}
        </span>
        <Space size={8}>
          <Button
            icon={<ReloadOutlined aria-hidden />}
            onClick={() => setTick((value) => value + 1)}
          >
            刷新列表
          </Button>
          <Button
            icon={<DesktopOutlined aria-hidden />}
            onClick={() =>
              window.open(CONSOLE_URL, "_blank", "noopener,noreferrer")
            }
          >
            阿里云控制台
          </Button>
        </Space>
      </div>

      {error ? <Notice variant="warn">{error}</Notice> : null}

      <Table
        size="middle"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={list}
        scroll={{ x: 1180 }}
        locale={{
          emptyText: (
            <EmptyState text="还没有导入批次：到「导入名单」把多维表格的号码交给阿里云。" />
          ),
        }}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          showSizeChanger: false,
          onChange: (next) => setPage(next),
          showTotal: (count) => `共 ${count} 个批次`,
        }}
      />

      <Modal
        open={detailOpen}
        width={980}
        title={
          detail
            ? `批次 #${detail.id} · ${detail.tableName}`
            : "批次详情"
        }
        footer={
          <Space>
            {detail?.jobGroupId ? (
              <Button
                icon={<ReloadOutlined aria-hidden />}
                loading={busyId === detail.id}
                onClick={() => void refreshStatus(detail)}
              >
                刷新任务组状态
              </Button>
            ) : null}
            <Button
              icon={<ExportOutlined aria-hidden />}
              onClick={() =>
                window.open(CONSOLE_URL, "_blank", "noopener,noreferrer")
              }
            >
              去阿里云控制台
            </Button>
            <Button type="primary" onClick={() => setDetailOpen(false)}>
              关闭
            </Button>
          </Space>
        }
        onCancel={() => setDetailOpen(false)}
      >
        {detailLoading && !detail ? (
          <div className="text-12 muted">读取中…</div>
        ) : detail ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Descriptions
              size="small"
              column={2}
              items={[
                { key: "mode", label: "导入方式", children: modeLabel(detail.mode) },
                {
                  key: "status",
                  label: "批次状态",
                  children: (
                    <Tag color={IMPORT_STATUS_COLOR[detail.status] || "default"}>
                      {IMPORT_STATUS_LABEL[detail.status] || detail.status}
                    </Tag>
                  ),
                },
                {
                  key: "jobGroup",
                  label: "任务组",
                  children: `${detail.jobGroupName || "—"}${
                    detail.jobGroupId ? `（${detail.jobGroupId}）` : ""
                  }`,
                },
                {
                  key: "jobStatus",
                  label: "任务组状态",
                  children: detail.jobGroupStatus ? (
                    <Tag
                      color={JOB_STATUS_COLOR[detail.jobGroupStatus] || "default"}
                    >
                      {jobStatusLabel(detail.jobGroupStatus)}
                    </Tag>
                  ) : (
                    "未同步"
                  ),
                },
                {
                  key: "counts",
                  label: "提交结果",
                  children: `已提交 ${detail.sentRows} · 跳过 ${detail.skippedRows} · 失败 ${detail.failedRows}`,
                },
                {
                  key: "created",
                  label: "创建时间",
                  children: fmtTime(detail.createdAt),
                },
              ]}
            />

            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                {`名单提交进度（不含跳过行）：已提交 ${detail.sentRows} / ${submittableRows}`}
              </div>
              <Progress
                percent={submitPercent}
                status={detail.status === "failed" ? "exception" : undefined}
              />
            </div>

            {detail.errorMessage ? (
              <Notice variant="error">{detail.errorMessage}</Notice>
            ) : null}

            <Table
              size="small"
              rowKey="id"
              columns={rowColumns}
              dataSource={detail.rows}
              scroll={{ x: 900 }}
              pagination={{
                current: detail.rowPage,
                pageSize: detail.rowPageSize,
                total: detail.rowTotal,
                showSizeChanger: false,
                onChange: (next) => {
                  if (!detail) return;
                  void openDetail(detail.id, next);
                },
                showTotal: (count) => `共 ${count} 行`,
              }}
            />
          </div>
        ) : (
          <div className="text-12 muted">批次详情读取失败</div>
        )}
      </Modal>
    </div>
  );
}
