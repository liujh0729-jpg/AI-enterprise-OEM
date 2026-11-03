import path from "node:path";
import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:1690";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // 关闭开发环境的 Next.js 指示器（左下角那个 N 浮层）
  devIndicators: false,
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  // 本机开发没有 Nginx 时，让 Next 自己把同源 /api/* 透传给 Hono 后端。
  // 生产由 Nginx 先把 /api/* 交给 Hono，Next 收不到这些请求，故此处仅在非生产生效。
  async rewrites() {
    // 活码落地页 `/s/:code` 始终转发给后端（客户 CDN 只改回源 Host，不需要配 URL 改写）
    const livecode = [
      { source: "/s/:code", destination: `${backendUrl}/api/public/lk/s/:code` },
    ];
    if (process.env.NODE_ENV === "production") return livecode;
    return [
      ...livecode,
      { source: "/api/:path*", destination: `${backendUrl}/api/:path*` },
    ];
  },
  // 平台管理后台入口落到侧栏菜单的第一个板块（板块清单见 src/config/routes.ts 的 ADMIN_SECTIONS）
  async redirects() {
    return [
      { source: "/admin", destination: "/admin/overview", permanent: false },
      // AIPDD Key 绑定已并入「开放集成 → API Key 管理」，旧地址重定向避免站内收藏/历史链接失效
      {
        source: "/developer/aipdd",
        destination: "/developer/keys",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
