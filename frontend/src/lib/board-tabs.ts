import type { HeroTab } from "@/components/ui/panel";

/**
 * 「业务服务」板块页签显隐（站点级，管理员在后台「站点设置 → 业务服务板块页签」配置）。
 * 12 个板块与 routes.ts「业务服务」分组同源；每个板块的 `demand`（需求信息）/ `services`（服务市集）
 * 对应其页头页签的 key 与文案。token 存 `<board>:<role>`（role: demand | services）。
 * 与「用户侧菜单显隐」同口径：仅控制页签展示，对所有身份一致生效，直链/接口不受限。
 */
export interface BoardTabDef {
  /** 板块 id（与后台存储 token 前段一致） */
  board: string;
  /** 板块名（后台选择器展示） */
  name: string;
  /** 需求信息页签（key + 文案）；该板块无此页签时为 null */
  demand: { key: string; label: string } | null;
  /** 服务市集页签（key + 文案）；该板块无此页签时为 null */
  services: { key: string; label: string } | null;
}

export const BOARD_TAB_DEFS: BoardTabDef[] = [
  { board: "marketing", name: "营销服务", demand: { key: "requests", label: "需求信息" }, services: { key: "services", label: "营销服务市集" } },
  { board: "supply", name: "供销网络", demand: { key: "requests", label: "需求信息" }, services: { key: "publish", label: "供销网络服务市集" } },
  { board: "tax", name: "财税服务", demand: { key: "requests", label: "需求信息" }, services: { key: "services", label: "财税服务市集" } },
  { board: "overseas", name: "跨境出海", demand: { key: "requests", label: "需求信息" }, services: { key: "services", label: "跨境出海服务市集" } },
  { board: "flex", name: "灵活用工", demand: { key: "work-orders", label: "用工需求" }, services: { key: "services", label: "灵活用工服务市集" } },
  { board: "logistics", name: "物流服务", demand: { key: "requests", label: "需求信息" }, services: { key: "services", label: "物流服务市集" } },
  { board: "smart", name: "IT服务", demand: { key: "requests", label: "需求信息" }, services: { key: "services", label: "IT服务市集" } },
  { board: "ip", name: "知识产权", demand: { key: "requests", label: "需求消息" }, services: { key: "services", label: "知识产权服务市集" } },
  { board: "legal", name: "法律服务", demand: { key: "requests", label: "需求消息" }, services: { key: "services", label: "法律服务市集" } },
  { board: "think-tank", name: "智库服务", demand: { key: "requests", label: "需求消息" }, services: { key: "services", label: "咨询服务市集" } },
  { board: "asset", name: "资产交易", demand: { key: "requests", label: "需求信息" }, services: { key: "services", label: "资产交易市集" } },
  { board: "market", name: "供需市场", demand: { key: "demands", label: "需求" }, services: { key: "services", label: "服务" } },
];

function boardTabDef(board: string): BoardTabDef | undefined {
  return BOARD_TAB_DEFS.find((def) => def.board === board);
}

/** 某板块下因站点配置而需隐藏的页签 key 集合。 */
export function hiddenBoardTabKeys(board: string, hidden?: string[]): Set<string> {
  const keys = new Set<string>();
  const def = boardTabDef(board);
  if (!def || !hidden?.length) return keys;
  const set = new Set(hidden);
  if (def.demand && set.has(`${board}:demand`)) keys.add(def.demand.key);
  if (def.services && set.has(`${board}:services`)) keys.add(def.services.key);
  return keys;
}

/**
 * 按站点级「板块页签显隐」过滤页签：只摘掉被点名板块的「需求信息 / 服务市集」页签，
 * 其余页签（资源库 / 名录等）原样保留。
 */
export function filterBoardTabs(board: string, tabs: HeroTab[], hidden?: string[]): HeroTab[] {
  const hide = hiddenBoardTabKeys(board, hidden);
  return hide.size ? tabs.filter((tab) => !hide.has(tab.key)) : tabs;
}
