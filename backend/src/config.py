import base64
import binascii
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from pydantic import field_validator
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

    # ---- Cookie / CORS ----
    # 本地 http 开发 False；生产用环境变量覆盖为 True
    cookie_secure: bool = False
    cookie_samesite: str = "lax"
    # 同源部署留空（前端走 /api 相对路径）；跨域填逗号分隔 origin
    cors_allow_origins: str = ""

    # ---- 内容目录 ----
    blog_content_dir: str = str(DATA_DIR / "content" / "blog")
    upload_dir: str = str(DATA_DIR / "content" / "uploads")
    chat_attachment_dir: str = str(DATA_DIR / "content" / "chat_attachments")

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
    # 指定已存在的用户名，启动时幂等提升为普通 admin；留空不处理
    initial_admin_username: str | None = None

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

    # ---- 流式超时兜底 ----
    # 思考期可能长时间无 event：调大 langchain 超时防误判卡死；agent_stream_idle_timeout 做最终兜底
    langchain_stream_chunk_timeout: float | None = 600.0
    agent_stream_idle_timeout: float = 600.0

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
