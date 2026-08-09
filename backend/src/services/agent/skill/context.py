"""SkillContext：skill 解析输出。

resolve_skills 产出；assemble_tools 取 required_tool_names，orchestrator 取
enabled_segment_names 填 PromptContext。
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SkillContext:
    required_tool_names: frozenset[str]
    enabled_segment_names: frozenset[str]
