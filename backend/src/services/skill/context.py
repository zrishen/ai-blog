"""SkillContext：skill 解析输出（seam-conventions §7 数据结构归属表）。

resolve_skills 产出；assemble_tools 取 required_tool_names，orchestrator 取
enabled_segment_names 填 PromptContext（1.3）。1.2 为桩数据，1.4 真实现读 SKILL_REGISTRY。
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SkillContext:
    required_tool_names: frozenset[str]
    enabled_segment_names: frozenset[str]
