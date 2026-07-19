# ai-blog

把想法写成体系 —— 一套面向个人创作者的 AI 写作 + 知识管理 + 研究图谱一体化平台。围绕博客创作、知识库 RAG、研究写作三条主线，配以可拖拽三栏布局、AI 侧栏、用户公开主页与未登录访问能力。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite + React Router |
| UI | shadcn/ui + Tailwind CSS v4 + Radix UI + motion + Lucide |
| 编辑器 | Vditor（Markdown 所见即所得/分屏/即时渲染）+ react-markdown + remark-gfm + rehype-highlight |
| 状态/布局 | 自定义 store（chatStore / authStore）+ react-resizable-panels |
| 图谱 | @xyflow/react + dagre（研究知识图谱可视化） |
| 后端 | FastAPI + SQLAlchemy 2.x（async）+ Pydantic v2 + uvicorn |
| AI 编排 | LangChain + LangGraph（含 langchain-openai / langchain-anthropic / langchain-deepseek / langchain-mcp-adapters） |
| 数据库 | SQLite（aiosqlite） |
| 向量库 | ChromaDB（持久化到本地磁盘） |
| MCP | mcp + langchain-mcp-adapters（stdio / streamable-http） |
| 认证 | JWT + bcrypt |
| 包管理 | 前端 pnpm，后端 uv |
| 测试 | 后端 pytest + pytest-asyncio，前端 vitest |

## 功能

### 博客创作
- Vditor Markdown 编辑器，支持所见即所得、分屏、即时渲染三种模式
- 文章 CRUD、草稿/发布、分类、标签、封面、摘要
- AI 一键生成封面
- 用户公开主页 `/u/:username` 与文章详情页 `/u/:username/posts/:slug`
- Markdown 文件作为事实源：用户每次创建/更新文章即写入 `data/content/blog/<username>/`，DB 作为查询索引
- 浏览量统计、置顶、归档

### AI 对话
- SSE 流式对话，多会话管理（创建/重命名/删除）
- 图片对话：上传图片附加到消息
- 文件对话：从知识库附加文件作为上下文
- 上下文压缩：长对话按阈值自动压缩历史
- 三栏布局里的右侧 AI 侧栏，根据当前页面自动切换上下文（博客、知识库、研究、文章详情）
- **公开对话**：未登录用户也可在 Landing 页和公开博客页面对话，受字符数/轮数、模型 token 与每 IP 每日 10 次限制

### 知识库（RAG）
- 上传 PDF / DOCX / XLSX / Markdown，自动解析分块入库
- 自动向量化（默认 ONNX 本地 embedding，可切换 OpenAI 兼容 API）
- 多层级分类管理（树形）
- 对话时按用户隔离 RAG 检索增强
- 文件预览（convert_to_html）

### 研究写作
完整的"研究 → 写作"工作流，围绕**研究图谱**展开：
- **Topics**（研究主题）：作为研究容器
- **Sources**（资料来源）：URL、出版方、可信度、抓取时间
- **Evidence**（证据）：从资料中摘录的原文片段
- **Claims**（论断）：从证据中提炼的论点（含信心、状态、采用与否）
- **Entities**（实体）与 **Relations**（关系）：构成知识图谱节点和边
- **Proposals**（研究建议）：AI 提出的下一步研究方向
- **Runs**（运行记录）：多阶段 Agent 流程的执行与状态
- 知识图谱可视化（基于 React Flow + dagre），节点点击查看详情
- 草稿预览：根据研究素材生成博客草稿
- 博客与研究双向联动：文章可引用 Claim / Topic 快照

### Agent 工具
后端通过 LangGraph 编排，提供以下工具能力：
- 博客 CRUD、知识库语义搜索、文件读取
- 代码执行（沙箱受限）
- MCP 工具调用（按用户配置的 MCP 服务）

### MCP 服务
- 支持 stdio 与 streamable-http 两种类型
- 用户在前端弹窗中增删改查自己的 MCP 服务
- 启用后自动注入到 Agent 工具集

### 用户与权限
- 邀请码注册 / 登录（JWT），密码 bcrypt 哈希；未配置邀请码时关闭注册
- **用户级 LLM 配置**：每个用户可在「设置」中配置自己的协议（OpenAI / Anthropic）、Base URL、API Key、Model，API Key 加密保存，后端调用时按用户身份路由
- 数据按用户隔离：博客、知识库、对话、研究、MCP、LLM 配置全部 user-scoped
- 发布的文章和公开 AI 对未登录用户开放；文件库、研究图谱与 MCP 服务均需登录

