"use client";

import {
  SEO_AUDIT_STATUS_LABELS,
  SEO_DEVICE_LABELS,
  SEO_FREQUENCY_LABELS,
  SEO_KEYWORD_SOURCE_LABELS,
  SEO_PROSPECT_STATUS_LABELS,
  SEO_SCHEMA_TYPE_LABELS,
  SEO_SEVERITY_LABELS,
  z,
  seoAuditSchema,
  seoBacklinkOverviewSchema,
  seoCompetitorOverviewSchema,
  seoGscAnalysisSchema,
  seoKeywordSchema,
  seoLocalGridSchema,
  seoLocalTrackerSchema,
  seoOverviewSchema,
  seoProgrammaticPageSchema,
  seoProgrammaticRunSchema,
  seoProjectSchema,
  seoRankTrackerSchema,
  seoReportSchema,
  seoLinkProspectSchema,
} from "@enterprise/contracts";
import { Notice } from "@/components/ui/panel";
import { presentMutationError } from "@/query/errors";
import { useGeoMeta, useGeoProjects, useGeoQuestions } from "@/query/geo";
import { useGeoActions } from "@/query/geo-actions";
import { useSeoActions, useSeoTrackers } from "@/query/seo";
import { App, Button, Modal, Select } from "antd";
import { useState, type ReactNode } from "react";

export type SeoProject = z.infer<typeof seoProjectSchema>;
export type SeoOverview = z.infer<typeof seoOverviewSchema>;
export type SeoAudit = z.infer<typeof seoAuditSchema>;
export type SeoKeyword = z.infer<typeof seoKeywordSchema>;
export type SeoRankTracker = z.infer<typeof seoRankTrackerSchema>;
export type SeoLocalTracker = z.infer<typeof seoLocalTrackerSchema>;
export type SeoLocalGrid = z.infer<typeof seoLocalGridSchema>;
export type SeoCompetitorOverview = z.infer<typeof seoCompetitorOverviewSchema>;
export type SeoBacklinkOverview = z.infer<typeof seoBacklinkOverviewSchema>;
export type SeoGscAnalysis = z.infer<typeof seoGscAnalysisSchema>;
export type SeoProspect = z.infer<typeof seoLinkProspectSchema>;
export type SeoProgrammaticRun = z.infer<typeof seoProgrammaticRunSchema>;
export type SeoProgrammaticPage = z.infer<typeof seoProgrammaticPageSchema>;
export type SeoReport = z.infer<typeof seoReportSchema>;

export const auditStatusLabel = (s: string) => SEO_AUDIT_STATUS_LABELS[s] ?? s;
export const severityLabel = (s: string) => SEO_SEVERITY_LABELS[s] ?? s;
export const deviceLabel = (s: string) => SEO_DEVICE_LABELS[s] ?? s;
export const frequencyLabel = (s: string) => SEO_FREQUENCY_LABELS[s] ?? s;
export const keywordSourceLabel = (s: string) => SEO_KEYWORD_SOURCE_LABELS[s] ?? s;
export const prospectStatusLabel = (s: string) => SEO_PROSPECT_STATUS_LABELS[s] ?? s;
export const schemaTypeLabel = (s: string) => SEO_SCHEMA_TYPE_LABELS[s] ?? s;

export const fmtNum = (v: number | null | undefined): string =>
  v === null || v === undefined ? "—" : v.toLocaleString("zh-CN");
export const fmtPos = (v: number | null | undefined): string =>
  v === null || v === undefined ? "未上榜" : `#${v}`;
