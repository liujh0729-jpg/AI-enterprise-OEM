# AIworkin 智能硬件开发包（Dev Kit）

让设备在 30 分钟内跑通心跳，并支持两类工具调用：

- **指令下发（DEVICE）**：平台把指令排队，设备心跳时取回、执行、回执；
- **设备直连（HTTP）**：设备自己起 HTTP 服务，平台按工具路径直接调用。

## 目录

```
hardware-devkit/
├─ README.md                 本文件：三步接入
├─ docs/
│  ├─ protocol.md            心跳 / 指令 / 回执逐字段说明
│  └─ tools.md               默认工具清单模板与命名约定
├─ python/                   Raspberry Pi / Jetson Orin Nano（纯标准库）
│  ├─ aiworkin_hardware/
│  │  ├─ client.py           心跳 / 指令 / 回执客户端
│  │  └─ http_tools.py       可选：设备直连（HTTP）工具服务端
│  └─ examples/
│     ├─ jetson_orin_nano.py
│     └─ raspberry_pi.py
├─ esp32/                    ESP32 / ESP32-S3（ESP-IDF 组件）
│  ├─ components/aiworkin_hardware/
│  └─ examples/quickstart/
└─ simulator/
   └─ simulate_device.mjs    无真机时验证整条链路
```

## 三步接入

1. **拿令牌**：页面「智能硬件 → 添加硬件」选型号接入设备，复制 `hw_` 开头的设备令牌（明文只显示一次）。
2. **填配置**：把平台地址与令牌填进示例的配置（ESP32 改 `main.c` 顶部宏；Python 用环境变量）。
3. **运行 / 烧录**：设备上线后，「我的设备」里状态在 1 个心跳周期内转为在线。

> 设备令牌只走设备通道（`/api/public/hardware/**`），不能调用任何业务接口；业务接口与 MCP 用的是另一把 `ek_` Key。

## 选择 SDK

| 型号 | 目录 | 说明 |
| --- | --- | --- |
| ESP32 / ESP32-S3 | `esp32/` | ESP-IDF 组件，`idf.py build flash monitor` |
| Jetson Orin Nano | `python/` | `python examples/jetson_orin_nano.py` |
| Raspberry Pi | `python/` | `python examples/raspberry_pi.py`，同时演示 HTTP 直连 |

Python 示例只依赖标准库，**无需 pip install**。

### Jetson / Pi 运行

```bash
cd hardware-devkit/python
export AIWORKIN_SERVER=https://your-site.example.com
export AIWORKIN_DEVICE_TOKEN=hw_xxxxxxxx
python examples/jetson_orin_nano.py
```

Pi 若要演示「设备直连（HTTP）」工具，再设 `AIWORKIN_PUBLIC_BASE_URL=http://<本机局域网IP>:8080`。

### ESP32 烧录

```bash
cd hardware-devkit/esp32/examples/quickstart
# 先改 main/main.c 顶部的 WIFI_SSID / WIFI_PASS / SERVER_URL / DEVICE_TOKEN
idf.py set-target esp32
idf.py build flash monitor
```

## 无真机时验证链路

用模拟器扮演一台设备，验证心跳、指令与回执：

```bash
cd hardware-devkit/simulator
HW_BASE_URL=https://your-site.example.com \
HW_DEVICE_TOKEN=hw_xxxxxxxx \
node simulate_device.mjs
```

模拟器会：每轮上报心跳 → 打印取回的指令 → 自动回执。随后在页面「试调」任一指令类工具，即可看到设备侧收到指令、平台侧收到回执。

## 工具指令码约定

工具在后台「智能硬件 → 默认工具」里维护。**指令下发（DEVICE）** 类工具要填「指令编码 commandCode」，设备端处理函数按它匹配，例如 `READ_STATUS`、`SET_LED`；两边必须完全一致，详见 [docs/tools.md](docs/tools.md)。
