## 环境
- 当前只有开发环境，无生产数据、无生产用户。架构演进可直接做破坏性切换（改存储布局、重命名/删除列、改路径契约），无需保留兼容层、双写或数据迁移脚本；本地 `backend/data/` 可随时清空重建。

## 行为
- 完成需要改动代码的指令后，总结追加写入主目录/LOG.md，不读 LOG.md，不写流水账
  格式：`YYYY-MM-DD HH:mm [类别] xxx`
  要求：一行一条，按日志风格记录；面向用户回顾，不写代码实现细节
- 临时文件处理：临时文件统一放在主目录/temps，包括一些临时脚本、临时测试文件、临时文档等
- git commit: conventional 前缀（feat/perf/fix/docs/refactor/test/chore），message 用中文
- skill 调用：
  planning-with-files：仅在用户显式触发时才调用，不主动判断调用；计划文件必须创建在 .planning/<日期>-<任务名>/ 下，禁止写入项目根目录；progress和task_plan需要用emo维护(完成✅、待办⬜、阻塞🚧、进行🔄、取消❌)
  其余 skill：按默认规则（任务匹配时主动调用）

## 项目导航

后端 `backend/src/`：api(薄) / services(厚、按域聚合)。域自己 glob `services/*/` 看。
- **架构已建，复用别自造**——动手先 grep 确认没有，再决定新写：
  - 工具统一经 `assemble_tools` 装配（新工具进 registry/provider，别另起）；通用文件工具纯动词、**不给 bash**（绕过资源门禁+路径安全）
  - workspace 文件系统有路径安全分层 + 写操作 per-user 锁；**内部 service 假定外层持锁，别再获取→非重入死锁**
  - 博客正文 .md 是唯一事实源，读走 `get_post_body`；`blog_posts.content` 仅镜像，**强语义路径别裸读它**（会读到未同步的旧值）
  - 鉴权用 `Depends(get_current_user)` + 双 token 体系，**别自己解析 token**
  - 后台耗时任务挂进 `FileProcessingJob` 框架，别另起 task 管理
  - `DomainError` 子类抛业务错误（全局 handler 自动转 HTTP，api 层别 try/except）
  - 横切基建：配置只在 `settings`、schema 改动走 Alembic、prompt 只在 `prompts.py`、用户上下文 `current_user_id_cv`、日志已带 request_id
- 路由前缀 `/api/v1`；PostgreSQL(asyncpg) + FalkorDB(记忆图谱+向量)

前端 `frontend/src/`：分层 `api(请求) ← stores(全局态 chatStore) ← features/<域>/(自包含) ← App`。chat 流式协议用 `\x00帧名\x00` 标记（别破坏）；双 token（access 内存 + refresh HttpOnly cookie）+ 会话纪元守卫；设计系统 token 唯一源 + `check-design-system.mjs` 守门。
- **动手前先找已有能力，别自造**——全局态进 chatStore（user-scoped 字段默认值收在 `*_DEFAULTS`，initialState 与 LOGOUT 共用，漏加 LOGOUT 跨账号残留）；UI 原语库/业务 hook/纯工具/类型都已就位，**自己 grep/glob 看有什么再决定新写**；类型从 `types/` 直取（stores 不 re-export 域类型）。

原则：最小范围改；遵循架构/接口；不改无关代码，职责单一；数据 user-scoped；废弃代码及时删除。**本导航只讲"全局已有什么能力"建立全局观、不讲怎么做；新增/改变已有能力时，主动同步更新对应这句（不等提醒）。**

验证：commit 时 pre-commit 自动跑静态检查（后端 ruff+basedpyright 只查 src、前端 lint），**手动/CI 还需**：前端 `npm run build && npm run test`、后端 `uv run pytest`（默认 4 进程并行，单进程调试加 `-n0`）。**分级验证省时间**：前端改单域 `npx vitest run tests/<域>/`，后端改单域 `uv run pytest tests/<域>/ --no-cov`；仅动共享层或 commit 前跑全量。后端测试起 testcontainers 真容器，单用例 ~1.3s，全量不快——日常只跑改动域。

注释：简洁，只说作用不写原因，多数情况不写。