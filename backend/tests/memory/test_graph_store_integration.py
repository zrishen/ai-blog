import asyncio
import os
import uuid

import pytest
from falkordb import FalkorDB

from src.services.memory import graph_store, memory_embeddings
from src.services.memory.graph_store import add_document_chunks as add_document_chunks_impl
from src.services.memory.graph_store import recall as recall_impl
from src.services.memory.graph_store import upsert_node_embeddings as upsert_node_embeddings_impl


@pytest.fixture(scope="module")
def falkordb_client():
    url = os.environ.get("FALKORDB_TEST_URL")
    if not url:
        pytest.skip("设置 FALKORDB_TEST_URL 后运行真实 FalkorDB 集成测试")
    return FalkorDB.from_url(url)


@pytest.mark.asyncio
async def test_chunk_write_recall_normalizes_slug_and_isolates_users(monkeypatch, falkordb_client):
    graph_name = f"recall_test_{uuid.uuid4().hex}"
    graph = falkordb_client.select_graph(graph_name)
    monkeypatch.setattr(graph_store, "_client", falkordb_client)
    monkeypatch.setattr(graph_store.settings, "falkordb_graph_name", graph_name)

    try:
        await add_document_chunks_impl(
            user_id=101,
            collection_name="user_101_kb",
            stored_name="memory.pdf",
            chunks=["Project Cortex uses FalkorDB for memory recall."],
            embeddings=[[1.0, 0.0]],
            metadata_list=[{"source": "memory.pdf"}],
            embedding_model="_test_model",
            vector_dim=2,
        )
        await add_document_chunks_impl(
            user_id=101,
            collection_name="user_101_kb",
            stored_name="less-related.pdf",
            chunks=["An unrelated orthogonal memory."],
            embeddings=[[0.0, 1.0]],
            metadata_list=[{"source": "less-related.pdf"}],
            embedding_model="_test_model",
            vector_dim=2,
        )
        await add_document_chunks_impl(
            user_id=202,
            collection_name="user_202_kb",
            stored_name="private.pdf",
            chunks=["This is another user's private memory."],
            embeddings=[[1.0, 0.0]],
            metadata_list=[{"source": "private.pdf"}],
            embedding_model="test_model",
            vector_dim=2,
        )

        hits = []
        for _ in range(20):
            hits = await recall_impl(
                user_id=101,
                query_embedding=[1.0, 0.0],
                embedding_model="_test_model",
                top_k=8,
            )
            if hits:
                break
            await asyncio.sleep(0.1)

        assert [hit.metadata["source"] for hit in hits][:2] == [
            "memory.pdf",
            "less-related.pdf",
        ]
        assert "private memory" not in "\n".join(hit.content for hit in hits)
        assert await recall_impl(
            user_id=303,
            query_embedding=[1.0, 0.0],
            embedding_model="test_model",
            top_k=8,
        ) == []
    finally:
        graph.delete()


