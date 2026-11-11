# AIPDD Enterprise 浏览器插件（v1.4.0）

一个插件承担三件事：**多平台内容分发**、**AI 获客（线索采集 / 触达执行）** 与 **本地 Chrome 控制（把浏览器交给云端 Agent）**。
配合 AIPDD Enterprise「工作台 → 营销工具 → 多平台内容分发 / AI 获客」与「工作台 → RPA自动化 → 本地 Chrome」使用。
所有平台动作都在你的浏览器本地完成——插件复用各平台已登录会话，账号凭据不出本机、不经过服务器。

v1.4.0 是在 v1.3.0 上原地升级，**不是第二个插件**：已安装的用户解压覆盖同一目录后，
到 `chrome://extensions/` 点该插件的「重新加载」即可，本系统登录态与各平台登录态都保留。
本版新增本地 Chrome 控制（需在插件侧边栏里用**本站账号**登录）与统一任务通道（§10.7）。
点工具栏图标即拉开右侧侧边栏（不再弹浮窗），设备登录在侧边栏右上角「⋯」里。

## 安装（开发者模式加载）

1. 解压本 zip（Windows「全部解压缩」会得到与压缩包同名的文件夹），解压出的文件夹里**直接就是 `manifest.json`**。
2. Chrome 地址栏打开 `chrome://extensions/`，右上角开启「开发者模式」。
3. 点「加载已解压的扩展程序」，选中解压出的那个文件夹（不用再往里钻一层）。
4. 在扩展列表把 AIPDD Enterprise 固定到工具栏（拼图图标 → 图钉）；之后点图标即拉开右侧侧边栏。
5. 点侧边栏右上角「⋯」填写本系统域名 / 账号 / 密码完成登录，这台浏览器即成为该账号下一台设备，分发、获客与浏览器代理随即可用。

## 使用：多平台内容分发

1. 在同一浏览器登录目标平台创作中心：微博、小红书（creator.xiaohongshu.com）、
   抖音（creator.douyin.com）、知乎（zhuanlan.zhihu.com/write）、今日头条号（mp.toutiao.com）。
2. 回到 AIPDD Enterprise 的多平台内容分发工具页，新建内容、勾选平台，点「分发」。
3. 插件逐个打开平台创作页并填充标题/正文/图片：
   - 「自动发布」开启：填完自动点发布（各平台风控弹窗仍需人工处理）。
   - 关闭（默认）：只填好内容，请回到平台页人工确认后发布。
4. 发布结果自动回写台账（保持工具页打开）；失败时标签页会保留，可在「结果 → 人工补记」。

## 使用：AI 获客

1. 在浏览器登录要采集的平台**消费侧**站点：小红书（www.xiaohongshu.com）、抖音（www.douyin.com）、
   知乎（www.zhihu.com）、微博（weibo.com / s.weibo.com）、B 站（www.bilibili.com / search.bilibili.com）。
   公众号走搜狗微信搜索（weixin.sogou.com）与文章页（mp.weixin.qq.com）。
2. 打开「营销工具 → AI 获客」，建好监控源并执行，在插件面板点「连接插件」。
   页面会签发一个 **5 分钟有效、只能 pull/report** 的令牌交给插件；过期后页面自动续期，任务不重启。
3. 插件串行打开平台搜索页/详情页/评论区抓取公开内容与评论，逐页把结果回传服务端落库。
4. **公开联系方式补抓（D7=B）**：账号/指定内容方式打开达人主页时，插件额外读取主页上**已公开可见**
   的邮箱 / 微信 / 电话 / 官网·店铺，连同「可见区域 + 来源 URL + 采集时间」一并回传，落在线索证据链上。
   插件不读隐藏数据、不调私有接口；线索详情页按字段与证据来源两栏展示。
5. 触达任务只执行**服务端已审核通过且你已确认**的那一条；私信首条始终需要人工确认。
6. 面板上可随时「暂停 / 停止」。停止后不再领取新任务，已打开的平台页保留供人工接手。

## 使用：本地 Chrome 控制（把浏览器交给云端 Agent）

1. 点浏览器工具栏的插件图标，右侧侧边栏会直接拉开；点右上角「⋯」（或未连接时点顶部的「未连接」胶囊）登录：填**本系统**的域名（`https://`，本机开发可改成 `http://`）、账号与密码（可选「记住域名」）。
   登录成功后插件拿到一把 `rc_` 设备令牌（明文只出现一次），此后心跳、领指令都用它，**不再需要密码**。
   目标平台（如某电商后台）的账号密码**永远不下发**给插件——Agent 用的是你在该平台**已登录的会话**。
