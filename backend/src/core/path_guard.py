"""path_guard: 跨切面文件系统安全咽喉点。

把 (属主, 相对路径) 解析为【已校验归属 + 已防穿越】的安全物理 Path。唯一入口 ensure_within。
@require_user 把 current_user_id_cv 桥接到工具层（1.1 仅定义，工具接入留后续）。

Scope:
- UPLOAD     upload_dir/resolve_username(属主)            现状 file_service.get_user_upload_dir
- ATTACHMENT chat_attachment_dir（1.1 现状兼容：stored_path 自带 <user_id>/ 前缀，root 不拼 identity；
             P2 收敛后改 chat_attachment_dir/str(user_id) + rel_path 不含 user 段，届时退役本 scope）
- WORKSPACE  workspace_root/resolve_username(属主)         P2 真实工作目录默认（Phase 2 落地 settings.workspace_root）

属主语义（seam-conventions §5 裁定#5）：ensure_within 第一参数是【资源属主】（非 viewer）。
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
from src.utils.user_dir import resolve_username


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
        raise OwnershipError("workspace scope 未配置（Phase 2 落地）")
    return Path(root).resolve()


def user_root(user_id: int | str, *, scope: Scope = Scope.WORKSPACE) -> Path:
    """user 隔离根 <base>/<identity>（不创建目录，但 fully-resolved 以对齐旧 user_dir.resolve() 语义，
    避免「用户目录是指向 root 内的 symlink」时 is_relative_to 基线 lexical 不匹配导致 false-403）。
    UPLOAD/WORKSPACE: identity=resolve_username(user_id)（resolve_username 不返回路径特殊字符，resolve 安全）；
    ATTACHMENT: root=chat_attachment_dir（stored_path 自带 user 段，不拼 identity，故不 resolve identity 段）。"""
    base = _base_dir(scope)
    if scope is Scope.ATTACHMENT:
        return base
    return (base / resolve_username(user_id)).resolve()


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
    返回未 resolve 的 root/rel_path（files/preview FileResponse 用法如此；attachment shim 由原 resolved 变
    unresolved，附件路径无 symlink 故观测等价——见 chat_attachment_service._resolve_stored_path）。

    gate ④ 说明：strict=True 保证父目录真实存在（调用方 write 前无需再判）；其 is_relative_to 复检为
    defense-in-depth（③ 已逻辑覆盖：target.resolve() 在 root 内 ⟹ parent.resolve() 亦在 root 内），
    非跨调用 TOCTOU 真防护——那需 O_NOFOLLOW/fchdir，留 P2/P3 沙箱。当前生产无 write 经 mode="write"
    （_resolve_stored_path 用 read、save_file 绕过 path_guard），④ 实质生效待 P2 写路径迁移。
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


def require_user(tool: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
    """@require_user：current_user_id_cv.get() 为 None 即抛 OwnershipError(403)（"None 即拒"）。

    纯校验装饰器——不注入 user_id 参数（避免泄露给 LLM 的工具 schema），工具内部仍 cv.get()
    （此时保证非 None）。仅支持 async 工具（wrapper 内 await tool(...))；sync @tool 需先改 async。
    @functools.wraps 保留 __name__/__doc__，供后续 LangChain @tool 的 schema 生成依赖。
    1.1 仅定义；工具接入留后续（接入把 None 分支从"返回字符串"改"抛 403"，
    需 1.7 回归确认，见 seam-conventions §5 risk）。
    """

    @functools.wraps(tool)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        if current_user_id_cv.get() is None:
            raise OwnershipError("未认证用户")
        return await tool(*args, **kwargs)

    return wrapper
