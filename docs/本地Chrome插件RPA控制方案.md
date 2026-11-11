# 本地 Chrome 插件 RPA 控制方案（插件登录 + 云端 Agent 互动闭环）

> 状态：**已实现**（2026-11-11 起草并落地；迁移号顺延为 0072-0076、0079，服务 `backend/src/rpa/chrome-*.ts`）。
> 与《日卡与30天卡兑换码设计方案》互不依赖；迁移号已错开（日卡占 0067/0068/0078）。
> 实施载体是**既有单插件** `extensions/aipdd-enterprise`（v1.3.0 → v1.4.0），不新建第二个扩展。

---

## 一、需求拆解（你的 7 条 → 目标态）

| # | 你的原话 | 目标态 |
|---|---|---|
| 0 | 插件要支持登录：界面显示 `https://`，用户只填域名后面的内容，再填用户名/密码就能登录 | 插件弹窗顶部一个固定 `https://` 前缀输入框（前缀不可编辑，只填 `xxx.com` 或 `xxx.com/api/backend`）+ 用户名 + 密码 + 「登录」；登录对象是**本系统的云上账号**（不是目标平台），成功后插件拿到长期设备令牌并把 `clientId` 注册为该账号名下的一个「本地 Chrome 设备」 |
| 1 | 插件打开 → background 启动，携带 `clientId` 连上云上账号，显示在线 | 安装/首次登录时生成一次性 `clientId` 并永久保存；后台每 30 秒心跳（复用硬件模块「心跳顺带下发待办指令」的范式），服务端把设备置 `ONLINE`；超时未心跳自动 `OFFLINE` |
| 2 | 云上后台新建任务并绑定这个 `clientId` | RPA 页新增「本地 Chrome」页签：设备列表（在线灯、版本、最近心跳）+ 新建任务时可选「执行设备＝本地 Chrome」并**指定具体 clientId**（不给「随便哪台」的模糊口径） |
| 3 | 云上 Agent 下发指令 → 任务推送到插件 | 云端会话/任务把动作写入指令队列，随插件的下一次拉取投递（有 SSE 长连时秒级、没有时 ≤30 秒）；插件不主动猜任务，只领自己 `clientId` 名下的指令 |
| 4 | 插件收到指令 → 转发给 content_script 在网页执行 | background 用 `chrome.tabs.sendMessage` 把动作投递给目标标签页的 content_script；**改为动态注入**（现有 content_scripts 是按平台 URL 静态匹配的，任意网页根本没有脚本可收） |
| 5 | content_script 执行完：读 DOM / 截图 → 回传 background → 回传云上 | 每个动作统一返回 `{ok, data, screenshotKey?, pageMap?, errorMessage}`；截图走 OSS（`StorageService.put`）只回 URL，DOM 回「页面元素地图 + 可见文本摘要」，不回整页 HTML |
| 6 | 云上拿到页面结果交给 LLM 思考下一步，循环 | 一个 `ChromeRpaSession` 会话 = 目标 + 逐步记录；每步把「上一步观测」喂 `aiChat` / `aiJson`，产出下一个动作；带最大步数、单步超时、连续失败停止、敏感动作人工确认 |
| 7 | 连接好了 Tab 下状态变绿，否则红色；变绿后 Agent 才能调用插件 | 两处灯：**顶栏 Chrome 插件入口**（现在只有「版本过时」橙点）加绿/红状态点；**RPA →「本地 Chrome」页签**每个设备一行绿/红。离线时 Agent 工具直接返回「设备不在线」并**不渲染可选入口**（不给能点但必然失败的按钮） |

---

## 二、现状盘点：可直接复用的地基（结论：任务/执行/设备通道/LLM 都已有同类实现，缺的是「Chrome 这一类设备 + 页面动作协议 + LLM 循环」）

