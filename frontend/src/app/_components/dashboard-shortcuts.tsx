"use client";

import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CarryOutOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { App, Button, Checkbox, Drawer, Space } from "antd";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { dashboardShortcutsSchema } from "@enterprise/contracts";
import { EmptyState, Panel } from "@/components/ui/panel";
import { ROUTE_ICONS } from "@/components/pro/pro-layout";
import { navigationFor, type EnterpriseRoute } from "@/config/routes";
import { uiPreferencesApi } from "@/api/ui-preferences";
import { useI18n } from "@/lib/i18n/i18n";
import { useSession } from "@/lib/session";
import { useSiteBrand } from "@/lib/site-brand";
import { presentMutationError } from "@/query/errors";
import { useBusinessMutation, useBusinessQuery } from "@/query/business";

const PREF_KEY = "dashboard.shortcuts";
const MAX_SHORTCUTS = 12;

/** 首次进入的预置快捷入口：全部取自侧栏菜单，命中不到会自动跳过（不会出现当前身份看不到的页面）。 */
const DEFAULT_PATHS = [
  "/agent",
  "/kb",
  "/data-table",
  "/crm",
  "/oa",
  "/okr",
  "/project",
  "/marketing-tools",
  "/bi",
];

type ShortcutItem = { path: string; name: string; icon?: string };

/** 递归拍平菜单：只保留带 path 的叶子项（含外链），分组本身不均作入口。 */
function flattenMenu(routes: EnterpriseRoute[] | undefined, out: ShortcutItem[]) {
  for (const route of routes || []) {
    if (route.type === "group") {
      flattenMenu(route.routes, out);
      continue;
    }
    if (route.path) out.push({ path: route.path, name: route.name || route.path, icon: route.icon });
  }
}

/**
 * 驾驶舱首个板块「快捷导航」：当前身份可见菜单的常用入口集合，整卡可点直达；
 * 右上角「设置」打开抽屉，勾选增删、上下箭头排序，落库账号级（跨设备）。
 */
