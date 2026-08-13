"""resolve_skills 真实现：读 SKILL_REGISTRY + DEFAULT_ENABLED_SKILLS 派生 SkillContext。

enabled skill 的 required_tool_tag 工具 + enabled_segment_names 段聚合返回。
默认启用集由 DEFAULT_ENABLED_SKILLS 决定（当前 writing + knowledge + memory）。
输出形状遵循 SkillContext，不改 assemble_tools/PromptContext 调用点。
"""
from __future__ import annotations

from src.services.agent.skill.context import SkillContext
from src.services.agent.skill.descriptor import DEFAULT_ENABLED_SKILLS, SKILL_REGISTRY
from src.tools.registry import tool_names_by_tag


def resolve_skills(enabled_ids: frozenset[str] | None = None) -> SkillContext:
    """按 enabled_ids 聚合 skill 的 required tools + enabled segments。

    - enabled_ids=None → DEFAULT_ENABLED_SKILLS（向后兼容无参调用 resolve_skills()）。
    - unknown skill id → ValueError fail loud（防 typo 静默丢 skill）。
    - 默认场景（DEFAULT_ENABLED_SKILLS 全开）：写作/知识库/记忆工具与对应指令段均激活。
    """
    enabled = enabled_ids if enabled_ids is not None else DEFAULT_ENABLED_SKILLS

    required: set[str] = set()
    segments: set[str] = set()
    for sid in enabled:
        if sid not in SKILL_REGISTRY:
            raise ValueError(f"unknown skill id: {sid}")
        skill = SKILL_REGISTRY[sid]
        required |= tool_names_by_tag(skill.required_tool_tag)
        segments |= skill.enabled_segment_names

    return SkillContext(
        required_tool_names=frozenset(required),
        enabled_segment_names=frozenset(segments),
    )
