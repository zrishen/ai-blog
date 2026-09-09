"""blog_tag_service 标签解析与建议单元测试。

锁住 _parse_tags/_clean_tag 的多格式兼容（逗号/中文逗号/顿号/换行、去编号/引号/后缀、
长度与数量上限）+ suggest_tags 的主路径（mock _call_llm，避免真实 LLM 调用）。
"""

from types import SimpleNamespace

import pytest

from src.services.workspace.blog import blog_tag_service
from src.services.workspace.blog.blog_tag_service import _clean_tag, _parse_tags


# ── _clean_tag ──

@pytest.mark.parametrize(
    "raw, expected",
    [
        ("AI", "AI"),
        ("1. AI", "AI"),  # 去编号
        ("- AI", "AI"),  # 去列表符
        ("「机器学习」", "机器学习"),  # 去引号
        ("深度学习;", "深度学习"),  # 去后缀分号
        ("A", None),  # 长度 < 2
        ("", None),
        ("   ", None),
    ],
)
def test_clean_tag(raw: str, expected: str | None) -> None:
    assert _clean_tag(raw) == expected


# ── _parse_tags ──

def test_parse_tags_comma_and_chinese_sep() -> None:
    assert _parse_tags("AI, 机器学习、深度学习") == ["AI", "机器学习", "深度学习"]


def test_parse_tags_empty_returns_empty() -> None:
    assert _parse_tags("") == []
    assert _parse_tags("   ") == []


def test_parse_tags_capped_at_five() -> None:
    tags = _parse_tags("aa,bb,cc,dd,ee,ff,gg")
    assert tags == ["aa", "bb", "cc", "dd", "ee"]


# ── suggest_tags（mock _call_llm）──

async def test_suggest_tags_success(monkeypatch) -> None:
    async def fake_call(prompt):
        return "AI, 机器学习, 深度学习"

    monkeypatch.setattr(blog_tag_service, "_call_llm", fake_call)
    post = SimpleNamespace(id=1, title="T", excerpt="E", content="C")
    assert await blog_tag_service.suggest_tags(post) == ["AI", "机器学习", "深度学习"]


async def test_suggest_tags_reads_working_body_through_seam(monkeypatch) -> None:
    prompts: list[str] = []

    async def fake_call(prompt):
        prompts.append(prompt)
        return "AI"

    monkeypatch.setattr(blog_tag_service, "_call_llm", fake_call)
    async def body_from_seam(_post):
        return "body from seam"

    monkeypatch.setattr(blog_tag_service, "get_post_body", body_from_seam)
    post = SimpleNamespace(id=1, title="T", excerpt="", content="legacy body")

    assert await blog_tag_service.suggest_tags(post) == ["AI"]
    assert "body from seam" in prompts[0]
    assert "legacy body" not in prompts[0]


async def test_suggest_tags_empty_input_returns_empty(monkeypatch) -> None:
    # 既无 title 也无 excerpt → 不调 LLM，直接返回 []
    called = False

    async def fake_call(prompt):
        nonlocal called
        called = True
        return "x"

    async def fake_body(post):
        return ""

    monkeypatch.setattr(blog_tag_service, "_call_llm", fake_call)
    monkeypatch.setattr(blog_tag_service, "get_post_body", fake_body)
    post = SimpleNamespace(id=1, title="", excerpt="", content="")
    assert await blog_tag_service.suggest_tags(post) == []
    assert called is False  # 未调 LLM


async def test_suggest_tags_retries_then_empty(monkeypatch) -> None:
    # LLM 持续返回无法解析的内容 → 重试后返回 []
    calls = 0

    async def fake_call(prompt):
        nonlocal calls
        calls += 1
        return "   "  # _parse_tags 返回空

    monkeypatch.setattr(blog_tag_service, "_call_llm", fake_call)
    post = SimpleNamespace(id=1, title="T", excerpt="E", content="C")
    assert await blog_tag_service.suggest_tags(post) == []
    assert calls == blog_tag_service.TAG_SUGGEST_RETRIES  # 重试满次数