| 能力 | 位置（已核对） | 复用方式 |
|---|---|---|
| RPA 四件套数据模型 | `backend/prisma/schema.prisma:1872-2031`（`RpaScript` / `RpaAccount` / `RpaTask` / `RpaTaskExecution`，另有 `RpaSetting`/`RpaLlmSetting`）；建表在 `migrations/0001_init/migration.sql:1631-1747` | **不新建任务体系**：Chrome 任务仍是 `RpaTask`，执行记录仍是 `RpaTaskExecution`（`executor='chrome:<clientId>'`） |
| 设备类型词表 | `backend/src/rpa/rpa-shared.ts:6` `DEVICE_TYPES = ['pc','android','iphone']`、`:10` 中文标签、`:16-24` 别名归一 | 追加 `'chrome'` → 标签「本地 Chrome 插件」，别名收 `chrome/插件/本地浏览器/local` |
| 机器通道（执行端领任务） | 契约 `packages/contracts/src/automation.ts:2552-2641`：`POST /api/v1/rpa/executions/claim`（`:2626`）、`POST /api/v1/rpa/executions/:id/finish`（`:2634`）；处理器 `backend/src/http/automation-routes.ts:345-367`；`claim` 入参 `{executor?, taskId?, deviceType?}`（`rpa-task.service.ts:564-566`），`tryGrab` 原子抢单 `:806-812`，`buildDispatch` `:837-951`，超时回收 `sweepTimeouts` `:957-990`，回传 `{status,errorMessage,output,logText}` `:656-676`，`sanitizeErrorMessage` `:43-52` | Chrome 通道**沿用同一套抢单/超时/回传语义**，只是传输从「一次性 claim」换成「心跳顺带下发 + 指令级回执」（见第三节） |
| 机器通道鉴权 | `x-api-key` 或 `Bearer ek_…` → `sha256` 比对 `ApiKey.keyHash`（`backend/src/auth/auth.service.ts:50-80`）；Key 生成 `ek_${randomBytes(24).hex}`（`identity.service.ts:2460-2464,2498-2502`）；`ApiKey` 模型 `schema.prisma:202-228` | **插件不走 ek_ Key**（那是用户手工配置的凭据，不能由插件自持）；插件用登录换来的**设备令牌**，见 D2/第四节 |
| 心跳 + 指令队列范式（硬件模块，同构可抄） | `backend/src/hardware/hardware.public.ts:70-84` 三个公开端点（`heartbeat` / `commands` / `result`）+ `:37` `x-device-token: hw_…`；`hardware.service.ts:1169-1207` 心跳刷新 ONLINE/lastSeenAt 并**顺带下发待办**、`:1216-1244` 队列「已下发→已投递」、`:1247-1269` 按 `commandCode` 配回执；令牌 sha256 存（`hardware.helpers.ts:57-73`、`HwDevice.tokenHash` `schema.prisma:11459`） | Chrome 通道**照抄这套队列语义**：唯一 `commandCode` 匹配回执，不靠「第几条」对号 |
| 插件↔云端现状（获客桥，另一套范式） | 契约 `packages/contracts/src/acquisition.ts:1063-1084`（`plugin/token|pull|report`）；令牌 5 分钟随机 hex、只存 sha256（`schema.prisma:9723-9739`，`plugin-bridge.service.ts:75-127` 签发、`:197-240` 每次复权校验、`:59-63` 拉取 60 次/分频控）；插件侧 15 秒空轮询（`acquisition.js:8` `IDLE_POLL_MS`、`:437-474` 轮询循环、`:112-125` 令牌在请求体里） | 「网页签发短时令牌」适合**页面驱动**的场景；RPA 是**设备常驻**，必须换成登录换长期设备令牌（否则用户每 5 分钟要回网页点一次） |
| 长连接先例 | 全站无 WebSocket；SSE 已有三处：工作流运行流 `automation-routes.ts:1449-1481`（`streamSSE` + 10 秒心跳）、服务台 `service-desk.public.ts:276-304`（进程内总线 + 轮询兜底）、模型广场中转 `model-plaza.public.ts:77` | 若走 SSE，直接复用 `streamSSE` 写法；但 MV3 Service Worker 生命周期是硬约束（见 D1） |
| LLM 决策 | `backend/src/ai/ai-gateway.ts:352-372` `aiChat(prisma, input)`（模型在 `requireModel` 内按平台绑定挑选并 `meter()` 计量）、`:375-384` `tryChat`（静默变体）、`:387-403` `parseJsonObject`、`:415+` `aiJson`；RPA 已有先例 `rpa-llm.service.ts:7` 用 `aiChat` 写脚本 | 循环里取动作一律走 `aiJson`/`parseJsonObject`，**不自建 HTTP 调用**；LLM 成本经 `meter()` 自然进积分 |
| Agent 工具注册 | `backend/src/content/agent-business-tools.ts:60-104`（`BUSINESS_TOOLS`：OpenAI function `spec` + `operationId` + `write/callable/billing`）、`agent-tool-manifest.ts:14-33` 工具种类与 `:144-205` 构建；MCP 目录由契约 `endpoints` 自动派生（`backend/src/mcp/mcp-catalog.ts:1-33`）；硬件写闸范式 `hardware.service.ts:370-377,431`（grant / unattended / dryRun） | 新增契约端点即自动进 MCP；站内 Agent 再加 6-8 个 `BUSINESS_TOOLS` 动作；「互动控制」按硬件的 grant/unattended 口径设确认闸 |
| 插件工程现状 | `extensions/aipdd-enterprise/manifest.json`：MV3、`version 1.3.0`（`:4`）、permissions `["tabs","storage"]` + `host_permissions ["<all_urls>"]`（`:6-7`）、content_scripts **静态**匹配平台 URL（`:16-81`）；`background.js:7` `importScripts("acquisition.js","outreach.js")`；`bridge.js:36-51` `postMessage` ping/pong 握手带版本号；`background.js` `pendingReceipts` 本地队列（上限 200 / TTL 3 天）；**全仓无 `chrome.alarms`、无 `chrome.scripting`、无 WebSocket** | 必须新增：`alarms`、`scripting`（动态注入任意页面）、`offscreen`（仅当选 SSE 保活）。离线补传直接复用 `pendingReceipts` 的思路做 `pendingActionResults` |
| 版本同步点 | `manifest.json:4`、`extensions/aipdd-enterprise/README.md:1`、`backend/src/distribution/extension-release.ts:8-12`（`version/minVersion/downloadPath`）、`frontend/public/downloads` 的 zip | 升 v1.4.0 时**四处一起改**，`minVersion` 提到 1.4.0 逼旧插件先更新再执行（否则旧插件不认识 `chrome` 任务会静默失败）。**后续变更（2026-11-11）**：`popup.html` 已随弹窗取消而删除，版本同步点由五处减为上述四处 |
| 前端状态灯先例 | 顶栏入口 `frontend/src/components/extension-entry.tsx:441-449`（`ChromeOutlined` + 仅「版本过时」橙 `Badge dot`）、`:45-50` 抽屉四页签、`:101-109` `pingExtension(1000)` 检测、挂载点 `pro-layout.tsx:56,374`、桥接工具 `frontend/src/lib/extension-bridge.ts`（ping） | 顶栏入口加**在线绿点/离线红点**；页签内设备行直接套 `PHASE_COLORS` 同一套 badge 口径，不新造颜色 |
| RPA 页签现状 | `frontend/src/app/rpa/page.tsx:72-100`（`tabs={[tasks, accounts, scripts, settings]}`，`:38` 是 `?tab=` 深链白名单）、`_components/{task,account,script,settings}-panel.tsx`、API 客户端 `_components/common.ts:390-476` | **新增第五个页签「本地 Chrome」**，而不是把设备塞进 `tasks` 面板里 |
| 出网护栏（边界，重要） | `backend/src/http/outbound-guard.ts`：仅 https（`:61-68,142` 仅开发环境放行 loopback）、拦截 URL 内凭据 `:146`、管理端黑名单 `:149`、私网/链路本地/元数据 CIDR `:18-30,83-109`、发送前 DNS 重解析 `:164-191`；硬件心跳上报 baseUrl 也过这道闸（`hardware.service.ts:1179`） | **插件在用户本机浏览器里打开目标网页，不经过这道闸**（服务器不代发请求）；但云端侧任何「校验/预览用户填的域名」的动作都必须走它，且插件登录目标只允许 https + 与签发令牌同源 |
| 二进制存储 | `backend/src/storage/storage.service.ts:12` `put(path, Buffer)`、`:17-22` `signFormPost`、`:25` `remove`、`:31` `urlOf`、`:35` `stat`、`:40` `read(key, maxBytes?)`（默认 40MB 上限，`oss.service.ts:240`；对象路径约定 `enterprise/<userId>/...`，`digital-asset.service.ts:740-743`） | 截图/大观测一律 `put` 后回 `urlOf`，**不把 base64 塞进 JSON 或 LLM 上下文** |
| 复权与撤权 | 既有收口：旧分享/导出/**插件令牌**/定时任务取用前统一走 `isStanding` 复权（任务 #260） | Chrome 设备令牌每次心跳/领指令前同样复权：离职或掉出主体立即 `OFFLINE + 令牌吊销`，避免「人走了浏览器还在被控制」 |

