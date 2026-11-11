"use client";

import {
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  InboxOutlined,
  ReloadOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  ConfigProvider,
  Input,
  Modal,
  Select,
  Space,
  Table,
} from "antd";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { MyTaskRow, TaskSummary } from "@enterprise/contracts";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import {
  EmptyState,
  Notice,
  PageHero,
  Panel,
  PillTabs,
  StatCard,
  StatGrid,
} from "@/components/ui/panel";
import { taskCenterApi } from "@/api/task-center";
import { PAGE_META } from "@/config/routes";
import { resolveStatus } from "@/lib/status";
import { useBusinessMutation, useBusinessQuery } from "@/query/business";

function fmtDay(value: string | null) {
  return value ? value.slice(0, 10) : "—";
}

/**
 * 统一任务中心「我的任务」：把各业务模块的待办聚成一屏（只读聚合 + 本人关闭 / 重开）。
 * 任务归口只有一处：源模块要么推、要么被拉，明细仍在对应模块办理。
 */
export default function TasksPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const meta = PAGE_META["/tasks"];
  const { request: requestPassword, modal: passwordModal } = usePasswordConfirm();
  const [paging, setPaging] = useState({ page: 1, pageSize: 20 });
  const [scope, setScope] = useState<"unclosed" | "all">("unclosed");
  const [category, setCategory] = useState("");
  const [source, setSource] = useState("");
  const [keyword, setKeyword] = useState("");
  const [formRow, setFormRow] = useState<MyTaskRow | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const noteRef = useRef("");

  const params = {
    page: paging.page,
    pageSize: paging.pageSize,
    ...(category ? { category } : {}),
    ...(source ? { source } : {}),
    ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
    // includeClosed 为 z.coerce.boolean()：传 false 会被当成 true，未办时直接省略该参数。
    ...(scope === "all" ? { includeClosed: true } : {}),
  };

  const listQuery = useBusinessQuery("my-tasks", "list", params, (signal) =>
    taskCenterApi.list({ query: params }, { signal }),
  );
  const rows: MyTaskRow[] = listQuery.data?.list || [];
  const summary: TaskSummary | undefined = listQuery.data?.summary;

  const closeMutation = useBusinessMutation(
    (input: { params: { id: string }; body: { note?: string } }) =>
      taskCenterApi.close(input),
    ["my-tasks"],
  );
  const reopenMutation = useBusinessMutation(
    (input: { params: { id: string } }) => taskCenterApi.reopen(input),
    ["my-tasks"],
  );
  const submitFormMutation = useBusinessMutation(
    (input: {
      params: { id: string };
      body: { values: Record<string, string>; note?: string };
    }) => taskCenterApi.submitForm(input),
    ["my-tasks"],
  );

  /** 改筛选条件时回到第一页，避免停留在越界页。 */
  const resetPage = () => setPaging((prev) => ({ ...prev, page: 1 }));

  const askClose = (row: MyTaskRow) => {
    noteRef.current = "";
    requestPassword({
      title: "关闭任务",
      okText: "确认关闭",
      content: (
        <div>
          <div className="text-12 muted" style={{ marginBottom: 6 }}>
            {`「${row.title}」将归入「已关闭」；由工作流派发的节点会唤醒流程继续执行。`}
          </div>
          <Input.TextArea
            rows={2}
            maxLength={500}
            placeholder="关闭说明（选填）"
            onChange={(event) => {
              noteRef.current = event.target.value;
            }}
          />
        </div>
      ),
      onOk: async () => {
        const note = noteRef.current.trim();
        await closeMutation.mutateAsync({
          params: { id: String(row.id) },
          body: note ? { note } : {},
        });
        message.success("任务已关闭");
      },
    });
  };

  const openForm = (row: MyTaskRow) => {
    setFormValues({});
    setFormErrors({});
    setFormRow(row);
  };

  const submitForm = () => {
    if (!formRow?.formSchema) return;
    const errors: Record<string, string> = {};
    for (const field of formRow.formSchema.fields) {
      if (field.required && !(formValues[field.key] || "").trim()) {
        errors[field.key] = `请填写「${field.label}」`;
      }
    }
    setFormErrors(errors);
    if (Object.keys(errors).length) return;
    submitFormMutation.mutate(
      {
        params: { id: String(formRow.id) },
        body: { values: formValues },
      },
      {
        onSuccess: () => {
          message.success("已提交，流程继续");
          setFormRow(null);
        },
      },
    );
  };

  const reopen = (row: MyTaskRow) => {
    reopenMutation.mutate(
      { params: { id: String(row.id) } },
      { onSuccess: () => message.success("任务已重开") },
    );
  };

  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="我的任务"
        desc={meta.description}
        extra={
          <Button
            icon={<ReloadOutlined />}
            loading={listQuery.isFetching}
            onClick={() => void listQuery.refetch()}
          >
            刷新
          </Button>
        }
      />

      <StatGrid>
        <StatCard
          label="未办"
          value={summary?.pending ?? "—"}
          hint="待处理 + 处理中"
          icon={<UnorderedListOutlined aria-hidden />}
        />
        <StatCard
          label="处理中"
          value={summary?.doing ?? "—"}
          hint="已接手、尚未办结"
          icon={<ClockCircleOutlined aria-hidden />}
        />
        <StatCard
          label="今日到期"
          value={summary?.dueToday ?? "—"}
          hint="截止时间落在今天"
          icon={<ClockCircleOutlined aria-hidden />}
        />
        <StatCard
          label="已逾期"
          value={summary?.overdue ?? "—"}
          hint="已过截止时间仍未办结"
          icon={<ExclamationCircleOutlined aria-hidden />}
        />
        <StatCard
          label="已关闭"
          value={summary?.closed ?? "—"}
          hint="已完成 / 已取消 / 已失效"
          icon={<InboxOutlined aria-hidden />}
        />
      </StatGrid>

      <Notice variant="info">
        本页只做聚合与关闭 / 重开，任务明细仍在对应模块办理：点「去处理」跳转到源模块。
        已办结的任务默认不显示，切「全部」可查看。
      </Notice>

      <Panel
        title="任务清单"
        extra={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Select
              value={category}
              style={{ width: 130 }}
              onChange={(value) => {
                resetPage();
                setCategory(value);
              }}
              options={[
                { value: "", label: "全部分类" },
                ...(summary?.byCategory || []).map((item) => ({
                  value: item.key,
                  label: `${item.label}（${item.count}）`,
                })),
              ]}
            />
            <Select
              value={source}
              style={{ width: 150 }}
              onChange={(value) => {
                resetPage();
                setSource(value);
              }}
              options={[
                { value: "", label: "全部来源" },
                ...(summary?.bySource || []).map((item) => ({
                  value: item.key,
                  label: `${item.label}（${item.count}）`,
                })),
              ]}
            />
            <Input.Search
              allowClear
              style={{ width: 220 }}
              placeholder="搜索标题 / 内容"
              onSearch={(value) => {
                resetPage();
                setKeyword(value);
              }}
            />
          </div>
        }
      >
        <div className="table-wrap">
          <PillTabs
            items={[
              { key: "unclosed", label: "未办", count: summary?.pending },
              { key: "all", label: "全部" },
            ]}
            value={scope}
            variant="soft"
            size="small"
            onChange={(key) => {
              resetPage();
              setScope(key as "unclosed" | "all");
            }}
            style={{ marginBottom: 12 }}
          />
          {listQuery.error && (
            <Notice variant="error">
              任务加载失败：{listQuery.error.message}
            </Notice>
          )}
          <Table<MyTaskRow>
            rowKey="id"
            loading={listQuery.isPending}
            dataSource={rows}
            pagination={{
              current: paging.page,
              pageSize: paging.pageSize,
              total: listQuery.data?.total || 0,
              onChange: (page, pageSize) => setPaging({ page, pageSize }),
            }}
            size="middle"
            locale={{
              emptyText: (
                <EmptyState
                  icon={<InboxOutlined aria-hidden />}
                  text={
                    scope === "unclosed"
                      ? "当前没有待办任务：各模块把需要你处理的事推送或汇聚到这里"
                      : "暂无任务记录"
                  }
                />
              ),
            }}
            columns={[
              {
                title: "任务",
                dataIndex: "title",
                render: (_: unknown, row: MyTaskRow) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {row.link ? (
                        <a onClick={() => router.push(row.link)}>{row.title}</a>
                      ) : (
                        row.title
                      )}
                    </div>
                    {row.description ? (
                      <div
                        className="text-12 muted"
                        style={{ marginTop: 2 }}
                      >
                        {row.description}
                      </div>
                    ) : null}
                    {row.formData ? (
                      <div className="text-12" style={{ marginTop: 4 }}>
                        {row.formSchema?.fields
                          .filter((field) => row.formData?.[field.key])
                          .map(
                            (field) =>
                              `${field.label}：${row.formData?.[field.key]}`,
                          )
                          .join("；")}
                      </div>
                    ) : null}
                  </div>
                ),
              },
              {
                title: "分类",
                dataIndex: "categoryLabel",
                width: 90,
                render: (value: string) => (
                  <span className="badge badge-sky">{value}</span>
                ),
              },
              {
                title: "来源",
                dataIndex: "sourceLabel",
                width: 110,
                render: (value: string) => (
                  <span className="badge badge-gray">{value}</span>
                ),
              },
              {
                title: "优先级",
                dataIndex: "priorityLabel",
                width: 90,
                render: (value: string, row: MyTaskRow) => (
                  <span
                    className={`badge badge-${resolveStatus("taskPriority", row.priority).variant}`}
                  >
                    {value}
                  </span>
                ),
              },
              {
                title: "业务状态",
                dataIndex: "sourceStatusLabel",
                width: 110,
                render: (value: string) =>
                  value ? (
                    <span className="text-12">{value}</span>
                  ) : (
                    <span className="text-12 muted">—</span>
                  ),
              },
              {
                title: "中心状态",
                dataIndex: "statusLabel",
                width: 100,
                render: (value: string, row: MyTaskRow) => (
                  <span
                    className={`badge badge-${resolveStatus("task", row.status).variant}`}
                  >
                    {value}
                  </span>
                ),
              },
              {
                title: "截止",
                dataIndex: "dueAt",
                width: 130,
                render: (value: string | null, row: MyTaskRow) => (
                  <div>
                    <div>{fmtDay(value)}</div>
                    {row.overdue ? (
                      <div
                        className="text-12"
                        style={{ color: "var(--danger)" }}
                      >
                        已逾期
                      </div>
                    ) : null}
                  </div>
                ),
              },
              {
                title: "操作",
                width: 180,
                render: (_: unknown, row: MyTaskRow) => {
                  const unclosed =
                    row.status === "OPEN" || row.status === "DOING";
                  return (
                    <Space size={6} wrap>
                      {unclosed && row.formSchema ? (
                        <Button
                          size="small"
                          type="primary"
                          onClick={() => openForm(row)}
                        >
                          填写
                        </Button>
                      ) : null}
                      {row.link ? (
                        <Button
                          size="small"
                          onClick={() => router.push(row.link)}
                        >
                          去处理
                        </Button>
                      ) : null}
                      {unclosed ? (
                        <Button
                          size="small"
                          danger
                          onClick={() => askClose(row)}
                        >
                          关闭
                        </Button>
                      ) : (
                        <Button size="small" onClick={() => reopen(row)}>
                          重开
                        </Button>
                      )}
                    </Space>
                  );
                },
              },
            ]}
          />
        </div>
      </Panel>

      <Modal
        open={Boolean(formRow)}
        title={
          formRow?.formSchema?.title
            ? `填写：${formRow.formSchema.title}`
            : "填写表单"
        }
        okText="提交"
        cancelText="取消"
        confirmLoading={submitFormMutation.isPending}
        onOk={submitForm}
        onCancel={() => {
          if (!submitFormMutation.isPending) setFormRow(null);
        }}
        destroyOnHidden
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {(formRow?.formSchema?.fields || []).map((field) => (
            <div key={field.key}>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                {field.label}
                {field.required ? (
                  <span style={{ color: "var(--danger)" }}> *</span>
                ) : null}
              </div>
              <Input.TextArea
                autoSize={{ minRows: 1, maxRows: 5 }}
                maxLength={2000}
                value={formValues[field.key] || ""}
                status={formErrors[field.key] ? "error" : undefined}
                onChange={(event) => {
                  setFormValues((prev) => ({
                    ...prev,
                    [field.key]: event.target.value,
                  }));
                  if (formErrors[field.key]) {
                    setFormErrors((prev) => ({ ...prev, [field.key]: "" }));
                  }
                }}
              />
              {formErrors[field.key] ? (
                <div
                  style={{
                    color: "var(--danger)",
                    fontSize: 12,
                    marginTop: 4,
                  }}
                >
                  {formErrors[field.key]}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Modal>

      {passwordModal}
    </ConfigProvider>
  );
}
