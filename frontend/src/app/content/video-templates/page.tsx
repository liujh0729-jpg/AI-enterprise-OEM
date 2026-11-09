"use client";

import {
  PlayCircleFilled,
  SearchOutlined,
  UploadOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { App, Button, Checkbox, Input, Pagination, Space, Tag } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  VIDEO_TEMPLATE_SORTS,
  VIDEO_TEMPLATE_SORT_LABELS,
  VIDEO_TEMPLATE_TYPES,
  VIDEO_TEMPLATE_TYPE_LABELS,
  type ContentJob,
  type VideoTemplateCard,
  type VideoTemplateDetail,
  type VideoTemplateSort,
  type VideoTemplateType,
} from "@enterprise/contracts";
import { contentApi } from "@/api/content";
import { EmptyState, Notice, PageHero, Panel, PillTabs } from "@/components/ui/panel";
import { RawImg } from "@/components/ui/raw-img";
import { GenerateTemplateModal } from "./_components/generate-modal";
import { PublishTemplateModal } from "./_components/publish-modal";
import { TemplateDrawer } from "./_components/template-drawer";

const PAGE_SIZE = 20;
const JOB_PAGE_SIZE = 12;
const JOB_POLL_MS = 4000;

const JOB_STATUS_LABEL: Record<string, string> = {
  PENDING: "排队中",
  RUNNING: "生成中",
  SUCCESS: "已完成",
  FAILED: "失败",
  CANCELED: "已取消",
};
const JOB_STATUS_COLOR: Record<string, string> = {
  PENDING: "default",
  RUNNING: "processing",
  SUCCESS: "success",
  FAILED: "error",
  CANCELED: "warning",
};
const JOB_TERMINAL = new Set(["SUCCESS", "FAILED", "CANCELED"]);

type BoardKey = "market" | "jobs";
type SortKey = VideoTemplateSort;
type TypeKey = "all" | VideoTemplateType;

function coverOf(row: VideoTemplateCard) {
  return row.coverUrl;
}

function jobInput(job: ContentJob) {
  return (job.input || {}) as Record<string, unknown>;
}

function jobPrompt(job: ContentJob) {
  return String(jobInput(job).prompt || "");
}

function jobReferences(job: ContentJob) {
  const value = jobInput(job).references;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function jobResultUrl(job: ContentJob) {
  const output = (job.output || {}) as Record<string, unknown>;
  return String(output.url || job.assetUrl || "");
}

function timeText(value: string) {
  return value ? value.replace("T", " ").slice(0, 16) : "—";
}

function TemplateCardView({
  row,
  onOpen,
}: {
  row: VideoTemplateCard;
  onOpen: (id: number) => void;
}) {
  const cover = coverOf(row);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(row.id);
        }
      }}
      style={{
        border: "1px solid var(--line, #f0f0f0)",
        borderRadius: 14,
        overflow: "hidden",
        background: "#fff",
        cursor: "pointer",
        display: "grid",
        gridTemplateRows: "auto 1fr",
      }}
    >
      <div style={{ position: "relative", aspectRatio: "3 / 4", background: "#f5f5f5" }}>
        {cover ? (
          <RawImg
            src={cover}
            alt={row.title}
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            className="text-12 muted"
          >
            暂无封面
          </div>
        )}
        <PlayCircleFilled
          style={{
            position: "absolute",
            right: 10,
            bottom: 10,
            fontSize: 26,
            color: "rgba(255,255,255,0.92)",
            filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.4))",
          }}
        />
        {row.source === "AIWORKIN" ? (
          <Tag color="purple" style={{ position: "absolute", top: 8, left: 8 }}>
            AIWORKIN
          </Tag>
        ) : null}
        {row.viewCost > 0 ? (
          <Tag color="gold" style={{ position: "absolute", top: 8, right: 8 }}>
            {row.viewCost} 积分
          </Tag>
        ) : null}
      </div>
      <div style={{ padding: 10, display: "grid", gap: 6 }}>
        <strong
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={row.title}
        >
          {row.title}
        </strong>
        <div className="text-12 muted" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {row.ownerName}
          </span>
          <span style={{ flexShrink: 0 }}>{row.ratingAvg || 0} 分</span>
        </div>
        <div className="text-12 muted" style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{row.useCount} 次使用</span>
          <span>{row.favoriteCount} 收藏</span>
        </div>
        <Space size={4} wrap>
          <Tag>{row.videoTypeLabel}</Tag>
          {row.viewCost > 0 ? <Tag color="gold">付费配方</Tag> : null}
          {row.mine ? <Tag color="green">我发布的</Tag> : null}
        </Space>
      </div>
    </div>
  );
}

