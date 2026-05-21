# AI Assistant

基于 React + FastAPI 的 AI 对话助手，支持知识库检索增强生成（RAG）、文件上传解析、流式输出等功能。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite |
| 后端 | FastAPI + SQLAlchemy + OpenAI SDK |
| 数据库 | SQLite (aiosqlite) |
| 向量库 | ChromaDB (ONNX MiniLM L6 V2) |

## 功能特性

- **AI 对话**：支持流式输出，Markdown 渲染，光标动画
- **图片对话**：上传图片直接与 AI 对话
- **文件上传**：支持 `.docx`、`.xlsx`、`.pdf` 文件上传与内容解析
- **知识库（RAG）**：上传文档自动向量化，对话时检索相关片段增强回答
- **对话管理**：多会话管理、历史记录查看、会话删除
- **主题切换**：支持浅色/深色模式

## 快速开始

### 前置要求

- Python 3.11+
- Node.js 18+ (使用 fnm 管理)
- uv (Python 包管理器)

### 后端

```bash
cd backend
uv sync
uv run uvicorn src.main:app --host 0.0.0.0 --port 8001 --reload
```

需要配置 `.env` 文件：

```env
OPENAI_API_KEY=your-api-key
BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-4o-mini
```

### 前端

```bash
cd frontend
npx vite --port 5173
```

前端通过 Vite proxy 将 `/api` 请求转发到后端（默认 `http://localhost:8001`）。

## API 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET | `/api/conversations` | 获取对话列表 |
| POST | `/api/conversations` | 创建新对话 |
| DELETE | `/api/conversations/:id` | 删除对话 |
| GET | `/api/conversations/:id/messages` | 获取对话消息 |
| POST | `/api/chat` | 非流式对话 |
| POST | `/api/chat/stream` | 流式对话 (SSE) |
| POST | `/api/upload` | 上传文件 |
| GET | `/api/uploads/:filename` | 下载上传的文件 |
| POST | `/api/kb/documents` | 上传文件到知识库 |
| GET | `/api/kb/documents` | 列出知识库文档 |
| DELETE | `/api/kb/documents/:id` | 删除知识库文档 |
| GET | `/api/kb/collections` | 列出向量库集合 |
| DELETE | `/api/kb/collections/:name` | 删除向量库集合 |

## 项目结构

```
├── backend/
│   ├── src/
│   │   ├── api/routes.py          # API 路由
│   │   ├── core/config.py         # 配置
│   │   ├── database/              # 数据库模型与连接
│   │   ├── schemas/               # Pydantic 数据模型
│   │   ├── services/              # 业务逻辑（对话、文件、向量库等）
│   │   └── utils/chunker.py       # 文档分块工具
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── api/client.ts          # API 客户端
│   │   ├── components/            # UI 组件
│   │   ├── hooks/                 # React hooks
│   │   ├── pages/                 # 页面
│   │   └── stores/chatStore.tsx   # 状态管理
│   └── package.json
```
