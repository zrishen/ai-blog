"""chat/token_estimate 文本提取与 token 估算单元测试。

锁住估算公式（CJK 0.5 token、其余 0.25 token、最少 1）与 content/reasoning block
提取逻辑。estimate_tokens 是上下文长度预算的依据，此前仅靠 API 端到端间接覆盖。
"""

import pytest

from src.services.agent.token_estimate import (
    _extract_reasoning_content,
    _extract_text_content,
    estimate_tokens,
)


def test_extract_text_content_plain_str() -> None:
    assert _extract_text_content("hello") == "hello"


def test_extract_text_content_mixed_blocks() -> None:
    content = [
        "pre ",
        {"type": "text", "text": "a"},
        {"type": "output_text", "text": "b"},
        {"type": "other", "text": "ignored"},  # 非 text/output_text → 忽略
        {"type": "text", "content": "c"},  # 回退到 content 键
    ]
    assert _extract_text_content(content) == "pre abc"


def test_extract_text_content_non_list_returns_empty() -> None:
    assert _extract_text_content(123) == ""
    assert _extract_text_content(None) == ""


def test_extract_reasoning_content_collects_thinking_and_reasoning() -> None:
    content = [
        {"type": "thinking", "thinking": "T1"},
        {"type": "reasoning", "text": "R"},
        {"type": "text", "text": "ignored"},  # 非思考类 → 忽略
    ]
    assert _extract_reasoning_content(content) == "T1R"


def test_extract_reasoning_content_non_list_or_no_match_returns_empty() -> None:
    assert _extract_reasoning_content("x") == ""
    assert _extract_reasoning_content([{"type": "text"}]) == ""


@pytest.mark.parametrize(
    "text, expected",
    [
        ("hello", 1),  # 5 ascii → 5//4 = 1
        ("你好", 1),  # 2 cjk → 2//2 = 1
        ("你好世界", 2),  # 4 cjk → 4//2 = 2
        ("", 1),  # 空串兜底 max(1, 0)
        ("a你好", 1),  # cjk=2, other=1 → 1 + 0
    ],
)
def test_estimate_tokens(text: str, expected: int) -> None:
    assert estimate_tokens(text) == expected


def test_estimate_tokens_accepts_list_via_text_extraction() -> None:
    # list 输入 → 先 _extract_text_content 再估算
    assert estimate_tokens([{"type": "text", "text": "hello"}]) == 1


def test_estimate_tokens_accepts_none_as_empty() -> None:
    # assistant tool_calls 消息的 content 可能为 None（合法），不应崩溃（曾致 stream_chat 500）
    assert estimate_tokens(None) == 1


def test_estimate_tokens_includes_image_blocks() -> None:
    # 多模态消息：文本 + 图片块，token = 文本 token + 图片基础值 + base64 折算
    content = [
        {"type": "text", "text": "hello"},
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "a" * 400}},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64," + "b" * 400}},
    ]
    total = estimate_tokens(content)
    # 文本 1 + 图片1(500 + 400//400=1) + 图片2(500 + 400//400=1) = 1003
    assert total >= 1002  # 500+1 + 500+1 + 1
