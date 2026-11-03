"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { platformApi, type SiteConfig } from "@/api/platform";
import { currentSiteOrigin, normalizeSiteUrl } from "@/lib/site-url";

const EMPTY: SiteConfig = {
  siteName: "",
  siteLogo: "",
  siteDesc: "",
  icpRecord: "",
  footerLinks: [],
  businessMenuHidden: [],
  integrationMenuHidden: [],
  aiServicesHidden: false,
};
const SiteBrandContext = createContext<SiteConfig>(EMPTY);

/** 读取站点配置（名称 / logo / 简介 / ICP / 页脚链接）。 */
export function useSiteBrand(): SiteConfig {
  return useContext(SiteBrandContext);
}

/**
 * 本站对外地址（origin）：后台「站点域名」配了就用它，没配就用当前访问域名。
 * 首帧（SSR 与水合）一律给空串，挂载后再填值，免得服务器渲染的地址与浏览器不一致报错；
 * 展示处自己拿 `SITE_BASE_PLACEHOLDER` 兜底，拼接处拿到空串就当相对路径用。
 */
export function useSiteBase(): string {
  const { siteUrl } = useSiteBrand();
  const configured = normalizeSiteUrl(siteUrl);
  const [base, setBase] = useState("");
  useEffect(() => setBase(configured || currentSiteOrigin()), [configured]);
  return base;
}

/**
 * 站点品牌装配：进本站先拉一次 /api/site-config，用后台配置的站点名即时改写浏览器标题，
 * 并把配置通过 Context 透出给 logo / 页脚备案等消费点（设计 §7「前端 SSR 读取、即时生效」）。
 */
export function SiteBrandProvider({ children }: { children: ReactNode }) {
  const [site, setSite] = useState<SiteConfig>(EMPTY);
  useEffect(() => {
    const controller = new AbortController();
    platformApi
      .siteConfig({ signal: controller.signal })
      .then((config) => {
        if (controller.signal.aborted) return;
        setSite(config);
        if (config.siteName) document.title = config.siteName;
      })
      .catch(() => {
        /* 站点配置拉取失败回落到内置默认，不影响使用 */
      });
    return () => controller.abort();
  }, []);
  return <SiteBrandContext.Provider value={site}>{children}</SiteBrandContext.Provider>;
}
