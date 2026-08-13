## 环境
- 当前只有开发环境，无生产数据、无生产用户。架构演进可直接做破坏性切换（改存储布局、重命名/删除列、改路径契约），无需保留兼容层、双写或数据迁移脚本；本地 `backend/data/` 可随时清空重建。

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
AI 写作 + 知识库 RAG；前后端分离 + LangGraph。

后端 `backend/src/`：api(薄) / services(厚、按域聚合)。域：blog/chat/conversation/public_chat/memory(图谱+向量)/file/markdown/trash/subscription/workspace/user/admin/llm/embeddings/plugins。项目特定约定——
- `prompts.py` 是 prompt 唯一源，别散落到别处
- chat 是拆分聚合的大模块，流式入口 `services/chat/orchestrator.stream_chat`
- 博客正文以 workspace 的 .md 文件为唯一事实源（user-scoped，agent 经文件工具 read/write/edit 直接操作；`blog_body_service.get_post_body(post)` 是运行期规范读法）。`blog_posts.content` 是可重建的搜索/兼容镜像——由 `reconcile_blog_document`(md→content) 与 `sync_blog_document`(content→md) 双向同步保持忠实，`blocks_json` 是派生 AST 缓存。强语义路径（编辑器正文 `get_blog_post` owner 分支、图片引用判断的删除/隐藏链路：孤儿清理/回收站 purge/软删隐藏）读 md 真相；缓存路径（作者列表搜索 `list_posts`、作者本人图片授权 `_find_owner_post_referencing_image`）保留读 content 镜像并依赖 reconcile 忠实；公开发布以不可变 `BlogPostRevision.content` 为权威，不动。改正文经博客工具/API（写 content→sync 出 md）或直接改 md（→reconcile 回写 content）两条入口；workspace 文件工具（write/edit/git restore）写时持 per-user workspace_lock 串行
- 路由前缀 `/api/v1`；PostgreSQL(asyncpg) + FalkorDB(记忆图谱+向量)

前端 `frontend/src/`：分层单向依赖 `api ← stores ← features ← App`（stores/api 都不 import features，由 `eslint import-x/no-restricted-paths` error 守门）。`features/<域>/` 自包含、统一经 `index.ts` barrel 对外；`api/client.ts` 统一请求（双 token：access 内存 + refresh HttpOnly cookie，401 单飞刷新 + 会话纪元守卫）；`types/` 是类型唯一源——**features 从 `@/types/*` 直取类型，stores 不再 re-export 域类型做中转**（chatStore 只导出自家 `ChatState`/`ChatAction`）；业务沉 hook。chatStore 拆 7 slice：`chatReducer` 依次委托 7 子 reducer，LOGOUT 跨域重置——`initialState` 与 LOGOUT 共享 `AI_SIDEBAR/BLOG/WORKSPACE/BRAIN_DEFAULTS` 常量，**加 user-scoped 字段只改对应 `*_DEFAULTS` 一处**（不要漏加 LOGOUT，否则跨账号残留）。`tsconfig.app.json` 已开 `strict`（编译期收口 null/any）；`eslint.config.js` 启用 `recommendedTypeChecked` + `no-floating-promises` error。

设计系统（改 UI 必读，`scripts/check-design-system.mjs` 守门 + CI 强制）：`index.css` 是 token 唯一源——色用语义 token（`bg-primary`/`text-muted-foreground`/`border-border`…）禁硬编码调色板色；圆角 `rounded-{panel,control,surface,shell}`；字号（`index.css` token）：`text-caption(11)/fine(12)/meta(13)/body(14)/body-lg(15)` 联动 `--font-base`，`text-reading(16)` 锁定用于阅读正文（AI 消息/文章正文）；标题 `text-{xl,2xl,3xl}`。场景→档位：阅读正文=reading；界面主文本(列表/导航/表单/默认按钮/Dialog 正文)=body；次要(时间戳/Alert/段落小标题条/Dialog 描述/helper)=meta；微信息(Badge/Eyebrow/tooltip/计数)=fine；最小(脚注/节点元数据)=caption；紧凑按钮=meta；Dialog 标题=body-lg。**禁裸用 `text-xs/sm/base`**（等像素已并入 fine/body/reading，表单防缩放用 `text-reading md:text-body`）；复用 `components/ui/` 原语（EmptyState/SectionTitle/PageHeader/Surface/Badge/Button…），别新造。

原则：最小范围改；遵循架构/接口；不改无关代码，职责单一；数据 user-scoped；废弃代码要及时删除，不残留死代码。

验证：前端 `npm run lint && npm run build && npm run test`，后端 `uv run pytest`（自动覆盖率、不设硬阈值）；按改动跑域测试即可。

注释：注释简洁，不写原因注释，只需要说明作用。大部分情况下不写注释