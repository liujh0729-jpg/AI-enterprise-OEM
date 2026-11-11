# AI 编程（平台后台自助改码）设计方案

> 状态：**已实施**（2026-11-11 成文并落地：契约 `packages/contracts/src/ai-code.ts`、后端 `backend/src/ai-code/*`、迁移 `backend/prisma/migrations/0088_ai_code/`、执行器 `scripts/upgrade-runner.mjs` 的 `CODE_EDIT` 模式、前端 `/admin/ai-code`）。
> 入口：平台管理后台 → 系统与内容 → **AI 编程**（`/admin/ai-code`），紧跟「平台升级」。
> 一句话：管理员选好模型后，用「对话 + 上传参考图 / 文件」让模型改写本系统自身源码，先产出**可审阅的差异**，再由既有「平台升级」执行器完成 **强制备份 → 构建 → 迁移 → 重启 → 健康检查**，任何一步都能**一键还原**（数据库 + 程序）。

## 一、背景与目标

平台已有成熟的「平台升级与一键还原」（`docs/平台升级设计方案.md`，代码在 `backend/src/upgrade/*` + `scripts/upgrade-runner.mjs`）：取包 → Agent 分析 → 强制备份 → 独立 runner 执行（维护模式 / 停服 / 备份 / 覆盖 / 装依赖 / 构建 / 迁移 / 重启 / 健康检查）→ 失败自动回滚 → 备份台账一键还原。

本功能不另造一套部署链，只在同一条链上**换一个「要应用的东西」**：原来应用的是「升级包里的整棵源码树」，现在应用的是「模型本轮改出来的文件集合」。这样风险、备份、维护模式、回滚、还原全部沿用既有机制，新增面只有「对话改码」与「差异审阅」。

目标：

1. 后台一个页面完成「选模型 → 对话改码 → 审阅差异 → 备份并执行 → 可一键还原」。
2. **绝不让模型直接写线上源码**：模型只写「暂存区」，产出差异，人审后才能落地。
3. 进入本功能必须**重复输入登录密码**，并以醒目方式告知「非常危险，建议线下优化好再部署」。
4. 执行前**强制备份数据库 + 程序**（沿用平台升级的双重强制校验）；备份台账与「一键还原」复用平台升级已有实现（同一处实现）。
5. 全程可审计：会话、工具调用、差异、任务步骤、备份与操作人全部落库。

## 二、已确认口径（来自需求）

1. 新增菜单「AI 编程」，属平台管理后台；管理员**先选模型**，再进入对话。
2. 交互形如 Qoder 的对话：对话框 + 上传参考图片 / 文件。
3. 进入要**二次输入密码**，并明确告知危险、建议线下优化后再部署，而不是直接在线上改、直接重启。
4. 用户须**提前备份**，且可选**「备份并一键还原」**（数据库备份 + 程序备份）。
5. 这是高风险方案：**先出方案，确认后再实施**。

## 三、关键设计决策

1. **暂存区 + 差异审阅（核心安全设计）**
   - 每个会话一份暂存目录 `update/ai-code/<sessionId>/`，模型的所有写操作只落在暂存区，并登记 `path → 新内容 / SHA / 变更类型(新增·修改·删除)` 清单。
   - 页面按文件展示 unified diff，支持**逐文件批准 / 拒绝**、**全部拒绝**。
   - 只有管理员点「备份并执行」后，独立 runner 才把批准的文件写入线上源码树。
