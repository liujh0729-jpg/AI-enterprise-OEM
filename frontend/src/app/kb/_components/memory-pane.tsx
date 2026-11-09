"use client";

import {
  DeleteOutlined,
  PlusOutlined,
  SaveOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import type {
  ContentAgentPersona,
  ContentDigitalAsset,
  ContentLibraryDraft,
  ContentLibraryItem,
  ContentLibrarySearch,
} from "@enterprise/contracts";
import { App, Button, Card, Checkbox, Input, Modal, Select, Skeleton, Space, Tag } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { contentApi } from "@/api/content";
import { kbApi, type KbRecallResult } from "@/api/kb";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { memoryApi, type AgentOverview } from "@/app/agent/_components/common";
import { EventPanel } from "@/app/agent/_components/event-panel";
import { OverviewPanel } from "@/app/agent/_components/overview-panel";

/** 能解析成文本收进资料库的扩展名；后端同一份清单，这里只用来提前标出来。 */
const LIBRARY_EXTS = ["md", "txt", "csv", "json", "html", "htm", "docx", "pptx", "xlsx", "pdf"];

const STATUS_LABELS: Record<string, string> = {
  ready: "可检索",
  empty: "正文为空",
  failed: "解析失败",
  missing: "原件已删除",
};

function extOf(name: string) {
  const file = String(name || "").split("?")[0].split("#")[0].split("/").pop() || "";
  return file.toLowerCase().split(".").pop() || "";
}

function fmtDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-CN");
}

/**
 * 知识库「记忆」页签（Agent 记忆与知识库记忆的合并入口）：
 * ① 长期记忆（模型 save_memory 与用户手写，注入对话；共用一套 + 每个数字分身各一套）
 * ② 资料库（从数字资产收进来的文档：按问题检索片段+出处，AI 改写待确认）
 * ③ 待确认改写（Agent 对 Markdown 的改写，接受才写入正文）
 * ④ 操作记忆（路由级中间件记录的本站写操作，只读统计 + 清单，可清空，可一键提炼成记忆页）
 * ⑤ 上下文召回（验证 Agent 组 prompt 前的知识回流片段）
 */
