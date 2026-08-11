"""Fixed-command Git history for one user's real workspace."""

from __future__ import annotations

import os
import re
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path

from src.core.exceptions import ConflictError, NotFoundError, OwnershipError, ValidationFailedError
from src.core.path_guard import workspace_dir, workspace_path
from src.core.workspace_path import validate_workspace_relative_path

_COMMAND_TIMEOUT_SECONDS = 20
_MAX_OUTPUT_CHARS = 40_000
_MAX_HISTORY_LIMIT = 50
_REVISION_RE = re.compile(r"(?:HEAD(?:~[1-9][0-9]*)?|[0-9a-fA-F]{7,64})\Z")
_GITIGNORE_LINE = ".trash/"


@dataclass(frozen=True)
class WorkspaceGitStatus:
    branch: str
    changed_paths: tuple[str, ...]
    head: str


@dataclass(frozen=True)
class WorkspaceGitRevision:
    revision: str
    committed_at: str
    subject: str


def validate_workspace_revision(value: str) -> str:
    if not isinstance(value, str) or not _REVISION_RE.fullmatch(value):
        raise ValidationFailedError("Workspace revision is invalid")
    return value


def _run_git(root: Path, *args: str, allowed_returncodes: tuple[int, ...] = (0,)) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(
            ["git", "-c", "core.quotepath=false", *args],
            cwd=root,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=_COMMAND_TIMEOUT_SECONDS,
            shell=False,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise OwnershipError("Workspace Git is unavailable") from exc
    if result.returncode not in allowed_returncodes:
        detail = (result.stderr or result.stdout).strip().replace("\n", " ")
        raise ConflictError(f"Workspace Git operation failed: {detail[:500] or 'unknown error'}")
    return result


def _write_gitignore(root: Path) -> None:
    path = root / ".gitignore"
    if path.is_symlink():
        raise OwnershipError("Workspace .gitignore cannot be a symbolic link")
    try:
        current = path.read_text(encoding="utf-8") if path.exists() else ""
    except OSError as exc:
        raise OwnershipError("Workspace .gitignore could not be read") from exc
    if _GITIGNORE_LINE in current.splitlines():
        return
    updated = f"{current.rstrip()}\n{_GITIGNORE_LINE}\n" if current else f"{_GITIGNORE_LINE}\n"
    temporary = root / f".gitignore.{uuid.uuid4().hex}.tmp"
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as output:
            output.write(updated)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    except OSError as exc:
        raise OwnershipError("Workspace .gitignore could not be written") from exc
    finally:
        temporary.unlink(missing_ok=True)


def ensure_workspace_repository(user_id: int) -> Path:
    """Create one local-only Git repository and its initial snapshot if needed."""

    root = workspace_dir(user_id, create=True)
    git_dir = root / ".git"
    if git_dir.exists():
        if git_dir.is_symlink():
            raise OwnershipError("Workspace Git directory cannot be a symbolic link")
        _run_git(root, "rev-parse", "--is-inside-work-tree")
        return root

    _write_gitignore(root)
    _run_git(root, "init", "--quiet")
    _run_git(root, "config", "user.name", "AI Blog Workspace")
    _run_git(root, "config", "user.email", "workspace@local.invalid")
    _run_git(root, "add", "--all", "--", ".")
    _run_git(root, "commit", "--quiet", "-m", "Initialize workspace")
    return root


def record_workspace_change(user_id: int, summary: str) -> bool:
    """Commit all non-ignored workspace changes with a server-defined summary."""

    root = ensure_workspace_repository(user_id)
    _run_git(root, "add", "--all", "--", ".")
    staged = _run_git(root, "diff", "--cached", "--quiet", allowed_returncodes=(0, 1))
    if staged.returncode == 0:
        return False
    _run_git(root, "commit", "--quiet", "-m", summary.replace("\r", " ").replace("\n", " ")[:200])
    return True


def get_workspace_git_status(user_id: int) -> WorkspaceGitStatus:
    root = ensure_workspace_repository(user_id)
    branch = _run_git(root, "branch", "--show-current").stdout.strip() or "HEAD"
    changed_paths = tuple(
        line[3:] for line in _run_git(root, "status", "--porcelain=v1", "--untracked-files=all").stdout.splitlines()
    )
    head = _run_git(root, "rev-parse", "--short", "HEAD").stdout.strip()
    return WorkspaceGitStatus(branch=branch, changed_paths=changed_paths, head=head)


def list_workspace_git_revisions(user_id: int, *, limit: int = 10) -> list[WorkspaceGitRevision]:
    root = ensure_workspace_repository(user_id)
    limit = max(1, min(limit, _MAX_HISTORY_LIMIT))
    output = _run_git(root, "log", f"--max-count={limit}", "--format=%H%x1f%cI%x1f%s").stdout
    revisions: list[WorkspaceGitRevision] = []
    for line in output.splitlines():
        revision, committed_at, subject = line.split("\x1f", maxsplit=2)
        revisions.append(WorkspaceGitRevision(revision=revision, committed_at=committed_at, subject=subject))
    return revisions


def get_workspace_git_diff(user_id: int, *, base_revision: str, target_revision: str = "HEAD") -> str:
    root = ensure_workspace_repository(user_id)
    base_revision = validate_workspace_revision(base_revision)
    target_revision = validate_workspace_revision(target_revision)
    output = _run_git(root, "diff", "--no-ext-diff", base_revision, target_revision, "--").stdout
    if len(output) > _MAX_OUTPUT_CHARS:
        return f"{output[:_MAX_OUTPUT_CHARS]}\n... diff truncated ..."
    return output or "No differences."


def restore_workspace_file(user_id: int, *, relative_path: str, revision: str) -> str:
    """Restore one regular file from a validated local revision."""

    root = ensure_workspace_repository(user_id)
    relative_path = validate_workspace_relative_path(relative_path)
    revision = validate_workspace_revision(revision)
    _run_git(root, "restore", f"--source={revision}", "--", relative_path)
    target = workspace_path(user_id, relative_path)
    if target.is_symlink():
        target.unlink(missing_ok=True)
        raise OwnershipError("Workspace revision contains an unsafe symbolic link")
    if not target.is_file():
        raise NotFoundError("Workspace revision does not contain a regular file")
    return relative_path
