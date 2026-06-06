# ai-blog

基于 React + FastAPI 的 AI 博客写作与知识管理平台。支持博客创作发布、AI 对话助手、知识库检索增强生成（RAG）、MCP 工具集成、文件上传解析等功能。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite |
| UI | shadcn/ui + Tailwind CSS v4 + Framer Motion + Lucide |
| 后端 | FastAPI + SQLAlchemy + LangChain + LangGraph |
| 数据库 | SQLite (aiosqlite) |
| 向量库 | ChromaDB |
| AI | Anthropic SDK + OpenAI SDK |
| 包管理 | 前端 pnpm，后端 uv |

## 功能特性

### 博客系统

- **文章创作**：Vditor 所见即所得 Markdown 编辑器，支持分屏/即时渲染/所见即所得三种模式
- **文章管理**：创建、编辑、删除、发布/取消发布，草稿自动保存到本地
- **分类管理**：文章分类的增删改查
- **封面生成**：AI 自动生成文章封面图
- **卡片首页**：瀑布流布局，大图卡片 + 横排卡片 + 双列卡片交替展示
- **Markdown 驱动**：文章以 Markdown 文件存储，数据库作为索引缓存，Agent 和前端共用同一数据源

### AI 对话助手

- **流式对话**：SSE 流式输出，Markdown 渲染，打字光标动画
- **多会话管理**：创建、切换、删除对话，历史记录持久化
- **图片对话**：上传图片与 AI 直接对话
- **侧栏助手**：右侧可拖拽 AI 侧栏，随时唤起对话

### 知识库（RAG）

- **文件上传**：支持 PDF、DOCX、XLSX 文件上传与内容解析
- **自动向量化**：上传后自动分块（递归字符分割）并写入向量库
- **检索增强**：对话时自动检索知识库相关片段，增强回答质量
- **分类管理**：多层嵌套分类树，拖拽移动分类，右键菜单操作
- **文档管理**：按分类浏览文档，预览文件内容

### Agent 工具

- **博客 CRUD**：Agent 可直接创建、更新、删除、查询博客文章
- **知识库搜索**：Agent 可检索知识库内容辅助回答
- **代码执行**：Claude Agent SDK 提供代码执行与文件操作能力

### MCP 服务

- **工具集成**：支持配置 MCP 服务器（stdio / streamable-http），扩展 Agent 工具能力
- **内置工具**：时间查询等常用 MCP 工具一键导入
- **可视化管理**：前端界面增删改查 MCP 服务配置

### 用户系统

- **注册/登录**：JWT 认证，BCrypt 密码哈希
- **权限控制**：博客写操作需登录，只读内容公开访问
- **用户隔离**：对话、知识库数据按用户隔离

### 主题与布局

- **浅色/深色主题**：一键切换，主题偏好持久化
- **三栏可拖拽布局**：左侧栏 + 主内容区 + AI 侧栏，宽度自由调整
- **响应式设计**：适配不同屏幕尺寸

## 快速开始

### 前置要求