### 缺口（本次真正要造的）

1. `chrome` 这一类设备：设备注册表 + 设备令牌 + 在线判定 + 指令队列 + 回执。
2. 插件侧：登录 UI、`clientId` 持久化、心跳循环、**动态注入的通用 content_script（动作执行器 + 页面地图 + 截图）**、状态灯与「停止」硬闸。
3. 云端：`ChromeRpaSession/Step` 与 **LLM 决策循环**（观测 → 下一步 → 下发 → 再观测）。
4. Agent/MCP：把「这台浏览器现在能干什么」暴露成工具，并在离线时明确不可调用。
5. 前端：「本地 Chrome」页签（设备 + 会话回放）、顶栏绿/红灯、新建任务时绑 clientId。

---

## 三、总体架构（闭环时序）

```
[插件弹窗]  https:// + 域名 + 用户名 + 密码
     │  POST /api/v1/rpa/chrome/login        （账号口令校验＝复用 account.login：bcrypt/审计/连错锁定/限流）
     ▼
[云端]  校验口令 → 签发 rc_ 设备令牌（sha256 存）→ 落 rpa_chrome_devices(clientId, userId, ONLINE)
     │
     │  每 30s：POST /api/v1/rpa/chrome/heartbeat {clientId, version, pages[]}
     ▼
[云端]  刷 ONLINE/lastSeenAt + isStanding 复权 + 顺带返回该设备的待投递指令（≤10 条，标 已投递）
     │
     │  {commands:[{commandCode, sessionId, stepIndex, action}]}
     ▼
[插件 background]  chrome.tabs.get/create → chrome.scripting 动态注入 → tabs.sendMessage(action)
     │
     ▼
[content_script]   执行动作 → 生成 observation{pageMap, text, matched, screenshotKey?}
     │  POST /api/v1/rpa/chrome/result {commandCode, ok, data, screenshot?(dataURL→云端 put OSS)}
     ▼
[云端 会话引擎]    把 observation 拼进上下文 → aiJson/aiChat 产出下一步 action → 入队
     │                                   （循环，直到 finish / 达最大步数 / 超时 / 人工停止）
     ▼
[前端]  设备行与顶栏入口绿灯=在线；会话详情逐步显示「动作 / LLM 理由 / 观测 / 截图」
```

关键取舍（为什么是这个形状）：

1. **控制方向只有「云 → 设备」一条队列**，插件永远只做「领自己的指令 + 交回执」。插件侧不持有任何选模型、选积分、选他人的能力，权限完全由 `rc_` 令牌绑定的那个 userId 决定。
2. **指令队列与传输层解耦**：先用心跳顺带下发（照抄硬件，实现最省、断线自愈天然成立），后续在同一队列上加 SSE 只是把「等下一次心跳」换成「立刻推」，协议和数据模型一行都不用改（见 D1）。
3. **任务台账复用 `RpaTask/RpaTaskExecution`**：`deviceType='chrome' + chromeClientId` 就是绑定；抢单/超时回收/重试/执行历史全部白拿。
4. **观测不是 HTML 而是「页面地图」**：整页 HTML 会把 LLM 上下文打爆且充满噪音。content_script 产出可见交互元素清单（`index/role/name/selector/value`）+ 截断后的正文摘要，动作既可用 selector 也可用 `elementIndex` 指定（后者对 LLM 更稳，不依赖它猜选择器）。
5. **LLM 只在云端**：插件里没有任何 AI 调用、不携带模型凭据；插件断网只是设备变红，不会失控。

---

## 四、插件侧设计

### 4.1 登录（你的第 0 条）

弹窗（`popup.html/js`）新增第一屏：

- 三行输入：① `https://` 作为**不可编辑前缀**（`<span class="prefix">https://</span>` + 同排 input，或 `<input prefix>`），placeholder 给 `oem.example.com`；② 用户名；③ 密码。
- 一个「记住域名」勾选；一个状态灯（灰=未登录 / 绿=在线 / 黄=等待确认 / 红=离线或失败）。
- 校验与口径：
  - 域名输入**只做规整不做拼接**：剥掉用户误粘贴的 `https://`、`/`、路径以外的空白，得到 `https://<域名>`；若站点挂在子路径（线上后端在 `/api/backend`），允许在域名后带该前缀，与现有 `apiBase` 校验口径一致（`acquisition.js:494-527` 保留路径前缀、只校验 origin 的写法照搬）。
  - **只允许 https**（本系统登录页与网关都在 https 上）。填 `http://` 或内网名直接拒绝并提示「请填写本系统的 https 域名」，避免把账号口令发到明文或内网。
  - 口令只用于这一次 `login` 请求，**不写入 `chrome.storage`**（存储里只留 `rc_` 设备令牌与域名）；弹窗关闭即清空输入框。
- 云端 `POST /api/v1/rpa/chrome/login {domain, clientId, username, password, deviceName, extensionVersion}`：
  1. 直接调既有 `account.account.login(username, password, {ip, userAgent})`（`session.ts:105-125` 同一条路径）→ bcrypt、登录审计 `loginLogs`、连错临时锁定、限流全部白拿；**不另写一套验密**。
  2. 成功后签发设备令牌 `rc_<randomBytes(24).hex>`（形态对齐 `ek_`/`hw_`），**只存 sha256**（照 `hardware.helpers.ts:57-73`），明文只在响应里出现一次。
  3. 落/更新 `rpa_chrome_devices`：`clientId` 唯一，换账号登录 = 改绑 `userId`；同一 `clientId` 重复登录**吊销旧令牌**（防止旧会话继续领指令）。
  4. 频率闸：按账号 + 按 IP 双道 `RateWindow`（`session.ts:80-94` 已有同一口径），并把 `x-forwarded-for` 记进审计。
