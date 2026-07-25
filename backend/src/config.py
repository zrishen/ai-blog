import base64
import binascii
from pathlib import Path

from dotenv import load_dotenv
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# 加载 .env 到 os.environ（不覆盖已有值），让 HF_ENDPOINT 等非 Settings 变量也能被第三方库（如 huggingface_hub）读到
load_dotenv()

# 项目根目录（backend/），所有数据路径基于此绝对路径，不依赖 cwd
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ---- LLM 核心 ----
    openai_api_key: str = ""
    base_url: str = "https://api.openai.com/v1"
    model_name: str = "Qwen3.6-35B"

    # ---- 存储路径 ----
    database_url: str = f"sqlite+aiosqlite:///{(DATA_DIR / 'ai-blog.db').as_posix()}"
    chroma_db_path: str = str(DATA_DIR / "chroma_db")

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
    # 不提供可工作的默认值：缺失或使用公开弱值时启动即失败，
    # 部署必须通过 JWT_SECRET 环境变量（或本地 .env）注入高熵随机值。
    jwt_secret: str = ""
    registration_invite_code: str = ""
    llm_settings_encryption_key: str

    # ---- Token 有效期 ----
    # access token（短期 JWT，存客户端内存）；refresh token（不透明，存 DB 哈希，放 HttpOnly cookie）
    access_token_expire_seconds: int = 15 * 60
    refresh_token_expire_seconds: int = 30 * 24 * 3600
    refresh_cookie_name: str = "refresh_token"

    # ---- Cookie / CORS ----
    # refresh cookie 属性：本地 http 开发 cookie_secure=False；生产用环境变量覆盖为 True
    cookie_secure: bool = False
    cookie_samesite: str = "lax"
    # CORS：同源部署留空即可（前端走 /api 相对路径）；跨域部署时填逗号分隔的具体 origin
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
    image_generation_model: str = "gpt-image-1"
    image_generation_size: str = "1536x1024"

    # ---- 公共聊天 ----
    public_chat_max_input_chars: int = 2000
    public_chat_max_context_chars: int = 6000
    public_chat_max_history_messages: int = 10
    public_chat_max_output_tokens: int = 800
    public_chat_daily_ip_limit: int = 10

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
    # 思考模型思考阶段可能长时间不产生 event,这里给两个兜底:
    # 1. langchain 内部 stream_chunk_timeout 调大,避免思考期间被误判卡死后异常被 astream_events 吞掉
    # 2. 我们自己的 agent_stream_idle_timeout 作为最终兜底,N 秒无 event 主动 raise 让上层正常收尾
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
