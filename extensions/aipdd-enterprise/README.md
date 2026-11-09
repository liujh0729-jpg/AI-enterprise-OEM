# AIPDD Enterprise 浏览器插件（v1.3.0）

一个插件承担两件事：**多平台内容分发** 与 **AI 获客（线索采集 / 触达执行）**。
配合 AIPDD Enterprise「工作台 → 营销工具 → 多平台内容分发 / AI 获客」使用。
所有平台动作都在你的浏览器本地完成——插件复用各平台已登录会话，账号凭据不出本机、不经过服务器。

v1.3.0 是在 v1.2.0 分发插件上原地升级，**不是第二个插件**：已安装的用户解压覆盖同一目录后，
到 `chrome://extensions/` 点该插件的「重新加载」即可，站点信任白名单与已登录会话都保留。

## 安装（开发者模式加载）

1. 解压本 zip 到任意固定文件夹（保留 aipdd-enterprise 目录）。
2. Chrome 地址栏打开 `chrome://extensions/`，右上角开启「开发者模式」。
3. 点「加载已解压的扩展程序」，选择 aipdd-enterprise 文件夹。
4. 在扩展列表把 AIPDD Enterprise 固定到工具栏（拼图图标 → 图钉）。
5. 打开企业站页面，点插件弹窗里的「信任此站点」——分发与获客都只对已信任的站点生效。

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
4. 触达任务只执行**服务端已审核通过且你已确认**的那一条；私信首条始终需要人工确认。
5. 面板上可随时「暂停 / 停止」。停止后不再领取新任务，已打开的平台页保留供人工接手。

## 执行约束（写进插件，不是口头承诺）

- **权限不扩张**：仍为 `tabs` / `storage` / `<all_urls>`，v1.3.0 没有新增任何 permission。
- **不读 Cookie、不导出凭据**：只读页面 DOM 与复用浏览器已有会话，不调用平台私有接口。
- **不绕过验证码**：遇登录墙 / 验证码 / 风控页立即停止并回报 `NEED_LOGIN` / `CAPTCHA` / `RISK_CONTROL`，
  标签页保留并切到前台，你就地处理后重新执行即可。
- **串行 + 随机间隔**：每打开一个平台页算一次操作，两次操作之间随机等待（默认 20–60 秒，服务端下发）；
  页内滚动只是等渲染，不另计操作。单账号每小时上限由服务端下发。
- **结果未知不重试**：回执发不出去时只提示「结果未知」，绝不自动重发，避免平台侧重复动作。
- **失败保留标签页**：只有真正成功的采集页会自动关闭；失败/待人工的页面一律保留。
- **同源护栏**：`apiBase` 必须与发起页面自己的 origin 一致，插件不会把令牌发往第三方地址。

## 打包发布（开发者）

- 重新打包请用 `node scripts/pack-extension.mjs`（产出 POSIX 分隔符条目的 zip，供
  `frontend/public/downloads/` 分发）；**不要用 PowerShell `Compress-Archive`**，它写的反斜杠
  条目名在 macOS/Linux 解压后不会形成目录，导致按本文安装步骤加载失败。
- 发新版时同步四处版本号：本文件标题、`manifest.json` 的 `version`、`backend/src/distribution`
  的 `EXTENSION_INFO`（`version` 与 `downloadPath`）、`frontend/public/downloads/` 里的 zip 文件名
  （`scripts/verify-distribution.mjs` 会断言四处对齐）。

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
- MV3 Service Worker 会被浏览器回收：**执行期间请保持获客工具页打开**，页面每 20 秒查一次状态，
  既刷新进度也让 Worker 保持活跃。关掉页面后任务会在服务端按心跳超时记为 `PARTIAL`。

## 与页面通信协议（开发者）

分发（v1.2.0 起，保持不变）：

- 页面 → 插件：`window.postMessage({ source: 'aipdd-page', type: 'ping' | 'distribute', jobId, payload })`
- 插件 → 页面：`window.postMessage({ source: 'aipdd-extension', type: 'pong' | 'accepted' | 'result', ... })`
- distribute payload：`{ title, content, images: [{ name, url }], platformCodes, autoPublish }`

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
  - `{ type: 'outreach-result', jobId, outreachId, status, receipt, receiptRef, stopReason, error }`
  - `{ type: 'acq-state', jobId, phase, taskType, done, total, newLeads, needToken, message }`
  - `{ type: 'acq-unknown', jobId, runId, outreachId, error }`（回执上报失败＝结果未知，不重试）

后台内部指令：`AIPDD_ACQ_START` / `AIPDD_ACQ_TOKEN` / `AIPDD_ACQ_PAUSE` / `AIPDD_ACQ_STOP` /
`AIPDD_ACQ_STATUS`（页面 → background），`AIPDD_COLLECT`（background → collector.js），
`AIPDD_ACQ_EVENT`（background → bridge → 页面）。

服务端接口：`POST /enterprise/acquisition/plugin/token`（页面带会话签发）、
`POST /enterprise/acquisition/plugin/pull`、`POST /enterprise/acquisition/plugin/report`
（后两个免登录，只认令牌；每次最多领 5 个任务）。

## 文件职责

| 文件 | 作用 |
|---|---|
| `manifest.json` | MV3 声明：权限、Service Worker、三份 content script |
| `background.js` | 分发调度 + 把 `AIPDD_ACQ_*` 指令转给获客模块 |
| `acquisition.js` | 获客后台：领任务/续期/暂停停止/串行随机间隔/增量回执 |
| `bridge.js` | 注入所有页面，同源同帧护栏下双向转发 postMessage |
| `publisher.js` | 平台创作页填充与发布（分发） |
| `collector.js` | 平台搜索页/详情页/评论区/账号页抓取（获客） |
| `popup.html` / `popup.js` | 版本显示与「信任此站点」白名单开关 |