### 主题与布局
- 浅色 / 深色主题切换
- 三栏可拖拽布局（左侧栏 + 主内容 + AI 侧栏），布局持久化到 localStorage
- 响应式

## 快速开始

### Docker 部署（推荐用于云服务器）

项目提供前端 Nginx + 后端 FastAPI 的同源容器编排，运行数据继续持久化在 `backend/data`。完整的首次启动、更新、备份与 HTTPS 接入说明见 [`deploy/docker/README.md`](deploy/docker/README.md)。

```bash
docker compose build
docker compose up -d
```

未安装 Docker 时仍可按下方步骤直接运行前后端。

### 前置要求
- Python 3.11+（推荐用 [uv](https://github.com/astral-sh/uv) 管理）
- Node.js 20.19+（容器构建固定使用 Node.js 22；本地依赖以 `package-lock.json` 为准）

### 1. 配置后端环境变量

在 `backend/` 下创建 `.env`：

```env
OPENAI_API_KEY=your-api-key
BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-4o-mini
JWT_SECRET=用命令生成的高熵随机值
REGISTRATION_INVITE_CODE=自行分发的邀请码
LLM_SETTINGS_ENCRYPTION_KEY=用 Fernet.generate_key() 生成的密钥
```

> 用户也可以登录后在前端「设置」弹窗中配置自己的 LLM Key，会覆盖后端默认值。

### 2. 启动后端

```bash
cd backend
uv run uvicorn src.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir src
```

或双击 `start_backend.bat`。后端运行在 http://127.0.0.1:8000，健康检查 `GET /api/health`。

启动时会自动：
- 执行 DB 迁移（含历史数据目录从 `user_id` 改为 `username` 命名的一次性迁移）
- 写入项目介绍文章（`ai-blog` 系统账户）

### 3. 启动前端

```bash
cd frontend
pnpm install
pnpm dev
```

或双击 `start_frontend.bat`。Vite 代理把 `/api` 转发到后端 8000，浏览器访问 http://localhost:5173。

## 项目结构

```
ai-blog/
├── backend/
│   ├── data/                       # 所有运行时数据统一在此（路径基于 backend/，不依赖 cwd）
│   │   ├── ai-blog.db              # SQLite 关系库（会话、文章、知识库、研究图谱…）
│   │   ├── chroma_db/              # ChromaDB 向量索引
│   │   ├── content/
│   │   │   ├── blog/<username>/    # 博客 Markdown 文件（按用户名分目录）
│   │   │   └── uploads/<username>/ # 用户上传的文件（按用户名分目录）
│   │   ├── templates/              # 系统模板（如项目介绍 md）
│   │   └── logs/
│   ├── src/
│   │   ├── main.py                 # FastAPI 入口 + startup 钩子
│   │   ├── config.py               # Pydantic Settings，所有路径基于 BASE_DIR 绝对路径
│   │   ├── api/                    # 路由层（按功能拆分）
│   │   │   ├── routes.py           # 统一注册入口
│   │   │   ├── status.py           # 健康检查
│   │   │   ├── auth.py             # 注册/登录
│   │   │   ├── settings.py         # 用户级 LLM 配置
│   │   │   ├── blog.py             # 博客 CRUD + 封面生成
│   │   │   ├── research.py         # 研究图谱 + 运行 + 草稿预览
│   │   │   ├── conversations.py    # 会话管理
│   │   │   ├── chat.py             # 私有 SSE 流式对话
│   │   │   ├── public_chat.py      # 公开对话（未登录）
│   │   │   ├── kb.py               # 知识库 + 分类
│   │   │   ├── files.py            # 上传 + 公开访问 /public/uploads/{username}/...
│   │   │   ├── preview.py          # 文件预览
│   │   │   └── mcp.py              # MCP 服务管理
│   │   ├── services/               # 业务逻辑层
│   │   │   ├── blog_service.py             # 博客读写主流程
│   │   │   ├── markdown_blog_service.py    # Markdown 文件 I/O + frontmatter
│   │   │   ├── blog_cover_service.py       # AI 封面生成
│   │   │   ├── blog_tag_service.py
│   │   │   ├── chat_service.py             # 私有对话编排
│   │   │   ├── public_chat_service.py      # 公开对话（限额）
│   │   │   ├── conversation_service.py
│   │   │   ├── research_service.py         # 研究图谱 + Agent 流程
│   │   │   ├── file_service.py             # 上传/读取/向量化
│   │   │   ├── embedding_service.py        # ONNX 或 API embedding
│   │   │   ├── vector_store.py             # ChromaDB 封装
│   │   │   ├── llm_settings_service.py     # 用户级 LLM 配置
│   │   │   ├── user_service.py
│   │   │   ├── official_intro_service.py   # 项目介绍模板
│   │   │   └── mcp/                        # MCP 客户端管理
│   │   ├── tools/                  # LangGraph Agent 可用工具
│   │   │   ├── agent_tools.py
│   │   │   ├── research_tools.py
│   │   │   └── mcp_tools.py
│   │   ├── database/               # ORM 模型、连接、迁移
│   │   │   ├── models.py           # 所有 SQLAlchemy 模型（含研究图谱完整结构）
│   │   │   ├── engine.py / session.py
│   │   │   └── migrations.py       # 自动迁移（含 user_id→username 目录迁移）
│   │   ├── schemas/                # Pydantic Schema
│   │   └── utils/                  # 工具函数（slug、user_dir 翻译等）
│   └── tests/
│       └── mock/                   # Mock 测试（日常开发与 CI，约 140+ 用例）
├── frontend/
│   ├── src/
│   │   ├── App.tsx                 # 根组件：三栏布局 + 路由 + ErrorBoundary
│   │   ├── api/                    # API 客户端（auth/blog/chat/conversations/files/knowledge/mcp/research）
│   │   ├── stores/                 # chatStore、authStore
│   │   ├── components/             # NavBar / LeftSidebar / AISidebar 触发器 / MCPModal / shadcn ui
│   │   ├── features/
│   │   │   ├── landing/            # LandingPage（项目主页 + 公开对话）
│   │   │   ├── blog/               # 博客列表 / 详情 / 编辑器（Vditor）
│   │   │   ├── knowledge-base/     # 知识库管理 + 上传
│   │   │   ├── research/           # 研究图谱（React Flow + 节点 + 详情面板 + 流程面板）
│   │   │   ├── ai-chat/            # 右侧 AI 侧栏（多上下文）
│   │   │   └── auth/               # 登录弹窗
│   │   └── hooks/
│   ├── public/                     # 静态资源（项目图标 writing.svg）
│   └── index.html
├── start_backend.bat
├── start_frontend.bat
├── LOG.md                          # 变更日志（按日期追加）
└── README.md
```

## 前端路由

| 路径 | 说明 | 是否需登录 |
|---|---|---|
| `/` | Landing 项目主页（介绍 + 公开 AI 对话） | 否 |
| `/u/:username` | 用户公开博客主页 | 否（仅展示已发布文章） |
| `/u/:username/posts/:slug` | 文章详情页 | 否 |
| `/knowledge` | 知识库管理 | 是 |
| `/research` `/research/:topicId` | 研究图谱 | 是 |

## 核心 API

| 分类 | 方法 | 路径 | 说明 |
|---|---|---|---|
| 系统 | GET | `/api/health` | 健康检查 |
| 认证 | POST | `/api/auth/register` `/api/auth/login` | 注册 / 登录 |
| 用户设置 | GET/PUT | `/api/settings/llm` | 读取/更新当前用户的 LLM 配置 |
| 博客 | CRUD | `/api/blog/posts` | 文章列表/详情/创建/更新/删除 |
| 博客 | PUT | `/api/blog/posts/{id}/publish` | 发布/取消发布 |
| 博客 | POST | `/api/blog/posts/{id}/generate-cover` | AI 生成封面 |
| 博客 | CRUD | `/api/blog/categories` | 分类管理 |
| 研究 | CRUD | `/api/research/topics` | 研究主题 |
| 研究 | CRUD | `/api/research/topics/{id}/sources` `/evidence` `/claims` `/entities` `/relations` `/proposals` | 图谱各维度 |
| 研究 | GET | `/api/research/topics/{id}/runs` | 运行记录 |
| 研究 | POST | `/api/research/topics/{id}/draft-preview` | 生成博客草稿预览 |
| 研究 | GET | `/api/research/graph` | 完整图谱数据 |
| 对话 | POST | `/api/chat/stream` | 私有 SSE 流式对话 |
| 对话 | POST | `/api/public/chat/stream` | 公开 SSE 流式对话（匿名、限额） |
| 对话 | CRUD | `/api/conversations` | 会话管理 |
| 知识库 | CRUD | `/api/kb/documents` `/api/kb/categories` | 文档与分类 |
| 文件 | POST | `/api/files/upload` | 上传文件 |
| 文件 | GET | `/api/public/uploads/{username}/{filename}` | 公开访问上传文件 |
| 文件 | GET | `/api/preview/...` | 文件预览 |
| MCP | CRUD | `/api/mcp/servers` | MCP 服务管理 |

完整接口见 `backend/src/api/` 下各路由文件。

## 测试

```bash
cd backend
uv run pytest tests/mock -v
```

覆盖：博客 CRUD、用户隔离、知识库 RAG、向量库隔离、研究 API、研究运行阶段、设置、认证、文件服务元数据、公开对话等。

前端测试：

```bash
cd frontend
pnpm test
```

## 配置说明

`backend/.env` 中的主要环境变量（`config.py` 为默认值，可被 `.env` 覆盖）：

| 变量 | 说明 | 默认 |
|---|---|---|
| `OPENAI_API_KEY` | 默认 LLM API 密钥 | 必填 |
| `BASE_URL` | 默认 LLM Base URL | 必填 |
| `MODEL_NAME` | 默认对话模型 | `Qwen3.6-35B` |
| `DEEP_THINKING_MODEL_NAME` | 深度思考模型 | 同上 |
| `DATABASE_URL` | SQLite 路径 | 自动指向 `data/ai-blog.db`，一般无需设置 |
| `CHROMA_DB_PATH` | 向量库路径 | 自动 `data/chroma_db` |
| `BLOG_CONTENT_DIR` | 博客文件根目录 | `data/content/blog` |
| `UPLOAD_DIR` | 上传根目录 | `data/content/uploads` |
| `JWT_SECRET` | JWT 签名密钥 | 生产环境务必修改 |
| `REGISTRATION_INVITE_CODE` | 共享注册邀请码；留空则关闭注册 | 空 |
| `LLM_SETTINGS_ENCRYPTION_KEY` | 用户 LLM API Key 的 Fernet 加密主密钥 | 必填 |
| `JWT_EXPIRE_SECONDS` | Token 过期时间 | 7 天 |
| `EMBEDDING_PROVIDER` | embedding 来源 | `onnx`（本地） |
| `EMBEDDING_MODEL` | embedding 模型 | `Qwen3-Embedding-8B` |
| `EMBEDDING_DIM` | 向量维度 | 384 |
| `RAG_TOP_K` | 检索片段数 | 3 |
| `RAG_DISTANCE_THRESHOLD` | 距离阈值 | 0.7 |
| `PUBLIC_CHAT_MAX_INPUT_CHARS` | 公开对话单次输入字符上限 | 2000 |
| `PUBLIC_CHAT_MAX_OUTPUT_TOKENS` | 公开对话单次输出 token 上限 | 800 |
| `PUBLIC_CHAT_DAILY_IP_LIMIT` | 两个匿名公开聊天入口共享的每 IP 中国自然日额度 | 10 |
| `MCP_CALL_TIMEOUT_SECONDS` | MCP 工具调用超时 | 30 |

## 数据目录与命名

- 所有运行时数据统一收纳在 `backend/data/`
- 用户内容目录以 **username** 命名（`data/content/blog/<username>/`、`data/content/uploads/<username>/`），便于人工辨识
- 业务层逻辑（DB、API、所有权判断）仍使用 `user_id`，仅在路径生成处翻译为 username
- 用户改名暂未支持；未来若支持改名，需额外的目录迁移逻辑

## 开发约定

- 代码改动后按日志风格追加到 `LOG.md`：`YYYY-MM-DD HH:mm [类别] xxx`
- git commit 风格：`增加: xxx` `修复: xxx` `优化: xxx` `重构: xxx` `文档: xxx` `测试: xxx` `配置: xxx`
- 临时脚本/测试文件统一放在主目录 `temps/`
