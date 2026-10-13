# ai-blog

> Turn ideas into a body of work — an AI writing platform for individual creators. Built around a Markdown workspace as the single source of truth, it combines blogging, AI chat, a RAG knowledge base, and a cognitive-memory knowledge graph. Self-hostable out of the box.

<p align="center">
  <a href="README.md">中文</a> · <strong>English</strong>
</p>

<p align="center">
  <a href="https://github.com/zrishen/ai-blog/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/zrishen/ai-blog/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/zrishen/ai-blog/tags"><img alt="Release" src="https://img.shields.io/github/v/tag/zrishen/ai-blog?label=release"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>
</p>

<p align="center">
  <img src="docs/landing.png" alt="ai-blog landing page" width="960">
</p>

## Features

### Writing Workspace

- Vditor editor with WYSIWYG, split view, and instant rendering; post bodies are stored as `.md` files in the user workspace as the single source of truth
- Post CRUD, drafts and publishing, categories, tags, covers, and excerpts; one-click AI cover generation
- Publishing uses immutable revision snapshots; public profile `/u/:username` and post pages are open to visitors
- Workspace file tree, trash, and Git versioning

### AI Chat

- SSE streaming, multi-conversation management, automatic context compaction for long conversations
- Chat attachments support images and documents, quota-limited
- AI sidebar that switches with page context: blog, knowledge base, post detail
- Agent toolkit: blog read/write, knowledge-base semantic search, memory recall, workspace file reading, restricted web fetching, and MCP; both are off by default, see `MCP_ENABLED`
- Public chat: anonymous visitors can chat on the landing page and public blog, rate-limited by input characters, output tokens, and per-IP daily limits

### Knowledge Base · RAG

- Upload PDF / DOCX / XLSX / Markdown; background jobs parse, chunk, and index automatically
- Embeddings via an OpenAI-compatible API or a local sentence-transformers model
- Per-user isolated retrieval augmentation during chat

### Cognitive Memory

- Long-term memory on a FalkorDB graph, extracting entities, facts, episodes, and preferences from conversations
- Scheduled consolidation and decay; recall expands along the graph to related memories
- `/brain` page visualizes the knowledge graph with entity details and memory stats

### Accounts & Subscription

- Invite-code registration and login, JWT sessions, bcrypt password hashing
- Per-user LLM settings BYOK: protocol, base URL, API key, and model; keys encrypted at rest and routed per user
- Subscription system: activation codes, platform key with a weekly token quota; automatic fallback to BYOK when over quota or expired
- Admin console `/admin`: user management, activation codes, usage stats
- All data is strictly user-scoped

### UI

- Light and dark themes
- Three-pane draggable layout: sidebar, main content, and AI sidebar; layout persists
- Responsive design for mobile

## Getting Started

### Docker Deployment

The recommended way: a same-origin compose stack bringing up Nginx, FastAPI, PostgreSQL, and FalkorDB in one go:

```bash
# 1. Prepare backend env vars; generation commands for the three secrets are in the file
cp backend/.env.example backend/.env
# Edit backend/.env: fill in OPENAI_API_KEY, JWT_SECRET, etc.

# 2. Build and start
docker compose build
docker compose up -d

# 3. Health check
curl http://127.0.0.1/health
```

See [`deploy/docker/README.md`](deploy/docker/README.md) for the full first-run, update, backup, and HTTPS guide.

### Local Development

Prerequisites: Python 3.11+, Node.js 20+, and Docker; PostgreSQL and FalkorDB run in containers, and [uv](https://github.com/astral-sh/uv) is recommended for Python dependencies.

```bash
# Backend env vars
cp backend/.env.example backend/.env
# Edit backend/.env: keep the local defaults for DATABASE_URL / FALKORDB_URL
```

On Windows, double-click `start_backend.bat` and `start_frontend.bat`; they bring up the database containers and start both services. Or run manually:

```bash
# Start dev databases: postgres and falkordb only
docker compose -f compose.yaml -f compose.dev.yaml up -d --wait postgres falkordb

# Start the backend
cd backend
uv run uvicorn src.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir src

# Start the frontend in a separate terminal
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`; Vite proxies `/api` to the backend on port 8000.

## Tech Stack

| Layer | Choice |
| --- | --- |
| Frontend | React 19 · TypeScript · Vite · Tailwind CSS 4 · Vditor |
| Backend | Python 3.11+ · FastAPI · SQLAlchemy 2.0 · Alembic |
| Storage | PostgreSQL · FalkorDB graph database |
| AI | LangGraph · LangChain · OpenAI-compatible APIs · sentence-transformers |
| Tooling | Docker Compose · Nginx · GitHub Actions CI |

## Project Structure

```text
ai-blog
├─ backend/         FastAPI service: thin api layer + domain services
├─ frontend/        React SPA: self-contained features by domain
├─ deploy/docker/   Dockerfiles, Nginx config, and deployment docs
├─ docs/            Screenshots
├─ compose.yaml     Production stack
└─ compose.dev.yaml Local development stack
```

## Configuration

See [`backend/.env.example`](backend/.env.example) for all options with inline comments.

## Testing

```bash
# Backend: testcontainers spin up real containers; the full suite is slow,
# prefer running only the domain you touched
cd backend
uv run pytest

# Frontend
cd frontend
npm run test
```

CI additionally runs frontend lint and build, plus backend ruff and basedpyright checks.

## License

[MIT](LICENSE)
