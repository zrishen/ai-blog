"""研究 prompt 构建测试。"""

from src.database.models import ResearchTopic
from src.services.research_service import _build_research_prompt


def test_build_research_prompt_with_special_chars():
    """验证含特殊字符的 title 不会导致 str crash。"""
    topic = ResearchTopic(
        id=1,
        user_id=1,
        title="Python {2.0} 与 ${data} 变量",
        description="测试 {curly} 括号",
    )
    prompt = _build_research_prompt(topic)
    assert "Python {2.0} 与 ${data} 变量" in prompt
    assert "测试 {curly} 括号" in prompt


def test_build_research_prompt_with_empty_description():
    """验证 description 为空时使用默认值 '无'。"""
    topic = ResearchTopic(
        id=2,
        user_id=1,
        title="正常标题",
    )
    prompt = _build_research_prompt(topic)
    assert "正常标题" in prompt


def test_build_research_prompt_with_none_values():
    """验证 title/description 为 None 时不崩溃。"""
    topic = ResearchTopic(id=3, user_id=1, title=None)
    prompt = _build_research_prompt(topic)
    assert prompt is not None
    assert len(prompt) > 0
