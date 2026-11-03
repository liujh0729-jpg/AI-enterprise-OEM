# 前端（Next.js App Router）演示镜像：安装依赖 → 构建契约包 → next dev 启动
# 依赖 BACKEND_URL 把同源 /api/* 透传给后端（见 next.config.ts 的 rewrites）。
# 生产请 `pnpm --filter aiworkin-enterprise-web build` 后 `next start`，并由 Nginx 反代 /api/*。
FROM node:24-slim AS base
ENV NODE_ENV=development
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY frontend/package.json ./frontend/
COPY packages/contracts/package.json ./packages/contracts/
COPY backend/package.json ./backend/
RUN pnpm install --no-frozen-lockfile --filter aiworkin-enterprise-web...
COPY packages ./packages
COPY frontend ./frontend
RUN pnpm --filter @enterprise/contracts build
EXPOSE 15890
CMD ["pnpm", "--filter", "aiworkin-enterprise-web", "dev"]
