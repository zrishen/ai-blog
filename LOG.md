# LOG

## 2026-05-21 18:30 MCP 工具集成 + 前端配置界面完整实施

## 2026-05-21 19:10 修复日志文件中 ANSI 颜色码泄露问题

- **问题**：控制台颜色格式化器 `_ColoredFormatter` 直接修改 `LogRecord.levelname`，导致共享同一 record 的文件 handler 也写入了带 ANSI 颜色的日志
- **修复**：改为先格式化再在结果字符串上替换颜色，不修改 `LogRecord` 本身
- **文件**：`backend/src/core/logging_config.py`

### 完成内容

#### 后端（完整工具调用链路）
- [mcp_server_tools.py](backend/src/services/mcp_server_tools.py)：内建工具 MCP Server，提供 `get_current_time`（北京时间）、`get_weather`（wttr.in API）、`web_search`（DuckDuckGo HTML）三个工具
- [tool_client.py](backend/src/services/tool_client.py)：MCP Client，通过 stdio 启动子进程与 MCP Server 通信，封装 `call_tool()` 和 `list_available_tools()`
- [mcp_config.py](backend/src/services/mcp_config.py)：MCP 配置管理，支持内置工具种子数据自动注入 + 用户自定义服务 CRUD
- [mcp_server.py](backend/src/models/mcp_server.py)：MCPServer 数据模型，支持 builtin/stdio/sse 三种服务器类型
- [chat_service.py](backend/src/services/chat_service.py)：工具调用集成 — 两阶段流程（LLM 检测 tool_calls → 执行工具 → 二次调用 LLM 生成回复），SSE 推送 `\x00TOOLDONE\x00` 事件通知前端，优雅降级（LLM 不支持 tool_use 时退回纯文本）
- [routes.py](backend/src/api/routes.py)：MCP 配置 CRUD API（GET/POST /mcp/servers, PUT toggle, DELETE）
- [engine.py](backend/src/database/engine.py)：`init_db()` 末尾添加 `seed_default_tools()` 调用，启动时自动注入内置工具（幂等）

#### 前端（工具展示 + MCP 配置 UI）
- [ChatMessage.tsx](frontend/src/components/ChatMessage.tsx)：添加工具调用状态（齿轮图标 + "Calling: xxx"）和工具结果（可展开 details 块）渲染
- [ChatMessage.css](frontend/src/components/ChatMessage.css)：工具调用/结果样式
- [MCPConfig.tsx](frontend/src/components/MCPConfig.tsx)：MCP 服务器配置面板，支持查看/添加/删除服务器、切换内置工具开关
- [MCPConfig.css](frontend/src/components/MCPConfig.css)：独立样式文件，卡片美化、Toggle Switch 动画、类型 Badge 颜色编码
- [Sidebar.tsx](frontend/src/components/Sidebar.tsx)：添加第三个 "MCP" tab
- [client.ts](frontend/src/api/client.ts)：SSE `\x00TOOLDONE\x00` 事件解析，MCP CRUD API 函数
- [chatStore.tsx](frontend/src/stores/chatStore.tsx)：tool_calls/tool_results 状态，mcpServers 状态管理
- [useChat.ts](frontend/src/hooks/useChat.ts)：tool 回调（工具调用中/完成更新显示）
- [ChatPage.tsx](frontend/src/pages/ChatPage.tsx)：透传 tool_calls/tool_results 属性，优化流式输出滚动

#### 日志
- 工具调用全流程结构化日志（tool_client.py、chat_service.py、routes.py）
- 工具调用失败记录错误日志
- HTTP 访问日志同时写入 app.log 文件

### 技术
- MCP SDK（Model Context Protocol）：stdio 模式子进程通信
- OpenAI Tool Use API：function calling，两阶段对话
- SSE（Server-Sent Events）：`\x00` 标记协议传递工具事件
- SQLAlchemy async ORM + SQLite PRAGMA 迁移
- React state 管理：tool_calls/tool_results 消息扩展
- ChromaDB 向量库（RAG 知识库）