@pytest.mark.asyncio
async def test_knowledge_node_recall_supports_kinds_validity_and_user_isolation(
    monkeypatch, falkordb_client
):
    graph_name = f"knowledge_recall_test_{uuid.uuid4().hex}"
    graph = falkordb_client.select_graph(graph_name)
    monkeypatch.setattr(graph_store, "_client", falkordb_client)
    monkeypatch.setattr(graph_store.settings, "falkordb_graph_name", graph_name)

    try:
        entity_id = await graph_store.add_entity(
            user_id=101,
            name="Project Cortex",
            entity_type="concept",
            description="AI memory brain",
        )
        fact_id = await graph_store.add_fact(
            user_id=101,
            subject_id=entity_id,
            predicate="uses",
            object_text="FalkorDB",
        )
        episode_id = await graph_store.add_episode(
            user_id=101,
            kind="chat",
            summary="Discussed FalkorDB memory recall",
        )
        pref_id = await graph_store.add_preference(
            user_id=101,
            key="answer_style",
            value="concise",
        )
        private_entity = await graph_store.add_entity(
            user_id=202,
            name="Private project",
            description="another user",
        )

        await upsert_node_embeddings_impl(
            kind="entity",
            embedding_model="_test_model",
            vector_dim=2,
            rows=[
                {
                    "user_id": 101,
                    "memory_id": entity_id,
                    "text": "name: Project Cortex\ndescription: AI memory brain",
                    "embedding": [1.0, 0.0],
                },
                {
                    "user_id": 202,
                    "memory_id": private_entity,
                    "text": "name: Private project\ndescription: another user",
                    "embedding": [1.0, 0.0],
                },
            ],
        )
        await upsert_node_embeddings_impl(
            kind="fact",
            embedding_model="_test_model",
            vector_dim=2,
            rows=[{
                "user_id": 101,
                "memory_id": fact_id,
                "text": "subject: Project Cortex\npredicate: uses\nobject: FalkorDB",
                "embedding": [1.0, 0.0],
            }],
        )
        await upsert_node_embeddings_impl(
            kind="episode",
            embedding_model="_test_model",
            vector_dim=2,
            rows=[{
                "user_id": 101,
                "memory_id": episode_id,
                "text": "kind: chat\nsummary: Discussed FalkorDB memory recall",
                "embedding": [1.0, 0.0],
            }],
        )
        await upsert_node_embeddings_impl(
            kind="preference",
            embedding_model="_test_model",
            vector_dim=2,
            rows=[{
                "user_id": 101,
                "memory_id": pref_id,
                "text": "key: answer_style\nvalue: concise",
                "embedding": [1.0, 0.0],
            }],
        )

        hits = []
        for _ in range(20):
            hits = await recall_impl(
                user_id=101,
                query_embedding=[1.0, 0.0],
                embedding_model="_test_model",
                top_k=8,
                kinds=["entity", "fact", "episode", "preference"],
            )
            if {hit.kind for hit in hits} == {"entity", "fact", "episode", "preference"}:
                break
            await asyncio.sleep(0.1)

        assert {hit.kind for hit in hits} == {"entity", "fact", "episode", "preference"}
        assert all((hit.metadata or {}).get("id") != private_entity for hit in hits)
        # hops=0：kinds 严格限定种子类型，不做图扩展。
        strict = await recall_impl(
            user_id=101,
            query_embedding=[1.0, 0.0],
            embedding_model="test_model",
            top_k=8,
            kinds=["fact"],
            hops=0,
        )
        assert [hit.kind for hit in strict] == ["fact"]
        assert all((hit.metadata or {}).get("graph_distance") == 0 for hit in strict)
        # hops>0：fact 种子经 SUBJECT 扩展到关联 entity，体现 GraphRAG 跨类型证据。
        expanded = await recall_impl(
            user_id=101,
            query_embedding=[1.0, 0.0],
            embedding_model="test_model",
            top_k=8,
            kinds=["fact"],
            hops=1,
        )
        assert {"fact", "entity"} <= {hit.kind for hit in expanded}
        expanded_entity = next(hit for hit in expanded if hit.kind == "entity")
        assert expanded_entity.metadata["graph_distance"] >= 1

        await graph_store._write(
            "MATCH (f:Fact {fact_id:$fid}), (p:Preference {pref_id:$pid}) "
            "SET f.valid_to=$now, p.valid_to=$now",
            {"fid": fact_id, "pid": pref_id, "now": "2026-08-03T00:00:00"},
        )
        assert await recall_impl(
            user_id=101,
            query_embedding=[1.0, 0.0],
            embedding_model="test_model",
            top_k=8,
            kinds=["fact", "preference"],
            only_valid=True,
            hops=0,
        ) == []
        assert {hit.kind for hit in await recall_impl(
            user_id=101,
            query_embedding=[1.0, 0.0],
            embedding_model="test_model",
            top_k=8,
            kinds=["fact", "preference"],
            only_valid=False,
            hops=0,
        )} == {"fact", "preference"}

        async def get_embeddings(texts):
            return [[1.0, 0.0] for _ in texts]

        monkeypatch.setattr(
            memory_embeddings.embedding_service,
            "get_embedding_collection_suffix",
            lambda: "_test_model_v2",
        )
        monkeypatch.setattr(memory_embeddings.embedding_service, "get_embeddings", get_embeddings)
        report = await memory_embeddings.reindex_all(
            user_id=101,
            kinds=["entity", "fact", "episode", "preference"],
            batch_size=2,
        )
        assert report.embedded == 4
        assert {hit.kind for hit in await recall_impl(
            user_id=101,
            query_embedding=[1.0, 0.0],
            embedding_model="_test_model_v2",
            top_k=8,
            kinds=["entity", "fact", "episode", "preference"],
            only_valid=False,
        )} == {"entity", "fact", "episode", "preference"}
        assert await recall_impl(
            user_id=101,
            query_embedding=[1.0, 0.0],
            embedding_model="_test_model",
            top_k=8,
            kinds=["entity"],
        )
    finally:
        graph.delete()


