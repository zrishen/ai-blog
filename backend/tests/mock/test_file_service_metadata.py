from unittest.mock import AsyncMock, patch

import pytest

from src.services.file_service import vectorize_and_store


@pytest.mark.asyncio
async def test_vectorize_and_store_writes_rich_metadata():
    captured = {}

    async def fake_add_documents(collection_name, documents, metadata_list=None):
        captured["collection_name"] = collection_name
        captured["documents"] = documents
        captured["metadata_list"] = metadata_list

    with patch("src.utils.file_parser.parse_file", AsyncMock(return_value="第一段内容。\n第二段内容。")), \
         patch("src.services.embedding_service.get_embeddings", AsyncMock(return_value=[[0.1] * 384])), \
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

    async def fake_add_documents(collection_name, documents, metadata_list=None):
        captured["metadata_list"] = metadata_list

    with patch("src.utils.file_parser.parse_file", AsyncMock(return_value="测试内容")), \
         patch("src.services.embedding_service.get_embeddings", AsyncMock(return_value=[[0.1] * 384])), \
         patch("src.services.vector_store.add_documents", side_effect=fake_add_documents):
        await vectorize_and_store("stored.docx", "doc_collection")

    metadata = captured["metadata_list"][0]
    assert metadata["source"] == "stored.docx"
    assert metadata["file_type"] == "docx"
    assert "category_id" not in metadata


@pytest.mark.asyncio
async def test_vectorize_and_store_metadata_matches_multiple_chunks():
    captured = {}

    async def fake_add_documents(collection_name, documents, metadata_list=None):
        captured["documents"] = documents
        captured["metadata_list"] = metadata_list

    long_text = "这是一个用于测试递归字符分割的句子。" * 80
    with patch("src.utils.file_parser.parse_file", AsyncMock(return_value=long_text)), \
         patch("src.services.embedding_service.get_embeddings", AsyncMock(return_value=[[0.1] * 384])), \
         patch("src.services.vector_store.add_documents", side_effect=fake_add_documents):
        chunks = await vectorize_and_store("stored.pdf", "kb_long", original_name="long.pdf")

    assert len(chunks) > 1
    assert len(captured["documents"]) == len(chunks)
    assert len(captured["metadata_list"]) == len(chunks)
    assert captured["metadata_list"][0]["chunk_index"] == 0
    assert captured["metadata_list"][-1]["chunk_index"] == len(chunks) - 1
    assert all(metadata["total_chunks"] == len(chunks) for metadata in captured["metadata_list"])
