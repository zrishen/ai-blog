"""skill 框架：用户 UI 显式启用 → 后端编排（注入指令段 + 挂载声明工具）。

1.4 落地 SKILL_REGISTRY + DEFAULT_ENABLED_SKILLS + resolve_skills 真实现（替换 1.2 桩）。
"""
from src.services.skill.context import SkillContext
from src.services.skill.descriptor import (
    DEFAULT_ENABLED_SKILLS,
    SKILL_REGISTRY,
    SkillDescriptor,
)
from src.services.skill.resolver import resolve_skills

__all__ = [
    "DEFAULT_ENABLED_SKILLS",
    "SKILL_REGISTRY",
    "SkillContext",
    "SkillDescriptor",
    "resolve_skills",
]
