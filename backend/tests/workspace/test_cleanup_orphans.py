from src.services.workspace.file.orphan_cleanup_service import cleanup_workspace_upload_orphans


def test_cleanup_upload_orphans_is_user_scoped(tmp_path):
    workspace = tmp_path / "workspace"
    user1_uploads = workspace / "users" / "1" / "uploads"
    user2_uploads = workspace / "users" / "2" / "uploads"
    user1_uploads.mkdir(parents=True)
    user2_uploads.mkdir(parents=True)
    for upload_root in (user1_uploads, user2_uploads):
        (upload_root / "shared.pdf").write_bytes(b"shared")
        (upload_root / "orphan.pdf").write_bytes(b"orphan")

    removed = cleanup_workspace_upload_orphans(
        workspace,
        {1: {"shared.pdf"}},
        dry_run=False,
    )

    assert removed == 3
    assert (user1_uploads / "shared.pdf").exists()
    assert not (user1_uploads / "orphan.pdf").exists()
    assert not (user2_uploads / "shared.pdf").exists()
    assert not (user2_uploads / "orphan.pdf").exists()


def test_cleanup_upload_orphans_dry_run_preserves_files(tmp_path):
    workspace = tmp_path / "workspace"
    upload = workspace / "users" / "7" / "uploads" / "orphan.txt"
    upload.parent.mkdir(parents=True)
    upload.write_text("x", encoding="utf-8")

    assert cleanup_workspace_upload_orphans(workspace, {}, dry_run=True) == 1
    assert upload.exists()


def test_cleanup_upload_orphans_skips_non_user_id_roots(tmp_path):
    workspace = tmp_path / "workspace"
    upload = workspace / "users" / "legacy-name" / "uploads" / "unknown.txt"
    upload.parent.mkdir(parents=True)
    upload.write_text("x", encoding="utf-8")

    assert cleanup_workspace_upload_orphans(workspace, {}, dry_run=False) == 0
    assert upload.exists()
