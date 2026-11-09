"""设备通道客户端：心跳 / 指令 / 回执。纯标准库实现，Linux 设备（Pi / Jetson）直接可用。"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger("aiworkin_hardware")

# 与后端契约保持一致：设备令牌请求头。
DEVICE_TOKEN_HEADER = "x-device-token"

# 处理函数签名：入参为工具 args，返回设备响应（dict）或 None。
CommandHandler = Callable[[Dict[str, Any]], Optional[Dict[str, Any]]]


class DeviceChannelError(RuntimeError):
    """设备通道调用失败（网络错误、令牌无效、设备停用等）。"""


@dataclass
class Command:
    """平台下发的一条指令。"""

    event_id: int
    #: 唯一命令号，回执时必须原样带回。
    command_code: str
    #: 工具声明的指令码，设备据此决定执行哪个动作。
    tool_command_code: str
    args: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_json(cls, raw: Dict[str, Any]) -> "Command":
        return cls(
            event_id=int(raw.get("eventId", 0)),
            command_code=str(raw.get("commandCode", "")),
            tool_command_code=str(raw.get("toolCommandCode", "")),
            args=raw.get("args") if isinstance(raw.get("args"), dict) else {},
        )


class DeviceClient:
    """一个设备一个实例。构造后 register() 处理函数，再 run_forever() 或 start()。"""

    def __init__(
        self,
        server_url: str,
        device_token: str,
        *,
        firmware_version: str = "",
        report_base_url: str = "",
        heartbeat_interval: float = 30.0,
        request_timeout: float = 15.0,
    ) -> None:
        if not server_url:
            raise ValueError("server_url 不能为空，例如 https://your-site.example.com")
        if not device_token:
            raise ValueError("device_token 不能为空，格式 hw_...")
        self.server_url = server_url.rstrip("/")
        self.device_token = device_token
        self.firmware_version = firmware_version
        # 若本设备也提供 HTTP 直连工具，把对外可访问地址填在这里，随心跳上报。
        self.report_base_url = report_base_url
        self.heartbeat_interval = max(5.0, float(heartbeat_interval))
        self.request_timeout = request_timeout
        self._handlers: Dict[str, CommandHandler] = {}
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    # ------------------------------------------------------------ 注册处理函数

    def register(self, tool_command_code: str, handler: CommandHandler) -> None:
        """注册某个工具指令码的处理函数。tool_command_code 即工具里的 commandCode。"""
        self._handlers[tool_command_code] = handler

    # ------------------------------------------------------------ HTTP 基础

    def _request(self, method: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self.server_url}{path}"
        data = None
        headers = {DEVICE_TOKEN_HEADER: self.device_token, "accept": "application/json"}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["content-type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.request_timeout) as resp:
                body = resp.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")
            raise DeviceChannelError(f"{method} {path} -> HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise DeviceChannelError(f"{method} {path} 连接失败: {exc.reason}") from exc
        try:
            parsed = json.loads(body) if body else {}
        except json.JSONDecodeError as exc:
            raise DeviceChannelError(f"{method} {path} 返回不是 JSON: {body[:200]}") from exc
        if not isinstance(parsed, dict):
            raise DeviceChannelError(f"{method} {path} 返回形状异常")
        if parsed.get("ok") is False:
            raise DeviceChannelError(str(parsed.get("message") or "设备通道返回失败"))
        return parsed

    # ------------------------------------------------------------ 三个动作

    def heartbeat(self) -> list[Command]:
        """上报心跳并取回待办指令。"""
        meta: Dict[str, Any] = {}
        if self.report_base_url:
            meta["baseUrl"] = self.report_base_url
        data = self._request(
            "POST",
            "/api/public/hardware/heartbeat",
            {"firmwareVersion": self.firmware_version, "meta": meta},
        )
        return [Command.from_json(item) for item in (data.get("commands") or [])]

    def poll_commands(self) -> list[Command]:
        """主动拉取待办指令（不带心跳回执的客户端用）。"""
        data = self._request("GET", "/api/public/hardware/commands")
        return [Command.from_json(item) for item in (data.get("commands") or [])]

    def report_result(
        self,
        command_code: str,
        *,
        ok: bool,
        message: str = "",
        response: Optional[Dict[str, Any]] = None,
    ) -> None:
        """上报一条指令的回执。command_code 用收到的唯一命令号。"""
        payload: Dict[str, Any] = {"commandCode": command_code, "ok": ok, "message": message}
        if response is not None:
            payload["response"] = response
        self._request("POST", "/api/public/hardware/result", payload)

    # ------------------------------------------------------------ 指令分发

    def handle(self, command: Command) -> None:
        """执行一条指令并回报结果；无处理函数或异常都会回报 ok=False。"""
        handler = self._handlers.get(command.tool_command_code)
        if handler is None:
            logger.warning("未注册指令 %s 的处理函数，回报失败", command.tool_command_code)
            self.report_result(
                command.command_code,
                ok=False,
                message=f"设备未实现指令 {command.tool_command_code}",
            )
            return
        try:
            result = handler(command.args)
        except Exception as exc:  # 设备侧异常不能让通道断掉
            logger.exception("指令 %s 执行异常", command.tool_command_code)
            self.report_result(command.command_code, ok=False, message=str(exc)[:200])
            return
        self.report_result(
            command.command_code,
            ok=True,
            message="",
            response=result if isinstance(result, dict) else None,
        )

    # ------------------------------------------------------------ 主循环

    def run_once(self) -> list[Command]:
        """跑一轮：心跳 + 处理带回的指令。返回本轮处理的指令。"""
        commands = self.heartbeat()
        for command in commands:
            self.handle(command)
        return commands

    def run_forever(self) -> None:
        """阻塞式主循环：按心跳间隔上报并处理指令。"""
        logger.info("设备通道启动：%s（间隔 %.0fs）", self.server_url, self.heartbeat_interval)
        while not self._stop.is_set():
            try:
                self.run_once()
            except DeviceChannelError as exc:
                logger.warning("本轮心跳失败：%s", exc)
            self._stop.wait(self.heartbeat_interval)

    def start(self) -> None:
        """后台线程方式启动主循环。"""
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self.run_forever, name="aiworkin-hardware", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        """停止主循环。"""
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=self.request_timeout + 1)
            self._thread = None
