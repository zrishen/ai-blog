"""跨域运行时上下文：当前请求用户 ID（current_user_id_cv）、请求 id（request_id_cv）。

current_user_id_cv：由 chat 编排在执行 LangGraph Agent 前 set / finally reset，
供 @tool 工具（签名不带 user_id）通过 .get() 取当前用户。
request_id_cv：由 ASGI request_id 中间件 set，供日志 filter / Sentry 关联同一次请求。
"""

import contextvars

current_user_id_cv: contextvars.ContextVar[int | None] = contextvars.ContextVar("current_user_id", default=None)

request_id_cv: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)
