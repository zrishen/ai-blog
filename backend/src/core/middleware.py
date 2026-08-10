"""ASGI 中间件：为每个请求注入 request_id（contextvar），供日志 / Sentry 关联同一次请求。

用纯 ASGI 而非 BaseHTTPMiddleware：后者会复制 context，在中间件内 set 的 ContextVar
不传播到下游路由处理器。纯 ASGI 在同一 task 内 set/reset，contextvar 正确传播。
"""

import uuid

from src.core.context import request_id_cv


class RequestIdMiddleware:
    """纯 ASGI 中间件：进入时生成 request_id 存入 contextvar，并在响应头回写 X-Request-ID。"""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = uuid.uuid4().hex[:8]
        token = request_id_cv.set(request_id)

        async def send_with_header(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers") or [])
                headers.append((b"x-request-id", request_id.encode("latin-1")))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_header)
        finally:
            request_id_cv.reset(token)
