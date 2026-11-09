# 类型逃逸盘点报告

- 生成工具：`scripts/escape-audit.mjs` v2（commit `5e152c3`，2026-11-09）
- 候选文件 1929（已跟踪 + 未跟踪，去重），纳入扫描 1467，其中尚未 git add 的 501
- 排除：依赖/构建/生成目录内 0 / 量具自身 2 / 索引有磁盘无 3
- 代码行 526,748（其中生产 481,049）
- 逃逸总数 **6**，其中生产代码 **4**，已登记 allowlist 6，未登记 0
- 生产密度 **0.01 处/kloc**（口径：仅 role=prod 的命中 ÷ 生产代码千行）
- 预算文件：`.escape-budget.json`（total=6）

> 计数为「文本命中」，注释与字符串中的同名字样也会计入；.vue 仅统计 `<script>` 段。

## 索引与磁盘不一致（未扫）

以下 3 个文件在 git 索引里、磁盘上不存在（未提交的删除）。盘点对象是工作树，故不纳入统计；计数有效，但 git 状态待收口：

- `backend/src/platform/provider-display.service.ts`
- `frontend/src/app/admin/_components/providers-display-tab.tsx`
- `frontend/src/app/agent/_components/memory-tab.tsx`

## 分类计数

| 类别 | 合计 | 生产 | 测试 | 脚本 | .d.ts |
| --- | ---: | ---: | ---: | ---: | ---: |
| `as never` | 0 | 0 | 0 | 0 | 0 |
| `as any` | 0 | 0 | 0 | 0 | 0 |
| `as unknown as` | 3 | 1 | 0 | 2 | 0 |
| `@ts-ignore` | 0 | 0 | 0 | 0 | 0 |
| `@ts-expect-error` | 0 | 0 | 0 | 0 | 0 |
| `eslint-disable` | 3 | 3 | 0 | 0 | 0 |
| `: any` | 0 | 0 | 0 | 0 | 0 |
| `@ts-nocheck` | 0 | 0 | 0 | 0 | 0 |
| **合计** | **6** | **4** | 0 | 2 | 0 |

## 按落点（密度只算生产代码）

| 模块 | 文件 | kloc | 生产 kloc | 合计 | 生产 | 密度 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frontend | 598 | 189.2 | 188.7 | 4 | 3 | 0.02 |
| backend | 721 | 261.8 | 241.9 | 2 | 1 | 0 |
| extensions | 7 | 2.9 | 0.0 | 0 | 0 | 0 |
| hardware-devkit | 1 | 0.1 | 0.0 | 0 | 0 | 0 |
| packages/contracts | 52 | 50.5 | 50.5 | 0 | 0 | 0 |
| scripts | 88 | 22.3 | 0.0 | 0 | 0 | 0 |

## 按角色

| 角色 | 文件 | 行数 | 命中 |
| --- | ---: | ---: | ---: |
| prod | 1244 | 481049 | 4 |
| test | 108 | 18083 | 0 |
| script | 115 | 27616 | 2 |

## Top 6 文件

| 文件 | 角色 | 行数 | 命中 | 明细 |
| --- | --- | ---: | ---: | --- |
| `backend/src/http/automation-routes.ts` | prod | 1818 | 1 | as unknown as×1 |
| `backend/test/doubles.ts` | script | 9 | 1 | as unknown as×1 |
| `frontend/src/app/agent/_components/chat-panel.tsx` | prod | 2408 | 1 | eslint-disable×1 |
| `frontend/src/components/ui/raw-img.tsx` | prod | 13 | 1 | eslint-disable×1 |
| `frontend/src/lib/session.tsx` | prod | 123 | 1 | eslint-disable×1 |
| `frontend/src/test/doubles.ts` | script | 9 | 1 | as unknown as×1 |

## eslint-disable 规则分布

| 规则 | 次数 |
| --- | ---: |
| `react-hooks/exhaustive-deps` | 2 |
| `@next/next/no-img-element` | 1 |

## allowlist

登记 6 条，命中 6 条，失效 0 条。
