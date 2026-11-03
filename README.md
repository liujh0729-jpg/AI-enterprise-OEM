# OEM Enterprise · 开源企业服务工作台 + 商务社交

一个把 **企业服务工作台**（Hono + Prisma + MySQL + Next.js/Ant Design）与 **商务社交 SNS**
（关系 / 动态 / 小组 / 私信 / 简历 / 供求广场 / 招聘）合并移植的开源项目。用户在本地注册即可使用全部社交与
供求发布能力；需要面向上游市场（AIworkin）发布需求 / 服务、做企业档案与资格申请时，绑定一把
AIPDD APIKey 即可打通——**本系统不涉币、不托管上游账号、样式与交互全部本地重写**。

> 设计与迁移规格见 [`docs/开源版整体设计方案.md`](docs/开源版整体设计方案.md)。

---

## ✨ 能力概览

| 板块 | 内容 | 是否需要绑定 Key |
|---|---|---|
| 账户体系 | 本地注册 / 登录 / 找回 / 改密 / 换绑 / 注销、登录日志、平台级封禁、用户邀请码（注册选填，记录邀请关系） | 否 |
| 平台后台 | 站点设置（含站点域名、业务服务菜单逐项显隐与默认语言）、AIPDD 平台 Key（基础数据）、注册通道（用户名 / 邮箱 / 手机）、SMTP、阿里云短信、服务商展示与同步 | 部分（同步） |
| 多国语言 | 简体中文 · English · Tiếng Việt · 日本語 · العربية · Français · Español · Русский；管理员可设站点默认语言，访客随时切换（阿拉伯语整站 RTL） | 否 |
| 商务人脉 | 侧栏分组，下挂「商务社交」与「招聘」两个入口 | 否 |
| 商务社交 | 资料、好友 / 拉黑、动态信息流、豆瓣式小组（匿名发帖 / 楼层）、站内私信、职场简历（HTML 独立页，可在私信里投递，雇主点开即看并导出 PDF） | 否 |
| 供求广场 | 通用发布需求 / 服务，进本地信息流、可被浏览与私信对接 | 本地发布：否 |
| 招聘专区 | 发布岗位（全职 / 兼职 / 实习 / 临时 / 劳务派遣）进招聘广场，对接靠站内私信（可附 HTML 简历投递）；本系统不做 ATS 简历库与筛选 | 本地发布：否 |
| 服务商名录 | 业务服务各板块的资源库页签：列表浏览 → 详情 → 发起签约；某板块只有一家服务商时不展示列表，直接内嵌展示该服务商详情 | 否 |
| 上游联动 | 供求帖一键同步发布到 AIworkin、岗位同步为用工需求（类目固定取「灵活用工」子树）、企业档案、服务商资格申请、需求撮合与回复 | 是 |

**两段式发布**是本项目的核心口径：供求帖默认在本地「免 Key」发布；勾选「同步发布到 AIworkin」时，
经统一凭证解析器以用户绑定的 Key 调上游 `POST /market/listings`，并镜像回上游审核 / 撤回状态。

---

## 🧱 技术栈

