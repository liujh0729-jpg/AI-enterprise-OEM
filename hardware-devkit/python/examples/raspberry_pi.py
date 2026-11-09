#!/usr/bin/env python3
"""Raspberry Pi 最小示例：同时演示「指令下发（DEVICE）」与「设备直连（HTTP）」两种通道。

环境变量：
  AIWORKIN_SERVER            平台地址，如 https://your-site.example.com
  AIWORKIN_DEVICE_TOKEN      设备令牌 hw_...
  AIWORKIN_PUBLIC_BASE_URL   本机对外可访问地址（可选），如 http://192.168.1.20:8080；
                             填了才会启动 HTTP 工具服务并随心跳上报 meta.baseUrl
  AIWORKIN_HTTP_PORT         HTTP 工具服务端口（可选，默认 8080）
  AIWORKIN_HEARTBEAT         心跳间隔秒（可选，默认 30）
"""

import logging
import os
import time

from aiworkin_hardware import DeviceClient, HttpToolServer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def read_cpu_temp(_args):
    try:
        with open("/sys/class/thermal/thermal_zone0/temp", "r", encoding="utf-8") as fh:
            return {"celsius": round(int(fh.read().strip()) / 1000.0, 2)}
    except OSError:
        return {"celsius": None, "note": "thermal zone 不可读"}


def http_status(_args):
    return {"ok": True, "uptime": round(time.monotonic(), 1)}


def main():
    server = os.environ["AIWORKIN_SERVER"]
    token = os.environ["AIWORKIN_DEVICE_TOKEN"]
    public_base = os.environ.get("AIWORKIN_PUBLIC_BASE_URL", "").strip()
    http_port = int(os.environ.get("AIWORKIN_HTTP_PORT", "8080"))

    if public_base:
        # 只有把工具设成「设备直连（HTTP）」时才需要；路径要和工具里填的一致。
        http = HttpToolServer(token, port=http_port)
        http.register("GET", "/status", http_status)
        http.start()

    client = DeviceClient(
        server,
        token,
        firmware_version="raspberry-pi-1.0.0",
        report_base_url=public_base,
        heartbeat_interval=float(os.environ.get("AIWORKIN_HEARTBEAT", "30")),
    )
    client.register("READ_CPU_TEMP", read_cpu_temp)
    client.run_forever()


if __name__ == "__main__":
    main()
