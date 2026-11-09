"use client";

import { App, Badge, Button, Checkbox, Input, Pagination, Select, Space, Table, Tag } from "antd";
import type { TableProps } from "antd";
import {
  ApiOutlined,
  SearchOutlined,
  StarFilled,
  UploadOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useState } from "react";
import { communityApi } from "@/api/community";
import { EmptyState, Notice, Panel, PillTabs } from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";
import type {
  CommunityCategory,
  CommunityCategoryRow,
  CommunityCredentialStatus,
  CommunityDraft,
  CommunityRun,
  CommunityWorkflowCard,
  CommunityWorkflowDetail,
} from "@enterprise/contracts";
import { PublishModal } from "./publish-modal";
import { RunBlock, ACTIVE_RUN_STATUSES, timeText } from "./run-list";
import { WorkflowDrawer } from "./workflow-drawer";

const PAGE_SIZE = 20;
/** 我的产物页多久拉一次：与详情抽屉一个口径，够跟上上游排队就好。 */
const POLL_MS = 8000;

type SortKey = "recommend" | "hot" | "new";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recommend", label: "推荐" },
  { key: "hot", label: "热门" },
  { key: "new", label: "最新" },
];

/** 卡片封面：没有图时留一块同比例的浅底，保证整屏卡片高度一致（瀑布会打乱扫视节奏）。 */
function Cover({ row }: { row: CommunityWorkflowCard }) {
  return (
    <div
      style={{
        height: 150,
        borderRadius: 10,
        overflow: "hidden",
        background: "#f5f5f5",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {row.covers.length ? (
        <RawImg
          src={row.covers[0]}
          alt={row.title}
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <span className="text-12 muted">{row.mediaType === "video" ? "视频工作流" : "暂无封面"}</span>
      )}
    </div>
  );
}

function WorkflowCard({
  row,
  onOpen,
}: {
  row: CommunityWorkflowCard;
  onOpen: (code: string) => void;
}) {
  return (
    <div
      onClick={() => onOpen(row.code)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(row.code);
        }
      }}
      style={{
        border: "1px solid var(--line, #f0f0f0)",
        borderRadius: 12,
        padding: 10,
        cursor: "pointer",
        display: "grid",
        gap: 8,
        background: "#fff",
      }}
    >
      <Cover row={row} />
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <strong
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {row.title}
          </strong>
          {row.favorited ? <StarFilled style={{ color: "#faad14" }} /> : null}
        </div>
        <div
          className="text-12 muted"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            minHeight: 36,
          }}
        >
          {row.summary}
        </div>
      </div>
      <Space size={4} wrap>
        <Tag>{row.categoryLabel}</Tag>
        {row.groupLabel ? <Tag>{row.groupLabel}</Tag> : null}
        {row.source === "OFFICIAL" ? <Tag color="blue">官方</Tag> : null}
        {row.runnable ? null : <Tag color="orange">仅浏览</Tag>}
        {row.mine ? (
          <Tag color={row.status === "RECOMMENDED" || row.status === "APPROVED" ? "green" : "gold"}>
            我的·{row.statusLabel}
          </Tag>
        ) : null}
      </Space>
      <div className="text-12 muted" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{row.ownerName || "本站用户"}</span>
        <span>
          {row.runCount} 次运行 · {row.likeCount} 赞
        </span>
      </div>
    </div>
  );
}

/**
 * 社区主体：分类页签下的卡片流 + 详情抽屉 + 我的产物 / 我的发布两个台账页。
 * 「浏览」与「运行」分离是刻意的：卡片永远能点开看，只有 API 格式的才给运行按钮。
 */
