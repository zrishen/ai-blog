"""第 4 seam 接口：工具行为描述符（ToolBehaviorDescriptor）。

纯接口定义——封装工具的「结果投影」（on_tool_end → blog_meta/references）与「流式
投射」（on_chat_model_stream → 增量 marker）两类副作用。handler 实现与 descriptor
单例在 services/agent/tool_behaviors.py，由 orchestrator 注入 assemble_tools。
registry/provider 仅引用此接口，保持 tools→services 零运行时依赖。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from src.services.agent.streaming import StreamProjector


@dataclass(frozen=True)
class ResultContext:
    """on_tool_end 投影上下文：工具名 + 返回文本 + 工具输入（call_id 解析后的 input）。"""

    tool_name: str
    result_text: str
    tool_input: dict | None


@dataclass(frozen=True)
class ToolBehaviorDescriptor:
    """工具行为描述：on_result 返回 merge 进 SSE end payload 的 dict；

    stream_projector_factory 产 per-idx 流式投射状态机（on_chat_model_stream 用）。
    两者皆可空——无副作用的工具（如 blog_read_post）挂 None。
    """

    on_result: Callable[[ResultContext], dict] | None = None
    stream_projector_factory: Callable[[], "StreamProjector"] | None = None
