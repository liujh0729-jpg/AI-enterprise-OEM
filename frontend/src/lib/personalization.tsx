"use client";

import type { ProLayoutProps } from "@ant-design/pro-components";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { navHiddenMenusSchema } from "@enterprise/contracts";
import { uiPreferencesApi } from "@/api/ui-preferences";
import { defaultSettings } from "@/config/default-settings";
import { useSession } from "@/lib/session";

/** 风格设置沿用历史口径：只存本机浏览器，不写账号（与菜单显隐不同）。 */
export const SETTINGS_STORAGE_KEY = "aiworkin-enterprise-pro-settings";
/** 账号级偏好键：用户自己关掉的侧栏菜单叶子路径（跨设备）。 */
const HIDDEN_MENUS_KEY = "nav.hiddenMenus";

export type PersonalizationValue = {
  /** 整体风格设置（ProLayout 的 settings）。 */
  settings: ProLayoutProps;
  updateSettings: (patch: Partial<ProLayoutProps>) => void;
  resetSettings: () => void;
  /** 用户自己关掉的菜单叶子路径；某分组叶子全被关掉时该分组在渲染时消失。 */
  hiddenMenuPaths: string[];
  /** 保存菜单显隐到账号级；乐观更新，失败自动回滚并返回 false。 */
  saveHiddenMenuPaths: (paths: string[]) => Promise<boolean>;
  menusSaving: boolean;
};

const PersonalizationContext = createContext<PersonalizationValue | null>(null);

export function usePersonalization(): PersonalizationValue {
  const value = useContext(PersonalizationContext);
  if (!value) {
    throw new Error(
      "usePersonalization must be used within PersonalizationProvider",
    );
  }
  return value;
}

/**
 * 「个性化设置」的共享状态：驾驶舱面板负责编辑，外壳（pro-layout）负责应用。
 * 挂在 Providers 里，外壳与其渲染的页面同处一个 Context。
 */
export function PersonalizationProvider({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const [settings, setSettings] = useState<ProLayoutProps>(defaultSettings);
  const [hiddenMenuPaths, setHiddenMenuPaths] = useState<string[]>([]);
  const [menusSaving, setMenusSaving] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return;
    try {
      setSettings({ ...defaultSettings, ...(JSON.parse(raw) as ProLayoutProps) });
    } catch {
      window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    document.body.classList.toggle("colorWeak", Boolean(settings.colorWeak));
  }, [settings.colorWeak]);

  const updateSettings = useCallback((patch: Partial<ProLayoutProps>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* 隐私模式禁存储：本次会话内仍然生效 */
      }
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(defaultSettings);
    try {
      window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
    } catch {
      /* 同上 */
    }
  }, []);

  useEffect(() => {
    if (!me?.userId) {
      setHiddenMenuPaths([]);
      return;
    }
    let alive = true;
    void uiPreferencesApi
      .get({ params: { key: HIDDEN_MENUS_KEY } })
      .then((data) => {
        if (!alive) return;
        const parsed = navHiddenMenusSchema.safeParse(data?.value);
        setHiddenMenuPaths(parsed.success ? parsed.data.paths : []);
      })
      // fail-open：拉取失败按「没有关过任何菜单」处理，菜单照常完整显示
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [me?.userId]);

  const saveHiddenMenuPaths = useCallback(
    async (paths: string[]) => {
      const previous = hiddenMenuPaths;
      setHiddenMenuPaths(paths);
      setMenusSaving(true);
      try {
        await uiPreferencesApi.save({
          params: { key: HIDDEN_MENUS_KEY },
          body: { value: { paths } },
        });
        return true;
      } catch {
        setHiddenMenuPaths(previous);
        return false;
      } finally {
        setMenusSaving(false);
      }
    },
    [hiddenMenuPaths],
  );

  const value = useMemo<PersonalizationValue>(
    () => ({
      settings,
      updateSettings,
      resetSettings,
      hiddenMenuPaths,
      saveHiddenMenuPaths,
      menusSaving,
    }),
    [
      settings,
      updateSettings,
      resetSettings,
      hiddenMenuPaths,
      saveHiddenMenuPaths,
      menusSaving,
    ],
  );

  return (
    <PersonalizationContext.Provider value={value}>
      {children}
    </PersonalizationContext.Provider>
  );
}