export function CommunityBoard({
  view,
  categories,
  credential,
  onConnect,
}: {
  view: string;
  /** 分类页签与其计数由页头一并传下来（同一个接口两处都要用，不取两次） */
  categories: CommunityCategoryRow[];
  credential: CommunityCredentialStatus | null;
  onConnect: () => void;
}) {
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState<CommunityWorkflowCard[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortKey>("recommend");
  const [group, setGroup] = useState("");
  const [keyword, setKeyword] = useState("");
  const [runnableOnly, setRunnableOnly] = useState(false);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [drawerCode, setDrawerCode] = useState("");
  const [editing, setEditing] = useState<CommunityWorkflowDetail | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  const [runs, setRuns] = useState<CommunityRun[]>([]);
  const [runsBusy, setRunsBusy] = useState(false);

  const [drafts, setDrafts] = useState<CommunityDraft[]>([]);

  const isBrowse = view !== "runs" && view !== "drafts";

  const loadList = useCallback(async (target: string, nextPage: number) => {
    setLoading(true);
    try {
      const data = await communityApi.list({
        query: {
          page: nextPage,
          pageSize: PAGE_SIZE,
          category: target === "all" ? undefined : (target as CommunityCategory),
          group: group || undefined,
          keyword: keyword.trim() || undefined,
          sort,
          runnable: runnableOnly || undefined,
          favorite: favoriteOnly || undefined,
        },
      });
      if (!data) throw new Error("内容列表读取失败");
      setRows(data.list || []);
      setTotal(data.total || 0);
      setError("");
    } catch (caught) {
      setRows([]);
      setTotal(0);
      setError((caught as Error).message || "内容列表读取失败");
    } finally {
      setLoading(false);
    }
  }, [group, keyword, sort, runnableOnly, favoriteOnly]);

  const loadRuns = useCallback(async () => {
    try {
      const data = await communityApi.myRuns({ query: { page: 1, pageSize: 30 } });
      setRuns(data?.list || []);
    } catch {
      // 台账读失败不打断页面，下一次轮询还会再试
    }
  }, []);

  const loadDrafts = useCallback(async () => {
    try {
      const data = await communityApi.myDrafts({ query: { page: 1, pageSize: 50 } });
      setDrafts(data?.list || []);
    } catch (caught) {
      setError((caught as Error).message || "我的发布读取失败");
    }
  }, []);

  useEffect(() => {
    setPage(1);
    setError("");
    if (view !== "runs" && view !== "drafts") void loadList(view, 1);
    else if (view === "runs") void loadRuns();
    else void loadDrafts();
  }, [view, loadList, loadRuns, loadDrafts]);

  /** 我的产物页：有进行中的作业才轮询，全部落终态即停。 */
  useEffect(() => {
    if (view !== "runs") return;
    if (!runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status))) return;
    const timer = setInterval(() => void loadRuns(), POLL_MS);
    return () => clearInterval(timer);
  }, [view, runs, loadRuns]);

  const patchCard = (
    code: string,
    patch: Partial<{ favoriteCount: number; likeCount: number; favorited: boolean; liked: boolean }>,
  ) => {
    setRows((current) =>
      current.map((row) => (row.code === code ? { ...row, ...patch } : row)),
    );
  };

  const cancelRun = (run: CommunityRun) => {
    modal.confirm({
      title: "取消这次运行",
      content: "上游作业会被取消；已经在算的那部分积分由 Comfy Cloud 结算，本站不代收也不退。",
      okText: "取消运行",
      okButtonProps: { danger: true },
      onOk: async () => {
        setRunsBusy(true);
        try {
          await communityApi.cancelRun({ params: { id: String(run.id) } });
          await loadRuns();
        } catch (caught) {
          message.error((caught as Error).message || "取消失败");
        } finally {
          setRunsBusy(false);
        }
      },
    });
  };

  const groupOptions = (categories.find((item) => item.key === view)?.groups || []).map(
    (item) => ({ value: item.label, label: `${item.label}（${item.count}）` }),
  );

  const draftColumns: TableProps<CommunityDraft>["columns"] = [
    {
      title: "工作流",
      dataIndex: "title",
      render: (_value, row) => (
        <Button type="link" style={{ paddingInline: 0 }} onClick={() => setDrawerCode(row.code)}>
          {row.title}
        </Button>
      ),
    },
    { title: "分类", dataIndex: "categoryLabel", width: 110 },
    {
      title: "状态",
      dataIndex: "statusLabel",
      width: 130,
      render: (_value, row) => (
        <Tag
          color={
            row.status === "RECOMMENDED"
              ? "green"
              : row.status === "APPROVED"
                ? "blue"
                : row.status === "REJECTED" || row.status === "REMOVED"
                  ? "red"
                  : "gold"
          }
        >
          {row.statusLabel}
        </Tag>
      ),
    },
    { title: "审核备注", dataIndex: "auditNote", ellipsis: true },
    { title: "运行次数", dataIndex: "runCount", width: 90 },
    {
      title: "已得推荐奖",
      dataIndex: "rewarded",
      width: 110,
      render: (value: boolean) => (value ? "是" : "否"),
    },
    {
      title: "最近更新",
      dataIndex: "updatedAt",
      width: 170,
      render: (value: string) => timeText(value),
    },
  ];

  const connectButton = (
    <Badge dot={!credential?.connected} offset={[-4, 4]}>
      <Button
        icon={<ApiOutlined />}
        type={credential?.connected ? "default" : "primary"}
        onClick={onConnect}
      >
        {credential?.connected ? `已连接 ${credential.keyMask}` : "连接 Comfy Cloud"}
      </Button>
    </Badge>
  );

  return (
    <>
      {isBrowse ? (
        <Panel
          title="工作流市场"
          titleExtra={
            <Space size={8} wrap>
              <Input
                style={{ width: 220 }}
                allowClear
                prefix={<SearchOutlined />}
                placeholder="搜索标题、简介或标签，回车查询"
                maxLength={120}
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                onPressEnter={() => {
                  setPage(1);
                  void loadList(view, 1);
                }}
              />
              {groupOptions.length ? (
                <Select
                  style={{ width: 180 }}
                  allowClear
                  placeholder="场景分组"
                  value={group || undefined}
                  options={groupOptions}
                  onChange={(value) => setGroup(value || "")}
                />
              ) : null}
              <PillTabs
                size="small"
                variant="soft"
                items={SORTS}
                value={sort}
                onChange={(key) => setSort(key as SortKey)}
              />
              <Checkbox
                checked={runnableOnly}
                onChange={(event) => setRunnableOnly(event.target.checked)}
              >
                只看可直接运行
              </Checkbox>
              <Checkbox
                checked={favoriteOnly}
                onChange={(event) => setFavoriteOnly(event.target.checked)}
              >
                我的收藏
              </Checkbox>
            </Space>
          }
          extra={
            <Space size={8}>
              {connectButton}
              <Button
                icon={<UploadOutlined />}
                onClick={() => {
                  setEditing(null);
                  setPublishOpen(true);
                }}
              >
                发布工作流
              </Button>
            </Space>
          }
        >
          {credential && !credential.connected ? (
            <Notice variant="info">
              运行需要你自己的 Comfy Cloud API Key 与付费订阅（本站不代付算力）。
              <Button size="small" type="link" onClick={onConnect}>
                去连接
              </Button>
            </Notice>
          ) : null}
          {error ? (
            <div style={{ marginTop: 10 }}>
              <Notice variant="error">{error}</Notice>
            </div>
          ) : null}
          {loading ? (
            <div className="text-12 muted" style={{ padding: "24px 0", textAlign: "center" }}>
              正在读取社区内容…
            </div>
          ) : rows.length ? (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
                  gap: 14,
                  marginTop: 12,
                }}
              >
                {rows.map((row) => (
                  <WorkflowCard key={row.code} row={row} onOpen={setDrawerCode} />
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                <Pagination
                  current={page}
                  pageSize={PAGE_SIZE}
                  total={total}
                  showSizeChanger={false}
                  onChange={(next) => {
                    setPage(next);
                    void loadList(view, next);
                  }}
                />
              </div>
            </>
          ) : (
            <EmptyState text={favoriteOnly ? "你还没有收藏过工作流。" : "这个分类下暂时没有内容。"} />
          )}
        </Panel>
      ) : null}

      {view === "runs" ? (
        <Panel
          title="我的产物"
          extra={
            <Button onClick={() => void loadRuns()}>刷新</Button>
          }
        >
          <div className="text-12 muted" style={{ marginBottom: 10 }}>
            上游 Comfy Cloud 的产物地址只有几个小时有效，本站会在生成完成后把文件转存进自己的对象存储，
            并登记进「数字资产管理」——所以这里列出的地址长期有效。
          </div>
          <RunBlock
            runs={runs}
            busy={runsBusy}
            showWorkflow
            emptyText="还没有运行记录：去工作流市场挑一个，点「立即运行」。"
            onCancel={cancelRun}
          />
        </Panel>
      ) : null}

      {view === "drafts" ? (
        <Panel
          title="我的发布"
          extra={
            <Space size={8}>
              {connectButton}
              <Button
                icon={<UploadOutlined />}
                onClick={() => {
                  setEditing(null);
                  setPublishOpen(true);
                }}
              >
                发布工作流
              </Button>
            </Space>
          }
        >
          <div className="text-12 muted" style={{ marginBottom: 10 }}>
            提交后进入待审核；管理员通过并推荐进市场时会按后台规则给你积分奖励。
            改动工作流正文或参数槽位会重新回到待审核。
          </div>
          {error ? <Notice variant="error">{error}</Notice> : null}
          <div className="table-wrap">
            <Table<CommunityDraft>
              rowKey="code"
              size="middle"
              pagination={false}
              dataSource={drafts}
              columns={draftColumns}
              locale={{ emptyText: <EmptyState text="你还没有发布过工作流。" /> }}
            />
          </div>
        </Panel>
      ) : null}

      <WorkflowDrawer
        code={drawerCode}
        credential={credential}
        onConnect={onConnect}
        onEdit={(detail) => {
          setEditing(detail);
          setPublishOpen(true);
        }}
        onCountChange={patchCard}
        onClose={() => setDrawerCode("")}
      />
      <PublishModal
        open={publishOpen}
        editing={editing}
        onClose={() => {
          setPublishOpen(false);
          setEditing(null);
        }}
        onSaved={() => {
          if (isBrowse) void loadList(view, page);
          else void loadDrafts();
        }}
      />
    </>
  );
}