- **不做的事**：插件不读网站 Cookie、不复用网页会话令牌、不代理 `/api/auth/login` 的 httpOnly Cookie（Cookie 是 `SameSite=Lax` + `httpOnly`，`chrome-extension://` 跨站根本带不过去，也不该带）。

### 4.2 clientId 与生命周期

- 首次安装/首次登录时用 `crypto.randomUUID()` 生成 `clientId`，存 `chrome.storage.local`，**永不重生成**（重装扩展会换号，这是可接受的：界面上显示为「新设备」，旧设备由后台停用）。
- Service Worker 会被回收（MV3 空闲即停）。启动路径三条都要接上：`chrome.runtime.onStartup`、`chrome.runtime.onInstalled`、`chrome.alarms`；新增权限 **`alarms`**，`chrome.alarms.create('rpa-heartbeat', {periodInMinutes: 0.5})`（Chrome 120+ 允许 30 秒粒度；旧浏览器回落 1 分钟）。
- 在线判定以服务端为准：`lastSeenAt` 超过 3 个心跳周期（90 秒）→ 视图上 `OFFLINE`；心跳里 `isStanding` 复权失败（离职/掉主体）→ 直接 `DISABLED` + 吊销令牌，插件端收到即清令牌并要求重新登录。

### 4.3 动作执行器（要新增的 content_script）

新增 `rpa-executor.js`，**用 `chrome.scripting.executeScript` 动态注入**（现有 `manifest.json:16-81` 的静态匹配只覆盖微博/小红书这类平台页，任意目标网页必须动态注入；`host_permissions` 已经是 `<all_urls>`，注入不需要新权限，只需 `scripting`）。

动作集合（白名单，闭集；未知动作直接回 `FAILED`，绝不"尽力而为"）：

| 动作 | 参数 | 观测返回 |
|---|---|---|
| `open_tab` | `{url, focus?}` | `{tabId, url, title}`；仅 http(s)，禁 `chrome://`/`file://`/`devtools://`/`view-source:` |
| `close_tab` | `{tabId}` | `{closed:true}`；**禁止关闭非本次会话打开的页**（tabId 必须是会话登记表里的） |
| `navigate` | `{tabId, url}` | `{url, title, ready}` |
| `snapshot` | `{tabId, maxChars?, interactiveOnly?}` | `pageMap`（可见交互元素 `[{i, role, name, selector, value?, href?}]`）+ `text`（截断正文）+ `url/title` |
| `read` | `{tabId, target?: {selector｜elementIndex}, mode: text｜attribute｜count}` | `{value}` / `{count}` |
| `act` | `{tabId, action: click｜type｜select｜check｜scroll｜key｜submit, target, value?, clearFirst?}` | `{matched, effect, before/after 摘要}`；`click/type` 用真实事件（`focus + dispatchEvent`，沿用 `publisher.js` 已验证的可编辑区输入手法） |
| `wait` | `{tabId, ms?｜target?, timeoutMs?}` | `{ok, elapsedMs}`；上限 30 秒，超了直接回超时不空转 |
| `screenshot` | `{tabId, clip?, format?: 'png'｜'jpeg'}` | `chrome.tabs.captureVisibleTab`（需 `activeTab` 或已有 `<all_urls>`）→ 回 `dataURL` 由 background 上传，最终只回 `screenshotKey/url` |
| `finish` | `{status, output}` | 会话结束，落 `RpaTaskExecution` |
| `stop` | — | 用户在插件/页面点「停止」时由**插件侧主动**入队优先级最高的中断指令 |

明确**不做**的动作：`eval_script`（任意 JS 注入）、`upload_file`、`download`、`read_cookies`、`read_passwords`。若将来要加 `eval_script`，必须独立决策 + 后台开关 + 用户每次确认，本方案不开这个口子。

### 4.4 插件端安全闸（把浏览器交给云端必须带的东西）

1. **动作来源只有云端会话**：content_script 不接受页面自己 postMessage 来的控制指令（现有 `bridge.js:36-51` 只用于握手）。这条把「网页里的文本/脚本指挥你的浏览器」这条最常见注入路径直接堵死。
2. **每会话用户确认**：首次接管某标签页时把该 tab `active:true` 并注入一条顶部横幅「AI 正在控制此页面 · 停止」（横幅由 executor 注入，`stop` 走本地直通云端队列）。用户点停止 → 会话置 `CANCELLED`，队列里未投递的指令全部作废。
3. **敏感动作必须人点一下才执行**：`submit`、以及命中「支付/转账/删除/发布/发送/授权」关键词的点击 —— 插件先回 `PENDING_CONFIRM`（灯变黄），用户在插件弹窗点「允许本次」才继续。这对应硬件模块的 `grant/unattended/dryRun` 三段闸（`hardware.service.ts:370-377,431`），沿用同一语义而不是新造一套。
4. **域名黑名单**：银行/支付/密码管理器/内部系统域名默认拒绝接管，黑名单可在后台 `RpaSetting` 配；命中即回 `FAILED` 并留审计。
5. **单次会话硬上限**：最多动作数、单动作超时、会话总时长（值由服务端随登录下发，插件侧再兜一层），超限自动停止。
6. **断连不自由发挥**：拿不到云端指令时插件只等不做；本地不缓存待执行动作（除 `pendingReceipts` 式的**结果补传队列**：执行完但回传失败时先落 storage.local，下次心跳补传，避免结果丢在半路——照 `background.js:86-120` 同一套 TTL/上限思路）。

---

## 五、云端设计

### 5.1 数据模型（迁移 0068-0070）

