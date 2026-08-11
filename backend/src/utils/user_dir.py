"""跨平台安全的用户名目录段校验。

工作区物理根已使用不可变 user ID；本模块仅保留用户名本身的跨平台合法性校验，
用于注册输入和旧 username 根迁移 preflight。
"""

from pathlib import PurePosixPath, PureWindowsPath

_WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}
_WINDOWS_FORBIDDEN_CHARS = frozenset('<>:"/\\|?*')


def validate_user_directory_name(username: str) -> str:
    """Return a username only when it is safe as one cross-platform path segment."""

    if not isinstance(username, str) or not username:
        raise ValueError("用户名不能为空")
    if username in {".", ".."} or username != username.strip() or username.endswith("."):
        raise ValueError("用户名不能作为安全目录名")
    if any(ord(char) < 32 or char in _WINDOWS_FORBIDDEN_CHARS for char in username):
        raise ValueError("用户名包含目录不支持的字符")

    posix = PurePosixPath(username)
    windows = PureWindowsPath(username)
    if posix.parts != (username,) or windows.parts != (username,) or windows.drive or windows.root:
        raise ValueError("用户名必须是单个目录名")

    if username.split(".", 1)[0].upper() in _WINDOWS_RESERVED_NAMES:
        raise ValueError("用户名是 Windows 保留设备名")
    return username