@pytest.mark.asyncio
async def test_consolidate_preference_first_write_then_versions(monkeypatch, falkordb_client):
    """方案 A 端到端（真实 FalkorDB）：首次创建 → 重复跳过 → value 变更版本化。

    find_active_preference 只返回当前有效偏好，验证 arbitrator 与 graph_store 闭环。
    """
    from src.services.memory import consolidator

    graph_name = f"pref_consolidate_test_{uuid.uuid4().hex}"
    graph = falkordb_client.select_graph(graph_name)
    monkeypatch.setattr(graph_store, "_client", falkordb_client)
    monkeypatch.setattr(graph_store.settings, "falkordb_graph_name", graph_name)
    await graph_store.ensure_graph()

    try:
        pid1 = await consolidator.consolidate_preference(
            user_id=101, key="Reply Language", value="中文", confidence=0.9,
        )
        assert pid1
        assert await graph_store.find_active_preference(user_id=101, key="reply language") == {
            "pref_id": pid1, "value": "中文",
        }

        # 重复：同 key 同 value → 跳过
        assert await consolidator.consolidate_preference(
            user_id=101, key="reply language", value="中文", confidence=0.9,
        ) is None

        # value 变更 → 版本化，当前有效切到新值，旧版本保留可回溯
        pid2 = await consolidator.consolidate_preference(
            user_id=101, key="reply language", value="English", confidence=0.85,
        )
        assert pid2 and pid2 != pid1
        assert await graph_store.find_active_preference(user_id=101, key="reply language") == {
            "pref_id": pid2, "value": "English",
        }
    finally:
        graph.delete()


@pytest.mark.asyncio
async def test_recall_touch_and_decay_close_the_loop(monkeypatch, falkordb_client):
    """衰减闭环（真实 FalkorDB）：节点旧化→decay 降权→recall 命中 touch 刷新→decay 不再降权。"""
    from src.services.memory import jobs
    from src.services.memory import schema as S

    graph_name = f"decay_loop_test_{uuid.uuid4().hex}"
    graph = falkordb_client.select_graph(graph_name)
    monkeypatch.setattr(graph_store, "_client", falkordb_client)
    monkeypatch.setattr(graph_store.settings, "falkordb_graph_name", graph_name)
    monkeypatch.setattr(graph_store.settings, "memory_decay_days", 1)
    await graph_store.ensure_graph()

    try:
        entity_id = await graph_store.add_entity(
            user_id=101, name="Stale Entity", entity_type="concept", confidence=0.9,
        )
        # 旧化：last_accessed_at 设到 decay 阈值（now - 1d）之前
        await graph_store._write(
            f"MATCH (e:{S.ENTITY} {{entity_id:$eid}}) SET e.last_accessed_at=$stale",
            {"eid": entity_id, "stale": "2000-01-01T00:00:00"},
        )

        assert await jobs.decay_memories() >= 1  # 长期未访问节点 confidence 被降权

        # recall 命中后 touch 刷新 last_accessed_at（模拟 base_recall_memory 行为）
        hit = graph_store.MemoryHit(
            content="Stale Entity", kind="entity", score=0.1, metadata={"id": entity_id},
        )
        await graph_store.touch_memories(user_id=101, hits=[hit])

        # 再次 decay：刚被 recall 访问的节点不再降权
        assert await jobs.decay_memories() == 0
    finally:
        graph.delete()


