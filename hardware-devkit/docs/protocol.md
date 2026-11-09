# 设备通道协议

设备通道挂在 `/api/public/hardware/**`，免登录，只认设备令牌。

- 请求头：`x-device-token: hw_...`
- 响应统一是极简 JSON：`{ "ok": true, ... }`，失败为 `{ "ok": false, "message": "..." }`（**不套**站内的 `code/message/data` 信封）。
- 令牌无效返回 401，设备停用返回 403。

> 关掉「智能硬件」板块不会掐断设备通道，已接入设备仍可心跳。

## 1. 心跳

`POST /api/public/hardware/heartbeat`

请求体：

```json
{
  "firmwareVersion": "esp32-1.0.0",
  "meta": { "baseUrl": "http://192.168.1.20:8080" }
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `firmwareVersion` | 否 | 固件版本，最长 40 |
| `meta.baseUrl` | 否 | 本设备对外 HTTP 地址，仅「设备直连（HTTP）」工具需要；不合法不会入库 |

响应：

```json
{
  "ok": true,
  "received": true,
  "commands": [
    { "eventId": 123, "commandCode": "SET_LED__a1b2c3d4", "toolCommandCode": "SET_LED", "args": { "on": true } }
  ]
}
```

心跳会把设备置为在线，并**顺带带回待办指令**（设备不必再单独轮询）。

## 2. 拉取指令（可选）

`GET /api/public/hardware/commands`

响应与心跳的 `commands` 等价：

```json
{ "ok": true, "commands": [ { "eventId": 123, "commandCode": "...", "toolCommandCode": "...", "args": {} } ] }
```

适合不按固定周期心跳、但想主动取指令的客户端。

## 3. 回执

`POST /api/public/hardware/result`

请求体：

```json
{
  "commandCode": "SET_LED__a1b2c3d4",
  "ok": true,
  "message": "",
  "response": { "on": true }
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `commandCode` | 是 | **必须原样带回收到的唯一命令号**，平台据此匹配这次下发 |
| `ok` | 否 | 默认 `true`；设备执行失败填 `false` |
| `message` | 否 | 失败原因，最长 200 |
| `response` | 否 | 工具返回给调用方的响应对象 |

响应：`{ "ok": true, "received": true }`

## 指令字段：`commandCode` 与 `toolCommandCode`

一条指令有两个码，别混用：

| 字段 | 含义 | 用途 |
| --- | --- | --- |
| `commandCode` | 唯一命令号，形如 `<工具指令码>__<8位随机>` | 回执时**原样带回**，平台靠它精确匹配这一次下发 |
| `toolCommandCode` | 工具里配置的「指令编码」 | 设备据此决定执行哪个动作 |

> 为什么分开：同一个工具会被调用很多次，若只用工具指令码匹配，多次下发会串号。所以平台给每次下发一个唯一号。

## 指令生命周期

```
已下发（排队）→ 已投递（设备取走）→ 已回执 / 回执超时
```

- 平台下发后同步等待回执，默认 **30 秒**超时，超时在事件流水留痕并返回 `DEVICE_TIMEOUT`。
- 每设备 **每分钟最多 30 条**指令，超出返回限流。
- 设备 **180 秒**没有心跳即判离线。

## 4. 设备直连（HTTP）工具

管理员把工具通道设为「设备直连（HTTP）」时，平台按下面的约定调用设备：

- 目标地址：`<meta.baseUrl><工具 path>`，方法用工具里配置的 HTTP 方法；
- 请求头：
  - `content-type: application/json`
  - `x-device-token-hash: <sha256(设备令牌) 的十六进制>`（设备可据此自证调用来自平台）
- 请求体：工具参数 JSON（GET/HEAD 无请求体）；
- 设备返回：JSON，HTTP 2xx 视为成功，响应体作为工具结果。

Python 侧的 `aiworkin_hardware.HttpToolServer` 已实现这套约定（校验哈希 + 路径分发），可直接用。
