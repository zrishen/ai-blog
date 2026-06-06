from src.database.models import Base
from src.database.session import engine


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _migrate_users()
    await _migrate_image_url()
    await _migrate_file_url()
    await _migrate_kb_documents()
    await _migrate_mcp_servers()
    await _migrate_blog_tables()
    await _migrate_kb_categories()
    await _migrate_kb_categories_parent()
    await _migrate_kb_document_category()
    await _migrate_kb_document_user_id()
    await _migrate_conversation_user_id()
    await _migrate_blog_file_path()
    await _migrate_blog_user_id()
    await _migrate_blog_unique_scopes()
    await _migrate_kb_category_user_scope()
    await _migrate_mcp_user_scope()
    await _migrate_research_graph()
    await _migrate_research_entity_enhancements()
    await _migrate_blog_file_storage()


async def _table_exists(conn, table_name: str) -> bool:
    from sqlalchemy import text

    result = await conn.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name=:name"),
        {"name": table_name},
    )
    return result.scalar_one_or_none() is not None


async def _columns(conn, table_name: str) -> list[str]:
    from sqlalchemy import text

    result = await conn.execute(text(f"PRAGMA table_info({table_name})"))
    return [row[1] for row in result.fetchall()]


async def _has_unique_index_on(conn, table_name: str, columns: list[str]) -> bool:
    from sqlalchemy import text

    indexes = await conn.execute(text(f"PRAGMA index_list({table_name})"))
    for row in indexes.fetchall():
        index_name = row[1]
        is_unique = bool(row[2])
        if not is_unique:
            continue
        index_columns = await conn.execute(text(f"PRAGMA index_info({index_name})"))
        names = [col[2] for col in index_columns.fetchall()]
        if names == columns:
            return True
    return False


async def _migrate_blog_file_path():
    from sqlalchemy import text

    async with engine.connect() as conn:
        columns = await _columns(conn, "blog_posts")
        if "file_path" not in columns:
            await conn.execute(text("ALTER TABLE blog_posts ADD COLUMN file_path TEXT"))
            await conn.commit()


async def _migrate_image_url():
    from sqlalchemy import text

    async with engine.connect() as conn:
        columns = await _columns(conn, "messages")
        if "image_url" not in columns:
            await conn.execute(text("ALTER TABLE messages ADD COLUMN image_url TEXT"))
            await conn.commit()


async def _migrate_file_url():
    from sqlalchemy import text

    async with engine.connect() as conn:
        columns = await _columns(conn, "messages")
        if "file_url" not in columns:
            await conn.execute(text("ALTER TABLE messages ADD COLUMN file_url TEXT"))
            await conn.commit()


async def _migrate_mcp_servers():
    from sqlalchemy import text

    async with engine.connect() as conn:
        if not await _table_exists(conn, "mcp_servers"):
            await conn.execute(text("""
                CREATE TABLE mcp_servers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
                    name TEXT NOT NULL,
                    server_type TEXT NOT NULL,
                    tools JSON,
                    command TEXT,
                    args TEXT,
                    env_vars TEXT,
                    url TEXT,
                    is_active BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uq_mcp_servers_user_name UNIQUE (user_id, name)
                )
            """))
            await conn.commit()