- **后端**：[Hono 4](https://hono.dev) + `@hono/zod-openapi`、Prisma 5.22、MySQL 8、Zod 4
- **前端**：Next.js 16（App Router）+ React 19 + Ant Design 6 / Pro Components + `@tanstack/react-query` 5
- **运行时**：Node.js ≥ 24、pnpm ≥ 10（monorepo workspace）

## 📁 目录结构

```
oem-enterprise/
├── backend/            # Hono API（Prisma schema、迁移、各业务模块）
│   ├── prisma/         # schema.prisma + migrations/（MySQL，表前缀 sns_ 为社交板块）
│   └── src/
│       ├── account/    # 本地注册/登录/找回/改密/封禁 + AIPDD API Key 绑定
│       ├── platform/   # 站点设置、服务商展示与同步
│       ├── social/     # 社交板块（关系/动态/小组/私信/简历）+ 供求广场 listing + 招聘 hiring
│       ├── aiworkin/   # 上游通道：AiworkinClient / DemandService / 类目字典
│       └── http/       # app.ts 装配、services.ts 依赖容器、鉴权与错误处理
├── frontend/           # Next.js 应用（AntD 主题，/social 等页面）
├── packages/contracts/ # 前后端共享的接口契约与错误码
├── scripts/            # 冒烟测试（smoke-m*.ps1）与工程脚本
├── infra/              # nginx / 部署配置；docker-compose.yml 在根目录
└── docs/               # 开源版整体设计方案
```

---

## 🚀 快速开始（本地开发）

前置：Node ≥ 24、pnpm ≥ 10、一个可访问的 **MySQL 8 或 PostgreSQL** 实例（二选一）。

### 方式 A：一键安装（推荐，可选数据库）

```bash
pnpm install
pnpm setup            # 交互式：选 MySQL / PostgreSQL → 填连接信息 → 写 backend/.env → 生成客户端 → 建表
# 或非交互：pnpm setup --db postgres --host 127.0.0.1 --port 5432 --user app --password *** --database enterprise --yes
pnpm dev:api & pnpm dev:web
```

`pnpm setup` 会：① 写入 `backend/.env` 的 `DATABASE_URL` 与 `DB_PROVIDER`；② MySQL 走迁移历史 `prisma migrate deploy`，PostgreSQL 由 `schema.prisma` 派生 `schema.postgres.prisma` 后 `prisma db push`；③ 按所选方言生成 Prisma Client。

> Prisma 的 Client 与建表语句按方言生成：切换数据库后重新执行 `pnpm setup`（或 `pnpm --filter aiworkin-enterprise-api prisma:generate:pg`）即可。

### 方式 B：手动配置

```bash
# 1) 安装依赖（会触发 prisma generate）
pnpm install

# 2) 配置后端环境变量
cp backend/.env.example backend/.env
#   编辑 backend/.env：设置 DATABASE_URL（MySQL 或 PostgreSQL）、DB_PROVIDER、JWT_SECRET、EXTERNAL_CRED_KEY
#   （JWT_SECRET / EXTERNAL_CRED_KEY 为本地随机串，缺失时后端拒绝启动）

# 3) 配置前端环境变量
cp frontend/.env.example frontend/.env.local

# 4) 初始化数据库（迁移/db push + 生成客户端）
#   MySQL：
pnpm --filter aiworkin-enterprise-api prisma:migrate:deploy
pnpm --filter aiworkin-enterprise-api prisma:generate
#   PostgreSQL（改用派生 schema）：
pnpm --filter aiworkin-enterprise-api db:push:pg

# 4b)（可选）灌入演示数据：企业档案 / 服务商名录 / 律师·知产·灵工 / 供销营销等
#     仅用于名录与详情展示；演示身份不是可登录账号，登录后仍请用步骤 5 注册的本地账号。
pnpm --filter aiworkin-enterprise-api prisma:seed

# 5) 起后端（默认 1690）与前端（默认 15890）
pnpm dev:api
pnpm dev:web
```

浏览器打开 `http://127.0.0.1:15890`，注册一个本地账号即可进入社交与供求广场。
前端通过 Next.js 服务端把 `/api/backend/*` 代理到后端，浏览器侧保持同源。

### 关键环境变量

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | 数据库连接串：MySQL `mysql://user:pass@127.0.0.1:3306/enterprise` 或 PostgreSQL `postgresql://user:pass@127.0.0.1:5432/enterprise?schema=public` |
| `DB_PROVIDER` | `mysql` / `postgres`：原生 SQL 方言分支依据（单据号自增、JSON 列取值）；缺省时由 `DATABASE_URL` 协议推断 |
| `PORT` | 后端监听端口，默认 `1690` |
| `JWT_SECRET` / `JWT_ISSUER` | 本地会话签名密钥，生产必须替换为随机值 |
| `EXTERNAL_CRED_KEY` | AIPDD Key / 外报凭据的 AES-256-GCM 派生密钥，单独配置、不回退 JWT_SECRET |
| `AIPDD_PLATFORM_KEY` | 平台级 AIPDD APIKey 的部署兜底（基础数据通道）；后台「系统配置 → AIPDD 平台 Key」保存后以库内密文为准 |
| `AIWORKIN_BASE_URL` / `AIWORKIN_ENABLED` | 上游市场地址与开关（关闭后仅本地闭环可用） |
| `CORS_ORIGIN_PATTERNS` | 允许的跨域来源（逗号分隔） |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 首次启动种子出的平台管理员账号 |

> 所有密钥仅存本机 `.env`（已在 `.gitignore` 中），任何接口永不回显 AIPDD Key 原文。

### 数据库兼容性（MySQL / PostgreSQL）

系统安装时二选一，运行期以 `DB_PROVIDER`（缺省由 `DATABASE_URL` 协议推断）为准，业务在两种库上等价可跑。为抹平方言差异已做如下处理：

- **Schema 单一事实源**：以 `prisma/schema.prisma`（MySQL）为准，安装 PostgreSQL 时由 `scripts/gen-prisma-schema.mjs` 确定性派生 `schema.postgres.prisma`（`provider=postgresql`，`@db.TinyInt→@db.SmallInt`、`@db.DateTime→@db.Timestamp`）。MySQL 走迁移历史建表，PostgreSQL 走 `prisma db push`。
- **单据号自增**：`document-number.ts` 按方言分支——MySQL 用 `INSERT IGNORE`+`LAST_INSERT_ID`，PostgreSQL 用 `ON CONFLICT DO NOTHING`+`UPDATE … RETURNING`。
- **JSON 列取值**：`common/sql-json.ts` 的 `jsonText()` 按方言生成 `->>` 路径（PostgreSQL `col->>'key'` / MySQL `col->>'$.key'`），供大数据取数、线索挖掘的跨任务去重查询使用。
- **BI 问数/图表**：`bi/bi.internal.ts` 的 `internalScope()` 按方言下发占位符（PostgreSQL `$1`/`ANY($2::text[])` / MySQL `?`）；`bi.query.service.ts` 的图表标识符引用按目标库选择（应用库或外部数据源的 PG双引号/MYSQL反引号）。
- **客户端生成**：`postinstall` 走 `scripts/prisma-generate-auto.mjs`，根据 `DB_PROVIDER`/`DATABASE_URL` 自动选默认或派生 schema 生成，避免重装依赖时 PG 客户端被 MySQL 版覆盖。
- **用户名大小写**：登录与唯一约束以**小写归一化**统一口径（MySQL 默认排序规则大小写不敏感、PostgreSQL 敏感），邮箱同样小写存储，保证两库登录/查重行为一致；改动前已存在的混合大小写账号在 MySQL 上仍可正常登录（CI 命中），存量库可执行 `pnpm --filter aiworkin-enterprise-api db:normalize-usernames` 一次性回填（幂等，双库通用，撞名会跳过并列表提示）。

> 已知差异：自由文本搜索（`contains` 关键字）在 MySQL 大小写不敏感、PostgreSQL 大小写敏感——Prisma 的 `mode:'insensitive'` 在 MySQL 连接器上不受支持，故不对全部搜索语句强行统一。中文等主内容不含大小写，不受影响；如需拉丁文搜索也保持一致，可在 PostgreSQL 侧以大小写不敏感的 ICU 排序规则建库，或对相应字段做小写归一化后检索。

---

## 🐳 Docker Compose（含 MySQL）

根目录 `docker-compose.yml` 编排 **MySQL + 后端 + 前端** 三个服务，适合一键体验：

```bash
# 全部服务依赖均自带本地演示默认值（${VAR:-default}），直接拉起即可：
docker compose up --build
# 需要自定义口令 / 域名时，在根目录新建 .env 覆盖 MYSQL_* / JWT_SECRET / EXTERNAL_CRED_KEY 等
# 后端 http://localhost:1690  前端 http://localhost:15890
```

首次启动后端会自动执行 `prisma migrate deploy` 建表。生产部署请替换 `JWT_SECRET` / `EXTERNAL_CRED_KEY`
为强随机值，并使用独立的数据库与反向代理（`infra/nginx/` 提供样例配置）。

---

## 🌐 站点域名（对外访问地址）

全站不写死本机地址：MCP / API 接入端点、IM 回调与卡片「去处理」链接、在线客服嵌入脚本、
活码入口、邀请链接、支付回调建议值等绝对地址，统一按下列优先级拼接：

1. 「平台管理后台 → 站点设置 → 站点域名」填写的值（只认 http/https，可带端口，存库即生效，无需重启）
2. 后端环境变量 `SITE_URL`
3. 访客当前访问地址（`window.location.origin`，单域名部署无需任何配置）

本机开发一项都不用填：开发态由 Next 反代 `/api/*`，生产态由 Nginx 先取 `/api/*`，
所以 `https://你的域名/api/v1/mcp` 这类端点在两种形态下都成立。
后台改完域名后，该域名会自动并入 CORS / 来源校验白名单；`SITE_URL` 变量本身改动仍需重启。

---

## 🔑 AIPDD API Key 绑定与上游通道

- 用户在「开放集成 → API Key 管理」页的「AIPDD API Key 绑定」板块绑定一把 AIPDD 平台签发的 API Key（sk-）；
  多用户可绑同一把 Key（N:1，按指纹归并），密文以 AES-256-GCM 落库。
  原独立页「AIPDD Key 绑定」（`/developer/aipdd`）已并入 API Key 管理，旧地址重定向到 `/developer/keys`。
  这两页（API Key 管理 / 模型设置）属账号级自助，**平台管理员身份下侧栏不展示**，要配请切到企业 / 个人身份（平台级 Key 在「系统配置 → AIPDD 平台 Key」），直接访问链接仍可用。
- 同一板块承担注册引导：管理员在「站点设置」填入 AIPDD 推荐码后，新用户按引导去 www.aipdd.work 注册并填写该码
  可获赠算力（邀请佣金归管理员）；可用 env `AIPDD_REFERRAL_CODE` 设默认码、`AIPDD_REGISTER_URL` 覆盖注册地址（仅认 http/https）。
- `backend/src/common/upstream-token.ts` 是访问上游的 **唯一凭证入口**：业务代码不再把本地会话令牌当上游凭证，
  而是换成用户绑定的 Key；未绑定用户触发上游动作时得到引导性 `403`（本地发布不受影响）。
- **基础数据走平台 Key，不走用户 Key**：省市字典、平台字典项这类参照数据与用户身份无关，由管理员在
  「平台管理后台 → 系统配置 → AIPDD 平台 Key」统一配置一把平台 Key（同一套 `sk-` 格式校验与在线验真，
  AES-256-GCM 密文落 `system_settings.aipdd_platform_key`，只回掩码，优先级高于 env `AIPDD_PLATFORM_KEY`，
  且被通用系统参数接口读写隔离）。解析链：平台 Key → 本人绑定 Key → 都没有时地区回落本地内置省市字典
  （`backend/src/shared/region-dictionary.ts`，数据源 `GEO_CENTERS`），所以未配置平台 Key 也不会卡住表单，
  但平台字典项仍需 Key。
- 发布需求、同步上游、建联资源等 **用户动作仍使用各自绑定的 Key**，不受平台 Key 影响。
- `AIPDD_KEY_VERIFY=off` 时绑定不做在线验真（便于离线演示）；设为在线模式会调用上游核验。

---

## 🧪 冒烟测试

`scripts/` 下按里程碑提供闭环冒烟（PowerShell，纯 ASCII，随机用户名保证幂等）：

```powershell
pwsh scripts/smoke-m5.ps1   # 社交板块闭环（关系/动态/小组/私信/简历/封禁继承）
pwsh scripts/smoke-m6.ps1   # 供求广场：本地免 Key 发布 + 未绑 Key 同步上游 403
pwsh scripts/smoke-site-url.ps1            # 站点域名归一 / CORS / 公开回显 + 页面 200
pwsh scripts/smoke-aipdd-platform-key.ps1  # 平台 AIPDD Key：密文不外泄 + 地区字典兜底
```

---

## 🧹 相对上游商业版的裁剪

本开源版是「合并 + 脱敏 + 本地化」的产物，明确**不包含**：

- SNS 原版 NestJS 后端与 aiworkin.com 蓝白视觉（信息架构保留，样式全部重写为 AntD）；
- awcoin 奖励 / 结算等涉币业务（供求广场只镜像上游状态，不涉币）；
- 平台代查 / 代申 `sk-` Key、`DEV_AUTO_LOGIN` 就地签发等机制（演示数据随 `prisma:seed` 提供，
  但演示身份不可一键登录，须正常本地注册）；
- 上游 Java 目录服务：数据源改为本地 `users` 表。

---

## 📄 License

Released under the [Apache License 2.0](LICENSE).
