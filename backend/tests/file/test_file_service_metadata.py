from unittest.mock import patch

import pytest

from src.services.file.file_service import vectorize_and_store


async def _fake_embeddings(texts, progress_callback=None):
    return [[0.1] * 384 for _ in texts]


@pytest.mark.asyncio
async def test_vectorize_reports_black_box_stages_before_first_completed_unit():
    events = []

    async def reporter(stage, completed, total, unit):
        events.append((stage, completed, total, unit))

    def fake_parse(path, progress_callback=None):
        progress_callback(1, 2, "page")
        return "测试内容"

    async def fake_embeddings(texts, progress_callback=None):
        await progress_callback(len(texts), len(texts), "chunk")
        return [[0.1] * 384 for _ in texts]

    async def fake_add_document_chunks(**kwargs):
        await kwargs["progress_callback"](len(kwargs["chunks"]), len(kwargs["chunks"]), "chunk")

    with patch("src.utils.file_parser.parse_path", side_effect=fake_parse), \
         patch("src.utils.chunker.chunk_text", return_value=["第一片段", "第二片段"]), \
         patch("src.services.embeddings.embedding_service.get_embeddings", side_effect=fake_embeddings), \
         patch("src.services.memory.graph_store.add_document_chunks", side_effect=fake_add_document_chunks):
        await vectorize_and_store(
            "stored.pdf",
            "kb_progress",
            progress_reporter=reporter,
        )

    assert events[0] == ("parse", 0, 1, "operation")
    assert events.index(("embedding", 0, 2, "chunk")) < events.index(("embedding", 2, 2, "chunk"))
    assert events.index(("vector_store", 0, 2, "chunk")) < events.index(("vector_store", 2, 2, "chunk"))


@pytest.mark.asyncio
async def test_vectorize_and_store_writes_rich_metadata():
    captured = {}

    async def fake_add_document_chunks(**kwargs):
        captured.update(kwargs)

    with patch("src.utils.file_parser.parse_path", return_value="第一段内容。\n第二段内容。"), \
         patch("src.services.embeddings.embedding_service.get_embeddings", side_effect=_fake_embeddings), \
         patch("src.services.memory.graph_store.add_document_chunks", side_effect=fake_add_document_chunks):
        chunks = await vectorize_and_store(
            "stored.pdf",
            "kb_doc",
            original_name="kb_doc.pdf",
        )

    assert chunks == ["第一段内容。\n第二段内容。"]
    assert captured["collection_name"] == "kb_doc"
    assert captured["chunks"] == chunks

    metadata = captured["metadata_list"][0]
    assert metadata["source"] == "kb_doc.pdf"
    assert metadata["file_name"] == "kb_doc.pdf"
    assert metadata["original_name"] == "kb_doc.pdf"
    assert metadata["stored_name"] == "stored.pdf"
    assert metadata["file_type"] == "pdf"
    assert metadata["collection_name"] == "kb_doc"
    assert metadata["chunk_index"] == 0
    assert metadata["total_chunks"] == 1
    assert metadata["chunk_id"] == "stored.pdf:0"


@pytest.mark.asyncio
async def test_vectorize_and_store_writes_default_metadata():
    captured = {}

    async def fake_add_document_chunks(**kwargs):
        captured.update(kwargs)

    with patch("src.utils.file_parser.parse_path", return_value="测试内容"), \
         patch("src.services.embeddings.embedding_service.get_embeddings", side_effect=_fake_embeddings), \
         patch("src.services.memory.graph_store.add_document_chunks", side_effect=fake_add_document_chunks):
        await vectorize_and_store("stored.docx", "doc_collection")

    metadata = captured["metadata_list"][0]
    assert metadata["source"] == "stored.docx"
    assert metadata["file_type"] == "docx"
    assert metadata["collection_name"] == "doc_collection"
    assert metadata["user_id"] == 1
    assert metadata["total_chunks"] == 1


@pytest.mark.asyncio
async def test_vectorize_and_store_metadata_matches_multiple_chunks():
    captured = {}

    async def fake_add_document_chunks(**kwargs):
        captured.update(kwargs)

    long_text = "这是一个用于测试递归字符分割的句子。" * 80
    with patch("src.utils.file_parser.parse_path", return_value=long_text), \
         patch("src.services.embeddings.embedding_service.get_embeddings", side_effect=_fake_embeddings), \
         patch("src.services.memory.graph_store.add_document_chunks", side_effect=fake_add_document_chunks):
        chunks = await vectorize_and_store("stored.pdf", "kb_long", original_name="long.pdf")

    assert len(chunks) > 1
    assert len(captured["chunks"]) == len(chunks)
    assert len(captured["metadata_list"]) == len(chunks)
    assert captured["metadata_list"][0]["chunk_index"] == 0
    assert captured["metadata_list"][-1]["chunk_index"] == len(chunks) - 1
    assert all(metadata["total_chunks"] == len(chunks) for metadata in captured["metadata_list"])


@pytest.mark.asyncio
async def test_vectorize_and_store_writes_chunks_to_graph():
    captured = {}

    async def fake_add_document_chunks(**kwargs):
        captured["memory"] = kwargs

    with patch("src.utils.file_parser.parse_path", return_value="memory content"), \
         patch("src.services.embeddings.embedding_service.get_embeddings", side_effect=_fake_embeddings), \
         patch("src.services.memory.graph_store.add_document_chunks", side_effect=fake_add_document_chunks):
        await vectorize_and_store(
            "stored.pdf",
            "user_17_kb",
            original_name="memory.pdf",
            user_id=17,
            resource_type="file",
            resource_id=21,
        )

    assert captured["memory"]["user_id"] == 17
    assert captured["memory"]["collection_name"] == "user_17_kb"
    assert captured["memory"]["stored_name"] == "stored.pdf"
    assert captured["memory"]["chunks"] == ["memory content"]
    assert captured["memory"]["embedding_model"].startswith("_")
    assert captured["memory"]["vector_dim"] == 384
    assert captured["memory"]["metadata_list"][0]["resource_type"] == "file"
    assert captured["memory"]["metadata_list"][0]["resource_id"] == 21
