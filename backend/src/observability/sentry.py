"""Sentry 初始化：DSN 未配置时跳过，保证本地 / CI 无 key 不报错、不影响测试。

sentry-sdk 默认自动启用 FastAPI / Starlette / Logging / httpx 等集成，故不显式传
integrations —— 显式传参会覆盖默认集成列表，反而丢掉别的默认集成。
"""

import logging

import sentry_sdk

from src.config import settings

logger = logging.getLogger(__name__)


def init_sentry() -> None:
    """读 settings.sentry_dsn，空则跳过；否则初始化 Sentry（错误捕获 + 性能 trace）。"""
    if not settings.sentry_dsn:
        return

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment or None,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,
    )
    logger.info(
        "Sentry initialized (environment=%s, traces_sample_rate=%s)",
        settings.sentry_environment or "default",
        settings.sentry_traces_sample_rate,
    )
