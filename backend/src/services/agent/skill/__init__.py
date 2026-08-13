"""skill 框架：用户 UI 显式启用 → 后端编排（注入指令段 + 挂载声明工具）。"""

from src.services.agent.skill.context import SkillContext
from src.services.agent.skill.descriptor import (
    DEFAULT_ENABLED_SKILLS,
    SKILL_REGISTRY,
    SkillDescriptor,
)
from src.services.agent.skill.resolver import resolve_skills

__all__ = [
    "DEFAULT_ENABLED_SKILLS",
    "SKILL_REGISTRY",
    "SkillContext",
    "SkillDescriptor",
    "resolve_skills",
]