2. 首次安装即具备 `scripting` 与 `alarms`（动态注入动作执行器、心跳保活），并为浏览器代理申请 `<all_urls>` 站点访问——Agent 默认可接管任意普通网页（`chrome://` 等浏览器内置页除外），无需逐站点授权。
3. 回到「工作台 → RPA自动化 → 本地 Chrome」页签，看到你本机这台设备显示**在线**（绿点）即可开工：
   - 点「新建互动任务」填目标（如「打开某页 → 搜索关键词 → 回前 3 条标题」）、起始地址与最大步数；
   - 页面把目标交给云端 LLM，云端逐步产出动作、插件在你浏览器里逐步执行并回报页面地图与截图；
   - 页面可看每一步的动作 / 想法 / 报错 / 截图，失败步骤可单独重试；随时可暂停 / 继续 / 停止。
4. 也可不经过 LLM：给任务绑定 `chrome_actions` 类型的动作序列 JSON，按顺序确定性回放。
5. 也可在「RPA 任务」页签把目标设备选成「本地 Chrome」并在在线设备里挑一台，挂成任务定时跑。

**安全闸（与云端同一套口径）**

- 指令只能来自云端会话，网页里的文字 / 脚本发不出控制指令。
- 动作是**闭集**（打开 / 关闭标签页、跳转、读页面、点击 / 输入 / 选择 / 滚动 / 按键 / 提交、等待、截图、结束）；不提供执行任意脚本、上传下载、读 Cookie、读密码。
- **敏感动作先确认**：提交表单与命中「支付 / 转账 / 删除 / 发布 / 发送 / 授权」等关键词的点击，插件先回「等待确认」（灯变黄），你在侧边栏点「允许本次」才执行。
- **危险站点黑名单**（银行 / 支付 / 密码管理器 / 内网等）命中即失败并留痕；会话有最大步数 / 单步超时 / 总时长上限。
- 随时可硬停止：页面点「停止」或侧边栏「⋯」→「停止所有控制」，停止后**未投递**的指令全部作废。
- 观测只回「可见交互元素清单 + 截断正文 + 少量截图」，截图存平台对象存储、默认只本人可见；**不读 Cookie、不绕过验证码**。

## 使用：浏览器代理侧边栏（Agent 控制浏览器）

1. 点工具栏图标**直接拉开右侧侧边栏**（不再弹浮窗），或按 `Alt+A` 打开主界面。侧边栏分四区：
   - **Header**：设备名与连接状态灯（灰=未连接 / 绿=在线 / 黄=待确认 / 红=离线）、模型（来自本系统模型广场）、积分 / 时长卡额度、账号菜单（打开本系统 / 停止所有控制 / 断开）。
   - **Main**：会话消息流（目标 / 思考 / 动作 / 工具 / 结果 / 截图 / 错误），敏感动作以「待确认」卡片出现，可当场「允许本次 / 拒绝」。
   - **Composer**：输入目标 + 模式（Act / Crawl / Extract）+ 附件 + 「增强提示」+ 发送。
   - **Footer**：历史 / 技能 / 计划 / 触发器 / 录制 / MCP / 模型七个入口，点开是在 Main 上叠加的抽屉。
2. 界面样式取自本系统设计令牌（`tokens.css`），四区布局参考 rtrvr.ai 的骨架，皮肤与本系统一致。
3. 所有普通网页默认可被 Agent 接管：不需要逐站点信任；插件只复用你已登录的会话执行页面动作，不越过登录墙或验证码。

## 执行约束（写进插件，不是口头承诺）

- **权限最小化**：基础权限为 `tabs` / `storage`；v1.4.0 本地 Chrome 控制新增必需的 `alarms`（心跳保活）与 `scripting`（把动作执行器 / 桥接脚本动态注入目标页，插件启动即需，故列为必需权限，不随登录再申请）；浏览器代理侧边栏另加 `sidePanel`（只用于显示主界面，不扩大任何站点访问范围）；浏览器代理需要接管任意普通网页，故 `host_permissions` 声明 `<all_urls>`，安装即授予，无需逐站点手势授权。
- **不读 Cookie、不导出凭据**：只读页面 DOM 与复用浏览器已有会话，不调用平台私有接口；本地 Chrome 控制沿用同一口径，只把「可见交互元素 + 截断正文 + 少量截图」回传，不读 Cookie、不抓目标平台口令。
- **不绕过验证码**：遇登录墙 / 验证码 / 风控页立即停止并回报 `NEED_LOGIN` / `CAPTCHA` / `RISK_CONTROL`，
  标签页保留并切到前台，你就地处理后重新执行即可。
