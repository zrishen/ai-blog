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
