"""Mock 测试 fixtures — 屏蔽外部服务。"""

import json
from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def mock_external_services():
    """自动 mock 所有外部服务。"""
    with patch("src.api.chat.stream_chat", side_effect=mock_stream_chat), \
         patch("src.api.kb.vectorize_and_store", return_value=[]), \
         patch("src.api.kb.list_collections", return_value=[]), \
         patch("src.api.kb.get_collection_count", return_value=0), \
         patch("src.api.kb.delete_document_chunks", return_value=True), \
         patch("src.api.kb.delete_collection", return_value=True), \
         patch("src.utils.file_parser.parse_file", return_value="mocked content"), \
         patch("src.services.vector_store.list_collections", return_value=[]), \
         patch("src.services.vector_store.get_collection_count", return_value=0), \
         patch("src.services.vector_store.search", return_value=[]), \
         patch("src.services.vector_store.delete_document_chunks", return_value=True), \
         patch("src.services.vector_store.delete_collection", return_value=True), \
         patch("src.services.embedding_service.get_embeddings", return_value=[[0.1] * 384]):
        yield


async def mock_stream_chat(
    content,
    conversation_id=None,
    user_id=None,
    image_url=None,
    file_url=None,
    use_rag=False,
    rag_mode=None,
    thinking_mode="normal",
    context=None,
):
    """模拟流式聊天响应。"""
    yield "你好！这是一个测试回复。"
    yield "\n\n\0DONE\0\n" + json.dumps({
        "type": "done",
        "conversation_id": conversation_id or 1,
        "message_id": 1,
    })
