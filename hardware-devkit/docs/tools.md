# 默认工具清单模板

工具在后台「智能硬件 → 默认工具」里按型号维护，用户侧「MCP / API」即时可见。

## 命名约定

- **工具编码 `code`**：小写字母 / 数字 / 连字符 / 下划线，进 MCP 工具名 `hw__<型号编码>__<工具编码>`；
- **指令编码 `commandCode`**（仅「指令下发」类）：设备端处理函数按它匹配，**必须与固件/示例里的字符串完全一致**；
- **执行通道**：
  - `指令下发（DEVICE）`：平台排队、设备取回执行、回执；适合 ESP32 等不长期在线监听的设备；
  - `设备直连（HTTP）`：设备自起 HTTP，平台直接调用；适合 Pi / Jetson 等常在线设备；
- **写动作 `write`**：会改设备状态或下发指令的工具勾选「写动作」；写动作还受授权闸约束（未授权 / 无人值守只出草案）。

## ESP32（示例）

| 名称 | 编码 | 种类 | 通道 | commandCode | 参数 Schema | 响应 | 写动作 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 读取设备状态 | `read-status` | MCP | DEVICE | `READ_STATUS` | `{"type":"object","properties":{}}` | `{"uptime_ms": 12345}` | 否 |
| 控制板载 LED | `set-led` | MCP | DEVICE | `SET_LED` | `{"type":"object","properties":{"on":{"type":"boolean"}},"required":["on"]}` | `{"on": true}` | 是 |

## Jetson Orin Nano（示例）

| 名称 | 编码 | 种类 | 通道 | commandCode | 参数 Schema | 响应 | 写动作 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 读取 SoC 温度 | `read-temperature` | MCP | DEVICE | `READ_TEMPERATURE` | `{"type":"object","properties":{}}` | `{"celsius": 45.2}` | 否 |
| 读取运行状态 | `read-status` | MCP | DEVICE | `READ_STATUS` | `{"type":"object","properties":{}}` | `{"uptime": 123.4}` | 否 |

## Raspberry Pi（示例，含 HTTP 直连）

| 名称 | 编码 | 种类 | 通道 | 方法 / 路径 | 参数 Schema | 响应 | 写动作 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 读取 CPU 温度 | `read-cpu-temp` | MCP | DEVICE | `READ_CPU_TEMP` | `{"type":"object","properties":{}}` | `{"celsius": 50.1}` | 否 |
| 运行状态（HTTP） | `http-status` | API | HTTP | `GET /status` | `{"type":"object","properties":{}}` | `{"ok": true, "uptime": 12.3}` | 否 |

> HTTP 类工具要求设备随心跳上报 `meta.baseUrl`，并真的在该地址提供对应路径。

## 常见错误

- **指令一直「回执超时」**：设备没在 30 秒内回执。检查设备是否在线、`toolCommandCode` 是否与固件里的处理函数一致、回执是否带回了正确的 `commandCode`。
- **MCP 看不到工具**：工具被停用、型号未上架，或设备不属于该型号。用户自建工具仅本人可见。
- **写工具只返回草案**：写动作未在「智能硬件 → MCP」授权，或调用来自无人值守任务。本人「试调」不受此限。
