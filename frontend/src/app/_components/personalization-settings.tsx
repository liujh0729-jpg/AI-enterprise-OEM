"use client";

import { CheckOutlined, SettingOutlined } from "@ant-design/icons";
import { App, Button, Switch } from "antd";
import { useMemo, useState } from "react";
import {
  EmptyState,
  Notice,
  Panel,
  PanelTabs,
  PillTabs,
} from "@/components/ui/panel";
import { ROUTE_ICONS } from "@/components/pro/pro-layout";
import { navigationFor, type EnterpriseRoute } from "@/config/routes";
import { useI18n } from "@/lib/i18n/i18n";
import { useSession } from "@/lib/session";
import { useSiteBrand } from "@/lib/site-brand";
import { usePersonalization } from "@/lib/personalization";

/**
 * 驾驶舱「个性化设置」：把「系统里要有哪些菜单」与「整体风格」两件事收在一处，
 * 取代原先右上角齿轮从右侧滑出的风格设置层。菜单显隐是账号级（跨设备），风格设置仍只存本机。
 */

/** 可配置的板块：其余分组（模型服务 / 管理设置 / 商务人脉等）与驾驶舱不开放个人显隐。 */
const CONFIGURABLE_GROUPS = ["工作台", "业务服务", "智能硬件"] as const;

/** 主题色预设：取常用品牌蓝与一组对比度良好的色相。 */
const COLOR_PRESETS = [
  "#1677ff",
  "#5a54f9",
  "#9e339f",
  "#f5222d",
  "#fa541c",
  "#fa8c16",
  "#13c2c2",
  "#52c41a",
];

type MenuNode = {
  key: string;
  name: string;
  icon?: string;
  /** 叶子项才有真实 path（分组 / 子分组为 undefined）。 */
  path?: string;
  children?: MenuNode[];
};

function toNode(route: EnterpriseRoute): MenuNode {
  const children = route.routes?.length ? route.routes.map(toNode) : undefined;
  return {
    key: route.path || route.name || Math.random().toString(36).slice(2),
    name: route.name || route.path || "",
    icon: route.icon,
    path: children ? undefined : route.path,
    children,
  };
}

/** 拍平一个节点下所有叶子路径（分组/子分组取其全部后代）。 */
function leafPaths(node: MenuNode): string[] {
  if (!node.children?.length) return node.path ? [node.path] : [];
  return node.children.flatMap(leafPaths);
}

