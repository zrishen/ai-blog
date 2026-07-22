"""直接运行全部测试。

用法:
    cd backend && uv run python tests/run_mock.py
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
        "tests",
        "-v",
    ], cwd=backend_dir))
