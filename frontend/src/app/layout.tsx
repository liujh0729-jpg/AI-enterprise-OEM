import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { PRODUCT_LOGO_SRC, PRODUCT_NAME, POWERED_BY, TITLE_SUFFIX } from "@/lib/brand";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    // Next 的 template 不作用于同一段的 default：首页（大部分页面没有自己的标题）这里显式接上同一后缀
    default: `${PRODUCT_NAME} ${TITLE_SUFFIX}`,
    // 有自己标题的页面：后缀跟在标题变量后面
    template: `%s ${TITLE_SUFFIX}`,
  },
  description:
    `AIworkin Enterprise 企业服务工作台：签约、财税、出海、物流、法律、知产、灵活用工、营销。${POWERED_BY}`,
  icons: {
    icon: { url: PRODUCT_LOGO_SRC, type: "image/png" },
    apple: PRODUCT_LOGO_SRC,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <div id="enterprise-root">
          <Providers>
            <AppShell>{children}</AppShell>
          </Providers>
        </div>
      </body>
    </html>
  );
}
