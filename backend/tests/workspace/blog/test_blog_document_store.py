"""Filesystem contract tests for the canonical editable blog document store."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest

from src.config import settings
from src.core import path_guard
from src.core.exceptions import OwnershipError, ValidationFailedError
from src.core.path_guard import workspace_dir
from src.services.workspace.blog import blog_document_store
from src.services.workspace.blog.blog_document_store import (
    BlogDocument,
    BlogDocumentCorruptError,
    BlogDocumentNotFoundError,
    blog_document_path,
    read_blog_document,
    write_blog_document,
)


CREATED_AT = datetime(2025, 2, 3, 4, 5, 6, 123456, tzinfo=UTC)


@pytest.fixture
def workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "workspace"
    monkeypatch.setattr(settings, "workspace_root", str(root))
    monkeypatch.setattr(path_guard, "resolve_username", lambda user_id: f"user-{user_id}")
    return root


def test_write_round_trip_uses_deterministic_frontmatter_and_atomic_replace(workspace, monkeypatch):
    document = BlogDocument(
        slug="hello-world",
        title="Hello \"world\"",
        created_at=CREATED_AT,
        status="published",
        category="ai-writing",
        excerpt=None,
        tags="ai, writing",
        author="Ada",
        cover="/api/v1/blog/cover/hello.png",
        body="First line\r\nSecond line\n",
    )
    replaced: list[tuple[Path, Path]] = []
    fsync_calls: list[int] = []
    real_replace = blog_document_store.os.replace
    real_fsync = blog_document_store.os.fsync

    def tracked_replace(source, destination):
        replaced.append((Path(source), Path(destination)))
        return real_replace(source, destination)

    def tracked_fsync(descriptor):
        fsync_calls.append(descriptor)
        return real_fsync(descriptor)

    monkeypatch.setattr(blog_document_store.os, "replace", tracked_replace)
    monkeypatch.setattr(blog_document_store.os, "fsync", tracked_fsync)

    path = write_blog_document(1, document)

    assert path == workspace / "user-1" / "posts" / "hello-world.md"
    assert path.read_text(encoding="utf-8") == (
        '---\n'
        'type: "blog"\n'
        'title: "Hello \\"world\\""\n'
        'slug: "hello-world"\n'
        'status: "published"\n'
        'category: "ai-writing"\n'
        'excerpt: null\n'
        'tags: "ai, writing"\n'
        'author: "Ada"\n'
        'cover: "/api/v1/blog/cover/hello.png"\n'
        'created: "2025-02-03T04:05:06.123456Z"\n'
        '---\n'
        'First line\nSecond line\n'
    )
    assert read_blog_document(1, "hello-world") == document
    assert fsync_calls
    assert len(replaced) == 1
    temporary_path, destination = replaced[0]
    assert temporary_path.parent == destination.parent == path.parent
    assert temporary_path.name.startswith(".hello-world.md.")
    assert temporary_path.suffix == ".tmp"
    assert not temporary_path.exists()


def test_read_missing_document_has_no_creation_side_effect(workspace):
    user_root = workspace / "user-1"

    with pytest.raises(BlogDocumentNotFoundError):
        read_blog_document(1, "missing-post")

    assert not user_root.exists()
    assert blog_document_path(1, "missing-post") == user_root / "posts" / "missing-post.md"
    assert not user_root.exists()


def test_created_at_normalizes_existing_naive_utc_and_aware_offsets():
    naive_utc = BlogDocument(
        slug="naive-utc",
        title="Naive UTC",
        body="Body",
        created_at=datetime(2025, 2, 3, 4, 5, 6, 123456),
    )
    offset = BlogDocument(
        slug="offset-utc",
        title="Offset UTC",
        body="Body",
        created_at=datetime(2025, 2, 3, 12, 5, 6, 123456, tzinfo=timezone(timedelta(hours=8))),
    )

    assert naive_utc.created_at == CREATED_AT
    assert offset.created_at == CREATED_AT
    assert blog_document_store._serialize(naive_utc).endswith('created: "2025-02-03T04:05:06.123456Z"\n---\nBody')


@pytest.mark.parametrize(
    "contents",
    [
        "not frontmatter",
        (
            '---\ntype: "blog"\ntitle: "Title"\nslug: "wrong-slug"\nstatus: "draft"\ncategory: null\n'
            'excerpt: null\ntags: null\nauthor: null\ncover: null\ncreated: "2025-02-03T04:05:06.123456Z"\n---\nBody'
        ),
        (
            '---\ntype: "blog"\ntitle: "Title"\nslug: "corrupt-post"\nstatus: "draft"\ncategory: null\n'
            'excerpt: null\ntags: null\nauthor: null\ncover: null\ncreated: "2025-02-03T04:05:06Z"\n---\nBody'
        ),
        (
            '---\ntype: "blog"\ntitle: "Title"\nslug: "corrupt-post"\nstatus: "draft"\ncategory: null\n'
            'excerpt: null\ntags: null\nauthor: null\ncover: null\ncreated: "2025-02-03T04:05:06.123456Z"\n---\nBody\r\n'
        ),
    ],
)
def test_read_rejects_corrupt_or_noncanonical_document(workspace, contents):
    posts_dir = workspace_dir(1, create=True) / "posts"
    posts_dir.mkdir()
    (posts_dir / "corrupt-post.md").write_bytes(contents.encode("utf-8"))

    with pytest.raises(BlogDocumentCorruptError):
        read_blog_document(1, "corrupt-post")


@pytest.mark.parametrize("slug", ["../escape", "other/post", "C:drive", "CON", "hello_world", "Hello"])
def test_document_path_rejects_unvalidated_slugs(workspace, slug):
    with pytest.raises(ValidationFailedError):
        blog_document_path(1, slug)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("document_type", "note"),
        ("status", "archived"),
        ("category", "Not-a-slug"),
        ("cover", 123),
        ("created_at", "2025-02-03T04:05:06Z"),
    ],
)
def test_document_rejects_invalid_new_metadata(field, value):
    values = {
        "slug": "metadata-post",
        "title": "Metadata",
        "body": "Body",
        "created_at": CREATED_AT,
    }
    values[field] = value

    with pytest.raises(ValidationFailedError):
        BlogDocument(**values)


def test_documents_are_isolated_by_owner(workspace):
    write_blog_document(
        1,
        BlogDocument(slug="private-post", title="Private", body="Owner one only", created_at=CREATED_AT),
    )

    with pytest.raises(BlogDocumentNotFoundError):
        read_blog_document(2, "private-post")

    assert not (workspace / "user-2").exists()


def test_write_rejects_posts_directory_symlink_escape(workspace, tmp_path):
    root = workspace_dir(1, create=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    try:
        (root / "posts").symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("symlink needs developer mode or administrator permissions on Windows")

    with pytest.raises(OwnershipError):
        write_blog_document(1, BlogDocument(slug="safe-post", title="Safe", body="No escape", created_at=CREATED_AT))

    assert not (outside / "safe-post.md").exists()
