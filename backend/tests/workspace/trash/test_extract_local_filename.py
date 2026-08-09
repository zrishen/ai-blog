"""trash_service._extract_local_filename 单元测试。

锁住 URL 引用解析行为：从博客正文/封面引用里提取本地 stored 文件名，
回收扫描据此判断文件是否可安全删除。API 版本化（/api → /api/v1）后正则需
兼容新旧前缀——历史 markdown 内嵌的旧 /api/ 引用与新生成的 /api/v1/ 引用都须命中，
否则旧博客回收时会漏判文件引用、误删用户上传。
"""

import pytest

from src.services.workspace.trash.trash_service import _extract_local_filename


@pytest.mark.parametrize(
    "value, expected",
    [
        # 新前缀 /api/v1/（API 版本化后 file_service 生成的 URL）
        ("/api/v1/uploads/abc.png", "abc.png"),
        ("/api/v1/public/uploads/alice/abc.png", "abc.png"),
        ("/api/v1/blog/cover/cover-1.svg", "cover-1.svg"),
        # 旧前缀 /api/（历史 markdown 内嵌引用，迁移期须兼容，否则回收漏判）
        ("/api/uploads/abc.png", "abc.png"),
        ("/api/public/uploads/alice/abc.png", "abc.png"),
        ("/api/blog/cover/cover-1.svg", "cover-1.svg"),
        # 纯文件名（无 URL 前缀）
        ("abc.png", "abc.png"),
        ("cover-1.svg", "cover-1.svg"),
    ],
)
def test_extract_local_filename_returns_stored_name(value: str, expected: str) -> None:
    assert _extract_local_filename(value) == expected


@pytest.mark.parametrize(
    "value",
    [
        None,
        "",
        "   ",
        # 外链 / 协议 URL：非本地文件，回收不应触碰
        "https://example.com/cover.png",
        "http://cdn.example.com/x.jpg",
        "data:image/png;base64,iVBORw0KGgo=",
        "blob:https://example.com/abc",
        "ftp://example.com/x",
        "file:///etc/passwd",
        "//cdn.example.com/protocol-relative.png",
        # 不安全文件名：路径穿越 / 多级 / 含分隔符
        "../etc/passwd",
        "a/b.png",
        "a\\b.png",
        "/absolute/path.png",
    ],
)
def test_extract_local_filename_returns_none(value: object) -> None:
    """非本地引用或非法文件名须返回 None，避免误删或路径穿越。"""
    assert _extract_local_filename(value) is None  # type: ignore[arg-type]
