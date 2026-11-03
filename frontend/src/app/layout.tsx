import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { PRODUCT_LOGO_SRC, PRODUCT_NAME } from "@/lib/brand";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: PRODUCT_NAME,
    template: `%s | ${PRODUCT_NAME}`,
  },
  description:
    "AIworkin Enterprise 企业服务工作台：签约、财税、出海、物流、法律、知产、灵活用工、营销。",
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
    <html lang="zh-CN">
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