- **串行 + 随机间隔**：每打开一个平台页算一次操作，两次操作之间随机等待（默认 20–60 秒，服务端下发）；
  页内滚动只是等渲染，不另计操作。单账号每小时上限由服务端下发。
- **结果未知不重试**：回执发不出去时只提示「结果未知」，绝不自动重发，避免平台侧重复动作。
- **失败保留标签页**：只有真正成功的采集页会自动关闭；失败/待人工的页面一律保留。
- **只抓已公开可见字段（D7=B）**：公开联系方式仅从达人**主页公开区域**抽取，且只认 `email` / `wechat` /
  `phone` / `homepage` 四类，每条都带可见性与来源证据；不做全量抓取、不读隐藏数据。
- **同源护栏**：`apiBase` 必须与发起页面自己的 origin 一致，插件不会把令牌发往第三方地址。

## 打包发布（开发者）

- 重新打包请用 `node scripts/pack-extension.mjs`（产出 POSIX 分隔符条目的 zip，供
  `frontend/public/downloads/` 分发）；**不要用 PowerShell `Compress-Archive`**，它写的反斜杠
  条目名在 macOS/Linux 解压后不会形成目录，导致按本文安装步骤加载失败。
- 发新版时同步版本号：本文件标题、`manifest.json` 的 `version`（侧边栏与设备名里的版本运行时从 manifest 读，
  已无硬编码副本）、
  `backend/src/distribution/extension-release.ts` 的 `EXTENSION_RELEASE`（`version` / `minVersion` /
  `downloadPath`）、`frontend/public/downloads/` 里的 zip 文件名（`scripts/verify-distribution.mjs`
  会断言对齐；`minVersion` 一并抬到新版本号，旧插件在页面显示「需更新」而不是静默失败）。

## 已知限制

- 平台页 DOM 改版会导致填充/抓取失败：属预期降级，如实报 `PAGE_CHANGED`，人工接手即可；
  插件后续版本会更新选择器。**空结果不会被当成成功**，批次会记为 `PARTIAL` 并给出原因。
- 正文填充依赖 `document.execCommand`（已是废弃 API，但各平台创作页仍普遍吃这条路）：
  它在非前台标签页上可能静默失败，因此后台投递前会把平台页切到前台、填完切回；
  填充失败时标签页保留，人工到该页粘贴发布即可。
- 微博「自动发布」为首页直发短文；长文/文章类建议用小红书、知乎、头条号链路。
- 视频类内容本期只做图文与文章，视频请上传本地文件后人工发布。
- **视频号没有公开网页搜索入口**：关键词/竞品/话题方式会如实停下并提示改用「指定内容评论」，
  填入可公开访问的视频页链接；TikTok / X / 快手采集本期未开放。
- 公众号关键词采集走搜狗微信搜索，证据链接是搜狗跳转地址；搜狗频繁出验证码时会报 `CAPTCHA` 停下。
  要采文章评论区，请用「指定内容评论」直接填 `mp.weixin.qq.com` 文章链接。
- 采集只滚动加载、不点击「展开更多回复」，因此嵌套子回复可能采不全；这是刻意的保守策略。
- **公开联系方式只在达人主页「已公开可见」时才有**：多数主页不放联系方式，补不到属正常结果，不是失败；
  若平台把联系方式放在需登录后才展开的区域，插件不会去点开或读取（守住 D7=B 合规边界）。
- **分发效果回流（D8=A）**：发布成功的作品可点「刷新效果」，插件回各平台创作中心读阅读/点赞/评论并回写；
  平台改版或不展示该数据时读不到，界面如实提示「尚未读到效果数据」，不伪造数字。
- MV3 Service Worker 会被浏览器回收：**执行期间请保持获客工具页打开**，页面每 20 秒查一次状态，
  既刷新进度也让 Worker 保持活跃。关掉页面后任务会在服务端按心跳超时记为 `PARTIAL`。

## 与页面通信协议（开发者）

分发（v1.2.0 起，保持不变）：

