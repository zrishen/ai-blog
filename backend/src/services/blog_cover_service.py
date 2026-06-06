"""博客封面生成服务。"""

import base64
import uuid

from openai import AsyncOpenAI

from src.config import settings
from src.database.models import BlogPost
from src.services.file_service import get_user_upload_dir


def _plain_text(value: str | None, limit: int) -> str:
    text = (value or "").replace("#", " ").replace("*", " ").replace("`", " ")
    return " ".join(text.split())[:limit]


def _build_prompt(post: BlogPost) -> str:
    title = _plain_text(post.title, 120)
    tags = _plain_text(post.tags, 100)
    excerpt = _plain_text(post.excerpt or post.content, 700)
    return (
        "Create a refined 16:9 editorial blog cover image with clean composition, modern shapes, "
        "subtle depth, strong focal point, no readable text, no logo, no watermark. "
        f"Article title: {title}. "
        f"Tags: {tags or 'general technology and writing'}. "
        f"Content summary: {excerpt or title}."
    )


async def generate_cover_image(post: BlogPost) -> str:
    client = AsyncOpenAI(api_key=settings.openai_api_key, base_url=settings.base_url)
    try:
        result = await client.images.generate(
            model=settings.image_generation_model,
            prompt=_build_prompt(post),
            size=settings.image_generation_size,
            n=1,
        )
    except Exception as exc:
        raise ValueError(f"Image generation failed: {exc}") from exc

    if not result.data or not getattr(result.data[0], "b64_json", None):
        raise ValueError("Image generation did not return base64 image data")

    image_bytes = base64.b64decode(result.data[0].b64_json)
    stored_name = f"blog-cover-{post.id}-{uuid.uuid4().hex}.png"
    user_dir = get_user_upload_dir(post.user_id)
    (user_dir / stored_name).write_bytes(image_bytes)
    return f"/api/blog/cover/{stored_name}"
