"""进程内滑动窗口频率限制（防撞库、暴力注册等高频滥用）。

仅单进程事件循环内有效；多 worker 部署时各 worker 独立计数（实际阈值约为配置值 × worker 数，
仍能显著减速攻击）。需跨重启/worker 持久化的配额型限制（如公开聊天每日额度）请走 DB 方案。
"""

import time
from collections import defaultdict, deque
from threading import Lock

_buckets: dict[str, deque[float]] = defaultdict(deque)
_lock = Lock()


def check_rate_limit(bucket_key: str, *, limit: int, window_seconds: int) -> bool:
    """滑动窗口：窗口内未达 limit 则记一次并返回 True；已达上限返回 False（不记录）。

    bucket_key 由调用方拼装（如 "login:{ip}"），同一 key 共享一个窗口计数。
    """
    now = time.monotonic()
    cutoff = now - window_seconds
    with _lock:
        queue = _buckets[bucket_key]
        while queue and queue[0] < cutoff:
            queue.popleft()
        if len(queue) >= limit:
            return False
        queue.append(now)
        return True


def reset_rate_limit() -> None:
    """清空全部计数（测试用）。"""
    with _lock:
        _buckets.clear()