- 页面 → 插件：`window.postMessage({ source: 'aipdd-page', type: 'ping' | 'distribute', jobId, payload })`
- 插件 → 页面：`window.postMessage({ source: 'aipdd-extension', type: 'pong' | 'accepted' | 'result', ... })`
- distribute payload：`{ title, content, images: [{ name, url }], platformCodes, autoPublish }`
- **效果回流（v1.3.0 D8）**：页面 → 插件 `{ type: 'collect-metrics', jobId, payload: { contentId, items: [{ platformCode, publishedUrl }] } }`；
  插件在各平台创作中心读阅读/点赞/评论后回 `{ type: 'metrics', jobId, metrics: [{ platformCode, publishedItemId, views, likes, comments }] }`。
  结果标识（`publishedItemId`）由插件读取，用于服务端按「内容 + 平台」幂等覆盖写。

获客（v1.3.0 新增）：

- 页面 → 插件：`{ source: 'aipdd-page', type: 'collect' | 'outreach', jobId, payload }`
  - collect payload：`{ apiBase, token, platform, mode, query, urls[], limits }`
  - outreach payload：`{ apiBase, token, platform, action, targetUrl, text, maxPerHour }`
  - `apiBase` 带后端前缀（线上为 `https://站点/api/backend`）；插件校验 origin 必须与来源页一致，
    保留路径前缀再请求 `/enterprise/acquisition/plugin/*`。
- 页面 → 插件：`{ type: 'acq-token', payload: { token } }`（续期，不重启任务）
- 页面 → 插件：`{ type: 'acq-control', payload: { action: 'pause' | 'stop' } }`、`{ type: 'acq-status' }`
- 插件 → 页面：
  - `{ type: 'accepted', jobId, ok, errorMsg, state }`（启动/控制应答）
  - `{ type: 'harvest', jobId, runId, items[], done, collected, newLeads, status, stopReason, error }`
    - item 若来自达人主页，带 `contacts[]`：`{ field: 'email'|'wechat'|'phone'|'homepage', value, visibility: 'PROFILE_PUBLIC'|'BIO_PUBLIC' }`（D7=B 证据链）
  - `{ type: 'outreach-result', jobId, outreachId, status, receipt, receiptRef, stopReason, error }`
  - `{ type: 'acq-state', jobId, phase, taskType, done, total, newLeads, needToken, message }`
  - `{ type: 'acq-unknown', jobId, runId, outreachId, error }`（回执上报失败＝结果未知，不重试）

后台内部指令：`AIPDD_ACQ_START` / `AIPDD_ACQ_TOKEN` / `AIPDD_ACQ_PAUSE` / `AIPDD_ACQ_STOP` /
`AIPDD_ACQ_STATUS`（页面 → background），`AIPDD_COLLECT`（background → collector.js），
`AIPDD_ACQ_EVENT`（background → bridge → 页面）。

### 统一通信协议（v1.4.0 引入，§10.7）

上面两套消息名是存量链路，插件同时提供**统一能力协议**：页面只发「能力标识 + 动作 + 参数」，
插件只执行已登记动作，回执统一携带「状态 + 结果 + 证据 + 错误码 + 版本」。新业务一律走统一协议，
存量链路作为过渡适配层保留，逐步收敛。

- 握手：`pong` 增带 `protocolVersion`（当前 `1`，与契约 `BROWSER_TASK_PROTOCOL_VERSION` 同源）。
  页面据此决定走统一通道还是回落旧消息名（旧插件不上报＝回落）。
- 任务（页面 → 插件）：`{ source: 'aipdd-page', type: 'task', jobId, task: { protocolVersion, capability, action, jobId, platforms?, source?, orgUserId?, token?, payload } }`
  - 已登记「能力:动作」：`distribution:fill|publish|metrics`、`acquisition:collect|outreach|metrics`；
    未知能力/动作一律拒绝（`code: 'UNKNOWN_CAPABILITY'`），不下发任何脚本。
  - 接单应答沿用 `accepted`：`{ type: 'accepted', jobId, ok, errorMsg, code, capability, action, state }`，
    被拒时 `ok: false` 且 `code` 为 `UNKNOWN_CAPABILITY` / `TASK_REJECTED`。