### 验证（2026-05-21 18:30 已完成）
- [x] `/api/mcp/servers` 返回内置工具服务（id=1, is_active=true）
- [x] 后端启动自动种子 `seed_default_tools()`（幂等）
- [x] 工具调用流程日志确认：`MCP tool flow: found 1 active servers` → `Tool calling flow: 3 tools available` → `Combined RAG + tool_use: rag=yes, tools=3`
- [x] 普通对话正常工作：`Response generated: 16 chars, preview='你好！请问有什么我可以帮您的吗？'`
- [x] 后端健康检查：`/api/status` → database ok, uploads ok (30 files), vector_store ok (4 collections)
- [x] 前端已用 fnm node v24.12.0 启动：`http://localhost:5173/`
- [ ] 问"现在几点" → 调用 `get_current_time`（需用户在浏览器测试）
- [ ] 问"北京天气" → 调用 `get_weather`（需用户在浏览器测试）
- [ ] 问"今天有什么新闻" → 调用 `web_search`（需用户在浏览器测试）
- [ ] 前端 MCP 配置面板完整交互（需在浏览器测试）

---

## 2026-05-21 18:00 MCP 内置工具启动自动种子

### 问题
`seed_default_tools()` 函数只通过 `/mcp/seed` 端点手动调用，应用重启后内置工具不会自动入库，用户首次启动时看不到预配置的工具服务。

### 修改
- [engine.py](backend/src/database/engine.py) `init_db()` 末尾添加：`async with async_session() as session: from src.services.mcp_config import seed_default_tools; await seed_default_tools(session)`。在创建所有表并执行完所有迁移后，自动插入内置工具条目（幂等，已存在则跳过）。

### 验证
重启后端后访问 `/api/mcp/servers` 应自动返回内置工具服务（id=1, name="内置工具", is_active=true）。

---

## 2026-05-21 17:40 日志换行符修复

### 问题
日志文件中一条日志被分成多行显示，如 RAG 搜索结果内容包含换行符时。

