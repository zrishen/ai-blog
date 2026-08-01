"""统一领域异常。

service 层只抛领域异常（表达业务语义），由 main.py 注册的全局 exception_handler 统一翻译成 JSON（HTTP 是 api 层的事）。
响应格式：{"code": <str>, "message": <str>}
"""

from typing import Any


class DomainError(Exception):
    """领域异常基类。

    子类覆盖 code（前端按此分支）与 status（HTTP 状态码）。
    """

    code: str = "domain_error"
    status: int = 400

    def __init__(self, message: str = "", *, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details:
            payload["details"] = self.details
        return payload


class NotFoundError(DomainError):
    """资源不存在（404）。"""

    code = "not_found"
    status = 404


class OwnershipError(DomainError):
    """资源存在但不属于当前用户（403）。"""

    code = "forbidden"
    status = 403


class ConflictError(DomainError):
    """状态冲突，如唯一约束、重复操作（409）。"""

    code = "conflict"
    status = 409


class ValidationFailedError(DomainError):
    """业务校验失败（422）。"""

    code = "validation_failed"
    status = 422
