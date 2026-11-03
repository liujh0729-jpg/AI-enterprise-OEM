import type { ReactNode } from "react";

/**
 * 「工作台」三个卡片首屏（内容创作 / 营销工具 / 应用市场）共用同一套版式：
 * 一行固定 4 张卡，条目少也占 4 等分之一的宽度；整卡可点，卡内不放按钮。
 */
export function ToolCardGrid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 16,
      }}
    >
      {children}
    </div>
  );
}

export function ToolCard({
  icon,
  title,
  tag,
  description,
  meta,
  onClick,
}: {
  icon?: ReactNode;
  title: ReactNode;
  tag?: ReactNode;
  description: ReactNode;
  /** 说明下方的一行补充信息（如应用市场的授权范围与首页地址）。 */
  meta?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: "left",
        border: "1px solid var(--line, #f0f0f0)",
        borderRadius: 12,
        padding: "16px 18px",
        background: "#fff",
        cursor: "pointer",
        display: "grid",
        gap: 8,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {icon}
        <strong>{title}</strong>
        {tag}
      </span>
      <span
        className="text-12 muted"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {description}
      </span>
      {meta ? (
        <span className="text-12 muted" style={{ fontSize: 12 }}>
          {meta}
        </span>
      ) : null}
    </button>
  );
}
