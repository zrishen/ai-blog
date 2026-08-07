"""memory 域 conftest。

顶层 conftest 的 mock_external_services 把 graph_store.delete_resource_memory 全局 mock 成 noop，
便于移除/删除资源的集成测试（workspace/trash/blog）不连真实 FalkorDB。但本域 test_graph_store
直接测 delete_resource_memory 的真实 Cypher 行为（只 mock _read/_write），需在测试前恢复真实函数。
模块加载（收集阶段）早于运行时 mock，故此时保存的是真实函数。
"""

import pytest

from src.services.memory import graph_store

_real_delete_resource_memory = graph_store.delete_resource_memory


@pytest.fixture(autouse=True)
def _restore_real_delete_resource_memory(monkeypatch):
    monkeypatch.setattr(graph_store, "delete_resource_memory", _real_delete_resource_memory)