2. **复用升级执行器**：在 `platform_upgrade_jobs` 上新增任务类型 `CODE_EDIT`，runner 新增 `code-edit` 模式——「覆盖代码」一步换成「应用编辑集」，其余步骤（维护模式、强制备份、装依赖、构建、迁移、重启、健康检查、自动回滚）原样复用。
3. **复用备份与还原**：沿用 `platform_backups` 台账与 `AdminUpgrade_restore`（`FULL` / `DATABASE`），AI 编程页只做入口聚合与「本次任务」过滤，不新建第二套备份/还原。
4. **复用 Agent 基建**：对话走既有 SSE 流式（`backend/src/http/automation-routes.ts` 中 agent 流式注册的写法）+ 工具循环（`backend/src/content/agent-engine.ts`），只是注入一套「代码工具」而非业务工具。
5. **模型来源**：复用「模型广场」目录 + 平台文本模型槽位（与升级分析同源，`backend/src/ai/ai-gateway.ts` 的 `resolveModel`）；只列**文本 / 视觉**能力模型，允许管理员在页面显式指定。
6. **两种产出**：①**生成补丁包**（下载，线下部署，零风险）；②**在线应用**（备份 + 构建 + 重启，高风险，需二次密码 + 手动确认文本）。默认走 ①，②需显式解锁。

## 四、总体流程

```
① 解锁进入            ② 选模型 + 对话改码                 ③ 审阅差异              ④ 备份并执行 / 导出补丁
输入登录密码        选模型 → 对话 / 上传参考图·文件      文件级 diff            强制备份（DB + 代码）
（危险告知横幅）    模型用「代码工具」读文件、出改动  → 逐文件批准 / 拒绝  →   维护模式 → 应用编辑集 → 装依赖
                   改动只落 update/ai-code/<id>/ 暂存区   （全部拒绝可）      → 构建 → 迁移 → 重启 → 健康检查
                                                                             失败自动回滚；随时「一键还原」
```

## 五、界面（`/admin/ai-code`）

沿用后台板块规范（`ADMIN_SECTIONS` 新增一项 + `frontend/src/app/admin/[section]/page.tsx` 分支），页面内用页签组织：

- **危险门（进入即拦）**：整页顶部固定红色告知条——「此功能会直接改写本系统运行中的源码并触发构建 / 重启，非常危险；**强烈建议在本地 / 线下环境优化并验证后再部署**，不要直接在生产上改、直接重启。」未通过密码复验前，页面只有这一条 + 密码输入框。
- **对话页签**：
  - 顶部：模型选择（下拉，来自模型广场文本 / 视觉模型）、当前工作区 / 版本 / 分支信息只读展示。
  - 中部：消息流（Markdown / 代码块高亮），支持粘贴与**上传参考图片 / 文件**（复用既有上传通道，产物以 `references` 落到消息上）。
  - 模型每条「打算改哪些文件」都以**文件卡片**列出；写操作实时反映到「变更」页签。
- **变更页签**：本次会话的暂存区差异——文件树 + 逐文件 diff（新增 / 修改 / 删除三种色标）、逐文件「采纳 / 弃用」、整体「全部弃用」；底部两个动作：
  - 「导出补丁包」（默认动作，下载 zip，线下部署）；
  - 「备份并执行」（高危，见下）。
- **执行页签**：复用平台升级的任务视图与步骤条（预检 → 备份 DB → 备份代码 → 应用编辑集 → 装依赖 → 构建 → 迁移 → 重启 → 健康检查），实时日志、取消、失败自动回滚提示。
- **备份与还原页签**：复用平台升级的备份台账 + 还原（FULL / DATABASE），只默认过滤「AI 编程产生的备份」，并给出「还原上次一键还原」快捷入口。

「备份并执行」的确认弹窗（三重闸）：

1. 列出将要落地的文件清单与影响面（是否含 `schema.prisma` / 迁移 / 依赖）。
2. 二次密码（登录密码，复用 `backend/src/common/confirm-password.ts` 的 `assertSensitivePassword`）。
3. 手动输入确认文本（如 `确认改码`），服务端校验。

## 六、代码工具（注入 Agent 引擎的工具集）

新增命名空间 `code__`，全部受工作区路径策略约束（根 = `installDir()`）：

| 工具 | 作用 | 落点 |
|---|---|---|
| `code__list_dir` | 列目录 | 只读 |
| `code__read_file` | 读文件（带行号、大小上限） | 只读 |
| `code__grep` | 正则检索（按 glob 过滤） | 只读 |
| `code__write_file` | 写文件（新建 / 覆盖） | 暂存区 |
| `code__apply_patch` | 按 unified diff 打补丁 | 暂存区 |
| `code__delete_file` | 删除文件（登记为删除变更） | 暂存区 |