export const fmtPct = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`;
export const fmtUsd = (v: number): string => `$${v.toFixed(4)}`;

/** 数据源未配置时的统一指引：不造假数据，明确告诉用户去配 Key 或用免费抓取。 */
export function NoSourceNotice({ children }: { children?: ReactNode }) {
  return (
    <Notice variant="warn">
      {children ??
        "未配置数据源：该项实测数据需要 DataForSEO Key（你自带、你付费，本系统不另计积分）。请在右上角「数据源设置」里配置；站点体检等自有抓取功能无需 Key 即可使用。"}
    </Notice>
  );
}

/** 付费检查的成本预估：只展示，不设阻断式审批闸（用户确认后即跑）。 */
export function CostHint({
  calls,
  estimatedUsd,
  note,
}: {
  calls: number;
  estimatedUsd: number;
  note: string;
}) {
  return (
    <Notice variant="info">
      预计调用 <strong>{calls}</strong> 次 · 约 <strong>{fmtUsd(estimatedUsd)}</strong>
      {note ? ` · ${note}` : ""}（费用由你的 DataForSEO 账户承担，本系统不另计积分）
    </Notice>
  );
}

/** AI 估计 / 规则产出标注：无 Key 或无模型时的诚实降级标签。 */
export function ModeTag({ mode }: { mode: string }) {
  const text =
    mode === "llm" || mode === "dataforseo"
      ? mode === "dataforseo"
        ? "数据源实测"
        : "AI 生成"
      : "AI 估计（规则降级）";
  return <span className="text-12 muted">· {text}</span>;
}

export const splitLines = (raw: string): string[] =>
  raw
    .split(/[\n,，;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);

export const domainOf = (raw: string): string =>
  raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();

/** 关键词 → 排名跟踪：词库、GSC 机会词共用的唯一入口（选跟踪器后批量入库，后端自动去重）。 */
export function SendToTrackerButton({
  projectId,
  keywords,
  label = "转排名跟踪",
}: {
  projectId: number;
  keywords: string[];
  label?: string;
}) {
  const { message } = App.useApp();
  const actions = useSeoActions();
  const trackersQuery = useSeoTrackers(projectId);
  const trackers = trackersQuery.data ?? [];
  const [open, setOpen] = useState(false);
  const [trackerId, setTrackerId] = useState(0);
  const [busy, setBusy] = useState(false);

  const openModal = () => {
    setTrackerId((prev) => prev || trackers[0]?.id || 0);
    setOpen(true);
  };

  const submit = async () => {
    const words = keywords.map((word) => word.trim()).filter(Boolean);
    if (!words.length) {
      message.warning("请先勾选要导入的关键词");
      return;
    }
    if (!trackerId) {
      message.warning("请选择跟踪器");
      return;
    }
    setBusy(true);
    try {
      const r = await actions.addRankKeywords.mutateAsync({ body: { trackerId, keywords: words } });
      const added = r?.added ?? words.length;
      message.success(
        `已加入跟踪器 ${added} 个关键词${added < words.length ? "（已存在的自动跳过）" : ""}`,
      );
      setOpen(false);
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button onClick={openModal} disabled={keywords.length === 0}>
        {label}
        {keywords.length ? `（${keywords.length}）` : ""}
      </Button>
      <Modal
        open={open}
        title="加入排名跟踪"
        okText="导入"
        confirmLoading={busy}
        okButtonProps={{ disabled: trackers.length === 0 }}
        onOk={() => void submit()}
        onCancel={() => setOpen(false)}
      >
        {trackers.length === 0 ? (
          <Notice variant="warn">
            还没有排名跟踪器：请先到「排名跟踪」页签新建跟踪器（域名、地区、语言、设备、频率），再回来导入关键词。
          </Notice>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <Notice variant="info">
              排名检查需要 DataForSEO Key（费用由你的数据源账户承担）；未配置 Key 时关键词只入库、不产排名。
            </Notice>
            <Select
              style={{ width: "100%" }}
              value={trackerId || undefined}
              onChange={setTrackerId}
              options={trackers.map((t) => ({
                value: t.id,
                label: `${t.domain} · ${deviceLabel(t.device)} · ${frequencyLabel(t.frequency)} · 已有 ${t.keywordCount} 词`,
              }))}
            />
            <div className="text-12 muted">
              将导入 {keywords.length} 个关键词；已存在的自动跳过（单次最多 200 个）。
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

/** 关键词 → GEO 监控问题：把词库/机会词转成 AI 问答侧的监控问题（同项目内按文本去重）。 */
export function SendToGeoQuestionButton({
  keywords,
  label = "转 GEO 监控",
}: {
  keywords: string[];
  label?: string;
}) {
  const { message } = App.useApp();
  const actions = useGeoActions();
  const projectsQuery = useGeoProjects();
  const metaQuery = useGeoMeta();
  const projects = projectsQuery.data ?? [];
  const questionTypes = (metaQuery.data?.questionTypes ?? []).map((item) => item.type);
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(0);
  const [type, setType] = useState("");
  const [busy, setBusy] = useState(false);
  const questionsQuery = useGeoQuestions(projectId);
  const existing = new Set(
    (questionsQuery.data ?? []).map((item) => item.text.trim().toLowerCase()),
  );
  const words = keywords.map((word) => word.trim()).filter(Boolean);
  const fresh = words.filter((word) => !existing.has(word.toLowerCase()));

  const openModal = () => {
    setProjectId((prev) => prev || projects[0]?.id || 0);
    setType((prev) => prev || questionTypes[0] || "品类词");
    setOpen(true);
  };

  const submit = async () => {
    if (!projectId) {
      message.warning("请选择 GEO 监控项目");
      return;
    }
    if (!fresh.length) {
      message.info("这些关键词在所选项目里都已存在，无需重复创建");
      return;
    }
    setBusy(true);
    let added = 0;
    try {
      for (const word of fresh.slice(0, 100)) {
        await actions.createQuestion.mutateAsync({
          params: { id: String(projectId) },
          body: { text: word, type: type || "品类词" },
        });
        added += 1;
      }
      message.success(`已创建 ${added} 个 GEO 监控问题`);
      setOpen(false);
    } catch (error) {
      if (added) message.warning(`已创建 ${added} 个，其余失败`);
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button onClick={openModal} disabled={keywords.length === 0}>
        {label}
        {keywords.length ? `（${keywords.length}）` : ""}
      </Button>
      <Modal
        open={open}
        title="转 GEO 监控问题"
        okText="创建"
        confirmLoading={busy}
        okButtonProps={{ disabled: projects.length === 0 || fresh.length === 0 }}
        onOk={() => void submit()}
        onCancel={() => setOpen(false)}
      >
        {projects.length === 0 ? (
          <Notice variant="warn">
            还没有 GEO 监控项目：请先到「GEO-AI 引擎优化」新建项目并填品牌信息，再回来把关键词转成监控问题。
          </Notice>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <Notice variant="info">
              问题会进入所选 GEO 项目的监控问题库，用于追踪品牌在 AI 问答中的提及与引用；同一项目内相同问题自动跳过。
            </Notice>
            <Select
              style={{ width: "100%" }}
              value={projectId || undefined}
              onChange={setProjectId}
              options={projects.map((p) => ({ value: p.id, label: `${p.brand || "未命名品牌"} · 项目 #${p.id}` }))}
            />
            <Select
              style={{ width: "100%" }}
              value={type || undefined}
              onChange={setType}
              options={questionTypes.map((value) => ({ value, label: value }))}
            />
            <div className="text-12 muted">
              共 {words.length} 个关键词，其中 {fresh.length} 个为新问题
              {questionsQuery.isPending ? "（正在核对已有问题…）" : ""}；单次最多创建 100 个。
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}