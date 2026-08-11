import base64
import binascii
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from dotenv import load_dotenv
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# 加载 .env（不覆盖已有值），让非 Settings 变量（如 HF_ENDPOINT）也能被第三方库读到
load_dotenv()

# 项目根目录（backend/），所有数据路径基于此，不依赖 cwd
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ---- LLM 核心 ----
    openai_api_key: str = ""
    base_url: str = "https://api.openai.com/v1"
    model_name: str = "Qwen3.6-35B"

    # ---- 存储路径 ----
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/cortex"

    # ---- FalkorDB（AI 大脑）----
    # redis://[user:pass@]host:port；graph 名 cortex（与 PG 库同名）
    falkordb_url: str = "redis://localhost:6379"
    falkordb_username: str = ""
    falkordb_password: str = ""
    falkordb_graph_name: str = "cortex"
    # 默认启用；仅在 FalkorDB 故障等紧急回退场景显式设为 False。
    memory_enabled: bool = True
    memory_recall_top_k: int = 8
    memory_recall_hops: int = 2
    memory_decay_days: int = 90
    memory_maintenance_interval_seconds: float = 86400
    # 抽取档位：light=仅 Entity+Episode / deep=Entity+Fact+关系。
    # 默认 deep：Fact 是大脑时序记忆的核心（SUPERSEDES/valid_from-to/correct_fact），
    # light 会让 Fact 召回与事实管理无数据可用。light 仅作显式降级。
    memory_extract_depth: str = "deep"

    # ---- Embedding / 向量化 ----
    embedding_model: str = "Qwen3-Embedding-8B"
    embedding_base_url: str | None = "https://dygptapi.duoyioa.com/openai/v1"
    embedding_api_key: str | None = None
    embedding_batch_size: int = 32
    # embedding provider: "api"(OpenAI 兼容远程) | "local"(sentence-transformers 进程内模型)
    embedding_provider: str = "api"
    embedding_local_model: str = "Qwen/Qwen3-Embedding-0.6B"
    embedding_local_device: str = "cpu"

    # ---- 文件处理 worker 并发 ----
    # 全系统共享：所有用户加起来同时最多跑这么多 job。受 embedding provider 限流与内存预算约束。
    file_processing_concurrency: int = Field(4, ge=1)
    # 单用户并发上限：防一个用户批量加入 AI 知识索引独占全局槽位、饿死他人。
    # 默认 1——同用户索引串行，规避并发写同一用户记忆图（consolidator 时序）的竞态；
    # 1 本身已防独占（单用户最多占 1 槽），跨用户并行由 file_processing_concurrency 保证。
    # 记忆层并发经验证后可调高；单租户可设成与 file_processing_concurrency 相等。
    file_processing_user_concurrency: int = Field(1, ge=1)

    # ---- RAG 检索 ----
    rag_top_k: int = 3
    rag_distance_threshold: float = 0.7

    # ---- 安全密钥 ----
    # 无默认值：缺失或用公开弱值启动即失败；须通过 JWT_SECRET 注入高熵随机值
    jwt_secret: str = ""
    registration_invite_code: str = ""
    llm_settings_encryption_key: str

    # ---- Token 有效期 ----
    # access 短期 JWT 存客户端内存；refresh 存 DB 哈希，放 HttpOnly cookie
    access_token_expire_seconds: int = 15 * 60
    refresh_token_expire_seconds: int = 30 * 24 * 3600
    refresh_cookie_name: str = "refresh_token"
    # refresh 轮换宽限期：旧 token 在此窗口内被重用视为多标签页并发刷新竞态（宽容换新），
    # 超窗口才判定 token 被窃取、吊销该用户全部 refresh。覆盖浏览器 cookie 传播 + 刷新 RTT。
    refresh_rotation_grace_seconds: int = 30
    # preview token：弱权限令牌（type=preview，绑定 user+filename），仅用于 PDF iframe 这类
    # 必须把凭证放 URL 的场景；TTL 宽以支持长时阅读，安全靠 scope 收口而非时效。
    preview_token_expire_seconds: int = 24 * 3600

    # ---- Cookie / CORS ----
    # refresh cookie 的 secure：None=按请求协议自动推导（HTTPS / X-Forwarded-Proto → secure），
    # 防 HTTP 生产漏配；True/False=强制覆盖（本地 http 调试可显式设 False）。
    cookie_secure: bool | None = None
    cookie_samesite: str = "lax"
    # 同源部署留空（前端走 /api 相对路径）；跨域填逗号分隔 origin
    cors_allow_origins: str = ""

    # ---- 可观测性（Sentry / 链路追踪）----
    # 空 DSN = 禁用 Sentry；本地开发可不配。生产配置后捕获未处理异常 + 性能 trace。
    sentry_dsn: str = ""
    # 事务采样率 0.0~1.0；0=不上报性能追踪，生产建议 0.1~0.3。
    sentry_traces_sample_rate: float = 0.0
    # 部署环境标识（production/staging）；空=Sentry 默认。
    sentry_environment: str = ""

    # ---- 内容目录 ----
    blog_content_dir: str = str(DATA_DIR / "content" / "blog")
    upload_dir: str = str(DATA_DIR / "content" / "uploads")
    chat_attachment_dir: str = str(DATA_DIR / "content" / "chat_attachments")
    # Phase 2 真实工作目录：<workspace_root>/<username>/。内容文件的唯一 owner 根。
    workspace_root: str = str(DATA_DIR / "workspace")
    workspace_files_enabled: bool = True
    skill_prompt_max_chars: int = 12_000
    # ---- 聊天附件限制 ----
    chat_attachment_max_file_size_bytes: int = 10 * 1024 * 1024
    chat_attachment_max_image_size_bytes: int = 5 * 1024 * 1024
    chat_attachment_max_document_size_bytes: int = 10 * 1024 * 1024
    chat_attachment_max_count_per_message: int = 20
    chat_attachment_max_total_size_bytes: int = 25 * 1024 * 1024
    chat_attachment_max_document_chars: int = 30_000
    chat_attachment_max_total_document_chars: int = 80_000
    chat_attachment_upload_chunk_size_bytes: int = 1024 * 1024
    chat_attachment_pending_ttl_seconds: int = 24 * 3600
    chat_attachment_claim_ttl_seconds: int = 2 * 60 * 60
    chat_attachment_max_pending_count_per_user: int = 100
    chat_attachment_max_pending_size_bytes_per_user: int = 100 * 1024 * 1024
    chat_attachment_cleanup_batch_size: int = 20

    # ---- 图像生成 ----
    image_generation_provider: Literal["openai", "siliconflow"] = "openai"
    image_generation_model: str = "gpt-image-1"
    image_generation_size: str = "1536x1024"
    image_generation_base_url: str | None = None
    image_generation_api_key: str | None = None

    # ---- 认证频率限制（内存滑动窗口，防撞库/暴力注册）----
    auth_rate_limit_window_seconds: int = 60
    auth_login_rate_limit: int = 10
    auth_register_rate_limit: int = 5
    # /status 健康检查限流（未认证，防高频请求放大 DB/磁盘/图库探测负载）
    status_rate_limit: int = 30
    client_error_rate_limit: int = 20  # 每 IP 每分钟前端错误上报上限

    # ---- 公共聊天 ----
    public_chat_max_input_chars: int = 2000
    public_chat_max_context_chars: int = 6000
    public_chat_max_history_messages: int = 10
    public_chat_max_output_tokens: int = 800
    public_chat_daily_ip_limit: int = 10

    # ---- 订阅（平台 key 共享模式）----
    # 兑换码激活：订阅期用平台 key，按 token 周额度限制，超额/到期回退 BYOK
    subscription_duration_days: int = 30
    # 周额度，周一 00:00 UTC+8 重置；100M 为防滥用上限
    subscription_weekly_token_limit: int = 100_000_000
    # 单次请求 input token 上限（system+历史+当前+RAG+附件口径）
    subscription_per_request_token_limit: int = 100_000
    # 首次启动按账号密码自动创建；已存在则只提升权限，不覆盖密码
    super_admin_username: str | None = None
    super_admin_password: str | None = None

    # ---- 上下文压缩（compact 摘要）----
    # 超 budget*ratio 触发：保留最近 recent_count 条原文，更早的 LLM 摘要
    compact_context_budget: int = 20000
    compact_trigger_ratio: float = 0.7
    compact_recent_count: int = 12

    # ---- LLM 思考强度 ----
    # 三档思考强度: fast(low) / balanced(medium) / smart(high)
    smart_thinking_model_name: str | None = None
    llm_temperature: float = 0.2
    llm_max_output_tokens: int = 32768
    fast_thinking_budget_tokens: int = 2048
    balanced_thinking_budget_tokens: int = 8192
    smart_thinking_budget_tokens: int = 16384
    fast_extra_body: str | None = None
    balanced_extra_body: str | None = None
    smart_extra_body: str | None = None

    # ---- MCP ----
    mcp_call_timeout_seconds: float = 30.0

    # ---- Web 工具 ----
    # 默认关闭：仅在显式配置精确出站主机后开启，避免把任意 URL 读取面暴露给所有用户。
    web_tools_enabled: bool = False
    web_tool_daily_request_limit: int = Field(30, ge=1)
    web_fetch_connect_timeout_seconds: float = Field(10.0, gt=0)
    web_fetch_read_timeout_seconds: float = Field(20.0, gt=0)
    web_fetch_write_timeout_seconds: float = Field(10.0, gt=0)
    web_fetch_max_response_bytes: int = Field(2 * 1024 * 1024, ge=1)
    web_fetch_max_text_chars: int = Field(20_000, ge=1)
    web_fetch_max_redirects: int = Field(3, ge=0, le=10)
    web_fetch_allowed_hosts: str = ""
    web_fetch_allowed_ports: str = "80,443"
    web_fetch_allowed_content_types: str = "text/html,text/plain,application/json"
    # SearXNG 兼容 JSON 搜索端点；未配置时 web_search 明确返回不可用，web_fetch 不受影响。
    web_search_endpoint: str | None = None
    web_search_max_results: int = Field(5, ge=1, le=10)

    # ---- 流式超时兜底 ----
    # 思考期可能长时间无 event：调大 langchain 超时防误判卡死；agent_stream_idle_timeout 做最终兜底
    langchain_stream_chunk_timeout: float | None = 600.0
    agent_stream_idle_timeout: float = 600.0

    @field_validator("database_url")
    @classmethod
    def _database_url_must_be_secured(cls, value: str) -> str:
        # 非本地拒绝空密码/公开弱值（postgres），与 jwt_secret 强约束看齐；本地放行保留开发便利。
        # compose 部署另由 ${POSTGRES_PASSWORD:?} 在编排层兜底。
        parts = urlsplit(value)
        host = (parts.hostname or "").lower()
        is_local = host in {"localhost", "127.0.0.1", "::1"}
        password = parts.password or ""
        if not is_local and (not password or password == "postgres"):
            raise ValueError(
                "database_url 指向非本地主机却使用空密码或公开弱值（postgres），"
                "存在被直连拿库风险；请通过环境变量 DATABASE_URL 注入强密码。"
            )
        return value

    @field_validator("jwt_secret")
    @classmethod
    def _jwt_secret_must_be_strong(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError(
                "jwt_secret 未配置：请通过环境变量 JWT_SECRET 或 backend/.env 注入高熵随机值"
                "（可用 python -c \"import secrets; print(secrets.token_urlsafe(48))\" 生成）。"
            )
        if stripped == "dev-secret-key-change-in-production-env":
            raise ValueError(
                "jwt_secret 仍在使用仓库内的公开默认值，存在被伪造 JWT 的风险，请替换为高熵随机值。"
            )
        return stripped

    @field_validator("llm_settings_encryption_key")
    @classmethod
    def _llm_settings_encryption_key_must_be_valid(cls, value: str) -> str:
        stripped = value.strip()
        try:
            decoded = base64.urlsafe_b64decode(stripped.encode("ascii"))
        except (UnicodeEncodeError, binascii.Error, ValueError) as exc:
            raise ValueError("llm_settings_encryption_key 必须是有效的 Fernet 密钥") from exc
        if len(decoded) != 32:
            raise ValueError("llm_settings_encryption_key 必须是有效的 Fernet 密钥")
        return stripped


settings = Settings()