export function PersonalizationSettings() {
  const { message } = App.useApp();
  const { t } = useI18n();
  const { me } = useSession();
  const brand = useSiteBrand();
  const {
    settings,
    updateSettings,
    resetSettings,
    hiddenMenuPaths,
    saveHiddenMenuPaths,
    menusSaving,
  } = usePersonalization();

  const [tab, setTab] = useState("menu");
  const [draft, setDraft] = useState<string[] | null>(null);
  const dirty = draft !== null;
  const active = draft ?? hiddenMenuPaths;

  /** 目录 = 当前身份可见菜单里的可配置分组（站点显隐 + 身份过滤已生效）。 */
  const groups = useMemo(() => {
    const routes = navigationFor(me, brand.hiddenMenuPaths || []).routes || [];
    return CONFIGURABLE_GROUPS.map((name) =>
      routes.find((route) => route.name === name),
    )
      .filter((route): route is EnterpriseRoute => Boolean(route))
      .map(toNode);
  }, [me, brand.hiddenMenuPaths]);

  const activeSet = useMemo(() => new Set(active), [active]);
  const iconOf = (node: MenuNode) =>
    node.icon ? ROUTE_ICONS[node.icon as keyof typeof ROUTE_ICONS] : null;

  const setLeaf = (path: string, visible: boolean) => {
    const next = new Set(active);
    if (visible) next.delete(path);
    else next.add(path);
    setDraft([...next]);
  };

  const setGroup = (node: MenuNode, visible: boolean) => {
    const next = new Set(active);
    for (const path of leafPaths(node)) {
      if (visible) next.delete(path);
      else next.add(path);
    }
    setDraft([...next]);
  };

  const saveMenus = async () => {
    const ok = await saveHiddenMenuPaths(active);
    if (ok) {
      message.success("菜单设置已保存");
      setDraft(null);
    } else {
      message.error("菜单设置保存失败，请重试");
    }
  };

  const menuTab = groups.length ? (
    <div>
      <Notice variant="info">
        {`勾选你要用到的功能；取消勾选的菜单会从左侧隐藏（直接输入网址仍可访问）。某个分组下的菜单全部取消后，该分组也会一起隐藏。这里只列出你当前身份能看到、且可自由取舍的板块。`}
      </Notice>
      <div className="ps-grid">
        {groups.map((group) => {
          const paths = leafPaths(group);
          const visibleCount = paths.filter((path) => !activeSet.has(path)).length;
          return (
            <div className="ps-group" key={group.key}>
              <div className="ps-group-head">
                <span className="ps-group-title">
                  {iconOf(group)}
                  {t(group.name)}
                </span>
                <Switch
                  size="small"
                  checked={visibleCount > 0}
                  onChange={(checked) => setGroup(group, checked)}
                  aria-label={`${group.name}：${visibleCount > 0 ? "全部隐藏" : "全部显示"}`}
                />
              </div>
              <div className="ps-list">
                {(group.children || []).map((child) =>
                  child.children?.length ? (
                    <div className="ps-sub" key={child.key}>
                      <div className="ps-sub-head">
                        <span className="ps-label">
                          {iconOf(child)}
                          {t(child.name)}
                        </span>
                        <Switch
                          size="small"
                          checked={leafPaths(child).some(
                            (path) => !activeSet.has(path),
                          )}
                          onChange={(checked) => setGroup(child, checked)}
                          aria-label={`${child.name}：全部隐藏或显示`}
                        />
                      </div>
                      {child.children.map((leaf) => (
                        <MenuRow
                          key={leaf.key}
                          node={leaf}
                          icon={iconOf(leaf)}
                          visible={!activeSet.has(leaf.path || "")}
                          onToggle={setLeaf}
                          label={t(leaf.name)}
                        />
                      ))}
                    </div>
                  ) : (
                    <MenuRow
                      key={child.key}
                      node={child}
                      icon={iconOf(child)}
                      visible={!activeSet.has(child.path || "")}
                      onToggle={setLeaf}
                      label={t(child.name)}
                    />
                  ),
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="ps-actions">
        <Button
          type="primary"
          loading={menusSaving}
          disabled={!dirty}
          onClick={() => void saveMenus()}
        >
          保存菜单
        </Button>
        <Button onClick={() => setDraft([])}>恢复默认（全部显示）</Button>
        {dirty ? (
          <span className="text-12 muted">有未保存的修改</span>
        ) : (
          <span className="text-12 muted">已与账号同步</span>
        )}
      </div>
    </div>
  ) : (
    <EmptyState
      icon={<SettingOutlined aria-hidden />}
      text="当前身份没有可自行取舍的菜单板块（平台管理员的菜单由平台统一控制）"
    />
  );

  const navTheme: "light" | "realDark" =
    settings.navTheme === "realDark" ? "realDark" : "light";
  const layout: "side" | "top" | "mix" =
    settings.layout === "side" || settings.layout === "top"
      ? settings.layout
      : "mix";
  const contentWidth: "Fluid" | "Fixed" =
    settings.contentWidth === "Fixed" ? "Fixed" : "Fluid";

  const styleTab = (
    <div>
      <div className="ps-field">
        <div>
          <div className="ps-field-label">主题色</div>
          <div className="ps-field-hint">导航与主按钮的主色调</div>
        </div>
        <div className="ps-swatches">
          {COLOR_PRESETS.map((color) => (
            <button
              key={color}
              type="button"
              className={`ps-swatch${settings.colorPrimary === color ? " active" : ""}`}
              style={{ background: color }}
              aria-label={`主题色 ${color}`}
              aria-pressed={settings.colorPrimary === color}
              onClick={() => updateSettings({ colorPrimary: color })}
            >
              {settings.colorPrimary === color ? <CheckOutlined /> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="ps-field">
        <div>
          <div className="ps-field-label">导航模式</div>
          <div className="ps-field-hint">深色只作用于导航与布局底色</div>
        </div>
        <PillTabs
          size="small"
          items={[
            { key: "light", label: "亮色" },
            { key: "realDark", label: "暗色" },
          ]}
          value={navTheme}
          onChange={(key) =>
            updateSettings({ navTheme: key === "realDark" ? "realDark" : "light" })
          }
        />
      </div>

      <div className="ps-field">
        <div>
          <div className="ps-field-label">布局</div>
          <div className="ps-field-hint">菜单在左侧、顶部，或顶部一级 + 左侧二级</div>
        </div>
        <PillTabs
          size="small"
          items={[
            { key: "side", label: "侧边" },
            { key: "top", label: "顶部" },
            { key: "mix", label: "混合" },
          ]}
          value={layout}
          onChange={(key) =>
            updateSettings({
              layout: key === "side" || key === "top" ? key : "mix",
            })
          }
        />
      </div>

      <div className="ps-field">
        <div>
          <div className="ps-field-label">内容区域宽度</div>
          <div className="ps-field-hint">流式铺满，或定宽居中留白</div>
        </div>
        <PillTabs
          size="small"
          items={[
            { key: "Fluid", label: "流式" },
            { key: "Fixed", label: "定宽" },
          ]}
          value={contentWidth}
          onChange={(key) =>
            updateSettings({ contentWidth: key === "Fixed" ? "Fixed" : "Fluid" })
          }
        />
      </div>

      <div className="ps-field">
        <div>
          <div className="ps-field-label">固定顶栏</div>
          <div className="ps-field-hint">滚动时顶栏保持可见</div>
        </div>
        <Switch
          size="small"
          checked={Boolean(settings.fixedHeader)}
          onChange={(checked) => updateSettings({ fixedHeader: checked })}
        />
      </div>

      <div className="ps-field">
        <div>
          <div className="ps-field-label">固定侧边菜单</div>
          <div className="ps-field-hint">滚动时左侧菜单保持可见</div>
        </div>
        <Switch
          size="small"
          checked={Boolean(settings.fixSiderbar)}
          onChange={(checked) => updateSettings({ fixSiderbar: checked })}
        />
      </div>

      <div className="ps-field">
        <div>
          <div className="ps-field-label">色弱模式</div>
          <div className="ps-field-hint">降低对比、增强区分度，便于辨认状态色</div>
        </div>
        <Switch
          size="small"
          checked={Boolean(settings.colorWeak)}
          onChange={(checked) => updateSettings({ colorWeak: checked })}
        />
      </div>

      <div className="ps-actions">
        <Button
          onClick={() => {
            resetSettings();
            message.success("已恢复默认风格");
          }}
        >
          恢复默认风格
        </Button>
        <span className="text-12 muted">
          风格设置只保存在当前浏览器，换设备或清缓存会回到默认值。
        </span>
      </div>
    </div>
  );

  return (
    <Panel
      title="个性化设置"
      titleBadge={
        <span className="text-12 muted">
          按需精简左侧菜单，并调整整体风格
        </span>
      }
    >
      <PanelTabs
        value={tab}
        onChange={setTab}
        items={[
          { key: "menu", label: "菜单配置", children: menuTab },
          { key: "style", label: "整体风格", children: styleTab },
        ]}
      />
    </Panel>
  );
}

function MenuRow({
  node,
  icon,
  visible,
  onToggle,
  label,
}: {
  node: MenuNode;
  icon: React.ReactNode;
  visible: boolean;
  onToggle: (path: string, visible: boolean) => void;
  label: string;
}) {
  return (
    <div className="ps-row">
      <span className="ps-label">
        {icon}
        {label}
      </span>
      <Switch
        size="small"
        checked={visible}
        disabled={!node.path}
        onChange={(checked) => node.path && onToggle(node.path, checked)}
        aria-label={label}
      />
    </div>
  );
}