```prisma
/// 本地 Chrome 插件设备：一个 clientId = 一台浏览器，归属一个账号
model RpaChromeDevice {
  id               Int       @id @default(autoincrement())
  clientId         String    @unique @map("client_id") @db.VarChar(64)
  userId           String    @map("user_id") @db.VarChar(64)
  name             String    @default("") @db.VarChar(80)
  domain           String    @default("") @db.VarChar(200)
  extensionVersion String    @default("") @map("extension_version") @db.VarChar(24)
  userAgent        String    @default("") @map("user_agent") @db.VarChar(200)
  /// 设备令牌只存 sha256（对齐硬件 hw_ 令牌范式）
  tokenHash        String    @unique @map("token_hash") @db.VarChar(64)
  /// ONLINE | OFFLINE | DISABLED
  status           String    @default("OFFLINE") @db.VarChar(16)
  lastSeenAt       DateTime? @map("last_seen_at")
  revokedAt        DateTime? @map("revoked_at")
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @updatedAt @map("updated_at")

  @@index([userId, status])
  @@map("rpa_chrome_devices")
}

/// 指令队列：云端 → 设备唯一通道；commandCode 是回执配对的唯一键
model RpaChromeCommand {
  id          Int       @id @default(autoincrement())
  commandCode String    @unique @map("command_code") @db.VarChar(40)
  deviceId    Int       @map("device_id")
  clientId    String    @map("client_id") @db.VarChar(64)
  sessionId   Int       @default(0) @map("session_id")
  stepIndex   Int       @default(0) @map("step_index")
  action      Json      @default("{}")
  /// PENDING | DISPATCHED | PENDING_CONFIRM | ACKED | DONE | FAILED | TIMEOUT | CANCELLED
  status      String    @default("PENDING") @db.VarChar(20)
  dispatchedAt DateTime? @map("dispatched_at")
  ackedAt      DateTime? @map("acked_at")
  finishedAt   DateTime? @map("finished_at")
  result       Json?
  errorMessage String    @default("") @map("error_message") @db.VarChar(500)
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  @@index([deviceId, status, id])
  @@index([sessionId, stepIndex])
  @@map("rpa_chrome_commands")
}

/// LLM 驱动的浏览器会话：目标 → 逐步动作 → 观测 → 下一步
model RpaChromeSession {
  id          Int       @id @default(autoincrement())
  userId      String    @map("user_id") @db.VarChar(64)
  taskId      Int       @default(0) @map("task_id")
  executionId Int       @default(0) @map("execution_id")
  deviceId    Int       @map("device_id")
  clientId    String    @map("client_id") @db.VarChar(64)
  goal        String    @db.Text
  /// RUNNING | WAITING_CONFIRM | PAUSED | COMPLETED | FAILED | CANCELLED | TIMEOUT
  status      String    @default("RUNNING") @db.VarChar(20)
  stepCount   Int       @default(0) @map("step_count")
  maxSteps    Int       @default(25) @map("max_steps")
  modelKey    String    @default("") @map("model_key") @db.VarChar(128)
  stopReason  String    @default("") @map("stop_reason") @db.VarChar(200)
  pointsCost  Decimal   @default(0) @map("points_cost") @db.Decimal(18, 4)
  createdBy   String    @default("") @map("created_by") @db.VarChar(64)
  startedAt   DateTime  @default(now()) @map("started_at")
  endedAt     DateTime? @map("ended_at")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  @@index([userId, status, createdAt])
  @@index([deviceId, status])
  @@map("rpa_chrome_sessions")
}

/// 会话的一步：动作 + LLM 理由 + 观测（截图只存 key）
model RpaChromeStep {
  id           Int      @id @default(autoincrement())
  sessionId    Int      @map("session_id")
  stepIndex    Int      @map("step_index")
  commandCode  String   @default("") @map("command_code") @db.VarChar(40)
  action       Json     @default("{}")
  thought      String   @default("") @db.Text
  observation  Json?
  screenshotKey String  @default("") @map("screenshot_key") @db.VarChar(200)
  /// PENDING | DISPATCHED | ACKED | DONE | FAILED | SKIPPED
  status       String   @default("PENDING") @db.VarChar(16)
  elapsedMs    Int      @default(0) @map("elapsed_ms")
  promptTokens Int      @default(0) @map("prompt_tokens")
  completionTokens Int  @default(0) @map("completion_tokens")
  errorMessage String   @default("") @map("error_message") @db.VarChar(500)
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@unique([sessionId, stepIndex])
  @@index([commandCode])
  @@map("rpa_chrome_steps")
}
```

- `RpaTask` 加 `chromeClientId String @default("") @map("chrome_client_id") @db.VarChar(64)`；`deviceType` 词表加 `'chrome'`（`rpa-shared.ts:6,10` + 别名 `:16-24`）。
- `RpaScript.fileType` 加 `'chrome_actions'`：动作序列 JSON，**可以完全不经过 LLM 顺序回放**（同一任务既支持「确定性脚本」也支持「AI 自主决策」，见 D6）。
- 迁移：`0068_rpa_chrome_device`（两张设备/指令表 + `RpaTask` 列）、`0069_rpa_chrome_session`（会话/步骤两张）、`0070_rpa_chrome_script_type`（fileType 词表与默认设置行）。手写 MySQL SQL，并按既有流程生成 `schema.postgres.prisma`（`scripts/gen-prisma-schema.mjs:1-14`）。

### 5.2 设备通道端点（插件用）

沿用硬件的最小信封（`hardware.public.ts:9-16`：`{ok, ...}`，不做 feature 门控），令牌走 **`x-chrome-token: rc_...`** 头（对齐 `x-device-token`），每个端点取用前都 `isStanding` 复权：

| 端点 | 作用 |
|---|---|
| `POST /api/v1/rpa/chrome/login` | 域名 + 账号口令 → 设备注册 + `rc_` 令牌 |
| `POST /api/v1/rpa/chrome/heartbeat` | 刷在线 + 返回 ≤10 条待投递指令 + 回带「会话上限/黑名单/是否需要确认」配置 |
| `POST /api/v1/rpa/chrome/result` | 按 `commandCode` 回写结果/截图（幂等：已 `DONE` 的重复回执直接吞） |
| `POST /api/v1/rpa/chrome/logout` | 吊销令牌 + 置 `OFFLINE` |
| `POST /api/v1/rpa/chrome/confirm` | 用户对「等待确认」动作点允许/拒绝 |

大截图走 `StorageService.put('enterprise/<userId>/rpa-chrome/<commandCode>.png', buffer)`，`urlOf` 回给会话（`storage.service.ts:12,31`），**接口体里不落 base64**（`bodyLimit` 中间件按路径限额，`app.ts:86-94,256`，截图会顶穿）。

### 5.3 会话端点（页面与 Agent 用，`/enterprise/rpa/chrome/*`）