export function DashboardShortcuts() {
  const router = useRouter();
  const { message } = App.useApp();
  const { t } = useI18n();
  const { me } = useSession();
  const brand = useSiteBrand();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);

  /** 目录 = 当前身份可见的侧栏菜单（站点显隐 + 身份过滤 + 类目开通），只收菜单里的叶子项。 */
  const catalog = useMemo(() => {
    const out: ShortcutItem[] = [];
    flattenMenu(navigationFor(me, brand.hiddenMenuPaths || []).routes, out);
    const seen = new Set<string>();
    return out.filter((item) => !seen.has(item.path) && (seen.add(item.path), true));
  }, [me, brand.hiddenMenuPaths]);
  const catalogMap = useMemo(() => new Map(catalog.map((item) => [item.path, item])), [catalog]);

  const prefQuery = useBusinessQuery(
    "ui-preferences",
    PREF_KEY,
    {},
    (signal) => uiPreferencesApi.get({ params: { key: PREF_KEY } }, { signal }),
    "all",
    Boolean(me),
  );

  /** 已保存的路径；没存过或结构不合规时为 null，回落到预置。 */
  const storedPaths = useMemo(() => {
    const parsed = dashboardShortcutsSchema.safeParse(prefQuery.data?.value);
    return parsed.success ? parsed.data.paths : null;
  }, [prefQuery.data]);

  /** 生效列表：预置或已存值里剔除当前身份看不到的页面（隐藏的菜单不进导航）。 */
  const effectivePaths = useMemo(
    () => (storedPaths ?? DEFAULT_PATHS).filter((path) => catalogMap.has(path)),
    [storedPaths, catalogMap],
  );

  const saveMutation = useBusinessMutation(
    (paths: string[]) =>
      uiPreferencesApi.save({ params: { key: PREF_KEY }, body: { value: { paths } } }),
    ["ui-preferences"],
  );

  const iconOf = (item?: ShortcutItem) =>
    item?.icon ? ROUTE_ICONS[item.icon as keyof typeof ROUTE_ICONS] : <CarryOutOutlined />;

  const openDrawer = () => {
    setDraft(effectivePaths);
    setOpen(true);
  };

  const toggle = (path: string, checked: boolean) => {
    setDraft((prev) => {
      if (checked) {
        if (prev.includes(path) || prev.length >= MAX_SHORTCUTS) return prev;
        return [...prev, path];
      }
      return prev.filter((item) => item !== path);
    });
  };

  const move = (index: number, delta: number) => {
    setDraft((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const resetDefault = () => setDraft(DEFAULT_PATHS.filter((path) => catalogMap.has(path)));

  const save = () => {
    saveMutation.mutate(draft, {
      onSuccess: () => {
        message.success("快捷导航已保存");
        setOpen(false);
      },
      onError: (error) => presentMutationError(error, (text) => message.error(text)),
    });
  };

  const rowLabel = (path: string) => {
    const item = catalogMap.get(path);
    return (
      <span className="shortcut-item">
        <span className="shortcut-ico">{iconOf(item)}</span>
        <span className="shortcut-name">{t(item?.name || path)}</span>
      </span>
    );
  };

  const available = catalog.filter((item) => !draft.includes(item.path));

  return (
    <Panel
      title="快捷导航"
      titleBadge={<span className="text-12 muted">常用入口一屏直达，可自行增减与排序</span>}
      extra={
        <Button size="small" icon={<SettingOutlined />} onClick={openDrawer}>
          设置
        </Button>
      }
    >
      {effectivePaths.length ? (
        <div className="biz-grid">
          {effectivePaths.map((path) => {
            const item = catalogMap.get(path)!;
            const external = /^https?:\/\//.test(path);
            return (
              <button
                key={path}
                type="button"
                className="biz-card"
                onClick={() => {
                  if (external) window.open(path, "_blank", "noreferrer");
                  else router.push(path);
                }}
              >
                <span className="biz-ico">{iconOf(item)}</span>
                <span className="biz-main">
                  <span className="biz-label">{t(item.name)}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<CarryOutOutlined aria-hidden />}
          text="还没有快捷入口：点右上角「设置」从菜单里挑选常用入口"
        />
      )}

      <Drawer
        title="设置快捷导航"
        size={440}
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <div className="shortcut-footer">
            <Button onClick={resetDefault}>恢复默认</Button>
            <Space>
              <Button onClick={() => setOpen(false)}>取消</Button>
              <Button type="primary" loading={saveMutation.isPending} onClick={save}>
                保存
              </Button>
            </Space>
          </div>
        }
      >
        <div className="text-12 muted" style={{ marginBottom: 10 }}>
          {`已选 ${draft.length}/${MAX_SHORTCUTS}：勾选添加、取消即移除；用上下箭头排序。目录只列出当前身份可见的菜单，不会出现看不到的页面。`}
        </div>
        {draft.length ? (
          <div className="shortcut-order">
            {draft.map((path, index) => (
              <div className="shortcut-row" key={path}>
                <Checkbox checked onChange={() => toggle(path, false)} />
                {rowLabel(path)}
                <span className="shortcut-actions">
                  <Button
                    size="small"
                    type="text"
                    icon={<ArrowUpOutlined />}
                    disabled={index === 0}
                    aria-label="上移"
                    onClick={() => move(index, -1)}
                  />
                  <Button
                    size="small"
                    type="text"
                    icon={<ArrowDownOutlined />}
                    disabled={index === draft.length - 1}
                    aria-label="下移"
                    onClick={() => move(index, 1)}
                  />
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="还没有添加快捷入口：勾选下方菜单即可添加" />
        )}
        {available.length ? (
          <div className="shortcut-available">
            {available.map((item) => (
              <div className="shortcut-row" key={item.path}>
                <Checkbox
                  checked={false}
                  disabled={draft.length >= MAX_SHORTCUTS}
                  onChange={() => toggle(item.path, true)}
                />
                {rowLabel(item.path)}
              </div>
            ))}
          </div>
        ) : null}
      </Drawer>
    </Panel>
  );
}