路径策略（读也收敛，写从严）：

- 允许：`backend/src/**`、`frontend/src/**`、`packages/contracts/src/**`、`backend/prisma/**`、`docs/**`（是否放开 `infra/**`、`scripts/**`、`extensions/**` 见「待确认」）。
- 拒绝：`.env*`、`**/node_modules/**`、`.git/**`、`update/**`、`.next/**`、`dist/**`、任何符号链接逃逸、绝对路径与 `..` 穿越。
- 大小上限：单文件写入 / 读取上限（如 1MB），会话累计变更文件数与字节数上限。
- **模型不得执行任意命令**：所有命令（构建、迁移、重启）只由 runner 以参数数组执行，模型无 shell 能力。

## 七、编译与重启（本系统的特殊性）

线上/开发两种形态由既有 runner 自动识别（`backend/src/upgrade/upgrade.config.ts` 的 `deploymentMode()`）：

- **应用编辑集**：只覆盖被批准的文件（增量），删除变更按清单删除；排除 `.env*`、`node_modules`、`.git`、`update`、`.next`、`dist`、日志。
- **装依赖**：仅当改动的文件含 `package.json` / `pnpm-lock.yaml` 时执行。
- **构建**：`packages/contracts` 先 build（契约变了必须先构建 dist，否则前端 typecheck 读旧契约），再 `aiworkin-enterprise-api` build，最后 `aiworkin-enterprise-web` build。
- **迁移**：改动含 `backend/prisma/**` 时跑 `prisma migrate deploy`（PostgreSQL 走派生 schema）。
- **重启**：`dev`（本机 `pnpm dev`，tsx watch 会自动重载）→ 由 runner 拉起 `scripts/dev.mjs`；`pm2` / `systemd` / `command` / `docker` 各自方式；Docker 不在容器内自我重启，页面给宿主机命令。
- **健康检查**：轮询 `UPGRADE_HEALTH_URL`（默认 `http://127.0.0.1:1690/health/ready`），超时判失败。
- **失败自动回滚**：按备份恢复代码 + 数据库并重启（沿用升级的自动回滚）。

## 八、数据模型

| 表 | 用途 | 新建 / 复用 |
|---|---|---|
| `platform_upgrade_jobs` | 新增字段 `sourceKind`（`UPGRADE`/`RESTORE`/`CODE_EDIT`）与 `sourceRefId`（会话 id） | 复用（+1 迁移） |
| `platform_upgrade_steps` / `platform_backups` | 步骤与备份台账 | 复用 |
| `ai_code_sessions` | 会话：操作人、标题、模型、状态、暂存目录、关联任务 | 新建 |
| `ai_code_messages` | 消息：role、content、`references`(Json)、`toolCalls`(Json)、状态 | 新建 |
| `ai_code_edits` | 变更：`path`、`changeType`、`oldSha`/`newSha`、`diff`、`status`(pending/approved/rejected/applied)、`appliedJobId` | 新建 |

迁移：新增一个 `backend/prisma/migrations/0xxx_ai_code/`；PostgreSQL schema 由 `scripts/gen-prisma-schema.mjs` 派生，统一 `migrate deploy`。

## 九、接口

契约（`packages/contracts/src/ai-code.ts`，全部 `requireAdmin`）：

