"""Tests for the working-copy body seam before the filesystem cutover."""

from src.database.models import BlogPost
from src.services.workspace.blog.blog_body_service import get_post_body


def test_get_post_body_is_exactly_the_legacy_working_copy() -> None:
    body = "First line\r\nSecond line\n"
    post = BlogPost(title="Post", slug="post", content=body)

    assert get_post_body(post) is body