### 根因
[logging_config.py:33-37](backend/src/core/logging_config.py#L33-L37) 的 `_FileFormatter.format()` 修改了 `record.msg`（格式模板），但换行符实际存在于 `record.args` 的内容中，已被 `getMessage()` 格式化进最终字符串，修改 `record.msg` 无效。

### 修改
直接对 `super().format(record)` 的返回值进行换行符替换。

---

## 2026-05-21 17:30 MCP 工具加载异步连接修复

### 问题
MCP 工具加载失败，日志报错：`'sqlalchemy.ext.asyncio.engine.AsyncConnection' object does not support the context manager protocol (missed __exit__ method)`

### 根因
[chat_service.py:286](backend/src/services/chat_service.py#L286) 使用同步 `with db_engine.connect()` 打开异步引擎的连接。`db_engine` 是 `AsyncEngine`，必须用 `async with`。

### 修改
改用 `async_session` 的 `async with` 上下文管理器访问数据库。

### 验证
重启后端后，MCP 工具加载不再报错，日志显示 `MCP tool flow: found 1 active servers`。

---

## 2026-05-21 17:00 HTTP 访问日志修复：写入 app.log 文件

### 问题
`uvicorn.access` 的 HTTP 日志只输出到控制台终端，未写入 `backend/logs/app.log` 文件。

### 根因
Uvicorn 在 `setup_logging()` 之后会为 `uvicorn.access` logger 添加独立的 handler，导致不再继承 root logger 的文件处理器。仅设置 `setLevel()` 无法解决这个问题。

### 修改
- [logging_config.py](backend/src/core/logging_config.py) 第 75-79 行：将 `uvicorn.access` logger 显式添加 `file_handler` 和 `console` handler（不再依赖继承），级别从 INFO 改为 DEBUG（记录所有 HTTP 请求）。

### 验证
重启后端后，`app.log` 中已正确出现 `[uvicorn.access]` 日志行，如：
```
[2026-05-21 14:29:50] [INFO] [uvicorn.access] 127.0.0.1:56694 - "GET /api/conversations HTTP/1.1" 200
```

## 2026-05-21 16:00 后端日志系统优化

### 修改
- [logging_config.py](backend/src/core/logging_config.py)：日志系统已在前序会话完成，包含：
  - 彩色控制台输出（ANSI 转义码，按日志级别着色）
  - RotatingFileHandler 轮转文件（10MB 上限，5 个备份）
  - 结构化日志辅助函数 `struct()`
  - 第三方库噪音压制（openai, httpx, aiosqlite, asyncio）

- [main.py](backend/src/main.py)：在 `@app.on_event("startup")` 中调用 `setup_logging()`，在数据库初始化之前完成日志系统初始化

- [chat_service.py](backend/src/services/chat_service.py)：清理 `_retrieve_context()` 中约 20 处 `print(f"[RAG DEBUG] ...")` 调试语句，全部替换为 `logger.debug(...)` 结构化调用。生产环境（INFO 级别）不再输出调试噪音，需要调试时可降级到 DEBUG 级别查看 RAG 检索全过程日志

### 技术
- Python logging 模块化系统：`logging.getLogger(__name__)` 获取模块化 logger
- RotatingFileHandler：自动日志文件轮转
- ANSI 转义码：控制台彩色输出，提升可读性
- logger.debug() 替代 print()：结构化日志，可按级别过滤

## 2026-05-21 15:30 美化 MCP 配置界面

### 修改
- [MCPConfig.css](frontend/src/components/MCPConfig.css)：新建独立样式文件（~330行），包含：
  - 表单面板美化：圆角卡片、淡入动画（fade-in）、自定义下拉箭头、焦点光环效果
  - 服务器卡片：hover 边框高亮、builtin 类型浅青色背景区分
  - Type Badge：三种类型不同颜色编码（builtin 青色 / stdio 紫色 / sse 绿色）
  - 自定义 Toggle Switch：滑动动画（track + thumb，250ms 过渡）
  - 删除按钮：hover 显示（opacity 0→1），hover 时红色高亮

- [MCPConfig.tsx](frontend/src/components/MCPConfig.tsx)：所有 CSS 类名从旧的 kb-* 前缀替换为 mcp-* 前缀，toggle switch 添加 track/thumb 嵌套结构

## 2026-05-21 修复 MCP 界面白屏

### 问题
- 点击侧栏 MCP tab 时前端白屏
- 根因：[chatStore.tsx](frontend/src/stores/chatStore.tsx) 的 `initialState` 缺少 `mcpServers: []` 初始化，且 reducer 缺少 `SET_MCP_SERVERS` 和 `REMOVE_MCP_SERVER` 的 case 处理
- 当 MCPConfig 组件尝试遍历 `state.mcpServers` 时值为 `undefined`，抛出 TypeError 导致整棵 React 组件树崩溃

### 修改
- [chatStore.tsx](frontend/src/stores/chatStore.tsx)：`initialState` 添加 `mcpServers: []`
- [chatStore.tsx](frontend/src/stores/chatStore.tsx)：reducer 添加 `SET_MCP_SERVERS` 和 `REMOVE_MCP_SERVER` 的 case 处理

## 2026-05-21 完成工具调用前端集成 + MCP 配置 UI + Sidebar MCP Tab

### 前端修改（本次会话）

- [ChatMessage.tsx](frontend/src/components/ChatMessage.tsx)：扩展接口添加 `tool_calls?: ToolCall[]` 和 `tool_results?: string[]`，在 Markdown 内容之前添加工具调用状态（齿轮图标 + "Calling: xxx"）和工具结果（可展开的 details 块）的渲染。

- [ChatMessage.css](frontend/src/components/ChatMessage.css)：添加 `.message-tool-calls`, `.message-tool-call`, `.message-tool-results`, `.message-tool-result` 样式类。

- [ChatPage.tsx](frontend/src/pages/ChatPage.tsx)：在 `<ChatMessage>` 渲染中透传 `tool_calls` 和 `tool_results` 属性。

- [MCPConfig.tsx](frontend/src/components/MCPConfig.tsx)：新建 MCP 服务器配置 UI 面板组件，参照 KnowledgeBase 组件模式。支持：查看服务器列表（区分内置/stdio/sse 类型）、添加新服务器（stdio 需要 command+args，sse 需要 url）、切换内置工具启用/禁用状态、删除自定义服务器、表单验证、错误提示、加载状态。

- [Sidebar.tsx](frontend/src/components/Sidebar.tsx)：添加第三个 "MCP" tab 按钮，import MCPConfig 组件，在渲染逻辑中添加 MCPConfig 面板渲染。

### 前端核心逻辑（前序会话已完成）

- [client.ts](frontend/src/api/client.ts)：`sendChat()` 增加 tool 回调参数，SSE 解析 `\x00TOOLDONE\x00` 事件触发工具调用/结果回调；新增 MCP CRUD API 函数（listMCPServers, addMCPServer, toggleMCPServer, deleteMCPServer）。

- [chatStore.tsx](frontend/src/stores/chatStore.tsx)：Message 接口增加 tool_calls/tool_results，Panel 类型扩展为 "conversations"|"knowledge"|"mcp"，ChatState 增加 mcpServers 状态，reducer 处理新 action。

- [useChat.ts](frontend/src/hooks/useChat.ts)：`sendMessage()` 添加 tool 回调（工具调用中更新显示，工具完成更新结果），新增 loadMCPServers/addMCPServer/removeMCPServer hooks。

### 后端（前序会话已完成）

- [mcp_server_tools.py](backend/src/services/mcp_server_tools.py)：内建工具 MCP Server（get_current_time, get_weather, web_search）

- [tool_client.py](backend/src/services/tool_client.py)：MCP Client，stdio 模式连接 MCP Server 子进程

- [mcp_config.py](backend/src/services/mcp_config.py)：MCP 配置管理，内置工具种子数据，配置 CRUD

- [mcp_server.py](backend/src/models/mcp_server.py)：MCPServer 数据模型（builtin/stdio/sse 三种类型）

- [chat_service.py](backend/src/services/chat_service.py)：工具调用集成，两阶段流程（检测 tool_calls → 执行工具 → 二次调用 LLM），优雅降级

- [routes.py](backend/src/api/routes.py)：MCP 配置 CRUD 路由（GET/POST /mcp/servers, PUT toggle, DELETE）

## 2026-05-20 22:05 修复前端白屏（react-markdown named import 不匹配 Vite bundle）

### 问题
- 修改 react-markdown 导入为 named import `import { Markdown }` 后前端界面全部空白
- 根因：Vite 打包 react-markdown 时，bundle 只做了 `export { Markdown as default }`，没有 `export { Markdown }` named export
- `import { Markdown }` 在浏览器中找不到 named export，导致 JavaScript 运行时错误、白屏

### 修改
- [ChatMessage.tsx](frontend/src/components/ChatMessage.tsx)：`import { Markdown }` → `import Markdown`（default import）

### 说明
- react-markdown v10 的 `index.js`（JS entry）和 `lib/index.d.ts`（TypeScript types）导出声明不一致
- JS entry 有 `export { Markdown as default }`，TS types 没有 default 声明
- Vite 打包时以 JS entry 为准，只做 `Markdown as default` 导出
- named import `import { Markdown }` 无法匹配，Vite 打包后也不会自动补充 named export

## 2026-05-20 21:10 修复 RAG 不检索知识库 + SSE 流挂起问题

### 问题
- 用户上传 PDF 到知识库后向 AI 提问，AI 不检索知识库内容，直接凭训练数据回答
- 前端 SSE 流式响应一直挂起，得不到任何回复
- 根因分析：诊断脚本 [diagnose.py](backend/diagnose.py) 确认 `MDCN_revision_v2` 集合有 223 个文档，但 `_retrieve_context()` 只搜索硬编码的 `uploaded_files` 和 `knowledge_base` 两个空集合，永远返回空字符串

### 修改
- [chat_service.py](backend/src/services/chat_service.py) `_retrieve_context()`：
  - 从硬编码搜索两个集合改为动态获取所有集合（`list_collections()`）
  - 筛选出有文档的集合（`count > 0`）后逐一搜索
  - 结果按距离排序并限制数量（`top_k * 2`），避免 prompt 过大
  - 集合名动态生成 source 标签（`kb:{collection_name}`）

- [chat_service.py](backend/src/services/chat_service.py) 超时保护机制：
  - 新增 `_timeout_guard()` 函数，封装 `asyncio.wait_for`，默认超时 120 秒
  - 数据库查询（conversation lookup / message fetch）：120 秒超时
  - 文件提取：120 秒超时，超时则跳过
  - RAG 检索：120 秒超时，超时则跳过
  - API 调用：60 秒超时，超时后返回错误提示并保存到数据库
  - 流式接收：捕获 `asyncio.CancelledError`，防止连接断开导致异常

### 验证
- 诊断脚本确认 RAG 检索本身无性能问题（PDF 解析 3.3 秒，嵌入生成很快）
- 需重启后端服务生效，前端测试提问 PDF 相关内容验证修复

## 2026-05-20 20:49 清理后端多余文件与统一配置

## 2026-05-20 20:49 清理后端多余文件与统一配置

### 修改
- [config.py](backend/src/core/config.py)：`model_name` 默认值从 `gpt-4o-mini` 改为 `Qwen3.6-35B`，与 `.env` 统一
- 删除 `backend/backend/` — 嵌套的空文件夹（项目初始化遗留）
- 删除 `backend/tests/` — 空的测试目录
- 删除 `backend/.env.example` — 已有 `.env`，模板多余
- 删除 `backend/test_doc.docx` — 测试文档
- 删除 `backend/src/__pycache__/` — Python 缓存

### 说明
- `config.py` 不是多余文件，它是核心配置模块，被 `main.py` 和各服务层导入使用
- pydantic-settings 运行时优先读取 `.env` 中的值，所以之前默认值不一致不影响功能，但现在已统一

## 2026-05-20 16:30 启动前后端服务（修复端口占用与配置问题）

### 问题
- 端口 8001 被未知进程（PID 11704）占用且无法终止
- bash 环境缺少标准工具（netstat、taskkill、node、uv 等不在 PATH）
- 后端启动时 pydantic-settings 无法正确加载 .env 中的 BASE_URL 字段

### 解决
- 使用 Python 调用 netstat 定位占用端口的 PID
- 后端改启动在 8002 端口
- 更新 [vite.config.ts](frontend/vite.config.ts) 代理目标从 8001 改为 8002
- 通过 fnm 找到 node.exe 路径，直接用 `node.exe vite.js` 启动前端
- 前端运行在 http://localhost:5173，后端运行在 http://localhost:8002

## 2026-05-20 编写 README.md 并启动前后端

### 完成
- 编写 [README.md](README.md)，记录技术栈、功能特性、快速开始指南、API 接口文档和项目结构
- 确认后端 FastAPI 服务运行在 http://localhost:8001
- 确认前端 Vite 服务运行在 http://localhost:5175

## 2026-05-19 提高 KB 文件上传限制到 100MB

### 问题
- 前端 test_doc.docx 上传成功，但用户自己的文件上传失败
- 根因：后端 file_service.py 中 MAX_FILE_SIZE 限制为 10MB，用户文件超过此限制

### 修改
- [file_service.py](backend/src/services/file_service.py)：MAX_FILE_SIZE 从 10MB 提高到 100MB
- [file_service.py](backend/src/services/file_service.py)：修复 file.size 为 None 时的比较 bug（大文件流式上传时 size 可能为 None）

### 验证
- 测试上传 test_doc.docx 成功

## 2026-05-19 修复 KB 上传 500 错误（Vite 代理端口 + 导入路径）

### 问题
- 前端在知识库上传文件时返回 500 错误
- 后端日志中没有任何 KB 上传请求记录

### 根因
1. **Vite 代理端口错误**：[vite.config.ts](frontend/vite.config.ts) 中 `/api` 代理目标为 `http://localhost:8000`，但后端运行在 8001 端口，请求被发到了错误的端口
2. **routes.py 导入不一致**：[routes.py](backend/src/api/routes.py) 第 149 行从 `src.database.models` 导入 KBDocument，而文件其他处均从 `src.database.engine` 导入

### 修改
- [vite.config.ts](frontend/vite.config.ts)：代理目标从 `http://localhost:8000` 改为 `http://localhost:8001`
- [routes.py](backend/src/api/routes.py)：`from src.database.models import KBDocument` → `from src.database.engine import KBDocument`

### 验证
- 需重启前端 dev server 使代理配置生效，然后重新测试 KB 文件上传

## 2026-05-19 修复文件上传 404（后端旧进程）

### 问题
- 上传返回 `{"detail":"Not Found"}`，OpenAPI spec 中无 `/api/upload` 路由
- 根因：有两个 uvicorn 进程在运行（PID 14144 和 9624），旧进程加载的代码没有 upload 路由

### 修改
- 杀掉旧 uvicorn 进程，重新启动后端

### 验证
- OpenAPI spec 确认 `/api/upload` 和 `/api/uploads/{filename}` 已注册
- 实际上传测试成功

## 2026-05-19 修复文件上传 404 与图标对齐

### 问题
- Vite dev server 没有 proxy 配置，`/api/upload` 请求发送到前端端口（5173）而非后端（8000），导致 404
- 输入框中 attach-btn 图标与文字底部对齐，视觉上不对齐

### 修改
- [vite.config.ts](frontend/vite.config.ts)：添加 server.proxy 配置，将 `/api` 请求代理到 `http://localhost:8000`
- [ChatInput.css](frontend/src/components/ChatInput.css)：`.chat-input-wrapper` 的 `align-items` 从 `flex-end` 改为 `center`

### 验证
- TypeScript 类型检查通过
- Vite 生产构建成功

## 2026-05-19 修复文件上传按钮合并与 accept 属性

修复文件上传"上传失败"问题，合并图片和文件上传按钮为一个。

### 问题
- ChatInput.tsx 中文件输入框的 accept 属性使用了文件扩展名（`.docx,.xlsx,.pdf`）而非 MIME 类型，部分浏览器不兼容
- 图片和文件上传使用两个独立按钮，用户要求合并

### 修改
- [ChatInput.tsx](frontend/src/components/ChatInput.tsx)：合并两个文件输入框和一个按钮，统一使用 `accept="image/*,application/pdf,.docx,.xlsx"`；handleFileUpload 根据文件类型自动区分图片（本地 base64 预览）和文档（服务端上传）
- [ChatInput.css](frontend/src/components/ChatInput.css)：移除 `image-upload-btn` 和 `file-upload-btn` 样式，新增 `attach-btn` 合并样式

### 验证
- TypeScript 类型检查通过
- Vite 生产构建成功

## 2026-05-19 文件上传对话功能

实现上传文件（Word .docx、Excel .xlsx、PDF .pdf）并与 AI 对话的功能。

### 后端修改
- [routes.py](backend/src/api/routes.py)：添加 `/upload` 和 `/uploads/{filename}` 端点，chat 端点传递 file_url
- [models.py](backend/src/database/models.py)：Message 模型添加 file_url 列
- [engine.py](backend/src/database/engine.py)：添加 file_url 数据库迁移，add_message_pair 支持 file_url 参数
- [schemas.py](backend/src/schemas/conversation.py)：MessageRequest 和 MessageResponse 添加 file_url 字段
- [chat_service.py](backend/src/services/chat_service.py)：stream_chat 支持 file_url，提取文件内容并拼接到用户消息
- [file_service.py](backend/src/services/file_service.py)：新建文件解析服务（上轮已创建）

### 前端修改
- [chatStore.tsx](frontend/src/stores/chatStore.tsx)：Message 接口添加 file_url 字段
- [client.ts](frontend/src/api/client.ts)：添加 uploadFile 函数，sendChat 添加 file_url 参数
- [useChat.ts](frontend/src/hooks/useChat.ts)：sendMessage 支持 file_url 参数
- [ChatInput.tsx](frontend/src/components/ChatInput.tsx)：添加文件上传按钮、文件选择器、文件预览
- [ChatInput.css](frontend/src/components/ChatInput.css)：添加文件上传按钮和文件预览样式
- [ChatMessage.tsx](frontend/src/components/ChatMessage.tsx)：添加 fileUrl prop，显示文件链接
- [ChatMessage.css](frontend/src/components/ChatMessage.css)：添加文件链接样式
- [ChatPage.tsx](frontend/src/pages/ChatPage.tsx)：传递 file_url 给 ChatMessage

### 验证
- TypeScript 类型检查通过
- Vite 生产构建成功
- 后端模块导入正常，API 端点注册正确

## 2026-05-19 修复光标闪烁位置

### 问题
- 等待 AI 回复时，所有 AI 消息都显示光标闪烁，应在最后一条 AI 消息位置显示

### 修改
- [ChatMessage.tsx](frontend/src/components/ChatMessage.tsx)：添加 `index` prop，计算最后一条 assistant 消息的索引，只在最后一条显示光标
- [ChatPage.tsx](frontend/src/pages/ChatPage.tsx)：渲染消息时传递 `index` prop

## 2026-05-19 修复主题切换图标反转

### 问题
- 深色模式显示太阳图标、浅色模式显示月亮图标，逻辑相反

### 修改
- [Sidebar.tsx](frontend/src/components/Sidebar.tsx)：深色模式显示月亮、浅色模式显示太阳

## 2026-05-19 修改输入栏 placeholder 文字

### 修改
- [ChatInput.tsx](frontend/src/components/ChatInput.tsx)：placeholder 改为"有问题，尽管问"

## 2026-05-19 修复流式输出时 Markdown 排版异常

### 问题
- AI 流式输出时，React Markdown 收到不完整的 Markdown 内容（未闭合的代码块、不完整表格等），导致排版奇怪
- 刷新后消息完整，排版恢复正常

### 修改
- [ChatMessage.tsx](frontend/src/components/ChatMessage.tsx)：流式输出期间（显示光标时）用纯文本 `<span>` 显示内容，流式结束后用 React Markdown 渲染
- [ChatPage.tsx](frontend/src/pages/ChatPage.tsx)：优化自动滚动逻辑，区分消息数量变化（新消息）和流式内容更新，避免流式期间频繁重渲染导致布局跳动

### 验证
- TypeScript 类型检查通过

## 2026-05-19 RAG 集成 - 知识库功能实现

实现检索增强生成（RAG）功能：文档上传时自动向量化存入 ChromaDB，对话时检索相关文档片段作为上下文。

### 技术选型
- **向量数据库**：ChromaDB（嵌入式，本地持久化）
- **Embedding 模型**：ONNX MiniLM L6 V2（本地运行，384维，无需 API key）
- **文档分块**：500 字符 chunks + 100 字符重叠

### 后端新增/修改文件
- [pyproject.toml](backend/pyproject.toml)：添加 `chromadb>=1.0.0`, `tiktoken>=0.7.0` 依赖
- [config.py](backend/src/core/config.py)：新增 `chroma_db_path`, `embedding_dim=384`, `rag_top_k=3` 配置
- [chunker.py](backend/src/utils/chunker.py)：新建文档分块工具（`chunk_text` 函数）
- [embedding_service.py](backend/src/services/embedding_service.py)：新建嵌入服务，使用 ONNXMiniLM_L6_V2 通过线程池异步调用
- [vector_store.py](backend/src/services/vector_store.py)：新建向量库服务，封装 ChromaDB PersistentClient
- [file_service.py](backend/src/services/file_service.py)：新增 `vectorize_and_store` 函数，文件上传后自动向量化
- [chat_service.py](backend/src/services/chat_service.py)：新增 `_retrieve_context` 函数，对话时检索相关文档片段并拼接到 prompt
- [models.py](backend/src/database/models.py)：新增 `kb_documents` 表
- [engine.py](backend/src/database/engine.py)：添加 KB 表 PRAGMA 迁移
- [routes.py](backend/src/api/routes.py)：新增 `/api/kb` 路由组（上传、列表、删除文档；列出、删除 collection）
- [schemas/knowledge_base.py](backend/src/schemas/knowledge_base.py)：新建知识库响应 schema
- [schemas/conversation.py](backend/src/schemas/conversation.py)：新建对话相关 schema

### 前端修改
- [client.ts](frontend/src/api/client.ts)：API 基础 URL 从 8000 改为 8001

### 关键修复
- ChromaDB ONNXMiniLM_L6_V2 只有 `embed_query` 没有 `embed_documents`，需在循环中逐个调用
- ChromaDB 1.5.9 中不存在的 collection 抛 `NotFoundError` 而非 `ValueError`
- Pydantic v2 `from_attributes=True` 要求 schema 字段类型与 SQLAlchemy model 严格匹配

## 2026-05-19 修复 KB 文档列表 500 错误

### 问题
- `GET /api/kb/documents` 返回 500：`PydanticValidationError: created_at Input should be a valid string`
- 根因：`KBDocumentResponse` schema 中 `created_at` 类型声明为 `str`，但 SQLAlchemy model 返回 `datetime` 对象

### 修改
- [knowledge_base.py](backend/src/schemas/knowledge_base.py)：`created_at: str` → `created_at: datetime`，添加 `from datetime import datetime` 导入

### 验证
- `GET /api/kb/documents` 返回正常，`created_at` 正确序列化为 ISO 格式字符串

## 2026-05-19 修复文件上传 404（后端旧进程）
