"""path_guard 咽喉点单测：门控（空/'.'、绝对、'..'、symlink 逃逸、TOCTOU 父目录）+ Scope + read-write
+ ATTACHMENT 现状语义 + 属主隔离 + require_user（None 即拒 + wraps 透传）。"""

import asyncio
from pathlib import Path

import pytest

from src.config import settings
from src.core import path_guard
from src.core.context import current_user_id_cv
from src.core.exceptions import OwnershipError
from src.core.path_guard import Scope, ensure_within, require_user, user_root


@pytest.fixture
def roots(tmp_path, monkeypatch):
    """把 settings 目录 + resolve_username 指到 tmp_path，隔离真实 FS。"""
    upload = tmp_path / "uploads"
    attach = tmp_path / "attachments"
    upload.mkdir()
    attach.mkdir()
    monkeypatch.setattr(settings, "upload_dir", str(upload))
    monkeypatch.setattr(settings, "chat_attachment_dir", str(attach))
    monkeypatch.setattr(path_guard, "resolve_username", lambda uid: f"u{uid}")
    # WORKSPACE 未配置：确保 settings 无 workspace_root（防未来加默认值让 test_workspace_unconfigured_raises 假阴性）
    monkeypatch.delattr(settings, "workspace_root", raising=False)
    return {"upload": upload, "attach": attach}


# ---- 门控 ⓪ 空 / '.' ----

def test_reject_empty_and_dot(roots):
    for bad in ("", "."):
        with pytest.raises(OwnershipError):
            ensure_within(1, bad, scope=Scope.UPLOAD)


# ---- 门控 ① 绝对路径（跨平台；仅保留当前平台判定为绝对的用例，确保 is_absolute() 门控真被命中）----

_ABS_CASES = [p for p in ("/etc/passwd", "C:/x", "C:\\evil") if Path(p).is_absolute()]


@pytest.mark.parametrize("abs_path", _ABS_CASES)
def test_reject_absolute(roots, abs_path):
    with pytest.raises(OwnershipError):
        ensure_within(1, abs_path, scope=Scope.UPLOAD)


# ---- 门控 ② '..'（顶层 + 中段）----

def test_reject_parent_traversal(roots):
    with pytest.raises(OwnershipError):
        ensure_within(1, "../escape", scope=Scope.UPLOAD)


@pytest.mark.parametrize("rel", ["a/..", "a/../b", "a/../../e", "sub/../.."])
def test_reject_mid_path_traversal(roots, rel):
    # 收紧契约：parts 中任何位置出现 '..' 即拒（旧 resolve-only 会放行 a/.. → 等价 root）
    with pytest.raises(OwnershipError):
        ensure_within(1, rel, scope=Scope.UPLOAD)


# ---- 门控 ③ symlink 逃逸 ----

def test_reject_symlink_escape(roots, tmp_path):
    user_dir = roots["upload"] / "u1"
    user_dir.mkdir()
    outside = tmp_path / "outside.txt"
    outside.write_text("secret")
    try:
        (user_dir / "link.txt").symlink_to(outside)
    except OSError:
        pytest.skip("symlink needs dev mode/admin on Windows")
    with pytest.raises(OwnershipError):
        ensure_within(1, "link.txt", scope=Scope.UPLOAD)


# ---- 门控 ④ write 父目录（strict=True 存在性）----

def test_write_parent_must_exist(roots):
    with pytest.raises(OwnershipError):
        ensure_within(1, "nodir/a.txt", mode="write", scope=Scope.UPLOAD)


def test_write_valid_when_parent_exists(roots):
    user_dir = roots["upload"] / "u1"
    user_dir.mkdir()
    p = ensure_within(1, "a.txt", mode="write", scope=Scope.UPLOAD)
    assert p == user_dir / "a.txt"


# 注：gate ④ 的 parent is_relative_to 复检是 defense-in-depth（gate ③ 已逻辑覆盖：
# target 在 root 内 ⟹ parent 亦在 root 内），不可单独触发——故不补 symlinked-parent 用例。
# 详见 seam-conventions §11 裁定#6。


# ---- Scope.ATTACHMENT 现状语义（root 不拼 user，stored_path 自带 user 段）----

def test_attachment_root_no_user_prefix(roots):
    (roots["attach"] / "1").mkdir()
    (roots["attach"] / "1" / "f.bin").write_bytes(b"x")
    p = ensure_within(0, "1/f.bin", scope=Scope.ATTACHMENT)
    assert p == roots["attach"] / "1" / "f.bin"
    assert user_root(0, scope=Scope.ATTACHMENT) == roots["attach"]


def test_attachment_reject_traversal(roots):
    with pytest.raises(OwnershipError):
        ensure_within(0, "../../../etc/passwd", scope=Scope.ATTACHMENT)


# ---- Scope.WORKSPACE（P2 才加 settings.workspace_root）----

def test_workspace_unconfigured_raises(roots):
    # 现状未配置 → WORKSPACE scope 抛 OwnershipError；happy path 留 P2（Settings 加字段后，pydantic 现拒 setattr 未知字段）
    with pytest.raises(OwnershipError):
        ensure_within(1, "notes/x.md", scope=Scope.WORKSPACE)


# ---- 属主身份语义（裁定#5：第一参数=属主，非 viewer）----

def test_owner_isolation_between_users(roots):
    (roots["upload"] / "u1").mkdir()
    (roots["upload"] / "u1" / "secret.txt").write_text("x")
    p = ensure_within(1, "secret.txt", scope=Scope.UPLOAD)
    assert p == roots["upload"] / "u1" / "secret.txt"
    p2 = ensure_within(2, "secret.txt", scope=Scope.UPLOAD)
    assert p2 == roots["upload"] / "u2" / "secret.txt"


# ---- require_user（None 即拒 + wraps 透传契约）----

def test_require_user_none_raises():
    token = current_user_id_cv.set(None)
    try:

        @require_user
        async def tool():
            return "ok"

        with pytest.raises(OwnershipError):
            asyncio.run(tool())
    finally:
        current_user_id_cv.reset(token)


def test_require_user_set_passes_and_preserves_wraps():
    token = current_user_id_cv.set(42)
    try:

        @require_user
        async def tool(a, *, b=0):
            """doc-here"""

            return (a, b)

        # wraps：__name__/__doc__ 保留（LangChain @tool schema 生成依赖）；参数透传
        assert tool.__name__ == "tool"
        assert tool.__doc__ == "doc-here"
        assert asyncio.run(tool(1, b=2)) == (1, 2)
    finally:
        current_user_id_cv.reset(token)