export function MemoryPane({ spaceId }: { spaceId: number }) {
  const { message } = App.useApp();
  const [block, setBlock] = useState("");
  const [savedBlock, setSavedBlock] = useState("");
  const [loadingMemory, setLoadingMemory] = useState(true);
  const [saving, setSaving] = useState(false);
  const [memoryError, setMemoryError] = useState("");
  const [personas, setPersonas] = useState<ContentAgentPersona[]>([]);
  /** 0＝账号共用（所有分身都注入）；>0＝只编辑该分身的私有记忆 */
  const [memoryPersonaId, setMemoryPersonaId] = useState(0);

  const [library, setLibrary] = useState<ContentLibraryItem[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [libraryError, setLibraryError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [assets, setAssets] = useState<ContentDigitalAsset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [assetsError, setAssetsError] = useState("");
  const [pickedAssets, setPickedAssets] = useState<number[]>([]);
  const [adding, setAdding] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<ContentLibrarySearch | null>(null);
  const [searchError, setSearchError] = useState("");
  const [drafts, setDrafts] = useState<ContentLibraryDraft[]>([]);
  const [decidingDraft, setDecidingDraft] = useState(0);

  const [overview, setOverview] = useState<AgentOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [overviewError, setOverviewError] = useState("");
  const [consolidating, setConsolidating] = useState(false);
  const [consolidateResult, setConsolidateResult] = useState("");
  const [recallQuery, setRecallQuery] = useState("");
  const [recalled, setRecalled] = useState<KbRecallResult | null>(null);
  const [recalling, setRecalling] = useState(false);
  const [recallError, setRecallError] = useState("");
  const { request, modal } = usePasswordConfirm();

  const loadMemory = useCallback(async (targetPersonaId: number) => {
    setLoadingMemory(true);
    try {
      const result = await contentApi.memories({
        query: { personaId: targetPersonaId },
      });
      const text = result?.block || "";
      setBlock(text);
      setSavedBlock(text);
      setMemoryError("");
    } catch (caught) {
      setMemoryError((caught as Error).message || "长期记忆加载失败");
    } finally {
      setLoadingMemory(false);
    }
  }, []);

  const loadLibrary = useCallback(async () => {
    setLoadingLibrary(true);
    try {
      const rows = await contentApi.library();
      setLibrary(rows || []);
      setLibraryError("");
    } catch (caught) {
      setLibraryError((caught as Error).message || "资料库加载失败");
    } finally {
      setLoadingLibrary(false);
    }
  }, []);

  /** 待确认改写是辅助区：取不到就不显示这一块，不挡资料清单。 */
  const loadDrafts = useCallback(async () => {
    try {
      setDrafts((await contentApi.libraryDrafts()) || []);
    } catch {
      setDrafts([]);
    }
  }, []);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    const result = await memoryApi.overview();
    setOverview(result.data);
    setOverviewError(result.message);
    setLoadingOverview(false);
  }, []);

  useEffect(() => {
    void loadMemory(memoryPersonaId);
  }, [loadMemory, memoryPersonaId]);

  useEffect(() => {
    void contentApi
      .personas()
      .then((rows) => setPersonas(rows || []))
      .catch(() => setPersonas([]));
  }, []);

  useEffect(() => {
    void loadLibrary();
    void loadDrafts();
    void loadOverview();
  }, [loadLibrary, loadDrafts, loadOverview]);

  const saveMemory = async () => {
    setSaving(true);
    try {
      const result = await contentApi.saveMemories({
        body: { content: block, personaId: memoryPersonaId },
      });
      const text = result?.block || "";
      setBlock(text);
      setSavedBlock(text);
      message.success(
        memoryPersonaId ? "分身私有记忆已保存" : "共用记忆已保存",
      );
    } catch (caught) {
      message.error((caught as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const clearOperations = async () => {
    const result = await memoryApi.clear();
    await loadOverview();
    message.success(`已清空 ${result.events} 条操作记忆`);
  };

  const consolidate = async () => {
    setConsolidating(true);
    try {
      const data = await kbApi.consolidate({ body: { spaceId, limit: 200 } });
      setConsolidateResult(
        data
          ? `扫描事件 ${data.eventsScanned} · 更新实体 ${data.entitiesUpdated} · 写入记忆页 ${data.pagesWritten.length}（冲突项自动进待审）`
          : "提炼接口未返回数据",
      );
      message.success("提炼完成，记忆页默认走人在环复核");
    } catch (caught) {
      message.error((caught as Error).message || "记忆提炼失败");
    } finally {
      setConsolidating(false);
    }
  };

  const recall = async () => {
    const q = recallQuery.trim();
    if (!q) return;
    setRecalling(true);
    try {
      setRecalled(await kbApi.recall({ body: { query: q, topK: 3, maxChars: 1200 } }));
      setRecallError("");
    } catch (caught) {
      setRecalled(null);
      setRecallError((caught as Error).message || "召回失败");
    } finally {
      setRecalling(false);
    }
  };

  /** 打开选择弹窗时拉一次数字资产（文档都在 file 类型里）。 */
  const openPicker = async () => {
    setPickerOpen(true);
    setPickedAssets([]);
    setSkipped([]);
    setLoadingAssets(true);
    try {
      const result = await contentApi.digitalAssets({
        query: { page: 1, pageSize: 100, type: "file" },
      });
      setAssets(result?.list || []);
      setAssetsError("");
    } catch (caught) {
      setAssets([]);
      setAssetsError((caught as Error).message || "数字资产清单读取失败");
    } finally {
      setLoadingAssets(false);
    }
  };

  const addFromAssets = async () => {
    if (!pickedAssets.length) return;
    setAdding(true);
    try {
      const result = await contentApi.libraryAdd({ body: { assetIds: pickedAssets } });
      setLibrary(result?.items || []);
      const skippedRows = result?.skipped || [];
      setSkipped(skippedRows);
      if (skippedRows.length) {
        message.warning(`有 ${skippedRows.length} 份没能收进资料库`);
      } else {
        setPickerOpen(false);
        message.success("已收进资料库");
      }
      await loadDrafts();
    } catch (caught) {
      message.error((caught as Error).message || "收进资料库失败");
    } finally {
      setAdding(false);
    }
  };

  const removeItem = (item: ContentLibraryItem) => {
    request({
      title: "移出资料库",
      content: `会把《${item.name}》从资料库移除，数字资产里的原件不受影响。`,
      okText: "移除",
      danger: true,
      onOk: async () => {
        await contentApi.libraryRemove({ params: { id: String(item.id) } });
        await loadLibrary();
        if (searchResult) setSearchResult(null);
        message.success("已移出资料库");
      },
    });
  };

  const runSearch = async () => {
    const text = question.trim();
    if (!text) {
      message.warning("先把问题写完整，例如：我们今年的营销预算是多少？");
      return;
    }
    setSearching(true);
    setSearchError("");
    try {
      const result = await contentApi.librarySearch({ body: { question: text } });
      setSearchResult(result);
    } catch (caught) {
      setSearchResult(null);
      setSearchError((caught as Error).message || "检索失败");
    } finally {
      setSearching(false);
    }
  };

  const decideDraft = async (draft: ContentLibraryDraft, accept: boolean) => {
    setDecidingDraft(draft.id);
    try {
      await contentApi.libraryDraftDecide({
        params: { id: String(draft.id) },
        body: { accept },
      });
      await Promise.all([loadDrafts(), loadLibrary()]);
      message.success(accept ? "已写入正文" : "已放弃这条改写");
    } catch (caught) {
      message.error((caught as Error).message || "处理失败");
    } finally {
      setDecidingDraft(0);
    }
  };

  const inLibraryIds = new Set(
    library.filter((item) => item.aipddAssetId > 0).map((item) => item.aipddAssetId),
  );
  const readyCount = library.filter((item) => item.status === "ready").length;

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Panel
        title="长期记忆"
        titleExtra={
          <span className="text-12 muted">
            Agent 与你在下面写的内容会注入对话；一行一条，保存后立即生效
          </span>
        }
        extra={
          <Button
            type="primary"
            icon={<SaveOutlined aria-hidden />}
            disabled={block === savedBlock}
            loading={saving}
            onClick={() => void saveMemory()}
          >
            保存
          </Button>
        }
      >
        {memoryError ? <Notice variant="error">{memoryError}</Notice> : null}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 8,
          }}
        >
          <Select
            style={{ width: 220 }}
            value={memoryPersonaId}
            options={[
              { value: 0, label: "共用记忆（所有分身）" },
              ...personas.map((item) => ({
                value: item.id,
                label: `只属于：${item.name}`,
              })),
            ]}
            onChange={(value: number) => setMemoryPersonaId(value)}
          />
          <span className="text-12 muted">
            {memoryPersonaId
              ? "这段只注入这位分身的对话；共用记忆仍会一起注入。"
              : "所有分身与未指定分身的对话都会注入这段记忆。"}
          </span>
        </div>
        {loadingMemory ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : (
          <Input.TextArea
            value={block}
            autoSize={{ minRows: 6, maxRows: 16 }}
            placeholder={"一行一条，例如：\n- 我的品牌叫小野，主色是墨绿\n- 视频统一 9:16、15 秒"}
            onChange={(event) => setBlock(event.target.value)}
          />
        )}
      </Panel>

      <Panel
        title="资料库"
        titleExtra={
          <span className="text-12 muted">
            从数字资产挑文档收进来；Agent 按问题检索片段与出处，需要细节再精读全文
          </span>
        }
        extra={
          <Button type="primary" icon={<PlusOutlined aria-hidden />} onClick={() => void openPicker()}>
            从数字资产添加
          </Button>
        }
      >
        {libraryError ? <Notice variant="error">{libraryError}</Notice> : null}
        {loadingLibrary ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : !library.length ? (
          <Notice variant="info">
            {"还没有资料。点右上角「从数字资产添加」，把 Markdown、Word、PDF 等文档收进来；原件在"}
            <Link href="/assets">数字资产管理</Link>
            {"里删除后，这篇也会跟着退出检索。"}
          </Notice>
        ) : (
          <div style={{ display: "grid", gap: 0 }}>
            {library.map((item) => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "9px 0",
                  borderBottom: "1px solid var(--line, #f0f0f0)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.name}
                    </span>
                    <Tag style={{ marginInlineEnd: 0 }}>{item.type}</Tag>
                    {item.status === "ready" ? null : (
                      <Tag color="orange" style={{ marginInlineEnd: 0 }}>
                        {STATUS_LABELS[item.status] || "不可用"}
                      </Tag>
                    )}
                  </div>
                  <div className="text-12 muted" style={{ marginTop: 2 }}>
                    {item.status === "ready"
                      ? `${item.nodeCount} 个片段 · ${item.charCount.toLocaleString("zh-CN")} 字 · 收录于 ${fmtDate(item.createdAt)}`
                      : item.note || "这篇暂时不参与检索"}
                  </div>
                </div>
                <Button
                  type="link"
                  danger
                  icon={<DeleteOutlined aria-hidden />}
                  onClick={() => removeItem(item)}
                >
                  移出
                </Button>
              </div>
            ))}
            <div className="text-12 muted" style={{ marginTop: 8 }}>
              {`共 ${library.length} 篇，其中 ${readyCount} 篇可检索；正文不进对话上下文，只在命中时取片段。`}
            </div>
          </div>
        )}

        <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
          <Input.TextArea
            value={question}
            autoSize={{ minRows: 2, maxRows: 4 }}
            placeholder="检索测试：把问题写成一句完整的话，例如「我们今年的营销预算怎么分配到各个渠道？」"
            onChange={(event) => setQuestion(event.target.value)}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="text-12 muted">按问题做语义匹配，返回候选片段与出处；不是关键词搜索。</span>
            <Button
              icon={<SearchOutlined aria-hidden />}
              loading={searching}
              disabled={!readyCount}
              onClick={() => void runSearch()}
            >
              检索
            </Button>
          </div>
          {searchError ? <Notice variant="error">{searchError}</Notice> : null}
          {searchResult ? (
            <div style={{ display: "grid", gap: 8 }}>
              {searchResult.note ? <Notice variant="info">{searchResult.note}</Notice> : null}
              {searchResult.scope.length ? (
                <span className="text-12 muted">{`覆盖资料：${searchResult.scope.join("、")}`}</span>
              ) : null}
              {searchResult.hits.length ? (
                <div style={{ display: "grid", gap: 8 }}>
                  {searchResult.hits.map((hit) => (
                    <div
                      key={`${hit.nodeId}-${hit.score}`}
                      style={{
                        border: "1px solid var(--line, #f0f0f0)",
                        borderRadius: 8,
                        padding: "8px 10px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <strong style={{ fontSize: 13 }}>{`《${hit.itemName}》`}</strong>
                        <span className="text-12 muted">{hit.path || hit.kind}</span>
                        <span className="text-12 muted" style={{ marginLeft: "auto" }}>
                          {`相关度 ${hit.score}`}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, marginTop: 4, whiteSpace: "pre-wrap" }}>
                        {hit.snippet}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Panel>

      {drafts.length ? (
        <Panel
          title="待确认改写"
          titleBadge={`${drafts.length} 条`}
          titleExtra={
            <span className="text-12 muted">
              Agent 对 Markdown 的改写都先放这里；点「接受」才写入正文，不会静默覆盖
            </span>
          }
        >
          <div style={{ display: "grid", gap: 12 }}>
            {drafts.map((draft) => (
              <div
                key={draft.id}
                style={{
                  border: "1px solid var(--line, #f0f0f0)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 13 }}>{`《${draft.itemName}》`}</strong>
                  <span className="text-12 muted">{draft.nodePath || "整篇"}</span>
                  <span className="text-12 muted" style={{ marginLeft: "auto" }}>
                    {fmtDate(draft.createdAt)}
                  </span>
                </div>
                {draft.reason ? (
                  <span className="text-12 muted">{`改写理由：${draft.reason}`}</span>
                ) : null}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                  }}
                >
                  <div>
                    <div className="text-12 muted" style={{ marginBottom: 4 }}>
                      修改前
                    </div>
                    <div style={{ maxHeight: 180, overflowY: "auto", whiteSpace: "pre-wrap", fontSize: 13 }}>
                      {draft.before}
                    </div>
                  </div>
                  <div>
                    <div className="text-12 muted" style={{ marginBottom: 4 }}>
                      修改后
                    </div>
                    <div style={{ maxHeight: 180, overflowY: "auto", whiteSpace: "pre-wrap", fontSize: 13 }}>
                      {draft.after}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <Button
                    disabled={decidingDraft === draft.id}
                    onClick={() => void decideDraft(draft, false)}
                  >
                    放弃
                  </Button>
                  <Button
                    type="primary"
                    loading={decidingDraft === draft.id}
                    onClick={() => void decideDraft(draft, true)}
                  >
                    接受并写入
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel
        title="操作记忆"
        titleExtra={
          <span className="text-12 muted">
            你在这个系统里做过的写操作（与长期记忆分开，只读，可清空）；一键提炼成知识库记忆页，同对象先建后删视为矛盾，自动进待审
          </span>
        }
        extra={
          <Space>
            <Button
              type="primary"
              icon={<ThunderboltOutlined aria-hidden />}
              loading={consolidating}
              onClick={() => void consolidate()}
            >
              立即提炼
            </Button>
            <Button
              danger
              icon={<DeleteOutlined aria-hidden />}
              disabled={loadingOverview || !overview?.total}
              onClick={() =>
                request({
                  title: "清空我的操作记忆",
                  content: "会删除当前账号在本系统积累的全部操作记忆，长期记忆不受影响。",
                  okText: "清空",
                  danger: true,
                  onOk: clearOperations,
                })
              }
            >
              清空操作记忆
            </Button>
          </Space>
        }
      >
        {consolidateResult ? <Notice variant="success">{consolidateResult}</Notice> : null}
        {overviewError ? (
          <Notice variant="error">{`操作记忆加载失败：${overviewError}`}</Notice>
        ) : null}
        {loadingOverview ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : !overview?.total ? (
          <Notice variant="info">
            还没有属于这个账号的操作记忆。在多维表格加一行、建一个 RPA
            任务、发布一条需求，这里就会出现第一条。
          </Notice>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            <OverviewPanel stats={overview} />
            <EventPanel stats={overview} />
          </div>
        )}
      </Panel>

      <Panel
        title="上下文召回"
        titleExtra="验证 Agent 组 prompt 前的知识回流片段（走会话绑定的当前空间）。"
      >
        {recallError ? <Notice variant="error">{recallError}</Notice> : null}
        <Space.Compact style={{ width: "100%", maxWidth: 640 }}>
          <Input
            placeholder="模拟智能体的当前问题"
            value={recallQuery}
            onChange={(e) => setRecallQuery(e.target.value)}
            onPressEnter={() => void recall()}
          />
          <Button loading={recalling} onClick={() => void recall()}>
            召回
          </Button>
        </Space.Compact>
        {recalled && recalled.snippets.length ? (
          <div style={{ marginTop: 12 }}>
            {recalled.snippets.map((s) => (
              <Card key={s.pageId} size="small" title={`${s.title}（${s.slug}）`} style={{ marginBottom: 8 }}>
                <div style={{ whiteSpace: "pre-wrap" }}>{s.text}</div>
              </Card>
            ))}
            <div>共回流 {recalled.total} 字（预算内裁剪）</div>
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <EmptyState text="暂无回流片段：先提炼或发布一些页面" />
          </div>
        )}
      </Panel>

      <Modal
        open={pickerOpen}
        title="从数字资产收进资料库"
        okText="收进资料库"
        onOk={() => void addFromAssets()}
        confirmLoading={adding}
        okButtonProps={{ disabled: !pickedAssets.length }}
        onCancel={() => setPickerOpen(false)}
        width={640}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <span className="text-12 muted">
            只收文字文档（md / txt / csv / json / html / docx / pptx / xlsx / pdf，单个不超过 20MB）。
            收进来以后正文会切成片段，原件删掉这篇就退出检索。
          </span>
          {assetsError ? <Notice variant="error">{assetsError}</Notice> : null}
          {skipped.length ? (
            <Notice variant="warn">{`以下没能收进：${skipped.join("；")}`}</Notice>
          ) : null}
          {loadingAssets ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : !assets.length ? (
            <Notice variant="info">
              {"数字资产里还没有文档。先到"}
              <Link href="/assets">数字资产管理</Link>
              {"上传一份。"}
            </Notice>
          ) : (
            <div style={{ display: "grid", gap: 6, maxHeight: 340, overflowY: "auto" }}>
              {assets.map((asset) => {
                const ext = extOf(asset.name || asset.url);
                const supported = LIBRARY_EXTS.includes(ext);
                const added = inLibraryIds.has(asset.id);
                return (
                  <Checkbox
                    key={asset.id}
                    checked={pickedAssets.includes(asset.id)}
                    disabled={!supported || added}
                    onChange={(event) =>
                      setPickedAssets((prev) =>
                        event.target.checked
                          ? [...prev, asset.id]
                          : prev.filter((id) => id !== asset.id),
                      )
                    }
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        maxWidth: 520,
                      }}
                    >
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {asset.name || "未命名文档"}
                      </span>
                      <span className="text-12 muted">
                        {`${ext || "未知格式"} · ${asset.fileSize.toFixed(1)} MB`}
                      </span>
                      {added ? <Tag style={{ marginInlineEnd: 0 }}>已在资料库</Tag> : null}
                      {!added && !supported ? (
                        <Tag color="orange" style={{ marginInlineEnd: 0 }}>
                          不支持解析
                        </Tag>
                      ) : null}
                    </span>
                  </Checkbox>
                );
              })}
            </div>
          )}
        </div>
      </Modal>

      {modal}
    </Space>
  );
}
