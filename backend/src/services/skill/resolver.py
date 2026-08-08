"""resolve_skills 真实现（1.4）：读 SKILL_REGISTRY + DEFAULT_ENABLED_SKILLS 派生 SkillContext。

通用底座工具（tag="base"）always required（P2 知识库/记忆 skill 化后改 tag 交对应 skill）。
enabled skill 的 required_tool_tag 工具 + enabled_segment_names 段聚合返回。
形状与 1.2 桩严格一致（SkillContext），不改 assemble_tools/PromptContext 调用点。
"""
from __future__ import annotations

from src.services.skill.context import SkillContext
from src.services.skill.descriptor import DEFAULT_ENABLED_SKILLS, SKILL_REGISTRY
from src.tools.registry import tool_names_by_tag


def resolve_skills(enabled_ids: frozenset[str] | None = None) -> SkillContext:
    """按 enabled_ids 聚合 skill 的 required tools + enabled segments。

    - enabled_ids=None → DEFAULT_ENABLED_SKILLS（向后兼容 1.3 调用形态 resolve_skills()）。
    - unknown skill id → ValueError fail loud（防 typo 静默丢 skill）。
    - 默认场景（writing 启用）== 1.3 桩结果：9 工具 required（base 2 + writing 7）+ writing×3 segments。
    """
    enabled = enabled_ids if enabled_ids is not None else DEFAULT_ENABLED_SKILLS

    required: set[str] = set(tool_names_by_tag("base"))  # 通用底座 always required
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