@pytest.mark.asyncio
async def test_recall_quality_baseline(monkeypatch, falkordb_client):
    """召回质量基线：相似度梯度排序 + 用户隔离 + 延迟/上下文长度记录。

    延迟与上下文长度仅记录供后续优化对照（task_plan：不在测量前凭空设定阈值）。
    """
    import time

    graph_name = f"quality_baseline_{uuid.uuid4().hex}"
    graph = falkordb_client.select_graph(graph_name)
    monkeypatch.setattr(graph_store, "_client", falkordb_client)
    monkeypatch.setattr(graph_store.settings, "falkordb_graph_name", graph_name)
    await graph_store.ensure_graph()

    try:
        # 相似度梯度：A 最相关、B 次相关、C 正交；另注入其他用户同向量验证隔离
        entity_a = await graph_store.add_entity(user_id=101, name="Cortex", description="memory brain")
        entity_b = await graph_store.add_entity(user_id=101, name="FalkorDB", description="graph db")
        entity_c = await graph_store.add_entity(user_id=101, name="Orthogonal", description="unrelated")
        leak_id = await graph_store.add_entity(user_id=202, name="Leak", description="other user")
        await upsert_node_embeddings_impl(
            kind="entity",
            embedding_model="_baseline",
            vector_dim=2,
            rows=[
                {"user_id": 101, "memory_id": entity_a, "text": "name: Cortex", "embedding": [1.0, 0.0]},
                {"user_id": 101, "memory_id": entity_b, "text": "name: FalkorDB", "embedding": [0.9, 0.436]},
                {"user_id": 101, "memory_id": entity_c, "text": "name: Orthogonal", "embedding": [0.0, 1.0]},
                {"user_id": 202, "memory_id": leak_id, "text": "name: Leak", "embedding": [1.0, 0.0]},
            ],
        )

        query = [1.0, 0.0]
        start = time.monotonic()
        hits = []
        for _ in range(20):
            hits = await recall_impl(
                user_id=101, query_embedding=query, embedding_model="_baseline",
                top_k=3, kinds=["entity"], hops=0,
            )
            if hits:
                break
            await asyncio.sleep(0.1)
        latency_ms = (time.monotonic() - start) * 1000

        assert hits, "baseline: expected recall hits"
        ids = [hit.metadata["id"] for hit in hits]
        # 排序质量：最相关 A 排第一；正交 C 排在 A 后（若被召回）
        assert ids[0] == entity_a
        if entity_c in ids:
            assert ids.index(entity_c) > ids.index(entity_a)
        # 用户隔离：其他用户不泄漏
        assert leak_id not in ids

        from src.tools.memory import _format_memory_context

        context = _format_memory_context(hits)
        ctx_chars = len(context)
        print(
            f"\n[recall-baseline] latency={latency_ms:.1f}ms "
            f"hits={len(hits)} ranking={ids} context_chars={ctx_chars}"
        )
        # 上下文不超预算（宽松上限防退化，非性能目标）
        assert ctx_chars <= 6200
    finally:
        graph.delete()


@pytest.mark.asyncio
async def test_recall_tenant_starvation_boundary(monkeypatch, falkordb_client):
    """多租户候选饥饿边界：跨租户大量极相似节点是否挤占目标用户召回。

    评估当前 overfetch（max(32, top_k*4)）的隔离强度；暴露候选饥饿风险。
    """
    graph_name = f"tenant_starvation_{uuid.uuid4().hex}"
    graph = falkordb_client.select_graph(graph_name)
    monkeypatch.setattr(graph_store, "_client", falkordb_client)
    monkeypatch.setattr(graph_store.settings, "falkordb_graph_name", graph_name)
    await graph_store.ensure_graph()

    try:
        # 目标用户 101：3 个 entity，向量与 query 相近（cosine 距离≈0.1）
        target_ids = [
            await graph_store.add_entity(user_id=101, name=f"Target{i}") for i in range(3)
        ]
        # 10 个其他用户各 5 个噪声 entity，向量 = query（距离 0，抢占全局 ANN 候选）
        rows = [
            {"user_id": 101, "memory_id": eid, "text": f"name: Target{i}", "embedding": [0.9, 0.436]}
            for i, eid in enumerate(target_ids)
        ]
        for uid in range(202, 212):
            for j in range(5):
                nid = await graph_store.add_entity(user_id=uid, name=f"Noise{uid}_{j}")
                rows.append({
                    "user_id": uid, "memory_id": nid,
                    "text": f"name: Noise{uid}_{j}", "embedding": [1.0, 0.0],
                })
        await upsert_node_embeddings_impl(
            kind="entity", embedding_model="_starve", vector_dim=2, rows=rows,
        )

        query = [1.0, 0.0]
        hits = []
        for _ in range(20):
            hits = await recall_impl(
                user_id=101, query_embedding=query, embedding_model="_starve",
                top_k=3, kinds=["entity"], hops=0,
            )
            if hits:
                break
            await asyncio.sleep(0.1)

        target_hits = [h for h in hits if h.metadata["id"] in target_ids]
        # 隔离硬断言：召回的绝不泄漏噪声用户
        assert all(h.metadata["id"] in target_ids for h in hits), "跨用户泄漏"
        # 候选饥饿：目标用户应至少召回 1 条（若为 0，说明 overfetch 不足，需缓解）
        print(
            f"\n[tenant-starvation] target_hits={len(target_hits)}/3 "
            f"candidate_k>=128 noise_nodes=50"
        )
        assert len(target_hits) >= 1, "候选饥饿：目标用户被噪声完全挤占，overfetch 不足"
    finally:
        graph.delete()