`devices` 列表 / `device/disable` / `session/start`（`{clientId, goal, taskId?, maxSteps?, modelKey?}`）/ `session/list` / `session/:id`（逐步 + 截图）/ `session/:id/pause` / `resume` / `stop` / `step/:id/retry` / `sessions/active?clientId=`（给前端灯用：这台设备当前有没有在跑）。全部进契约 `endpoints`，因此 **MCP 目录自动可见**（`mcp-catalog.ts:1-33`）。

### 5.4 LLM 决策循环（引擎一份，入口两个）

`ChromeAgentService.run(sessionId)`：

1. 取设备，**不在线就直接 `FAILED`**（`stopReason='设备不在线'`）——这就是「绿灯才能调」的服务端落点。
2. 首步观测：`snapshot` 当前页（或 `open_tab` 到任务给定的起始 URL）。
3. 循环：`observation`（页面地图截断 + 上一步结果 + 目标）→ `aiJson`（`ai-gateway.ts:415+`，内部 `aiChat` `:352-372` + `meter()` 计量，失败/非 JSON 用 `parseJsonObject` `:387-403` 兜）→ 产出 `{thought, action}`。
4. 校验 `action`：动作在闭集内、`tabId` 属于本会话、URL 是 http(s) 且不在黑名单、命中敏感词就转 `WAITING_CONFIRM`。非法动作不重试烧钱，直接回喂「动作不合法：原因」让 LLM 换一步（最多 2 次，与既有「模型报错我自己重试 2-3 次」的开发期口径一致）。
5. 入队 → 等设备回执（单步超时默认 60 秒）→ 写 `rpa_chrome_steps` → 回到 3。
6. 终止：`finish` / `stepCount >= maxSteps`（默认 25）/ 连续 3 步失败 / 用户停止 / 设备掉线（心跳断 → 会话 `TIMEOUT`）。
7. **积分与用量**：LLM 成本由 `meter()` 走既有 AI 用量口径，不新增计费科目；`session.pointsCost` 只做展示聚合。
8. **不静默假成功**：任何一步没拿到回执，会话状态就是非终态并显示原因；绝不在设备离线时把任务标 `completed`。

入口两个，共用引擎（D6）：
- **页面入口**：RPA「本地 Chrome」页签「新建互动任务」，人给目标、人看逐步回放、人可随时停止。
- **Agent/MCP 入口**：`chrome_open_session / chrome_snapshot / chrome_act / chrome_screenshot / chrome_session_stop` 等 6-8 个 `BUSINESS_TOOLS`（`agent-business-tools.ts:60-104`，带 `write`/`callable` 标注）。写类动作默认不放行，需在 Agent「授权闸」按域勾选——与既有 SCRM/RPA 写动作同一口径。

---

## 六、状态灯与「Agent 里可调」的口径（你的第 7 条）

| 位置 | 现状 | 目标 |
|---|---|---|
| 顶栏 Chrome 插件入口（`extension-entry.tsx:441-449`，挂在 `pro-layout.tsx:56,374`） | 只在版本过时时显示橙色 `Badge dot` | 状态点改为**四态**：绿＝本账号至少一台设备在线；红＝已检测到插件但无在线设备；橙（现有）＝版本过时需更新；灰＝未检测到插件。灯旁 tooltip 写清「Agent 只能控制在线设备」 |
| RPA →「本地 Chrome」页签（新增，接在 `rpa/page.tsx:72-100` 现有四页签后） | 无 | 每个 `clientId` 一行：名称 / **绿·红在线灯** / 扩展版本 / 最近心跳 / 当前会话 / 操作（新建任务、停用、查看会话）。颜色与 badge 直接套 `acquisition-tab.tsx:56-68` 的 `PHASE_COLORS`，全站同一口径 |
| 插件弹窗 | 已随 D2/D3 取消，登录与状态收进侧边栏账号浮层 | 顶部状态灯 + 登录态 + 在线/离线 + 「停止所有控制」；等待人工确认时黄灯并列出待确认动作 |
| Agent 侧「能不能调」 | — | **只有在线设备才出现在可选清单里**（不渲染不能点的按钮，符合既有「不该看到的不渲染」纪律）；工具被离线设备调用时返回明确错误文案，不返回空结果 |
| 新建 RPA 任务绑定设备 | `deviceType` 只有 pc/android/iphone | 选 `chrome` 时**必须从在线设备清单里选具体 clientId**（清单只有 1 台时不渲染下拉，直接显示设备名，遵循「单选不出控件」） |

灯的数据源：`GET /enterprise/rpa/chrome/devices`（列表页轮询）+ 页面会话态复用既有 SSE 写法（`automation-routes.ts:1449-1481`）——前端侧不必为灯新增长连接。

---

## 七、插件工程改动清单（单插件，不新建第二个）

沿用「获客/分发能力升级只动既有 `aipdd-enterprise`」的规则：

1. `manifest.json`：`version` 1.3.0 → **1.4.0**；`permissions` 增 `alarms`、`scripting`（选 SSE 再加 `offscreen`）；`host_permissions` 不变；新增 `rpa-executor.js` 走动态注入，**不进** `content_scripts` 静态表（静态表继续只服务平台分发/获客页）。
2. `background.js`：`importScripts` 追加 `chrome-rpa.js`（登录/心跳/队列/中断/结果补传）与 `chrome-actions/*.js`（动作实现），与现有 `:7` 的 `importScripts("acquisition.js","outreach.js")` 同一 MV3 经典 SW 写法；`chrome.alarms.onAlarm` 与 `onStartup/onInstalled` 接心跳。
3. `sidepanel.html/js`：第一屏登录（`https://` 固定前缀 + 用户名 + 密码 + 记住域名）+ 状态灯 + 设备名 + 待确认队列 + 「停止所有控制」（`popup.html/js` 已随弹窗取消删除）。
4. 结果补传：`chrome.storage.local` 新键 `pendingChromeResults`（上限/TTL 复用 `pendingReceipts` 的 200/3 天口径，`background.js:86-120`），落库成功后由心跳响应清队。
5. 分发与获客**协议不变、行为不变**：新能力全部走新通道与新指令前缀（如 `AIPDD_CHROME_*`），不碰 `AIPDD_DISTRIBUTE` / `AIPDD_ACQ_*` 的处理链，避免把已上线功能改坏。
6. 版本同步五处（`manifest.json:4`、`popup.html:77`、`README.md:1`+`:61`、`extension-release.ts:8-12`、`frontend/public/downloads` zip），并把 `minVersion` 抬到 `1.4.0`：旧插件不认识 `chrome` 任务，必须强制先更新。

