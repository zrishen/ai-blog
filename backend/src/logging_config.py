"""后端日志系统配置。

输出格式：
  [2026-05-21 13:40:44,123] [INFO] [src.services.chat_service] 消息内容

包含文件:行号、日志级别、模块名。结构化字段（如工具调用）使用额外键。
"""

import logging
import logging.handlers
import sys
from pathlib import Path

LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
LOG_FILE = LOG_DIR / "app.log"
LOG_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
LOG_BACKUP_COUNT = 5

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


class _FileFormatter(logging.Formatter):
    """文件日志格式化器：将消息中的换行符替换为空格，确保每行一条日志。"""

    def format(self, record: logging.LogRecord) -> str:
        result = super().format(record)
        return result.replace("\n", " ").replace("\r", " ")


class _ColoredFormatter(logging.Formatter):
    """为控制台输出添加颜色。不直接修改 record.levelname，避免影响共享同一 LogRecord 的其他 handler。"""

    def format(self, record: logging.LogRecord) -> str:
        result = super().format(record)
        color = _ANSI_COLORS.get(record.levelno, "")
        if color and record.levelname in result:
            result = result.replace(record.levelname, f"{color}{record.levelname}{_RESET}", 1)
        return result


# Prevent uvicorn/stdlib basicConfig from overriding our logging config.
# basicConfig only takes effect if root.handlers is empty, but it also
# resets root level. Stub it out so our config always wins.
logging.basicConfig = lambda *_, **__: None  # noqa: F841  # type: ignore[assignment]


def setup_logging(level: str = "INFO") -> None:
    """初始化日志系统：控制台 + 轮转文件。"""
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    fmt = _FileFormatter(
        "[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(_ColoredFormatter(
        "[%(asctime)s] [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    ))
    console.setLevel(level)

    file_handler = logging.handlers.RotatingFileHandler(
        LOG_FILE,
        maxBytes=LOG_MAX_BYTES,
        backupCount=LOG_BACKUP_COUNT,
        encoding="utf-8",
    )
    file_handler.setFormatter(fmt)
    file_handler.setLevel(logging.DEBUG)  # 文件记录所有级别

    root = logging.getLogger()
    root.setLevel(logging.DEBUG)
    root.handlers.clear()
    root.addHandler(console)
    root.addHandler(file_handler)

    # 压低第三方库日志噪音
    for noisy in ("openai._base_client", "httpx", "aiosqlite", "asyncio", "watchfiles"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    # HTTP 访问日志：控制台 INFO，文件 DEBUG（显式添加 handler，不依赖继承）
    access_logger = logging.getLogger("uvicorn.access")
    access_logger.setLevel(logging.DEBUG)
    access_logger.addHandler(file_handler)
    access_logger.addHandler(console)

    logging.getLogger(__name__).info("日志系统已初始化 → %s (level=%s)", LOG_FILE, level)


def struct(**kwargs) -> str:
    """将结构化字段编码为日志行，方便 grep/解析。"""
    return " | ".join(f"{k}={v}" for k, v in kwargs.items())
