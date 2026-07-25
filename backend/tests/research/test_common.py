"""research/common 纯函数单元测试。

common 是 research 域依赖根（常量 + 归一化/校验工具），被各 service 复用。
锁住数值归一化、字符串清洗、payload 解析、冲突判定、截断等纯逻辑。
"""

import pytest

from src.services.research.common import (
    AUTO_ADOPT_MIN_CONFIDENCE,
    _clamp_confidence,
    _coerce_int,
    _coerce_str_list,
    _normalize_claim_text,
    _normalize_entity_name,
    _payload_int_list,
    _proposal_payload_has_conflict_hint,
    _truncate_detail,
)


def test_auto_adopt_min_confidence_constant() -> None:
    assert AUTO_ADOPT_MIN_CONFIDENCE == 85


@pytest.mark.parametrize(
    "value, expected",
    [
        (None, 0),
        ("", 0),
        ("42", 42),
        (42, 42),
        ("abc", 0),
        (3.7, 3),
    ],
)
def test_coerce_int(value, expected: int) -> None:
    assert _coerce_int(value) == expected


@pytest.mark.parametrize(
    "value, expected",
    [
        (None, 0),
        (-5, 0),
        (50, 50),
        (150, 100),
        ("200", 100),
        ("abc", 0),
    ],
)
def test_clamp_confidence(value, expected: int) -> None:
    assert _clamp_confidence(value) == expected


def test_normalize_entity_name_collapses_whitespace() -> None:
    assert _normalize_entity_name("  a   b  ") == "a b"
    assert _normalize_entity_name("\tx\ny") == "x y"


@pytest.mark.parametrize(
    "value, expected",
    [
        (None, []),
        ("", []),
        ("a,b,c", ["a", "b", "c"]),
        (["x", "y"], ["x", "y"]),
        ("a,a,b", ["a", "b"]),  # 去重
    ],
)
def test_coerce_str_list(value, expected: list[str]) -> None:
    assert _coerce_str_list(value) == expected


def test_payload_int_list_parses_dedup_and_skips_invalid() -> None:
    assert _payload_int_list({"a": "1,2", "b": "3"}, "a", "b") == [1, 2, 3]
    assert _payload_int_list({"a": ["4", "5"]}, "a") == [4, 5]
    assert _payload_int_list({"a": "", "b": None}, "a", "b") == []
    assert _payload_int_list({"a": "1,1,2"}, "a") == [1, 2]  # 去重
    assert _payload_int_list({"a": "0,-1,3"}, "a") == [3]  # 跳过 <= 0


@pytest.mark.parametrize(
    "text, expected",
    [
        ("  Hello, World！ ", "hello, world"),  # 小写 + 剥尾 ！
        ("  A，B。 ", "a，b"),  # 中间中文逗号保留、剥尾句号
        ("", ""),
    ],
)
def test_normalize_claim_text(text: str, expected: str) -> None:
    assert _normalize_claim_text(text) == expected


@pytest.mark.parametrize(
    "payload, expected",
    [
        ({"status": "conflicting"}, True),
        ({"conflicting_claim_ids": "1"}, True),
        ({"conflict_claim_id": [1, 2]}, True),
        ({}, False),
        ({"status": "pending"}, False),
    ],
)
def test_proposal_payload_has_conflict_hint(payload: dict, expected: bool) -> None:
    assert _proposal_payload_has_conflict_hint(payload) is expected


def test_truncate_detail() -> None:
    assert _truncate_detail("short") == "short"
    assert _truncate_detail("x" * 200, limit=10) == "xxxxxxxxxx..."
    assert _truncate_detail("a\nb", limit=10) == "a b"  # 换行折成空格
