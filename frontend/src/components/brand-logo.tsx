import Image from "next/image";
import { PRODUCT_LOGO_SRC } from "@/lib/brand";
import styles from "./brand-logo.module.css";

type BrandLogoProps = {
  size?: number;
  className?: string;
  priority?: boolean;
  /** 后台「站点设置」配置的 Logo；缺省用内置品牌图标。 */
  src?: string;
};

export function BrandLogo({ size = 32, className, priority = false, src }: BrandLogoProps) {
  return (
    <Image
      src={src || PRODUCT_LOGO_SRC}
      alt="AIPDD"
      width={size}
      height={size}
      priority={priority}
      unoptimized
      className={[styles.logo, className].filter(Boolean).join(" ")}
    />
  );
}
