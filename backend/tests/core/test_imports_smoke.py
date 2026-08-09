"""App 启动 import 冒烟基线（Phase 1.8 bulk-move 门禁）。

验证两条 import 链无断裂，防服务域搬迁后 import 路径写错致 app 启动崩：

1. ``import src.main`` —— app 装配链（api 路由树 → 全 services）。
   注：conftest 加载时已 ``from src.main import app``，此测将其显式命名 + 断言，
   搬迁后断链会在 collection 阶段就暴露。

2. ``bootstrap.startup()`` 函数体内的 lazy 模块路径全部可解析。
   这些模块在 app 启动时才加载，且部分（memory.jobs / official_intro_service /
   utils.user_dir）不被 api 链或域 pytest 拉入——搬迁后路径写错会致 app 启动崩
   而测试漏过。此参数化测显式覆盖该缺口。
"""

import importlib

import pytest

# bootstrap.startup() 函数体内 lazy 引用的全部模块（与 bootstrap.py startup() 保持一致）。
# 改动 startup() 的 lazy import 时须同步本列表。
_STARTUP_LAZY_MODULES = (
    "src.services.workspace.file.file_processing_service",
    "src.services.workspace.blog.blog_service",
    "src.services.accounts.user.official_intro_service",
    "src.services.accounts.user.user_service",
    "src.utils.user_dir",
    "src.services.memory.graph_store",
    "src.services.memory.jobs",
    "src.services.infra.embeddings.embedding_service",
)


def test_app_import_chain_smoke():
    """import src.main 触发 app 装配全链（api 路由 → services）。"""
    import src.main

    assert src.main.app is not None


@pytest.mark.parametrize("module_name", _STARTUP_LAZY_MODULES)
def test_startup_lazy_imports_smoke(module_name):
    """bootstrap.startup() 内 lazy 模块路径全部可解析（搬迁防回归核心缺口）。"""
    assert importlib.import_module(module_name) is not None
