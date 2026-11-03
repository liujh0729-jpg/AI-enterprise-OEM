"use client";

import {
  BarChartOutlined,
  BulbOutlined,
  DownloadOutlined,
  GlobalOutlined,
  KeyOutlined,
  QuestionCircleOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { App, Button, Drawer, Form, Input, Modal, Select } from "antd";
import { useEffect, useState } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { GeoKeySettingsPanel } from "@/components/geo-key-settings";
import { ColumnSwitch, EmptyState, Notice, Panel } from "@/components/ui/panel";
import { useGeoActions } from '@/query/geo-actions';
import { useGeoProjects, useGeoMeta, useGeoQuestions } from "@/query/geo";
import type { GeoProject, GeoTopicDraft } from "./geo-common";
import { GeoPressView } from "./geo-press-view";
import {
  GeoBatchesView,
  GeoQuestionsView,
  GeoReportView,
  GeoTopicView,
} from "./geo-views";

/** GEO 建站：AIworkin 侧 GEO 独立站看板，点按钮即新窗口打开。 */
const GEO_SITE_URL = "https://aiworkin.com/cn/dashboard/geo-sites";

const VIEWS = [
  { value: "report", label: <><BarChartOutlined aria-hidden /> 可见度报告</> },
  { value: "questions", label: <><QuestionCircleOutlined aria-hidden /> 监控问题库</> },
  { value: "batches", label: <><DownloadOutlined aria-hidden /> 采集批次</> },
  { value: "topics", label: <><BulbOutlined aria-hidden /> 选题池</> },
  { value: "press", label: <><SendOutlined aria-hidden /> 发稿平台推荐</> },
  { value: "site", label: <><GlobalOutlined aria-hidden /> GEO 建站</> },
];

const EMPTY_PROJECT = {
  brand: "",
  brand_aliases: "",
  industry: "",
  competitors: "",
  platforms: [] as string[],
  note: "",
};

/**
 * GEO-AI引擎优化：项目 → 问题库 → 采集批次（逐条观测）→ 报告 → 选题池，
 * 指标口径与 AIworkin GEO 技能包 geo_metrics.py 一致；另有发稿平台推荐（按语言筛）
 * 与 GEO 建站（AIworkin 外链视图）两个视图。
 * 采集平台 Key 由每个账号在这里配自己的（只服务本人项目，管理员也看不到别人的 Key）。
 */
export function GeoTab() {
  const actions=useGeoActions();
  const { message } = App.useApp();
  const { request, modal } = usePasswordConfirm();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [view, setView] = useState("report");
  const [topicDraft, setTopicDraft] = useState<GeoTopicDraft | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [editing, setEditing] = useState<GeoProject | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const projectsQuery = useGeoProjects();
  const metaQuery = useGeoMeta();
  const projects = projectsQuery.data ?? [];
  const meta = metaQuery.data ?? null;
  const questionsQuery = useGeoQuestions(projectId ?? 0);
  const questions = questionsQuery.data ?? [];
  const loading = projectsQuery.isPending;
  useEffect(() => {
    if (!projectsQuery.data) return;
    const list = projectsQuery.data;
    setProjectId(current => current && list.some(item => item.id === current) ? current : list[0]?.id ?? null);
  }, [projectsQuery.data]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      ...EMPTY_PROJECT,
      platforms: meta?.availablePlatforms || [],
    });
    setFormOpen(true);
  };

  const openEdit = () => {
    const current = projects.find((item) => item.id === projectId);
    if (!current) return;
    setEditing(current);
    form.setFieldsValue({
      brand: current.brand,
      brand_aliases: current.brandAliases,
      industry: current.industry,
      competitors: current.competitors.join(","),
      platforms: current.platforms,
      note: current.note,
    });
    setFormOpen(true);
  };

  const save = async () => {
    const values = (await form.validateFields()) as Record<string, unknown>;
    setSubmitting(true);
    try {
      if (!editing) {
        await actions.createProject.mutateAsync({body:values});

        message.success("GEO 项目已创建，下一步按配比录入监控问题");
        setFormOpen(false);
        setView("questions");
        return;
      }
      const target = editing;
      setFormOpen(false);
      request({
        title: "修改 GEO 项目（需密码）",
        content: `确认修改项目「${target.brand}」？`,
        okText: "保存修改",
        onOk: async () => {
          await actions.updateProject.mutateAsync({params:{id:String(target.id)},body:values});

          message.success("已保存修改");
          setEditing(null);
        },
      });
    } catch { /* 统一 Mutation Hook 已展示错误。 */ } finally {
      setSubmitting(false);
    }
  };

  const removeProject = () => {
    const current = projects.find((item) => item.id === projectId);
    if (!current) return;
    request({
      title: "删除 GEO 项目",
      danger: true,
      okText: "确认删除",
      content: `确认删除项目「${current.brand}」？其监控问题、采集批次、观测记录与选题池一并删除，且不可恢复。`,
      onOk: async () => {
        await actions.removeProject.mutateAsync({params:{id:String(current.id)}});

        message.success("项目已删除");
        setProjectId(null);
      },
    });
  };

  const current = projects.find((item) => item.id === projectId) || null;

  // 当前账号没配 Key 与模型的平台不出现在选项里（项目里已存的历史平台仍以已选标签展示，编辑保存不丢）
  const platformOptions = (meta?.availablePlatforms || []).map((item) => ({
    value: item,
    label: item,
  }));

  return (
    <Panel
      title="GEO-AI引擎优化"
      extra={
        <div className="geo-bar" style={{ margin: 0 }}>
          <Select
            value={projectId ?? undefined}
            placeholder="选择品牌项目"
            style={{ minWidth: 220 }}
            loading={loading}
            options={projects.map((item) => ({
              value: item.id,
              label: `${item.brand}${item.industry ? `（${item.industry}）` : ""}`,
            }))}
            onChange={(value) => setProjectId(value)}
          />
          <Button type="primary" onClick={openCreate}>
            ＋ 新建项目
          </Button>
          {current ? (
            <>
              <Button onClick={openEdit}>项目设置</Button>
              <Button danger onClick={removeProject}>
                删除项目
              </Button>
            </>
          ) : null}
          <Button
            icon={<KeyOutlined aria-hidden />}
            onClick={() => setKeysOpen(true)}
          >
            采集平台 Key
          </Button>
        </div>
      }
    >
      {projectsQuery.isError || metaQuery.isError || questionsQuery.isError ? <Notice variant="warn">{projectsQuery.error?.message ?? metaQuery.error?.message ?? questionsQuery.error?.message}</Notice> : null}
      <ColumnSwitch value={view} onChange={setView} options={VIEWS} />
      {view === "press" ? (
        <GeoPressView />
      ) : view === "site" ? (
        <div>
          <Notice variant="info">
            GEO 建站是在 AIworkin 侧完成的生成式引擎优化独立站：建站、内容发布与看板都在那边，本系统不保存建站数据。
          </Notice>
          <p className="text-12 muted" style={{ marginTop: 12 }}>
            地址：{GEO_SITE_URL}
          </p>
          <Button
            type="primary"
            icon={<GlobalOutlined aria-hidden />}
            style={{ marginTop: 10 }}
            onClick={() =>
              window.open(GEO_SITE_URL, "_blank", "noopener,noreferrer")
            }
          >
            在新窗口打开 GEO 独立站
          </Button>
        </div>
      ) : !projectId ? (
        <EmptyState
          icon={<GlobalOutlined aria-hidden />}
          text="尚未创建 GEO 项目：新建项目后录入监控问题库与采集批次，即可生成可见度报告与选题池"
        />
      ) : (
        <>
          {current ? (
            <Notice variant="info">
              品牌：<strong>{current.brand}</strong>
              {current.brandAliasList.length
                ? `（别名 ${current.brandAliasList.join(" / ")}）`
                : ""}
              {current.industry ? ` · 行业：${current.industry}` : ""}
              {current.competitors.length
                ? ` · 竞品：${current.competitors.join(" / ")}`
                : " · 未配置竞品"}
              {` · 监控平台：${current.platforms.join(" / ") || "未配置"}`}
            </Notice>
          ) : null}
          {view === "report" ? (
            <GeoReportView
              projectId={projectId}
              onNavigate={setView}
              onCreateTopic={(draft) => {
                setTopicDraft(draft);
                setView("topics");
              }}
            />
          ) : null}
          {view === "questions" ? (
            <GeoQuestionsView projectId={projectId} meta={meta} />
          ) : null}
          {view === "batches" ? (
            <GeoBatchesView projectId={projectId} meta={meta} />
          ) : null}
          {view === "topics" ? (
            <GeoTopicView
              projectId={projectId}
              meta={meta}
              questions={questions}
              draft={topicDraft}
              onDraftUsed={() => setTopicDraft(null)}
            />
          ) : null}
        </>
      )}

      <Modal
        open={formOpen}
        title={editing ? "修改 GEO 项目（需密码）" : "新建 GEO 项目"}
        width={640}
        confirmLoading={submitting}
        okText={editing ? "保存修改" : "创建项目"}
        onCancel={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onOk={() => void save()}
      >
        <Form form={form} layout="vertical" initialValues={EMPTY_PROJECT}>
          <Form.Item
            name="brand"
            label="品牌名称 *"
            rules={[{ required: true, message: "请填写品牌名称" }]}
          >
            <Input placeholder="如：星链传媒" />
          </Form.Item>
          <div className="form-2col">
            <Form.Item name="brand_aliases" label="品牌别名（逗号分隔）">
              <Input placeholder="如：星链,星链文化" />
            </Form.Item>
            <Form.Item name="industry" label="所属行业">
              <Input placeholder="如：本地生活服务" />
            </Form.Item>
          </div>
          <Form.Item
            name="competitors"
            label="竞品名称（逗号分隔，用于对比矩阵）"
          >
            <Input placeholder="如：蓝橙营销,巨量投放" />
          </Form.Item>
          <Form.Item name="platforms" label="监控平台">
            <Select
              mode="multiple"
              placeholder={
                platformOptions.length
                  ? "默认全部可用平台"
                  : "暂无可用的采集平台"
              }
              options={platformOptions}
            />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} placeholder="监控范围、数据断点说明等" />
          </Form.Item>
        </Form>
      </Modal>
      <Drawer
        open={keysOpen}
        onClose={() => setKeysOpen(false)}
        title="GEO 采集平台 Key（我的账号）"
        size="min(1180px, 96vw)"
      >
        <GeoKeySettingsPanel />
      </Drawer>
      {modal}
    </Panel>
  );
}