async def _migrate_kb_documents():
    from sqlalchemy import text

    async with engine.connect() as conn:
        if not await _table_exists(conn, "kb_documents"):
            await conn.execute(text("""
                CREATE TABLE kb_documents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    collection_name TEXT NOT NULL,
                    user_id TEXT NOT NULL DEFAULT 'default_user',
                    original_name TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    chunk_content TEXT NOT NULL,
                    metadata TEXT,
                    category_id INTEGER REFERENCES kb_categories(id),
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            await conn.commit()


async def _migrate_blog_tables():
    from sqlalchemy import text

    async with engine.connect() as conn:
        if not await _table_exists(conn, "blog_categories"):
            await conn.execute(text("""
                CREATE TABLE blog_categories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
                    name TEXT NOT NULL,
                    slug TEXT NOT NULL,
                    description TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uq_blog_categories_user_slug UNIQUE (user_id, slug),
                    CONSTRAINT uq_blog_categories_user_name UNIQUE (user_id, name)
                )
            """))
        if not await _table_exists(conn, "blog_posts"):
            await conn.execute(text("""
                CREATE TABLE blog_posts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    slug TEXT NOT NULL,
                    content TEXT NOT NULL,
                    excerpt TEXT,
                    cover_image TEXT,
                    status TEXT DEFAULT 'draft',
                    category_id INTEGER REFERENCES blog_categories(id),
                    tags TEXT,
                    author TEXT,
                    view_count INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    published_at DATETIME,
                    file_path TEXT,
                    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
                    CONSTRAINT uq_blog_posts_user_slug UNIQUE (user_id, slug)
                )
            """))
        await conn.commit()


async def _migrate_kb_categories():
    from sqlalchemy import text

    async with engine.connect() as conn:
        if not await _table_exists(conn, "kb_categories"):
            await conn.execute(text("""
                CREATE TABLE kb_categories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
                    name TEXT NOT NULL,
                    slug TEXT NOT NULL,
                    description TEXT,
                    parent_id INTEGER REFERENCES kb_categories(id) ON DELETE SET NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uq_kb_categories_user_slug UNIQUE (user_id, slug),
                    CONSTRAINT uq_kb_categories_user_name UNIQUE (user_id, name)
                )
            """))
            await conn.commit()


async def _migrate_kb_categories_parent():
    from sqlalchemy import text

    async with engine.connect() as conn:
        columns = await _columns(conn, "kb_categories")
        if "parent_id" not in columns:
            await conn.execute(text("ALTER TABLE kb_categories ADD COLUMN parent_id INTEGER REFERENCES kb_categories(id) ON DELETE SET NULL"))
            await conn.commit()


async def _migrate_kb_document_category():
    from sqlalchemy import text

    async with engine.connect() as conn:
        columns = await _columns(conn, "kb_documents")
        if "category_id" not in columns:
            await conn.execute(text("ALTER TABLE kb_documents ADD COLUMN category_id INTEGER REFERENCES kb_categories(id)"))
            await conn.commit()


async def _migrate_kb_document_user_id():
    from sqlalchemy import text

    async with engine.connect() as conn:
        columns = await _columns(conn, "kb_documents")
        if "user_id" not in columns:
            await conn.execute(text("ALTER TABLE kb_documents ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default_user'"))
            await conn.commit()


async def _migrate_users():
    from sqlalchemy import text

    async with engine.connect() as conn:
        if not await _table_exists(conn, "users"):
            await conn.execute(text("""
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            await conn.commit()


async def _migrate_conversation_user_id():
    from sqlalchemy import text

    async with engine.connect() as conn:
        columns = await _columns(conn, "conversations")
        if "user_id" not in columns:
            await conn.execute(text("ALTER TABLE conversations ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id)"))
            await conn.commit()


async def _migrate_blog_user_id():
    from sqlalchemy import text

    async with engine.connect() as conn:
        columns = await _columns(conn, "blog_posts")
        if "user_id" not in columns:
            await conn.execute(text("ALTER TABLE blog_posts ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id)"))
            await conn.commit()


