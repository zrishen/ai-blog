from types import SimpleNamespace

import pytest

from src.config import settings
from src.services.blog import blog_cover_service


class FakeResponse:
    def __init__(self, *, payload=None, content=b"", content_type="application/json"):
        self._payload = payload or {}
        self.content = content
        self.headers = {"content-type": content_type}

    def json(self):
        return self._payload

    def raise_for_status(self):
        return None


class FakeAsyncClient:
    def __init__(self):
        self.post_calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, *, headers, json):
        self.post_calls.append((url, headers, json))
        return FakeResponse(payload={"images": [{"url": "https://images.example/cover.webp"}]})

    async def get(self, url):
        assert url == "https://images.example/cover.webp"
        return FakeResponse(content=b"image-bytes", content_type="image/webp")


def test_cover_prompt_derives_a_cute_hand_drawn_scene_from_article_content(monkeypatch):
    post = SimpleNamespace(title="Creative work", tags="writing", excerpt="A guide to ideas", content="")
    monkeypatch.setattr(settings, "image_generation_size", "1440x400")

    prompt = blog_cover_service._build_prompt(post)

    assert "cute, hand-drawn cartoon editorial illustration" in prompt
    assert "1440x400 ultra-wide blog cover" in prompt
    assert "Derive the central subject" in prompt
    assert "warm, playful colors" in prompt
    assert "Do not add generic AI" in prompt
    assert "No readable text" in prompt
    assert "Article title: Creative work." in prompt
    assert "Content summary: A guide to ideas." in prompt


@pytest.mark.asyncio
async def test_siliconflow_cover_is_downloaded_and_stored_locally(tmp_path, monkeypatch):
    client = FakeAsyncClient()
    post = SimpleNamespace(id=9, user_id=3, title="Test post", tags="AI", excerpt="Summary", content="")

    monkeypatch.setattr(settings, "image_generation_provider", "siliconflow")
    monkeypatch.setattr(settings, "image_generation_model", "Kwai-Kolors/Kolors")
    monkeypatch.setattr(settings, "image_generation_size", "1024x1024")
    monkeypatch.setattr(settings, "image_generation_base_url", "https://api.siliconflow.cn/v1")
    monkeypatch.setattr(settings, "image_generation_api_key", "siliconflow-test-key")
    monkeypatch.setattr(blog_cover_service, "get_user_upload_dir", lambda _user_id: tmp_path)
    monkeypatch.setattr(blog_cover_service.httpx, "AsyncClient", lambda *, timeout: client)

    cover_url = await blog_cover_service.generate_cover_image(post)

    assert cover_url.startswith("/api/v1/blog/cover/blog-cover-9-")
    stored_path = tmp_path / cover_url.rsplit("/", 1)[-1]
    assert stored_path.suffix == ".webp"
    assert stored_path.read_bytes() == b"image-bytes"
    request_url, headers, payload = client.post_calls[0]
    assert request_url == "https://api.siliconflow.cn/v1/images/generations"
    assert headers["Authorization"] == "Bearer siliconflow-test-key"
    assert payload["model"] == "Kwai-Kolors/Kolors"
    assert payload["image_size"] == "1024x1024"
    assert payload["batch_size"] == 1
