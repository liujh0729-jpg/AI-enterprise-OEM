# 后端（Hono + Prisma）演示镜像：安装依赖 → 生成 Prisma Client → tsx 启动
# 生产请改用 `pnpm build` 产物 + 独立迁移流程。
FROM node:24-slim AS base
ENV NODE_ENV=development
WORKDIR /app
RUN corepack enable
# 依赖清单（利用层缓存）
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY backend/package.json ./backend/
COPY packages/contracts/package.json ./packages/contracts/
# 安装（backend 的 postinstall 会执行 prisma generate）
RUN pnpm install --no-frozen-lockfile
# 源码
COPY packages ./packages
COPY backend ./backend
# 构建共享契约包（前端/后端运行时依赖其 dist）
RUN pnpm --filter @enterprise/contracts build
EXPOSE 1690
CMD ["pnpm", "--filter", "aiworkin-enterprise-api", "start"]
