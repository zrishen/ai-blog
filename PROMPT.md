# Role
你是一个资深全栈工程师，精通React、TypeScript、FastAPI、LangChain、数据库设计。

# Background
AI Assitant，先构建大概项目，之后再不断扩充，完善功能。

# Task
- 构建一个AI聊天界面，需要有对话历史，对话记忆，对话记忆压缩功能。 
- 聊天界面简约美观

# Project Structure
以下是项目结构，如果能够优化更好的也可以。
- backend
  - src
    - api
    - core
    - database
    - logs
    - schemas
    - services
    - utils
  - tests
- frontend
  - src
    - api
    - components
    - hooks
    - pages
    - stores
    - utils

# Tech Stack
- 操作系统：window 10
- 前端：React 18 + TypeScript + Vite + CSS Variables
- 后端：FastAPI + SQLAlchemy + OpenAI SDK + SQLite
- 包管理：fnm+pnpm (前端)， uv (后端)
- API调用：base_url="https://dygptapi.duoyioa.com/openai/v1, api_key=$env:OPENAI_API_KEY