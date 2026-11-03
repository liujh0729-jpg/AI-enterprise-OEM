#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' '此一次性发布脚本已归档：原脚本固定历史版本并曾指向 ae_test，禁止复用。' >&2
printf '%s\n' '生产仅使用 ae_prod.public。先运行 runtime/production-guards/production-database.mjs check，再按 docs/deployment.md 备份和迁移。' >&2
printf '%s\n' '此入口不会构建、迁移、修改 current 链接或重启服务。' >&2
exit 1