| 操作 | 方法 / 路径 | 说明 |
|---|---|---|
| `AdminAiCode_overview` | GET `/enterprise/admin/ai-code/overview` | 工作区信息、解锁状态、活动任务、工具与磁盘状态 |
| `AdminAiCode_unlock` | POST `/enterprise/admin/ai-code/unlock` | 复验登录密码，发放短时解锁票据 |
| `AdminAiCode_models` | GET `/enterprise/admin/ai-code/models` | 可选模型（文本 / 视觉） |
| `AdminAiCode_sessions` | GET / POST `/enterprise/admin/ai-code/sessions` | 会话列表 / 新建 |
| `AdminAiCode_session` | GET `/enterprise/admin/ai-code/sessions/:id` | 会话详情（含消息） |
| `AdminAiCode_edits` | GET `/enterprise/admin/ai-code/sessions/:id/edits` | 暂存区变更（文件列表 + diff） |
| `AdminAiCode_revert` | POST `/enterprise/admin/ai-code/sessions/:id/revert` | 弃用某文件 / 全部 |
| `AdminAiCode_apply` | POST `/enterprise/admin/ai-code/apply` | 建 `CODE_EDIT` 任务并拉起 runner（需解锁票据 + 确认文本） |
| `AdminAiCode_export` | POST `/enterprise/admin/ai-code/sessions/:id/export` | 导出补丁 zip |
| 复用 | `AdminUpgrade_job` / `_logs` / `_cancel` / `_backups` / `_restore` / `_removeBackup` | 任务、日志、取消、备份、还原 |

非契约（手写注册，同一路由分组内）：

- `POST /enterprise/admin/ai-code/sessions/:id/messages` — SSE 流式（事件：`delta / tool_start / tool_progress / tool_end / notice / done / error`），沿用 agent 流式写法的 `streamSSE` + 心跳。
- `POST /enterprise/admin/ai-code/sessions/:id/upload` — 参考图 / 文件 multipart 上传（复用既有上传通道与存储）。

## 十、安全与可靠性

- **权限**：所有操作 `requireAdmin`；前端深链同样按身份收口。
- **解锁票据**：`unlock` 复验登录密码（限流）；票据短时有效（默认 15 分钟，内存态，绑定 userId），`apply`、写类工具、导出必须带票据。
- **确认文本**：`apply` 在服务端校验确认文本；契约层 `refine` + 服务层双校验。
- **强制备份**：数据库 + 代码**双重强制**（沿用升级的契约 `refine` + 服务层检查），备份前后校验 SHA-256 与权限 600。
- **路径与命令**：工具受白名单 / 黑名单约束；模型无 shell；runner 全部用参数数组，不拼 shell 字符串。
- **维护模式**：执行前落维护标记，非 GET/HEAD/OPTIONS 一律 503；白名单含本页、会话 / 身份 / 账号、健康检查，保证管理员仍能登录、看进度、取消。
- **自动回滚**：执行失败按建议回滚；任何时候可从备份台账一键还原。
- **单任务**：同一时间只允许一个 `CODE_EDIT` / 升级 / 还原任务，避免并发覆盖。
- **审计**：每次工具调用、每次采纳 / 弃用、每次 apply / 还原均写审计（操作人、会话、文件、结果）。
- **额度**：对话消耗按平台模型计费口径计入调用者积分（与内容创作同源），避免无上限消耗。
- **隔离测试**：网络访问统一走 `httpRequest` / `streamRequest`，继承隔离测试禁网策略。

## 十一、已知限制

1. 模型可能改错或引入漏洞：**必须人工审阅 diff**；方案默认「导出补丁线下部署」，在线应用为显式高风险选项。
2. 增量覆盖不等于整树替换：非本次编辑的旧文件不会动；删除只对清单内文件生效。
3. `dev` 模式下 tsx watch 会自动热重载，不受 runner 的停 / 启节奏控制；构建与迁移步骤对 dev 意义有限（主要用于线上形态）。
4. Docker 部署需在宿主机执行重启命令，容器内不自动重启。
5. 构建 / 迁移失败到回滚完成之间服务不可用（与平台升级同）。

## 十二、环境变量（均可选，新增项默认关）

| 变量 | 默认 | 说明 |
|---|---|---|
| `AI_CODE_ENABLED` | `false` | 总开关，未开启时页面只读并提示 |
| `AI_CODE_UNLOCK_TTL_MIN` | `15` | 解锁票据有效期（分钟） |
| `AI_CODE_MAX_FILES` | `200` | 单会话累计变更文件数上限 |
| `AI_CODE_MAX_FILE_BYTES` | `1048576` | 单文件读写上限 |
| `AI_CODE_ALLOW_APPLY` | `false` | 是否允许在线应用（否则只能导出补丁） |
| 复用 `UPGRADE_*` | — | 部署目录、重启模式、健康检查、备份等全部沿用 |

