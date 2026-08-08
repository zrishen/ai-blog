"""Skill 声明注册表（seam-conventions §7）：skill = {声明工具 tag + 启用的 prompt 段名}。

1.4 落地：SKILL_REGISTRY + DEFAULT_ENABLED_SKILLS。resolve_skills 读此派生 SkillContext。
指令文本是 PromptSegment 段（prompts.py 唯一源）；skill 只声明「启用哪些段名」（字符串契约，
不 import prompts，解耦）。删 instructions（seam-conventions §6 裁定#2）。
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SkillDescriptor:
    """一个可启用 skill 的声明。

    - required_tool_tag：TOOL_REGISTRY 中此 tag 的工具 = skill 声明挂载的工具
      （tool_names_by_tag 派生，统一工具名源，无工具名字面量副本）。
    - enabled_segment_names：skill 启用时激活的 PromptSegment 段名（prompts.py SEG_*.name）。
      1.4 段多 default_active=True，此集合为 1.5 翻 default_active=False 后的激活源铺路。
    """

    id: str
    name: str
    description: str
    required_tool_tag: str
    enabled_segment_names: frozenset[str]


# 写作 skill 启用的 prompt 段名（与 prompts.py SEG_WRITING_*.name 一致——字符串契约，不 import prompts）
WRITING_SEGMENT_NAMES = frozenset({"writing_create_flow", "writing_mermaid", "writing_sidebar"})

SKILL_REGISTRY: dict[str, SkillDescriptor] = {
    "writing": SkillDescriptor(
        id="writing",
        name="写作",
        description="博客文章创作：创建/编辑/搜索文章 + 侧栏定制",
        required_tool_tag="writing",
        enabled_segment_names=WRITING_SEGMENT_NAMES,
    ),
}

# 默认启用的 skill（用户未传 enabled_skills 时）；1.4 仅 writing（知识库/记忆 P2 skill 化）
DEFAULT_ENABLED_SKILLS: frozenset[str] = frozenset({"writing"})