async def _migrate_blog_unique_scopes():
    from sqlalchemy import text

    async with engine.connect() as conn:
        blog_category_columns = await _columns(conn, "blog_categories")
        if "user_id" not in blog_category_columns:
            await conn.execute(text("ALTER TABLE blog_categories ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id)"))
            await conn.commit()

        blog_post_columns = await _columns(conn, "blog_posts")
        if "user_id" not in blog_post_columns:
            await conn.execute(text("ALTER TABLE blog_posts ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id)"))
            await conn.commit()
        if "file_path" not in blog_post_columns:
            await conn.execute(text("ALTER TABLE blog_posts ADD COLUMN file_path TEXT"))
            await conn.commit()

        need_categories_rebuild = (
            await _has_unique_index_on(conn, "blog_categories", ["name"])
            or await _has_unique_index_on(conn, "blog_categories", ["slug"])
            or not await _has_unique_index_on(conn, "blog_categories", ["user_id", "name"])
        )
        need_posts_rebuild = (
            await _has_unique_index_on(conn, "blog_posts", ["slug"])
            or not await _has_unique_index_on(conn, "blog_posts", ["user_id", "slug"])
        )

        if not need_categories_rebuild and not need_posts_rebuild:
            return

        await conn.execute(text("PRAGMA foreign_keys=OFF"))
        if need_categories_rebuild:
            await conn.execute(text("""
                CREATE TABLE blog_categories_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
                    name TEXT NOT NULL,
                    slug TEXT NOT NULL,
                    description TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uq_blog_categories_user_slug UNIQUE (user_id, slug),
                    CONSTRAINT uq_blog_categories_user_name UNIQUE (user_id, name)
                )
            """))
            await conn.execute(text("""
                INSERT INTO blog_categories_new (id, user_id, name, slug, description, created_at, updated_at)
                SELECT id, COALESCE(user_id, 1), name, slug, description, created_at, updated_at
                FROM blog_categories
            """))
            await conn.execute(text("DROP TABLE blog_categories"))
            await conn.execute(text("ALTER TABLE blog_categories_new RENAME TO blog_categories"))

        if need_posts_rebuild:
            await conn.execute(text("""
                CREATE TABLE blog_posts_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    slug TEXT NOT NULL,
                    content TEXT NOT NULL,
                    excerpt TEXT,
                    cover_image TEXT,
                    status TEXT DEFAULT 'draft',
                    category_id INTEGER REFERENCES blog_categories(id),
                    tags TEXT,
                    author TEXT,
                    view_count INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    published_at DATETIME,
                    file_path TEXT,
                    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
                    CONSTRAINT uq_blog_posts_user_slug UNIQUE (user_id, slug)
                )
            """))
            await conn.execute(text("""
                INSERT INTO blog_posts_new (
                    id, title, slug, content, excerpt, cover_image, status, category_id,
                    tags, author, view_count, created_at, updated_at, published_at, file_path, user_id
                )
                SELECT
                    id, title, slug, content, excerpt, cover_image, status, category_id,
                    tags, author, view_count, created_at, updated_at, published_at, file_path, COALESCE(user_id, 1)
                FROM blog_posts
            """))
            await conn.execute(text("DROP TABLE blog_posts"))
            await conn.execute(text("ALTER TABLE blog_posts_new RENAME TO blog_posts"))

        await conn.execute(text("PRAGMA foreign_keys=ON"))
        await conn.commit()


async def _migrate_kb_category_user_scope():
    from sqlalchemy import text

    async with engine.connect() as conn:
        columns = await _columns(conn, "kb_categories")
        if "user_id" not in columns:
            await conn.execute(text("ALTER TABLE kb_categories ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id)"))
            await conn.commit()

        need_rebuild = (
            await _has_unique_index_on(conn, "kb_categories", ["name"])
            or await _has_unique_index_on(conn, "kb_categories", ["slug"])
            or not await _has_unique_index_on(conn, "kb_categories", ["user_id", "name"])
        )
        if not need_rebuild:
            return

        await conn.execute(text("PRAGMA foreign_keys=OFF"))
        await conn.execute(text("""
            CREATE TABLE kb_categories_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
                name TEXT NOT NULL,
                slug TEXT NOT NULL,
                description TEXT,
                parent_id INTEGER REFERENCES kb_categories(id) ON DELETE SET NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_kb_categories_user_slug UNIQUE (user_id, slug),
                CONSTRAINT uq_kb_categories_user_name UNIQUE (user_id, name)
            )
        """))
        await conn.execute(text("""
            INSERT INTO kb_categories_new (id, user_id, name, slug, description, parent_id, created_at)
            SELECT id, COALESCE(user_id, 1), name, slug, description, parent_id, created_at
            FROM kb_categories
        """))
        await conn.execute(text("DROP TABLE kb_categories"))
        await conn.execute(text("ALTER TABLE kb_categories_new RENAME TO kb_categories"))
        await conn.execute(text("PRAGMA foreign_keys=ON"))
        await conn.commit()


