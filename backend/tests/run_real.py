"""直接运行真实测试。

用法:
    cd backend && uv run python tests/run_real.py

注意: 需要配置 .env 中的 API key 和真实外部服务。
"""

from pathlib import Path
import subprocess
import sys


if __name__ == "__main__":
    backend_dir = Path(__file__).resolve().parents[1]
    raise SystemExit(subprocess.call([
        sys.executable,
        "-m",
        "pytest",
        "tests/real",
        "-v",
    ], cwd=backend_dir))
