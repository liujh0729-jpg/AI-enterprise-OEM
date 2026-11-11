import { z } from "zod";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/** 已知的界面偏好键：驾驶舱「快捷导航」与侧栏「个性化菜单显隐」；未登记键一律拒绝写入。 */
export const UI_PREFERENCE_KEYS = ["dashboard.shortcuts", "nav.hiddenMenus"] as const;
export type UiPreferenceKey = (typeof UI_PREFERENCE_KEYS)[number];

export const uiPreferenceSchema = z.object({
  key: z.string(),
  /** 任意 JSON：数组/对象/标量，由各功能自行约定结构 */
  value: z.unknown(),
  updatedAt: z.string().nullable(),
});
export type UiPreference = z.infer<typeof uiPreferenceSchema>;

/** 驾驶舱快捷导航：有序的菜单路径集合（账号级，跨设备）。 */
export const dashboardShortcutsSchema = z.object({
  paths: z.array(z.string()).max(12),
});
export type DashboardShortcuts = z.infer<typeof dashboardShortcutsSchema>;

/**
 * 侧栏「个性化菜单显隐」：账号级（跨设备）保存用户自己关掉的菜单叶子路径。
 * 只存被关掉的叶子；某分组的叶子全部被关掉时，该分组在渲染时自然消失（无需存一级开关）。
 */
export const navHiddenMenusSchema = z.object({
  paths: z.array(z.string().max(2000)).max(200),
});
export type NavHiddenMenus = z.infer<typeof navHiddenMenusSchema>;

export const uiPreferencesEndpoints = {
  UiPrefs_get: {
    method: "get" as const,
    path: "/enterprise/ui-preferences/:key",
    params: z.object({ key: z.string().min(1).max(64) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(uiPreferenceSchema),
  },
  UiPrefs_save: {
    method: "put" as const,
    path: "/enterprise/ui-preferences/:key",
    params: z.object({ key: z.string().min(1).max(64) }),
    query: emptyQuery,
    body: z.object({ value: z.unknown() }),
    response: envelope(uiPreferenceSchema),
  },
};
