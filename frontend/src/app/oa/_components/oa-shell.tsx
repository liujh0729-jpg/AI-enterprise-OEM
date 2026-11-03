"use client";

import { Button, ConfigProvider, Select, Spin } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  OA_LINK_TARGETS,
  type OaApplication,
  type OaLinkSearchItem,
  type OaLinkTarget,
  type OaLinkTargetType,
  type OaOrg,
  type OaTemplateSummary,
  type OaWorkspace,
} from "@enterprise/contracts";
import { oaApi } from "@/api/oa";
import {
  EmptyState,
  Notice,
  PageHero,
  Panel,
  StatCard,
  StatGrid,
} from "@/components/ui/panel";
import { ApplicationDetail } from "./application-detail";
import { ApplicationsPanel } from "./applications-panel";
import { CcPanel } from "./cc-panel";
import { NewApplicationDrawer } from "./new-application-drawer";
import { SettingsPanel } from "./settings-panel";
import { TemplatesPanel } from "./templates-panel";
import { TodoPanel } from "./todo-panel";
import {
  oaError,
  orgQueryOf,
  type OaMember,
  type OaOrgQuery,
} from "./oa-common";

type OverviewData = NonNullable<Awaited<ReturnType<typeof oaApi.overview>>>;

const TABS = [
  { key: "todo", label: "待我审批" },
  { key: "mine", label: "我发起的" },
  { key: "cc", label: "抄送我的" },
  { key: "all", label: "全部单据" },
  { key: "templates", label: "模板与流程" },
];

/** 管理员专属页签：普通成员不渲染，深链进来也回落到「待我审批」。 */
const ADMIN_TABS = ["all", "templates"];

const TAB_KEYS = TABS.map((item) => item.key);

const isOrgAdmin = (org: OaOrg | null) =>
  org?.role === "OWNER" || org?.role === "ADMIN";

const isLinkTarget = (value: string): value is OaLinkTargetType =>
  (OA_LINK_TARGETS as readonly string[]).includes(value);

