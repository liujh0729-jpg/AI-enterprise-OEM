"""可选：给「设备直连（HTTP）」工具用的轻量 HTTP 服务端（纯标准库）。

平台调用 HTTP 类工具时，会把工具参数作为 JSON 请求体发到
`<meta.baseUrl><工具 path>`，并带上 `x-device-token-hash`（sha256(令牌) 的十六进制）。
本模块校验这个头，再按 (方法, 路径) 分发到注册的处理函数，返回 JSON。

不是所有设备都需要它：用「指令下发（DEVICE）」通道的工具走心跳/回执即可，
只有管理员把工具设成「设备直连（HTTP）」时才需要设备自己起 HTTP 服务。
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Dict, Optional, Tuple

logger = logging.getLogger("aiworkin_hardware")

HttpHandler = Callable[[Dict[str, Any]], Dict[str, Any]]
RouteKey = Tuple[str, str]


class HttpToolServer:
    """把工具 path 映射到处理函数的最小 HTTP 服务端。"""

    def __init__(self, device_token: str, *, host: str = "0.0.0.0", port: int = 8080) -> None:
        if not device_token:
            raise ValueError("device_token 不能为空")
        self._expected_hash = hashlib.sha256(device_token.encode("utf-8")).hexdigest()
        self.host = host
        self.port = port
        self._routes: Dict[RouteKey, HttpHandler] = {}
        self._server: Optional[ThreadingHTTPServer] = None
        self._thread: Optional[threading.Thread] = None

    def register(self, method: str, path: str, handler: HttpHandler) -> None:
        """注册一个工具路径，例如 register("POST", "/gpio", fn)。path 要和工具里填的一致。"""
        key = (method.upper(), path if path.startswith("/") else f"/{path}")
        self._routes[key] = handler

    def _dispatch(self, method: str, path: str, args: Dict[str, Any]) -> Dict[str, Any]:
        handler = self._routes.get((method.upper(), path))
        if handler is None:
            return {"__status__": 404, "error": f"未实现 {method} {path}"}
        try:
            result = handler(args)
        except Exception as exc:  # 处理函数异常返回 500，不拖垮服务
            logger.exception("HTTP 工具 %s %s 执行异常", method, path)
            return {"__status__": 500, "error": str(exc)[:200]}
        return result if isinstance(result, dict) else {"result": result}

    def _build_handler(self) -> type[BaseHTTPRequestHandler]:
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def _handle(self) -> None:  # noqa: N802
                if self.headers.get("x-device-token-hash", "") != outer._expected_hash:
                    self._send(401, {"ok": False, "error": "令牌校验失败"})
                    return
                length = int(self.headers.get("content-length", "0") or 0)
                raw = self.rfile.read(length) if length else b""
                try:
                    args = json.loads(raw.decode("utf-8")) if raw else {}
                except json.JSONDecodeError:
                    args = {}
                if not isinstance(args, dict):
                    args = {}
                result = outer._dispatch(self.command, self.path.split("?", 1)[0], args)
                status = int(result.pop("__status__", 200))
                self._send(status, result)

            def _send(self, status: int, payload: Dict[str, Any]) -> None:
                body = json.dumps(payload).encode("utf-8")
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self) -> None:  # noqa: N802
                self._handle()

            def do_POST(self) -> None:  # noqa: N802
                self._handle()

            def do_PUT(self) -> None:  # noqa: N802
                self._handle()

            def log_message(self, fmt: str, *args: Any) -> None:  # 安静一点
                logger.debug("http %s - %s", self.address_string(), fmt % args)

        return Handler

    def serve_forever(self) -> None:
        self._server = ThreadingHTTPServer((self.host, self.port), self._build_handler())
        logger.info("HTTP 工具服务监听 %s:%d", self.host, self.port)
        self._server.serve_forever()

    def start(self) -> None:
        """后台线程启动。"""
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self.serve_forever, name="aiworkin-http-tools", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._server:
            self._server.shutdown()
            self._server.server_close()
            self._server = None
        if self._thread:
            self._thread.join(timeout=3)
            self._thread = None