---

## 八、安全与边界（这次是「云端能操作你的浏览器」，必须逐条写死）

| 风险 | 处置 |
|---|---|
| 口令落到插件 | 口令只用于一次 `login` 请求，不落 `chrome.storage`；之后只带 `rc_` 令牌（服务端只存 sha256）。插件**从不**读 Cookie、不抓目标平台口令（现有 `background.js` 顶部注释「不读 Cookie、不绕过验证码」的口径延续并写进新模块） |
| 设备令牌被偷 = 别人能开你的浏览器 | `rc_` 与 `clientId` 一一绑用户；同 `clientId` 重新登录即吊销旧令牌；心跳里 `isStanding` 复权，离职/掉主体立即失效；登录/心跳/接管动作全部留审计；后台可一键停用设备 |
| Prompt 注入把浏览器变成肉鸡 | ① 指令只能来自云端会话，页面内容不能发起控制；② LLM 输出必须过动作闭集 + URL/域名黑名单 + 敏感动作人工确认；③ 每会话最多动作数与总时长上限；④ 用户随时可硬停止，停止后队列里未投递指令全部作废 |
| 越权控制他人浏览器 | 设备只认自己 `userId`；会话只能启动在本人设备上；`clientId` 不由前端字符串决定归属（服务端按令牌反查）；组织主体切换不改变设备归属 |
| 观测内容含隐私 | 截图/DOM 摘要进 OSS（`enterprise/<userId>/...`），默认只本人可见、保留 N 天（D7）；页面地图截断上限由服务端下发，不进第三方上下文；LLM 上下文只用平台绑定的模型（走 `aiChat`，不旁路用户 Key 之外的上游） |
| SSRF / 内网穿透 | 插件侧打开网页由本机浏览器完成，服务器不代发；云端一切「校验用户填的地址」的动作过 `outbound-guard`（`:18-30,83-109,164-191`）；插件登录目标固定只允许 https 且与令牌同源；`open_tab` 禁 `chrome://`/`file://`/元数据地址 |
| 危险站点 | 银行/支付/密码管理/内网系统域名黑名单（后台可配），命中即拒并留痕；`eval_script`/`upload_file`/`download` 一律不提供 |
| 刷屏与成本 | 心跳与领指令按设备 `RateWindow`（照 `plugin-bridge.service.ts:59-63` 的 60 次/分口径）；LLM 每步计量走既有 AI 用量；会话最大步数默认 25，超限强制结束 |

---

## 九、实施批次

| 批次 | 内容 | 交付判定 |
|---|---|---|
| B0 | 备份工作区（zip + diff + 未跟踪清单）并跑基线校验 | 基线 typecheck/lint/test 全绿可对照 |
| B1 | 契约 `chrome-rpa`（设备通道 + 会话端点，`endpoints` 进表）+ Prisma 四张表 + `RpaTask.chromeClientId` + 迁移 0068-0070 | `prisma generate` 过；双 schema 一致；空库可 migrate |
| B2 | 设备通道后端：`login`（复用 `account.login` + `rc_` 令牌 sha256）/ `heartbeat`（在线 + 队列下发）/ `result`（幂等）/ `logout` / `confirm` | 单测：重登吊销旧令牌、幂等回执、复权失败即吊销、频控 |
| B3 | `RpaTask` 支持 `deviceType='chrome'` + 绑 `clientId`：新建/认领/超时回收/执行历史复用 | 离线设备领不到任务；`sweepTimeouts` 覆盖 chrome 类任务 |
| B4 | 插件端：登录 UI + `clientId` + `alarms` 心跳 + 动态注入 `rpa-executor.js`（`open_tab/navigate/snapshot/read/act/wait/screenshot/finish`）+ 结果补传队列 | 本机真实加载扩展，走通「云端下一条 click 指令 → 页面被点 → 回执带页面地图」 |
| B5 | 插件端安全闸：接管横幅 + 硬停止 + 敏感动作 `PENDING_CONFIRM` + 域名黑名单 + 会话上限 | 点停止后未投递指令全部作废；黑名单域名直接失败并留痕 |
| B6 | `ChromeAgentService` 循环（`aiJson` 出动作 → 校验 → 队列 → 观测）+ `ChromeRpaSession/Step` 落库 | 一个真实目标（如「打开某页 → 搜索关键词 → 回前 3 条标题」）在 ≤N 步内跑通；离线直接 `FAILED` |
| B7 | Agent 工具 + MCP：6-8 个 `BUSINESS_TOOLS` + 契约自动派生；写动作接授权闸（grant/unattended） | 站内 Agent 与 MCP 客户端都能列到并调用；离线设备返回明确错误 |
| B8 | 前端：RPA「本地 Chrome」页签（设备/会话/逐步回放+截图）、新建任务绑 clientId、顶栏入口四态状态灯、弹窗状态区 | 灯绿/红与服务端在线态一致；不在线时 Agent 入口不渲染 |
| B9 | 帮助中心：新增话题（插件登录、把浏览器交给 Agent 的安全边界、设备与任务绑定、状态灯含义），模型广场/MCP 话题同步；README 更新 | 站内搜索与 `Help_search` 命中；8 语言文案齐 |
| B10 | 插件 v1.4.0 五处版本同步 + zip 重出 + `minVersion` 抬高 | 旧插件在界面里显示「需更新」而非静默失败 |
| B11 | 全量校验：后端 `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter aiworkin-enterprise-api typecheck`、`pnpm exec eslint "{src,test}/**/*.ts"`、`pnpm --filter aiworkin-enterprise-api test`；前端 `node scripts/with-heap.mjs` 类型检查 + `pnpm -r lint` | 全绿；无新增 `as never` / `eslint-disable` |

---

## 十、决策点（推荐默认值，确认即可开工）

