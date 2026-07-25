"""chat 域 service 包。

对外门面：stream_chat（api 层唯一入口）+ LLM 工厂（public_chat / research 复用）。
内部按职责拆分：orchestrator / llm_factory / messages / streaming / references / token_estimate。
"""

from .llm_factory import _chat_model_kwargs, _create_llm
from .orchestrator import stream_chat

__all__ = ["stream_chat", "_create_llm", "_chat_model_kwargs"]
