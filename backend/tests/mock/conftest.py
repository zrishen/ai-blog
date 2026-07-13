"""Mock 测试 fixtures — 屏蔽外部服务。"""

import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest


async def _fake_get_user_llm_settings(db, user_id):
    """模拟登录用户已配置自有 API 密钥，避免 chat/research service 触发无 key 拒绝。"""
    return SimpleNamespace(
        protocol="openai",
        base_url="https://example.com/v1",
        api_key="test-key",
        model_name="test-model",
    )


@pytest.fixture(autouse=True)
def mock_external_services():
    """自动 mock 所有外部服务。"""
    with patch("src.api.chat.stream_chat", side_effect=mock_stream_chat), \
         patch("src.services.llm_settings_service.get_user_llm_settings", new=_fake_get_user_llm_settings), \
         patch("src.services.chat_service.get_user_llm_settings", new=_fake_get_user_llm_settings), \
         patch("src.api.files.vectorize_and_store", return_value=[]), \
         patch("src.api.files.delete_document_chunks", return_value=True), \
         patch("src.utils.file_parser.parse_file", return_value="mocked content"), \
         patch("src.services.vector_store.list_collections", return_value=[]), \
         patch("src.services.vector_store.get_collection_count", return_value=0), \
         patch("src.services.vector_store.search", return_value=[]), \
         patch("src.services.vector_store.delete_document_chunks", return_value=True), \
         patch("src.services.vector_store.delete_collection", return_value=True), \
         patch("src.services.embedding_service.get_embeddings", return_value=[[0.1] * 384]), \
         patch("src.services.trash_service.vectorize_and_store", return_value=[]), \
         patch("src.services.trash_service.delete_document_chunks", return_value=True), \
         patch("src.services.trash_service.delete_post_file", return_value=True):
        yield


async def mock_stream_chat(
    content,
    conversation_id=None,
    user_id=None,
    image_url=None,
    file_url=None,
    thinking_mode="normal",
    context=None,
):
    """模拟流式聊天响应。"""
    yield "\0ROUNDDELTA\0" + json.dumps({"round_id": 1, "delta": "你好！这是一个测试回复。"})
    yield "\0ROUNDEND\0" + json.dumps({
        "round_id": 1,
        "classification": "final",
        "text": "你好！这是一个测试回复。",
        "loop_step_index": None,
    })
    yield "\n\n\0DONE\0\n" + json.dumps({
        "type": "done",
        "conversation_id": conversation_id or 1,
        "message_id": 1,
    })
