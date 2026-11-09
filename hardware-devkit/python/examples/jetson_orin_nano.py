#!/usr/bin/env python3
"""Jetson Orin Nano 最小示例：心跳 + 指令处理 + 回执（「指令下发」通道）。

运行前准备：
  1. 在页面「智能硬件 → 添加硬件」接入一台 jetson-orin-nano 型号设备，复制 hw_ 令牌；
  2. 后台「默认工具」给该型号建工具，记下每个工具的「指令编码 commandCode」；
  3. 设置环境变量后运行本脚本，设备会在 1 个心跳周期内上线。

环境变量：
  AIWORKIN_SERVER        平台地址，如 https://your-site.example.com（不带 /api/...）
  AIWORKIN_DEVICE_TOKEN  设备令牌 hw_...
  AIWORKIN_FIRMWARE      固件版本（可选，默认 jetson-orin-nano-1.0.0）
  AIWORKIN_HEARTBEAT     心跳间隔秒（可选，默认 30）
"""

import logging
import os
import time

from aiworkin_hardware import DeviceClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def read_temperature(_args):
    """读取 SoC 温度（Jetson 常见 thermal zone）。"""
    try:
        with open("/sys/devices/virtual/thermal/thermal_zone0/temp", "r", encoding="utf-8") as fh:
            milli = int(fh.read().strip())
        return {"celsius": round(milli / 1000.0, 2)}
    except OSError:
        return {"celsius": None, "note": "thermal zone 不可读，请在真机上确认路径"}


def read_status(_args):
    return {
        "uptime": round(time.monotonic(), 1),
        "firmware": os.environ.get("AIWORKIN_FIRMWARE", "jetson-orin-nano-1.0.0"),
    }


def main():
    server = os.environ["AIWORKIN_SERVER"]
    token = os.environ["AIWORKIN_DEVICE_TOKEN"]
    client = DeviceClient(
        server,
        token,
        firmware_version=os.environ.get("AIWORKIN_FIRMWARE", "jetson-orin-nano-1.0.0"),
        heartbeat_interval=float(os.environ.get("AIWORKIN_HEARTBEAT", "30")),
    )
    # 指令码必须与后台工具里的 commandCode 完全一致。
    client.register("READ_TEMPERATURE", read_temperature)
    client.register("READ_STATUS", read_status)
    client.run_forever()


if __name__ == "__main__":
    main()
