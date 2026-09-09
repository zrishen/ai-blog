# ai-blog

> Turn ideas into a body of work — an AI writing platform for individual creators. Built around a Markdown workspace as the single source of truth, it combines blogging, AI chat, a RAG knowledge base, and a cognitive-memory knowledge graph. Self-hostable out of the box.

[中文](README.md) · [![CI](https://github.com/zhongrishen/ai-blog/actions/workflows/ci.yml/badge.svg)](https://github.com/zhongrishen/ai-blog/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<p align="center">
  <img src="docs/landing.png" alt="ai-blog landing page">
</p>

## Features

### Writing Workspace
- Markdown editing (Vditor: WYSIWYG / split view / instant rendering); post bodies live as `.md` files in the user workspace
- Post CRUD, drafts / publishing, categories, tags, covers, excerpts; one-click AI cover generation
- Publishing uses immutable revision snapshots; public profile `/u/:username` and post pages are open to anonymous visitors
- Workspace file tree, trash, and Git versioning

### AI Chat
- SSE streaming chat with multi-conversation management; long conversations are auto-compacted
- Chat attachments: images + documents (quota-limited)
- Right-hand AI sidebar that switches context with the current page (blog, knowledge base, post detail)
- Agent tools: blog read/write, knowledge-base semantic search, cognitive-memory recall, workspace file reading, restricted web fetching (off by default), and MCP (disabled by default, see `MCP_ENABLED`)
- Public chat: anonymous visitors can chat on the landing page and public blog, limited by input chars, output tokens, and per-IP daily requests

### Knowledge Base (RAG)
- Upload PDF / DOCX / XLSX / Markdown; background jobs parse, chunk, and index automatically
- Embeddings via an OpenAI-compatible API or a local sentence-transformers model
- Per-user isolated retrieval augmentation during chat

### Cognitive Memory (Brain)
- Long-term memory on a FalkorDB graph: entities, facts, episodes, and preferences extracted from conversations
- Scheduled consolidation and decay; recall expands the graph to related memories
- `/brain` page visualizes the knowledge graph with entity details and memory stats

### Accounts & Subscription
- Invite-code registration / login (JWT), bcrypt password hashing
- Per-user LLM settings (BYOK): protocol, base URL, API key, model — keys encrypted at rest, routed per user
- Subscription system: activation codes, platform key + weekly token quota; falls back to BYOK when over quota or expired
- Admin console `/admin`: user management, activation codes, usage stats
- All user data strictly user-scoped and isolated

### UI
- Light / dark themes
- Three-pane draggable layout (sidebar + main content + AI sidebar), persisted
- Responsive design

## Getting Started

### Docker Deployment (Recommended)

Ships a same-origin Nginx + FastAPI compose stack with PostgreSQL and FalkorDB:

```bash
# 1. Prepare backend env vars (key-generation commands are commented in the file)
cp backend/.env.example backend/.env
# Edit backend/.env: fill in OPENAI_API_KEY, JWT_SECRET, etc.

# 2. Build and start
docker compose build
docker compose up -d

# 3. Health check
curl http://127.0.0.1/health
```

See [`deploy/docker/README.md`](deploy/docker/README.md) for full first-run, update, backup, and HTTPS instructions.

### Local Development

Prerequisites: Python 3.11+ ([uv](https://github.com/astral-sh-uv) recommended), Node.js 20+, Docker (for PostgreSQL and FalkorDB).

```bash
# Backend env vars
cp backend/.env.example backend/.env
# Edit backend/.env: keep the local defaults for DATABASE_URL / FALKORDB_URL
```

On Windows, just double-click `start_backend.bat` and `start_frontend.bat` (they start the database containers and services for you). Or run manually:

```bash
# Start dev databases (postgres + falkordb only)
docker compose -f compose.yaml -f compose.dev.yaml up -d --wait postgres falkordb

# Start the backend
cd backend
uv run uvicorn src.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir src

# Start the frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 — Vite proxies `/api` to the backend on port 8000.

## Configuration

See [`backend/.env.example`](backend/.env.example) for all configuration options with inline comments.

## Testing

```bash
# Backend (testcontainers spin up real containers; the full suite is slow,
# prefer running only the tests for the domain you touched)
cd backend
uv run pytest

# Frontend
cd frontend
npm run test
```

## License

[MIT](LICENSE)

