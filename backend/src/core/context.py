"""跨域运行时上下文。

current_user_id_cv：当前请求用户 ID 的上下文变量。
由 chat 编排在执行 LangGraph Agent 前 set，供 @tool 工具（blog/file/research）通过 .get() 取当前用户
（工具签名不带 user_id，靠上下文隐式传递）。

集中在此处作为单一来源，避免散落在各领域工具文件里。
"""

import contextvars

# 当前请求用户 ID。chat_service.stream_chat 在执行 Agent 前 set / finally reset。
# file / blog / research 工具通过 current_user_id_cv.get() 取当前用户。
current_user_id_cv: contextvars.ContextVar[int | None] = contextvars.ContextVar(
    "current_user_id", default=None
)