- 回执（插件 → 页面）：`{ source: 'aipdd-extension', type: 'receipt', receipt: { protocolVersion, capability, action, jobId, status, code, message, results[], evidence[], pluginVersion, at } }`
  - 信封状态：`ACCEPTED / RUNNING / SUCCESS / PARTIAL / FAILED / UNKNOWN`；由逐条结果汇总
    （无结果＝接单、全成功＝SUCCESS、全失败＝FAILED、其余＝PARTIAL）。
  - 逐条结果严格区分 `FILLED`（已填充待确认）/ `SUBMITTED`（已提交待核实）/ `VERIFIED`（已核实发布）
    / `FAILED` / `SKIPPED`；分发回执另带发布链接证据（`kind: 'URL'`）。
  - 错误码见契约 `BROWSER_TASK_ERROR_CODES`；`NEED_LOGIN / CAPTCHA / RISK_CONTROL / UNTRUSTED_SITE`
    一律停止任务不自动重试。
- 仅对「经统一通道下发」的任务回统一回执；旧消息名发起的任务不重复回报，避免双份台账。
  `acquisition` 的终态回执另带 `data`（`runId / outreachId / newLeads / receipt / receiptRef / stopReason`），
  页面 `POST /enterprise/acquisition/plugin/receipt` 把它记到服务端任务队列（`browser_tasks.receipt_data`）。

### 站点访问与内容脚本登记

- `manifest.json` 申请 `host_permissions: ["<all_urls>"]`：浏览器代理（Agent）可接管任意普通网页，这是默认值，无需逐站点信任。
- 分发 / 获客的业务 `content_scripts`（`publisher.js` / `collector.js` / `metrics.js` / `outreach.js`）仍只挂在各自平台站点上，不随 `<all_urls>` 扩大。
- `bridge.js` 不静态挂载：由后台 `ensureSiteAccess()` 用 `chrome.scripting.registerContentScripts`
  按声明平台站点（`DECLARED_SITES`）动态登记 `aipdd-bridge`，页面发来的任务走这一条统一通道。
- 声明清单与契约 `EXTENSION_CAPABILITIES[*].sitePermissions` 同源；发布新平台时两处同步。
- 统一通道还做能力校验：任务能力必须属于当前页面声明的站点，否则拒绝。

> 契约见 `packages/contracts/src/browser-task.ts`；页面侧 SDK 见 `frontend/src/lib/extension-bridge.ts`
> （`sendBrowserTask` / `onBrowserReceipt` / `supportsBrowserTask`）。

服务端接口：`POST /enterprise/acquisition/plugin/token`（页面带会话签发）、
`POST /enterprise/acquisition/plugin/pull`、`POST /enterprise/acquisition/plugin/report`
（后两个免登录，只认令牌；每次最多领 5 个任务）。

## 文件职责

| 文件 | 作用 |
|---|---|
| `manifest.json` | MV3 声明：`<all_urls>` host 权限、Service Worker、按站点挂载的业务 content script |
| `background.js` | 按声明平台站点动态登记 `aipdd-bridge`；分发调度 + 把 `AIPDD_ACQ_*` 指令转给获客模块 |
| `acquisition.js` | 获客后台：领任务/续期/暂停停止/串行随机间隔/增量回执 |
| `bridge.js` | 只在声明的平台站点注入，同源同帧护栏下双向转发 postMessage；含统一任务/回执通道与旧消息名适配 |
| `publisher.js` | 平台创作页填充与发布（分发） |
| `collector.js` | 平台搜索页/详情页/评论区/账号页抓取（获客） |
| `chrome-rpa.js` | 本地 Chrome 控制：设备登录 / 心跳 / 领指令 / 暂停停止 / 结果补传队列；并给侧边栏 Agent 暴露「设备通道请求 + 本机执行动作」 |
| `chrome-agent.js` | 侧边栏 Agent 编排：逐步读页面观测 → 调平台 `/decide` 拿下一步动作 → 敏感动作先问本人 → 本机执行 → 记消息卡 |
| `rpa-executor.js` | 本地 Chrome 动作执行器（内容脚本，由后台 `chrome.scripting.executeScript` 动态注入目标页） |
| `sidepanel.html` / `sidepanel.js` | 浏览器代理主界面：Header / Main / Composer / Footer 四区 + 抽屉与浮层；账号浮层含设备登录 |
| `sidepanel.css` | 侧边栏样式（布局照 rtrvr，颜色 / 圆角 / 字号取自设计令牌） |
| `icons/` | 插件图标（16/32/48/128，深色底 + 白色 AI 字标；由 `node scripts/gen-extension-icons.mjs` 生成） |
| `tokens.css` | 插件设计令牌（逐值取自 `frontend/src/app/globals.css` 的 `:root`） |