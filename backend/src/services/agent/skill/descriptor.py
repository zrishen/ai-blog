"""Skill 声明注册表：skill = {声明工具 tag + 启用的 prompt 段名}。

SKILL_REGISTRY + DEFAULT_ENABLED_SKILLS 为唯一源，resolve_skills 读此派生 SkillContext。
指令文本是 PromptSegment 段（prompts.py 唯一源）；skill 只声明「启用哪些段名」（字符串契约，
不 import prompts，解耦）；不内嵌 instructions 文本（由 prompts.py 段承载）。
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SkillDescriptor:
    """一个可启用 skill 的声明。

    - required_tool_tag：TOOL_REGISTRY 中此 tag 的工具 = skill 声明挂载的工具
      （tool_names_by_tag 派生，统一工具名源，无工具名字面量副本）。
    - enabled_segment_names：skill 启用时激活的 PromptSegment 段名（prompts.py SEG_*.name）。
      写作段在 prompts.py 中默认 default_active=False，此集合为其激活源（skill 启用 → enabled_segments 含 writing×3）。
    """

    id: str
    name: str
    description: str
    required_tool_tag: str
    enabled_segment_names: frozenset[str]


# 写作 skill 启用的 prompt 段名（与 prompts.py SEG_WRITING_*.name 一致——字符串契约，不 import prompts）
WRITING_SEGMENT_NAMES = frozenset({"writing_create_flow", "writing_mermaid", "writing_sidebar"})
KNOWLEDGE_SEGMENT_NAMES = frozenset({"knowledge_library"})
MEMORY_SEGMENT_NAMES = frozenset({"memory_recall"})

SKILL_REGISTRY: dict[str, SkillDescriptor] = {
    "writing": SkillDescriptor(
        id="writing",
        name="写作",
        description="博客文章创作：创建/编辑/搜索文章 + 侧栏定制",
        required_tool_tag="writing",
        enabled_segment_names=WRITING_SEGMENT_NAMES,
    ),
    "knowledge": SkillDescriptor(
        id="knowledge",
        name="知识库",
        description="检索已加入知识库的文档，并查询其中提取出的实体与事实关系",
        required_tool_tag="knowledge",
        enabled_segment_names=KNOWLEDGE_SEGMENT_NAMES,
    ),
    "memory": SkillDescriptor(
        id="memory",
        name="记忆",
        description="回忆用户过往对话、偏好、实体关系和有时效的事实",
        required_tool_tag="memory",
        enabled_segment_names=MEMORY_SEGMENT_NAMES,
    ),
}

# 默认启用的 skill（用户未传 enabled_skills 时）；目前仅 writing（知识库/记忆待 skill 化）
DEFAULT_ENABLED_SKILLS: frozenset[str] = frozenset({"writing", "knowledge", "memory"})
