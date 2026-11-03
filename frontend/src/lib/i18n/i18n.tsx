"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSiteBrand } from "@/lib/site-brand";
import { MESSAGES } from "./messages";
import { isLang, languageOf, type Lang, type Locale } from "./langs";

export { LANGUAGES, isLang, languageOf } from "./langs";
export type { Lang } from "./langs";

/** 访客手动选过语言后记在这里（跨会话保留）；未选过则跟随管理员设置的站点默认语言。 */
const STORAGE_KEY = "app-lang";

type I18nValue = {
  /** 当前生效语言码。 */
  lang: Lang;
  /** 当前语言的排版方向（ar 为 rtl）。 */
  dir: "ltr" | "rtl";
  /** 当前语言对应的 Antd 组件内置文案包。 */
  antdLocale: Locale;
  /** 切换语言：写入 localStorage 并对后续渲染生效；未登录/已登录都可用。 */
  setLang: (code: string) => void;
  /** 按原文（简体中文）取译文；字典未命中回落原文本身——增量翻译不炸页面。 */
  t: (text: string) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

function readStoredLang(): Lang | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value && isLang(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * 多语言装配（挂在 SiteBrandProvider 之下、ConfigProvider 之上）：
 * 语言优先级 = 访客手动选择（localStorage） > 管理员站点默认语言（/api/site-config） > zh-CN；
 * 同步维护 <html lang/dir>，并把 locale 交给 ConfigProvider 让 Antd 内置文案一起切换。
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const site = useSiteBrand();
  // 首帧固定 zh-CN 保证 SSR/水合一致，存储值与站点默认在 effect / site 拉取后纠正。
  const [chosen, setChosen] = useState<Lang | null>(null);
  useEffect(() => setChosen(readStoredLang()), []);

  const siteDefault: Lang = isLang(site.defaultLanguage)
    ? site.defaultLanguage
    : "zh-CN";
  const lang = chosen ?? siteDefault;
  const meta = languageOf(lang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = meta.dir;
  }, [lang, meta.dir]);

  const setLang = useCallback((code: string) => {
    if (!isLang(code)) return;
    setChosen(code);
    try {
      window.localStorage.setItem(STORAGE_KEY, code);
    } catch {
      /* 隐私模式禁存储：本次会话内切换仍然生效。 */
    }
  }, []);

  const t = useCallback(
    (text: string) => MESSAGES[lang]?.[text] ?? text,
    [lang],
  );

  const value = useMemo<I18nValue>(
    () => ({ lang, dir: meta.dir, antdLocale: meta.antdLocale, setLang, t }),
    [lang, meta.dir, meta.antdLocale, setLang, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used within I18nProvider");
  return value;
}
