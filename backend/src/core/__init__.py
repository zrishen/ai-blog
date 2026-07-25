"""跨域基础设施：运行时上下文、统一异常。

- context.current_user_id_cv：当前请求用户 ID 的上下文变量
- exceptions：领域异常基类（service 抛、api 层全局 handler 翻译）

安全与依赖注入（get_current_user / get_db）的聚合见 Phase 4 域聚合。
"""