/**
 * 视频模版社区：样片先看、配方后解锁、用你自己的模型复刻。
 * 列表排序口径「使用最多 / 最新 / 收藏最多」与契约一致，关键词只搜标题与简介。
 */
export default function VideoTemplatesPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const [rows, setRows] = useState<VideoTemplateCard[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [appliedKeyword, setAppliedKeyword] = useState("");
  const [type, setType] = useState<TypeKey>("all");
  const [sort, setSort] = useState<SortKey>("latest");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [drawerId, setDrawerId] = useState(0);
  const [publishOpen, setPublishOpen] = useState(false);
  const [generator, setGenerator] = useState<VideoTemplateDetail | null>(null);
  const [board, setBoard] = useState<BoardKey>("market");
  const [jobs, setJobs] = useState<ContentJob[]>([]);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [jobsPage, setJobsPage] = useState(1);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState("");

  const typeTabs = useMemo(
    () => [
      { key: "all" as const, label: "全部" },
      ...VIDEO_TEMPLATE_TYPES.map((key) => ({
        key,
        label: VIDEO_TEMPLATE_TYPE_LABELS[key],
      })),
    ],
    [],
  );
  const sortTabs = useMemo(
    () =>
      VIDEO_TEMPLATE_SORTS.map((key) => ({
        key,
        label: VIDEO_TEMPLATE_SORT_LABELS[key],
      })),
    [],
  );

  const load = useCallback(
    async (targetPage: number) => {
      setLoading(true);
      try {
        const data = await contentApi.videoTemplates({
          query: {
            page: targetPage,
            pageSize: PAGE_SIZE,
            keyword: appliedKeyword || undefined,
            type: type === "all" ? undefined : type,
            sort,
            favorite: favoriteOnly || undefined,
            mine: mineOnly || undefined,
          },
        });
        setRows(data?.list || []);
        setTotal(data?.total || 0);
        setError("");
      } catch (caught) {
        setRows([]);
        setTotal(0);
        setError((caught as Error).message || "模版列表读取失败");
      } finally {
        setLoading(false);
      }
    },
    [appliedKeyword, type, sort, favoriteOnly, mineOnly],
  );

  useEffect(() => {
    setPage(1);
    void load(1);
  }, [load]);

  // 模版复刻任务统一挂在 video-ref 这个隐藏工具下，按 tool 过滤即可只看生成任务。
  const loadJobs = useCallback(async (targetPage: number) => {
    setJobsLoading(true);
    try {
      const data = await contentApi.jobs({
        query: { page: targetPage, pageSize: JOB_PAGE_SIZE, tool: "video-ref" },
      });
      setJobs(data?.list || []);
      setJobsTotal(data?.total || 0);
      setJobsError("");
    } catch (caught) {
      setJobs([]);
      setJobsTotal(0);
      setJobsError((caught as Error).message || "生成任务读取失败");
    } finally {
      setJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (board !== "jobs") return;
    void loadJobs(jobsPage);
  }, [board, jobsPage, loadJobs]);

  // 有未完成任务时定时重读列表；全部落到终态就自动停，不需要手动刷新。
  useEffect(() => {
    if (board !== "jobs") return;
    if (!jobs.some((item) => !JOB_TERMINAL.has(item.status))) return;
    const timer = window.setTimeout(() => {
      void loadJobs(jobsPage);
    }, JOB_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [board, jobs, jobsPage, loadJobs]);

  const cancelJob = async (id: number) => {
    try {
      await contentApi.cancelJob({ params: { id: String(id) } });
      await loadJobs(jobsPage);
    } catch (caught) {
      message.error((caught as Error).message || "取消失败");
    }
  };

  const patchCard = (
    id: number,
    patch: Partial<{
      favoriteCount: number;
      favorited: boolean;
      ratingAvg: number;
      ratingCount: number;
      myRating: number;
      useCount: number;
      viewCount: number;
    }>,
  ) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  return (
    <div>
      <PageHero
        title="视频模版"
        desc="挑一条样片，带着发布者的提示词与参考图，用你自己配置的视频模型复刻；也可以发布自己的模版赚查看积分。付费模版先看样片，支付后解锁配方，同一账号只扣一次。生成是异步任务，提交后到「生成任务」里看进度与成片。"
        tabs={[
          {
            key: "market",
            label: (
              <>
                <PlayCircleFilled aria-hidden /> 模版市场
              </>
            ),
          },
          {
            key: "jobs",
            label: (
              <>
                <VideoCameraOutlined aria-hidden /> 生成任务
              </>
            ),
            count: jobsTotal || undefined,
          },
        ]}
        activeTab={board}
        onTabChange={(key) => {
          setBoard(key as BoardKey);
          if (key === "jobs") setJobsPage(1);
        }}
      />

      {board === "market" ? (
      <Panel
        title="模版市场"
        extra={
          <Space size={8}>
            <Button
              icon={<VideoCameraOutlined aria-hidden />}
              onClick={() => router.push("/agent")}
            >
              视频生成
            </Button>
            <Button type="primary" icon={<UploadOutlined aria-hidden />} onClick={() => setPublishOpen(true)}>
              发布模版
            </Button>
          </Space>
        }
        titleExtra={
          <Space size={8} wrap>
            <Input
              style={{ width: 240 }}
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索标题或简介，回车查询"
              maxLength={120}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onPressEnter={() => setAppliedKeyword(keyword.trim())}
            />
            <PillTabs
              size="small"
              variant="soft"
              items={sortTabs}
              value={sort}
              onChange={(key) => setSort(key as SortKey)}
            />
            <Checkbox
              checked={favoriteOnly}
              onChange={(event) => setFavoriteOnly(event.target.checked)}
            >
              我的收藏
            </Checkbox>
            <Checkbox
              checked={mineOnly}
              onChange={(event) => setMineOnly(event.target.checked)}
            >
              我的发布
            </Checkbox>
          </Space>
        }
      >
        <PillTabs
          size="small"
          items={typeTabs}
          value={type}
          onChange={(key) => setType(key as TypeKey)}
        />
        {error ? (
          <div style={{ marginTop: 10 }}>
            <Notice variant="error">{error}</Notice>
          </div>
        ) : null}
        {loading ? (
          <div className="text-12 muted" style={{ padding: "24px 0", textAlign: "center" }}>
            正在读取模版…
          </div>
        ) : rows.length ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 14,
                marginTop: 14,
              }}
            >
              {rows.map((row) => (
                <TemplateCardView key={row.id} row={row} onOpen={setDrawerId} />
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
                  void load(next);
                }}
              />
            </div>
          </>
        ) : (
          <EmptyState
            text={
              favoriteOnly
                ? "你还没有收藏过模版。"
                : mineOnly
                  ? "你还没有发布过模版。"
                  : appliedKeyword
                    ? "没有找到匹配的模版。"
                    : "这个分类下暂时没有模版。"
            }
          />
        )}
      </Panel>
      ) : (
        <Panel
          title="生成任务"
          titleExtra={<span className="text-12 muted">异步生成，完成后自动出现在这里</span>}
        >
          <Notice variant="info">
            在「模版市场」点「使用模版生成」提交后，任务会在这里排队与生成；完成后可直接预览、打开原文件，产物同时登记进数字资产。未完成的任务会自动刷新。
          </Notice>
          {jobsError ? (
            <div style={{ marginTop: 10 }}>
              <Notice variant="error">{jobsError}</Notice>
            </div>
          ) : null}
          {jobsLoading && !jobs.length ? (
            <div className="text-12 muted" style={{ padding: "24px 0", textAlign: "center" }}>
              正在读取生成任务…
            </div>
          ) : jobs.length ? (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 14,
                  marginTop: 14,
                }}
              >
                {jobs.map((job) => {
                  const url = jobResultUrl(job);
                  return (
                    <div
                      key={job.id}
                      style={{
                        border: "1px solid var(--line, #f0f0f0)",
                        borderRadius: 12,
                        overflow: "hidden",
                        background: "#fff",
                        display: "grid",
                        gridTemplateRows: "auto 1fr",
                      }}
                    >
                      <div
                        style={{
                          position: "relative",
                          aspectRatio: "16 / 9",
                          background: "#000",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {job.status === "SUCCESS" && url ? (
                          <video
                            src={url}
                            controls
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "contain",
                              background: "#000",
                            }}
                          />
                        ) : (
                          <span className="text-12" style={{ color: "rgba(255,255,255,0.72)" }}>
                            {job.status === "FAILED"
                              ? "生成失败"
                              : job.status === "CANCELED"
                                ? "已取消"
                                : job.status === "PENDING"
                                  ? "排队中…"
                                  : "正在生成…"}
                          </span>
                        )}
                      </div>
                      <div style={{ padding: 10, display: "grid", gap: 8, alignContent: "start" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <Tag color={JOB_STATUS_COLOR[job.status] || "default"}>
                            {JOB_STATUS_LABEL[job.status] || job.status}
                          </Tag>
                          <span className="text-12 muted">
                            任务 #{job.id} · {timeText(job.createdAt)}
                          </span>
                          {job.aipddAssetId ? (
                            <Link href="/assets">
                              <Tag color="success" style={{ cursor: "pointer" }}>
                                已存入数字资产
                              </Tag>
                            </Link>
                          ) : null}
                        </div>
                        <div
                          className="text-12"
                          style={{
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            lineHeight: 1.6,
                            minHeight: 38,
                          }}
                          title={jobPrompt(job)}
                        >
                          {jobPrompt(job) || "（没有提示词）"}
                        </div>
                        {jobReferences(job).length ? (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {jobReferences(job)
                              .slice(0, 6)
                              .map((ref) => (
                                <RawImg
                                  key={ref}
                                  src={ref}
                                  alt="参考图"
                                  style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6 }}
                                />
                              ))}
                          </div>
                        ) : null}
                        {job.status === "FAILED" ? (
                          <span className="text-12" style={{ color: "#ff4d4f" }}>
                            {job.error || "生成失败"}
                          </span>
                        ) : null}
                        <Space size={8} wrap>
                          {job.status === "PENDING" ? (
                            <Button size="small" onClick={() => void cancelJob(job.id)}>
                              取消排队
                            </Button>
                          ) : null}
                          {job.status === "SUCCESS" && url ? (
                            <a href={url} target="_blank" rel="noreferrer" className="text-12">
                              打开原文件
                            </a>
                          ) : null}
                        </Space>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                <Pagination
                  current={jobsPage}
                  pageSize={JOB_PAGE_SIZE}
                  total={jobsTotal}
                  showSizeChanger={false}
                  onChange={setJobsPage}
                />
              </div>
            </>
          ) : (
            <EmptyState text="还没有生成任务。去「模版市场」挑一条样片，点「使用模版生成」复刻。" />
          )}
        </Panel>
      )}

      <TemplateDrawer
        id={drawerId}
        open={drawerId > 0}
        onClose={() => setDrawerId(0)}
        onChanged={patchCard}
        onUse={(detail) => {
          setDrawerId(0);
          setGenerator(detail);
        }}
      />
      <GenerateTemplateModal
        open={Boolean(generator)}
        template={generator}
        onClose={() => setGenerator(null)}
        onGenerated={() => {
          if (generator) patchCard(generator.id, {});
          setGenerator(null);
          setJobsPage(1);
          setBoard("jobs");
        }}
      />
      <PublishTemplateModal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        onSaved={() => {
          void load(1);
          setPage(1);
        }}
      />
    </div>
  );
}