- Python 3.11+（使用 [uv](https://github.com/astral-sh/uv) 管理依赖）
- Node.js 18+（使用 [pnpm](https://pnpm.io/) 管理依赖）

### 1. 配置环境变量

在 `backend/` 目录下创建 `.env` 文件：

```env
OPENAI_API_KEY=your-api-key
BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-4o-mini
```

### 2. 启动后端

```bash
cd backend
uv sync
uv run uvicorn src.main:app --host 0.0.0.0 --port 8102 --reload
```

或双击 `start_backend.bat`

### 3. 启动前端

```bash
cd frontend
pnpm install
pnpm dev
```

或双击 `start_frontend.bat`

前端通过 Vite proxy 将 `/api` 请求转发到后端 `http://localhost:8102`。打开浏览器访问 `http://localhost:5173` 即可使用。

## API 接口

### 博客

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/blog/posts` | 文章列表（支持状态/分类/搜索筛选和分页） | 否 |
| GET | `/api/blog/posts/{id}` | 文章详情 | 否 |
| POST | `/api/blog/posts` | 创建文章 | 是 |
| PUT | `/api/blog/posts/{id}` | 更新文章 | 是 |
| DELETE | `/api/blog/posts/{id}` | 删除文章 | 是 |
| PUT | `/api/blog/posts/{id}/publish` | 发布/取消发布 | 是 |
| POST | `/api/blog/posts/{id}/generate-cover` | AI 生成封面 | 是 |
| GET | `/api/blog/categories` | 分类列表 | 否 |
| POST | `/api/blog/categories` | 创建分类 | 是 |
| PUT | `/api/blog/categories/{id}` | 更新分类 | 是 |
| DELETE | `/api/blog/categories/{id}` | 删除分类 | 是 |

### 对话与聊天

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/conversations` | 对话列表 |
| POST | `/api/conversations` | 创建对话 |
| DELETE | `/api/conversations/{id}` | 删除对话 |
| GET | `/api/conversations/{id}/messages` | 获取对话消息 |
| POST | `/api/chat` | 非流式对话 |
| POST | `/api/chat/stream` | 流式对话（SSE） |

### 知识库

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/kb/documents` | 上传文档到知识库 |
| GET | `/api/kb/documents` | 文档列表 |
| PUT | `/api/kb/documents/{id}/category` | 设置文档分类 |
| DELETE | `/api/kb/documents/{id}` | 删除文档 |
| GET | `/api/kb/categories` | 分类树（支持 `?flat=true` 扁平列表） |
| POST | `/api/kb/categories` | 创建分类 |
| PUT | `/api/kb/categories/{id}` | 更新分类 |
| DELETE | `/api/kb/categories/{id}` | 删除分类 |
| GET | `/api/kb/collections` | 向量库集合列表 |
| DELETE | `/api/kb/collections/{name}` | 删除集合 |

### 文件

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/upload` | 上传文件 |
| GET | `/api/uploads/{filename}` | 下载文件 |
| GET | `/api/preview/{filename}` | 文件预览（PDF/DOCX/XLSX→HTML） |

### MCP 服务

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/mcp/servers` | MCP 服务器列表 |
| POST | `/api/mcp/servers` | 添加 MCP 服务器 |
| PUT | `/api/mcp/servers/{id}` | 更新配置 |
| DELETE | `/api/mcp/servers/{id}` | 删除服务器 |
| GET | `/api/mcp/library` | 内置 MCP 工具库 |
| POST | `/api/mcp/library/{name}/import` | 导入内置工具 |

### 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 用户登录 |
| GET | `/api/auth/me` | 获取当前用户信息 |

### 系统

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/status` | 系统状态 |

## 后端测试

### Mock 测试（日常开发）

Mock 测试屏蔽 LLM、Embedding、ChromaDB 等外部依赖，适合日常开发和 CI：

```bash
cd backend
uv run pytest tests/mock -v
```

### Real 测试（发布前）

Real 测试走真实链路，适合发布前或修改 AI/RAG/MCP 逻辑后验证：

```bash
cd backend
uv run pytest tests/real -v
```

## 项目结构

```
ai-blog/
├── backend/
│   ├── content/blog/           # Markdown 博客文件（事实源）
│   ├── src/
│   │   ├── main.py             # FastAPI 入口
│   │   ├── config.py           # 配置（环境变量）
│   │   ├── api/                # API 路由层
│   │   │   ├── routes.py       # 路由汇总注册
│   │   │   ├── blog.py         # 博客 API
│   │   │   ├── chat.py         # 聊天 API
│   │   │   ├── conversations.py
│   │   │   ├── kb.py           # 知识库 API
│   │   │   ├── mcp.py          # MCP 服务 API
│   │   │   ├── files.py        # 文件上传
│   │   │   ├── preview.py      # 文件预览
│   │   │   ├── auth.py         # 认证 API
│   │   │   └── status.py       # 状态 API
│   │   ├── services/           # 业务逻辑层
│   │   │   ├── blog_service.py
│   │   │   ├── blog_cover_service.py
│   │   │   ├── markdown_blog_service.py  # Markdown↔DB 同步
│   │   │   ├── chat_service.py           # LangGraph Agent + RAG
│   │   │   ├── conversation_service.py
│   │   │   ├── file_service.py
│   │   │   └── vector_store.py
│   │   ├── tools/              # Agent 工具定义
│   │   │   └── agent_tools.py  # 博客 CRUD + 知识库搜索工具
│   │   ├── database/           # 数据库层
│   │   │   ├── models.py       # ORM 模型
│   │   │   ├── session.py      # 连接与会话
│   │   │   └── migrations.py   # 数据库迁移
│   │   ├── schemas/            # Pydantic Schema
│   │   └── utils/              # 工具函数
│   └── tests/
│       ├── mock/               # Mock 测试
│       └── real/               # Real 测试
├── frontend/
│   ├── src/
│   │   ├── App.tsx             # 根组件（布局 + 路由）
│   │   ├── main.tsx            # 入口
│   │   ├── api/client.ts       # API 客户端
│   │   ├── stores/             # 状态管理
│   │   │   ├── chatStore.tsx   # 全局状态（useReducer）
│   │   │   └── authStore.tsx   # 认证状态
│   │   ├── components/         # 通用组件
│   │   │   ├── NavBar.tsx      # 顶部导航栏
│   │   │   ├── LeftSidebar.tsx # 左侧栏
│   │   │   ├── MCPModal.tsx    # MCP 配置弹窗
│   │   │   ├── FilePreview.tsx # 文件预览
│   │   │   └── ui/             # shadcn/ui 组件
│   │   ├── features/           # 功能模块
│   │   │   ├── blog/           # 博客（编辑/列表/详情/卡片）
│   │   │   ├── knowledge-base/ # 知识库管理
│   │   │   ├── ai-chat/        # AI 侧栏对话
│   │   │   └── auth/           # 登录/注册
│   │   └── hooks/              # React Hooks
│   └── index.html
├── start_backend.bat
├── start_frontend.bat
└── README.md
```

## 配置说明

`.env` 中的主要配置项：

| 变量 | 说明 | 默认值 |
|---|---|---|
| `OPENAI_API_KEY` | API 密钥 | 必填 |
| `BASE_URL` | API 地址 | 必填 |
| `MODEL_NAME` | 对话模型 | `Qwen3.6-35B` |
| `ROUTER_MODEL_NAME` | 路由分类模型 | `ds/deepseek-v4-flash` |
| `EMBEDDING_MODEL` | 向量化模型 | `text-embedding-3-small` |
| `JWT_SECRET` | JWT 签名密钥 | `dev-secret-key-change-in-production-env` |
| `JWT_EXPIRE_SECONDS` | Token 过期时间（秒） | 604800（7 天） |
| `DATABASE_URL` | 数据库连接 | `sqlite+aiosqlite:///./ai-blog.db` |
| `CHROMA_DB_PATH` | 向量库存储路径 | `./chroma_db` |
| `RAG_TOP_K` | 检索返回片段数 | 3 |
