import arEG from "antd/locale/ar_EG";
import enUS from "antd/locale/en_US";
import esES from "antd/locale/es_ES";
import frFR from "antd/locale/fr_FR";
import jaJP from "antd/locale/ja_JP";
import ruRU from "antd/locale/ru_RU";
import viVN from "antd/locale/vi_VN";
import zhCN from "antd/locale/zh_CN";
import type { Locale } from "antd/es/locale";

/**
 * 系统支持的界面语言清单（与后端 SUPPORTED_LANGUAGES 白名单一一对应）：
 * label 用各语言母语自称（语言切换器里对所有人都能认出），
 * antdLocale 让 Antd 组件内置文案（分页/表格/空态等）跟随，
 * dir 支持阿拉伯语整站 RTL 排版。
 */
export const LANGUAGES = [
  { code: "zh-CN", label: "简体中文", antdLocale: zhCN, dir: "ltr" },
  { code: "en", label: "English", antdLocale: enUS, dir: "ltr" },
  { code: "vi", label: "Tiếng Việt", antdLocale: viVN, dir: "ltr" },
  { code: "ja", label: "日本語", antdLocale: jaJP, dir: "ltr" },
  { code: "ar", label: "العربية", antdLocale: arEG, dir: "rtl" },
  { code: "fr", label: "Français", antdLocale: frFR, dir: "ltr" },
  { code: "es", label: "Español", antdLocale: esES, dir: "ltr" },
  { code: "ru", label: "Русский", antdLocale: ruRU, dir: "ltr" },
] as const;

export type Lang = (typeof LANGUAGES)[number]["code"];

/** 任意字符串是否为受支持的语言码（接口/存储回来的值先过这道闸）。 */
export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && LANGUAGES.some((l) => l.code === value);
}

/** 按语言码取注册表条目（isLang 保证不会未命中，除非清单被改动）。 */
export function languageOf(code: Lang): (typeof LANGUAGES)[number] {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

export type { Locale };
