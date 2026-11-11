"use client";

import { ArrowLeftOutlined, SettingOutlined } from "@ant-design/icons";
import { Button, Spin, Tag } from "antd";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LowCodeEntityView, LowCodePageView } from "@enterprise/contracts";
import { LOWCODE_PAGE_TYPE_LABELS } from "@enterprise/contracts";
import { lowcodeApi } from "@/api/lowcode";
import { EmptyState, Notice, PageHero } from "@/components/ui/panel";
import { errText } from "./_components/row-form";
import {
  ApprovalInboxView,
  DashboardView,
  EntityDetailView,
  EntityFormView,
  EntityKanbanView,
  EntityListView,
} from "./_components/views";
import { CanvasView } from "./_components/canvas";
import { SettingsDrawer } from "./_components/settings";

type Detail = Awaited<ReturnType<typeof lowcodeApi.projectDetail>>;

export default function LowCodeProjectPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = Number(params?.id);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeId, setActiveId] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("project");
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  /** 空态直达设置页签：页面缺失去「页面」，实体缺失去「实体」。 */
  const openSettings = useCallback((tab: string) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  useEffect(() => {
    if (!Number.isInteger(projectId) || projectId <= 0) {
      setError("应用编号无效");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    void lowcodeApi
      .projectDetail({ params: { id: String(projectId) } })
      .then((data) => setDetail(data))
      .catch((err: unknown) => {
        setDetail(null);
        setError(errText(err));
      })
      .finally(() => setLoading(false));
  }, [projectId, reloadKey]);

  const pages = useMemo(
    () => (detail?.pages || []).filter((page) => page.visible !== false),
    [detail],
  );

  useEffect(() => {
    if (!pages.length) {
      setActiveId("");
      return;
    }
    if (!pages.some((page) => String(page.id) === activeId)) {
      setActiveId(String(pages[0].id));
    }
  }, [pages, activeId]);

  const entities = useMemo(() => detail?.entities || [], [detail]);
  const active = pages.find((page) => String(page.id) === activeId);
  const entityOf = useCallback(
    (entityId: number): LowCodeEntityView | undefined =>
      entities.find((entity) => entity.id === entityId),
    [entities],
  );

  const heroTabs = pages.map((page) => ({
    key: String(page.id),
    label:
      page.type === "APPROVAL_INBOX" && detail?.myPendingApprovals
        ? `${page.name}（${detail.myPendingApprovals}）`
        : page.name,
  }));

  if (loading && !detail) {
    return (
      <div className="lowcode-loading">
        <Spin />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <Notice variant="error">
        {error || "应用不存在或无权访问"}
        <Button style={{ marginLeft: 12 }} onClick={() => router.push("/app-center")}>
          返回内建应用
        </Button>
      </Notice>
    );
  }

  const project = detail.project;

  return (
    <>
      <PageHero
        title={
          <span className="lowcode-hero-title">
            <Button
              type="text"
              size="small"
              aria-label="返回内建应用"
              icon={<ArrowLeftOutlined />}
              onClick={() => router.push("/app-center")}
            />
            {project.name}
          </span>
        }
        titleExtra={
          <>
            <Tag>{project.typeLabel || project.type}</Tag>
            <Tag color={detail.myRoleKey === "OWNER" ? "blue" : "default"}>
              {detail.myRoleName || detail.myRoleKey || "成员"}
            </Tag>
            {project.orgName ? <Tag color="geekblue">{project.orgName}</Tag> : <Tag>仅本人</Tag>}
          </>
        }
        desc={
          project.description ||
          "组织内共享的低代码应用：实体落多维表格，成员按角色权限读写，页面按配置渲染。"
        }
        tabs={heroTabs}
        activeTab={activeId}
        onTabChange={setActiveId}
        extra={
          project.canManage ? (
            <Button icon={<SettingOutlined />} onClick={() => openSettings("project")}>
              应用设置
            </Button>
          ) : null
        }
      />

      {!pages.length ? (
        <Notice variant="info">
          这个应用还没有页面。
          {project.canManage ? (
            <>
              打开右上角「应用设置」在「页面」里新建。{" "}
              <Button type="link" size="small" onClick={() => openSettings("pages")}>
                去新建页面
              </Button>
            </>
          ) : (
            "请联系项目管理员添加页面。"
          )}
        </Notice>
      ) : null}

      {active ? (
        <PageView
          key={active.id}
          projectId={projectId}
          page={active}
          entities={entities}
          entity={active.entityId ? entityOf(active.entityId) : undefined}
          canManage={project.canManage}
          onSaved={reload}
          onOpenSettings={openSettings}
        />
      ) : !pages.length ? (
        <div className="panel">
          <EmptyState
            text="暂无可用页面"
            action={
              project.canManage ? (
                <Button type="primary" onClick={() => openSettings("pages")}>
                  去新建页面
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : null}

      <SettingsDrawer
        open={settingsOpen}
        projectId={projectId}
        detail={detail}
        initialTab={settingsTab}
        onClose={() => setSettingsOpen(false)}
        onReload={reload}
      />
    </>
  );
}

function PageView({
  projectId,
  page,
  entities,
  entity,
  canManage,
  onSaved,
  onOpenSettings,
}: {
  projectId: number;
  page: LowCodePageView;
  entities: LowCodeEntityView[];
  entity?: LowCodeEntityView;
  canManage: boolean;
  onSaved: () => void;
  onOpenSettings: (tab: string) => void;
}) {
  if (page.type === "APPROVAL_INBOX") {
    return <ApprovalInboxView projectId={projectId} />;
  }
  if (page.type === "DASHBOARD") {
    return <DashboardView entities={entities} onOpenSettings={onOpenSettings} />;
  }
  if (page.type === "CUSTOM") {
    return (
      <CanvasView
        projectId={projectId}
        page={page}
        entities={entities}
        canManage={canManage}
        onSaved={onSaved}
      />
    );
  }
  if (!entity) {
    return (
      <Notice variant="warn">
        「{page.name}」绑定的实体不存在。
        {canManage ? (
          <>
            请到「应用设置 → 页面」重新选择实体。{" "}
            <Button type="link" size="small" onClick={() => onOpenSettings("pages")}>
              去调整页面
            </Button>
          </>
        ) : null}
      </Notice>
    );
  }
  if (page.type === "FORM") {
    return <EntityFormView projectId={projectId} entity={entity} />;
  }
  if (page.type === "DETAIL") {
    return <EntityDetailView projectId={projectId} entity={entity} />;
  }
  if (page.type === "KANBAN") {
    return (
      <EntityKanbanView
        projectId={projectId}
        entity={entity}
        page={page}
        onOpenSettings={onOpenSettings}
      />
    );
  }
  if (page.type === "LIST") {
    return <EntityListView projectId={projectId} entity={entity} page={page} />;
  }
  return (
    <Notice variant="info">
      「{page.name}」是{LOWCODE_PAGE_TYPE_LABELS[page.type] || page.type}页面，当前版本不支持该类型渲染。
    </Notice>
  );
}
