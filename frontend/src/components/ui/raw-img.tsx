import type { ImgHTMLAttributes } from "react";

/**
 * 原生 <img>。
 *
 * 用于 next/image 覆盖不到的场景：OSS 签名直链 / 外部站图标 / 本地 data URL，
 * 这些地址的域名随租户或来源变化，无法在 next.config 里固定 remotePatterns，
 * 也不需要走图片优化。集中到这里，避免在每个调用点散落 no-img-element 抑制。
 */
export function RawImg({ alt = "", ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  // eslint-disable-next-line @next/next/no-img-element -- 域名不固定的 OSS/外部直链与 data URL，不走 next/image
  return <img alt={alt} {...props} />;
}
