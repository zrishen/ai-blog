"""chat/streaming partial-JSON 增量解析单元测试。

锁住流式工具参数解析：从尚未闭合的 JSON 里实时抽取字段（前端据此边生成边渲染）。
覆盖整数提取 + content/任意字符串字段提取 + JSON 转义（\\n \\/ \" 等）+ \\u Unicode 与
surrogate pair + partial 未闭合。这些解析器是 SSE 渲染的核心，此前仅靠 API 端到端间接覆盖。
"""

import pytest

from src.services.chat.streaming import (
    _compact_json,
    _extract_partial_content,
    _extract_partial_int,
    _extract_partial_json_string,
    _extract_partial_replacement,
    _extract_partial_target,
)


def test_compact_json_strips_whitespace() -> None:
    assert _compact_json({"a": 1, "b": "x"}) == '{"a":1,"b":"x"}'


def test_compact_json_keeps_unicode() -> None:
    assert _compact_json({"title": "中文"}) == '{"title":"中文"}'


@pytest.mark.parametrize(
    "args_json, field, expected",
    [
        ('"post_id": 42,', "post_id", 42),
        ('"post_id": 42}', "post_id", 42),
        ('"post_id":42,', "post_id", 42),
        ('foo "post_id": 7,', "post_id", 7),
        # 非整数 / 无尾随分隔（lookahead 失败）/ 字段缺失 → None
        ('"post_id": "x"', "post_id", None),
        ('"post_id": 42', "post_id", None),
        ('"other": 1', "post_id", None),
        ("", "post_id", None),
    ],
)
def test_extract_partial_int(args_json: str, field: str, expected: int | None) -> None:
    assert _extract_partial_int(args_json, field) == expected


@pytest.mark.parametrize(
    "args_json, expected",
    [
        ('"content": "hello"', "hello"),
        ('"content": "hello', "hello"),  # partial 未闭合
        ('"content": "a\\nb"', "a\nb"),  # \n 转义
        ('"content": "a\\"b"', 'a"b'),  # \" 转义
        ('"content": "a\\\\b"', "a\\b"),  # \\ 转义
        ('"content": "a\\tb"', "a\tb"),  # \t 转义
        ('"other": "x"', None),
    ],
)
def test_extract_partial_content(args_json: str, expected: str | None) -> None:
    assert _extract_partial_content(args_json) == expected


@pytest.mark.parametrize(
    "args_json, field, expected",
    [
        ('"target_text": "foo"', "target_text", "foo"),
        ('"target_text": "foo', "target_text", "foo"),  # partial
        ('"replacement_text": "bar\\rbaz"', "replacement_text", "bar\rbaz"),  # \r
        ('"x": "\\u4e2d\\u6587"', "x", "中文"),  # \u BMP
        ('"x": "\\uD83D\\uDE00"', "x", "\U0001F600"),  # surrogate pair → 😀
        ('"x": "\\/"', "x", "/"),  # \/ 转义
        ('"x": "\\f\\b"', "x", "\f\b"),  # \f \b
        ('"x": "abc', "x", "abc"),  # partial 未闭合
        ('"y": "z"', "x", None),  # 字段不存在
    ],
)
def test_extract_partial_json_string(args_json: str, field: str, expected: str | None) -> None:
    assert _extract_partial_json_string(args_json, field) == expected


def test_extract_partial_target_replacement_shortcuts() -> None:
    assert _extract_partial_target('"target_text": "T"') == "T"
    assert _extract_partial_replacement('"replacement_text": "R"') == "R"
