"""博客封面生成服务。"""

import base64
import mimetypes
import uuid

import httpx
from openai import AsyncOpenAI

from src.config import settings
from src.database.models import BlogPost
from src.services.file.file_service import get_user_upload_dir


def _plain_text(value: str | None, limit: int) -> str:
    text = (value or "").replace("#", " ").replace("*", " ").replace("`", " ")
    return " ".join(text.split())[:limit]


def _build_prompt(post: BlogPost) -> str:
    title = _plain_text(post.title, 120)
    tags = _plain_text(post.tags, 100)
    excerpt = _plain_text(post.excerpt or post.content, 700)
    return (
        f"Create a cute, hand-drawn cartoon editorial illustration for a {settings.image_generation_size} "
        "ultra-wide blog cover. "
        "Derive the central subject, characters, setting, and symbolic details from the article title, "
        "tags, and summary below, turning its core idea into one clear visual narrative. "
        "Use warm, playful colors, soft outlines, expressive details, and a friendly illustrated feel. "
        "Do not add generic AI, futuristic, city, or architecture imagery unless it is genuinely relevant "
        "to the article. No readable text, no logo, no watermark. "
        f"Article title: {title}. "
        f"Tags: {tags or 'general technology and writing'}. "
        f"Content summary: {excerpt or title}."
    )


def _image_api_key() -> str:
    return settings.image_generation_api_key or settings.openai_api_key


def _image_base_url() -> str:
    return settings.image_generation_base_url or settings.base_url


def _stored_cover_name(post: BlogPost, content_type: str | None = None) -> str:
    media_type = (content_type or "").split(";", 1)[0].strip().lower()
    extension = {
        "image/avif": ".avif",
        "image/gif": ".gif",
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
    }.get(media_type) or mimetypes.guess_extension(media_type) or ".png"
    if extension not in {".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"}:
        extension = ".png"
    return f"blog-cover-{post.id}-{uuid.uuid4().hex}{extension}"


def _store_cover_image(post: BlogPost, image_bytes: bytes, content_type: str | None = None) -> str:
    if not image_bytes:
        raise ValueError("Image generation returned an empty image")
    stored_name = _stored_cover_name(post, content_type)
    user_dir = get_user_upload_dir(post.user_id)
    (user_dir / stored_name).write_bytes(image_bytes)
    return f"/api/v1/blog/cover/{stored_name}"


async def _generate_siliconflow_cover(post: BlogPost, prompt: str) -> str:
    api_key = _image_api_key()
    if not api_key:
        raise ValueError("IMAGE_GENERATION_API_KEY or OPENAI_API_KEY is required for image generation")

    endpoint = f"{_image_base_url().rstrip('/')}/images/generations"
    payload = {
        "model": settings.image_generation_model,
        "prompt": prompt,
        "image_size": settings.image_generation_size,
        "batch_size": 1,
    }
    timeout = httpx.Timeout(180.0, connect=20.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(endpoint, headers={"Authorization": f"Bearer {api_key}"}, json=payload)
            response.raise_for_status()
            images = response.json().get("images") or []
            image_url = images[0].get("url") if images and isinstance(images[0], dict) else None
            if not image_url:
                raise ValueError("Image generation did not return an image URL")
            image_response = await client.get(image_url)
            image_response.raise_for_status()
    except httpx.HTTPError as exc:
        raise ValueError(f"Image generation failed: {exc}") from exc

    return _store_cover_image(post, image_response.content, image_response.headers.get("content-type"))


async def generate_cover_image(post: BlogPost) -> str:
    prompt = _build_prompt(post)
    if settings.image_generation_provider == "siliconflow":
        return await _generate_siliconflow_cover(post, prompt)

    client = AsyncOpenAI(api_key=_image_api_key(), base_url=_image_base_url())
    try:
        result = await client.images.generate(
            model=settings.image_generation_model,
            prompt=prompt,
            size=settings.image_generation_size,
            n=1,
        )
    except Exception as exc:
        raise ValueError(f"Image generation failed: {exc}") from exc

    if not result.data or not getattr(result.data[0], "b64_json", None):
        raise ValueError("Image generation did not return base64 image data")

    return _store_cover_image(post, base64.b64decode(result.data[0].b64_json), "image/png")
