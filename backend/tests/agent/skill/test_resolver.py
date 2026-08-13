"""resolve_skills 真实现单测（1.4）：读 SKILL_REGISTRY + DEFAULT_ENABLED_SKILLS 派生 SkillContext。

形状与 1.2 桩一致（SkillContext），不改 assemble_tools/PromptContext 调用点（seam-conventions §8）。
"""
import pytest

from src.services.agent.skill import DEFAULT_ENABLED_SKILLS, resolve_skills
from src.services.agent.skill.context import SkillContext
from src.tools.registry import tool_names_by_tag

_WRITING_SEGMENTS = frozenset({"writing_create_flow", "writing_mermaid", "writing_sidebar"})
_KNOWLEDGE_SEGMENTS = frozenset({"knowledge_library"})
_MEMORY_SEGMENTS = frozenset({"memory_recall"})


def test_resolve_skills_default_equals_default_enabled_skills():
    """默认（None）== DEFAULT_ENABLED_SKILLS（writing+knowledge+memory 全开）：10 工具 + 三组段。"""
    ctx = resolve_skills()
    assert isinstance(ctx, SkillContext)
    assert ctx.required_tool_names == (
        tool_names_by_tag("writing") | tool_names_by_tag("knowledge") | tool_names_by_tag("base")
        | tool_names_by_tag("memory")
    )
    assert len(ctx.required_tool_names) == 10
    assert ctx.enabled_segment_names == _WRITING_SEGMENTS | _KNOWLEDGE_SEGMENTS | _MEMORY_SEGMENTS


def test_resolve_skills_explicit_empty_enabled_ids():
    """显式空集 → 无 skill 工具 + 无 skill 段（base 已无工具）。"""
    ctx = resolve_skills(enabled_ids=frozenset())
    assert ctx.required_tool_names == tool_names_by_tag("base")
    assert ctx.enabled_segment_names == frozenset()


def test_resolve_skills_composes_knowledge_and_memory_without_writing():
    ctx = resolve_skills(enabled_ids=frozenset({"knowledge", "memory"}))

    assert ctx.required_tool_names == tool_names_by_tag("knowledge") | tool_names_by_tag("memory")
    assert ctx.enabled_segment_names == _KNOWLEDGE_SEGMENTS | _MEMORY_SEGMENTS


def test_resolve_skills_unknown_id_raises():
    """unknown skill id → ValueError fail loud（防 typo 静默丢 skill）。"""
    with pytest.raises(ValueError, match="unknown skill"):
        resolve_skills(enabled_ids=frozenset({"nonexistent"}))


def test_default_enabled_skills_is_full_set():
    """DEFAULT_ENABLED_SKILLS = writing + knowledge + memory（三类内置 skill 全开）。"""
    assert DEFAULT_ENABLED_SKILLS == frozenset({"writing", "knowledge", "memory"})


def test_default_enabled_skills_subset_of_registry():
    """默认启用集必须是已注册 skill（防 registry 演进后默认集指向幽灵 skill）。"""
    from src.services.agent.skill.descriptor import SKILL_REGISTRY

    assert DEFAULT_ENABLED_SKILLS <= SKILL_REGISTRY.keys()


def test_writing_segment_names_match_prompts():
    """字符串契约锁定：descriptor 段名 == prompts SEG_*.name。

    descriptor 不 import prompts（解耦），段名是字面量契约。若 prompts 改名而 descriptor 没跟，
    1.5 翻 default_active=False 后写作段将永不激活（静默致命）。此测在 CI 抓漂移。
    """
    from src.prompts import SEG_WRITING_CREATE, SEG_WRITING_MERMAID, SEG_WRITING_SIDEBAR
    from src.services.agent.skill.descriptor import WRITING_SEGMENT_NAMES

    assert WRITING_SEGMENT_NAMES == {
        SEG_WRITING_CREATE.name,
        SEG_WRITING_MERMAID.name,
        SEG_WRITING_SIDEBAR.name,
    }


def test_knowledge_segment_names_match_prompts():
    from src.prompts import SEG_KNOWLEDGE_LIBRARY
    from src.services.agent.skill.descriptor import KNOWLEDGE_SEGMENT_NAMES

    assert KNOWLEDGE_SEGMENT_NAMES == {SEG_KNOWLEDGE_LIBRARY.name}


def test_memory_segment_names_match_prompts():
    from src.prompts import SEG_MEMORY_RECALL
    from src.services.agent.skill.descriptor import MEMORY_SEGMENT_NAMES

    assert MEMORY_SEGMENT_NAMES == {SEG_MEMORY_RECALL.name}


def test_base_tool_set_snapshot():
    """base 标签内容锁定——防误重标（如 base_search_file→writing）致 base 集合静默收缩。"""
    assert tool_names_by_tag("knowledge") == {"base_search_file", "knowledge_query_graph"}
    assert tool_names_by_tag("memory") == {"base_recall_memory"}
    assert tool_names_by_tag("base") == frozenset()
