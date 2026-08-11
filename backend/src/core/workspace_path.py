"""跨平台 workspace 路径词法校验（输入形状，422）。

与 ``path_guard``（resolve 级归属/穿越，403）分层：本模块在 path_guard 之前运行，
二者叠加。规则覆盖控制字符、Windows 禁字符/设备名、ADS 冒号、尾点、首尾空格；
``%`` 与 ``_`` 是合法文件名字符，保持放行——SQL LIKE 的元字符问题在 LIKE 层修，
不在这里禁。
"""

from __future__ import annotations

from pathlib import PurePosixPath, PureWindowsPath

from src.core.exceptions import ValidationFailedError

_WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}
_WINDOWS_FORBIDDEN_CHARS = frozenset('<>:"/\\|?*')


def validate_workspace_segment(
    name: str,
    *,
    max_length: int = 300,
    allow_leading_dot: bool = False,
) -> str:
    """单段名（folder/file/stored filename）。非法抛 ``ValidationFailedError``。"""

    if not isinstance(name, str) or not name:
        raise ValidationFailedError("Workspace name is invalid")
    if len(name) > max_length:
        raise ValidationFailedError("Workspace name is too long")
    if name in {".", ".."}:
        raise ValidationFailedError("Workspace name is invalid")
    if name.strip() != name or name.endswith("."):
        raise ValidationFailedError("Workspace name is invalid")
    if not allow_leading_dot and name.startswith("."):
        raise ValidationFailedError("Workspace name is invalid")
    if any(ord(ch) < 32 for ch in name):
        raise ValidationFailedError("Workspace name is invalid")
    if any(ch in _WINDOWS_FORBIDDEN_CHARS for ch in name):
        raise ValidationFailedError("Workspace name is invalid")
    posix = PurePosixPath(name)
    windows = PureWindowsPath(name)
    if posix.parts != (name,) or windows.parts != (name,) or windows.drive or windows.root:
        raise ValidationFailedError("Workspace name is invalid")
    if name.split(".", 1)[0].upper() in _WINDOWS_RESERVED_NAMES:
        raise ValidationFailedError("Workspace name is invalid")
    return name


def validate_workspace_relative_path(
    value: str,
    *,
    max_length: int = 500,
    allow_hidden: bool = False,
) -> str:
    """多段 POSIX 相对路径。非法抛 ``ValidationFailedError``。

    ``allow_hidden=True`` 放行 ``.``-前缀段（用于 ``.trash`` 等系统前缀）。
    """

    if not isinstance(value, str) or not value or len(value) > max_length or "\\" in value:
        raise ValidationFailedError("Workspace path is invalid")
    path = PurePosixPath(value)
    if path.is_absolute() or value != path.as_posix():
        raise ValidationFailedError("Workspace path is invalid")
    for part in path.parts:
        if part == "..":
            raise ValidationFailedError("Workspace path is invalid")
        validate_workspace_segment(part, allow_leading_dot=allow_hidden)
    return path.as_posix()


def is_safe_workspace_segment(name: str) -> bool:
    """Predicate 版 segment 校验（给 bool 契约的调用方）。"""

    try:
        validate_workspace_segment(name)
    except ValidationFailedError:
        return False
    return True
