## 行为
- 完成需要改动代码的指令后，总结追加写入主目录/LOG.md，不读 LOG.md，不写流水账
  格式：`YYYY-MM-DD HH:mm [类别] xxx`
  要求：一行一条，按日志风格记录；面向用户回顾，不写代码实现细节
- 临时文件处理：临时文件统一放在主目录/temps，包括一些临时脚本、临时测试文件、临时文档等
- git commit风格
  feat: 新功能
  perf: 优化
  fix: 修复问题
  docs: 修改文档
  refactor: 重构
  test: 增加或修改测试
  chore: 构建、依赖、配置等
- skill 调用：
  planning-with-files：仅在用户显式触发时才调用，不主动判断调用；计划文件必须创建在 .planning/<日期>-<任务名>/ 下，禁止写入项目根目录；progress和task_plan需要用emo维护(完成✅、待办⬜、阻塞🚧、进行🔄、取消❌)
  其余 skill：按默认规则（任务匹配时主动调用）


## 项目导航
AI 写作 + 知识库 RAG + 研究图谱；前后端分离 + LangGraph。

后端 `backend/src/`：api(薄) / services(厚、按域聚合)。项目特定约定——
- `prompts.py` 是 prompt 唯一源，别散落到别处
- chat、research 是拆分聚合的大模块，流式入口 `services/chat/orchestrator.stream_chat`
- 博客 Markdown 是事实源，DB 仅索引（改正文改 MD，别只改 DB）
- 路由前缀 `/api/v1`；SQLite(aiosqlite)+ChromaDB

前端 `frontend/src/`：`features/<域>/` 自包含；`api/client.ts` 统一请求（双 token：access 内存 + refresh HttpOnly cookie，401 单飞刷新）；业务沉 hook；chatStore 拆 7 slice，改 reducer 注意 LOGOUT 跨域重置（范式 `features/research/hooks/`）。

设计系统（改 UI 必读，`scripts/check-design-system.mjs` 守门 + CI 强制）：`index.css` 是 token 唯一源——色用语义 token（`bg-primary`/`text-muted-foreground`/`border-border`…）禁硬编码调色板色；圆角 `rounded-{panel,control,surface,shell}`；字号 `text-{caption,fine,meta,body,body-lg}`（联动 `--font-base`），标题 `text-{3xl,2xl,xl}`；复用 `components/ui/` 原语（EmptyState/SectionTitle/PageHeader/Surface/Badge/Button…），别新造。

原则：最小范围改；遵循架构/接口；不改无关代码，职责单一；数据 user-scoped；废弃代码要及时删除，不残留死代码。

验证：前端 `npm run lint && npm run build && npm run test`，后端 `uv run pytest`（自动覆盖率、不设硬阈值）；按改动跑域测试即可。