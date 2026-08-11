"""path_guard: 跨切面文件系统安全咽喉点。

把 (属主, 相对路径) 解析为【已校验归属 + 已防穿越】的安全物理 Path。唯一入口 ensure_within。
@require_user 把 current_user_id_cv 桥接到工具层（当前仅定义，工具接入留后续）。

Scope:
- UPLOAD     upload_dir/<identity>（遗留 scope；现行文件库已使用 WORKSPACE/uploads）
- ATTACHMENT chat_attachment_dir（现状兼容：stored_path 自带 <user_id>/ 前缀，root 不拼 identity；
             收敛后改 chat_attachment_dir/str(user_id) + rel_path 不含 user 段，届时退役本 scope）
- WORKSPACE  workspace_root/users/<user_id>                不可变 user ID 工作目录

属主语义：ensure_within 第一参数是【资源属主】（非 viewer）。
公共读路径传 author username/id；chat 路径属主=current user（@require_user 从 cv 取）。
"""

from __future__ import annotations

import functools
from enum import StrEnum
from pathlib import Path
from typing import Any, Awaitable, Callable, Literal

from src.config import settings
from src.core.context import current_user_id_cv
from src.core.exceptions import OwnershipError
from src.utils.user_dir import validate_user_directory_name


class Scope(StrEnum):
    WORKSPACE = "workspace"
    UPLOAD = "upload"
    ATTACHMENT = "attachment"


def _base_dir(scope: Scope) -> Path:
    if scope is Scope.ATTACHMENT:
        return Path(settings.chat_attachment_dir).resolve()
    if scope is Scope.UPLOAD:
        return Path(settings.upload_dir).resolve()
    root = getattr(settings, "workspace_root", None)
    if not root:
        raise OwnershipError("workspace scope 未配置（settings.workspace_root 未设置）")
    return Path(root).resolve()


def user_root(user_id: int | str, *, scope: Scope = Scope.WORKSPACE) -> Path:
    """返回属主隔离根，不创建目录。

    WORKSPACE 使用不可变 ``workspace_root/users/<user_id>``；UPLOAD 是无生产消费者的
    遗留 scope，继续只接受一个安全 identity 段；ATTACHMENT 的 stored_path 自带 user 段。
    """
    base = _base_dir(scope)
    if scope is Scope.ATTACHMENT:
        return base

    if scope is Scope.WORKSPACE:
        if not isinstance(user_id, int):
            raise OwnershipError("工作目录属主必须是用户 ID")
        users_root = base / "users"
        if users_root.is_symlink() or (users_root.exists() and not users_root.is_dir()):
            raise OwnershipError("工作目录容器不是安全目录")
        candidate = users_root / str(user_id)
    else:
        try:
            identity = validate_user_directory_name(str(user_id))
        except ValueError as exc:
            raise OwnershipError("资源属主的目录名不安全") from exc
        candidate = base / identity

    if candidate.is_symlink():
        raise OwnershipError("用户根目录不能是符号链接")
    root = candidate.resolve()
    if not root.is_relative_to(base):
        raise OwnershipError("用户根目录逃出存储根目录")
    return root


def workspace_dir(user_id: int, *, create: bool = False) -> Path:
    """Return one owner's real workspace root without creating it by default."""
    if not isinstance(user_id, int):
        raise OwnershipError("工作目录属主必须是用户 ID")

    root = user_root(user_id, scope=Scope.WORKSPACE)
    if not create:
        return root

    base = _base_dir(Scope.WORKSPACE)
    users_root = base / "users"
    try:
        base.mkdir(parents=True, exist_ok=True)
        users_root.mkdir(exist_ok=True)
        root.mkdir(exist_ok=True)
    except OSError as exc:
        raise OwnershipError("工作目录无法创建") from exc

    if users_root.is_symlink() or not users_root.is_dir():
        raise OwnershipError("工作目录容器不是安全目录")
    if not root.is_dir() or root.is_symlink():
        raise OwnershipError("工作目录不是安全目录")
    return user_root(user_id, scope=Scope.WORKSPACE)


def workspace_users_root() -> Path:
    """所有用户工作目录的容器（workspace_root/users），不创建。

    需遍历全部用户的地方（如 reconcile 兜底）用；含 symlink/非目录安全校验。
    """
    users_root = _base_dir(Scope.WORKSPACE) / "users"
    if users_root.is_symlink() or (users_root.exists() and not users_root.is_dir()):
        raise OwnershipError("工作目录容器不是安全目录")
    return users_root