async def _migrate_mcp_user_scope():
    from sqlalchemy import text

    async with engine.connect() as conn:
        columns = await _columns(conn, "mcp_servers")
        if "user_id" not in columns:
            await conn.execute(text("ALTER TABLE mcp_servers ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id)"))
            await conn.commit()

        need_rebuild = (
            await _has_unique_index_on(conn, "mcp_servers", ["name"])
            or not await _has_unique_index_on(conn, "mcp_servers", ["user_id", "name"])
        )
        if not need_rebuild:
            return

        await conn.execute(text("PRAGMA foreign_keys=OFF"))
        await conn.execute(text("""
            CREATE TABLE mcp_servers_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id),
                name TEXT NOT NULL,
                server_type TEXT NOT NULL,
                tools JSON,
                command TEXT,
                args TEXT,
                env_vars TEXT,
                url TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_mcp_servers_user_name UNIQUE (user_id, name)
            )
        """))
        await conn.execute(text("""
            INSERT INTO mcp_servers_new (
                id, user_id, name, server_type, tools, command, args, env_vars,
                url, is_active, created_at, updated_at
            )
            SELECT
                id, COALESCE(user_id, 1), name, server_type, tools, command, args, env_vars,
                url, is_active, created_at, updated_at
            FROM mcp_servers
        """))
        await conn.execute(text("DROP TABLE mcp_servers"))
        await conn.execute(text("ALTER TABLE mcp_servers_new RENAME TO mcp_servers"))
        await conn.execute(text("PRAGMA foreign_keys=ON"))
        await conn.commit()


