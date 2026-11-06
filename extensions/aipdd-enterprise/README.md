# AIPDD Enterprise 浏览器插件（v1.2.0）

多平台内容分发助手：配合 AIPDD Enterprise「工作台 → 营销工具 → 多平台内容分发」使用。
发布在你的浏览器本地完成——插件复用各平台已登录会话，账号凭据不出本机、不经过服务器。

## 安装（开发者模式加载）

1. 解压本 zip 到任意固定文件夹（保留 aipdd-enterprise 目录）。
2. Chrome 地址栏打开 `chrome://extensions/`，右上角开启「开发者模式」。
3. 点「加载已解压的扩展程序」，选择 aipdd-enterprise 文件夹。
4. 在扩展列表把 AIPDD Enterprise 固定到工具栏（拼图图标 → 图钉）。

## 使用

1. 在同一浏览器登录目标平台创作中心：微博、小红书（creator.xiaohongshu.com）、
   抖音（creator.douyin.com）、知乎（zhuanlan.zhihu.com/write）、今日头条号（mp.toutiao.com）。
2. 回到 AIPDD Enterprise 的多平台内容分发工具页，新建内容、勾选平台，点「分发」。
3. 插件逐个打开平台创作页并填充标题/正文/图片：
   - 「自动发布」开启：填完自动点发布（各平台风控弹窗仍需人工处理）。
   - 关闭（默认）：只填好内容，请回到平台页人工确认后发布。
4. 发布结果自动回写台账（保持工具页打开）；失败时标签页会保留，可在「结果 → 人工补记」。

## 打包发布（开发者）

- 重新打包请用 `node scripts/pack-extension.mjs`（产出 POSIX 分隔符条目的 zip，供
  `frontend/public/downloads/` 分发）；**不要用 PowerShell `Compress-Archive`**，它写的反斜杠
  条目名在 macOS/Linux 解压后不会形成目录，导致按本文安装步骤加载失败。
- 发新版时同步三处版本号：本文件标题、`manifest.json` 的 `version`、`backend/src/distribution`
  的 `EXTENSION_VERSION` 与下载文件名（verify-distribution.mjs 会断言对齐）。

## 已知限制

- 平台创作页 DOM 改版会导致填充失败：属预期降级，人工接手即可；插件后续版本会更新选择器。
- 正文填充依赖 `document.execCommand`（已是废弃 API，但各平台创作页仍普遍吃这条路）：
  它在非前台标签页上可能静默失败，因此后台投递前会把平台页切到前台、填完切回；
  填充失败时标签页保留，人工到该页粘贴发布即可。
- 微博「自动发布」为首页直发短文；长文/文章类建议用小红书、知乎、头条号链路。
- 视频类内容本期只做图文与文章，视频请上传本地文件后人工发布。

## 与页面通信协议（开发者）

- 页面 → 插件：`window.postMessage({ source: 'aipdd-page', type: 'ping' | 'distribute', jobId, payload })`
- 插件 → 页面：`window.postMessage({ source: 'aipdd-extension', type: 'pong' | 'accepted' | 'result', ... })`
- payload：`{ title, content, images: [{ name, url }], platformCodes, autoPublish }`
