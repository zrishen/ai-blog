"""后端日志系统配置：控制台彩色文本 + 轮转文件 JSON（app.log 收 src.* 自有代码，access.log 收框架/第三方）。

文件日志为 JSON 结构化（带 request_id），便于 AI / 日志工具按字段检索与关联；控制台保留彩色文本给人实时看。
"""

import logging
import logging.handlers
import sys
from src.config import DATA_DIR
from src.core.context import request_id_cv

LOG_DIR = DATA_DIR / "logs"
LOG_FILE = LOG_DIR / "app.log"
ACCESS_LOG_FILE = LOG_DIR / "access.log"
LOG_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
LOG_BACKUP_COUNT = 5

# 我们自己代码的 logger 前缀：进 app.log，不进 access.log
_OWN_CODE_PREFIX = "src."

# 控制台颜色（仅 tty 时启用）
_ANSI_COLORS = {
    logging.DEBUG: "\033[36m",    # 青色
    logging.INFO: "\033[32m",     # 绿色
    logging.WARNING: "\033[33m",  # 黄色
    logging.ERROR: "\033[31m",    # 红色
    logging.CRITICAL: "\033[1;31m",  # 粗红
}
_RESET = "\033[0m"


logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)


class _RequestIdFilter(logging.Filter):
    """把当前请求 id（contextvar）注入每条日志的 record.request_id，供格式化器输出。"""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_cv.get() or "-"
        return True


class _ColoredFormatter(logging.Formatter):
    """为控制台输出添加颜色。不直接修改 record.levelname，避免影响共享同一 LogRecord 的其他 handler。"""

    def format(self, record: logging.LogRecord) -> str:
        result = super().format(record)
        color = _ANSI_COLORS.get(record.levelno, "")
        if color and record.levelname in result:
            result = result.replace(record.levelname, f"{color}{record.levelname}{_RESET}", 1)
        return result


def _is_own_code_record(record: logging.LogRecord) -> bool:
    name = record.name or ""
    return name.startswith(_OWN_CODE_PREFIX)


class _OriginFilter(logging.Filter):
    """按代码归属路由日志：allow_own=True 放行 src.*（→ app.log），False 放行其余（→ access.log）。"""

    def __init__(self, *, allow_own: bool) -> None:
        super().__init__()
        self._allow_own = allow_own

    def filter(self, record: logging.LogRecord) -> bool:
        is_own = _is_own_code_record(record)
        return is_own if self._allow_own else not is_own


# Prevent uvicorn/stdlib basicConfig from overriding our logging config.
# basicConfig only takes effect if root.handlers is empty, but it also
# resets root level. Stub it out so our config always wins.
logging.basicConfig = lambda *_, **__: None  # noqa: F841  # type: ignore[assignment]


def _json_formatter() -> logging.Formatter:
    """结构化 JSON formatter：每行一个 JSON，含 timestamp/level/logger/message/request_id。"""
    from pythonjsonlogger.json import JsonFormatter

    return JsonFormatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s %(request_id)s",
        rename_fields={"asctime": "timestamp", "levelname": "level", "name": "logger"},
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def setup_logging(level: str = "INFO") -> None:
    """初始化日志系统：控制台彩色 + 轮转文件 JSON（app.log + access.log 分流）。"""
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    json_fmt = _json_formatter()

    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(_ColoredFormatter(
        "[%(asctime)s] [%(levelname)s] [%(request_id)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    ))
    console.setLevel(level)
    console.addFilter(_RequestIdFilter())

    app_file_handler = logging.handlers.RotatingFileHandler(
        LOG_FILE,
        maxBytes=LOG_MAX_BYTES,
        backupCount=LOG_BACKUP_COUNT,
        encoding="utf-8",
    )
    app_file_handler.setFormatter(json_fmt)
    app_file_handler.setLevel(logging.DEBUG)
    app_file_handler.addFilter(_RequestIdFilter())
    app_file_handler.addFilter(_OriginFilter(allow_own=True))

    http_file_handler = logging.handlers.RotatingFileHandler(
        ACCESS_LOG_FILE,
        maxBytes=LOG_MAX_BYTES,
        backupCount=LOG_BACKUP_COUNT,
        encoding="utf-8",
    )
    http_file_handler.setFormatter(json_fmt)
    http_file_handler.setLevel(logging.DEBUG)
    http_file_handler.addFilter(_RequestIdFilter())
    http_file_handler.addFilter(_OriginFilter(allow_own=False))

    root = logging.getLogger()
    root.setLevel(logging.DEBUG)
    root.handlers.clear()
    root.addHandler(console)
    root.addHandler(app_file_handler)
    root.addHandler(http_file_handler)

    # HTTP access logs are emitted by our application middleware. Configure
    # this logger directly so Uvicorn's later logging setup cannot silence it.
    access_logger = logging.getLogger("http.access")
    access_logger.handlers.clear()
    access_logger.setLevel(logging.INFO)
    access_logger.propagate = False
    access_logger.addHandler(console)
    access_logger.addHandler(http_file_handler)

    # 压低第三方库日志噪音
    for noisy in (
        "openai._base_client",
        "httpx",
        "asyncio",
        "watchfiles",
        "markdown_it",
    ):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    logging.getLogger(__name__).info(
        "日志系统已初始化 → %s + %s (level=%s)",
        LOG_FILE,
        ACCESS_LOG_FILE,
        level,
    )