/** `/oa` 与 `/oa/new` 共用一份页壳：后者只是把深链的关联对象预填进新建抽屉。 */
export function OaShell({ defaultTab = "todo" }: { defaultTab?: string }) {
  const [workspace, setWorkspace] = useState<OaWorkspace | null>(null);
  const [org, setOrg] = useState<OaOrg | null>(null);
  const [tab, setTab] = useState(defaultTab);
  const [detailId, setDetailId] = useState(0);
  const [detailNonce, setDetailNonce] = useState(0);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [templates, setTemplates] = useState<OaTemplateSummary[]>([]);
  const [members, setMembers] = useState<OaMember[]>([]);
  const [functions, setFunctions] = useState<{
    departments: { name: string; description: string }[];
    positions: { name: string; description: string }[];
    personas: { id: number; name: string; style: string; persona: string }[];
  }>({ departments: [], positions: [], personas: [] });
  const [targets, setTargets] = useState<OaLinkTarget[]>([]);
  const [mainError, setMainError] = useState("");
  const [loadNote, setLoadNote] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<OaApplication | null>(null);
  const [presetTemplateId, setPresetTemplateId] = useState<number | undefined>();
  const [presetLinks, setPresetLinks] = useState<OaLinkSearchItem[]>([]);
  const [presetTitle, setPresetTitle] = useState("");
  const [launch, setLaunch] = useState<{
    targetType: OaLinkTargetType;
    targetId: string;
  } | null>(null);

  const orgQuery: OaOrgQuery = useMemo(() => orgQueryOf(org), [org]);
  const isAdmin = isOrgAdmin(org);
  const activeTab = isAdmin || !ADMIN_TABS.includes(tab) ? tab : "todo";

  const loadWorkspace = useCallback(async () => {
    try {
      const data = await oaApi.workspace({});
      setWorkspace(data);
      setMainError("");
      setOrg((prev) => {
        if (!data?.orgs.length) return null;
        const keep =
          prev &&
          data.orgs.find(
            (item) =>
              item.orgType === prev.orgType && item.orgUserId === prev.orgUserId,
          );
        return keep || data.current;
      });
    } catch (err) {
      setMainError(oaError(err));
    }
  }, []);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const initial = query.get("tab");
    const id = (query.get("id") || "").trim();
    const target = (query.get("target") || "").trim();
    if (initial && TAB_KEYS.includes(initial)) setTab(initial);
    // 深链带 target 时，id 是业务对象 id（可能是 projectId:entityId:rowId 组合），不是 OA 单号。
    if (target && id && isLinkTarget(target)) {
      setLaunch({ targetType: target, targetId: id });
    } else {
      const detailParam = Number(id || 0);
      if (Number.isFinite(detailParam) && detailParam > 0) setDetailId(detailParam);
    }
    const template = Number(query.get("template") || 0);
    if (Number.isFinite(template) && template > 0) setPresetTemplateId(template);
  }, []);

  // 关联对象注册表与组织无关，只取一次。
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await oaApi.linkTargets({});
        if (alive) setTargets(data || []);
      } catch {
        if (alive) setTargets([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const { orgType, orgUserId } = orgQuery;

  const loadOrgData = useCallback(async () => {
    const notes: string[] = [];
    const [overviewResult, templatesResult, settingsResult] =
      await Promise.allSettled([
        oaApi.overview({ query: { orgType, orgUserId } }),
        oaApi.templates({ query: { orgType, orgUserId } }),
        oaApi.settings({ query: { orgType, orgUserId } }),
      ]);
    if (overviewResult.status === "fulfilled") {
      setOverview(overviewResult.value);
    } else {
      setOverview(null);
      notes.push(`统计加载失败：${oaError(overviewResult.reason)}`);
    }
    if (templatesResult.status === "fulfilled") {
      setTemplates(templatesResult.value || []);
    } else {
      setTemplates([]);
      notes.push(`模板加载失败：${oaError(templatesResult.reason)}`);
    }
    if (settingsResult.status === "fulfilled") {
      setMembers(settingsResult.value?.members || []);
      setFunctions({
        departments: settingsResult.value?.departments || [],
        positions: settingsResult.value?.positions || [],
        personas: settingsResult.value?.personas || [],
      });
    } else {
      setMembers([]);
      setFunctions({ departments: [], positions: [], personas: [] });
      notes.push(`组织成员加载失败：${oaError(settingsResult.reason)}`);
    }
    setLoadNote(notes.join("；"));
  }, [orgType, orgUserId]);

  useEffect(() => {
    if (!org) return;
    void loadOrgData();
  }, [org, loadOrgData]);

  // 深链预填：组织确定后才能按 id 回查关联对象；回查不到也照常打开抽屉让用户自己选。
  useEffect(() => {
    if (!launch || !org) return;
    const current = launch;
    setLaunch(null);
    void (async () => {
      try {
        const items = await oaApi.linkSearch({
          query: {
            orgType,
            orgUserId,
            targetType: current.targetType,
            keyword: "",
            targetId: current.targetId,
          },
        });
        const first = items?.[0];
        if (first) {
          setPresetLinks([first]);
          setPresetTitle(first.title);
        } else {
          setLoadNote(
            "关联的业务对象不在当前组织的数据范围内，请在「关联业务对象」里重新选择",
          );
        }
      } catch (err) {
        setLoadNote(oaError(err));
      }
      setDrawerOpen(true);
    })();
  }, [launch, org, orgType, orgUserId]);

  const tabItems = (isAdmin ? TABS : TABS.filter((item) => !ADMIN_TABS.includes(item.key))).map(
    (item) => ({
      ...item,
      count:
        item.key === "todo"
          ? overview?.todoCount || 0
          : item.key === "cc"
            ? overview?.unreadCcCount || 0
            : 0,
    }),
  );

  const goTab = (key: string) => {
    setTab(key);
    setDetailId(0);
  };

  const openNew = () => {
    setEditing(null);
    setPresetTemplateId(undefined);
    setPresetLinks([]);
    setDrawerOpen(true);
  };

  const openEditById = async (id: number) => {
    try {
      const data = await oaApi.applicationDetail({
        params: { id: String(id) },
        query: orgQuery,
      });
      if (!data) {
        setLoadNote(`草稿 ${id} 不存在或不在当前组织`);
        return;
      }
      setEditing(data);
      setPresetTemplateId(undefined);
      setPresetLinks([]);
      setDrawerOpen(true);
    } catch (err) {
      setLoadNote(oaError(err));
    }
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditing(null);
    setPresetTemplateId(undefined);
    setPresetLinks([]);
    setPresetTitle("");
  };

  const onSaved = async (app: OaApplication, submitted: boolean) => {
    const wasOpenOnDetail = detailId === app.id;
    closeDrawer();
    await loadOrgData();
    if (submitted) {
      // 提交后停在详情上，发起人能立刻看到流程走到了哪个节点。
      setDetailId(app.id);
      setDetailNonce((n) => n + 1);
      return;
    }
    if (wasOpenOnDetail) setDetailNonce((n) => n + 1);
    else setDetailId(0);
  };

  const detail =
    detailId > 0 ? (
      <ApplicationDetail
        key={`${detailId}-${detailNonce}`}
        id={detailId}
        org={orgQuery}
        members={members}
        targets={targets}
        isAdmin={isAdmin}
        onBack={() => setDetailId(0)}
        onChanged={() => void loadOrgData()}
        onEdit={(app) => {
          setEditing(app);
          setPresetTemplateId(undefined);
          setPresetLinks([]);
          setDrawerOpen(true);
        }}
        onDeleted={() => {
          setDetailId(0);
          void loadOrgData();
        }}
      />
    ) : null;

  const content =
    activeTab === "todo" ? (
      <TodoPanel org={org} templates={templates} onDetail={(id) => setDetailId(id)} />
    ) : activeTab === "mine" ? (
      <ApplicationsPanel
        scope="MINE"
        org={org}
        templates={templates}
        members={members}
        onDetail={(id) => setDetailId(id)}
        onEdit={(id) => void openEditById(id)}
        onNew={openNew}
      />
    ) : activeTab === "cc" ? (
      <CcPanel org={org} onDetail={(id) => setDetailId(id)} />
    ) : activeTab === "all" ? (
      <ApplicationsPanel
        scope="ALL"
        org={org}
        templates={templates}
        members={members}
        onDetail={(id) => setDetailId(id)}
        onEdit={(id) => void openEditById(id)}
      />
    ) : (
      <>
        <TemplatesPanel
          org={org}
          members={members}
          functions={functions}
          onChanged={loadOrgData}
        />
        <SettingsPanel
          org={org}
          isAdmin={isAdmin}
          onChanged={() => void loadOrgData()}
        />
      </>
    );

  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="OA"
        desc="表单申请与多级审批：请假、报销、付款、采购、用章；可关联 CRM 等业务数据，审批结果回写。"
        tabs={tabItems}
        activeTab={activeTab}
        onTabChange={goTab}
        extra={
          workspace && workspace.orgs.length > 1 ? (
            <Select
              style={{ minWidth: 220 }}
              value={org ? `${org.orgType}:${org.orgUserId}` : undefined}
              options={workspace.orgs.map((item) => ({
                value: `${item.orgType}:${item.orgUserId}`,
                label: `${item.name}（${item.roleLabel || item.orgType}）`,
              }))}
              onChange={(value: string) => {
                const next = workspace.orgs.find(
                  (item) => `${item.orgType}:${item.orgUserId}` === value,
                );
                if (!next) return;
                setOrg(next);
                setDetailId(0);
              }}
            />
          ) : null
        }
      />

      {mainError ? (
        <Notice variant="error">
          {mainError}
          <Button onClick={() => void loadWorkspace()}>重试</Button>
        </Notice>
      ) : null}

      {!workspace && !mainError ? (
        <div style={{ padding: 40, textAlign: "center" }}>
          <Spin />
        </div>
      ) : null}

      {workspace && !workspace.orgs.length && !mainError ? (
        <Panel title="OA">
          <EmptyState text="你还没有可用的组织身份：OA 按组织运行，请先完成企业备案，或绑定一家开通 OA 板块的服务机构。" />
        </Panel>
      ) : null}

      {workspace && org ? (
        <>
          <StatGrid>
            <StatCard
              label="待我审批"
              value={overview?.todoCount ?? "—"}
              hint={
                overview?.otherPendingCount
                  ? `另有 ${overview.otherPendingCount} 条其他系统待办`
                  : undefined
              }
              onClick={() => goTab("todo")}
            />
            <StatCard
              label="我发起进行中"
              value={overview?.myApprovingCount ?? "—"}
              onClick={() => goTab("mine")}
            />
            <StatCard label="本月完成" value={overview?.monthDoneCount ?? "—"} />
            <StatCard
              label="平均办结时长"
              value={overview ? `${overview.avgHandleHours} 小时` : "—"}
              hint="提交到出结论"
            />
            <StatCard
              label="超时未处理"
              value={overview ? `${overview.overdueCount} 条` : "—"}
            />
          </StatGrid>
          {loadNote ? (
            <Notice variant="warn">
              {`部分数据加载失败：${loadNote}`}
              <Button onClick={() => void loadOrgData()}>重试</Button>
            </Notice>
          ) : null}
          {detail || content}
        </>
      ) : null}

      <NewApplicationDrawer
        open={drawerOpen}
        org={orgQuery}
        members={members}
        targets={targets}
        templates={templates}
        application={editing}
        presetTemplateId={presetTemplateId}
        presetLinks={presetLinks}
        presetTitle={presetTitle}
        onClose={closeDrawer}
        onSaved={(app, submitted) => void onSaved(app, submitted)}
      />
    </ConfigProvider>
  );
}
