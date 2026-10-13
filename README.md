# ai-blog

> 把想法写成体系 —— 一套面向个人创作者的 AI 写作平台。以 Markdown 工作区为事实源，集博客创作、AI 对话、知识库 RAG 与认知记忆图谱于一体，开箱即可自部署。

[English](README.en.md) · [![CI](https://github.com/zrishen/ai-blog/actions/workflows/ci.yml/badge.svg)](https://github.com/zrishen/ai-blog/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/v/tag/zrishen/ai-blog?label=release)](https://github.com/zrishen/ai-blog/tags) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<p align="center">
  <img src="docs/landing.png" alt="ai-blog 主页界面" width="960">
</p>

## 功能特性

### 写作工作台

- Markdown 编辑器 Vditor，支持所见即所得、分屏与即时渲染；正文以 `.md` 文件为唯一事实源，存于用户工作区
- 文章 CRUD、草稿与发布、分类、标签、封面、摘要；封面支持 AI 一键生成
- 发布基于不可变 revision 快照；公开主页 `/u/:username` 与文章详情页对访客开放
- 工作区文件树、回收站与 Git 版本化

### AI 对话

- SSE 流式输出，多会话管理，长对话自动压缩上下文
- 聊天附件支持图片与文档，可按配额限制
- AI 侧栏随页面上下文切换：博客、知识库、文章详情
- Agent 工具集：博客读写、知识库语义搜索、认知记忆召回、工作区文件读取、受限 Web 抓取与 MCP，后两者默认关闭，见 `MCP_ENABLED`
- 公开对话：未登录访客可在 Landing 页与公开博客对话，按字符数、输出 token 与每 IP 每日次数限流

### 知识库 RAG

- 支持 PDF / DOCX / XLSX / Markdown 上传，后台任务自动解析、分块、向量化入库
- Embedding 支持 OpenAI 兼容 API 或本地 sentence-transformers 模型
- 对话时按用户隔离做检索增强

### 认知记忆

- 基于 FalkorDB 图谱的长期记忆，从对话中抽取实体、事实、情景与偏好
- 定时巩固与衰减；召回时沿图谱扩展关联记忆
- `/brain` 页面可视化知识图谱，含实体详情与记忆统计

### 账户与订阅

- 邀请码注册与登录，JWT 会话，密码 bcrypt 哈希
- 用户级 LLM 配置 BYOK：协议、Base URL、API Key 与模型，Key 加密存储、按用户路由
- 订阅体系：兑换码激活、平台 Key 与周 token 配额；超额或到期自动回退 BYOK
- 管理后台 `/admin`：用户管理、兑换码与用量统计
- 所有数据严格按用户隔离

### 界面

- 浅色与深色主题
- 三栏可拖拽布局：侧栏、主内容与 AI 侧栏，布局持久化
- 响应式设计，适配移动端

## 快速开始

### Docker 部署

推荐方式，同源容器编排一次拉起 Nginx、FastAPI、PostgreSQL 与 FalkorDB：

```bash
# 1. 准备后端环境变量，三个密钥的生成命令见文件内注释
cp backend/.env.example backend/.env
# 编辑 backend/.env，填入 OPENAI_API_KEY、JWT_SECRET 等

# 2. 构建并启动
docker compose build
docker compose up -d

# 3. 健康检查
curl http://127.0.0.1/health
```

首次启动、更新、备份与 HTTPS 接入的完整说明见 [`deploy/docker/README.md`](deploy/docker/README.md)。

### 本地开发

前置要求：Python 3.11+、Node.js 20+ 与 Docker；PostgreSQL 与 FalkorDB 由容器提供，Python 依赖推荐用 [uv](https://github.com/astral-sh/uv) 管理。

```bash
# 后端环境变量
cp backend/.env.example backend/.env
# 编辑 backend/.env，DATABASE_URL / FALKORDB_URL 保持本地默认即可
```

Windows 用户可直接双击 `start_backend.bat` 与 `start_frontend.bat`，脚本会自动拉起数据库容器并启动前后端；或手动执行：

```bash
# 启动开发数据库，仅 postgres 与 falkordb
docker compose -f compose.yaml -f compose.dev.yaml up -d --wait postgres falkordb

# 启动后端
cd backend
uv run uvicorn src.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir src

# 启动前端，另开终端
cd frontend
npm install
npm run dev
```

浏览器访问 `http://localhost:5173`，Vite 已将 `/api` 代理到后端 8000 端口。

## 技术栈

| 维度 | 选型 |
| --- | --- |
| 前端 | React 19 · TypeScript · Vite · Tailwind CSS 4 · Vditor |
| 后端 | Python 3.11+ · FastAPI · SQLAlchemy 2.0 · Alembic |
| 存储 | PostgreSQL · FalkorDB 图数据库 |
| AI | LangGraph · LangChain · OpenAI 兼容接口 · sentence-transformers |
| 工程 | Docker Compose · Nginx · GitHub Actions CI |

## 项目结构

```text
ai-blog
├─ backend/         FastAPI 服务，api 薄层 + services 领域层
├─ frontend/        React 单页应用，features 按域自包含
├─ deploy/docker/   Dockerfile、Nginx 配置与部署文档
├─ docs/            界面截图
├─ compose.yaml     生产编排
└─ compose.dev.yaml 本地开发编排
```

## 配置

全部配置项与注释见 [`backend/.env.example`](backend/.env.example)。

## 测试

```bash
# 后端：testcontainers 起真实容器，全量较慢，建议只跑改动域
cd backend
uv run pytest

# 前端
cd frontend
npm run test
```

CI 在此基础上额外执行前端 lint、构建与后端 ruff、basedpyright 检查。

## 许可证

[MIT](LICENSE)
