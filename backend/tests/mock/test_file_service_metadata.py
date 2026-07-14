from unittest.mock import patch

import pytest

from src.services.file_service import vectorize_and_store


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

    async def fake_add_documents(
        collection_name,
        documents,
        metadata_list=None,
        embeddings=None,
        progress_callback=None,
    ):
        await progress_callback(len(documents), len(documents), "chunk")

    with patch("src.utils.file_parser.parse_path", side_effect=fake_parse), \
         patch("src.utils.chunker.chunk_text", return_value=["第一片段", "第二片段"]), \
         patch("src.services.embedding_service.get_embeddings", side_effect=fake_embeddings), \
         patch("src.services.vector_store.add_documents", side_effect=fake_add_documents):
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

    async def fake_add_documents(
        collection_name,
        documents,
        metadata_list=None,
        embeddings=None,
        progress_callback=None,
    ):
        captured["collection_name"] = collection_name
        captured["documents"] = documents
        captured["metadata_list"] = metadata_list

    with patch("src.utils.file_parser.parse_path", return_value="第一段内容。\n第二段内容。"), \
         patch("src.services.embedding_service.get_embeddings", side_effect=_fake_embeddings), \
         patch("src.services.vector_store.add_documents", side_effect=fake_add_documents):
        chunks = await vectorize_and_store(
            "stored.pdf",
            "kb_doc",
            original_name="kb_doc.pdf",
            category_id=123,
        )

    assert chunks == ["第一段内容。\n第二段内容。"]
    assert captured["collection_name"] == "kb_doc"
    assert captured["documents"] == chunks

    metadata = captured["metadata_list"][0]
    assert metadata["source"] == "kb_doc.pdf"
    assert metadata["file_name"] == "kb_doc.pdf"
    assert metadata["original_name"] == "kb_doc.pdf"
    assert metadata["stored_name"] == "stored.pdf"
    assert metadata["file_type"] == "pdf"
    assert metadata["collection_name"] == "kb_doc"
    assert metadata["category_id"] == 123
    assert metadata["chunk_index"] == 0
    assert metadata["total_chunks"] == 1
    assert metadata["chunk_id"] == "stored.pdf:0"


@pytest.mark.asyncio
async def test_vectorize_and_store_omits_empty_category_metadata():
    captured = {}

    async def fake_add_documents(
        collection_name,
        documents,
        metadata_list=None,
        embeddings=None,
        progress_callback=None,
    ):
        captured["metadata_list"] = metadata_list

    with patch("src.utils.file_parser.parse_path", return_value="测试内容"), \
         patch("src.services.embedding_service.get_embeddings", side_effect=_fake_embeddings), \
         patch("src.services.vector_store.add_documents", side_effect=fake_add_documents):
        await vectorize_and_store("stored.docx", "doc_collection")

    metadata = captured["metadata_list"][0]
    assert metadata["source"] == "stored.docx"
    assert metadata["file_type"] == "docx"
    assert "category_id" not in metadata


@pytest.mark.asyncio
async def test_vectorize_and_store_metadata_matches_multiple_chunks():
    captured = {}

    async def fake_add_documents(
        collection_name,
        documents,
        metadata_list=None,
        embeddings=None,
        progress_callback=None,
    ):
        captured["documents"] = documents
        captured["metadata_list"] = metadata_list

    long_text = "这是一个用于测试递归字符分割的句子。" * 80
    with patch("src.utils.file_parser.parse_path", return_value=long_text), \
         patch("src.services.embedding_service.get_embeddings", side_effect=_fake_embeddings), \
         patch("src.services.vector_store.add_documents", side_effect=fake_add_documents):
        chunks = await vectorize_and_store("stored.pdf", "kb_long", original_name="long.pdf")

    assert len(chunks) > 1
    assert len(captured["documents"]) == len(chunks)
    assert len(captured["metadata_list"]) == len(chunks)
    assert captured["metadata_list"][0]["chunk_index"] == 0
    assert captured["metadata_list"][-1]["chunk_index"] == len(chunks) - 1
    assert all(metadata["total_chunks"] == len(chunks) for metadata in captured["metadata_list"])
