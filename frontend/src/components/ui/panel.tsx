"use client";

import { InboxOutlined } from "@ant-design/icons";
import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "@/lib/i18n/i18n";

/** 字符串文案过一遍字典（ReactNode 原样透传）：全站页头/面板标题在消费点统一随语言切换。 */
export function Translatable({ text }: { text: ReactNode }) {
  const { t } = useI18n();
  return <>{typeof text === "string" ? t(text) : text}</>;
}

export type HeroTab = { key: string; label: ReactNode; count?: number };

/**
 * 页签条（demo `.tabs` + `.tab-item` 胶囊分段）：放不下时**整行折到第二行**。
 * 不用 antd `Segmented`：它的滑块动效 + 放不下时的内部横滚会「跳」
 * （点页签时隐藏 radio 获焦，浏览器为露出获焦项会横滚宿主容器）。
 */
export function TabStrip({
  items,
  value,
  onChange,
  style,
}: {
  items: HeroTab[];
  value?: string;
  onChange: (key: string) => void;
  style?: CSSProperties;
}) {
  return (
    <div className="tabs" role="tablist" style={style}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={item.key === value}
          className={item.key === value ? "tab-item active" : "tab-item"}
          onClick={() => onChange(item.key)}
        >
          <Translatable text={item.label} />
          {item.count ? `（${item.count}）` : null}
        </button>
      ))}
    </div>
  );
}

/** 胶囊分段选项：value 与 label 成对，count 只在需要时带上。 */
export type PillTab = { key: string; label: ReactNode; count?: number };

/**
 * 面板内的轻量分段选择（筛选 / 二选一开关）：与页头 TabStrip 同一套胶囊语言，但更紧凑。
 * 不用 antd `Segmented`：滑块动效在选项多时会跳，小尺寸下与本站胶囊页签风格也不搭。
 * variant：solid 实心高亮（表单里的决策项）/ soft 浅底高亮（列表上方的筛选，选项多不刺眼）。
 */
export function PillTabs({
  items,
  value,
  onChange,
  size = "normal",
  variant = "solid",
  style,
}: {
  items: PillTab[];
  value?: string;
  onChange: (key: string) => void;
  size?: "normal" | "small";
  variant?: "solid" | "soft";
  style?: CSSProperties;
}) {
  return (
    <div
      className={`pill-tabs${size === "small" ? " small" : ""}${variant === "soft" ? " soft" : ""}`}
      role="tablist"
      style={style}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={item.key === value}
          className={item.key === value ? "pill-tab active" : "pill-tab"}
          onClick={() => onChange(item.key)}
        >
          <Translatable text={item.label} />
          {item.count ? <span className="pill-tab-count">{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/**
 * 页头：标题（紧跟其后的 titleExtra）与页签条同处首行（页签贴右上角），板块介绍整行落在标题下方 ——
 * 页签条与介绍各占一行，互不挤压（页签条放不下时整行折到第二行）。
 */
export function PageHero({
  title,
  titleExtra,
  desc,
  tabs,
  activeTab,
  onTabChange,
  extra,
}: {
  title: ReactNode;
  /** 贴着标题右侧的辅助入口（如「使用说明」）：不放行末，避免与右上角页签条挤在一起。 */
  titleExtra?: ReactNode;
  desc?: ReactNode;
  tabs?: HeroTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  extra?: ReactNode;
}) {
  return (
    <div className="page-hero">
      <div className="page-hero-head">
        <div className="page-hero-title-group">
          <h2 className="page-hero-title"><Translatable text={title} /></h2>
          {titleExtra}
        </div>
        <div className="page-hero-side">
          {tabs?.length ? (
            <TabStrip
              items={tabs}
              value={activeTab}
              onChange={(key) => onTabChange?.(key)}
            />
          ) : null}
          {extra}
        </div>
      </div>
      {desc ? <p className="page-hero-desc"><Translatable text={desc} /></p> : null}
    </div>
  );
}

/**
 * 栏目内子视图切换器（正文首行的旧口径，如「灵工发薪」子页签）：宽度收成内容宽，胶囊条不铺满整行。
 * 需要跟着面板标题走的工具页签，用 `Panel` 的 `titleExtra` + `TabStrip`。
 */
export function ColumnSwitch({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: ReactNode }[];
}) {
  return (
    <TabStrip
      items={options.map((item) => ({ key: item.value, label: item.label }))}
      value={value}
      onChange={onChange}
      style={{ width: "fit-content", marginBottom: 12 }}
    />
  );
}

export function Panel({
  title,
  titleExtra,
  extra,
  children,
  titleBadge,
}: {
  title: ReactNode;
  /** 贴着标题右侧的说明文字（如前置条件提示）：不放行末，避免与右上角页签条挤在一起。
   *  面板内页签条用 `extra`（行末右对齐），与全站页签样式一致。 */
  titleExtra?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  titleBadge?: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div className="panel-title-group">
          <h3><Translatable text={title} /></h3>
          {titleExtra}
        </div>
        {/* 说明与标题平级：放不下时说明整段换行，标题不被挤压（对齐 demo .panel-head） */}
        {titleBadge ? <span className="panel-badge">{titleBadge}</span> : null}
        {extra ? <div className="panel-extra">{extra}</div> : null}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="stat-grid">{children}</div>;
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  onClick,
}: {
  label: string;
  value: ReactNode;
  /** 卡片脚注：支持 ReactNode（如内嵌状态说明与「去绑定」链接），卡片内融合提示时用。 */
  hint?: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      className="stat-card"
      onClick={onClick}
      style={onClick ? { cursor: "pointer" } : undefined}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {icon ? <div className="stat-ico">{icon}</div> : null}
      <div style={{ minWidth: 0 }}>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {hint ? <div className="stat-hint">{hint}</div> : null}
      </div>
    </div>
  );
}

export function Notice({
  variant = "info",
  children,
}: {
  variant?: "info" | "warn" | "error" | "success";
  children: ReactNode;
}) {
  return <div className={`notice notice-${variant}`}>{children}</div>;
}

export function EmptyState({
  icon = <InboxOutlined aria-hidden />,
  text,
}: {
  icon?: ReactNode;
  text: string;
}) {
  return (
    <div className="empty">
      <div className="empty-ico">{icon}</div>
      <div>{text}</div>
    </div>
  );
}
