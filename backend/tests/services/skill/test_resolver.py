"""resolve_skills 真实现单测（1.4）：读 SKILL_REGISTRY + DEFAULT_ENABLED_SKILLS 派生 SkillContext。

形状与 1.2 桩一致（SkillContext），不改 assemble_tools/PromptContext 调用点（seam-conventions §8）。
"""
import pytest

from src.services.skill import DEFAULT_ENABLED_SKILLS, resolve_skills
from src.services.skill.context import SkillContext
from src.tools.registry import tool_names_by_tag

_WRITING_SEGMENTS = frozenset({"writing_create_flow", "writing_mermaid", "writing_sidebar"})


def test_resolve_skills_default_equals_writing_plus_base():
    """默认（None）== DEFAULT_ENABLED_SKILLS={'writing'}：required=writing+base 共 9 工具，segments=writing×3。"""
    ctx = resolve_skills()
    assert isinstance(ctx, SkillContext)
    assert ctx.required_tool_names == tool_names_by_tag("writing") | tool_names_by_tag("base")
    assert len(ctx.required_tool_names) == 9
    assert ctx.enabled_segment_names == _WRITING_SEGMENTS


def test_resolve_skills_explicit_empty_enabled_ids():
    """显式空集 → 仅 base 通用底座工具 + 无 skill 段（writing 不启用）。"""
    ctx = resolve_skills(enabled_ids=frozenset())
    assert ctx.required_tool_names == tool_names_by_tag("base")
    assert ctx.enabled_segment_names == frozenset()


def test_resolve_skills_unknown_id_raises():
    """unknown skill id → ValueError fail loud（防 typo 静默丢 skill）。"""
    with pytest.raises(ValueError, match="unknown skill"):
        resolve_skills(enabled_ids=frozenset({"nonexistent"}))


def test_default_enabled_skills_is_writing():
    """DEFAULT_ENABLED_SKILLS={'writing'}（1.4 仅 writing；知识库/记忆 P2 skill 化）。"""
    assert DEFAULT_ENABLED_SKILLS == frozenset({"writing"})


def test_writing_segment_names_match_prompts():
    """字符串契约锁定：descriptor 段名 == prompts SEG_*.name。

    descriptor 不 import prompts（解耦），段名是字面量契约。若 prompts 改名而 descriptor 没跟，
    1.5 翻 default_active=False 后写作段将永不激活（静默致命）。此测在 CI 抓漂移。
    """
    from src.prompts import SEG_WRITING_CREATE, SEG_WRITING_MERMAID, SEG_WRITING_SIDEBAR
    from src.services.skill.descriptor import WRITING_SEGMENT_NAMES

    assert WRITING_SEGMENT_NAMES == {
        SEG_WRITING_CREATE.name,
        SEG_WRITING_MERMAID.name,
        SEG_WRITING_SIDEBAR.name,
    }


def test_base_tool_set_snapshot():
    """base 标签内容锁定——防误重标（如 base_search_file→writing）致 base 集合静默收缩。"""
    assert tool_names_by_tag("base") == {"base_search_file", "base_recall_memory"}
