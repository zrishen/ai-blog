from pathlib import Path
from pydantic import field_validator
from pydantic_settings import BaseSettings

# 项目根目录（backend/），所有数据路径基于此绝对路径，不依赖 cwd
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"


class Settings(BaseSettings):
    openai_api_key: str = ""
    base_url: str = "https://api.openai.com/v1"
    model_name: str = "Qwen3.6-35B"
    database_url: str = f"sqlite+aiosqlite:///{(DATA_DIR / 'ai-blog.db').as_posix()}"
    chroma_db_path: str = str(DATA_DIR / "chroma_db")
    embedding_model: str = "Qwen3-Embedding-8B"
    embedding_base_url: str | None = "https://dygptapi.duoyioa.com/openai/v1"
    embedding_api_key: str | None = None
    embedding_batch_size: int = 32
    rag_top_k: int = 3
    rag_distance_threshold: float = 0.7
    # 不提供可工作的默认值：缺失或使用公开弱值时启动即失败，
    # 部署必须通过 JWT_SECRET 环境变量（或本地 .env）注入高熵随机值。
    jwt_secret: str = ""
    # access token（短期 JWT，存客户端内存）；refresh token（不透明，存 DB 哈希，放 HttpOnly cookie）
    access_token_expire_seconds: int = 15 * 60
    refresh_token_expire_seconds: int = 30 * 24 * 3600
    refresh_cookie_name: str = "refresh_token"
    # refresh cookie 属性：本地 http 开发 cookie_secure=False；生产用环境变量覆盖为 True
    cookie_secure: bool = False
    cookie_samesite: str = "lax"
    # CORS：同源部署留空即可（前端走 /api 相对路径）；跨域部署时填逗号分隔的具体 origin
    cors_allow_origins: str = ""
    blog_content_dir: str = str(DATA_DIR / "content" / "blog")
    upload_dir: str = str(DATA_DIR / "content" / "uploads")
    image_generation_model: str = "gpt-image-1"
    image_generation_size: str = "1536x1024"
    public_chat_max_input_chars: int = 2000
    public_chat_max_context_chars: int = 6000
    public_chat_max_history_messages: int = 10
    public_chat_max_output_tokens: int = 800
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
    mcp_call_timeout_seconds: float = 30.0
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

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()