async def _migrate_research_graph():
    from sqlalchemy import text

    async with engine.connect() as conn:
        if not await _table_exists(conn, "research_topics"):
            await conn.execute(text("""
                CREATE TABLE research_topics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    title TEXT NOT NULL,
                    description TEXT,
                    status TEXT NOT NULL DEFAULT 'draft',
                    summary TEXT,
                    last_checked_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
        if not await _table_exists(conn, "research_sources"):
            await conn.execute(text("""
                CREATE TABLE research_sources (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    topic_id INTEGER NOT NULL REFERENCES research_topics(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    title TEXT NOT NULL,
                    url TEXT,
                    canonical_url TEXT,
                    publisher TEXT,
                    source_type TEXT NOT NULL DEFAULT 'manual',
                    published_at DATETIME,
                    fetched_at DATETIME,
                    trust_level TEXT NOT NULL DEFAULT 'unknown',
                    status TEXT NOT NULL DEFAULT 'pending',
                    raw_excerpt TEXT,
                    metadata_json JSON,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uq_research_sources_topic_canonical_url UNIQUE (topic_id, canonical_url)
                )
            """))
        if not await _table_exists(conn, "research_evidence"):
            await conn.execute(text("""
                CREATE TABLE research_evidence (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    topic_id INTEGER NOT NULL REFERENCES research_topics(id) ON DELETE CASCADE,
                    source_id INTEGER REFERENCES research_sources(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    quote TEXT NOT NULL,
                    location TEXT,
                    kind TEXT NOT NULL DEFAULT 'manual',
                    metadata_json JSON,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
        if not await _table_exists(conn, "research_claims"):
            await conn.execute(text("""
                CREATE TABLE research_claims (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    topic_id INTEGER NOT NULL REFERENCES research_topics(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    claim_text TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    confidence INTEGER NOT NULL DEFAULT 0,
                    claim_type TEXT,
                    adopted BOOLEAN NOT NULL DEFAULT 0,
                    reasoning TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
        if not await _table_exists(conn, "research_entities"):
            await conn.execute(text("""
                CREATE TABLE research_entities (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    topic_id INTEGER NOT NULL REFERENCES research_topics(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    name TEXT NOT NULL,
                    entity_type TEXT,
                    aliases_json JSON,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
        if not await _table_exists(conn, "research_relations"):
            await conn.execute(text("""
                CREATE TABLE research_relations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    topic_id INTEGER NOT NULL REFERENCES research_topics(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    from_type TEXT NOT NULL,
                    from_id INTEGER NOT NULL,
                    to_type TEXT NOT NULL,
                    to_id INTEGER NOT NULL,
                    relation_type TEXT NOT NULL,
                    metadata_json JSON,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
        if not await _table_exists(conn, "research_proposals"):
            await conn.execute(text("""
                CREATE TABLE research_proposals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    topic_id INTEGER NOT NULL REFERENCES research_topics(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    proposal_type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT,
                    payload_json JSON,
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    reviewed_at DATETIME,
                    applied_at DATETIME
                )
            """))
        if not await _table_exists(conn, "research_runs"):
            await conn.execute(text("""
                CREATE TABLE research_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    topic_id INTEGER NOT NULL REFERENCES research_topics(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    idempotency_key TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'queued',
                    progress_json JSON,
                    error_message TEXT,
                    started_at DATETIME,
                    finished_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uq_research_runs_topic_idempotency_key UNIQUE (topic_id, idempotency_key)
                )
            """))
        if not await _table_exists(conn, "blog_post_research_links"):
            await conn.execute(text("""
                CREATE TABLE blog_post_research_links (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    post_id INTEGER NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
                    topic_id INTEGER NOT NULL REFERENCES research_topics(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    snapshot_json JSON NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uq_blog_post_research_links_post_topic UNIQUE (post_id, topic_id)
                )
            """))
        if not await _table_exists(conn, "blog_post_claim_links"):
            await conn.execute(text("""
                CREATE TABLE blog_post_claim_links (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    post_id INTEGER NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
                    claim_id INTEGER NOT NULL REFERENCES research_claims(id) ON DELETE CASCADE,
                    topic_id INTEGER NOT NULL REFERENCES research_topics(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    usage_note TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uq_blog_post_claim_links_post_claim UNIQUE (post_id, claim_id)
                )
            """))

        indexes = [
            "CREATE INDEX IF NOT EXISTS ix_research_topics_user_id ON research_topics(user_id)",
            "CREATE INDEX IF NOT EXISTS ix_research_topics_user_status ON research_topics(user_id, status)",
            "CREATE INDEX IF NOT EXISTS ix_research_sources_user_id ON research_sources(user_id)",
            "CREATE INDEX IF NOT EXISTS ix_research_sources_topic_user ON research_sources(topic_id, user_id)",
            "CREATE INDEX IF NOT EXISTS ix_research_evidence_user_id ON research_evidence(user_id)",
            "CREATE INDEX IF NOT EXISTS ix_research_evidence_topic_user ON research_evidence(topic_id, user_id)",
            "CREATE INDEX IF NOT EXISTS ix_research_claims_user_id ON research_claims(user_id)",
            "CREATE INDEX IF NOT EXISTS ix_research_claims_topic_user ON research_claims(topic_id, user_id)",
            "CREATE INDEX IF NOT EXISTS ix_research_claims_user_status ON research_claims(user_id, status)",
            "CREATE INDEX IF NOT EXISTS ix_research_entities_user_id ON research_entities(user_id)",
            "CREATE INDEX IF NOT EXISTS ix_research_entities_topic_user ON research_entities(topic_id, user_id)",
            "CREATE INDEX IF NOT EXISTS ix_research_relations_user_id ON research_relations(user_id)",
            "CREATE INDEX IF NOT EXISTS ix_research_relations_topic_user ON research_relations(topic_id, user_id)",
            "CREATE INDEX IF NOT EXISTS ix_research_relations_from ON research_relations(from_type, from_id)",
            "CREATE INDEX IF NOT EXISTS ix_research_relations_to ON research_relations(to_type, to_id)",
            "CREATE INDEX IF NOT EXISTS ix_research_proposals_user_id ON research_proposals(user_id)",
            "CREATE INDEX IF NOT EXISTS ix_research_proposals_topic_user ON research_proposals(topic_id, user_id)",
            "CREATE INDEX IF NOT EXISTS ix_research_runs_user_id ON research_runs(user_id)",
            "CREATE INDEX IF NOT EXISTS ix_research_runs_topic_user ON research_runs(topic_id, user_id)",
            "CREATE INDEX IF NOT EXISTS ix_blog_post_research_links_user_id ON blog_post_research_links(user_id)",
            "CREATE INDEX IF NOT EXISTS ix_blog_post_research_links_post_user ON blog_post_research_links(post_id, user_id)",
            "CREATE INDEX IF NOT EXISTS ix_blog_post_claim_links_user_id ON blog_post_claim_links(user_id)",
            "CREATE INDEX IF NOT EXISTS ix_blog_post_claim_links_post_user ON blog_post_claim_links(post_id, user_id)",
        ]
        for statement in indexes:
            await conn.execute(text(statement))
        await conn.commit()


async def _migrate_research_entity_enhancements():
    from sqlalchemy import text

    async with engine.connect() as conn:
        if not await _table_exists(conn, "research_entities"):
            return

        columns = await _columns(conn, "research_entities")
        if "description" not in columns:
            await conn.execute(text("ALTER TABLE research_entities ADD COLUMN description TEXT"))
        if "confidence" not in columns:
            await conn.execute(text("ALTER TABLE research_entities ADD COLUMN confidence INTEGER NOT NULL DEFAULT 0"))
        if "status" not in columns:
            await conn.execute(text("ALTER TABLE research_entities ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"))
        if "updated_at" not in columns:
            await conn.execute(text("ALTER TABLE research_entities ADD COLUMN updated_at DATETIME"))

        if not await _table_exists(conn, "research_claim_entity_links"):
            await conn.execute(text("""
                CREATE TABLE research_claim_entity_links (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    claim_id INTEGER NOT NULL REFERENCES research_claims(id) ON DELETE CASCADE,
                    entity_id INTEGER NOT NULL REFERENCES research_entities(id) ON DELETE CASCADE,
                    topic_id INTEGER NOT NULL REFERENCES research_topics(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    role TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT uq_claim_entity_link UNIQUE (claim_id, entity_id)
                )
            """))

        indexes = [
            "CREATE INDEX IF NOT EXISTS ix_research_entities_topic_name ON research_entities(topic_id, name)",
            "CREATE INDEX IF NOT EXISTS ix_claim_entity_links_user_id ON research_claim_entity_links(user_id)",
            "CREATE INDEX IF NOT EXISTS ix_claim_entity_links_topic_user ON research_claim_entity_links(topic_id, user_id)",
            "CREATE INDEX IF NOT EXISTS ix_claim_entity_links_claim ON research_claim_entity_links(claim_id)",
            "CREATE INDEX IF NOT EXISTS ix_claim_entity_links_entity ON research_claim_entity_links(entity_id)",
        ]
        for statement in indexes:
            await conn.execute(text(statement))
        await conn.commit()


async def _migrate_blog_file_storage():
    """将 content/blog/ 下扁平 .md 文件迁移到 content/blog/1/ 目录。"""
    from pathlib import Path
    from shutil import move as shutil_move
    from sqlalchemy import text

    content_dir = Path(__file__).parent.parent.parent / "content" / "blog"
    if not content_dir.exists():
        return

    flat_files = list(content_dir.glob("*.md"))
    if not flat_files:
        return

    target_dir = content_dir / "1"
    target_dir.mkdir(parents=True, exist_ok=True)

    for filepath in flat_files:
        dest = target_dir / filepath.name
        if not dest.exists():
            shutil_move(str(filepath), str(dest))

    import logging
    logger = logging.getLogger(__name__)
    async with engine.connect() as conn:
        for filepath in flat_files:
            slug = filepath.stem
            new_path = str((target_dir / filepath.name).resolve().relative_to(Path.cwd().resolve()))
            await conn.execute(
                text("UPDATE blog_posts SET file_path = :path WHERE slug = :slug AND user_id = 1"),
                {"path": new_path, "slug": slug},
            )
        await conn.commit()
    logger.info("文件存储迁移: %d 个文件 → content/blog/1/", len(flat_files))
