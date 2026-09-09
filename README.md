# ai-blog

> 把想法写成体系 —— 一套面向个人创作者的 AI 写作平台。以 Markdown 工作区为事实源，集博客创作、AI 对话、知识库 RAG 与认知记忆图谱于一体，开箱即可自部署。

[English](README.en.md) · [![CI](https://github.com/zrishen/ai-blog/actions/workflows/ci.yml/badge.svg)](https://github.com/zrishen/ai-blog/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<p align="center">
  <img src="docs/landing.png" alt="ai-blog 主页界面">
</p>

## 功能特性

### 写作工作台
- Markdown 编辑（Vditor，所见即所得 / 分屏 / 即时渲染），正文以 `.md` 文件为唯一事实源存于用户工作区
- 文章 CRUD、草稿 / 发布、分类、标签、封面、摘要，AI 一键生成封面
- 发布采用不可变 revision 快照；用户公开主页 `/u/:username` 与文章详情页对未登录访客开放
- 工作区文件树管理、回收站、Git 版本化

### AI 对话
- SSE 流式对话，多会话管理，长对话自动压缩上下文
- 聊天附件：图片 + 文档（可配额限制）
- 右侧 AI 侧栏随页面上下文切换（博客、知识库、文章详情）
- Agent 工具：博客读写、知识库语义搜索、认知记忆召回、工作区文件读取、受限 Web 抓取（默认关闭）、MCP（默认停用，见 `MCP_ENABLED`）
- 公开对话：未登录用户可在 Landing 页与公开博客页对话，受字符数、输出 token 与每 IP 每日次数限制

### 知识库（RAG）
- 上传 PDF / DOCX / XLSX / Markdown，后台任务自动解析分块、向量化入库
- Embedding 支持 OpenAI 兼容 API 或本地 sentence-transformers 模型
- 对话时按用户隔离做检索增强

### 认知记忆（大脑）
- 基于 FalkorDB 图谱的长期记忆：从对话中抽取实体、事实、情景与偏好
- 定时巩固与衰减，召回时图扩展关联记忆
- `/brain` 页面可视化知识图谱，查看实体详情与记忆统计

### 账户与订阅
- 邀请码注册 / 登录（JWT），密码 bcrypt 哈希
- 用户级 LLM 配置（BYOK）：协议、Base URL、API Key、模型，Key 加密保存，按用户路由
- 订阅体系：兑换码激活、平台 Key + 周 token 配额，超额或到期自动回退 BYOK
- 管理后台 `/admin`：用户管理、兑换码、用量统计
- 所有用户数据严格 user-scoped 隔离

### 界面
- 浅色 / 深色主题
- 三栏可拖拽布局（侧栏 + 主内容 + AI 侧栏），布局持久化
- 响应式设计

## 快速开始

### Docker 部署（推荐）

提供 Nginx + FastAPI 同源容器编排，包含 PostgreSQL 与 FalkorDB：

```bash
# 1. 准备后端环境变量（三个密钥的生成命令见该文件内注释）
cp backend/.env.example backend/.env
# 编辑 backend/.env 填入 OPENAI_API_KEY、JWT_SECRET 等

# 2. 构建并启动
docker compose build
docker compose up -d

# 3. 健康检查
curl http://127.0.0.1/health
```

完整的首次启动、更新、备份与 HTTPS 接入说明见 [`deploy/docker/README.md`](deploy/docker/README.md)。

### 本地开发

前置要求：Python 3.11+（推荐 [uv](https://github.com/astral-sh/uv)）、Node.js 20+、Docker（跑 PostgreSQL 与 FalkorDB）。

```bash
# 后端环境变量
cp backend/.env.example backend/.env
# 编辑 backend/.env：DATABASE_URL / FALKORDB_URL 保持本地默认即可
```

Windows 下直接双击 `start_backend.bat` 与 `start_frontend.bat`（自动拉起数据库容器并启动服务）；或手动执行：

```bash
# 启动开发数据库（仅 postgres + falkordb）
docker compose -f compose.yaml -f compose.dev.yaml up -d --wait postgres falkordb

# 启动后端
cd backend
uv run uvicorn src.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir src

# 启动前端（另开终端）
cd frontend
npm install
npm run dev
```

浏览器访问 http://localhost:5173，Vite 会把 `/api` 代理到后端 8000。

## 配置

全部配置项及注释见 [`backend/.env.example`](backend/.env.example)。

## 测试

```bash
# 后端（testcontainers 起真实容器，全量较慢，建议只跑改动域）
cd backend
uv run pytest

# 前端
cd frontend
npm run test
```

## 许可证

[MIT](LICENSE)
