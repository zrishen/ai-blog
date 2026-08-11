import pytest

from src.config import settings
from src.core.exceptions import ValidationFailedError
from src.services.workspace import workspace_git_service


@pytest.fixture
def workspace_root(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "workspace_root", str(tmp_path / "workspace"))


def test_workspace_git_tracks_diff_restore_and_ignores_recycle_bin(workspace_root):
    root = workspace_git_service.ensure_workspace_repository(1)
    document = root / "notes" / "plan.md"
    document.parent.mkdir()
    document.write_text("first\n", encoding="utf-8")
    assert workspace_git_service.record_workspace_change(1, "Write notes/plan.md") is True
    first_revision = workspace_git_service.list_workspace_git_revisions(1, limit=1)[0].revision

    document.write_text("second\n", encoding="utf-8")
    assert workspace_git_service.record_workspace_change(1, "Edit notes/plan.md") is True
    diff = workspace_git_service.get_workspace_git_diff(1, base_revision=first_revision)
    assert "-first" in diff
    assert "+second" in diff

    assert workspace_git_service.restore_workspace_file(
        1,
        relative_path="notes/plan.md",
        revision=first_revision,
    ) == "notes/plan.md"
    assert document.read_text(encoding="utf-8") == "first\n"
    assert workspace_git_service.record_workspace_change(1, "Restore notes/plan.md") is True

    recycle_file = root / ".trash" / "discarded.txt"
    recycle_file.parent.mkdir()
    recycle_file.write_text("ignored", encoding="utf-8")
    assert workspace_git_service.record_workspace_change(1, "Ignore recycle bin") is False
    status = workspace_git_service.get_workspace_git_status(1)
    assert status.changed_paths == ()
    assert len(workspace_git_service.list_workspace_git_revisions(1, limit=10)) == 4


def test_workspace_git_rejects_hidden_paths_and_untrusted_revisions(workspace_root):
    workspace_git_service.ensure_workspace_repository(1)

    with pytest.raises(ValidationFailedError):
        workspace_git_service.restore_workspace_file(1, relative_path=".git/config", revision="HEAD")
    with pytest.raises(ValidationFailedError):
        workspace_git_service.get_workspace_git_diff(1, base_revision="HEAD^;invalid")


def test_workspace_git_repositories_are_user_scoped(workspace_root):
    first = workspace_git_service.ensure_workspace_repository(1)
    second = workspace_git_service.ensure_workspace_repository(2)

    assert first != second
    assert (first / ".git").is_dir()
    assert (second / ".git").is_dir()