| # | 决策 | 选项 | **推荐** |
|---|---|---|---|
| D1 | 云→设备传输 | A 心跳轮询（30 秒，照抄硬件队列，最稳） / B SSE 长连 + `offscreen` 保活（秒级，MV3 SW 需保活） / C 先 A，队列不动、B 作为增量 | **C**：B1-B6 用 A 就能把闭环跑通，延迟可接受时不再加复杂度；需要秒级互动时在同一队列上补 SSE，客户端只换传输层 |
| D2 | 插件登录方式 | A 插件内填域名 + 账号密码（你的原话） / B 已登录网页一键配对（复用 `bridge.js` ping/pong） / C A 必做 + B 作为免密便捷入口 | **C**：A 是你要的能力；B 只是少敲一次密码，不改变设备令牌这条主链路 |
| D3 | 目标平台口令是否下发给插件 | A 不下发（用浏览器已登录会话） / B 允许任务显式勾选「把本人 RpaAccount 口令交给插件」（现有 `ek_` 通道本来就回传明文口令，`rpa-task.service.ts:873-890`） | **A 默认**；B 需要显式勾选 + 审计留痕，且只允许口令属主本人。避免「任务表格里的一个字段」把口令悄悄送到扩展 |
| D4 | 动作集合 | A 闭集 9 个动作（本方案） / B 额外开放 `eval_script` | **A**：`eval_script` 等于把任意 JS 执行权交给云端，与「不控制别人账号」不冲突但和「不被注入劫持」冲突，必须单独决策 |
| D5 | 敏感动作确认 | A 提交/发送/支付/删除/发布/授权类动作必须插件端点确认 / B 只有支付类确认 / C 全自动 | **A**：与你既有的「真实对外动作要人确认」口径（分发「仅填充」模式、触达需确认任务）一致；黄灯就是为此而设 |
| D6 | LLM 循环入口 | A 只做后台任务自跑 / B 只做 Agent 互动 / C 同一引擎两入口 | **C**；同时保留 `chrome_actions` 脚本的**无 LLM 顺序回放**，让确定性任务不花积分 |
| D7 | 截图与观测留存 | A OSS + 默认 7 天保留 + 仅本人可见 / B 只回 base64 不落盘 / C 永久留存 | **A**：不落盘就没法逐步回放（你第 5、6 条要看结果）；永久留存会把别人的页面长期留在库里 |
| D8 | 在线判定阈值 | A 90 秒（3 个心跳周期） / B 30 秒 / C 由后台可调 | **A**，并把阈值放进 `RpaSetting` 可调；B 会因一次网络抖动就闪红，用户不信任灯 |

---

## 十一、验收清单（真机联调按此逐条走，不看代码想当然）

1. 新浏览器装 v1.4.0 → 弹窗填 `https://` + 域名 + 账号密码 → 登录成功；`chrome.storage` 里查不到口令；云端出现一台 `ONLINE` 设备。
2. 关掉浏览器 2 分钟后设备变红；重开自动回到绿（`alarms` + `onStartup` 两条路都验）。
3. 顶栏入口：插件在但设备离线 = 红；任一设备在线 = 绿；版本过时 = 橙。
4. RPA 新建任务：`deviceType=chrome` 必须选定在线的 clientId；离线设备不在清单里。
5. 云端发一条 `navigate + snapshot` → 插件回执带页面地图；页面地图里没有不可见元素，长度受服务端上限约束。
6. `act.click` 用一个真实表单页验证：输入框值真的变了（不是只派发了事件），并且回执 `matched` 说明命中元素。
7. `screenshot` → 结果里是 OSS URL 不是 base64；点开只本人可见；7 天后取不到。
8. 会话跑一个多步目标，逐步显示「动作 / LLM 理由 / 观测 / 截图」；中途在插件点「停止」→ 会话 `CANCELLED`，未投递指令全部作废。
9. 命中「提交」类动作 → 黄灯 `WAITING_CONFIRM`，不点确认就永远不执行；点拒绝 → 该步 `FAILED` 且会话给出原因。
10. 黑名单域名（如网银）→ 直接失败并留审计；`chrome://settings` 被拒。
11. 同 `clientId` 在另一账号登录 → 旧令牌立刻 401；原账号设备变红。
12. 离职/移出主体后设备心跳 → 令牌吊销、`DISABLED`、Agent 里入口消失（复权口径与 #260 一致）。
13. Agent/MCP：设备离线时 `chrome_snapshot` 返回「设备不在线」而不是空结果；在线时可正常互动控制。
14. 无 LLM 的 `chrome_actions` 脚本按序回放成功，且不产生 AI 积分消耗。
15. 旧版 v1.3.0 插件在界面上显示「需更新」，且不会领到 `chrome` 类任务。

---

## 十二、风险与边界

- **不改分发与获客链路**：插件新能力全部走新通道与新指令前缀；`AIPDD_DISTRIBUTE` / `AIPDD_ACQ_*` / 平台 URL 静态注入原样保留，回归验证以「这三条链路行为不变」为硬指标。
- **不新建第二个扩展**（既有规则），也**不引入 WebDriver/CDP/比特浏览器**：本方案的执行体就是用户自己的 Chrome + 插件，与现有 `pc/android/iphone` 三类设备并列成第四类。
- **延迟诚实说明**：D1 选 A 时，指令最坏等 30 秒才到插件，一步 LLM + 一步执行 ≈ 秒级到几十秒级；对「点开某页搜一下」够用，对高频连续操作不够用——那属于 D1-B 的 SSE 增量，不是缺陷。
- **MV3 生命周期是硬约束**：Service Worker 会被回收，`alarms` 是唯一可靠的常驻心跳；不用裸 `setInterval`（会被杀）。
- **不承诺绕过风控**：真实浏览器 + 用户已登录会话仍可能遇到验证码/风控，遇阻一律停下并回 `FAILED` 交人工，与现有分发/获客的「遇登录墙/验证码立即停」口径一致。
- **不做的事**：不读 Cookie、不抓密码管理器、不注入任意 JS、不代理用户填的内网地址、不把设备令牌放进 URL 查询串。
- **与其它方案的关系**：日卡方案（`docs/日卡与30天卡兑换码设计方案.md`）动的是积分/模型广场链路，本方案动的是 RPA/插件链路；两者迁移号与契约文件都错开，可并行实施。
