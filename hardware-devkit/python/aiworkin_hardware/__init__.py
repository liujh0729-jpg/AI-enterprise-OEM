"""AIworkin 智能硬件设备 SDK（Python，纯标准库，无第三方依赖）。

覆盖设备通道的三件事：
  1. 心跳上报（POST /api/public/hardware/heartbeat）——刷新在线状态，顺带取回待办指令；
  2. 指令处理（心跳返回的 commands，或 GET /api/public/hardware/commands）；
  3. 回执上报（POST /api/public/hardware/result）——按唯一 commandCode 匹配下发。

适用 Raspberry Pi / Jetson Orin Nano 等能跑 Python 3.8+ 的 Linux 设备。
只依赖标准库，不需要 pip install。
"""

from .client import DeviceClient, DeviceChannelError, Command
from .http_tools import HttpToolServer

__all__ = ["DeviceClient", "DeviceChannelError", "Command", "HttpToolServer"]
__version__ = "1.0.0"