## 十三、验收

- 契约、后端、前端 `tsc --noEmit` 通过；新增文件 ESLint 通过（**不得** `as never` / `eslint-disable`，遵循 `docs/ub-mode`）。
- `pnpm api:docs` 重新生成 OpenAPI 且 `pnpm api:docs:check` 通过；`pnpm check:architecture` 通过。
- 本地 MySQL 已应用新迁移；PostgreSQL schema 可正常生成。
- 后台 `/admin/ai-code`：危险告知可见、密码复验生效、未解锁不能对话写文件、模型可选、上传可用、diff 可逐文件采纳 / 弃用。
- 「备份并执行」缺失 `mysqldump` / `tar` 时禁用并给安装指引；执行中写请求 503、可取消；构建失败能自动回滚。
- 备份台账与「一键还原」可还原到执行前状态（代码 + 数据库）。

## 十四、改动清单（文件级，确认后实施）

- 契约：`packages/contracts/src/ai-code.ts`（新增）、`src/index.ts` 导出、`src/upgrade.ts`（job 类型扩展）；`npm run build --prefix packages/contracts`。
- 后端：`backend/src/ai-code/*`（service / controller / routes / tools / staging）、`backend/src/upgrade/*`（新增 `CODE_EDIT` 类型与 runner 配置透传）、`backend/prisma/migrations/0xxx_ai_code/`、`backend/src/http/app.ts`（注册路由与服务）。
- 执行器：`scripts/upgrade-runner.mjs` 新增 `code-edit` 模式（应用编辑集步骤）。
- 前端：`frontend/src/config/routes.ts`（`ADMIN_SECTIONS` 增 `ai-code`，`group: "system"`，紧随 `upgrade`）、`frontend/src/app/admin/[section]/page.tsx`（分支）、`frontend/src/app/admin/_components/ai-code-tab.tsx`（新增）、`frontend/src/api/ai-code.ts`（新增）。
- 文档：本方案在实施后改为「已实施」，并更新 `README.md`。

## 十五、已确认口径（实施按此落地）

1. **默认产出**：默认「导出补丁包」线下部署；在线应用另需 `AI_CODE_ALLOW_APPLY`（默认开启，可关成只导出）。
2. **写目录范围**：白名单 `backend/src`、`frontend/src`、`packages/contracts/src`、`backend/prisma`、`docs`；不放开 `infra/**`、`scripts/**`、`extensions/**`、`hardware-devkit/**`。
3. **解锁粒度**：一次解锁 15 分钟（`AI_CODE_UNLOCK_TTL_MIN`），过期重新输密码；采纳 / 弃用、写文件、导出、应用都校验票据。
4. **模型来源**：模型广场目录里的文本 / 视觉模型，未指定时沿用平台文本模型槽位。
5. **备份保留**：沿用「不限期、手动清理」，与平台升级共用同一份备份台账。
6. **菜单位置**：平台管理后台「系统与内容」组，紧跟「平台升级」。

### 实施差异（相对初期草案）

- 任务类型：`platform_upgrade_jobs.source_kind = CODE_EDIT` + `source_ref_id = 会话 id`（`type` 同步为 `CODE_EDIT`），步骤集为 `preflight → backup_db → backup_code → maintenance → stop → apply → install → build → migrate → start → health → done`；「装依赖」与「迁移」按编辑集是否含 `package.json` / `backend/prisma/**` 条件跳过。
- 非契约路由：`POST /sessions/:id/messages`（SSE）、`POST /sessions/:id/upload`（multipart）、`GET /sessions/:id/uploads/:name`、`GET /exports/:name`（二进制下载）。
- 附件口径：图片（png/jpg/webp/gif，≤6MB）走视觉通道；文本类（ts/tsx/js/json/md/css/sql/yml/prisma 等，≤200KB）内联进本轮提示；单次最多 6 个。
- 失败回退：任务失败 / 回滚 / 取消 / 中断时，已标记 `applied` 的变更回退为 `approved`，便于修正后重试。
