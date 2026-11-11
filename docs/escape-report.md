# 类型逃逸盘点报告

- 生成工具：`scripts/escape-audit.mjs` v2（commit `84d68d7`，2026-11-11）
- 候选文件 2202（已跟踪 + 未跟踪，去重），纳入扫描 1674，其中尚未 git add 的 209
- 排除：依赖/构建/生成目录内 0 / 量具自身 2 / 索引有磁盘无 2
- 代码行 607,430（其中生产 544,410）
- 逃逸总数 **6**，其中生产代码 **4**，已登记 allowlist 6，未登记 0
- 生产密度 **0.01 处/kloc**（口径：仅 role=prod 的命中 ÷ 生产代码千行）
- 预算文件：`.escape-budget.json`（total=6）

> 计数为「文本命中」，注释与字符串中的同名字样也会计入；.vue 仅统计 `<script>` 段。

## 索引与磁盘不一致（未扫）

以下 2 个文件在 git 索引里、磁盘上不存在（未提交的删除）。盘点对象是工作树，故不纳入统计；计数有效，但 git 状态待收口：

- `extensions/aipdd-enterprise/popup.js`
- `frontend/src/app/social/_components/listing-tab.tsx`

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
| frontend | 647 | 210.8 | 210.2 | 4 | 3 | 0.01 |
| backend | 863 | 310.1 | 278.5 | 2 | 1 | 0 |
| extensions | 11 | 7.4 | 0.0 | 0 | 0 | 0 |
| hardware-devkit | 1 | 0.1 | 0.0 | 0 | 0 | 0 |
| packages/contracts | 62 | 55.7 | 55.7 | 0 | 0 | 0 |
| scripts | 90 | 23.4 | 0.0 | 0 | 0 | 0 |

## 按角色

| 角色 | 文件 | 行数 | 命中 |
| --- | ---: | ---: | ---: |
| prod | 1395 | 544410 | 4 |
| test | 158 | 29799 | 0 |
| script | 121 | 33221 | 2 |

## Top 6 文件

| 文件 | 角色 | 行数 | 命中 | 明细 |
| --- | --- | ---: | ---: | --- |
| `backend/src/http/automation-routes.ts` | prod | 2016 | 1 | as unknown as×1 |
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
