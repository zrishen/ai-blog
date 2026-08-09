"""agent 域 service 包。

对外门面：stream_chat（api 层唯一入口）。
内部按职责拆分：orchestrator / messages / streaming / references / token_estimate。
"""

from .orchestrator import stream_chat

__all__ = ["stream_chat"]
