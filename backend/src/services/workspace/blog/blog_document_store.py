"""Canonical filesystem storage for editable blog documents.

This module deliberately accepts an owner id and a validated slug, never a
caller-supplied filesystem path.  Higher-level blog services will be wired to
it in a later phase.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from src.core.exceptions import NotFoundError, OwnershipError, ValidationFailedError
from src.core.path_guard import workspace_dir, workspace_path
from src.utils.user_dir import validate_user_directory_name

_FRONTMATTER_FIELDS = (
    "type",
    "title",
    "slug",
    "status",
    "category",
    "excerpt",
    "tags",
    "author",
    "cover",
    "created",
)
_SLUG_RE = re.compile(r"[^\W_]+(?:-[^\W_]+)*", re.UNICODE)
_MAX_SLUG_LENGTH = 200
_MAX_CATEGORY_SLUG_LENGTH = 100
_VALID_STATUSES = {"draft", "published"}
_CREATED_FORMAT = "%Y-%m-%dT%H:%M:%S.%fZ"
_CREATED_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z")


class BlogDocumentNotFoundError(NotFoundError):
    """The controlled blog document does not exist for this owner and slug."""


class BlogDocumentCorruptError(ValidationFailedError):
    """A document is not in the exact format owned by this store."""


class BlogDocumentStorageError(RuntimeError):
    """A controlled document could not be read from or written to storage."""


def _validate_slug(slug: str) -> str:
    if (
        not isinstance(slug, str)
        or not slug
        or len(slug) > _MAX_SLUG_LENGTH
        or slug != slug.lower()
        or _SLUG_RE.fullmatch(slug) is None
    ):
        raise ValidationFailedError("Blog document slug is invalid")
    try:
        return validate_user_directory_name(slug)
    except ValueError as exc:
        raise ValidationFailedError("Blog document slug is invalid") from exc


def _validate_optional_text(value: str | None, field: str, *, max_length: int | None = None) -> None:
    if value is not None and not isinstance(value, str):
        raise ValidationFailedError(f"Blog document {field} must be text or null")
    if max_length is not None and value is not None and len(value) > max_length:
        raise ValidationFailedError(f"Blog document {field} is too long")


def _validate_category(category: str | None) -> None:
    if category is None:
        return
    if (
        not isinstance(category, str)
        or not category
        or len(category) > _MAX_CATEGORY_SLUG_LENGTH
        or category != category.lower()
        or _SLUG_RE.fullmatch(category) is None
    ):
        raise ValidationFailedError("Blog document category must be a valid category slug or null")


def _normalize_created_at(value: datetime) -> datetime:
    if not isinstance(value, datetime):
        raise ValidationFailedError("Blog document created_at must be a datetime")
    if value.tzinfo is None:
        # Existing BlogPost.created_at values are naive UTC datetimes.
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _parse_created(value: str) -> datetime:
    if _CREATED_RE.fullmatch(value) is None:
        raise ValidationFailedError("Blog document created must be UTC ISO-8601")
    try:
        return datetime.strptime(value, _CREATED_FORMAT).replace(tzinfo=UTC)
    except ValueError as exc:
        raise ValidationFailedError("Blog document created must be UTC ISO-8601") from exc


@dataclass(frozen=True)
class BlogDocument:
    """A strict, filesystem-canonical editable blog document."""

    slug: str
    title: str
    body: str
    created_at: datetime
    document_type: str = "blog"
    status: str = "draft"
    category: str | None = None
    excerpt: str | None = None
    tags: str | None = None
    author: str | None = None
    cover: str | None = None

    def __post_init__(self) -> None:
        _validate_slug(self.slug)
        if not isinstance(self.title, str) or not self.title.strip() or len(self.title) > 300:
            raise ValidationFailedError("Blog document title is required")
        if not isinstance(self.body, str):
            raise ValidationFailedError("Blog document body must be text")
        if self.document_type != "blog":
            raise ValidationFailedError("Blog document type must be blog")
        if self.status not in _VALID_STATUSES:
            raise ValidationFailedError("Blog document status is invalid")
        _validate_category(self.category)
        _validate_optional_text(self.excerpt, "excerpt", max_length=500)
        _validate_optional_text(self.tags, "tags", max_length=500)
        _validate_optional_text(self.author, "author", max_length=100)
        _validate_optional_text(self.cover, "cover", max_length=500)
        object.__setattr__(self, "created_at", _normalize_created_at(self.created_at))
        object.__setattr__(self, "body", self.body.replace("\r\n", "\n").replace("\r", "\n"))


def blog_document_path(user_id: int, slug: str) -> Path:
    """Return a guarded ``posts/<slug>.md`` path without creating anything."""

    slug = _validate_slug(slug)
    return workspace_path(user_id, f"posts/{slug}.md")


def _posts_dir(user_id: int) -> Path:
    root = workspace_dir(user_id, create=True)
    posts_dir = root / "posts"
    try:
        posts_dir.mkdir(exist_ok=True)
    except OSError as exc:
        raise BlogDocumentStorageError("Unable to create the controlled posts directory") from exc
    if posts_dir.is_symlink() or not posts_dir.is_dir():
        raise OwnershipError("Blog posts directory is not a safe directory")
    return posts_dir


def _serialize(document: BlogDocument) -> str:
    values = {
        "type": document.document_type,
        "title": document.title,
        "slug": document.slug,
        "status": document.status,
        "category": document.category,
        "excerpt": document.excerpt,
        "tags": document.tags,
        "author": document.author,
        "cover": document.cover,
        "created": document.created_at.strftime(_CREATED_FORMAT),
    }
    frontmatter = "\n".join(
        ["---", *(f"{field}: {json.dumps(values[field], ensure_ascii=False)}" for field in _FRONTMATTER_FIELDS), "---", ""]
    )
    return frontmatter + document.body


def _parse(text: str, expected_slug: str) -> BlogDocument:
    if not text.startswith("---\n"):
        raise BlogDocumentCorruptError("Blog document frontmatter is missing")

    delimiter = "\n---\n"
    end = text.find(delimiter, len("---\n"))
    if end < 0:
        raise BlogDocumentCorruptError("Blog document frontmatter is incomplete")

    lines = text[len("---\n"):end].split("\n")
    if len(lines) != len(_FRONTMATTER_FIELDS):
        raise BlogDocumentCorruptError("Blog document frontmatter fields are invalid")

    values: dict[str, str | None] = {}
    for field, line in zip(_FRONTMATTER_FIELDS, lines, strict=True):
        prefix = f"{field}: "
        if not line.startswith(prefix):
            raise BlogDocumentCorruptError("Blog document frontmatter fields are invalid")
        try:
            value = json.loads(line[len(prefix):])
        except json.JSONDecodeError as exc:
            raise BlogDocumentCorruptError("Blog document frontmatter values are invalid") from exc
        if field in {"type", "title", "slug", "status", "created"}:
            if not isinstance(value, str):
                raise BlogDocumentCorruptError("Blog document frontmatter values are invalid")
        elif value is not None and not isinstance(value, str):
            raise BlogDocumentCorruptError("Blog document frontmatter values are invalid")
        values[field] = value

    try:
        document = BlogDocument(
            slug=values["slug"] or "",
            title=values["title"] or "",
            body=text[end + len(delimiter):],
            created_at=_parse_created(values["created"] or ""),
            document_type=values["type"] or "",
            status=values["status"] or "",
            category=values["category"],
            excerpt=values["excerpt"],
            tags=values["tags"],
            author=values["author"],
            cover=values["cover"],
        )
    except ValidationFailedError as exc:
        raise BlogDocumentCorruptError("Blog document frontmatter values are invalid") from exc

    if document.slug != expected_slug or _serialize(document) != text:
        raise BlogDocumentCorruptError("Blog document does not match its controlled path")
    return document


def read_blog_document(user_id: int, slug: str) -> BlogDocument:
    """Read one managed document without creating an owner or ``posts`` directory."""

    slug = _validate_slug(slug)
    path = blog_document_path(user_id, slug)
    if path.is_symlink():
        raise OwnershipError("Blog document must not be a symbolic link")
    if not path.exists():
        raise BlogDocumentNotFoundError("Blog document not found")
    if not path.is_file():
        raise BlogDocumentCorruptError("Blog document is not a regular file")
    try:
        text = path.read_bytes().decode("utf-8")
    except UnicodeDecodeError as exc:
        raise BlogDocumentCorruptError("Blog document is not valid UTF-8") from exc
    except OSError as exc:
        raise BlogDocumentStorageError("Blog document could not be read") from exc
    return _parse(text, slug)


def _fsync_directory(directory: Path) -> None:
    """Persist the rename on platforms that permit opening directory handles."""

    try:
        descriptor = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    except OSError:
        return
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _atomic_write(path: Path, content: str) -> None:
    temporary_path = path.parent / f".{path.name}.{uuid.uuid4().hex}.tmp"
    try:
        with temporary_path.open("xb") as output:
            output.write(content.encode("utf-8"))
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_path, path)
        _fsync_directory(path.parent)
    except OSError as exc:
        raise BlogDocumentStorageError("Blog document could not be written") from exc
    finally:
        try:
            temporary_path.unlink(missing_ok=True)
        except OSError:
            pass


def write_blog_document(user_id: int, document: BlogDocument) -> Path:
    """Atomically write one document to its only permitted workspace location."""

    if not isinstance(document, BlogDocument):
        raise ValidationFailedError("Blog document payload is invalid")
    _validate_slug(document.slug)
    _posts_dir(user_id)
    path = workspace_path(user_id, f"posts/{document.slug}.md", mode="write")
    if path.is_symlink():
        raise OwnershipError("Blog document must not be a symbolic link")
    _atomic_write(path, _serialize(document))
    return path