def workspace_path(
    user_id: int,
    relative_path: str | Path,
    *,
    mode: Literal["read", "write"] = "read",
) -> Path:
    """Resolve a workspace-relative path through the sole WORKSPACE guard."""
    if not isinstance(user_id, int):
        raise OwnershipError("工作目录属主必须是用户 ID")
    return ensure_within(user_id, relative_path, mode=mode, scope=Scope.WORKSPACE)


def ensure_within(
    user_id: int | str,
    rel_path: str | Path,
    *,
    mode: Literal["read", "write"] = "read",
    scope: Scope = Scope.WORKSPACE,
) -> Path:
    """把 (属主, rel_path) 解析为已校验归属+已防穿越的安全 Path。失败抛 OwnershipError(403)。

    门控：⓪ 空/'.' 拒（Path('').parts==() 否则绕过门控返回 user 根目录本身，接入层 exists() 非
    is_file() 使 '/uploads/.' 可达 → FileResponse 喂目录）；① rel_path 禁绝对 ② '..' in parts 预拒
    （含中段 a/../b，旧 resolve-only 会放行）③ resolve 后必 is_relative_to(user_root) ④ write 额外校验父目录。
    read：resolve 默认非 strict（允许目标不存在，调用方 exists() 决策 404）；write：父目录 strict=True。
    返回未 resolve 的 root/rel_path（files/preview FileResponse 用法如此；附件的 owner-aware helper
    也复用这一返回语义）。

    gate ④ 说明：strict=True 保证父目录真实存在（调用方 write 前无需再判）；其 is_relative_to 复检为
    defense-in-depth（③ 已逻辑覆盖：target.resolve() 在 root 内 ⟹ parent.resolve() 亦在 root 内），
    非跨调用 TOCTOU 真防护——那需 O_NOFOLLOW/fchdir；现有 WORKSPACE write 调用仍依赖“工作区只由服务进程修改”的运行前提。
    """
    root = user_root(user_id, scope=scope)
    p = Path(rel_path)
    if str(p) in ("", "."):
        raise OwnershipError("路径不得为空或当前目录")
    if p.is_absolute():
        raise OwnershipError("路径必须是相对路径")
    if ".." in p.parts:
        raise OwnershipError("路径不得穿越父目录")

    target = root / p
    resolved = target.resolve()
    if not resolved.is_relative_to(root):
        raise OwnershipError("路径逃出用户目录")

    if mode == "write":
        try:
            parent_resolved = target.parent.resolve(strict=True)
        except (FileNotFoundError, OSError) as exc:
            raise OwnershipError("父目录不存在或不可访问") from exc
        # defense-in-depth：③ 已保证 target 在 root 内时 parent 亦然；保留作 ③ 松动时的兜底
        if not parent_resolved.is_relative_to(root):
            raise OwnershipError("父目录逃出用户目录")
    return target


def attachment_stored_path(user_id: int, stored_path: str | Path) -> Path:
    """Resolve a legacy ``<user_id>/...`` chat attachment path for its owner.

    Chat attachments keep the owner id in the persisted relative path until the
    Phase 2 storage migration.  Validate that prefix before applying the shared
    attachment-root traversal and symlink guards.
    """
    path = Path(stored_path)
    if not path.parts or path.parts[0] != str(user_id):
        raise OwnershipError("附件路径与资源属主不匹配")
    return ensure_within(0, path, mode="read", scope=Scope.ATTACHMENT)


def require_user(tool: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
    """@require_user：current_user_id_cv.get() 为 None 即抛 OwnershipError(403)（"None 即拒"）。

    纯校验装饰器——不注入 user_id 参数（避免泄露给 LLM 的工具 schema），工具内部仍 cv.get()
    （此时保证非 None）。仅支持 async 工具（wrapper 内 await tool(...))；sync @tool 需先改 async。
    @functools.wraps 保留 __name__/__doc__，供后续 LangChain @tool 的 schema 生成依赖。
    当前仅定义；工具接入留后续（接入把 None 分支从"返回字符串"改"抛 403"，
    接入时需回归确认）。
    """

    @functools.wraps(tool)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        if current_user_id_cv.get() is None:
            raise OwnershipError("未认证用户")
        return await tool(*args, **kwargs)

    return wrapper
