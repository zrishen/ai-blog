"""resource_resolver 判定单测（fake session，无 DB）。"""

from __future__ import annotations

from dataclasses import dataclass

from src.services.workspace.resource_resolver import (
    ResourceKind,
    resolve_workspace_resource,
)


@dataclass
class _FakeDoc:
    id: int
    file_path: str


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return list(self._rows)


class _FakeSession:
    def __init__(self, *, blog_post_id, documents=()):
        self._blog_post_id = blog_post_id
        self._documents = list(documents)

    async def scalar(self, _statement):
        return self._blog_post_id

    async def execute(self, _statement):
        return _Result(self._documents)


async def test_resolver_returns_blog_post_when_path_matches():
    db = _FakeSession(blog_post_id=7)
    resolved = await resolve_workspace_resource(db, user_id=1, relative_path="posts/hello.md")
    assert resolved.kind is ResourceKind.BLOG_POST
    assert resolved.resource_id == 7


async def test_resolver_returns_file_document_with_uploads_prefix():
    db = _FakeSession(blog_post_id=None, documents=[_FakeDoc(id=3, file_path="uploads/report.pdf")])
    resolved = await resolve_workspace_resource(db, user_id=1, relative_path="uploads/report.pdf")
    assert resolved.kind is ResourceKind.FILE_DOCUMENT
    assert resolved.resource_id == 3


async def test_resolver_normalizes_legacy_file_document_without_prefix():
    db = _FakeSession(blog_post_id=None, documents=[_FakeDoc(id=9, file_path="legacy.pdf")])
    resolved = await resolve_workspace_resource(db, user_id=1, relative_path="uploads/legacy.pdf")
    assert resolved.kind is ResourceKind.FILE_DOCUMENT
    assert resolved.resource_id == 9


async def test_resolver_returns_unmanaged_when_nothing_matches():
    db = _FakeSession(blog_post_id=None, documents=[_FakeDoc(id=3, file_path="uploads/other.pdf")])
    resolved = await resolve_workspace_resource(db, user_id=1, relative_path="notes/plain.md")
    assert resolved.kind is ResourceKind.UNMANAGED
    assert resolved.resource_id is None


async def test_resolver_skips_file_document_with_unnormalizable_path():
    db = _FakeSession(
        blog_post_id=None,
        documents=[_FakeDoc(id=3, file_path="../escape"), _FakeDoc(id=4, file_path="uploads/ok.pdf")],
    )
    resolved = await resolve_workspace_resource(db, user_id=1, relative_path="uploads/ok.pdf")
    assert resolved.kind is ResourceKind.FILE_DOCUMENT
    assert resolved.resource_id == 4
