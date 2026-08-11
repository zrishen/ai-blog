"""core.workspace_path 跨平台词法校验单测。"""

import pytest

from src.core.workspace_path import (
    is_safe_workspace_segment,
    validate_workspace_relative_path,
    validate_workspace_segment,
)


@pytest.mark.parametrize("name", ["foo", "my-notes", "100%", "my_notes", "中文", "a.b", "100"])
def test_segment_accepts_cross_platform_safe_names(name):
    assert validate_workspace_segment(name) == name


@pytest.mark.parametrize(
    "name",
    [
        "",
        ".",
        "..",
        "foo.",
        " foo",
        "foo ",
        "\x00",
        "\n",
        "\t",
        "a:b",
        "a/b",
        "a\\b",
        "<",
        ">",
        "*",
        "?",
        "|",
        '"',
        "CON",
        "PRN",
        "AUX",
        "NUL",
        "COM1",
        "LPT1",
        "CON.txt",
        "com1.log",
    ],
)
def test_segment_rejects_unsafe_names(name):
    with pytest.raises(Exception):
        validate_workspace_segment(name)


def test_segment_allow_leading_dot_for_system_prefixes():
    assert validate_workspace_segment(".trash", allow_leading_dot=True) == ".trash"
    with pytest.raises(Exception):
        validate_workspace_segment(".trash")


def test_segment_respects_max_length():
    validate_workspace_segment("a" * 300)
    with pytest.raises(Exception):
        validate_workspace_segment("a" * 301)


@pytest.mark.parametrize("value", ["a", "a/b", "posts/hello.md", "a/b/c", "100%/reports", "my_notes/draft"])
def test_relative_path_accepts_safe_paths(value):
    assert validate_workspace_relative_path(value) == value


@pytest.mark.parametrize(
    "value",
    [
        "/a",
        "a//b",
        "a/./b",
        "a/../b",
        "../escape",
        "a\\b",
        "a/.hidden/b",
        "a/CON/b",
        "foo./b",
        "a/\x00",
        "a/:b",
        "a/CON.txt/b",
    ],
)
def test_relative_path_rejects_unsafe_paths(value):
    with pytest.raises(Exception):
        validate_workspace_relative_path(value)


def test_relative_path_allow_hidden_for_trash_layout():
    assert validate_workspace_relative_path(".trash/abc123/posts/hello.md", allow_hidden=True) == (
        ".trash/abc123/posts/hello.md"
    )
    with pytest.raises(Exception):
        validate_workspace_relative_path(".trash/abc123/posts/hello.md")


def test_relative_path_respects_max_length():
    validate_workspace_relative_path("a" * 300 + "/" + "b" * 199)
    with pytest.raises(Exception):
        validate_workspace_relative_path("a" * 300 + "/" + "b" * 200)


def test_is_safe_workspace_segment_predicate():
    assert is_safe_workspace_segment("document.pdf") is True
    assert is_safe_workspace_segment("../escape") is False
    assert is_safe_workspace_segment("") is False
    assert is_safe_workspace_segment("CON") is False
